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
const { execSync } = require('child_process');
const {
    ROOT_FILES,
    DIRS_TO_COPY,
    isDistFileAllowed
} = require('./shared-whitelist.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

console.log('🛡️  ZevSafe Production Distribution Builder');
console.log(`Target: ${DIST_DIR}`);

// 0. Pre-build check: Verify sw.js is fully synchronized
console.log('🔍 Checking Service Worker precache manifest synchronization...');
try {
    execSync('node tools/build-sw.js --check', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch (err) {
    console.error('❌ Service Worker check failed. Please run `node tools/build-sw.js` and try again.');
    process.exit(1);
}

// 1. Clean or create dist directory
if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// Helper: recursive copy using shared whitelist filter
function copyDirFiltered(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(destDir, { recursive: true });

    const items = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const item of items) {
        const srcPath = path.join(srcDir, item.name);
        const destPath = path.join(destDir, item.name);
        const relPath = path.relative(ROOT_DIR, srcPath);

        if (!isDistFileAllowed(relPath)) continue;

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
