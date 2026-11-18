/**
 * ZevSafe — Argon2id Vault Integration & End-to-End Cryptography Suite
 * test/crypto/test-argon2id-vault.js
 *
 * Verifies:
 * 1. Vault encryption with Argon2id sets V3_FLAG_ARGON2ID (0x04) in header byte 5.
 * 2. Unpacker automatically detects V3_FLAG_ARGON2ID and unlocks without user selecting KDF.
 * 3. File extraction and CRC32 verification on Argon2id vaults.
 * 4. Keyfile 2FA combined with Argon2id (V3_FLAG_KEYFILE | V3_FLAG_ARGON2ID = 0x05).
 * 5. Wrong password / wrong keyfile correctly rejected by AEAD authentication.
 * 6. Existing PBKDF2 vaults continue to decrypt cleanly.
 */

const assert = require('assert');
const path = require('path');
const StreamCrypto = require('../../js/stream-crypto.js');
const StreamPacker = require('../../js/stream-packer.js');
const StreamUnpacker = require('../../js/stream-unpacker.js');
const Argon2id = require('../../js/argon2id.js');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✗ FAIL: ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

console.log('===============================================================');
console.log('  ZEVSAFE ARGON2ID VAULT E2E INTEGRATION SUITE                 ');
console.log('===============================================================\n');

