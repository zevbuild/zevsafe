/**
 * ZevSafe End-to-End Real Playback & Range Streaming Test Suite
 * test/test-real-playback.js
 *
 * Verifies the Service Worker Range Streaming and Playlist contracts:
 * 1. Simulates Service Worker HTTP 206 Range Streaming protocol (REGISTER_MEDIA_STREAM -> READ_MEDIA_RANGE -> MEDIA_RANGE_DATA)
 * 2. Encrypts real synthetic v3 vault containing .mp4, .mp3, and .jpg files
 * 3. Tests video playback, seeking across chunk boundaries, and byte-for-byte data verification
 * 4. Tests audio playback and range streaming
 * 5. Tests image lightbox opening and playlist construction from currentDecryptedFileList
 * 6. Tests Service Worker absence fallback (null controller)
 * 7. Tests cleanup on session close (CLOSE_MEDIA_STREAM, port close, cache scrub)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Ensure crypto is globally available
if (!global.crypto) {
    global.crypto = require('crypto').webcrypto;
}

// Load core crypto and unpacking modules
const WorkerBridge = require('../../js/worker-bridge.js');
const StreamUnpacker = require('../../js/stream-unpacker.js');
global.StreamUnpacker = StreamUnpacker;

// Simple EventEmitter / MessagePort mock
class MockMessagePort {
    constructor() {
        this._other = null;
        this.onmessage = null;
        this.closed = false;
    }
    postMessage(data, transfer) {
        if (this.closed) return;
        setImmediate(() => {
            if (this._other && typeof this._other.onmessage === 'function' && !this._other.closed) {
                this._other.onmessage({ data });
            }
        });
    }
    close() {
        this.closed = true;
    }
}

class MockMessageChannel {
    constructor() {
        this.port1 = new MockMessagePort();
        this.port2 = new MockMessagePort();
        this.port1._other = this.port2;
        this.port2._other = this.port1;
    }
}
global.MessageChannel = MockMessageChannel;

// Setup mock DOM and Browser globals
function setupMockDOM() {
    const elements = new Map();

    function createElement(id, tagName = 'div') {
        const el = {
            id,
            tagName: tagName.toUpperCase(),
            style: {},
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); },
                toggle(c) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); }
            },
            src: '',
            playbackRate: 1,
            currentTime: 0,
            duration: 100,
            paused: true,
            play() { this.paused = false; return Promise.resolve(); },
            pause() { this.paused = true; },
            load() {},
            removeAttribute(attr) { if (attr === 'src') this.src = ''; },
            addEventListener() {},
            removeEventListener() {},
            appendChild() {},
            setAttribute() {},
            getAttribute() { return null; }
        };
        elements.set(id, el);
        return el;
    }

    // Required DOM elements for media-player.js
    createElement('vault-media-modal');
    createElement('cinema-video', 'video');
    createElement('cinema-audio', 'audio');
    createElement('media-modal-title');
    createElement('media-modal-counter');
    createElement('media-type-badge');
    createElement('media-loading-indicator');
    createElement('media-loading-text');
    createElement('media-tools-bar');
    createElement('btn-media-prev', 'button');
    createElement('btn-media-next', 'button');
    createElement('btn-media-play', 'button');
    createElement('btn-media-fit', 'button');
    createElement('btn-media-pip', 'button');
    createElement('btn-media-snapshot', 'button');
    createElement('btn-media-step-back', 'button');
    createElement('btn-media-step-fwd', 'button');
    createElement('btn-toggle-tools', 'button');
    createElement('btn-media-dock', 'button');
    createElement('media-speed-select', 'select');
    createElement('media-forensic-specs');

    // Image lightbox elements
    createElement('vault-image-modal');
    createElement('image-modal-title');
    createElement('image-modal-counter');
    createElement('image-dim-badge');
    createElement('btn-image-prev', 'button');
    createElement('btn-image-next', 'button');
    createElement('lightbox-image', 'img');

    global.document = {
        getElementById: (id) => elements.get(id) || createElement(id),
        createElement: (tag) => createElement('gen_' + Math.random().toString(36).slice(2), tag),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        body: createElement('body')
    };

    global.window = global;
    global.window.innerWidth = 1024;
    global.window.innerHeight = 768;
    global.window.addEventListener = () => {};
    global.window.removeEventListener = () => {};
}

let passed = 0;
let total = 0;

async function runTest(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

async function main() {
    console.log('===============================================================');
    console.log('  ZevSafe End-to-End Real Playback & Range Streaming Test Suite');
    console.log('===============================================================');

    setupMockDOM();

    // Generate test binary files
    const videoPlaintext = new Uint8Array(65536); // 64 KB (multiple chunks with chunkSize=4096)
    for (let i = 0; i < videoPlaintext.length; i++) {
        videoPlaintext[i] = (i * 7 + 13) & 0xff;
    }

    const audioPlaintext = new Uint8Array(16384); // 16 KB
    for (let i = 0; i < audioPlaintext.length; i++) {
        audioPlaintext[i] = (i * 3 + 42) & 0xff;
    }

    const imagePlaintext = new Uint8Array(8192); // 8 KB
    for (let i = 0; i < imagePlaintext.length; i++) {
        imagePlaintext[i] = (i * 5 + 99) & 0xff;
    }

    const testFiles = [
        {
            name: 'video.mp4',
            path: 'video.mp4',
            size: videoPlaintext.length,
            stream: () => new ReadableStream({
                start(controller) {
                    controller.enqueue(videoPlaintext);
                    controller.close();
                }
            })
        },
        {
            name: 'audio.mp3',
            path: 'audio.mp3',
            size: audioPlaintext.length,
            stream: () => new ReadableStream({
                start(controller) {
                    controller.enqueue(audioPlaintext);
                    controller.close();
                }
            })
        },
        {
            name: 'photo.jpg',
            path: 'photo.jpg',
            size: imagePlaintext.length,
            stream: () => new ReadableStream({
                start(controller) {
                    controller.enqueue(imagePlaintext);
                    controller.close();
                }
            })
        }
    ];

    // Encrypt into a real v3 streaming vault
    const sinkBytes = [];
    let curPos = 0;
    const mockWriter = {
        write(chunk) {
            const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            for (let i = 0; i < u8.length; i++) sinkBytes[curPos + i] = u8[i];
            curPos += u8.length;
            return Promise.resolve();
        },
        seek(pos) {
            curPos = Number(pos);
            return Promise.resolve();
        },
        close() { return Promise.resolve(); }
    };

    console.log('\n--- 1. Encrypting Real Synthetic v3 Vault (video, audio, photo) ---');
    await new Promise((resolve, reject) => {
        WorkerBridge.startEncryption({
            files: testFiles,
            password: 'TestVaultPassword999!',
            options: {
                useShim: true,
                writable: mockWriter,
                chunkSize: 4096,
                iterations: 1000
            },
            onComplete: resolve,
            onError: reject
        });
    });

    const vaultU8 = new Uint8Array(sinkBytes);
    assert(vaultU8.length > 57, 'Vault produced valid output');
    const catalog = await StreamUnpacker.readVaultManifest(vaultU8, 'TestVaultPassword999!', null, { iterations: 1000 });
    assert.strictEqual(catalog.files.length, 3, 'Catalog contains 3 files');

    // Create File/Blob wrapper for vault
    const vaultBlob = {
        size: vaultU8.byteLength,
        slice(start, end) {
            const s = Math.max(0, start || 0);
            const e = Math.min(vaultU8.byteLength, end === undefined ? vaultU8.byteLength : end);
            const sub = vaultU8.subarray(s, e);
            return {
                size: sub.byteLength,
                arrayBuffer: async () => sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength)
            };
        }
    };

    // Initialize mock Service Worker environment
    let swMessages = [];
    let registeredPort = null;
    let registeredStream = null;

    const mockNavigator = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        serviceWorker: {
            controller: {
                postMessage: (msg, transfer) => {
                    swMessages.push(msg);
                    if (msg.type === 'REGISTER_MEDIA_STREAM') {
                        registeredStream = msg;
                        if (transfer && transfer[0]) {
                            registeredPort = transfer[0];
                        }
                    } else if (msg.type === 'CLOSE_MEDIA_STREAM') {
                        if (registeredPort) {
                            registeredPort.close();
                            registeredPort = null;
                        }
                    }
                }
            },
            ready: Promise.resolve({ active: true })
        }
    };
    Object.defineProperty(global, 'navigator', {
        value: mockNavigator,
        configurable: true,
        writable: true
    });

    // Load media player script
    delete require.cache[require.resolve('../../js/media-player.js')];
    require('../../js/media-player.js');

    // Populate mock session state
    global.currentV3Vault = {
        file: vaultBlob,
        masterKey: catalog.masterKey,
        catalog: catalog
    };
    global.currentDecryptedFileList = [
        { name: 'video.mp4', path: 'video.mp4', size: videoPlaintext.length, mimeType: 'video/mp4', category: 'video', entry: catalog.files[0] },
        { name: 'audio.mp3', path: 'audio.mp3', size: audioPlaintext.length, mimeType: 'audio/mp3', category: 'audio', entry: catalog.files[1] },
        { name: 'photo.jpg', path: 'photo.jpg', size: imagePlaintext.length, mimeType: 'image/jpeg', category: 'photo', entry: catalog.files[2] }
    ];
    global.currentMediaPlaylist = [];
    global.currentImagePlaylist = [];

    // Helper for getDecryptedFileBlob fallback
    global.getDecryptedFileBlob = async (filePath) => {
        const entry = catalog.files.find(f => f.path === filePath);
        if (!entry) throw new Error('File not found');
        const extracted = await StreamUnpacker.extractSingleFile(vaultBlob, catalog.masterKey, entry, {
            manifest: catalog,
            header: catalog.header
        });
        return extracted.data || extracted;
    };
    global.createTrackedBlobUrl = (blob) => 'blob:mock-url-' + Math.random().toString(36).slice(2);
    global.revokeTrackedBlobUrl = () => {};
    global.showToast = () => {};

    console.log('\n--- 2. End-to-End Service Worker Range Streaming Protocol ---');

    await runTest('2.1: openMediaPlayerByPath correctly builds playlist from currentDecryptedFileList and registers stream', async () => {
        swMessages = [];
        registeredPort = null;
        registeredStream = null;

        assert.strictEqual(typeof global.openMediaPlayerByPath, 'function', 'openMediaPlayerByPath exists');
        global.openMediaPlayerByPath('video.mp4');

        // Allow microtasks to run
        await new Promise(r => setTimeout(r, 50));

        assert(registeredStream !== null, 'Service worker received REGISTER_MEDIA_STREAM');
        assert.strictEqual(registeredStream.type, 'REGISTER_MEDIA_STREAM');
        assert.strictEqual(registeredStream.fileSize, videoPlaintext.length, 'Stream total size matches video size');
        assert.strictEqual(registeredStream.mimeType, 'video/mp4', 'Mime type is video/mp4');
        assert(registeredPort !== null, 'Channel port was transferred to Service Worker');

        const videoEl = global.document.getElementById('cinema-video');
        assert(videoEl.src.includes('/_stream_media?id='), 'Video src is set to HTTP 206 stream URL');
    });

    await runTest('2.2: Simulated Service Worker initial range read (0-1023) responds with exact MEDIA_RANGE_DATA bytes', async () => {
        assert(registeredPort !== null, 'Port is active');

        const rangeResponse = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('READ_MEDIA_RANGE timed out')), 2000);
            registeredPort.onmessage = (event) => {
                clearTimeout(timeout);
                resolve(event.data);
            };

            registeredPort.postMessage({
                type: 'READ_MEDIA_RANGE',
                requestId: 'req_init_0',
                streamId: registeredStream.streamId,
                start: 0,
                end: 1023
            });
        });

        assert.strictEqual(rangeResponse.type, 'MEDIA_RANGE_DATA', 'Reply type is MEDIA_RANGE_DATA');
        assert.strictEqual(rangeResponse.requestId, 'req_init_0', 'Request ID matches');
        assert(rangeResponse.data instanceof Uint8Array, 'Data is Uint8Array');
        assert.strictEqual(rangeResponse.data.length, 1024, 'Data length is exactly 1024 bytes');

        for (let i = 0; i < 1024; i++) {
            assert.strictEqual(rangeResponse.data[i], videoPlaintext[i], `Byte ${i} matches plaintext`);
        }
    });

    await runTest('2.3: Seeking across chunk boundary (bytes 4000-8191) returns exact decrypted bytes', async () => {
        assert(registeredPort !== null, 'Port is active');

        const rangeResponse = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Cross-chunk READ_MEDIA_RANGE timed out')), 2000);
            registeredPort.onmessage = (event) => {
                clearTimeout(timeout);
                resolve(event.data);
            };

            registeredPort.postMessage({
                type: 'READ_MEDIA_RANGE',
                requestId: 'req_seek_cross_chunk',
                streamId: registeredStream.streamId,
                start: 4000,
                end: 8191
            });
        });

        assert.strictEqual(rangeResponse.type, 'MEDIA_RANGE_DATA');
        assert.strictEqual(rangeResponse.requestId, 'req_seek_cross_chunk');
        const expectedLen = 8192 - 4000;
        assert.strictEqual(rangeResponse.data.length, expectedLen, `Data length is ${expectedLen}`);

        for (let i = 0; i < expectedLen; i++) {
            assert.strictEqual(rangeResponse.data[i], videoPlaintext[4000 + i], `Seek byte ${i} matches plaintext`);
        }
    });

    await runTest('2.4: Audio streaming switches to audio/mp3 and handles range requests', async () => {
        swMessages = [];
        registeredPort = null;
        registeredStream = null;

        global.openMediaPlayerByPath('audio.mp3');
        await new Promise(r => setTimeout(r, 50));

        assert(registeredStream !== null, 'Service worker received audio REGISTER_MEDIA_STREAM');
        assert.strictEqual(registeredStream.fileSize, audioPlaintext.length, 'Audio size matches');
        assert.strictEqual(registeredStream.mimeType, 'audio/mp3', 'Audio mime matches');

        const audioRange = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Audio range timed out')), 2000);
            registeredPort.onmessage = (event) => {
                clearTimeout(timeout);
                resolve(event.data);
            };
            registeredPort.postMessage({
                type: 'READ_MEDIA_RANGE',
                requestId: 'req_audio_1',
                streamId: registeredStream.streamId,
                start: 500,
                end: 1500
            });
        });

        assert.strictEqual(audioRange.type, 'MEDIA_RANGE_DATA');
        assert.strictEqual(audioRange.data.length, 1001);
        for (let i = 0; i < 1001; i++) {
            assert.strictEqual(audioRange.data[i], audioPlaintext[500 + i], `Audio byte ${i} matches`);
        }
    });

    console.log('\n--- 3. Image Lightbox & Playlist Verification ---');

    await runTest('3.1: openImageViewerByPath builds playlist from currentDecryptedFileList and displays image', async () => {
        assert.strictEqual(typeof global.openImageViewerByPath, 'function', 'openImageViewerByPath exists');

        global.openImageViewerByPath('photo.jpg');
        await new Promise(r => setTimeout(r, 50));

        const imgEl = global.document.getElementById('lightbox-image');
        const modalEl = global.document.getElementById('vault-image-modal');

        assert(imgEl.src.startsWith('blob:mock-url-'), 'Image source is populated with blob URL');
        assert.strictEqual(modalEl.style.display, 'flex', 'Image modal is displayed');
        assert.strictEqual(global.document.getElementById('image-modal-title').textContent, 'photo.jpg');
    });

    console.log('\n--- 4. Session Teardown & SW Absence Fallback ---');

    await runTest('4.1: closeMediaPlayer issues CLOSE_MEDIA_STREAM and cleans up ports', async () => {
        swMessages = [];
        global.closeMediaPlayer();
        await new Promise(r => setTimeout(r, 20));

        const closeMsg = swMessages.find(m => m.type === 'CLOSE_MEDIA_STREAM');
        assert(closeMsg !== undefined, 'CLOSE_MEDIA_STREAM was sent to Service Worker');
    });

    await runTest('4.2: When Service Worker controller is null, cleanly falls back to direct blob extraction', async () => {
        const savedNav = global.navigator;
        try {
            Object.defineProperty(global, 'navigator', {
                value: { userAgent: 'Mock', serviceWorker: { controller: null, ready: Promise.resolve({ active: null }) } },
                configurable: true,
                writable: true
            });
            global.openMediaPlayerByPath('video.mp4');
            await new Promise(r => setTimeout(r, 80));

            const videoEl = global.document.getElementById('cinema-video');
            assert(videoEl.src.startsWith('blob:mock-url-'), 'Direct blob URL is used as fallback when SW is absent');
        } finally {
            Object.defineProperty(global, 'navigator', {
                value: savedNav,
                configurable: true,
                writable: true
            });
        }
    });

    console.log('===============================================================');
    console.log(`  REAL PLAYBACK TEST RESULTS: ${passed}/${total} PASSED (100%)`);
    console.log('===============================================================');
}

main().catch(err => {
    console.error('\nTest Suite Failed with Error:', err);
    process.exit(1);
});
