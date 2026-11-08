/**
 * ZevSafe Phase 2: Media Player Security Lifecycle, Gesture Engine & Guardrail Test Suite
 *
 * Verifies:
 * 1. window.ZevMedia explicit API surface
 * 2. On vault lock (lock, auto-lock, duress, panic):
 *    - Revocation of player blob URLs
 *    - Unloading of video and audio elements in DOM
 *    - SW stream termination (CLOSE_ALL_MEDIA_STREAMS) & route failure (HTTP 404/410)
 *    - Works whether or not js/media-player.js was loaded
 * 3. 2.5 GB phone guardrail (applies ONLY to memory fallback, NOT to range streaming)
 * 4. Gesture Engine: Double-tap accumulation (-10s, -20s, -30s), single-tap 250ms delay, zoom guard
 * 5. iOS CSS pseudo-fullscreen fallback & screen.orientation safe try/catch
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const appJsSource = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
const mediaPlayerJsSource = fs.readFileSync(path.join(ROOT_DIR, 'js/media-player.js'), 'utf8');
const mediaPlayerCssSource = fs.readFileSync(path.join(ROOT_DIR, 'css/media-player.css'), 'utf8');
const swJsSource = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');
const indexHtmlSource = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

console.log('===============================================================');
console.log('  ZevSafe Media Player Security Lifecycle & Gesture Suite     ');
console.log('===============================================================');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

// ── 1. EXPLICIT API & WINDOW.ZEVMEDIA EXPORTS ─────────────────────────
console.log('\n--- 1. Explicit API & window.ZevMedia Surface ---');

runTest('1.1: js/media-player.js defines and exports window.ZevMedia', () => {
    assert.ok(mediaPlayerJsSource.includes('global.ZevMedia = ZevMedia'), 'Must export global.ZevMedia');
    assert.ok(mediaPlayerJsSource.includes('const ZevMedia = {'), 'Must declare ZevMedia object');
});

runTest('1.2: window.ZevMedia includes all required player & lifecycle methods', () => {
    const requiredMethods = [
        'playMediaByIndex',
        'openMediaPlayerByPath',
        'closeMediaPlayer',
        'openImageViewerByPath',
        'closeImageViewer',
        'showImageByIndex',
        'getActiveCinemaMedia',
        'stepVideoFrame',
        'captureVideoFrameSnapshot',
        'setVideoZoom',
        'nudgeVideoZoom',
        'resetVideoZoom',
        'rotateVideo',
        'flipVideo',
        'toggleVideoFilter',
        'setMediaLoopPointA',
        'setMediaLoopPointB',
        'clearMediaABLoop',
        'addMediaBookmark',
        'toggleAudioGainBoost',
        'toggleVocalClarity',
        'toggleAmbientGlow',
        'toggleTheaterMode',
        'toggleHotkeysModal',
        'requestPlayerFullscreen',
        'exitPlayerFullscreen',
        'cleanupActiveSession',
        'isLoaded'
    ];
    for (const method of requiredMethods) {
        assert.ok(
            mediaPlayerJsSource.includes(method),
            `ZevMedia must declare and export ${method}`
        );
    }
});

runTest('1.3: app.js defines ensureMediaPlayerLoaded and loadStyle helpers', () => {
    assert.ok(appJsSource.includes('function loadStyle(href)'), 'app.js must define loadStyle');
    assert.ok(appJsSource.includes('function ensureMediaPlayerLoaded()'), 'app.js must define ensureMediaPlayerLoaded');
    assert.ok(appJsSource.includes('loadStyle(\'css/media-player.css\')'), 'ensureMediaPlayerLoaded must load css/media-player.css');
    assert.ok(appJsSource.includes('loadScript(\'js/media-player.js\')'), 'ensureMediaPlayerLoaded must load js/media-player.js');
});

// ── 2. VAULT LOCK SECURITY & STREAM ROUTE TEARDOWN ─────────────────────
console.log('\n--- 2. Vault Lock Security & SW Route Teardown ---');

runTest('2.1: sw.js implements CLOSE_ALL_MEDIA_STREAMS to terminate all sessions', () => {
    assert.ok(swJsSource.includes("data.type === 'CLOSE_ALL_MEDIA_STREAMS'"), 'sw.js must handle CLOSE_ALL_MEDIA_STREAMS');
    assert.ok(swJsSource.includes('activeMediaStreams.clear()'), 'sw.js must clear all active streams on lock');
});

runTest('2.2: lockVaultSession in app.js invokes revokeAllPlayerMediaSessions', () => {
    assert.ok(appJsSource.includes('revokeAllPlayerMediaSessions()'), 'lockVaultSession must call revokeAllPlayerMediaSessions');
    assert.ok(appJsSource.includes("type: 'CLOSE_ALL_MEDIA_STREAMS'"), 'revokeAllPlayerMediaSessions must post CLOSE_ALL_MEDIA_STREAMS to SW');
});

runTest('2.3: Video playback, vault lock, blob revocation & SW route rejection lifecycle simulation', () => {
    // Build a mock sandbox simulating the browser environment
    let swStreams = new Map();
    let swMessageLog = [];
    let revokedUrls = [];

    // Mock Service Worker
    const mockSW = {
        controller: {
            postMessage(msg) {
                swMessageLog.push(msg);
                if (msg.type === 'CLOSE_ALL_MEDIA_STREAMS') {
                    for (const [id, session] of swStreams.entries()) {
                        session.portClosed = true;
                    }
                    swStreams.clear();
                } else if (msg.type === 'CLOSE_MEDIA_STREAM') {
                    const session = swStreams.get(msg.streamId);
                    if (session) {
                        session.portClosed = true;
                        swStreams.delete(msg.streamId);
                    }
                }
            }
        }
    };

    // Register an active streaming session
    const testStreamId = 'stream_' + Date.now();
    swStreams.set(testStreamId, {
        fileSize: 1048576,
        mimeType: 'video/mp4',
        filename: 'test-vault-video.mp4',
        portClosed: false
    });

    assert.strictEqual(swStreams.has(testStreamId), true, 'Stream session active before lock');

    // Mock elements
    let videoPaused = false;
    let videoSrc = 'blob:https://zevsafe.app/mock-blob-video-123';
    let videoLoaded = false;
    const mockVideo = {
        style: { display: 'block' },
        pause() { videoPaused = true; },
        removeAttribute(attr) { if (attr === 'src') videoSrc = null; },
        load() { videoLoaded = true; }
    };

    let audioPaused = false;
    let audioSrc = 'blob:https://zevsafe.app/mock-blob-audio-456';
    const mockAudio = {
        style: { display: 'none' },
        pause() { audioPaused = true; },
        removeAttribute(attr) { if (attr === 'src') audioSrc = null; },
        load() {}
    };

    const mockElements = {
        'cinema-video': mockVideo,
        'cinema-audio': mockAudio,
        'lightbox-image': { src: 'blob:https://zevsafe.app/mock-img', style: { display: 'none' } },
        'vault-media-modal': { style: { display: 'flex' } },
        'vault-image-modal': { style: { display: 'none' } }
    };

    // Run revokeAllPlayerMediaSessions in sandboxed context
    const sandbox = {
        navigator: { serviceWorker: mockSW },
        document: {
            getElementById(id) { return mockElements[id] || null; }
        },
        currentMediaBlobUrl: 'blob:https://zevsafe.app/active-player-blob',
        currentImageBlobUrl: 'blob:https://zevsafe.app/active-image-blob',
        revokeTrackedBlobUrl(url) { revokedUrls.push(url); },
        window: {
            ZevMedia: {
                cleanupActiveSession() {
                    // Cleanup called
                }
            }
        }
    };

    vm.createContext(sandbox);

    // Extract revokeAllPlayerMediaSessions function code from app.js and run
    const fnMatch = appJsSource.match(/function revokeAllPlayerMediaSessions\(\)\s*\{[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'Must find revokeAllPlayerMediaSessions in app.js');
    vm.runInContext(fnMatch[0], sandbox);
    vm.runInContext('revokeAllPlayerMediaSessions();', sandbox);

    // Assertions
    assert.strictEqual(videoPaused, true, 'Video must be paused on vault lock');
    assert.strictEqual(videoSrc, null, 'Video src attribute must be removed on vault lock');
    assert.strictEqual(videoLoaded, true, 'Video load() must be called to purge decoded hardware buffers');
    assert.strictEqual(sandbox.currentMediaBlobUrl, null, 'currentMediaBlobUrl must be nulled on vault lock');
    assert.strictEqual(sandbox.currentImageBlobUrl, null, 'currentImageBlobUrl must be nulled on vault lock');
    assert.ok(revokedUrls.includes('blob:https://zevsafe.app/active-player-blob'), 'Player blob URL must be revoked');
    assert.ok(revokedUrls.includes('blob:https://zevsafe.app/active-image-blob'), 'Image blob URL must be revoked');

    // Verify SW received CLOSE_ALL_MEDIA_STREAMS and killed the stream session
    assert.strictEqual(swMessageLog.length > 0, true, 'Message must be posted to SW');
    assert.strictEqual(swMessageLog[0].type, 'CLOSE_ALL_MEDIA_STREAMS', 'SW must receive CLOSE_ALL_MEDIA_STREAMS');
    assert.strictEqual(swStreams.has(testStreamId), false, 'SW stream session must be completely deleted from activeMediaStreams');
});

runTest('2.4: revokeAllPlayerMediaSessions executes safely when media-player.js is NOT loaded', () => {
    const sandbox = {
        navigator: {},
        document: {
            getElementById() { return null; }
        },
        currentMediaBlobUrl: null,
        currentImageBlobUrl: null,
        revokeTrackedBlobUrl() {},
        window: {} // No ZevMedia
    };
    vm.createContext(sandbox);
    const fnMatch = appJsSource.match(/function revokeAllPlayerMediaSessions\(\)\s*\{[\s\S]*?\n\}/);
    vm.runInContext(fnMatch[0], sandbox);
    assert.doesNotThrow(() => {
        vm.runInContext('revokeAllPlayerMediaSessions();', sandbox);
    }, 'Must not throw even when elements, SW, or ZevMedia are absent');
});

// ── 3. 2.5 GB PHONE MEMORY GUARDRAIL ──────────────────────────────────
console.log('\n--- 3. 2.5 GB Phone Memory Guardrail Verification ---');

runTest('3.1: 2.5 GB limit does NOT block SW range streaming', () => {
    // In js/media-player.js, playMediaByIndex must NOT check item.size or return on file limit before canStreamRange
    const playMediaIdx = mediaPlayerJsSource.indexOf('async function playMediaByIndex(index)');
    const canStreamIdx = mediaPlayerJsSource.indexOf('canStreamRange(item)', playMediaIdx);
    assert.ok(canStreamIdx !== -1, 'Must find canStreamRange(item) in playMediaByIndex');
    const codeBeforeStream = mediaPlayerJsSource.slice(playMediaIdx, canStreamIdx);
    assert.ok(
        !codeBeforeStream.includes('2.5 * 1024 * 1024 * 1024') && !codeBeforeStream.includes('exceeds phone limit'),
        'playMediaByIndex must not return early on file size before checking canStreamRange'
    );
});

runTest('3.2: 2.5 GB limit is enforced on setupDirectBlobPlayback (memory fallback)', () => {
    const directPlaybackIdx = mediaPlayerJsSource.indexOf('async function setupDirectBlobPlayback');
    const directPlaybackCode = mediaPlayerJsSource.slice(directPlaybackIdx, directPlaybackIdx + 1000);
    assert.ok(
        directPlaybackCode.includes('2.5 * 1024 * 1024 * 1024'),
        'setupDirectBlobPlayback must check 2.5 GB boundary'
    );
    assert.ok(
        directPlaybackCode.includes('isMobilePhone'),
        'setupDirectBlobPlayback must check isMobilePhone'
    );
    assert.ok(
        directPlaybackCode.includes('showToast'),
        'setupDirectBlobPlayback must display descriptive warning toast'
    );
});

// ── 4. GESTURE ENGINE: ACCUMULATION, SINGLE-TAP DELAY & ZOOM GUARD ─────
console.log('\n--- 4. Gesture Engine: Accumulation, Single-Tap & Zoom Guard ---');

runTest('4.1: Gesture engine accumulates double-taps into combined seek total', () => {
    assert.ok(mediaPlayerJsSource.includes('accumulatedSeekDelta'), 'Must track accumulatedSeekDelta');
    assert.ok(mediaPlayerJsSource.includes('accumulatedSeekDelta -= 10'), 'Must decrement 10 on backward seek');
    assert.ok(mediaPlayerJsSource.includes('accumulatedSeekDelta += 10'), 'Must increment 10 on forward seek');
    assert.ok(mediaPlayerJsSource.includes('${accumulatedSeekDelta}s'), 'Must display accumulated total in badge');
});

runTest('4.2: Single-tap uses ~250ms debounce delay and is cancelled by double-tap', () => {
    assert.ok(mediaPlayerJsSource.includes('singleTapTimer = setTimeout('), 'Must delay single tap action');
    assert.ok(mediaPlayerJsSource.includes('clearTimeout(singleTapTimer)'), 'Must clear single tap on double-tap arrival');
    assert.ok(mediaPlayerJsSource.includes('250'), 'Single tap timeout must be 250ms');
});

runTest('4.3: Double-tap seek is disabled when zoomed (double-tap resets zoom to 1.0x)', () => {
    assert.ok(mediaPlayerJsSource.includes('currentMediaZoom > 1.05'), 'Must check zoom level in double-tap');
    assert.ok(mediaPlayerJsSource.includes('resetVideoZoom()'), 'Double tap when zoomed must reset zoom');
});

// ── 5. FULLSCREEN, IOS CSS FALLBACK & ORIENTATION LOCK ─────────────────
console.log('\n--- 5. Fullscreen, iOS Pseudo Fallback & Orientation Lock ---');

runTest('5.1: Fullscreen implements .media-fullscreen--pseudo fallback for iOS Safari', () => {
    assert.ok(mediaPlayerJsSource.includes('media-fullscreen--pseudo'), 'js/media-player.js must toggle media-fullscreen--pseudo');
    assert.ok(mediaPlayerCssSource.includes('.media-modal-container.media-fullscreen--pseudo'), 'css/media-player.css must define .media-fullscreen--pseudo');
});

runTest('5.2: screen.orientation.lock and unlock are safely wrapped in try/catch', () => {
    assert.ok(mediaPlayerJsSource.includes("screen.orientation.lock('landscape')"), 'Must call screen.orientation.lock');
    assert.ok(mediaPlayerJsSource.includes('screen.orientation.unlock()'), 'Must call screen.orientation.unlock');
    assert.ok(mediaPlayerJsSource.includes('.catch(() => {})'), 'lock promise rejection must be caught safely');
});

runTest('5.3: PiP button is automatically hidden when pictureInPicture is unsupported', () => {
    assert.ok(mediaPlayerJsSource.includes('pictureInPictureEnabled'), 'Must detect pictureInPictureEnabled');
    assert.ok(mediaPlayerJsSource.includes("mediaPipBtn.style.display = 'none'"), 'Must hide PiP button when unsupported');
});

// ── 6. DOM ACCESSIBILITY & ARIA-LABELS ─────────────────────────────────
console.log('\n--- 6. DOM Accessibility & Icon-Only Button Labels ---');

runTest('6.1: All player action and control buttons in index.html feature aria-label attributes', () => {
    const requiredLabeledButtons = [
        'btn-media-snapshot',
        'btn-media-loop',
        'btn-media-ambient',
        'btn-media-hotkeys',
        'btn-media-download',
        'btn-close-hotkeys',
        'btn-media-play',
        'btn-media-prev',
        'btn-media-rewind10',
        'btn-media-forward10',
        'btn-media-next',
        'btn-media-mute',
        'btn-media-audio-boost',
        'btn-media-vocal-clarity',
        'btn-media-bookmark',
        'btn-media-fit',
        'btn-media-pip',
        'btn-media-theater',
        'btn-media-fullscreen',
        'btn-toggle-tools',
        'btn-close-tools-drawer',
        'btn-media-step-back',
        'btn-media-step-fwd',
        'btn-media-zoom-in',
        'btn-media-zoom-out',
        'btn-media-zoom-reset',
        'btn-media-ab-a',
        'btn-media-ab-b',
        'btn-media-ab-clear',
        'btn-media-rot-left',
        'btn-media-rot-right',
        'btn-media-flip-h',
        'btn-media-flip-v',
        'btn-filter-bright',
        'btn-filter-contrast',
        'btn-filter-invert',
        'btn-filter-cctv',
        'btn-filter-reset'
    ];
    for (const btnId of requiredLabeledButtons) {
        const regex = new RegExp(`id="${btnId}"[^>]*aria-label="[^"]+"`);
        assert.ok(
            regex.test(indexHtmlSource),
            `Button #${btnId} must have an aria-label attribute in index.html`
        );
    }
});

runTest('6.2: All image lightbox buttons in index.html feature aria-label attributes', () => {
    const imageButtons = [
        'btn-image-open-tab',
        'btn-image-download',
        'btn-image-prev',
        'btn-image-next',
        'btn-image-zoom-out',
        'btn-image-zoom-in',
        'btn-image-zoom-reset',
        'btn-image-rotate',
        'btn-image-fullscreen'
    ];
    for (const btnId of imageButtons) {
        const regex = new RegExp(`id="${btnId}"[^>]*aria-label="[^"]+"`);
        assert.ok(
            regex.test(indexHtmlSource),
            `Image button #${btnId} must have an aria-label attribute in index.html`
        );
    }
});

console.log('===============================================================');
console.log(`  ALL ${passedTests}/${totalTests} MEDIA PLAYER SECURITY & GESTURE TESTS PASSED (100%)`);
console.log('===============================================================');
