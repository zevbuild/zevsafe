#!/usr/bin/env node
/**
 * ZevSafe Unified Test Harness Runner (Phase 6 Architecture)
 * test/run-all.js
 *
 * Automated runner for all unit, integration, crypto, security, UI, PWA, and a11y test suites.
 * Evaluates pass/fail strictly by process exit code (exit 0 = pass; non-zero = fail).
 * Assertion counts and stats extracted from suite output are purely informational.
 * Supports PowerShell (.ps1) tests via auto-detection of pwsh / powershell.
 * Supports dynamic suite discovery (flat test/ in Phase A; categorized subdirectories in Phase B).
 *
 * Usage:
 *   node test/run-all.js                  # Run all test suites
 *   node test/run-all.js --core           # Run core regression test suites
 *   node test/run-all.js --crypto         # Run all cryptographic engine suites
 *   node test/run-all.js --category=ui    # Run all UI test suites
 *   node test/run-all.js --suite=android  # Run suites matching pattern "android"
 *   node test/run-all.js --bail           # Stop immediately on first failure
 *   node test/run-all.js --list           # List all discovered suites and exit
 *   node test/run-all.js --json           # Output machine-readable JSON report
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;

// Non-test helper files to exclude from auto-discovery
const EXCLUDED_FILES = new Set([
    'run-all.js',
    'e2e-runner.js',
    'mock-stream.js',
    'memory-profiler.js'
]);

/**
 * Authoritative Catalog of Test Suites with Category and Descriptions
 */
