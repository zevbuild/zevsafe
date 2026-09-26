/**
 * Unit Test Suite for ZevSafe v3 STREAM AEAD Cryptographic Engine
 *
 * Covers:
 * 1. Container Header creation, parsing, validation, and in-place updates
 * 2. Per-chunk IV computation (12B) and AAD computation (42B)
 * 3. PBKDF2-SHA512 key derivation with and without keyfile 2FA XOR
 * 4. Single-chunk AES-256-GCM encryption and decryption framing
 * 5. Tamper detection: 1-bit ciphertext flips, tag alteration, IV/AAD alteration
 * 6. Web Streams API multi-chunk streaming encryption and decryption
 * 7. Stream adversarial attacks: truncation, chunk reordering, and splicing
 */

const {
    V3_MAGIC,
    V3_VERSION,
    V3_HEADER_SIZE,
    DEFAULT_CHUNK_SIZE,
    PBKDF2_ITERATIONS,
    SALT_LENGTH,
    BASE_IV_PREFIX_LENGTH,
    IV_LENGTH,
    TAG_LENGTH,
    AAD_LENGTH,
    CHUNK_HEADER_SIZE,
    V3_FLAG_KEYFILE,
    deriveMasterKey,
    computeChunkIV,
    computeChunkAAD,
    encryptChunk,
    decryptChunk,
    createChunkEncryptorStream,
    createChunkDecryptorStream,
    createContainerHeader,
    parseContainerHeader,
    updateManifestOffset,
    generateSalt,
    generateBaseIVPrefix
} = require('../js/stream-crypto.js');

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
    if (a.length !== b.length) return false;
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

// Helper to convert ReadableStream to concatenated Uint8Array
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

// Helper to create a ReadableStream from an array of chunks
function createStreamFromChunks(chunks) {
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(chunk);
            }
            controller.close();
        }
    });
}

// =========================================================================
// TEST SUITES
// =========================================================================

async function testContainerHeader() {
    console.log('\n--- 1. Container Header Tests ---');

    const salt = generateSalt(32);
    const prefix = generateBaseIVPrefix(7);
    const manifestOffset = 9876543210n;

    assert(salt.length === 32, 'generateSalt produces 32 bytes');
    assert(prefix.length === 7, 'generateBaseIVPrefix produces 7 bytes');

    const header = createContainerHeader({
        salt,
        baseIVPrefix: prefix,
        chunkSize: 4194304,
        flags: V3_FLAG_KEYFILE,
        manifestOffset
    });

    assert(header.length === V3_HEADER_SIZE, `Container header size is exactly ${V3_HEADER_SIZE} bytes (57 bytes)`);
    assert(arraysEqual(header.slice(0, 4), V3_MAGIC), "Header magic is 'ZV3\\0' (0x5A, 0x56, 0x33, 0x00)");
    assert(header[4] === V3_VERSION, 'Header version is 0x03');
    assert(header[5] === V3_FLAG_KEYFILE, 'Header flags preserve V3_FLAG_KEYFILE');

    const parsed = parseContainerHeader(header);
    assert(arraysEqual(parsed.magic, V3_MAGIC), 'Parsed magic matches');
    assert(parsed.version === 3, 'Parsed version is 3');
    assert(parsed.flags === V3_FLAG_KEYFILE, 'Parsed flags match');
    assert(parsed.chunkSize === 4194304, 'Parsed chunkSize is 4 MB');
    assert(arraysEqual(parsed.salt, salt), 'Parsed salt matches original salt');
    assert(arraysEqual(parsed.baseIVPrefix, prefix), 'Parsed baseIVPrefix matches original prefix');
    assert(parsed.manifestOffset === manifestOffset, 'Parsed manifestOffset matches 9876543210n');

    // In-place manifest offset update
    updateManifestOffset(header, 123456789012345n);
    const updatedParsed = parseContainerHeader(header);
    assert(updatedParsed.manifestOffset === 123456789012345n, 'updateManifestOffset updates offset correctly');

    // Corruption detection
    const badMagicHeader = new Uint8Array(header);
    badMagicHeader[0] = 0xFF;
    let magicCaught = false;
    try {
        parseContainerHeader(badMagicHeader);
    } catch (e) {
        magicCaught = true;
    }
    assert(magicCaught, 'parseContainerHeader rejects corrupt magic');

    let shortCaught = false;
    try {
        parseContainerHeader(header.slice(0, 30));
    } catch (e) {
        shortCaught = true;
    }
    assert(shortCaught, 'parseContainerHeader rejects truncated header');
}

