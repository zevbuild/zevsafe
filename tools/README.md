# 🛠️ ZevSafe PC Streaming Tools (25 GB - 100 GB+)

Zero-RAM, zero-dependency streaming encryption and decryption tools for Windows PC.

---

## 📦 Included Tools

| File | Purpose | Usage |
|---|---|---|
| **`Encrypt-Vault.bat`** | 1-Click Folder Encryptor | Drag & drop any folder onto this `.bat` file (or double-click to enter path). Encrypts with zero RAM limit into a `.zev` vault. |
| **`Decrypt-Vault.bat`** | 1-Click Vault Decryptor | Drag & drop any `.zev` vault onto this `.bat` file (or double-click to enter path). Decrypts directly to the original folder structure. |
| **`encrypt.ps1`** | PowerShell Streaming Encryptor | Under-the-hood PowerShell script using AES-256-GCM and PBKDF2-SHA512. |
| **`decrypt.ps1`** | PowerShell Streaming Decryptor | Under-the-hood PowerShell script performing chunked streaming decryption. |

---

## ⚡ How It Works
- **Zero-RAM Footprint:** Streams data chunk-by-chunk directly between disk and cipher pipeline, allowing 25 GB to 100 GB+ datasets to process without consuming system memory.
- **Full Compatibility:** Produces bit-identical standard vaults compatible with the ZevSafe Web PWA (`zevsafe.pages.dev`) and the native Android app (`com.zevbuild.zevsafe`).
