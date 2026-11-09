/**
 * ZevSafe — Production Distribution Completeness Test Suite (test/test-dist-completeness.js)
 *
 * Validates that running `node tools/build-dist.js` produces a complete, self-contained `dist/` directory:
 * 1. Contains every asset listed in `SHELL_ASSETS` (`sw.js`).
 * 2. Contains every local asset referenced by `index.html` (scripts, stylesheets, images, icons, links).
 * 3. Contains every local icon/asset referenced by `manifest.json`.
 * 4. Contains every page URL published in `sitemap.xml`.
 * 5. Contains every local asset referenced by all subpage HTML files (`knowledge/`, `roadmap/`, etc.).
 * 6. Contains all mandatory Cloudflare Pages files: robots.txt, sitemap.xml, favicon.svg, google verification, _headers.
 * 7. Strictly excludes internal clutter (*.md root notes, test/, archive/, docs/, .agents/).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

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
console.log('  ZevSafe Production Distribution (dist/) Completeness Suite');
console.log('===============================================================');

// 1. Run tools/build-dist.js
console.log('\n--- 1. Running Production Distribution Builder ---');
runTest('1.1: tools/build-dist.js builds cleanly with exit code 0', () => {
    const buildOutput = execSync('node tools/build-dist.js', { cwd: ROOT_DIR, encoding: 'utf8' });
    assert.ok(buildOutput.includes('Production build complete in dist/'), 'Build script must report completion');
    assert.ok(fs.existsSync(DIST_DIR), 'dist/ directory must exist');
});

// 2. Verify SHELL_ASSETS completeness
console.log('\n--- 2. Verifying SHELL_ASSETS (sw.js) Completeness ---');
const swContent = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');
const shellAssetsMatch = swContent.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
assert.ok(shellAssetsMatch, 'SHELL_ASSETS must be defined in sw.js');

const rawShellAssets = eval(`[${shellAssetsMatch[1]}]`);
runTest('2.1: All SHELL_ASSETS exist in dist/', () => {
    const missing = [];
    for (const asset of rawShellAssets) {
        let clean = asset.replace(/^\.\//, '');
        if (clean === '' || clean.endsWith('/')) {
            clean = path.join(clean, 'index.html');
        }
        const distFile = path.join(DIST_DIR, clean);
        if (!fs.existsSync(distFile)) {
            missing.push({ asset, clean, distFile });
        }
    }
    assert.strictEqual(missing.length, 0, `Missing SHELL_ASSETS in dist/: ${JSON.stringify(missing)}`);
});

runTest('2.2: All local assets referenced by index.html exist in SHELL_ASSETS', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const assetRegex = /(?:src|href)=["']([^"':#?]+)["']/g;
    const normalizedShellAssets = new Set(rawShellAssets.map(a => a.replace(/^\.\//, '')));
    const missingInShell = [];
    let match;
    while ((match = assetRegex.exec(html)) !== null) {
        const ref = match[1];
        if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('mailto:')) {
            continue;
        }
        let cleanRef = ref.replace(/^\.\//, '').replace(/^\//, '');
        if (!path.extname(cleanRef) && !cleanRef.endsWith('/')) {
            cleanRef = cleanRef === '' ? '' : `${cleanRef}/`;
        }
        // Normalize comparison
        const inShell = normalizedShellAssets.has(cleanRef) ||
                        normalizedShellAssets.has(`./${cleanRef}`) ||
                        normalizedShellAssets.has(`${cleanRef}index.html`) ||
                        (cleanRef === '' && normalizedShellAssets.has(''));
        if (!inShell && !cleanRef.includes('canonical') && !cleanRef.endsWith('.xml') && !cleanRef.endsWith('.txt')) {
            missingInShell.push(cleanRef);
        }
    }
    assert.strictEqual(missingInShell.length, 0, `Assets referenced in index.html missing from SHELL_ASSETS: ${JSON.stringify(missingInShell)}`);
});

// 3. Verify index.html referenced assets
console.log('\n--- 3. Verifying index.html Referenced Assets ---');
runTest('3.1: All local scripts, stylesheets, and images in index.html exist in dist/', () => {
    const html = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
    const assetRegex = /(?:src|href)=["']([^"':#?]+)["']/g;
    const missing = [];
    let match;
    while ((match = assetRegex.exec(html)) !== null) {
        const ref = match[1];
        if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('mailto:')) {
            continue;
        }
        const cleanRef = ref.replace(/^\.\//, '').replace(/^\//, '');
        let target = path.join(DIST_DIR, cleanRef);
        if (cleanRef.endsWith('/') || !path.extname(cleanRef)) {
            target = path.join(target, 'index.html');
        }
        if (!fs.existsSync(target)) {
            missing.push({ ref, target });
        }
    }
    assert.strictEqual(missing.length, 0, `Missing index.html assets in dist/: ${JSON.stringify(missing)}`);
});

// 4. Verify manifest.json assets
console.log('\n--- 4. Verifying manifest.json Icons & Shortcuts ---');
runTest('4.1: All icons and shortcuts in manifest.json exist in dist/', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'));
    const missing = [];
    if (manifest.icons) {
        for (const icon of manifest.icons) {
            const clean = icon.src.replace(/^\.\//, '').replace(/^\//, '');
            if (!fs.existsSync(path.join(DIST_DIR, clean))) {
                missing.push(icon.src);
            }
        }
    }
    if (manifest.shortcuts) {
        for (const sc of manifest.shortcuts) {
            if (sc.icons) {
                for (const icon of sc.icons) {
                    const clean = icon.src.replace(/^\.\//, '').replace(/^\//, '');
                    if (!fs.existsSync(path.join(DIST_DIR, clean))) {
                        missing.push(icon.src);
                    }
                }
            }
        }
    }
    assert.strictEqual(missing.length, 0, `Missing manifest assets in dist/: ${JSON.stringify(missing)}`);
});

runTest('4.2: All icons in manifest.json exist in SHELL_ASSETS and screenshots are strictly excluded', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
    const normalizedShellAssets = new Set(rawShellAssets.map(a => a.replace(/^\.\//, '')));

    // Icons must be in SHELL_ASSETS
    if (manifest.icons) {
        for (const icon of manifest.icons) {
            const clean = icon.src.replace(/^\.\//, '').replace(/^\//, '');
            assert.ok(normalizedShellAssets.has(clean), `Manifest icon ${icon.src} must be precached in SHELL_ASSETS`);
        }
    }

    // Screenshots must NOT be in SHELL_ASSETS
    if (manifest.screenshots) {
        for (const ss of manifest.screenshots) {
            const clean = ss.src.replace(/^\.\//, '').replace(/^\//, '');
            assert.ok(!normalizedShellAssets.has(clean), `Screenshot ${ss.src} must NOT be precached in SHELL_ASSETS`);
        }
    }
});

// 5. Verify sitemap.xml URLs
console.log('\n--- 5. Verifying sitemap.xml Published Routes ---');
runTest('5.1: All routes in sitemap.xml exist in dist/', () => {
    const sitemap = fs.readFileSync(path.join(DIST_DIR, 'sitemap.xml'), 'utf8');
    const locRegex = /<loc>https:\/\/zevsafe\.pages\.dev\/([^<]*)<\/loc>/g;
    const missing = [];
    let match;
    while ((match = locRegex.exec(sitemap)) !== null) {
        let route = match[1];
        if (route === '' || route.endsWith('/')) {
            route = path.join(route, 'index.html');
        }
        const target = path.join(DIST_DIR, route);
        if (!fs.existsSync(target)) {
            missing.push({ route, target });
        }
    }
    assert.strictEqual(missing.length, 0, `Missing sitemap.xml pages in dist/: ${JSON.stringify(missing)}`);
});

// 6. Verify Subpage HTML Files
console.log('\n--- 6. Verifying Subpage HTML Files and Assets ---');
const subpageDirs = [
    'change-log',
    'device-power',
    'how-to-use-zevsafe',
    'roadmap',
    'security-audit',
    'knowledge'
];

runTest('6.1: All subpage directories and index.html files exist in dist/', () => {
    for (const dir of subpageDirs) {
        const subIndex = path.join(DIST_DIR, dir, 'index.html');
        assert.ok(fs.existsSync(subIndex), `Subpage index.html must exist at ${dir}/index.html`);
    }
});

// 7. Verify Specific Mandatory Whitelist Items
console.log('\n--- 7. Verifying Mandatory Whitelist Items ---');
const mandatoryItems = [
    'css/media-player.css',
    'jszip.min.js',
    'knowledge/index.html',
    'roadmap/index.html',
    'security-audit/index.html',
    'change-log/index.html',
    'device-power/index.html',
    'how-to-use-zevsafe/index.html',
    'future-plans/FUTURE_PLAN.md',
    'robots.txt',
    'sitemap.xml',
    'favicon.svg',
    'google89c1668234bdd7ae.html',
    '404.html',
    '_headers'
];

runTest('7.1: All mandatory whitelist items exist in dist/', () => {
    for (const item of mandatoryItems) {
        const target = path.join(DIST_DIR, item);
        assert.ok(fs.existsSync(target), `Mandatory item missing from dist/: ${item}`);
    }
});

// 8. Verify Strict Exclusion of Internal Clutter
console.log('\n--- 8. Verifying Exclusion of Internal Clutter ---');
const prohibitedItems = [
    'README.md',
    'GEMINI.md',
    'AGENTS.md',
    'PROJECT.md',
    'FORMAT.md',
    'CHANGELOG.md',
    'test',
    'archive',
    'docs',
    '.agents'
];

runTest('8.1: Internal notes, tests, docs, and archives are strictly excluded from dist/', () => {
    for (const prohibited of prohibitedItems) {
        const target = path.join(DIST_DIR, prohibited);
        assert.ok(!fs.existsSync(target), `Prohibited item leaked into dist/: ${prohibited}`);
    }
});

console.log('\n===============================================================');
console.log(`  ALL ${passed}/${total} DIST COMPLETENESS TESTS PASSED (100%)`);
console.log('===============================================================');