async function testIVandAAD() {
    console.log('\n--- 2. IV and AAD Computation Tests ---');

    const prefix = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70]);
    const salt = new Uint8Array(32).fill(0xAA);

    // IV tests
    const iv0False = computeChunkIV(prefix, 0, false);
    assert(iv0False.length === IV_LENGTH, 'computeChunkIV returns 12 bytes');
    assert(arraysEqual(iv0False.slice(0, 7), prefix), 'IV bytes 0..6 match baseIVPrefix');
    assert(iv0False[7] === 0 && iv0False[8] === 0 && iv0False[9] === 0 && iv0False[10] === 0, 'IV bytes 7..10 encode chunk index 0');
    assert(iv0False[11] === 0x00, 'IV byte 11 is 0x00 when isLast = false');

    const iv5True = computeChunkIV(prefix, 5, true);
    assert(iv5True[7] === 0 && iv5True[8] === 0 && iv5True[9] === 0 && iv5True[10] === 5, 'IV bytes 7..10 encode chunk index 5');
    assert(iv5True[11] === 0x01, 'IV byte 11 is 0x01 when isLast = true');

    const ivHighIndex = computeChunkIV(prefix, 0x12345678, false);
    assert(ivHighIndex[7] === 0x12 && ivHighIndex[8] === 0x34 && ivHighIndex[9] === 0x56 && ivHighIndex[10] === 0x78, 'IV correctly encodes big-endian uint32');

    // AAD tests
    const aad0False = computeChunkAAD(V3_MAGIC, V3_VERSION, salt, 0, false);
    assert(aad0False.length === AAD_LENGTH, 'computeChunkAAD returns 42 bytes');
    assert(arraysEqual(aad0False.slice(0, 4), V3_MAGIC), "AAD bytes 0..3 match 'ZV3\\0'");
    assert(aad0False[4] === 0x03, 'AAD byte 4 is version 0x03');
    assert(arraysEqual(aad0False.slice(5, 37), salt), 'AAD bytes 5..36 match 32-byte salt');
    assert(aad0False[37] === 0 && aad0False[38] === 0 && aad0False[39] === 0 && aad0False[40] === 0, 'AAD bytes 37..40 encode chunk index 0');
    assert(aad0False[41] === 0x00, 'AAD byte 41 is 0x00 when isLast = false');

    const aad7True = computeChunkAAD(V3_MAGIC, V3_VERSION, salt, 7, true);
    assert(aad7True[40] === 7, 'AAD byte 40 encodes chunk index 7');
    assert(aad7True[41] === 0x01, 'AAD byte 41 is 0x01 when isLast = true');

    // Strict integer validation tests (Defect 1)
    let ivNaNCaught = false;
    try { computeChunkIV(prefix, NaN, false); } catch (e) { ivNaNCaught = (e instanceof RangeError); }
    assert(ivNaNCaught, 'computeChunkIV throws RangeError on NaN chunkIndex');

    let aadNaNCaught = false;
    try { computeChunkAAD(V3_MAGIC, V3_VERSION, salt, NaN, false); } catch (e) { aadNaNCaught = (e instanceof RangeError); }
    assert(aadNaNCaught, 'computeChunkAAD throws RangeError on NaN chunkIndex');

    let ivFloatCaught = false;
    try { computeChunkIV(prefix, 1.5, false); } catch (e) { ivFloatCaught = (e instanceof RangeError); }
    assert(ivFloatCaught, 'computeChunkIV throws RangeError on float chunkIndex (1.5)');

    let aadFloatCaught = false;
    try { computeChunkAAD(V3_MAGIC, V3_VERSION, salt, 2.7, false); } catch (e) { aadFloatCaught = (e instanceof RangeError); }
    assert(aadFloatCaught, 'computeChunkAAD throws RangeError on float chunkIndex (2.7)');

    let ivNegCaught = false;
    try { computeChunkIV(prefix, -1, false); } catch (e) { ivNegCaught = (e instanceof RangeError); }
    assert(ivNegCaught, 'computeChunkIV throws RangeError on negative chunkIndex (-1)');

    let aadNegCaught = false;
    try { computeChunkAAD(V3_MAGIC, V3_VERSION, salt, -1, false); } catch (e) { aadNegCaught = (e instanceof RangeError); }
    assert(aadNegCaught, 'computeChunkAAD throws RangeError on negative chunkIndex (-1)');

    let ivOverflowCaught = false;
    try { computeChunkIV(prefix, 0x100000000, false); } catch (e) { ivOverflowCaught = (e instanceof RangeError); }
    assert(ivOverflowCaught, 'computeChunkIV throws RangeError on chunkIndex overflow (2^32)');

    let aadOverflowCaught = false;
    try { computeChunkAAD(V3_MAGIC, V3_VERSION, salt, 0x100000000, false); } catch (e) { aadOverflowCaught = (e instanceof RangeError); }
    assert(aadOverflowCaught, 'computeChunkAAD throws RangeError on chunkIndex overflow (2^32)');
}

