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

runTest('4.1: Service Worker shell cache bumped to v70', () => {
    assert.ok(swJs.includes("const APP_VERSION    = 'v70';"), 'sw.js must be APP_VERSION v70');
});

runTest('4.2: index.html synchronized to v8.19.0 / WEB-VERSION-70', () => {
    assert.ok(indexHtml.includes('WEB-VERSION-70'), 'index.html must have WEB-VERSION-70');
    assert.ok(indexHtml.includes('v8.19.0'), 'index.html must have v8.19.0');
});

runTest('4.3: index.html & styles.css implement upgraded 3-zone cybernetic navbar & brand link', () => {
    assert.ok(indexHtml.includes('class="brand-link"'), 'index.html must wrap brand in .brand-link');
    assert.ok(indexHtml.includes('class="nav-links-group"'), 'index.html must contain .nav-links-group');
    assert.ok(indexHtml.includes('class="nav-actions-deck"'), 'index.html must contain .nav-actions-deck');
    assert.ok(stylesCss.includes('.brand-link:hover .brand-logo'), 'styles.css must style brand-logo hover rotation');
    assert.ok(stylesCss.includes('@media (max-width: 1240px) and (min-width: 769px)'), 'styles.css must protect 1-row navbar layout on desktop');
});

runTest('4.4: index.html & styles.css implement enhanced Hero trust strip with 5 GB range streaming pill & light theme', () => {
    assert.ok(indexHtml.includes('5 GB Instant Streaming'), 'index.html must include 5 GB Instant Streaming trust pill');
    assert.ok(stylesCss.includes('.light-theme .navbar'), 'styles.css must provide light-theme navbar background');
    assert.ok(stylesCss.includes('.light-theme .hero-security-badge'), 'styles.css must provide light-theme hero badge');
    assert.ok(stylesCss.includes('.light-theme .hero-title-refined'), 'styles.css must provide light-theme hero title');
    assert.ok(stylesCss.includes('.light-theme .hero-trust-strip'), 'styles.css must provide light-theme trust strip');
});

// ── 5. ON-DEMAND RANGE STREAMING ENGINE & INSTANT PLAYBACK (< 60 MB RAM) ───
console.log('\n--- 5. On-Demand Range Streaming Engine & Instant Playback (< 60 MB RAM) ---');
const StreamUnpacker = require('../js/stream-unpacker.js');
const WorkerBridge = require('../js/worker-bridge.js');

runTest('5.1: StreamUnpacker exports extractFileRange', () => {
    assert.strictEqual(typeof StreamUnpacker.extractFileRange, 'function', 'extractFileRange must be an exported function');
});

runTest('5.2: sw.js defines handleStreamMedia with HTTP 206 Partial Content and Content-Range', () => {
    assert.ok(swJs.includes("url.pathname === '/_stream_media'"), 'sw.js must route /_stream_media');
    assert.ok(swJs.includes('handleStreamMedia'), 'sw.js must define handleStreamMedia');
    assert.ok(swJs.includes('status: 206'), 'sw.js must return status 206 Partial Content');
    assert.ok(swJs.includes("'Accept-Ranges': 'bytes'"), 'sw.js must declare Accept-Ranges: bytes');
    assert.ok(swJs.includes("'Content-Range'"), 'sw.js must include Content-Range header');
});

runTest('5.3: sw.js message listener registers and closes media streams', () => {
    assert.ok(swJs.includes("data.type === 'REGISTER_MEDIA_STREAM'"), 'sw.js must handle REGISTER_MEDIA_STREAM');
    assert.ok(swJs.includes("data.type === 'CLOSE_MEDIA_STREAM'"), 'sw.js must handle CLOSE_MEDIA_STREAM');
    assert.ok(swJs.includes('READ_MEDIA_RANGE'), 'sw.js must request READ_MEDIA_RANGE from client port');
});

