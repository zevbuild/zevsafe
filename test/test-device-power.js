/**
 * Test Suite: Know Your Device Power - Cryptographic Hardware Benchmark & Profiler
 *
 * Verifies the benchmark engine, tier classification, recommendations,
 * and seamless PWA/Service Worker integration.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('===============================================================');
console.log('  TEST SUITE: KNOW YOUR DEVICE POWER (HARDWARE BENCHMARK)       ');
console.log('===============================================================\n');

(async function runTests() {
    // --- 1. Engine & Module Export Verification ---
    const engine = require('../js/device-benchmark.js');
    assert.strictEqual(typeof engine, 'object', 'DeviceBenchmark engine is an object');
    assert.strictEqual(typeof engine.benchmarkPbkdf2, 'function', 'benchmarkPbkdf2 is a function');
    assert.strictEqual(typeof engine.benchmarkAesGcm, 'function', 'benchmarkAesGcm is a function');
    assert.strictEqual(typeof engine.classifyHardware, 'function', 'classifyHardware is a function');
    assert.strictEqual(typeof engine.generateRecommendation, 'function', 'generateRecommendation is a function');
    assert.strictEqual(typeof engine.runFullBenchmark, 'function', 'runFullBenchmark is a function');
    console.log('  ✔ 1. DeviceBenchmark engine exports all expected API methods');

    // --- 2. Hardware Classification Matrix ---
    const classS = engine.classifyHardware({ encryptSpeedMBps: 850 }, { elapsedMs: 180 });
    assert.strictEqual(classS.id, 'S', 'Class S detected for 850 MB/s and 180 ms KDF');
    assert.strictEqual(classS.title.includes('Class S'), true, 'Class S title formatted');

    const classA = engine.classifyHardware({ encryptSpeedMBps: 520 }, { elapsedMs: 420 });
    assert.strictEqual(classA.id, 'A', 'Class A detected for 520 MB/s and 420 ms KDF');

    const classB = engine.classifyHardware({ encryptSpeedMBps: 220 }, { elapsedMs: 850 });
    assert.strictEqual(classB.id, 'B', 'Class B detected for 220 MB/s and 850 ms KDF');

    const classC = engine.classifyHardware({ encryptSpeedMBps: 90 }, { elapsedMs: 1600 });
    assert.strictEqual(classC.id, 'C', 'Class C detected for 90 MB/s and 1600 ms KDF');
    console.log('  ✔ 2. Hardware classification tiers (Class S, A, B, C) accurately certified');

    // --- 3. Dynamic Recommendation Engine ---
    const recS = engine.generateRecommendation(classS, {
        600000: { elapsedMs: 180 },
        1200000: { elapsedMs: 360 },
        2400000: { elapsedMs: 720 }
    });
    assert.strictEqual(recS.recommendedRounds, 1200000, 'Class S recommends 1.2M rounds');
    assert.strictEqual(recS.recommendedTierName.includes('Hardened'), true, 'Tier name indicates Hardened');
    assert.strictEqual(typeof recS.reason, 'string', 'Recommendation includes actionable reason');

    const recC = engine.generateRecommendation(classC, {
        600000: { elapsedMs: 1600 },
        1200000: { elapsedMs: 3200 },
        2400000: { elapsedMs: 6400 }
    });
    assert.strictEqual(recC.recommendedRounds, 600000, 'Class C recommends 600,000 rounds to prevent UI lag');
    console.log('  ✔ 3. Personalized vault recommendations correctly align with CPU capacity');

    // --- 4. Physical HTML & CSS Assets ---
    const dpHtmlPath = path.resolve(__dirname, '../device-power/index.html');
    assert.strictEqual(fs.existsSync(dpHtmlPath), true, 'device-power/index.html physically exists');

    const dpHtml = fs.readFileSync(dpHtmlPath, 'utf8');
    assert.strictEqual(dpHtml.includes('Content-Security-Policy'), true, 'Strict CSP meta tag present');
    assert.strictEqual(dpHtml.includes('https://zevsafe.pages.dev/device-power/'), true, 'Canonical URL present');
    assert.strictEqual(dpHtml.includes('id="btn-run-benchmark"'), true, 'Run benchmark button present');
    assert.strictEqual(dpHtml.includes('id="tier-badge-giant"'), true, 'Dynamic tier badge container present');
    assert.strictEqual(dpHtml.includes('id="val-enc-speed"'), true, 'Encryption throughput gauge present');
    assert.strictEqual(dpHtml.includes('id="val-dec-speed"'), true, 'Decryption throughput gauge present');
    assert.strictEqual(dpHtml.includes('id="val-kdf-latency"'), true, 'KDF latency gauge present');
    assert.strictEqual(dpHtml.includes('id="btn-mobile-nav-toggle"'), true, 'Phone-only mobile nav toggle present');
    assert.strictEqual(dpHtml.includes('id="mobile-nav-drawer"'), true, 'Mobile navigation drawer present');
    console.log('  ✔ 4. device-power/index.html UI components, CSP & mobile accessibility verified');

    // --- 5. Service Worker, PWA & Routing Verification ---
    const swPath = path.resolve(__dirname, '../sw.js');
    const sw = fs.readFileSync(swPath, 'utf8');
    assert.strictEqual(sw.includes("'./device-power/'"), true, 'sw.js precaches ./device-power/');
    assert.strictEqual(sw.includes("'./device-power/index.html'"), true, 'sw.js precaches ./device-power/index.html');
    assert.strictEqual(sw.includes("'./js/device-benchmark.js'"), true, 'sw.js precaches ./js/device-benchmark.js');
    assert.strictEqual(sw.includes("'device-power'"), true, 'sw.js SECTION_ROUTES includes device-power');
    assert.strictEqual(sw.includes("'know-your-device-power'"), true, 'sw.js SECTION_ROUTES includes know-your-device-power alias');

    const sitemap = fs.readFileSync(path.resolve(__dirname, '../sitemap.xml'), 'utf8');
    assert.strictEqual(sitemap.includes('https://zevsafe.pages.dev/device-power/'), true, 'sitemap.xml lists /device-power/');

    const usb = fs.readFileSync(path.resolve(__dirname, '../js/usb-backup-kit.js'), 'utf8');
    assert.strictEqual(usb.includes("'device-power/index.html'"), true, 'usb-backup-kit bundles device-power/index.html');
    assert.strictEqual(usb.includes("'js/device-benchmark.js'"), true, 'usb-backup-kit bundles js/device-benchmark.js');

    const indexHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
    assert.strictEqual(indexHtml.includes('href="./device-power/"'), true, 'Main app shell links to ./device-power/');
    console.log('  ✔ 5. PWA offline caching, sitemap, USB backup kit, and app navigation links verified');

    console.log('\n===============================================================');
    console.log('  ALL 5/5 DEVICE POWER BENCHMARK TESTS PASSED (100%)          ');
    console.log('===============================================================');
})().catch(err => {
    console.error('Test failure:', err);
    process.exit(1);
});
