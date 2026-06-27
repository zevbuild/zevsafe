# 🔒 ZevSafe — Offline Folder Encryption Portal

> **by [zevbuild](https://github.com/zevbuild) · Encrypt and decrypt entire folders directly in your browser — no server, no uploads, 100% private.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Cloudflare%20Pages-8b5cf6?style=for-the-badge&logo=cloudflare)](https://zevsafe.pages.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge)](LICENSE)
[![Security: AES-256-GCM](https://img.shields.io/badge/Security-AES--256--GCM-ef4444?style=for-the-badge)](#cryptography)
[![PWA: Installable](https://img.shields.io/badge/PWA-Installable-8b5cf6?style=for-the-badge)](#pwa--install-as-an-app)
[![100% Offline](https://img.shields.io/badge/Mode-100%25%20Offline-f59e0b?style=for-the-badge)](#)

---

## ✨ What is ZevSafe?

**ZevSafe** is a fully client-side, zero-trust encryption portal. It runs entirely in your browser using the native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) — no backend, no accounts, no internet connection required after first load.

It supports two encryption modes — **v1 (Standard)** and **v2 (Enhanced)** — and can be installed as a desktop or mobile app via PWA.

**Perfect for:**
- Encrypting sensitive folders before storing on USB drives or SD cards
- Sharing encrypted data with others via a shared password
- Air-gapped / fully offline security workflows
- Adding a keyfile second factor to vaults beyond just a password

---

## 🚀 Features

| Feature | Details |
|---|---|
| 🔐 **AES-256-GCM Encryption** | Authenticated military-grade encryption (v1 & v2) |
| 🔑 **v1 Mode — PBKDF2-SHA256** | 100,000 iterations · 16-byte salt · backward-compatible |
| 🚀 **v2 Mode — PBKDF2-SHA512** | 600,000 iterations · 32-byte salt · 6× stronger KDF |
| 🗝️ **Keyfile (2nd Factor)** | Any file acts as a physical key — optional, v2 only |
| 📁 **Full Folder Support** | Encrypts entire folder trees via in-memory ZIP |
| 💧 **Drag & Drop** | Drop a folder to encrypt, drop a `.enc` vault to decrypt |
| 🔄 **Auto-Version Detection** | Decryption auto-detects v1 vs v2 format from magic header |
| 💪 **Password Strength Meter** | Real-time visual feedback on password strength |
| 📲 **PWA — Installable App** | Install to home screen / desktop. Works fully offline |
| 🌐 **100% Offline** | Zero network requests — files and passwords never leave your device |
| 📦 **Single Portable Output** | Produces one compact `.enc` vault file |
| 🔓 **Cross-Platform** | Works in any modern browser on Windows, Mac, Linux, Android, iOS |

---

## 🔐 How It Works

### v1 — Standard Mode (default)
```
[Your Folder]
     │
     ▼
 Compress (ZIP / DEFLATE level 6)
     │
     ▼
 Generate: Salt (16 bytes) + IV (12 bytes)  ← cryptographically random
     │
     ▼
 PBKDF2(password, salt, 100k iterations, SHA-256) → 256-bit AES-GCM key
     │
     ▼
 AES-256-GCM Encrypt(zip bytes, key, iv) → ciphertext + auth tag
     │
     ▼
 Output file: [ Salt(16) | IV(12) | Ciphertext+Tag ] → yourfolder.enc
```

### v2 — Enhanced Mode (opt-in toggle)
```
[Your Folder]
     │
     ▼
 Compress (ZIP / DEFLATE level 6)
     │
     ▼
 Generate: Salt (32 bytes) + IV (12 bytes)  ← cryptographically random
     │
     ▼
 PBKDF2(password, salt, 600k iterations, SHA-512) → 256 raw key bytes
     │
     ▼ (if keyfile provided)
 SHA-256(keyfile) XOR rawKey  → mixed key bytes
     │
     ▼
 Import as AES-256-GCM key
     │
     ▼
 AES-256-GCM Encrypt → ciphertext + auth tag
     │
     ▼
 Output file: [ Magic(4) | Version(1) | Flags(1) | Salt(32) | IV(12) | Ciphertext+Tag ]
```

**Decryption** is fully automatic — ZevSafe detects the format by reading the 4-byte magic header (`ZV2\0`) and routes to the correct pipeline. v1 vaults always work in v2-capable builds.

---

## 🛡️ Cryptography

### v1 Parameters
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

### v2 Parameters (Enhanced)
| Parameter | Value |
|---|---|
| Cipher | AES-256-GCM (same) |
| Key size | 256 bits (same) |
| IV size | 96 bits — 12 bytes (same) |
| Salt size | 256 bits — 32 bytes (2× larger) |
| KDF | PBKDF2-SHA512 |
| Iterations | 600,000 (6× stronger) |
| Second factor | Optional keyfile (SHA-256 XOR'd into key material) |
| Format | Magic header `ZV2\0` for auto-detection |

> **GCM (Galois/Counter Mode)** provides both **confidentiality AND integrity**. Any tampering with the vault file will cause decryption to fail — no silent data corruption possible.

---

## 📖 Usage Guide

### 🔐 Encrypt a Folder — v1 (Standard)
1. Open **ZevSafe** in your browser.
2. Drag & drop your folder into the **Encrypt Folder** panel (or click "Browse Folder").
3. Enter a strong password (8+ characters) and confirm it.
4. Click **Encrypt & Download** → downloads `yourfolder.enc`.

### 🚀 Encrypt a Folder — v2 (Enhanced)
1. Complete steps 1–3 above.
2. Toggle **Enhanced Security Mode (v2)** — the options panel expands.
3. Optionally select a **Keyfile** (any file — photo, document, random binary).
4. Click **Encrypt & Download** → downloads `yourfolder.enc` (v2 format).
   > ⚠️ If you used a keyfile, keep it. Without it, the vault **cannot be decrypted** — even with the correct password.

### 🔓 Decrypt a Vault
1. Open **ZevSafe**.
2. Drag & drop your `.enc` file into the **Decrypt** panel (or click "Select .enc File").
3. If the vault is v2 with a keyfile, click **Select Keyfile** on the decrypt side.
4. Enter your password.
5. Click **Decrypt & Download** → downloads `yourfolder_decrypted.zip`.
6. Extract the ZIP to restore your original files.

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
├── .gitignore
└── mybrain/            # Project architecture & knowledge base
    ├── PROJECT_PLAN.md
    ├── CRYPTOGRAPHIC_SPECIFICATIONS.md
    ├── SD_CARD_ENCRYPTION_GUIDE.md
    ├── SHIZUKU_AND_STORAGE_ROUTING.md
    └── WEB_APP_DESIGN.md
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
- **Service Worker never caches `.enc` files** or blob download URLs — decrypted output cannot be captured by the cache layer.
- **Verify the source.** Always use ZevSafe from the official Cloudflare Pages URL ([zevsafe.pages.dev](https://zevsafe.pages.dev)) or a locally cloned copy you trust.

---

## 👤 About

Built by **[zevbuild](https://github.com/zevbuild)** — crafting offline-first, privacy-first tools.

---

## 📜 License

MIT License — free to use, modify, and distribute.

---

*ZevSafe — Secure your data. Trust no one. Not even us.*
