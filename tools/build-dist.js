#!/usr/bin/env node
/**
 * ZevSafe — Production Distribution Builder (tools/build-dist.js)
 *
 * Assembles a clean, clutter-free production build in `dist/` for Cloudflare Pages.
 * Excludes internal markdown files, audit reports, test runners, and archives.
 * Preserves plain static site ergonomics without bundling or minification.
 *
 * Usage:
 *   node tools/build-dist.js
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

console.log('🛡️  ZevSafe Production Distribution Builder');
console.log(`Target: ${DIST_DIR}`);

// 1. Clean or create dist directory
if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. Production file whitelist (individual root files)
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

// 3. Production directory whitelist
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

// Helper: recursive copy excluding internal *.md, test files, and dotfiles
function copyDirFiltered(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(destDir, { recursive: true });

    const items = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const item of items) {
        const srcPath = path.join(srcDir, item.name);
        const destPath = path.join(destDir, item.name);

        // Skip internal markdown (except future-plans which is a published roadmap doc), tests, hidden files
        if (item.name.endsWith('.md') && !srcPath.includes('future-plans')) continue;
        if (item.name.startsWith('.')) continue;
        if (item.name.includes('.test.') || item.name.includes('.spec.')) continue;

        if (item.isDirectory()) {
            copyDirFiltered(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Copy root files
let copiedFileCount = 0;
for (const file of ROOT_FILES) {
    const src = path.join(ROOT_DIR, file);
    const dest = path.join(DIST_DIR, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        copiedFileCount++;
    }
}

// Copy directories
for (const dir of DIRS_TO_COPY) {
    const src = path.join(ROOT_DIR, dir);
    const dest = path.join(DIST_DIR, dir);
    copyDirFiltered(src, dest);
}

console.log(`✅ Production build complete in dist/ (${copiedFileCount} root files + whitelisted directories).`);
console.log('🚫 Excluded: *.md, test/, archive/, docs/, .agents/');
