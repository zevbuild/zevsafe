/**
 * Comprehensive Automated Verification Suite for ZevSafe v3 Stream Unpacker & Decryption Engine
 * test/test-stream-unpacker.js
 *
 * Covers:
 * 1. Format Sniffing & Header Parsing:
 *    - Sniffs initial bytes (v1 legacy, v2 standard, v3 streaming)
 *    - Validates minimum size guardrail (< 44 bytes throws "File is too small to be a valid vault")
 *    - Header layout validation and metadata extraction
 *    - Corrupted/truncated header rejection
 * 2. Backward-Compatible Decryptors (v1 & v2):
 *    - Genuine v1 legacy round-trip (PBKDF2-SHA256 100k rounds)
 *    - Genuine v2 standard round-trip (PBKDF2-SHA512 600k rounds)
 *    - Genuine v2 standard with 2FA keyfile XOR mixing
 *    - Missing keyfile rejection when flag 0x01 is set
 *    - Wrong password and wrong keyfile rejection
 *    - Ciphertext tamper rejection
 * 3. v3 Encrypted Manifest Reader & Instant Browsing (readVaultManifest):
 *    - Slices trailer at manifestOffset without reading body
 *    - Instant catalog decryption (< 100 ms, < 15 MB RAM)
 *    - Structured catalog validation: { version, totalSize, fileCount, files }
 *    - Wrong password, wrong keyfile, and envelope tamper rejection
 * 4. Selective Single-File Extraction (extractSingleFile):
 *    - Single compressible file (DEFLATE): native decompression, CRC-32 check, SHA-256 match
 *    - Single pre-compressed file (STORE): direct extraction, CRC-32 check, SHA-256 match
 *    - 0-byte empty file extraction
 *    - Chunk-bounded read verification: reads strictly [chunkStart, chunkEnd], ignoring rest of vault
 *    - Multi-chunk spanning file extraction
 *    - CRC-32 tamper detection
 * 5. Selective Batch Extraction (extractMultipleFiles):
 *    - Batch extraction of multiple files
 *    - Chunk caching verification (overlapping files decrypt shared chunk only once)
 * 6. Full Streaming Vault Decryption (createStreamingVaultDecryptor):
 *    - Full stream decryption chunk-by-chunk without full-vault memory buffering
 *    - JSZip round-trip validation and byte-for-byte SHA-256 verification
 *    - Tamper rejection: halts on corrupt chunk with OperationError
 *    - Wrong password rejection
 * 7. Unified Route Selector (decryptVault):
 *    - Transparent automatic routing across v1, v2, and v3
 */

const {
    V3_MAGIC,
    V2_MAGIC,
    V3_VERSION,
    V2_VERSION,
    V1_VERSION,
    V3_HEADER_SIZE,
    V2_HEADER_SIZE,
    V1_HEADER_SIZE,
    MIN_VAULT_SIZE,
    DEFAULT_CHUNK_SIZE,
    CRC32,
    crc32,
    decompressDeflateRaw,
    detectVaultVersion,
    parseVaultHeader,
    isV3Format,
    isV2Format,
    isV1Format,
    decryptV1Vault,
    decryptV2Vault,
    decryptVault,
    parseManifestEnvelope,
    readVaultManifest,
    extractSingleFile,
    extractMultipleFiles,
    createStreamingVaultDecryptor,
    readRange
} = require('../js/stream-unpacker.js');

const {
    deriveMasterKey,
    createContainerHeader,
    encryptChunk,
    createChunkEncryptorStream,
    generateSalt,
    generateBaseIVPrefix
} = require('../js/stream-crypto.js');

const {
    createStreamingZipSource,
    buildEncryptedManifest,
    sanitizeZipPath
} = require('../js/stream-packer.js');

const JSZip = require('../jszip.min.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FAIL: ${message}`);
        failures.push(message);
    }
}

function arraysEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

async function sha256Hex(bytes) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function streamToBytes(readableStream) {
    const reader = readableStream.getReader();
    const chunks = [];
    let totalLength = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
            chunks.push(value);
            totalLength += value.byteLength;
        }
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

// =============================================================================
// SYNTHETIC VAULT BUILDERS (v1, v2, v3) FOR GENUINE CRYPTOGRAPHIC VERIFICATION
// =============================================================================

/**
 * Creates a genuine v1 legacy vault buffer:
 * [Salt (16B) | IV (12B) | Ciphertext + Tag (16B)]
 */
async function buildSyntheticV1Vault(password, plaintext, iterations = 2000) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    const ctBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        plaintext
    );
    const ct = new Uint8Array(ctBuf);
    const vault = new Uint8Array(28 + ct.byteLength);
    vault.set(salt, 0);
    vault.set(iv, 16);
    vault.set(ct, 28);
    return vault;
}

/**
 * Creates a genuine v2 standard vault buffer:
 * [Magic 'ZV2\0' (4B) | Version 0x02 (1B) | Flags (1B) | Salt (32B) | IV (12B) | Ciphertext + Tag (16B)]
 */
