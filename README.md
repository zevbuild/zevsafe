# 🔒 ZevSafe — Zero-Knowledge Offline File & Folder Encryption Portal

> **by [zevbuild](https://github.com/zevbuild) · Encrypt and decrypt files and entire folders directly in your browser — zero uploads, zero tracking, 100% private & offline.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Cloudflare%20Pages-8b5cf6?style=for-the-badge&logo=cloudflare)](https://zevsafe.pages.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge)](LICENSE)
[![Security: AES-256-GCM](https://img.shields.io/badge/Security-AES--256--GCM-ef4444?style=for-the-badge)](#-cryptography)
[![KDF: PBKDF2-SHA512](https://img.shields.io/badge/KDF-PBKDF2--SHA512%20(600k)-3b82f6?style=for-the-badge)](#-cryptography)
[![PWA: Installable](https://img.shields.io/badge/PWA-Installable-8b5cf6?style=for-the-badge)](#-pwa--install-as-an-app)
[![100% Offline](https://img.shields.io/badge/Mode-100%25%20Offline-f59e0b?style=for-the-badge)](#)
[![Release: v4 / WEB-VERSION-21](https://img.shields.io/badge/Release-v4%20(WEB--VERSION--21)-06b6d4?style=for-the-badge)](CHANGELOG.md)

---

> 🟢 **Current stable release — v4 (`.zev` format / WEB-VERSION-21):** military-grade security by default.  
> **PBKDF2-SHA512 · 600,000 iterations · 32-byte salt · AES-256-GCM · optional keyfile 2FA · Decrypted Vault Explorer · Cinema Media Player · 5 GB+ in-browser streaming.**

---

## ✨ What is ZevSafe?

**ZevSafe** is a zero-trust, client-side encryption portal designed to lock sensitive files and directory hierarchies into single portable encrypted vaults (`.zev`). It executes entirely within your browser sandbox leveraging the native W3C [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) — **no backend servers, no cloud telemetry, no accounts, and no data transmission over the network**.

Once loaded, ZevSafe works **100% offline and air-gapped**. It employs **v2 Standard (PBKDF2-SHA512 / 600,000 rounds)** by default, supports an optional **Keyfile second factor**, provides a built-in **Decrypted Vault Explorer** with an **in-browser Cinema Media Player**, and maintains transparent backward compatibility with legacy **v1 vaults**.

### Ideal For:
- **Zero-knowledge backup:** Encrypting personal archives before storing on USB flash drives, external SSDs, or public cloud storage.
- **Air-gapped security:** Encrypting and decrypting data on completely offline machines or in airplane mode.
- **Two-factor protection:** Pairing a passphrase with a physical keyfile (e.g., a photo, key file, or document) so neither factor alone can unlock the vault.
- **Instant media streaming:** Playing encrypted 2.5 GB+ videos and audio files directly inside the browser without downloading decrypted files to disk.
- **Selective file extraction:** Inspecting decrypted vault contents and extracting single files or batch-downloading selected files instead of saving the full archive.

---

## 🚀 Key Features

| Feature | Description |
|---|---|
| 🔐 **AES-256-GCM Authenticated Encryption** | Military-grade authenticated cipher guaranteeing confidentiality and detecting any bit-flipping or file tampering. |
| 🛡️ **v2 Standard (Default Mode)** | PBKDF2-SHA512 key stretching with **600,000 iterations** and a 32-byte CSPRNG random salt (exceeds OWASP guidelines). |
| 🗝️ **Keyfile Two-Factor Authentication (2FA)** | Mixes a SHA-256 hash of any file (image, key, binary) into derived key material as a physical second factor. |
| 🔑 **Automatic v1 Legacy Compatibility** | Reads the 4-byte `ZV2\0` magic header to automatically detect and decrypt older v1 vaults (100,000 PBKDF2-SHA256 iterations). |
| 📁 **Dual File & Full Directory Support** | Select individual files, multi-file selections, or complete directory trees using "Browse Folder" or "Browse Files". |
| ⚡ **Native File System Access API** | Uses `window.showDirectoryPicker()` with recursive folder hierarchy capture and seamless fallback to HTML5 `webkitdirectory`. |
| 📂 **Decrypted Vault Explorer** | In-memory interactive file manager featuring List and Grid views, instant search, multi-criteria sorting, and batch downloads. |
| ⬇️ **1-Click Full ZIP & Single-File Downloads** | Download individual files, selected batches, or click `⬇️ Download All (ZIP)` directly in the header. |
| 🎬 **In-Browser Cinema Media Player** | Direct playback for decrypted video (`.mp4`, `.mov`, `.webm`, `.mkv`) and audio (`.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`) with zero disk writes. |
| 🎛️ **Advanced Cinema Controls** | Variable playback speed (0.5×–2.0×), ±10s scrubbing, track navigation, Picture-in-Picture (PiP), fullscreen, and "New Tab" streaming. |
| 📦 **Smart Adaptive Compression** | Instant `STORE` mode for pre-compressed media/archives + Fast Level 1 DEFLATE for compressible documents/code (up to **10× faster**). |
| 🚀 **5 GB+ Memory Optimization** | Zero-copy buffer management and intermediate heap deallocation cut browser RAM usage by >65%, supporting 5 GB+ vaults on desktop and 2.5 GB on mobile. |
| 💻 **1-Click PC Setup (25+ GB)** | Includes Windows batch launchers (`Encrypt-Vault.bat`, `Decrypt-Vault.bat`) and streaming PowerShell scripts for zero-RAM 25 GB–100 GB+ datasets. |
| 📊 **3-Stage Real-Time Pipeline Tracker** | Visual progress pills (`Compress` → `Encrypt/Decrypt` → `Save`) with live throughput telemetry (MB/s, compression ratio, timers). |
| 📝 **Password Recovery & Manager Integration** | Real-time password modal with 1-click clipboard copy, browser password-manager save (`PasswordCredential`), print sheet, and text export. |
| 📲 **Installable Offline PWA** | Progressive Web App with Cache-First Service Worker (`v21`), auto-updating in background, fully functional offline. |

---

## 🔐 How It Works

### v2 — Standard Mode Architecture (Default)

```text
[Files / Directory Tree]
        │
        ▼
Packaging & Granular Smart Compression
   ├── Pre-compressed Media / Archives (.mp4, .jpg, .zip, etc.)  ──►  STORE Mode (Instant 0-CPU)
   └── Compressible Code & Docs (.txt, .json, .csv, .pdf, etc.) ──►  Fast DEFLATE (Level 1)
        │
        ▼
Generate Random Nonces: Salt (32 bytes) + IV (12 bytes) via window.crypto.getRandomValues()
        │
        ▼
PBKDF2-SHA512 (Password, Salt, 600,000 iterations)  ──►  256-bit Raw Key Bytes
        │
        ▼ (Optional Keyfile 2FA)
SHA-256(Keyfile) XOR RawKeyBytes  ──►  Hardened Key Material
        │
        ▼
Import as AES-256-GCM CryptoKey
        │
        ▼
AES-256-GCM Encrypt(ZipBytes, Key, IV)  ──►  Ciphertext + 128-bit Authentication Tag
        │
        ▼
Assemble Single Portable Vault (.zev):
┌──────────────┬──────────────┬───────────┬──────────────────┬────────────────┬──────────────────────────────┐
│ Magic 'ZV2\0'│ Version 0x02 │ Flags (1) │ Salt (32 Bytes)  │ IV (12 Bytes)  │ Ciphertext + GCM Auth Tag    │
│ 4 Bytes      │ 1 Byte       │ (0x01=Key)│                  │                │ (Variable Length)            │
└──────────────┴──────────────┴───────────┴──────────────────┴────────────────┴──────────────────────────────┘
0              4              5           6                  38               50
```

### v1 — Legacy Mode Architecture (Backward Compatible)

```text
[Directory Tree]
        │
        ▼
In-Memory ZIP Packaging
        │
        ▼
Generate: Salt (16 bytes) + IV (12 bytes) via CSPRNG
        │
        ▼
PBKDF2-SHA256 (Password, Salt, 100,000 iterations)  ──►  256-bit AES-GCM Key
        │
        ▼
AES-256-GCM Encrypt  ──►  Ciphertext + 128-bit Authentication Tag
        │
        ▼
Output File (.zev):
┌──────────────────────────────┬──────────────────────────────┬────────────────────────────────────────┐
│ Salt (16 Bytes)              │ IV (12 Bytes)                │ Ciphertext + 128-bit GCM Auth Tag      │
└──────────────────────────────┴──────────────────────────────┴────────────────────────────────────────┘
0                              16                             28
```

> **Automated Format Routing:** When unlocking a vault, ZevSafe inspects the first 4 bytes. If the header matches `ZV2\0`, it automatically executes the v2 pipeline and alerts the user if a keyfile is required (`Flags & 0x01`). If no magic header is present, it transparently decrypts the file using the v1 legacy pipeline.

---

## 🛡️ Cryptography Specifications

| Parameter | v2 Standard (Default) | v1 Legacy (Compatibility) |
|---|---|---|
| **Cipher** | **AES-256-GCM** (Galois/Counter Mode) | **AES-256-GCM** |
| **Key Size** | 256 bits | 256 bits |
| **IV / Nonce Size** | 96 bits (12 bytes, unique per encryption) | 96 bits (12 bytes, unique per encryption) |
| **Salt Size** | 256 bits (32 bytes cryptographically random) | 128 bits (16 bytes cryptographically random) |
| **KDF Algorithm** | **PBKDF2-SHA512** | **PBKDF2-SHA256** |
| **KDF Iterations** | **600,000 rounds** (OWASP 2024+ benchmark) | 100,000 rounds |
| **Second Factor (2FA)** | Optional physical Keyfile (`SHA-256` XOR-mixed) | Not supported in v1 |
| **Tamper Protection** | 128-bit GCM Authentication Tag | 128-bit GCM Authentication Tag |
| **Header Identifier** | 4-byte magic sequence: `0x5A 0x56 0x32 0x00` (`ZV2\0`) | Raw header `[ Salt(16) \| IV(12) ]` |
| **Random Entropy** | Native `window.crypto.getRandomValues()` | Native `window.crypto.getRandomValues()` |

> **Tamper Resistance:** AES-GCM is an Authenticated Encryption with Associated Data (AEAD) scheme. Any modification, bit-flip, or corruption of the encrypted file causes authentication to fail immediately during decryption, preventing silent data degradation or malicious injection.

---

## 📖 Step-by-Step Usage Guide

### 🔐 1. Encrypting Files or Folders

1. Open **[ZevSafe](https://zevsafe.pages.dev)** in any modern web browser.
2. Provide your data using either method:
   - Click **📁 Browse Folder** to select a full folder tree (powered by native OS directory picker).
   - Click **📄 Browse Files** to select loose files or multiple documents.
   - Or **drag and drop** files or a directory directly into the drop zone.
3. Enter a strong password or PIN (minimum 4 characters) and confirm it.
4. *(Optional)* Click **Select Keyfile** to bind a physical file (photo, document, random file) as an indispensable second factor.
5. Click **Encrypt & Download**:
   - The 3-stage tracker shows compression and encryption progress in real time.
   - Your encrypted vault (`yourfolder.zev`) automatically downloads.
6. The **Save Vault Password** dialog opens:
   - Click **📋 Copy** to copy your password.
   - Click **💾 Save Password** to save credentials directly to your browser's password manager.
   - Click **⬇️ Download Sheet** or **🖨️ Print Sheet** to generate an offline, printable recovery sheet (`<folder>_password_recovery_sheet.txt`).

### 🔓 2. Decrypting a Vault

1. Drag and drop your `.zev` vault file into the **Unlock a Vault** panel (or click "Select .zev File").
2. ZevSafe reads the header:
   - If the vault was encrypted with a keyfile, a prompt asks you to select your keyfile.
   - If it is a standard password-only vault, proceed directly.
3. Enter your password and click **Decrypt & Download**.
4. The **Decrypted Vault Explorer** modal opens immediately.

### 📂 3. Using the Decrypted Vault Explorer

The temporary in-memory explorer lets you interact with decrypted files without writing unencrypted archives to disk:
- **Play Media:** Click **▶️ Play** on any video or audio file to launch the cinema player.
- **Single File Download:** Click **⬇️ Save** on any row to download that specific file.
- **Search & Filter:** Filter by filename via the instant search bar, or switch category tabs (**Videos**, **Audio**, **Photos**, **Docs**, **Code**, **Archives**).
- **View Toggle & Sorting:** Switch between List and Grid layout, and sort by Name, Size, or File Type.
- **Batch Download:** Select multiple files using checkboxes and click **⬇️ Download Selected**.
- **Download Everything:** Click **⬇️ Download All (ZIP)** in the header to export the entire folder as a single ZIP archive.

### 🎬 4. Cinema Media Player & Shortcuts

When viewing decrypted media, use the full-featured cinema player:
- **Playback Speed:** Select speeds from `0.5×` to `2.0×`.
- **Seek:** Jump ±10 seconds with dedicated buttons or arrow keys.
- **Playlist:** Auto-detects all audio/video tracks in the vault; skip with **⏮️ Prev** / **⏭️ Next**.
- **Picture-in-Picture & Fullscreen:** Multi-task or watch in full display mode.
- **New Tab Stream:** Click **↗️ New Tab** to stream the decrypted media in an isolated browser window.

#### Keyboard Shortcuts:
| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / Pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Rewind 10s / Forward 10s |
| <kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> | Previous Track / Next Track |
| <kbd>F</kbd> | Toggle Fullscreen |
| <kbd>P</kbd> | Toggle Picture-in-Picture (PiP) |
| <kbd>M</kbd> | Mute / Unmute |
| <kbd>Esc</kbd> | Close Media Player |

---

## ⚡ File Size Capacity & Large Vaults

Because ZevSafe performs all compression, key derivation, and cryptographic transforms in client memory, processing limits depend on available browser RAM:

| Platform / Device | In-Browser Safe Capacity | Recommended Tool |
|---|---|---|
| **Desktop (Chrome, Edge, Firefox, Brave)** | **Up to ~5 GB+** | In-Browser Web App (Zero-Copy Architecture) |
| **Mobile (Android Chrome, iOS Safari)** | **Up to ~2.5 GB** | In-Browser Web App / PWA |
| **Large Datasets (25 GB – 100 GB+)** | **Unlimited (Zero-RAM Streaming)** | **1-Click PC Setup** (`Encrypt-Vault.bat` / PowerShell) |

### Need to Encrypt 25 GB to 100 GB+?
For massive datasets that exceed browser JavaScript heap allocations:
1. Click **💻 PC Setup (25+ GB)** in the navigation bar to download the pre-configured Windows toolkit.
2. Drag and drop any folder onto **`Encrypt-Vault.bat`** (or drag a `.zev` file onto **`Decrypt-Vault.bat`**).
3. The PowerShell streaming engine (`encrypt.ps1` / `decrypt.ps1`) processes data chunk-by-chunk with **zero RAM footprint**, matching the exact v2 standard format.

---

## 📲 PWA — Install as an Offline App

ZevSafe is a certified Progressive Web App. Install it once to use it as an offline desktop or mobile application:

### Desktop (Google Chrome / Microsoft Edge / Brave)
1. Navigate to [zevsafe.pages.dev](https://zevsafe.pages.dev).
2. Click the **Install** icon (➕ or computer display) in the URL address bar, or click **Install** on the bottom banner.
3. Launch ZevSafe directly from your Start Menu, Taskbar, or Applications launcher.

### Android (Chrome)
1. Open [zevsafe.pages.dev](https://zevsafe.pages.dev).
2. Tap the **"Install ZevSafe"** banner at the bottom of the screen (or tap menu `⋮` → **Add to Home screen**).
3. Open ZevSafe from your home screen like a native Android app.

### iOS / iPadOS (Safari)
1. Open [zevsafe.pages.dev](https://zevsafe.pages.dev) in Safari.
2. Tap the **Share** button (box with upward arrow `⎋`).
3. Scroll down and select **"Add to Home Screen"**.
4. Tap **Add** in the top-right corner.

> ✈️ **Airplane Mode Verified:** You can disconnect Wi-Fi and mobile data completely. The Service Worker serves all assets from cache, and Web Crypto runs locally.

---

## 🗂️ Project Structure

```text
zevsafe/
├── index.html                      # Main portal UI (Encrypt, Decrypt, Explorer, Media Player)
├── how-to-use-zevsafe/
│   └── index.html                  # In-depth technical documentation & user guide
├── app.js                          # Core engine: Web Crypto API, JSZip, UI state, Explorer
├── styles.css                      # Glassmorphic responsive styling, cinema player, dark theme
├── sw.js                           # PWA Service Worker (Cache-First & SWR strategies)
├── manifest.json                   # Web App Manifest for standalone desktop/mobile installation
├── jszip.min.js                    # Local offline JSZip library for folder archive packaging
├── Encrypt-Vault.bat               # Windows 1-click drag-and-drop batch encryptor (25GB+)
├── Decrypt-Vault.bat               # Windows 1-click drag-and-drop batch decryptor (25GB+)
├── encrypt.ps1                     # Streaming PowerShell script for zero-RAM 25GB+ encryption
├── decrypt.ps1                     # Streaming PowerShell script for zero-RAM 25GB+ decryption
├── favicon.svg                     # Vector brand favicon
├── icon-192.png                    # PWA launcher icon (192×192)
├── icon-512.png                    # PWA launcher icon (512×512)
├── zevsafe-logo.png                # High-res 3D metallic lock-shield brand asset
├── zevsafe-og.png                  # Open Graph social preview banner (1200×630)
├── robots.txt                      # Search engine crawl rules
├── sitemap.xml                     # Search engine XML index
├── CHANGELOG.md                    # Release history and milestone documentation
├── WEB_APP_DESIGN.md               # Technical architecture and cryptographic specification
├── task.md                         # Current task tracker and roadmap
└── archive/
    └── android-native-planning/    # Historical planning docs (native Kotlin concept prior to PWA)
```

---

## 💻 Run Locally

ZevSafe requires **no build step, no npm packages, and no node_modules**. It is built with vanilla HTML5, CSS3, and modern JavaScript.

### Quick Start
Clone the repository and open `index.html` directly in your browser:

```bash
git clone https://github.com/zevbuild/zevsafe.git
cd zevsafe

# Open directly:
start index.html       # Windows
open index.html        # macOS
xdg-open index.html    # Linux
```

### Running with a Local Web Server
To test PWA installation, Service Worker caching, and full offline synchronization, serve over `localhost`:

```bash
# Using Python 3:
python -m http.server 8080

# Or using Node:
npx serve .
```

Then visit `http://localhost:8080` in your web browser.

---

## ⚠️ Security Principles & Zero-Knowledge Guarantees

- **Passphrase Sovereignty:** ZevSafe enforces a zero-knowledge architecture. There is no password recovery mechanism, reset link, or administrative backdoor. **If you lose your password or keyfile, your encrypted vault is mathematically unrecoverable.**
- **Keyfile Protection:** When keyfile 2FA is enabled, the keyfile is combined with your password via SHA-256 XOR mixing. Always store your keyfile on a separate physical medium from your `.zev` vault.
- **Volatile Memory Only:** Decrypted files exist strictly in volatile browser RAM. Nothing is written to IndexedDB, LocalStorage, or disk unless you explicitly click a download or save button.
- **Cache Isolation:** The Service Worker (`sw.js`) explicitly excludes `.zev` files and temporary `blob:` URLs from cache storage, ensuring decrypted data can never be persisted in browser cache.
- **Air-Gapped Operation:** All encryption operations take place on the local CPU via the browser's native C++ Web Crypto implementation. No telemetry, analytics, or external API calls are made.

---

## 👤 Author & Acknowledgements

Created by **[zevbuild](https://github.com/zevbuild)** — dedicated to developing privacy-centric, zero-knowledge, and offline-first open source tools.

Documentation & Guide: [how-to-use-zevsafe/](https://zevsafe.pages.dev/how-to-use-zevsafe/)  
Live Portal: [https://zevsafe.pages.dev](https://zevsafe.pages.dev)

---

## 📜 License

This project is licensed under the [MIT License](LICENSE) — free to use, modify, audit, and distribute.

---

<p align="center">
  <sub><strong>ZevSafe</strong> — Secure your data. Trust no one. Not even us.</sub>
</p>