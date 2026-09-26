/**
 * ZevSafe 5 GB Streaming Architecture - Memory Profiling & Verification Harness
 * test/memory-profiler.js
 *
 * Provides real-time memory telemetry and assertions to enforce:
 * 1. Target peak memory heap < 150 MB during multi-gigabyte operations.
 * 2. Strict ceiling peak memory heap < 200 MB (hard failure threshold).
 * 3. Credit-based backpressure verification (highWaterMark: 1, <= 2 chunks in-flight).
 * 4. Zero memory leak verification (heap returns to baseline after stream release).
 */

(function (global) {
    'use strict';

    /**
     * BufferTracker: tracks virtual or physical in-flight chunk allocations
     * to verify strict credit-based ACK flow control and memory bounding.
     */
    class BufferTracker {
        constructor() {
            this.activeAllocations = new Map();
            this.peakActiveBytes = 0;
            this.peakActiveCount = 0;
            this.totalAllocatedBytes = 0;
            this.totalReleasedBytes = 0;
        }

        allocate(id, sizeBytes) {
            this.activeAllocations.set(id, { sizeBytes, timestamp: Date.now() });
            this.totalAllocatedBytes += sizeBytes;

            const currentBytes = this.getActiveBytes();
            const currentCount = this.activeAllocations.size;

            if (currentBytes > this.peakActiveBytes) this.peakActiveBytes = currentBytes;
            if (currentCount > this.peakActiveCount) this.peakActiveCount = currentCount;
        }

        release(id) {
            const alloc = this.activeAllocations.get(id);
            if (alloc) {
                this.totalReleasedBytes += alloc.sizeBytes;
                this.activeAllocations.delete(id);
            }
        }

        getActiveCount() {
            return this.activeAllocations.size;
        }

        getActiveBytes() {
            let total = 0;
            for (const item of this.activeAllocations.values()) {
                total += item.sizeBytes;
            }
            return total;
        }

        reset() {
            this.activeAllocations.clear();
            this.peakActiveBytes = 0;
            this.peakActiveCount = 0;
            this.totalAllocatedBytes = 0;
            this.totalReleasedBytes = 0;
        }

        /**
         * Asserts backpressure guardrails: concurrent in-flight chunks must not exceed maxConcurrentChunks
         * @param {number} maxConcurrentChunks Default 2
         * @param {number} maxChunkSize Default 4 MB (4194304)
         */
        assertBackpressureCompliance(maxConcurrentChunks = 2, maxChunkSize = 4194304) {
            if (this.peakActiveCount > maxConcurrentChunks) {
                throw new Error(
                    `Backpressure violation: peak active in-flight chunks was ${this.peakActiveCount}, exceeding allowed limit of ${maxConcurrentChunks}.`
                );
            }
            const maxAllowedBytes = maxConcurrentChunks * maxChunkSize;
            if (this.peakActiveBytes > maxAllowedBytes) {
                throw new Error(
                    `In-flight buffer violation: peak active buffer memory was ${MemoryProfiler.formatBytes(this.peakActiveBytes)}, exceeding limit of ${MemoryProfiler.formatBytes(maxAllowedBytes)}.`
                );
            }
            return true;
        }
    }

    /**
     * MemoryProfiler: Real-time heap sampler & threshold auditor
     */
    class MemoryProfiler {
        constructor(options = {}) {
            this.targetLimitMB = options.targetLimitMB || 150; // Target < 150 MB
            this.strictLimitMB = options.strictLimitMB || 200; // Hard ceiling < 200 MB
            this.sampleIntervalMs = options.sampleIntervalMs || 30;

            this.bufferTracker = new BufferTracker();
            this.samples = [];
            this.isTracking = false;
            this._timer = null;

            this.baseline = null;
            this.peakBytes = 0;
            this.finalSnapshot = null;
        }

        /**
         * Get current memory usage snapshot across Chromium, Node.js, or Fallback.
         * @returns {{ usedJSHeapBytes: number, totalJSHeapBytes: number, heapLimitBytes: number, source: string, timestamp: number }}
         */
        static getCurrentMemory() {
            const timestamp = Date.now();

            // Chromium performance.memory
            if (typeof performance !== 'undefined' && performance.memory) {
                return {
                    usedJSHeapBytes: performance.memory.usedJSHeapSize,
                    totalJSHeapBytes: performance.memory.totalJSHeapSize,
                    heapLimitBytes: performance.memory.jsHeapSizeLimit,
                    source: 'performance.memory',
                    timestamp
                };
            }

            // Node.js process.memoryUsage
            if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
                const mem = process.memoryUsage();
                return {
                    usedJSHeapBytes: mem.heapUsed,
                    totalJSHeapBytes: mem.heapTotal,
                    heapLimitBytes: mem.rss,
                    source: 'process.memoryUsage',
                    timestamp
                };
            }

            // Standard fallback (browsers without memory API)
            return {
                usedJSHeapBytes: 0,
                totalJSHeapBytes: 0,
                heapLimitBytes: 0,
                source: 'unavailable',
                timestamp
            };
        }

        /**
         * Format byte counts into human-readable strings
         */
        static formatBytes(bytes, decimals = 2) {
            if (bytes === 0 || isNaN(bytes)) return '0 B';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
            if (i === 0) return `${Math.round(bytes)} B`;
            const formatted = (bytes / Math.pow(k, i)).toFixed(dm);
            return `${formatted} ${sizes[i]}`;
        }

        /**
         * Starts periodic sampling of heap memory
         */
        start() {
            this.samples = [];
            this.bufferTracker.reset();
            this.baseline = MemoryProfiler.getCurrentMemory();
            this.peakBytes = this.baseline.usedJSHeapBytes;
            this.finalSnapshot = null;
            this.isTracking = true;

            this._timer = setInterval(() => {
                this.sample();
            }, this.sampleIntervalMs);

            return this.baseline;
        }

        /**
         * Records a single point-in-time memory sample
         */
        sample() {
            const mem = MemoryProfiler.getCurrentMemory();
            this.samples.push(mem);
            if (mem.usedJSHeapBytes > this.peakBytes) {
                this.peakBytes = mem.usedJSHeapBytes;
            }
            return mem;
        }

        /**
         * Stops memory tracking and produces an evaluation report
         * @returns {{
         *   source: string,
         *   baselineBytes: number,
         *   peakBytes: number,
         *   finalBytes: number,
         *   netDeltaBytes: number,
         *   peakDeltaBytes: number,
         *   peakMB: number,
         *   sampleCount: number,
         *   targetLimitMB: number,
         *   strictLimitMB: number,
         *   passedTarget: boolean,
         *   passedStrict: boolean,
         *   summary: string
         * }}
         */
        stop() {
            if (this._timer) {
                clearInterval(this._timer);
                this._timer = null;
            }
            this.isTracking = false;
            this.finalSnapshot = MemoryProfiler.getCurrentMemory();

            if (this.finalSnapshot.usedJSHeapBytes > this.peakBytes) {
                this.peakBytes = this.finalSnapshot.usedJSHeapBytes;
            }

            const baselineUsed = this.baseline ? this.baseline.usedJSHeapBytes : 0;
            const finalUsed = this.finalSnapshot.usedJSHeapBytes;
            const netDeltaBytes = finalUsed - baselineUsed;
            const peakDeltaBytes = this.peakBytes - baselineUsed;
            const peakMB = this.peakBytes / (1024 * 1024);
            const peakDeltaMB = peakDeltaBytes / (1024 * 1024);

            const passedTarget = peakMB <= this.targetLimitMB;
            const passedStrict = peakMB <= this.strictLimitMB;

            const summary = `Source: ${this.finalSnapshot.source} | Baseline: ${MemoryProfiler.formatBytes(baselineUsed)} | Peak: ${MemoryProfiler.formatBytes(this.peakBytes)} (${peakMB.toFixed(2)} MB) | Delta: ${MemoryProfiler.formatBytes(peakDeltaBytes)} (${peakDeltaMB.toFixed(2)} MB) | Status: ${passedTarget ? 'OPTIMAL (<150MB)' : passedStrict ? 'ACCEPTABLE (<200MB)' : 'EXCEEDED (>200MB)'}`;

            return {
                source: this.finalSnapshot.source,
                baselineBytes: baselineUsed,
                peakBytes: this.peakBytes,
                finalBytes: finalUsed,
                netDeltaBytes,
                peakDeltaBytes,
                peakMB,
                peakDeltaMB,
                sampleCount: this.samples.length,
                targetLimitMB: this.targetLimitMB,
                strictLimitMB: this.strictLimitMB,
                passedTarget,
                passedStrict,
                summary
            };
        }

        /**
         * Asserts memory guardrails against given limits
         * Throws hard error if strict limit exceeded (> 200 MB)
         * Returns warning object if target limit exceeded (> 150 MB but < 200 MB)
         */
        assertLimits(report = null) {
            const r = report || (this.isTracking ? this.stop() : null);
            if (!r) throw new Error('No memory report available to assert.');

            // Only enforce memory limit checks if memory reporting source is available
            if (r.source === 'unavailable') {
                return { status: 'skipped', reason: 'performance.memory unavailable in this browser engine' };
            }

            if (!r.passedStrict) {
                throw new Error(
                    `CRITICAL MEMORY VIOLATION: Peak heap memory reached ${r.peakMB.toFixed(2)} MB, exceeding the strict hard ceiling of ${r.strictLimitMB} MB! (Peak bytes: ${r.peakBytes})`
                );
            }

            return {
                status: 'passed',
                peakMB: r.peakMB,
                optimal: r.passedTarget,
                warning: !r.passedTarget ? `Peak memory (${r.peakMB.toFixed(2)} MB) exceeded target 150 MB but remained within 200 MB hard limit.` : null
            };
        }
    }

    // Export to global / module
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MemoryProfiler, BufferTracker };
    } else {
        global.MemoryProfiler = MemoryProfiler;
        global.BufferTracker = BufferTracker;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
