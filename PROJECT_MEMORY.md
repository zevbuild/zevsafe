# 🧠 ZevSafe Ecosystem — Project Memory (`zevsafe` & `app-zevsafe`)

> **System Memory, Architecture & Cross-Platform Reference for AI Agents**  
> **Web Portal Version:** `v8.2.0` (`WEB-VERSION-53`, Service Worker `v53`)  
> **Native Android App (`app-zevsafe`):** **DEPRECATED & SUNSET** — All mobile development unified into Web PWA (`zevsafe.pages.dev`). Historical repository archived at [`zevbuild/app-zevsafe`](https://github.com/zevbuild/app-zevsafe).
> **Future Plans & Roadmap:** Documented in [`future-plans/FUTURE_PLAN.md`](future-plans/FUTURE_PLAN.md) (Completed Phases 1–7; Upcoming Phases 8–14: Argon2id WASM, Visual Paper-Safe QR Sheet, Document Redaction, Hardware Profiler, Offline i18n, True Offline USB Backup & Font Decoupling, Native Password Manager Integration).

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
- **Air-Gapped PWA Precaching:** All 12 Knowledge Hub pages and assets are precached in `SHELL_ASSETS` (`APP_VERSION = 'v53'`) for 100% offline availability in airplane mode.

### 3.3 Component Directory

| File / Directory | Responsibility |
|---|---|
| `_headers` | Cloudflare Pages HTTP response headers enforcing server-level CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `/sw.js` cache control. |
| `security-audit/index.html` | Public web presentation of the official Security Audit Report with interactive severity filters, real-time search, scorecard metrics, and responsive deep-dives. |
| `SECURITY_AUDIT_REPORT.md` | Authoritative security audit and hardening attestation report (Score: 96/100, Grade A+) documenting 20 vulnerability remediation proofs, CVSS ratings, and verification test matrices. |
| `FORMAT.md` | Authoritative binary container specification defining `ZV3\0` STREAM AEAD, 57-byte header, 4 MB chunk wire framing, 12-byte IV & 42-byte AAD math, encrypted tail manifest JSON schema, and selective extraction. |
| `index.html` | Primary vault UI, Encrypt/Decrypt cards, 60 FPS Telemetry HUD with live throughput & workers badge, Vault Explorer modal, Cinema Media Player, Image Lightbox modal, Code & Text Viewer/Editor modal (`#vault-text-modal`), approved modern navbar, cryptographic trust strip (`WEB-VERSION-52`). |
| `app.js` | Main-thread controller, drag-and-drop traversal, entropy meter, Vault Explorer UI with instant session key extraction, hierarchical directory drill-down & breadcrumb navigation, in-browser PDF previewer, interactive in-browser text file editor (`toggleTextEditMode`, `saveTextFileChanges`), in-vault note creation (`createNewTextFile`), session overlay Map (`editedFiles`), tracked blob URL registry, Cinema streaming media player, high-res Image Lightbox controller with pan/zoom/rotate, Code & Text reader with line numbers and copy-to-clipboard, Telemetry HUD controller, and universal session zeroization protocol. |
| `styles.css` | Glassmorphic theme system, adaptive Telemetry HUD grid, modern navbar & hero trust strip, Cinema deck controls, Image Lightbox controls bar & viewport, Code Viewer line numbers & syntax container, interactive textarea editor (`.text-code-textarea`), breadcrumb navigation trail, directory items, `(Edited)` badge pills, PDF preview frame, toast notifications, and mobile GPU hardware optimizations. |
| `sw.js` | Offline-first PWA Service Worker (`APP_VERSION = 'v49'`) + Tier 2 `/_stream_download` streaming download interceptor + cache lifecycle + subfolder routing. |
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