const SUITE_CATALOG = [
    // ── Crypto Suites ────────────────────────────────────────────────────────
    {
        file: 'test-stream-crypto.js',
        category: 'crypto',
        name: 'STREAM AEAD v3 Crypto Engine',
        description: 'AES-256-GCM 4MB chunks, 12B IV, 42B AAD, PBKDF2-HMAC-SHA512, 1-bit tamper detection'
    },
    {
        file: 'test-stream-packer.js',
        category: 'crypto',
        name: 'v3 Vault Stream Packer',
        description: 'Multi-file archive packer, DEFLATE/STORE compression, encrypted trailer manifest'
    },
    {
        file: 'test-stream-unpacker.js',
        category: 'crypto',
        name: 'v3 Vault Stream Unpacker',
        description: 'Instant catalog extraction, selective single-file extraction, memory-bounded caching'
    },
    {
        file: 'test-worker-bridge.js',
        category: 'crypto',
        name: 'Worker Pipeline & Telemetry',
        description: 'Transferable ArrayBuffers, credit-based backpressure, 60 FPS telemetry, cooperative cancel'
    },
    {
        file: 'test-android-encryption.js',
        category: 'crypto',
        name: 'Android Mobile Encryption & OPFS',
        description: 'Tier 1-4 fallback, OPFS staging, 2FA Keyfile XOR, non-seekable streams, memory bounds'
    },
    {
        file: 'e2e-tests.js',
        category: 'crypto',
        name: '5 GB Streaming Architecture E2E',
        description: 'Comprehensive 4-tier 250-test end-to-end streaming encryption and decryption matrix'
    },

    // ── Security Suites ──────────────────────────────────────────────────────
    {
        file: 'test-media-player-security-lifecycle.js',
        category: 'security',
        name: 'Media Security Lifecycle & Panic',
        description: 'Zeroization, panic purge, blob URL revocation, wake-lock release, CSP enforcement'
    },
    {
        file: 'test-adversarial-challenger.js',
        category: 'security',
        name: 'Adversarial Challenger Suite 1',
        description: 'Format tampering, header corruption, payload truncation, auth tag bit-flips'
    },
    {
        file: 'test-adversarial-challenger1.js',
        category: 'security',
        name: 'Adversarial Challenger Suite 2',
        description: 'Stream boundary attacks, chunk reordering, splice attacks, replay prevention'
    },
    {
        file: 'test-adversarial-challenger2.js',
        category: 'security',
        name: 'Adversarial Challenger Suite 3',
        description: 'Edge cases, malformed headers, invalid magic bytes, malicious manifest paths'
    },
    {
        file: 'test-challenger-remediation.js',
        category: 'security',
        name: 'Challenger Remediation Verifier',
        description: 'Regression tests confirming all adversarial challenger findings remain remediated'
    },
    {
        file: 'test-phase4-reliability.js',
        category: 'security',
        name: 'Phase 4 Reliability & Stress',
        description: 'Long-running multi-cycle stress testing, memory leak detection, garbage collection verify'
    },
    {
        file: 'test-decrypt-zipslip.ps1',
        category: 'security',
        name: 'PowerShell Zip-Slip & Device Handle',
        description: 'Tools containment check, directory traversal attacks, Windows reserved device names'
    },
    {
        file: 'test-security-csp-audit.js',
        category: 'security',
        name: 'Security CSP & Headers Audit',
        description: 'Strict Content-Security-Policy compliance, zero unsafe-inline, distribution build check'
    },

    // ── UI Suites ────────────────────────────────────────────────────────────
    {
        file: 'test-explorer-folder-nav.js',
        category: 'ui',
        name: 'Vault Explorer VFS Navigation',
        description: 'Virtual filesystem, breadcrumb navigation, folder traversal, item search, batch select'
    },
    {
        file: 'test-roadmap-plan.js',
        category: 'ui',
        name: 'Roadmap Companion Portal',
        description: 'Interactive roadmap matrix, 14 feature cards, category filters, progress bar calculation'
    },
    {
        file: 'test-device-power.js',
        category: 'ui',
        name: 'Device Power Benchmark Engine',
        description: 'Client-side PBKDF2 throughput benchmark, hardware class tiering, zero network calls'
    },
    {
        file: 'test-paper-safe-qr.js',
        category: 'ui',
        name: 'Paper-Safe QR Code System',
        description: 'Optical recovery payload encoding, instant unlock QR, password extraction, auto-decrypt'
    },
    {
        file: 'test-video-player-pro.js',
        category: 'ui',
        name: 'Cinema Video Player Pro Engine',
        description: 'Forensic video studio, audio DSP boost, vocal clarity, playback controls, hotkeys'
    },
    {
        file: 'test-mobile-video-player.js',
        category: 'ui',
        name: 'Mobile Video Player Overhaul',
        description: 'Zero-clutter stage, single-row transport bar <= 56px, slide-up studio drawer, auto-hide'
    },
    {
        file: 'test-real-playback.js',
        category: 'ui',
        name: 'SW HTTP 206 Range Streaming & Playback',
        description: 'End-to-end real v3 streaming playback, HTTP 206 range protocol, seek across chunks, audio and photo'
    },
    {
        file: 'test-document-viewer.js',
        category: 'ui',
        name: 'In-Vault Modular Document & PDF Viewer',
        description: 'Lazy-loaded document viewer, PDF blob frame, z-index 2100 backdrop fix, 5 MB memory limit'
    },
    {
        file: 'test-image-viewer.js',
        category: 'ui',
        name: 'In-Vault Modular Image Lightbox Viewer',
        description: 'Lazy-loaded on photo click, pan/zoom/rotate math, playlist construction, blob URL cleanup'
    },
    {
        file: 'test-header-navbar-upgrade.js',
        category: 'ui',
        name: 'Header & Navbar Architecture',
        description: 'Semantic navigation, 1-row protection between 769px and 1240px, light theme contrast'
    },
    {
        file: 'test-checklist-remediations.js',
        category: 'ui',
        name: 'Deep Feature Checklist Remediations',
        description: 'Remediations audit across UI, WCAG AA contrast tokens, chunk cache zeroization'
    },
    {
        file: 'browser-verification-phase2.js',
        category: 'ui',
        name: 'Headless Chrome Phase 2 Viewports',
        description: 'CDP browser verification, portrait 390x844, landscape 844x390, lazy loading validation'
    },
    {
        file: 'browser-verification-phase3.js',
        category: 'ui',
        name: 'Headless Chrome Phase 3 Strict CSP',
        description: 'CDP verification with real _headers CSP, zero console errors, 13 modal dialog state cycles'
    },

    // ── PWA Suites ───────────────────────────────────────────────────────────
    {
        file: 'test-integration-m5.js',
        category: 'pwa',
        name: 'Milestone 5 Integration & Memory',
        description: 'RFC 5987 Content-Disposition, StreamSaver fallback, bounded heap < 150 MB RAM'
    },
    {
        file: 'test-phase5-pwa.js',
        category: 'pwa',
        name: 'Phase 5 PWA Offline & Shell Assets',
        description: 'Service worker precache manifest, offline shell routing, cache versioning'
    },
    {
        file: 'test-simulate-pwa-upgrade.js',
        category: 'pwa',
        name: 'Simulated PWA Service Worker Upgrade',
        description: 'Multi-version SW transition simulation, client claim verification, cache cleanup'
    },
    {
        file: 'test-dist-completeness.js',
        category: 'pwa',
        name: 'Production Distribution Completeness',
        description: 'Dist output verification, shell asset checksums, Service Worker hash alignment'
    },

    // ── A11y Suites ──────────────────────────────────────────────────────────
    {
        file: 'test-phase7-a11y.js',
        category: 'a11y',
        name: 'Phase 7 Accessibility & axe-core',
        description: 'WCAG 2.1 AA/AAA compliance, dialog focus traps, roving tabindex, automated axe-core audits'
    }
];

