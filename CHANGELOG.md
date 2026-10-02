# Changelog

## Version 6.6 (WEB-VERSION-34) — October 2, 2026
- `UI` (`styles.css`, `index.html`): Streamlined above-the-fold visual experience with approved modern navbar and hero redesign. Transformed the navigation header with live `● 100% Offline` status pulse badge, subtle link styling, and clean vector action pills (`Android App`, `PC Toolkit (25GB+)`). Elevated the hero section with a frosted cryptographic trust strip highlighting AES-256-GCM, 600,000 PBKDF2 Iterations, and 100% Air-Gapped architecture. Reduced shell vertical gaps (`4rem` → `2.25rem`) and hero padding, bringing the core Encrypt and Decrypt drop zones directly above the fold on standard laptops without scrolling. Updated headline to high-impact cybersecurity value proposition: *"Encrypt Anything. Expose Nothing. Private Folder Vaults Running 100% In-Browser."*
- `UI` (`styles.css`, `app.js`): Replaced all blocking browser `window.alert()` dialogs with a modern, non-blocking glassmorphic Toast Notification System (`showToast`) featuring auto-dismiss, smooth entry/exit animations, status indicators (info, warning, error, success), and inline validation error shake (`@keyframes fieldShake`) on drop zones and password inputs.
- `UI` (`styles.css`): Fixed card height asymmetry and CTA baseline alignment. Unified vault card heights using CSS Grid `align-items: stretch` and anchored primary action buttons (`#btn-encrypt`, `#btn-decrypt`) to the bottom via `margin-top: auto`.
- `Fix` (`styles.css`): Resolved the 440px wide `.v2-badge` stretching glitch in the 5 GB Streaming Mode toggle container by setting `align-self: flex-start;` and `align-items: flex-start;`.
- `Fix` (`styles.css`, `index.html`): Re-docked the PWA Install banner as a floating card in the bottom-right corner (`bottom: 24px; right: 24px; max-width: 380px;`) so it never obscures drop zones or action buttons. Added persistent 7-day dismissal memory via `localStorage`.
- `UI` (`styles.css`, `app.js`): Fixed tablet (≤ 820px) tab switching synchronization. Clicking `[🔐 Encrypt]` and `[🔓 Decrypt]` now dynamically toggles single-panel visibility across tablet viewports, eliminating double-card vertical stacking and excessive page scrolling. Added clean resize state restoration.
- `UI` (`styles.css`): Fixed mobile navbar overcrowding by hiding secondary desktop PC setup buttons on narrow screens (`≤ 640px`) and enforcing `white-space: nowrap;` on all navigation pills to eliminate multi-line text wrapping.
- `UI` (`styles.css`): Neutralized dropzone empty state text (`.drop-selected`) color to a muted slate hue, resolving misleading green success styling when no files are loaded. Increased password field right padding to `3rem` to ensure comfortable clearance from the visibility toggle eye icon.
- `PWA` (`sw.js`, `index.html`, `change-log/index.html`): Bumped Service Worker offline shell cache to `v34` and synchronized release indicators to `WEB-VERSION-34`.

---

## Version 6.5 (WEB-VERSION-33) — October 2, 2026
- `Brand` (`assets/zevsafe-logo.svg`, `assets/zevsafe-logo.png`, `assets/zevsafe-logo.webp`, `assets/icon-192.png`, `assets/icon-192.webp`, `assets/icon-512.png`, `assets/icon-512.webp`, `assets/zevsafe-og.png`, `assets/zevsafe-og.webp`, `assets/favicon.svg`, `favicon.svg`): Adopted the official "Orbit Concept" visual brand identity system representing a self-contained, air-gapped cryptographic ecosystem. Deployed mathematical SVG master vectors, high-efficiency quantized 512×512 brand marks, PWA launcher & splash icons (192×192, 512×512), 1200×630 OpenGraph social preview card, and matching SVG vector favicons.
- `Refactor` (`assets/`): Organized brand logos (`zevsafe-logo.png`, `zevsafe-logo.webp`), PWA launcher icons (`icon-192.png`, `icon-192.webp`, `icon-512.png`, `icon-512.webp`), social share previews (`zevsafe-og.png`, `zevsafe-og.webp`), and vector favicon into a structured `assets/` directory with comprehensive usage documentation (`assets/README.md`). Preserved root `favicon.svg` for direct browser requests to eliminate 404s.

