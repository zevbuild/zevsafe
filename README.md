# 🔒 ZevSafe — Offline Folder Encryption Portal

> **by [zevbuild](https://github.com/zevbuild) · Encrypt and decrypt entire folders directly in your browser — no server, no uploads, 100% private.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Cloudflare%20Pages-8b5cf6?style=for-the-badge&logo=cloudflare)](https://zevsafe.pages.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge)](LICENSE)
[![Security: AES-256-GCM](https://img.shields.io/badge/Security-AES--256--GCM-ef4444?style=for-the-badge)](#cryptography)
[![100% Offline](https://img.shields.io/badge/Mode-100%25%20Offline-f59e0b?style=for-the-badge)](#)

---

## ✨ What is ZevSafe?

**ZevSafe** is a fully client-side, zero-trust encryption portal built by **zevbuild**. It runs entirely in your browser using the native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) — no backend, no accounts, no internet connection required after the page loads.

**Perfect for:**
- Encrypting sensitive folders before storing on USB drives or SD cards
- Sharing encrypted data with others (they decrypt with the same password)
- Air-gapped / fully offline security workflows
- Keeping files private on portable drives

---

## 🚀 Features

| Feature | Details |
|---|---|
| 🔐 **AES-256-GCM Encryption** | Military-grade authenticated encryption |
| 🔑 **PBKDF2 Key Derivation** | 100,000 iterations with SHA-256 |
| 📁 **Full Folder Support** | Encrypts entire folder trees, not just single files |
| 💧 **Drag & Drop** | Drop a folder to encrypt, drop a `.enc` file to decrypt |
| 💪 **Password Strength Meter** | Real-time visual feedback on password strength |
| 👁 **Show/Hide Password** | Toggle visibility on all password fields |
| 🌐 **100% Offline** | Zero network requests — your files never leave your device |
| ✈️ **SW Offline Caching** | Service Worker caches all resources for 100% offline future loading |
| 📦 **Single Portable Output** | Produces one compact `.enc` vault file |
| 🔓 **Cross-Platform** | Works in any modern browser on Windows, Mac, Linux, Android, and iOS |

---

## 🔐 How It Works

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
 PBKDF2(password, salt, 100k iterations, SHA-256) → AES-256-GCM key
     │
     ▼
 AES-256-GCM Encrypt(zip bytes, key, iv) → ciphertext + auth tag
     │
     ▼
 Output file: [ Salt(16) | IV(12) | Ciphertext ] → yourfolder.enc
```

**Decryption** is the exact reverse. The Salt and IV are stored in the file header (non-secret). Only the **password** you set can unlock the data. Wrong password = automatic error — AES-GCM's authentication tag rejects it instantly.

---

## 🛡️ Cryptography

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

> **GCM (Galois/Counter Mode)** provides both **confidentiality AND integrity**. Any tampering with the file will cause decryption to fail with an error — no silent data corruption.

---

## 📖 Usage Guide

### 🔐 Encrypt a Folder
1. Open **ZevSafe** in your browser.
2. Drag & drop your folder into the **Encrypt Folder** panel (or click "Browse Folder").
3. Enter a strong password (8+ characters) and confirm it.
4. Click **Encrypt & Download** → downloads `yourfolder.enc`.

### 🔓 Decrypt a Vault
1. Open **ZevSafe** in your browser.
2. Drag & drop your `.enc` file into the **Decrypt Folder** panel (or click "Select .enc File").
3. Enter your original password.
4. Click **Decrypt & Download** → decrypts the vault and downloads `yourfolder_decrypted.zip`.
5. Extract the ZIP to restore your original files.

---

## 🗂️ Project Structure

```
zevsafe/
├── index.html          # Main UI (ZevSafe portal)
├── app.js              # Encryption/decryption logic (Web Crypto API)
├── styles.css          # Dark glassmorphism UI
├── jszip.min.js        # Offline JS library for folder compression
├── encrypt.ps1         # (Windows) PowerShell streaming encryption tool
├── decrypt.ps1         # (Windows) PowerShell streaming decryption tool
├── .gitignore          # Git ignore rules
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

Or serve with a local server:
```bash
npx serve .
# or
python -m http.server 8080
```

---

## ⚠️ Security Notes

- **Password strength matters.** Use a long passphrase (16+ characters). The encryption is only as strong as your password.
- **No password recovery.** There is no backdoor, no reset. Lose your password → data is permanently unrecoverable.
- **Memory safety.** All crypto runs in the browser's native sandbox. Decrypted data exists only in RAM and is never written to disk until you download it.
- **Verify the source.** Always use ZevSafe from the official Cloudflare Pages URL (https://zevsafe.pages.dev) or a locally cloned copy you trust.

---

## 👤 About

Built by **[zevbuild](https://github.com/zevbuild)** — crafting offline-first, privacy-first tools.

---

## 📜 License

MIT License — free to use, modify, and distribute.

---

*ZevSafe — Secure your data. Trust no one. Not even us.*
