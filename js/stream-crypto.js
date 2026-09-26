/**
 * ZevSafe v3 STREAM AEAD Cryptographic Engine
 *
 * Implements low-memory streaming encryption and decryption conforming to
 * the v3 STREAM AEAD container specification:
 * - PBKDF2-SHA512 key derivation with 600,000 iterations & optional SHA-256 keyfile XOR
 * - Per-chunk 12-byte counter-progressing IVs
 * - Per-chunk 42-byte Associated Authenticated Data (AAD) container-binding headers
 * - Framing: [Length (4B uint32 BE) || Ciphertext (N bytes) || Tag (16B)]
 * - Web Streams API TransformStreams (createChunkEncryptorStream, createChunkDecryptorStream)
 * - Strict authentication verification with immediate OperationError on tamper
 */

(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        const exports = factory();
        root.StreamCrypto = exports;
        if (typeof globalThis !== 'undefined') {
            globalThis.StreamCrypto = exports;
        }
    }
}(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    // =========================================================================
    // CONSTANTS & FORMAT SPECIFICATION
    // =========================================================================

    /** 4-byte magic identifier for ZevSafe v3 vaults: 'ZV3\0' */
    const V3_MAGIC = new Uint8Array([0x5A, 0x56, 0x33, 0x00]);

    /** Format version 3 */
    const V3_VERSION = 0x03;

    /** Total size of v3 container header in bytes */
    const V3_HEADER_SIZE = 57;

    /** Default chunk payload size (4 MB) */
    const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4,194,304 bytes

    /** Default PBKDF2 iterations for v3 vaults (exceeds OWASP guidelines) */
    const PBKDF2_ITERATIONS = 600000;

    /** Length of cryptographic salt in bytes */
    const SALT_LENGTH = 32;

    /** Length of base IV prefix in bytes */
    const BASE_IV_PREFIX_LENGTH = 7;

    /** Standard AES-GCM IV length in bytes */
    const IV_LENGTH = 12;

    /** Standard AES-GCM authentication tag length in bytes (128 bits) */
    const TAG_LENGTH = 16;

    /** Length of per-chunk Associated Authenticated Data (AAD) in bytes */
    const AAD_LENGTH = 42;

    /** Size of chunk length prefix in bytes (uint32 BE) */
    const CHUNK_HEADER_SIZE = 4;

    /** Header Flag bit 0: Keyfile required */
    const V3_FLAG_KEYFILE = 0x01;

    // Resolve Web Crypto SubtleCrypto implementation
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

    // Resolve crypto.getRandomValues implementation
    function getRandomValues(array) {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            return crypto.getRandomValues(array);
        }
        if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
            return globalThis.crypto.getRandomValues(array);
        }
        if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
            return window.crypto.getRandomValues(array);
        }
        throw new Error('Web Crypto getRandomValues is not available in this environment');
    }

    // Resolve DOMException or fallback
    function createOperationError(message) {
        if (typeof DOMException !== 'undefined') {
            return new DOMException(message, 'OperationError');
        }
        const err = new Error(message);
        err.name = 'OperationError';
        return err;
    }

    // =========================================================================
    // KEY DERIVATION & CRYPTOGRAPHIC PRIMITIVES
    // =========================================================================

    /**
     * Derives a 256-bit AES-GCM CryptoKey using PBKDF2-SHA512.
     * Optionally mixes SHA-256(keyfileBytes) via bitwise XOR into raw key material.
     *
     * @param {string} password - Master password
     * @param {Uint8Array} salt - 32-byte cryptographically random salt
     * @param {number} [iterations=600000] - PBKDF2 iteration count
     * @param {Uint8Array|ArrayBuffer|null} [keyfileBytes=null] - Optional keyfile bytes for 2FA
     * @returns {Promise<CryptoKey>} Non-extractable AES-GCM-256 CryptoKey
     */
    async function deriveMasterKey(password, salt, iterations = PBKDF2_ITERATIONS, keyfileBytes = null) {
        if (typeof password !== 'string') {
            throw new TypeError('Password must be a string');
        }
        if (!salt || salt.byteLength < SALT_LENGTH) {
            throw new TypeError(`Salt must be at least ${SALT_LENGTH} bytes`);
        }

        const subtle = getSubtleCrypto();
        const enc = new TextEncoder();
        const passwordBytes = enc.encode(password);

        // Import master password as PBKDF2 base key material
        const keyMaterial = await subtle.importKey(
            'raw',
            passwordBytes,
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );

        // Derive 256 bits (32 bytes) raw key material using PBKDF2-SHA512
        const derivedBits = await subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: salt instanceof Uint8Array ? salt : new Uint8Array(salt),
                iterations: iterations,
                hash: 'SHA-512'
            },
            keyMaterial,
            256
        );

        let rawKeyBytes = new Uint8Array(derivedBits);

        // Optional 2FA Keyfile XOR mixing
        if (keyfileBytes !== null && keyfileBytes !== undefined) {
            const keyfileBuf = keyfileBytes instanceof Uint8Array
                ? keyfileBytes
                : new Uint8Array(keyfileBytes);

            const hashBuffer = await subtle.digest('SHA-256', keyfileBuf);
            const keyfileHash = new Uint8Array(hashBuffer);

            const mixedKey = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                mixedKey[i] = rawKeyBytes[i] ^ keyfileHash[i];
            }
            rawKeyBytes = mixedKey;
        }

        // Import as non-extractable 256-bit AES-GCM CryptoKey
        return await subtle.importKey(
            'raw',
            rawKeyBytes,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Computes the 12-byte IV for a specific chunk.
     * Layout: [7-byte Vault Prefix || 4-byte Big-Endian Chunk Counter || 1-byte is_last Flag]
     *
     * @param {Uint8Array} baseIVPrefix - 7-byte base IV prefix from container header
     * @param {number} chunkIndex - 32-bit chunk counter (0, 1, 2, ...)
     * @param {boolean} isLast - Whether this is the final chunk in the stream
     * @returns {Uint8Array} 12-byte AES-GCM IV
     */
    function computeChunkIV(baseIVPrefix, chunkIndex, isLast) {
        if (!baseIVPrefix || baseIVPrefix.byteLength < BASE_IV_PREFIX_LENGTH) {
            throw new TypeError(`baseIVPrefix must be at least ${BASE_IV_PREFIX_LENGTH} bytes`);
        }
        if (typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 0xFFFFFFFF) {
            throw new RangeError('chunkIndex must be an unsigned 32-bit integer');
        }

        const iv = new Uint8Array(IV_LENGTH);
        const prefixBytes = baseIVPrefix instanceof Uint8Array
            ? baseIVPrefix.subarray(0, BASE_IV_PREFIX_LENGTH)
            : new Uint8Array(baseIVPrefix, 0, BASE_IV_PREFIX_LENGTH);

        iv.set(prefixBytes, 0);

        const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
        view.setUint32(7, chunkIndex >>> 0, false); // Big-endian 32-bit index
        iv[11] = isLast ? 0x01 : 0x00;

        return iv;
    }

    /**
     * Computes the 42-byte Associated Authenticated Data (AAD) bound to the chunk.
     * Layout: [Magic 'ZV3\0' (4B) || Version (1B) || Salt (32B) || BigEndian32(chunkIndex) (4B) || is_last Flag (1B)]
     *
     * @param {Uint8Array|string} magic - 4-byte container magic
     * @param {number} version - 1-byte format version (0x03)
     * @param {Uint8Array} salt - 32-byte vault salt
     * @param {number} chunkIndex - 32-bit chunk counter
     * @param {boolean} isLast - Whether this is the final chunk
     * @returns {Uint8Array} 42-byte AAD
     */
    function computeChunkAAD(magic, version, salt, chunkIndex, isLast) {
        if (!salt || salt.byteLength < SALT_LENGTH) {
            throw new TypeError(`salt must be at least ${SALT_LENGTH} bytes`);
        }
        if (typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 0xFFFFFFFF) {
            throw new RangeError('chunkIndex must be an unsigned 32-bit integer');
        }

        let magicBytes;
        if (!magic) {
            magicBytes = V3_MAGIC;
        } else if (typeof magic === 'string') {
            magicBytes = new TextEncoder().encode(magic);
        } else if (magic instanceof Uint8Array) {
            magicBytes = magic;
        } else {
            magicBytes = new Uint8Array(magic);
        }

        const aad = new Uint8Array(AAD_LENGTH);
        aad.set(magicBytes.subarray(0, 4), 0);
        aad[4] = (version !== undefined && version !== null ? version : V3_VERSION) & 0xFF;

        const saltBytes = salt instanceof Uint8Array
            ? salt.subarray(0, SALT_LENGTH)
            : new Uint8Array(salt, 0, SALT_LENGTH);
        aad.set(saltBytes, 5);

        const view = new DataView(aad.buffer, aad.byteOffset, aad.byteLength);
        view.setUint32(37, chunkIndex >>> 0, false); // Big-endian 32-bit index
        aad[41] = isLast ? 0x01 : 0x00;

        return aad;
    }

    /**
     * Encrypts a single plaintext chunk with AES-256-GCM using computed IV and AAD.
     * Formats output as: [Length (4B uint32 BE) || Ciphertext (N bytes) || Tag (16B)].
     *
     * @param {CryptoKey} key - AES-GCM CryptoKey
     * @param {Uint8Array} plaintext - Plaintext chunk bytes
     * @param {Uint8Array} baseIVPrefix - 7-byte base IV prefix
     * @param {number} chunkIndex - 32-bit chunk index
     * @param {boolean} isLast - Whether this is the final chunk
     * @param {Uint8Array} salt - 32-byte vault salt
     * @returns {Promise<Uint8Array>} Framed encrypted chunk bytes
     */
    async function encryptChunk(key, plaintext, baseIVPrefix, chunkIndex, isLast, salt) {
        const subtle = getSubtleCrypto();
        const iv = computeChunkIV(baseIVPrefix, chunkIndex, isLast);
        const aad = computeChunkAAD(V3_MAGIC, V3_VERSION, salt, chunkIndex, isLast);

        const plainBytes = plaintext instanceof Uint8Array
            ? plaintext
            : new Uint8Array(plaintext || 0);

        const encryptedBuf = await subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
                additionalData: aad,
                tagLength: 128
            },
            key,
            plainBytes
        );

        const encryptedBytes = new Uint8Array(encryptedBuf);
        // encryptedBytes byteLength = N + 16 (Ciphertext + Tag)
        const chunkBytes = new Uint8Array(CHUNK_HEADER_SIZE + encryptedBytes.byteLength);
        const view = new DataView(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength);

        // Store Length: length of ciphertext payload (N bytes)
        view.setUint32(0, plainBytes.byteLength, false);
        chunkBytes.set(encryptedBytes, CHUNK_HEADER_SIZE);

        return chunkBytes;
    }

    /**
     * Authenticates and decrypts a framed encrypted chunk with AES-256-GCM.
     * Extracts length, ciphertext, and tag.
     * Throws OperationError immediately if tag verification fails or if chunk
     * sequence/isLast flag has been manipulated.
     *
     * @param {CryptoKey} key - AES-GCM CryptoKey
     * @param {Uint8Array} chunkBytes - Framed encrypted chunk bytes [Length(4) || Ciphertext(N) || Tag(16)]
     * @param {Uint8Array} baseIVPrefix - 7-byte base IV prefix
     * @param {number} chunkIndex - 32-bit chunk index
     * @param {boolean} isLast - Whether this is the expected final chunk
     * @param {Uint8Array} salt - 32-byte vault salt
     * @returns {Promise<Uint8Array>} Decrypted plaintext bytes
     */
    async function decryptChunk(key, chunkBytes, baseIVPrefix, chunkIndex, isLast, salt) {
        if (!chunkBytes || chunkBytes.byteLength < CHUNK_HEADER_SIZE + TAG_LENGTH) {
            throw createOperationError('Invalid chunk: buffer length too small for framing and authentication tag');
        }

        const chunkArr = chunkBytes instanceof Uint8Array
            ? chunkBytes
            : new Uint8Array(chunkBytes);

        const view = new DataView(chunkArr.buffer, chunkArr.byteOffset, chunkArr.byteLength);
        const declaredLen = view.getUint32(0, false);

        // Verify declared length matches chunk buffer
        // declaredLen is N (ciphertext length without tag) -> total chunk length is CHUNK_HEADER_SIZE + declaredLen + TAG_LENGTH
        const expectedTotalLenStandard = CHUNK_HEADER_SIZE + declaredLen + TAG_LENGTH;
        if (chunkArr.byteLength !== expectedTotalLenStandard) {
            throw createOperationError('Invalid chunk: length field does not match chunk payload size');
        }
        const ciphertextAndTag = chunkArr.subarray(CHUNK_HEADER_SIZE);

        const subtle = getSubtleCrypto();
        const iv = computeChunkIV(baseIVPrefix, chunkIndex, isLast);
        const aad = computeChunkAAD(V3_MAGIC, V3_VERSION, salt, chunkIndex, isLast);

        try {
            const decryptedBuf = await subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    additionalData: aad,
                    tagLength: 128
                },
                key,
                ciphertextAndTag
            );
            return new Uint8Array(decryptedBuf);
        } catch (err) {
            // Guarantee OperationError is thrown on authentication failure
            throw createOperationError('Chunk authentication failed: corrupted ciphertext, altered sequence, or invalid key');
        }
    }

    // =========================================================================
    // WEB STREAMS API STREAMING PIPELINES
    // =========================================================================

    /**
     * Helper to concatenate two Uint8Arrays with minimal overhead.
     */
    function concatBuffers(a, b) {
        if (!a || a.byteLength === 0) return b;
        if (!b || b.byteLength === 0) return a;
        const out = new Uint8Array(a.byteLength + b.byteLength);
        out.set(a, 0);
        out.set(b, a.byteLength);
        return out;
    }

    /**
     * Creates a TransformStream that receives arbitrary plaintext chunks and emits
     * framed encrypted chunks [Length (4B) || Ciphertext (N) || Tag (16B)].
     *
     * Ensures strict memory bounds (< 8 MB internal buffer) and guarantees
     * the final chunk is correctly tagged with isLast = true.
     *
     * @param {CryptoKey} key - AES-GCM CryptoKey
     * @param {Uint8Array} baseIVPrefix - 7-byte base IV prefix
     * @param {Uint8Array} salt - 32-byte vault salt
     * @param {number} [chunkSize=4194304] - Plaintext chunk size (default 4 MB)
     * @returns {TransformStream} Plaintext -> Framed Encrypted Chunks
     */
    function createChunkEncryptorStream(key, baseIVPrefix, salt, chunkSize = DEFAULT_CHUNK_SIZE) {
        if (typeof TransformStream === 'undefined') {
            throw new Error('TransformStream is not supported in this environment');
        }

        let chunkIndex = 0;
        let buffer = new Uint8Array(0);

        return new TransformStream({
            async transform(chunk, controller) {
                if (!chunk || chunk.byteLength === 0) return;

                const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                buffer = concatBuffers(buffer, incoming);

                // While buffer strictly exceeds chunkSize, we know subsequent data exists,
                // so we can safely encrypt and emit a non-final chunk (isLast = false).
                while (buffer.byteLength > chunkSize) {
                    const plaintextSlice = buffer.slice(0, chunkSize);
                    buffer = buffer.slice(chunkSize);

                    const encrypted = await encryptChunk(
                        key,
                        plaintextSlice,
                        baseIVPrefix,
                        chunkIndex,
                        false, // isLast = false
                        salt
                    );
                    chunkIndex++;
                    controller.enqueue(encrypted);
                }
            },

            async flush(controller) {
                // At flush, the remaining bytes (<= chunkSize, including 0 bytes for empty stream)
                // represent the final chunk.
                const finalSlice = buffer;
                buffer = new Uint8Array(0);

                const encrypted = await encryptChunk(
                    key,
                    finalSlice,
                    baseIVPrefix,
                    chunkIndex,
                    true, // isLast = true
                    salt
                );
                chunkIndex++;
                controller.enqueue(encrypted);
            }
        });
    }

    /**
     * Creates a TransformStream that receives framed encrypted chunks (or an arbitrary byte stream
     * of framed chunks) and emits decrypted plaintext chunks.
     *
     * Uses 1-chunk delay buffering to verify the final chunk transition and ensure that
     * any truncation, reordering, or chunk tampering immediately throws OperationError with
     * zero corrupt bytes emitted.
     *
     * @param {CryptoKey} key - AES-GCM CryptoKey
     * @param {Uint8Array} baseIVPrefix - 7-byte base IV prefix
     * @param {Uint8Array} salt - 32-byte vault salt
     * @param {number} [chunkSize=4194304] - Expected chunk size (default 4 MB)
     * @returns {TransformStream} Framed Encrypted Chunks -> Plaintext Chunks
     */
    function createChunkDecryptorStream(key, baseIVPrefix, salt, chunkSize = DEFAULT_CHUNK_SIZE) {
        if (typeof TransformStream === 'undefined') {
            throw new Error('TransformStream is not supported in this environment');
        }

        let buffer = new Uint8Array(0);
        let pendingChunk = null; // { chunkBytes, chunkIndex }
        let nextChunkIndex = 0;

        return new TransformStream({
            async transform(chunk, controller) {
                if (!chunk || chunk.byteLength === 0) return;

                const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                buffer = concatBuffers(buffer, incoming);

                // Parse as many complete framed chunks as available in buffer
                while (buffer.byteLength >= CHUNK_HEADER_SIZE) {
                    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                    const declaredPayloadLen = view.getUint32(0, false);
                    if (declaredPayloadLen > chunkSize) {
                        throw createOperationError(`Invalid chunk: declared length ${declaredPayloadLen} exceeds maximum chunk size ${chunkSize}`);
                    }
                    const totalChunkLen = CHUNK_HEADER_SIZE + declaredPayloadLen + TAG_LENGTH;

                    // If full chunk not yet received, wait for subsequent bytes
                    if (buffer.byteLength < totalChunkLen) {
                        break;
                    }

                    const framedChunk = buffer.slice(0, totalChunkLen);
                    buffer = buffer.slice(totalChunkLen);

                    // If a pending chunk was previously held, it is now confirmed NOT to be the last chunk
                    if (pendingChunk !== null) {
                        const plaintext = await decryptChunk(
                            key,
                            pendingChunk.chunkBytes,
                            baseIVPrefix,
                            pendingChunk.chunkIndex,
                            false, // isLast = false
                            salt
                        );
                        controller.enqueue(plaintext);
                    }

                    // Hold the new chunk until we discover whether another chunk follows
                    pendingChunk = {
                        chunkBytes: framedChunk,
                        chunkIndex: nextChunkIndex
                    };
                    nextChunkIndex++;
                }
            },

            async flush(controller) {
                // If leftover incomplete bytes remain in the accumulator buffer, stream was truncated mid-chunk
                if (buffer.byteLength > 0) {
                    throw createOperationError('Stream truncated: incomplete chunk framing remaining in buffer');
                }

                // If no chunks were received at all, stream was empty
                if (pendingChunk === null) {
                    throw createOperationError('Stream truncated: no chunks received');
                }

                // The held chunk is confirmed to be the final chunk
                const plaintext = await decryptChunk(
                    key,
                    pendingChunk.chunkBytes,
                    baseIVPrefix,
                    pendingChunk.chunkIndex,
                    true, // isLast = true
                    salt
                );
                controller.enqueue(plaintext);
                pendingChunk = null;
            }
        });
    }

    // =========================================================================
    // CONTAINER HEADER UTILITIES
    // =========================================================================

    /**
     * Creates a 57-byte v3 container header.
     * Layout: [Magic 'ZV3\0' (4B) | Version 0x03 (1B) | Flags (1B) | ChunkSize (4B) | Salt (32B) | Base IV Prefix (7B) | Manifest Offset (8B)]
     *
     * @param {Object} options
     * @param {Uint8Array} options.salt - 32-byte vault salt
     * @param {Uint8Array} options.baseIVPrefix - 7-byte base IV prefix
     * @param {number} [options.chunkSize=4194304] - Chunk size in bytes
     * @param {number} [options.flags=0] - Flags bitfield (e.g. V3_FLAG_KEYFILE)
     * @param {BigInt|number} [options.manifestOffset=0n] - Manifest offset relative to file start
     * @returns {Uint8Array} 57-byte header
     */
    function createContainerHeader(options) {
        if (!options || !options.salt || options.salt.byteLength < SALT_LENGTH) {
            throw new TypeError(`salt must be at least ${SALT_LENGTH} bytes`);
        }
        if (!options.baseIVPrefix || options.baseIVPrefix.byteLength < BASE_IV_PREFIX_LENGTH) {
            throw new TypeError(`baseIVPrefix must be at least ${BASE_IV_PREFIX_LENGTH} bytes`);
        }

        const header = new Uint8Array(V3_HEADER_SIZE);
        const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

        // 1. Magic 'ZV3\0' (4B)
        header.set(V3_MAGIC, 0);

        // 2. Version 0x03 (1B)
        header[4] = V3_VERSION;

        // 3. Flags (1B)
        header[5] = (options.flags || 0) & 0xFF;

        // 4. ChunkSize 4MB (4B uint32 BE)
        const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
        view.setUint32(6, chunkSize >>> 0, false);

        // 5. Salt (32B)
        const saltBytes = options.salt instanceof Uint8Array
            ? options.salt.subarray(0, SALT_LENGTH)
            : new Uint8Array(options.salt, 0, SALT_LENGTH);
        header.set(saltBytes, 10);

        // 6. Base IV Prefix (7B)
        const prefixBytes = options.baseIVPrefix instanceof Uint8Array
            ? options.baseIVPrefix.subarray(0, BASE_IV_PREFIX_LENGTH)
            : new Uint8Array(options.baseIVPrefix, 0, BASE_IV_PREFIX_LENGTH);
        header.set(prefixBytes, 42);

        // 7. Manifest Offset (8B uint64 BE)
        const manifestOffset = BigInt(options.manifestOffset || 0n);
        view.setBigUint64(49, manifestOffset, false);

        return header;
    }

    /**
     * Parses and validates a 57-byte v3 container header.
     *
     * @param {Uint8Array} headerBytes - Header byte buffer
     * @returns {Object} Parsed container header fields
     */
    function parseContainerHeader(headerBytes) {
        if (!headerBytes || headerBytes.byteLength < V3_HEADER_SIZE) {
            throw createOperationError(`Invalid container header: expected at least ${V3_HEADER_SIZE} bytes`);
        }

        const header = headerBytes instanceof Uint8Array
            ? headerBytes
            : new Uint8Array(headerBytes);

        // Validate Magic 'ZV3\0'
        for (let i = 0; i < 4; i++) {
            if (header[i] !== V3_MAGIC[i]) {
                throw createOperationError('Invalid container header: invalid magic identifier');
            }
        }

        // Validate Version
        const version = header[4];
        if (version !== V3_VERSION) {
            throw createOperationError(`Unsupported vault version: ${version} (expected ${V3_VERSION})`);
        }

        const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
        const flags = header[5];
        const chunkSize = view.getUint32(6, false);
        const salt = header.slice(10, 42);
        const baseIVPrefix = header.slice(42, 49);
        const manifestOffset = view.getBigUint64(49, false);

        return {
            magic: header.slice(0, 4),
            version,
            flags,
            chunkSize,
            salt,
            baseIVPrefix,
            manifestOffset
        };
    }

    /**
     * Updates the 8-byte Manifest Offset field in a container header in place.
     *
     * @param {Uint8Array} headerBytes - 57-byte container header
     * @param {BigInt|number} manifestOffset - 64-bit manifest byte offset
     */
    function updateManifestOffset(headerBytes, manifestOffset) {
        if (!headerBytes || headerBytes.byteLength < V3_HEADER_SIZE) {
            throw new TypeError(`headerBytes must be at least ${V3_HEADER_SIZE} bytes`);
        }
        const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
        view.setBigUint64(49, BigInt(manifestOffset), false);
    }

    /**
     * Generates a cryptographically secure random 32-byte salt.
     *
     * @param {number} [length=32]
     * @returns {Uint8Array}
     */
    function generateSalt(length = SALT_LENGTH) {
        return getRandomValues(new Uint8Array(length));
    }

    /**
     * Generates a cryptographically secure random 7-byte base IV prefix.
     *
     * @param {number} [length=7]
     * @returns {Uint8Array}
     */
    function generateBaseIVPrefix(length = BASE_IV_PREFIX_LENGTH) {
        return getRandomValues(new Uint8Array(length));
    }

    // =========================================================================
    // EXPORTS
    // =========================================================================

    return {
        // Constants
        V3_MAGIC,
        V3_VERSION,
        V3_HEADER_SIZE,
        DEFAULT_CHUNK_SIZE,
        PBKDF2_ITERATIONS,
        SALT_LENGTH,
        BASE_IV_PREFIX_LENGTH,
        IV_LENGTH,
        TAG_LENGTH,
        AAD_LENGTH,
        CHUNK_HEADER_SIZE,
        V3_FLAG_KEYFILE,

        // Core Crypto
        deriveMasterKey,
        computeChunkIV,
        computeChunkAAD,
        encryptChunk,
        decryptChunk,

        // Web Streams API Wrappers
        createChunkEncryptorStream,
        createChunkDecryptorStream,

        // Container Header Utilities
        createContainerHeader,
        parseContainerHeader,
        updateManifestOffset,
        generateSalt,
        generateBaseIVPrefix
    };
}));