async function testKeyDerivation() {
    console.log('\n--- 3. PBKDF2 Key Derivation & Keyfile Tests ---');

    const salt = generateSalt(32);
    const password = 'SuperSecretVaultMasterPassword!#2026';

    // Fast iteration count for unit test performance (1000 rounds); full 600k tested separately
    console.log('  Deriving key with PBKDF2-SHA512 (fast test iterations)...');
    const key1 = await deriveMasterKey(password, salt, 1000, null);
    assert(key1 !== null && key1.algorithm.name === 'AES-GCM', 'deriveMasterKey returns AES-GCM CryptoKey');

    // Determinism test: same password + salt + iterations produces identical decryption ability
    const key2 = await deriveMasterKey(password, salt, 1000, null);
    const prefix = generateBaseIVPrefix(7);
    const testPlaintext = new TextEncoder().encode('ZevSafe STREAM AEAD Key Derivation Test');

    const encrypted = await encryptChunk(key1, testPlaintext, prefix, 0, true, salt);
    const decryptedWithKey2 = await decryptChunk(key2, encrypted, prefix, 0, true, salt);
    assert(arraysEqual(decryptedWithKey2, testPlaintext), 'Independent derivation with same password and salt decrypts correctly');

    // Password mismatch test
    const wrongKey = await deriveMasterKey('WrongPassword123', salt, 1000, null);
    let wrongPassCaught = false;
    try {
        await decryptChunk(wrongKey, encrypted, prefix, 0, true, salt);
    } catch (e) {
        wrongPassCaught = (e.name === 'OperationError');
    }
    assert(wrongPassCaught, 'Decryption with wrong password key throws OperationError');

    // Keyfile 2FA tests
    const keyfileBytesA = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xAA, 0xBB, 0xCC, 0xDD]);
    const keyfileBytesB = new Uint8Array([0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22]);

    const keyWithKeyfileA = await deriveMasterKey(password, salt, 1000, keyfileBytesA);
    const keyWithKeyfileA2 = await deriveMasterKey(password, salt, 1000, keyfileBytesA);
    const keyWithKeyfileB = await deriveMasterKey(password, salt, 1000, keyfileBytesB);

    const encKeyfile = await encryptChunk(keyWithKeyfileA, testPlaintext, prefix, 0, true, salt);

    // Decrypt with identical keyfile
    const decKeyfile = await decryptChunk(keyWithKeyfileA2, encKeyfile, prefix, 0, true, salt);
    assert(arraysEqual(decKeyfile, testPlaintext), 'Keyfile 2FA derivation produces matching key and decrypts successfully');

    // Decrypt with different keyfile
    let wrongKeyfileCaught = false;
    try {
        await decryptChunk(keyWithKeyfileB, encKeyfile, prefix, 0, true, salt);
    } catch (e) {
        wrongKeyfileCaught = (e.name === 'OperationError');
    }
    assert(wrongKeyfileCaught, 'Decryption with wrong keyfile throws OperationError');

    // Decrypt without keyfile
    let noKeyfileCaught = false;
    try {
        await decryptChunk(key1, encKeyfile, prefix, 0, true, salt);
    } catch (e) {
        noKeyfileCaught = (e.name === 'OperationError');
    }
    assert(noKeyfileCaught, 'Decryption without keyfile when keyfile was used throws OperationError');

    // Test standard 600,000 iterations derivation genuinely executes
    console.log('  Testing full 600,000 PBKDF2-SHA512 iterations...');
    const t0 = Date.now();
    const full600kKey = await deriveMasterKey('ProductionTestPass123', salt, PBKDF2_ITERATIONS, null);
    const elapsed = Date.now() - t0;
    console.log(`  600,000 rounds completed in ${elapsed} ms`);
    assert(full600kKey !== null && full600kKey.algorithm.name === 'AES-GCM', '600,000 iterations PBKDF2-SHA512 derivation succeeds');
}

