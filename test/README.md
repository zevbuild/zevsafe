# ZevSafe Test Infrastructure & Suite Documentation

## 1. Overview & Architecture

ZevSafe features an automated test harness designed to guarantee the integrity of its client-side, zero-knowledge encryption architecture. The test suite validates cryptographic primitives, streaming I/O, memory bounding (< 150 MB peak RAM across multi-gigabyte vaults), UI components, accessibility compliance (WCAG 2.1 AA/AAA), and progressive web app (PWA) offline capabilities.

### Core Architectural Invariants
1. **100% Client-Side Execution:** No external APIs, CDNs, or tracking services are permitted. All cryptographic derivations and verifications execute strictly in local memory and worker threads.
2. **Process Exit Code Contract:** All automated test suites adhere to the standard exit code convention:
   - `0`: All assertions in the suite passed.
   - `Non-Zero (1+)`: One or more assertions failed, or an unhandled exception occurred.
3. **Informational Metrics:** Assertion counts, memory profiling numbers, and execution timings displayed in summaries are informational; pass/fail determination is strictly governed by process exit codes.
4. **Sequential Execution:** The unified runner executes suites sequentially to prevent port collisions on local HTTP verification servers and Chrome DevTools Protocol (CDP) endpoints, while ensuring peak memory bounds remain isolated.

---

## 2. Prerequisites & Environment Setup

### Required Runtimes & Dependencies
- **Node.js:** Supported on **Node.js 20.x** and **Node.js 22.x** LTS (minimum Node 18+ for native `crypto.subtle` and Web Streams API).
- **Google Chrome / Chromium:** Required for headless browser verification suites (`browser-verification-phase2.js`, `browser-verification-phase3.js`, `test-phase7-a11y.js`, `test-phase4-reliability.js`).
  - Auto-detected on Windows (`Program Files`, `LocalAppData`), macOS (`/Applications`), and Linux (`/usr/bin/google-chrome`, `/usr/bin/chromium`).
  - Can be explicitly overridden via the `CHROME_PATH` environment variable.
- **PowerShell (`pwsh` or `powershell`):** Required for the Windows Zip-Slip containment verification (`test-decrypt-zipslip.ps1`). PowerShell 7+ (`pwsh`) is supported cross-platform on Windows, Linux, and macOS.
- **Package Dependencies:**
  ```bash
  npm install
  ```
  Installs `axe-core` for automated accessibility audits.

---

## 3. Unified Test Harness: `test/run-all.js`

`test/run-all.js` is the single entry point for automated test execution across the entire repository.

### Features
- **Auto-Discovery:** Scans `test/` (and subdirectories in Phase B) for all `.js` and `.ps1` test suites.
- **Cross-Platform Host Detection:** Automatically discovers Chrome/Chromium and PowerShell runtimes.
- **Strict Exit-Code Evaluation:** Accurately evaluates each suite by its child process exit status.
- **Informational Assertion Extraction:** Parses stdout for assertion counts, displaying them in a formatted summary table.
- **Flexible Filtering:** Target specific categories, patterns, or core regression subsets.
- **Machine-Readable Output:** Generates structured JSON reports with `--json`.

### CLI Usage & Examples

```bash
# Run all test suites in the repository
node test/run-all.js

# Run the 6 core regression suites (Android, M5, QR, Roadmap, Explorer, Device-Power)
node test/run-all.js --core

# Run all cryptographic and streaming engine test suites
node test/run-all.js --crypto

# Run all test suites in a specific functional category
node test/run-all.js --category=crypto
node test/run-all.js --category=security
node test/run-all.js --category=ui
node test/run-all.js --category=pwa
node test/run-all.js --category=a11y

# Run suites matching a specific name pattern
node test/run-all.js --suite=android
node test/run-all.js zipslip

# Stop execution immediately on the first encountered failure
node test/run-all.js --bail

# List all discovered test suites and their category metadata without executing
node test/run-all.js --list

# Emit structured JSON report to stdout
node test/run-all.js --json > test-results.json

# Display live stdout and stderr during test execution
node test/run-all.js --verbose
```

