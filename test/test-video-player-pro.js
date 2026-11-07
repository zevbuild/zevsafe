/**
 * ZevSafe Automated Verification Suite: Video Player 3.0 (Pro Studio Upgrade)
 *
 * Verifies:
 * 1. DOM elements & ARIA roles in index.html (Scrubber, Steppers, Boost, Loupe Zoom, A-B Loop, Bookmarks, Ambient, EQ)
 * 2. CSS styles & classes in styles.css (Cyber Scrubber, Zoom Badge, A-B Markers, Pins, Vocal EQ, Ambient Glow)
 * 3. JavaScript engine functions & handlers in app.js (Forensic Loupe, A-B Looper, WebAudio EQ, Bookmarks, Ambilight)
 * 4. PWA Service Worker bump (APP_VERSION = 'v66') in sw.js
 * 5. Version badge synchronization (v8.15.0 / WEB-VERSION-66) in index.html
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
let passed = 0;
let total = 0;

function runTest(name, fn) {
    total++;
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

console.log('===============================================================');
console.log('  ZevSafe Video Player 3.0 Pro Studio Automated Test Suite     ');
console.log('===============================================================');

// ── 1. DOM STRUCTURE IN index.html ────────────────────────────
console.log('\n--- 1. DOM Elements & Accessibility in index.html ---');
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

runTest('1.1: Snapshot, Loop, and Ambient action buttons present in media modal header', () => {
    assert.ok(indexHtml.includes('id="btn-media-snapshot"'), 'Must have #btn-media-snapshot');
    assert.ok(indexHtml.includes('id="btn-media-loop"'), 'Must have #btn-media-loop');
    assert.ok(indexHtml.includes('id="btn-media-ambient"'), 'Must have #btn-media-ambient');
});

runTest('1.2: Video stage with ambient canvas, zoom badge, center ripple and gestures', () => {
    assert.ok(indexHtml.includes('id="cinema-video-stage"'), 'Must have #cinema-video-stage');
    assert.ok(indexHtml.includes('id="cinema-ambient-canvas"'), 'Must have #cinema-ambient-canvas');
    assert.ok(indexHtml.includes('id="cinema-zoom-badge"'), 'Must have #cinema-zoom-badge');
    assert.ok(indexHtml.includes('id="cinema-center-ripple"'), 'Must have #cinema-center-ripple');
    assert.ok(indexHtml.includes('id="cinema-gesture-left"'), 'Must have #cinema-gesture-left');
    assert.ok(indexHtml.includes('id="cinema-gesture-right"'), 'Must have #cinema-gesture-right');
});

runTest('1.3: Cybernetic timeline scrubber elements, A-B markers, and bookmarks wrap', () => {
    assert.ok(indexHtml.includes('id="media-timeline-wrap"'), 'Must have #media-timeline-wrap');
    assert.ok(indexHtml.includes('role="slider"'), 'Scrubber must have role="slider"');
    assert.ok(indexHtml.includes('id="media-timeline-track"'), 'Must have #media-timeline-track');
    assert.ok(indexHtml.includes('id="media-timeline-buffer"'), 'Must have #media-timeline-buffer');
    assert.ok(indexHtml.includes('id="media-timeline-ab-range"'), 'Must have #media-timeline-ab-range');
    assert.ok(indexHtml.includes('id="media-timeline-progress"'), 'Must have #media-timeline-progress');
    assert.ok(indexHtml.includes('id="media-timeline-thumb"'), 'Must have #media-timeline-thumb');
    assert.ok(indexHtml.includes('id="media-timeline-marker-a"'), 'Must have #media-timeline-marker-a');
    assert.ok(indexHtml.includes('id="media-timeline-marker-b"'), 'Must have #media-timeline-marker-b');
    assert.ok(indexHtml.includes('id="media-timeline-bookmarks-wrap"'), 'Must have #media-timeline-bookmarks-wrap');
    assert.ok(indexHtml.includes('id="media-timeline-tooltip"'), 'Must have #media-timeline-tooltip');
});

runTest('1.4: Single-frame stepping buttons, audio boost, vocal clarity, and bookmark button present', () => {
    assert.ok(indexHtml.includes('id="btn-media-step-back"'), 'Must have #btn-media-step-back');
    assert.ok(indexHtml.includes('id="btn-media-step-fwd"'), 'Must have #btn-media-step-fwd');
    assert.ok(indexHtml.includes('id="btn-media-audio-boost"'), 'Must have #btn-media-audio-boost');
    assert.ok(indexHtml.includes('id="btn-media-vocal-clarity"'), 'Must have #btn-media-vocal-clarity');
    assert.ok(indexHtml.includes('id="btn-media-bookmark"'), 'Must have #btn-media-bookmark');
});

runTest('1.5: Secondary tools bar present with Zoom, A-B Loop, Rotation, Flip and Filters', () => {
    assert.ok(indexHtml.includes('id="media-tools-bar"'), 'Must have #media-tools-bar');
    assert.ok(indexHtml.includes('id="btn-media-zoom-in"'), 'Must have #btn-media-zoom-in');
    assert.ok(indexHtml.includes('id="btn-media-zoom-out"'), 'Must have #btn-media-zoom-out');
    assert.ok(indexHtml.includes('id="btn-media-zoom-reset"'), 'Must have #btn-media-zoom-reset');
    assert.ok(indexHtml.includes('id="btn-media-ab-a"'), 'Must have #btn-media-ab-a');
    assert.ok(indexHtml.includes('id="btn-media-ab-b"'), 'Must have #btn-media-ab-b');
    assert.ok(indexHtml.includes('id="btn-media-ab-clear"'), 'Must have #btn-media-ab-clear');
    assert.ok(indexHtml.includes('id="btn-media-rot-left"'), 'Must have #btn-media-rot-left');
    assert.ok(indexHtml.includes('id="btn-media-rot-right"'), 'Must have #btn-media-rot-right');
    assert.ok(indexHtml.includes('id="btn-media-flip-h"'), 'Must have #btn-media-flip-h');
    assert.ok(indexHtml.includes('id="btn-media-flip-v"'), 'Must have #btn-media-flip-v');
    assert.ok(indexHtml.includes('id="btn-filter-bright"'), 'Must have #btn-filter-bright');
    assert.ok(indexHtml.includes('id="btn-filter-contrast"'), 'Must have #btn-filter-contrast');
    assert.ok(indexHtml.includes('id="btn-filter-invert"'), 'Must have #btn-filter-invert');
    assert.ok(indexHtml.includes('id="btn-filter-cctv"'), 'Must have #btn-filter-cctv');
    assert.ok(indexHtml.includes('id="btn-filter-reset"'), 'Must have #btn-filter-reset');
});

runTest('1.6: Extended speed options (0.25x to 4.0x) present', () => {
    assert.ok(indexHtml.includes('value="0.25"'), 'Must have 0.25x speed');
    assert.ok(indexHtml.includes('value="3"'), 'Must have 3.0x speed');
    assert.ok(indexHtml.includes('value="4"'), 'Must have 4.0x speed');
});

// ── 2. CSS STYLING IN styles.css ──────────────────────────────
console.log('\n--- 2. CSS Rules & Visual Styling in styles.css ---');
const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'styles.css'), 'utf8');

runTest('2.1: Scrubber timeline track, buffer, progress, thumb, A-B range and markers styled', () => {
    assert.ok(stylesCss.includes('.media-timeline-wrap'), 'Must define .media-timeline-wrap');
    assert.ok(stylesCss.includes('.media-timeline-track'), 'Must define .media-timeline-track');
    assert.ok(stylesCss.includes('.media-timeline-buffer'), 'Must define .media-timeline-buffer');
    assert.ok(stylesCss.includes('.media-timeline-ab-range'), 'Must define .media-timeline-ab-range');
    assert.ok(stylesCss.includes('.media-timeline-ab-marker'), 'Must define .media-timeline-ab-marker');
    assert.ok(stylesCss.includes('.media-timeline-ab-marker--b'), 'Must define .media-timeline-ab-marker--b');
    assert.ok(stylesCss.includes('.media-timeline-bookmarks-wrap'), 'Must define .media-timeline-bookmarks-wrap');
    assert.ok(stylesCss.includes('.media-timeline-bookmark-pin'), 'Must define .media-timeline-bookmark-pin');
});

runTest('2.2: Ambient backlight canvas, zoom badge, and stage grab cursor styled', () => {
    assert.ok(stylesCss.includes('.cinema-ambient-canvas'), 'Must define .cinema-ambient-canvas');
    assert.ok(stylesCss.includes('.cinema-ambient-canvas.active'), 'Must define .cinema-ambient-canvas.active');
    assert.ok(stylesCss.includes('.cinema-zoom-badge'), 'Must define .cinema-zoom-badge');
    assert.ok(stylesCss.includes('.cinema-video-stage.is-zoomed'), 'Must define .cinema-video-stage.is-zoomed');
    assert.ok(stylesCss.includes('.cinema-video-stage.is-panning'), 'Must define .cinema-video-stage.is-panning');
});

runTest('2.3: Audio boost and Vocal Clarity EQ badges styled', () => {
    assert.ok(stylesCss.includes('.media-boost-badge'), 'Must define .media-boost-badge');
    assert.ok(stylesCss.includes('.media-boost-badge.is-active'), 'Must define .media-boost-badge.is-active');
    assert.ok(stylesCss.includes('.media-eq-badge'), 'Must define .media-eq-badge');
    assert.ok(stylesCss.includes('.media-eq-badge.is-active'), 'Must define .media-eq-badge.is-active');
});

runTest('2.4: Light theme overrides for cinema player defined', () => {
    assert.ok(stylesCss.includes('.light-theme .media-cinema-bar'), 'Must define light theme media bar');
    assert.ok(stylesCss.includes('.light-theme .media-timeline-track'), 'Must define light theme track');
    assert.ok(stylesCss.includes('.light-theme .media-timeline-ab-range'), 'Must define light theme A-B range');
    assert.ok(stylesCss.includes('.light-theme .cinema-zoom-badge'), 'Must define light theme zoom badge');
    assert.ok(stylesCss.includes('.light-theme .media-eq-badge'), 'Must define light theme EQ badge');
});

// ── 3. JAVASCRIPT ENGINE IN app.js ────────────────────────────
console.log('\n--- 3. JavaScript Engine Logic & Handlers in app.js ---');
const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');

runTest('3.1: Pro Cinema Player 3.0 state variables initialized', () => {
    assert.ok(appJs.includes('let currentMediaRotation = 0;'), 'Must have currentMediaRotation');
    assert.ok(appJs.includes('let currentMediaFlipH = 1;'), 'Must have currentMediaFlipH');
    assert.ok(appJs.includes('let currentMediaFlipV = 1;'), 'Must have currentMediaFlipV');
    assert.ok(appJs.includes('let currentMediaZoom = 1.0;'), 'Must have currentMediaZoom');
    assert.ok(appJs.includes('let mediaLoopPointA = null;'), 'Must have mediaLoopPointA');
    assert.ok(appJs.includes('let mediaLoopPointB = null;'), 'Must have mediaLoopPointB');
    assert.ok(appJs.includes('let currentMediaBookmarks = [];'), 'Must have currentMediaBookmarks');
    assert.ok(appJs.includes('let currentMediaAmbientGlow = false;'), 'Must have currentMediaAmbientGlow');
    assert.ok(appJs.includes('let currentMediaVocalClarity = false;'), 'Must have currentMediaVocalClarity');
});

runTest('3.2: Frame stepping function stepVideoFrame implemented with 30fps delta', () => {
    assert.ok(appJs.includes('function stepVideoFrame(frames)'), 'Must define stepVideoFrame');
    assert.ok(appJs.includes('(1 / 30) * frames'), 'Must compute 30fps frame delta');
});

runTest('3.3: captureVideoFrameSnapshot extracts canvas frame, saves to vault and downloads', () => {
    assert.ok(appJs.includes('function captureVideoFrameSnapshot()'), 'Must define captureVideoFrameSnapshot');
    assert.ok(appJs.includes('canvas.getContext(\'2d\')'), 'Must use canvas 2D context');
    assert.ok(appJs.includes('currentV3Vault.editedFiles.set('), 'Must save snapshot into vault editedFiles');
    assert.ok(appJs.includes('a.download = snapName;'), 'Must trigger direct device download');
});

runTest('3.4: Forensic Loupe Pan & Zoom functions implemented', () => {
    assert.ok(appJs.includes('function setVideoZoom(zoom)'), 'Must define setVideoZoom');
    assert.ok(appJs.includes('function nudgeVideoZoom(delta)'), 'Must define nudgeVideoZoom');
    assert.ok(appJs.includes('function resetVideoZoom()'), 'Must define resetVideoZoom');
    assert.ok(appJs.includes('function showCinemaZoomBadge()'), 'Must define showCinemaZoomBadge');
});

runTest('3.5: A-B Segment Looper functions implemented', () => {
    assert.ok(appJs.includes('function setMediaLoopPointA()'), 'Must define setMediaLoopPointA');
    assert.ok(appJs.includes('function setMediaLoopPointB()'), 'Must define setMediaLoopPointB');
    assert.ok(appJs.includes('function clearMediaABLoop()'), 'Must define clearMediaABLoop');
    assert.ok(appJs.includes('function updateABLoopUI(media)'), 'Must define updateABLoopUI');
});

runTest('3.6: Forensic Timestamp Bookmarks implemented', () => {
    assert.ok(appJs.includes('function addMediaBookmark()'), 'Must define addMediaBookmark');
    assert.ok(appJs.includes('function renderMediaBookmarks()'), 'Must define renderMediaBookmarks');
});

runTest('3.7: WebAudio Vocal Clarity Equalizer implemented', () => {
    assert.ok(appJs.includes('function toggleVocalClarity()'), 'Must define toggleVocalClarity');
    assert.ok(appJs.includes('currentMediaVocalFilter = currentMediaAudioCtx.createBiquadFilter();'), 'Must create BiquadFilter');
    assert.ok(appJs.includes('currentMediaVocalFilter.type = \'peaking\';'), 'Must be peaking EQ filter');
    assert.ok(appJs.includes('currentMediaVocalFilter.frequency.value = 2500;'), 'Must center at 2500 Hz for voice');
});

runTest('3.8: Ambient Cinema Glow (Ambilight) implemented', () => {
    assert.ok(appJs.includes('function toggleAmbientGlow()'), 'Must define toggleAmbientGlow');
    assert.ok(appJs.includes('function updateAmbientGlow()'), 'Must define updateAmbientGlow');
});

runTest('3.9: Extended keyboard shortcuts matrix bound in keydown listener', () => {
    assert.ok(appJs.includes('e.key === \'[\''), 'Must bind [ to loop Point A');
    assert.ok(appJs.includes('e.key === \']\''), 'Must bind ] to loop Point B');
    assert.ok(appJs.includes('e.key === \'\\\\\''), 'Must bind \\ to clear loop');
    assert.ok(appJs.includes('e.key === \'v\' || e.key === \'V\''), 'Must bind V to vocal clarity');
    assert.ok(appJs.includes('e.key === \'+\' || e.key === \'=\''), 'Must bind + to zoom in');
    assert.ok(appJs.includes('e.key === \'-\' || e.key === \'_\''), 'Must bind - to zoom out');
    assert.ok(appJs.includes('e.key === \'0\''), 'Must bind 0 to reset zoom');
    assert.ok(appJs.includes('nudgePlaybackSpeed'), 'Must support playback speed nudging via shortcuts');
});

// ── 4. PWA SERVICE WORKER & VERSION SYNCHRONIZATION ───────────
console.log('\n--- 4. PWA Service Worker & Version Tags ---');
const swJs = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');

runTest('4.1: Service Worker shell cache bumped to v66', () => {
    assert.ok(swJs.includes("const APP_VERSION    = 'v66';"), 'sw.js must be APP_VERSION v66');
});

runTest('4.2: index.html synchronized to v8.15.0 / WEB-VERSION-66', () => {
    assert.ok(indexHtml.includes('WEB-VERSION-66'), 'index.html must have WEB-VERSION-66');
    assert.ok(indexHtml.includes('v8.15.0'), 'index.html must have v8.15.0');
});

console.log('\n===============================================================');
console.log(`  ALL ${passed}/${total} VIDEO PLAYER 3.0 TESTS PASSED (100%)       `);
console.log('===============================================================');