- `Fix` (`sw.js`, `manifest.json`, `index.html`, `how-to-use-zevsafe/index.html`, `change-log/index.html`): Updated all image paths, Open Graph meta tags, and Web App Manifest icons to `./assets/`. Enhanced Service Worker cache routing with regex alias fallback to serve legacy root image requests from `assets/` seamlessly.
- `PWA` (`sw.js`, `index.html`, `change-log/index.html`): Bumped Service Worker offline shell cache to `v33` and synchronized release indicators to `WEB-VERSION-33`.

---

## Version 6.4 (WEB-VERSION-32) — October 2, 2026
- `Refactor` (`tools/`, `docs/`): Cleanly organized codebase files and folders across the repository. Moved standalone Windows batch launchers (`Encrypt-Vault.bat`, `Decrypt-Vault.bat`) and PowerShell streaming scripts (`encrypt.ps1`, `decrypt.ps1`) into a dedicated `tools/` folder with documentation. Moved internal engineering architecture, design specifications, test infrastructure, and task trackers (`PROJECT.md` → `docs/ARCHITECTURE.md`, `docs/WEB_APP_DESIGN.md`, `docs/TEST_INFRA.md`, `docs/TEST_READY.md`, `docs/ORIGINAL_REQUEST.md`, `docs/task.md`) into a structured `docs/` directory with a navigation index `README.md`. Removed empty scratch directories (`project-brain`).
- `Fix` (`app.js`, `sw.js`): Updated in-browser 1-click PC setup packager in `app.js` to fetch PowerShell scripts from `tools/` with fallback to root, and added `tools/` assets to the Service Worker `SHELL_ASSETS` precache with alias routing.
- `PWA` (`sw.js`, `index.html`, `change-log/index.html`): Bumped Service Worker offline shell cache to `v32` and synchronized release indicators to `WEB-VERSION-32`.

---