---

## 4. Test Suite Catalog (29 Suites)

The test suites are organized into 5 primary functional categories:

| Category | Suite Filename | Primary Focus / Description |
|---|---|---|
| **crypto** | `test-stream-crypto.js` | v3 STREAM AEAD engine: AES-256-GCM 4MB chunks, 12B IV, 42B AAD, PBKDF2-SHA512, 1-bit tamper detection. |
| **crypto** | `test-stream-packer.js` | Streaming archive packing, mixed STORE/DEFLATE compression, 64-bit encrypted trailer manifest. |
| **crypto** | `test-stream-unpacker.js` | Streaming vault unpacking, instant catalog extraction, selective single-file extraction, LRU caching. |
| **crypto** | `test-worker-bridge.js` | Worker pipeline, transferable buffers, credit-based backpressure, 60 FPS telemetry, cooperative cancellation. |
| **crypto** | `test-android-encryption.js` | Android Chrome OPFS staging, 4-tier download fallback, 2FA Keyfile XOR, low storage quota edge cases. |
| **crypto** | `e2e-tests.js` | Comprehensive 4-tier 250-test end-to-end matrix covering all 23 features of the 5 GB streaming engine. |
| **security** | `test-media-player-security-lifecycle.js` | Video player memory zeroization, panic purge, blob URL revocation, wake-lock release, CSP validation. |
| **security** | `test-adversarial-challenger.js` | Adversarial fuzzing Suite 1: format tampering, header corruption, payload truncation, auth tag bit-flips. |
| **security** | `test-adversarial-challenger1.js` | Adversarial fuzzing Suite 2: chunk reordering, splice attacks, replay prevention, stream boundaries. |
| **security** | `test-adversarial-challenger2.js` | Adversarial fuzzing Suite 3: malformed headers, invalid magic bytes, path traversal injection. |
| **security** | `test-challenger-remediation.js` | Regression verifier ensuring all identified adversarial challenger vulnerabilities remain remediated. |
| **security** | `test-phase4-reliability.js` | Multi-cycle streaming stress testing, heap memory bounds, and garbage collection verification. |
| **security** | `test-decrypt-zipslip.ps1` | PowerShell validation for Zip-Slip path containment and Windows reserved device name blocking (`CON`, `PRN`, etc.). |
| **security** | `test-security-csp-audit.js` | Strict Content-Security-Policy audit across HTML files (`_headers`), verifying zero `unsafe-inline`. |
| **ui** | `test-explorer-folder-nav.js` | Vault Explorer VFS: recursive directory navigation, breadcrumb tracking, item search, batch selection. |
| **ui** | `test-roadmap-plan.js` | Interactive roadmap companion portal: 14 cards, category filters, progress bar calculations. |
| **ui** | `test-device-power.js` | Client-side cryptographic hardware benchmark: PBKDF2 iterations/sec, class ratings, zero network calls. |
| **ui** | `test-paper-safe-qr.js` | Paper-Safe QR engine: optical recovery payload generation, instant unlock Master Keycards, forgiving parser. |
| **ui** | `test-video-player-pro.js` | Forensic video player studio: A-B looping, audio gain boost, vocal clarity filter, keyboard shortcuts. |
| **ui** | `test-mobile-video-player.js` | Mobile video player overhaul: zero-clutter stage, single-row transport bar (<= 56px), slide-up drawer. |
| **ui** | `test-header-navbar-upgrade.js` | Semantic navbar layout, responsive single-row protection between 769px and 1240px, light theme contrast. |
| **ui** | `test-checklist-remediations.js` | 280-item feature checklist audit remediations: WCAG AA contrast tokens, chunk cache zeroization. |
| **ui** | `browser-verification-phase2.js` | Headless Chrome CDP: responsive viewports (390x844, 844x390, 1280x800), on-demand lazy loading. |
| **ui** | `browser-verification-phase3.js` | Headless Chrome CDP: strict _headers CSP, zero console errors, 13 modal dialog state cycle verification. |
| **pwa** | `test-integration-m5.js` | Milestone 5 integration: RFC 5987 Content-Disposition, StreamSaver fallback, heap delta < 150 MB. |
| **pwa** | `test-phase5-pwa.js` | Progressive Web App offline capabilities: service worker precache manifest, shell asset hash alignment. |
| **pwa** | `test-simulate-pwa-upgrade.js` | Simulated service worker upgrade cycle: multi-version transitions, client claim verification, cache eviction. |
| **pwa** | `test-dist-completeness.js` | Production distribution audit: dist asset whitelist, content hash alignment, zero dead links. |
| **a11y** | `test-phase7-a11y.js` | Phase 7 accessibility: WCAG 2.1 AA/AAA contrast calibration, dialog focus traps, automated `axe-core` audits. |

