/**
 * ZevSafe v3 Streaming Decryption, Selective Extraction & Backward Compatibility Engine
 * js/stream-unpacker.js
 *
 * Implements low-memory streaming decryption and selective extraction conforming to
 * the 5 GB streaming architecture specification:
 * - Automatic format sniffing & header parsing (v1 legacy, v2 standard, v3 streaming)
 * - 100% backward-compatible v1 & v2 vault decryptors (PBKDF2-SHA256 / PBKDF2-SHA512 + keyfile)
 * - Instant v3 encrypted manifest trailer reader (< 100 ms, < 15 MB RAM)
 * - Selective single-file extraction with chunk range reads, CRC-32 check & native decompression
 * - Selective batch extraction with chunk caching
 * - Full streaming vault decryption pipeline via Web Streams API (createStreamingVaultDecryptor)
 * - Unified automatic route selector (decryptVault)
 */

(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        const exports = factory();
        root.StreamUnpacker = exports;
        if (typeof globalThis !== 'undefined') {
            globalThis.StreamUnpacker = exports;
        }
    }
}(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    // =========================================================================
    // CONSTANTS & CONTAINER SPECIFICATIONS
    // =========================================================================

    /** 4-byte magic identifier for ZevSafe v3 vaults: 'ZV3\0' */
    const V3_MAGIC = new Uint8Array([0x5A, 0x56, 0x33, 0x00]);

    /** 4-byte magic identifier for ZevSafe v2 vaults: 'ZV2\0' */
    const V2_MAGIC = new Uint8Array([0x5A, 0x56, 0x32, 0x00]);

    /** Format version numbers */
    const V3_VERSION = 0x03;
    const V2_VERSION = 0x02;
    const V1_VERSION = 0x01;

    /** Header sizes in bytes */
    const V3_HEADER_SIZE = 57;
    const V2_HEADER_SIZE = 50;
    const V1_HEADER_SIZE = 28;

    /** Minimum size for any valid vault (16B salt + 12B IV + 16B GCM auth tag = 44B) */
    const MIN_VAULT_SIZE = 44;

    /** V3 chunk framing: 4B uint32 BE length prefix + 16B GCM tag = 20B overhead */
    const CHUNK_HEADER_SIZE = 4;
    const TAG_LENGTH = 16;
    const CHUNK_FRAME_OVERHEAD = CHUNK_HEADER_SIZE + TAG_LENGTH; // 20 bytes

    /** Default chunk payload size (4 MB = 4,194,304 bytes) */
    const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

    /** Manifest trailer envelope layout */
    const MANIFEST_SALT_LENGTH = 32;
    const MANIFEST_IV_LENGTH = 12;
    const MANIFEST_LEN_SIZE = 4;
    const MANIFEST_HEADER_SIZE = MANIFEST_SALT_LENGTH + MANIFEST_IV_LENGTH + MANIFEST_LEN_SIZE; // 48 bytes

    /** Flags bitfield */
    const FLAG_KEYFILE = 0x01;

    /** Standard PKWARE ZIP signatures */
    const ZIP_SIGNATURES = {
        LOCAL_FILE_HEADER: 0x04034b50,
        DATA_DESCRIPTOR: 0x08074b50,
        CENTRAL_DIRECTORY: 0x02014b50
    };

    // =========================================================================
    // ENVIRONMENT & DEPENDENCY RESOLUTION
    // =========================================================================

    function getSubtleCrypto() {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            return crypto.subtle;
        }
        if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
            return globalThis.crypto.subtle;
        }
        if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
            return window.crypto.subtle;
        }
        throw new Error('Web Crypto API (subtle) is not available in this environment');
    }

    function createOperationError(message) {
        if (typeof DOMException !== 'undefined') {
            return new DOMException(message, 'OperationError');
        }
        const err = new Error(message);
        err.name = 'OperationError';
        return err;
    }

    function getStreamCrypto() {
        if (typeof StreamCrypto !== 'undefined') {
            return StreamCrypto;
        }
        if (typeof globalThis !== 'undefined' && globalThis.StreamCrypto) {
            return globalThis.StreamCrypto;
        }
        if (typeof require === 'function') {
            try {
                return require('./stream-crypto.js');
            } catch (_) {
                try {
                    return require('../js/stream-crypto.js');
                } catch (__) {}
            }
        }
        throw new Error('StreamCrypto module is required but could not be loaded');
    }

    function concatBuffers(a, b) {
        if (!a || a.byteLength === 0) return b || new Uint8Array(0);
        if (!b || b.byteLength === 0) return a || new Uint8Array(0);
        const out = new Uint8Array(a.byteLength + b.byteLength);
        out.set(a instanceof Uint8Array ? a : new Uint8Array(a), 0);
        out.set(b instanceof Uint8Array ? b : new Uint8Array(b), a.byteLength);
        return out;
    }

    function xorBytes(a, b) {
        const len = Math.min(a.length, b.length);
        const result = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = a[i] ^ b[i];
        }
        return result;
    }

    // =========================================================================
    // CRC-32 TABLE & VERIFIER (IEEE 802.3 Standard)
    // =========================================================================

    const CRC32_TABLE = new Uint32Array(256);
    (function initCRC32Table() {
        const polynomial = 0xEDB88320;
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (polynomial ^ (c >>> 1)) : (c >>> 1);
            }
            CRC32_TABLE[i] = c >>> 0;
        }
    })();

    class CRC32 {
        constructor() {
            this.reset();
        }
        reset() {
            this.crc = 0xFFFFFFFF;
            return this;
        }
        update(chunk) {
            if (!chunk || chunk.byteLength === 0) return this;
            const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            let c = this.crc;
            const len = bytes.length;
            for (let i = 0; i < len; i++) {
                c = (c >>> 8) ^ CRC32_TABLE[(c ^ bytes[i]) & 0xFF];
            }
            this.crc = c >>> 0;
            return this;
        }
        digest() {
            return (this.crc ^ 0xFFFFFFFF) >>> 0;
        }
    }

    function crc32(data) {
        const calculator = new CRC32();
        if (typeof data === 'string') {
            calculator.update(new TextEncoder().encode(data));
        } else {
            calculator.update(data);
        }
        return calculator.digest();
    }

    // =========================================================================
    // NATIVE DECOMPRESSION (RFC 1951 Deflate-Raw)
    // =========================================================================

    /**
     * Decompresses raw DEFLATE bytes (RFC 1951) using native DecompressionStream.
     *
     * @param {Uint8Array} compressedBytes - Raw compressed bytes
     * @returns {Promise<Uint8Array>} Uncompressed plaintext bytes
     */
    async function decompressDeflateRaw(compressedBytes) {
        if (!compressedBytes || compressedBytes.byteLength === 0) {
            return new Uint8Array(0);
        }

        if (typeof DecompressionStream === 'undefined') {
            throw new Error('DecompressionStream is not supported in this environment');
        }

        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();

        let writeErr = null;
        // Write compressed bytes and close writable side
        const writePromise = (async () => {
            try {
                await writer.write(compressedBytes);
                await writer.close();
            } catch (err) {
                writeErr = err;
            }
        })();
        writePromise.catch(() => {});

        const chunks = [];
        let totalLen = 0;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.byteLength > 0) {
                    chunks.push(value);
                    totalLen += value.byteLength;
                }
            }
        } finally {
            await writePromise;
        }

        if (writeErr) {
            throw writeErr;
        }

        const out = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
            out.set(c, offset);
            offset += c.byteLength;
        }
        return out;
    }

    // =========================================================================
    // UNIVERSAL BYTE RANGE READER
    // =========================================================================

    /**
     * Reads a byte range [start, end) from an arbitrary vault source:
     * - Blob / File (via .slice(start, end).arrayBuffer())
     * - Uint8Array (via .subarray(start, end))
     * - ArrayBuffer (via new Uint8Array(buf, start, end - start))
     * - Function (async (start, end) => Uint8Array)
     * - Object with .readRange or .slice
     *
     * @param {*} source - Vault source
     * @param {number} start - 0-based start byte offset
     * @param {number} [end] - 0-based end byte offset (exclusive)
     * @returns {Promise<Uint8Array>}
     */
    async function readRange(source, start, end) {
        if (!source) {
            throw new TypeError('Vault source is null or undefined');
        }

        // 1. Custom function reader: fn(start, end)
        if (typeof source === 'function') {
            const res = await source(start, end);
            return res instanceof Uint8Array ? res : new Uint8Array(res);
        }

        // 2. Object with .readRange method
        if (typeof source.readRange === 'function') {
            const res = await source.readRange(start, end);
            return res instanceof Uint8Array ? res : new Uint8Array(res);
        }

        // 3. Uint8Array
        if (source instanceof Uint8Array) {
            const len = end !== undefined ? Math.min(end, source.byteLength) : source.byteLength;
            return source.subarray(start, len);
        }

        // 4. ArrayBuffer
        if (source instanceof ArrayBuffer) {
            const len = end !== undefined ? Math.min(end, source.byteLength) : source.byteLength;
            return new Uint8Array(source, start, len - start);
        }

        // 5. Blob / File with .slice()
        if (typeof source.slice === 'function') {
            const sliceObj = end !== undefined ? source.slice(start, end) : source.slice(start);
            if (typeof sliceObj.arrayBuffer === 'function') {
                const ab = await sliceObj.arrayBuffer();
                return new Uint8Array(ab);
            }
            if (sliceObj instanceof Uint8Array) {
                return sliceObj;
            }
        }

        // 6. ArrayBufferView
        if (ArrayBuffer.isView(source)) {
            const u8 = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
            const len = end !== undefined ? Math.min(end, u8.byteLength) : u8.byteLength;
            return u8.subarray(start, len);
        }

        throw new TypeError('Unsupported vault source type for byte range reading');
    }

    /**
     * Determines the total size of a vault source if known.
     * @param {*} source
     * @returns {number|null}
     */
    function getSourceTotalSize(source) {
        if (!source) return null;
        if (typeof source.size === 'number') return source.size;
        if (typeof source.byteLength === 'number') return source.byteLength;
        if (source.buffer && typeof source.buffer.byteLength === 'number') return source.byteLength;
        return null;
    }

    // =========================================================================
    // 1. FORMAT SNIFFING & HEADER PARSING
    // =========================================================================

    /**
     * Normalizes initial vault bytes into a Uint8Array.
     */
    async function getInitialBytes(bufferOrSource, minBytes = V3_HEADER_SIZE) {
        if (!bufferOrSource) {
            throw createOperationError('File is too small to be a valid vault');
        }

        if (bufferOrSource instanceof Uint8Array) {
            return bufferOrSource;
        }
        if (bufferOrSource instanceof ArrayBuffer) {
            return new Uint8Array(bufferOrSource);
        }
        if (ArrayBuffer.isView(bufferOrSource)) {
            return new Uint8Array(bufferOrSource.buffer, bufferOrSource.byteOffset, bufferOrSource.byteLength);
        }

        // Stream or File/Blob
        return await readRange(bufferOrSource, 0, minBytes);
    }

    /**
     * Sniffs the initial bytes of a vault to detect its format version (1, 2, or 3).
     *
     * Rules:
     * - Size < 44 bytes: Throws explicit error "File is too small to be a valid vault"
     * - 0x5A 0x56 0x33 0x00 ('ZV3\0'): Returns 3 (v3 streaming vault)
     * - 0x5A 0x56 0x32 0x00 ('ZV2\0'): Returns 2 (v2 standard vault)
     * - Other (size >= 44 bytes): Returns 1 (v1 legacy headerless vault)
     *
     * @param {Uint8Array|ArrayBuffer|Blob|File|Function} bufferOrSource
     * @returns {Promise<number>|number} Format version (1, 2, or 3)
     */
    function detectVaultVersion(bufferOrSource) {
        // Synchronous fast-path for memory buffers
        if (bufferOrSource instanceof Uint8Array || bufferOrSource instanceof ArrayBuffer || ArrayBuffer.isView(bufferOrSource)) {
            const totalSize = bufferOrSource.byteLength;
            if (totalSize < MIN_VAULT_SIZE) {
                throw createOperationError('File is too small to be a valid vault');
            }
            const u8 = bufferOrSource instanceof Uint8Array
                ? bufferOrSource
                : (bufferOrSource instanceof ArrayBuffer
                    ? new Uint8Array(bufferOrSource)
                    : new Uint8Array(bufferOrSource.buffer, bufferOrSource.byteOffset, bufferOrSource.byteLength));

            // Check v3 magic: 0x5A 0x56 0x33 0x00
            if (u8[0] === V3_MAGIC[0] && u8[1] === V3_MAGIC[1] && u8[2] === V3_MAGIC[2] && u8[3] === V3_MAGIC[3]) {
                return 3;
            }
            // Check v2 magic: 0x5A 0x56 0x32 0x00
            if (u8[0] === V2_MAGIC[0] && u8[1] === V2_MAGIC[1] && u8[2] === V2_MAGIC[2] && u8[3] === V2_MAGIC[3]) {
                return 2;
            }
            return 1;
        }

        // Asynchronous path for File/Blob/Function sources
        return (async () => {
            const total = getSourceTotalSize(bufferOrSource);
            if (total !== null && total < MIN_VAULT_SIZE) {
                throw createOperationError('File is too small to be a valid vault');
            }
            const initial = await readRange(bufferOrSource, 0, Math.min(57, total || 57));
            if (initial.byteLength < MIN_VAULT_SIZE) {
                throw createOperationError('File is too small to be a valid vault');
            }
            if (initial[0] === V3_MAGIC[0] && initial[1] === V3_MAGIC[1] && initial[2] === V3_MAGIC[2] && initial[3] === V3_MAGIC[3]) {
                return 3;
            }
            if (initial[0] === V2_MAGIC[0] && initial[1] === V2_MAGIC[1] && initial[2] === V2_MAGIC[2] && initial[3] === V2_MAGIC[3]) {
                return 2;
            }
            return 1;
        })();
    }

    /**
     * Parses the vault header and extracts version-specific metadata.
     *
     * @param {Uint8Array|ArrayBuffer|Blob|File|Function} bufferOrSource
     * @returns {Promise<Object>} Parsed container header
     */
    async function parseVaultHeader(bufferOrSource, options = {}) {
        const opts = options || {};
        if (!bufferOrSource) {
            throw createOperationError('File is too small to be a valid vault');
        }

        const total = getSourceTotalSize(bufferOrSource);
        if (total !== null && total < MIN_VAULT_SIZE) {
            throw createOperationError('File is too small to be a valid vault');
        }

        const initial = await getInitialBytes(bufferOrSource, V3_HEADER_SIZE);
        if (initial.byteLength < MIN_VAULT_SIZE) {
            throw createOperationError('File is too small to be a valid vault');
        }

        // Sniff Magic
        const isV3Magic = initial[0] === V3_MAGIC[0] && initial[1] === V3_MAGIC[1] && initial[2] === V3_MAGIC[2] && initial[3] === V3_MAGIC[3];
        const isV2Magic = initial[0] === V2_MAGIC[0] && initial[1] === V2_MAGIC[1] && initial[2] === V2_MAGIC[2] && initial[3] === V2_MAGIC[3];

        if (isV3Magic) {
            if (initial.byteLength < V3_HEADER_SIZE) {
                throw createOperationError('v3 vault header is incomplete — file may be corrupted');
            }
            const version = initial[4];
            if (version !== V3_VERSION) {
                throw createOperationError(`Unsupported vault version: 0x${version.toString(16)} (expected 0x03)`);
            }
            const flags = initial[5];
            const hasKeyfile = (flags & FLAG_KEYFILE) !== 0;
            const view = new DataView(initial.buffer, initial.byteOffset, initial.byteLength);
            const chunkSize = view.getUint32(6, false);
            const salt = initial.slice(10, 42);
            const baseIVPrefix = initial.slice(42, 49);
            const manifestOffset = view.getBigUint64(49, false);

            if (manifestOffset < 77n) {
                throw createOperationError(`Invalid v3 header: manifestOffset (${manifestOffset}) must be at least 77 bytes`);
            }

            return {
                version: 3,
                magic: 'ZV3\0',
                magicBytes: initial.slice(0, 4),
                flags,
                hasKeyfile,
                chunkSize,
                salt,
                baseIVPrefix,
                manifestOffset,
                headerSize: V3_HEADER_SIZE
            };
        }

        if (isV2Magic) {
            if (initial.byteLength < V2_HEADER_SIZE) {
                throw createOperationError('v2 vault header is incomplete — file may be corrupted');
            }
            const version = initial[4];
            if (version !== V2_VERSION) {
                throw createOperationError(`Unsupported vault version: 0x${version.toString(16)} (expected 0x02)`);
            }
            const flags = initial[5];
            const hasKeyfile = (flags & FLAG_KEYFILE) !== 0;
            const salt = initial.slice(6, 38);
            const iv = initial.slice(38, 50);

            return {
                version: 2,
                magic: 'ZV2\0',
                magicBytes: initial.slice(0, 4),
                flags,
                hasKeyfile,
                salt,
                iv,
                headerSize: V2_HEADER_SIZE
            };
        }

        // Version 1 Legacy Headerless
        const salt = initial.slice(0, 16);
        const iv = initial.slice(16, 28);

        return {
            version: 1,
            magic: null,
            magicBytes: null,
            flags: 0,
            hasKeyfile: false,
            salt,
            iv,
            headerSize: V1_HEADER_SIZE
        };
    }

    /**
     * Checks if buffer is v3 format.
     */
    function isV3Format(bufferOrBytes) {
        try {
            const v = detectVaultVersion(bufferOrBytes);
            return v === 3;
        } catch (_) {
            return false;
        }
    }

    /**
     * Checks if buffer is v2 format.
     */
    function isV2Format(bufferOrBytes) {
        try {
            const v = detectVaultVersion(bufferOrBytes);
            return v === 2;
        } catch (_) {
            return false;
        }
    }

    /**
     * Checks if buffer is v1 format.
     */
    function isV1Format(bufferOrBytes) {
        try {
            const v = detectVaultVersion(bufferOrBytes);
            return v === 1;
        } catch (_) {
            return false;
        }
    }

    // =========================================================================
    // 2. BACKWARD-COMPATIBLE DECRYPTORS (v1 & v2)
    // =========================================================================

    /**
     * Decrypts a legacy v1 vault container:
     * - Layout: [Salt (16B) | IV (12B) | Ciphertext + GCM Tag (16B)]
     * - Key Derivation: PBKDF2-SHA256, 100,000 iterations, 16-byte salt
     * - Cipher: AES-256-GCM
     *
     * @param {Uint8Array|ArrayBuffer} bufferOrBytes - Vault bytes
     * @param {string} password - Master password
     * @param {Object} [options={}] - Optional configuration (e.g. iterations override)
     * @returns {Promise<Uint8Array>} Decrypted plaintext bytes
     */
    async function decryptV1Vault(bufferOrBytes, password, options = {}) {
        const opts = options || {};
        if (typeof password !== 'string') {
            throw new TypeError('Password must be a string');
        }
        if (!bufferOrBytes) {
            throw createOperationError('File is too small to be a valid vault');
        }

        const u8 = bufferOrBytes instanceof Uint8Array
            ? bufferOrBytes
            : (bufferOrBytes instanceof ArrayBuffer
                ? new Uint8Array(bufferOrBytes)
                : new Uint8Array(bufferOrBytes.buffer, bufferOrBytes.byteOffset, bufferOrBytes.byteLength));

        if (u8.byteLength < MIN_VAULT_SIZE) {
            throw createOperationError('File is too small to be a valid vault');
        }

        const salt = u8.subarray(0, 16);
        const iv = u8.subarray(16, 28);
        const ciphertextWithTag = u8.subarray(28);

        const subtle = getSubtleCrypto();
        const enc = new TextEncoder();
        const keyMaterial = await subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        const iterations = opts.iterations || 100000;
        const key = await subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        try {
            const decryptedBuf = await subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    tagLength: 128
                },
                key,
                ciphertextWithTag
            );
            return new Uint8Array(decryptedBuf);
        } catch (err) {
            throw createOperationError('v1 decryption failed: incorrect password or corrupted vault data');
        }
    }

    /**
     * Decrypts a standard v2 vault container:
     * - Layout: [Magic 'ZV2\0' (4B) | Version 0x02 (1B) | Flags (1B) | Salt (32B) | IV (12B) | Ciphertext + GCM Tag]
     * - Key Derivation: PBKDF2-SHA512, 600,000 iterations, 32-byte salt, with optional SHA-256 keyfile XOR
     * - Cipher: AES-256-GCM
     *
     * @param {Uint8Array|ArrayBuffer} bufferOrBytes - Vault bytes
     * @param {string} password - Master password
     * @param {Uint8Array|ArrayBuffer|null} [keyfileBytes=null] - Optional keyfile bytes for 2FA
     * @param {Object} [options={}] - Optional configuration (e.g. iterations override)
     * @returns {Promise<Uint8Array>} Decrypted plaintext bytes
     */
    async function decryptV2Vault(bufferOrBytes, password, keyfileBytes = null, options = {}) {
        const opts = options || {};
        if (typeof password !== 'string') {
            throw new TypeError('Password must be a string');
        }
        if (!bufferOrBytes) {
            throw createOperationError('File is too small to be a valid vault');
        }

        const u8 = bufferOrBytes instanceof Uint8Array
            ? bufferOrBytes
            : (bufferOrBytes instanceof ArrayBuffer
                ? new Uint8Array(bufferOrBytes)
                : new Uint8Array(bufferOrBytes.buffer, bufferOrBytes.byteOffset, bufferOrBytes.byteLength));

        if (u8.byteLength < V2_HEADER_SIZE + TAG_LENGTH) {
            throw createOperationError('File is too small to be a valid vault');
        }

        // Validate v2 magic & version
        if (u8[0] !== V2_MAGIC[0] || u8[1] !== V2_MAGIC[1] || u8[2] !== V2_MAGIC[2] || u8[3] !== V2_MAGIC[3]) {
            throw createOperationError('Invalid v2 vault: magic identifier does not match ZV2\\0');
        }
        if (u8[4] !== V2_VERSION) {
            throw createOperationError(`Invalid v2 vault version: 0x${u8[4].toString(16)} (expected 0x02)`);
        }

        const flags = u8[5];
        const hasKeyfile = (flags & FLAG_KEYFILE) !== 0;

        if (hasKeyfile && (keyfileBytes === null || keyfileBytes === undefined)) {
            throw createOperationError('This v2 vault was encrypted with a keyfile. Please provide the keyfile.');
        }

        const salt = u8.subarray(6, 38);
        const iv = u8.subarray(38, 50);
        const ciphertextWithTag = u8.subarray(50);

        const subtle = getSubtleCrypto();
        const enc = new TextEncoder();
        const keyMaterial = await subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );

        const iterations = opts.iterations || 600000;
        const derivedBits = await subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: iterations,
                hash: 'SHA-512'
            },
            keyMaterial,
            256
        );

        let rawKeyBytes = new Uint8Array(derivedBits);

        // Keyfile 2FA XOR Mixing
        if (keyfileBytes !== null && keyfileBytes !== undefined) {
            const kBuf = keyfileBytes instanceof Uint8Array ? keyfileBytes : new Uint8Array(keyfileBytes);
            let kHash;
            if (opts.alreadyHashed && kBuf.byteLength === 32) {
                kHash = kBuf;
            } else {
                const digestBuf = await subtle.digest('SHA-256', kBuf);
                kHash = new Uint8Array(digestBuf);
            }
            rawKeyBytes = xorBytes(rawKeyBytes, kHash);
        }

        const key = await subtle.importKey(
            'raw',
            rawKeyBytes,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        try {
            const decryptedBuf = await subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    tagLength: 128
                },
                key,
                ciphertextWithTag
            );
            return new Uint8Array(decryptedBuf);
        } catch (err) {
            throw createOperationError('v2 decryption failed: incorrect password, wrong keyfile, or corrupted vault data');
        }
    }

    // =========================================================================
    // 3. v3 ENCRYPTED MANIFEST READER & INSTANT BROWSING
    // =========================================================================

    /**
     * Decrypts and parses a standalone encrypted manifest envelope.
     * Envelope layout: [Salt (32B) || IV (12B) || Length (4B uint32 BE) || Ciphertext + Tag (16B)]
     *
     * @param {Uint8Array} envelopeBytes - Manifest envelope byte buffer
     * @param {CryptoKey} key - Master AES-GCM CryptoKey
     * @returns {Promise<Object>} Parsed catalog JSON
     */
    async function parseManifestEnvelope(envelopeBytes, key) {
        if (!key) {
            throw new TypeError('CryptoKey is required to decrypt manifest');
        }
        if (!envelopeBytes || envelopeBytes.byteLength < MANIFEST_HEADER_SIZE + TAG_LENGTH) {
            throw createOperationError('Invalid manifest envelope: buffer too small for header and auth tag');
        }

        const env = envelopeBytes instanceof Uint8Array
            ? envelopeBytes
            : new Uint8Array(envelopeBytes);

        const iv = env.subarray(MANIFEST_SALT_LENGTH, MANIFEST_SALT_LENGTH + MANIFEST_IV_LENGTH);
        const view = new DataView(env.buffer, env.byteOffset, env.byteLength);
        const declaredLen = view.getUint32(MANIFEST_SALT_LENGTH + MANIFEST_IV_LENGTH, false);
        const ctWithTag = env.subarray(MANIFEST_HEADER_SIZE);

        if (ctWithTag.byteLength !== declaredLen + TAG_LENGTH) {
            throw createOperationError(`Invalid manifest envelope: declared length ${declaredLen} does not match ciphertext size ${ctWithTag.byteLength - TAG_LENGTH}`);
        }

        const subtle = getSubtleCrypto();
        let decryptedBuf;
        try {
            decryptedBuf = await subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    tagLength: 128
                },
                key,
                ctWithTag
            );
        } catch (err) {
            throw createOperationError('Manifest decryption failed: invalid password, wrong keyfile, or corrupted envelope');
        }

        const jsonStr = new TextDecoder().decode(decryptedBuf);
        return JSON.parse(jsonStr);
    }

    /**
     * Normalizes a file entry from the catalog for uniform properties.
     */
    function normalizeCatalogEntry(entry, defaultChunkSize = DEFAULT_CHUNK_SIZE) {
        const path = entry.path || entry.name || 'unnamed';
        const uncompressedSize = entry.size !== undefined ? entry.size : (entry.uncompressedSize !== undefined ? entry.uncompressedSize : 0);
        const compressedSize = entry.compressedSize !== undefined ? entry.compressedSize : uncompressedSize;
        const localHeaderOffset = entry.localHeaderOffset !== undefined ? entry.localHeaderOffset : (entry.offset !== undefined ? entry.offset : 0);
        const compressed = entry.compressed !== undefined ? entry.compressed : (entry.compressionMethod === 8);

        // Approximate header overhead (~30B local header + filename bytes)
        const headerLen = 30 + new TextEncoder().encode(path).length;
        const totalFileSpan = BigInt(localHeaderOffset) + BigInt(headerLen) + BigInt(compressedSize);

        const chunkStart = entry.chunkStart !== undefined
            ? entry.chunkStart
            : Math.floor(Number(BigInt(localHeaderOffset) / BigInt(defaultChunkSize)));

        const chunkEnd = entry.chunkEnd !== undefined
            ? entry.chunkEnd
            : Math.floor(Number(totalFileSpan / BigInt(defaultChunkSize)));

        return {
            path: path,
            name: path,
            size: uncompressedSize,
            uncompressedSize: uncompressedSize,
            compressedSize: compressedSize,
            offset: localHeaderOffset,
            localHeaderOffset: localHeaderOffset,
            compressed: !!compressed,
            compressionMethod: compressed ? 8 : 0,
            chunkStart: chunkStart,
            chunkEnd: Math.max(chunkStart, chunkEnd),
            crc32: entry.crc32 !== undefined ? (entry.crc32 >>> 0) : undefined,
            lastModified: entry.lastModified
        };
    }

    /**
     * Reads and decrypts the encrypted manifest trailer from a v3 vault in < 100 ms with < 15 MB RAM.
     * Slices only the trailer slice (file.slice(manifestOffset)), derives master key, and decrypts.
     *
     * Returns structured catalog:
     * {
     *   version: 3,
     *   totalSize: number,
     *   fileCount: number,
     *   files: Array<{ path, size, offset, compressed, chunkStart, chunkEnd, crc32 }>
     * }
     *
     * @param {*} vaultSource - Vault File, Blob, Uint8Array, ArrayBuffer, or reader function
     * @param {string|CryptoKey} passwordOrKey - Master password or derived CryptoKey
     * @param {Uint8Array|ArrayBuffer|ArrayBufferView|Object|null} [keyfileBytesOrOptions=null] - Positional keyfile bytes or options bag
     * @param {Object} [maybeOptions={}] - Optional configuration (e.g. iterations override)
     * @returns {Promise<Object>} Structured catalog
     */
    async function readVaultManifest(vaultSource, passwordOrKey, keyfileBytesOrOptions = null, maybeOptions = {}) {
        let keyfileBytes = null;
        let opts = {};

        if (keyfileBytesOrOptions === null || keyfileBytesOrOptions === undefined) {
            opts = maybeOptions || {};
            keyfileBytes = opts.keyfileBytes || null;
        } else if (ArrayBuffer.isView(keyfileBytesOrOptions)) {
            keyfileBytes = new Uint8Array(
                keyfileBytesOrOptions.buffer,
                keyfileBytesOrOptions.byteOffset,
                keyfileBytesOrOptions.byteLength
            );
            opts = maybeOptions || {};
        } else if (keyfileBytesOrOptions instanceof ArrayBuffer) {
            keyfileBytes = new Uint8Array(keyfileBytesOrOptions);
            opts = maybeOptions || {};
        } else if (typeof keyfileBytesOrOptions === 'object') {
            opts = keyfileBytesOrOptions || {};
            keyfileBytes = opts.keyfileBytes || null;
        } else {
            opts = maybeOptions || {};
            keyfileBytes = opts.keyfileBytes || null;
        }
        opts = opts || {};

        if (!vaultSource) {
            throw createOperationError('File is too small to be a valid vault');
        }

        // 1. Read and parse 57-byte container header
        const headerBytes = await readRange(vaultSource, 0, V3_HEADER_SIZE);
        const header = await parseVaultHeader(headerBytes, opts);

        if (header.version !== 3) {
            throw createOperationError(`Manifest reading is only supported for v3 streaming vaults (found v${header.version})`);
        }

        if (header.manifestOffset <= 0n) {
            throw createOperationError('Vault does not contain a valid manifest offset');
        }

        if (header.hasKeyfile && !keyfileBytes && !(passwordOrKey instanceof CryptoKey)) {
            throw createOperationError('This v3 vault was encrypted with a keyfile. Please provide the keyfile.');
        }

        // 2. Resolve Master CryptoKey
        let masterKey;
        if (passwordOrKey && typeof passwordOrKey === 'object' && passwordOrKey.algorithm) {
            masterKey = passwordOrKey;
        } else if (typeof passwordOrKey === 'string') {
            const StreamCrypto = getStreamCrypto();
            masterKey = await StreamCrypto.deriveMasterKey(
                passwordOrKey,
                header.salt,
                opts.iterations || 600000,
                keyfileBytes
            );
        } else {
            throw new TypeError('passwordOrKey must be a string password or AES-GCM CryptoKey');
        }

        // 3. Slice and read manifest envelope from vault trailer
        const manifestStart = Number(header.manifestOffset);
        const totalVaultSize = getSourceTotalSize(vaultSource);
        const manifestEnd = totalVaultSize !== null ? totalVaultSize : undefined;

        const envelopeBytes = await readRange(vaultSource, manifestStart, manifestEnd);
        if (envelopeBytes.byteLength < MANIFEST_HEADER_SIZE + TAG_LENGTH) {
            throw createOperationError('Manifest envelope at trailer is truncated or missing');
        }

        // 4. Decrypt and parse JSON catalog
        const parsedRaw = await parseManifestEnvelope(envelopeBytes, masterKey);

        // 5. Build structured catalog
        let filesArray = [];
        let totalSize = 0;
        let fileCount = 0;

        if (Array.isArray(parsedRaw)) {
            filesArray = parsedRaw.map(f => normalizeCatalogEntry(f, header.chunkSize));
            totalSize = filesArray.reduce((acc, f) => acc + (f.size || 0), 0);
            fileCount = filesArray.length;
        } else if (parsedRaw && typeof parsedRaw === 'object') {
            const rawFiles = Array.isArray(parsedRaw.files) ? parsedRaw.files : [];
            filesArray = rawFiles.map(f => normalizeCatalogEntry(f, header.chunkSize));
            fileCount = parsedRaw.fileCount !== undefined ? parsedRaw.fileCount : filesArray.length;
            totalSize = parsedRaw.totalSize !== undefined ? parsedRaw.totalSize : filesArray.reduce((acc, f) => acc + (f.size || 0), 0);
        }

        return {
            version: 3,
            totalSize,
            fileCount,
            files: filesArray,
            header
        };
    }

    // =========================================================================
    // 4. SELECTIVE SINGLE-FILE EXTRACTION
    // =========================================================================

    /**
     * Extracts a single file selectively on-demand:
     * - Reads only chunks [chunkStart, chunkEnd] from the vault file using byte range slicing.
     * - Decrypts only those chunks via StreamCrypto.decryptChunk.
     * - Slices out exact file bytes from decrypted chunk span.
     * - Decompresses via native DecompressionStream('deflate-raw') if compressed.
     * - Verifies CRC-32 against manifest entry.
     * - Zero buffering of the rest of the multi-gigabyte vault!
     *
     * @param {*} vaultSource - Vault File, Blob, Uint8Array, ArrayBuffer, or reader function
     * @param {string|CryptoKey} passwordOrKey - Master password or derived CryptoKey
     * @param {Object} targetEntry - Manifest file entry { path, size, offset, compressed, chunkStart, chunkEnd, crc32 }
     * @param {Object} [options={}] - Optional configuration (manifest, chunkCache, iterations, keyfileBytes)
     * @returns {Promise<Uint8Array>} Exact uncompressed original file bytes
     */
    async function extractSingleFile(vaultSource, passwordOrKey, targetEntry, options = {}) {
        const opts = options || {};
        if (!vaultSource) {
            throw createOperationError('Vault source is required');
        }
        // Support both (vaultSource, passwordOrKey, targetEntry, options) and (vaultSource, targetEntry, passwordOrKey, options)
        if (passwordOrKey && typeof passwordOrKey === 'object' && !passwordOrKey.algorithm && typeof passwordOrKey.path === 'string') {
            const tmp = passwordOrKey;
            passwordOrKey = targetEntry;
            targetEntry = tmp;
        }
        if (!targetEntry) {
            throw new TypeError('targetEntry descriptor is required');
        }

        const StreamCrypto = getStreamCrypto();

        // If targetEntry is a string filename and manifest is provided in options, find it
        let entry = targetEntry;
        if (typeof entry === 'string') {
            if (opts.manifest && Array.isArray(opts.manifest.files)) {
                const found = opts.manifest.files.find(f => f.path === entry || f.name === entry);
                if (!found) {
                    throw createOperationError(`File "${entry}" not found in manifest`);
                }
                entry = found;
            } else {
                throw new TypeError('targetEntry is a string path, but options.manifest was not provided');
            }
        }

        // 1. Read vault container header (57 bytes)
        const headerBytes = await readRange(vaultSource, 0, V3_HEADER_SIZE);
        const header = await parseVaultHeader(headerBytes, opts);

        if (header.version !== 3) {
            throw createOperationError(`Selective extraction is only supported for v3 streaming vaults (found v${header.version})`);
        }

        // 2. Resolve Master CryptoKey
        let masterKey;
        if (passwordOrKey && typeof passwordOrKey === 'object' && passwordOrKey.algorithm) {
            masterKey = passwordOrKey;
        } else if (typeof passwordOrKey === 'string') {
            masterKey = await StreamCrypto.deriveMasterKey(
                passwordOrKey,
                header.salt,
                opts.iterations || 600000,
                opts.keyfileBytes
            );
        } else {
            throw new TypeError('passwordOrKey must be a string password or AES-GCM CryptoKey');
        }

        // 3. Compute chunk span & vault offsets
        const chunkSize = header.chunkSize || DEFAULT_CHUNK_SIZE;
        const manifestOffset = header.manifestOffset;
        const totalFramedChunkSize = chunkSize + CHUNK_FRAME_OVERHEAD; // 4MB + 20B

        // Determine final chunk index
        // All full chunks are (chunkSize + 20) bytes. The trailer starts at manifestOffset.
        const lastChunkIndex = Number((manifestOffset - 58n) / BigInt(totalFramedChunkSize));

        // Determine target chunk span
        const normalized = normalizeCatalogEntry(entry, chunkSize);
        const chunkStart = Math.max(0, normalized.chunkStart);
        const chunkEnd = Math.min(lastChunkIndex, Math.max(chunkStart, normalized.chunkEnd));

        const chunkCache = opts.chunkCache || null;

        // 4. Read and decrypt chunks [chunkStart, chunkEnd]
        const decryptedChunks = [];

        for (let i = chunkStart; i <= chunkEnd; i++) {
            // Check cache if available
            if (chunkCache && chunkCache.has(i)) {
                decryptedChunks.push(chunkCache.get(i));
                continue;
            }

            const isLast = (i === lastChunkIndex);
            const chunkVaultStart = V3_HEADER_SIZE + i * totalFramedChunkSize;

            let chunkVaultEnd;
            if (isLast) {
                chunkVaultEnd = Number(manifestOffset);
            } else {
                chunkVaultEnd = chunkVaultStart + totalFramedChunkSize;
            }

            const chunkFramedBytes = await readRange(vaultSource, chunkVaultStart, chunkVaultEnd);
            const plainChunk = await StreamCrypto.decryptChunk(
                masterKey,
                chunkFramedBytes,
                header.baseIVPrefix,
                i,
                isLast,
                header.salt
            );

            if (chunkCache) {
                chunkCache.set(i, plainChunk);
            }
            decryptedChunks.push(plainChunk);
        }

        // 5. Concatenate decrypted chunk span
        let spanBytes;
        if (decryptedChunks.length === 1) {
            spanBytes = decryptedChunks[0];
        } else {
            let totalSpanLen = 0;
            for (const c of decryptedChunks) totalSpanLen += c.byteLength;
            spanBytes = new Uint8Array(totalSpanLen);
            let offset = 0;
            for (const c of decryptedChunks) {
                spanBytes.set(c, offset);
                offset += c.byteLength;
            }
        }

        // 6. Locate file payload in span
        const spanBasePlaintextOffset = BigInt(chunkStart) * BigInt(chunkSize);
        const targetLocalHeaderOffset = BigInt(normalized.localHeaderOffset);
        const relPos = Number(targetLocalHeaderOffset - spanBasePlaintextOffset);

        let payloadStart = relPos;
        let payloadLength = normalized.compressedSize;

        // Inspect ZIP Local File Header if present at relPos
        if (relPos >= 0 && relPos + 30 <= spanBytes.byteLength) {
            const view = new DataView(spanBytes.buffer, spanBytes.byteOffset, spanBytes.byteLength);
            const sig = view.getUint32(relPos, true);
            if (sig === ZIP_SIGNATURES.LOCAL_FILE_HEADER) {
                const nameLen = view.getUint16(relPos + 26, true);
                const extraLen = view.getUint16(relPos + 28, true);
                payloadStart = relPos + 30 + nameLen + extraLen;
            }
        }

        if (payloadStart < 0 || payloadStart > spanBytes.byteLength) {
            throw createOperationError(`Invalid file payload position in decrypted chunk span for "${normalized.path}"`);
        }

        // Extract payload bytes
        const payloadEnd = Math.min(spanBytes.byteLength, payloadStart + payloadLength);
        const rawPayload = spanBytes.subarray(payloadStart, payloadEnd);

        // 7. Decompress if compressed
        let extractedBytes;
        if (normalized.compressed && rawPayload.byteLength > 0) {
            extractedBytes = await decompressDeflateRaw(rawPayload);
        } else {
            extractedBytes = rawPayload;
        }

        // 8. CRC-32 verification
        if (normalized.crc32 !== undefined && normalized.crc32 !== null) {
            const computedCrc = crc32(extractedBytes);
            if ((computedCrc >>> 0) !== (normalized.crc32 >>> 0)) {
                throw createOperationError(
                    `CRC-32 checksum mismatch for "${normalized.path}": expected 0x${(normalized.crc32 >>> 0).toString(16).padStart(8, '0')}, calculated 0x${(computedCrc >>> 0).toString(16).padStart(8, '0')}`
                );
            }
        }

        try {
            Object.defineProperty(extractedBytes, 'data', {
                value: extractedBytes,
                enumerable: false,
                configurable: true
            });
        } catch (_) {}

        return extractedBytes;
    }

    /**
     * Selectively extracts multiple files from a vault, sharing decrypted chunk cache
     * so overlapping files in the same chunk are decrypted only once.
     *
     * @param {*} vaultSource - Vault source
     * @param {string|CryptoKey} passwordOrKey - Master password or CryptoKey
     * @param {Array<Object>} targetEntries - Array of manifest entries
     * @param {Object} [options={}]
     * @returns {Promise<Array<{ entry: Object, path: string, data: Uint8Array }>>}
     */
    async function extractMultipleFiles(vaultSource, passwordOrKey, targetEntries, options = {}) {
        const opts = options || {};
        if (!Array.isArray(targetEntries)) {
            throw new TypeError('targetEntries must be an Array');
        }

        const chunkCache = opts.chunkCache || new Map();
        const results = [];

        for (const entry of targetEntries) {
            const data = await extractSingleFile(vaultSource, passwordOrKey, entry, {
                ...opts,
                chunkCache
            });
            results.push({
                entry,
                path: entry.path || entry.name,
                data
            });
        }

        return results;
    }

    // =========================================================================
    // 5. FULL STREAMING VAULT DECRYPTION (createStreamingVaultDecryptor)
    // =========================================================================

    /**
     * Creates a ReadableStream<Uint8Array> that decrypts a v3 streaming vault on the fly:
     * - Reads incoming vault stream
     * - Skips and parses 57-byte container header
     * - Pipes ciphertext chunks through StreamCrypto.createChunkDecryptorStream
     * - Discards encrypted manifest trailer so only original ZIP64 payload is emitted
     * - Streams decrypted ZIP64 payload chunk-by-chunk to an output consumer without buffering in memory
     *
     * @param {ReadableStream<Uint8Array>|File|Blob} vaultStream - Encrypted vault stream or source
     * @param {string|CryptoKey} passwordOrKey - Master password or AES-GCM CryptoKey
     * @param {Object} [options={}] - Optional configuration (iterations, keyfileBytes, onHeader)
     * @returns {ReadableStream<Uint8Array>} Decrypted ZIP64 payload stream
     */
    function createStreamingVaultDecryptor(vaultStream, passwordOrKey, options = {}) {
        if (!vaultStream) {
            throw new TypeError('vaultStream is required');
        }

        const opts = options || {};
        const StreamCrypto = getStreamCrypto();

        let sourceStream = vaultStream;
        if (typeof sourceStream.stream === 'function') {
            sourceStream = sourceStream.stream();
        }

        if (!sourceStream || typeof sourceStream.getReader !== 'function') {
            throw new TypeError('vaultStream must be a ReadableStream or object with .stream()');
        }

        let decryptorReader = null;
        let sourceReader = null;
        let pumpPromise = null;

        async function startPumping() {
            const reader = sourceStream.getReader();
            sourceReader = reader;
            let headerAccumulator = new Uint8Array(0);

            // 1. Read first 57 bytes for container header
            while (headerAccumulator.byteLength < V3_HEADER_SIZE) {
                const { done, value } = await reader.read();
                if (done) {
                    throw createOperationError('File is too small to be a valid vault');
                }
                if (value && value.byteLength > 0) {
                    headerAccumulator = concatBuffers(headerAccumulator, value);
                }
            }

            const headerBytes = headerAccumulator.subarray(0, V3_HEADER_SIZE);
            const initialCiphertext = headerAccumulator.subarray(V3_HEADER_SIZE);

            const header = await parseVaultHeader(headerBytes, opts);
            if (header.version !== 3) {
                throw createOperationError(`Streaming decryptor requires v3 vault container, got v${header.version}`);
            }

            if (header.hasKeyfile && !opts.keyfileBytes && !(passwordOrKey instanceof CryptoKey)) {
                throw createOperationError('This v3 vault was encrypted with a keyfile. Please provide the keyfile.');
            }

            // 2. Derive master key if string password provided
            let masterKey;
            if (passwordOrKey && typeof passwordOrKey === 'object' && passwordOrKey.algorithm) {
                masterKey = passwordOrKey;
            } else if (typeof passwordOrKey === 'string') {
                masterKey = await StreamCrypto.deriveMasterKey(
                    passwordOrKey,
                    header.salt,
                    opts.iterations || 600000,
                    opts.keyfileBytes
                );
            } else {
                throw new TypeError('passwordOrKey must be a string password or AES-GCM CryptoKey');
            }

            if (typeof opts.onHeader === 'function') {
                opts.onHeader(header);
            }

            // 3. Create Chunk Decryptor TransformStream
            const decryptorTransform = StreamCrypto.createChunkDecryptorStream(
                masterKey,
                header.baseIVPrefix,
                header.salt,
                header.chunkSize
            );

            decryptorReader = decryptorTransform.readable.getReader();
            const writer = decryptorTransform.writable.getWriter();

            // Total ciphertext bytes before manifest trailer:
            const maxCiphertextBytes = header.manifestOffset > BigInt(V3_HEADER_SIZE)
                ? (header.manifestOffset - BigInt(V3_HEADER_SIZE))
                : -1n;

            let sentBytes = 0n;

            // 4. Background Pumping Task with Backpressure
            (async () => {
                try {
                    // Send leftover initial ciphertext if any
                    if (initialCiphertext.byteLength > 0) {
                        let toSend = initialCiphertext;
                        if (maxCiphertextBytes >= 0n) {
                            const rem = maxCiphertextBytes - sentBytes;
                            if (BigInt(toSend.byteLength) > rem) {
                                toSend = toSend.subarray(0, Number(rem));
                            }
                        }
                        if (toSend.byteLength > 0) {
                            sentBytes += BigInt(toSend.byteLength);
                            await writer.write(toSend);
                        }
                    }

                    // Pump remaining stream until stream end or trailer start
                    while (maxCiphertextBytes < 0n || sentBytes < maxCiphertextBytes) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value && value.byteLength > 0) {
                            let toSend = value;
                            if (maxCiphertextBytes >= 0n) {
                                const rem = maxCiphertextBytes - sentBytes;
                                if (BigInt(toSend.byteLength) > rem) {
                                    toSend = toSend.subarray(0, Number(rem));
                                }
                            }
                            if (toSend.byteLength > 0) {
                                sentBytes += BigInt(toSend.byteLength);
                                await writer.write(toSend);
                            }
                            if (maxCiphertextBytes >= 0n && sentBytes >= maxCiphertextBytes) {
                                break;
                            }
                        }
                    }

                    await writer.close();
                } catch (pumpErr) {
                    await writer.abort(pumpErr).catch(() => {});
                    await reader.cancel(pumpErr).catch(() => {});
                } finally {
                    try {
                        reader.releaseLock();
                    } catch (_) {}
                }
            })();
        }

        pumpPromise = startPumping();

        return new ReadableStream({
            async pull(controller) {
                try {
                    await pumpPromise;
                    const { done, value } = await decryptorReader.read();
                    if (done) {
                        controller.close();
                    } else {
                        controller.enqueue(value);
                    }
                } catch (err) {
                    controller.error(err);
                }
            },

            async cancel(reason) {
                if (decryptorReader) {
                    await decryptorReader.cancel(reason).catch(() => {});
                }
                if (sourceReader) {
                    await sourceReader.cancel(reason).catch(() => {});
                }
            }
        });
    }

    // =========================================================================
    // 6. UNIFIED ROUTE SELECTOR (decryptVault)
    // =========================================================================

    /**
     * Unified automatic route selector:
     * - Detects format version (v1, v2, or v3)
     * - Routes to decryptV1Vault, decryptV2Vault, or streaming v3 decryptor
     * - Returns decrypted archive bytes
     *
     * @param {*} vaultSource - Vault buffer, Uint8Array, or File
     * @param {string} password - Master password
     * @param {Object} [options={}] - Optional configuration
     * @returns {Promise<Uint8Array>}
     */
    async function decryptVault(vaultSource, password, options = {}) {
        const opts = options || {};
        const version = await detectVaultVersion(vaultSource);

        if (version === 1) {
            const bytes = await readRange(vaultSource, 0, undefined);
            return await decryptV1Vault(bytes, password, opts);
        }

        if (version === 2) {
            const bytes = await readRange(vaultSource, 0, undefined);
            return await decryptV2Vault(bytes, password, opts.keyfileBytes, opts);
        }

        if (version === 3) {
            // If vaultSource is already an in-memory buffer or File, stream-decrypt to Uint8Array
            let stream;
            if (vaultSource && typeof vaultSource.stream === 'function') {
                stream = vaultSource.stream();
            } else {
                const bytes = await readRange(vaultSource, 0, undefined);
                stream = new ReadableStream({
                    start(ctrl) {
                        ctrl.enqueue(bytes);
                        ctrl.close();
                    }
                });
            }

            const decryptStream = createStreamingVaultDecryptor(stream, password, opts);
            const reader = decryptStream.getReader();
            const chunks = [];
            let totalLen = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.byteLength > 0) {
                    chunks.push(value);
                    totalLen += value.byteLength;
                }
            }

            const out = new Uint8Array(totalLen);
            let offset = 0;
            for (const c of chunks) {
                out.set(c, offset);
                offset += c.byteLength;
            }
            return out;
        }

        throw createOperationError(`Unsupported vault format version: ${version}`);
    }

    // =========================================================================
    // EXPORTS
    // =========================================================================

    return {
        // Constants
        V3_MAGIC,
        V2_MAGIC,
        V3_VERSION,
        V2_VERSION,
        V1_VERSION,
        V3_HEADER_SIZE,
        V2_HEADER_SIZE,
        V1_HEADER_SIZE,
        MIN_VAULT_SIZE,
        DEFAULT_CHUNK_SIZE,
        MANIFEST_HEADER_SIZE,

        // CRC-32 & Decompression Primitives
        CRC32,
        crc32,
        decompressDeflateRaw,

        // Format Sniffing & Header Parsing
        detectVaultVersion,
        parseVaultHeader,
        isV3Format,
        isV2Format,
        isV1Format,

        // Backward-Compatible Decryptors
        decryptV1Vault,
        decryptV2Vault,
        decryptVault,

        // Manifest Reading & Instant Browsing
        parseManifestEnvelope,
        readVaultManifest,

        // Selective Extraction
        extractSingleFile,
        extractMultipleFiles,

        // Full Streaming Decryption
        createStreamingVaultDecryptor,

        // Range Reader Utility
        readRange
    };
}));
