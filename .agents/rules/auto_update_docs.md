---
name: auto-update-docs
description: Mandatory rule requiring AI agents to automatically update CHANGELOG.md, change-log/index.html, and README.md whenever making any changes.
trigger: always_on
---

# 🤖 Mandatory AI Rule: Automatic Changelog & README Updates

Whenever ANY AI agent modifies, adds, refactors, or deletes code/files in ZevSafe:

1. **Update `CHANGELOG.md`:** Document the change under the active/new version with categorized tags (`New`, `UI`, `Security`, `Perf`, `Fix`, `PWA`).
2. **Update `change-log/index.html`:** Mirror the changes to the user-facing web changelog.
3. **Update `README.md`:** Synchronize version badges, release descriptions, and feature tables.
4. **Synchronize PWA:** Bump `sw.js` and `index.html` version numbers when app shell code changes.
5. **Run Tests:** Ensure `node test/test-android-encryption.js` and `node test/test-integration-m5.js` pass with 100%.
