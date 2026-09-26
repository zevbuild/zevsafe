# Project: ZevSafe 5 GB Streaming Architecture

## Architecture

ZevSafe is a zero-knowledge, 100% client-side offline encryption web application. The 5 GB low-memory streaming architecture replaces the legacy monolithic buffer model with a chunked, backpressure-controlled streaming pipeline that guarantees peak memory heap < 150 MB (modeled ~45–75 MB), 60 FPS main thread fluidity, instant selective file extraction, and reliable multi-gigabyte downloads across modern mobile and desktop browsers.

### Core Architectural Components

1. **v3 STREAM AEAD Container (`ZV3\0`)**:
   - Web Crypto's `SubtleCrypto` only supports atomic single-shot operations. To stream up to 5 GB without loading the file into memory, payloads are partitioned into discrete 4 MB chunks ($C = 4,194,304\text{ bytes}$).
   - **Base Key Derivation**: PBKDF2-SHA512 with 600,000 iterations over user password and 32-byte cryptographically secure random salt, with optional SHA-256 keyfile XOR mixing, deriving a 256-bit AES-GCM master key.
   - **Per-Chunk Nonce Progression**: 12-byte IV structured as `[7-byte Vault Prefix | 4-byte Big-Endian Chunk Counter i | 1-byte is_last Flag (0x00 or 0x01)]`.
   - **Per-Chunk Associated Authenticated Data (AAD)**: 42-byte bound header `[Magic 'ZV3\0' (4B) | Version (1B) | Vault Salt (32B) | Chunk Index (4B) | is_last Flag (1B)]`. This mathematically prevents chunk reordering, truncation, insertion, duplication, or cross-vault splicing.
   - **Binary Container Layout**:
     ```text
     [Magic 'ZV3\0' (4B) | Version 0x03 (1B) | Flags (1B) | ChunkSize 4MB (4B) | Salt (32B) | Base IV Prefix (7B) | Manifest Offset (8B)]
     Chunk 0: [ Length (4B) | Ciphertext (4MB) | GCM Auth Tag (16B) ]
     Chunk 1: [ Length (4B) | Ciphertext (4MB) | GCM Auth Tag (16B) ]
     ...
     Chunk N (Final): [ Length (4B) | Ciphertext (<= 4MB) | GCM Auth Tag (16B) ]
     Encrypted Manifest Trailer: [ Salt_M (32B) | IV_M (12B) | Length (4B) | Ciphertext + Tag ]
     ```

2. **Streaming ZIP64 & Native Deflate Packaging**:
   - Universal OS compatibility without in-memory buffering.
   - Files are streamed sequentially using standard ZIP Local File Headers with General Purpose Bit 3 (`0x0008`) set, followed by compressed payload, and terminated with a 24-byte ZIP64 Extended Information Data Descriptor (`[0x08074b50 | CRC32 (4B) | CompSize (8B) | UncompSize (8B)]`).
   - Uses native `CompressionStream('deflate-raw')` / `DecompressionStream('deflate-raw')` (RFC 1951) for 0 MB JS heap dictionary overhead.
   - In-memory Central Directory metadata catalog requires < 2 MB RAM for 10,000 files and is written at the archive trailer.

3. **Encrypted Manifest Trailer & Instant Selective Extraction**:
   - An encrypted JSON catalog is appended to the vault trailer.
   - Slicing the tail of a 5 GB vault (`file.slice(manifestOffset)`) decrypts only ~50 KB–500 KB in < 100 ms with < 15 MB RAM, opening the Decrypted Vault Explorer instantly.
   - Single-file extraction computes the target file's chunk span $[C_{start}, C_{end}]$, decrypting and decompressing only those specific chunks without processing the entire 5 GB.
   - Video and audio files can be streamed on-demand to the Cinema Media Player.

4. **Web Worker Offloading & Real-Time Telemetry Pipeline**:
   - Key derivation, chunk reading, compression, and AES-GCM execute inside dedicated background Web Workers.
   - Chunks are transferred across thread boundaries via Transferable `ArrayBuffer` objects, eliminating memory copying.
   - Credit-based ACK backpressure flow control (`highWaterMark: 1`) restricts concurrent in-flight chunks to $\le 2$, bounding memory usage.
   - Real-time rolling metrics (MB/s throughput, elapsed seconds, dynamic ETA, and stage indicators) are published to the UI thread at throttled 100 ms intervals.

