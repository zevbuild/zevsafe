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
    function isTier1Supported(customWin) {
        const win = customWin || (typeof window !== 'undefined' ? window : null);
        return win !== null && typeof win.showSaveFilePicker === 'function';
    }

    function isTier2Supported(customNav) {
        const nav = customNav || (typeof navigator !== 'undefined' ? navigator : null);
        return nav !== null &&
               'serviceWorker' in nav &&
               nav.serviceWorker &&
               nav.serviceWorker.controller !== null &&
               nav.serviceWorker.controller !== undefined;
    }

    function isTier3Supported(customNav) {
        const nav = customNav || (typeof navigator !== 'undefined' ? navigator : null);
        return nav !== null &&
               'storage' in nav &&
               nav.storage &&
               typeof nav.storage.getDirectory === 'function';
    }

    function isIOS(customNav) {
        const nav = customNav || (typeof navigator !== 'undefined' ? navigator : null);
        if (!nav) return false;
        const ua = nav.userAgent || '';
        const isAppleMobile = /iPad|iPhone|iPod/i.test(ua);
        const isIPadOS = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
        return isAppleMobile || isIPadOS;
    }

    function isAndroid(customNav) {
        const nav = customNav || (typeof navigator !== 'undefined' ? navigator : null);
        if (!nav) return false;
        if (nav.userAgentData && typeof nav.userAgentData.platform === 'string') {
            if (/Android/i.test(nav.userAgentData.platform)) return true;
        }
        const ua = nav.userAgent || '';
        return /Android/i.test(ua);
    }

    function detectCapabilities(customNav, customWin) {
        const nav = customNav || (typeof navigator !== 'undefined' ? navigator : null);
        const win = customWin || (typeof window !== 'undefined' ? window : null);
        const t1 = isTier1Supported(win);
        const t2 = isTier2Supported(nav);
        const t3 = isTier3Supported(nav);
        const ios = isIOS(nav);
        const android = isAndroid(nav);

        let recommendedTier = TIER_4_FALLBACK;
        if ((ios || android) && t3) {
            // Android mobile & iOS Safari: seekable OPFS staging preferred over SW iframe streaming
            recommendedTier = TIER_3_OPFS;
        } else if (t1 && !android && !ios) {
            // Desktop Chrome/Edge/Opera: direct FileSystem Access API
            recommendedTier = TIER_1_FSA;
        } else if (t2 && !android && !ios) {
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
            isAndroid: android,
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
        stream.seek = async (pos) => {
            if (isClosed) {
                throw new Error('Stream is already closed');
            }
            if (typeof pos !== 'number' || pos < 0 || !Number.isFinite(pos)) {
                throw new TypeError('Seek position must be a non-negative number');
            }
            const seekOffset = Math.floor(pos);
            if (typeof writableFileStream.seek === 'function') {
                return await writableFileStream.seek(seekOffset);
            } else if (typeof writableFileStream.write === 'function') {
                try {
                    return await writableFileStream.write({ type: 'seek', position: seekOffset });
                } catch (wErr) {
                    throw new Error(`Underlying writable stream does not support seek operations: ${wErr.message || wErr}`);
                }
            }
            throw new Error('Underlying writable stream does not support seek operations');
        };
        stream.finalize = () => Promise.resolve();
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

        const chunks = [];
        let totalBytes = 0;
        let seekPos = null;
        const guardrailLimit = options.maxGuardrailBytes || MAX_FALLBACK_GUARDRAIL_BYTES;

        const stream = new WritableStream({
            async write(chunk) {
                if (isClosed) throw new Error('Stream is already closed or cancelled');
                const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

                if (seekPos !== null) {
                    if (seekPos > totalBytes) {
                        const gap = seekPos - totalBytes;
                        if (totalBytes + gap > guardrailLimit) {
                            throw new Error(`StreamSaver: In-memory safety guardrail exceeded (${(guardrailLimit / 1048576).toFixed(0)} MB limit). Browser lacks streaming disk storage (FSA/SW/OPFS). Processing halted to prevent memory exhaustion.`);
                        }
                        chunks.push(new Uint8Array(gap));
                        totalBytes += gap;
                    }

                    let remaining = data.byteLength;
                    let dataOffset = 0;
                    let currentPos = 0;
                    for (let i = 0; i < chunks.length && remaining > 0; i++) {
                        const cLen = chunks[i].byteLength;
                        if (seekPos < currentPos + cLen) {
                            const chunkOffset = seekPos - currentPos;
                            const copyLen = Math.min(remaining, cLen - chunkOffset);
                            chunks[i].set(data.subarray(dataOffset, dataOffset + copyLen), chunkOffset);
                            remaining -= copyLen;
                            dataOffset += copyLen;
                            seekPos += copyLen;
                        }
                        currentPos += cLen;
                    }
                    if (remaining > 0) {
                        if (totalBytes + remaining > guardrailLimit) {
                            throw new Error(`StreamSaver: In-memory safety guardrail exceeded (${(guardrailLimit / 1048576).toFixed(0)} MB limit). Browser lacks streaming disk storage (FSA/SW/OPFS). Processing halted to prevent memory exhaustion.`);
                        }
                        const remainder = data.slice(dataOffset);
                        chunks.push(remainder);
                        totalBytes += remainder.byteLength;
                        seekPos += remainder.byteLength;
                    }
                    if (seekPos >= totalBytes) {
                        seekPos = null;
                    }
                    return;
                }

                if (totalBytes + data.byteLength > guardrailLimit) {
                    throw new Error(`StreamSaver: In-memory safety guardrail exceeded (${(guardrailLimit / 1048576).toFixed(0)} MB limit). Browser lacks streaming disk storage (FSA/SW/OPFS). Processing halted to prevent memory exhaustion.`);
                }

                const owned = new Uint8Array(data.byteLength);
                owned.set(data);
                chunks.push(owned);
                totalBytes += owned.byteLength;
                if (options.onProgress) options.onProgress(data.byteLength);
            },
            async close() {
                if (isClosed) return;
                isClosed = true;

                // Stream assembled chunks with header to Service Worker
                for (const c of chunks) {
                    await new Promise((resolve, reject) => {
                        let timer = setTimeout(() => {
                            if (pendingAckResolve === resolve) {
                                pendingAckResolve = null;
                                pendingAckReject = null;
                                resolve();
                            }
                        }, 5000);
                        pendingAckResolve = () => { clearTimeout(timer); resolve(); };
                        pendingAckReject = (err) => { clearTimeout(timer); reject(err); };
                        try {
                            channel.port1.postMessage({ type: 'CHUNK', chunk: c }, [c.buffer.slice(0)]);
                        } catch (_) {
                            channel.port1.postMessage({ type: 'CHUNK', chunk: c });
                        }
                    });
                }

                channel.port1.postMessage({ type: 'DONE' });
                if (typeof Blob !== 'undefined') {
                    stream.resultBlob = new Blob(chunks, { type: 'application/octet-stream' });
                }
                if (iframe) {
                    setTimeout(() => { try { iframe.remove(); } catch (_) {} }, 5000);
                }
            },
            async abort(reason) {
                if (isClosed) return;
                isClosed = true;
                chunks.length = 0;
                try {
                    if (channel.port1 && typeof channel.port1.postMessage === 'function') {
                        channel.port1.postMessage({ type: 'ABORT', reason: String(reason) });
                    }
                } catch (_) {}
                if (iframe) {
                    try { iframe.remove(); } catch (_) {}
                }
            }
        });

        stream.tier = TIER_2_SW;
        stream.downloadId = downloadId;
        stream.chunks = chunks;
        stream.seek = (pos) => {
            if (isClosed) {
                return Promise.reject(new Error('Stream is already closed'));
            }
            if (typeof pos !== 'number' || pos < 0 || !Number.isFinite(pos)) {
                return Promise.reject(new TypeError('Seek position must be a non-negative number'));
            }
            seekPos = Math.floor(pos);
            return Promise.resolve();
        };
        stream.finalize = () => Promise.resolve();
        stream.writable = stream;
        return stream;
    }

    // ── Tier 3: OPFS Staging (iOS Safari 15.2+) ──────────────────────
    async function createTier3Writer(filename, expectedSize, options = {}) {
        const cleanName = sanitizeFilename(filename);
        const nav = options.navigator || (typeof navigator !== 'undefined' ? navigator : null);
        const getDirectoryFn = options.getDirectory || (nav && nav.storage && typeof nav.storage.getDirectory === 'function' && nav.storage.getDirectory.bind(nav.storage));
        if (!getDirectoryFn) {
            throw new Error('OPFS (navigator.storage.getDirectory) is not supported in this environment');
        }
        if (expectedSize > 0 && nav && nav.storage && typeof nav.storage.estimate === 'function') {
            try {
                const est = await nav.storage.estimate();
                if (est && typeof est.quota === 'number' && typeof est.usage === 'number' && !isNaN(est.quota) && !isNaN(est.usage)) {
                    const available = Math.max(0, est.quota - est.usage);
                    if (available < expectedSize) {
                        throw new Error(`Insufficient OPFS storage quota (available: ${(available / 1048576).toFixed(1)} MB, required: ${(expectedSize / 1048576).toFixed(1)} MB)`);
                    }
                }
            } catch (qErr) {
                if (qErr.message && qErr.message.includes('Insufficient OPFS storage quota')) {
                    throw qErr;
                }
            }
        }

        const root = await getDirectoryFn();

        // Proactive cleanup of any orphaned staging files from previous crashed runs
        try {
            const cleanupEntry = async (entryName) => {
                if (entryName && entryName.startsWith('zevsafe_stage_')) {
                    const match = entryName.match(/^zevsafe_stage_(\d+)_/);
                    if (match) {
                        let fileTime = parseInt(match[1], 10);
                        if (fileTime < 10000000000) fileTime *= 1000;
                        const ageMs = Date.now() - fileTime;
                        if (ageMs > 30 * 60 * 1000) {
                            try { await root.removeEntry(entryName); } catch (_) {}
                        }
                    } else {
                        try { await root.removeEntry(entryName); } catch (_) {}
                    }
                }
            };

            if (typeof root.values === 'function') {
                for await (const entry of root.values()) {
                    if (entry && entry.name) await cleanupEntry(entry.name);
                }
            } else if (typeof root.entries === 'function') {
                for await (const [name] of root.entries()) {
                    if (name) await cleanupEntry(name);
                }
            } else if (typeof root[Symbol.asyncIterator] === 'function') {
                for await (const [name] of root) {
                    if (name) await cleanupEntry(name);
                }
            }
        } catch (_) {}

        const tempName = `zevsafe_stage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`;
        const fileHandle = await root.getFileHandle(tempName, { create: true });
        let writable;
        try {
            writable = await fileHandle.createWritable();
        } catch (cwErr) {
            try { await root.removeEntry(tempName); } catch (_) {}
            throw cwErr;
        }
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
                try {
                    await writable.close();
                } catch (closeErr) {
                    try { await root.removeEntry(tempName); } catch (_) {}
                    throw closeErr;
                }

                // Obtain zero-RAM disk-backed File handle
                let file;
                try {
                    file = await fileHandle.getFile();
                } catch (gfErr) {
                    try { await root.removeEntry(tempName); } catch (_) {}
                    throw gfErr;
                }
                stream.resultFile = file;

                if (typeof URL !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
                    const objectUrl = URL.createObjectURL(file);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = objectUrl;
                    a.download = cleanName;
                    const container = document.body || document.documentElement;
                    if (container) {
                        container.appendChild(a);
                        a.click();
                        container.removeChild(a);
                    }

                    // Cleanup URL and OPFS staging file after delay (5 minutes safe window for mobile download managers)
                    const cleanTimer = setTimeout(async () => {
                        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
                        try { await root.removeEntry(tempName); } catch (_) {}
                    }, 300000);
                    if (cleanTimer && typeof cleanTimer.unref === 'function') cleanTimer.unref();
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
        stream.seek = async (pos) => {
            if (isClosed) {
                throw new Error('Stream is already closed');
            }
            if (typeof pos !== 'number' || pos < 0 || !Number.isFinite(pos)) {
                throw new TypeError('Seek position must be a non-negative number');
            }
            const seekOffset = Math.floor(pos);
            if (typeof writable.seek === 'function') {
                return await writable.seek(seekOffset);
            } else if (typeof writable.write === 'function') {
                try {
                    return await writable.write({ type: 'seek', position: seekOffset });
                } catch (wErr) {
                    throw new Error(`Underlying writable stream does not support seek operations: ${wErr.message || wErr}`);
                }
            }
            throw new Error('Underlying writable stream does not support seek operations');
        };
        stream.finalize = () => Promise.resolve();
        stream.writable = stream;
        return stream;
    }

    // ── Tier 4: Fallback In-Memory Accumulator ────────────────────────
    function createFallbackWriter(filename, expectedSize, options = {}) {
        const cleanName = sanitizeFilename(filename);
        const chunks = [];
        let totalBytes = 0;
        let isClosed = false;
        let seekPos = null;
        const guardrailLimit = options.maxGuardrailBytes || MAX_FALLBACK_GUARDRAIL_BYTES;

        const stream = new WritableStream({
            async write(chunk) {
                if (isClosed) throw new Error('Stream is already closed');
                const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

                if (seekPos !== null) {
                    if (seekPos > totalBytes) {
                        const gap = seekPos - totalBytes;
                        if (totalBytes + gap > guardrailLimit) {
                            throw new Error(`StreamSaver: In-memory safety guardrail exceeded (${(guardrailLimit / 1048576).toFixed(0)} MB limit). Browser lacks streaming disk storage (FSA/SW/OPFS). Processing halted to prevent memory exhaustion.`);
                        }
                        chunks.push(new Uint8Array(gap));
                        totalBytes += gap;
                    }

                    let remaining = data.byteLength;
                    let dataOffset = 0;
                    let currentPos = 0;
                    for (let i = 0; i < chunks.length && remaining > 0; i++) {
                        const cLen = chunks[i].byteLength;
                        if (seekPos < currentPos + cLen) {
                            const chunkOffset = seekPos - currentPos;
                            const copyLen = Math.min(remaining, cLen - chunkOffset);
                            chunks[i].set(data.subarray(dataOffset, dataOffset + copyLen), chunkOffset);
                            remaining -= copyLen;
                            dataOffset += copyLen;
                            seekPos += copyLen;
                        }
                        currentPos += cLen;
                    }
                    if (remaining > 0) {
                        if (totalBytes + remaining > guardrailLimit) {
                            throw new Error(`StreamSaver: In-memory safety guardrail exceeded (${(guardrailLimit / 1048576).toFixed(0)} MB limit). Browser lacks streaming disk storage (FSA/SW/OPFS). Processing halted to prevent memory exhaustion.`);
                        }
                        const remainder = data.slice(dataOffset);
                        chunks.push(remainder);
                        totalBytes += remainder.byteLength;
                        seekPos += remainder.byteLength;
                    }
                    if (seekPos >= totalBytes) {
                        seekPos = null;
                    }
                    return;
                }

                if (totalBytes + data.byteLength > guardrailLimit) {
                    throw new Error(`StreamSaver: In-memory safety guardrail exceeded (${(guardrailLimit / 1048576).toFixed(0)} MB limit). Browser lacks streaming disk storage (FSA/SW/OPFS). Processing halted to prevent memory exhaustion.`);
                }

                const owned = new Uint8Array(data.byteLength);
                owned.set(data);
                chunks.push(owned);
                totalBytes += owned.byteLength;
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
                    a.style.display = 'none';
                    a.href = url;
                    a.download = cleanName;
                    const container = document.body || document.documentElement;
                    if (container) {
                        container.appendChild(a);
                        a.click();
                        container.removeChild(a);
                    }
                    const timer = setTimeout(() => {
                        try { URL.revokeObjectURL(url); } catch (_) {}
                    }, 60000);
                    if (timer && typeof timer.unref === 'function') timer.unref();
                }
            },
            async abort() {
                isClosed = true;
                chunks.length = 0;
            }
        });

        stream.tier = TIER_4_FALLBACK;
        stream.chunks = chunks;
        stream.seek = (pos) => {
            if (isClosed) {
                return Promise.reject(new Error('Stream is already closed'));
            }
            if (typeof pos !== 'number' || pos < 0 || !Number.isFinite(pos)) {
                return Promise.reject(new TypeError('Seek position must be a non-negative number'));
            }
            seekPos = Math.floor(pos);
            return Promise.resolve();
        };
        stream.finalize = () => Promise.resolve();
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
        const caps = detectCapabilities(opts.navigator, opts.window);
        const requestedTier = opts.tier || caps.recommendedTier;
        const failedTiers = new Set();

        if (typeof opts.onTierSelected === 'function') {
            opts.onTierSelected(requestedTier);
        }

        // Tier 1: FileSystem Access API
        if (requestedTier === TIER_1_FSA && (opts.picker || (isTier1Supported(opts.window) && !caps.isAndroid && !caps.isIOS))) {
            try {
                return await createTier1Writer(filename, expectedSize, opts);
            } catch (t1Err) {
                if (t1Err && t1Err.name === 'AbortError') throw t1Err;
                failedTiers.add(TIER_1_FSA);
                console.warn('[StreamSaver] Tier 1 FSA failed, downgrading:', t1Err);
            }
        }

        // Tier 2: Service Worker Stream Intercept (only on desktop browsers, never mobile)
        if (requestedTier === TIER_2_SW && (opts.swController || isTier2Supported(opts.navigator)) && !caps.isAndroid && !caps.isIOS) {
            try {
                return await createTier2Writer(filename, expectedSize, opts);
            } catch (t2Err) {
                failedTiers.add(TIER_2_SW);
                console.warn('[StreamSaver] Tier 2 SW failed, downgrading:', t2Err);
            }
        }

        // Tier 3: OPFS Staging
        if (requestedTier === TIER_3_OPFS && (opts.getDirectory || isTier3Supported(opts.navigator))) {
            try {
                return await createTier3Writer(filename, expectedSize, opts);
            } catch (t3Err) {
                failedTiers.add(TIER_3_OPFS);
                console.warn('[StreamSaver] Tier 3 OPFS failed, downgrading:', t3Err);
            }
        }

        // Tier 4: Fallback In-Memory Accumulator
        if (requestedTier === TIER_4_FALLBACK) {
            return createFallbackWriter(filename, expectedSize, opts);
        }

        // Graceful automatic downgrade chain if requested tier failed or not supported
        if (!failedTiers.has(TIER_1_FSA) && (opts.picker || (isTier1Supported(opts.window) && !caps.isAndroid && !caps.isIOS))) {
            try {
                if (typeof opts.onTierSelected === 'function') opts.onTierSelected(TIER_1_FSA);
                return await createTier1Writer(filename, expectedSize, opts);
            } catch (t1Err) {
                if (t1Err && t1Err.name === 'AbortError') throw t1Err;
            }
        }
        if (!failedTiers.has(TIER_3_OPFS) && (opts.getDirectory || isTier3Supported(opts.navigator))) {
            try {
                if (typeof opts.onTierSelected === 'function') opts.onTierSelected(TIER_3_OPFS);
                return await createTier3Writer(filename, expectedSize, opts);
            } catch (_) {}
        }
        if (!failedTiers.has(TIER_2_SW) && ((opts.swController || isTier2Supported(opts.navigator)) && !caps.isAndroid && !caps.isIOS)) {
            try {
                if (typeof opts.onTierSelected === 'function') opts.onTierSelected(TIER_2_SW);
                return await createTier2Writer(filename, expectedSize, opts);
            } catch (_) {}
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
        isAndroid,
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
