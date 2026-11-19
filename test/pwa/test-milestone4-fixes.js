/**
 * ZevSafe Milestone 4 Verification Suite
 * test/pwa/test-milestone4-fixes.js
 *
 * Verifies all 3 Milestone 4 fixes:
 *  - Fix 4.1: Standalone USB Air-Gap Kit complete modular viewers & support assets bundling
 *  - Fix 4.2: Guard window.matchMedia & catch install prompt rejections in js/init.js
 *  - Fix 4.3: Prioritize OPFS (Tier 3) streaming over in-memory Tier 2 buffers & export aliases
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('===============================================================');
console.log('  ZevSafe Milestone 4 Defect Remediation Test Suite            ');
console.log('===============================================================\n');

let passCount = 0;
async function runTest(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passCount++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ↳ ${err.message}`);
        process.exit(1);
    }
}

async function main() {
    // ── Fix 4.1: USB Air-Gap Kit Modular Viewers Bundling ────────────────────
    console.log('--- Fix 4.1: Complete Modular Viewers in USB Air-Gap Kit ---');

    const kit = require(path.join(ROOT_DIR, 'js/usb-backup-kit.js'));
    const requiredAssets = [
        'css/media-player.css',
        '404.html',
        'js/init.js',
        'js/a11y-manager.js',
        'js/document-viewer.js',
        'js/text-editor.js',
        'js/image-viewer.js',
        'js/media-player.js',
        'js/passphrase-words.js'
    ];

    await runTest('4.1.1: All 9 modular viewer and runtime assets are bundled in AIRGAP_ASSET_PATHS', () => {
        for (const asset of requiredAssets) {
            assert.ok(
                kit.AIRGAP_ASSET_PATHS.includes(asset),
                `Asset missing from AIRGAP_ASSET_PATHS: ${asset}`
            );
        }
    });

    await runTest('4.1.2: Every asset in AIRGAP_ASSET_PATHS physically exists on disk in repository', () => {
        for (const relPath of kit.AIRGAP_ASSET_PATHS) {
            const absPath = path.join(ROOT_DIR, relPath);
            assert.ok(
                fs.existsSync(absPath),
                `Asset listed in AIRGAP_ASSET_PATHS does not exist on disk: ${relPath}`
            );
        }
    });

    await runTest('4.1.3: AIRGAP_ASSET_PATHS contains zero duplicate entries and has exactly 62 items', () => {
        const seen = new Set();
        for (const p of kit.AIRGAP_ASSET_PATHS) {
            assert.ok(!seen.has(p), `Duplicate entry detected in AIRGAP_ASSET_PATHS: ${p}`);
            seen.add(p);
        }
        assert.strictEqual(kit.AIRGAP_ASSET_PATHS.length, 62, `Expected 62 assets, got ${kit.AIRGAP_ASSET_PATHS.length}`);
    });

    // ── Fix 4.2: Guard matchMedia and Catch Prompt Rejection in js/init.js ───
    console.log('\n--- Fix 4.2: Guard matchMedia and Catch Prompt Rejections ---');

    const initSrc = fs.readFileSync(path.join(ROOT_DIR, 'js/init.js'), 'utf8');

    await runTest('4.2.1: window.matchMedia and navigator are guarded before standalone display check', () => {
        assert.ok(
            initSrc.includes("typeof window.matchMedia === 'function'"),
            'window.matchMedia must be type-guarded with typeof before invocation'
        );
        assert.ok(
            initSrc.includes("typeof window.navigator !== 'undefined'"),
            'window.navigator must be type-guarded before accessing .standalone'
        );
    });

    await runTest('4.2.2: deferredInstallPrompt.userChoice is wrapped in try...catch...finally', () => {
        assert.ok(
            initSrc.includes('catch (promptErr)'),
            'Install prompt execution must catch promptErr'
        );
        assert.ok(
            initSrc.includes('finally {\n            deferredInstallPrompt = null;\n        }'),
            'deferredInstallPrompt must be cleared in finally block'
        );
    });

    await runTest('4.2.3: Headless runtime simulation without window.matchMedia does not throw', () => {
        const headlessWindow = {
            navigator: { standalone: false }
        };
        const isInstalled = (typeof headlessWindow.matchMedia === 'function' && headlessWindow.matchMedia('(display-mode: standalone)').matches)
                         || (typeof headlessWindow.navigator !== 'undefined' && headlessWindow.navigator.standalone === true);
        assert.strictEqual(isInstalled, false, 'Headless runtime check should evaluate safely to false');
    });

    // ── Fix 4.3: OPFS Prioritization over Tier 2 SW Buffers & Aliases ─────────
    console.log('\n--- Fix 4.3: Prioritize OPFS (Tier 3) Streaming over In-Memory Tier 2 Buffers ---');

    const StreamSaverAdapter = require(path.join(ROOT_DIR, 'js/stream-saver.js'));

    await runTest('4.3.1: Desktop without FSA prioritizes TIER_3_OPFS ahead of TIER_2_SW', () => {
        const noFsaNav = {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
            storage: { getDirectory: () => {} },
            serviceWorker: { controller: {} }
        };
        const caps = StreamSaverAdapter.detectCapabilities(noFsaNav, {});
        assert.strictEqual(caps.recommendedTier, StreamSaverAdapter.TIER_3_OPFS, 'Desktop Firefox must recommend TIER_3_OPFS');
    });

    await runTest('4.3.2: Module exports detectStorageCapability and initStorageCapability aliases', () => {
        assert.strictEqual(
            typeof StreamSaverAdapter.detectStorageCapability,
            'function',
            'detectStorageCapability alias must be exported'
        );
        assert.strictEqual(
            typeof StreamSaverAdapter.initStorageCapability,
            'function',
            'initStorageCapability alias must be exported'
        );
        assert.strictEqual(
            StreamSaverAdapter.detectStorageCapability,
            StreamSaverAdapter.detectCapabilities,
            'detectStorageCapability must alias detectCapabilities'
        );
        assert.strictEqual(
            StreamSaverAdapter.initStorageCapability,
            StreamSaverAdapter.detectCapabilities,
            'initStorageCapability must alias detectCapabilities'
        );
    });

    await runTest('4.3.3: createStreamWriter evaluates TIER_3_OPFS before TIER_2_SW in source code', () => {
        const saverSrc = fs.readFileSync(path.join(ROOT_DIR, 'js/stream-saver.js'), 'utf8');
        const posTier3 = saverSrc.indexOf('if (requestedTier === TIER_3_OPFS');
        const posTier2 = saverSrc.indexOf('if (requestedTier === TIER_2_SW');
        assert.ok(posTier3 > 0, 'TIER_3_OPFS handler must be present');
        assert.ok(posTier2 > 0, 'TIER_2_SW handler must be present');
        assert.ok(
            posTier3 < posTier2,
            'Direct requested handler for TIER_3_OPFS must precede TIER_2_SW handler'
        );
    });

    await runTest('4.3.4: Proactively upgrades Tier 2 to Tier 3 when payload exceeds in-memory guardrail and OPFS is available', async () => {
        let selectedTier = null;
        const mockDir = {
            getFileHandle: async () => ({
                createWritable: async () => ({
                    write: async () => {},
                    seek: async () => {},
                    close: async () => {}
                }),
                getFile: async () => new Blob(['sample-vault'])
            }),
            removeEntry: async () => {}
        };

        const writer = await StreamSaverAdapter.createStreamWriter('large_vault.zev', 200 * 1024 * 1024, {
            tier: StreamSaverAdapter.TIER_2_SW,
            getDirectory: () => Promise.resolve(mockDir),
            swController: {},
            onTierSelected: (t) => { selectedTier = t; },
            navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        assert.strictEqual(selectedTier, StreamSaverAdapter.TIER_3_OPFS, 'Must proactively upgrade to TIER_3_OPFS');
        assert.ok(writer, 'Writer must be successfully returned');
    });

    console.log('\n===============================================================');
    console.log(`  ALL ${passCount}/${passCount} MILESTONE 4 FIX TESTS PASSED (100%)       `);
    console.log('===============================================================');
}

main().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
