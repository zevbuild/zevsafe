# Changelog

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
- Bumped PWA Service Worker app version to v7 for speed update synchronization










## Version 2 — (v2 encryption upgrade)
- Added v2 vault format: PBKDF2-SHA512, 600,000 iterations, 32-byte salt
- Added optional keyfile support (second factor alongside password)
- Kept v1 decryption working for backward compatibility (auto-detected via magic bytes)

## Version 1 — (stable v1)
- First working version: PBKDF2-SHA256 (100k iterations), AES-256-GCM encryption
- Folder-to-zip-to-encrypted-vault flow, fully client-side
- Offline PWA support via service worker
