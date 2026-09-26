# Changelog

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
