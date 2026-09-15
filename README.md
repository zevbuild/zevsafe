# 🔒 ZevSafe — Offline Folder Encryption Portal

> **by [zevbuild](https://github.com/zevbuild) · Encrypt and decrypt entire folders directly in your browser — no server, no uploads, 100% private.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Cloudflare%20Pages-8b5cf6?style=for-the-badge&logo=cloudflare)](https://zevsafe.pages.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge)](LICENSE)
[![Security: AES-256-GCM](https://img.shields.io/badge/Security-AES--256--GCM-ef4444?style=for-the-badge)](#cryptography)
[![PWA: Installable](https://img.shields.io/badge/PWA-Installable-8b5cf6?style=for-the-badge)](#pwa--install-as-an-app)
[![100% Offline](https://img.shields.io/badge/Mode-100%25%20Offline-f59e0b?style=for-the-badge)](#)

---

> 🟢 **Current stable release — v4 (`.zev` format):** military-grade security by default.
> PBKDF2-SHA512 · 600,000 iterations · 32-byte salt · AES-256-GCM · optional keyfile second factor.

---

## ✨ What is ZevSafe?

**ZevSafe** is a fully client-side, zero-trust encryption portal. It runs entirely in your browser using the native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) — no backend, no accounts, no internet connection required after first load.

It uses **v2 Standard (PBKDF2-SHA512 / 600k iterations)** by default, provides an optional **Keyfile second factor**, and maintains seamless backward compatibility with **v1 Legacy** vaults.

**Perfect for:**
- Encrypting sensitive folders before storing on USB drives or SD cards
- Sharing encrypted data with others via a shared password
- Air-gapped / fully offline security workflows
- Adding a keyfile second factor to vaults beyond just a password

---

## 🚀 Features

| Feature | Details |
|---|---|
| 🔐 **AES-256-GCM Encryption** | Authenticated military-grade encryption (v2 Standard & v1 Legacy) |
| 🚀 **v2 Mode (Default Standard)** | PBKDF2-SHA512 · 600,000 iterations · 32-byte salt · 6× stronger KDF |
| 🗝️ **Keyfile (2nd Factor)** | Any file acts as a physical key — optional second factor |
| 🔑 **v1 Legacy Support** | 100,000 iterations · 16-byte salt · seamless automatic detection |
| 📁 **Full Folder Support** | Encrypts entire folder trees via in-memory streaming ZIP |
| 💧 **Drag & Drop** | Drop a folder to encrypt, drop a `.zev` vault to decrypt |
| 🔄 **Auto-Version Detection** | Decryption auto-detects v1 vs v2 format from `ZV2\0` magic header |
| 🎬 **In-Browser Media Player** | Play encrypted 2.5 GB+ videos/audio directly in-browser or in a new tab |
| 📂 **Decrypted Vault Explorer** | Browse, search, filter, and selectively download decrypted files |
| 💻 **PC Setup (25+ GB)** | 1-click Windows zero-RAM batch/PowerShell streaming toolkit |
| 📲 **PWA — Installable App** | Install to home screen / desktop. Works fully offline |
| 🌐 **100% Offline** | Zero network requests — files and passwords never leave your device |
| 📦 **Single Portable Output** | Produces one compact `.zev` vault file |
| 🔓 **Cross-Platform** | Works in any modern browser on Windows, Mac, Linux, Android, iOS |

---

## 🔐 How It Works

### v2 — Standard Military-Grade Mode (Default)
```
[Your Folder]
     │
     ▼
 Package & Compress (Smart Adaptive: STORE for media, Fast DEFLATE for docs)
     │
     ▼
 Generate: Salt (32 bytes) + IV (12 bytes)  ← cryptographically random CSPRNG
     │
     ▼
 PBKDF2(password, salt, 600k iterations, SHA-512) → 256 raw key bytes
     │
     ▼ (if optional keyfile provided)
 SHA-256(keyfile) XOR rawKey  → mixed key bytes
     │
     ▼
 Import as AES-256-GCM key
     │
     ▼
 AES-256-GCM Encrypt → ciphertext + auth tag
     │
     ▼
 Output file: [ Magic 'ZV2\0'(4) | Version(1) | Flags(1) | Salt(32) | IV(12) | Ciphertext+Tag ]
```

### v1 — Legacy Mode (Backward Compatibility)
```
[Your Folder]
     │
     ▼
 Package & Compress (Smart Adaptive: STORE for media, Fast DEFLATE for docs)
     │
     ▼
 Generate: Salt (16 bytes) + IV (12 bytes)  ← cryptographically random CSPRNG
     │
     ▼
 PBKDF2(password, salt, 100k iterations, SHA-256) → 256-bit AES-GCM key
     │
     ▼
 AES-256-GCM Encrypt(zip bytes, key, iv) → ciphertext + auth tag
     │
     ▼
 Output file: [ Salt(16) | IV(12) | Ciphertext+Tag ] → yourfolder.zev
```

**Decryption** is fully automatic — ZevSafe detects the format by reading the 4-byte magic header (`ZV2\0`) and routes to the correct pipeline. v1 legacy vaults always work seamlessly.

---

## 🛡️ Cryptography

### v2 Parameters (Default Standard)
| Parameter | Value |
|---|---|
| Cipher | AES-256-GCM (Authenticated Encryption) |
| Key size | 256 bits |
| IV size | 96 bits — 12 bytes |
| Salt size | 256 bits — 32 bytes |
| KDF | PBKDF2-SHA512 |
| Iterations | 600,000 (exceeds OWASP 2024 recommendations) |
| Second factor | Optional keyfile (SHA-256 XOR'd into key material) |
| Format | Magic header `ZV2\0` for auto-detection |
| Memory optimization | Aggressive deallocation of intermediate buffers before unzipping |

### v1 Parameters (Legacy Compatibility)
| Parameter | Value |
|---|---|
| Cipher | AES-256-GCM |
| Key size | 256 bits |
| IV size | 96 bits (12 bytes) |
| Salt size | 128 bits (16 bytes) |
| KDF | PBKDF2-SHA256 |
| Iterations | 100,000 |
| Authentication | Built-in GCM tag — tamper-proof |
| Entropy source | `window.crypto.getRandomValues()` |

> **GCM (Galois/Counter Mode)** provides both **confidentiality AND integrity**. Any tampering with the vault file will cause decryption to fail — no silent data corruption possible.

---

## 📖 Usage Guide

### 🔐 Encrypt a Folder (v2 Standard by Default)
1. Open **ZevSafe** in your browser.
2. Drag & drop your folder into the **Lock a Folder** panel (or click "Browse Folder").
3. Enter a password or PIN (4+ characters) and confirm it.
4. *(Optional)* Select a **Keyfile** (any file — photo, document, random binary) for 2-factor security.
5. Click **Encrypt & Download** → downloads `yourfolder.zev`.

### 🔓 Decrypt a Vault
1. Open **ZevSafe**.
2. Drag & drop your `.zev` file into the **Unlock a Vault** panel (or click "Select .zev File").
3. If the vault was encrypted with a keyfile, select the keyfile in the decrypt panel.
4. Enter your password.
5. Click **Decrypt & Download** → opens the **Decrypted Vault Explorer**.
6. Play media directly, inspect files, or download individual files / full ZIP.

> **Format is auto-detected.** You do not need to manually select v1 or v2 mode when decrypting.

---

## 📲 PWA — Install as an App

ZevSafe is a fully installable **Progressive Web App (PWA)**. Once installed, it runs in standalone mode (like a native app) and works fully offline.

### Desktop (Chrome / Edge)
1. Visit [zevsafe.pages.dev](https://zevsafe.pages.dev)
2. Click the install icon (➕) in the address bar, or look for the banner.
3. Click **Install**. ZevSafe appears in your app launcher.

### Android (Chrome)
1. Visit the site — an **"Install ZevSafe"** banner appears at the bottom.
2. Tap **Install** → added to your home screen.

### iOS (Safari)
1. Tap the **Share** button (□↑).
2. Select **"Add to Home Screen"**.
3. Tap **Add** → ZevSafe icon appears on your home screen.

Once installed, the app works **100% offline** — no internet required for encryption or decryption.

---

## ❓ FAQ — File Size Limits

**Q: How large can files be?**

ZevSafe works entirely in your browser's RAM. The practical limits are:

| Device | Safe Limit |
|--------|-----------|
| Desktop (8–16 GB RAM) | Up to ~1–2 GB per vault |
| Mid-range laptop | Up to ~500 MB per vault |
| Mobile / tablet | Up to ~100–300 MB per vault |

The bottleneck is the JavaScript heap limit, not network speed (there is no network). Compressing 500 MB of files may produce a vault of 200–480 MB depending on content type.

**Q: What if my file is too large?**

Split your folder into smaller sub-folders and encrypt each separately. Or use the PowerShell scripts (`encrypt.ps1` / `decrypt.ps1`) included in the repo for streaming large files with no memory limit.

---

## 🗂️ Project Structure

```
zevsafe/
├── index.html          # Main UI — encrypt & decrypt portal
├── how-to-use.html     # Full user guide & technical reference
├── app.js              # Encryption/decryption logic (Web Crypto API)
│                       #   ├─ v1: PBKDF2-SHA256 / 100k / 16-byte salt
│                       #   └─ v2: PBKDF2-SHA512 / 600k / 32-byte salt + keyfile XOR
├── styles.css          # Dark glassmorphism UI + v2 components + PWA banner
├── sw.js               # Production Service Worker (Cache-First + SWR strategies)
├── manifest.json       # Web App Manifest (PWA install, icons, shortcuts)
├── icon-192.png        # PWA icon — 192×192
├── icon-512.png        # PWA icon — 512×512
├── favicon.svg         # Browser tab icon (SVG, any size)
├── jszip.min.js        # Offline JS library for folder ZIP compression
├── encrypt.ps1         # (Windows) PowerShell streaming encryption (large files)
├── decrypt.ps1         # (Windows) PowerShell streaming decryption (large files)
├── CHANGELOG.md        # Version history
├── task.md             # Current/ongoing task tracker
├── WEB_APP_DESIGN.md   # Current web app architecture notes
├── .gitignore
└── archive/
    └── android-native-planning/   # Superseded — early plan to build a native
        │                          # Android/Kotlin app before pivoting to this
        │                          # pure browser-based web app. Kept for reference only.
        ├── PROJECT_PLAN.md
        ├── CRYPTOGRAPHIC_SPECIFICATIONS.md
        ├── SHIZUKU_AND_STORAGE_ROUTING.md
        └── README.md
```

---

## 💻 Run Locally

No build step required — pure HTML/JS/CSS:

```bash
git clone https://github.com/zevbuild/zevsafe.git
cd zevsafe

# Just open index.html in your browser:
start index.html      # Windows
open index.html       # macOS
xdg-open index.html   # Linux
```

Or serve with a local HTTP server (required for Service Worker):
```bash
npx serve .
# or
python -m http.server 8080
```
> ⚠️ Service Workers only work over HTTPS or `localhost`. Use a local server to test PWA install and offline caching.

---

## ⚠️ Security Notes

- **Password strength matters.** Use a long passphrase (16+ characters). v2 mode is significantly stronger for the same password due to 6× more KDF iterations.
- **No password recovery.** There is no backdoor, no reset. Lose your password → vault is permanently unrecoverable.
- **Keyfile loss = vault loss.** If you encrypted with a keyfile in v2 mode, that exact file is required for decryption. Store it separately from the vault.
- **Memory safety.** All crypto runs in the browser's native sandbox. Decrypted data exists only in RAM and is never written to disk until you choose to download.
- **Service Worker never caches `.zev` files** or blob download URLs — decrypted output cannot be captured by the cache layer.
- **Verify the source.** Always use ZevSafe from the official Cloudflare Pages URL ([zevsafe.pages.dev](https://zevsafe.pages.dev)) or a locally cloned copy you trust.

---

## 👤 About

Built by **[zevbuild](https://github.com/zevbuild)** — crafting offline-first, privacy-first tools.

---

## 📜 License

MIT License — free to use, modify, and distribute.

---

*ZevSafe — Secure your data. Trust no one. Not even us.*