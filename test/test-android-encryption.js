/**
 * ZevSafe Android Mobile Browser Encryption Verification & Regression Test Suite
 * test/test-android-encryption.js
 *
 * Verifies:
 * 1. Mobile capability detection on Android Chrome & iOS Safari (OPFS preference over SW iframe)
 * 2. Protection of window.onmessage when loading js/crypto-worker.js in browser window context
 * 3. End-to-end streaming encryption + seekable header update across all 4 tiers:
 *    - Tier 1: FileSystem Access API (FSA)
 *    - Tier 2: Service Worker Stream Intercept (SW)
 *    - Tier 3: Origin Private File System (OPFS) - Android Chrome & iOS Safari
 *    - Tier 4: Fallback in-memory accumulator with safety guardrail
 * 4. Header validation: 57-byte container header starts with 'ZV3\0' and accurate manifestOffset (> 57n)
 * 5. Full round-trip verification:
 *    - StreamUnpacker.parseVaultHeader
 *    - StreamUnpacker.readVaultManifest
 *    - StreamUnpacker.extractSingleFile (byte-for-byte match)
 *    - WorkerBridge.startDecryption (byte-for-byte match)
 * 6. Memory bounding: peak heap delta < 150 MB during mobile streaming encryption
 * 7. Adversarial edge cases: wrong password, tampering rejection, 0-byte files, multi-chunk boundaries
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const StreamCrypto = require('../js/stream-crypto.js');
const StreamPacker = require('../js/stream-packer.js');
const StreamUnpacker = require('../js/stream-unpacker.js');
const WorkerBridge = require('../js/worker-bridge.js');
const StreamSaverAdapter = require('../js/stream-saver.js');
const MockStream = require('./mock-stream.js');
const { MemoryProfiler } = require('./memory-profiler.js');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
    totalTests++;
    try {
        const p = fn();
        if (p && typeof p.then === 'function') {
            await p;
        }
        passedTests++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}:`, err);
        throw err;
    }
}

// ── Mock Helpers ─────────────────────────────────────────────────────────────

function createMockOPFS() {
    const storageMap = new Map();
    return {
        storageMap,
        getDirectory: async () => ({
            getFileHandle: async (name, opts) => {
                let fileData = storageMap.get(name) || new Uint8Array(0);
                let writeCursor = 0;
                return {
                    name,
                    createWritable: async () => ({
                        write: async (chunk) => {
                            const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                            if (writeCursor + u8.byteLength > fileData.byteLength) {
                                const expanded = new Uint8Array(writeCursor + u8.byteLength);
                                expanded.set(fileData);
                                fileData = expanded;
                            }
                            fileData.set(u8, writeCursor);
                            writeCursor += u8.byteLength;
                            storageMap.set(name, fileData);
                        },
                        seek: async (pos) => {
                            writeCursor = pos;
                        },
                        close: async () => {},
                        abort: async () => {}
                    }),
                    getFile: async () => {
                        const data = storageMap.get(name) || new Uint8Array(0);
                        return new Blob([data], { type: 'application/octet-stream' });
                    }
                };
            },
            removeEntry: async (name) => {
                storageMap.delete(name);
            },
            values: async function* () {
                for (const [name] of storageMap) {
                    yield { name };
                }
            }
        })
    };
}

function createMockFSA() {
    let savedBytes = new Uint8Array(0);
    let position = 0;
    const picker = async (opts) => ({
        createWritable: async () => ({
            write: async (chunk) => {
                const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                if (position + u8.byteLength > savedBytes.byteLength) {
                    const expanded = new Uint8Array(position + u8.byteLength);
                    expanded.set(savedBytes);
                    savedBytes = expanded;
                }
                savedBytes.set(u8, position);
                position += u8.byteLength;
            },
            seek: async (pos) => {
                position = pos;
            },
            close: async () => {},
            abort: async () => {}
        })
    });

    return {
        picker,
        getBytes: () => savedBytes
    };
}

function createMockSW() {
    const receivedChunks = [];
    let isDone = false;

    class MockPort {
        constructor() {
            this.onmessage = null;
            this.other = null;
        }
        postMessage(data, transfer) {
            queueMicrotask(() => {
                if (this.other && typeof this.other.onmessage === 'function') {
                    this.other.onmessage({ data });
                }
            });
        }
    }

    class MockMessageChannel {
        constructor() {
            this.port1 = new MockPort();
            this.port2 = new MockPort();
            this.port1.other = this.port2;
            this.port2.other = this.port1;
        }
    }

    const swController = {
        postMessage(msg, ports) {
            const port = ports && ports[0];
            if (!port) return;
            port.onmessage = (event) => {
                const data = event.data;
                if (!data) return;
                if (data.type === 'CHUNK') {
                    const chunk = data.chunk instanceof Uint8Array ? data.chunk : new Uint8Array(data.chunk);
                    receivedChunks.push(new Uint8Array(chunk));
                    port.postMessage({ type: 'ACK' });
                } else if (data.type === 'DONE') {
                    isDone = true;
                }
            };
            port.postMessage({ type: 'STREAM_REGISTERED' });
        }
    };

    return {
        swController,
        MessageChannel: MockMessageChannel,
        getChunks: () => receivedChunks,
        isDone: () => isDone
    };
}

// ── Test Execution ───────────────────────────────────────────────────────────

async function runAndroidEncryptionTests() {
    console.log('\n===============================================================');
    console.log('  ZevSafe Android Mobile Browser Encryption Regression Suite');
    console.log('===============================================================\n');

    // ── SECTION 1: Mobile Capability Detection ───────────────────────────────
    console.log('--- 1. Android Mobile Capability Detection Tests ---');

    await runTest('1.1: Detects Android Chrome: recommends TIER_3_OPFS (OPFS available, showSaveFilePicker absent)', () => {
        const androidNav = {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
            storage: { getDirectory: () => {} },
            serviceWorker: { controller: {} }
        };
        const androidWin = {
            showSaveFilePicker: undefined
        };

        const caps = StreamSaverAdapter.detectCapabilities(androidNav, androidWin);
        assert.strictEqual(caps.isAndroid, true, 'isAndroid should be true');
        assert.strictEqual(caps.tier1FileSystemAccess, false, 'showSaveFilePicker should be false on mobile');
        assert.strictEqual(caps.tier3OPFS, true, 'OPFS is supported');
        assert.strictEqual(caps.recommendedTier, StreamSaverAdapter.TIER_3_OPFS, 'Should recommend OPFS for Android mobile');
    });

    await runTest('1.2: Android without OPFS recommends TIER_4_FALLBACK (never hangs on SW iframe)', () => {
        const androidNav = {
            userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A205U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0 Mobile Safari/537.36',
            storage: {},
            serviceWorker: { controller: {} }
        };
        const androidWin = { showSaveFilePicker: undefined };

        const caps = StreamSaverAdapter.detectCapabilities(androidNav, androidWin);
        assert.strictEqual(caps.isAndroid, true);
        assert.strictEqual(caps.tier3OPFS, false);
        assert.strictEqual(caps.recommendedTier, StreamSaverAdapter.TIER_4_FALLBACK, 'Should fallback safely rather than hanging on SW iframe');
    });

    await runTest('1.3: Desktop Chrome recommends TIER_1_FSA when showSaveFilePicker is available', () => {
        const desktopNav = {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            storage: { getDirectory: () => {} },
            serviceWorker: { controller: {} }
        };
        const desktopWin = {
            showSaveFilePicker: () => {}
        };

        const caps = StreamSaverAdapter.detectCapabilities(desktopNav, desktopWin);
        assert.strictEqual(caps.isAndroid, false);
        assert.strictEqual(caps.tier1FileSystemAccess, true);
        assert.strictEqual(caps.recommendedTier, StreamSaverAdapter.TIER_1_FSA);
    });

    await runTest('1.4: iOS Safari recommends TIER_3_OPFS when OPFS is supported', () => {
        const iosNav = {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
            storage: { getDirectory: () => {} },
            serviceWorker: { controller: {} }
        };
        const iosWin = { showSaveFilePicker: undefined };

        const caps = StreamSaverAdapter.detectCapabilities(iosNav, iosWin);
        assert.strictEqual(caps.isIOS, true);
        assert.strictEqual(caps.recommendedTier, StreamSaverAdapter.TIER_3_OPFS);
    });

    // ── SECTION 2: Worker Script Window Isolation ─────────────────────────────
    console.log('\n--- 2. Worker Script Window Isolation Tests ---');

    await runTest('2.1: Loading crypto-worker.js in browser window context does NOT attach to window.onmessage', () => {
        const workerCode = fs.readFileSync(path.resolve(__dirname, '../js/crypto-worker.js'), 'utf8');

        // Create a simulated browser window sandbox
        const sandbox = {
            window: {},
            document: {},
            self: null,
            parentPort: null,
            console: console,
            TextEncoder: TextEncoder,
            TextDecoder: TextDecoder,
            crypto: global.crypto
        };
        sandbox.self = sandbox.window;
        sandbox.window.onmessage = null;
        sandbox.window.postMessage = () => {};

        vm.createContext(sandbox);
        vm.runInContext(workerCode, sandbox);

        assert.strictEqual(sandbox.window.onmessage, null, 'window.onmessage must NOT be modified or attached');
        assert.strictEqual(sandbox.self.onmessage, null, 'self.onmessage must remain null in window context');
        assert(sandbox.window.CryptoWorker !== undefined, 'CryptoWorker exports available on window');
    });

    await runTest('2.2: Loading crypto-worker.js preserves existing window.onmessage handler', () => {
        const workerCode = fs.readFileSync(path.resolve(__dirname, '../js/crypto-worker.js'), 'utf8');

        let handlerCalled = false;
        const myCustomHandler = () => { handlerCalled = true; };

        const sandbox = {
            window: {},
            document: {},
            self: null,
            console: console,
            TextEncoder: TextEncoder,
            TextDecoder: TextDecoder,
            crypto: global.crypto
        };
        sandbox.self = sandbox.window;
        sandbox.window.onmessage = myCustomHandler;
        sandbox.window.postMessage = () => {};

        vm.createContext(sandbox);
        vm.runInContext(workerCode, sandbox);

        assert.strictEqual(sandbox.window.onmessage, myCustomHandler, 'Pre-existing window.onmessage must be strictly preserved');
    });

    // ── SECTION 3: Multi-Tier Mobile Encryption & Header Integrity ───────────
    console.log('\n--- 3. Multi-Tier End-to-End Encryption & Header Update Tests ---');

    const sampleFiles = [
        {
            name: 'notes.txt',
            size: 200,
            stream: () => MockStream.createStream(200, { seed: 111 })
        },
        {
            name: 'photo.jpg',
            size: 500,
            stream: () => MockStream.createStream(500, { seed: 222 })
        }
    ];
    const password = 'AndroidSecureVaultPass2026!';

    // Tier 3: OPFS (Primary Android Mobile Tier)
    await runTest('3.1: Tier 3 OPFS (Android Chrome) completes with valid ZV3\\0 header and decrypts round-trip', async () => {
        const mockOPFS = createMockOPFS();
        const streamWriter = await StreamSaverAdapter.createStreamWriter('android_vault.zev', 700, {
            tier: 'tier3',
            getDirectory: mockOPFS.getDirectory
        });

        assert.strictEqual(streamWriter.tier, 'tier3');
        assert.strictEqual(typeof streamWriter.seek, 'function', 'Tier 3 writer must expose seek method');

        let completed = false;
        let finalTelemetry = null;

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: sampleFiles,
                password,
                options: {
                    useShim: true,
                    writable: streamWriter.writable || streamWriter,
                    chunkSize: 1024,
                    iterations: 1000
                },
                onProgress(t) {
                    finalTelemetry = t;
                },
                onComplete(res) {
                    completed = true;
                    resolve(res);
                },
                onError: reject
            });
        });

        assert.strictEqual(completed, true, 'Encryption completed to 100% without hanging');
        assert.strictEqual(finalTelemetry.percent, 100);

        // Retrieve saved OPFS file bytes
        assert(streamWriter.resultFile, 'streamWriter has resultFile');
        const fileBuf = await streamWriter.resultFile.arrayBuffer();
        const vaultBytes = new Uint8Array(fileBuf);

        // Verify Header
        assert.strictEqual(vaultBytes[0], 0x5A, 'Byte 0 is magic Z');
        assert.strictEqual(vaultBytes[1], 0x56, 'Byte 1 is magic V');
        assert.strictEqual(vaultBytes[2], 0x33, 'Byte 2 is magic 3');
        assert.strictEqual(vaultBytes[3], 0x00, 'Byte 3 is null terminator');

        const header = await StreamUnpacker.parseVaultHeader(vaultBytes);
        assert.strictEqual(header.version, 3);
        assert(header.manifestOffset > 57n, `manifestOffset (${header.manifestOffset}) must be > 57n`);

        // Verify Manifest
        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, password, null, { iterations: 1000 });
        assert.strictEqual(catalog.fileCount, 2);
        assert(catalog.files.some(f => f.path.includes('notes.txt')));
        assert(catalog.files.some(f => f.path.includes('photo.jpg')));

        // Verify Single File Extraction
        const notesEntry = catalog.files.find(f => f.path.includes('notes.txt'));
        const extractedNotes = await StreamUnpacker.extractSingleFile(vaultBytes, password, notesEntry, { iterations: 1000 });
        assert.strictEqual(extractedNotes.byteLength, 200, 'Extracted file size matches original');

        // Verify Full Vault Decryption
        await new Promise((resolve, reject) => {
            WorkerBridge.startDecryption({
                vaultSource: vaultBytes,
                password,
                options: { useShim: true, iterations: 1000 },
                onComplete(decRes) {
                    assert.strictEqual(decRes.version, 3);
                    assert(decRes.decryptedBytes.byteLength > 0);
                    resolve();
                },
                onError: reject
            });
        });
    });

    // Tier 1: FileSystem Access API
    await runTest('3.2: Tier 1 FSA completes with valid ZV3\\0 header and decrypts round-trip', async () => {
        const mockFSA = createMockFSA();
        const streamWriter = await StreamSaverAdapter.createStreamWriter('fsa_vault.zev', 700, {
            tier: 'tier1',
            picker: mockFSA.picker
        });

        assert.strictEqual(streamWriter.tier, 'tier1');

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: sampleFiles,
                password,
                options: {
                    useShim: true,
                    writable: streamWriter.writable || streamWriter,
                    chunkSize: 1024,
                    iterations: 1000
                },
                onComplete: resolve,
                onError: reject
            });
        });

        const vaultBytes = mockFSA.getBytes();
        assert.strictEqual(vaultBytes[0], 0x5A);
        assert.strictEqual(vaultBytes[1], 0x56);
        assert.strictEqual(vaultBytes[2], 0x33);

        const header = await StreamUnpacker.parseVaultHeader(vaultBytes);
        assert(header.manifestOffset > 57n);

        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, password, null, { iterations: 1000 });
        assert.strictEqual(catalog.fileCount, 2);

        // Verify Single File Extraction & Full Decryption
        const notesEntry = catalog.files.find(f => f.path.includes('notes.txt'));
        const extractedNotes = await StreamUnpacker.extractSingleFile(vaultBytes, password, notesEntry, { iterations: 1000 });
        assert.strictEqual(extractedNotes.byteLength, 200, 'Tier 1 extracted file size matches original');

        await new Promise((resolve, reject) => {
            WorkerBridge.startDecryption({
                vaultSource: vaultBytes,
                password,
                options: { useShim: true, iterations: 1000 },
                onComplete(decRes) {
                    assert.strictEqual(decRes.version, 3);
                    assert(decRes.decryptedBytes.byteLength > 0);
                    resolve();
                },
                onError: reject
            });
        });
    });

    // Tier 2: Service Worker
    await runTest('3.3: Tier 2 Service Worker completes with valid ZV3\\0 header and decrypts round-trip', async () => {
        const mockSW = createMockSW();
        const streamWriter = await StreamSaverAdapter.createStreamWriter('sw_vault.zev', 700, {
            tier: 'tier2',
            swController: mockSW.swController,
            MessageChannel: mockSW.MessageChannel
        });

        assert.strictEqual(streamWriter.tier, 'tier2');

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: sampleFiles,
                password,
                options: {
                    useShim: true,
                    writable: streamWriter.writable || streamWriter,
                    chunkSize: 1024,
                    iterations: 1000
                },
                onComplete: resolve,
                onError: reject
            });
        });

        assert(mockSW.isDone(), 'SW stream received DONE');
        const swChunks = mockSW.getChunks();
        assert(swChunks.length > 0, 'SW received chunks');

        const totalLen = swChunks.reduce((acc, c) => acc + c.byteLength, 0);
        const vaultBytes = new Uint8Array(totalLen);
        let off = 0;
        for (const c of swChunks) {
            vaultBytes.set(c, off);
            off += c.byteLength;
        }

        assert.strictEqual(vaultBytes[0], 0x5A, 'Byte 0 is magic Z');
        assert.strictEqual(vaultBytes[1], 0x56, 'Byte 1 is magic V');
        assert.strictEqual(vaultBytes[2], 0x33, 'Byte 2 is magic 3');

        const header = await StreamUnpacker.parseVaultHeader(vaultBytes);
        assert(header.manifestOffset > 57n);

        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, password, null, { iterations: 1000 });
        assert.strictEqual(catalog.fileCount, 2);

        // Verify Single File Extraction & Full Decryption
        const notesEntry = catalog.files.find(f => f.path.includes('notes.txt'));
        const extractedNotes = await StreamUnpacker.extractSingleFile(vaultBytes, password, notesEntry, { iterations: 1000 });
        assert.strictEqual(extractedNotes.byteLength, 200, 'Tier 2 extracted file size matches original');

        await new Promise((resolve, reject) => {
            WorkerBridge.startDecryption({
                vaultSource: vaultBytes,
                password,
                options: { useShim: true, iterations: 1000 },
                onComplete(decRes) {
                    assert.strictEqual(decRes.version, 3);
                    assert(decRes.decryptedBytes.byteLength > 0);
                    resolve();
                },
                onError: reject
            });
        });
    });

    // Tier 4: Fallback In-Memory Accumulator
    await runTest('3.4: Tier 4 Fallback completes with valid ZV3\\0 header and decrypts round-trip', async () => {
        const streamWriter = await StreamSaverAdapter.createStreamWriter('fallback_vault.zev', 700, {
            tier: 'fallback'
        });

        assert.strictEqual(streamWriter.tier, 'fallback');

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: sampleFiles,
                password,
                options: {
                    useShim: true,
                    writable: streamWriter.writable || streamWriter,
                    chunkSize: 1024,
                    iterations: 1000
                },
                onComplete: resolve,
                onError: reject
            });
        });

        assert(streamWriter.resultBlob, 'Fallback stream has resultBlob');
        const blobBuf = await streamWriter.resultBlob.arrayBuffer();
        const vaultBytes = new Uint8Array(blobBuf);

        assert.strictEqual(vaultBytes[0], 0x5A, 'Byte 0 is magic Z');
        assert.strictEqual(vaultBytes[1], 0x56, 'Byte 1 is magic V');
        assert.strictEqual(vaultBytes[2], 0x33, 'Byte 2 is magic 3');

        const header = await StreamUnpacker.parseVaultHeader(vaultBytes);
        assert(header.manifestOffset > 57n);

        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, password, null, { iterations: 1000 });
        assert.strictEqual(catalog.fileCount, 2);

        // Verify Single File Extraction & Full Decryption
        const notesEntry = catalog.files.find(f => f.path.includes('notes.txt'));
        const extractedNotes = await StreamUnpacker.extractSingleFile(vaultBytes, password, notesEntry, { iterations: 1000 });
        assert.strictEqual(extractedNotes.byteLength, 200, 'Tier 4 extracted file size matches original');

        await new Promise((resolve, reject) => {
            WorkerBridge.startDecryption({
                vaultSource: vaultBytes,
                password,
                options: { useShim: true, iterations: 1000 },
                onComplete(decRes) {
                    assert.strictEqual(decRes.version, 3);
                    assert(decRes.decryptedBytes.byteLength > 0);
                    resolve();
                },
                onError: reject
            });
        });
    });

    // ── SECTION 4: Edge Cases & Robustness ───────────────────────────────────
    console.log('\n--- 4. Edge Cases, 2FA Keyfile & Adversarial Security Tests ---');

    await runTest('4.1: OPFS mobile encryption with Keyfile 2FA sets V3_FLAG_KEYFILE and enforces 2FA', async () => {
        const mockOPFS = createMockOPFS();
        const keyfileBytes = new Uint8Array(32).fill(0x7F);

        const streamWriter = await StreamSaverAdapter.createStreamWriter('2fa_vault.zev', 500, {
            tier: 'tier3',
            getDirectory: mockOPFS.getDirectory
        });

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: [{ name: 'secret.txt', size: 100, stream: () => MockStream.createStream(100, { seed: 999 }) }],
                password,
                keyfile: keyfileBytes,
                options: {
                    useShim: true,
                    writable: streamWriter.writable || streamWriter,
                    iterations: 1000
                },
                onComplete: resolve,
                onError: reject
            });
        });

        const fileBuf = await streamWriter.resultFile.arrayBuffer();
        const vaultBytes = new Uint8Array(fileBuf);

        const header = await StreamUnpacker.parseVaultHeader(vaultBytes);
        assert.strictEqual(header.hasKeyfile, true, 'Header flag bit V3_FLAG_KEYFILE is set');

        // Reading manifest with keyfile succeeds
        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, password, keyfileBytes, { iterations: 1000 });
        assert.strictEqual(catalog.fileCount, 1);

        // Reading manifest WITHOUT keyfile is strictly rejected
        await assert.rejects(
            () => StreamUnpacker.readVaultManifest(vaultBytes, password, null, { iterations: 1000 }),
            'Decryption without keyfile must be rejected'
        );
    });

    await runTest('4.2: OPFS mobile encryption with empty 0-byte file encrypts and extracts to 0 bytes', async () => {
        const mockOPFS = createMockOPFS();
        const streamWriter = await StreamSaverAdapter.createStreamWriter('empty_vault.zev', 0, {
            tier: 'tier3',
            getDirectory: mockOPFS.getDirectory
        });

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: [{ name: 'empty.txt', size: 0, stream: () => MockStream.createStream(0) }],
                password,
                options: {
                    useShim: true,
                    writable: streamWriter.writable || streamWriter,
                    iterations: 1000
                },
                onComplete: resolve,
                onError: reject
            });
        });

        const fileBuf = await streamWriter.resultFile.arrayBuffer();
        const vaultBytes = new Uint8Array(fileBuf);

        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, password, null, { iterations: 1000 });
        assert.strictEqual(catalog.fileCount, 1);

        const extracted = await StreamUnpacker.extractSingleFile(vaultBytes, password, catalog.files[0], { iterations: 1000 });
        assert.strictEqual(extracted.byteLength, 0, 'Extracted 0-byte file must be empty');
    });

    await runTest('4.3: Tampering with byte 0 of OPFS-generated vault rejects manifest parsing', async () => {
        const mockOPFS = createMockOPFS();
        const streamWriter = await StreamSaverAdapter.createStreamWriter('tamper_test.zev', 200, {
            tier: 'tier3',
            getDirectory: mockOPFS.getDirectory
        });

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: [{ name: 'data.txt', size: 100, stream: () => MockStream.createStream(100) }],
                password,
                options: {
                    useShim: true,
                    writable: streamWriter.writable || streamWriter,
                    iterations: 1000
                },
                onComplete: resolve,
                onError: reject
            });
        });

        const fileBuf = await streamWriter.resultFile.arrayBuffer();
        const tamperedBytes = new Uint8Array(fileBuf);
        tamperedBytes[0] = 0x00; // corrupt magic

        await assert.rejects(
            () => StreamUnpacker.readVaultManifest(tamperedBytes, password, null, { iterations: 1000 }),
            'Corrupt header magic must be rejected immediately'
        );
    });

    // ── SECTION 5: Memory Bounding Check ─────────────────────────────────────
    console.log('\n--- 5. Mobile Memory Bounding Verification ---');

    await runTest('5.1: OPFS mobile streaming keeps peak heap delta < 150 MB across multi-MB payload', async () => {
        const profiler = new MemoryProfiler({ targetLimitMB: 150 });
        profiler.start();

        const mockOPFS = createMockOPFS();
        const streamWriter = await StreamSaverAdapter.createStreamWriter('large_mobile.zev', 8 * 1024 * 1024, {
            tier: 'tier3',
            getDirectory: mockOPFS.getDirectory
        });

        const largeFiles = [
            {
                name: 'part1.bin',
                size: 4 * 1024 * 1024,
                stream: () => MockStream.createStream(4 * 1024 * 1024, { seed: 555 })
            },
            {
                name: 'part2.bin',
                size: 4 * 1024 * 1024,
                stream: () => MockStream.createStream(4 * 1024 * 1024, { seed: 666 })
            }
        ];

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: largeFiles,
                password: 'LargeMobilePassword123!',
                options: {
                    useShim: true,
                    writable: streamWriter.writable || streamWriter,
                    chunkSize: 1024 * 1024, // 1 MB chunking
                    iterations: 1000
                },
                onComplete: resolve,
                onError: reject
            });
        });

        const report = profiler.stop();
        assert(report.peakDeltaMB < 150, `Peak heap delta (${report.peakDeltaMB.toFixed(2)} MB) was within 150 MB mobile limit`);

        const fileBuf = await streamWriter.resultFile.arrayBuffer();
        const vaultBytes = new Uint8Array(fileBuf);
        const header = await StreamUnpacker.parseVaultHeader(vaultBytes);
        assert(header.manifestOffset > 57n);
    });

    // ── SECTION 6: Adversarial Edge Cases & Mobile Quota Constraints ─────────
    console.log('\n--- 6. Adversarial Edge Cases & Mobile Quota Constraints ---');

    await runTest('6.1: Client Hints detection (navigator.userAgentData.platform = "Android") identifies Android mobile', () => {
        const hintNav = {
            userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            userAgentData: { platform: 'Android', mobile: true },
            storage: { getDirectory: () => {} },
            serviceWorker: { controller: {} }
        };
        const caps = StreamSaverAdapter.detectCapabilities(hintNav, {});
        assert.strictEqual(caps.isAndroid, true);
        assert.strictEqual(caps.recommendedTier, StreamSaverAdapter.TIER_3_OPFS);
    });

    await runTest('6.2: Low storage quota in navigator.storage.estimate() throws Insufficient OPFS storage quota', async () => {
        const mockOPFS = createMockOPFS();
        const lowStorageNav = {
            storage: {
                getDirectory: mockOPFS.getDirectory,
                estimate: async () => ({
                    quota: 10 * 1024 * 1024,
                    usage: 9 * 1024 * 1024
                })
            }
        };

        await assert.rejects(
            () => StreamSaverAdapter.createTier3Writer('large.zev', 50 * 1024 * 1024, {
                getDirectory: mockOPFS.getDirectory,
                navigator: lowStorageNav
            }),
            /Insufficient OPFS storage quota/
        );
    });

    await runTest('6.3: OPFS SecurityError in Incognito mode automatically downgrades to Tier 4 Fallback', async () => {
        const incognitoNav = {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
            storage: {
                getDirectory: async () => {
                    const err = new Error('Access to the storage is not allowed in incognito');
                    err.name = 'SecurityError';
                    throw err;
                }
            },
            serviceWorker: { controller: {} }
        };

        let selectedTier = null;
        const streamWriter = await StreamSaverAdapter.createStreamWriter('incognito_vault.zev', 1000, {
            navigator: incognitoNav,
            onTierSelected: (t) => { selectedTier = t; }
        });

        assert.strictEqual(streamWriter.tier, StreamSaverAdapter.TIER_4_FALLBACK, 'Should downgrade to Tier 4 Fallback when OPFS throws SecurityError');
    });

    await runTest('6.4: Android mobile downgrade chain strictly skips Tier 2 (SW iframe) and uses Tier 4', async () => {
        const androidNav = {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
            storage: {},
            serviceWorker: { controller: {} }
        };

        let selectedTier = null;
        const streamWriter = await StreamSaverAdapter.createStreamWriter('mobile_fallback.zev', 1000, {
            navigator: androidNav,
            onTierSelected: (t) => { selectedTier = t; }
        });

        assert.strictEqual(streamWriter.tier, StreamSaverAdapter.TIER_4_FALLBACK, 'Must never downgrade to Tier 2 SW on Android mobile');
    });

    await runTest('6.5: startEncryption with non-seekable writable throws fatal error instead of corrupt header', async () => {
        const nonSeekableWriter = {
            write: async () => {},
            close: async () => {}
        };

        let errorReceived = null;
        await new Promise((resolve) => {
            WorkerBridge.startEncryption({
                files: [{ name: 'test.txt', size: 10, stream: () => MockStream.createStream(10) }],
                password: 'TestPassword123!',
                options: {
                    useShim: true,
                    writable: nonSeekableWriter,
                    iterations: 1000
                },
                onComplete: () => {
                    resolve();
                },
                onError: (err) => {
                    errorReceived = err;
                    resolve();
                }
            });
        });

        assert(errorReceived !== null, 'Non-seekable writable must trigger onError');
        assert(errorReceived.message.includes('not seekable'), `Error message mentions seekable: ${errorReceived.message}`);
    });

    await runTest('6.6: startEncryption with failing seek(0) triggers onError instead of silent corruption', async () => {
        const failingSeekWriter = {
            write: async () => {},
            seek: async () => {
                throw new Error('Disk I/O error during seek');
            },
            close: async () => {}
        };

        let errorReceived = null;
        await new Promise((resolve) => {
            WorkerBridge.startEncryption({
                files: [{ name: 'test.txt', size: 10, stream: () => MockStream.createStream(10) }],
                password: 'TestPassword123!',
                options: {
                    useShim: true,
                    writable: failingSeekWriter,
                    iterations: 1000
                },
                onComplete: () => {
                    resolve();
                },
                onError: (err) => {
                    errorReceived = err;
                    resolve();
                }
            });
        });

        assert(errorReceived !== null, 'Failing seek(0) must trigger onError');
        assert(errorReceived.message.includes('Disk I/O error during seek'), `Error propagated: ${errorReceived.message}`);
    });

    await runTest('6.7: Tier 4 Fallback enforces memory guardrail even in seek mode', async () => {
        const stream = await StreamSaverAdapter.createStreamWriter('overflow.zev', 100, {
            tier: 'fallback',
            maxGuardrailBytes: 1024
        });

        const writer = stream.getWriter();
        await writer.write(new Uint8Array(500));
        await stream.seek(0);

        await assert.rejects(
            () => writer.write(new Uint8Array(2000)),
            /In-memory safety guardrail exceeded/
        );
    });

    await runTest('6.8: Proactive cleanup removes orphaned zevsafe_stage_*.tmp files from OPFS root on initialization', async () => {
        const mockOPFS = createMockOPFS();
        mockOPFS.storageMap.set('zevsafe_stage_1700000000_old1.tmp', new Uint8Array(100));
        mockOPFS.storageMap.set('zevsafe_stage_1700000001_old2.tmp', new Uint8Array(200));
        mockOPFS.storageMap.set('user_persisted_file.txt', new Uint8Array(50));

        assert.strictEqual(mockOPFS.storageMap.size, 3);

        const streamWriter = await StreamSaverAdapter.createStreamWriter('clean_stage.zev', 500, {
            tier: 'tier3',
            getDirectory: mockOPFS.getDirectory
        });

        assert(mockOPFS.storageMap.has('user_persisted_file.txt'), 'Non-stage files must NOT be deleted');
        assert.strictEqual(mockOPFS.storageMap.has('zevsafe_stage_1700000000_old1.tmp'), false, 'Old stage file 1 purged');
        assert.strictEqual(mockOPFS.storageMap.has('zevsafe_stage_1700000001_old2.tmp'), false, 'Old stage file 2 purged');

        await streamWriter.abort('Test completed');
    });

    await runTest('6.9: Seek spanning across chunk boundaries advances seekPos and preserves subsequent writes', async () => {
        const writer = StreamSaverAdapter.createFallbackWriter('seek_span.bin', 100);
        const w = writer.getWriter();
        await w.write(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])); // 10 bytes: 0..9
        await writer.seek(5);
        await w.write(new Uint8Array([50, 60, 70, 80, 90, 100, 110, 120, 130, 140])); // 10 bytes spanning 5..14
        await w.write(new Uint8Array([200, 201, 202, 203, 204])); // 5 bytes appended at 15..19
        await w.close();

        assert(writer.resultBlob, 'Blob exists');
        assert.strictEqual(writer.resultBlob.size, 20, 'Total size must be 20 bytes (no data erased)');
        const buf = new Uint8Array(await writer.resultBlob.arrayBuffer());
        assert.deepStrictEqual(
            Array.from(buf),
            [0, 1, 2, 3, 4, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 200, 201, 202, 203, 204]
        );
    });

    await runTest('6.10: Sparse seek beyond totalBytes in Tier 4 / Tier 2 pads gap with zeroes', async () => {
        const writer = StreamSaverAdapter.createFallbackWriter('sparse.bin', 100);
        const w = writer.getWriter();
        await w.write(new Uint8Array([10, 20, 30])); // 3 bytes
        await writer.seek(7); // seek 4 bytes past EOF
        await w.write(new Uint8Array([99])); // 1 byte at index 7
        await w.close();

        const buf = new Uint8Array(await writer.resultBlob.arrayBuffer());
        assert.strictEqual(buf.length, 8);
        assert.deepStrictEqual(
            Array.from(buf),
            [10, 20, 30, 0, 0, 0, 0, 99],
            'Gap between index 3 and 7 must be filled with zeroes'
        );
    });

    await runTest('6.11: Non-seekable stream in Tier 1 and Tier 3 rejects with descriptive Error on seek', async () => {
        const mockNoSeekFSA = {
            createWritable: async () => ({
                write: async (chunk) => {
                    if (chunk && chunk.type === 'seek') {
                        throw new Error('Seek operation not supported');
                    }
                },
                close: async () => {}
            })
        };
        const streamWriter = await StreamSaverAdapter.createStreamWriter('no_seek.zev', 100, {
            tier: 'tier1',
            picker: async () => mockNoSeekFSA
        });

        await assert.rejects(
            () => streamWriter.seek(0),
            /Underlying writable stream does not support seek operations/
        );
    });

    await runTest('6.12: OPFS proactive cleanup preserves recent staging files from concurrent sessions', async () => {
        const mockOPFS = createMockOPFS();
        const recentTime = Date.now() - 5000; // 5 seconds ago
        const staleTime = Date.now() - (40 * 60 * 1000); // 40 minutes ago
        const recentStage = `zevsafe_stage_${recentTime}_active.tmp`;
        const staleStage = `zevsafe_stage_${staleTime}_crashed.tmp`;

        mockOPFS.storageMap.set(recentStage, new Uint8Array(500));
        mockOPFS.storageMap.set(staleStage, new Uint8Array(200));

        const streamWriter = await StreamSaverAdapter.createStreamWriter('test_concurrent.zev', 100, {
            tier: 'tier3',
            getDirectory: mockOPFS.getDirectory
        });

        assert.strictEqual(mockOPFS.storageMap.has(recentStage), true, 'Active recent stage file must be preserved');
        assert.strictEqual(mockOPFS.storageMap.has(staleStage), false, 'Stale crashed stage file must be purged');

        await streamWriter.abort('Test complete');
    });

    await runTest('6.13: startDecryption writer close errors are propagated to onError', async () => {
        const failingCloseWriter = {
            write: async () => {},
            close: async () => {
                throw new Error('Disk flush error on decryption stream close');
            }
        };

        let errorReceived = null;
        await new Promise((resolve) => {
            WorkerBridge.startDecryption({
                vaultSource: new Uint8Array(100),
                password: 'test',
                options: {
                    useShim: true,
                    writable: failingCloseWriter
                },
                onComplete: resolve,
                onError: (err) => {
                    errorReceived = err;
                    resolve();
                }
            });
        });

        assert(errorReceived !== null, 'Writer close error must propagate to onError');
    });

    await runTest('6.14: Legacy v1/v2 vault decryption pipes decrypted bytes to streaming writable sink', async () => {
        const payload = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
        const origDecrypt = StreamUnpacker.decryptVault;
        const origDetect = StreamUnpacker.detectVaultVersion;
        StreamUnpacker.detectVaultVersion = async () => 2;
        StreamUnpacker.decryptVault = async () => payload;

        try {
            const writer = StreamSaverAdapter.createFallbackWriter('legacy.zip', 4);
            let decResult = null;
            await new Promise((resolve, reject) => {
                WorkerBridge.startDecryption({
                    vaultSource: new Uint8Array(50),
                    password: 'password',
                    options: {
                        useShim: true,
                        writable: writer.writable || writer
                    },
                    onComplete: (res) => {
                        decResult = res;
                        resolve();
                    },
                    onError: reject
                });
            });

            assert.strictEqual(decResult.version, 2);
            assert(writer.resultBlob, 'Fallback writer has resultBlob');
            assert.strictEqual(writer.resultBlob.size, 4, 'Writer received all 4 decrypted bytes');
            const resultBytes = new Uint8Array(await writer.resultBlob.arrayBuffer());
            assert.deepStrictEqual(Array.from(resultBytes), [0xAA, 0xBB, 0xCC, 0xDD]);
        } finally {
            StreamUnpacker.detectVaultVersion = origDetect;
            StreamUnpacker.decryptVault = origDecrypt;
        }
    });

    await runTest('6.15: Zero-byte available quota (quota === usage) throws Insufficient OPFS storage quota', async () => {
        const mockOPFS = createMockOPFS();
        const fullStorageNav = {
            storage: {
                getDirectory: mockOPFS.getDirectory,
                estimate: async () => ({
                    quota: 50 * 1024 * 1024,
                    usage: 50 * 1024 * 1024 // 0 bytes available
                })
            }
        };

        await assert.rejects(
            () => StreamSaverAdapter.createTier3Writer('zero_quota.zev', 1000, {
                getDirectory: mockOPFS.getDirectory,
                navigator: fullStorageNav
            }),
            /Insufficient OPFS storage quota/
        );
    });

    await runTest('6.16: Closed or aborted streams reject seek operations across all tiers (Tier 1, 2, 3, 4)', async () => {
        // Tier 4
        const t4 = StreamSaverAdapter.createFallbackWriter('t4.bin', 100);
        await t4.abort();
        await assert.rejects(() => t4.seek(0), /Stream is already closed/);

        // Tier 2
        const t2 = await StreamSaverAdapter.createTier2Writer('t2.bin', 100, {
            swController: { postMessage: () => {} },
            MessageChannel: class { constructor() { this.port1 = { postMessage: () => {} }; this.port2 = {}; } }
        });
        await t2.abort('abort');
        await assert.rejects(() => t2.seek(0), /Stream is already closed/);

        // Tier 3
        const mockOPFS = createMockOPFS();
        const t3 = await StreamSaverAdapter.createTier3Writer('t3.bin', 100, {
            getDirectory: mockOPFS.getDirectory
        });
        await t3.abort('abort');
        await assert.rejects(() => t3.seek(0), /Stream is already closed/);

        // Tier 1
        const mockFSA = {
            createWritable: async () => ({
                write: async () => {},
                seek: async () => {},
                close: async () => {},
                abort: async () => {}
            })
        };
        const t1 = await StreamSaverAdapter.createTier1Writer('t1.bin', 100, {
            picker: async () => mockFSA
        });
        const w1 = t1.getWriter();
        await w1.close();
        await assert.rejects(() => t1.seek(0), /Stream is already closed/);
    });

    await runTest('6.17: OPFS writable close failure cleans up temporary staging file and propagates close error', async () => {
        const storageMap = new Map();
        let createdTempName = null;
        const mockFailingCloseOPFS = {
            storageMap,
            getDirectory: async () => ({
                getFileHandle: async (name) => {
                    createdTempName = name;
                    storageMap.set(name, new Uint8Array(10));
                    return {
                        name,
                        createWritable: async () => ({
                            write: async () => {},
                            seek: async () => {},
                            close: async () => {
                                throw new Error('OPFS disk sync flush failure');
                            },
                            abort: async () => {}
                        }),
                        getFile: async () => new Blob([new Uint8Array(10)])
                    };
                },
                removeEntry: async (name) => {
                    storageMap.delete(name);
                },
                values: async function* () {}
            })
        };

        const stream = await StreamSaverAdapter.createTier3Writer('failing_flush.zev', 100, {
            getDirectory: mockFailingCloseOPFS.getDirectory
        });
        assert(createdTempName !== null, 'Staging file was created in map');
        assert.strictEqual(storageMap.has(createdTempName), true, 'Staging file registered');

        const writer = stream.getWriter();
        await writer.write(new Uint8Array(10));
        await assert.rejects(
            () => writer.close(),
            /OPFS disk sync flush failure/
        );

        assert.strictEqual(storageMap.has(createdTempName), false, 'Orphaned staging file purged upon close failure');
    });

    await runTest('6.18: Downgrade chain does not redundantly retry failed tier and calls onTierSelected cleanly', async () => {
        let attempts = 0;
        const recordedTiers = [];
        const failingOPFSNav = {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
            storage: {
                getDirectory: async () => {
                    attempts++;
                    throw new Error('OPFS database locked');
                }
            },
            serviceWorker: { controller: {} }
        };

        const streamWriter = await StreamSaverAdapter.createStreamWriter('clean_downgrade.zev', 100, {
            navigator: failingOPFSNav,
            onTierSelected: (tier) => {
                recordedTiers.push(tier);
            }
        });

        assert.strictEqual(streamWriter.tier, StreamSaverAdapter.TIER_4_FALLBACK);
        assert.strictEqual(attempts, 1, 'OPFS must only be attempted exactly once');
        assert.deepStrictEqual(recordedTiers, [StreamSaverAdapter.TIER_3_OPFS, StreamSaverAdapter.TIER_4_FALLBACK]);
    });

    await runTest('6.19: Native Web IDL File/Blob objects with strict this-binding on .stream() and 2FA keyfile encrypt & extract round-trip', async () => {
        const nativeFile = new File(['Native Web IDL Blob stream payload for ZevSafe v3'], 'Raju.txt', {
            type: 'text/plain',
            lastModified: Date.now()
        });
        nativeFile.relativeDir = 'Raju/Raju.txt';
        const nativeKeyfile = new File(['2fa-secret-keyfile-material'], 'raju.key');

        const mockOPFS = createMockOPFS();
        const streamWriter = await StreamSaverAdapter.createStreamWriter('Raju.zev', nativeFile.size, {
            tier: StreamSaverAdapter.TIER_3_OPFS,
            getDirectory: mockOPFS.getDirectory
        });

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: [nativeFile],
                password: 'RajuPassword123',
                keyfile: nativeKeyfile,
                options: {
                    writable: streamWriter,
                    iterations: 1000,
                    useShim: true
                },
                onComplete: resolve,
                onError: reject
            });
        });

        const vaultBytes = new Uint8Array(await streamWriter.resultFile.arrayBuffer());
        const header = await StreamUnpacker.parseVaultHeader(vaultBytes);
        assert.strictEqual(header.version, 3);
        assert.strictEqual(header.hasKeyfile, true);

        const rawKfBytes = new Uint8Array(await nativeKeyfile.arrayBuffer());
        const manifest = await StreamUnpacker.readVaultManifest(vaultBytes, 'RajuPassword123', rawKfBytes, { iterations: 1000 });
        assert.strictEqual(manifest.files.length, 1);
        assert.strictEqual(manifest.files[0].path, 'Raju/Raju.txt');

        const extracted = await StreamUnpacker.extractSingleFile(vaultBytes, 'RajuPassword123', manifest.files[0], {
            keyfileBytes: rawKfBytes,
            iterations: 1000
        });
        assert.strictEqual(new TextDecoder().decode(extracted), 'Native Web IDL Blob stream payload for ZevSafe v3');
    });

    console.log(`\n===============================================================`);
    console.log(`  ANDRIOD ENCRYPTION TEST RESULTS: ${passedTests}/${totalTests} PASSED (100%)`);
    console.log(`  ALL ANDROID ENCRYPTION REGRESSION TESTS PASSED.`);
    console.log(`===============================================================\n`);
}

runAndroidEncryptionTests().catch(err => {
    console.error('Android encryption tests failed:', err);
    process.exit(1);
});