// Core regression suites identified in original specification
const CORE_SUITES = new Set([
    'test-android-encryption.js',
    'test-integration-m5.js',
    'test-paper-safe-qr.js',
    'test-roadmap-plan.js',
    'test-explorer-folder-nav.js',
    'test-device-power.js'
]);

/**
 * Locate Chrome executable on current host
 */
function detectChrome() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }

    const platform = process.platform;
    const candidates = [];

    if (platform === 'win32') {
        candidates.push(
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe')
        );
    } else if (platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium'
        );
    } else {
        // Linux / POSIX
        candidates.push(
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium'
        );
    }

    for (const p of candidates) {
        if (p && fs.existsSync(p)) {
            process.env.CHROME_PATH = p;
            return p;
        }
    }

    return null;
}

/**
 * Locate PowerShell binary (pwsh preferred, powershell fallback)
 */
function detectPowerShell() {
    const isWindows = process.platform === 'win32';
    const candidates = isWindows
        ? ['pwsh', 'pwsh.exe', 'powershell.exe', 'powershell']
        : ['pwsh'];

    for (const bin of candidates) {
        try {
            const res = spawnSync(bin, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'ignore']
            });
            if (res.status === 0 && res.stdout) {
                return { bin, version: res.stdout.trim() };
            }
        } catch (_) {}
    }

    return null;
}

/**
 * Scan directory recursively to discover test files
 */
function discoverTestFiles(dir, baseDir = dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
            // Recurse into subdirectories (supports Phase B folder structure)
            results.push(...discoverTestFiles(fullPath, baseDir));
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if ((ext === '.js' || ext === '.ps1') && !EXCLUDED_FILES.has(entry.name)) {
                results.push({
                    fullPath,
                    relPath,
                    filename: entry.name,
                    ext
                });
            }
        }
    }
    return results;
}

/**
 * Extract informational assertion counts / summary from suite output
 */
function extractAssertionInfo(output) {
    if (!output) return '-';

    // Pattern 1: "TEST RESULTS: 33/33 PASSED" or "RESULTS: 5/5 PASSED"
    const m1 = output.match(/(?:TEST\s+RESULTS|RESULTS):\s*(\d+\/\d+)\s*PASSED/i);
    if (m1) return `${m1[1]} passed`;

    // Pattern 2: "ALL 41 EXPLORER FOLDER NAVIGATION TESTS PASSED"
    const m2 = output.match(/ALL\s+(\d+)\s+[^.\n\r]*PASSED/i);
    if (m2) return `${m2[1]}/${m2[1]} passed`;

    // Pattern 3: "Total: 250 | Passed: 250"
    const m3 = output.match(/Total:\s*(\d+)\s*\|\s*Passed:\s*(\d+)/i);
    if (m3) return `${m3[2]}/${m3[1]} passed`;

    // Pattern 4: "20/20 PASSED"
    const m4 = output.match(/(\d+\/\d+)\s+PASSED/i);
    if (m4) return `${m4[1]} passed`;

    // Pattern 5: "ALL TESTS PASSED WITH 100% SUCCESS RATE"
    const m5 = output.match(/(\d+)\s+tests?\s+passed/i);
    if (m5) return `${m5[1]} passed`;

    // Pattern 6: Count individual tick marks "✓"
    const checkmarks = (output.match(/✓/g) || []).length;
    if (checkmarks > 0) return `${checkmarks} passed`;

    return '-';
}

/**
 * Extract concise error snippet from failed suite output
 */
function extractErrorSnippet(stdout, stderr) {
    const combined = (stderr || '') + '\n' + (stdout || '');
    const lines = combined.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('at '));

    const failLine = lines.find(l => /error|fail|assertion|exception|rejected/i.test(l));
    if (failLine) {
        return failLine.slice(0, 120);
    }
    return lines[lines.length - 1] ? lines[lines.length - 1].slice(0, 120) : 'Non-zero exit code';
}

/**
 * Execute a single test suite in an isolated child process
 */