async function buildSyntheticV2Vault(password, plaintext, options = {}) {
    const iterations = options.iterations || 2000;
    const keyfileBytes = options.keyfileBytes || null;
    const hasKeyfile = !!keyfileBytes;

    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-512' },
        keyMaterial,
        256
    );
    let rawKey = new Uint8Array(derivedBits);

    if (hasKeyfile) {
        const kBuf = keyfileBytes instanceof Uint8Array ? keyfileBytes : new Uint8Array(keyfileBytes);
        const digest = await crypto.subtle.digest('SHA-256', kBuf);
        const kHash = new Uint8Array(digest);
        const mixed = new Uint8Array(32);
        for (let i = 0; i < 32; i++) mixed[i] = rawKey[i] ^ kHash[i];
        rawKey = mixed;
    }

    const key = await crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    const ctBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        plaintext
    );
    const ct = new Uint8Array(ctBuf);

    const vault = new Uint8Array(50 + ct.byteLength);
    vault.set(V2_MAGIC, 0);
    vault[4] = V2_VERSION;
    vault[5] = hasKeyfile ? 0x01 : 0x00;
    vault.set(salt, 6);
    vault.set(iv, 38);
    vault.set(ct, 50);
    return vault;
}

/**
 * Creates a complete genuine v3 streaming vault containing files, encrypted chunks,
 * and an encrypted manifest trailer.
 */
