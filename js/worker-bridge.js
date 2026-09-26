/**
 * ZevSafe v3 Worker Pipeline & Telemetry Infrastructure Bridge
 * js/worker-bridge.js
 *
 * Implements main-thread orchestrator for background Web Workers:
 * - Spawns & manages worker lifecycle across modern browsers & Node.js (worker_threads / shim).
 * - Correlated async postMessage communication with Transferable ArrayBuffers (zero-copy).
 * - Credit-based ACK Flow Control: bounded credit window (max 2-4 in-flight chunks), peak heap < 150 MB.
 * - 60 FPS Telemetry Calculator: throttled to ~100 ms, emitting percent, stage, rolling throughputMBs,
 *   elapsedSec, dynamic etaSec, processedBytes, totalBytes.
 * - Public APIs: startEncryption, startDecryption, extractSingleFile.
 * - Clean cooperative cancellation and resource disposal.
 */

(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        const exports = factory();
        root.WorkerBridge = exports;
        if (typeof globalThis !== 'undefined') {
            globalThis.WorkerBridge = exports;
        }
    }
}(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    // =========================================================================
    // DEPENDENCY RESOLUTION
    // =========================================================================

    function getStreamCrypto() {
        if (typeof StreamCrypto !== 'undefined') return StreamCrypto;
        if (typeof globalThis !== 'undefined' && globalThis.StreamCrypto) return globalThis.StreamCrypto;
        if (typeof require === 'function') {
            try { return require('./stream-crypto.js'); } catch (_) {}
            try { return require('../js/stream-crypto.js'); } catch (_) {}
        }
        throw new Error('StreamCrypto module is required but could not be loaded');
    }

    function getStreamPacker() {
        if (typeof StreamPacker !== 'undefined') return StreamPacker;
        if (typeof globalThis !== 'undefined' && globalThis.StreamPacker) return globalThis.StreamPacker;
        if (typeof require === 'function') {
            try { return require('./stream-packer.js'); } catch (_) {}
            try { return require('../js/stream-packer.js'); } catch (_) {}
        }
        throw new Error('StreamPacker module is required but could not be loaded');
    }

    function getStreamUnpacker() {
        if (typeof StreamUnpacker !== 'undefined') return StreamUnpacker;
        if (typeof globalThis !== 'undefined' && globalThis.StreamUnpacker) return globalThis.StreamUnpacker;
        if (typeof require === 'function') {
            try { return require('./stream-unpacker.js'); } catch (_) {}
            try { return require('../js/stream-unpacker.js'); } catch (_) {}
        }
        throw new Error('StreamUnpacker module is required but could not be loaded');
    }

    function getHiResTime() {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    // =========================================================================
    // CREDIT-BASED ACK FLOW CONTROLLER
    // =========================================================================

    /**
     * Bounded credit-window flow controller for streaming pipelines.
     * Restricts in-flight unacknowledged chunks between main thread and worker
     * to a maximum threshold (default 2), preventing memory accumulation
     * during multi-gigabyte operations and ensuring peak heap < 150 MB.
     */
    class CreditFlowController {
        /**
         * @param {number} [maxCredits=2] - Maximum in-flight chunks allowed (e.g. 2-4)
         */
        constructor(maxCredits = 2) {
            this.maxCredits = Math.max(1, maxCredits);
            this.availableCredits = this.maxCredits;
            this.inFlight = 0;
            this.waiters = [];
            this.maxInFlightObserved = 0;
            this.totalAcquired = 0;
            this.totalReleased = 0;
        }

        /**
         * Acquires a processing credit. If available credits are exhausted,
         * suspends the caller until an in-flight chunk is released via ACK.
         * @returns {Promise<void>}
         */
        async acquire() {
            if (this.availableCredits > 0 && this.waiters.length === 0) {
                this.availableCredits--;
                this.inFlight++;
                this.totalAcquired++;
                if (this.inFlight > this.maxInFlightObserved) {
                    this.maxInFlightObserved = this.inFlight;
                }
                return;
            }

            await new Promise((resolve) => {
                this.waiters.push(resolve);
            });

            this.totalAcquired++;
            if (this.inFlight > this.maxInFlightObserved) {
                this.maxInFlightObserved = this.inFlight;
            }
        }

        /**
         * Releases a credit when worker acknowledges completion of a chunk.
         * Resumes next queued chunk reader if any are waiting, directly handing off
         * the credit to avoid microtask race conditions where concurrent acquire() steals it.
         */
        release() {
            this.totalReleased++;

            if (this.waiters.length > 0) {
                const nextWaiter = this.waiters.shift();
                nextWaiter();
            } else {
                this.inFlight = Math.max(0, this.inFlight - 1);
                this.availableCredits = Math.min(this.maxCredits, this.availableCredits + 1);
            }
        }

        /**
         * Returns snapshot of flow control metrics.
         * @returns {{ maxCredits: number, availableCredits: number, inFlight: number, maxInFlightObserved: number, waitersCount: number }}
         */
        getStats() {
            return {
                maxCredits: this.maxCredits,
                availableCredits: this.availableCredits,
                inFlight: this.inFlight,
                maxInFlightObserved: this.maxInFlightObserved,
                waitersCount: this.waiters.length,
                totalAcquired: this.totalAcquired,
                totalReleased: this.totalReleased
            };
        }
    }

    // =========================================================================
    // 60 FPS REAL-TIME TELEMETRY CALCULATOR
    // =========================================================================

    /**
     * Calculates real-time progress metrics throttled to ~100 ms intervals:
     * - percent (0..100)
     * - stage (descriptive current phase)
     * - throughputMBs (rolling average MB/s over sliding 2s window)
     * - elapsedSec (seconds since start)
     * - etaSec (estimated seconds remaining)
     * - processedBytes, totalBytes
     */
    class TelemetryCalculator {
        /**
         * @param {Object} [options={}]
         * @param {number} [options.totalBytes=0]
         * @param {number} [options.throttleMs=100]
         * @param {Function} [options.onProgress=null]
         */
        constructor({ totalBytes = 0, throttleMs = 100, onProgress = null } = {}) {
            this.totalBytes = Math.max(0, totalBytes);
            this.throttleMs = Math.max(10, throttleMs);
            this.onProgress = typeof onProgress === 'function' ? onProgress : null;
            this.startTime = getHiResTime();
            this.lastEmitTime = 0;
            this.processedBytes = 0;
            this.stage = 'Initializing...';
            this.samples = []; // sliding window: [{ time: number, bytes: number }]
            this.windowMs = 2000; // 2-second window for rolling throughput
            this.timer = null;
        }

        setTotalBytes(bytes) {
            this.totalBytes = Math.max(0, bytes);
        }

        setStage(stage, forceEmit = false) {
            this.stage = stage;
            const now = getHiResTime();
            const minThrottleMs = 50;
            const elapsed = now - this.lastEmitTime;

            if (forceEmit) {
                if (this.lastEmitTime === 0 || elapsed >= minThrottleMs) {
                    this.notify(true);
                } else if (!this.timer) {
                    const delay = Math.max(10, Math.ceil(minThrottleMs - elapsed + 5));
                    this.timer = setTimeout(() => {
                        this.timer = null;
                        this.lastEmitTime = getHiResTime();
                        if (this.onProgress) {
                            try {
                                this.onProgress(this.getMetrics());
                            } catch (_) {}
                        }
                    }, delay);
                }
            } else {
                this.notify(false);
            }
        }

        recordProgress(bytesAdded, forceEmit = false) {
            this.processedBytes += bytesAdded;
            const now = getHiResTime();
            this.samples.push({ time: now, bytes: this.processedBytes });

            // Prune samples older than rolling window
            const cutoff = now - this.windowMs;
            while (this.samples.length > 2 && this.samples[0].time < cutoff) {
                this.samples.shift();
            }

            this.notify(forceEmit);
        }

        computeThroughput() {
            const now = getHiResTime();
            const elapsedSec = Math.max(0.001, (now - this.startTime) / 1000);

            if (this.samples.length >= 2) {
                const first = this.samples[0];
                const last = this.samples[this.samples.length - 1];
                const dt = (last.time - first.time) / 1000;
                const db = last.bytes - first.bytes;
                if (dt >= 0.05 && db >= 0) {
                    const mbPerSec = (db / (1024 * 1024)) / dt;
                    return Math.max(0, +mbPerSec.toFixed(2));
                }
            }

            // Fallback to cumulative average
            const cumulativeMBs = (this.processedBytes / (1024 * 1024)) / elapsedSec;
            return Math.max(0, +cumulativeMBs.toFixed(2));
        }

        getMetrics() {
            const now = getHiResTime();
            const elapsedSec = +((now - this.startTime) / 1000).toFixed(2);
            let percent = 0;
            if (this.stage === 'Complete') {
                percent = 100;
            } else if (this.totalBytes > 0) {
                percent = Math.min(100, Math.max(0, +((this.processedBytes / this.totalBytes) * 100).toFixed(1)));
            }

            const throughputMBs = this.computeThroughput();

            let etaSec = 0;
            if (this.stage !== 'Complete' && this.totalBytes > 0 && percent < 100) {
                const remainingBytes = Math.max(0, this.totalBytes - this.processedBytes);
                if (throughputMBs > 0) {
                    etaSec = +(remainingBytes / (throughputMBs * 1024 * 1024)).toFixed(1);
                }
            }

            return {
                percent,
                stage: this.stage,
                throughputMBs,
                elapsedSec,
                etaSec,
                processedBytes: (this.stage === 'Complete' && this.totalBytes > 0) ? this.totalBytes : this.processedBytes,
                totalBytes: this.totalBytes
            };
        }

        notify(forceEmit = false) {
            if (!this.onProgress) return;
            const now = getHiResTime();

            if (forceEmit || now - this.lastEmitTime >= this.throttleMs) {
                if (this.timer) {
                    clearTimeout(this.timer);
                    this.timer = null;
                }
                this.lastEmitTime = now;
                try {
                    this.onProgress(this.getMetrics());
                } catch (_) {}
            } else if (!this.timer) {
                // Trailing edge notification
                const delay = Math.max(10, Math.ceil(this.throttleMs - (now - this.lastEmitTime)));
                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.lastEmitTime = getHiResTime();
                    if (this.onProgress) {
                        try {
                            this.onProgress(this.getMetrics());
                        } catch (_) {}
                    }
                }, delay);
            }
        }

        dispose() {
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }
        }
    }

    // =========================================================================
    // UNIFIED WORKER MANAGEMENT & MESSAGE CORRELATION
    // =========================================================================

    /**
     * Unified wrapper normalizing Web Worker and node:worker_threads interfaces.
     */
    class UnifiedWorkerWrapper {
        constructor(rawWorker, isNode) {
            this.rawWorker = rawWorker;
            this.isNode = isNode;
            this.onmessage = null;
            this.onerror = null;

            if (isNode) {
                rawWorker.on('message', (data) => {
                    if (typeof this.onmessage === 'function') {
                        this.onmessage({ data });
                    }
                });
                rawWorker.on('error', (err) => {
                    if (typeof this.onerror === 'function') {
                        this.onerror(err);
                    }
                });
            } else {
                rawWorker.onmessage = (e) => {
                    if (typeof this.onmessage === 'function') {
                        this.onmessage(e);
                    }
                };
                rawWorker.onerror = (e) => {
                    if (typeof this.onerror === 'function') {
                        this.onerror(e);
                    }
                };
            }
        }

        postMessage(data, transferList = []) {
            if (this.isNode) {
                // In Node worker_threads, transferList must contain ArrayBuffers or MessagePorts
                const validTransfers = (transferList || []).filter(item => {
                    return item instanceof ArrayBuffer || (typeof MessagePort !== 'undefined' && item instanceof MessagePort);
                });
                this.rawWorker.postMessage(data, validTransfers);
            } else {
                this.rawWorker.postMessage(data, transferList);
            }
        }

        terminate() {
            if (this._pendingRequestIds) {
                for (const reqId of this._pendingRequestIds) {
                    if (workerPromises.has(reqId)) {
                        const { timer, reject } = workerPromises.get(reqId);
                        if (timer) clearTimeout(timer);
                        workerPromises.delete(reqId);
                        reject(new Error('Operation cancelled'));
                    }
                }
                this._pendingRequestIds.clear();
            }
            if (this.isNode && typeof this.rawWorker.unref === 'function') {
                try { this.rawWorker.unref(); } catch (_) {}
            }
            if (typeof this.rawWorker.terminate === 'function') {
                return this.rawWorker.terminate();
            }
        }
    }

    /**
     * Fallback async worker shim for headless or restricted environments.
     */
    function createAsyncWorkerShim(workerModule) {
        let handler = workerModule;
        if (!handler && typeof require === 'function') {
            try { handler = require('./crypto-worker.js'); } catch (_) {
                try { handler = require('../js/crypto-worker.js'); } catch (__) {}
            }
        }

        const shim = {
            onmessage: null,
            onerror: null,
            postMessage(data, transferList = []) {
                queueMicrotask(async () => {
                    try {
                        if (handler && typeof handler.processIncomingMessage === 'function') {
                            await handler.processIncomingMessage(data, (reply, transfer) => {
                                if (typeof shim.onmessage === 'function') {
                                    shim.onmessage({ data: reply });
                                }
                            });
                        } else {
                            throw new Error('Worker handler processIncomingMessage is not available');
                        }
                    } catch (err) {
                        if (typeof shim.onerror === 'function') {
                            shim.onerror(err);
                        }
                    }
                });
            },
            terminate() {
                // In-process shim clean up
            }
        };
        return shim;
    }

    /**
     * Spawns worker using the optimal mechanism for the current environment:
     * - Node.js: node:worker_threads
     * - Browser: Web Worker
     * - Fallback / Shim: AsyncWorkerShim
     *
     * @param {Object} [options={}]
     * @returns {UnifiedWorkerWrapper|Object}
     */
    function createWorker(options = {}) {
        if (options && options.useShim) {
            return createAsyncWorkerShim(options.workerModule);
        }

        const isNodeEnv = typeof process !== 'undefined' && process.versions && !!process.versions.node;

        if (isNodeEnv) {
            try {
                const wt = require('node:worker_threads');
                const path = require('node:path');
                let workerScript = options.workerPath;
                if (!workerScript) {
                    workerScript = path.resolve(__dirname, 'crypto-worker.js');
                }
                const rawWorker = new wt.Worker(workerScript);
                return new UnifiedWorkerWrapper(rawWorker, true);
            } catch (err) {
                // If worker_threads fails (e.g. bundle restrictions), fallback to async shim
                return createAsyncWorkerShim(options.workerModule);
            }
        }

        // Browser Web Worker scope
        if (typeof Worker !== 'undefined') {
            let workerUrl = options.workerUrl || options.workerPath;
            if (!workerUrl) {
                if (typeof location !== 'undefined' && location.pathname && location.pathname.includes('/test/')) {
                    workerUrl = '../js/crypto-worker.js';
                } else {
                    workerUrl = 'js/crypto-worker.js';
                }
            }
            try {
                const raw = new Worker(workerUrl);
                return new UnifiedWorkerWrapper(raw, false);
            } catch (err) {
                return createAsyncWorkerShim(options.workerModule);
            }
        }

        return createAsyncWorkerShim(options.workerModule);
    }

    let messageIdSequence = 0;
    const workerPromises = new Map();

    /**
     * Sends a correlated request to a worker and awaits the matching ACK.
     *
     * @param {UnifiedWorkerWrapper|Object} worker
     * @param {Object} message - Payload with { type, ... }
     * @param {Array<Transferable>} [transferList=[]]
     * @returns {Promise<any>}
     */
    function sendWorkerRequest(worker, message, transferList = []) {
        return new Promise((resolve, reject) => {
            const id = ++messageIdSequence;
            const timeoutMs = message.timeoutMs || 120000;

            const timer = setTimeout(() => {
                if (workerPromises.has(id)) {
                    workerPromises.delete(id);
                    if (worker._pendingRequestIds) worker._pendingRequestIds.delete(id);
                    reject(new Error(`Worker request "${message.type}" (id: ${id}) timed out after ${timeoutMs} ms`));
                }
            }, timeoutMs);

            if (typeof timer.unref === 'function') {
                timer.unref();
            }

            if (!worker._pendingRequestIds) {
                worker._pendingRequestIds = new Set();
            }
            worker._pendingRequestIds.add(id);

            workerPromises.set(id, { resolve, reject, timer, worker });

            // Attach message listener once
            if (!worker._hasBridgeListener) {
                worker._hasBridgeListener = true;
                const existingOnMessage = worker.onmessage;

                worker.onmessage = (event) => {
                    const data = event && event.data ? event.data : event;
                    if (data && data.id && workerPromises.has(data.id)) {
                        const { resolve: res, reject: rej, timer: t } = workerPromises.get(data.id);
                        clearTimeout(t);
                        workerPromises.delete(data.id);
                        if (worker._pendingRequestIds) worker._pendingRequestIds.delete(data.id);

                        if (data.success) {
                            res(data);
                        } else {
                            const err = new Error(data.error?.message || 'Worker operation failed');
                            err.name = data.error?.name || 'WorkerError';
                            err.stack = data.error?.stack || err.stack;
                            rej(err);
                        }
                    }
                    if (typeof existingOnMessage === 'function') {
                        existingOnMessage(event);
                    }
                };

                const existingOnError = worker.onerror;
                worker.onerror = (err) => {
                    // Reject all pending promises on fatal worker error
                    for (const [pendId, { reject: rej, timer: t }] of workerPromises.entries()) {
                        clearTimeout(t);
                        rej(new Error(`Worker encountered fatal error: ${err?.message || err}`));
                    }
                    workerPromises.clear();
                    if (typeof existingOnError === 'function') {
                        existingOnError(err);
                    }
                };
            }

            try {
                worker.postMessage({ ...message, id }, transferList);
            } catch (err) {
                clearTimeout(timer);
                workerPromises.delete(id);
                reject(err);
            }
        });
    }

    // =========================================================================
    // BUFFER & MANIFEST HELPERS
    // =========================================================================

    function concatBuffers(a, b) {
        if (!a || a.byteLength === 0) return b || new Uint8Array(0);
        if (!b || b.byteLength === 0) return a || new Uint8Array(0);
        const out = new Uint8Array(a.byteLength + b.byteLength);
        out.set(a instanceof Uint8Array ? a : new Uint8Array(a), 0);
        out.set(b instanceof Uint8Array ? b : new Uint8Array(b), a.byteLength);
        return out;
    }

    function concatAll(buffers) {
        let total = 0;
        for (const b of buffers) {
            if (b) total += b.byteLength;
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const b of buffers) {
            if (b && b.byteLength > 0) {
                out.set(b instanceof Uint8Array ? b : new Uint8Array(b), offset);
                offset += b.byteLength;
            }
        }
        return out;
    }

    /**
     * Parses Central Directory records from raw ZIP bytes to construct
     * the authoritative files catalog for the encrypted manifest trailer.
     *
     * @param {Uint8Array} zipBytes - Full or tail ZIP stream bytes
     * @param {number} chunkSize - Plaintext chunk size (e.g. 4 MB)
     * @returns {Array<Object>} Catalog files array
     */
    function parseCentralDirectoryEntries(zipBytes, chunkSize) {
        const catalogFiles = [];
        const len = zipBytes.length;

        for (let i = 0; i <= len - 46; i++) {
            // Central Directory Header Signature: 0x02014b50
            if (zipBytes[i] === 0x50 && zipBytes[i+1] === 0x4B && zipBytes[i+2] === 0x01 && zipBytes[i+3] === 0x02) {
                const method = zipBytes[i + 10] | (zipBytes[i + 11] << 8);
                const crc = (zipBytes[i + 16] | (zipBytes[i + 17] << 8) | (zipBytes[i + 18] << 16) | (zipBytes[i + 19] << 24)) >>> 0;
                let compSize = (zipBytes[i + 20] | (zipBytes[i + 21] << 8) | (zipBytes[i + 22] << 16) | (zipBytes[i + 23] << 24)) >>> 0;
                let uncompSize = (zipBytes[i + 24] | (zipBytes[i + 25] << 8) | (zipBytes[i + 26] << 16) | (zipBytes[i + 27] << 24)) >>> 0;
                const nameLen = zipBytes[i + 28] | (zipBytes[i + 29] << 8);
                const extraLen = zipBytes[i + 30] | (zipBytes[i + 31] << 8);
                let offset = (zipBytes[i + 42] | (zipBytes[i + 43] << 8) | (zipBytes[i + 44] << 16) | (zipBytes[i + 45] << 24)) >>> 0;

                const nameBytes = zipBytes.subarray(i + 46, i + 46 + nameLen);
                const name = new TextDecoder().decode(nameBytes);

                // Check for ZIP64 Extra Field (0x0001) if standard fields overflow
                if (extraLen > 0 && i + 46 + nameLen + extraLen <= len) {
                    const extra = zipBytes.subarray(i + 46 + nameLen, i + 46 + nameLen + extraLen);
                    let ePos = 0;
                    while (ePos + 4 <= extra.length) {
                        const tag = extra[ePos] | (extra[ePos + 1] << 8);
                        const size = extra[ePos + 2] | (extra[ePos + 3] << 8);
                        if (tag === 0x0001) {
                            const eView = new DataView(extra.buffer, extra.byteOffset + ePos + 4, size);
                            let vPos = 0;
                            if (uncompSize === 0xFFFFFFFF && vPos + 8 <= size) {
                                uncompSize = Number(eView.getBigUint64(vPos, true));
                                vPos += 8;
                            }
                            if (compSize === 0xFFFFFFFF && vPos + 8 <= size) {
                                compSize = Number(eView.getBigUint64(vPos, true));
                                vPos += 8;
                            }
                            if (offset === 0xFFFFFFFF && vPos + 8 <= size) {
                                offset = Number(eView.getBigUint64(vPos, true));
                                vPos += 8;
                            }
                            break;
                        }
                        ePos += 4 + size;
                    }
                }

                const chunkStart = Math.floor(offset / chunkSize);
                const chunkEnd = Math.floor((offset + 30 + nameLen + extraLen + compSize - 1) / chunkSize);

                catalogFiles.push({
                    path: name,
                    name: name,
                    size: uncompSize,
                    compressedSize: compSize,
                    offset: offset,
                    localHeaderOffset: offset,
                    compressed: method === 8,
                    compressionMethod: method,
                    chunkStart: chunkStart,
                    chunkEnd: Math.max(chunkStart, chunkEnd),
                    crc32: crc
                });

                // Advance past this central directory entry
                i += 45 + nameLen + extraLen;
            }
        }

        return catalogFiles;
    }

    // =========================================================================
    // PUBLIC API IMPLEMENTATIONS
    // =========================================================================

    /**
     * Starts streaming encryption of files into a v3 STREAM AEAD container:
     * - Spawns background worker and derives PBKDF2-SHA512 master key off the main thread.
     * - Streams ZIP64 packaging with native DEFLATE compression.
     * - Credit-based flow control restricts in-flight chunks (max 2-4), keeping heap < 150 MB.
     * - 60 FPS real-time telemetry emitted at ~100 ms intervals.
     * - Builds encrypted manifest trailer and finalizes container header.
     *
     * @param {Object} params
     * @param {Array<Object|File>} params.files
     * @param {string} params.password
     * @param {File|Uint8Array|ArrayBuffer|null} [params.keyfile=null]
     * @param {Function} [params.onProgress=null]
     * @param {Function} [params.onComplete=null]
     * @param {Function} [params.onError=null]
     * @param {Object} [params.options={}]
     * @returns {{ cancel: Function, getFlowStats: Function }}
     */
    function startEncryption({
        files,
        password,
        keyfile = null,
        onProgress = null,
        onComplete = null,
        onError = null,
        options = {}
    }) {
        const opts = options || {};
        let cancelled = false;
        let hasError = false;
        let fatalError = null;
        let worker = null;
        let flowController = null;
        let telemetry = null;
        let zipReader = null;
        let writer = null;

        if (opts.writable) {
            if (typeof opts.writable.getWriter === 'function') {
                writer = opts.writable.getWriter();
            } else if (typeof opts.writable.write === 'function') {
                writer = opts.writable;
            }
        }

        const handleFatalError = async (err) => {
            if (hasError || cancelled) return;
            hasError = true;
            cancelled = true;
            fatalError = err;

            if (telemetry) {
                try { telemetry.setStage('Error', true); } catch (_) {}
                telemetry.dispose();
            }

            if (zipReader) {
                try { await zipReader.cancel(err).catch(() => {}); } catch (_) {}
            }

            if (writer && typeof writer.abort === 'function') {
                try { await writer.abort(err).catch(() => {}); } catch (_) {}
            } else if (opts.writable && typeof opts.writable.abort === 'function') {
                try { await opts.writable.abort(err).catch(() => {}); } catch (_) {}
            }

            if (worker) {
                try { worker.terminate(); } catch (_) {}
            }

            if (typeof onError === 'function') {
                try { onError(err); } catch (_) {}
            }
        };

        const transitionStage = async (stage) => {
            if (cancelled || hasError) return;
            if (telemetry) {
                const minInterval = 65; // Safe margin above 50 ms floor against Windows timer resolution jitter
                while (telemetry.lastEmitTime > 0) {
                    const elapsed = getHiResTime() - telemetry.lastEmitTime;
                    if (elapsed < minInterval) {
                        await new Promise(r => setTimeout(r, Math.max(10, Math.ceil(minInterval - elapsed))));
                    } else {
                        break;
                    }
                }
                if (cancelled || hasError) return;
                telemetry.setStage(stage, true);
            }
        };

        const cancel = async () => {
            if (cancelled || hasError) return;
            cancelled = true;
            try {
                if (telemetry) telemetry.setStage('Cancelled', true);
                if (zipReader) {
                    try { await zipReader.cancel('Operation cancelled'); } catch (_) {}
                }
                if (writer && typeof writer.abort === 'function') {
                    try { await writer.abort('Operation cancelled').catch(() => {}); } catch (_) {}
                } else if (opts.writable && typeof opts.writable.abort === 'function') {
                    try { await opts.writable.abort('Operation cancelled').catch(() => {}); } catch (_) {}
                }
                if (worker) {
                    try {
                        await sendWorkerRequest(worker, { type: 'CANCEL', timeoutMs: 2000 });
                    } catch (_) {}
                    worker.terminate();
                }
            } finally {
                if (telemetry) telemetry.dispose();
            }
        };

        const getFlowStats = () => {
            return flowController ? flowController.getStats() : null;
        };

        (async () => {
            try {
                const StreamCrypto = getStreamCrypto();
                const StreamPacker = getStreamPacker();

                if (!Array.isArray(files) || files.length === 0) {
                    throw new Error('files must be a non-empty Array of file descriptor objects');
                }
                if (typeof password !== 'string') {
                    throw new TypeError('password must be a string');
                }

                const totalPlainBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
                const chunkSize = opts.chunkSize || StreamCrypto.DEFAULT_CHUNK_SIZE;
                const maxCredits = opts.maxCredits || 2;

                telemetry = new TelemetryCalculator({
                    totalBytes: totalPlainBytes,
                    throttleMs: opts.throttleMs || 100,
                    onProgress
                });

                flowController = new CreditFlowController(maxCredits);

                // 1. Spawn Worker
                telemetry.setStage('Spawning worker...', true);
                worker = createWorker(opts);

                // 2. Prepare salt & base IV prefix
                const salt = StreamCrypto.generateSalt(StreamCrypto.SALT_LENGTH);
                const baseIVPrefix = StreamCrypto.generateBaseIVPrefix(StreamCrypto.BASE_IV_PREFIX_LENGTH);
                const hasKeyfile = !!keyfile;

                let keyfileBytes = null;
                if (keyfile) {
                    if (keyfile instanceof Uint8Array) {
                        keyfileBytes = keyfile;
                    } else if (keyfile instanceof ArrayBuffer) {
                        keyfileBytes = new Uint8Array(keyfile);
                    } else if (typeof keyfile.arrayBuffer === 'function') {
                        keyfileBytes = new Uint8Array(await keyfile.arrayBuffer());
                    }
                }

                // 3. Derive key off main thread in background worker
                await transitionStage('Deriving key...');
                const saltBuf = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength);
                const kfBuf = keyfileBytes
                    ? keyfileBytes.buffer.slice(keyfileBytes.byteOffset, keyfileBytes.byteOffset + keyfileBytes.byteLength)
                    : null;

                const initKeyTransfers = [saltBuf.slice(0)];
                if (kfBuf) initKeyTransfers.push(kfBuf.slice(0));

                if (cancelled || hasError) return;

                await sendWorkerRequest(worker, {
                    type: 'INIT_KEY',
                    password,
                    salt: saltBuf,
                    iterations: opts.iterations || StreamCrypto.PBKDF2_ITERATIONS,
                    keyfile: kfBuf
                }, initKeyTransfers);

                if (cancelled || hasError) return;

                // 4. Set streaming parameters in worker
                const ivBuf = baseIVPrefix.buffer.slice(baseIVPrefix.byteOffset, baseIVPrefix.byteOffset + baseIVPrefix.byteLength);
                if (cancelled || hasError) return;
                await sendWorkerRequest(worker, {
                    type: 'SET_PARAMS',
                    baseIVPrefix: ivBuf,
                    salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength),
                    chunkSize
                });

                if (cancelled || hasError) return;

                // 5. Start Streaming ZIP Packaging & Chunk Encryption Pipeline
                await transitionStage('Packaging archive...');
                const zipStream = StreamPacker.createStreamingZipSource(files, opts);
                zipReader = zipStream.getReader();

                // Memory bounding: do NOT buffer chunks in encryptedChunks when opts.writable is provided
                const shouldBuffer = !opts.writable && opts.bufferChunks !== false;
                const encryptedChunks = shouldBuffer ? [] : null;
                let totalEncryptedBytes = 0;
                let currentPlainBuffer = new Uint8Array(0);
                let chunkIndex = 0;

                // Small rolling tail buffer (2 MB) for Central Directory catalog parsing
                // Replaces unbounded plainStreamAccumulator to prevent OOM on multi-GB archives
                const tailChunks = [];
                let tailBytes = 0;
                const MAX_TAIL_BYTES = 2 * 1024 * 1024; // 2 MB rolling window

                await transitionStage('Encrypting stream...');

                // If a writable stream is provided, reserve 57 bytes at the beginning for container header
                if (writer && typeof writer.write === 'function') {
                    try {
                        const placeholderHeader = new Uint8Array(StreamCrypto.V3_HEADER_SIZE);
                        await writer.write(placeholderHeader);
                    } catch (wErr) {
                        await handleFatalError(wErr);
                        return;
                    }
                }

                while (!cancelled && !hasError) {
                    let readResult;
                    try {
                        readResult = await zipReader.read();
                    } catch (rErr) {
                        await handleFatalError(rErr);
                        break;
                    }
                    const { done, value } = readResult;
                    if (done) break;

                    if (value && value.byteLength > 0) {
                        const incoming = value instanceof Uint8Array ? value : new Uint8Array(value);
                        currentPlainBuffer = concatBuffers(currentPlainBuffer, incoming);

                        // Maintain rolling tail buffer
                        tailChunks.push(incoming);
                        tailBytes += incoming.byteLength;
                        while (tailChunks.length > 1 && (tailBytes - tailChunks[0].byteLength) >= MAX_TAIL_BYTES) {
                            tailBytes -= tailChunks[0].byteLength;
                            tailChunks.shift();
                        }

                        // While buffer strictly exceeds chunkSize, emit non-final chunk
                        while (currentPlainBuffer.byteLength > chunkSize && !cancelled && !hasError) {
                            const sliceToEncrypt = currentPlainBuffer.slice(0, chunkSize);
                            currentPlainBuffer = currentPlainBuffer.slice(chunkSize);

                            // Acquire flow control credit
                            await flowController.acquire();
                            if (cancelled || hasError) return;

                            const currIdx = chunkIndex++;
                            const rawBuf = sliceToEncrypt.buffer.slice(
                                sliceToEncrypt.byteOffset,
                                sliceToEncrypt.byteOffset + sliceToEncrypt.byteLength
                            );

                            sendWorkerRequest(worker, {
                                type: 'ENCRYPT_CHUNK',
                                chunk: rawBuf,
                                chunkIndex: currIdx,
                                isLast: false,
                                baseIVPrefix: baseIVPrefix.buffer.slice(baseIVPrefix.byteOffset, baseIVPrefix.byteOffset + baseIVPrefix.byteLength),
                                salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength)
                            }, [rawBuf]).then(async res => {
                                if (hasError || cancelled) {
                                    flowController.release();
                                    return;
                                }

                                const encChunk = new Uint8Array(res.chunk);
                                totalEncryptedBytes += encChunk.byteLength;

                                if (opts.onChunk) {
                                    try {
                                        const p = opts.onChunk(encChunk, currIdx, false);
                                        if (p && typeof p.then === 'function') await p;
                                    } catch (cErr) {
                                        flowController.release();
                                        await handleFatalError(cErr);
                                        return;
                                    }
                                }

                                if (writer && typeof writer.write === 'function') {
                                    try {
                                        await writer.write(encChunk);
                                    } catch (wErr) {
                                        flowController.release();
                                        await handleFatalError(wErr);
                                        return;
                                    }
                                }

                                // Release flow control credit only AFTER consumer has processed the chunk
                                flowController.release();

                                if (shouldBuffer) {
                                    encryptedChunks[currIdx] = encChunk;
                                }
                                telemetry.recordProgress(chunkSize);
                            }).catch(async err => {
                                flowController.release();
                                await handleFatalError(err);
                            });
                        }
                    }
                }

                if (cancelled || hasError) return;

                // Wait for all in-flight non-final chunks to complete
                while (flowController.inFlight > 0) {
                    if (cancelled || hasError) return;
                    await new Promise(r => setTimeout(r, 10));
                    if (cancelled || hasError) return;
                }

                // Encrypt the final chunk with isLast = true
                await flowController.acquire();
                if (cancelled || hasError) return;

                const finalIdx = chunkIndex++;
                const finalRaw = currentPlainBuffer.buffer.slice(
                    currentPlainBuffer.byteOffset,
                    currentPlainBuffer.byteOffset + currentPlainBuffer.byteLength
                );

                let finalRes;
                try {
                    finalRes = await sendWorkerRequest(worker, {
                        type: 'ENCRYPT_CHUNK',
                        chunk: finalRaw,
                        chunkIndex: finalIdx,
                        isLast: true,
                        baseIVPrefix: baseIVPrefix.buffer.slice(baseIVPrefix.byteOffset, baseIVPrefix.byteOffset + baseIVPrefix.byteLength),
                        salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength)
                    }, [finalRaw]);
                } catch (fErr) {
                    flowController.release();
                    await handleFatalError(fErr);
                    return;
                }

                if (cancelled || hasError) {
                    flowController.release();
                    return;
                }

                const finalEnc = new Uint8Array(finalRes.chunk);
                totalEncryptedBytes += finalEnc.byteLength;

                if (opts.onChunk) {
                    try {
                        const p = opts.onChunk(finalEnc, finalIdx, true);
                        if (p && typeof p.then === 'function') await p;
                    } catch (cErr) {
                        flowController.release();
                        await handleFatalError(cErr);
                        return;
                    }
                }

                if (writer && typeof writer.write === 'function') {
                    try {
                        await writer.write(finalEnc);
                    } catch (wErr) {
                        flowController.release();
                        await handleFatalError(wErr);
                        return;
                    }
                }

                flowController.release();

                if (shouldBuffer) {
                    encryptedChunks[finalIdx] = finalEnc;
                }
                telemetry.recordProgress(currentPlainBuffer.byteLength);

                if (cancelled || hasError) return;

                // 6. Build Manifest Trailer Envelope
                await transitionStage('Finalizing manifest...');

                // Parse Central Directory records from rolling tail bytes
                const tailZipBytes = concatAll(tailChunks);
                const catalogFiles = parseCentralDirectoryEntries(tailZipBytes, chunkSize);

                const manifestCatalog = {
                    version: 3,
                    totalSize: catalogFiles.reduce((acc, f) => acc + (f.size || 0), 0),
                    fileCount: catalogFiles.length,
                    files: catalogFiles
                };

                let manifestRes;
                try {
                    manifestRes = await sendWorkerRequest(worker, {
                        type: 'BUILD_MANIFEST',
                        catalog: manifestCatalog
                    });
                } catch (mErr) {
                    await handleFatalError(mErr);
                    return;
                }

                if (cancelled || hasError) return;

                const manifestEnvelope = new Uint8Array(manifestRes.envelope);

                // Write manifest trailer envelope to stream writer
                if (writer && typeof writer.write === 'function') {
                    try {
                        await writer.write(manifestEnvelope);
                    } catch (wErr) {
                        await handleFatalError(wErr);
                        return;
                    }
                }

                // 7. Create Container Header
                const manifestOffset = BigInt(StreamCrypto.V3_HEADER_SIZE + totalEncryptedBytes);
                const header = StreamCrypto.createContainerHeader({
                    salt,
                    baseIVPrefix,
                    chunkSize,
                    flags: hasKeyfile ? StreamCrypto.V3_FLAG_KEYFILE : 0x00,
                    manifestOffset
                });

                // Write final container header to byte 0 if writer is seekable
                if (writer && typeof writer.seek === 'function') {
                    try {
                        await writer.seek(0);
                        await writer.write(header);
                    } catch (sErr) {
                        console.warn('[WorkerBridge] Failed to seek to 0 for header update:', sErr);
                    }
                } else if (opts.writable && typeof opts.writable.seek === 'function') {
                    try {
                        await opts.writable.seek(0);
                        await opts.writable.write(header);
                    } catch (sErr) {
                        console.warn('[WorkerBridge] Failed to seek writable to 0 for header update:', sErr);
                    }
                }

                // Close writer if open
                if (writer && typeof writer.close === 'function') {
                    try {
                        await writer.close();
                    } catch (_) {}
                }

                if (cancelled || hasError) return;

                // Align telemetry progress with totalPlainBytes before complete
                if (telemetry && telemetry.processedBytes < totalPlainBytes) {
                    telemetry.recordProgress(totalPlainBytes - telemetry.processedBytes);
                }

                await transitionStage('Complete');

                if (cancelled || hasError) return;

                const fullVault = shouldBuffer ? concatAll([header, ...encryptedChunks, manifestEnvelope]) : null;

                if (typeof onComplete === 'function') {
                    onComplete({
                        vault: fullVault,
                        vaultBytes: fullVault,
                        header,
                        manifest: manifestCatalog,
                        manifestEnvelope,
                        chunks: shouldBuffer ? encryptedChunks : [],
                        totalBytes: fullVault ? fullVault.byteLength : (StreamCrypto.V3_HEADER_SIZE + totalEncryptedBytes + manifestEnvelope.byteLength),
                        manifestOffset
                    });
                }
            } catch (err) {
                await handleFatalError(err);
            } finally {
                if (telemetry) telemetry.dispose();
                if (worker && !opts.keepWorkerAlive) {
                    worker.terminate();
                }
            }
        })();

        return { cancel, getFlowStats };
    }

    /**
     * Starts streaming decryption of a .zev vault:
     * - Automatic format sniffing (v1, v2, v3).
     * - Instantly reads and offloads manifest trailer decryption to worker, calling onManifestReady(files).
     * - Stream-decrypts chunks using credit-based flow control to prevent buffer buildup.
     * - Emits 60 FPS real-time telemetry throttled to ~100 ms.
     *
     * @param {Object} params
     * @param {*} params.vaultSource - File, Blob, Uint8Array, or ArrayBuffer
     * @param {string} params.password
     * @param {File|Uint8Array|ArrayBuffer|null} [params.keyfile=null]
     * @param {Function} [params.onManifestReady=null]
     * @param {Function} [params.onProgress=null]
     * @param {Function} [params.onComplete=null]
     * @param {Function} [params.onError=null]
     * @param {Object} [params.options={}]
     * @returns {{ cancel: Function, getFlowStats: Function }}
     */
    function startDecryption({
        vaultSource,
        password,
        keyfile = null,
        onManifestReady = null,
        onProgress = null,
        onComplete = null,
        onError = null,
        options = {}
    }) {
        const opts = options || {};
        let cancelled = false;
        let hasError = false;
        let fatalError = null;
        let worker = null;
        let flowController = null;
        let telemetry = null;
        let writer = null;

        if (opts.writable) {
            if (typeof opts.writable.getWriter === 'function') {
                writer = opts.writable.getWriter();
            } else if (typeof opts.writable.write === 'function') {
                writer = opts.writable;
            }
        }

        const handleFatalError = async (err) => {
            if (hasError || cancelled) return;
            hasError = true;
            cancelled = true;
            fatalError = err;

            if (telemetry) {
                try { telemetry.setStage('Error', true); } catch (_) {}
                telemetry.dispose();
            }

            if (writer && typeof writer.abort === 'function') {
                try { await writer.abort(err).catch(() => {}); } catch (_) {}
            } else if (opts.writable && typeof opts.writable.abort === 'function') {
                try { await opts.writable.abort(err).catch(() => {}); } catch (_) {}
            }

            if (worker) {
                try { worker.terminate(); } catch (_) {}
            }

            if (typeof onError === 'function') {
                try { onError(err); } catch (_) {}
            }
        };

        const transitionStage = async (stage) => {
            if (cancelled || hasError) return;
            if (telemetry) {
                const minInterval = 65; // Safe margin above 50 ms floor against Windows timer resolution jitter
                while (telemetry.lastEmitTime > 0) {
                    const elapsed = getHiResTime() - telemetry.lastEmitTime;
                    if (elapsed < minInterval) {
                        await new Promise(r => setTimeout(r, Math.max(10, Math.ceil(minInterval - elapsed))));
                    } else {
                        break;
                    }
                }
                if (cancelled || hasError) return;
                telemetry.setStage(stage, true);
            }
        };

        const cancel = async () => {
            if (cancelled || hasError) return;
            cancelled = true;
            try {
                if (telemetry) telemetry.setStage('Cancelled', true);
                if (writer && typeof writer.abort === 'function') {
                    try { await writer.abort('Operation cancelled').catch(() => {}); } catch (_) {}
                } else if (opts.writable && typeof opts.writable.abort === 'function') {
                    try { await opts.writable.abort('Operation cancelled').catch(() => {}); } catch (_) {}
                }
                if (worker) {
                    try {
                        await sendWorkerRequest(worker, { type: 'CANCEL', timeoutMs: 2000 });
                    } catch (_) {}
                    worker.terminate();
                }
            } finally {
                if (telemetry) telemetry.dispose();
            }
        };

        const getFlowStats = () => {
            return flowController ? flowController.getStats() : null;
        };

        (async () => {
            try {
                const StreamCrypto = getStreamCrypto();
                const StreamUnpacker = getStreamUnpacker();

                if (!vaultSource) {
                    throw new Error('vaultSource is required');
                }
                if (typeof password !== 'string') {
                    throw new TypeError('password must be a string');
                }

                // Detect vault format version
                const version = await StreamUnpacker.detectVaultVersion(vaultSource);

                if (version === 1 || version === 2) {
                    // Backward-compatible v1 / v2 legacy vault route
                    telemetry = new TelemetryCalculator({
                        totalBytes: 100,
                        throttleMs: opts.throttleMs || 100,
                        onProgress
                    });
                    await transitionStage('Decrypting legacy vault...');

                    let keyfileBytes = null;
                    const kf = keyfile || opts.keyfileBytes;
                    if (kf) {
                        if (kf instanceof Uint8Array) keyfileBytes = kf;
                        else if (kf instanceof ArrayBuffer) keyfileBytes = new Uint8Array(kf);
                        else if (typeof kf.arrayBuffer === 'function') keyfileBytes = new Uint8Array(await kf.arrayBuffer());
                    }

                    const decryptedBytes = await StreamUnpacker.decryptVault(vaultSource, password, {
                        keyfileBytes,
                        ...opts
                    });

                    if (cancelled || hasError) return;

                    telemetry.recordProgress(100, true);

                    await transitionStage('Complete');

                    if (cancelled || hasError) return;

                    if (typeof onComplete === 'function') {
                        onComplete({
                            version,
                            decryptedBytes,
                            totalBytes: decryptedBytes.byteLength
                        });
                    }
                    return;
                }

                if (version !== 3) {
                    throw new Error(`Unsupported vault format version: ${version}`);
                }

                // 1. Read v3 Container Header (57 bytes)
                const headerBytes = await StreamUnpacker.readRange(vaultSource, 0, StreamCrypto.V3_HEADER_SIZE);
                const header = StreamCrypto.parseContainerHeader(headerBytes);

                const hasKeyfileFlag = (header.flags & StreamCrypto.V3_FLAG_KEYFILE) !== 0;
                if (hasKeyfileFlag && !keyfile && !opts.keyfileBytes) {
                    throw new Error('This vault requires a keyfile for 2FA authentication, but none was provided');
                }

                let keyfileBytes = null;
                const kf = keyfile || opts.keyfileBytes;
                if (kf) {
                    if (kf instanceof Uint8Array) keyfileBytes = kf;
                    else if (kf instanceof ArrayBuffer) keyfileBytes = new Uint8Array(kf);
                    else if (typeof kf.arrayBuffer === 'function') keyfileBytes = new Uint8Array(await kf.arrayBuffer());
                }

                const manifestOffset = Number(header.manifestOffset);
                const totalEncryptedBytes = manifestOffset - StreamCrypto.V3_HEADER_SIZE;
                const chunkSize = header.chunkSize || StreamCrypto.DEFAULT_CHUNK_SIZE;
                const totalFramedChunkSize = chunkSize + StreamCrypto.CHUNK_HEADER_SIZE + StreamCrypto.TAG_LENGTH;

                telemetry = new TelemetryCalculator({
                    totalBytes: totalEncryptedBytes,
                    throttleMs: opts.throttleMs || 100,
                    onProgress
                });

                // 2. Spawn worker
                telemetry.setStage('Spawning worker...', true);
                worker = createWorker(opts);

                // 3. Derive key off main thread in worker
                await transitionStage('Deriving key...');
                const saltBuf = header.salt.buffer.slice(header.salt.byteOffset, header.salt.byteOffset + header.salt.byteLength);
                const kfBuf = keyfileBytes
                    ? keyfileBytes.buffer.slice(keyfileBytes.byteOffset, keyfileBytes.byteOffset + keyfileBytes.byteLength)
                    : null;

                const initTransfers = [saltBuf.slice(0)];
                if (kfBuf) initTransfers.push(kfBuf.slice(0));

                if (cancelled || hasError) return;

                await sendWorkerRequest(worker, {
                    type: 'INIT_KEY',
                    password,
                    salt: saltBuf,
                    iterations: opts.iterations || StreamCrypto.PBKDF2_ITERATIONS,
                    keyfile: kfBuf
                }, initTransfers);

                if (cancelled || hasError) return;

                // 4. Read & Decrypt Manifest Trailer
                await transitionStage('Reading manifest...');
                const manifestEnvelopeBytes = await StreamUnpacker.readRange(vaultSource, manifestOffset, undefined);
                const envBuf = manifestEnvelopeBytes.buffer.slice(
                    manifestEnvelopeBytes.byteOffset,
                    manifestEnvelopeBytes.byteOffset + manifestEnvelopeBytes.byteLength
                );

                let manifestRes;
                try {
                    manifestRes = await sendWorkerRequest(worker, {
                        type: 'DECRYPT_MANIFEST',
                        envelope: envBuf
                    }, [envBuf]);
                } catch (mErr) {
                    await handleFatalError(mErr);
                    return;
                }

                if (cancelled || hasError) return;

                const manifest = manifestRes.manifest;
                const files = manifestRes.files;

                await transitionStage('Manifest ready');

                if (typeof onManifestReady === 'function') {
                    try {
                        onManifestReady(files, manifest);
                    } catch (_) {}
                }

                if (cancelled || hasError) return;

                // If manifest-only mode requested
                if (opts.manifestOnly || opts.mode === 'manifest-only') {
                    if (typeof onComplete === 'function') {
                        onComplete({
                            version: 3,
                            manifest,
                            files,
                            header
                        });
                    }
                    return;
                }

                // 5. Full Streaming Decryption Pipeline
                await transitionStage('Decrypting stream...');
                const maxCredits = opts.maxCredits || 2;
                flowController = new CreditFlowController(maxCredits);

                const numChunks = Math.ceil(totalEncryptedBytes / totalFramedChunkSize);
                const lastChunkIndex = numChunks - 1;

                // Memory bounding: do NOT buffer decryptedChunks when opts.writable is active
                const shouldBuffer = !opts.writable && opts.bufferChunks !== false;
                const decryptedChunks = shouldBuffer ? [] : null;
                let totalDecryptedBytes = 0;

                for (let i = 0; i < numChunks && !cancelled && !hasError; i++) {
                    const isLast = (i === lastChunkIndex);
                    const cStart = StreamCrypto.V3_HEADER_SIZE + i * totalFramedChunkSize;
                    const cEnd = isLast ? manifestOffset : cStart + totalFramedChunkSize;

                    // Acquire credit before dispatching chunk
                    await flowController.acquire();
                    if (cancelled || hasError) return;

                    let chunkBytes;
                    try {
                        chunkBytes = await StreamUnpacker.readRange(vaultSource, cStart, cEnd);
                    } catch (rErr) {
                        flowController.release();
                        await handleFatalError(rErr);
                        return;
                    }

                    if (cancelled || hasError) {
                        flowController.release();
                        return;
                    }

                    const rawBuf = chunkBytes.buffer.slice(
                        chunkBytes.byteOffset,
                        chunkBytes.byteOffset + chunkBytes.byteLength
                    );

                    sendWorkerRequest(worker, {
                        type: 'DECRYPT_CHUNK',
                        chunk: rawBuf,
                        chunkIndex: i,
                        isLast,
                        baseIVPrefix: header.baseIVPrefix.buffer.slice(header.baseIVPrefix.byteOffset, header.baseIVPrefix.byteOffset + header.baseIVPrefix.byteLength),
                        salt: header.salt.buffer.slice(header.salt.byteOffset, header.salt.byteOffset + header.salt.byteLength)
                    }, [rawBuf]).then(async res => {
                        if (hasError || cancelled) {
                            flowController.release();
                            return;
                        }

                        const plainChunk = new Uint8Array(res.chunk);
                        totalDecryptedBytes += plainChunk.byteLength;

                        if (opts.onChunk) {
                            try {
                                const p = opts.onChunk(plainChunk, i, isLast);
                                if (p && typeof p.then === 'function') await p;
                            } catch (cErr) {
                                flowController.release();
                                await handleFatalError(cErr);
                                return;
                            }
                        }

                        if (writer && typeof writer.write === 'function') {
                            try {
                                await writer.write(plainChunk);
                            } catch (wErr) {
                                flowController.release();
                                await handleFatalError(wErr);
                                return;
                            }
                        }

                        // Release flow control credit AFTER consumer has processed it
                        flowController.release();

                        if (shouldBuffer) {
                            decryptedChunks[i] = plainChunk;
                        }
                        telemetry.recordProgress(chunkBytes.byteLength);
                    }).catch(async err => {
                        flowController.release();
                        await handleFatalError(err);
                    });
                }

                if (cancelled || hasError) return;

                // Wait for all in-flight chunks
                while (flowController.inFlight > 0) {
                    if (cancelled || hasError) return;
                    await new Promise(r => setTimeout(r, 10));
                    if (cancelled || hasError) return;
                }

                // Close stream writer if provided
                if (writer && typeof writer.close === 'function') {
                    try {
                        await writer.close();
                    } catch (_) {}
                }

                if (cancelled || hasError) return;

                await transitionStage('Complete');

                if (cancelled || hasError) return;

                const fullZipBytes = shouldBuffer ? concatAll(decryptedChunks) : null;

                if (typeof onComplete === 'function') {
                    onComplete({
                        version: 3,
                        manifest,
                        files,
                        decryptedBytes: fullZipBytes,
                        totalBytes: fullZipBytes ? fullZipBytes.byteLength : totalDecryptedBytes,
                        header
                    });
                }
            } catch (err) {
                await handleFatalError(err);
            } finally {
                if (telemetry) telemetry.dispose();
                if (worker && !opts.keepWorkerAlive) {
                    worker.terminate();
                }
            }
        })();

        return { cancel, getFlowStats };
    }

    /**
     * Selectively extracts a single file from a large vault without loading
     * or decrypting the entire archive:
     * - Offloads key derivation and chunk span $[C_{start}, C_{end}]$ decryption to worker.
     * - Decompresses via native RFC 1951 deflate-raw and verifies CRC-32 checksum.
     * - Returns uncompressed file Uint8Array.
     *
     * @param {Object} params
     * @param {*} params.vaultSource
     * @param {string} params.password
     * @param {File|Uint8Array|ArrayBuffer|null} [params.keyfile=null]
     * @param {Object|string} params.targetEntry - Manifest file descriptor or filename string
     * @param {Function} [params.onProgress=null]
     * @param {Object} [params.options={}]
     * @returns {Promise<Uint8Array>}
     */
    async function extractSingleFile({
        vaultSource,
        password,
        keyfile = null,
        targetEntry,
        onProgress = null,
        options = {}
    }) {
        const StreamCrypto = getStreamCrypto();
        const StreamUnpacker = getStreamUnpacker();
        const opts = options || {};

        if (!vaultSource) throw new Error('vaultSource is required');
        if (typeof password !== 'string') throw new TypeError('password must be a string');
        if (!targetEntry) throw new Error('targetEntry is required');

        let worker = null;
        let telemetry = null;

        try {
            // 1. Read v3 Container Header
            const headerBytes = await StreamUnpacker.readRange(vaultSource, 0, StreamCrypto.V3_HEADER_SIZE);
            const header = StreamCrypto.parseContainerHeader(headerBytes);

            if (header.version !== 3) {
                throw new Error(`Selective extraction requires v3 streaming vault (found v${header.version})`);
            }

            const hasKeyfileFlag = (header.flags & StreamCrypto.V3_FLAG_KEYFILE) !== 0;
            if (hasKeyfileFlag && !keyfile && !opts.keyfileBytes) {
                throw new Error('This vault requires a keyfile for 2FA authentication, but none was provided');
            }

            let keyfileBytes = null;
            const kf = keyfile || opts.keyfileBytes;
            if (kf) {
                if (kf instanceof Uint8Array) keyfileBytes = kf;
                else if (kf instanceof ArrayBuffer) keyfileBytes = new Uint8Array(kf);
                else if (typeof kf.arrayBuffer === 'function') keyfileBytes = new Uint8Array(await kf.arrayBuffer());
            }

            telemetry = new TelemetryCalculator({
                totalBytes: 100,
                throttleMs: opts.throttleMs || 100,
                onProgress
            });

            // 2. Spawn worker
            telemetry.setStage('Spawning worker...', true);
            worker = createWorker(opts);

            // 3. Derive key off main thread in worker
            telemetry.setStage('Deriving key...', true);
            const saltBuf = header.salt.buffer.slice(header.salt.byteOffset, header.salt.byteOffset + header.salt.byteLength);
            const kfBuf = keyfileBytes
                ? keyfileBytes.buffer.slice(keyfileBytes.byteOffset, keyfileBytes.byteOffset + keyfileBytes.byteLength)
                : null;

            const initTransfers = [saltBuf.slice(0)];
            if (kfBuf) initTransfers.push(kfBuf.slice(0));

            await sendWorkerRequest(worker, {
                type: 'INIT_KEY',
                password,
                salt: saltBuf,
                iterations: opts.iterations || StreamCrypto.PBKDF2_ITERATIONS,
                keyfile: kfBuf
            }, initTransfers);

            // 4. Resolve targetEntry if provided as string
            let entry = targetEntry;
            if (typeof entry === 'string') {
                if (opts.manifest && Array.isArray(opts.manifest.files)) {
                    const found = opts.manifest.files.find(f => f.path === entry || f.name === entry);
                    if (!found) throw new Error(`File "${entry}" not found in manifest`);
                    entry = found;
                } else {
                    // Decrypt manifest envelope first
                    const mOffset = Number(header.manifestOffset);
                    const manifestEnvelopeBytes = await StreamUnpacker.readRange(vaultSource, mOffset, undefined);
                    const envBuf = manifestEnvelopeBytes.buffer.slice(
                        manifestEnvelopeBytes.byteOffset,
                        manifestEnvelopeBytes.byteOffset + manifestEnvelopeBytes.byteLength
                    );
                    const mRes = await sendWorkerRequest(worker, {
                        type: 'DECRYPT_MANIFEST',
                        envelope: envBuf
                    }, [envBuf]);

                    const files = mRes.files || [];
                    const found = files.find(f => f.path === entry || f.name === entry);
                    if (!found) throw new Error(`File "${entry}" not found in manifest`);
                    entry = found;
                }
            }

            telemetry.setStage('Extracting file...', true);

            // 5. Read target chunk span
            const chunkSize = header.chunkSize || StreamCrypto.DEFAULT_CHUNK_SIZE;
            const manifestOffset = header.manifestOffset;
            const totalFramedChunkSize = chunkSize + StreamCrypto.CHUNK_HEADER_SIZE + StreamCrypto.TAG_LENGTH;
            const lastChunkIndex = Number((manifestOffset - BigInt(StreamCrypto.V3_HEADER_SIZE) - 1n) / BigInt(totalFramedChunkSize));

            const chunkStart = Math.max(0, entry.chunkStart !== undefined ? entry.chunkStart : Math.floor((entry.offset || 0) / chunkSize));
            const chunkEnd = Math.min(lastChunkIndex, entry.chunkEnd !== undefined ? entry.chunkEnd : chunkStart);

            const chunkBuffers = [];
            const transfers = [];

            for (let i = chunkStart; i <= chunkEnd; i++) {
                const isLast = (i === lastChunkIndex);
                const cStart = StreamCrypto.V3_HEADER_SIZE + i * totalFramedChunkSize;
                const cEnd = isLast ? Number(manifestOffset) : cStart + totalFramedChunkSize;

                const cBytes = await StreamUnpacker.readRange(vaultSource, cStart, cEnd);
                const ab = cBytes.buffer.slice(cBytes.byteOffset, cBytes.byteOffset + cBytes.byteLength);
                chunkBuffers.push({
                    index: i,
                    buffer: ab,
                    isLast
                });
                transfers.push(ab);
            }

            // 6. Send EXTRACT_FILE to worker
            const res = await sendWorkerRequest(worker, {
                type: 'EXTRACT_FILE',
                entry,
                chunkBuffers,
                baseIVPrefix: header.baseIVPrefix.buffer.slice(header.baseIVPrefix.byteOffset, header.baseIVPrefix.byteOffset + header.baseIVPrefix.byteLength),
                salt: header.salt.buffer.slice(header.salt.byteOffset, header.salt.byteOffset + header.salt.byteLength),
                chunkSize
            }, transfers);

            telemetry.recordProgress(100, true);
            telemetry.setStage('Complete', true);

            return new Uint8Array(res.data);
        } finally {
            if (telemetry) telemetry.dispose();
            if (worker && !opts.keepWorkerAlive) {
                worker.terminate();
            }
        }
    }

    // =========================================================================
    // EXPORTS
    // =========================================================================

    return {
        // Core Classes
        CreditFlowController,
        TelemetryCalculator,
        UnifiedWorkerWrapper,

        // Worker Spawning & Messaging
        createWorker,
        createAsyncWorkerShim,
        sendWorkerRequest,

        // Public APIs
        startEncryption,
        startDecryption,
        extractSingleFile,

        // Helpers
        parseCentralDirectoryEntries
    };
}));