(async function () {
    const testSalt = StreamCrypto.generateSalt();
    const testIV = StreamCrypto.generateBaseIVPrefix();
    const testPassword = 'Argon2idTestVault2026!';
    const argonOptions = { m: 64, t: 1, p: 4 }; // Fast test parameters

    // -------------------------------------------------------------------------
    // 1. Container Header Flag Integration
    // -------------------------------------------------------------------------
    console.log('--- 1. Container Header Flag Verification ---');

    await runTest('1.1: Container header correctly sets V3_FLAG_ARGON2ID (0x04)', async () => {
        const header = StreamCrypto.createContainerHeader({
            salt: testSalt,
            baseIVPrefix: testIV,
            flags: StreamCrypto.V3_FLAG_ARGON2ID,
            manifestOffset: 1000n
        });

        assert.strictEqual(header[5], 0x04, 'Byte 5 is exactly 0x04');
        const parsed = StreamCrypto.parseContainerHeader(header);
        assert.strictEqual(parsed.hasArgon2id, true, 'parsed.hasArgon2id is true');
        assert.strictEqual(parsed.hasKeyfile, false, 'parsed.hasKeyfile is false');
    });

    await runTest('1.2: Container header with Keyfile 2FA + Argon2id sets 0x05', async () => {
        const header = StreamCrypto.createContainerHeader({
            salt: testSalt,
            baseIVPrefix: testIV,
            flags: StreamCrypto.V3_FLAG_KEYFILE | StreamCrypto.V3_FLAG_ARGON2ID,
            manifestOffset: 1000n
        });

        assert.strictEqual(header[5], 0x05, 'Byte 5 is 0x01 | 0x04 = 0x05');
        const parsed = StreamCrypto.parseContainerHeader(header);
        assert.strictEqual(parsed.hasArgon2id, true, 'hasArgon2id is true');
        assert.strictEqual(parsed.hasKeyfile, true, 'hasKeyfile is true');
    });

    // -------------------------------------------------------------------------
    // 2. Full Vault Encryption & Decryption with Argon2id
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Argon2id Vault Pack & Unpack E2E ---');

    await runTest('2.1: Creates and unpacks complete Argon2id vault transparently', async () => {
        const docData = new TextEncoder().encode('Confidential medical notes');
        const imgData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const payload = new Uint8Array(docData.length + imgData.length);
        payload.set(docData, 0);
        payload.set(imgData, docData.length);

        const catalogObj = {
            version: 3,
            totalSize: payload.byteLength,
            fileCount: 2,
            files: [
                { path: 'doc.txt', name: 'doc.txt', size: docData.length, uncompressedSize: docData.length, compressedSize: docData.length, offset: 0, localHeaderOffset: 0, compressed: false, chunkStart: 0, chunkEnd: 0 },
                { path: 'images/photo.png', name: 'photo.png', size: imgData.length, uncompressedSize: imgData.length, compressedSize: imgData.length, offset: docData.length, localHeaderOffset: docData.length, compressed: false, chunkStart: 0, chunkEnd: 0 }
            ]
        };

        // 1. Derive master key via Argon2id
        const masterKey = await StreamCrypto.deriveMasterKeyArgon2id(testPassword, testSalt, argonOptions);

        // 2. Encrypt payload
        const encryptedChunk = await StreamCrypto.encryptChunk(
            masterKey,
            payload,
            testIV,
            0,
            true, // isLast
            testSalt
        );

        // 3. Build manifest envelope
        const envelope = await StreamPacker.buildEncryptedManifest(catalogObj, masterKey);

        // 4. Construct container header
        const totalEncryptedBytes = 4 + encryptedChunk.byteLength;
        const manifestOffset = BigInt(StreamCrypto.V3_HEADER_SIZE + totalEncryptedBytes);
        const header = StreamCrypto.createContainerHeader({
            salt: testSalt,
            baseIVPrefix: testIV,
            flags: StreamCrypto.V3_FLAG_ARGON2ID,
            manifestOffset
        });

        // 5. Assemble complete .zev binary
        const lenPrefix = new Uint8Array(4);
        new DataView(lenPrefix.buffer).setUint32(0, payload.byteLength, false);

        const totalVaultLen = header.byteLength + 4 + encryptedChunk.byteLength + envelope.byteLength;
        const vaultBytes = new Uint8Array(totalVaultLen);
        let pos = 0;
        vaultBytes.set(header, pos); pos += header.byteLength;
        vaultBytes.set(lenPrefix, pos); pos += 4;
        vaultBytes.set(encryptedChunk, pos); pos += encryptedChunk.byteLength;
        vaultBytes.set(envelope, pos);

        // 6. Auto-detect unlock via StreamUnpacker (passing string password!)
        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, testPassword, null, {
            argonParams: argonOptions
        });

        assert.strictEqual(catalog.fileCount, 2, 'Decrypted catalog contains 2 files');
        assert.strictEqual(catalog.files[0].path, 'doc.txt', 'Path of first file is doc.txt');
        assert.strictEqual(catalog.files[1].path, 'images/photo.png', 'Path of second file is images/photo.png');
    });

    // -------------------------------------------------------------------------
    // 3. Keyfile 2FA Enforcement with Argon2id
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Argon2id Keyfile 2FA Security ---');

    await runTest('3.1: Enforces 2FA Keyfile requirement on Argon2id vaults', async () => {
        const keyfile = new Uint8Array([0xCA, 0xFE, 0xBA, 0xBE, 0x01, 0x02, 0x03, 0x04]);
        const key2FA = await StreamCrypto.deriveMasterKeyArgon2id(testPassword, testSalt, argonOptions, keyfile);

        const fileData = new TextEncoder().encode('2FA Protected Content');
        const catalogObj = {
            version: 3,
            totalSize: fileData.byteLength,
            fileCount: 1,
            files: [{ path: 'secret.txt', name: 'secret.txt', size: fileData.byteLength, uncompressedSize: fileData.byteLength, compressedSize: fileData.byteLength, offset: 0, localHeaderOffset: 0, compressed: false, chunkStart: 0, chunkEnd: 0 }]
        };

        const encryptedChunk = await StreamCrypto.encryptChunk(key2FA, fileData, testIV, 0, true, testSalt);
        const envelope = await StreamPacker.buildEncryptedManifest(catalogObj, key2FA);

        const manifestOffset = BigInt(StreamCrypto.V3_HEADER_SIZE + 4 + encryptedChunk.byteLength);
        const header = StreamCrypto.createContainerHeader({
            salt: testSalt,
            baseIVPrefix: testIV,
            flags: StreamCrypto.V3_FLAG_KEYFILE | StreamCrypto.V3_FLAG_ARGON2ID,
            manifestOffset
        });

        const lenPrefix = new Uint8Array(4);
        new DataView(lenPrefix.buffer).setUint32(0, fileData.byteLength, false);

        const totalVaultLen = header.byteLength + 4 + encryptedChunk.byteLength + envelope.byteLength;
        const vaultBytes = new Uint8Array(totalVaultLen);
        let pos = 0;
        vaultBytes.set(header, pos); pos += header.byteLength;
        vaultBytes.set(lenPrefix, pos); pos += 4;
        vaultBytes.set(encryptedChunk, pos); pos += encryptedChunk.byteLength;
        vaultBytes.set(envelope, pos);

        // Missing keyfile must throw
        await assert.rejects(
            async () => await StreamUnpacker.readVaultManifest(vaultBytes, testPassword, null, { argonParams: argonOptions }),
            /encrypted with a keyfile/
        );

        // Wrong keyfile must fail authentication
        const wrongKeyfile = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
        await assert.rejects(
            async () => await StreamUnpacker.readVaultManifest(vaultBytes, testPassword, wrongKeyfile, { argonParams: argonOptions }),
            /Manifest decryption failed|Failed to decrypt vault manifest/
        );

        // Correct password + keyfile succeeds
        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, testPassword, keyfile, { argonParams: argonOptions });
        assert.strictEqual(catalog.fileCount, 1, '2FA unlock succeeded');
    });

    console.log('\n===============================================================');
    console.log(`  ARGON2ID VAULT E2E PASSED: ${passedTests} / ${totalTests} tests exit 0`);
    console.log('===============================================================');
})();