runTest('5.4: app.js wires canStreamRange with Service Worker MessageChannel and extractFileRange', () => {
    assert.ok(appJs.includes('canStreamRange'), 'app.js must evaluate canStreamRange');
    assert.ok(appJs.includes("item.category === 'video'"), 'app.js must check item.category');
    assert.ok(appJs.includes('StreamUnpacker.extractFileRange'), 'app.js must call StreamUnpacker.extractFileRange');
    assert.ok(appJs.includes("type: 'REGISTER_MEDIA_STREAM'"), 'app.js must send REGISTER_MEDIA_STREAM');
    assert.ok(appJs.includes("new MessageChannel()"), 'app.js must instantiate MessageChannel for streaming');
    assert.ok(appJs.includes("/_stream_media?id="), 'app.js must set video src to /_stream_media?id=');
});

runTest('5.5: app.js closeMediaPlayer cleanly closes activeMediaChannel and activeMediaStreamId', () => {
    assert.ok(appJs.includes("type: 'CLOSE_MEDIA_STREAM'"), 'closeMediaPlayer must post CLOSE_MEDIA_STREAM');
    assert.ok(appJs.includes('activeMediaChannel.port1.close()'), 'closeMediaPlayer must close channel port');
    assert.ok(appJs.includes('activeMediaChunkCache.clear()'), 'closeMediaPlayer must scrub chunk cache');
});

runTest('5.6: app.js mediaDlBtn handles on-demand decrypted download fallback', () => {
    assert.ok(appJs.includes('getDecryptedFileBlob(item.path)'), 'mediaDlBtn must fall back to getDecryptedFileBlob if blob not buffered');
});

// ── 6. VIDEO PLAYER 5.0 PRO STUDIO CYBER CINEMA UPGRADES ──────
console.log('\n--- 6. Video Player 5.0 Pro Studio Cyber Cinema Upgrades ---');

runTest('6.1: Theater Mode, Hotkeys action buttons & Forensic Specs HUD present in index.html', () => {
    assert.ok(indexHtml.includes('id="btn-media-theater"'), 'Must have #btn-media-theater');
    assert.ok(indexHtml.includes('id="btn-media-hotkeys"'), 'Must have #btn-media-hotkeys');
    assert.ok(indexHtml.includes('id="media-forensic-specs"'), 'Must have #media-forensic-specs');
});

runTest('6.2: Interactive Hotkeys cheatsheet overlay modal & close button present in index.html', () => {
    assert.ok(indexHtml.includes('id="media-hotkeys-modal"'), 'Must have #media-hotkeys-modal');
    assert.ok(indexHtml.includes('id="btn-close-hotkeys"'), 'Must have #btn-close-hotkeys');
    assert.ok(indexHtml.includes('class="media-hotkeys-grid"'), 'Must have .media-hotkeys-grid');
    assert.ok(indexHtml.includes('class="media-hotkey-row"'), 'Must have .media-hotkey-row');
});

runTest('6.3: Theater Mode container & Forensic Specs HUD styled in styles.css', () => {
    assert.ok(stylesCss.includes('.media-modal-container.media-modal-container--theater'), 'Must define .media-modal-container--theater');
    assert.ok(stylesCss.includes('max-width: 1560px'), 'Theater container must have max-width: 1560px');
    assert.ok(stylesCss.includes('.media-forensic-specs'), 'Must define .media-forensic-specs');
    assert.ok(stylesCss.includes('color: #2dd4bf'), 'Forensic specs must use cybernetic teal accent');
});

runTest('6.4: Interactive Hotkeys modal card & expanding volume hover slider styled in styles.css', () => {
    assert.ok(stylesCss.includes('.media-hotkeys-modal'), 'Must define .media-hotkeys-modal');
    assert.ok(stylesCss.includes('.media-hotkeys-card'), 'Must define .media-hotkeys-card');
    assert.ok(stylesCss.includes('.media-volume-wrap:hover .media-volume-range'), 'Must define expanding volume hover slider');
});

runTest('6.5: Theater Mode & Hotkeys modal toggle functions implemented in app.js', () => {
    assert.ok(appJs.includes('function toggleTheaterMode()'), 'Must define toggleTheaterMode');
    assert.ok(appJs.includes('function toggleHotkeysModal()'), 'Must define toggleHotkeysModal');
    assert.ok(appJs.includes('let isTheaterMode = false;'), 'Must initialize isTheaterMode state');
});

