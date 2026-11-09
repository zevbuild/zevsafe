/**
 * ZevSafe — Shared Production Whitelist & Asset Manifest (tools/shared-whitelist.js)
 *
 * Single source of truth for:
 *  - Cloudflare Pages distribution builder (tools/build-dist.js)
 *  - Service Worker precache & section routing generator (tools/build-sw.js)
 *  - Completeness regression test suites (test/test-dist-completeness.js, test/test-phase5-pwa.js)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 1. Root files copied to dist/
const ROOT_FILES = [
    'index.html',
    'app.js',
    'styles.css',
    'sw.js',
    'manifest.json',
    '_headers',
    '404.html',
    'robots.txt',
    'sitemap.xml',
    'favicon.svg',
    'jszip.min.js',
    'google89c1668234bdd7ae.html'
];

// 2. Directory folders copied to dist/
const DIRS_TO_COPY = [
    'js',
    'css',
    'assets',
    'change-log',
    'device-power',
    'future-plans',
    'how-to-use-zevsafe',
    'knowledge',
    'roadmap',
    'security-audit',
    'tools'
];

// 3. Downloadable CLI tools intended for end users (precached in SW)
const PRECACHED_CLI_TOOLS = [
    './tools/encrypt.ps1',
    './tools/decrypt.ps1',
    './tools/Encrypt-Vault.bat',
    './tools/Decrypt-Vault.bat'
];

// 4. Filter function for copying files to dist/
function isDistFileAllowed(relPath) {
    const normalized = relPath.replace(/\\/g, '/');
    const base = path.basename(normalized);

    // Skip dotfiles and test files
    if (base.startsWith('.')) return false;
    if (base.includes('.test.') || base.includes('.spec.')) return false;

    // Skip internal markdown files unless in future-plans (published doc)
    if (base.endsWith('.md') && !normalized.includes('future-plans')) return false;

    return true;
}

// 5. Compute list of precached shell assets
function computeShellAssets(rootDir) {
    const assets = [];

    // Core homepage
    assets.push('./');
    assets.push('./index.html');

    // Standalone subpages
    const subpages = [
        'roadmap',
        'device-power',
        'knowledge',
        'how-to-use-zevsafe',
        'change-log',
        'security-audit'
    ];

    for (const sub of subpages) {
        assets.push(`./${sub}/`);
        assets.push(`./${sub}/index.html`);
        if (sub === 'knowledge') {
            const kCss = path.join(rootDir, 'knowledge', 'knowledge.css');
            const kJs = path.join(rootDir, 'knowledge', 'knowledge.js');
            if (fs.existsSync(kCss)) assets.push('./knowledge/knowledge.css');
            if (fs.existsSync(kJs)) assets.push('./knowledge/knowledge.js');

            // Scan knowledge subdirectories
            const kDir = path.join(rootDir, 'knowledge');
            const kEntries = fs.readdirSync(kDir, { withFileTypes: true });
            for (const kEnt of kEntries) {
                if (kEnt.isDirectory()) {
                    const subIndexPath = path.join(kDir, kEnt.name, 'index.html');
                    if (fs.existsSync(subIndexPath)) {
                        if (kEnt.name === 'airgap-usb-backup') {
                            assets.push(`./knowledge/${kEnt.name}/`);
                        }
                        assets.push(`./knowledge/${kEnt.name}/index.html`);
                    }
                }
            }
        }
    }

    // Stylesheets
    assets.push('./styles.css');
    const mediaCss = path.join(rootDir, 'css', 'media-player.css');
    if (fs.existsSync(mediaCss)) {
        assets.push('./css/media-player.css');
    }

    // App core scripts
    assets.push('./app.js');
    assets.push('./js/init.js');
    assets.push('./404.html');
    assets.push('./jszip.min.js');
    assets.push('./manifest.json');
    assets.push('./favicon.svg');

    // Assets directory (favicons, logos, icons) - EXCLUDING install screenshots
    const assetsDir = path.join(rootDir, 'assets');
    if (fs.existsSync(assetsDir)) {
        const assetFiles = fs.readdirSync(assetsDir).sort();
        for (const f of assetFiles) {
            // NEVER precache screenshots per requirement ("Do not precache them")
            if (f.toLowerCase().includes('screenshot')) continue;
            if (f.startsWith('.')) continue;
            if (f.endsWith('.md')) continue;
            assets.push(`./assets/${f}`);
        }
    }

    // Downloadable CLI tools
    for (const tool of PRECACHED_CLI_TOOLS) {
        const localPath = path.join(rootDir, tool.replace(/^\.\//, ''));
        if (fs.existsSync(localPath)) {
            assets.push(tool);
        }
    }

    // JS modules in js/ (excluding init.js which is already added)
    const jsDir = path.join(rootDir, 'js');
    if (fs.existsSync(jsDir)) {
        const jsFiles = fs.readdirSync(jsDir).sort();
        for (const f of jsFiles) {
            if (f === 'init.js') continue;
            if (f.endsWith('.js') && !f.includes('.test.') && !f.includes('.spec.')) {
                assets.push(`./js/${f}`);
            }
        }
    }

    // Deduplicate while preserving order
    return Array.from(new Set(assets));
}

// 6. Compute SECTION_ROUTES
function computeSectionRoutes(rootDir) {
    const routes = [
        'roadmap',
        'master-plan',
        'device-power',
        'know-your-device-power',
        'how-to-use-zevsafe',
        'change-log',
        'security-audit',
        'knowledge'
    ];

    const kDir = path.join(rootDir, 'knowledge');
    if (fs.existsSync(kDir)) {
        const kEntries = fs.readdirSync(kDir, { withFileTypes: true });
        for (const kEnt of kEntries) {
            if (kEnt.isDirectory()) {
                const subIndexPath = path.join(kDir, kEnt.name, 'index.html');
                if (fs.existsSync(subIndexPath)) {
                    routes.push(`knowledge/${kEnt.name}`);
                }
            }
        }
    }

    return routes;
}

// 7. Compute deterministic content hash of all precached files (cross-platform LF normalization)
function computeContentHash(rootDir, shellAssets) {
    const hash = crypto.createHash('sha256');
    const textExts = new Set([
        '.html', '.js', '.css', '.json', '.svg', '.xml', '.txt',
        '.webmanifest', '.ps1', '.bat', '.cmd', '.sh', '.md'
    ]);
    for (const asset of shellAssets) {
        // Strip leading ./ and trailing / for directory routes
        let clean = asset.replace(/^\.\//, '');
        if (clean === '' || clean.endsWith('/')) {
            clean = path.join(clean, 'index.html');
        }
        const fullPath = path.join(rootDir, clean);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            hash.update(asset);
            const ext = path.extname(clean).toLowerCase();
            let buf = fs.readFileSync(fullPath);
            if (textExts.has(ext)) {
                // Normalize CRLF to LF so content hash is deterministic across Windows, macOS, and Linux runners
                const text = buf.toString('utf8').replace(/\r\n/g, '\n');
                buf = Buffer.from(text, 'utf8');
            }
            hash.update(buf);
        }
    }
    return hash.digest('hex').slice(0, 8);
}

module.exports = {
    ROOT_FILES,
    DIRS_TO_COPY,
    PRECACHED_CLI_TOOLS,
    isDistFileAllowed,
    computeShellAssets,
    computeSectionRoutes,
    computeContentHash
};