async function testSingleChunkCrypto() {
    console.log('\n--- 4. Single Chunk Encrypt & Decrypt Framing Tests ---');

    const salt = generateSalt(32);
    const prefix = generateBaseIVPrefix(7);
    const key = await deriveMasterKey('ChunkCryptoPassword', salt, 1000);

    const testSizes = [0, 1, 15, 16, 64, 1024, 65536, 1048576]; // 0B up to 1 MB

    for (const size of testSizes) {
        const plaintext = new Uint8Array(size);
        for (let i = 0; i < size; i++) plaintext[i] = (i * 37) & 0xFF;

        const framed = await encryptChunk(key, plaintext, prefix, 0, true, salt);

        // Check framing: [Length (4B) || Ciphertext (N) || Tag (16B)]
        assert(framed.byteLength === CHUNK_HEADER_SIZE + size + TAG_LENGTH,
            `Framed chunk length for ${size} bytes is exactly 4 + ${size} + 16 = ${framed.byteLength}`);

        const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
        const declaredLen = view.getUint32(0, false);
        assert(declaredLen === size, `Declared length prefix correctly matches plaintext size ${size}`);

        const decrypted = await decryptChunk(key, framed, prefix, 0, true, salt);
        assert(arraysEqual(decrypted, plaintext), `Round-trip decryption for ${size} bytes matches plaintext byte-for-byte`);
    }
}

async function testTamperRejection() {
    console.log('\n--- 5. Tamper Rejection & Adversarial Tests ---');

    const salt = generateSalt(32);
    const prefix = generateBaseIVPrefix(7);
    const key = await deriveMasterKey('TamperProofSecret', salt, 1000);

    const plaintext = new Uint8Array(256);
    for (let i = 0; i < 256; i++) plaintext[i] = i;

    const originalChunk = await encryptChunk(key, plaintext, prefix, 0, true, salt);

    // 1. 1-bit flip in ciphertext payload
    const tamperedCiphertext = new Uint8Array(originalChunk);
    tamperedCiphertext[CHUNK_HEADER_SIZE + 10] ^= 0x01; // flip 1 bit in ciphertext
    let bitFlipCaught = false;
    try {
        await decryptChunk(key, tamperedCiphertext, prefix, 0, true, salt);
    } catch (e) {
        bitFlipCaught = (e.name === 'OperationError');
    }
    assert(bitFlipCaught, '1-bit flip in ciphertext payload throws OperationError immediately');

    // 2. 1-bit flip in authentication tag
    const tamperedTag = new Uint8Array(originalChunk);
    tamperedTag[tamperedTag.length - 1] ^= 0x80; // flip bit in tag
    let tagFlipCaught = false;
    try {
        await decryptChunk(key, tamperedTag, prefix, 0, true, salt);
    } catch (e) {
        tagFlipCaught = (e.name === 'OperationError');
    }
    assert(tagFlipCaught, '1-bit flip in authentication tag throws OperationError');

    // 3. Length prefix tampering
    const tamperedLength = new Uint8Array(originalChunk);
    tamperedLength[3] ^= 0x01; // modify length field
    let lenTamperCaught = false;
    try {
        await decryptChunk(key, tamperedLength, prefix, 0, true, salt);
    } catch (e) {
        lenTamperCaught = (e.name === 'OperationError');
    }
    assert(lenTamperCaught, 'Tampered length header field throws OperationError');

    // 3b. Malleable length tampering (N + 16 strictly rejected - Defect 2)
    const tamperedPlus16 = new Uint8Array(originalChunk);
    const origDeclaredLen = new DataView(originalChunk.buffer, originalChunk.byteOffset, originalChunk.byteLength).getUint32(0, false);
    new DataView(tamperedPlus16.buffer, tamperedPlus16.byteOffset, tamperedPlus16.byteLength).setUint32(0, origDeclaredLen + TAG_LENGTH, false);
    let lenPlus16Caught = false;
    try {
        await decryptChunk(key, tamperedPlus16, prefix, 0, true, salt);
    } catch (e) {
        lenPlus16Caught = (e.name === 'OperationError');
    }
    assert(lenPlus16Caught, 'Tampered length header (N + 16) strictly throws OperationError without decrypting');

    // 4. Chunk Index alteration (AAD/IV sequence attack)
    let indexTamperCaught = false;
    try {
        // Encrypted with chunkIndex 0, decrypted with chunkIndex 1
        await decryptChunk(key, originalChunk, prefix, 1, true, salt);
    } catch (e) {
        indexTamperCaught = (e.name === 'OperationError');
    }
    assert(indexTamperCaught, 'Altered chunkIndex throws OperationError (AAD sequence binding protects order)');

    // 5. isLast flag alteration
    let flagTamperCaught = false;
    try {
        // Encrypted with isLast = true, decrypted with isLast = false
        await decryptChunk(key, originalChunk, prefix, 0, false, salt);
    } catch (e) {
        flagTamperCaught = (e.name === 'OperationError');
    }
    assert(flagTamperCaught, 'Altered isLast flag throws OperationError (AAD/IV protects finality flag)');

    // 6. Truncated chunk buffer (< 20 bytes)
    let shortChunkCaught = false;
    try {
        await decryptChunk(key, originalChunk.slice(0, 15), prefix, 0, true, salt);
    } catch (e) {
        shortChunkCaught = (e.name === 'OperationError');
    }
    assert(shortChunkCaught, 'Truncated chunk (< 20 bytes) throws OperationError');
}

