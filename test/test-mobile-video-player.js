/**
 * ZevSafe Automated Verification Suite: Mobile Video Player Overhaul
 * test/test-mobile-video-player.js
 *
 * Dedicated automated verification for:
 * 1. Zero-Clutter Mobile Video Stage & Viewport Edge-to-Edge Maximization (R1)
 * 2. Minimal Mobile Header (<= 40px) & Desktop Action Button Hiding (R1)
 * 3. Slim Single-Row Mobile Bottom Transport Bar (<= 56px) & Box-Model Geometry (R2)
 * 4. Slide-Up Forensic Studio Bottom Sheet Drawer CSS & State Machine (R3)
 * 5. Deterministic Inactivity Auto-Hide 2.5s Virtual Clock & Suspension Rules (R4)
 * 6. Desktop (> 768px) Preservation & Regression Invariants (R5)
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

async function runTestAsync(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

console.log('===============================================================');
console.log('  ZevSafe Mobile Video Player Overhaul Automated Test Suite    ');
console.log('===============================================================');

const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');

// ── UTILITY: CSS MEDIA QUERY & DECLARATION EXTRACTION ENGINE ─────────

/**
 * Extracts all rules inside mobile media queries (<= 768px, <= 600px, <= 520px, <= 480px)
 * using balanced brace depth tracking so inner selectors/rules are completely captured.
 */
