# Tasks — ZevSafe

Current and upcoming work only. Historical completed items are preserved below under a clearly marked section.

---

## 🔲 Upcoming / To Do

> Add new tasks here as they come up. Format: `- [ ] Description`

- [ ] Final cross-browser test of progress tracker UI (Compress → Encrypt → Save pipeline)
- [ ] Accessibility pass: add `aria-live` to password strength meter, `role="alert"` to PWA install banner

---

## ✅ Current App — What's Actually Built

These are the verified, shipped features in the live web app:

- [x] `index.html` — main UI with Encrypt and Decrypt panels, drop zones, v2 toggle
- [x] `styles.css` — dark glassmorphism design system with light theme support
- [x] `app.js` — full encrypt/decrypt pipeline (v1 PBKDF2-SHA256 + v2 PBKDF2-SHA512 + keyfile XOR)
- [x] `how-to-use.html` — step-by-step guide, crypto table, FAQ, technical pipeline breakdown
- [x] `sw.js` — Production Service Worker (Cache-First + Stale-While-Revalidate strategies)
- [x] `manifest.json` + `icon-192.png` + `icon-512.png` — PWA installable on desktop and mobile
- [x] `encrypt.ps1` / `decrypt.ps1` — PowerShell streaming helpers for large files (no RAM limit)
- [x] `favicon.svg` — SVG favicon for browser tabs and mobile bookmarks
- [x] `WEB_APP_DESIGN.md` — current architecture & crypto spec reference doc (repo root)
- [x] `CHANGELOG.md` — running changelog of shipped changes
- [x] Password strength meter (real-time visual, shown on encrypt password field)
- [x] Mobile tab bar (Encrypt / Decrypt) shown only on small screens
- [x] Dynamic drop zone text ("Tap to select" on touch devices)
- [x] Auto-theme detection (dark/light) via `matchMedia` + CSS variables
- [x] v2 Enhanced Security mode toggle with optional keyfile second factor
- [x] 3-stage real-time progress tracker UI (Compress → Encrypt/Decrypt → Save pills + detail cards)
- [x] Password save modal: copy, print sheet, download sheet, browser password-manager save
- [x] Vault extension renamed from `.enc` → `.zev` across all files and documentation
- [x] `PROJECT-MEMORY/` Android planning docs archived to `archive/android-native-planning/`

---

## 🗃️ Historical Log — REMOVED Features (not in current app)

> These features were added and then explicitly reverted. Listed here so the history is clear,
> not as a to-do list.

- [x] ~~Explorer pane HTML markup in `index.html`~~ — **REMOVED**
- [x] ~~CardExplorer class, setups, and toolbar bindings in `app.js`~~ — **REMOVED**
- [x] ~~btnEncrypt / btnDecrypt explorer load/unload logic~~ — **REMOVED**
- [x] ~~Explorer event listeners (close and download buttons)~~ — **REMOVED**
- [x] ~~Explorer styles in `styles.css`~~ — **REMOVED**
- [x] ~~Workspace explorer references in `README.md`~~ — **REMOVED**
- [x] ~~"My Brain" rich text note editor with formatting toolbar~~ — **REMOVED**
- [x] ~~"My Brain" folder tree vault in desktop sidebar~~ — **REMOVED**
- [x] ~~Local note search and drag-and-drop hierarchy reordering~~ — **REMOVED**
- [x] ~~Desktop/laptop productivity workspace detection~~ — **REMOVED**
