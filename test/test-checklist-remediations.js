/**
 * ZevSafe Checklist Remediations Automated Verification Suite
 * Verifies all 7 remediated PARTIAL checklist items and mobile drawer badge sync.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
        console.error(err);
        process.exitCode = 1;
    }
}

console.log('===============================================================');
console.log('  ZevSafe Checklist Remediations Automated Verification Suite  ');
console.log('===============================================================\n');

// 1. Item 2.15: OperationError Toast & Shake in app.js
runTest('Item 2.15: app.js invokes showToast and shakeField on OperationError', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert(
        appJs.includes("showToast('Decryption failed: Wrong password, wrong keyfile, or corrupted vault.', 'error');"),
        'app.js must call showToast with descriptive wrong password message on OperationError'
    );
    assert(
        appJs.includes("shakeField('decrypt-password');"),
        'app.js must invoke shakeField for decrypt-password on OperationError'
    );
});

// 2. Item 4.22: Global Ctrl+V clipboard paste listener references decrypt-section
runTest('Item 4.22: app.js global paste listener checks decrypt-section and visibility', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert(
        appJs.includes("document.getElementById('decrypt-section')"),
        'app.js paste listener must reference decrypt-section element'
    );
    assert(
        !appJs.includes("document.getElementById('view-decrypt')"),
        'app.js must not reference non-existent view-decrypt id'
    );
});

// 3. Item 7.25: Interactive theme toggle and localStorage persistence
runTest('Item 7.25: index.html and app.js implement theme toggle buttons and persistence', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

    assert(indexHtml.includes('id="btn-theme-toggle"'), 'index.html must contain #btn-theme-toggle in navbar');
    assert(indexHtml.includes('id="btn-theme-toggle-mobile"'), 'index.html must contain #btn-theme-toggle-mobile in mobile drawer');

    assert(appJs.includes("zevsafe_theme"), 'app.js must use zevsafe_theme localStorage key');
    assert(appJs.includes("localStorage.getItem(THEME_STORAGE_KEY)"), 'app.js must read saved theme from localStorage');
    assert(appJs.includes("localStorage.setItem(THEME_STORAGE_KEY"), 'app.js must persist theme to localStorage');

    assert(stylesCss.includes('.btn-theme-toggle'), 'styles.css must style .btn-theme-toggle');
    assert(stylesCss.includes('.btn-theme-toggle-mobile'), 'styles.css must style .btn-theme-toggle-mobile');
});

// 4. Mobile drawer Knowledge Hub badge sync
runTest('Mobile Drawer Badge: index.html synchronizes Knowledge Hub badge to current release', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert(
        !indexHtml.includes('<span class="mn-badge">v8.8.0</span>'),
        'index.html mobile drawer must not display outdated v8.8.0 badge'
    );
    assert(
        /<span class="mn-badge">v8\.\d+\.\d+<\/span>/.test(indexHtml),
        'index.html mobile drawer must display synchronized active release badge'
    );
});

// 5. Item 10.2: _headers frame-src and camera=(self)
runTest('Item 10.2: _headers contains frame-src and camera=(self) Permissions-Policy', () => {
    const headers = fs.readFileSync(path.join(__dirname, '..', '_headers'), 'utf8');
    assert(headers.includes("frame-src 'self' blob:;"), '_headers CSP must define frame-src self blob:');
    assert(headers.includes("camera=(self)"), '_headers Permissions-Policy must allow camera=(self)');
});

// 6. Item 10.11 / 10.9: WCAG AA color contrast in styles.css
runTest('Item 10.11 & 10.9: styles.css enforces WCAG AA compliant text contrast in light theme', () => {
    const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    // Dark modal surface override in light theme
    assert(
        stylesCss.includes('--text-3: #7c8ba1;'),
        'styles.css dark modal override in light theme must use #7c8ba1 (>= 4.5:1 contrast)'
    );
    assert(
        stylesCss.includes('.light-theme .mobile-tab {\n    color: #475569;'),
        'styles.css .mobile-tab in light theme must use #475569'
    );
});

// 7. Item 11.5 / 11.7: ChunkCache LRU eviction zeroization
runTest('Item 11.5 & 11.7: StreamUnpacker bounded cache zeroizes evicted chunks', () => {
    const StreamUnpacker = require('../js/stream-unpacker.js');
    assert(
        typeof StreamUnpacker.createBoundedChunkCache === 'function',
        'StreamUnpacker must export createBoundedChunkCache'
    );

    const cache = StreamUnpacker.createBoundedChunkCache(2);
    const chunk0 = new Uint8Array([1, 2, 3, 4, 5]);
    const chunk1 = new Uint8Array([6, 7, 8, 9, 10]);
    const chunk2 = new Uint8Array([11, 12, 13, 14, 15]);

    cache.set(0, chunk0);
    cache.set(1, chunk1);
    assert.strictEqual(cache.size, 2);

    // Adding 3rd chunk must evict chunk 0 and zeroize its buffer
    cache.set(2, chunk2);
    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.has(0), false);
    assert.strictEqual(cache.has(1), true);
    assert.strictEqual(cache.has(2), true);

    // Assert that chunk0 buffer was wiped with zeroes
    for (let i = 0; i < chunk0.length; i++) {
        assert.strictEqual(chunk0[i], 0, `Byte at index ${i} of evicted chunk must be zeroized`);
    }
});

// 8. Item 12.3: Open Graph and Twitter Card tags in all 17 user-facing HTML files
runTest('Item 12.3: All 17 user-facing HTML files contain Open Graph and Twitter Card tags', () => {
    const pages = [
        'index.html',
        'roadmap/index.html',
        'device-power/index.html',
        'how-to-use-zevsafe/index.html',
        'security-audit/index.html',
        'change-log/index.html',
        'knowledge/index.html',
        'knowledge/core-vault/index.html',
        'knowledge/virtual-filesystem/index.html',
        'knowledge/duress-decoy/index.html',
        'knowledge/polyglot-camouflage/index.html',
        'knowledge/health-and-salvage/index.html',
        'knowledge/media-cinema/index.html',
        'knowledge/passwords-autolock/index.html',
        'knowledge/key-derivation-2fa/index.html',
        'knowledge/mobile-streaming/index.html',
        'knowledge/airgap-usb-backup/index.html'
    ];

    for (const page of pages) {
        const fullPath = path.join(__dirname, '..', page);
        assert(fs.existsSync(fullPath), `Page ${page} must exist`);
        const content = fs.readFileSync(fullPath, 'utf8');
        assert(content.includes('property="og:title"'), `${page} must contain og:title`);
        assert(content.includes('property="og:url"'), `${page} must contain og:url`);
        assert(content.includes('property="og:image"'), `${page} must contain og:image`);
        assert(content.includes('name="twitter:card"'), `${page} must contain twitter:card`);
        assert(content.includes('name="twitter:image"'), `${page} must contain twitter:image`);
    }
});

console.log(`\n===============================================================`);
console.log(`  REMEDIATION VERIFICATION SUITE: ${passedTests}/${totalTests} PASSED`);
console.log(`===============================================================\n`);