---

## 5. In-Browser Interactive Runners

For visual and manual inspection of streaming pipelines and worker bridges in standard browser environments, the following HTML runners are available:

- `test/e2e-runner.html`: Complete interactive DOM test dashboard for the 250-test E2E streaming suite with real-time memory telemetry and charts.
- `test/test-stream-crypto.html`: Browser test harness for `js/stream-crypto.js` primitives.
- `test/test-stream-packer.html`: Browser test harness for multi-file vault packing and manifest generation.
- `test/test-stream-unpacker.html`: Browser test harness for instant catalog extraction and single-file range extraction.
- `test/test-worker-bridge.html`: Browser test harness for Web Worker messaging, zero-copy buffer transfer, and telemetry.

To run interactive suites:
```bash
# Serve repository root with any local static HTTP server
npx serve .
# Open http://localhost:3000/test/e2e-runner.html in any modern browser
```

---

## 6. Continuous Integration & Deployment (Cloudflare Pages)

Automated deployment is handled natively and securely via **Cloudflare Pages** directly connected to the repository's `main` branch.

- **Static Zero-Knowledge Architecture:** Because ZevSafe is 100% client-side and requires zero build steps or server runtimes in production, commits pushed to `main` trigger instant edge deployment across Cloudflare's global CDN network (`https://zevsafe.pages.dev`).
- **Local & Pre-Commit Verification:** Full automated regression testing is executed locally via the offline test harness:
  ```bash
  node test/run-all.js
  ```
- **Matrix Compatibility:** All 30 test suites run against Node.js 20.x and 22.x with process isolation, exit-code validation as ground truth, and zero external network access.

---

## 7. Test Reorganization Roadmap (Phase B)

In accordance with Phase 6 architecture, tests will be relocated into categorized subdirectories at **Gate 4 (Phase B)** following the CSS and JS branch merges:

```
test/
├── run-all.js
├── README.md
├── crypto/
│   ├── test-stream-crypto.js
│   ├── test-stream-packer.js
│   ├── test-stream-unpacker.js
│   ├── test-worker-bridge.js
│   ├── test-android-encryption.js
│   └── e2e-tests.js
├── security/
│   ├── test-media-player-security-lifecycle.js
│   ├── test-adversarial-challenger.js
│   ├── test-phase4-reliability.js
│   └── test-decrypt-zipslip.ps1
├── ui/
│   ├── test-explorer-folder-nav.js
│   ├── test-roadmap-plan.js
│   ├── test-device-power.js
│   ├── test-paper-safe-qr.js
│   └── test-video-player-pro.js
├── pwa/
│   ├── test-integration-m5.js
│   └── test-phase5-pwa.js
└── a11y/
    └── test-phase7-a11y.js
```

`test/run-all.js` is designed to seamlessly support both the current flat layout and the reorganized subdirectory layout without breaking changes.
