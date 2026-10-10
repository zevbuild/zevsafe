# 🧠 ZevSafe Ecosystem — Project Memory (`zevsafe` & `app-zevsafe`)

> **System Memory, Architecture & Cross-Platform Reference for AI Agents**  
> **Web Portal Version:** `v6.7` (`WEB-VERSION-35`, Service Worker `v35`)  
> **Companion Android App:** [`zevbuild/app-zevsafe`](https://github.com/zevbuild/app-zevsafe) (`com.zevbuild.zevsafe` `v6.4.2`, Build `33`)

> **🤖 MANDATORY AI AGENT RULE:**  
> Whenever **ANY** AI agent (Antigravity, Gemini, Cursor, Windsurf, Claude, Copilot) modifies, adds, refactors, or fixes any code or documentation in `zevsafe` or `app-zevsafe`, you **MUST AUTOMATICALLY UPDATE `PROJECT_MEMORY.md`**, `CHANGELOG.md`, `change-log/index.html`, AND `README.md` before completing your task so that any future AI agent can immediately understand the exact current state of the ecosystem.

---

## 1. Ecosystem Overview

ZevSafe is a 100% client-side, zero-knowledge, military-grade file and folder encryption suite that operates with **zero servers, zero cloud uploads, and zero telemetry**.

It consists of three bit-identically compatible platforms sharing the **`ZV3\0` STREAM AEAD** binary format:
1. **Web PWA (`zevsafe`):** Browser-based vault application ([`zevsafe.pages.dev`](https://zevsafe.pages.dev)) using the Web Crypto API (`crypto.subtle`), elastic multi-worker pool (`js/worker-bridge.js`, `js/crypto-worker.js`), zero-copy transferable buffers, ephemeral session key caching, and a 4-tier streaming file saver (`js/stream-saver.js`).
2. **Native Android App (`app-zevsafe`):** Standalone Kotlin + Jetpack Compose Android application (`com.zevbuild.zevsafe`) with AndroidX Media3 ExoPlayer Cinema streaming, Android 14 `VaultForegroundService`, `MediaStore.Downloads` auto-saving, and system share sheet integration. Detailed Android Project Memory lives in `../app-zevsafe/PROJECT_MEMORY.md` and `../app-zevsafe/PROJECT-MEMORY/`.
3. **Emergency Desktop CLI Tools (`tools/`):** Standalone Windows batch launchers (`tools/Encrypt-Vault.bat`, `tools/Decrypt-Vault.bat`) and PowerShell streaming engines (`tools/encrypt.ps1`, `tools/decrypt.ps1`) for zero-RAM 25 GB – 100 GB+ datasets.

---

## 2. Shared Binary Container Format (`ZV3\0`)

Any `.zev` file created on Web, Android, or Desktop can be unlocked on any other platform:

| Offset (B) | Size | Encoding | Field | Description |
|---|---|---|---|---|
| `0..3` | 4 B | ASCII | `MAGIC` | `ZV3\0` (`0x5A 0x56 0x33 0x00`) |
| `4` | 1 B | Uint8 | `VERSION` | `0x03` (Container format version 3) |
| `5` | 1 B | Uint8 | `FLAGS` | Bit 0 (`0x01`): Keyfile 2FA active; Bit 1 (`0x02`): Reserved |
| `6..9` | 4 B | Uint32 BE | `CHUNK_SIZE` | `4,194,304` bytes (4 MB default) |
| `10..41` | 32 B | Raw Bytes | `SALT` | 32-byte CSPRNG salt for PBKDF2-HMAC-SHA512 (600,000 iterations) |
| `42..48` | 7 B | Raw Bytes | `BASE_IV_PREFIX` | 7-byte CSPRNG base IV prefix |
| `49..56` | 8 B | Uint64 BE | `MANIFEST_OFFSET` | Big-endian byte offset of the encrypted tail manifest |

* **Total Header Size:** Exactly 57 bytes (`V3_HEADER_SIZE = 57`).
* **Key Derivation:** `PBKDF2-HMAC-SHA512` with `600,000` iterations producing a 256-bit (32-byte) AES key.
* **Optional Keyfile 2FA:** `MasterKey = DerivedKey ⊕ SHA-256(KeyfileBytes)`.
* **Chunk IV Layout (12 B):** `BaseIVPrefix(7B) ‖ Uint32BE(chunkIndex)(4B) ‖ isLast(1B)`.
* **Chunk AAD Layout (42 B):** `Magic(4B) ‖ Version(1B) ‖ Salt(32B) ‖ Uint32BE(chunkIndex)(4B) ‖ isLast(1B)`.
* **Chunk Framing:** `[PlaintextLength(4B BE) ‖ Ciphertext(N) ‖ GCM_Tag(16B)]`.
* **Tail Manifest Envelope (48 B header):** `[Salt(32B) ‖ IV(12B) ‖ PlainLen(4B BE) ‖ Ciphertext(M) ‖ Tag(16B)]`.

---

## 3. Web PWA Architecture (`zevsafe`)

### 3.1 Multi-Worker Parallel AEAD Pipeline (v6.7)
- **Elastic `WorkerPool`:** Scales up to `navigator.hardwareConcurrency` clamped between 4 and 8 workers (falls back safely to 1 on single-core devices, in-process shims, or manifest-only operations).
- **Session Multiplexing:** Multi-session broadcast (`INIT_KEY` or `INIT_SESSION`) initializes all pool workers with session parameters, allowing any idle worker to process any chunk concurrently.
- **Strictly Ordered Reassembly (`OrderedReassemblyQueue`):** Resolves non-deterministic chunk completion orders into strictly sequential stream writes ($0, 1, 2, \dots$) before writing to disk or output sinks.
- **Credit Flow Control:** Adaptive credit window $W = \max(2, \min(12, N \times 2))$ with deferred release: credits are released only after chunks are written to the sink, bounding peak process heap strictly below 105 MB.
- **Zero-Copy Transferable Buffers:** Eliminates redundant `.slice()` duplications across worker boundaries using `toTransferableArrayBuffer(data)`, saving over 20 GB of memory allocations on 5 GB vaults.
- **Ephemeral Session Key Caching:** `readVaultManifest` returns non-extractable `CryptoKey` in catalog result; Vault Explorer reuses this cached key for single-file extractions and media playback, reducing file access latency from ~2,500 ms to < 15 ms (> 150× faster).
- **Zero-Knowledge Session Teardown (`lockV3VaultSession`):** Explicitly wipes keyfile bytes via `.fill(0)`, nullifies all key/catalog references, revokes blob URLs, and scrubs password fields on modal close, file clear, or window unload.

### 3.2 Component Directory

| File / Directory | Responsibility |
|---|---|
| `index.html` | Primary vault UI, Encrypt/Decrypt cards, 60 FPS Telemetry HUD with live throughput & workers badge, Vault Explorer modal, Cinema Media Player, approved modern navbar, cryptographic trust strip (`WEB-VERSION-35`). |
| `app.js` | Main-thread controller, drag-and-drop traversal, entropy meter, Vault Explorer UI with instant session key extraction, Cinema streaming media player with static DOM controls & volume slider, Telemetry HUD controller, and session zeroization protocol. |
| `styles.css` | Glassmorphic theme system, adaptive Telemetry HUD grid, modern navbar & hero trust strip, Cinema deck controls, responsive micro-hero, and toast notifications. |
| `sw.js` | Offline-first PWA Service Worker (`APP_VERSION = 'v35'`) + Tier 2 `/_stream_download` streaming download interceptor + cache lifecycle. |
| `assets/` | Structured brand assets: high-res 3D metallic logos, PWA icons, Open Graph social cards, and vector favicon. |
| `js/worker-bridge.js` | Elastic `WorkerPool`, `OrderedReassemblyQueue`, `CreditFlowController`, zero-copy buffer transfers, and streaming pipeline orchestration. |
| `js/crypto-worker.js` | Multi-session background worker supporting `INIT_SESSION`, `CLEANUP_SESSION`, zero-copy STREAM AEAD encryption/decryption, and manifest building/decryption. |
| `js/stream-unpacker.js` | Fast-path manifest parser returning `masterKey: CryptoKey`, selective file extraction bypassing PBKDF2, and stream decryptor. |
| `js/stream-packer.js` | Streaming ZIP64 packager and encrypted manifest builder. |
| `js/stream-crypto.js` | Core mathematical STREAM AEAD primitive implementation (IV, AAD, AES-GCM, PBKDF2). |
| `js/stream-saver.js` | 4-tier streaming file saver (Tier 1 FSA, Tier 2 SW, Tier 3 OPFS, Tier 4 Fallback). |
| `tools/` | Standalone zero-RAM Windows streaming toolset: 1-click batch encryptor (`Encrypt-Vault.bat`), decryptor (`Decrypt-Vault.bat`), and PowerShell engines. |
| `test/` | Automated test suites (33 Android tests, 5 M5 tests, 74 worker bridge tests, 95 stream crypto tests, 142 packager tests, 99 unpacker tests, 250 E2E tests). |
| `change-log/index.html` | Interactive web release notes portal with live search and version filter chips. |
| `how-to-use-zevsafe/index.html` | Comprehensive user & security guide with Android APK and offline usage instructions. |

---

## 4. Companion Android App Architecture (`../app-zevsafe`)

Located at `C:\Users\Raju\Another-world\GitHub\zevbuild-studio\app-zevsafe` (GitHub: [`zevbuild/app-zevsafe`](https://github.com/zevbuild/app-zevsafe)):
- **Package ID:** `com.zevbuild.zevsafe` (`v6.4.2`, Build `33`, `compileSdk = 35`, `minSdk = 26`).
- **Key Components:**
  - `CryptoEngine.kt`: Native JVM/Kotlin `ZV3\0` STREAM AEAD implementation + `V3DecryptedInputStream` pull stream + legacy v1/v2 compatibility.
  - `VaultViewModel.kt`: MVVM state holder with `Dispatchers.Main` thread-safe completion callbacks, automatic saving of `.zev` and `.zip` outputs to the device's `Downloads` folder (`MediaStore.Downloads`), and on-demand extraction (`extractSingleFileIfNeeded`, `exportDecryptedZip`).
  - `VaultForegroundService.kt`: Android 14 `dataSync` foreground service with partial wake lock and live notification progress bar.
  - `FileProvider`: Dynamic `${applicationId}.fileprovider` authority in `AndroidManifest.xml` matched with `"${context.packageName}.fileprovider"` across `EncryptScreen.kt`, `DecryptScreen.kt`, and `VaultBrowserScreen.kt`.
  - **Brand Assets:** Quantized PNG + WebP and minified `favicon.svg`.
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
   node test/test-worker-bridge.js
   node test/test-stream-crypto.js
   node test/test-stream-packer.js
   node test/test-stream-unpacker.js
   node test/e2e-tests.js
   ```
   Ensure 100% pass rate across all suites.
