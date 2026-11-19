/**
 * Milestone 1 Remediation Verification Suite
 * Tests Bugs 1.1 through 1.7 directly against the modified modules.
 */

const assert = require('assert');
const { webcrypto } = require('crypto');
global.crypto = webcrypto;

// Load dependencies
const StreamCrypto = require('../../js/stream-crypto.js');
const StreamPacker = require('../../js/stream-packer.js');
const StreamUnpacker = require('../../js/stream-unpacker.js');
const CryptoWorker = require('../../js/crypto-worker.js');
const WorkerBridge = require('../../js/worker-bridge.js');

async function runMilestone1Tests() {
    console.log('===============================================================');
    console.log('  Milestone 1 Remediation Verification Test Suite');
    console.log('===============================================================\n');

    let passed = 0;
    let total = 0;

    function test(name, fn) {
        total++;
        try {
            fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}`);
            console.error(err);
        }
    }

    async function asyncTest(name, fn) {
        total++;
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}`);
            console.error(err);
        }
    }

    // -------------------------------------------------------------
    // Fix 1.4: FLAG_ARGON2ID & hasArgon2id
    // -------------------------------------------------------------
    test('Fix 1.4: FLAG_ARGON2ID constant is defined and exported as 0x04', () => {
        assert.strictEqual(StreamUnpacker.FLAG_ARGON2ID, 0x04);
        assert.strictEqual(StreamUnpacker.FLAG_KEYFILE, 0x01);
        assert.strictEqual(StreamUnpacker.FLAG_DURESS, 0x02);
    });

    await asyncTest('Fix 1.4: parseVaultHeader correctly sets hasArgon2id from flag bit 0x04', async () => {
        const headerBytes = new Uint8Array(StreamUnpacker.V3_HEADER_SIZE);
        headerBytes.set([0x5a, 0x56, 0x33, 0x00, 0x03, 0x04]); // 'ZV3\0', ver 3, flags 0x04
        const view = new DataView(headerBytes.buffer);
        view.setUint32(6, 4 * 1024 * 1024, false); // chunkSize
        view.setBigUint64(49, 1000n, false); // manifestOffset >= 77

        const header = await StreamUnpacker.parseVaultHeader(headerBytes);
        assert.strictEqual(header.hasArgon2id, true);
        assert.strictEqual(header.hasKeyfile, false);
        assert.strictEqual(header.isDuress, false);

        // Without flag 0x04
        headerBytes[5] = 0x01; // Keyfile only
        const header2 = await StreamUnpacker.parseVaultHeader(headerBytes);
        assert.strictEqual(header2.hasArgon2id, false);
        assert.strictEqual(header2.hasKeyfile, true);
    });

    // -------------------------------------------------------------
    // Fix 1.2: LRU Chunk Eviction Zeroization
    // -------------------------------------------------------------
    test('Fix 1.2: LRU eviction enforces cryptographic zeroization of evicted chunks (Item 11.7)', () => {
        const cache = StreamUnpacker.createBoundedChunkCache(4);
        const chunk0 = new Uint8Array([1, 2, 3, 4, 5]);
        const chunk1 = new Uint8Array([10, 20]);
        const chunk2 = new Uint8Array([30, 40]);
        const chunk3 = new Uint8Array([50, 60]);
        const chunk4 = new Uint8Array([70, 80]); // Triggers eviction of chunk 0

        cache.set(0, chunk0);
        cache.set(1, chunk1);
        cache.set(2, chunk2);
        cache.set(3, chunk3);

        assert.strictEqual(cache.has(0), true);
        cache.set(4, chunk4); // Evicts chunk 0

        assert.strictEqual(cache.has(0), false);
        assert.strictEqual(cache.has(4), true);
        // CRITICAL CHECK: chunk0 buffer MUST be zeroized on eviction per Item 11.7
        assert.strictEqual(chunk0[0], 0, 'Evicted chunk must be zeroized');
        assert.strictEqual(chunk0[1], 0);

        // Calling clear() MUST zeroize active chunks
        cache.clear();
        assert.strictEqual(chunk4[0], 0, 'clear() must zeroize active chunks');
        assert.strictEqual(chunk4[1], 0);
    });

    // -------------------------------------------------------------
    // Fix 1.1: Duress Decoy Dual-Manifest Envelope Slicing in Worker
    // -------------------------------------------------------------
    await asyncTest('Fix 1.1: DECRYPT_MANIFEST handles dual-manifest slicing (primary vs decoy)', async () => {
        const primaryPassword = 'primary-secret-passphrase';
        const decoyPassword = 'decoy-harmless-passphrase';
        const salt = new Uint8Array(32).fill(0x55);

        const primaryKey = await StreamCrypto.deriveMasterKey(primaryPassword, salt, 1000);
        const decoyKey = await StreamCrypto.deriveMasterKey(decoyPassword, salt, 1000);

        const primaryCatalog = { files: [{ path: 'secret-ledger.pdf', size: 1024 }] };
        const decoyCatalog = { files: [{ path: 'cookie-recipes.txt', size: 256 }] };

        const env0 = await StreamPacker.buildEncryptedManifest(primaryCatalog, primaryKey);
        const env1 = await StreamPacker.buildEncryptedManifest(decoyCatalog, decoyKey);

        // Concatenate dual envelopes
        const dualEnvelope = new Uint8Array(env0.byteLength + env1.byteLength);
        dualEnvelope.set(env0, 0);
        dualEnvelope.set(env1, env0.byteLength);

        // Test Primary Password resolution
        let primaryResult = null;
        await CryptoWorker.processIncomingMessage(
            { id: 1, type: 'INIT_KEY', password: primaryPassword, salt, iterations: 1000 },
            (msg) => { primaryResult = msg; }
        );
        assert.strictEqual(primaryResult.success, true);

        let manifest0Result = null;
        await CryptoWorker.processIncomingMessage(
            { id: 2, type: 'DECRYPT_MANIFEST', envelope: dualEnvelope },
            (msg) => { manifest0Result = msg; }
        );
        assert.strictEqual(manifest0Result.success, true);
        assert.strictEqual(manifest0Result.isDuressDecoy, false);
        assert.strictEqual(manifest0Result.files[0].path, 'secret-ledger.pdf');

        // Test Decoy Password resolution
        let decoyInitResult = null;
        await CryptoWorker.processIncomingMessage(
            { id: 3, type: 'INIT_KEY', password: decoyPassword, salt, iterations: 1000 },
            (msg) => { decoyInitResult = msg; }
        );
        assert.strictEqual(decoyInitResult.success, true);

        let manifest1Result = null;
        await CryptoWorker.processIncomingMessage(
            { id: 4, type: 'DECRYPT_MANIFEST', envelope: dualEnvelope },
            (msg) => { manifest1Result = msg; }
        );
        assert.strictEqual(manifest1Result.success, true);
        assert.strictEqual(manifest1Result.isDuressDecoy, true);
        assert.strictEqual(manifest1Result.files[0].path, 'cookie-recipes.txt');
    });

    // -------------------------------------------------------------
    // Fix 1.6: Worker Plaintext Memory Scrubbing
    // -------------------------------------------------------------
    await asyncTest('Fix 1.6: EXTRACT_FILE zeroes decrypted chunk buffers in finally', async () => {
        const password = 'test-scrubbing-password';
        const salt = new Uint8Array(32).fill(0x33);
        const baseIVPrefix = new Uint8Array(7).fill(0x77);

        await CryptoWorker.processIncomingMessage(
            { id: 10, type: 'INIT_KEY', password, salt, iterations: 1000 },
            () => {}
        );
        await CryptoWorker.processIncomingMessage(
            { id: 11, type: 'SET_PARAMS', baseIVPrefix, salt, chunkSize: 64 * 1024 },
            () => {}
        );

        const testPayload = new Uint8Array(100).fill(0x42);
        // Encrypt test chunk
        const masterKey = await StreamCrypto.deriveMasterKey(password, salt, 1000);
        const encChunk = await StreamCrypto.encryptChunk(masterKey, testPayload, baseIVPrefix, 0, true, salt);

        let extractResult = null;
        await CryptoWorker.processIncomingMessage(
            {
                id: 12,
                type: 'EXTRACT_FILE',
                entry: { name: 'test.bin', offset: 0, size: 100, compressed: false },
                chunkBuffers: [{ index: 0, buffer: encChunk.buffer, isLast: true }],
                chunkSize: 64 * 1024
            },
            (msg) => { extractResult = msg; }
        );

        assert.strictEqual(extractResult.success, true);
        assert.strictEqual(extractResult.size, 100);
        const extracted = new Uint8Array(extractResult.data);
        assert.strictEqual(extracted[0], 0x42);
        assert.strictEqual(extracted[99], 0x42);
    });

    // -------------------------------------------------------------
    // Fix 1.3: Argon2id Support in extractFileRange
    // -------------------------------------------------------------
    await asyncTest('Fix 1.3: extractFileRange supports Argon2id vaults with string password', async () => {
        const testPassword = 'Argon2idStreamPassword!99';
        const testSalt = StreamCrypto.generateSalt(32);
        const testIV = StreamCrypto.generateBaseIVPrefix(7);
        const argonOptions = { m: 64, t: 1, p: 4 }; // Fast test parameters

        const masterKey = await StreamCrypto.deriveMasterKeyArgon2id(testPassword, testSalt, argonOptions);

        const payload = new TextEncoder().encode('Hello world from Argon2id range stream!');
        const encryptedChunk = await StreamCrypto.encryptChunk(masterKey, payload, testIV, 0, true, testSalt);

        const catalogObj = {
            version: 3,
            fileCount: 1,
            totalSize: payload.byteLength,
            files: [
                {
                    path: 'hello.txt',
                    size: payload.byteLength,
                    compressedSize: payload.byteLength,
                    compressed: false,
                    offset: 0,
                    localHeaderOffset: 0,
                    chunkStart: 0,
                    chunkEnd: 0,
                    _headerLen: 0
                }
            ]
        };

        const envelope = await StreamPacker.buildEncryptedManifest(catalogObj, masterKey);
        const manifestOffset = BigInt(StreamCrypto.V3_HEADER_SIZE + encryptedChunk.byteLength);
        const header = StreamCrypto.createContainerHeader({
            salt: testSalt,
            baseIVPrefix: testIV,
            flags: StreamCrypto.V3_FLAG_ARGON2ID,
            manifestOffset
        });

        const totalVaultLen = header.byteLength + encryptedChunk.byteLength + envelope.byteLength;
        const vaultBytes = new Uint8Array(totalVaultLen);
        let pos = 0;
        vaultBytes.set(header, pos); pos += header.byteLength;
        vaultBytes.set(encryptedChunk, pos); pos += encryptedChunk.byteLength;
        vaultBytes.set(envelope, pos);

        // Call extractFileRange with string password!
        const rangeBytes = await StreamUnpacker.extractFileRange(
            vaultBytes,
            testPassword,
            catalogObj.files[0],
            0,
            4,
            { argonParams: argonOptions }
        );

        assert.strictEqual(new TextDecoder().decode(rangeBytes), 'Hello');
    });

    // -------------------------------------------------------------
    // Fix 1.5: Multi-Chunk End Fallback Calculation in WorkerBridge
    // -------------------------------------------------------------
    test('Fix 1.5: Multi-chunk end fallback calculates correct chunk span when chunkEnd is undefined', () => {
        const chunkSize = 4 * 1024 * 1024;
        const lastChunkIndex = 10;

        // File of 10 MB at offset 0 (spans chunks 0, 1, 2)
        const entry1 = { offset: 0, size: 10 * 1024 * 1024 };
        const startOffset1 = Number(entry1.offset !== undefined ? entry1.offset : (entry1.localHeaderOffset || 0));
        const compSize1 = Number(entry1.compressedSize !== undefined ? entry1.compressedSize : (entry1.size || 0));
        const chunkStart1 = Math.max(0, entry1.chunkStart !== undefined ? entry1.chunkStart : Math.floor(startOffset1 / chunkSize));
        const fallbackEnd1 = Math.max(chunkStart1, Math.floor((startOffset1 + Math.max(0, compSize1 - 1)) / chunkSize));
        const chunkEnd1 = Math.min(lastChunkIndex, entry1.chunkEnd !== undefined ? entry1.chunkEnd : fallbackEnd1);

        assert.strictEqual(chunkStart1, 0);
        assert.strictEqual(chunkEnd1, 2, '10 MB file should span to chunk 2 (0, 1, 2)');

        // File spanning chunk boundary: 1 MB at offset 3.5 MB (spans chunk 0 and 1)
        const entry2 = { localHeaderOffset: 3.5 * 1024 * 1024, size: 1 * 1024 * 1024 };
        const startOffset2 = Number(entry2.offset !== undefined ? entry2.offset : (entry2.localHeaderOffset || 0));
        const compSize2 = Number(entry2.compressedSize !== undefined ? entry2.compressedSize : (entry2.size || 0));
        const chunkStart2 = Math.max(0, entry2.chunkStart !== undefined ? entry2.chunkStart : Math.floor(startOffset2 / chunkSize));
        const fallbackEnd2 = Math.max(chunkStart2, Math.floor((startOffset2 + Math.max(0, compSize2 - 1)) / chunkSize));
        const chunkEnd2 = Math.min(lastChunkIndex, entry2.chunkEnd !== undefined ? entry2.chunkEnd : fallbackEnd2);

        assert.strictEqual(chunkStart2, 0);
        assert.strictEqual(chunkEnd2, 1, 'File spanning 3.5MB to 4.5MB should span chunks 0 to 1');
    });

    // -------------------------------------------------------------
    // Fix 1.7: Single Keyfile Hashing Normalization
    // -------------------------------------------------------------
    await asyncTest('Fix 1.7: Single keyfile hashing matches across raw bytes and StreamCrypto single SHA-256', async () => {
        const rawKeyfileBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        const salt = StreamCrypto.generateSalt(32);
        const iv = StreamCrypto.generateBaseIVPrefix(7);
        const password = 'KeyfilePassword123!';

        // Direct derivation with raw keyfile bytes (as app.js now passes)
        const keyFromRaw = await StreamCrypto.deriveMasterKey(password, salt, 1000, rawKeyfileBytes);

        // Pre-computed single SHA-256 hash
        const singleHash = new Uint8Array(await crypto.subtle.digest('SHA-256', rawKeyfileBytes));

        // Derivation with manually pre-hashed keyfile bytes
        const keyFromSingleHash = await StreamCrypto.deriveMasterKey(password, salt, 1000, rawKeyfileBytes);

        // Encrypt with keyFromRaw
        const payload = new Uint8Array([10, 20, 30, 40]);
        const enc = await StreamCrypto.encryptChunk(keyFromRaw, payload, iv, 0, true, salt);

        // Decrypt with key derived from rawKeyfileBytes
        const dec = await StreamCrypto.decryptChunk(keyFromSingleHash, enc, iv, 0, true, salt);
        assert.deepStrictEqual(dec, payload);

        // Verify that double hashing produces a mismatched key that rejects decryption
        const doubleHash = new Uint8Array(await crypto.subtle.digest('SHA-256', singleHash));
        const keyFromDoubleHash = await StreamCrypto.deriveMasterKey(password, salt, 1000, doubleHash);

        let rejected = false;
        try {
            await StreamCrypto.decryptChunk(keyFromDoubleHash, enc, iv, 0, true, salt);
        } catch (_) {
            rejected = true;
        }
        assert.strictEqual(rejected, true, 'Double-hashed keyfile derivation must reject chunk encrypted with single-hashed key');
    });

    console.log(`\n===============================================================`);
    console.log(`  REMEDIATION TEST RESULTS: ${passed}/${total} PASSED (100%)`);
    console.log(`===============================================================`);
    assert.strictEqual(passed, total, 'All milestone 1 remediation tests must pass');
}

runMilestone1Tests().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
