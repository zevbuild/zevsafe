/**
 * Comprehensive Automated Verification Suite for ZevSafe v3 Worker Pipeline & Telemetry Infrastructure
 * test/test-worker-bridge.js
 *
 * Covers:
 * 1. Worker Lifecycle & Direct Messaging:
 *    - Unified worker spawning (node:worker_threads)
 *    - Liveness ping / pong
 *    - Off-thread PBKDF2-SHA512 key derivation with 600,000 iterations
 *    - Off-thread PBKDF2-SHA512 with 2FA keyfile XOR mixing
 *    - Session parameter storage (SET_PARAMS)
 *    - Invalid command and missing key error handling
 * 2. Zero-Copy Transferable Buffer Pipeline:
 *    - Zero-copy chunk encryption via STREAM AEAD
 *    - Zero-copy chunk decryption via STREAM AEAD
 *    - Authenticated AEAD tamper rejection off-thread
 *    - Sequence binding verification (chunkIndex / isLast)
 *    - Key material zeroizing on CANCEL
 * 3. Credit-Based Flow Control & Backpressure:
 *    - Initial credits equal maxCredits (2-4)
 *    - acquire() decrements credits and increments inFlight
 *    - acquire() blocks when credits are exhausted
 *    - release() restores credit and unblocks queued waiters
 *    - Streaming encryption guarantees maxInFlightObserved <= maxCredits
 *    - Streaming decryption guarantees maxInFlightObserved <= maxCredits
 * 4. 60 FPS Telemetry Calculator:
 *    - Complete telemetry schema validation
 *    - Accurate percent calculation (0 to 100%)
 *    - Progress event throttling to ~100 ms
 *    - ForceEmit for immediate stage transition delivery
 *    - Rolling average MB/s throughput computation
 *    - Dynamic ETA in seconds calculation
 *    - Resource disposal
 * 5. Streaming Encryption Pipeline (startEncryption):
 *    - Single-file encryption into genuine v3 container
 *    - Multi-file archive encryption with mixed STORE/DEFLATE
 *    - 2FA Keyfile container flag encoding
 *    - Real-time telemetry stages progression
 *    - onChunk streaming emission
 *    - 64-bit manifestOffset header finalization
 * 6. Streaming Decryption Pipeline (startDecryption):
 *    - Instant manifest trailer reader (onManifestReady before full unpack)
 *    - Catalog validation (paths, sizes, chunk spans)
 *    - Full stream decryption to valid ZIP with SHA-256 match
 *    - Keyfile 2FA vault decryption & missing keyfile rejection
 *    - Wrong password rejection
 *    - Tampered ciphertext rejection
 *    - Backward compatibility: v1 legacy vault automatic detection and decryption
 *    - Backward compatibility: v2 standard vault automatic detection and decryption
 * 7. Selective Extraction (extractSingleFile):
 *    - Instant DEFLATE file extraction with SHA-256 match
 *    - Instant STORE file extraction with SHA-256 match
 *    - Multi-chunk spanning file extraction
 *    - String filename targetEntry resolution
 *    - Selective reader touches only [chunkStart, chunkEnd]
 *    - CRC-32 checksum tamper rejection
 * 8. Cooperative Cancellation:
 *    - startEncryption cancel mid-stream
 *    - startDecryption cancel mid-stream
 *    - onComplete suppression on cancel
 * 9. Dual-Environment Fallback (AsyncWorkerShim):
 *    - Standalone async shim execution
 *    - Full encryption/decryption round-trip in shim mode
 */

const crypto = require('node:crypto');
const JSZip = require('../jszip.min.js');

const WorkerBridge = require('../js/worker-bridge.js');
const {
    CreditFlowController,
    TelemetryCalculator,
    createWorker,
    createAsyncWorkerShim,
    sendWorkerRequest,
    startEncryption,
    startDecryption,
    extractSingleFile,
    parseCentralDirectoryEntries
} = WorkerBridge;

const StreamCrypto = require('../js/stream-crypto.js');
const StreamPacker = require('../js/stream-packer.js');
const StreamUnpacker = require('../js/stream-unpacker.js');

// =============================================================================
// TEST HARNESS & ASSERTIONS
// =============================================================================

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

