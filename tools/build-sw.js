#!/usr/bin/env node
/**
 * ZevSafe — Service Worker & Precache Asset Generator (tools/build-sw.js)
 *
 * Responsibilities:
 *  - Generates SHELL_ASSETS and SECTION_ROUTES in sw.js using shared whitelist.
 *  - Computes deterministic SHA-256 content hash of all precached shell assets.
 *  - Formats SHELL_CACHE = `zevsafe-shell-${APP_VERSION}-${CONTENT_HASH}`.
 *  - Validates synchronization in CI/build via `--check` flag (fails if sw.js is stale).
 *  - Supports `--bump` to increment APP_VERSION and synchronize WEB-VERSION-XX in index.html.
 *
 * Usage:
 *  node tools/build-sw.js          # Updates sw.js in place
 *  node tools/build-sw.js --check  # Verifies sw.js is up to date (exit code 1 if stale)
 *  node tools/build-sw.js --bump   # Increments version, updates content hash and sw.js
 */

const fs = require('fs');
const path = require('path');
const {
    computeShellAssets,
    computeSectionRoutes,
    computeContentHash
} = require('./shared-whitelist.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const SW_PATH = path.join(ROOT_DIR, 'sw.js');
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');

const isCheck = process.argv.includes('--check');
const isBump = process.argv.includes('--bump');

function main() {
    if (!fs.existsSync(SW_PATH)) {
        console.error(`Error: Service worker file not found at ${SW_PATH}`);
        process.exit(1);
    }

    const swRaw = fs.readFileSync(SW_PATH, 'utf8');

    // 1. Determine current APP_VERSION
    const versionMatch = swRaw.match(/const\s+APP_VERSION\s*=\s*['"](v\d+)['"];/);
    if (!versionMatch) {
        console.error('Error: Could not extract APP_VERSION from sw.js');
        process.exit(1);
    }

    let currentVersion = versionMatch[1];
    let nextVersion = currentVersion;

    if (isBump) {
        const num = parseInt(currentVersion.replace('v', ''), 10);
        nextVersion = `v${num + 1}`;
        console.log(`🔄 Version bump requested: ${currentVersion} -> ${nextVersion}`);
    }

    // 2. Compute shell assets and section routes
    const shellAssets = computeShellAssets(ROOT_DIR);
    const sectionRoutes = computeSectionRoutes(ROOT_DIR);
    const contentHash = computeContentHash(ROOT_DIR, shellAssets);

    // 3. Construct updated content for sw.js
    const assetsFormatted = shellAssets.map(a => `    '${a}'`).join(',\n');
    const routesFormatted = sectionRoutes.map(r => `    '${r}'`).join(',\n');

    let updatedSw = swRaw;

    // Update APP_VERSION
    updatedSw = updatedSw.replace(
        /const\s+APP_VERSION\s*=\s*['"][^'"]+['"];/,
        `const APP_VERSION    = '${nextVersion}';`
    );

    // Update CONTENT_HASH and SHELL_CACHE
    if (updatedSw.includes('const CONTENT_HASH')) {
        updatedSw = updatedSw.replace(
            /const\s+CONTENT_HASH\s*=\s*['"][^'"]+['"];/,
            `const CONTENT_HASH   = '${contentHash}';`
        );
    } else {
        updatedSw = updatedSw.replace(
            /const\s+APP_VERSION\s*=\s*['"][^'"]+['"];\s*\nconst\s+SHELL_CACHE\s*=\s*`[^`]+`;/,
            `const APP_VERSION    = '${nextVersion}';\nconst CONTENT_HASH   = '${contentHash}';\nconst SHELL_CACHE    = \`zevsafe-shell-\${APP_VERSION}-\${CONTENT_HASH}\`;`
        );
    }

    // Update SHELL_ASSETS
    updatedSw = updatedSw.replace(
        /const\s+SHELL_ASSETS\s*=\s*\[[\s\S]*?\];/,
        `const SHELL_ASSETS = [\n${assetsFormatted}\n];`
    );

    // Update SECTION_ROUTES
    updatedSw = updatedSw.replace(
        /const\s+SECTION_ROUTES\s*=\s*\[[\s\S]*?\];/,
        `const SECTION_ROUTES = [\n${routesFormatted}\n];`
    );

    // Ensure install event does not skipWaiting unconditionally on updates
    const oldInstallBlock = `.then(() => {
                console.log(\`[ZevSafe SW] Install complete. Activating immediately.\`);
                return self.skipWaiting();
            })`;

    const safeInstallBlock = `.then(async () => {
                console.log(\`[ZevSafe SW \${APP_VERSION}] Install complete.\`);
                // Activate immediately only on first install when no clients are controlled
                const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
                if (!clientsList || clientsList.length === 0) {
                    return self.skipWaiting();
                }
                // On updates, stay in waiting until user triggers SKIP_WAITING
            })`;

    if (updatedSw.includes(oldInstallBlock)) {
        updatedSw = updatedSw.replace(oldInstallBlock, safeInstallBlock);
    }

    // Normalize newlines for strict equality check
    const normalizedDisk = swRaw.replace(/\r\n/g, '\n');
    const normalizedUpdated = updatedSw.replace(/\r\n/g, '\n');

    // 4. Handle --check mode
    if (isCheck) {
        if (normalizedDisk !== normalizedUpdated) {
            console.error('❌ sw.js is out of date with filesystem assets or whitelist!');
            console.error(`Expected CONTENT_HASH: ${contentHash}`);
            console.error(`Expected SHELL_ASSETS count: ${shellAssets.length}`);
            console.error(`Expected SECTION_ROUTES count: ${sectionRoutes.length}`);
            console.error('Run `node tools/build-sw.js` to update sw.js.');
            process.exit(1);
        } else {
            console.log(`✅ sw.js is fully synchronized (${shellAssets.length} assets, hash: ${contentHash}).`);
            process.exit(0);
        }
    }

    // 5. Write updated sw.js to disk
    fs.writeFileSync(SW_PATH, updatedSw, 'utf8');
    console.log(`✅ sw.js generated successfully!`);
    console.log(`   Version:      ${nextVersion}`);
    console.log(`   Content Hash: ${contentHash}`);
    console.log(`   Assets:       ${shellAssets.length} items precached`);
    console.log(`   Routes:       ${sectionRoutes.length} section routes`);

    // 6. If --bump, synchronize index.html WEB-VERSION tag
    if (isBump && fs.existsSync(INDEX_PATH)) {
        const nextNum = nextVersion.replace('v', '');
        let indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
        const oldTagMatch = indexHtml.match(/WEB-VERSION-(\d+)/);
        if (oldTagMatch) {
            const oldTag = oldTagMatch[0];
            const newTag = `WEB-VERSION-${nextNum}`;
            indexHtml = indexHtml.split(oldTag).join(newTag);
            fs.writeFileSync(INDEX_PATH, indexHtml, 'utf8');
            console.log(`   index.html:   Synchronized ${oldTag} -> ${newTag}`);
        }
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
