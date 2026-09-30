---
trigger: always_on
---

# 🤖 Mandatory AI Rule: Automatic Project Memory, Changelog & README Updates

Whenever ANY AI agent modifies, adds, refactors, or deletes code/files in ZevSafe:

1. **Always Update `PROJECT_MEMORY.md`:** Keep `PROJECT_MEMORY.md` (and `../app-zevsafe/PROJECT_MEMORY.md` + `../app-zevsafe/PROJECT-MEMORY/*.md` when Android features are modified) 100% synchronized so any AI agent can immediately understand the project.
2. **Update `CHANGELOG.md`:** Document the change under the active/new version with categorized tags (`New`, `UI`, `Security`, `Perf`, `Fix`, `PWA`).
3. **Update `change-log/index.html`:** Mirror the changes to the user-facing web changelog.
4. **Update `README.md`:** Synchronize version badges, release descriptions, and feature tables.
5. **Synchronize PWA:** Bump `sw.js` and `index.html` version numbers when app shell code changes.
6. **Run Tests:** Ensure `node test/test-android-encryption.js` and `node test/test-integration-m5.js` pass with 100%.