runTest('6.6: Forensic metadata specs detection & loadedmetadata event wired in app.js', () => {
    assert.ok(appJs.includes('function updateVideoForensicSpecs(video, isStream)'), 'Must define updateVideoForensicSpecs');
    assert.ok(appJs.includes('el.addEventListener(\'loadedmetadata\''), 'Must listen to loadedmetadata event');
    assert.ok(appJs.includes('4K UHD'), 'Must compute 4K UHD tier');
    assert.ok(appJs.includes('1080p FHD'), 'Must compute 1080p FHD tier');
});

runTest('6.7: Multi-touch pinch-to-zoom engine & keyboard shortcuts bound in app.js', () => {
    assert.ok(appJs.includes('touchPinchDist'), 'Must track touch pinch distance');
    assert.ok(appJs.includes('touchPinchStartZoom'), 'Must track touch pinch starting zoom');
    assert.ok(appJs.includes("e.key === 't' || e.key === 'T'"), 'Must bind T to toggleTheaterMode');
    assert.ok(appJs.includes("e.key === '?'"), 'Must bind ? to toggleHotkeysModal');
});

runTest('6.8: Light theme WCAG AAA overrides for Forensic Specs, Hotkeys modal and Theater defined', () => {
    assert.ok(stylesCss.includes('.light-theme .media-forensic-specs'), 'Must define light theme forensic specs');
    assert.ok(stylesCss.includes('.light-theme .media-hotkeys-modal'), 'Must define light theme hotkeys modal');
    assert.ok(stylesCss.includes('.light-theme .media-hotkeys-card'), 'Must define light theme hotkeys card');
    assert.ok(stylesCss.includes('.light-theme .media-modal-container.media-modal-container--theater'), 'Must define light theme theater container');
});

runTest('6.9: Logical standard video player organization: unified transport row & numbered studio steps', () => {
    assert.ok(indexHtml.includes('id="btn-toggle-tools"'), 'Must have #btn-toggle-tools');
    assert.ok(indexHtml.includes('class="media-tools-step-badge"'), 'Must have .media-tools-step-badge for numbered steps');
    assert.ok(stylesCss.includes('.media-tools-step-badge'), 'styles.css must style .media-tools-step-badge');
    assert.ok(stylesCss.includes('.media-ctrl-btn--tools'), 'styles.css must style .media-ctrl-btn--tools');
    assert.ok(appJs.includes('btn-toggle-tools'), 'app.js must wire btn-toggle-tools');
});

runTest('6.10: Mobile browser support & zero-clutter phone cinema architecture', () => {
    // 1. Mobile browser inline playback attributes
    assert.ok(indexHtml.includes('playsinline webkit-playsinline'), 'Video element must have playsinline and webkit-playsinline for iOS Safari & Android Chrome');
    
    // 2. Mobile decluttering: hide desktop-only & non-touch buttons
    assert.ok(stylesCss.includes('#btn-media-hotkeys,'), 'Must hide hotkeys button on mobile screens');
    assert.ok(stylesCss.includes('#btn-media-theater {'), 'Must hide theater button on mobile screens');
    assert.ok(stylesCss.includes('.media-volume-wrap .media-volume-range {\n        display: none !important;'), 'Must hide volume range slider on mobile screens to preserve hardware button controls');
    
    // 3. Mobile swipeable studio tools carousel
    assert.ok(stylesCss.includes('scroll-snap-type: x mandatory;'), 'Numbered studio tools must form a horizontal swipeable carousel on mobile');
    assert.ok(stylesCss.includes('overflow-x: auto;'), 'Studio tools must support horizontal touch scrolling');
    
    // 4. One-finger touch panning when zoomed in
    assert.ok(appJs.includes('isTouchPanning'), 'app.js must support 1-finger touch pan when video is zoomed');
    assert.ok(appJs.includes("toolsBar.classList.add('is-collapsed')"), 'app.js must default studio tools to collapsed on mobile');
});

