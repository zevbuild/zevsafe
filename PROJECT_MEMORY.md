# 🧠 ZevSafe Ecosystem — Project Memory (`zevsafe` & `app-zevsafe`)

> **System Memory, Architecture & Cross-Platform Reference for AI Agents**  
> **Web Portal Version:** `v8.16.0` (`WEB-VERSION-67`, Service Worker `v67`)  
> **Native Android App (`app-zevsafe`):** **DEPRECATED & SUNSET** — All mobile development unified into Web PWA (`zevsafe.pages.dev`). Historical repository archived at [`zevbuild/app-zevsafe`](https://github.com/zevbuild/app-zevsafe).
> **Future Plans & Roadmap:** Interactive Portal at [`roadmap/index.html`](roadmap/index.html) & documented in [`future-plans/FUTURE_PLAN.md`](future-plans/FUTURE_PLAN.md) (Completed Phases 1–7, 9, 11, 13 & 14 [78.5% Delivered]; Upcoming Phase 8 [Argon2id WASM KDF], Phases 10 & 12 [In-Vault Redaction & Offline i18n]).

> **🤖 MANDATORY AI AGENT RULE:**  
> Whenever **ANY** AI agent (Antigravity, Gemini, Cursor, Windsurf, Claude, Copilot) modifies, adds, refactors, or fixes any code or documentation in `zevsafe` or `app-zevsafe`, you **MUST AUTOMATICALLY UPDATE `PROJECT_MEMORY.md`**, `CHANGELOG.md`, `change-log/index.html`, AND `README.md` before completing your task so that any future AI agent can immediately understand the exact current state of the ecosystem.

---

## 1. Ecosystem Overview

ZevSafe is a 100% client-side, zero-knowledge, military-grade file and folder encryption suite that operates with **zero servers, zero cloud uploads, and zero telemetry**.

It consists of three bit-identically compatible platforms sharing the **`ZV3\0` STREAM AEAD** binary format:
1. **Web PWA (`zevsafe`):** Browser-based vault application ([`zevsafe.pages.dev`](https://zevsafe.pages.dev)) using the Web Crypto API (`crypto.subtle`), elastic multi-worker pool (`js/worker-bridge.js`, `js/crypto-worker.js`), zero-copy transferable buffers, ephemeral session key caching, rich in-vault media player, image lightbox viewer with pan/zoom/rotate, code & text document viewer with line numbers & clipboard copy, formal defense-in-depth security hardening (Score 96/100, Grade A+), and a 4-tier streaming file saver (`js/stream-saver.js`).
2. **Native Android App (`app-zevsafe`) [DEPRECATED]:** Historical standalone Kotlin + Jetpack Compose Android application (`com.zevbuild.zevsafe`). Succeeded entirely by the mobile Web PWA at `zevsafe.pages.dev`, which provides identical offline `ZV3\0` STREAM AEAD cryptography with OPFS streaming, image lightbox, text editing, and zero sideloading friction. Detailed Android Project Memory archived in `../app-zevsafe/PROJECT_MEMORY.md`.
3. **Emergency Desktop CLI Tools (`tools/`):** Standalone Windows batch launchers (`tools/Encrypt-Vault.bat`, `tools/Decrypt-Vault.bat`) and PowerShell streaming engines (`tools/encrypt.ps1`, `tools/decrypt.ps1`) for zero-RAM 25 GB – 100 GB+ datasets.

---

## 2. Shared Binary Container Format (`ZV3\0`)

Any `.zev` file created on Web, Android, or Desktop can be unlocked on any other platform:

| Offset (B) | Size | Encoding | Field | Description |
|---|---|---|---|---|
| `0..3` | 4 B | ASCII | `MAGIC` | `ZV3\0` (`0x5A 0x56 0x33 0x00`) |
| `4` | 1 B | Uint8 | `VERSION` | `0x03` (Container format version 3) |
| `5` | 1 B | Uint8 | `FLAGS` | Bit 0 (`0x01`): Keyfile 2FA active; Bit 1 (`0x02`): Reserved |
| `6..9` | 4 B | Uint32 BE | `CHUNK_SIZE` | `4,194,304` bytes (4 MB default) |
| `10..41` | 32 B | Raw Bytes | `SALT` | 32-byte CSPRNG salt for PBKDF2-HMAC-SHA512 (600,000 iterations) |
| `42..48` | 7 B | Raw Bytes | `BASE_IV_PREFIX` | 7-byte CSPRNG base IV prefix |
| `49..56` | 8 B | Uint64 BE | `MANIFEST_OFFSET` | Big-endian byte offset of the encrypted tail manifest |

* **Total Header Size:** Exactly 57 bytes (`V3_HEADER_SIZE = 57`).
* **Key Derivation:** `PBKDF2-HMAC-SHA512` with `600,000` iterations producing a 256-bit (32-byte) AES key.
* **Optional Keyfile 2FA:** `MasterKey = DerivedKey ⊕ SHA-256(KeyfileBytes)`.
* **Chunk IV Layout (12 B):** `BaseIVPrefix(7B) ‖ Uint32BE(chunkIndex)(4B) ‖ isLast(1B)`.
* **Chunk AAD Layout (42 B):** `Magic(4B) ‖ Version(1B) ‖ Salt(32B) ‖ Uint32BE(chunkIndex)(4B) ‖ isLast(1B)`.
* **Chunk Framing:** `[PlaintextLength(4B BE) ‖ Ciphertext(N) ‖ GCM_Tag(16B)]`.
* **Tail Manifest Envelope (48 B header):** `[Salt(32B) ‖ IV(12B) ‖ PlainLen(4B BE) ‖ Ciphertext(M) ‖ Tag(16B)]`.

---

## 3. Web PWA Architecture (`zevsafe`)

### 3.1 Multi-Worker Parallel AEAD Pipeline
- **Elastic `WorkerPool`:** Scales up to `navigator.hardwareConcurrency` clamped between 4 and 8 workers (falls back safely to 1 on single-core devices, in-process shims, or manifest-only operations).
- **Session Multiplexing:** Multi-session broadcast (`INIT_KEY` or `INIT_SESSION`) initializes all pool workers with session parameters, allowing any idle worker to process any chunk concurrently.
- **Strictly Ordered Reassembly (`OrderedReassemblyQueue`):** Resolves non-deterministic chunk completion orders into strictly sequential stream writes ($0, 1, 2, \dots$) before writing to disk or output sinks.
- **Credit Flow Control:** Adaptive credit window $W = \max(2, \min(12, N \times 2))$ with deferred release: credits are released only after chunks are written to the sink, bounding peak process heap strictly below 105 MB.
- **Zero-Copy Transferable Buffers:** Eliminates redundant `.slice()` duplications across worker boundaries using `toTransferableArrayBuffer(data)`, saving over 20 GB of memory allocations on 5 GB vaults.
- **Ephemeral Session Key Caching:** `readVaultManifest` returns non-extractable `CryptoKey` in catalog result; Vault Explorer reuses this cached key for single-file extractions, image lightbox viewing, and media playback, reducing file access latency from ~2,500 ms to < 15 ms (> 150× faster).
- **In-Vault File Viewers & Stream Extraction:**
  - **Image Lightbox Modal (`#vault-image-modal`):** Smooth zoom (25%–500%), mouse drag-pan, wheel zoom, double-click zoom toggle, 90° rotation, dimensions badge, and prev/next playlist carousel.
  - **Text & Code Document Viewer Modal (`#vault-text-modal`):** Monospace syntax display with line numbers gutter, memory-bounded preview (up to 5 MB), word wrap toggle, and 1-tap clipboard copying.
  - **Download All Stream Decryption:** Vault Explorer preserves the active master password string in `currentV3Vault.password` (with fallback to `currentV3Vault.masterKey`) for `WorkerBridge.startDecryption`.
- **Zero-Knowledge Session Teardown (`lockV3VaultSession`):** Explicitly wipes keyfile bytes via `.fill(0)`, nullifies all key/catalog references, revokes media/image blob URLs, and scrubs password fields on modal close, file clear, or window unload.

### 3.2 Defensive Security Hardening & Audit Attestation (v6.9)
- **Security Audit Report ([`SECURITY_AUDIT_REPORT.md`](SECURITY_AUDIT_REPORT.md)):** Comprehensive evaluation of 20 vulnerability investigations; post-remediation composite score upgraded from 77/100 to **96/100 (Grade A+)**; production release approved.
- **Cryptographic Bounds & Memory Zeroization (`js/stream-crypto.js`):** Enforces minimum PBKDF2 iteration floor ($\ge 100,000$ in browser production); wraps `deriveMasterKey` in `try...finally` with explicit `.fill(0)` zeroization on precursor byte buffers (`passwordBytes`, `rawKeyBytes`, `mixedKey`, `keyfileHash`); strictly validates container header bounds in `parseContainerHeader` ($1\text{ KB} \le \text{chunkSize} \le 64\text{ MB}$, $manifestOffset \ge 77\text{ B}$).
- **Zip-Slip & Path Traversal Mitigations:** Canonical path containment validation (`Path.GetFullPath`), Windows reserved device name validation (`CON`, `PRN`, `AUX`, `NUL`, etc.), NTFS Alternate Data Stream filtering (`:`), control character filtering, and directory/file reparse point (symlink) detection in `tools/decrypt.ps1`; RFC 1951 path normalization in `tools/encrypt.ps1`; catalog entry sanitization in `StreamPacker` and `StreamUnpacker` (`sanitizeEntryPath` aligned with `sanitizeZipPath`) filtering null bytes, control characters, colons (`:`), Windows reserved device names, and directory traversal segments (`..`); safe stack-based fallback path sanitization in `app.js` `batchDownloadSelected` with sanitized output container names (`sanitizeFilenamePart`).
- **Client-Side Defense-in-Depth:** Strict Content-Security-Policy (CSP) meta tags and Cloudflare Pages HTTP response headers (`_headers`) across all portal pages (`connect-src 'self' blob: data:`, `frame-ancestors 'none'`); DOM XSS immunity in `showToast` via `document.createElement`/`textContent`; restriction of direct external SVG blob navigation with `rel="noopener noreferrer"`.
- **Worker Concurrency & Flow Control Robustness (`js/worker-bridge.js`):** Implemented cooperative `abort(reason)` methods on `CreditFlowController` and `OrderedReassemblyQueue` called upon cancellation or fatal errors; prevented double worker releases under error cascades; eliminated transferable buffer detachment race conditions by caching `chunkByteLength` prior to worker handoff; rejected pending waiters upon `WorkerPool.terminate()`.
- **Memory Bounding & Cache Hygiene:** 4-chunk (16 MB) memory-bounded LRU eviction cache (`chunkCache`) in `app.js` with proper architectural lifecycle management (eviction drops oldest key to avoid buffer aliasing with `decryptedChunks` during active multi-chunk extractions, while `.fill(0)` byte scrubbing is strictly executed in `clear()` during `lockV3VaultSession`); CSPRNG `downloadId` token generation with 5-second rapid session reclamation in `StreamSaver`.
- **Mobile GPU & Touch Performance Optimization (`styles.css`):** Completely eradicated mobile browser lag and thermal throttling on smartphones (Android/iOS) by disabling continuous 80px Gaussian blur convolutions on floating orbs (`.orb`) and full-screen procedural SVG fractal noise filters (`.noise`) on screens $\le 820\text{px}$ or touch devices; substituted static zero-overhead CSS radial gradients; removed heavy `backdrop-filter: blur(24px)` from cards/headers in favor of high-performance opaque dark surfaces (`rgba(13, 17, 28, 0.94)`); purged catastrophic universal transition rule `* { transition-duration: 0.15s !important; }`; restored native 1:1 touch momentum scrolling; paused idle background keyframe animations (`gradientShift`, `drop-ring`).
- **PWA Service Worker Hardening & Chrome Subfolder Routing (`sw.js`, `_headers`):** Resolved Chrome subfolder loading failure (`/how-to-use-zevsafe/`, `/change-log/`, `/security-audit/`) by rebuilding redirected HTTP 308 responses into clean `Response` objects before `cache.put()`, avoiding Chromium `TypeError: Cannot cache a redirected response`; canonical trailing slash URL normalization across all cross-page links; section-aware `cacheFirst` path matching and subfolder-specific offline fallbacks; standardized `{ scope: '/' }` across subfolders without redundant `controllerchange` reloads; precached canonical directory paths alongside index files; added `/sw.js` HTTP headers in `_headers` (`Service-Worker-Allowed: /`, `Cache-Control: no-cache, no-store, must-revalidate`); bumped offline shell cache to `v44`.


- **Phone-Only Right-Aligned Hamburger Navigation (`#btn-mobile-nav-toggle`, `#mobile-nav-drawer`):** Replaces cramped horizontal links on screens <= 768px with a right-aligned cybernetic hamburger button that morphs into an 'X' and slides down a frosted glass navigation drawer. Strictly hidden on desktop.

### 3.4 Comprehensive Knowledge Hub & Service Manual (`knowledge/`) [v8.2.0]
- **Architecture & Portal (`knowledge/index.html`, `knowledge/knowledge.css`, `knowledge/knowledge.js`):**
  - Instant client-side search engine with keyboard shortcut `/` and `ESC` clearing.
  - Interactive Dual-Perspective Architecture: 2-way / 3-way view toggle between 🟢 *Simple Step-by-Step User Guides* (plain English, screenshots, workflows) and 🔵 *Deep Cryptographic & Technical Disclosures* (byte offsets, Web Crypto API parameters, mathematical formulas, memory bounds) with `localStorage` state persistence.
  - Security Invariants Matrix detailing primitives, parameters, boundaries, and threat models across all 9 services.
- **Nine Dedicated Service Deep-Dive Pages:**
  1. `knowledge/core-vault/index.html`: Core Streaming Vault (Lock, Unlock, 57B Header, 4MB Chunks, Emergency Sheet)
  2. `knowledge/virtual-filesystem/index.html`: Virtual Filesystem & Live Editing (Notes, Live MD Editor, In-Place Rename/Delete, Direct Re-encryption, Session Overlay Map/Set)
  3. `knowledge/duress-decoy/index.html`: Duress Decoy Vaults & Plausible Deniability (Dual-Manifest, V3_FLAG_DURESS, Realistic Decoys, IND-CPA Indistinguishability)
  4. `knowledge/polyglot-camouflage/index.html`: Steganographic Forensic Camouflage (JPEG/PNG Termination Markers, Sliding-Window Detector, Cover Generator)
  5. `knowledge/health-and-salvage/index.html`: Vault Health, Deep AEAD Scan & Fault-Tolerant Salvage (Chunk Isolation, Quarantining, Salvage Reports)
  6. `knowledge/media-cinema/index.html`: Media Cinema Deck & Floating Audio Dock (Zero-RAM Streaming, Persistent Dock, URL Revocation Invariants)
  7. `knowledge/passwords-autolock/index.html`: Passwords & Auto-Lock Protocol (CSPRNG Diceware, Shannon Entropy, Inactivity Timers, Buffer Zeroization)
  8. `knowledge/key-derivation-2fa/index.html`: Key Derivation & 2FA Physical Keyfiles (600k-2.4M PBKDF2 Tiers, SHA-256 Keyfile Mixing)
  9. `knowledge/mobile-streaming/index.html`: Multi-Tier Mobile Streaming Storage (Tier 1 FSA, Tier 3 OPFS, Tier 2 SW, Tier 4 Fallback, Memory Bounding < 150 MB)
- **Air-Gapped PWA Precaching:** All 12 Knowledge Hub pages and assets are precached in `SHELL_ASSETS` (`APP_VERSION = 'v59'`) for 100% offline availability in airplane mode.

### 3.5 Strategic Remediation & Hardening Roadmap (v8.8.0)
- **Phase A — Cryptographic & Memory Integrity Remediation:**
  - **Multi-Tier PBKDF2 Iteration Auto-Resolution (`js/stream-unpacker.js`):** `readVaultManifest` reads the manifest envelope trailer before testing candidate keys, sequentially trialing candidate tiers `[600000, 1200000, 2400000]` against Envelope 0 and Envelope 1, retaining the successfully derived `masterKey` so downstream operations avoid re-derivation.
  - **Plausible Deniability Protection (`js/worker-bridge.js`):** Suppressed `V3_FLAG_DURESS (0x02)` in unencrypted container header flags. The dual-manifest parser decrypts Envelope 1 seamlessly without requiring public flag disclosure.
  - **Zero-Copy Direct Buffer Transfer & Zeroization (`js/worker-bridge.js`):** Eliminated buffer cloning in `initTransfers = [saltBuf, kfBuf]`, transferring array buffers directly to prevent memory leaks, and added `.fill(0)` wiping for `keyfileBytes` in `extractSingleFile`'s `finally` block.
  - **Precursor Byte Scrubbing (`app.js`):** Wrapped `deriveKeyV2Raw` and `deriveKeyV2` with `try...finally` memory scrubbing with `.fill(0)` for `passBytes`, `rawKey`, `mixedKey`, and `keyfileBytes`.
  - **OPFS Mobile Staging Deletion Window (`js/stream-saver.js`):** Extended `createTier3Writer.close()` OPFS staging file deletion timeout from 5,000 ms to 120,000 ms, preventing premature deletion during mobile download transfers of multi-GB vaults.
- **Phase B — Service Worker & PWA Offline Resilience Remediation:**
  - **Unified Subfolder Routing (`sw.js`):** Implemented `SECTION_ROUTES` array (14 paths) and `matchSectionRoute(pathname, cacheName)` in `cacheFirst` and offline `catch` blocks, providing automatic routing and offline fallbacks for all 11 Knowledge Hub subfolder routes (`/knowledge/(.*)` -> `./knowledge/$1/index.html`).
  - **Comprehensive USB Air-Gap Kit Asset Manifest (`js/usb-backup-kit.js`):** Updated `AIRGAP_ASSET_PATHS` to 31 essential runtime assets (including `jszip.min.js`, `js/stream-crypto.js`, `js/stream-packer.js`, `js/stream-unpacker.js`, `js/crypto-worker.js`, `js/stream-saver.js`, `js/worker-bridge.js`, `js/usb-backup-kit.js`, assets, and all 11 Knowledge Hub HTML pages). Updated `fetchAssetBytes` to dynamically match any active `zevsafe-shell-*` cache via `caches.keys()`, and added `cd /d "%~dp0"` to `WINDOWS_LAUNCHER`.
  - **PWA Shortcuts Hash Navigation Router (`app.js`):** Added `initPwaShortcutRouting()` to handle initial load and `hashchange` events for `#decrypt` and `#encrypt`, switching tabs cleanly when launched via PWA shortcuts.
- **Phase C — Mobile UX, Accessibility & Cross-Page Integrity Remediation:**
  - **Mobile Drawer Focus Trap & Scroll Lock (`app.js`):** Implemented Tab key focus trapping in `#mobile-nav-drawer`, focus restoration to `#btn-mobile-nav-toggle` on close, global exposure of `window.closeMobileNavDrawer`, and integrated drawer closing into `#btn-open-usb-backup-mobile` to cleanly release body scroll lock before opening modals.
  - **WCAG 2.1 Contrast AA/AAA & Touch Targets (`styles.css`):** Updated dark theme `--text-3` to `#7c8ba1` (5.7:1 AA contrast against `#08091a`) and light theme `--text-3` to `#475569` (7.24:1 AAA contrast against `#f8fafc`). Ensured minimum 48px touch targets for `#btn-mobile-nav-toggle`, `#btn-mobile-nav-close`, and `.btn-max-security-pill`.
  - **Knowledge Hub SEO & Structural Standardization:** Ingested `<link rel="canonical">` into `<head>` across all 11 Knowledge Hub pages, standardized Card 10 markup in `knowledge/index.html` (`data-service="10"`, `.kb-badge-number`, `.kb-tag-list`), added standard `.kb-footer` in `knowledge/airgap-usb-backup/index.html`, and ingested all 11 Knowledge Hub URLs into `sitemap.xml`.
  - **Version Badge Synchronization (`index.html`):** Synchronized mobile drawer badges and footer version references to `v8.8.0 / WEB-VERSION-59`.

| File / Directory | Responsibility |
|---|---|
| `_headers` | Cloudflare Pages HTTP response headers enforcing server-level CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `/sw.js` cache control. |
| `security-audit/index.html` | Public web presentation of the official Security Audit Report with interactive severity filters, real-time search, scorecard metrics, and responsive deep-dives. |
| `SECURITY_AUDIT_REPORT.md` | Authoritative security audit and hardening attestation report (Score: 96/100, Grade A+) documenting 20 vulnerability remediation proofs, CVSS ratings, and verification test matrices. |
| `FORMAT.md` | Authoritative binary container specification defining `ZV3\0` STREAM AEAD, 57-byte header, 4 MB chunk wire framing, 12-byte IV & 42-byte AAD math, encrypted tail manifest JSON schema, and selective extraction. |
| `index.html` | Primary vault UI, Encrypt/Decrypt cards, 60 FPS Telemetry HUD with live throughput & workers badge, Vault Explorer modal, Cinema Media Player, Image Lightbox modal, Code & Text Viewer/Editor modal (`#vault-text-modal`), approved modern navbar, cryptographic trust strip (`WEB-VERSION-52`). |
| `app.js` | Main-thread controller, drag-and-drop traversal, entropy meter, Vault Explorer UI with instant session key extraction, hierarchical directory drill-down & breadcrumb navigation, in-browser PDF previewer, interactive in-browser text file editor (`toggleTextEditMode`, `saveTextFileChanges`), in-vault note creation (`createNewTextFile`), session overlay Map (`editedFiles`), tracked blob URL registry, Cinema streaming media player, high-res Image Lightbox controller with pan/zoom/rotate, Code & Text reader with line numbers and copy-to-clipboard, Telemetry HUD controller, and universal session zeroization protocol. |
| `styles.css` | Glassmorphic theme system, adaptive Telemetry HUD grid, modern navbar & hero trust strip, Cinema deck controls, Image Lightbox controls bar & viewport, Code Viewer line numbers & syntax container, interactive textarea editor (`.text-code-textarea`), breadcrumb navigation trail, directory items, `(Edited)` badge pills, PDF preview frame, toast notifications, and mobile GPU hardware optimizations. |
| `sw.js` | Offline-first PWA Service Worker (`APP_VERSION = 'v55'`) + Tier 2 `/_stream_download` streaming download interceptor + cache lifecycle + subfolder routing. |
| `assets/` | Structured brand assets: high-res 3D metallic logos, PWA icons, Open Graph social cards, and vector favicon. |
| `js/worker-bridge.js` | Elastic `WorkerPool`, `OrderedReassemblyQueue`, `CreditFlowController`, zero-copy buffer transfers, and streaming pipeline orchestration. |
| `js/crypto-worker.js` | Multi-session background worker supporting `INIT_SESSION`, `CLEANUP_SESSION`, zero-copy STREAM AEAD encryption/decryption, and manifest building/decryption. |
| `js/stream-unpacker.js` | Fast-path manifest parser returning `masterKey: CryptoKey`, selective file extraction bypassing PBKDF2, and stream decryptor. |
| `js/stream-packer.js` | Streaming ZIP64 packager and encrypted manifest builder. |
| `js/stream-crypto.js` | Core mathematical STREAM AEAD primitive implementation (IV, AAD, AES-GCM, PBKDF2). |
| `js/stream-saver.js` | 4-tier streaming file saver (Tier 1 FSA, Tier 2 SW, Tier 3 OPFS, Tier 4 Fallback). |
| `tools/` | Standalone zero-RAM Windows streaming toolset: 1-click batch encryptor (`Encrypt-Vault.bat`), decryptor (`Decrypt-Vault.bat`), and PowerShell engines. |
| `test/` | Automated test suites (33 Android tests, 5 M5 tests, 74 worker bridge tests, 95 stream crypto tests, 142 packager tests, 99 unpacker tests, 250 E2E tests, 21 explorer folder navigation, audio dock & health verification tests). |
| `change-log/index.html` | Interactive web release notes portal with live search and version filter chips. |
| `how-to-use-zevsafe/index.html` | Comprehensive documentation portal with simple step-by-step guides (folder locking, recovery sheets, Vault Explorer media viewing) and an exhaustive Technical Architecture section (`ZV3\0` STREAM AEAD wire layout, deterministic 12B IV, 42B AAD, memory zeroization, worker flow control). |

### 3.4 Web Vault Explorer & In-Browser File Browser Architecture
- **Floating Audio Mini-Player Dock (`dockAudioPlayer`, `expandAudioDock`, `closeAudioDock`):** Persistent bottom player dock allowing uninterrupted audio playback while navigating folders, reading documents, or editing files in Vault Explorer. Synchronizes playback status, track timer, and controls with zero-knowledge session teardown.
- **Vault Cryptographic Health & Bit-Rot Verifier (`verifyVaultIntegrity`):** Comprehensive client-side diagnostic scorecard verifying 57-byte container header, version 3 magic, PBKDF2 salt and iteration floor (>= 100k rounds), 12B IV + 42B AAD layouts, and AES-256-GCM 16-byte authentication tags across all chunks to certify 100% bit-rot-free integrity without disk writes.
- **In-Vault Ephemeral Virtual Filesystem (`addFilesToVault`, `deleteVaultFile`, `renameVaultFile`):** Full in-session file operations allowing drag-and-drop or file picker additions into the active directory (`explorerCurrentDir`), soft deletions marked in `currentV3Vault.deletedFiles`, and in-session renaming with zero unencrypted disk footprint.

### 3.5 Phase 13: 100% True Zero-Network Air-Gap Portability & Google Font Decoupling
- **Complete Decoupling of Font CDNs:** Completely removed all runtime and asset references to `fonts.googleapis.com` and `fonts.gstatic.com`. Stripped all `<link rel="preconnect">` and external stylesheet tags from all 14 HTML pages.
- **Hardened Air-Gapped CSP:** Tightened Content-Security-Policy (CSP) in all HTML pages and Cloudflare `_headers` to `style-src 'self' 'unsafe-inline'; font-src 'self' data:;`, guaranteeing zero outbound network requests and complete air-gap compliance.
- **Modern High-DPI Native System Typography:** Upgraded typography tokens across `styles.css` and `knowledge/knowledge.css` with gorgeous, modern native system font stacks for body (`Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica Neue`, `Arial`, `sans-serif`), display (`Outfit`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica Neue`, `sans-serif`), and code (`JetBrains Mono`, `ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, `Liberation Mono`, `Courier New`, `monospace`). Guarantees zero Cumulative Layout Shift (CLS 0.00).
- **Service Worker Shell v54 & Stale Cache Cleansing:** Bumped `APP_VERSION` to `v54` in `sw.js`, deleted Google Fonts runtime routing and `staleWhileRevalidate` function, and configured cache cleanup to automatically purge stale font caches.

- **Client-Side Safe Markdown Viewer (`renderSafeMarkdown`):** Built-in air-gapped markdown renderer for `.md` and `.markdown` files supporting headers, fenced code blocks, task checkboxes (`- [x]`), inline code, blockquotes, and tables without external CDNs.
- **In-Vault Direct Re-Encryption to `.zev` (`reEncryptVaultToZev`):** Direct in-place re-encryption from Vault Explorer packaging modified and new notes with preserved relative paths into an updated `.zev` streaming container with zero temporary zip roundtripping.
- **Built-in CSPRNG Diceware & Random Password Generator (`initPasswordGenerator`):** Zero-network high-entropy Diceware passphrase generator (770+ word EFF wordlist) and customizable alphanumeric generator with live entropy calculation and 1-click form synchronization.
- **Auto-Lock Inactivity Timer Protocol (`startExplorerIdleWatcher`, `stopExplorerIdleWatcher`):** Tracks user activity and automatically executes zero-knowledge session teardown (`lockVaultSession`) upon configurable idle timeout (5/15/30 min).
- **Hierarchical Directory Tree Engine (`getItemsInDirectory`):** Groups decrypted files at `explorerCurrentDir` into immediate subdirectories and direct files. Computes recursive file counts and total byte sizes per folder in $O(N)$ time with zero memory allocations beyond folder summaries.
- **Interactive Breadcrumb Navigation (`renderBreadcrumbs`):** Renders navigable crumb pills (`📁 Vault Root / photos / vacation`) allowing instant jumping to parent directory levels. In search mode, displays active search query with 1-click query clearing.
- **In-Browser Text Document Editing & Note Creation:** Decrypted Vault Explorer document modal (`#vault-text-modal`) provides interactive `<textarea>` editing (`.text-code-textarea`) for text/code documents with dynamic line numbering (`syncTextareaLineNumbers`), tab indentation (4 spaces), and `Ctrl+S` saving. A `➕ New Note` button in `#explorer-toolbar` enables creating new `.txt` notes in `explorerCurrentDir`.
- **In-Session Decrypted Overlay Map (`editedFiles`):** Newly edited or created text files are kept in `currentV3Vault.editedFiles` (or mutates `currentDecryptedZip`). Requests through `getDecryptedFileBlob(filePath)` dynamically prioritize the overlay Blob, updating file sizes, displaying an `(Edited)` badge pill, and seamlessly bundling edits into full vault exports (`btn-explorer-download-all`) via JSZip.
- **In-Browser Decrypted PDF Document Previewer (`openPdfViewerByPath`):** Dynamically mounts decrypted PDF blobs into a dedicated viewer frame (`#pdf-preview-frame`) in the document modal with `📄 View` buttons and pop-out tab support (`btn-text-open-tab`), keeping PDF document previews air-gapped without disk persistence.
- **Centralized Tracked Blob URL Registry (`activeBlobUrls`):** All object URLs created for previews (media, image lightbox, PDF documents) pass through `createTrackedBlobUrl` and are automatically tracked in a centralized `Set`. `revokeTrackedBlobUrl` and `revokeAllActiveBlobUrls` guarantee immediate memory revocation upon modal dismissal, playlist advancement, or session termination.
- **Universal Zero-Knowledge Session Zeroization (`lockVaultSession`):** Executes unconditionally across all vault architectures (v3 streaming and legacy v1/v2 JSZip). Zeroizes keyfile buffers and chunk caches in volatile RAM with `.fill(0)`, purges `editedFiles` Map and editing states, purges JSZip instances/blobs, resets directory navigation state, scrubs password and keyfile DOM input fields, and revokes all active blob URLs.
- **Scoped Batch Downloads & Select-All:** Checkbox selection dynamically scopes to visible items at the active directory level; batch ZIP generation preserves sanitized relative directory paths via `StreamPacker.sanitizeZipPath`.

---

### 3.6 Phase 14: Native Password Manager Integration & W3C Credential Management API
- **W3C Credential Management API Integration (`saveVaultCredential`, `autofillVaultCredential`):** Standard W3C `navigator.credentials.store()` and `navigator.credentials.get({ password: true })` integration with `PasswordCredential` instantiation. Allows seamless 1-click password saving directly into Chrome Password Manager, Bitwarden, 1Password, Dashlane, Apple Keychain, Edge, and KeePassXC.
- **Standards-Compliant Semantic Hidden Forms (`#vault-credential-form`, `#vault-decrypt-credential-form`):** Embedded hidden forms equipped with standard semantic autocomplete tokens (`autocomplete="username"`, `autocomplete="new-password"`, `autocomplete="current-password"`). Dispatches simulated `submit` events so third-party browser extensions (which listen on form submit events) actively intercept and trigger their native "Save Password" dialogs.
- **Folder-Aware Identifier Binding:** Automatically maps the active vault filename or folder name (`folderName` or `folderName.zev`) to the credential username identifier (`credential.id` & `credential.name`), binding the vault secret to its exact container name to eliminate forgotten passwords.
- **Decryption Prime & 1-Click Autofill (`#btn-autofill-pwd`):** When a `.zev` archive is selected in Decrypt view, automatically pre-fills the hidden username field with `file.name` to prime browser autofill heuristics. The "🔑 Autofill from Password Manager" button invokes `navigator.credentials.get()`, automatically populating the password field and updating UI strength meters.
- **Configurable Auto-Save Prompt Toggle (`#chk-auto-save-pwd`):** Checked by default, automatically executes `saveVaultCredential` upon successful completion of v3 streaming or v1/v2 legacy vault encryption without requiring manual user intervention.


### 3.7 Phase 13 Part 2: 1-Click USB Air-Gap Backup Kit & Standalone Portability Engine (`js/usb-backup-kit.js`)
- **100% Client-Side Pure-JS PKZIP Generator (`buildPKZip`, `computeCRC32`):** Pure JavaScript ZIP implementation complying with PKZIP 2.0 specifications without third-party npm libraries or CDN dependencies. Packages all HTML, CSS, worker, and streaming scripts with calculated IEEE 802.3 32-bit CRCs and UTF-8 path headers.
- **Direct USB Flash Drive Writer (`writeToUsbDirectory`):** Employs the W3C File System Access API (`showDirectoryPicker`) to stream the complete ZevSafe vault suite and subfolder hierarchy directly onto connected USB thumb drives or external storage drives.
- **Cross-Platform Zero-Config Launchers:** Bundles `Launch-ZevSafe-Windows.bat` and `Launch-ZevSafe-Mac-Linux.sh` for 1-click execution on air-gapped computers with automated 127.0.0.1 HTTP local server initiation or direct browser fallbacks.
- **Interactive Cybernetic Modal (`#usb-backup-modal`):** Accessible via desktop navbar (`#btn-open-usb-backup-nav`) and mobile drawer (`#btn-open-usb-backup-mobile`), featuring live progress tracking (`#usb-backup-progress-card`) and 1-click download actions.


### 3.8 Comprehensive Knowledge Hub Service Manual #10: Air-Gap USB Backup (`knowledge/airgap-usb-backup/`)
- **10th Dedicated Service Manual:** Step-by-step disclosures in dual perspective (Simple User Guide vs Technical Cryptographic Specification) for the 1-Click USB Air-Gap Backup Kit, pure-JS PKZIP 2.0 binary architecture, W3C File System Access API direct streaming, Google Font decoupling, and cross-platform offline launchers.
- **Service Manual #07 Update (`knowledge/passwords-autolock/`):** Added complete Simple and Technical disclosures for Phase 14 Native Password Manager Integration, detailing the W3C Credential Management API (`PasswordCredential`), semantic hidden forms (`autocomplete="username"`, `autocomplete="new-password"`, `autocomplete="current-password"`), extension form submit event triggers, and vault filename binding.
- **Interactive Search & Card Grid (`knowledge/index.html`):** Expanded to 10 service cards with real-time tag-based search and filter counters.


### 3.9 Collapsible Max Security Options Bar & Pill Button (Design 2)
- **Minimalist Encryption Card Redesign (`#max-security-bar`, `#btn-toggle-max-security`, `#max-security-collapsible`):** Tucks the advanced, screen-crowding security panels (Key Derivation Hardening select, Polyglot Media Camouflage, Duress Decoy Vault) behind an understated, cybernetic pill button.

### 3.10 Phase 11: Know Your Device Power — Cryptographic Hardware Benchmark & Profiler (`device-power/index.html`, `js/device-benchmark.js`)
- **100% Client-Side Cryptographic Profiler:** Benchmarks raw WebCrypto hardware acceleration (AES-NI / NEON instructions), measuring parallel chunk streaming throughput (MB/s) and PBKDF2-SHA512 key derivation latency across standard and hardened tiers (600,000, 1,200,000, and 2,400,000 rounds).
- **Zero-Knowledge Memory-Bounded Execution (< 20 MB RAM):** Uses reusable 1MB buffers to stream multi-megabyte stress tests without accumulating heap allocations, and immediately scrubs all test keys, salts, and plaintexts via `.fill(0)`.
- **Hardware Tier Classification:** Classifies machines into Class S (Cyber-Station ⚡, > 650 MB/s, <= 300ms KDF), Class A (High-Efficiency 🚀, 350-650 MB/s, 300-650ms KDF), Class B (Balanced Everyday ⚖️, 120-350 MB/s, 650-1300ms KDF), and Class C (Low-Power 🛡️, < 120 MB/s, > 1300ms KDF).
- **Tailored Vault Recommendations:** Generates machine-specific PBKDF2 iteration recommendations informing users whether their hardware can run 1.2M or 2.4M rounds with zero perceived UI latency. Linked directly from the Max Security options bar in `index.html`.
- **PWA & Offline Integration:** Precached under Service Worker cache `v60` in `sw.js` with section routing for `/device-power` and `/know-your-device-power`, bundled into `usb-backup-kit.js`, and indexed in `sitemap.xml`.
- **Dynamic Active State Highlighting (`.btn-max-security-pill.is-active`):** If any non-default security feature is engaged (e.g. 1.2M or 2.4M PBKDF2 rounds, polyglot cover enabled, or decoy vault armed), the pill button glows emerald and automatically expands so the user retains immediate visibility of their active security configuration.
- **Zero-Friction Default Experience:** First-time and standard users enjoy a clutter-free, fast 1-field password flow without visual overload.

### 3.11 Phase 9: Visual Paper-Safe & Optical QR Emergency Recovery Sheet (`js/qr-engine.js`, `index.html`, `app.js`, `styles.css`) [v8.10.0]
- **Air-Gapped Pure-JS QR Engine (`js/qr-engine.js`):** Built a zero-dependency ISO/IEC 18004 QR Code Model 2 engine implementing Byte Mode data encoding (UTF-8), Galois Field GF(256) arithmetic, standard Reed-Solomon polynomial division, dynamic version scaling (V1 to V14), and 8-mask penalty scoring.
- **Scalable Vector SVG Rendering:** Outputs crisp, standalone `<svg>` markup with configurable pixel sizing, color palettes, quiet zones, and accessible title tags. Supports direct canvas drawing with `window.devicePixelRatio` scaling.
- **Cold-Storage Zero-Knowledge Principle:** Raw passwords are never transmitted to shared or network printers; provides structured handwriting boxes for indelible pen Diceware passphrases and formatted 8-group CSPRNG salt fingerprints (`XXXX-XXXX-XXXX-...`).
- **Standalone Air-Gapped Printable Recovery Certificate (.html):** One-click download of a self-contained, single-file HTML cold-storage certificate featuring security Guilloche dashed borders, high-contrast `@media print` rules for physical A4/Letter paper safes, embedded SVG QR, and offline restoration manuals.
- **In-App Optical QR Scanner & Image Drop Decoder (`#qr-scanner-modal`):** Integrated a camera viewfinder (`navigator.mediaDevices.getUserMedia`) with animated laser targeting utilizing the native W3C `BarcodeDetector` API for real-time camera scanning, plus a drag-and-drop image decoder for scanned photos and screenshots.
- **Decrypt View Auto-Fill:** "📷 Scan Paper QR" button next to password field, automatic parameter population (salt fingerprint verification badge, KDF iteration preset, safe location hint), and smooth autofocus into the passphrase input.
- **PWA & Offline Integration:** Precached under Service Worker cache `v61` in `sw.js` and bundled into `js/usb-backup-kit.js` for 100% offline air-gap portability.


### 3.12 Master Plan & Strategic Roadmap Pill UI Portal (`roadmap/index.html`, `styles.css`, `index.html`) [v8.11.0]
- **Interactive 14-Phase Ecosystem Blueprint (`roadmap/index.html`):** A dedicated, zero-external-network portal documenting the 14-phase engineering roadmap that evolves ZevSafe from an authenticated streaming container into a zero-footprint ephemeral virtual operating environment.
- **Desktop & Mobile Navbar Pill UI (`#nav-roadmap-pill`, `.plan-pill-nav`):** Cybernetic pill button embedded in the main navigation bar, mobile hamburger navigation drawer, and footer, displaying a real-time progress counter badge (`11 / 14`) with smooth hover elevation and responsive layout adaptations.
- **Filterable Status Matrix & Live Progress HUD:** Instant client-side status filtering (`All 14`, `Shipped 11`, `Up Next 1`, `Planned 2`) and visual progress bar (`78.5% Complete`, 11 of 14 shipped) with interactive phase cards highlighting architectural deliverables and cryptographic tags.
- **Deep-Dive Technical Architecture Inspector Drawer (`#rm-drawer`):** Slide-out inspector modal exposing detailed cryptographic parameters, standard RFCs, memory bounding bounds, execution latencies, binary footprints, and fallback strategies for each roadmap phase.
- **Zero-Network & Air-Gap Compliance:** Strict Content Security Policy (`default-src 'self'`), zero Google font requests, zero CDN scripts, and zero telemetry. Precached in Service Worker cache `v62` (`sw.js`), included in `SECTION_ROUTES`, bundled into the 1-Click USB Air-Gap Backup Kit (`js/usb-backup-kit.js`), and indexed in `sitemap.xml`.


### 3.13 Optical Paper-Safe Clipboard & Paste System (`js/qr-engine.js`, `app.js`, `index.html`, `styles.css`) [v8.12.0]
- **Unified Clipboard & Screenshot Paste System:** Users can press `Ctrl+V` (or `Cmd+V`) anywhere on the Decrypt screen or within the Optical QR Scanner modal with an image/screenshot in their clipboard (from Snipping Tool, Win+Shift+S, PrtScn, or browser copy) to instantly decode and apply Paper-Safe parameters in client-side RAM.
- **Intelligent Password Field Interception:** Pasting raw Paper-Safe text payloads (JSON, `ZEVSAFE_PAPER:`, or markdown code blocks) directly into the `decrypt-password` input automatically extracts the vault parameters, applies the salt fingerprint and KDF preset, and clears the password field so the user can enter their handwritten passphrase cleanly without payload contamination.
- **1-Click Clipboard Paste Action (`#btn-paste-qr-clipboard`):** Added an accessible, cybernetic clipboard paste button that leverages the native `navigator.clipboard.read()` (for image blobs) and `navigator.clipboard.readText()` (for JSON strings) with descriptive toast feedback.
- **Forgiving & Multi-Format Payload Parsing (`QREngine.parsePaperSafePayload`):** Upgraded parser to tolerate surrounding markdown, codeblocks (```json), optional prefixes (`ZEVSAFE_PAPER:`, `ZEVSAFE:`), base64-encoded strings, and whitespace while strictly verifying cryptographic bounds.
- **PWA & Offline Integration:** Precached under Service Worker cache `v63` in `sw.js`.


### 3.14 Master Key QR 1-Scan Vault Unlock Engine (`js/qr-engine.js`, `app.js`, `index.html`) [v8.13.0]
- **Master Key QR Code Embedding:** Allows the QR code on the Paper-Safe recovery sheet to act as a physical **Master Keycard** by embedding the master password directly into the QR payload (`pw: String(password)`). Controlled by an intuitive toggle (`#chk-paper-embed-password`, enabled by default).
- **1-Scan Zero-Typing Vault Unlock:** When the Master Key QR is scanned via camera, pasted via `Ctrl+V` screenshot, or uploaded as an image, ZevSafe instantly extracts the password, populates `#decrypt-password`, and immediately triggers decryption if the `.zev` vault file is already selected. Eliminates manual passphrase typing and technical parameter configuration.
- **Visual Keycard Sheet Design:** When password embedding is enabled, the printed recovery certificate automatically switches to a prominent `⚡ ZV3 MASTER KEYCARD` layout displaying `⚡ Instant Unlock QR Keycard` and a clear monospace keycard box, while preserving the standard blank handwriting mode when unchecked.
- **PWA & Offline Integration:** Precached under Service Worker shell cache `v64` in `sw.js`.


### 3.15 280-Item Feature Checklist Master Audit & Strategic Remediations [v8.13.0]
- **Exhaustive 280-Item Audit Certification (`CHECKLIST_AUDIT_REPORT.md`):** Conducted a deep technical audit covering all 280 items across Sections 1 to 12 (Core Encryption, Core Decryption, Vault Explorer VFS, Paper-Safe QR System, Vault Health Tools, Password Manager Integration, Navigation & UI, Companion Portals, PWA & Offline, Security & CSP, Performance & Mobile, SEO & Sitemap). Certified 100% PASS post-remediation.
- **Decryption `OperationError` User Feedback:** Updated `app.js:2651-2658` to invoke `showToast('Decryption failed: Wrong password, wrong keyfile, or corrupted vault.', 'error')` and `shakeField('decrypt-password')` on WebCrypto authentication tag / decryption failure.
- **Global Clipboard Paste Target Fix:** Corrected element reference in `app.js:7886-7892` from non-existent `view-decrypt` to `decrypt-section`, restoring global optical QR screenshot and payload clipboard auto-fill.
- **Interactive Light/Dark Theme Switcher & Persistence:** Added `#btn-theme-toggle` in the desktop navbar and `#btn-theme-toggle-mobile` in the mobile drawer with sun/moon icons and state badges. Persists user preference via `localStorage.getItem('zevsafe_theme')` / `localStorage.setItem('zevsafe_theme')`.
- **Mobile Drawer Version Badge Synchronization:** Synchronized Knowledge Hub mobile drawer badge from `v8.8.0` to `v8.13.0` in `index.html:228`.
- **Security Headers & Camera Permissions Hardening:** Added `frame-src 'self' blob:;` to CSP for sandboxed PDF previews and updated `Permissions-Policy` to `camera=(self)` in `_headers` to enable optical QR camera scanning on Cloudflare Pages.
- **WCAG 2.1 AA Color Contrast Hardening:** Updated light-theme modal `--text-3` to `#7c8ba1` (5.70:1 contrast against `#08091a`) and mobile tab / toggle text to `#475569` (7.24:1 AAA contrast) in `styles.css`.
- **Bounded LRU Cache Eviction Zeroization:** Updated `createBoundedChunkCache.set()` in `js/stream-unpacker.js:1085-1095` to invoke `this.delete(oldestKey)` on LRU eviction and key overwrite, ensuring all plaintext chunk buffers are immediately zeroized with `.fill(0)`.
- **Open Graph & Social Metadata Synchronization:** Added canonical Open Graph and Twitter Card meta tags across all 13 companion portals and service manual subpages.
- **Automated Regression Verification Suite:** Created `test/test-checklist-remediations.js` (8/8 tests passed; 123/123 assertions passed across all 7 suites).

### 3.16 Video Player 2.0 (Pro Cinema Upgrade) [v8.14.0]
- **Precision Cybernetic Timeline Scrubber:** Custom timeline replacing native browser controls with dynamic buffered range visualization (`video.buffered`), gradient progress fill (`#38bdf8` to `#8b5cf6`), glowing draggable thumb, and real-time hover timestamp tooltip (`MM:SS`).
- **Forensic Single-Frame Stepper (`.` / `,`):** Allows nudging playback forward and backward by single 33.3ms frames (30/60 fps) for granular video inspection, automatically pausing playback for forensic accuracy.
- **1-Click Full-Resolution Frame Snapshot (`📸 Snap Frame` / `S`):** Extracts the active video frame at full native resolution (`video.videoWidth` × `video.videoHeight`) via an offscreen `<canvas>` with any active rotation/flip and filters applied. Saves directly into the decrypted vault overlay (`currentV3Vault.editedFiles`) and downloads as a PNG.
- **Lossless Hardware-Accelerated 90° Rotation & Flip:** Supports 90° step rotation (`↺ 90°` / `↻ 90°` / `R`) and mirroring (`⇄ Flip H` / `⇅ Flip V`) via GPU compositor CSS transforms without re-encoding latency.
- **Real-Time Forensic Video Filters:** Real-time CSS filter pipeline for video: Brightness (+35% for dark/night footage), High Contrast (+50% for text clarity), Forensic Invert (negative analysis), CCTV B&W monochrome, and 1-tap reset.
- **WebAudio 200% Audio Gain Booster (`AudioContext` + `GainNode` / `B`):** Amplifies quiet recordings up to 2.0× volume without clipping, with zero-leak teardown on modal close and track switches.
- **Stage Center Ripple & Double-Tap Gestures:** Single-click on stage toggles play/pause with an expanding center ripple icon (`▶` / `⏸`); double-clicking the left 35% rewinds 10s (`⏪ 10s`), and double-clicking the right 35% advances 10s (`10s ⏩`).
- **Aspect Ratio & Loop Controls:** 1-click aspect switcher (Fit, Fill, 16:9, 4:3) and loop toggle (`🔁 Loop: On/Off`).
- **Extended Keyboard Matrix:** Full keyboard control (Space, K, J, L, ,, ., B, R, S, F, P, M, Arrows).
- **PWA & Offline Integration:** Precached under Service Worker cache `v65` (`APP_VERSION = 'v65'`) in `sw.js`. Verified by `test/test-video-player-pro.js` (19/19 tests).

### 3.17 Video Player 3.0 (Pro Studio Upgrade) [v8.15.0]
- **Interactive Forensic Loupe Pan & Zoom (`1.0×` to `5.0×`):** Allows smooth forensic zooming on live playing or paused video via mouse wheel or dedicated toolbar controls (`🔍+ In`, `🔍- Out`, `1:1 Reset`). Users can drag/pan across the zoomed viewport with mouse or touch. Floating HUD badge (`🔍 100%`) provides real-time magnification level feedback.
- **A-B Forensic Segment Looper:** Precision point-to-point looping for repetitive motion review, surveillance analysis, or learning. Set Point A (`[` / `[ Set A`) and Point B (`]` / `Set B ]`) with glowing visual marker pins on the scrubber track and a translucent highlighted range band (`#media-timeline-ab-range`). Seamlessly loops playback from Point B back to Point A. Cleared with `\` or `✕ Clear`.
- **Forensic Timestamp Bookmarks (`📌 Mark` / `Shift+M`):** 1-click timestamp marking that drops interactive luminous amber pin markers on the cybernetic timeline scrubber. Hovering displays the bookmark timecode, and clicking seeks directly to that exact millisecond.
- **WebAudio Vocal Clarity Equalizer (`🎙️ Vocal` / `V`):** Integrated `BiquadFilterNode` peaking filter (+8dB boost at 2500 Hz, Q=1.2) tuned for human speech clarity and dialogue intelligibility, cutting through background rumble and noisy environments.
- **Ambient Cinema Glow (Ambilight Mode `✨ Ambient`):** High-performance canvas-based ambient backlight system (`#cinema-ambient-canvas`) mirroring active video border colors behind the stage with GPU-accelerated blur (48px) and zero idle CPU draw when paused.
- **Extended Playback Speed Deck (`0.25×` to `4.0×`):** Added 0.25x Super Slow-Motion and 3.0x/4.0x high-speed presets with `<` and `>` keyboard shortcuts for instant speed nudging.
- **Extended Keyboard Shortcuts Matrix:** Full studio keyboard matrix (`[`, `]`, `\`, `V`, `+`, `-`, `0`, `<`, `>`, `Shift+M`, Space, K, J, L, ,, ., B, R, S, F, P, M, Arrows).
- **Service Worker & Verification:** Precached under `APP_VERSION = 'v66'` in `sw.js`. Verified by `test/test-video-player-pro.js` (21/21 assertions, 100% pass).

### 3.18 Video Player 4.0 (On-Demand Range Streaming Engine & Instant Playback) [v8.16.0]
- **Instant Playback for Large Videos (> 1 GB up to 5 GB):** Solved the root cause of user-reported 1–2 minute startup latency and video stuttering. Instead of decrypting hundreds of chunks (1–2 GB) into a monolithic `Uint8Array` / `Blob` upfront, video playback starts **instantly (< 1 second)** via partial range streaming.
- **Byte-Exact Range Extractor (`StreamUnpacker.extractFileRange`):** Reads and decrypts only the specific 4 MB chunks holding the requested byte range. Because pre-compressed video and audio media files are stored using ZIP STORE mode (uncompressed, method 0), plaintext offsets map 1:1 to encrypted chunk positions: `targetChunk = Math.floor((localHeaderOffset + headerLen + startPos) / 4194304)`. Serving any 1–2 MB range takes only ~25 ms instead of 120,000 ms.
- **Synthetic Service Worker Range Route (`/_stream_media?id=...`):** Service Worker fetch handler intercepts native browser `Range: bytes=start-end` requests from `<video>` and `<audio>`, exchanges range slices with the client page via `MessageChannel` (`READ_MEDIA_RANGE` / `MEDIA_RANGE_DATA`), and returns standard `HTTP/206 Partial Content` with `Content-Range: bytes START-END/TOTAL` and `Accept-Ranges: bytes`.
- **Strictly Bounded Memory (< 60 MB RAM Peak):** Completely eliminates the 2–3 GB memory explosion caused by allocating multi-gigabyte blobs on the main thread heap. Decrypted chunks are held in a bounded LRU cache (6 chunks = 24 MB), preventing browser tab crashes, frame drops, and GC freezing.
- **Instant Timeline Seeking:** Seeking to any point across multi-GB files (e.g. jumping from minute 1 to minute 45) takes only ~25–35 ms because only the destination chunk is fetched and decrypted on demand.
- **Seamless Progressive Fallback:** Automatically utilizes on-demand range streaming for v3 vaults while gracefully preserving full fallback to `getDecryptedFileBlob` for legacy vaults or environments without Service Worker support.
- **On-Demand Decrypted Download:** The cinema modal download button (`#btn-media-download`) extracts the full file blob only when explicitly requested by the user, conserving RAM during standard playback.
- **PWA Service Worker & Verification:** Shell cache bumped to `APP_VERSION = 'v67'` in `sw.js` and `WEB-VERSION-67` in `index.html`. Automated regression verified by `test/test-video-player-pro.js` (29/29 tests, 100% pass rate).

## 4. Companion Android App Architecture (`../app-zevsafe`)

Located at `C:\Users\Raju\Another-world\GitHub\zevbuild-studio\app-zevsafe` (GitHub: [`zevbuild/app-zevsafe`](https://github.com/zevbuild/app-zevsafe)):
- **Package ID:** `com.zevbuild.zevsafe` (`v6.4.2`, Build `33`, `compileSdk = 35`, `minSdk = 26`).
- **Key Components:**
  - `CryptoEngine.kt`: Native JVM/Kotlin `ZV3\0` STREAM AEAD implementation + `V3DecryptedInputStream` pull stream + legacy v1/v2 compatibility.
  - `VaultViewModel.kt`: MVVM state holder with `Dispatchers.Main` thread-safe completion callbacks, automatic saving of `.zev` and `.zip` outputs to the device's `Downloads` folder (`MediaStore.Downloads`), and on-demand extraction (`extractSingleFileIfNeeded`, `exportDecryptedZip`).
  - `VaultForegroundService.kt`: Android 14 `dataSync` foreground service with partial wake lock and live notification progress bar.
  - `FileProvider`: Dynamic `${applicationId}.fileprovider` authority in `AndroidManifest.xml` matched with `"${context.packageName}.fileprovider"` across `EncryptScreen.kt`, `DecryptScreen.kt`, and `VaultBrowserScreen.kt`.
  - **Brand Assets:** Quantized PNG + WebP and minified `favicon.svg`.
  - **Full Android Project Memory:** See [`../app-zevsafe/PROJECT_MEMORY.md`](../app-zevsafe/PROJECT_MEMORY.md) and [`../app-zevsafe/PROJECT-MEMORY/`](../app-zevsafe/PROJECT-MEMORY/).

---

## 5. Mandatory Verification & Sync Checklist for Every Change

1. **Update `PROJECT_MEMORY.md`** (and `../app-zevsafe/PROJECT_MEMORY.md` + `PROJECT-MEMORY/*.md` if Android is affected).
2. **Update `CHANGELOG.md`** and **`change-log/index.html`**.
3. **Update `README.md`** (badges, features, version references).
4. **Bump `sw.js` (`APP_VERSION`) and `index.html` (`WEB-VERSION-XX`)** whenever web shell assets change.
5. **Run Regression Tests:**
   ```bash
   node test/test-android-encryption.js
   node test/test-integration-m5.js
   node test/test-worker-bridge.js
   node test/test-stream-crypto.js
   node test/test-stream-packer.js
   node test/test-stream-unpacker.js
   node test/e2e-tests.js
   ```
   Ensure 100% pass rate across all suites.
