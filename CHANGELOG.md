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





## Version 2 — (v2 encryption upgrade)
- Added v2 vault format: PBKDF2-SHA512, 600,000 iterations, 32-byte salt
- Added optional keyfile support (second factor alongside password)
- Kept v1 decryption working for backward compatibility (auto-detected via magic bytes)

## Version 1 — (stable v1)
- First working version: PBKDF2-SHA256 (100k iterations), AES-256-GCM encryption
- Folder-to-zip-to-encrypted-vault flow, fully client-side
- Offline PWA support via service worker