5. **Multi-Tier Mobile Streaming Download Adapter**:
   - **Tier 1 (Desktop & Android Chrome)**: File System Access API (`showSaveFilePicker()` + `createWritable()`) directly streams ciphertext or decrypted output to disk.
   - **Tier 2 (Desktop Safari, Firefox, Mobile Chrome)**: Service Worker stream intercept (`sw.js`). Synthetic fetch route (`/_stream_download`) streams a `ReadableStream` response with `Content-Disposition: attachment`.
   - **Tier 3 (iOS Safari 15.2+)**: Origin Private File System (OPFS) worker staging via `createSyncAccessHandle()`, yielding a disk-backed `File` object downloaded via `URL.createObjectURL(file)` without holding bytes in the JS heap.

6. **Backward Compatibility**:
   - First 4 bytes sniffed:
     - `ZV3\0` -> v3 Streaming Pipeline
     - `ZV2\0` -> v2 Standard Pipeline (PBKDF2-SHA512, 600k rounds, 32B salt, 12B IV, keyfile XOR)
     - Other (length $\ge 44$ bytes) -> v1 Legacy Pipeline (PBKDF2-SHA256, 100k rounds, 16B salt, 12B IV)
     - Length $< 44$ bytes -> Rejection with corrupted/invalid vault error.

---

## Feature Inventory

Every feature discovered during Survey is mapped to a dedicated milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | v1 Legacy Vault Decryption | Headerless AES-256-GCM with PBKDF2-SHA256 (100k rounds, 16B salt, 12B IV) | M3 | survey |
| 2 | v2 Standard Vault Decryption | `ZV2\0` container with PBKDF2-SHA512 (600k rounds, 32B salt, 12B IV) | M3 | survey |
| 3 | Keyfile 2FA XOR Mixing | Hardens PBKDF2 key with SHA-256(keyfile) XOR; flag bit `0x01` | M1 | survey |
| 4 | Automatic Format Sniffing | Sniffs initial 4 bytes to auto-route between v1, v2, and v3 | M3 | survey |
| 5 | v3 STREAM AEAD Container Framing | `ZV3\0` 4 MB chunks with 12B counter IV and 42B AAD sequence binding | M1 | survey |
| 6 | STREAM AEAD Decryption & Tamper Detection | Validates chunk GHASH tags & sequence counter; immediate halt on tamper | M1 | survey |
| 7 | Low-Memory PBKDF2 Key Derivation | Worker-offloaded PBKDF2-SHA512 (600k rounds) without main thread stall | M1 | survey |
| 8 | Streaming ZIP64 Archive Packager | Streams files with Local Bit 3 data descriptors & deferred Central Directory | M2 | survey |
| 9 | Native Stream Compression | `CompressionStream('deflate-raw')` / `DecompressionStream('deflate-raw')` | M2 | survey |
| 10 | Encrypted Manifest Trailer | Encrypted JSON catalog for file paths, sizes, offsets, and chunk spans | M3 | survey |
| 11 | Instant Vault Browsing & Search | Decrypts only manifest trailer in < 100 ms with < 15 MB RAM | M3 | survey |
| 12 | Selective Single-File Extraction | Decrypts and decompresses only chunk span $[C_{start}, C_{end}]$ on demand | M3 | survey |
| 13 | Selective Batch Extraction | Extracts selected file subsets into streamed zip bundle | M3 | survey |
| 14 | Web Worker Pipeline & Transferable Buffers | Offloads crypto and compression using transferable ArrayBuffers | M4 | survey |
| 15 | Backpressure Flow Control | Strict 1-chunk highWaterMark preventing buffer accumulation | M1 | survey |
| 16 | Real-Time Telemetry & Throughput | Emits true MB/s processing speed, elapsed time, ETA, and stage progress | M4 | survey |
| 17 | Cancellation & Error Recovery | Cooperative cancellation releasing all streams, handles, and memory | M4 | survey |
| 18 | 60 FPS Responsive UI Integration | Smooth non-blocking UI for encrypt and decrypt views | M5 | survey |
| 19 | Multi-Tier Mobile Streaming Downloads | FileSystem API, ServiceWorker fetch intercept, OPFS staging | M5 | survey |
| 20 | Cinema Media Streaming Player | Range/chunk on-demand streaming playback of video/audio from large vaults | M5 | survey |
| 21 | Opaque-Box E2E Test Suite (Tiers 1-4) | Comprehensive test harness, synthetic 5 GB streams, memory validation | E2E Track | survey |
| 22 | Tier 5 Adversarial Coverage Hardening | White-box adversarial testing, edge corruption, OOM stress tests | M7 | survey |
| 23 | Forensic Integrity Verification | Systematic audit confirming genuine client-side crypto logic | M7 | survey |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| **E2E** | E2E Testing Track | Independent opaque-box test infrastructure, synthetic multi-gigabyte streams, memory profilers, Tiers 1-4 test suites (`TEST_READY.md`) | None | DONE |
| **M1** | Core Streaming Crypto & AEAD Engine | v3 STREAM AEAD framing, chunk encryption/decryption, PBKDF2-SHA512 worker routines, AAD counter binding, tamper rejection (`stream-crypto.js`) | None | DONE |
| **M2** | Streaming Packaging & Compression Engine | Streaming ZIP64 packager, native `CompressionStream('deflate-raw')` pipeline, adaptive STORE/DEFLATE (`stream-packer.js`) | M1 | DONE |
| **M3** | Decryption, Selective Extraction & Compatibility | Header sniffing, v1/v2 backward compat, manifest trailer parser, instant vault browser, selective file extraction (`stream-unpacker.js`) | M1, M2 | DONE |
| **M4** | Worker Pipeline & Telemetry Infrastructure | Web Worker orchestrator, transferable buffers, credit ACK backpressure, true MB/s telemetry, cooperative cancel (`crypto-worker.js`, `worker-bridge.js`) | M1, M2, M3 | IN_PROGRESS |
| **M5** | UI Streaming Integration & Mobile Downloads | Modernized `app.js` UI bindings, 60 FPS animations, `sw.js` stream intercept download, FileSystem Access API & OPFS adapters (`stream-saver.js`) | M4 | PLANNED |
| **M6** | Final E2E Test Suite Validation | Execute 100% of E2E test suite (Tiers 1-4) against integrated web application; verify memory < 150 MB and SHA-256 round-trip | M5, E2E | PLANNED |
| **M7** | Adversarial Hardening (Tier 5) & Forensic Audit | Challenger adversarial testing, edge case stress-testing, tamper fuzzing, and Forensic Auditor verification | M6 | PLANNED |

