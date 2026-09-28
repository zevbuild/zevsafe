# 🤖 AI Agent Guidelines & Mandatory Automation Rules for ZevSafe

> **CRITICAL RULE FOR ALL AI AGENTS (Antigravity, Cursor, Windsurf, Claude, Copilot, etc.)**:
> Whenever you modify, add, refactor, or delete ANY file or code in this repository (features, bug fixes, UI/UX improvements, crypto changes, streaming updates, styling, or scripts), you **MUST AUTOMATICALLY UPDATE BOTH THE CHANGELOG AND THE README BEFORE COMPLETING YOUR TASK.**
> Never finish a task or prompt without completing this documentation sync.

---

## 📋 Mandatory Rules When Changing Anything

### 1. Update `CHANGELOG.md`
- Add an entry under the current active version section (or create a new version section if bumping the release).
- Include the date (e.g. `September 28, 2026`).
- Group changes into clear bullet points with tags:
  - `New`: New features or capabilities
  - `UI`: UI/UX, styling, or ergonomic improvements
  - `Security`: Cryptographic, key derivation, or sanitization enhancements
  - `Perf`: Speedups, memory reduction, streaming optimizations
  - `Fix`: Bug fixes and edge-case resolutions
  - `PWA`: Service worker, cache, or offline behavior changes
- Specify the exact modified files in backticks for each item.

### 2. Update the Web Changelog: `change-log/index.html`
- Mirror the update into `change-log/index.html` so the live web app reflects the change for end users.
- Add/update the `<article class="cl-card" data-version="...">` with corresponding bullet badges (`cl-bullet--new`, `cl-bullet--ui`, `cl-bullet--sec`, `cl-bullet--perf`, `cl-bullet--fix`).
- If a new version is released, update the "Latest Version" badge in the stats grid and top hero.

### 3. Update `README.md`
- **Version Badges:** If the version has changed, update:
  - `[![Release: vX / WEB-VERSION-YY](...)]`
  - The "Current stable release" banner at the top of the README.
- **Features Table:** If a feature was introduced, improved, or modified, update the Key Features table.
- **PWA Version:** Ensure any reference to the Service Worker cache version matches the current version.
- **Links & References:** Verify links to documentation, changelog, and tools remain accurate.

### 4. Synchronize PWA Service Worker & Version Tags
- If code affecting the app shell is changed (`app.js`, `styles.css`, `index.html`, etc.):
  - Bump `const APP_VERSION = 'vXX';` in `sw.js`.
  - Update `WEB-VERSION-XX` in `index.html` (hero badge and meta tags).
  - Ensure any new HTML pages or assets are included in `SHELL_ASSETS` in `sw.js`.

### 5. Verify Regression Tests
- Always run the automated regression tests before committing:
  ```bash
  node test/test-android-encryption.js
  node test/test-integration-m5.js
  ```
- Ensure 100% of tests pass.

---

## 🔒 Security & Architectural Non-Negotiables
- **100% Client-Side:** NEVER introduce backend API dependencies, server-side tracking, telemetry, or external network calls.
- **Zero-Knowledge Principle:** Passwords and keys must never touch non-volatile disk unencrypted.
- **Memory Bounding:** Streaming pipeline must stay bounded (< 150 MB RAM) across multi-GB files.
