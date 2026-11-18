/**
 * ZevSafe — Argon2id Memory-Hard Key Derivation Engine (RFC 9106)
 * js/argon2id.js
 *
 * Implements 100% client-side, zero-knowledge, memory-hard key stretching
 * conforming to RFC 9106 (Argon2id Hybrid: data-independent indexing in early
 * passes for side-channel immunity, transitioning to data-dependent indexing
 * for GPU cluster and ASIC resistance).
 *
 * Invariant: Transient 64 MB matrix is allocated once, processed off-thread,
 * and immediately zeroized via .fill(0n) upon key derivation.
 */

(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        const exports = factory();
        root.Argon2id = exports;
        if (typeof globalThis !== 'undefined') {
            globalThis.Argon2id = exports;
        }
    }
}(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    // =========================================================================
    // RFC 9106 CONSTANTS
    // =========================================================================

    const ARGON2_VERSION_13 = 0x13; // 19
    const ARGON2_TYPE_ID = 2;       // Argon2id

    /** Default RFC 9106 parameters for production vaults */
    const DEFAULT_MEMORY_KIB = 65536; // 64 MiB
    const DEFAULT_ITERATIONS = 3;     // 3 passes
    const DEFAULT_LANES = 4;          // 4 parallel threads/lanes
    const DEFAULT_TAG_LENGTH = 32;    // 256 bits AES key

    const IV = [
        0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn,
        0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
        0x510e527fade682d1n, 0x9b05688c2b3e6c1fn,
        0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n
    ];

    const SIGMA = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
        [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
        [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
        [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
        [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
        [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
        [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
        [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
        [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3]
    ];

    const MASK64 = 0xffffffffffffffffn;
    const MASK32 = 0xffffffffn;

    function rotr64(x, n) {
        const shift = BigInt(n);
        return (((x >> shift) | (x << (64n - shift))) & MASK64);
    }

    // =========================================================================
    // BLAKE2B CRYPTOGRAPHIC HASH (RFC 7693)
    // =========================================================================

    function blake2bCompress(h, m, t0, t1, f0) {
        const v = new BigUint64Array(16);
        for (let i = 0; i < 8; i++) v[i] = h[i];
        v[8] = IV[0]; v[9] = IV[1]; v[10] = IV[2]; v[11] = IV[3];
        v[12] = IV[4] ^ t0;
        v[13] = IV[5] ^ t1;
        v[14] = IV[6] ^ f0;
        v[15] = IV[7];

        function G(a, b, c, d, x, y) {
            v[a] = (v[a] + v[b] + x) & MASK64;
            v[d] = rotr64(v[d] ^ v[a], 32);
            v[c] = (v[c] + v[d]) & MASK64;
            v[b] = rotr64(v[b] ^ v[c], 24);
            v[a] = (v[a] + v[b] + y) & MASK64;
            v[d] = rotr64(v[d] ^ v[a], 16);
            v[c] = (v[c] + v[d]) & MASK64;
            v[b] = rotr64(v[b] ^ v[c], 63);
        }

        for (let r = 0; r < 12; r++) {
            const s = SIGMA[r];
            G(0, 4, 8, 12, m[s[0]], m[s[1]]);
            G(1, 5, 9, 13, m[s[2]], m[s[3]]);
            G(2, 6, 10, 14, m[s[4]], m[s[5]]);
            G(3, 7, 11, 15, m[s[6]], m[s[7]]);
            G(0, 5, 10, 15, m[s[8]], m[s[9]]);
            G(1, 6, 11, 12, m[s[10]], m[s[11]]);
            G(2, 7, 8, 13, m[s[12]], m[s[13]]);
            G(3, 4, 9, 14, m[s[14]], m[s[15]]);
        }

        for (let i = 0; i < 8; i++) {
            h[i] = (h[i] ^ v[i] ^ v[i + 8]) & MASK64;
        }
    }

    function blake2b(outLen, key, input) {
        const h = new BigUint64Array(8);
        for (let i = 0; i < 8; i++) h[i] = IV[i];
        const param = BigInt(outLen) | (BigInt(key ? key.length : 0) << 8n) | (1n << 16n) | (1n << 24n);
        h[0] ^= param;

        const block = new Uint8Array(128);
        const m = new BigUint64Array(16);
        const mView = new DataView(block.buffer);

        let t0 = 0n;
        let t1 = 0n;

        function processBlock(f0) {
            for (let i = 0; i < 16; i++) {
                m[i] = mView.getBigUint64(i * 8, true);
            }
            blake2bCompress(h, m, t0, t1, f0);
        }

        if (key && key.length > 0) {
            block.set(key, 0);
            t0 = 128n;
            if (input.length === 0) {
                processBlock(MASK64);
                const out = new Uint8Array(outLen);
                const hView = new DataView(h.buffer);
                for (let i = 0; i < outLen; i++) out[i] = hView.getUint8(i);
                return out;
            } else {
                processBlock(0n);
                block.fill(0);
            }
        }

        let inOffset = 0;
        let remaining = input.length;

        while (remaining > 128) {
            block.set(input.subarray(inOffset, inOffset + 128), 0);
            inOffset += 128;
            remaining -= 128;
            t0 += 128n;
            if (t0 < 128n) t1 += 1n;
            processBlock(0n);
        }

        block.fill(0);
        block.set(input.subarray(inOffset), 0);
        t0 += BigInt(remaining);
        if (t0 < BigInt(remaining)) t1 += 1n;
        processBlock(MASK64);

        const out = new Uint8Array(outLen);
        const hView = new DataView(h.buffer);
        for (let i = 0; i < outLen; i++) out[i] = hView.getUint8(i);
        return out;
    }

    /** Variable-length hash function H' (RFC 9106 Section 3.2.2) */
    function Hprime(outLen, input) {
        const prefix = new Uint8Array(4);
        new DataView(prefix.buffer).setUint32(0, outLen, true);
        const prepended = new Uint8Array(4 + input.length);
        prepended.set(prefix, 0);
        prepended.set(input, 4);

        if (outLen <= 64) {
            return blake2b(outLen, null, prepended);
        }

        const r = Math.ceil(outLen / 32) - 2;
        const out = new Uint8Array(outLen);
        let v = blake2b(64, null, prepended);
        out.set(v.subarray(0, 32), 0);
        let outOffset = 32;

        for (let i = 2; i <= r; i++) {
            v = blake2b(64, null, v);
            out.set(v.subarray(0, 32), outOffset);
            outOffset += 32;
        }

        const lastLen = outLen - 32 * r;
        v = blake2b(lastLen, null, v);
        out.set(v, outOffset);
        return out;
    }

    // =========================================================================
    // ARGON2 BLOCK COMPRESSION G & PERMUTATION P (RFC 9106 Section 3.5 & 3.6)
    // =========================================================================

    function fGB(v, a, b, c, d) {
        let va = v[a];
        let vb = v[b];
        let vc = v[c];
        let vd = v[d];

        va = (va + vb + 2n * (va & MASK32) * (vb & MASK32)) & MASK64;
        vd = rotr64(vd ^ va, 32);
        vc = (vc + vd + 2n * (vc & MASK32) * (vd & MASK32)) & MASK64;
        vb = rotr64(vb ^ vc, 24);

        va = (va + vb + 2n * (va & MASK32) * (vb & MASK32)) & MASK64;
        vd = rotr64(vd ^ va, 16);
        vc = (vc + vd + 2n * (vc & MASK32) * (vd & MASK32)) & MASK64;
        vb = rotr64(vb ^ vc, 63);

        v[a] = va;
        v[b] = vb;
        v[c] = vc;
        v[d] = vd;
    }

    function permuteP(v) {
        // Columns
        fGB(v, 0, 4, 8, 12);
        fGB(v, 1, 5, 9, 13);
        fGB(v, 2, 6, 10, 14);
        fGB(v, 3, 7, 11, 15);

        // Diagonals
        fGB(v, 0, 5, 10, 15);
        fGB(v, 1, 6, 11, 12);
        fGB(v, 2, 7, 8, 13);
        fGB(v, 3, 4, 9, 14);
    }

    // Pre-allocated static working buffers to avoid GC pressure in inner loops
    const _R = new BigUint64Array(128);
    const _Z = new BigUint64Array(128);
    const _row = new BigUint64Array(16);
    const _col = new BigUint64Array(16);
    const _zeroBlock = new BigUint64Array(128);
    const _inputZ = new BigUint64Array(128);
    const _blockZ = new BigUint64Array(128);
    const _addressBlock = new BigUint64Array(128);
    const _tmp = new BigUint64Array(128);

    function blockG(X, Y, out) {
        // R = X ^ Y
        for (let i = 0; i < 128; i++) {
            _R[i] = X[i] ^ Y[i];
            _Z[i] = _R[i];
        }

        // Row-wise permutations
        for (let r = 0; r < 8; r++) {
            for (let i = 0; i < 16; i++) _row[i] = _Z[r * 16 + i];
            permuteP(_row);
            for (let i = 0; i < 16; i++) _Z[r * 16 + i] = _row[i];
        }

        // Column-wise permutations
        for (let c = 0; c < 8; c++) {
            for (let r = 0; r < 8; r++) {
                _col[2 * r] = _Z[r * 16 + 2 * c];
                _col[2 * r + 1] = _Z[r * 16 + 2 * c + 1];
            }
            permuteP(_col);
            for (let r = 0; r < 8; r++) {
                _Z[r * 16 + 2 * c] = _col[2 * r];
                _Z[r * 16 + 2 * c + 1] = _col[2 * r + 1];
            }
        }

        // Output = Z ^ R
        for (let i = 0; i < 128; i++) {
            out[i] = _Z[i] ^ _R[i];
        }
    }

    // =========================================================================
    // PRIMARY ARGON2ID API (RFC 9106)
    // =========================================================================

    /**
     * Derives a cryptographic tag/key using Argon2id (RFC 9106).
     *
     * @param {string|Uint8Array} password - Master password
     * @param {Uint8Array} salt - CSPRNG salt (>= 8 bytes, typically 16 or 32)
     * @param {Object} [options] - Configuration bag
     * @param {number} [options.m=65536] - Memory size in KiB (default: 64 MB)
     * @param {number} [options.t=3] - Number of passes/iterations (default: 3)
     * @param {number} [options.p=4] - Parallelism degree/lanes (default: 4)
     * @param {number} [options.hashLen=32] - Output key size in bytes (default: 32)
     * @param {Uint8Array|null} [options.key=null] - Optional secret key (K)
     * @param {Uint8Array|null} [options.ad=null] - Optional associated data (X)
     * @param {Function|null} [options.onProgress=null] - Optional callback (percent, pass, totalPasses)
     * @returns {Promise<Uint8Array>} Derived key bytes (tag)
     */
    async function hash(password, salt, options = {}) {
        if (!password && password !== '') {
            throw new TypeError('Password is required');
        }
        if (!salt || salt.byteLength < 8) {
            throw new TypeError('Salt must be at least 8 bytes');
        }

        const pwdBytes = typeof password === 'string'
            ? new TextEncoder().encode(password)
            : (password instanceof Uint8Array ? password : new Uint8Array(password));

        const saltBytes = salt instanceof Uint8Array ? salt : new Uint8Array(salt);

        const m = (options.m !== undefined && options.m !== null) ? options.m : DEFAULT_MEMORY_KIB;
        const t = (options.t !== undefined && options.t !== null) ? options.t : DEFAULT_ITERATIONS;
        const p = (options.p !== undefined && options.p !== null) ? options.p : DEFAULT_LANES;
        const hashLen = (options.hashLen !== undefined && options.hashLen !== null) ? options.hashLen : DEFAULT_TAG_LENGTH;
        const key = options.key || null;
        const ad = options.ad || null;
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

        if (m < 8 * p) {
            throw new RangeError(`Memory size m (${m} KiB) must be at least 8 * p (${8 * p} KiB)`);
        }
        if (t < 1) {
            throw new RangeError(`Iterations t (${t}) must be at least 1`);
        }
        if (p < 1 || p > 0xFFFFFF) {
            throw new RangeError(`Parallelism p (${p}) must be between 1 and 16,777,215`);
        }

        const v = ARGON2_VERSION_13;
        const y = ARGON2_TYPE_ID;

        // 1. Initial Hash H0
        const pwdLen = pwdBytes.length;
        const saltLen = saltBytes.length;
        const keyLen = key ? key.length : 0;
        const adLen = ad ? ad.length : 0;

        const h0InputLen = 4 * 6 + 4 + pwdLen + 4 + saltLen + 4 + keyLen + 4 + adLen;
        const h0Buf = new Uint8Array(h0InputLen);
        const h0View = new DataView(h0Buf.buffer);
        let off = 0;

        h0View.setUint32(off, p, true); off += 4;
        h0View.setUint32(off, hashLen, true); off += 4;
        h0View.setUint32(off, m, true); off += 4;
        h0View.setUint32(off, t, true); off += 4;
        h0View.setUint32(off, v, true); off += 4;
        h0View.setUint32(off, y, true); off += 4;

        h0View.setUint32(off, pwdLen, true); off += 4;
        if (pwdLen > 0) { h0Buf.set(pwdBytes, off); off += pwdLen; }

        h0View.setUint32(off, saltLen, true); off += 4;
        if (saltLen > 0) { h0Buf.set(saltBytes, off); off += saltLen; }

        h0View.setUint32(off, keyLen, true); off += 4;
        if (keyLen > 0) { h0Buf.set(key, off); off += keyLen; }

        h0View.setUint32(off, adLen, true); off += 4;
        if (adLen > 0) { h0Buf.set(ad, off); off += adLen; }

        const H0 = blake2b(64, null, h0Buf);

        // 2. Memory Allocation
        const mPrime = 4 * p * Math.floor(m / (4 * p));
        const q = mPrime / p; // blocks per lane
        const slLen = q / 4;  // blocks per slice per lane

        // Flat memory matrix: mPrime blocks of 1024 bytes (128 BigUint64 words each)
        const B = new BigUint64Array(mPrime * 128);

        function getBlock(lane, col) {
            const start = (lane * q + col) * 128;
            return B.subarray(start, start + 128);
        }

        try {
            // 3. First two blocks of each lane (j = 0, 1)
            const blockInitBuf = new Uint8Array(64 + 8);
            blockInitBuf.set(H0, 0);
            const blockInitView = new DataView(blockInitBuf.buffer);

            for (let l = 0; l < p; l++) {
                for (let j = 0; j < 2; j++) {
                    blockInitView.setUint32(64, j, true);
                    blockInitView.setUint32(68, l, true);
                    const blockBytes = Hprime(1024, blockInitBuf);
                    const blockWords = new BigUint64Array(blockBytes.buffer);
                    const target = getBlock(l, j);
                    target.set(blockWords);
                }
            }

            // 4. Memory-filling loop
            const totalSteps = t * 4 * p;
            let currentStep = 0;

            for (let r = 0; r < t; r++) {
                for (let sl = 0; sl < 4; sl++) {
                    for (let l = 0; l < p; l++) {
                        const isArgon2i = (r === 0 && (sl === 0 || sl === 1));

                        let ctr = 1;
                        if (isArgon2i) {
                            _inputZ.fill(0n);
                            _inputZ[0] = BigInt(r);
                            _inputZ[1] = BigInt(l);
                            _inputZ[2] = BigInt(sl);
                            _inputZ[3] = BigInt(mPrime);
                            _inputZ[4] = BigInt(t);
                            _inputZ[5] = BigInt(y);
                            _inputZ[6] = BigInt(ctr);
                            blockG(_zeroBlock, _inputZ, _blockZ);
                            blockG(_zeroBlock, _blockZ, _addressBlock);
                        }

                        const startIdx = (r === 0 && sl === 0) ? 2 : 0;
                        for (let idx = startIdx; idx < slLen; idx++) {
                            const j = sl * slLen + idx;
                            const prev = (j === 0) ? getBlock(l, q - 1) : getBlock(l, j - 1);

                            let J1 = 0;
                            let J2 = 0;

                            if (isArgon2i) {
                                const addrIdx = (idx % 128);
                                if (addrIdx === 0 && idx > 0) {
                                    ctr++;
                                    _inputZ[6] = BigInt(ctr);
                                    blockG(_zeroBlock, _inputZ, _blockZ);
                                    blockG(_zeroBlock, _blockZ, _addressBlock);
                                }
                                const lowHigh = _addressBlock[addrIdx];
                                J1 = Number(lowHigh & MASK32);
                                J2 = Number((lowHigh >> 32n) & MASK32);
                            } else {
                                // Argon2d
                                const lowHigh = prev[0];
                                J1 = Number(lowHigh & MASK32);
                                J2 = Number((lowHigh >> 32n) & MASK32);
                            }

                            // Reference Lane
                            const refLane = (r === 0 && sl === 0) ? l : (J2 % p);

                            // Candidate Window W
                            let Wlen = 0;
                            let startCol = 0;

                            if (r === 0) {
                                if (refLane === l) {
                                    Wlen = j - 1;
                                    startCol = 0;
                                } else {
                                    Wlen = sl * slLen - (idx === 0 ? 1 : 0);
                                    startCol = 0;
                                }
                            } else {
                                if (refLane === l) {
                                    Wlen = q - slLen + idx - 1;
                                    startCol = ((sl + 1) % 4) * slLen;
                                } else {
                                    Wlen = q - slLen - (idx === 0 ? 1 : 0);
                                    startCol = ((sl + 1) % 4) * slLen;
                                }
                            }

                            // Map J1 to relative index
                            const J1Big = BigInt(J1);
                            const x = (J1Big * J1Big) >> 32n;
                            const yVal = (BigInt(Wlen) * x) >> 32n;
                            const zz = Wlen - 1 - Number(yVal);

                            const refCol = (startCol + zz) % q;
                            const refBlock = getBlock(refLane, refCol);

                            const curr = getBlock(l, j);
                            blockG(prev, refBlock, _tmp);

                            if (r === 0) {
                                curr.set(_tmp);
                            } else {
                                for (let k = 0; k < 128; k++) curr[k] ^= _tmp[k];
                            }
                        }

                        currentStep++;
                        if (onProgress && (currentStep % p === 0)) {
                            const percent = Math.min(100, Math.round((currentStep / totalSteps) * 100));
                            onProgress(percent, r + 1, t);
                        }
                    }
                }
            }

            // 5. Final XOR sum of last blocks
            const C = new BigUint64Array(128);
            for (let l = 0; l < p; l++) {
                const lastBlock = getBlock(l, q - 1);
                for (let k = 0; k < 128; k++) C[k] ^= lastBlock[k];
            }

            const cBytes = new Uint8Array(C.buffer);
            const tag = Hprime(hashLen, cBytes);

            C.fill(0n);
            return tag;
        } finally {
            // Strict memory zeroization
            B.fill(0n);
            _R.fill(0n);
            _Z.fill(0n);
            _row.fill(0n);
            _col.fill(0n);
            _inputZ.fill(0n);
            _blockZ.fill(0n);
            _addressBlock.fill(0n);
            _tmp.fill(0n);
        }
    }

    return {
        hash,
        blake2b,
        Hprime,
        ARGON2_VERSION_13,
        ARGON2_TYPE_ID,
        DEFAULT_MEMORY_KIB,
        DEFAULT_ITERATIONS,
        DEFAULT_LANES,
        DEFAULT_TAG_LENGTH
    };
}));