## Version 6.3 (WEB-VERSION-31) — September 30, 2026
- `New` (`app-zevsafe`): Launched the companion standalone native Android application ([`zevbuild/app-zevsafe`](https://github.com/zevbuild/app-zevsafe/releases/latest)) built in Kotlin and Jetpack Compose (`com.zevbuild.zevsafe` v6.3.0). Features bit-identical `ZV3\0` STREAM AEAD chunked cipher pipeline, AndroidX Media3 ExoPlayer Cinema streaming video/audio player, persistent background encryption via Android 14 `ForegroundService` with notification progress telemetry, and native system share sheet integration (`ACTION_VIEW`, `ACTION_SEND`, `ACTION_SEND_MULTIPLE`). Pre-compiled APKs are distributed via official GitHub Releases.
- `Fix` (`app-zevsafe`: `AndroidManifest.xml`, `EncryptScreen.kt`, `DecryptScreen.kt`, `VaultBrowserScreen.kt`, `VaultViewModel.kt`): Resolved `FileProvider` authority mismatch (`com.zevbuild.zevsafe.fileprovider`), dispatched completion UI callbacks safely onto `Dispatchers.Main`, and added automatic saving of encrypted `.zev` vaults and exported `.zip` archives directly to the device's `Downloads` folder via `MediaStore.Downloads`.
- `Perf` (`app-zevsafe`: `icon-192.png`, `icon-512.png`, `zevsafe-logo.png`, `cyber-vault.png`, `favicon.svg` + `.webp` variants): Compressed all logos and images in `app-zevsafe` from 2.24 MB down to 148.90 KB (93.4% reduction) and generated next-generation WebP variants.
- `New` (`PROJECT_MEMORY.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.agents/rules/auto_update_docs.md`, `app-zevsafe/PROJECT_MEMORY.md`, `app-zevsafe/PROJECT-MEMORY/`): Added comprehensive cross-platform Project Memory knowledge base and mandatory AI agent synchronization rules across both `zevsafe` and `app-zevsafe` so any AI agent can immediately understand the architecture and state.
- `New` (`index.html`, `how-to-use-zevsafe/index.html`, `change-log/index.html`): Integrated prominent Android App (APK) download links in the primary navigation header, hero tech line, and footer across all portal pages, directing users to the official [ZevSafe Android Releases](https://github.com/zevbuild/app-zevsafe/releases/latest).
- `UI` (`styles.css`): Added custom emerald-themed `.nav-pill--android` button styling with glow effect and full light/dark theme contrast support.
- `PWA` (`sw.js`, `index.html`, `change-log/index.html`): Bumped Service Worker offline shell cache to `v31` and synchronized release indicators to `WEB-VERSION-31`.

---

## Version 6.3 — September 30, 2026
- `UI` (`styles.css`, `app.js`, `change-log/index.html`, `how-to-use-zevsafe/index.html`): Universal auto-hiding navigation header and brand logo on scroll down across all desktop, laptop, tablet, and mobile devices and all browsers (Chrome, Edge, Safari, Firefox, Opera). Removed viewport boundaries; the sticky header smoothly slides out of view (`transform: translateY(-110%)` with opacity transition) on downward scroll, maximizing screen real estate for the vault interface, and restores instantly upon scrolling up or reaching the top.
- `Perf` (`styles.css`, `app.js`): Implemented passive event listeners, `requestAnimationFrame` debouncing, and CSS `will-change: transform` with hardware WebKit acceleration (`-webkit-transform`) for buttery 60/120/144 FPS scroll fluidity with zero thread blocking.
- `PWA` (`sw.js`, `index.html`, `change-log/index.html`): Bumped Service Worker offline shell cache to `v30` and synchronized release indicators to `WEB-VERSION-30`.

---

## Version 6.2 — September 30, 2026
- `Perf` (`zevsafe-og.png`, `icon-192.png`, `icon-512.png`, `zevsafe-logo.png`): High-efficiency compression of all brand images and logos in-place, slashing image transfer size from 809 KB to 348 KB (57%+ reduction) for lightning-fast first paint and instant offline PWA caching.
- `New` (`zevsafe-logo.webp`, `icon-192.webp`, `icon-512.webp`, `zevsafe-og.webp`, `manifest.json`): Generated modern next-generation WebP variants and integrated them into PWA `manifest.json` (`icon-512.webp` at 26.6 KB [93.8% smaller], `icon-192.webp` at 7.3 KB [90.4% smaller]).
- `Perf` (`favicon.svg`): Minified vector SVG favicon, stripping whitespace and comments.
- `PWA` (`sw.js`, `index.html`, `change-log/index.html`): Bumped Service Worker offline shell cache to `v29` and synchronized release indicators to `WEB-VERSION-29`.

---

## Version 6.1 — September 30, 2026
- `UI` (`styles.css`): Auto-hide hero section (`<header class="hero">`) on mobile screens (≤ 600px) to maximize vertical viewport space, bringing vault controls and drop-zones immediately to the top of mobile devices.
- `UI` (`styles.css`, `app.js`, `change-log/index.html`, `how-to-use-zevsafe/index.html`): Added auto-hiding top header and brand logo on mobile scroll down (≤ 820px) with `requestAnimationFrame` debounced scroll-direction tracking and smooth hardware-accelerated slide transitions (`translateY(-110%)`); smoothly reappears when scrolling up or near the top.
- `PWA` (`sw.js`, `index.html`, `change-log/index.html`): Bumped Service Worker offline shell cache to `v28` and synchronized app release badges to `WEB-VERSION-28`.

---

## Version 6 — September 28, 2026
- Mobile Micro-Hero (`styles.css`): Replaced hidden mobile hero with a sleek, compact micro-hero displaying the privacy badge, responsive title, and two-line clamped tagline so mobile visitors retain immediate context and orientation.
- Glassmorphic Specular Card Elevation (`styles.css`): Added specular top highlights and tuned hover glows to primary encryption and decryption vault cards for greater visual depth.
- Light Theme Dark Surface Contrast Fixes (`styles.css`): Scoped high-contrast light typography and controls to modals, cinema player deck, telemetry HUD, and progress panels, preventing contrast inversion under light theme.
- Decrypted Vault Explorer Breadcrumbs & Empty Size Pill Suppression (`styles.css`, `index.html`): Added breadcrumbs navigation bar and eliminated awkward empty pill artifacts on 0-byte items.
- Dedicated Changelog Portal (`change-log/index.html`): Launched an interactive in-app and web release notes page featuring chronological milestones, category badges, real-time live search, version filter chips, and full dark/light theme synchronization.
- Light Theme Nav-Pill & Password Input Contrast Fixes (`styles.css`): Fixed washed-out `.nav-pill` buttons and illegible dark password input boxes (`.field-input`, `#encrypt-password`, `#decrypt-password`) in light/white theme by enforcing crisp `#ffffff` input backgrounds, `#0f172a` text, `#94a3b8` placeholders, vibrant high-contrast CTA gradients (`.nav-pill--cta`), and refined drop-zone and button borders.
- Automated AI Agent Documentation Rules (`AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.agents/rules/auto_update_docs.md`): Established mandatory protocol requiring any AI assistant modifying the codebase to automatically synchronize `CHANGELOG.md`, `change-log/index.html`, and `README.md`.
- PWA Service Worker Cache Sync: Bumped cache to `v27` (`WEB-VERSION-27`).

---

## Version 5.1 — September 27, 2026
- PWA Version Indicator Sync (`index.html`): Corrected hero tech-line badge from `WEB-VERSION-21` to `WEB-VERSION-23` to match the Service Worker cache version bumped in v5, ensuring users always see the accurate app version on the landing page

---

## Version 5 — September 26, 2026
- 5 GB Low-RAM Streaming Compression, Encryption & Decryption Engine (`ZV3\0`): Added chunked 4 MB STREAM AEAD (`AES-256-GCM`) pipeline capable of compressing, encrypting, and decrypting vaults up to 5 GB with < 150 MB peak heap RAM on mobile (Android Chrome, iOS Safari) and desktop browsers
- Zero-Buffer Streaming ZIP64 Packager (`js/stream-packer.js`): Streams files via `file.stream()` and native `CompressionStream('deflate-raw')` with 24-byte ZIP64 Data Descriptors (`Bit 3`), adaptive `STORE`/`DEFLATE` selection, and an encrypted tail manifest catalog
- Instant Vault Explorer & Selective Chunk Extraction (`js/stream-unpacker.js`): Unlocks and lists 1,000+ files from a 5 GB vault in < 100 ms using < 15 MB RAM by slicing only the 57-byte container header and encrypted tail manifest; extracts individual files or media streams by decrypting only the required 4 MB chunk span
- Off-Thread Web Worker & Credit Backpressure (`js/crypto-worker.js`, `js/worker-bridge.js`): Offloads 600,000-iteration PBKDF2-SHA512 key derivation, deflate compression, and AES-GCM chunk encryption/decryption to a dedicated Web Worker with zero-copy `Transferable` buffers, 2-credit (~8 MB) flow control, and 60 FPS live telemetry
- Multi-Tier Mobile & Desktop Streaming Downloads (`js/stream-saver.js`, `sw.js`): Implements Tier 1 FileSystem Access API (`showSaveFilePicker`), Tier 2 Service Worker `/_stream_download` stream interception, and Tier 3 OPFS disk staging so 5 GB outputs save without hitting browser `Blob` memory limits
- Automated Verification Suite (`test/`): Added 710 automated unit, integration, and 4-tier E2E tests verifying cryptographic integrity, tamper rejection, memory bounds, and v1/v2/v3 backward compatibility
- PWA Service Worker Cache Sync: Bumped PWA cache version to `v23` (`WEB-VERSION-23`)

## Version 4 — September 15, 2026
- Fixed Files & Folder Upload & Drag-and-Drop: Removed restrictive single-folder drop constraints, allowing users to drop loose files, multiple files, or full directory structures directly into the vault creator
- Fixed Local Folder Upload: Resolved issue where touchscreen laptops (coarse pointer) and resized desktop viewports routed "Browse Folder" to a file-only selector; folder browse now reliably opens the native directory picker
- Native File System Access API: Added `window.showDirectoryPicker()` support for native OS directory selection with recursive hierarchy preservation on modern desktop browsers (Chrome, Edge, Opera), with seamless fallback to HTML5 `webkitdirectory`
- Enhanced Drag-and-Drop Traversal: Added support for `getAsFileSystemHandle()` alongside `webkitGetAsEntry()` for seamless folder and nested subfolder drops
- Simplified & Streamlined Decrypted Vault Explorer: Redesigned modal with clean, intuitive layout so anybody can understand it instantly; eliminated unstyled white category buttons and awkward control wrapping
- Smart Visibility Adaptation: Hides redundant search bars, sort dropdowns, view toggles, and checkboxes when viewing single-file vaults; automatically hides 0-count category tabs
- Prominent Primary Download Button: Relocated `⬇️ Download All (ZIP)` directly into the header next to close button for instant 1-click access
- Enhanced Media & File Actions: Polished `▶️ Play` (purple gradient) and `⬇️ Save` (teal pill) buttons with row click-to-play support
- PWA Service Worker Cache Sync: Bumped PWA cache version to `v21` and app indicator to `WEB-VERSION-21`

## Version 3 — July 5, 2026
- Renamed vault file extension from `.enc` to `.zev`
- Updated all UI text, file-picker filters, and PowerShell scripts to match
- Fixed remaining `.enc` references in docs (`README.md`, `how-to-use.html`)
- Optimized mobile layout by scaling down icons slightly on phone screens (<= 520px) for improved comfort and vertical space efficiency
- Streamlined main page copy: removed redundant warning alerts and simplified descriptions to declutter the workspace
- Enhanced design aesthetics: added high-end glows, dynamic gradient borders on card hover, and micro-scale animations to interactive buttons
- Scaled down buttons on phone screens (<= 520px) to provide a more compact and thumb-friendly vertical viewport flow
- Removed the "How It Works" text block from the main page to keep the dashboard extremely clean and minimal, referencing the comprehensive user guide instead
- Added premium ZevSafe logo branding: replaced generic text emojis with the newly generated 3D metallic lock-shield icon in the navbar, footer, and password save modal
- Simplified design aesthetics: removed all cheap decorative emojis from card titles, input headers, buttons, and alert boxes
- Cleaned up form inputs: adjusted prefix padding on password inputs now that decorative icons have been removed, creating a neat left-aligned typographic grid
- Accessibility (a11y) pass: added `aria-live`, `aria-atomic`, `aria-checked`, and `aria-label` attributes to password strength meter, password visibility toggles, v2 switch, and PWA banner
- Large folder memory guard: added intelligent client-side size check (>1.5 GB) recommending PowerShell zero-RAM streaming helper scripts
- iOS Safari PWA guide: added dedicated iPhone/iPad manual "Add to Home Screen" instructions in `how-to-use.html`
- Bumped PWA Service Worker app version to v6 for cache synchronization
- 10x Performance Speedup: optimized JSZip compression level from heavy level 6 to fast level 1 (5x-10x faster)
- Smart Pre-Compressed Media Detector: automatically uses instant `STORE` mode for folders containing photos, videos, or archives (>60% media), dropping 600 MB folder processing time from 5 minutes down to 3-5 seconds on mobile devices
- In-Browser Decrypted Vault File Explorer: temporary in-memory file browser launched upon decryption allowing instant single-file downloads, subfolder inspection, and real-time search filtering
- Password Flexibility & PIN Support: removed password strength complexity meter and reduced minimum length to 4+ digits/chars, supporting quick PINs and seamless password manager integration
- UI/UX Streamlining: removed image assets from the hero section for a clean, centered, lightweight layout and refined mobile responsive ergonomics
- Decryption Flow Refinement: eliminated forced auto-download upon decryption, giving users full control to choose specific files or download the full ZIP from the Decrypted Vault Explorer
- UI/UX & Animation Upgrade: added glowing shimmering progress bar transitions, animated pulsating/bursting stage pipeline pills, and interactive button loading sweeps during encryption and decryption
- 5 GB+ Large File & Memory Optimization: eliminated duplicate buffer allocations via direct `uint8array` compression, zero-copy Blob-by-reference header assembly, and aggressive intermediate heap deallocation, cutting peak browser RAM usage by >65% to support large 5 GB+ video and media vaults
- Dedicated In-Browser Media Player & Auto-Detector: intelligently identifies decrypted video (.mp4, .mov, .webm, .mkv) and audio (.mp3, .wav, .ogg, .flac, .aac) files, providing an instant "▶️ Play" button for direct cinema playback and new-tab streaming without requiring file downloads
- Android 2.5 GB Media Streaming & Hardware Acceleration: optimized in-browser media players with `playsinline` and persistent Blob streams for seamless 2 GB+ video playback directly inside Android Chrome or in a new browser tab
- 1-Click PC Desktop Setup (25+ GB): added instant in-browser generation and download of `ZevSafe-PC-Setup-25GB.zip` containing drag-and-drop batch launchers (`Encrypt-Vault.bat`, `Decrypt-Vault.bat`) and streaming scripts for zero-RAM 25 GB – 100 GB+ vaults with no manual configuration
- Granular Per-File Smart Compression: upgraded packaging engine to evaluate each file entry individually (STORE mode for pre-compressed media/archives + Fast Level 1 DEFLATE for compressible documents/code), achieving up to 10x faster vault packaging with real-time throughput telemetry (MB/s)
- Native PowerShell Streaming Compression Upgrade: added pre-compressed extension hashing and selective NoCompression/Fastest streaming in `encrypt.ps1`
- Multi-Display Screen Size Optimization: separate high-performance CSS layouts tailored for Compact Phones (<=380px), Standard Mobile (<=520px), Tablets (521-900px), Laptops (901-1440px), and Ultrawide Displays (>1440px) with safe-area insets and `content-visibility: auto` 120Hz smooth scrolling
- Advanced Decrypted Files View: introduced interactive List / Grid view toggle, category filter tabs (Videos, Audio, Photos, Docs, Code, Archives), multi-criteria sorting (Name, Size, Type), and multi-file selection with 1-click batch downloads
- Feature-Packed Cinema Video & Audio Player: added playback speed selector (0.5x - 2.0x), instant +/-10s scrubbing, playlist auto-navigation across all vault media (Prev/Next tracks), Picture-in-Picture (PiP), Fullscreen, Aspect Ratio (Fit/Fill), duration counter, and full keyboard navigation (Space, Arrows, F, P, M)
- Bumped PWA Service Worker app version to v15 for cache synchronization


















## Version 2 — (v2 encryption upgrade)
- Added v2 vault format: PBKDF2-SHA512, 600,000 iterations, 32-byte salt
- Added optional keyfile support (second factor alongside password)
- Kept v1 decryption working for backward compatibility (auto-detected via magic bytes)

## Version 1 — (stable v1)
- First working version: PBKDF2-SHA256 (100k iterations), AES-256-GCM encryption
- Folder-to-zip-to-encrypted-vault flow, fully client-side
- Offline PWA support via service worker