function runSuite(suite, powershellInfo) {
    const isPs = suite.ext === '.ps1';
    let cmd = process.execPath;
    let args = [suite.fullPath];

    if (isPs) {
        if (!powershellInfo) {
            return {
                status: 'SKIPPED',
                exitCode: null,
                durationMs: 0,
                assertions: 'PowerShell not detected',
                error: 'pwsh / powershell binary not found in PATH'
            };
        }
        cmd = powershellInfo.bin;
        args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', suite.fullPath];
    }

    const env = {
        ...process.env,
        FORCE_COLOR: '0',
        NODE_ENV: 'test'
    };

    const startTime = performance.now();
    const result = spawnSync(cmd, args, {
        cwd: ROOT_DIR,
        env,
        encoding: 'utf8',
        timeout: 120000, // 2-minute safety ceiling per suite
        maxBuffer: 32 * 1024 * 1024 // 32 MB buffer for verbose logs
    });
    const durationMs = Math.round(performance.now() - startTime);

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const exitCode = result.status;
    const isTimeout = result.error && result.error.code === 'ETIMEDOUT';

    let status = 'PASS';
    let error = null;

    if (isTimeout) {
        status = 'TIMEOUT';
        error = 'Execution timed out (> 120s)';
    } else if (exitCode !== 0) {
        status = 'FAIL';
        error = extractErrorSnippet(stdout, stderr);
    }

    const assertions = extractAssertionInfo(stdout);

    return {
        status,
        exitCode: exitCode !== null ? exitCode : (isTimeout ? -1 : 1),
        durationMs,
        assertions,
        error,
        stdout,
        stderr
    };
}

/**
 * Format milliseconds into human-readable string
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * CLI Argument Parser
 */
function parseArgs(args) {
    const opts = {
        all: false,
        core: false,
        crypto: false,
        category: null,
        suite: null,
        bail: false,
        list: false,
        json: false,
        verbose: false,
        ignoreFailures: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--all') opts.all = true;
        else if (arg === '--core' || arg === '--regression') opts.core = true;
        else if (arg === '--crypto') opts.crypto = true;
        else if (arg === '--bail') opts.bail = true;
        else if (arg === '--list') opts.list = true;
        else if (arg === '--json') opts.json = true;
        else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
        else if (arg === '--ignore-failures') opts.ignoreFailures = true;
        else if (arg === '--help' || arg === '-h') opts.help = true;
        else if (arg.startsWith('--category=')) opts.category = arg.split('=')[1].toLowerCase();
        else if (arg === '--category' && i + 1 < args.length) opts.category = args[++i].toLowerCase();
        else if (arg.startsWith('--suite=')) opts.suite = arg.split('=')[1];
        else if (arg === '--suite' && i + 1 < args.length) opts.suite = args[++i];
        else if (!arg.startsWith('-') && !opts.suite) opts.suite = arg;
    }

    return opts;
}

/**
 * Print CLI Help
 */
function printHelp() {
    console.log(`
ZevSafe Unified Test Harness Runner (Phase 6 Architecture)
==========================================================
Usage:
  node test/run-all.js [options] [suite-filter]

Options:
  --all                 Run all 29 test suites in the repository
  --core, --regression  Run the core regression test suites
  --crypto              Run all cryptographic and streaming engine suites
  --category=<cat>      Run suites in category (crypto, security, ui, pwa, a11y)
  --suite=<pattern>     Run suites matching filename or name regex
  --bail                Stop execution immediately on first failure
  --list                List discovered test suites with metadata and exit
  --json                Emit complete results summary as machine-readable JSON
  --verbose, -v         Display live stdout/stderr of each suite during execution
  --help, -h            Show this help documentation

Categories:
  crypto     STREAM AEAD v3, Packer, Unpacker, Worker Bridge, Android, E2E (6 suites)
  security   Media Lifecycle, Adversarial Challengers 1-3, Remediation, Reliability, Zip-Slip, CSP (8 suites)
  ui         Explorer VFS, Roadmap, Device Power, Paper QR, Video Pro, Mobile Player, Navbar, Checklists, Browser CDP (10 suites)
  pwa        M5 Integration, Offline Shell, PWA Upgrade, Dist Completeness (4 suites)
  a11y       Phase 7 WCAG AAA & automated axe-core audits (1 suite)
`);
}

/**
 * Main Runner Function
 */
