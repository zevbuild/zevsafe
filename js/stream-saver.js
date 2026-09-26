/**
 * ZevSafe 5 GB Streaming Architecture - Multi-Tier Download Adapter
 * js/stream-saver.js
 *
 * Implements a 4-tier streaming download engine capable of saving multi-gigabyte
 * payloads (up to 5 GB+) with peak JS heap < 50 MB:
 *   - Tier 1: FileSystem Access API (showSaveFilePicker + createWritable)
 *   - Tier 2: Service Worker Stream Intercept (sw.js synthetic fetch route with single-chunk ACK flow control)
 *   - Tier 3: Origin Private File System (OPFS) Staging (iOS Safari 15.2+ zero-RAM disk staging)
 *   - Tier 4: In-memory chunk accumulator with 150 MB safety guardrail
 */

(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        const exports = factory();
        root.StreamSaver = exports;
        root.StreamSaverAdapter = exports;
        if (typeof globalThis !== 'undefined') {
            globalThis.StreamSaver = exports;
            globalThis.StreamSaverAdapter = exports;
        }
    }
}(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    // ── Constants ────────────────────────────────────────────────────
    const TIER_1_FSA = 'tier1';
    const TIER_2_SW = 'tier2';
    const TIER_3_OPFS = 'tier3';
    const TIER_4_FALLBACK = 'fallback';
    const MAX_FALLBACK_GUARDRAIL_BYTES = 150 * 1024 * 1024; // 150 MB Safety Guardrail

    // ── Filename Sanitizer (Tests 2.19.3, 2.19.4) ────────────────────
    function sanitizeFilename(name, fallback = 'vault.zev') {
        if (!name || typeof name !== 'string' || name.trim().length === 0) return fallback;
        return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    }

    /**
     * Encodes filename for Content-Disposition according to RFC 5987.
     * format: filename*=UTF-8''<encoded-filename>
     */
    function encodeRFC5987(filename) {
        const clean = sanitizeFilename(filename);
        return `attachment; filename*=UTF-8''${encodeURIComponent(clean)}`;
    }

    // ── Device & Capability Detection ────────────────────────────────
    function isTier1Supported() {
        return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
    }

    function isTier2Supported() {
        return typeof navigator !== 'undefined' &&
               'serviceWorker' in navigator &&
               navigator.serviceWorker.controller !== null;
    }

    function isTier3Supported() {
        return typeof navigator !== 'undefined' &&
               'storage' in navigator &&
               typeof navigator.storage.getDirectory === 'function';
    }

    function isIOS() {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        const isAppleMobile = /iPad|iPhone|iPod/.test(ua);
        const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        return isAppleMobile || isIPadOS;
    }

    function detectCapabilities() {
        const t1 = isTier1Supported();
        const t2 = isTier2Supported();
        const t3 = isTier3Supported();
        const ios = isIOS();

        let recommendedTier = TIER_4_FALLBACK;
        if (ios && t3) {
            // iOS Safari: OPFS staging preferred over SW iframe streaming
            recommendedTier = TIER_3_OPFS;
        } else if (t1) {
            // Desktop Chrome/Edge/Opera: direct FileSystem Access API
            recommendedTier = TIER_1_FSA;
        } else if (t2) {
            // Firefox/Safari Desktop: ServiceWorker synthetic download intercept
            recommendedTier = TIER_2_SW;
        } else if (t3) {
            // Browsers with OPFS support
            recommendedTier = TIER_3_OPFS;
        }

        return {
            tier1FileSystemAccess: t1,
            tier2ServiceWorker: t2,
            tier3OPFS: t3,
            isIOS: ios,
            recommendedTier
        };
    }

    // ── Tier 1: FileSystem Access API ────────────────────────────────
    async function createTier1Writer(filename, expectedSize, options = {}) {
        const cleanName = sanitizeFilename(filename);
        const ext = cleanName.toLowerCase().split('.').pop();
        let types = [];
        if (ext === 'zev') {
            types = [{
                description: 'ZevSafe Encrypted Vault (*.zev)',
                accept: { 'application/octet-stream': ['.zev'] }
            }];
        } else if (ext === 'zip') {
            types = [{
                description: 'ZIP Archive (*.zip)',
                accept: { 'application/zip': ['.zip'] }
            }];
        }

        const pickerFn = (options.picker) || (typeof window !== 'undefined' && window.showSaveFilePicker);
        if (!pickerFn) {
            throw new Error('FileSystem Access API (showSaveFilePicker) is not supported in this environment');
        }

        // Must run within user gesture context
        const handle = await pickerFn({
            suggestedName: cleanName,
            types
        });

        const writableFileStream = await handle.createWritable();
        let isClosed = false;

        const stream = new WritableStream({
            async write(chunk) {
                if (isClosed) throw new Error('Stream is already closed');
                const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                await writableFileStream.write(data);
                if (options.onProgress) options.onProgress(data.byteLength);
            },
            async close() {
                if (isClosed) return;
                isClosed = true;
                await writableFileStream.close();
            },
            async abort(reason) {
                if (isClosed) return;
                isClosed = true;
                try {
                    await writableFileStream.abort(reason);
                } catch (_) {}
            }
        });

        stream.tier = TIER_1_FSA;
        stream.fileHandle = handle;
        stream.rawWritable = writableFileStream;
        stream.seek = (pos) => (typeof writableFileStream.seek === 'function' ? writableFileStream.seek(pos) : Promise.resolve());
        stream.writable = stream;
        return stream;
    }

    // ── Tier 2: Service Worker Stream Intercept ──────────────────────
    async function createTier2Writer(filename, expectedSize, options = {}) {
        const cleanName = sanitizeFilename(filename);
        const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const swController = options.swController || (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller);

        if (!swController) {
            throw new Error('Service Worker controller is not active or available for streaming download');
        }

        const ChannelClass = options.MessageChannel || (typeof MessageChannel !== 'undefined' ? MessageChannel : null);
        if (!ChannelClass) {
            throw new Error('MessageChannel is not supported in this environment');
        }
        const channel = new ChannelClass();

        // 1. Register with Service Worker controller
        swController.postMessage({
            type: 'REGISTER_DOWNLOAD',
            downloadId,
            id: downloadId,
            filename: cleanName,
            expectedSize: expectedSize || 0,
            size: expectedSize || 0
        }, [channel.port2]);

        // 2. Trigger browser download via hidden iframe
        let iframe = null;
        if (typeof document !== 'undefined' && document.createElement) {
            iframe = document.createElement('iframe');
            iframe.hidden = true;
            iframe.style.display = 'none';
            iframe.src = `/_stream_download?filename=${encodeURIComponent(cleanName)}&id=${downloadId}`;
            document.body.appendChild(iframe);
        }

        let isClosed = false;
        let pendingAckResolve = null;
        let pendingAckReject = null;

        channel.port1.onmessage = (event) => {
            const data = event.data;
            if (!data) return;
            if (data.type === 'ACK' || data.type === 'CHUNK_ACK') {
                if (pendingAckResolve) {
                    const r = pendingAckResolve;
                    pendingAckResolve = null;
                    pendingAckReject = null;
                    r();
                }
            } else if (data.type === 'DISCONNECTED' || data.type === 'ABORT') {
                // Download cancelled or disconnected by user in browser download manager
                isClosed = true;
                if (pendingAckReject) {
                    const rj = pendingAckReject;
                    pendingAckResolve = null;
                    pendingAckReject = null;
                    rj(new Error(data.reason || 'Download disconnected by client'));
                }
                if (options.onDisconnect) options.onDisconnect(data.reason);
            }
        };

        const stream = new WritableStream({
            async write(chunk) {
                if (isClosed) throw new Error('Stream is already closed or cancelled');
                const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

                // Send chunk with backpressure: wait for ACK before resolving (bounds memory <= 4 MB)
                await new Promise((resolve, reject) => {
                    pendingAckResolve = resolve;
                    pendingAckReject = reject;
                    try {
                        channel.port1.postMessage({ type: 'CHUNK', chunk: data }, [data.buffer]);
                    } catch (postErr) {
                        // In case transfer fails or buffer is detached
                        channel.port1.postMessage({ type: 'CHUNK', chunk: data });
                    }
                });

                if (options.onProgress) options.onProgress(data.byteLength);
            },
            async close() {
                if (isClosed) return;
                isClosed = true;
                channel.port1.postMessage({ type: 'DONE' });
                if (iframe) {
                    setTimeout(() => { try { iframe.remove(); } catch (_) {} }, 5000);
                }
            },
            async abort(reason) {
                if (isClosed) return;
                isClosed = true;
                channel.port1.postMessage({ type: 'ABORT', reason: String(reason) });
                if (iframe) {
                    try { iframe.remove(); } catch (_) {}
                }
            }
        });

        stream.tier = TIER_2_SW;
        stream.downloadId = downloadId;
        stream.writable = stream;
        return stream;
    }

    // ── Tier 3: OPFS Staging (iOS Safari 15.2+) ──────────────────────
    async function createTier3Writer(filename, expectedSize, options = {}) {
        const cleanName = sanitizeFilename(filename);
        const getDirectoryFn = options.getDirectory || (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory.bind(navigator.storage));
        if (!getDirectoryFn) {
            throw new Error('OPFS (navigator.storage.getDirectory) is not supported in this environment');
        }

        const root = await getDirectoryFn();
        const tempName = `zevsafe_stage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`;
        const fileHandle = await root.getFileHandle(tempName, { create: true });
        const writable = await fileHandle.createWritable();
        let isClosed = false;

        const stream = new WritableStream({
            async write(chunk) {
                if (isClosed) throw new Error('Stream is already closed');
                const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                await writable.write(data);
                if (options.onProgress) options.onProgress(data.byteLength);
            },
            async close() {
                if (isClosed) return;
                isClosed = true;
                await writable.close();

                // Obtain zero-RAM disk-backed File handle
                const file = await fileHandle.getFile();
                stream.resultFile = file;

                if (typeof URL !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
                    const objectUrl = URL.createObjectURL(file);
                    const a = document.createElement('a');
                    a.href = objectUrl;
                    a.download = cleanName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    // Cleanup URL and OPFS staging file after delay
                    setTimeout(async () => {
                        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
                        try { await root.removeEntry(tempName); } catch (_) {}
                    }, 60000);
                }
            },
            async abort(reason) {
                if (isClosed) return;
                isClosed = true;
                try {
                    await writable.abort(reason);
                } catch (_) {}
                try {
                    await root.removeEntry(tempName);
                } catch (_) {}
            }
        });

        stream.tier = TIER_3_OPFS;
        stream.fileHandle = fileHandle;
        stream.seek = (pos) => (typeof writable.seek === 'function' ? writable.seek(pos) : Promise.resolve());
        stream.writable = stream;
        return stream;
    }

    // ── Tier 4: Fallback In-Memory Accumulator ────────────────────────
    function createFallbackWriter(filename, expectedSize, options = {}) {
        const cleanName = sanitizeFilename(filename);
        const chunks = [];
        let totalBytes = 0;
        let isClosed = false;
        const guardrailLimit = options.maxGuardrailBytes || MAX_FALLBACK_GUARDRAIL_BYTES;

        const stream = new WritableStream({
            async write(chunk) {
                if (isClosed) throw new Error('Stream is already closed');
                const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

                if (totalBytes + data.byteLength > guardrailLimit) {
                    throw new Error(`StreamSaver: In-memory safety guardrail exceeded (${(guardrailLimit / 1048576).toFixed(0)} MB limit). Browser lacks streaming disk storage (FSA/SW/OPFS). Processing halted to prevent memory exhaustion.`);
                }

                chunks.push(data);
                totalBytes += data.byteLength;
                if (options.onProgress) options.onProgress(data.byteLength);
            },
            async close() {
                if (isClosed) return;
                isClosed = true;

                let blob = null;
                if (typeof Blob !== 'undefined') {
                    const ext = cleanName.toLowerCase().split('.').pop();
                    const mimeType = ext === 'zip' ? 'application/zip' : 'application/octet-stream';
                    blob = new Blob(chunks, { type: mimeType });
                    stream.resultBlob = blob;
                }

                if (blob && typeof URL !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = cleanName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => {
                        try { URL.revokeObjectURL(url); } catch (_) {}
                    }, 60000);
                }
            },
            async abort() {
                isClosed = true;
                chunks.length = 0;
            }
        });

        stream.tier = TIER_4_FALLBACK;
        stream.chunks = chunks;
        stream.writable = stream;
        return stream;
    }

    // ── Unified Public Interface Contract ────────────────────────────
    /**
     * Creates a multi-tier streaming writer for output download.
     * @param {string} filename - Output filename
     * @param {number} [expectedSize] - Total expected file size in bytes
     * @param {Object} [options] - Options and callbacks
     * @returns {Promise<WritableStream<Uint8Array>>}
     */
    async function createStreamWriter(filename, expectedSize = 0, options = {}) {
        const opts = options || {};
        const caps = detectCapabilities();
        const requestedTier = opts.tier || caps.recommendedTier;

        if (typeof opts.onTierSelected === 'function') {
            opts.onTierSelected(requestedTier);
        }

        // Tier 1: FileSystem Access API
        if (requestedTier === TIER_1_FSA && isTier1Supported()) {
            return createTier1Writer(filename, expectedSize, opts);
        }

        // Tier 2: Service Worker Stream Intercept
        if (requestedTier === TIER_2_SW && isTier2Supported()) {
            return createTier2Writer(filename, expectedSize, opts);
        }

        // Tier 3: OPFS Staging
        if (requestedTier === TIER_3_OPFS && isTier3Supported()) {
            return createTier3Writer(filename, expectedSize, opts);
        }

        // Tier 4: Fallback In-Memory Accumulator
        if (requestedTier === TIER_4_FALLBACK) {
            return createFallbackWriter(filename, expectedSize, opts);
        }

        // Graceful automatic downgrade chain if requested tier not supported
        if (isTier1Supported()) {
            if (typeof opts.onTierSelected === 'function') opts.onTierSelected(TIER_1_FSA);
            return createTier1Writer(filename, expectedSize, opts);
        }
        if (isTier2Supported()) {
            if (typeof opts.onTierSelected === 'function') opts.onTierSelected(TIER_2_SW);
            return createTier2Writer(filename, expectedSize, opts);
        }
        if (isTier3Supported()) {
            if (typeof opts.onTierSelected === 'function') opts.onTierSelected(TIER_3_OPFS);
            return createTier3Writer(filename, expectedSize, opts);
        }

        if (typeof opts.onTierSelected === 'function') opts.onTierSelected(TIER_4_FALLBACK);
        return createFallbackWriter(filename, expectedSize, opts);
    }

    return {
        createStreamWriter,
        detectCapabilities,
        sanitizeFilename,
        encodeRFC5987,
        encodeContentDisposition: encodeRFC5987,
        isTier1Supported,
        isTier2Supported,
        isTier3Supported,
        isIOS,
        createTier1Writer,
        createTier2Writer,
        createTier3Writer,
        createFallbackWriter,
        TIER_1_FSA,
        TIER_2_SW,
        TIER_3_OPFS,
        TIER_4_FALLBACK,
        MAX_FALLBACK_GUARDRAIL_BYTES
    };
}));
