# Project: ZevSafe Multi-Worker Parallel Crypto & Ephemeral Session Key Optimization

## Architecture
ZevSafe Web PWA (`zevsafe`) is an air-gapped, 100% client-side zero-knowledge encrypted vault system using the `ZV3\0` STREAM AEAD container format (AES-256-GCM + PBKDF2-SHA512).
The architecture comprises:
- **WorkerBridge & WorkerPool (`js/worker-bridge.js`):** Manages an elastic pool of Web Workers (or Node `worker_threads`), dispatching independent 4 MB STREAM AEAD chunks concurrently while enforcing an `OrderedReassemblyQueue` for strictly sequential stream writes and backpressure credit flow control ($W = \max(2, \min(12, N \times 2))$) to strictly bound peak heap RAM under 150 MB.
- **CryptoWorker (`js/crypto-worker.js`):** Executes chunk encryption and decryption in background threads, accepting and returning transferable `ArrayBuffer` instances with zero memory copies.
- **StreamCrypto (`js/stream-crypto.js`):** Defines the mathematical invariants for chunk IV derivation (7B prefix + 4B counter + 1B isLast), 42B AAD derivation, and 57B header / 48B manifest envelope layout.
- **StreamUnpacker (`js/stream-unpacker.js`):** Reads vault manifests and extracts individual files. Returns derived `masterKey` from `readVaultManifest` so subsequent extractions bypass the 600,000-iteration PBKDF2 (< 15 ms vs ~2,500 ms).
- **App Shell & Vault Explorer (`app.js`, `index.html`):** Manages UI state, caches `currentV3Vault.masterKey`, wipes plaintext passwords, activates the telemetry HUD (showing live MB/s and active worker threads), and securely zeroizes memory on session lock.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Elastic Worker Pool | Web Worker pool scaling up to `navigator.hardwareConcurrency` (clamped 4–8) in `js/worker-bridge.js` and `js/crypto-worker.js` | 1 | ORIGINAL_REQUEST §R1 |
| 2 | Ordered Reassembly Queue | Sequencing buffer guaranteeing strictly ordered stream writes and bounded memory credit flow | 1 | ORIGINAL_REQUEST §R1 |
| 3 | Zero-Copy Transferable Buffers | Direct `ArrayBuffer` transfer lists without `buffer.slice()` or TypedArray copying | 1 | ORIGINAL_REQUEST §R2 |
| 4 | Ephemeral Session Key Caching | Return and cache non-extractable `masterKey` in `currentV3Vault` to bypass 600k PBKDF2 on extractions | 1 | ORIGINAL_REQUEST §R3 |
| 5 | Zero-Knowledge Session Zeroization | Wipe DOM passwords, zeroize `keyfileBytes`, clean up keys and blobs via `lockV3VaultSession` | 1 | ORIGINAL_REQUEST §R3 |
| 6 | Telemetry HUD & Cinema Deck Polish | Activate live throughput (EMA MB/s), core count badge, ETA, cancellation, and wired Cinema deck controls | 1 | ORIGINAL_REQUEST §R4 |
| 7 | Cross-Platform Compatibility & Testing | 100% pass on 7 test suites (698+ tests), bit-for-bit compatibility with Android companion app | 2 | ORIGINAL_REQUEST §R5 |
| 8 | Ecosystem Documentation & Version Sync | Synchronize `PROJECT_MEMORY.md`, `CHANGELOG.md`, `change-log/index.html`, `README.md`, `sw.js`, `index.html` to v6.7 / v35 | 2 | ORIGINAL_REQUEST §R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Supercharged Throughput, Zero-Copy, Session Key Caching & UX Polish | `js/worker-bridge.js`, `js/crypto-worker.js`, `js/stream-unpacker.js`, `app.js`, `index.html` | None | IN_PROGRESS |
| 2 | Comprehensive Verification, Test Hardening & Documentation Sync | `test/`, `PROJECT_MEMORY.md`, `CHANGELOG.md`, `change-log/index.html`, `README.md`, `sw.js`, `index.html` | M1 | PLANNED |

## Interface Contracts

### `WorkerPool` & `WorkerBridge` ↔ `CryptoWorker`
- **Init Session Message:**
  - `type: 'INIT_SESSION'`
  - `sessionId: string`
  - `cryptoKey: CryptoKey` (or `salt: ArrayBuffer`, `iterations: number`, `keyfileBytes: ArrayBuffer`)
  - `baseIVPrefix: ArrayBuffer` (7 bytes)
  - `chunkSize: number`
  - `magic: ArrayBuffer`, `version: number`, `salt: ArrayBuffer` (for AAD)
  - Transfer list: `[salt, keyfileBytes]` (when transferring raw buffers)
- **Encrypt Chunk Request:**
  - `type: 'ENCRYPT_CHUNK'`
  - `sessionId: string`, `chunkIndex: number`, `isLast: boolean`
  - `plainChunk: ArrayBuffer`
  - Transfer list: `[plainChunk]`
- **Encrypt Chunk Response:**
  - `type: 'CHUNK_ENCRYPTED'`
  - `sessionId: string`, `chunkIndex: number`, `isLast: boolean`
  - `encryptedChunk: ArrayBuffer`
  - Transfer list: `[encryptedChunk]`
- **Decrypt Chunk Request:**
  - `type: 'DECRYPT_CHUNK'`
  - `sessionId: string`, `chunkIndex: number`, `isLast: boolean`
  - `cipherChunk: ArrayBuffer`
  - Transfer list: `[cipherChunk]`
- **Decrypt Chunk Response:**
  - `type: 'CHUNK_DECRYPTED'`
  - `sessionId: string`, `chunkIndex: number`, `isLast: boolean`
  - `plainChunk: ArrayBuffer`
  - Transfer list: `[plainChunk]`

### `StreamUnpacker` ↔ `app.js` (Vault Explorer)
- **`StreamUnpacker.readVaultManifest(file, passwordOrKey, opts)`:**
  - Returns: `{ version: 3, totalSize, fileCount, files: [...], header, masterKey: CryptoKey }`
- **`StreamUnpacker.extractSingleFile(file, passwordOrKey, entry, opts)`:**
  - Accepts `CryptoKey` as `passwordOrKey`, bypassing PBKDF2 derivation.
- **`lockV3VaultSession()` in `app.js`:**
  - Zeroizes `currentV3Vault.keyfileBytes` with `.fill(0)`.
  - Nullifies `currentV3Vault.masterKey`, `currentV3Vault.password`, `currentV3Vault.catalog`.
  - Sets `currentV3Vault = null`.
  - Revokes active media blob URLs and nullifies `currentMediaBlob`.

## Code Layout
- `js/worker-bridge.js`: WorkerPool, OrderedReassemblyQueue, startEncryption, startDecryption
- `js/crypto-worker.js`: Multi-session worker message handlers, zero-copy buffer transfers
- `js/stream-unpacker.js`: readVaultManifest returning masterKey, extractSingleFile using masterKey
- `js/stream-crypto.js`: Mathematical definitions for STREAM AEAD
- `app.js`: Vault Explorer session management, UI telemetry HUD updates, Cinema player deck controls
- `index.html`: UI markup for telemetry HUD and media player
- `styles.css`: Styling for telemetry HUD and player controls
- `test/`: Automated test suites (`test-android-encryption.js`, `test-integration-m5.js`, `test-worker-bridge.js`, etc.)
- `PROJECT_MEMORY.md`, `CHANGELOG.md`, `change-log/index.html`, `README.md`, `sw.js`: Ecosystem docs and versioning