async function testWebStreamsPipeline() {
    console.log('\n--- 6. Web Streams API Multi-Chunk Streaming Pipeline Tests ---');

    const salt = generateSalt(32);
    const prefix = generateBaseIVPrefix(7);
    const key = await deriveMasterKey('WebStreamsStreamKey', salt, 1000);

    // Test A: Multi-chunk streaming roundtrip with custom small chunkSize (64 KB)
    const testChunkSize = 65536; // 64 KB per chunk
    const totalBytes = testChunkSize * 3 + 12345; // ~208 KB (4 chunks: 3 full + 1 partial)
    const syntheticPlaintext = new Uint8Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) syntheticPlaintext[i] = (i * 43) & 0xFF;

    const originalHash = await sha256Hex(syntheticPlaintext);

    // Feed plaintext in small arbitrary 16 KB chunks to test accumulator
    const inputStreamChunks = [];
    const feedSliceSize = 16384;
    for (let offset = 0; offset < totalBytes; offset += feedSliceSize) {
        inputStreamChunks.push(syntheticPlaintext.slice(offset, offset + feedSliceSize));
    }

    const plaintextStream = createStreamFromChunks(inputStreamChunks);
    const encryptorStream = createChunkEncryptorStream(key, prefix, salt, testChunkSize);
    const encryptedStream = plaintextStream.pipeThrough(encryptorStream);

    // Collect encrypted chunks
    const encryptedChunks = [];
    const reader = encryptedStream.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        encryptedChunks.push(value);
    }

    assert(encryptedChunks.length === 4, `Encryptor stream emitted exactly 4 framed chunks (expected for 3 full + 1 partial)`);

    // Verify first 3 chunks are testChunkSize and 4th is remainder
    for (let i = 0; i < 3; i++) {
        const view = new DataView(encryptedChunks[i].buffer, encryptedChunks[i].byteOffset, encryptedChunks[i].byteLength);
        const declared = view.getUint32(0, false);
        assert(declared === testChunkSize, `Chunk ${i} payload length is ${testChunkSize}`);
    }
    const lastView = new DataView(encryptedChunks[3].buffer, encryptedChunks[3].byteOffset, encryptedChunks[3].byteLength);
    assert(lastView.getUint32(0, false) === 12345, `Chunk 3 (final) payload length is remainder 12345 bytes`);

    // Now pipe encrypted chunks through decryptor stream
    const decryptorStream = createChunkDecryptorStream(key, prefix, salt, testChunkSize);
    const decryptInputStream = createStreamFromChunks(encryptedChunks);
    const decryptedStream = decryptInputStream.pipeThrough(decryptorStream);

    const decryptedBytes = await streamToBytes(decryptedStream);
    const decryptedHash = await sha256Hex(decryptedBytes);

    assert(decryptedBytes.length === totalBytes, `Decrypted byte stream length ${decryptedBytes.length} matches original ${totalBytes}`);
    assert(decryptedHash === originalHash, `Decrypted payload SHA-256 hash matches original byte-for-byte: ${decryptedHash}`);

    // Test B: Empty stream (0 bytes) round-trip
    const emptyPlaintext = new Uint8Array(0);
    const emptyPlaintextStream = createStreamFromChunks([emptyPlaintext]);
    const emptyEncStream = emptyPlaintextStream.pipeThrough(createChunkEncryptorStream(key, prefix, salt, testChunkSize));
    const emptyDecStream = emptyEncStream.pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
    const emptyDecrypted = await streamToBytes(emptyDecStream);
    assert(emptyDecrypted.length === 0, 'Empty 0-byte stream round-trips to exactly 0 bytes');

    // Test C: Exact 1-chunk boundary stream (stream size == testChunkSize)
    const exact1Chunk = new Uint8Array(testChunkSize).fill(0x55);
    const exactStream = createStreamFromChunks([exact1Chunk])
        .pipeThrough(createChunkEncryptorStream(key, prefix, salt, testChunkSize))
        .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
    const exactDecrypted = await streamToBytes(exactStream);
    assert(arraysEqual(exactDecrypted, exact1Chunk), 'Exact 1-chunk boundary stream decrypts cleanly');

    // Test D: Exact 2-chunk boundary stream (stream size == 2 * testChunkSize)
    const exact2Chunk = new Uint8Array(testChunkSize * 2).fill(0x77);
    const exact2Stream = createStreamFromChunks([exact2Chunk])
        .pipeThrough(createChunkEncryptorStream(key, prefix, salt, testChunkSize))
        .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
    const exact2Decrypted = await streamToBytes(exact2Stream);
    assert(arraysEqual(exact2Decrypted, exact2Chunk), 'Exact 2-chunk boundary stream decrypts cleanly');

    // Test E: Fragmented incoming encrypted chunks (simulating random network/disk slice chunking)
    const allEncryptedBytes = concatArrayOfBuffers(encryptedChunks);
    // Slice into unusual 7919-byte fragments
    const fragmentedChunks = [];
    const fragmentSize = 7919;
    for (let offset = 0; offset < allEncryptedBytes.byteLength; offset += fragmentSize) {
        fragmentedChunks.push(allEncryptedBytes.slice(offset, offset + fragmentSize));
    }

    const fragDecStream = createStreamFromChunks(fragmentedChunks)
        .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
    const fragDecryptedBytes = await streamToBytes(fragDecStream);
    assert(arraysEqual(fragDecryptedBytes, syntheticPlaintext), 'Decryptor reassembles arbitrary stream fragmentation and decrypts cleanly');
}

