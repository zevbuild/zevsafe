# 🧠 ZevSafe Ecosystem — Project Memory (`zevsafe` & `app-zevsafe`)

> **System Memory, Architecture & Cross-Platform Reference for AI Agents**  
> **Web Portal Version:** `v6.6` (`WEB-VERSION-34`, Service Worker `v34`)  
> **Companion Android App:** [`zevbuild/app-zevsafe`](https://github.com/zevbuild/app-zevsafe) (`com.zevbuild.zevsafe` `v6.3.0`, Build `30`)

> **🤖 MANDATORY AI AGENT RULE:**  
> Whenever **ANY** AI agent (Antigravity, Gemini, Cursor, Windsurf, Claude, Copilot) modifies, adds, refactors, or fixes any code or documentation in `zevsafe` or `app-zevsafe`, you **MUST AUTOMATICALLY UPDATE `PROJECT_MEMORY.md`**, `CHANGELOG.md`, `change-log/index.html`, AND `README.md` before completing your task so that any future AI agent can immediately understand the exact current state of the ecosystem.

---

## 1. Ecosystem Overview

ZevSafe is a 100% client-side, zero-knowledge, military-grade file and folder encryption suite that operates with **zero servers, zero cloud uploads, and zero telemetry**.

It consists of three bit-identically compatible platforms sharing the **`ZV3\0` STREAM AEAD** binary format:
1. **Web PWA (`zevsafe`):** Browser-based vault application ([`zevsafe.pages.dev`](https://zevsafe.pages.dev)) using the Web Crypto API (`crypto.subtle`), Web Workers (`js/crypto-worker.js`), and a 4-tier streaming file saver (`js/stream-saver.js`).
2. **Native Android App (`app-zevsafe`):** Standalone Kotlin + Jetpack Compose Android application (`com.zevbuild.zevsafe`) with AndroidX Media3 ExoPlayer Cinema streaming, Android 14 `VaultForegroundService`, `MediaStore.Downloads` auto-saving, and system share sheet integration. Detailed Android Project Memory lives in `../app-zevsafe/PROJECT_MEMORY.md` and `../app-zevsafe/PROJECT-MEMORY/`.
3. **Emergency Desktop CLI Tools (`tools/`):** Standalone Windows batch launchers (`tools/Encrypt-Vault.bat`, `tools/Decrypt-Vault.bat`) and PowerShell streaming engines (`tools/encrypt.ps1`, `tools/decrypt.ps1`) for zero-RAM 25 GB – 100 GB+ datasets.

---

## 2. Shared Binary Container Format (`ZV3\0`)

Any `.zev` file created on Web, Android, or Desktop can be unlocked on any other platform:

| Offset | Size | Field | Description |
|---|---|---|---|
| `0..3` | 4 B | `MAGIC` | ASCII `ZV3\0` (`0x5A 0x56 0x33 0x00`) |
| `4` | 1 B | `FLAGS` | Bit 0 (`0x01`): Keyfile 2FA active; Bit 1 (`0x02`): Streaming mode |
| `5..8` | 4 B | `CHUNK_SIZE` | Uint32LE (`4,194,304` bytes = 4 MB default) |
| `9..40` | 32 B | `SALT` | CSPRNG salt for PBKDF2-HMAC-SHA512 (600,000 iterations) |
| `41..48` | 8 B | `IV_PREFIX` | 8-byte random nonce prefix (combined with 4-byte chunk counter = 12-byte AES-GCM IV) |
| `49..56` | 8 B | `MANIFEST_OFFSET` | Uint64LE byte offset of the encrypted tail manifest |

* **Key Derivation:** `PBKDF2-HMAC-SHA512` with `600,000` iterations producing a 256-bit (32-byte) key.
* **Optional Keyfile 2FA:** `MasterKey = DerivedKey ⊕ SHA-256(KeyfileBytes)`.
* **Chunk AEAD:** `AES-256-GCM` (128-bit tag) with 42-byte Additional Authenticated Data (AAD) binding header fields, chunk index, chunk length, and final-chunk flag (`0x01` for final data chunk, `0x02` for tail manifest).

---

## 3. Web PWA Architecture (`zevsafe`)

| File / Directory | Responsibility |
|---|---|
| `index.html` | Primary vault UI, Encrypt/Decrypt cards, Vault Explorer modal, Cinema Media Player, approved modern navbar, cryptographic trust strip, and Android APK navigation links (`WEB-VERSION-34`). |
| `app.js` | Main-thread controller, drag-and-drop directory traversal, password entropy meter, Vault Explorer UI, Cinema streaming media player, universal 120 FPS auto-hiding navbar, and non-blocking glassmorphic toast notification system (`showToast`). |
| `styles.css` | Glassmorphic dark/light theme system, modern navbar & hero trust strip, responsive micro-hero, hardware-accelerated header transitions, toast notifications, and baseline card alignment. |
| `sw.js` | Offline-first PWA Service Worker (`APP_VERSION = 'v34'`) + Tier 2 `/_stream_download` streaming download interceptor + legacy root asset alias routing. |
| `assets/` | Structured brand assets: high-res 3D metallic logos (`zevsafe-logo.png`, `.webp`), PWA icons (`icon-192`, `icon-512`), Open Graph social cards (`zevsafe-og`), and vector favicon (`favicon.svg`). |
| `js/` | Modular client-side streaming engine: Web Worker cryptography (`crypto-worker.js`), worker bridge (`worker-bridge.js`), ZIP64 streaming packager (`stream-packer.js`), tail manifest unpacker (`stream-unpacker.js`), and 4-tier download engine (`stream-saver.js`). |
| `docs/` | Internal engineering specifications: architecture (`ARCHITECTURE.md`), web app design (`WEB_APP_DESIGN.md`), test infrastructure (`TEST_INFRA.md`), readiness report (`TEST_READY.md`), and tasks (`task.md`). |
| `tools/` | Standalone zero-RAM Windows streaming toolset: 1-click batch encryptor (`Encrypt-Vault.bat`), decryptor (`Decrypt-Vault.bat`), and PowerShell scripts (`encrypt.ps1`, `decrypt.ps1`). |
| `test/` | Automated verification suites: mobile browser OPFS regression tests (`test-android-encryption.js`), Milestone 5 integration suite (`test-integration-m5.js`), and synthetic stream mocks. |
| `change-log/index.html` | Interactive web release notes portal with live search and version filter chips. |
| `how-to-use-zevsafe/index.html` | Comprehensive user & security guide with Android APK and offline usage instructions. |

---

## 4. Companion Android App Architecture (`../app-zevsafe`)

Located at `C:\Users\Raju\Another-world\GitHub\zevbuild-studio\app-zevsafe` (GitHub: [`zevbuild/app-zevsafe`](https://github.com/zevbuild/app-zevsafe)):
- **Package ID:** `com.zevbuild.zevsafe` (`v6.3.0`, `compileSdk = 35`, `minSdk = 26`).
- **Key Components:**
  - `CryptoEngine.kt`: Native JVM/Kotlin `ZV3\0` STREAM AEAD implementation + `V3DecryptedInputStream` pull stream + legacy v1/v2 compatibility.
  - `VaultViewModel.kt`: MVVM state holder with `Dispatchers.Main` thread-safe completion callbacks, automatic saving of `.zev` and `.zip` outputs to the device's `Downloads` folder (`MediaStore.Downloads`), and on-demand extraction (`extractSingleFileIfNeeded`, `exportDecryptedZip`).
  - `VaultForegroundService.kt`: Android 14 `dataSync` foreground service with partial wake lock and live notification progress bar.
  - `FileProvider`: Dynamic `${applicationId}.fileprovider` authority in `AndroidManifest.xml` matched with `"${context.packageName}.fileprovider"` across `EncryptScreen.kt`, `DecryptScreen.kt`, and `VaultBrowserScreen.kt`.
  - **Brand Assets:** Quantized PNG + WebP (`icon-192`, `icon-512`, `zevsafe-logo`, `cyber-vault`) and minified `favicon.svg` (93.4% reduction: 2.24 MB → 148.9 KB).
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
   ```
   Ensure 100% pass rate (`33/33` and `5/5`).
