# archive/android-native-planning/

This folder contains planning documents from an early phase of ZevSafe when the project was
being designed as a **native Android/Kotlin app** (Shizuku, Tink, SQLCipher, Jetpack Compose).

The project pivoted to a **pure browser-based web app** instead.

> ⚠️ **None of the code in this folder is used by the live app.**
> The real implementation lives in `app.js`, `index.html`, `sw.js`, and `styles.css`.

## Contents

| File | What it described |
|---|---|
| `PROJECT_PLAN.md` | Android Gradle project structure, Kotlin dependencies (Tink, Shizuku, SQLCipher, ExoPlayer) |
| `SHIZUKU_AND_STORAGE_ROUTING.md` | Kotlin code for elevated SD-card access via Shizuku ADB binder |
| `CRYPTOGRAPHIC_SPECIFICATIONS.md` | Kotlin/JVM PBKDF2 + AES-GCM streaming cryptor (NOT the web app implementation) |

Kept here for historical reference only.