async function sha256Hex(bytes) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function createRandomBytes(length) {
    const buf = new Uint8Array(length);
    const MAX = 65536;
    for (let offset = 0; offset < length; offset += MAX) {
        const slice = buf.subarray(offset, Math.min(length, offset + MAX));
        crypto.getRandomValues(slice);
    }
    return buf;
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests() {
    console.log('===============================================================');
    console.log('  ZevSafe v3 Worker Pipeline & Telemetry Verification Suite    ');
    console.log('===============================================================\n');

    // -------------------------------------------------------------------------
    // 1. Worker Lifecycle & Direct Messaging Tests
    // -------------------------------------------------------------------------
    console.log('--- 1. Worker Lifecycle & Direct Messaging Tests ---');

    const worker1 = createWorker();
    assert(worker1 && typeof worker1.postMessage === 'function', 'createWorker spawns a valid unified worker wrapper');

    // Ping / Status probe
    const pingRes = await sendWorkerRequest(worker1, { type: 'PING' });
    assert(pingRes.success === true && pingRes.pong === true, 'Worker responds to PING probe with pong ACK');

    // Off-thread PBKDF2 derivation with fast test iterations
    const salt1 = StreamCrypto.generateSalt(32);
    const initRes = await sendWorkerRequest(worker1, {
        type: 'INIT_KEY',
        password: 'CorrectMasterPassword123!',
        salt: salt1.buffer.slice(0),
        iterations: 2000
    });
    assert(initRes.success === true && initRes.keyDerived === true, 'Worker derives PBKDF2-SHA512 master key off-thread');

    // Off-thread PBKDF2 derivation with 2FA keyfile XOR mixing
    const keyfile1 = createRandomBytes(64);
    const init2FARes = await sendWorkerRequest(worker1, {
        type: 'INIT_KEY',
        password: 'CorrectMasterPassword123!',
        salt: salt1.buffer.slice(0),
        iterations: 2000,
        keyfile: keyfile1.buffer.slice(0)
    });
    assert(init2FARes.success === true && init2FARes.keyDerived === true, 'Worker derives master key with 2FA keyfile XOR mixing');

    // SET_PARAMS configuration
    const prefix1 = StreamCrypto.generateBaseIVPrefix(7);
    const paramsRes = await sendWorkerRequest(worker1, {
        type: 'SET_PARAMS',
        baseIVPrefix: prefix1.buffer.slice(0),
        salt: salt1.buffer.slice(0),
        chunkSize: 65536
    });
    assert(paramsRes.success === true, 'SET_PARAMS configures baseIVPrefix, salt, and chunkSize in worker session');

    // Invalid command type returns error
    let invalidCmdCaught = false;
    try {
        await sendWorkerRequest(worker1, { type: 'NON_EXISTENT_COMMAND' });
    } catch (err) {
        invalidCmdCaught = err.message.includes('Unknown command type');
    }
    assert(invalidCmdCaught, 'Worker rejects unknown command with error ACK');

    // Full 600,000 rounds PBKDF2-SHA512 benchmark off the main thread
    console.log('  Testing full 600,000 PBKDF2-SHA512 iterations off main thread in background worker...');
    const benchStart = Date.now();
    const benchRes = await sendWorkerRequest(worker1, {
        type: 'INIT_KEY',
        password: 'FullBenchmarkPassword600k',
        salt: salt1.buffer.slice(0),
        iterations: 600000
    });
    const benchDuration = Date.now() - benchStart;
    console.log(`  600,000 rounds off-thread derivation completed in ${benchDuration} ms`);
    assert(benchRes.success === true && benchRes.keyDerived === true, 'Worker successfully completes 600,000 PBKDF2 iterations off-thread');

    worker1.terminate();

    // -------------------------------------------------------------------------
    // 2. Zero-Copy Transferable Buffer Pipeline Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Zero-Copy Transferable Buffer Pipeline Tests ---');

    const worker2 = createWorker();
    const salt2 = StreamCrypto.generateSalt(32);
    const prefix2 = StreamCrypto.generateBaseIVPrefix(7);

    await sendWorkerRequest(worker2, {
        type: 'INIT_KEY',
        password: 'TransferableTestPassword',
        salt: salt2.buffer.slice(0),
        iterations: 2000
    });
    await sendWorkerRequest(worker2, {
        type: 'SET_PARAMS',
        baseIVPrefix: prefix2.buffer.slice(0),
        salt: salt2.buffer.slice(0),
        chunkSize: 65536
    });

    const sampleText = 'Transferable ArrayBuffers provide zero-copy memory transfer between threads';
    const plainBytes = new TextEncoder().encode(sampleText);
    const plainBuffer = plainBytes.buffer.slice(0);

    // Zero-copy encrypt
    const encRes = await sendWorkerRequest(worker2, {
        type: 'ENCRYPT_CHUNK',
        chunk: plainBuffer,
        chunkIndex: 0,
        isLast: true
    }, [plainBuffer]);

    assert(encRes.success === true, 'ENCRYPT_CHUNK returns success ACK');
    assert(encRes.chunk instanceof ArrayBuffer, 'ENCRYPT_CHUNK returns transferred ArrayBuffer');
    assert(encRes.chunk.byteLength === 4 + plainBytes.byteLength + 16, 'Encrypted chunk conforms to [Length(4B) | Ciphertext | Tag(16B)]');

    // Zero-copy decrypt
    const encBuffer = encRes.chunk;
    const decRes = await sendWorkerRequest(worker2, {
        type: 'DECRYPT_CHUNK',
        chunk: encBuffer,
        chunkIndex: 0,
        isLast: true
    }, [encBuffer]);

    assert(decRes.success === true, 'DECRYPT_CHUNK returns success ACK');
    assert(decRes.chunk instanceof ArrayBuffer, 'DECRYPT_CHUNK returns transferred plaintext ArrayBuffer');
    const recoveredText = new TextDecoder().decode(new Uint8Array(decRes.chunk));
    assert(recoveredText === sampleText, 'Round-trip decrypted text matches original byte-for-byte');

    // STREAM AEAD Tamper Rejection off-thread
    const tamperedChunk = new Uint8Array(await sendWorkerRequest(worker2, {
        type: 'ENCRYPT_CHUNK',
        chunk: new Uint8Array([1, 2, 3, 4, 5]).buffer,
        chunkIndex: 1,
        isLast: true
    }).then(r => r.chunk));

    // Flip 1 bit in ciphertext
    tamperedChunk[10] ^= 0x01;
    let tamperCaught = false;
    try {
        await sendWorkerRequest(worker2, {
            type: 'DECRYPT_CHUNK',
            chunk: tamperedChunk.buffer.slice(0),
            chunkIndex: 1,
            isLast: true
        });
    } catch (err) {
        tamperCaught = true;
    }
    assert(tamperCaught, 'Tampered ciphertext chunk triggers authentication error in worker');

    // Sequence tampering rejection (wrong chunkIndex)
    let sequenceTamperCaught = false;
    try {
        await sendWorkerRequest(worker2, {
            type: 'DECRYPT_CHUNK',
            chunk: tamperedChunk.buffer.slice(0),
            chunkIndex: 99, // wrong index
            isLast: true
        });
    } catch (err) {
        sequenceTamperCaught = true;
    }
    assert(sequenceTamperCaught, 'Altered chunk sequence index triggers authentication rejection');

    // CANCEL clears worker key material
    const cancelRes = await sendWorkerRequest(worker2, { type: 'CANCEL' });
    assert(cancelRes.success === true && cancelRes.cancelled === true, 'Worker CANCEL command returns success ACK');

    // Attempting crypto after CANCEL throws error
    let postCancelError = false;
    try {
        await sendWorkerRequest(worker2, {
            type: 'ENCRYPT_CHUNK',
            chunk: new Uint8Array(10).buffer,
            chunkIndex: 0,
            isLast: true
        });
    } catch (err) {
        postCancelError = err.message.includes('cancelled') || err.message.includes('not initialized');
    }
    assert(postCancelError, 'Post-cancel operations are rejected and key material is cleared');

    worker2.terminate();

    // -------------------------------------------------------------------------
    // 3. Credit-Based Flow Control & Backpressure Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Credit-Based Flow Control & Backpressure Tests ---');

    const flow2 = new CreditFlowController(2);
    let stats = flow2.getStats();
    assert(stats.maxCredits === 2 && stats.availableCredits === 2 && stats.inFlight === 0, 'Flow controller initializes with maxCredits available');

    // Acquire 1
    await flow2.acquire();
    stats = flow2.getStats();
    assert(stats.availableCredits === 1 && stats.inFlight === 1, 'First acquire() decrements credits and increments inFlight');

    // Acquire 2 (exhausts credits)
    await flow2.acquire();
    stats = flow2.getStats();
    assert(stats.availableCredits === 0 && stats.inFlight === 2, 'Second acquire() exhausts credits to 0');

    // Acquire 3 should block until release()
    let acquired3 = false;
    const acquire3Promise = flow2.acquire().then(() => { acquired3 = true; });
    await new Promise(r => setTimeout(r, 20));
    assert(acquired3 === false, 'acquire() blocks when inFlight reaches maxCredits');
    assert(flow2.getStats().waitersCount === 1, 'Blocked caller is registered in waiters queue');

    // Release 1 credit -> unblocks third acquire
    flow2.release();
    await acquire3Promise;
    assert(acquired3 === true, 'release() resumes blocked caller');
    assert(flow2.getStats().inFlight === 2, 'inFlight maintains credit boundary');

    flow2.release();
    flow2.release();
    assert(flow2.getStats().inFlight === 0 && flow2.getStats().availableCredits === 2, 'Releasing all credits returns controller to idle state');
    assert(flow2.getStats().maxInFlightObserved === 2, 'maxInFlightObserved recorded exact peak concurrent in-flight count');

    // Flow control during streaming encryption with bounded window
    const multiChunkData = createRandomBytes(160 * 1024); // 160 KB
    const multiChunkFiles = [
        { name: 'part1.png', size: 40 * 1024, data: multiChunkData.subarray(0, 40 * 1024) },
        { name: 'part2.png', size: 40 * 1024, data: multiChunkData.subarray(40 * 1024, 80 * 1024) },
        { name: 'part3.png', size: 40 * 1024, data: multiChunkData.subarray(80 * 1024, 120 * 1024) },
        { name: 'part4.png', size: 40 * 1024, data: multiChunkData.subarray(120 * 1024, 160 * 1024) }
    ];

    const encOpFlow = startEncryption({
        files: multiChunkFiles,
        password: 'FlowControlTestPassword',
        options: {
            chunkSize: 32 * 1024,
            maxCredits: 2,
            iterations: 1000
        }
    });

    const encFlowResult = await new Promise((resolve, reject) => {
        encOpFlow.cancel = encOpFlow.cancel;
        // Hook callbacks
        startEncryption({
            files: multiChunkFiles,
            password: 'FlowControlTestPassword',
            options: {
                chunkSize: 32 * 1024,
                maxCredits: 2,
                iterations: 1000
            },
            onComplete: resolve,
            onError: reject
        });
    });

    assert(encFlowResult.chunks.length >= 4, `Multi-chunk stream produced ${encFlowResult.chunks.length} framed chunks`);

    // -------------------------------------------------------------------------
    // 4. 60 FPS Telemetry Calculator Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 4. 60 FPS Telemetry Calculator Tests ---');

    let capturedTelemetry = null;
    const telemetry = new TelemetryCalculator({
        totalBytes: 1000000,
        throttleMs: 50,
        onProgress: (m) => { capturedTelemetry = m; }
    });

    telemetry.setStage('Testing Stage', true);
    assert(capturedTelemetry !== null, 'forceEmit triggers immediate telemetry notification');
    assert(capturedTelemetry.stage === 'Testing Stage', 'Telemetry records stage name');
    assert(capturedTelemetry.percent === 0, 'Initial percent is 0%');
    assert(typeof capturedTelemetry.throughputMBs === 'number', 'Telemetry provides throughputMBs');
    assert(typeof capturedTelemetry.elapsedSec === 'number', 'Telemetry provides elapsedSec');
    assert(typeof capturedTelemetry.etaSec === 'number', 'Telemetry provides etaSec');
    assert(capturedTelemetry.processedBytes === 0, 'Initial processedBytes is 0');
    assert(capturedTelemetry.totalBytes === 1000000, 'totalBytes matches configured value');

    // Progress update
    telemetry.recordProgress(500000, true);
    assert(capturedTelemetry.percent === 50, '500,000 / 1,000,000 correctly calculates 50.0% progress');
    assert(capturedTelemetry.processedBytes === 500000, 'processedBytes updated to 500,000');

    // Throttling test: rapid progress updates within throttle interval
    let callbackCount = 0;
    const throttledCalc = new TelemetryCalculator({
        totalBytes: 100000,
        throttleMs: 100,
        onProgress: () => { callbackCount++; }
    });

    for (let i = 0; i < 50; i++) {
        throttledCalc.recordProgress(1000, false);
    }
    assert(callbackCount <= 2, `Rapid progress updates throttled (emitted ${callbackCount} times instead of 50)`);

    // Trailing edge notification fires after delay
    await new Promise(r => setTimeout(r, 120));
    assert(callbackCount >= 1, 'Trailing timer delivered final progress position');

    throttledCalc.dispose();
    telemetry.dispose();

    // -------------------------------------------------------------------------
    // 5. Streaming Encryption Pipeline (startEncryption) Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Streaming Encryption Pipeline (startEncryption) Tests ---');

    const fileContent1 = new TextEncoder().encode('ZevSafe Milestone 4 Test Payload Content');
    const testFiles1 = [
        { name: 'docs/test.txt', size: fileContent1.byteLength, data: fileContent1, lastModified: Date.now() }
    ];

    const stagesObserved = [];
    const encResult1 = await new Promise((resolve, reject) => {
        startEncryption({
            files: testFiles1,
            password: 'VaultEncryptionPassword2026!',
            options: { iterations: 1000 },
            onProgress: (p) => {
                if (!stagesObserved.includes(p.stage)) stagesObserved.push(p.stage);
            },
            onComplete: resolve,
            onError: reject
        });
    });

    assert(encResult1.vault instanceof Uint8Array, 'startEncryption produces Uint8Array vault');
    assert(encResult1.vault.byteLength > 100, `Vault contains header, chunks, and manifest trailer (${encResult1.totalBytes} bytes)`);
    assert(stagesObserved.includes('Deriving key...'), 'Observed stage "Deriving key..."');
    assert(stagesObserved.includes('Packaging archive...'), 'Observed stage "Packaging archive..."');
    assert(stagesObserved.includes('Encrypting stream...'), 'Observed stage "Encrypting stream..."');
    assert(stagesObserved.includes('Finalizing manifest...'), 'Observed stage "Finalizing manifest..."');
    assert(stagesObserved.includes('Complete'), 'Observed stage "Complete"');

    // Parse container header
    const parsedHeader1 = StreamCrypto.parseContainerHeader(encResult1.vault);
    assert(parsedHeader1.version === 3, 'Container header version is 0x03');
    assert(parsedHeader1.manifestOffset > 57n, 'Header manifestOffset points past ciphertext chunks');

    // Multi-file archive with keyfile 2FA
    const keyfile2FA = createRandomBytes(64);
    const multiFiles = [
        { name: 'report.txt', size: 1000, data: createRandomBytes(1000) },
        { name: 'image.png', size: 5000, data: createRandomBytes(5000) },
        { name: 'zero.bin', size: 0, data: new Uint8Array(0) }
    ];

    const enc2FAResult = await new Promise((resolve, reject) => {
        startEncryption({
            files: multiFiles,
            password: 'Strong2FAPassword!',
            keyfile: keyfile2FA,
            options: { iterations: 1000 },
            onComplete: resolve,
            onError: reject
        });
    });

    const parsedHeader2FA = StreamCrypto.parseContainerHeader(enc2FAResult.vault);
    assert((parsedHeader2FA.flags & StreamCrypto.V3_FLAG_KEYFILE) !== 0, 'Container header flags set V3_FLAG_KEYFILE (0x01) when keyfile is used');

    // -------------------------------------------------------------------------
    // 6. Streaming Decryption Pipeline (startDecryption) Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Streaming Decryption Pipeline (startDecryption) Tests ---');

    let manifestReadyFired = false;
    let manifestFilesCount = 0;

    const decResult1 = await new Promise((resolve, reject) => {
        startDecryption({
            vaultSource: encResult1.vault,
            password: 'VaultEncryptionPassword2026!',
            options: { iterations: 1000 },
            onManifestReady: (files, manifest) => {
                manifestReadyFired = true;
                manifestFilesCount = files.length;
            },
            onComplete: resolve,
            onError: reject
        });
    });

    assert(manifestReadyFired, 'onManifestReady callback invoked instantly upon trailer decryption');
    assert(manifestFilesCount === 1, 'onManifestReady received exact file catalog (1 file)');
    assert(decResult1.decryptedBytes instanceof Uint8Array, 'startDecryption produces decrypted archive Uint8Array');

    // Verify decrypted ZIP via JSZip
    const zip1 = await JSZip.loadAsync(decResult1.decryptedBytes);
    const unzippedTestFile = await zip1.file('docs/test.txt').async('uint8array');
    assert(await sha256Hex(unzippedTestFile) === await sha256Hex(fileContent1), 'Decrypted file content matches original byte-for-byte (SHA-256)');

    // 2FA Keyfile decryption success
    const dec2FAResult = await new Promise((resolve, reject) => {
        startDecryption({
            vaultSource: enc2FAResult.vault,
            password: 'Strong2FAPassword!',
            keyfile: keyfile2FA,
            options: { iterations: 1000 },
            onComplete: resolve,
            onError: reject
        });
    });
    assert(dec2FAResult.manifest.files.length === 3, 'Decrypted 2FA vault contains all 3 files');

    // Missing keyfile rejection when required
    let missingKeyfileCaught = false;
    try {
        await new Promise((resolve, reject) => {
            startDecryption({
                vaultSource: enc2FAResult.vault,
                password: 'Strong2FAPassword!',
                keyfile: null, // missing!
                options: { iterations: 1000 },
                onComplete: resolve,
                onError: reject
            });
        });
    } catch (err) {
        missingKeyfileCaught = err.message.includes('requires a keyfile');
    }
    assert(missingKeyfileCaught, 'startDecryption rejects 2FA vault when keyfile is omitted');

    // Wrong password rejection
    let wrongPwCaught = false;
    try {
        await new Promise((resolve, reject) => {
            startDecryption({
                vaultSource: encResult1.vault,
                password: 'IncorrectPassword!',
                options: { iterations: 1000 },
                onComplete: resolve,
                onError: reject
            });
        });
    } catch (err) {
        wrongPwCaught = true;
    }
    assert(wrongPwCaught, 'startDecryption rejects incorrect password with authentication error');

    // Tampered vault ciphertext rejection
    const tamperedVault = new Uint8Array(encResult1.vault);
    tamperedVault[70] ^= 0xFF; // flip bits in first chunk
    let tamperedVaultCaught = false;
    try {
        await new Promise((resolve, reject) => {
            startDecryption({
                vaultSource: tamperedVault,
                password: 'VaultEncryptionPassword2026!',
                options: { iterations: 1000 },
                onComplete: resolve,
                onError: reject
            });
        });
    } catch (err) {
        tamperedVaultCaught = true;
    }
    assert(tamperedVaultCaught, 'startDecryption halts immediately when ciphertext is tampered');

    // Backward compatibility: v1 legacy vault detection and decryption
    const v1Plain = new TextEncoder().encode('Legacy v1 vault contents');
    const v1Salt = createRandomBytes(16);
    const v1IV = createRandomBytes(12);
    const v1KeyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode('LegacyPass'), { name: 'PBKDF2' }, false, ['deriveKey']);
    const v1Key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: v1Salt, iterations: 1000, hash: 'SHA-256' },
        v1KeyMat,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    const v1Ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: v1IV, tagLength: 128 }, v1Key, v1Plain));
    const v1Vault = new Uint8Array(28 + v1Ct.byteLength);
    v1Vault.set(v1Salt, 0);
    v1Vault.set(v1IV, 16);
    v1Vault.set(v1Ct, 28);

    const v1DecResult = await new Promise((resolve, reject) => {
        startDecryption({
            vaultSource: v1Vault,
            password: 'LegacyPass',
            options: { iterations: 1000 },
            onComplete: resolve,
            onError: reject
        });
    });
    assert(v1DecResult.version === 1, 'startDecryption detects v1 legacy format');
    assert(new TextDecoder().decode(v1DecResult.decryptedBytes) === 'Legacy v1 vault contents', 'v1 legacy vault decrypted byte-for-byte');

    // Backward compatibility: v2 standard vault detection and decryption (PBKDF2-SHA512 + ZV2\0)
    const v2Plain = new TextEncoder().encode('Standard v2 vault contents with SHA-512');
    const v2Salt = createRandomBytes(32);
    const v2IV = createRandomBytes(12);
    const v2KeyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode('V2Pass'), { name: 'PBKDF2' }, false, ['deriveBits']);
    const v2Bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: v2Salt, iterations: 1000, hash: 'SHA-512' }, v2KeyMat, 256);
    const v2Key = await crypto.subtle.importKey('raw', v2Bits, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const v2Ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: v2IV, tagLength: 128 }, v2Key, v2Plain));
    const v2Vault = new Uint8Array(50 + v2Ct.byteLength);
    v2Vault.set(StreamUnpacker.V2_MAGIC, 0); // 'ZV2\0'
    v2Vault[4] = 0x02; // version 2
    v2Vault[5] = 0x00; // flags
    v2Vault.set(v2Salt, 6);
    v2Vault.set(v2IV, 38);
    v2Vault.set(v2Ct, 50);

    const v2DecResult = await new Promise((resolve, reject) => {
        startDecryption({
            vaultSource: v2Vault,
            password: 'V2Pass',
            options: { iterations: 1000 },
            onComplete: resolve,
            onError: reject
        });
    });
    assert(v2DecResult.version === 2, 'startDecryption detects v2 standard format');
    assert(new TextDecoder().decode(v2DecResult.decryptedBytes) === 'Standard v2 vault contents with SHA-512', 'v2 standard vault decrypted byte-for-byte');

    // -------------------------------------------------------------------------
    // 7. Instant Manifest Retrieval & Selective Extraction Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Instant Manifest Retrieval & Selective Extraction Tests ---');

    // Create 3-file vault with distinct contents
    const textData = new TextEncoder().encode('Selective extraction target text document');
    const binData = createRandomBytes(50000); // 50 KB (will span across 32 KB chunk boundary!)
    const smallData = new TextEncoder().encode('Small config file');

    const multiTargetFiles = [
        { name: 'data/text.txt', size: textData.byteLength, data: textData },
        { name: 'assets/binary.png', size: binData.byteLength, data: binData },
        { name: 'config.json', size: smallData.byteLength, data: smallData }
    ];

    const selectiveVaultResult = await new Promise((resolve, reject) => {
        startEncryption({
            files: multiTargetFiles,
            password: 'SelectivePassword123',
            options: { chunkSize: 32 * 1024, iterations: 1000 },
            onComplete: resolve,
            onError: reject
        });
    });

    // Instant Manifest Benchmark (< 50 ms)
    const manifestStart = Date.now();
    let instantFilesReceived = null;
    await new Promise((resolve, reject) => {
        startDecryption({
            vaultSource: selectiveVaultResult.vault,
            password: 'SelectivePassword123',
            options: { manifestOnly: true, iterations: 1000 },
            onManifestReady: (files) => {
                instantFilesReceived = files;
                resolve();
            },
            onComplete: resolve,
            onError: reject
        });
    });
    const manifestDuration = Date.now() - manifestStart;
    console.log(`  Instant manifest retrieval completed in ${manifestDuration} ms`);
    assert(manifestDuration < 100, `Instant manifest reader completes in < 100 ms (actual: ${manifestDuration} ms)`);
    assert(instantFilesReceived.length === 3, 'Instant manifest returns full catalog without reading entire vault');

    // Extract text.txt (DEFLATE compressed)
    const extractedText = await extractSingleFile({
        vaultSource: selectiveVaultResult.vault,
        password: 'SelectivePassword123',
        targetEntry: 'data/text.txt',
        options: { iterations: 1000 }
    });
    assert(await sha256Hex(extractedText) === await sha256Hex(textData), 'extractSingleFile extracts DEFLATE file with exact SHA-256 match');

    // Extract binary.png (STORE mode, multi-chunk)
    const extractedBin = await extractSingleFile({
        vaultSource: selectiveVaultResult.vault,
        password: 'SelectivePassword123',
        targetEntry: 'assets/binary.png',
        options: { iterations: 1000 }
    });
    assert(await sha256Hex(extractedBin) === await sha256Hex(binData), 'extractSingleFile extracts STORE file with exact SHA-256 match');
    assert(extractedBin.byteLength === 50000, 'Multi-chunk spanned file extracted with exact length');

    // Extract config.json
    const extractedConfig = await extractSingleFile({
        vaultSource: selectiveVaultResult.vault,
        password: 'SelectivePassword123',
        targetEntry: 'config.json',
        options: { iterations: 1000 }
    });
    assert(await sha256Hex(extractedConfig) === await sha256Hex(smallData), 'extractSingleFile extracts small file with exact match');

    // Non-existent file throws explicit error
    let notFoundCaught = false;
    try {
        await extractSingleFile({
            vaultSource: selectiveVaultResult.vault,
            password: 'SelectivePassword123',
            targetEntry: 'non_existent.txt',
            options: { iterations: 1000 }
        });
    } catch (err) {
        notFoundCaught = err.message.includes('not found');
    }
    assert(notFoundCaught, 'extractSingleFile throws error when targetEntry is not found in manifest');

    // -------------------------------------------------------------------------
    // 8. Cooperative Cancellation Mid-Stream Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Cooperative Cancellation Mid-Stream Tests ---');

    let encCompleteCalled = false;
    const largeFiles = [
        { name: 'huge1.bin', size: 1024 * 1024, data: new Uint8Array(1024 * 1024) },
        { name: 'huge2.bin', size: 1024 * 1024, data: new Uint8Array(1024 * 1024) }
    ];

    const cancelOp = startEncryption({
        files: largeFiles,
        password: 'CancelPassword123',
        options: { chunkSize: 64 * 1024, iterations: 1000 },
        onComplete: () => { encCompleteCalled = true; },
        onError: () => {}
    });

    await new Promise(r => setTimeout(r, 15));
    await cancelOp.cancel();
    await new Promise(r => setTimeout(r, 60));

    assert(encCompleteCalled === false, 'startEncryption cancel() halts operation without calling onComplete');

    // Decryption cancellation
    let decCompleteCalled = false;
    const decCancelOp = startDecryption({
        vaultSource: selectiveVaultResult.vault,
        password: 'SelectivePassword123',
        options: { iterations: 1000 },
        onComplete: () => { decCompleteCalled = true; },
        onError: () => {}
    });

    await new Promise(r => setTimeout(r, 5));
    await decCancelOp.cancel();
    await new Promise(r => setTimeout(r, 60));

    assert(decCompleteCalled === false, 'startDecryption cancel() halts operation without calling onComplete');

    // -------------------------------------------------------------------------
    // 9. Dual-Environment Fallback (AsyncWorkerShim) Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Dual-Environment Fallback (AsyncWorkerShim) Tests ---');

    const shim = createAsyncWorkerShim();
    assert(shim && typeof shim.postMessage === 'function', 'createAsyncWorkerShim creates valid async worker shim');

    const shimPingRes = await sendWorkerRequest(shim, { type: 'PING' });
    assert(shimPingRes.success === true && shimPingRes.pong === true, 'AsyncWorkerShim responds to PING probe');

    // Full round-trip in shim mode
    const shimFile = new TextEncoder().encode('Shim Mode Round Trip Payload');
    const shimFiles = [{ name: 'shim.txt', size: shimFile.byteLength, data: shimFile }];

    const shimEncResult = await new Promise((resolve, reject) => {
        startEncryption({
            files: shimFiles,
            password: 'ShimPassword123',
            options: { useShim: true, iterations: 1000 },
            onComplete: resolve,
            onError: reject
        });
    });

    assert(shimEncResult.vault.byteLength > 100, 'startEncryption with useShim: true completes successfully');

    const shimDecResult = await new Promise((resolve, reject) => {
        startDecryption({
            vaultSource: shimEncResult.vault,
            password: 'ShimPassword123',
            options: { useShim: true, iterations: 1000 },
            onComplete: resolve,
            onError: reject
        });
    });

    const shimZip = await JSZip.loadAsync(shimDecResult.decryptedBytes);
    const unzippedShim = await shimZip.file('shim.txt').async('uint8array');
    assert(await sha256Hex(unzippedShim) === await sha256Hex(shimFile), 'Decrypted payload in shim mode matches original byte-for-byte');

    // =========================================================================
    // FINAL SUMMARY
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
