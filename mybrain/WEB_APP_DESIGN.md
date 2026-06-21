# Web Cryptor: Architectural & Cryptographic Design

This document details the client-side, browser-based zipping and encryption architecture used in Web Vault.

---

## 1. Web Application Architecture
The application runs as a self-contained Single-Page Application (SPA). It uses zero backend servers.

* **HTML5 File System API**: Allows users to select folders (`webkitdirectory` input attribute) or drag and drop folders directly. The dropzone listener uses `webkitGetAsEntry()` to recursively traverse the files and subfolders, capturing their hierarchy.
* **JSZip Core**: A pure JavaScript compression library. Files are read as array buffers chunk by chunk, zipped in-memory preserving the relative directory path, and packaged into a ZIP blob.
* **Web Crypto API**: The standard native browser API for cryptographic operations. It compiles and executes AES-256-GCM algorithms in native browser C++ space, yielding very high encryption speeds.

---

## 2. Cryptographic Specifications

### Key Derivation Function (PBKDF2)
When the user submits a password:
* **Algorithm**: `PBKDF2` (Password-Based Key Derivation Function 2)
* **Salt**: A unique, cryptographically secure 16-byte random salt generated per-encryption using `window.crypto.getRandomValues()`.
* **Hash function**: `SHA-256`
* **Iterations**: `100,000`
* **Key Length**: `256 bits` (derived key used directly for AES-GCM)

### Encryption Scheme (AES-GCM-256)
We encrypt the zipped file stream using AES in Galois/Counter Mode (GCM):
* **Mode**: `AES-GCM`
* **IV (Initialization Vector)**: A secure, random 12-byte initialization vector generated per-encryption.
* **Auth Tag**: A 128-bit authentication tag is automatically appended to the ciphertext by the browser's Web Crypto engine. GCM validates this tag during decryption to verify that the file contents have not been modified or tampered with.

### Output File Structure
The generated `.enc` file packages all elements required for offline decryption:
```text
┌──────────────────────┬──────────────────────┬────────────────────────────────────────────────────────┐
│ Salt (16 Bytes)      │ IV (12 Bytes)        │ Ciphertext + 128-bit GCM Auth Tag (Variable Length)    │
└──────────────────────┴──────────────────────┴────────────────────────────────────────────────────────┘
0                      16                     28
```

---

## 3. Browser Compatibility & Offline Usage
* **Compatibility**: Works on all modern web browsers supporting the Web Crypto API, including Google Chrome, Microsoft Edge, Mozilla Firefox, Apple Safari (both Desktop and Mobile).
* **Offline Execution**:
  * The application has zero network dependencies. All libraries (`jszip.min.js`) are saved locally.
  * You can run the app offline simply by double-clicking **`index.html`** in your file browser.
  * For local hosting, you can run a lightweight server locally:
    ```bash
    python -m http.server 8000
    ```
    Then visit `http://localhost:8000` in your browser.
