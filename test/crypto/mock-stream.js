/**
 * ZevSafe 5 GB Streaming Architecture - Deterministic Mock Stream Generator
 * test/mock-stream.js
 *
 * Provides high-throughput, memory-bounded synthetic streaming data generation
 * capable of producing up to 5 GB streams without buffering entire payloads in RAM.
 * Includes a zero-dependency, FIPS 180-4 compliant StreamingSha256 engine for
 * running digests across gigabyte streams.
 */

(function (global) {
    'use strict';

    /**
     * Standard FIPS 180-4 Streaming SHA-256 Engine.
     * Maintains an 8x32-bit internal state with 64-byte block buffer (~128 bytes memory footprint).
     * Matches Web Crypto crypto.subtle.digest('SHA-256') byte-for-byte.
     */
    class StreamingSha256 {
        constructor() {
            this.reset();
        }

        reset() {
            // Initial hash values (FIPS 180-4 Section 5.3.3)
            this.h0 = 0x6a09e667;
            this.h1 = 0xbb67ae85;
            this.h2 = 0x3c6ef372;
            this.h3 = 0xa54ff53a;
            this.h4 = 0x510e527f;
            this.h5 = 0x9b05688c;
            this.h6 = 0x1f83d9ab;
            this.h7 = 0x5be0cd19;

            this.block = new Uint8Array(64);
            this.blockLength = 0;
            this.totalBytes = 0;
            this.w = new Int32Array(64);
            this._finalized = false;
        }

        update(data) {
            if (this._finalized) {
                throw new Error('StreamingSha256 already finalized. Call reset() first.');
            }
            if (!(data instanceof Uint8Array)) {
                if (data instanceof ArrayBuffer) {
                    data = new Uint8Array(data);
                } else if (ArrayBuffer.isView(data)) {
                    data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                } else if (typeof data === 'string') {
                    data = new TextEncoder().encode(data);
                } else {
                    throw new TypeError('Unsupported input type for StreamingSha256 update');
                }
            }

            const len = data.length;
            this.totalBytes += len;
            let offset = 0;

            // Fill leftover block buffer
            if (this.blockLength > 0) {
                const fillNeeded = 64 - this.blockLength;
                if (len >= fillNeeded) {
                    this.block.set(data.subarray(0, fillNeeded), this.blockLength);
                    this._processBlock(this.block, 0);
                    this.blockLength = 0;
                    offset = fillNeeded;
                } else {
                    this.block.set(data, this.blockLength);
                    this.blockLength += len;
                    return this;
                }
            }

            // Process full 64-byte blocks directly from input without copying
            while (offset + 64 <= len) {
                this._processBlock(data, offset);
                offset += 64;
            }

            // Stash remaining bytes
            if (offset < len) {
                const remaining = len - offset;
                this.block.set(data.subarray(offset, len), 0);
                this.blockLength = remaining;
            }

            return this;
        }

        _processBlock(data, offset) {
            const w = this.w;
            for (let i = 0; i < 16; i++) {
                const p = offset + (i * 4);
                w[i] = (data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | (data[p + 3]);
            }

            for (let i = 16; i < 64; i++) {
                const s0 = (this._rotr(w[i - 15], 7) ^ this._rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3));
                const s1 = (this._rotr(w[i - 2], 17) ^ this._rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10));
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }

            let a = this.h0, b = this.h1, c = this.h2, d = this.h3;
            let e = this.h4, f = this.h5, g = this.h6, h = this.h7;

            const K = StreamingSha256.K;
            for (let i = 0; i < 64; i++) {
                const s1 = (this._rotr(e, 6) ^ this._rotr(e, 11) ^ this._rotr(e, 25));
                const ch = (e & f) ^ ((~e) & g);
                const temp1 = (h + s1 + ch + K[i] + w[i]) | 0;
                const s0 = (this._rotr(a, 2) ^ this._rotr(a, 13) ^ this._rotr(a, 22));
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const temp2 = (s0 + maj) | 0;

                h = g;
                g = f;
                f = e;
                e = (d + temp1) | 0;
                d = c;
                c = b;
                b = a;
                a = (temp1 + temp2) | 0;
            }

            this.h0 = (this.h0 + a) | 0;
            this.h1 = (this.h1 + b) | 0;
            this.h2 = (this.h2 + c) | 0;
            this.h3 = (this.h3 + d) | 0;
            this.h4 = (this.h4 + e) | 0;
            this.h5 = (this.h5 + f) | 0;
            this.h6 = (this.h6 + g) | 0;
            this.h7 = (this.h7 + h) | 0;
        }

        _rotr(x, n) {
            return (x >>> n) | (x << (32 - n));
        }

        digest() {
            if (!this._finalized) {
                // Pad block with 0x80 and 64-bit total length in bits
                const bitLen = this.totalBytes * 8;
                const highBits = Math.floor(bitLen / 0x100000000);
                const lowBits = bitLen >>> 0;

                const pad = new Uint8Array(64);
                pad[0] = 0x80;

                if (this.blockLength < 56) {
                    const padLen = 56 - this.blockLength;
                    this.block.set(pad.subarray(0, padLen), this.blockLength);
                } else {
                    const padLen1 = 64 - this.blockLength;
                    this.block.set(pad.subarray(0, padLen1), this.blockLength);
                    this._processBlock(this.block, 0);
                    this.block.fill(0);
                }

                // Append 64-bit length
                this.block[56] = (highBits >>> 24) & 0xff;
                this.block[57] = (highBits >>> 16) & 0xff;
                this.block[58] = (highBits >>> 8) & 0xff;
                this.block[59] = highBits & 0xff;
                this.block[60] = (lowBits >>> 24) & 0xff;
                this.block[61] = (lowBits >>> 16) & 0xff;
                this.block[62] = (lowBits >>> 8) & 0xff;
                this.block[63] = lowBits & 0xff;
                this._processBlock(this.block, 0);

                this._finalized = true;
            }

            const out = new Uint8Array(32);
            const view = new DataView(out.buffer);
            view.setUint32(0, this.h0, false);
            view.setUint32(4, this.h1, false);
            view.setUint32(8, this.h2, false);
            view.setUint32(12, this.h3, false);
            view.setUint32(16, this.h4, false);
            view.setUint32(20, this.h5, false);
            view.setUint32(24, this.h6, false);
            view.setUint32(28, this.h7, false);
            return out;
        }

        hexDigest() {
            const d = this.digest();
            return MockStream.bytesToHex(d);
        }
    }

    StreamingSha256.K = new Int32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);

    /**
     * Fast 32-bit Xorshift PRNG for repeatable synthetic payload generation.
     */
    class XorShift32 {
        constructor(seed = 0x12345678) {
            this.state = seed === 0 ? 0x12345678 : (seed >>> 0);
        }

        next() {
            let x = this.state;
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            this.state = x >>> 0;
            return this.state;
        }

        nextByte() {
            return (this.next() & 0xff);
        }

        fillBuffer(buffer) {
            const u32 = new Uint32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
            for (let i = 0; i < u32.length; i++) {
                u32[i] = this.next();
            }
            const remainderStart = u32.length * 4;
            for (let i = remainderStart; i < buffer.byteLength; i++) {
                buffer[i] = this.nextByte();
            }
        }
    }

    /**
     * MockStream: Deterministic Synthetic Streaming Generator & Verifier
     */
    const MockStream = {
        StreamingSha256,
        XorShift32,

        /**
         * Hex string <-> Uint8Array conversions
         */
        bytesToHex(bytes) {
            const hex = [];
            for (let i = 0; i < bytes.length; i++) {
                hex.push(bytes[i].toString(16).padStart(2, '0'));
            }
            return hex.join('');
        },

        hexToBytes(hex) {
            if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < hex.length; i += 2) {
                bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
            }
            return bytes;
        },

        /**
         * Create a deterministic Uint8Array buffer of exact length
         * @param {number} length
         * @param {number} seed
         * @param {'prng'|'zeros'|'pattern'|'compressible'} patternType
         */
        createDeterministicBuffer(length, seed = 0x5a3c9b, patternType = 'prng') {
            const buf = new Uint8Array(length);
            if (patternType === 'zeros') {
                buf.fill(0);
            } else if (patternType === 'pattern') {
                for (let i = 0; i < length; i++) {
                    buf[i] = (seed + i) & 0xff;
                }
            } else if (patternType === 'compressible') {
                // Highly compressible repeating pattern (RFC 1951 friendly)
                const phrase = new TextEncoder().encode('ZevSafe-5GB-Streaming-Secure-ZeroKnowledge-Vault-Test-Pattern-');
                for (let i = 0; i < length; i++) {
                    buf[i] = phrase[i % phrase.length];
                }
            } else {
                const prng = new XorShift32(seed);
                prng.fillBuffer(buf);
            }
            return buf;
        },

        /**
         * Pre-calculate the expected SHA-256 hash for a synthetic stream of given size and pattern
         * without keeping the entire payload in memory.
         * Memory complexity: O(chunkSize), runtime: streaming.
         * @param {number} totalBytes
         * @param {number} seed
         * @param {'prng'|'zeros'|'pattern'|'compressible'} patternType
         * @param {number} chunkSize (default 64 KB)
         * @returns {string} 64-character lowercase hex digest
         */
        calculateExpectedSha256(totalBytes, seed = 0x5a3c9b, patternType = 'prng', chunkSize = 65536) {
            const hasher = new StreamingSha256();
            let remaining = totalBytes;
            const chunkBuf = new Uint8Array(chunkSize);
            const prng = patternType === 'prng' ? new XorShift32(seed) : null;
            let offset = 0;

            const phrase = patternType === 'compressible'
                ? new TextEncoder().encode('ZevSafe-5GB-Streaming-Secure-ZeroKnowledge-Vault-Test-Pattern-')
                : null;

            while (remaining > 0) {
                const currentChunkSize = Math.min(remaining, chunkSize);
                const view = currentChunkSize === chunkSize ? chunkBuf : chunkBuf.subarray(0, currentChunkSize);

                if (patternType === 'zeros') {
                    view.fill(0);
                } else if (patternType === 'pattern') {
                    for (let i = 0; i < currentChunkSize; i++) {
                        view[i] = (seed + offset + i) & 0xff;
                    }
                } else if (patternType === 'compressible') {
                    for (let i = 0; i < currentChunkSize; i++) {
                        view[i] = phrase[(offset + i) % phrase.length];
                    }
                } else {
                    prng.fillBuffer(view);
                }

                hasher.update(view);
                remaining -= currentChunkSize;
                offset += currentChunkSize;
            }

            return hasher.hexDigest();
        },

        /**
         * Creates a ReadableStream<Uint8Array> that yields deterministically generated chunks
         * up to totalBytes.
         * Peak JS heap memory footprint stays bounded to <= 1 chunk size (e.g. 64 KB or 4 MB)
         * regardless of whether totalBytes is 100 KB, 100 MB, 1 GB, or 5 GB (5,368,709,120 bytes).
         *
         * @param {number} totalBytes
         * @param {Object} options
         * @param {number} options.chunkSize (default 64 KB, or 4 MB = 4194304)
         * @param {number} options.seed (default 0x5a3c9b)
         * @param {'prng'|'zeros'|'pattern'|'compressible'} options.patternType
         * @param {Function} options.onChunkYielded Optional callback(chunkIndex, bytesYielded, totalBytes)
         * @returns {ReadableStream<Uint8Array>}
         */
        createStream(totalBytes, options = {}) {
            const chunkSize = options.chunkSize || 65536;
            const seed = options.seed !== undefined ? options.seed : 0x5a3c9b;
            const patternType = options.patternType || 'prng';
            const onChunkYielded = options.onChunkYielded || null;

            let remainingBytes = totalBytes;
            let emittedBytes = 0;
            let chunkIndex = 0;

            const prng = patternType === 'prng' ? new XorShift32(seed) : null;
            const phrase = patternType === 'compressible'
                ? new TextEncoder().encode('ZevSafe-5GB-Streaming-Secure-ZeroKnowledge-Vault-Test-Pattern-')
                : null;

            return new ReadableStream({
                pull(controller) {
                    if (remainingBytes <= 0) {
                        controller.close();
                        return;
                    }

                    const thisChunkSize = Math.min(remainingBytes, chunkSize);
                    const chunk = new Uint8Array(thisChunkSize);

                    if (patternType === 'zeros') {
                        chunk.fill(0);
                    } else if (patternType === 'pattern') {
                        for (let i = 0; i < thisChunkSize; i++) {
                            chunk[i] = (seed + emittedBytes + i) & 0xff;
                        }
                    } else if (patternType === 'compressible') {
                        for (let i = 0; i < thisChunkSize; i++) {
                            chunk[i] = phrase[(emittedBytes + i) % phrase.length];
                        }
                    } else {
                        prng.fillBuffer(chunk);
                    }

                    remainingBytes -= thisChunkSize;
                    emittedBytes += thisChunkSize;
                    chunkIndex++;

                    if (onChunkYielded) {
                        onChunkYielded(chunkIndex - 1, emittedBytes, totalBytes);
                    }

                    controller.enqueue(chunk);
                }
            });
        },

        /**
         * Reads an entire stream and computes its running SHA-256 hash.
         * Verifies whether the final stream hash matches expectedSha256.
         * @param {ReadableStream<Uint8Array>} stream
         * @param {string} [expectedSha256]
         * @returns {Promise<{ matches: boolean, actualSha256: string, totalBytes: number, chunkCount: number }>}
         */
        async verifyStreamIntegrity(stream, expectedSha256 = null) {
            const reader = stream.getReader();
            const hasher = new StreamingSha256();
            let totalBytes = 0;
            let chunkCount = 0;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value && value.length > 0) {
                        hasher.update(value);
                        totalBytes += value.length;
                        chunkCount++;
                    }
                }
            } finally {
                reader.releaseLock();
            }

            const actualSha256 = hasher.hexDigest();
            const matches = expectedSha256 ? (actualSha256.toLowerCase() === expectedSha256.toLowerCase()) : true;

            return {
                matches,
                actualSha256,
                totalBytes,
                chunkCount
            };
        },

        /**
         * Creates a virtual file hierarchy representation for testing the ZIP64 streaming packager
         * without allocating files on the physical disk or holding big blobs in memory.
         *
         * @param {Array<{ path: string, size: number, pattern?: string, seed?: number }>} fileDefs
         * @returns {Array<{ name: string, path: string, size: number, stream: () => ReadableStream<Uint8Array>, expectedSha256: string }>}
         */
        createVirtualFiles(fileDefs) {
            return fileDefs.map((def, idx) => {
                const size = def.size || 0;
                const seed = def.seed !== undefined ? def.seed : (0x1000 + idx);
                const pattern = def.pattern || (def.path && def.path.endsWith('.txt') ? 'compressible' : 'prng');
                const expectedSha256 = MockStream.calculateExpectedSha256(size, seed, pattern);

                return {
                    name: def.name || def.path.split('/').pop(),
                    path: def.path,
                    size: size,
                    stream: () => MockStream.createStream(size, { seed, patternType: pattern }),
                    expectedSha256: expectedSha256
                };
            });
        },

        /**
         * Clones a stream while introducing a deliberate single-byte corruption at corruptionOffset
         * for tamper and authentication tag verification.
         * @param {ReadableStream<Uint8Array>} sourceStream
         * @param {number} corruptionOffset Byte offset where corruption occurs
         * @param {number} [xorByte=0x01] Value to XOR onto the corrupted byte
         * @returns {ReadableStream<Uint8Array>}
         */
        createCorruptedStream(sourceStream, corruptionOffset, xorByte = 0x01) {
            const reader = sourceStream.getReader();
            let currentOffset = 0;

            return new ReadableStream({
                async pull(controller) {
                    const { done, value } = await reader.read();
                    if (done) {
                        controller.close();
                        return;
                    }

                    const chunk = new Uint8Array(value);
                    const chunkStart = currentOffset;
                    const chunkEnd = currentOffset + chunk.length;

                    if (corruptionOffset >= chunkStart && corruptionOffset < chunkEnd) {
                        const localIndex = corruptionOffset - chunkStart;
                        chunk[localIndex] = chunk[localIndex] ^ xorByte;
                    }

                    currentOffset += chunk.length;
                    controller.enqueue(chunk);
                },
                cancel(reason) {
                    return reader.cancel(reason);
                }
            });
        }
    };

    // Export to global scope / CommonJS
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MockStream;
    } else {
        global.MockStream = MockStream;
        global.StreamingSha256 = StreamingSha256;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
