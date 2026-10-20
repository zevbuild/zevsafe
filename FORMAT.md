# 📦 ZevSafe Binary Container Specification (`.zev`)

> **Author:** [zevbuild](https://github.com/zevbuild)  
> **Status:** Standard / Active Specification  
> **Specification Version:** `3.0` (`ZV3\0`)  
> **Interoperability Standard:** Bit-identical container specification shared across:
> - **Web PWA:** [`zevsafe`](https://zevsafe.pages.dev) (`js/stream-crypto.js`, `js/stream-packer.js`, `js/stream-unpacker.js`, `js/worker-bridge.js`)
> - **Native Android App:** [`app-zevsafe`](https://github.com/zevbuild/app-zevsafe) (`com.zevbuild.zevsafe`: `CryptoEngine.kt`, `V3DecryptedInputStream`)
> - **Desktop CLI Tools:** Windows PowerShell & Batch Streaming Toolset (`tools/encrypt.ps1`, `tools/decrypt.ps1`)

---

## 1. Executive Summary & Design Principles

The `.zev` container format is a zero-knowledge, authenticated cryptographic file container engineered to securely package individual files or complete directory hierarchies directly inside client environments (browsers, mobile devices, and air-gapped workstations) without transmitting data across networks.

### Core Architectural Invariants:
1. **100% Air-Gapped & Client-Side:** No server-side processing, telemetry, external KMS dependencies, or cloud round-trips.
2. **Zero-Knowledge Principle:** Plaintext and key material are never persisted to non-volatile storage. Keys are kept ephemeral in RAM and zeroized immediately upon session teardown.
3. **Bounded Memory Footprint (< 150 MB RAM):** By employing a chunked STREAM AEAD pipeline with 4 MB frames and backpressure credit flow control, multi-gigabyte vaults (5 GB+) can be processed with peak heap consumption strictly below 105 MB on Web and Android.
4. **Instant Catalog Inspection (< 100 ms):** An encrypted JSON manifest envelope placed at the tail of the container enables random-access inspection of tens of thousands of files without decrypting or buffering data payloads.
5. **Targeted Selective Extraction (< 15 ms):** Single files can be extracted by decrypting only the specific 4 MB chunk span containing the file, bypassing global decryption.

---

## 2. High-Level Container Topology

```text
+---------------------------------------------------------------------------------------------+
| Container Header (57 Bytes)                                                                 |
| [ Magic 'ZV3\0' (4B) | Ver 0x03 (1B) | Flags (1B) | ChunkSize (4B) | Salt (32B) | IV (7B) | Off (8B) ] |
+---------------------------------------------------------------------------------------------+
| Chunk 0: [ PlaintextLength (4B) | Ciphertext (<= 4MB) | AES-GCM Tag (16B) ]                  |
+---------------------------------------------------------------------------------------------+
| Chunk 1: [ PlaintextLength (4B) | Ciphertext (<= 4MB) | AES-GCM Tag (16B) ]                  |
+---------------------------------------------------------------------------------------------+
| ...                                                                                         |
+---------------------------------------------------------------------------------------------+
| Chunk N (Final): [ PlaintextLength (4B) | Ciphertext (<= 4MB) | AES-GCM Tag (16B) ]         |
+---------------------------------------------------------------------------------------------+
| Encrypted Tail Manifest Trailer (Located at MANIFEST_OFFSET):                               |
| [ Salt (32B) | IV (12B) | PlaintextLength (4B) | Ciphertext JSON (M) | AES-GCM Tag (16B) ]    |
+---------------------------------------------------------------------------------------------+
```

---

## 3. Container Header Specification (Exact 57 Bytes)

Every v3 `.zev` vault begins with an unencrypted, authenticated 57-byte binary header.

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       MAGIC: 'ZV3\0'                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    VERSION    |     FLAGS     |          CHUNK_SIZE           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          (CHUNK_SIZE)         |                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+                               +
|                                                               |
+                                                               +
|                     SALT (Bytes 0..31)                        |
+                                                               +
|                                                               |
+                               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                               |     BASE_IV_PREFIX (0..6)     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      (BASE_IV_PREFIX)         |               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+               +
|                                                               |
+                    MANIFEST_OFFSET (0..7)                     +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### 3.1 Header Field Definitions

| Offset (Bytes) | Size | Encoding | Field Name | Description |
|---|---|---|---|---|
| `0..3` | 4 B | ASCII | `MAGIC` | Identifies container format: constant `ZV3\0` (`0x5A 0x56 0x33 0x00`). |
| `4` | 1 B | Uint8 | `VERSION` | Format version identifier. Always `0x03`. |
| `5` | 1 B | Bitfield | `FLAGS` | Feature bitmask: <br>• Bit 0 (`0x01`): Keyfile 2FA Required.<br>• Bits 1–7: Reserved for future extensions (must be `0`). |
| `6..9` | 4 B | Big-Endian Uint32 | `CHUNK_SIZE` | Size of unencrypted payload chunks. Default is `4,194,304` bytes (4 MB). |
| `10..41` | 32 B | Binary | `SALT` | Cryptographically secure random salt generated by CSPRNG (`crypto.getRandomValues` / `SecureRandom`). Used as KDF salt. |
| `42..48` | 7 B | Binary | `BASE_IV_PREFIX` | 7-byte CSPRNG random prefix used to construct unique per-chunk 12-byte IVs. |
| `49..56` | 8 B | Big-Endian Uint64 | `MANIFEST_OFFSET` | Absolute byte offset from the start of the file pointing to the encrypted tail catalog envelope. |

---

## 4. Cryptographic Key Derivation & 2FA

### 4.1 PBKDF2-HMAC-SHA512 Key Stretching
All keys are derived using PBKDF2 (RFC 8018 / PKCS #5 v2.1) configured with high iteration counts to resist brute-force attacks:
* **Pseudorandom Function (PRF):** `HMAC-SHA512`
* **Iteration Count ($c$):** **600,000 rounds** (exceeds OWASP minimum recommendations)
* **Salt Length:** 32 bytes (256 bits)
* **Derived Key Length:** 256 bits (32 bytes)

$$\text{DerivedKey} = \text{PBKDF2}_{\text{HMAC-SHA512}}(\text{Password}, \text{Salt}, 600\,000, 32)$$

### 4.2 Keyfile Two-Factor Authentication (2FA) Mixing
When Header Flag Bit 0 (`FLAGS & 0x01 != 0`) is asserted:
1. The physical keyfile (any document, image, or binary) is digested using SHA-256:
   $$\text{KeyfileHash} = \text{SHA-256}(\text{KeyfileBytes})$$
2. The derived 32-byte PBKDF2 key is combined with the 32-byte keyfile digest via bitwise XOR:
   $$\text{MasterKey}[i] = \text{DerivedKey}[i] \oplus \text{KeyfileHash}[i], \quad i \in [0, 31]$$
3. Neither the master password nor the keyfile alone can decrypt the container.

### 4.3 Zero-Knowledge In-Memory Handling
* **Session Scrubbing:** Plaintext passwords are cleared from DOM/UI inputs immediately after key generation.
* **Ephemeral Memory Zeroization:** When a vault session is closed or locked, sensitive key buffers in RAM are purged using `.fill(0)` / `Arrays.fill(bytes, 0.toByte())`.

---

## 5. STREAM AEAD Chunk Framing Protocol

The unencrypted data stream (which represents an internal ZIP64 archive) is partitioned into contiguous chunks of at most `CHUNK_SIZE` bytes.

### 5.1 Per-Chunk Wire Framing
Each chunk is written to the output stream as:

```text
+-----------------------+-----------------------------+------------------------+
| PlaintextLength (4 B) | Ciphertext (N Bytes)        | AES-GCM Auth Tag (16B) |
| Big-Endian Uint32     | Identical to PlaintextLength| 128-bit integrity tag  |
+-----------------------+-----------------------------+------------------------+
```

$$\text{Total Chunk Overhead} = 4 \text{ bytes (length)} + 16 \text{ bytes (tag)} = 20 \text{ bytes}$$

### 5.2 Deterministic 12-Byte Nonce / IV Construction
To prevent IV reuse without storing nonces on disk, the 12-byte initialization vector for chunk $i$ ($0, 1, 2, \dots$) is derived deterministically:

| Byte Range | Length | Field | Value |
|---|---|---|---|
| `0..6` | 7 Bytes | `Prefix` | Fixed 7-byte `BASE_IV_PREFIX` from Container Header. |
| `7..10` | 4 Bytes | `ChunkIndex` | Big-Endian 32-bit unsigned integer $i$. |
| `11` | 1 Byte | `isLast` | `0x01` if final chunk of the payload; `0x00` otherwise. |

$$\text{IV}_i = \text{BaseIVPrefix}[0..6] \;\|\; \text{BigEndianUInt32}(i) \;\|\; (1\text{B: } \text{isLast})$$

### 5.3 Per-Chunk Authenticated Additional Data (AAD) Construction (42 Bytes)
To bind the chunk payload to the container metadata and prevent chunk reordering, dropping, truncation, or splicing attacks, a 42-byte AAD block is supplied to AES-256-GCM during chunk encryption and decryption:

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     MAGIC: 'ZV3\0' (4B)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  VERSION(1B)  |                                               |
+-+-+-+-+-+-+-+-+                                               +
|                                                               |
+                     SALT (Bytes 0..31)                        +
|                                                               |
+                               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                               |      CHUNK_INDEX (0..3)       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      (CHUNK_INDEX)            |  IS_LAST(1B)  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

$$\text{AAD}_i = \text{Magic}(4\text{B}) \;\|\; \text{Version}(1\text{B}) \;\|\; \text{Salt}(32\text{B}) \;\|\; \text{BigEndianUInt32}(i) \;\|\; \text{isLast}(1\text{B})$$

> **Tamper Resistance:** If an adversary swaps two chunks, truncates the stream, changes the chunk order, or modifies the salt, AES-256-GCM authentication fails immediately with an `OperationError` / `AEADBadTagException` before any decrypted bytes are emitted.

---

## 6. Encrypted Tail Manifest Catalog (Trailer)

The trailer catalog begins at absolute byte offset `MANIFEST_OFFSET`.

### 6.1 Envelope Header (48 Bytes)
```text
+---------------------+--------------------+-----------------------+
| Manifest Salt (32B) | Manifest IV (12B)  | Plaintext Length (4B) |
| CSPRNG Salt         | CSPRNG Nonce       | Big-Endian Uint32     |
+---------------------+--------------------+-----------------------+
```

Followed immediately by:
```text
+------------------------------------+------------------------+
| Encrypted JSON Ciphertext (M B)   | AES-GCM Auth Tag (16B) |
+------------------------------------+------------------------+
```

### 6.2 Catalog JSON Schema
When decrypted, the trailer payload is a UTF-8 JSON document structured as:

```json
{
  "version": 3,
  "totalSize": 268435456,
  "fileCount": 2,
  "files": [
    {
      "path": "docs/specification.pdf",
      "name": "specification.pdf",
      "size": 1048576,
      "uncompressedSize": 1048576,
      "compressedSize": 1048576,
      "localHeaderOffset": 0,
      "compressed": false,
      "compressionMethod": 0,
      "crc32": 2841052193,
      "chunkStart": 0,
      "chunkEnd": 0,
      "lastModified": 1729416000000
    },
    {
      "path": "src/main.rs",
      "name": "main.rs",
      "size": 4096,
      "uncompressedSize": 4096,
      "compressedSize": 1240,
      "localHeaderOffset": 1048636,
      "compressed": true,
      "compressionMethod": 8,
      "crc32": 3942049182,
      "chunkStart": 0,
      "chunkEnd": 0,
      "lastModified": 1729416000000
    }
  ]
}
```

### 6.3 Field Descriptions
- `totalSize`: Total aggregate uncompressed bytes across all archived files.
- `localHeaderOffset`: Byte offset of the file's ZIP local file header (`PK\x03\x04`) within the decrypted plaintext stream.
- `compressed`: `false` if stored uncompressed (`STORE`); `true` if deflated (`DEFLATE`).
- `chunkStart`: Starting 4 MB chunk index $\lfloor \text{localHeaderOffset} / \text{CHUNK\_SIZE} \rfloor$.
- `chunkEnd`: Ending 4 MB chunk index $\lfloor (\text{localHeaderOffset} + 30 + \text{path.length} + \text{compressedSize}) / \text{CHUNK\_SIZE} \rfloor$.
- `crc32`: IEEE 802.3 CRC-32 checksum of the uncompressed file bytes.

---

## 7. Fast Random-Access Selective Extraction Algorithm

The `.zev` v3 format allows extracting or previewing an individual file without streaming the entire multi-gigabyte archive into memory.

### Step-by-Step Selective Extraction:
1. **Locate Target Chunk Span:**  
   Find the file entry in the manifest catalog, yielding $[i_{\text{start}}, i_{\text{end}}]$.
2. **Calculate File Offset in Vault:**  
   Because all non-final chunks are fixed size ($\text{CHUNK\_SIZE} + 20$ bytes):
   $$\text{VaultChunkStart}(i) = 57 + i \times (\text{CHUNK\_SIZE} + 20)$$
3. **Seek & Decrypt Chunks:**  
   Read and decrypt only chunks $i \in [i_{\text{start}}, i_{\text{end}}]$. For standard files $< 4$ MB, this touches at most 1–2 chunks.
4. **Locate Local Header in Span:**  
   $$\text{RelativeOffset} = \text{localHeaderOffset} - (i_{\text{start}} \times \text{CHUNK\_SIZE})$$
   Parse standard 30-byte ZIP Local Header (`PK\x03\x04`) to read dynamic filename length ($n$) and extra field length ($m$).
5. **Extract Payload:**  
   The compressed or raw payload begins at $\text{RelativeOffset} + 30 + n + m$. If deflated, inflate via `DecompressionStream('deflate-raw')` / `Inflater(nowrap=true)`. Verify output bytes against catalog `crc32`.
6. **Performance:** Execution completes in **< 15 ms** with memory consumption strictly bounded to **< 15 MB**.

---

## 8. Payload Packaging Rules (Adaptive Compression)

The internal unencrypted stream follows standard ZIP64 formatting with granular adaptive compression:

| File Category | Extensions | Packaging Mode | Reason |
|---|---|---|---|
| **Pre-Compressed Media** | `.jpg`, `.jpeg`, `.png`, `.webp`, `.mp4`, `.mov`, `.mkv`, `.mp3`, `.aac`, `.flac`, `.zip`, `.rar`, `.7z`, `.pdf` | `STORE` (Method `0x00`) | Bypasses redundant compression; 10x faster packaging with 0% CPU waste. |
| **Compressible Documents** | `.txt`, `.md`, `.json`, `.csv`, `.xml`, `.html`, `.js`, `.ts`, `.py`, `.kt`, `.c`, `.cpp`, `.log`, `.sql` | `DEFLATE` (Method `0x08`, Level 1) | Fast level 1 DEFLATE provides 60%–85% space reduction at maximum throughput. |

---

## 9. Backward Compatibility Reference (v1 & v2 Vaults)

`zevsafe` and `app-zevsafe` automatically identify vault format generations:

| Specification Parameter | v3 STREAM AEAD (`ZV3\0`) | v2 Standard (`ZV2\0`) | v1 Legacy |
|---|---|---|---|
| **Magic Bytes** | `ZV3\0` (`0x5A 0x56 0x33 0x00`) | `ZV2\0` (`0x5A 0x56 0x32 0x00`) | None (Starts with Salt) |
| **Header Size** | 57 Bytes | 50 Bytes | 28 Bytes |
| **KDF Algorithm** | PBKDF2-HMAC-SHA512 | PBKDF2-HMAC-SHA512 | PBKDF2-HMAC-SHA256 |
| **KDF Iterations** | **600,000** | **600,000** | 100,000 |
| **Salt Size** | 32 Bytes | 32 Bytes | 16 Bytes |
| **IV / Nonce Size** | 12 Bytes (Counter-derived) | 12 Bytes (Monolithic random) | 12 Bytes (Monolithic random) |
| **Cipher Engine** | AES-256-GCM (4 MB Chunks) | Monolithic AES-256-GCM | Monolithic AES-256-GCM |
| **Trailer Catalog** | Encrypted JSON Envelope | None | None |
| **RAM Footprint** | Bounded (< 150 MB) | Monolithic (Requires full RAM) | Monolithic (Requires full RAM) |
| **Max Practical Size** | **Multi-Gigabyte (25 GB+)** | Limited to available RAM (~500 MB) | Limited to available RAM (~200 MB) |