function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (opts.help) {
        printHelp();
        process.exit(0);
    }

    // 1. Environment & Capability Diagnostics
    const chromePath = detectChrome();
    const psInfo = detectPowerShell();

    // 2. Discover all test files on disk
    const discoveredFiles = discoverTestFiles(TEST_DIR);

    // 3. Map discovered files against the catalog
    const catalogMap = new Map();
    for (const c of SUITE_CATALOG) {
        catalogMap.set(c.file, c);
    }

    const allSuites = discoveredFiles.map(df => {
        const catEntry = catalogMap.get(df.filename) || {};
        return {
            filename: df.filename,
            relPath: df.relPath,
            fullPath: df.fullPath,
            ext: df.ext,
            category: catEntry.category || 'other',
            name: catEntry.name || df.filename,
            description: catEntry.description || 'Test Suite',
            isCore: CORE_SUITES.has(df.filename)
        };
    });

    // Sort suites: crypto -> security -> ui -> pwa -> a11y -> other
    const categoryOrder = { crypto: 1, security: 2, ui: 3, pwa: 4, a11y: 5, other: 6 };
    allSuites.sort((a, b) => {
        const orderA = categoryOrder[a.category] || 99;
        const orderB = categoryOrder[b.category] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.filename.localeCompare(b.filename);
    });

    // 4. Handle --list option
    if (opts.list) {
        console.log('\n================================================================================');
        console.log(`  ZevSafe Discovered Test Suites (${allSuites.length} total)`);
        console.log('================================================================================');
        for (const s of allSuites) {
            const coreTag = s.isCore ? ' [CORE]' : '';
            console.log(`  • [${s.category.toUpperCase()}] ${s.filename.padEnd(42)} ${coreTag}`);
            console.log(`    ${s.name} — ${s.description}`);
        }
        console.log('================================================================================\n');
        process.exit(0);
    }

    // 5. Filter suites based on CLI arguments
    let targetSuites = allSuites;

    if (opts.core) {
        targetSuites = allSuites.filter(s => s.isCore);
    } else if (opts.crypto) {
        targetSuites = allSuites.filter(s => s.category === 'crypto');
    } else if (opts.category) {
        targetSuites = allSuites.filter(s => s.category.toLowerCase() === opts.category);
    } else if (opts.suite) {
        const pattern = new RegExp(opts.suite, 'i');
        targetSuites = allSuites.filter(s => pattern.test(s.filename) || pattern.test(s.name));
    }

    if (targetSuites.length === 0) {
        console.error(`\n❌ Error: No test suites matched filter criteria.`);
        process.exit(1);
    }

    // 6. Print Execution Header (unless pure JSON requested)
    if (!opts.json) {
        console.log('\n================================================================================');
        console.log('  ZevSafe Test Harness Runner (Phase 6 Architecture)');
        console.log('================================================================================');
        console.log(`  Host OS:      ${os.type()} ${os.release()} (${process.arch})`);
        console.log(`  Node.js:      ${process.version} (${process.execPath})`);
        console.log(`  Chrome:       ${chromePath ? chromePath : 'Not found (CDP suites may skip/fail)'}`);
        console.log(`  PowerShell:   ${psInfo ? `${psInfo.bin} (${psInfo.version})` : 'Not found (.ps1 suites will skip)'}`);
        console.log(`  Suite Scope:  ${targetSuites.length} suite(s) scheduled for sequential execution`);
        console.log('================================================================================\n');
    }

    // 7. Execute Suites Sequentially
    const suiteResults = [];
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const globalStart = performance.now();

    for (let i = 0; i < targetSuites.length; i++) {
        const suite = targetSuites[i];
        const indexStr = `[${String(i + 1).padStart(2, '0')}/${String(targetSuites.length).padStart(2, '0')}]`;
        const prefix = `${indexStr} [${suite.category.toUpperCase()}] ${suite.filename}`;

        if (!opts.json) {
            process.stdout.write(`  ${prefix.padEnd(58)} ... `);
        }

        const res = runSuite(suite, psInfo);
        suiteResults.push({
            suite,
            ...res
        });

        if (res.status === 'PASS') {
            totalPassed++;
            if (!opts.json) {
                console.log(`PASS  (${formatDuration(res.durationMs).padStart(6)}) [${res.assertions}]`);
            }
        } else if (res.status === 'SKIPPED') {
            totalSkipped++;
            if (!opts.json) {
                console.log(`SKIP  (PowerShell missing)`);
            }
        } else {
            totalFailed++;
            if (!opts.json) {
                console.log(`FAIL  (exit ${res.exitCode}, ${formatDuration(res.durationMs)})`);
                if (res.error) {
                    console.log(`        ↳ ${res.error}`);
                }
            }
        }

        if (opts.verbose && (res.stdout || res.stderr)) {
            console.log('\n--- Live Output Begin ---');
            if (res.stdout) console.log(res.stdout);
            if (res.stderr) console.error(res.stderr);
            console.log('--- Live Output End ---\n');
        }

        if (opts.bail && res.status !== 'PASS' && res.status !== 'SKIPPED') {
            if (!opts.json) {
                console.log(`\n🛑 Execution halted (--bail triggered on ${suite.filename})`);
            }
            break;
        }
    }

    const globalDurationMs = Math.round(performance.now() - globalStart);

    // 8. Output Machine-Readable JSON if requested
    if (opts.json) {
        const jsonReport = {
            timestamp: new Date().toISOString(),
            host: {
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                chromePath,
                powershell: psInfo ? psInfo.version : null
            },
            summary: {
                total: targetSuites.length,
                passed: totalPassed,
                failed: totalFailed,
                skipped: totalSkipped,
                durationMs: globalDurationMs,
                success: totalFailed === 0
            },
            suites: suiteResults.map(r => ({
                file: r.suite.filename,
                relPath: r.suite.relPath,
                category: r.suite.category,
                name: r.suite.name,
                status: r.status,
                exitCode: r.exitCode,
                durationMs: r.durationMs,
                assertions: r.assertions,
                error: r.error
            }))
        };
        console.log(JSON.stringify(jsonReport, null, 2));
        process.exit(totalFailed === 0 || opts.ignoreFailures ? 0 : 1);
    }

    // 9. Format Terminal Summary Table
    console.log('\n================================================================================');
    console.log('  TEST EXECUTION SUMMARY TABLE');
    console.log('================================================================================');
    console.log('  ┌────┬────────────┬──────────────────────────────────────┬────────┬───────────┬──────────┬──────────────────┐');
    console.log('  │ #  │ Category   │ Suite Name                           │ Status │ Exit Code │ Duration │ Assertions (Info)│');
    console.log('  ├────┼────────────┼──────────────────────────────────────┼────────┼───────────┼──────────┼──────────────────┤');

    for (let i = 0; i < suiteResults.length; i++) {
        const r = suiteResults[i];
        const num = String(i + 1).padStart(2, '0');
        const cat = r.suite.category.padEnd(10);
        const name = (r.suite.filename.length > 36 ? r.suite.filename.slice(0, 33) + '...' : r.suite.filename).padEnd(36);
        const status = r.status.padEnd(6);
        const code = String(r.exitCode !== null ? r.exitCode : '-').padStart(9);
        const dur = formatDuration(r.durationMs).padStart(8);
        const assertStr = (r.assertions.length > 16 ? r.assertions.slice(0, 13) + '...' : r.assertions).padEnd(16);

        console.log(`  │ ${num} │ ${cat} │ ${name} │ ${status} │ ${code} │ ${dur} │ ${assertStr} │`);
    }

    console.log('  └────┴────────────┴──────────────────────────────────────┴────────┴───────────┴──────────┴──────────────────┘');

    // 10. Print Failure Details if any
    const failures = suiteResults.filter(r => r.status === 'FAIL' || r.status === 'TIMEOUT');
    if (failures.length > 0) {
        console.log('\n  FAILURES & ERRORS:');
        for (const f of failures) {
            console.log(`  • [${f.suite.category.toUpperCase()}] ${f.suite.filename} (Exit Code: ${f.exitCode}, Duration: ${formatDuration(f.durationMs)})`);
            if (f.error) {
                console.log(`    ↳ Error: ${f.error}`);
            }
        }
    }

    console.log('\n--------------------------------------------------------------------------------');
    console.log(`  Total Suites:   ${suiteResults.length}`);
    console.log(`  Passed:         ${totalPassed}`);
    console.log(`  Failed:         ${totalFailed}`);
    console.log(`  Skipped:        ${totalSkipped}`);
    console.log(`  Total Duration: ${formatDuration(globalDurationMs)}`);
    console.log('================================================================================');

    if (totalFailed > 0) {
        console.log(`  VERDICT: FAIL (${totalFailed} suite(s) exited with non-zero exit code)`);
    } else {
        console.log(`  VERDICT: ALL ${totalPassed} SCHEDULED TEST SUITES PASSED (100% SUCCESS RATE)`);
    }
    console.log('================================================================================\n');

    process.exit(totalFailed === 0 || opts.ignoreFailures ? 0 : 1);
}

main();