---

## Interface Contracts

### 1. `StreamCrypto` Engine (`stream-crypto.js`) ↔ Worker / Core
- **`deriveMasterKey(password: string, salt: Uint8Array, iterations: number = 600000, keyfileBytes: Uint8Array | null): Promise<CryptoKey>`**
  - Inputs: UTF-8 password, 32-byte salt, iterations count, optional keyfile.
  - Returns: 256-bit AES-GCM `CryptoKey`.
- **`computeChunkIV(baseIVPrefix: Uint8Array, chunkIndex: number, isLast: boolean): Uint8Array`**
  - Returns 12-byte IV: `baseIVPrefix[0..6] || BigEndian32(chunkIndex) || (isLast ? 0x01 : 0x00)`.
- **`computeChunkAAD(magic: Uint8Array, version: number, salt: Uint8Array, chunkIndex: number, isLast: boolean): Uint8Array`**
  - Returns 42-byte AAD binding: `magic (4B) || version (1B) || salt (32B) || BigEndian32(chunkIndex) (4B) || (isLast ? 0x01 : 0x00) (1B)`.
- **`encryptChunk(key: CryptoKey, plaintext: Uint8Array, baseIVPrefix: Uint8Array, chunkIndex: number, isLast: boolean, salt: Uint8Array): Promise<Uint8Array>`**
  - Returns formatted chunk: `[Length (4B uint32) || Ciphertext (N bytes) || Tag (16B)]`.