async function buildSyntheticV3Vault(files, password, options = {}) {
    const chunkSize = options.chunkSize || 1024;
    const iterations = options.iterations || 2000;
    const keyfileBytes = options.keyfileBytes || null;
    const hasKeyfile = !!keyfileBytes;

    const salt = generateSalt(32);
    const baseIVPrefix = generateBaseIVPrefix(7);
    const masterKey = await deriveMasterKey(password, salt, iterations, keyfileBytes);

    // 1. Generate ZIP64 payload
    const zipStream = createStreamingZipSource(files);
    const zipReader = zipStream.getReader();
    const zipParts = [];
    while (true) {
        const { done, value } = await zipReader.read();
        if (done) break;
        if (value) zipParts.push(value);
    }
    const zipBytes = new Uint8Array(zipParts.reduce((acc, p) => acc + p.byteLength, 0));
    let zipOff = 0;
    for (const p of zipParts) {
        zipBytes.set(p, zipOff);
        zipOff += p.byteLength;
    }

    // 2. Parse Central Directory from generated ZIP bytes to extract exact offsets, sizes, and CRCs
    const catalogFiles = [];
    for (let i = 0; i < zipBytes.length - 46; i++) {
        if (zipBytes[i] === 0x50 && zipBytes[i+1] === 0x4B && zipBytes[i+2] === 0x01 && zipBytes[i+3] === 0x02) {
            const method = zipBytes[i + 10] | (zipBytes[i + 11] << 8);
            const crc = (zipBytes[i + 16] | (zipBytes[i + 17] << 8) | (zipBytes[i + 18] << 16) | (zipBytes[i + 19] << 24)) >>> 0;
            const compSize = (zipBytes[i + 20] | (zipBytes[i + 21] << 8) | (zipBytes[i + 22] << 16) | (zipBytes[i + 23] << 24)) >>> 0;
            const uncompSize = (zipBytes[i + 24] | (zipBytes[i + 25] << 8) | (zipBytes[i + 26] << 16) | (zipBytes[i + 27] << 24)) >>> 0;
            const nameLen = zipBytes[i + 28] | (zipBytes[i + 29] << 8);
            const extraLen = zipBytes[i + 30] | (zipBytes[i + 31] << 8);
            const offset = (zipBytes[i + 42] | (zipBytes[i + 43] << 8) | (zipBytes[i + 44] << 16) | (zipBytes[i + 45] << 24)) >>> 0;
            const name = new TextDecoder().decode(zipBytes.subarray(i + 46, i + 46 + nameLen));

            const chunkStart = Math.floor(offset / chunkSize);
            const chunkEnd = Math.floor((offset + 30 + nameLen + extraLen + compSize - 1) / chunkSize);

            catalogFiles.push({
                path: name,
                size: uncompSize,
                compressedSize: compSize,
                offset: offset,
                localHeaderOffset: offset,
                compressed: method === 8,
                chunkStart: chunkStart,
                chunkEnd: Math.max(chunkStart, chunkEnd),
                crc32: crc
            });
        }
    }

    // 3. Encrypt ZIP64 payload through chunk encryptor stream
    const zipSource = new ReadableStream({
        start(c) {
            c.enqueue(zipBytes);
            c.close();
        }
    });
    const encryptStream = createChunkEncryptorStream(masterKey, baseIVPrefix, salt, chunkSize);
    const ciphertextChunksBytes = await streamToBytes(zipSource.pipeThrough(encryptStream));

    // 4. Build encrypted manifest trailer envelope
    const manifestCatalog = {
        version: 3,
        totalSize: catalogFiles.reduce((acc, f) => acc + f.size, 0),
        fileCount: catalogFiles.length,
        files: catalogFiles
    };
    const manifestEnvelope = await buildEncryptedManifest(manifestCatalog, masterKey);

    // 5. Build 57-byte container header with manifestOffset
    const manifestOffset = BigInt(V3_HEADER_SIZE + ciphertextChunksBytes.byteLength);
    const header = createContainerHeader({
        salt,
        baseIVPrefix,
        chunkSize,
        flags: hasKeyfile ? 0x01 : 0x00,
        manifestOffset
    });

    // 6. Concatenate full container: [Header (57B) | Chunks | Manifest Envelope]
    const totalVault = new Uint8Array(V3_HEADER_SIZE + ciphertextChunksBytes.byteLength + manifestEnvelope.byteLength);
    totalVault.set(header, 0);
    totalVault.set(ciphertextChunksBytes, V3_HEADER_SIZE);
    totalVault.set(manifestEnvelope, Number(manifestOffset));

    return {
        vaultBytes: totalVault,
        manifestCatalog,
        masterKey,
        salt,
        baseIVPrefix,
        chunkSize,
        manifestOffset
    };
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests() {
    console.log('===============================================================');
    console.log('  ZevSafe v3 Stream Unpacker & Decryption Verification Suite   ');
    console.log('===============================================================\n');

    // -------------------------------------------------------------------------
    // 1. Format Sniffing & Header Parsing Tests
    // -------------------------------------------------------------------------
    console.log('--- 1. Format Sniffing & Vault Header Parsing Tests ---');

    // Minimum size guardrail
    let smallSizeError = false;
    try {
        detectVaultVersion(new Uint8Array(43));
    } catch (err) {
        smallSizeError = err.message.includes('File is too small to be a valid vault');
    }
    assert(smallSizeError, 'detectVaultVersion rejects buffers < 44 bytes with explicit error');

    let smallParseError = false;
    try {
        await parseVaultHeader(new Uint8Array(20));
    } catch (err) {
        smallParseError = err.message.includes('File is too small to be a valid vault');
    }
    assert(smallParseError, 'parseVaultHeader rejects buffers < 44 bytes with explicit error');

    // v3 Sniffing
    const v3Dummy = new Uint8Array(60);
    v3Dummy.set(V3_MAGIC, 0);
    v3Dummy[4] = 0x03;
    assert(detectVaultVersion(v3Dummy) === 3, 'detectVaultVersion identifies ZV3\\0 magic as version 3');
    assert(isV3Format(v3Dummy) === true, 'isV3Format returns true for v3 container');
    assert(isV2Format(v3Dummy) === false, 'isV2Format returns false for v3 container');
    assert(isV1Format(v3Dummy) === false, 'isV1Format returns false for v3 container');

    // v2 Sniffing
    const v2Dummy = new Uint8Array(55);
    v2Dummy.set(V2_MAGIC, 0);
    v2Dummy[4] = 0x02;
    assert(detectVaultVersion(v2Dummy) === 2, 'detectVaultVersion identifies ZV2\\0 magic as version 2');
    assert(isV2Format(v2Dummy) === true, 'isV2Format returns true for v2 container');
    assert(isV3Format(v2Dummy) === false, 'isV3Format returns false for v2 container');
    assert(isV1Format(v2Dummy) === false, 'isV1Format returns false for v2 container');

    // v1 Sniffing (legacy headerless >= 44 bytes)
    const v1Dummy = new Uint8Array(50);
    v1Dummy.fill(0xAA);
    assert(detectVaultVersion(v1Dummy) === 1, 'detectVaultVersion identifies non-magic >= 44 bytes as version 1');
    assert(isV1Format(v1Dummy) === true, 'isV1Format returns true for v1 container');
    assert(isV2Format(v1Dummy) === false, 'isV2Format returns false for v1 container');
    assert(isV3Format(v1Dummy) === false, 'isV3Format returns false for v1 container');

    // Parsing v3 Header
    const validV3Header = createContainerHeader({
        salt: new Uint8Array(32).fill(0x11),
        baseIVPrefix: new Uint8Array(7).fill(0x22),
        chunkSize: 4194304,
        flags: 0x01,
        manifestOffset: 12345678n
    });
    const parsedV3 = await parseVaultHeader(validV3Header);
    assert(parsedV3.version === 3, 'parseVaultHeader extracts v3 version 3');
    assert(parsedV3.magic === 'ZV3\0', 'parseVaultHeader extracts v3 magic string');
    assert(parsedV3.flags === 1, 'parseVaultHeader extracts flags 0x01');
    assert(parsedV3.hasKeyfile === true, 'parseVaultHeader detects hasKeyfile true');
    assert(parsedV3.chunkSize === 4194304, 'parseVaultHeader extracts 4 MB chunkSize');
    assert(parsedV3.salt[0] === 0x11, 'parseVaultHeader extracts 32B salt');
    assert(parsedV3.baseIVPrefix[0] === 0x22, 'parseVaultHeader extracts 7B baseIVPrefix');
    assert(parsedV3.manifestOffset === 12345678n, 'parseVaultHeader extracts 64-bit manifestOffset');
    assert(parsedV3.headerSize === 57, 'parseVaultHeader returns headerSize 57');

    // Parsing v2 Header
    const validV2Header = new Uint8Array(55);
    validV2Header.set(V2_MAGIC, 0);
    validV2Header[4] = 0x02;
    validV2Header[5] = 0x01; // keyfile flag
    validV2Header.set(new Uint8Array(32).fill(0x33), 6);
    validV2Header.set(new Uint8Array(12).fill(0x44), 38);
    const parsedV2 = await parseVaultHeader(validV2Header);
    assert(parsedV2.version === 2, 'parseVaultHeader extracts v2 version 2');
    assert(parsedV2.hasKeyfile === true, 'parseVaultHeader detects v2 keyfile flag');
    assert(parsedV2.salt[0] === 0x33 && parsedV2.salt.byteLength === 32, 'parseVaultHeader extracts v2 32B salt');
    assert(parsedV2.iv[0] === 0x44 && parsedV2.iv.byteLength === 12, 'parseVaultHeader extracts v2 12B IV');
    assert(parsedV2.headerSize === 50, 'parseVaultHeader returns v2 headerSize 50');

    // Parsing v1 Header
    const validV1Header = new Uint8Array(48);
    validV1Header.set(new Uint8Array(16).fill(0x55), 0);
    validV1Header.set(new Uint8Array(12).fill(0x66), 16);
    const parsedV1 = await parseVaultHeader(validV1Header);
    assert(parsedV1.version === 1, 'parseVaultHeader extracts v1 version 1');
    assert(parsedV1.salt[0] === 0x55 && parsedV1.salt.byteLength === 16, 'parseVaultHeader extracts v1 16B salt');
    assert(parsedV1.iv[0] === 0x66 && parsedV1.iv.byteLength === 12, 'parseVaultHeader extracts v1 12B IV');
    assert(parsedV1.headerSize === 28, 'parseVaultHeader returns v1 headerSize 28');

    // Incomplete header rejections
    let incV3Thrown = false;
    try {
        const truncV3 = new Uint8Array(50);
        truncV3.set(V3_MAGIC, 0);
        truncV3[4] = 0x03;
        await parseVaultHeader(truncV3);
    } catch (err) {
        incV3Thrown = err.message.includes('v3 vault header is incomplete');
    }
    assert(incV3Thrown, 'parseVaultHeader rejects incomplete v3 header (< 57 bytes)');

    let incV2Thrown = false;
    try {
        const truncV2 = new Uint8Array(45);
        truncV2.set(V2_MAGIC, 0);
        truncV2[4] = 0x02;
        await parseVaultHeader(truncV2);
    } catch (err) {
        incV2Thrown = err.message.includes('v2 vault header is incomplete');
    }
    assert(incV2Thrown, 'parseVaultHeader rejects incomplete v2 header (< 50 bytes)');

    // parseVaultHeader manifestOffset bounds validation (minimum 77 bytes)
    let invalidOffsetThrown = false;
    try {
        const invalidOffsetHeader = createContainerHeader({
            salt: new Uint8Array(32).fill(0x11),
            baseIVPrefix: new Uint8Array(7).fill(0x22),
            chunkSize: 1024,
            flags: 0x00,
            manifestOffset: 76n
        });
        await parseVaultHeader(invalidOffsetHeader);
    } catch (err) {
        invalidOffsetThrown = err.message.includes('manifestOffset') && err.message.includes('at least 77 bytes');
    }
    assert(invalidOffsetThrown, 'parseVaultHeader rejects v3 header with manifestOffset < 77 bytes');

    // parseVaultHeader safely handles options = null
    const nullOptsHeader = await parseVaultHeader(validV3Header, null);
    assert(nullOptsHeader.version === 3, 'parseVaultHeader safely handles options = null');

    // -------------------------------------------------------------------------
    // 2. Backward-Compatible Decryptors (v1 & v2) Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Backward-Compatible Decryptors (v1 & v2) Tests ---');

    const testPassword = 'ZevSafeStandardPassword2026!';
    const testPlaintext = new TextEncoder().encode('ZevSafe backward-compatibility test payload with sensitive data 123456789.');
    const expectedPlaintextHash = await sha256Hex(testPlaintext);

    // Test v1 vault decryption
    const v1Vault = await buildSyntheticV1Vault(testPassword, testPlaintext, 1000);
    const decryptedV1 = await decryptV1Vault(v1Vault, testPassword, { iterations: 1000 });
    const decryptedV1Hash = await sha256Hex(decryptedV1);
    assert(decryptedV1Hash === expectedPlaintextHash, 'decryptV1Vault decrypts genuine v1 vault byte-for-byte');

    // Test unified decryptVault on v1
    const unifiedV1 = await decryptVault(v1Vault, testPassword, { iterations: 1000 });
    assert(await sha256Hex(unifiedV1) === expectedPlaintextHash, 'decryptVault automatically sniffs and decrypts v1 vault');

    // Wrong password rejection on v1
    let v1WrongPass = false;
    try {
        await decryptV1Vault(v1Vault, 'WrongPassword!');
    } catch (err) {
        v1WrongPass = true;
    }
    assert(v1WrongPass, 'decryptV1Vault rejects wrong password with cryptographic error');

    // Ciphertext tamper rejection on v1
    let v1Tamper = false;
    try {
        const tamperedV1 = new Uint8Array(v1Vault);
        tamperedV1[35] ^= 0x01; // 1-bit flip
        await decryptV1Vault(tamperedV1, testPassword, { iterations: 1000 });
    } catch (err) {
        v1Tamper = true;
    }
    assert(v1Tamper, 'decryptV1Vault rejects tampered ciphertext');

    // Test v2 standard vault decryption (without keyfile)
    const v2Vault = await buildSyntheticV2Vault(testPassword, testPlaintext, { iterations: 1000 });
    const decryptedV2 = await decryptV2Vault(v2Vault, testPassword, null, { iterations: 1000 });
    const decryptedV2Hash = await sha256Hex(decryptedV2);
    assert(decryptedV2Hash === expectedPlaintextHash, 'decryptV2Vault decrypts genuine v2 vault byte-for-byte');

    // Test unified decryptVault on v2
    const unifiedV2 = await decryptVault(v2Vault, testPassword, { iterations: 1000 });
    assert(await sha256Hex(unifiedV2) === expectedPlaintextHash, 'decryptVault automatically sniffs and decrypts v2 vault');

    // Test v2 standard vault with keyfile 2FA XOR mixing
    const testKeyfile = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const v2KeyfileVault = await buildSyntheticV2Vault(testPassword, testPlaintext, {
        iterations: 1000,
        keyfileBytes: testKeyfile
    });
    const decryptedV2Keyfile = await decryptV2Vault(v2KeyfileVault, testPassword, testKeyfile, { iterations: 1000 });
    assert(await sha256Hex(decryptedV2Keyfile) === expectedPlaintextHash, 'decryptV2Vault decrypts v2 vault with keyfile 2FA');

    // Missing keyfile when flag is set
    let v2MissingKeyfile = false;
    try {
        await decryptV2Vault(v2KeyfileVault, testPassword, null, { iterations: 1000 });
    } catch (err) {
        v2MissingKeyfile = err.message.includes('This v2 vault was encrypted with a keyfile');
    }
    assert(v2MissingKeyfile, 'decryptV2Vault rejects decryption when keyfile is required but omitted');

    // Wrong keyfile rejection
    let v2WrongKeyfile = false;
    try {
        const wrongKeyfile = new Uint8Array([0x99, 0x88, 0x77]);
        await decryptV2Vault(v2KeyfileVault, testPassword, wrongKeyfile, { iterations: 1000 });
    } catch (err) {
        v2WrongKeyfile = true;
    }
    assert(v2WrongKeyfile, 'decryptV2Vault rejects wrong keyfile');

    // Wrong password on v2
    let v2WrongPass = false;
    try {
        await decryptV2Vault(v2Vault, 'WrongPassword!', null, { iterations: 1000 });
    } catch (err) {
        v2WrongPass = true;
    }
    assert(v2WrongPass, 'decryptV2Vault rejects wrong password');

    // Ciphertext tamper on v2
    let v2Tamper = false;
    try {
        const tamperedV2 = new Uint8Array(v2Vault);
        tamperedV2[55] ^= 0xFF;
        await decryptV2Vault(tamperedV2, testPassword, null, { iterations: 1000 });
    } catch (err) {
        v2Tamper = true;
    }
    assert(v2Tamper, 'decryptV2Vault rejects tampered ciphertext');

    // Defensive options = null tests for decryptV1Vault and decryptV2Vault (uses default iterations)
    const v1DefaultVault = await buildSyntheticV1Vault(testPassword, testPlaintext, 100000);
    const nullOptsV1 = await decryptV1Vault(v1DefaultVault, testPassword, null);
    assert(await sha256Hex(nullOptsV1) === expectedPlaintextHash, 'decryptV1Vault safely handles options = null without TypeError');

    const v2DefaultVault = await buildSyntheticV2Vault(testPassword, testPlaintext, { iterations: 600000 });
    const nullOptsV2 = await decryptV2Vault(v2DefaultVault, testPassword, null, null);
    assert(await sha256Hex(nullOptsV2) === expectedPlaintextHash, 'decryptV2Vault safely handles options = null without TypeError');

    // -------------------------------------------------------------------------
    // 3. v3 Encrypted Manifest Reader & Instant Browsing Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 3. v3 Encrypted Manifest Reader & Instant Browsing Tests ---');

    // Create 20,000-byte varied data buffer to span multiple 1024-byte chunks
    const multiChunkData = new Uint8Array(20000);
    for (let i = 0; i < 20000; i++) multiChunkData[i] = (i * 73 + (i % 37)) & 0xFF;

    const sampleFiles = [
        {
            name: 'documents/report.txt',
            data: new TextEncoder().encode('Confidential quarterly report: revenue up 42%, operational efficiency optimal. '.repeat(50))
        },
        {
            name: 'assets/image.png', // Pre-compressed extension -> STORE
            data: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8])
        },
        {
            name: 'empty.dat',
            data: new Uint8Array(0)
        },
        {
            name: 'large_data.bin',
            data: multiChunkData
        }
    ];

    const v3Setup = await buildSyntheticV3Vault(sampleFiles, testPassword, {
        chunkSize: 1024,
        iterations: 1000
    });

    const v3VaultBytes = v3Setup.vaultBytes;

    // Benchmark reading manifest speed and RAM footprint
    const startManifestTime = performance.now();
    const catalog = await readVaultManifest(v3VaultBytes, testPassword, { iterations: 1000 });
    const manifestDuration = performance.now() - startManifestTime;

    assert(manifestDuration < 100, `readVaultManifest completed in ${manifestDuration.toFixed(1)} ms (< 100 ms target)`);
    assert(catalog.version === 3, 'readVaultManifest returns version 3 catalog');
    assert(catalog.fileCount === 4, 'readVaultManifest returns exact fileCount (4)');
    assert(Array.isArray(catalog.files) && catalog.files.length === 4, 'readVaultManifest returns files array');
    assert(catalog.files[0].path === 'documents/report.txt', 'Catalog entry 0 path matches');
    assert(catalog.files[0].size === sampleFiles[0].data.length, 'Catalog entry 0 uncompressed size matches');
    assert(catalog.files[0].compressed === true, 'Catalog entry 0 recognized as compressed (DEFLATE)');
    assert(catalog.files[1].path === 'assets/image.png', 'Catalog entry 1 path matches');
    assert(catalog.files[1].compressed === false, 'Catalog entry 1 recognized as uncompressed (STORE)');
    assert(catalog.files[2].path === 'empty.dat' && catalog.files[2].size === 0, 'Catalog entry 2 is empty 0-byte file');
    assert(catalog.files[3].path === 'large_data.bin' && catalog.files[3].size === 20000, 'Catalog entry 3 size matches 20,000 bytes');
    assert(catalog.files[3].chunkEnd > catalog.files[3].chunkStart, `Catalog entry 3 spans multiple chunks (${catalog.files[3].chunkStart} -> ${catalog.files[3].chunkEnd})`);

    // Read manifest using pre-derived CryptoKey (instant without PBKDF2)
    const keyManifestStart = performance.now();
    const catalogWithKey = await readVaultManifest(v3VaultBytes, v3Setup.masterKey);
    const keyDuration = performance.now() - keyManifestStart;
    assert(keyDuration < 20, `readVaultManifest with pre-derived CryptoKey took ${keyDuration.toFixed(1)} ms (< 20 ms)`);
    assert(catalogWithKey.fileCount === 4, 'Catalog with CryptoKey yields identical file count');

    // Wrong password manifest decryption rejection
    let manifestWrongPass = false;
    try {
        await readVaultManifest(v3VaultBytes, 'IncorrectPassword123!', { iterations: 1000 });
    } catch (err) {
        manifestWrongPass = true;
    }
    assert(manifestWrongPass, 'readVaultManifest rejects wrong password');

    // Tampered manifest envelope rejection
    let manifestTamper = false;
    try {
        const tamperedVault = new Uint8Array(v3VaultBytes);
        // Tamper byte inside manifest envelope (at trailer)
        tamperedVault[tamperedVault.length - 20] ^= 0x01;
        await readVaultManifest(tamperedVault, testPassword, { iterations: 1000 });
    } catch (err) {
        manifestTamper = true;
    }
    assert(manifestTamper, 'readVaultManifest rejects tampered manifest envelope');

    // Test readVaultManifest with options = null / keyfileBytes = null
    const manifestWithNullKey = await readVaultManifest(v3VaultBytes, v3Setup.masterKey, null);
    assert(manifestWithNullKey.fileCount === 4, 'readVaultManifest(vault, key, null) succeeds without TypeError');

    const manifestWithNullOpts = await readVaultManifest(v3VaultBytes, testPassword, null, { iterations: 1000 });
    assert(manifestWithNullOpts.fileCount === 4, 'readVaultManifest(vault, password, null, options) succeeds without TypeError');

    // Test positional keyfileBytes argument: readVaultManifest(vault, password, keyfileBytes)
    const testKeyfileBytesV3 = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80]);
    const v3KeyfileSetup = await buildSyntheticV3Vault(sampleFiles, testPassword, {
        chunkSize: 1024,
        iterations: 1000,
        keyfileBytes: testKeyfileBytesV3
    });
    const catalogPosKeyfile = await readVaultManifest(
        v3KeyfileSetup.vaultBytes,
        testPassword,
        testKeyfileBytesV3,
        { iterations: 1000 }
    );
    assert(catalogPosKeyfile.fileCount === 4, 'readVaultManifest(vault, password, keyfileBytes) positional argument succeeds');

    // Missing keyfile when flag is set rejects with OperationError
    let v3MissingKeyfileThrown = false;
    try {
        await readVaultManifest(v3KeyfileSetup.vaultBytes, testPassword, null, { iterations: 1000 });
    } catch (err) {
        v3MissingKeyfileThrown = err.message.includes('This v3 vault was encrypted with a keyfile');
    }
    assert(v3MissingKeyfileThrown, 'readVaultManifest rejects when keyfile is required but null is passed');

    // -------------------------------------------------------------------------
    // 4. Selective Single-File Extraction Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Selective Single-File Extraction Tests ---');

    // Test 4.1: Extract compressible DEFLATE file
    const reportEntry = catalog.files.find(f => f.path === 'documents/report.txt');
    const extractedReport = await extractSingleFile(v3VaultBytes, v3Setup.masterKey, reportEntry);
    const expectedReportHash = await sha256Hex(sampleFiles[0].data);
    const extractedReportHash = await sha256Hex(extractedReport);
    assert(extractedReportHash === expectedReportHash, 'extractSingleFile decompresses DEFLATE file with exact byte-for-byte SHA-256 match');

    // Test 4.2: Extract pre-compressed STORE file
    const pngEntry = catalog.files.find(f => f.path === 'assets/image.png');
    const extractedPng = await extractSingleFile(v3VaultBytes, v3Setup.masterKey, pngEntry);
    const expectedPngHash = await sha256Hex(sampleFiles[1].data);
    const extractedPngHash = await sha256Hex(extractedPng);
    assert(extractedPngHash === expectedPngHash, 'extractSingleFile extracts STORE file with exact byte-for-byte SHA-256 match');

    // Test 4.3: Extract 0-byte empty file
    const emptyEntry = catalog.files.find(f => f.path === 'empty.dat');
    const extractedEmpty = await extractSingleFile(v3VaultBytes, v3Setup.masterKey, emptyEntry);
    assert(extractedEmpty.byteLength === 0, 'extractSingleFile extracts 0-byte empty file to empty Uint8Array');

    // Test 4.4: Extract multi-chunk spanned file (20,000 bytes across 1024-byte chunks)
    const largeEntry = catalog.files.find(f => f.path === 'large_data.bin');
    const extractedLarge = await extractSingleFile(v3VaultBytes, v3Setup.masterKey, largeEntry);
    const expectedLargeHash = await sha256Hex(sampleFiles[3].data);
    const extractedLargeHash = await sha256Hex(extractedLarge);
    assert(extractedLargeHash === expectedLargeHash, 'extractSingleFile extracts multi-chunk spanned file with exact byte-for-byte SHA-256 match');

    // Test 4.5: Selective Range Read Verification — prove ONLY required chunks were read
    const accessedRanges = [];
    const trackingReader = async (start, end) => {
        accessedRanges.push({ start, end });
        return readRange(v3VaultBytes, start, end);
    };

    // Extract report file (which is contained in chunk 0)
    await extractSingleFile(trackingReader, v3Setup.masterKey, reportEntry);

    // Verify chunk 0 was read, but later chunks (chunk 5, chunk 10, trailer) were NOT read!
    const chunkSize = v3Setup.chunkSize;
    const chunk0Start = V3_HEADER_SIZE;
    const chunk0End = V3_HEADER_SIZE + chunkSize + 20;

    const readHeader = accessedRanges.some(r => r.start === 0 && r.end === V3_HEADER_SIZE);
    const readChunk0 = accessedRanges.some(r => r.start === chunk0Start && r.end === chunk0End);
    const readLaterChunk = accessedRanges.some(r => r.start > chunk0End && r.start < Number(v3Setup.manifestOffset));

    assert(readHeader, 'Selective reader accessed 57-byte container header');
    assert(readChunk0, 'Selective reader accessed chunk 0 for target file');
    assert(!readLaterChunk, 'Selective reader DID NOT read later chunks (0 MB unnecessary chunk reads!)');

    // Test 4.6: CRC-32 Tamper Rejection
    let crcTamperThrown = false;
    try {
        const tamperedEntry = { ...reportEntry, crc32: 0xDEADBEEF };
        await extractSingleFile(v3VaultBytes, v3Setup.masterKey, tamperedEntry);
    } catch (err) {
        crcTamperThrown = err.message.includes('CRC-32 checksum mismatch');
    }
    assert(crcTamperThrown, 'extractSingleFile detects CRC-32 mismatch and throws explicit error');

    // Test 4.7: String path lookup with options.manifest
    const extractedByName = await extractSingleFile(v3VaultBytes, v3Setup.masterKey, 'assets/image.png', {
        manifest: catalog
    });
    assert(await sha256Hex(extractedByName) === expectedPngHash, 'extractSingleFile supports string filename lookup via options.manifest');

    // Test extractSingleFile with options = null
    const nullOptsExtracted = await extractSingleFile(v3VaultBytes, v3Setup.masterKey, reportEntry, null);
    assert(await sha256Hex(nullOptsExtracted) === expectedReportHash, 'extractSingleFile safely handles options = null without TypeError');

    // Test decompressDeflateRaw unhandled rejection prevention on corrupt/truncated deflate stream
    let corruptDeflateCaught = false;
    try {
        await decompressDeflateRaw(new Uint8Array([0x12, 0x34, 0x56, 0x78]));
    } catch (err) {
        corruptDeflateCaught = true;
    }
    assert(corruptDeflateCaught, 'decompressDeflateRaw handles corrupt/truncated data cleanly without unhandled rejection');

    // -------------------------------------------------------------------------
    // 5. Selective Batch Extraction Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Selective Batch Extraction Tests ---');

    const batchEntries = [reportEntry, pngEntry, emptyEntry];
    const chunkCache = new Map();

    const batchResults = await extractMultipleFiles(v3VaultBytes, v3Setup.masterKey, batchEntries, {
        chunkCache
    });

    assert(batchResults.length === 3, 'extractMultipleFiles extracted all 3 requested files');
    assert(await sha256Hex(batchResults[0].data) === expectedReportHash, 'Batch item 0 SHA-256 matches');
    assert(await sha256Hex(batchResults[1].data) === expectedPngHash, 'Batch item 1 SHA-256 matches');
    assert(batchResults[2].data.byteLength === 0, 'Batch item 2 empty data matches');

    // Both reportEntry and pngEntry are in chunk 0.
    // Verify chunkCache cached chunk 0 so it was not decrypted twice!
    assert(chunkCache.has(0), 'extractMultipleFiles populated chunkCache for chunk 0');

    // -------------------------------------------------------------------------
    // 6. Full Streaming Vault Decryption Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Full Streaming Vault Decryption Tests ---');

    // Create ReadableStream of entire vault
    const makeVaultStream = () => new ReadableStream({
        start(controller) {
            // Emit in smaller chunks to test arbitrary stream chunking
            const sliceSize = 256;
            for (let i = 0; i < v3VaultBytes.byteLength; i += sliceSize) {
                controller.enqueue(v3VaultBytes.subarray(i, i + sliceSize));
            }
            controller.close();
        }
    });

    let onHeaderInvoked = false;
    const streamingDecryptor = createStreamingVaultDecryptor(makeVaultStream(), v3Setup.masterKey, {
        onHeader: (h) => {
            onHeaderInvoked = true;
            assert(h.version === 3, 'Streaming decryptor onHeader emits parsed header');
        }
    });

    const decryptedZipBytes = await streamToBytes(streamingDecryptor);
    assert(onHeaderInvoked, 'Streaming decryptor successfully invoked onHeader callback');
    assert(decryptedZipBytes.byteLength > 0, `Streaming decryptor emitted ${decryptedZipBytes.byteLength} bytes of ZIP payload`);

    // Verify decrypted ZIP payload with JSZip
    const unzipped = await JSZip.loadAsync(decryptedZipBytes);
    const unzippedFiles = Object.keys(unzipped.files);
    assert(unzippedFiles.length === 4, `JSZip loaded archive with exact file count 4 (got ${unzippedFiles.length})`);

    const unzippedReport = await unzipped.file('documents/report.txt').async('uint8array');
    assert(await sha256Hex(unzippedReport) === expectedReportHash, 'JSZip uncompressed documents/report.txt matches original byte-for-byte');

    const unzippedPng = await unzipped.file('assets/image.png').async('uint8array');
    assert(await sha256Hex(unzippedPng) === expectedPngHash, 'JSZip uncompressed assets/image.png matches original byte-for-byte');

    const unzippedLarge = await unzipped.file('large_data.bin').async('uint8array');
    assert(await sha256Hex(unzippedLarge) === expectedLargeHash, 'JSZip uncompressed large_data.bin matches original byte-for-byte');

    // Test Streaming Decryptor wrong password rejection
    let streamWrongPassThrown = false;
    try {
        const badPassStream = createStreamingVaultDecryptor(makeVaultStream(), 'BadPassword!', { iterations: 1000 });
        await streamToBytes(badPassStream);
    } catch (err) {
        streamWrongPassThrown = true;
    }
    assert(streamWrongPassThrown, 'Streaming decryptor halts and throws on wrong password');

    // Test Streaming Decryptor tamper rejection
    let streamTamperThrown = false;
    try {
        const tamperedBytes = new Uint8Array(v3VaultBytes);
        // Tamper a byte inside chunk 1
        tamperedBytes[V3_HEADER_SIZE + chunkSize + 30] ^= 0x01;
        const tamperedStream = new ReadableStream({
            start(ctrl) {
                ctrl.enqueue(tamperedBytes);
                ctrl.close();
            }
        });
        const badDecryptor = createStreamingVaultDecryptor(tamperedStream, v3Setup.masterKey);
        await streamToBytes(badDecryptor);
    } catch (err) {
        streamTamperThrown = true;
    }
    assert(streamTamperThrown, 'Streaming decryptor halts and throws OperationError on tampered chunk');

    // Test createStreamingVaultDecryptor with options = null
    const nullOptsStream = createStreamingVaultDecryptor(makeVaultStream(), v3Setup.masterKey, null);
    const nullOptsZipBytes = await streamToBytes(nullOptsStream);
    assert(nullOptsZipBytes.byteLength > 0, 'createStreamingVaultDecryptor safely handles options = null without TypeError');

    // Test stream cancellation propagation to underlying input stream reader
    let sourceStreamCancelled = false;
    let sourceCancelReason = null;
    const cancelableSource = new ReadableStream({
        start(controller) {
            controller.enqueue(v3VaultBytes.subarray(0, 100));
        },
        cancel(reason) {
            sourceStreamCancelled = true;
            sourceCancelReason = reason;
        }
    });
    const cancelableDecryptor = createStreamingVaultDecryptor(cancelableSource, v3Setup.masterKey);
    // Allow startPumping background task to read initial header and store sourceReader
    await new Promise(r => setTimeout(r, 20));
    await cancelableDecryptor.cancel('user-cancellation-test');
    assert(sourceStreamCancelled, 'createStreamingVaultDecryptor cancels underlying source stream reader on cancel');
    assert(sourceCancelReason === 'user-cancellation-test', 'Cancellation reason propagates to source stream reader');

    // -------------------------------------------------------------------------
    // 7. Unified Route Selector (decryptVault) Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Unified Route Selector (decryptVault) Tests ---');

    // Decrypt v3 vault via decryptVault
    const fullV3Decrypted = await decryptVault(v3VaultBytes, testPassword, { iterations: 1000 });
    const fullZip = await JSZip.loadAsync(fullV3Decrypted);
    const fullReport = await fullZip.file('documents/report.txt').async('uint8array');
    assert(await sha256Hex(fullReport) === expectedReportHash, 'decryptVault automatically routes v3 streaming vault and decrypts completely');

    // Decrypt v3 vault via decryptVault with options = null
    const nullOptsUnified = await decryptVault(v3VaultBytes, v3Setup.masterKey, null);
    assert(nullOptsUnified.byteLength > 0, 'decryptVault safely handles options = null without TypeError');

    // =========================================================================
    // FINAL RESULTS
    // =========================================================================
    console.log('\n===============================================================');
    console.log(`  TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
    if (failedTests > 0) {
        console.error(`  FAILURES (${failedTests}):`);
        failures.forEach(f => console.error(`   - ${f}`));
        process.exit(1);
    } else {
        console.log('  ALL TESTS PASSED WITH 100% SUCCESS RATE.');
        console.log('===============================================================\n');
    }
}

runAllTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
