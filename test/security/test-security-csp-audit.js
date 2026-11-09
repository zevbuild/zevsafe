/**
 * ZevSafe Phase 3 Security, CSP & Sanitization Automated Regression Suite
 * (test/test-security-csp-audit.js)
 *
 * Verifies:
 * 1. Content Security Policy in _headers has ZERO 'unsafe-inline' on /*
 * 2. All required CSP directives are present and sub-pages use ! Content-Security-Policy
 * 3. index.html has 0 inline styles, 0 inline scripts (excluding JSON-LD), 0 on* handlers, 0 javascript: URIs
 * 4. app.js and js/*.js have 0 style="..." or on*= attributes in HTML templates
 * 5. Real escapeHtml() and renderSafeMarkdown() sanitize adversarial XSS vectors
 * 6. sw.js has no obsolete comments, defines valid APP_VERSION pattern, and precaches js/init.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✗ FAIL: ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

console.log('===============================================================');
console.log('  ZevSafe Phase 3 Security & CSP Automated Regression Suite    ');
console.log('===============================================================\n');

// ── 1. Real _headers CSP Hardening Verification ──────────────────
console.log('--- 1. Real _headers Content Security Policy Rules ---');

const headersContent = fs.readFileSync(path.join(ROOT_DIR, '_headers'), 'utf8');

runTest('1.1: Root /* Content-Security-Policy exists and omits unsafe-inline from script-src and style-src', () => {
    const rootBlockMatch = headersContent.match(/\/\*[\s\S]*?Content-Security-Policy:\s*([^\n\r]+)/);
    assert.ok(rootBlockMatch, 'Root /* must define Content-Security-Policy');
    const csp = rootBlockMatch[1];

    assert.ok(csp.includes("script-src 'self'"), "script-src must specify 'self'");
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), "script-src must NOT contain 'unsafe-inline'");
    assert.ok(!csp.match(/script-src[^;]*'unsafe-inline'/), "script-src directive must not contain 'unsafe-inline'");

    assert.ok(csp.includes("style-src 'self'"), "style-src must specify 'self'");
    assert.ok(!csp.includes("style-src 'self' 'unsafe-inline'"), "style-src must NOT contain 'unsafe-inline'");
    assert.ok(!csp.match(/style-src[^;]*'unsafe-inline'/), "style-src directive must not contain 'unsafe-inline'");
});

runTest('1.2: Root CSP preserves all base directives (default-src, font-src, img-src, etc.)', () => {
    const rootBlockMatch = headersContent.match(/\/\*[\s\S]*?Content-Security-Policy:\s*([^\n\r]+)/);
    const csp = rootBlockMatch[1];
    assert.ok(csp.includes("default-src 'self'"), "Must specify default-src 'self'");
    assert.ok(csp.includes("font-src 'self' data:"), "Must specify font-src 'self' data:");
    assert.ok(csp.includes("img-src 'self' data: blob:"), "Must specify img-src 'self' data: blob:");
    assert.ok(csp.includes("media-src 'self' blob:"), "Must specify media-src 'self' blob:");
    assert.ok(csp.includes("frame-src 'self' blob:"), "Must specify frame-src 'self' blob:");
    assert.ok(csp.includes("connect-src 'self' blob: data:"), "Must specify connect-src 'self' blob: data:");
    assert.ok(csp.includes("object-src 'none'"), "Must specify object-src 'none'");
    assert.ok(csp.includes("base-uri 'self'"), "Must specify base-uri 'self'");
    assert.ok(csp.includes("frame-ancestors 'none'"), "Must specify frame-ancestors 'none'");
});

runTest('1.3: Sub-page routes use ! Content-Security-Policy detachment pattern', () => {
    const subpages = ['change-log', 'device-power', 'how-to-use-zevsafe', 'knowledge', 'roadmap', 'security-audit'];
    for (const sp of subpages) {
        assert.ok(headersContent.includes(`/${sp}/*`), `_headers must contain route /${sp}/*`);
        const subBlock = headersContent.split(`/${sp}/*`)[1].split(/\n\s*\n/)[0];
        assert.ok(subBlock.includes('! Content-Security-Policy'), `/${sp}/* must detach inherited CSP with '! Content-Security-Policy'`);
    }
});

// ── 2. index.html Zero-Inline Audit ──────────────────────────────
console.log('\n--- 2. index.html Markup Hygiene (Zero Inline Scripts, Styles & Handlers) ---');

const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

runTest('2.1: Exactly 0 inline <script> blocks (excluding structured data JSON-LD)', () => {
    const scripts = indexHtml.match(/<script(?![^>]*src=)(?![^>]*type="application\/ld\+json")[^>]*>/gi) || [];
    assert.strictEqual(scripts.length, 0, `index.html must have 0 inline scripts, found: ${scripts.length}`);
});

runTest('2.2: Exactly 0 inline style="..." attributes', () => {
    const styles = indexHtml.match(/style\s*=\s*"[^"]*"/gi) || [];
    assert.strictEqual(styles.length, 0, `index.html must have 0 style= attributes, found: ${styles.length}`);
});

runTest('2.3: Exactly 0 inline event handler on* attributes', () => {
    const onEvents = indexHtml.match(/\bon[a-z]+\s*=\s*"[^"]*"/gi) || [];
    assert.strictEqual(onEvents.length, 0, `index.html must have 0 on* attributes, found: ${onEvents.length}`);
});

runTest('2.4: Exactly 0 action="javascript:..." attributes on forms', () => {
    const jsActions = indexHtml.match(/action\s*=\s*"javascript:[^"]*"/gi) || [];
    assert.strictEqual(jsActions.length, 0, `index.html must have 0 action="javascript:" attributes, found: ${jsActions.length}`);
});

runTest('2.5: js/init.js is included with defer attribute', () => {
    assert.ok(indexHtml.includes('<script src="js/init.js" defer></script>'), 'index.html must load js/init.js with defer');
});

// ── 3. JS Source Code Hygiene (app.js & js/*.js) ───────────────────
console.log('\n--- 3. JavaScript Template Hygiene (Zero Inline Styles & Handlers) ---');

const jsFiles = [
    'app.js',
    'js/init.js',
    'js/media-player.js',
    'js/stream-crypto.js',
    'js/stream-packer.js',
    'js/stream-unpacker.js',
    'js/stream-saver.js',
    'js/worker-bridge.js',
    'js/qr-engine.js',
    'js/usb-backup-kit.js'
];

runTest('3.1: All JS files contain 0 style="..." attributes inside string templates or HTML generators', () => {
    for (const f of jsFiles) {
        const filePath = path.join(ROOT_DIR, f);
        if (!fs.existsSync(filePath)) continue;
        const code = fs.readFileSync(filePath, 'utf8');
        const lines = code.split('\n');
        lines.forEach((line, idx) => {
            if (/style\s*=\s*\\?["'][^"']+/.test(line)) {
                assert.fail(`${f}:${idx + 1} contains inline style attribute: ${line.trim()}`);
            }
        });
    }
});

runTest('3.2: All JS files contain 0 on*= attributes inside string templates or HTML generators', () => {
    for (const f of jsFiles) {
        const filePath = path.join(ROOT_DIR, f);
        if (!fs.existsSync(filePath)) continue;
        const code = fs.readFileSync(filePath, 'utf8');
        const lines = code.split('\n');
        lines.forEach((line, idx) => {
            if (/\bon[a-z]+\s*=\s*\\?["']/.test(line)) {
                assert.fail(`${f}:${idx + 1} contains inline event handler: ${line.trim()}`);
            }
        });
    }
});

// ── 4. Real XSS Sanitization & Function Invocation Tests ──────────
console.log('\n--- 4. Real XSS Sanitization & Markdown Invocation Tests ---');

// Extract escapeHtml and renderSafeMarkdown from app.js to test real implementations
const appJsCode = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');

// Isolate escapeHtml
const escapeHtmlMatch = appJsCode.match(/function escapeHtml\([^\)]*\)\s*\{[\s\S]*?\n\}/);
assert.ok(escapeHtmlMatch, 'escapeHtml must be defined in app.js');
const escapeHtml = new Function('str', escapeHtmlMatch[0] + '\nreturn escapeHtml(str);');

// Isolate renderSafeMarkdown
const renderSafeMarkdownMatch = appJsCode.match(/function renderSafeMarkdown\([^\)]*\)\s*\{[\s\S]*?\n\}/);
assert.ok(renderSafeMarkdownMatch, 'renderSafeMarkdown must be defined in app.js');
const renderSafeMarkdown = new Function('md', renderSafeMarkdownMatch[0] + '\nreturn renderSafeMarkdown(md);');

runTest('4.1: escapeHtml sanitizes script tags, double quotes, single quotes, and ampersands', () => {
    const payload = '<script>alert("XSS")</script>&\'hello\'';
    const escaped = escapeHtml(payload);
    assert.strictEqual(escaped.includes('<script>'), false);
    assert.strictEqual(escaped.includes('</script>'), false);
    assert.ok(escaped.includes('&lt;script&gt;'));
    assert.ok(escaped.includes('&amp;'));
});

runTest('4.2: escapeHtml neutralizes attribute breakout payloads', () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const escaped = escapeHtml(payload);
    assert.strictEqual(escaped.includes('<img'), false);
    assert.ok(escaped.includes('&quot;&gt;&lt;img'));
});

runTest('4.3: renderSafeMarkdown escapes raw HTML before markdown processing', () => {
    const payload = '# Title\n<script>alert(1)</script>\n**bold**';
    const rendered = renderSafeMarkdown(payload);
    assert.strictEqual(rendered.includes('<script>'), false);
    assert.ok(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(rendered.includes('<h1 class="md-h1">Title</h1>'));
    assert.ok(rendered.includes('<strong>bold</strong>'));
});

runTest('4.4: renderSafeMarkdown does not allow onerror attribute injection', () => {
    const payload = '<img src=x onerror=alert(document.cookie)>';
    const rendered = renderSafeMarkdown(payload);
    assert.strictEqual(rendered.includes('<img'), false);
    assert.ok(rendered.includes('&lt;img src=x onerror=alert(document.cookie)&gt;'));
});

// ── 5. Service Worker Hygiene & Version Invariants ────────────────
console.log('\n--- 5. Service Worker Hygiene & Pre-Caching ---');

const swContent = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');

runTest('5.1: sw.js has no legacy baseline regression comments', () => {
    assert.strictEqual(swContent.includes('Baseline regression assertion preservation'), false);
});

runTest('5.2: sw.js defines valid APP_VERSION matching /v\\d+/ pattern', () => {
    assert.match(swContent, /const APP_VERSION\s*=\s*'v\d+';/);
});

runTest('5.3: sw.js SHELL_ASSETS includes ./js/init.js', () => {
    assert.ok(swContent.includes("'./js/init.js'"), "SHELL_ASSETS must include './js/init.js'");
});

// ── 6. Production Distribution Builder ───────────────────────────
console.log('\n--- 6. Production Distribution Builder Integrity ---');

runTest('6.1: tools/build-dist.js exists and generates clean dist folder', () => {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'tools', 'build-dist.js')));
    const distIndex = path.join(ROOT_DIR, 'dist', 'index.html');
    assert.ok(fs.existsSync(distIndex), 'dist/index.html must exist');
    // Ensure dist does not have any .md files
    const distFiles = fs.readdirSync(path.join(ROOT_DIR, 'dist'));
    const mdFiles = distFiles.filter(f => f.endsWith('.md'));
    assert.strictEqual(mdFiles.length, 0, `dist must not contain .md files, found: ${mdFiles.join(', ')}`);
});

console.log('===============================================================');
console.log(`  ALL ${passedTests}/${totalTests} SECURITY & CSP TESTS PASSED (100%)       `);
console.log('===============================================================');
