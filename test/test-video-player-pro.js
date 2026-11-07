/**
 * ZevSafe Automated Verification Suite: Video Player 2.0 (Pro Cinema Upgrade)
 *
 * Verifies:
 * 1. DOM elements & ARIA roles in index.html (Scrubber, Frame Steppers, Audio Boost, Snapshot, Transforms, Filters)
 * 2. CSS styles & classes in styles.css (Cyber Scrubber, Center Ripple, Gesture Badges, Filters, Light Theme)
 * 3. JavaScript engine functions & handlers in app.js (Frame Stepping, WebAudio 200%, Snapshots, Transforms)
 * 4. PWA Service Worker bump (APP_VERSION = 'v65') in sw.js
 * 5. Version badge synchronization (v8.14.0 / WEB-VERSION-65) in index.html
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
console.log('  ZevSafe Video Player 2.0 Pro Automated Verification Suite    ');
console.log('===============================================================');

// ── 1. DOM STRUCTURE IN index.html ────────────────────────────
console.log('\n--- 1. DOM Elements & Accessibility in index.html ---');
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

runTest('1.1: Snapshot and Loop action buttons present in media modal header', () => {
    assert.ok(indexHtml.includes('id="btn-media-snapshot"'), 'Must have #btn-media-snapshot');
    assert.ok(indexHtml.includes('id="btn-media-loop"'), 'Must have #btn-media-loop');
});

runTest('1.2: Video stage with center ripple and gesture overlays present in modal body', () => {
    assert.ok(indexHtml.includes('id="cinema-video-stage"'), 'Must have #cinema-video-stage');
    assert.ok(indexHtml.includes('id="cinema-center-ripple"'), 'Must have #cinema-center-ripple');
    assert.ok(indexHtml.includes('id="cinema-gesture-left"'), 'Must have #cinema-gesture-left');
    assert.ok(indexHtml.includes('id="cinema-gesture-right"'), 'Must have #cinema-gesture-right');
});

runTest('1.3: Cybernetic timeline scrubber elements and ARIA roles present', () => {
    assert.ok(indexHtml.includes('id="media-timeline-wrap"'), 'Must have #media-timeline-wrap');
    assert.ok(indexHtml.includes('role="slider"'), 'Scrubber must have role="slider"');
    assert.ok(indexHtml.includes('id="media-timeline-track"'), 'Must have #media-timeline-track');
    assert.ok(indexHtml.includes('id="media-timeline-buffer"'), 'Must have #media-timeline-buffer');
    assert.ok(indexHtml.includes('id="media-timeline-progress"'), 'Must have #media-timeline-progress');
    assert.ok(indexHtml.includes('id="media-timeline-thumb"'), 'Must have #media-timeline-thumb');
    assert.ok(indexHtml.includes('id="media-timeline-tooltip"'), 'Must have #media-timeline-tooltip');
});

runTest('1.4: Single-frame stepping buttons and audio boost badge present', () => {
    assert.ok(indexHtml.includes('id="btn-media-step-back"'), 'Must have #btn-media-step-back');
    assert.ok(indexHtml.includes('id="btn-media-step-fwd"'), 'Must have #btn-media-step-fwd');
    assert.ok(indexHtml.includes('id="btn-media-audio-boost"'), 'Must have #btn-media-audio-boost');
    assert.ok(indexHtml.includes('Boost 200%'), 'Must state Boost 200%');
});

runTest('1.5: Secondary tools bar present with rotation, flip and real-time filters', () => {
    assert.ok(indexHtml.includes('id="media-tools-bar"'), 'Must have #media-tools-bar');
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

// ── 2. CSS STYLING IN styles.css ──────────────────────────────
console.log('\n--- 2. CSS Rules & Visual Styling in styles.css ---');
const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'styles.css'), 'utf8');

runTest('2.1: Scrubber timeline track, buffer, progress and hover thumb styled', () => {
    assert.ok(stylesCss.includes('.media-timeline-wrap'), 'Must define .media-timeline-wrap');
    assert.ok(stylesCss.includes('.media-timeline-track'), 'Must define .media-timeline-track');
    assert.ok(stylesCss.includes('.media-timeline-buffer'), 'Must define .media-timeline-buffer');
    assert.ok(stylesCss.includes('.media-timeline-progress'), 'Must define .media-timeline-progress');
    assert.ok(stylesCss.includes('.media-timeline-thumb'), 'Must define .media-timeline-thumb');
    assert.ok(stylesCss.includes('.media-timeline-tooltip'), 'Must define .media-timeline-tooltip');
});

runTest('2.2: Center ripple and gesture badge animations defined', () => {
    assert.ok(stylesCss.includes('.cinema-center-ripple'), 'Must define .cinema-center-ripple');
    assert.ok(stylesCss.includes('.cinema-center-ripple.active'), 'Must define .cinema-center-ripple.active');
    assert.ok(stylesCss.includes('.cinema-gesture-badge'), 'Must define .cinema-gesture-badge');
    assert.ok(stylesCss.includes('.cinema-gesture-badge.show'), 'Must define .cinema-gesture-badge.show');
});

runTest('2.3: Audio boost pill and filter active styles defined', () => {
    assert.ok(stylesCss.includes('.media-boost-badge'), 'Must define .media-boost-badge');
    assert.ok(stylesCss.includes('.media-boost-badge.is-active'), 'Must define .media-boost-badge.is-active');
    assert.ok(stylesCss.includes('.media-tools-bar'), 'Must define .media-tools-bar');
    assert.ok(stylesCss.includes('.media-filter-btn.is-active'), 'Must define .media-filter-btn.is-active');
});

runTest('2.4: Light theme overrides for cinema player defined', () => {
    assert.ok(stylesCss.includes('.light-theme .media-cinema-bar'), 'Must define light theme media bar');
    assert.ok(stylesCss.includes('.light-theme .media-timeline-track'), 'Must define light theme track');
    assert.ok(stylesCss.includes('.light-theme .media-boost-badge'), 'Must define light theme boost badge');
});

// ── 3. JAVASCRIPT ENGINE IN app.js ────────────────────────────
console.log('\n--- 3. JavaScript Engine Logic & Handlers in app.js ---');
const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');

runTest('3.1: Pro Cinema Player 2.0 state variables initialized', () => {
    assert.ok(appJs.includes('let currentMediaRotation = 0;'), 'Must have currentMediaRotation');
    assert.ok(appJs.includes('let currentMediaFlipH = 1;'), 'Must have currentMediaFlipH');
    assert.ok(appJs.includes('let currentMediaFlipV = 1;'), 'Must have currentMediaFlipV');
    assert.ok(appJs.includes('let currentMediaFilters = { bright: false, contrast: false, invert: false, cctv: false };'), 'Must have currentMediaFilters');
    assert.ok(appJs.includes('let currentMediaIsLooping = false;'), 'Must have currentMediaIsLooping');
    assert.ok(appJs.includes('let currentMediaAudioBoost = false;'), 'Must have currentMediaAudioBoost');
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

runTest('3.4: Hardware-accelerated transforms and real-time video filters implemented', () => {
    assert.ok(appJs.includes('function applyVideoTransforms()'), 'Must define applyVideoTransforms');
    assert.ok(appJs.includes('function rotateVideo(deg)'), 'Must define rotateVideo');
    assert.ok(appJs.includes('function flipVideo(axis)'), 'Must define flipVideo');
    assert.ok(appJs.includes('function toggleVideoFilter(name)'), 'Must define toggleVideoFilter');
    assert.ok(appJs.includes('function resetVideoTransforms()'), 'Must define resetVideoTransforms');
});

runTest('3.5: WebAudio GainNode 200% Audio Boost implemented with safe lifecycle', () => {
    assert.ok(appJs.includes('function initAudioBoostContext('), 'Must define initAudioBoostContext');
    assert.ok(appJs.includes('function toggleAudioGainBoost()'), 'Must define toggleAudioGainBoost');
    assert.ok(appJs.includes('currentMediaGainNode.gain.value = currentMediaAudioBoost ? 2.0 : 1.0;'), 'Must set 2.0x gain when boosted');
});

runTest('3.6: Timeline scrubber progress and drag seeking implemented', () => {
    assert.ok(appJs.includes('function updateTimelineScrubber(media)'), 'Must define updateTimelineScrubber');
    assert.ok(appJs.includes('media.buffered'), 'Must read media.buffered ranges');
    assert.ok(appJs.includes('timelineWrap.addEventListener(\'mousedown\''), 'Must bind scrubber mousedown');
});

runTest('3.7: Video stage click & double-tap gestures wired with ripple feedback', () => {
    assert.ok(appJs.includes('function showCinemaCenterRipple('), 'Must define showCinemaCenterRipple');
    assert.ok(appJs.includes('function showCinemaGestureBadge('), 'Must define showCinemaGestureBadge');
    assert.ok(appJs.includes('videoStage.addEventListener(\'click\''), 'Must bind stage click');
});

runTest('3.8: Extended keyboard shortcuts matrix bound in keydown listener', () => {
    assert.ok(appJs.includes('e.key === \'k\' || e.key === \'K\''), 'Must bind K to play/pause');
    assert.ok(appJs.includes('e.key === \'j\' || e.key === \'J\''), 'Must bind J to rewind');
    assert.ok(appJs.includes('e.key === \'l\' || e.key === \'L\''), 'Must bind L to forward');
    assert.ok(appJs.includes('e.key === \',\' || e.key === \'<\''), 'Must bind , to step back');
    assert.ok(appJs.includes('e.key === \'.\' || e.key === \'>\''), 'Must bind . to step forward');
    assert.ok(appJs.includes('e.key === \'b\' || e.key === \'B\''), 'Must bind B to audio boost');
    assert.ok(appJs.includes('e.key === \'r\' || e.key === \'R\''), 'Must bind R to rotate');
    assert.ok(appJs.includes('e.key === \'s\' || e.key === \'S\''), 'Must bind S to frame snapshot');
});

// ── 4. PWA SERVICE WORKER & VERSION SYNCHRONIZATION ───────────
console.log('\n--- 4. PWA Service Worker & Version Tags ---');
const swJs = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');

runTest('4.1: Service Worker shell cache bumped to v65', () => {
    assert.ok(swJs.includes("const APP_VERSION    = 'v65';"), 'sw.js must be APP_VERSION v65');
});

runTest('4.2: index.html synchronized to v8.14.0 / WEB-VERSION-65', () => {
    assert.ok(indexHtml.includes('WEB-VERSION-65'), 'index.html must have WEB-VERSION-65');
    assert.ok(indexHtml.includes('v8.14.0'), 'index.html must have v8.14.0');
});

console.log('\n===============================================================');
console.log(`  ALL ${passed}/${total} VIDEO PLAYER 2.0 TESTS PASSED (100%)       `);
console.log('===============================================================');