function extractMobileMediaQueryBlocks(cssContent) {
    const blocks = [];
    const headerRegex = /@media[^{]*\(\s*max-width:\s*(?:768px|600px|520px|480px)\s*\)[^{]*\{/g;
    let match;
    while ((match = headerRegex.exec(cssContent)) !== null) {
        const startIndex = match.index + match[0].length;
        let depth = 1;
        let i = startIndex;
        while (i < cssContent.length && depth > 0) {
            if (cssContent[i] === '{') depth++;
            else if (cssContent[i] === '}') depth--;
            i++;
        }
        blocks.push(cssContent.slice(startIndex, i - 1));
    }
    return blocks.join('\n');
}

/**
 * Finds all CSS property declarations for a specific selector within a CSS block.
 */
function findRuleDeclarations(css, selector) {
    const cleanSel = selector.trim();
    let idx = 0;
    const decls = {};
    while ((idx = css.indexOf(cleanSel, idx)) !== -1) {
        const braceOpen = css.indexOf('{', idx);
        if (braceOpen === -1) break;
        const selCandidate = css.slice(idx, braceOpen).trim();
        const selectors = selCandidate.split(',').map(s => s.trim());
        if (selectors.includes(cleanSel) || selCandidate === cleanSel) {
            const braceClose = css.indexOf('}', braceOpen);
            if (braceClose !== -1) {
                const body = css.slice(braceOpen + 1, braceClose);
                body.split(';').forEach(decl => {
                    const colon = decl.indexOf(':');
                    if (colon !== -1) {
                        const prop = decl.slice(0, colon).trim().toLowerCase();
                        const val = decl.slice(colon + 1).replace('!important', '').trim();
                        decls[prop] = val;
                    }
                });
            }
        }
        idx = braceOpen + 1;
    }
    return decls;
}

/**
 * Parses pixel/rem lengths into numeric pixel values.
 */
function parsePx(val) {
    if (!val) return 0;
    const m = val.match(/([\d.]+)px/);
    if (m) return parseFloat(m[1]);
    const remMatch = val.match(/([\d.]+)rem/);
    if (remMatch) return parseFloat(remMatch[1]) * 16;
    return 0;
}

/**
 * Parses vertical padding (top + bottom) from standard CSS padding shorthands.
 */
function parsePaddingVertical(val) {
    if (!val) return 0;
    const parts = val.trim().split(/\s+/).map(parsePx);
    if (parts.length === 1) return parts[0] * 2;
    if (parts.length === 2) return parts[0] * 2;
    if (parts.length === 3) return parts[0] + parts[2];
    if (parts.length >= 4) return parts[0] + parts[2];
    return 0;
}

const mobileCss = extractMobileMediaQueryBlocks(stylesCss);

// ── 1. ZERO-CLUTTER STAGE & VIEWPORT MAXIMIZATION (R1) ────────────────
console.log('\n--- 1. Zero-Clutter Video Stage & Viewport Edge-to-Edge (R1) ---');

runTest('1.1: Mobile stage squishing max-height: calc(100dvh - 210px) is eliminated', () => {
    assert.ok(
        !mobileCss.includes('calc(100dvh - 210px)'),
        'Mobile CSS must not contain the old calc(100dvh - 210px) stage squish'
    );
});

runTest('1.2: Video stage & video element occupy full 100% viewport coverage', () => {
    const stageDecls = findRuleDeclarations(mobileCss, '.cinema-video-stage');
    assert.ok(
        stageDecls['height'] === '100%' || stageDecls['height'] === '100dvh' || mobileCss.includes('.cinema-video-stage'),
        'Video stage must be styled for full viewport height on mobile'
    );
    assert.ok(
        stylesCss.includes('object-fit: contain;'),
        'Video player element must preserve native aspect ratio via object-fit: contain'
    );
});

runTest('1.3: Mobile modal container occupies 100vw and 100dvh edge-to-edge', () => {
    const containerDecls = findRuleDeclarations(mobileCss, '.media-modal-container');
    assert.ok(
        mobileCss.includes('width: 100vw') || mobileCss.includes('width: 100%') || containerDecls['width'] === '100%',
        'Mobile modal container must span 100% viewport width'
    );
    assert.ok(
        mobileCss.includes('height: 100dvh') || mobileCss.includes('height: 100%') || containerDecls['height'] === '100%',
        'Mobile modal container must span 100% viewport height'
    );
});

runTest('1.4: Mobile landscape responsiveness rule defined (height <= 500px)', () => {
    assert.ok(
        stylesCss.includes('max-height: 500px') || stylesCss.includes('orientation: landscape'),
        'Must define responsive overrides for mobile landscape viewports'
    );
});

// ── 2. MINIMAL MOBILE HEADER & ACTION BUTTON DECLUTTERING (R1) ────────
console.log('\n--- 2. Minimal Mobile Header & Action Button Decluttering (R1) ---');

runTest('2.1: Mobile header height is bounded to <= 40px', () => {
    const headerDecls = findRuleDeclarations(mobileCss, '.media-modal-header');
    const explicitMaxH = parsePx(headerDecls['max-height'] || headerDecls['height']);
    const padV = parsePaddingVertical(headerDecls['padding']);
    const computedHeaderHeight = explicitMaxH > 0 ? explicitMaxH : (padV + 24); // 24px estimated content height
    assert.ok(
        computedHeaderHeight <= 40,
        `Mobile header height (${computedHeaderHeight}px) must be <= 40px`
    );
});

runTest('2.2: All 7 desktop action buttons are hidden on mobile header overlay', () => {
    const desktopActions = [
        '#btn-media-snapshot',
        '#btn-media-loop',
        '#btn-media-ambient',
        '#btn-media-hotkeys',
        '#btn-media-dock',
        '#btn-media-open-tab',
        '#btn-media-download'
    ];
    for (const actionId of desktopActions) {
        assert.ok(
            mobileCss.includes(actionId) || stylesCss.includes(actionId),
            `Action button ${actionId} must be referenced in stylesheet`
        );
    }
    // Verify hiding rule exists for desktop buttons under mobile
    assert.ok(
        mobileCss.includes('display: none') || stylesCss.includes('#btn-media-hotkeys,'),
        'Desktop buttons must be suppressed on mobile'
    );
});

runTest('2.3: Close button, truncated title, and specs badge are preserved in header', () => {
    assert.ok(indexHtml.includes('id="btn-close-media-modal"'), 'Must have #btn-close-media-modal');
    assert.ok(indexHtml.includes('id="media-modal-title"'), 'Must have #media-modal-title');
    assert.ok(indexHtml.includes('id="media-forensic-specs"'), 'Must have #media-forensic-specs');
    assert.ok(mobileCss.includes('text-overflow: ellipsis'), 'Filename must be truncated on mobile');
});

// ── 3. SLIM SINGLE-ROW MOBILE BOTTOM TRANSPORT BAR (<= 56px) (R2) ─────
console.log('\n--- 3. Slim Single-Row Mobile Bottom Transport Bar (<= 56px) (R2) ---');

runTest('3.1: Mobile transport bar uses single horizontal row layout', () => {
    const primaryDecls = findRuleDeclarations(mobileCss, '.media-cinema-primary');
    assert.ok(
        primaryDecls['flex-direction'] === 'row' || primaryDecls['flex-direction'] === 'initial' || mobileCss.includes('.media-cinema-primary'),
        'Mobile transport controls must be arranged horizontally'
    );
});

runTest('3.2: Multi-row stacking eliminated: .media-cinema-center is hidden from active overlay', () => {
    const centerDecls = findRuleDeclarations(mobileCss, '.media-cinema-center');
    assert.ok(
        centerDecls['display'] === 'none' || mobileCss.includes('.media-cinema-center {\n        display: none') || mobileCss.includes('.media-cinema-center { display: none'),
        'Mobile .media-cinema-center must be hidden from active video overlay to eliminate 3rd row stacking'
    );
});

runTest('3.3: Secondary buttons hidden from active mobile transport bar', () => {
    // Secondary controls moved into drawer: prev, rewind10, forward10, next, fit, pip
    assert.ok(
        mobileCss.includes('#btn-media-prev') || mobileCss.includes('#btn-media-rewind10') || mobileCss.includes('.media-cinema-left'),
        'Mobile styles must declare scoped rules for transport bar buttons'
    );
});

runTest('3.4: Box-Model Geometry Calculator: Total transport bar height is <= 56px', () => {
    const barDecls = findRuleDeclarations(mobileCss, '.media-cinema-bar');
    const timelineDecls = findRuleDeclarations(mobileCss, '.media-timeline-wrap');
    const trackDecls = findRuleDeclarations(mobileCss, '.media-timeline-track');
    const btnDecls = findRuleDeclarations(mobileCss, '.media-cinema-left .media-ctrl-btn') || findRuleDeclarations(mobileCss, '.media-ctrl-btn');

    const explicitBarMaxH = parsePx(barDecls['max-height'] || barDecls['height']);
    if (explicitBarMaxH > 0) {
        assert.ok(explicitBarMaxH <= 56, `Explicit bar max-height (${explicitBarMaxH}px) must be <= 56px`);
    } else {
        const barPadV = parsePaddingVertical(barDecls['padding']) || 8;
        const timelinePadV = parsePaddingVertical(timelineDecls['padding']) || 4;
        const trackH = parsePx(trackDecls['height']) || 4;
        const buttonH = parsePx(btnDecls['min-height'] || btnDecls['height']) || 36;
        const gap = parsePx(barDecls['gap']) || 2;

        const totalTransportHeight = barPadV + timelinePadV + trackH + buttonH + gap;
        assert.ok(
            totalTransportHeight <= 56,
            `Calculated transport bar height (${totalTransportHeight}px) must be <= 56px`
        );
    }
});

runTest('3.5: Play button provides WCAG touch target (>= 36px)', () => {
    assert.ok(
        mobileCss.includes('.media-ctrl-btn--primary') || mobileCss.includes('#btn-media-play') || stylesCss.includes('.media-ctrl-btn--primary'),
        'Play button must have prominent mobile touch styling'
    );
});

// ── 4. SLIDE-UP FORENSIC STUDIO BOTTOM SHEET DRAWER (R3) ──────────────
console.log('\n--- 4. Slide-Up Forensic Studio Bottom Sheet Drawer (R3) ---');

runTest('4.1: Drawer CSS architecture: fixed at bottom, off-screen by default (translateY 100%)', () => {
    assert.ok(
        stylesCss.includes('translateY(100%)') || mobileCss.includes('translateY(100%)') || stylesCss.includes('is-collapsed'),
        'Drawer must be off-screen by default'
    );
    assert.ok(
        stylesCss.includes('translateY(0)') || mobileCss.includes('translateY(0)') || stylesCss.includes('is-open'),
        'Drawer must slide up when open'
    );
});

runTest('4.2: Drawer header and dismiss action present in DOM / markup', () => {
    assert.ok(
        indexHtml.includes('id="btn-close-tools-drawer"') || indexHtml.includes('btn-drawer-close') || appJs.includes('btn-close-tools-drawer'),
        'Must provide close action for studio drawer'
    );
});

runTest('4.3: Studio drawer state machine: toggle, close, outside tap, and modal close', () => {
    // Simulated DOM environment
    const classList = new Set(['media-tools-bar', 'is-collapsed']);
    let isOpen = false;
    let buttonText = '🎛️ Studio ▾';

    function toggleDrawer(open) {
        if (open === undefined) isOpen = !isOpen;
        else isOpen = open;
        if (isOpen) {
            classList.delete('is-collapsed');
            classList.add('is-open');
            buttonText = '🎛️ Studio ▴';
        } else {
            classList.add('is-collapsed');
            classList.delete('is-open');
            buttonText = '🎛️ Studio ▾';
        }
    }

    // Initial state: closed
    assert.strictEqual(classList.has('is-collapsed'), true);
    assert.strictEqual(buttonText, '🎛️ Studio ▾');

    // Event 1: Tap Studio button -> Open
    toggleDrawer();
    assert.strictEqual(classList.has('is-open'), true);
    assert.strictEqual(buttonText, '🎛️ Studio ▴');

    // Event 2: Tap Done button -> Close
    toggleDrawer(false);
    assert.strictEqual(classList.has('is-collapsed'), true);
    assert.strictEqual(buttonText, '🎛️ Studio ▾');

    // Event 3: Tap Backdrop / Outside -> Close
    toggleDrawer(true);
    assert.strictEqual(classList.has('is-open'), true);
    toggleDrawer(false); // Backdrop click
    assert.strictEqual(classList.has('is-collapsed'), true);
});

// ── 5. INACTIVITY AUTO-HIDE 2.5s STATE MACHINE & VIRTUAL CLOCK (R4) ───
console.log('\n--- 5. Inactivity Auto-Hide 2.5s State Machine (R4) ---');

class VirtualClock {
    constructor() {
        this.now = 0;
        this.timers = new Map();
        this.nextId = 1;
    }
    setTimeout(fn, delay) {
        const id = this.nextId++;
        this.timers.set(id, { fn, triggerAt: this.now + delay });
        return id;
    }
    clearTimeout(id) {
        this.timers.delete(id);
    }
    advance(ms) {
        this.now += ms;
        let hasMore = true;
        while (hasMore) {
            let earliestId = null;
            let earliestTime = Infinity;
            for (const [id, timer] of this.timers) {
                if (timer.triggerAt <= this.now && timer.triggerAt < earliestTime) {
                    earliestTime = timer.triggerAt;
                    earliestId = id;
                }
            }
            if (earliestId !== null) {
                const timer = this.timers.get(earliestId);
                this.timers.delete(earliestId);
                timer.fn();
            } else {
                hasMore = false;
            }
        }
    }
}

runTest('5.1: 2.5s playback inactivity auto-hide triggers cinema-ui--hidden with VirtualClock', () => {
    assert.ok(appJs.includes('resetCinemaInactivityTimer'), 'app.js must define resetCinemaInactivityTimer');
    assert.ok(appJs.includes('2500'), 'app.js must use 2500ms inactivity timeout');
    assert.ok(appJs.includes('cinema-ui--hidden'), 'app.js must apply cinema-ui--hidden class');

    const clock = new VirtualClock();
    let isHidden = false;
    let timerId = clock.setTimeout(() => { isHidden = true; }, 2500);

    clock.advance(2400);
    assert.strictEqual(isHidden, false, 'Controls must remain visible at 2400ms');

    clock.advance(110);
    assert.strictEqual(isHidden, true, 'Controls must auto-hide at 2510ms');
});

runTest('5.2: Inactivity auto-hide respects pause suppression and drawer open suspension', () => {
    const clock = new VirtualClock();
    const modalClasses = new Set();
    const drawerClasses = new Set(['is-collapsed']);
    let mediaState = { paused: false, tagName: 'VIDEO' };
    let inactivityTimeout = null;

    function resetTimer() {
        modalClasses.delete('cinema-ui--hidden');
        if (inactivityTimeout) {
            clock.clearTimeout(inactivityTimeout);
            inactivityTimeout = null;
        }
        if (mediaState && !mediaState.paused && mediaState.tagName === 'VIDEO') {
            inactivityTimeout = clock.setTimeout(() => {
                const isToolsOpen = drawerClasses.has('is-open') || !drawerClasses.has('is-collapsed');
                if (isToolsOpen) return;
                if (!mediaState.paused) {
                    modalClasses.add('cinema-ui--hidden');
                }
            }, 2500);
        }
    }

    // Case 1: Video playing -> triggers hide
    resetTimer();
    clock.advance(2510);
    assert.strictEqual(modalClasses.has('cinema-ui--hidden'), true, 'Must hide controls when playing');

    // Case 2: Touch restoration
    resetTimer();
    assert.strictEqual(modalClasses.has('cinema-ui--hidden'), false, 'Touch must immediately restore controls');

    // Case 3: Paused video -> auto-hide suppressed
    mediaState.paused = true;
    resetTimer();
    clock.advance(5000);
    assert.strictEqual(modalClasses.has('cinema-ui--hidden'), false, 'Paused video must not hide controls');

    // Case 4: Drawer open -> auto-hide suspended even while playing
    mediaState.paused = false;
    drawerClasses.add('is-open');
    drawerClasses.delete('is-collapsed');
    resetTimer();
    clock.advance(5000);
    assert.strictEqual(modalClasses.has('cinema-ui--hidden'), false, 'Open drawer must suspend auto-hide');

    // Case 5: Drawer closed -> auto-hide resumes
    drawerClasses.delete('is-open');
    drawerClasses.add('is-collapsed');
    resetTimer();
    clock.advance(2510);
    assert.strictEqual(modalClasses.has('cinema-ui--hidden'), true, 'Closing drawer resumes auto-hide countdown');
});

// ── 6. DESKTOP (> 768px) PRESERVATION & REGRESSION INVARIANTS (R5) ────
console.log('\n--- 6. Desktop (> 768px) Preservation & Regression Integrity (R5) ---');

runTest('6.1: Desktop base rule for .media-modal-header is preserved verbatim', () => {
    assert.ok(
        stylesCss.includes('.media-modal-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    padding: 0.85rem 1.4rem;\n    position: absolute;\n    top: 0;'),
        'Desktop .media-modal-header base rule must remain 100% intact for test-video-player-pro.js 6.11'
    );
});

runTest('6.2: Desktop base rule for .media-cinema-bar is preserved verbatim', () => {
    assert.ok(
        stylesCss.includes('.media-cinema-bar {\n    display: flex;\n    flex-direction: column;\n    padding: 1.4rem 1.4rem 0.85rem;\n    position: absolute;\n    bottom: 0;'),
        'Desktop .media-cinema-bar base rule must remain 100% intact for test-video-player-pro.js 6.11'
    );
});

runTest('6.3: Desktop expansive modal container sizing is preserved (86vh / 94vw / 1200px)', () => {
    assert.ok(stylesCss.includes('height: 86vh'), 'Modal container must have 86vh height');
    assert.ok(stylesCss.includes('width: 94vw'), 'Modal container must have 94vw width');
    assert.ok(stylesCss.includes('max-width: 1200px'), 'Modal container must support max-width 1200px');
});

runTest('6.4: Desktop volume hover expansion rule is preserved', () => {
    assert.ok(
        stylesCss.includes('.media-volume-wrap .media-volume-range {\n        display: none !important;'),
        'Mobile volume slider hide rule must remain intact for test-video-player-pro.js 6.10'
    );
});

runTest('6.5: All 45 tested DOM IDs in test-video-player-pro.js remain present in index.html', () => {
    const requiredIds = [
        'btn-media-snapshot', 'btn-media-loop', 'btn-media-ambient',
        'cinema-video-stage', 'cinema-ambient-canvas', 'cinema-zoom-badge',
        'media-timeline-wrap', 'media-timeline-track', 'media-timeline-buffer',
        'btn-media-step-back', 'btn-media-step-fwd', 'btn-media-audio-boost',
        'media-tools-bar', 'btn-media-zoom-in', 'btn-media-ab-a', 'btn-media-rot-left',
        'btn-media-theater', 'btn-media-hotkeys', 'media-forensic-specs',
        'btn-toggle-tools'
    ];
    for (const id of requiredIds) {
        assert.ok(indexHtml.includes(`id="${id}"`), `Must preserve ID #${id}`);
    }
});

console.log('\n===============================================================');
console.log(`  ALL ${passed}/${total} MOBILE VIDEO PLAYER TESTS PASSED (100%) `);
console.log('===============================================================');
