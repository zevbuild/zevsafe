/**
 * ZevSafe Milestone 2 Verification Suite
 * test/ui/test-milestone2-fixes.js
 *
 * Verifies all 7 Milestone 2 fixes:
 *  - Fix 2.1: Text Editor mode toggle and save handlers deduplication & setEditingState export
 *  - Fix 2.2: Document Viewer dirty state synchronization with ZevTextEditor & modal reset
 *  - Fix 2.3: Lightbox event listener deduplication between Media Player and Image Viewer
 *  - Fix 2.4: ServiceWorker EventTarget type guard in Media Player
 *  - Fix 2.5: Playlist path & entry synchronization on in-vault file rename
 *  - Fix 2.6: Touch drag/panning gestures on Image Lightbox & touch-action CSS
 *  - Fix 2.7: URL.revokeObjectURL fallback when revokeTrackedBlobUrl is absent
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('===============================================================');
console.log('  ZevSafe Milestone 2 Defect Remediation Test Suite            ');
console.log('===============================================================\n');

let passCount = 0;
function runTest(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passCount++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ↳ ${err.message}`);
        process.exit(1);
    }
}

// ── Fix 2.1: Text Editor Toggle & Save Deduplication ────────────────────────
console.log('--- Fix 2.1: Text Editor Mode Toggle & Save Deduplication ---');

const textEditorSrc = fs.readFileSync(path.join(ROOT_DIR, 'js/text-editor.js'), 'utf8');

runTest('2.1.1: initTextEditorUI does not bind duplicate click listeners to btn-text-edit or btn-text-save-changes', () => {
    // Delegation is handled in document-viewer.js; text-editor.js must not add its own listeners
    const initMatch = textEditorSrc.match(/function\s+initTextEditorUI\s*\(\)\s*\{([\s\S]*?)\}/);
    assert.ok(initMatch, 'initTextEditorUI function definition not found in js/text-editor.js');
    const body = initMatch[1];
    assert.ok(!body.includes("textEditBtn?.addEventListener('click'"), 'textEditBtn click listener must not be in initTextEditorUI');
    assert.ok(!body.includes("textSaveBtn?.addEventListener('click'"), 'textSaveBtn click listener must not be in initTextEditorUI');
});

runTest('2.1.2: global.ZevTextEditor exports setEditingState', () => {
    assert.ok(textEditorSrc.includes('setEditingState:'), 'ZevTextEditor must export setEditingState');
    assert.ok(textEditorSrc.includes('_isEditingText = Boolean(val)'), 'setEditingState must update _isEditingText');
});

// ── Fix 2.2: Document Dirty State Synchronization ───────────────────────────
console.log('\n--- Fix 2.2: Document Dirty State Synchronization ---');

const docViewerSrc = fs.readFileSync(path.join(ROOT_DIR, 'js/document-viewer.js'), 'utf8');

runTest('2.2.1: closeTextViewer checks both local and ZevTextEditor dirty state', () => {
    assert.ok(
        docViewerSrc.includes('const dirty = hasUnsavedChanges || Boolean(global.ZevTextEditor?.getState()?.hasUnsavedChanges);'),
        'closeTextViewer must evaluate both local and ZevTextEditor dirty flags'
    );
});

runTest('2.2.2: closeTextViewer and openTextViewerByPath reset ZevTextEditor dirty and editing states', () => {
    assert.ok(docViewerSrc.includes('global.ZevTextEditor.setUnsavedChanges(false)'), 'Must reset ZevTextEditor unsaved changes');
    assert.ok(docViewerSrc.includes('global.ZevTextEditor.setEditingState(false)'), 'Must reset ZevTextEditor editing state');
});

// ── Fix 2.3: Lightbox Event Listeners Deduplication ─────────────────────────
console.log('\n--- Fix 2.3: Lightbox Event Listeners Deduplication ---');

const mediaPlayerSrc = fs.readFileSync(path.join(ROOT_DIR, 'js/media-player.js'), 'utf8');

runTest('2.3.1: _initImageLightboxModalEvents guards against active ZevImageViewer', () => {
    assert.ok(
        mediaPlayerSrc.includes('root.ZevImageViewer && typeof root.ZevImageViewer.isLoaded === \'function\' && root.ZevImageViewer.isLoaded()'),
        '_initImageLightboxModalEvents must guard against duplicate registration when ZevImageViewer is loaded'
    );
});

// Helper to stage mock DOM environment for runtime Sequence A, Sequence B, and standalone tests
function createLightboxMockSandbox() {
    const elements = new Map();
    function getEl(id) {
        if (!elements.has(id)) {
            const listeners = {};
            elements.set(id, {
                id,
                style: {},
                dataset: {},
                classList: {
                    _c: new Set(),
                    add(c) { this._c.add(c); },
                    remove(c) { this._c.delete(c); },
                    contains(c) { return this._c.has(c); },
                    toggle(c) { if (this._c.has(c)) this._c.delete(c); else this._c.add(c); }
                },
                textContent: '',
                addEventListener(ev, fn) {
                    listeners[ev] = listeners[ev] || [];
                    listeners[ev].push(fn);
                },
                removeEventListener(ev, fn) {
                    if (listeners[ev]) listeners[ev] = listeners[ev].filter(h => h !== fn);
                },
                dispatchEvent(ev) {
                    const event = typeof ev === 'string' ? { type: ev } : ev;
                    const list = listeners[event.type] ? [...listeners[event.type]] : [];
                    for (const fn of list) fn(event);
                },
                click() {
                    this.dispatchEvent({ type: 'click', button: 0, clientX: 0, clientY: 0 });
                },
                getListenerCount(ev) {
                    return (listeners[ev] || []).length;
                },
                removeAttribute() {}
            });
        }
        return elements.get(id);
    }

    const windowListeners = {};
    const win = {
        addEventListener(ev, fn) {
            windowListeners[ev] = windowListeners[ev] || [];
            windowListeners[ev].push(fn);
        },
        removeEventListener(ev, fn) {
            if (windowListeners[ev]) windowListeners[ev] = windowListeners[ev].filter(h => h !== fn);
        },
        dispatchEvent(ev) {
            const event = typeof ev === 'string' ? { type: ev } : ev;
            const list = windowListeners[event.type] ? [...windowListeners[event.type]] : [];
            for (const fn of list) fn(event);
        }
    };
    win.window = win;

    const doc = {
        getElementById: (id) => getEl(id),
        querySelector: (sel) => getEl('container'),
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        readyState: 'complete'
    };
    win.document = doc;
    win.navigator = { serviceWorker: null };
    win.console = console;
    win.showToast = () => {};

    return { win, getEl };
}

const vm = require('vm');
const imageViewerSrc = fs.readFileSync(path.join(ROOT_DIR, 'js/image-viewer.js'), 'utf8');

runTest('2.3.2: Standalone media-player rotate click produces valid rotate(90deg) transform without NaN', () => {
    const { win, getEl } = createLightboxMockSandbox();
    vm.runInNewContext(mediaPlayerSrc, win);
    const rotateBtn = getEl('btn-image-rotate');
    const img = getEl('lightbox-image');
    assert.strictEqual(rotateBtn.getListenerCount('click'), 1, 'Standalone media-player must attach 1 click listener to rotate button');
    rotateBtn.click();
    assert.ok(img.style.transform, 'Transform must be applied to lightbox-image');
    assert.ok(!img.style.transform.includes('NaN'), `Transform must not contain NaN: "${img.style.transform}"`);
    assert.ok(img.style.transform.includes('rotate(90deg)'), `Transform must contain rotate(90deg): "${img.style.transform}"`);
});

runTest('2.3.3: Sequence A (ImageViewer first, MediaPlayer second) attaches exactly 1 listener, zoom is +0.25x and rotation is +90deg', () => {
    const { win, getEl } = createLightboxMockSandbox();
    vm.runInNewContext(imageViewerSrc, win);
    vm.runInNewContext(mediaPlayerSrc, win);
    const zoomInBtn = getEl('btn-image-zoom-in');
    const rotateBtn = getEl('btn-image-rotate');
    assert.strictEqual(zoomInBtn.getListenerCount('click'), 1, 'Sequence A must have exactly 1 zoom listener');
    assert.strictEqual(rotateBtn.getListenerCount('click'), 1, 'Sequence A must have exactly 1 rotate listener');
    zoomInBtn.click();
    assert.strictEqual(win.ZevImageViewer.getState().imageZoomLevel, 1.25, 'Zoom must increase by exactly 0.25x');
    rotateBtn.click();
    assert.strictEqual(win.ZevImageViewer.getState().imageRotationDeg, 90, 'Rotation must increase by exactly 90deg');
});

runTest('2.3.4: Sequence B (MediaPlayer first, ImageViewer second) deduplicates listeners, zoom is +0.25x and rotation is +90deg', () => {
    const { win, getEl } = createLightboxMockSandbox();
    vm.runInNewContext(mediaPlayerSrc, win);
    vm.runInNewContext(imageViewerSrc, win);
    const zoomInBtn = getEl('btn-image-zoom-in');
    const zoomOutBtn = getEl('btn-image-zoom-out');
    const zoomResetBtn = getEl('btn-image-zoom-reset');
    const rotateBtn = getEl('btn-image-rotate');
    assert.strictEqual(zoomInBtn.getListenerCount('click'), 1, 'Sequence B must deduplicate zoom listener to count 1');
    assert.strictEqual(rotateBtn.getListenerCount('click'), 1, 'Sequence B must deduplicate rotate listener to count 1');
    zoomInBtn.click();
    assert.strictEqual(win.ZevImageViewer.getState().imageZoomLevel, 1.25, 'Sequence B zoom must increase by exactly 0.25x (no double-firing)');
    zoomInBtn.click();
    assert.strictEqual(win.ZevImageViewer.getState().imageZoomLevel, 1.5, 'Sequence B second zoom must increase to 1.5');
    zoomOutBtn.click();
    assert.strictEqual(win.ZevImageViewer.getState().imageZoomLevel, 1.25, 'Sequence B zoomOut must decrease to 1.25');
    zoomResetBtn.click();
    assert.strictEqual(win.ZevImageViewer.getState().imageZoomLevel, 1.0, 'Sequence B zoomReset must reset to 1.0');
    rotateBtn.click();
    assert.strictEqual(win.ZevImageViewer.getState().imageRotationDeg, 90, 'Sequence B rotation must increase by exactly 90deg');
    const img = getEl('lightbox-image');
    assert.ok(!img.style.transform.includes('NaN'), `Sequence B transform must not contain NaN: "${img.style.transform}"`);
});

// ── Fix 2.4: Type-Guard ServiceWorker EventTarget ───────────────────────────
console.log('\n--- Fix 2.4: ServiceWorker EventTarget Type Guard ---');

runTest('2.4.1: media-player.js checks typeof navigator.serviceWorker.addEventListener', () => {
    assert.ok(
        mediaPlayerSrc.includes('typeof navigator.serviceWorker.addEventListener === \'function\''),
        'media-player.js must verify addEventListener is a function before calling it'
    );
});

// ── Fix 2.5: Synchronize Playlists on File Rename ────────────────────────────
console.log('\n--- Fix 2.5: Synchronize Playlists on File Rename ---');

const appJsSrc = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');

runTest('2.5.1: renameVaultFile updates item.entry.path and item.entry.name', () => {
    assert.ok(appJsSrc.includes('item.entry.path = newPath;'), 'item.entry.path must be updated to newPath');
    assert.ok(appJsSrc.includes("if ('name' in item.entry) item.entry.name = cleanNewName;"), 'item.entry.name must be updated');
});

runTest('2.5.2: renameVaultFile maps over currentMediaPlaylist and currentImagePlaylist', () => {
    assert.ok(appJsSrc.includes('for (const m of currentMediaPlaylist)'), 'Must iterate over currentMediaPlaylist');
    assert.ok(appJsSrc.includes('if (m.path === oldPath)'), 'Must match oldPath in media playlist');
    assert.ok(appJsSrc.includes('for (const img of currentImagePlaylist)'), 'Must iterate over currentImagePlaylist');
    assert.ok(appJsSrc.includes('if (img.path === oldPath)'), 'Must match oldPath in image playlist');
    assert.ok(appJsSrc.includes('window.currentMediaPlaylist = currentMediaPlaylist;'), 'Must sync window.currentMediaPlaylist');
    assert.ok(appJsSrc.includes('window.currentImagePlaylist = currentImagePlaylist;'), 'Must sync window.currentImagePlaylist');
});

// ── Fix 2.6: Touch Drag/Panning Gestures & CSS ──────────────────────────────
console.log('\n--- Fix 2.6: Touch Drag/Panning Gestures & CSS ---');

const mediaCss = fs.readFileSync(path.join(ROOT_DIR, 'css/media-player.css'), 'utf8');

runTest('2.6.1: image-viewer.js listens to touchstart, touchmove, touchend, touchcancel', () => {
    assert.ok(imageViewerSrc.includes("addEventListener('touchstart'"), 'imageViewport must listen to touchstart');
    assert.ok(imageViewerSrc.includes("addEventListener('touchmove'"), 'window must listen to touchmove');
    assert.ok(imageViewerSrc.includes("addEventListener('touchend'"), 'window must listen to touchend');
    assert.ok(imageViewerSrc.includes("addEventListener('touchcancel'"), 'window must listen to touchcancel');
});

runTest('2.6.2: .image-viewport has touch-action: none in CSS', () => {
    const viewportMatch = mediaCss.match(/\.image-viewport\s*\{[^}]*touch-action:\s*none;[^}]*\}/);
    assert.ok(viewportMatch, '.image-viewport must specify touch-action: none');
});

// ── Fix 2.7: URL.revokeObjectURL Fallback ────────────────────────────────────
console.log('\n--- Fix 2.7: URL.revokeObjectURL Fallback ---');

runTest('2.7.1: image-viewer.js falls back to URL.revokeObjectURL when revokeTrackedBlobUrl is absent', () => {
    const fallbackCount = (imageViewerSrc.match(/typeof URL !== 'undefined' && typeof URL\.revokeObjectURL === 'function'/g) || []).length;
    assert.strictEqual(fallbackCount, 2, 'Must have URL.revokeObjectURL fallback on both image switch and close');
});

console.log('===============================================================');
console.log(`  ALL ${passCount}/${passCount} MILESTONE 2 FIX TESTS PASSED (100%)       `);
console.log('===============================================================');