- **`decryptChunk(key: CryptoKey, chunkBytes: Uint8Array, baseIVPrefix: Uint8Array, chunkIndex: number, isLast: boolean, salt: Uint8Array): Promise<Uint8Array>`**
  - Authenticates and decrypts chunk. Throws `OperationError` immediately on tamper or wrong key.

### 2. `StreamPacker` (`stream-packer.js`) ↔ Crypto Pipeline
- **`createStreamingZipSource(files: Array<{ name: string, stream: ReadableStream, size: number }>): ReadableStream<Uint8Array>`**
  - Emits streaming ZIP64 byte stream chunk-by-chunk with Local Bit 3 data descriptors.
  - Collects Central Directory records in memory (< 2 MB for 10k files).
  - Emits Central Directory and ZIP64 End of Central Directory trailer at completion.
- **`buildEncryptedManifest(filesCatalog: Array<Object>, key: CryptoKey): Promise<Uint8Array>`**
  - Encrypts JSON manifest into standalone envelope `[Salt (32B) || IV (12B) || Length (4B) || Ciphertext + Tag]`.

### 3. `WorkerBridge` (`worker-bridge.js`) ↔ UI Thread (`app.js`)
- **`startEncryption(options: { files: Array<File>, password: string, keyfile: File | null, onProgress: Function, onComplete: Function, onError: Function }): { cancel: Function }`**
  - Spawns worker, initializes pipeline, streams output to download adapter.
  - Progress callback payload: `{ percent: number, stage: string, throughputMBs: number, elapsedSec: number, etaSec: number, processedBytes: number, totalBytes: number }`.
- **`startDecryption(options: { vaultFile: File, password: string, keyfile: File | null, onManifestReady: Function, onProgress: Function, onComplete: Function, onError: Function }): { cancel: Function }`**
  - Decrypts manifest trailer first; invokes `onManifestReady(files)` for instant browsing.
  - Allows full streaming unpack or selective file extraction.

### 4. `StreamSaverAdapter` (`stream-saver.js`) ↔ Browser
- **`createStreamWriter(filename: string, expectedSize?: number): Promise<WritableStream>`**
  - Auto-selects between FileSystem Access API, Service Worker `/_stream_download` intercept, or OPFS worker staging.

---

## Code Layout

```text
c:\Users\Raju\Another-world\GitHub\zevbuild-studio\zevsafe\
├── index.html                 # Main ZevSafe PWA UI
├── styles.css                 # Application styling
├── sw.js                      # Service Worker (enhanced with streaming download intercept)
├── app.js                     # Main UI orchestrator & view binding
├── jszip.min.js               # Legacy in-memory helper (retained for v1/v2 compatibility)
├── js/
│   ├── stream-crypto.js       # Core STREAM AEAD & PBKDF2 implementation
│   ├── stream-packer.js       # Streaming ZIP64 packaging & native deflate pipeline
│   ├── stream-unpacker.js     # Streaming vault parser, manifest reader & selective extractor
│   ├── crypto-worker.js       # Background Web Worker running packaging & crypto
│   ├── worker-bridge.js       # Main-thread promise-based bridge & telemetry throttling
│   └── stream-saver.js        # Multi-tier mobile & desktop streaming download adapter
├── test/
│   ├── e2e-runner.html        # Browser-based test harness for Tiers 1-4 and memory inspection
│   ├── e2e-tests.js           # Automated test suites (Tiers 1-4)
│   ├── mock-stream.js         # Synthetic multi-gigabyte stream generator
│   └── memory-profiler.js     # Real-time performance.memory verification harness
├── TEST_INFRA.md              # E2E Test infrastructure documentation
├── TEST_READY.md              # E2E Test suite ready publication
└── ORIGINAL_REQUEST.md        # Authoritative User Request
```

File write ownership rules:
- `stream-crypto.js`: Owned by M1 Worker.
- `stream-packer.js`: Owned by M2 Worker.
- `stream-unpacker.js`: Owned by M3 Worker.
- `crypto-worker.js`, `worker-bridge.js`: Owned by M4 Worker.
- `app.js`, `sw.js`, `stream-saver.js`, `index.html`: Owned by M5 Worker.
- `test/*`, `TEST_INFRA.md`, `TEST_READY.md`: Owned by E2E Testing Track Worker.
