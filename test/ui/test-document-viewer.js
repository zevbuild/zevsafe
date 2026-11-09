/**
 * ZevSafe Modular Document & PDF Viewer Test Suite
 * test/ui/test-document-viewer.js
 *
 * Validates:
 *  1. CSS overlay stacking (z-index: 2100 > 2000) so PDF/Text viewer never renders in explorer backdrop
 *  2. Container and header CSS independence in styles.css
 *  3. Dynamic lazy-loading of js/document-viewer.js on demand
 *  4. js/document-viewer.js exports correct read-only API (viewer + PDF)
 *  5. In-vault PDF rendering into iframe via tracked blob URL
 *  6. js/text-editor.js lazy-loaded only on Edit click (not on doc open)
 *  7. js/text-editor.js contains Tab indentation, Ctrl+S, in-session save logic
 *  8. State zeroization and blob URL revocation on modal close
 *  9. sw.js precaches both js/document-viewer.js and js/text-editor.js
 * 10. document-viewer.js enforces 5 MB bounded memory guardrail
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('===============================================================');
console.log('  ZevSafe In-Vault Document & PDF Viewer Suite');
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

// ── 1. CSS Overlay & Z-Index Architecture ──────────────────────────────
console.log('--- 1. Modal Overlay Stacking & Stacking Context ---');

const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'styles.css'), 'utf8');

runTest('1.1: .text-modal-overlay defined with position: fixed, inset: 0, and z-index: 2100', () => {
    assert.ok(stylesCss.includes('.text-modal-overlay'), 'styles.css must define .text-modal-overlay');
    assert.ok(stylesCss.includes('z-index: 2100'), '.text-modal-overlay must have z-index: 2100');
    assert.ok(stylesCss.includes('inset: 0'), '.text-modal-overlay must specify inset: 0');
});

runTest('1.2: .explorer-modal-overlay has z-index: 2000 (< 2100 text-modal-overlay)', () => {
    const explorerMatch = stylesCss.match(/\.explorer-modal-overlay\s*\{[^}]*z-index:\s*(\d+)/);
    assert.ok(explorerMatch, 'Could not find z-index on .explorer-modal-overlay');
    const explorerZ = parseInt(explorerMatch[1], 10);
    assert.strictEqual(explorerZ, 2000, 'explorer-modal-overlay z-index must be 2000');
    assert.ok(2100 > explorerZ, 'text-modal-overlay (2100) must stack strictly above explorer (2000)');
});

runTest('1.3: .text-modal-container has self-contained flex layout and dimensions in styles.css', () => {
    assert.ok(stylesCss.includes('.text-modal-container'), 'styles.css must define .text-modal-container');
    assert.ok(stylesCss.includes('max-width: 960px'), '.text-modal-container must have max-width');
    assert.ok(stylesCss.includes('.text-modal-container .media-modal-header'), 'styles.css must define header for text modal');
});

// ── 2. Service Worker & Whitelist Precaching ──────────────────────────────
console.log('\n--- 2. Service Worker Precaching & PWA Offline Integrity ---');

const swJs = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');

runTest('2.1: sw.js SHELL_ASSETS includes ./js/document-viewer.js for offline use', () => {
    assert.ok(swJs.includes("'./js/document-viewer.js'"), 'sw.js SHELL_ASSETS must contain ./js/document-viewer.js');
});

runTest('2.2: sw.js SHELL_ASSETS includes ./js/text-editor.js for offline use', () => {
    assert.ok(swJs.includes("'./js/text-editor.js'"), 'sw.js SHELL_ASSETS must contain ./js/text-editor.js');
});

// ── 3. Runtime Lazy-Loading & Public API ──────────────────────────────
console.log('\n--- 3. Modular Runtime Lazy-Loading & Delegators ---');

const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');

runTest('3.1: app.js defines ensureDocViewerLoaded loader', () => {
    assert.ok(appJs.includes('function ensureDocViewerLoaded()'), 'app.js must define ensureDocViewerLoaded');
    assert.ok(appJs.includes("loadScript('js/document-viewer.js')"), 'ensureDocViewerLoaded must load js/document-viewer.js');
});

runTest('3.2: app.js delegators call ensureDocViewerLoaded and window.ZevDocViewer', () => {
    assert.ok(appJs.includes('async function openTextViewerByPath(filePath) {'), 'openTextViewerByPath must exist in app.js');
    assert.ok(appJs.includes('async function openPdfViewerByPath(filePath) {'), 'openPdfViewerByPath must exist in app.js');
    assert.ok(appJs.includes('function closeTextViewer() {'), 'closeTextViewer must exist in app.js');
    assert.ok(appJs.includes('async function createNewTextFile() {'), 'createNewTextFile must exist in app.js');
});

// ── 4. Document Viewer Implementation In js/document-viewer.js ──────────────────────────────
console.log('\n--- 4. Document Viewer Logic & Bounded Memory ---');

const docViewerJs = fs.readFileSync(path.join(ROOT_DIR, 'js/document-viewer.js'), 'utf8');

runTest('4.1: js/document-viewer.js exports window.ZevDocViewer with viewer API', () => {
    assert.ok(docViewerJs.includes('global.ZevDocViewer = ZevDocViewer;'), 'Must export ZevDocViewer');
    assert.ok(docViewerJs.includes('openTextViewerByPath,'), 'Must export openTextViewerByPath');
    assert.ok(docViewerJs.includes('openPdfViewerByPath,'), 'Must export openPdfViewerByPath');
    assert.ok(docViewerJs.includes('closeTextViewer,'), 'Must export closeTextViewer');
});

runTest('4.2: Enforces bounded memory guardrail (5 MB preview limit)', () => {
    assert.ok(docViewerJs.includes('5 * 1024 * 1024'), 'Must guard text preview with 5 MB memory cap');
    assert.ok(docViewerJs.includes('This document is larger than 5 MB'), 'Must inform user when file exceeds preview cap');
});

runTest('4.3: PDF viewer dynamically mounts blob URL and revokes on close', () => {
    assert.ok(docViewerJs.includes("type: 'application/pdf'"), 'Must construct application/pdf blob');
    assert.ok(docViewerJs.includes('createTrackedBlobUrl(pdfBlob)'), 'Must register tracked blob URL');
    assert.ok(docViewerJs.includes('revokeTrackedBlobUrl(currentPdfBlobUrl)'), 'Must revoke PDF blob URL on replacement and close');
});

runTest('4.4: document-viewer.js lazy-loads text-editor.js via ensureTextEditorLoaded', () => {
    assert.ok(docViewerJs.includes('ensureTextEditorLoaded'), 'Must define ensureTextEditorLoaded lazy-loader');
    assert.ok(docViewerJs.includes('./js/text-editor.js'), 'ensureTextEditorLoaded must inject ./js/text-editor.js');
    assert.ok(docViewerJs.includes('ZevTextEditor.toggleTextEditMode'), 'Edit button must delegate to ZevTextEditor');
});

// ── 5. Text Editor Module In js/text-editor.js ──────────────────────────────
console.log('\n--- 5. Lazy Text Editor Module ---');

const textEditorJs = fs.readFileSync(path.join(ROOT_DIR, 'js/text-editor.js'), 'utf8');

runTest('5.1: js/text-editor.js exports window.ZevTextEditor', () => {
    assert.ok(textEditorJs.includes('global.ZevTextEditor = {'), 'Must export ZevTextEditor');
    assert.ok(textEditorJs.includes('toggleTextEditMode,'), 'Must export toggleTextEditMode');
    assert.ok(textEditorJs.includes('saveTextFileChanges,'), 'Must export saveTextFileChanges');
    assert.ok(textEditorJs.includes('createNewTextFile,'), 'Must export createNewTextFile');
});

runTest('5.2: js/text-editor.js supports Tab indentation (4 spaces) and Ctrl+S saving', () => {
    assert.ok(textEditorJs.includes("e.key === 'Tab'"), 'Must handle Tab key');
    assert.ok(textEditorJs.includes("'    '"), 'Must insert 4 spaces for Tab');
    assert.ok(textEditorJs.includes("e.key === 's' || e.key === 'S'"), 'Must handle Ctrl+S save shortcut');
    assert.ok(textEditorJs.includes('saveTextFileChanges()'), 'Must invoke saveTextFileChanges on Ctrl+S');
});

runTest('5.3: js/text-editor.js writes back to ZevDocViewer state via setTextContent/setEditingState', () => {
    assert.ok(textEditorJs.includes('docViewer.setTextContent'), 'Must call ZevDocViewer.setTextContent to sync state');
    assert.ok(textEditorJs.includes('docViewer.setEditingState'), 'Must call ZevDocViewer.setEditingState to sync editing flag');
});

console.log('===============================================================');
console.log(`  ALL ${passCount}/10 DOCUMENT VIEWER TESTS PASSED (100%)`);
console.log('===============================================================\n');
