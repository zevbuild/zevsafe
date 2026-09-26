/**
 * ZevSafe v3 Background Web Worker Engine
 * js/crypto-worker.js
 *
 * Implements off-thread cryptographic operations, compression, and selective extraction:
 * - Dedicated Web Worker scope (browser) and node:worker_threads (Node.js) compatible.
 * - PBKDF2-SHA512 key derivation with 600,000 iterations & optional keyfile XOR mixing off the main thread.
 * - Per-chunk STREAM AEAD encryption & decryption with Transferable ArrayBuffers (zero-copy memory transfer).
 * - Encrypted manifest trailer envelope decryption & instant catalog inspection.
 * - Selective single-file chunk decryption, native deflate decompression & CRC-32 verification.
 * - Cooperative cancellation and zeroizing of sensitive key material.
 */

(function () {
    'use strict';

    // =========================================================================
    // ENVIRONMENT DETECTION & DEPENDENCY RESOLUTION
    // =========================================================================

    const isNode = typeof process !== 'undefined' && process.versions && !!process.versions.node;
    let parentPort = null;

    if (isNode) {
        try {
            const wt = require('node:worker_threads');
            if (!wt.isMainThread && wt.parentPort) {
                parentPort = wt.parentPort;
            }
        } catch (_) {}
    }

    let StreamCrypto = null;
    let StreamPacker = null;
    let StreamUnpacker = null;

    function resolveDependencies() {
        if (StreamCrypto && StreamPacker && StreamUnpacker) return;

        if (typeof require === 'function') {
            try {
                if (!StreamCrypto) StreamCrypto = require('./stream-crypto.js');
            } catch (_) {
                try { StreamCrypto = require('../js/stream-crypto.js'); } catch (__) {}
            }
            try {
                if (!StreamPacker) StreamPacker = require('./stream-packer.js');
            } catch (_) {
                try { StreamPacker = require('../js/stream-packer.js'); } catch (__) {}
            }
            try {
                if (!StreamUnpacker) StreamUnpacker = require('./stream-unpacker.js');
            } catch (_) {
                try { StreamUnpacker = require('../js/stream-unpacker.js'); } catch (__) {}
            }
        }

        if (typeof importScripts === 'function') {
            // Dedicated Web Worker scope
            const pathsToTry = [
                ['stream-crypto.js', 'stream-packer.js', 'stream-unpacker.js'],
                ['js/stream-crypto.js', 'js/stream-packer.js', 'js/stream-unpacker.js'],
                ['../js/stream-crypto.js', '../js/stream-packer.js', '../js/stream-unpacker.js']
            ];

            for (const group of pathsToTry) {
                if (StreamCrypto && StreamPacker && StreamUnpacker) break;
                try {
                    importScripts(...group);
                } catch (_) {}
                if (typeof self !== 'undefined') {
                    if (!StreamCrypto && self.StreamCrypto) StreamCrypto = self.StreamCrypto;
                    if (!StreamPacker && self.StreamPacker) StreamPacker = self.StreamPacker;
                    if (!StreamUnpacker && self.StreamUnpacker) StreamUnpacker = self.StreamUnpacker;
                }
            }
        }

        // Global fallback
        const globalScope = typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this;
        if (!StreamCrypto && globalScope.StreamCrypto) StreamCrypto = globalScope.StreamCrypto;
        if (!StreamPacker && globalScope.StreamPacker) StreamPacker = globalScope.StreamPacker;
        if (!StreamUnpacker && globalScope.StreamUnpacker) StreamUnpacker = globalScope.StreamUnpacker;
    }

    resolveDependencies();

    // =========================================================================
    // WORKER SESSION STATE
    // =========================================================================

    const sessions = new Map();

    const defaultSession = {
        masterKey: null,
        salt: null,
        baseIVPrefix: null,
        chunkSize: 4 * 1024 * 1024,
        iterations: 600000,
        isCancelled: false
    };

    function getSession(sessionId) {
        if (!sessionId || sessionId === 'default') {
            return defaultSession;
        }
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, {
                masterKey: null,
                salt: null,
                baseIVPrefix: null,
                chunkSize: 4 * 1024 * 1024,
                iterations: 600000,
                isCancelled: false
            });
        }
        return sessions.get(sessionId);
    }

    function clearSession(session) {
        if (!session) return;
        session.masterKey = null;
        if (session.salt && session.salt.fill) session.salt.fill(0);
        session.salt = null;
        if (session.baseIVPrefix && session.baseIVPrefix.fill) session.baseIVPrefix.fill(0);
        session.baseIVPrefix = null;
        session.isCancelled = true;
    }

    // =========================================================================
    // MESSAGE HANDLERS
    // =========================================================================

    /**
     * Core message dispatcher. Processes an incoming command message and sends
     * reply via the provided replyFn(response, transferList).
     *
     * @param {Object} data - Command payload with { id, type, ... }
     * @param {Function} replyFn - Callback (replyMessage, transferArray) => void
     */
    async function processIncomingMessage(data, replyFn) {
        if (!data || typeof data !== 'object') return;
        const { id, type, sessionId } = data;

        resolveDependencies();

        const session = getSession(sessionId);

        try {
            switch (type) {
                // -------------------------------------------------------------
                // 1. INIT_KEY: Derives PBKDF2-SHA512 master key off main thread
                // -------------------------------------------------------------
                case 'INIT_KEY': {
                    const { password, salt, iterations = 600000, keyfile } = data;
                    if (typeof password !== 'string') {
                        throw new TypeError('password must be a string');
                    }
                    if (!salt) {
                        throw new TypeError('salt is required for key derivation');
                    }

                    const saltBytes = salt instanceof Uint8Array ? salt : new Uint8Array(salt);
                    let keyfileBytes = null;
                    if (keyfile) {
                        keyfileBytes = keyfile instanceof Uint8Array ? keyfile : new Uint8Array(keyfile);
                    }

                    const masterKey = await StreamCrypto.deriveMasterKey(
                        password,
                        saltBytes,
                        iterations,
                        keyfileBytes
                    );

                    session.masterKey = masterKey;
                    session.salt = saltBytes;
                    session.iterations = iterations;
                    session.isCancelled = false;

                    replyFn({
                        id,
                        type: 'ACK',
                        success: true,
                        keyDerived: true
                    }, []);
                    break;
                }

                // -------------------------------------------------------------
                // 2. SET_PARAMS: Updates container streaming parameters
                // -------------------------------------------------------------
                case 'SET_PARAMS': {
                    const { baseIVPrefix, salt, chunkSize } = data;
                    if (baseIVPrefix) {
                        session.baseIVPrefix = baseIVPrefix instanceof Uint8Array
                            ? baseIVPrefix
                            : new Uint8Array(baseIVPrefix);
                    }
                    if (salt) {
                        session.salt = salt instanceof Uint8Array
                            ? salt
                            : new Uint8Array(salt);
                    }
                    if (chunkSize) {
                        session.chunkSize = chunkSize;
                    }
                    session.isCancelled = false;

                    replyFn({
                        id,
                        type: 'ACK',
                        success: true
                    }, []);
                    break;
                }

                // -------------------------------------------------------------
                // 3. ENCRYPT_CHUNK: Encrypts chunk via STREAM AEAD with Transferable
                // -------------------------------------------------------------
                case 'ENCRYPT_CHUNK': {
                    if (session.isCancelled) {
                        throw new Error('Operation was cancelled');
                    }
                    if (!session.masterKey) {
                        throw new Error('Master key not initialized. Call INIT_KEY first.');
                    }

                    const { chunk, chunkIndex, isLast, baseIVPrefix, salt } = data;
                    if (!chunk) {
                        throw new TypeError('chunk buffer is required');
                    }

                    const plainBytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                    const ivPrefix = baseIVPrefix
                        ? (baseIVPrefix instanceof Uint8Array ? baseIVPrefix : new Uint8Array(baseIVPrefix))
                        : session.baseIVPrefix;
                    const s = salt
                        ? (salt instanceof Uint8Array ? salt : new Uint8Array(salt))
                        : session.salt;

                    if (!ivPrefix) throw new Error('baseIVPrefix is missing');
                    if (!s) throw new Error('salt is missing');

                    const encryptedBytes = await StreamCrypto.encryptChunk(
                        session.masterKey,
                        plainBytes,
                        ivPrefix,
                        chunkIndex,
                        isLast,
                        s
                    );

                    // Zero-copy transfer of encrypted buffer
                    const encBuffer = encryptedBytes.buffer.slice(
                        encryptedBytes.byteOffset,
                        encryptedBytes.byteOffset + encryptedBytes.byteLength
                    );

                    replyFn({
                        id,
                        type: 'ACK',
                        success: true,
                        chunk: encBuffer,
                        chunkIndex,
                        isLast,
                        byteLength: encryptedBytes.byteLength
                    }, [encBuffer]);
                    break;
                }

                // -------------------------------------------------------------
                // 4. DECRYPT_CHUNK: Decrypts chunk via STREAM AEAD with Transferable
                // -------------------------------------------------------------
                case 'DECRYPT_CHUNK': {
                    if (session.isCancelled) {
                        throw new Error('Operation was cancelled');
                    }
                    if (!session.masterKey) {
                        throw new Error('Master key not initialized. Call INIT_KEY first.');
                    }

                    const { chunk, chunkIndex, isLast, baseIVPrefix, salt } = data;
                    if (!chunk) {
                        throw new TypeError('chunk buffer is required');
                    }

                    const encBytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                    const ivPrefix = baseIVPrefix
                        ? (baseIVPrefix instanceof Uint8Array ? baseIVPrefix : new Uint8Array(baseIVPrefix))
                        : session.baseIVPrefix;
                    const s = salt
                        ? (salt instanceof Uint8Array ? salt : new Uint8Array(salt))
                        : session.salt;

                    if (!ivPrefix) throw new Error('baseIVPrefix is missing');
                    if (!s) throw new Error('salt is missing');

                    const plainBytes = await StreamCrypto.decryptChunk(
                        session.masterKey,
                        encBytes,
                        ivPrefix,
                        chunkIndex,
                        isLast,
                        s
                    );

                    // Zero-copy transfer of decrypted buffer
                    const plainBuffer = plainBytes.buffer.slice(
                        plainBytes.byteOffset,
                        plainBytes.byteOffset + plainBytes.byteLength
                    );

                    replyFn({
                        id,
                        type: 'ACK',
                        success: true,
                        chunk: plainBuffer,
                        chunkIndex,
                        isLast,
                        byteLength: plainBytes.byteLength
                    }, [plainBuffer]);
                    break;
                }

                // -------------------------------------------------------------
                // 5. DECRYPT_MANIFEST: Decrypts catalog from trailer envelope
                // -------------------------------------------------------------
                case 'DECRYPT_MANIFEST': {
                    if (!session.masterKey) {
                        throw new Error('Master key not initialized. Call INIT_KEY first.');
                    }

                    const { envelope } = data;
                    if (!envelope) {
                        throw new TypeError('envelope buffer is required');
                    }

                    const envelopeBytes = envelope instanceof Uint8Array
                        ? envelope
                        : new Uint8Array(envelope);

                    const catalog = await StreamPacker.parseEncryptedManifest(
                        envelopeBytes,
                        session.masterKey
                    );

                    replyFn({
                        id,
                        type: 'ACK',
                        success: true,
                        manifest: catalog,
                        files: Array.isArray(catalog) ? catalog : (catalog.files || [])
                    }, []);
                    break;
                }

                // -------------------------------------------------------------
                // 6. BUILD_MANIFEST: Encrypts catalog into trailer envelope
                // -------------------------------------------------------------
                case 'BUILD_MANIFEST': {
                    if (!session.masterKey) {
                        throw new Error('Master key not initialized. Call INIT_KEY first.');
                    }

                    const { catalog } = data;
                    if (!catalog) {
                        throw new TypeError('catalog metadata is required');
                    }

                    const envelopeBytes = await StreamPacker.buildEncryptedManifest(
                        catalog,
                        session.masterKey
                    );

                    const envBuffer = envelopeBytes.buffer.slice(
                        envelopeBytes.byteOffset,
                        envelopeBytes.byteOffset + envelopeBytes.byteLength
                    );

                    replyFn({
                        id,
                        type: 'ACK',
                        success: true,
                        envelope: envBuffer
                    }, [envBuffer]);
                    break;
                }

                // -------------------------------------------------------------
                // 7. EXTRACT_FILE: Decrypts file chunks, decompresses & verifies CRC
                // -------------------------------------------------------------
                case 'EXTRACT_FILE': {
                    if (session.isCancelled) {
                        throw new Error('Operation was cancelled');
                    }
                    if (!session.masterKey) {
                        throw new Error('Master key not initialized. Call INIT_KEY first.');
                    }

                    const { entry, chunkBuffers, baseIVPrefix, salt, chunkSize } = data;
                    if (!entry) throw new TypeError('entry descriptor is required');
                    if (!Array.isArray(chunkBuffers) || chunkBuffers.length === 0) {
                        throw new TypeError('chunkBuffers array is required');
                    }

                    const ivPrefix = baseIVPrefix
                        ? (baseIVPrefix instanceof Uint8Array ? baseIVPrefix : new Uint8Array(baseIVPrefix))
                        : session.baseIVPrefix;
                    const s = salt
                        ? (salt instanceof Uint8Array ? salt : new Uint8Array(salt))
                        : session.salt;
                    const cSize = chunkSize || session.chunkSize || 4 * 1024 * 1024;

                    // Decrypt each chunk in span
                    const decryptedList = [];
                    for (const cb of chunkBuffers) {
                        const raw = cb.buffer instanceof Uint8Array ? cb.buffer : new Uint8Array(cb.buffer);
                        const plain = await StreamCrypto.decryptChunk(
                            session.masterKey,
                            raw,
                            ivPrefix,
                            cb.index,
                            cb.isLast,
                            s
                        );
                        decryptedList.push(plain);
                    }

                    // Assemble decrypted span
                    let spanBytes;
                    if (decryptedList.length === 1) {
                        spanBytes = decryptedList[0];
                    } else {
                        const totalLen = decryptedList.reduce((acc, c) => acc + c.byteLength, 0);
                        spanBytes = new Uint8Array(totalLen);
                        let offset = 0;
                        for (const c of decryptedList) {
                            spanBytes.set(c, offset);
                            offset += c.byteLength;
                        }
                    }

                    // Locate file payload within the decrypted span
                    const chunkStart = entry.chunkStart !== undefined
                        ? entry.chunkStart
                        : Math.floor((entry.offset || entry.localHeaderOffset || 0) / cSize);
                    const spanBasePlaintextOffset = BigInt(chunkStart) * BigInt(cSize);
                    const localHeaderOffset = BigInt(
                        entry.localHeaderOffset !== undefined ? entry.localHeaderOffset : (entry.offset || 0)
                    );
                    const relPos = Number(localHeaderOffset - spanBasePlaintextOffset);

                    let payloadStart = relPos;
                    const payloadLength = Number(entry.compressedSize !== undefined ? entry.compressedSize : entry.size);

                    // Check for ZIP Local File Header (0x04034b50)
                    if (relPos >= 0 && relPos + 30 <= spanBytes.byteLength) {
                        const view = new DataView(spanBytes.buffer, spanBytes.byteOffset, spanBytes.byteLength);
                        const sig = view.getUint32(relPos, true);
                        if (sig === 0x04034b50) {
                            const nameLen = view.getUint16(relPos + 26, true);
                            const extraLen = view.getUint16(relPos + 28, true);
                            payloadStart = relPos + 30 + nameLen + extraLen;
                        }
                    }

                    if (payloadStart < 0 || payloadStart > spanBytes.byteLength) {
                        throw new Error(`Invalid file payload position in decrypted chunk span for "${entry.path || entry.name}"`);
                    }

                    const payloadEnd = Math.min(spanBytes.byteLength, payloadStart + payloadLength);
                    const rawPayload = spanBytes.subarray(payloadStart, payloadEnd);

                    // Decompress if compressed (method 8)
                    let extractedBytes;
                    const isCompressed = entry.compressed || entry.compressionMethod === 8;
                    if (isCompressed && rawPayload.byteLength > 0) {
                        extractedBytes = await StreamUnpacker.decompressDeflateRaw(rawPayload);
                    } else {
                        extractedBytes = rawPayload;
                    }

                    // Verify CRC-32 checksum if present
                    if (entry.crc32 !== undefined && entry.crc32 !== null) {
                        const computedCrc = StreamPacker.crc32(extractedBytes);
                        if ((computedCrc >>> 0) !== (entry.crc32 >>> 0)) {
                            throw new Error(
                                `CRC-32 checksum mismatch for "${entry.path || entry.name}": expected 0x${(entry.crc32 >>> 0).toString(16).padStart(8, '0')}, calculated 0x${(computedCrc >>> 0).toString(16).padStart(8, '0')}`
                            );
                        }
                    }

                    const outBuf = extractedBytes.buffer.slice(
                        extractedBytes.byteOffset,
                        extractedBytes.byteOffset + extractedBytes.byteLength
                    );

                    replyFn({
                        id,
                        type: 'ACK',
                        success: true,
                        data: outBuf,
                        path: entry.path || entry.name,
                        size: extractedBytes.byteLength
                    }, [outBuf]);
                    break;
                }

                // -------------------------------------------------------------
                // 8. CANCEL: Cooperative abort and zeroizing key material
                // -------------------------------------------------------------
                case 'CANCEL': {
                    clearSession(session);
                    if (sessionId && sessions.has(sessionId)) {
                        sessions.delete(sessionId);
                    }

                    replyFn({
                        id,
                        type: 'ACK',
                        success: true,
                        cancelled: true
                    }, []);
                    break;
                }

                // -------------------------------------------------------------
                // 9. PING: Liveness probe
                // -------------------------------------------------------------
                case 'PING': {
                    replyFn({
                        id,
                        type: 'ACK',
                        success: true,
                        pong: true
                    }, []);
                    break;
                }

                default:
                    throw new Error(`Unknown command type: "${type}"`);
            }
        } catch (err) {
            replyFn({
                id,
                type: 'ERROR',
                success: false,
                error: {
                    name: err.name || 'Error',
                    message: err.message || String(err),
                    stack: err.stack
                }
            }, []);
        }
    }

    // =========================================================================
    // EVENT LISTENERS BINDING
    // =========================================================================

    // 1. Node.js worker_threads
    if (parentPort) {
        parentPort.on('message', async (data) => {
            await processIncomingMessage(data, (reply, transfer) => {
                parentPort.postMessage(reply, transfer);
            });
        });
    }

    // 2. Dedicated Web Worker scope (browser)
    if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && !parentPort) {
        self.onmessage = async (event) => {
            const data = event && event.data ? event.data : event;
            await processIncomingMessage(data, (reply, transfer) => {
                self.postMessage(reply, transfer);
            });
        };
    }

    // 3. Module export for testing & in-process async worker shim
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            processIncomingMessage,
            sessions,
            defaultSession,
            getSession,
            clearSession
        };
    }
})();
