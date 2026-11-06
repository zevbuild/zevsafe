/**
 * ZevSafe Pure-JS Air-Gap QR Engine & Paper-Safe Recovery Generator
 *
 * Implements ISO/IEC 18004 QR Code Model 2 generation in 100% pure JavaScript.
 * Zero external dependencies. Zero network calls. Zero third-party CDNs.
 *
 * Capabilities:
 * 1. Pure-JS QR Matrix generation (Versions 1-14, EC levels L, M, Q, H, Byte Mode).
 * 2. High-precision vector SVG rendering with dark/light module styling and quiet zones.
 * 3. Paper-Safe Cold-Storage Recovery Certificate generator (Guilloche security border,
 *    salt fingerprint grouping, handwrittenDiceware/passphrase boxes, instructions).
 * 4. Optical QR Scanner controller (W3C BarcodeDetector API + image drop / file decoder).
 *
 * @license MIT
 * @version 1.0.0
 */

(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        root.QREngine = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // =========================================================================
    // 1. GALOIS FIELD GF(256) ARITHMETIC
    // =========================================================================

    const GF256_EXP = new Uint8Array(512);
    const GF256_LOG = new Uint8Array(256);

    (function initGF256() {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            GF256_EXP[i] = x;
            GF256_EXP[i + 255] = x;
            GF256_LOG[x] = i;
            x = (x << 1) ^ (x >= 128 ? 0x11D : 0); // Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
        }
    })();

    function gfMul(x, y) {
        if (x === 0 || y === 0) return 0;
        return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]];
    }

    /**
     * Compute Reed-Solomon generator polynomial of degree degree
     */
    function rsGeneratorPoly(degree) {
        let poly = new Uint8Array([1]);
        for (let i = 0; i < degree; i++) {
            const next = new Uint8Array(poly.length + 1);
            const factor = GF256_EXP[i];
            for (let j = 0; j < poly.length; j++) {
                next[j] ^= gfMul(poly[j], factor);
                next[j + 1] ^= poly[j];
            }
            poly = next;
        }
        return poly;
    }

    /**
     * Compute Reed-Solomon error correction codewords for data bytes
     */
    function rsComputeRemainder(data, ecCount) {
        const gen = rsGeneratorPoly(ecCount);
        const remainder = new Uint8Array(ecCount);
        for (let i = 0; i < data.length; i++) {
            const factor = data[i] ^ remainder[0];
            for (let j = 0; j < ecCount - 1; j++) {
                remainder[j] = remainder[j + 1] ^ gfMul(gen[ecCount - 1 - j], factor);
            }
            remainder[ecCount - 1] = gfMul(gen[0], factor);
        }
        return remainder;
    }

    // =========================================================================
    // 2. QR CODE MODEL 2 SPECIFICATION TABLES (Versions 1-14)
    // =========================================================================

    // Error Correction Levels: L (7%), M (15%), Q (25%), H (30%)
    const EC_LEVELS = {
        L: { tableIndex: 0, formatBits: 0x01 },
        M: { tableIndex: 1, formatBits: 0x00 },
        Q: { tableIndex: 2, formatBits: 0x03 },
        H: { tableIndex: 3, formatBits: 0x02 }
    };

    /**
     * Table of QR Versions 1 to 14:
     * [totalCodewords, [[ecCount, numBlocksG1, dataPerBlockG1, numBlocksG2, dataPerBlockG2], ... for L, M, Q, H]]
     */
    const QR_TABLE = [
        null, // 1-indexed
        // V1 (21x21)
        [26, [[7, 1, 19, 0, 0], [10, 1, 16, 0, 0], [13, 1, 13, 0, 0], [17, 1, 9, 0, 0]]],
        // V2 (25x25)
        [44, [[10, 1, 34, 0, 0], [16, 1, 28, 0, 0], [22, 1, 22, 0, 0], [28, 1, 16, 0, 0]]],
        // V3 (29x29)
        [70, [[15, 1, 55, 0, 0], [26, 1, 44, 0, 0], [18, 2, 17, 0, 0], [22, 2, 13, 0, 0]]],
        // V4 (33x33)
        [100, [[20, 1, 80, 0, 0], [18, 2, 32, 0, 0], [26, 2, 24, 0, 0], [16, 4, 9, 0, 0]]],
        // V5 (37x37)
        [134, [[26, 1, 108, 0, 0], [24, 2, 43, 0, 0], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12]]],
        // V6 (41x41)
        [172, [[18, 2, 68, 0, 0], [16, 4, 27, 0, 0], [24, 4, 19, 0, 0], [28, 4, 15, 0, 0]]],
        // V7 (45x45)
        [196, [[20, 2, 78, 0, 0], [18, 4, 31, 0, 0], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14]]],
        // V8 (49x49)
        [242, [[24, 2, 97, 0, 0], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15]]],
        // V9 (53x53)
        [292, [[30, 2, 116, 0, 0], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13]]],
        // V10 (57x57)
        [346, [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16]]],
        // V11 (61x61)
        [404, [[20, 4, 81, 0, 0], [30, 1, 50, 4, 51], [28, 4, 22, 4, 23], [24, 3, 12, 8, 13]]],
        // V12 (65x65)
        [466, [[24, 2, 92, 2, 93], [22, 6, 36, 2, 37], [26, 4, 20, 6, 21], [28, 7, 14, 4, 15]]],
        // V13 (69x69)
        [532, [[26, 4, 107, 0, 0], [22, 8, 37, 1, 38], [24, 8, 20, 4, 21], [22, 12, 11, 4, 12]]],
        // V14 (73x73)
        [581, [[30, 3, 115, 1, 116], [24, 4, 40, 5, 41], [20, 11, 16, 5, 17], [24, 11, 12, 5, 13]]]
    ];

    /**
     * Alignment pattern centre coordinates for Versions 1-14
     */
    const ALIGNMENT_PATTERN_LOCATIONS = [
        [], // V1 has none
        [6, 18], // V2
        [6, 22], // V3
        [6, 26], // V4
        [6, 30], // V5
        [6, 34], // V6
        [6, 22, 38], // V7
        [6, 24, 42], // V8
        [6, 26, 46], // V9
        [6, 28, 50], // V10
        [6, 30, 54], // V11
        [6, 32, 58], // V12
        [6, 34, 62], // V13
        [6, 26, 46, 66] // V14
    ];

    /**
     * Version info 18-bit bitstrings for Versions 7-14 (6 data bits + 12 BCH bits)
     */
    const VERSION_INFO = {
        7: 0x07C94,
        8: 0x085BC,
        9: 0x09A99,
        10: 0x0A4D3,
        11: 0x0BBF6,
        12: 0x0C762,
        13: 0x0D847,
        14: 0x0E60D
    };

    /**
     * Format info 15-bit strings (5 data bits + 10 BCH bits XOR 0x5412)
     */
    const FORMAT_INFO_MASK = 0x5412;

    function getFormatInfo(ecLevel, mask) {
        const data = (ecLevel.formatBits << 3) | mask;
        let rem = data << 10;
        for (let i = 4; i >= 0; i--) {
            if ((rem >> (i + 10)) & 1) {
                rem ^= 0x537 << i; // BCH generator polynomial x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
            }
        }
        return ((data << 10) | rem) ^ FORMAT_INFO_MASK;
    }

    // =========================================================================
    // 3. BITSTREAM ENCODING & AUTO-VERSION SELECTION
    // =========================================================================

    class BitBuffer {
        constructor() {
            this.buffer = [];
            this.length = 0;
        }

        put(num, length) {
            for (let i = 0; i < length; i++) {
                this.putBit(((num >>> (length - i - 1)) & 1) === 1);
            }
        }

        putBit(bit) {
            const bufIndex = Math.floor(this.length / 8);
            if (this.buffer.length <= bufIndex) {
                this.buffer.push(0);
            }
            if (bit) {
                this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
            }
            this.length++;
        }

        getBytes() {
            return new Uint8Array(this.buffer);
        }
    }

    /**
     * Encode string in UTF-8 Byte Mode (Mode 0100)
     */
    function encodeData(text, version, ecLevel) {
        const encoder = new TextEncoder();
        const dataBytes = encoder.encode(text);
        const ecIdx = EC_LEVELS[ecLevel].tableIndex;
        const entry = QR_TABLE[version][1][ecIdx];
        const totalDataBytes = entry[1] * entry[2] + entry[3] * entry[4];

        const bb = new BitBuffer();
        // Mode indicator for 8-bit byte mode: 0100
        bb.put(0x4, 4);

        // Character count indicator: 8 bits for V1-9, 16 bits for V10-40
        const countBits = version < 10 ? 8 : 16;
        bb.put(dataBytes.length, countBits);

        // Data bytes
        for (let i = 0; i < dataBytes.length; i++) {
            bb.put(dataBytes[i], 8);
        }

        // Terminator: up to 4 zero bits if room permits
        const maxBits = totalDataBytes * 8;
        const termLen = Math.min(4, maxBits - bb.length);
        if (termLen > 0) bb.put(0, termLen);

        // Pad to nearest byte boundary
        while (bb.length % 8 !== 0) {
            bb.putBit(false);
        }

        // Pad with alternating 0xEC and 0x11
        const padBytes = [0xEC, 0x11];
        let padIdx = 0;
        while (bb.length < maxBits) {
            bb.put(padBytes[padIdx % 2], 8);
            padIdx++;
        }

        return bb.getBytes();
    }

    /**
     * Determine minimum QR Version required for text length at given EC level
     */
    function findMinVersion(textLengthBytes, ecLevel = 'M') {
        const ecIdx = EC_LEVELS[ecLevel].tableIndex;
        for (let v = 1; v <= 14; v++) {
            const entry = QR_TABLE[v][1][ecIdx];
            const maxDataBytes = entry[1] * entry[2] + entry[3] * entry[4];
            const overheadBytes = v < 10 ? 2 : 3; // 4 bit mode + 8/16 bit count
            if (textLengthBytes + overheadBytes <= maxDataBytes) {
                return v;
            }
        }
        throw new Error(`Data payload (${textLengthBytes} bytes) exceeds QR Version 14 capacity at EC level ${ecLevel}`);
    }

    /**
     * Interleave data blocks and error correction codewords
     */
    function interleaveBlocks(dataBytes, version, ecLevel) {
        const ecIdx = EC_LEVELS[ecLevel].tableIndex;
        const entry = QR_TABLE[version][1][ecIdx];
        const ecCount = entry[0];
        const numBlocksG1 = entry[1];
        const dataPerBlockG1 = entry[2];
        const numBlocksG2 = entry[3];
        const dataPerBlockG2 = entry[4];

        const totalBlocks = numBlocksG1 + numBlocksG2;
        const dataBlocks = [];
        const ecBlocks = [];

        let offset = 0;
        for (let b = 0; b < totalBlocks; b++) {
            const dataLen = b < numBlocksG1 ? dataPerBlockG1 : dataPerBlockG2;
            const blockData = dataBytes.subarray(offset, offset + dataLen);
            offset += dataLen;
            dataBlocks.push(blockData);
            ecBlocks.push(rsComputeRemainder(blockData, ecCount));
        }

        // Interleave data codewords
        const result = [];
        const maxDataLen = Math.max(dataPerBlockG1, dataPerBlockG2);
        for (let i = 0; i < maxDataLen; i++) {
            for (let b = 0; b < totalBlocks; b++) {
                if (i < dataBlocks[b].length) {
                    result.push(dataBlocks[b][i]);
                }
            }
        }

        // Interleave EC codewords
        for (let i = 0; i < ecCount; i++) {
            for (let b = 0; b < totalBlocks; b++) {
                result.push(ecBlocks[b][i]);
            }
        }

        return new Uint8Array(result);
    }

    // =========================================================================
    // 4. MATRIX LAYOUT & MASKING
    // =========================================================================

    class QRMatrix {
        constructor(version) {
            this.version = version;
            this.size = 17 + 4 * version;
            this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(null));
            this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
        }

        setFunction(r, c, val) {
            this.modules[r][c] = !!val;
            this.isFunction[r][c] = true;
        }

        setupFinderPatterns() {
            const place = (row, col) => {
                for (let r = -1; r <= 7; r++) {
                    for (let c = -1; c <= 7; c++) {
                        const targetR = row + r;
                        const targetC = col + c;
                        if (targetR < 0 || targetR >= this.size || targetC < 0 || targetC >= this.size) continue;
                        if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                            (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
                            this.setFunction(targetR, targetC, true);
                        } else {
                            this.setFunction(targetR, targetC, false);
                        }
                    }
                }
            };
            place(0, 0);
            place(0, this.size - 7);
            place(this.size - 7, 0);
        }

        setupTimingPatterns() {
            for (let i = 8; i < this.size - 8; i++) {
                if (this.isFunction[6][i]) continue;
                this.setFunction(6, i, i % 2 === 0);
                this.setFunction(i, 6, i % 2 === 0);
            }
        }

        setupAlignmentPatterns() {
            const locs = ALIGNMENT_PATTERN_LOCATIONS[this.version - 1];
            if (!locs || locs.length === 0) return;

            for (let i = 0; i < locs.length; i++) {
                for (let j = 0; j < locs.length; j++) {
                    const r = locs[i];
                    const c = locs[j];
                    // Skip if overlaps with finder patterns
                    if ((r <= 8 && c <= 8) || (r <= 8 && c >= this.size - 8) || (r >= this.size - 8 && c <= 8)) continue;

                    for (let dr = -2; dr <= 2; dr++) {
                        for (let dc = -2; dc <= 2; dc++) {
                            const isDark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
                            this.setFunction(r + dr, c + dc, isDark);
                        }
                    }
                }
            }
        }

        setupDarkModule() {
            this.setFunction(4 * this.version + 9, 8, true);
        }

        reserveFormatAndVersion() {
            // Reserve format info areas around finders
            for (let i = 0; i < 9; i++) {
                if (i !== 6) {
                    this.isFunction[8][i] = true;
                    this.isFunction[i][8] = true;
                }
            }
            for (let i = 0; i < 8; i++) {
                this.isFunction[8][this.size - 1 - i] = true;
                this.isFunction[this.size - 1 - i][8] = true;
            }

            // Reserve version info areas for version >= 7
            if (this.version >= 7) {
                for (let r = 0; r < 6; r++) {
                    for (let c = 0; c < 3; c++) {
                        this.isFunction[r][this.size - 11 + c] = true;
                        this.isFunction[this.size - 11 + c][r] = true;
                    }
                }
            }
        }

        placeData(dataBytes, maskPattern) {
            let byteIdx = 0;
            let bitIdx = 7;
            let dir = -1; // -1 = up, 1 = down
            let r = this.size - 1;
            let c = this.size - 1;

            const maskFn = getMaskFunction(maskPattern);

            while (c > 0) {
                if (c === 6) c--; // Skip vertical timing column

                for (let count = 0; count < this.size; count++) {
                    for (let dc = 0; dc < 2; dc++) {
                        const targetC = c - dc;
                        if (!this.isFunction[r][targetC]) {
                            let bit = false;
                            if (byteIdx < dataBytes.length) {
                                bit = ((dataBytes[byteIdx] >>> bitIdx) & 1) === 1;
                                bitIdx--;
                                if (bitIdx < 0) {
                                    bitIdx = 7;
                                    byteIdx++;
                                }
                            }
                            // Invert bit if mask condition holds
                            if (maskFn(r, targetC)) {
                                bit = !bit;
                            }
                            this.modules[r][targetC] = bit;
                        }
                    }
                    r += dir;
                }
                dir = -dir;
                r += dir;
                c -= 2;
            }
        }

        writeFormatInformation(ecLevel, maskPattern) {
            const formatData = getFormatInfo(ecLevel, maskPattern);
            // Place on top-left, top-right, bottom-left
            for (let i = 0; i < 15; i++) {
                const bit = ((formatData >>> i) & 1) === 1;
                // Vertical strip around top-left & bottom-left
                if (i < 6) {
                    this.modules[i][8] = bit;
                } else if (i < 8) {
                    this.modules[i + 1][8] = bit;
                } else {
                    this.modules[this.size - 15 + i][8] = bit;
                }

                // Horizontal strip around top-left & top-right
                if (i < 8) {
                    this.modules[8][this.size - 1 - i] = bit;
                } else if (i === 8) {
                    this.modules[8][7] = bit;
                } else {
                    this.modules[8][14 - i] = bit;
                }
            }
        }

        writeVersionInformation() {
            if (this.version < 7) return;
            const vData = VERSION_INFO[this.version];
            for (let i = 0; i < 18; i++) {
                const bit = ((vData >>> i) & 1) === 1;
                const r = Math.floor(i / 3);
                const c = (i % 3) + this.size - 11;
                this.modules[r][c] = bit;
                this.modules[c][r] = bit;
            }
        }
    }

    function getMaskFunction(mask) {
        switch (mask) {
            case 0: return (r, c) => (r + c) % 2 === 0;
            case 1: return (r, c) => r % 2 === 0;
            case 2: return (r, c) => c % 3 === 0;
            case 3: return (r, c) => (r + c) % 3 === 0;
            case 4: return (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
            case 5: return (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0;
            case 6: return (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
            case 7: return (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
            default: return () => false;
        }
    }

    /**
     * ISO/IEC 18004 Penalty Score calculation
     */
    function calculatePenalty(modules, size) {
        let penalty = 0;

        // Rule 1: 5+ consecutive same color modules
        for (let r = 0; r < size; r++) {
            let count = 0;
            let last = null;
            for (let c = 0; c < size; c++) {
                const cur = modules[r][c];
                if (cur === last) {
                    count++;
                } else {
                    if (count >= 5) penalty += 3 + (count - 5);
                    last = cur;
                    count = 1;
                }
            }
            if (count >= 5) penalty += 3 + (count - 5);
        }

        for (let c = 0; c < size; c++) {
            let count = 0;
            let last = null;
            for (let r = 0; r < size; r++) {
                const cur = modules[r][c];
                if (cur === last) {
                    count++;
                } else {
                    if (count >= 5) penalty += 3 + (count - 5);
                    last = cur;
                    count = 1;
                }
            }
            if (count >= 5) penalty += 3 + (count - 5);
        }

        // Rule 2: 2x2 blocks of same color
        for (let r = 0; r < size - 1; r++) {
            for (let c = 0; c < size - 1; c++) {
                const val = modules[r][c];
                if (val === modules[r + 1][c] && val === modules[r][c + 1] && val === modules[r + 1][c + 1]) {
                    penalty += 3;
                }
            }
        }

        // Rule 3: 1:1:3:1:1 pattern
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size - 6; c++) {
                if (modules[r][c] && !modules[r][c + 1] && modules[r][c + 2] && modules[r][c + 3] &&
                    modules[r][c + 4] && !modules[r][c + 5] && modules[r][c + 6]) {
                    if (c >= 4 && !modules[r][c - 1] && !modules[r][c - 2] && !modules[r][c - 3] && !modules[r][c - 4]) {
                        penalty += 40;
                    }
                    if (c + 10 < size && !modules[r][c + 7] && !modules[r][c + 8] && !modules[r][c + 9] && !modules[r][c + 10]) {
                        penalty += 40;
                    }
                }
            }
        }

        // Rule 4: Balance of dark / light modules
        let darkCount = 0;
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (modules[r][c]) darkCount++;
            }
        }
        const total = size * size;
        const pct = (darkCount / total) * 100;
        const step = Math.floor(Math.abs(pct - 50) / 5);
        penalty += step * 10;

        return penalty;
    }

    /**
     * Generate 2D boolean module matrix for string payload
     * @param {string} text
     * @param {Object} [options]
     * @param {'L'|'M'|'Q'|'H'} [options.ecLevel='M']
     * @param {number} [options.version]
     * @returns {{ modules: boolean[][], version: number, size: number }}
     */
    function generateQRMatrix(text, options = {}) {
        const ecLevelStr = (options.ecLevel || 'M').toUpperCase();
        const ecLevel = EC_LEVELS[ecLevelStr];
        if (!ecLevel) throw new Error(`Invalid EC Level: ${options.ecLevel}`);

        const textBytes = new TextEncoder().encode(text);
        const version = options.version || findMinVersion(textBytes.length, ecLevelStr);

        const dataBytes = encodeData(text, version, ecLevelStr);
        const interleaved = interleaveBlocks(dataBytes, version, ecLevelStr);

        // Find optimal mask pattern among 0..7
        let bestMask = 0;
        let minPenalty = Infinity;
        let bestMatrix = null;

        for (let mask = 0; mask < 8; mask++) {
            const matrix = new QRMatrix(version);
            matrix.setupFinderPatterns();
            matrix.setupTimingPatterns();
            matrix.setupAlignmentPatterns();
            matrix.setupDarkModule();
            matrix.reserveFormatAndVersion();
            matrix.placeData(interleaved, mask);
            matrix.writeFormatInformation(ecLevel, mask);
            matrix.writeVersionInformation();

            const penalty = calculatePenalty(matrix.modules, matrix.size);
            if (penalty < minPenalty) {
                minPenalty = penalty;
                bestMask = mask;
                bestMatrix = matrix;
            }
        }

        return {
            modules: bestMatrix.modules,
            version: bestMatrix.version,
            size: bestMatrix.size,
            mask: bestMask
        };
    }

    // =========================================================================
    // 5. VECTOR SVG & CANVAS RENDERING
    // =========================================================================

    /**
     * Render QR Code to SVG markup string
     *
     * @param {string} text - Payload to encode
     * @param {Object} [options]
     * @param {number} [options.size=240] - Desired pixel width & height
     * @param {number} [options.margin=4] - Quiet zone margin (modules)
     * @param {string} [options.color='#0f172a'] - Foreground hex color
     * @param {string} [options.bgColor='#ffffff'] - Background hex color
     * @param {'L'|'M'|'Q'|'H'} [options.ecLevel='M'] - Error correction level
     * @param {string} [options.title='ZevSafe Paper-Safe QR'] - Accessible SVG title
     * @returns {string} Standalone SVG string
     */
    function createSVG(text, options = {}) {
        const qr = generateQRMatrix(text, options);
        const margin = options.margin !== undefined ? options.margin : 4;
        const totalSize = qr.size + margin * 2;
        const pixelSize = options.size || 240;
        const color = options.color || '#0f172a';
        const bgColor = options.bgColor || '#ffffff';
        const title = options.title || 'ZevSafe Paper-Safe QR';

        // Construct SVG path for dark modules for ultra-compact crisp rendering
        let pathD = '';
        for (let r = 0; r < qr.size; r++) {
            for (let c = 0; c < qr.size; c++) {
                if (qr.modules[r][c]) {
                    const x = c + margin;
                    const y = r + margin;
                    pathD += `M${x},${y}h1v1h-1z `;
                }
            }
        }

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" role="img" aria-label="${title}">
  <title>${title}</title>
  <rect width="${totalSize}" height="${totalSize}" fill="${bgColor}"/>
  <path d="${pathD.trim()}" fill="${color}"/>
</svg>`;
    }

    /**
     * Render QR Code directly into an HTMLCanvasElement
     */
    function renderToCanvas(canvas, text, options = {}) {
        if (!canvas || typeof canvas.getContext !== 'function') {
            throw new Error('Valid HTMLCanvasElement is required for renderToCanvas');
        }
        const qr = generateQRMatrix(text, options);
        const margin = options.margin !== undefined ? options.margin : 4;
        const totalModules = qr.size + margin * 2;
        const targetSize = options.size || 240;
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

        canvas.width = targetSize * dpr;
        canvas.height = targetSize * dpr;
        canvas.style.width = `${targetSize}px`;
        canvas.style.height = `${targetSize}px`;

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const color = options.color || '#0f172a';
        const bgColor = options.bgColor || '#ffffff';

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, targetSize, targetSize);

        const moduleSize = targetSize / totalModules;
        ctx.fillStyle = color;

        for (let r = 0; r < qr.size; r++) {
            for (let c = 0; c < qr.size; c++) {
                if (qr.modules[r][c]) {
                    const x = (c + margin) * moduleSize;
                    const y = (r + margin) * moduleSize;
                    ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(moduleSize), Math.ceil(moduleSize));
                }
            }
        }
    }

    // =========================================================================
    // 6. PAPER-SAFE RECOVERY DOMAIN HELPERS
    // =========================================================================

    /**
     * Formats 64-character hex salt into grouped blocks:
     * e.g. "8F2A-99B1-4D02-7CA8-105E-63FB-A142-90DD"
     */
    function formatSaltFingerprint(saltHex) {
        if (!saltHex || typeof saltHex !== 'string') return '';
        const clean = saltHex.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
        // Format first 32 characters (16 bytes) into 8 groups of 4 for human readability
        const groups = [];
        for (let i = 0; i < Math.min(clean.length, 32); i += 4) {
            groups.push(clean.substring(i, i + 4));
        }
        return groups.join('-');
    }

    /**
     * Builds structured recovery payload for Paper-Safe sheet QR
     */
    function buildPaperSafePayload(data) {
        if (!data || !data.vaultName || !data.saltHex) {
            throw new Error('vaultName and saltHex are required to build Paper-Safe payload');
        }
        return JSON.stringify({
            app: 'ZevSafe',
            v: 3,
            n: String(data.vaultName).trim(),
            s: String(data.saltHex).trim().replace(/^0x/i, '').toLowerCase().replace(/[^0-9a-f]/g, ''),
            k: Number(data.kdfIterations) || 600000,
            h: data.hint ? String(data.hint).trim().slice(0, 100) : '',
            kf: data.keyfileRequired ? 1 : 0,
            d: data.createdDate || new Date().toISOString().split('T')[0]
        });
    }

    /**
     * Checks if a string contains a valid Paper-Safe payload indicator
     */
    function isPaperSafePayload(raw) {
        if (!raw || typeof raw !== 'string') return false;
        return parsePaperSafePayload(raw) !== null;
    }

    /**
     * Validates and parses a scanned or pasted Paper-Safe QR payload.
     * Supports raw JSON, prefixed strings (ZEVSAFE_PAPER:), base64 payloads,
     * and markdown/surrounding text tolerance.
     */
    function parsePaperSafePayload(raw) {
        if (!raw || typeof raw !== 'string') return null;
        let str = raw.trim();

        // 1. Strip optional prefixes
        if (str.startsWith('ZEVSAFE_PAPER:')) {
            str = str.slice(14).trim();
        } else if (str.startsWith('ZEVSAFE:')) {
            str = str.slice(8).trim();
        }

        // 2. Base64 payload decoding fallback
        if (!str.includes('{') && /^[A-Za-z0-9+/=]+$/.test(str) && str.length >= 20) {
            try {
                if (typeof atob === 'function') {
                    const decoded = atob(str);
                    if (decoded && decoded.includes('{')) str = decoded.trim();
                } else if (typeof Buffer !== 'undefined') {
                    const decoded = Buffer.from(str, 'base64').toString('utf8');
                    if (decoded && decoded.includes('{')) str = decoded.trim();
                }
            } catch (_) {}
        }

        // 3. Extract JSON object substring if surrounded by extra text or markdown
        const start = str.indexOf('{');
        const end = str.lastIndexOf('}');
        if (start !== -1 && end > start) {
            str = str.slice(start, end + 1);
        }

        try {
            const parsed = JSON.parse(str);
            if (parsed.app !== 'ZevSafe' && parsed.v !== 3) return null;
            if (!parsed.s || typeof parsed.s !== 'string') return null;

            const cleanSalt = parsed.s.toLowerCase().replace(/^0x/i, '');
            if (cleanSalt.length < 32) return null;

            return {
                app: 'ZevSafe',
                version: parsed.v || 3,
                vaultName: parsed.n || 'Unnamed-Vault.zev',
                saltHex: cleanSalt,
                kdfIterations: Number(parsed.k) || 600000,
                hint: parsed.h || '',
                keyfileRequired: Boolean(parsed.kf),
                createdDate: parsed.d || ''
            };
        } catch (_) {
            return null;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Generates a self-contained, standalone printable HTML document for cold storage
     */
    function generatePaperSheetHTML(data) {
        const payload = buildPaperSafePayload(data);
        const qrSVG = createSVG(payload, { size: 180, margin: 2, color: '#0f172a', bgColor: '#ffffff' });
        const saltFormatted = escapeHtml(formatSaltFingerprint(data.saltHex));
        const saltHexFull = escapeHtml((data.saltHex || '').toUpperCase());
        const kdfRounds = Number(data.kdfIterations || 600000).toLocaleString('en-US');
        const vaultName = escapeHtml(data.vaultName || 'ZevSafe-Vault.zev');
        const hintText = escapeHtml(data.hint ? data.hint : 'None provided');
        const keyfileText = data.keyfileRequired ? 'REQUIRED (2FA Keyfile)' : 'Not Required (Password Only)';
        const dateText = escapeHtml(data.createdDate || new Date().toISOString().split('T')[0]);

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ZevSafe Paper-Safe Cold-Storage Certificate — ${vaultName}</title>
<style>
  :root {
    --ink: #0f172a;
    --paper: #ffffff;
    --border: #cbd5e1;
    --emerald: #059669;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    --mono: "Courier New", Courier, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #e2e8f0;
    color: var(--ink);
    font-family: var(--font);
    display: flex;
    justify-content: center;
    padding: 24px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .print-controls {
    position: fixed;
    top: 16px;
    right: 16px;
    display: flex;
    gap: 8px;
    z-index: 100;
  }
  .btn {
    background: var(--emerald);
    color: #fff;
    border: none;
    padding: 10px 18px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
  .sheet {
    background: var(--paper);
    width: 100%;
    max-width: 820px;
    border-radius: 8px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.25);
    padding: 48px;
    position: relative;
    border: 1px solid var(--border);
  }
  /* Security Guilloche Border */
  .sheet::before {
    content: '';
    position: absolute;
    top: 14px; left: 14px; right: 14px; bottom: 14px;
    border: 2px dashed var(--emerald);
    border-radius: 6px;
    pointer-events: none;
    opacity: 0.45;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid var(--ink);
    padding-bottom: 18px;
    margin-bottom: 24px;
  }
  .logo {
    font-size: 22px;
    font-weight: 900;
    letter-spacing: -0.02em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .subtitle {
    font-size: 12px;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    margin-top: 4px;
  }
  .badge {
    border: 1px solid var(--emerald);
    background: #ecfdf5;
    color: var(--emerald);
    font-size: 11px;
    font-weight: 800;
    padding: 4px 10px;
    border-radius: 4px;
    text-align: right;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 200px;
    gap: 32px;
    margin-bottom: 24px;
  }
  .field {
    margin-bottom: 16px;
  }
  .field-label {
    font-size: 11px;
    text-transform: uppercase;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #64748b;
    margin-bottom: 4px;
    display: block;
  }
  .field-val {
    font-size: 16px;
    font-weight: 700;
    font-family: var(--mono);
  }
  .fp-box {
    background: #f8fafc;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 12px;
    font-family: var(--mono);
    font-size: 14px;
    letter-spacing: 0.08em;
    font-weight: 800;
    display: inline-block;
  }
  .handwrite-wrap {
    border: 1px solid var(--border);
    background: #f8fafc;
    border-radius: 6px;
    padding: 14px;
    margin-top: 8px;
  }
  .handwrite-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 6px;
    margin: 8px 0;
  }
  .char-cell {
    height: 38px;
    border: 1.5px solid #94a3b8;
    border-radius: 4px;
    background: #fff;
  }
  .qr-box {
    border: 1px solid var(--border);
    background: #f8fafc;
    border-radius: 8px;
    padding: 14px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .qr-box svg { max-width: 170px; height: auto; }
  .instructions {
    border-top: 1px solid var(--border);
    padding-top: 18px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    font-size: 12px;
    color: #475569;
    line-height: 1.5;
  }
  .instructions h4 {
    color: var(--ink);
    font-size: 13px;
    margin-bottom: 4px;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border: none; max-width: 100%; width: 100%; padding: 24px; }
    .print-controls { display: none !important; }
  }
</style>
</head>
<body>
<div class="print-controls">
  <button class="btn" onclick="window.print()">🖨️ Print Sheet</button>
</div>

<div class="sheet">
  <div class="header">
    <div>
      <div class="logo">🛡️ ZevSafe Paper-Safe Recovery Certificate</div>
      <div class="subtitle">Zero-Knowledge Offline Vault Cold-Storage Certificate</div>
    </div>
    <div class="badge">
      <div>ZV3 STREAM AEAD</div>
      <div style="font-size:9px; opacity:0.8;">RFC 8018 / NIST SP 800-38D</div>
    </div>
  </div>

  <div class="grid">
    <div>
      <div class="field">
        <span class="field-label">Vault Container Identity</span>
        <div class="field-val">${vaultName}</div>
      </div>

      <div class="field">
        <span class="field-label">Cryptographic Salt Fingerprint (32 Bytes CSPRNG)</span>
        <div class="fp-box">${saltFormatted || saltHexFull.slice(0, 32)}</div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
        <div class="field">
          <span class="field-label">Key Derivation</span>
          <div class="field-val" style="font-size:13px;">${kdfRounds} Rounds (PBKDF2-SHA512)</div>
        </div>
        <div class="field">
          <span class="field-label">2FA Keyfile Status</span>
          <div class="field-val" style="font-size:13px; color:${data.keyfileRequired ? '#dc2626' : '#059669'};">${keyfileText}</div>
        </div>
      </div>

      <div class="handwrite-wrap">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="field-label" style="color:var(--ink); margin:0;">Handwritten Diceware Passphrase / Password (Physical Safe)</span>
          <span style="font-size:11px; color:#64748b; font-style:italic;">Write with pen · Never photograph</span>
        </div>
        <div class="handwrite-grid">
          <div class="char-cell"></div><div class="char-cell"></div><div class="char-cell"></div><div class="char-cell"></div>
          <div class="char-cell"></div><div class="char-cell"></div><div class="char-cell"></div><div class="char-cell"></div>
          <div class="char-cell"></div><div class="char-cell"></div><div class="char-cell"></div><div class="char-cell"></div>
        </div>
        <div style="font-size:11px; color:#64748b; margin-top:4px;">
          <strong>Hint / Location:</strong> ${hintText} · <strong>Created:</strong> ${dateText}
        </div>
      </div>
    </div>

    <div>
      <div class="qr-box">
        ${qrSVG}
        <div style="font-size:11px; font-weight:700; color:var(--ink);">Optical Recovery QR</div>
        <div style="font-size:10px; color:#64748b; line-height:1.4;">
          Point camera or drop this sheet on ZevSafe to auto-fill vault parameters.
        </div>
      </div>
    </div>
  </div>

  <div class="instructions">
    <div>
      <h4>🔒 Safe Cold Storage</h4>
      <p>Store this physical certificate in a fireproof home safe, locked deposit box, or air-gapped security envelope. The QR code contains non-sensitive metadata (salt, iterations, container name) required for verified reconstruction.</p>
    </div>
    <div>
      <h4>⚡ Instant Decryption Recovery</h4>
      <p>Open <strong>https://zevsafe.pages.dev</strong> or launch the offline USB Air-Gap kit. On the Decrypt tab, click <strong>"Scan Paper-Safe QR"</strong> or type your handwritten passphrase to unlock your files instantly.</p>
    </div>
  </div>
</div>
</body>
</html>`;
    }

    // =========================================================================
    // 7. OPTICAL SCANNER CONTROLLER (W3C BarcodeDetector API)
    // =========================================================================

    /**
     * Checks if native BarcodeDetector API with 'qr_code' format is supported
     */
    function isBarcodeDetectorSupported() {
        return typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function';
    }

    /**
     * Scan image source (video, img, canvas, blob/file) using BarcodeDetector
     */
    async function scanImage(source) {
        if (!isBarcodeDetectorSupported()) {
            throw new Error('BarcodeDetector API is not supported in this browser. Please use manual entry or drag-and-drop on a supported browser (Chrome, Edge, Android).');
        }

        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        let target = source;

        // If source is a Blob/File, convert to ImageBitmap
        if (typeof Blob !== 'undefined' && source instanceof Blob) {
            target = await createImageBitmap(source);
        }

        const barcodes = await detector.detect(target);
        if (!barcodes || barcodes.length === 0) {
            return null;
        }

        const rawValue = barcodes[0].rawValue;
        return {
            rawValue,
            paperSafe: parsePaperSafePayload(rawValue)
        };
    }

    // Export Public API
    return {
        // Core QR Generation
        generateQRMatrix,
        createSVG,
        renderToCanvas,
        findMinVersion,
        EC_LEVELS,

        // Paper-Safe Cold Storage
        formatSaltFingerprint,
        buildPaperSafePayload,
        isPaperSafePayload,
        parsePaperSafePayload,
        generatePaperSheetHTML,

        // Optical QR Scanner
        isBarcodeDetectorSupported,
        scanImage
    };
});