function concatArrayOfBuffers(arrays) {
    const total = arrays.reduce((acc, a) => acc + a.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
        out.set(a, offset);
        offset += a.byteLength;
    }
    return out;
}

async function testStreamAdversarialAttacks() {
    console.log('\n--- 7. Stream Adversarial Attacks Tests ---');

    const salt = generateSalt(32);
    const prefix = generateBaseIVPrefix(7);
    const key = await deriveMasterKey('AdversarialSecretPass', salt, 1000);
    const testChunkSize = 32768;

    // Create 3 encrypted chunks
    const data = new Uint8Array(testChunkSize * 3);
    data.fill(0x42);
    const encChunks = [];
    const encStream = createStreamFromChunks([data]).pipeThrough(createChunkEncryptorStream(key, prefix, salt, testChunkSize));
    const reader = encStream.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        encChunks.push(value);
    }
    assert(encChunks.length === 3, 'Prepared 3 encrypted chunks for adversarial testing');

    // 1. Chunk Truncation Attack: Omit the final chunk (chunk 2)
    let truncationCaught = false;
    try {
        const truncatedStream = createStreamFromChunks([encChunks[0], encChunks[1]])
            .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
        await streamToBytes(truncatedStream);
    } catch (e) {
        truncationCaught = (e.name === 'OperationError');
    }
    assert(truncationCaught, 'Chunk truncation attack (omitted final chunk) throws OperationError');

    // 2. Splicing Attack: Append an extra chunk after final chunk
    let splicingCaught = false;
    try {
        const splicedStream = createStreamFromChunks([encChunks[0], encChunks[1], encChunks[2], encChunks[0]])
            .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
        await streamToBytes(splicedStream);
    } catch (e) {
        splicingCaught = (e.name === 'OperationError');
    }
    assert(splicingCaught, 'Chunk splicing attack (chunk appended after final chunk) throws OperationError');

    // 3. Chunk Reordering Attack: Swap Chunk 0 and Chunk 1
    let reorderCaught = false;
    try {
        const reorderedStream = createStreamFromChunks([encChunks[1], encChunks[0], encChunks[2]])
            .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
        await streamToBytes(reorderedStream);
    } catch (e) {
        reorderCaught = (e.name === 'OperationError');
    }
    assert(reorderCaught, 'Chunk reordering attack (swapping chunks 0 and 1) throws OperationError');

    // 4. Incomplete Framing Truncation: Drop trailing 10 bytes from stream
    let incompleteCaught = false;
    try {
        const allBytes = concatArrayOfBuffers(encChunks);
        const truncatedBytes = allBytes.slice(0, allBytes.byteLength - 10);
        const brokenStream = createStreamFromChunks([truncatedBytes])
            .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
        await streamToBytes(brokenStream);
    } catch (e) {
        incompleteCaught = (e.name === 'OperationError');
    }
    assert(incompleteCaught, 'Incomplete chunk truncation (trailing 10 bytes missing) throws OperationError');

    // 5. Middle Chunk Tampering: Corrupt 1 byte in chunk 1
    const corruptedChunk1 = new Uint8Array(encChunks[1]);
    corruptedChunk1[20] ^= 0x01; // flip 1 bit
    let middleTamperCaught = false;
    try {
        const tamperedStream = createStreamFromChunks([encChunks[0], corruptedChunk1, encChunks[2]])
            .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
        await streamToBytes(tamperedStream);
    } catch (e) {
        middleTamperCaught = (e.name === 'OperationError');
    }
    assert(middleTamperCaught, 'Tampering inside middle chunk throws OperationError, halting stream pipeline');

    // 6. Declared length exceeding configured chunkSize (Stream Heap Bounding - Defect 3)
    const oversizedChunk = new Uint8Array(4 + 16);
    new DataView(oversizedChunk.buffer).setUint32(0, testChunkSize + 1, false);
    let oversizedCaught = false;
    try {
        const oversizedStream = createStreamFromChunks([oversizedChunk])
            .pipeThrough(createChunkDecryptorStream(key, prefix, salt, testChunkSize));
        await streamToBytes(oversizedStream);
    } catch (e) {
        oversizedCaught = (e.name === 'OperationError');
    }
    assert(oversizedCaught, 'Declared chunk length exceeding chunkSize throws OperationError immediately');
}

// =========================================================================
// RUNNER
// =========================================================================

async function runAllTests() {
    console.log('===============================================================');
    console.log('  ZevSafe v3 STREAM AEAD Core Cryptographic Verification Suite');
    console.log('===============================================================');

    const startTime = Date.now();

    await testContainerHeader();
    await testIVandAAD();
    await testKeyDerivation();
    await testSingleChunkCrypto();
    await testTamperRejection();
    await testWebStreamsPipeline();
    await testStreamAdversarialAttacks();

    const elapsedMs = Date.now() - startTime;

    console.log('\n===============================================================');
    console.log(`  TEST RESULTS: ${passedTests}/${totalTests} PASSED (${elapsedMs} ms)`);
    if (failedTests > 0) {
        console.error(`  FAILURES (${failedTests}):`);
        for (const f of failures) console.error(`   - ${f}`);
        console.log('===============================================================');
        process.exit(1);
    } else {
        console.log('  ALL TESTS PASSED WITH 100% SUCCESS RATE.');
        console.log('===============================================================');
        process.exit(0);
    }
}

runAllTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