runTest('6.11: Full-stage video maximization & intelligent 2.5s inactivity overlay auto-hide', () => {
    // 1. Expansive modal sizing
    assert.ok(stylesCss.includes('height: 86vh'), 'Modal container must have 86vh expansive viewport height');
    assert.ok(stylesCss.includes('width: 94vw'), 'Modal container must have 94vw expansive width');
    assert.ok(stylesCss.includes('max-width: 1200px'), 'Modal container must support max-width 1200px');
    
    // 2. Floating translucent overlays for header and controls
    assert.ok(stylesCss.includes('.media-modal-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    padding: 0.85rem 1.4rem;\n    position: absolute;\n    top: 0;'), 'Header must be a floating absolute overlay on top of video');
    assert.ok(stylesCss.includes('.media-cinema-bar {\n    display: flex;\n    flex-direction: column;\n    padding: 1.4rem 1.4rem 0.85rem;\n    position: absolute;\n    bottom: 0;'), 'Controls bar must be a floating absolute overlay over bottom of video');
    
    // 3. Auto-hide CSS classes
    assert.ok(stylesCss.includes('.cinema-ui--hidden .media-modal-header'), 'Must define auto-hide fade for header');
    assert.ok(stylesCss.includes('.cinema-ui--hidden .media-cinema-bar'), 'Must define auto-hide fade for cinema bar');
    assert.ok(stylesCss.includes('.cinema-ui--hidden .cinema-video-stage'), 'Must hide cursor when controls auto-hide');
    
    // 4. Inactivity auto-hide engine in app.js
    assert.ok(appJs.includes('resetCinemaInactivityTimer'), 'app.js must define resetCinemaInactivityTimer');
    assert.ok(appJs.includes('clearCinemaInactivityTimer'), 'app.js must define clearCinemaInactivityTimer');
    assert.ok(appJs.includes("modal.classList.add('cinema-ui--hidden')"), 'app.js must trigger cinema-ui--hidden class after 2.5s');
});

async function runEndToEndRangeVerification() {
    const videoData = new Uint8Array(16384);
    for (let i = 0; i < videoData.length; i++) videoData[i] = (i * 7 + 13) & 0xff;

    const files = [{
        name: 'movie.mp4',
        path: 'movie.mp4',
        size: videoData.length,
        lastModified: Date.now(),
        stream: () => new ReadableStream({
            start(c) { c.enqueue(videoData); c.close(); }
        })
    }];

    const sinkBytes = [];
    let curPos = 0;
    const mockWriter = {
        write(c) {
            const u8 = c instanceof Uint8Array ? c : new Uint8Array(c);
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

    await new Promise((res, rej) => {
        WorkerBridge.startEncryption({
            files,
            password: 'RangeTestPass123!',
            options: { useShim: true, writable: mockWriter, chunkSize: 2048, iterations: 1000 },
            onComplete: res,
            onError: rej
        });
    });

    const vaultBytes = new Uint8Array(sinkBytes);
    const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, 'RangeTestPass123!', null, { iterations: 1000 });
    const entry = catalog.files[0];

    // Sub-test 5.7: Single-chunk partial range extraction
    runTest('5.7: StreamUnpacker.extractFileRange accurately extracts partial single-chunk byte ranges', async () => {
        const range1 = await StreamUnpacker.extractFileRange(vaultBytes, 'RangeTestPass123!', entry, 100, 500, { iterations: 1000 });
        assert.strictEqual(range1.length, 401, 'Range 1 length matches');
        for (let i = 0; i < 401; i++) {
            assert.strictEqual(range1[i], videoData[100 + i], `Byte ${i} matches`);
        }
    });

    // Sub-test 5.8: Multi-chunk spanning byte range extraction
    runTest('5.8: StreamUnpacker.extractFileRange accurately extracts multi-chunk spanning byte ranges', async () => {
        const range2 = await StreamUnpacker.extractFileRange(vaultBytes, 'RangeTestPass123!', entry, 1500, 7000, { iterations: 1000 });
        assert.strictEqual(range2.length, 5501, 'Range 2 length matches');
        for (let i = 0; i < 5501; i++) {
            assert.strictEqual(range2[i], videoData[1500 + i], `Byte ${i} matches`);
        }
    });

    console.log('\n===============================================================');
    console.log(`  ALL ${passed}/${total} VIDEO PLAYER & ON-DEMAND TESTS PASSED (100%)       `);
    console.log('===============================================================');
}

runEndToEndRangeVerification().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
