/**
 * ZevSafe v3 Streaming Packaging & Compression Engine
 * js/stream-packer.js
 *
 * Implements low-memory streaming packaging and compression conforming to
 * the 5 GB streaming architecture specification:
 * - Streaming ZIP64 Archive Generator (createStreamingZipSource)
 * - General Purpose Bit 3 (0x0008) local file headers with 24-byte ZIP64 data descriptors
 * - RFC 1951 native CompressionStream('deflate-raw') streaming compression pipeline
 * - Adaptive STORE vs DEFLATE extension detection (isPreCompressedExtension)
 * - Incremental table-driven IEEE 802.3 CRC32 calculator
 * - In-memory Central Directory metadata catalog (< 2 MB for 10,000 files)
 * - ZIP64 End of Central Directory Record & Locator emission
 * - Encrypted JSON manifest envelope generator (buildEncryptedManifest)
 * - Memory bounded strictly (< 15 MB heap) with backpressured stream flow control
 */

(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        const exports = factory();
        root.StreamPacker = exports;
        if (typeof globalThis !== 'undefined') {
            globalThis.StreamPacker = exports;
        }
    }
}(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    // =========================================================================
    // CONSTANTS & FORMAT SPECIFICATION
    // =========================================================================

    /** Standard PKWARE ZIP 4-byte little-endian magic signatures */
    const ZIP_SIGNATURES = {
        LOCAL_FILE_HEADER: 0x04034b50,
        DATA_DESCRIPTOR: 0x08074b50,
        CENTRAL_DIRECTORY: 0x02014b50,
        ZIP64_EOCD_RECORD: 0x06064b50,
        ZIP64_EOCD_LOCATOR: 0x07064b50,
        EOCD_RECORD: 0x06054b50
    };

    /** Compression methods conforming to PKWARE ZIP specification */
    const COMPRESSION_METHODS = {
        STORE: 0,
        DEFLATE: 8
    };

    /** PKWARE Version specifications */
    const VERSION_ZIP64 = 45; // 4.5 (ZIP64 format)
    const VERSION_MADE_BY = 45;

    /** General Purpose Bit Flags */
    const FLAG_DATA_DESCRIPTOR = 0x0008; // Bit 3: CRC and sizes in data descriptor
    const FLAG_UTF8_FILENAME = 0x0800;   // Bit 11: Language encoding flag (UTF-8)
    const DEFAULT_GENERAL_FLAGS = FLAG_DATA_DESCRIPTOR | FLAG_UTF8_FILENAME; // 0x0808

    /** ZIP64 Extra Field Tag ID (APPNOTE.TXT Section 4.5.3) */
    const ZIP64_EXTRA_ID = 0x0001;

    /** 32-bit and 16-bit maximum value thresholds for ZIP64 extension routing */
    const MAX_32BIT = 0xFFFFFFFFn;
    const MAX_16BIT = 0xFFFFn;

    /** Manifest trailer envelope layout offsets */
    const MANIFEST_SALT_LENGTH = 32;
    const MANIFEST_IV_LENGTH = 12;
    const MANIFEST_LEN_SIZE = 4;
    const MANIFEST_HEADER_SIZE = MANIFEST_SALT_LENGTH + MANIFEST_IV_LENGTH + MANIFEST_LEN_SIZE; // 48 bytes
    const TAG_LENGTH = 16;

    /**
     * Pre-compressed file extensions that should bypass DEFLATE compression (STORE mode 0)
     * to save CPU and avoid expanding already-compressed formats.
     */
    const PRE_COMPRESSED_EXTENSIONS = new Set([
        // Images
        'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'ico', 'tiff', 'tif', 'bmp', 'raw', 'svgz',
        // Video
        'mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', '3gp', 'ts', 'mts', 'm2ts', 'vob', 'ogv',
        // Audio
        'mp3', 'aac', 'ogg', 'oga', 'flac', 'm4a', 'opus', 'wma', 'wav', 'alac', 'aiff', 'mid', 'midi',
        // Compressed Archives & Packages
        'zip', 'zipx', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', '7z', 'rar', 'zst', 'lzma', 'cab', 'iso', 'dmg',
        'apk', 'jar', 'war', 'ear', 'aar', 'xpi', 'crx', 'deb', 'rpm',
        // Compressed Documents
        'pdf', 'epub', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'
    ]);

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

    // =========================================================================
    // CRC-32 TABLE & INCREMENTAL CALCULATOR (IEEE 802.3 Standard)
    // =========================================================================

    /**
     * Precomputed 256-entry table for standard IEEE 802.3 CRC32 (polynomial 0xEDB88320)
     */
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

    /**
     * Fast table-driven IEEE 802.3 CRC32 calculator supporting incremental updates.
     */
    class CRC32 {
        constructor() {
            this.reset();
        }

        /**
         * Resets the internal CRC state.
         * @returns {CRC32}
         */
        reset() {
            this.crc = 0xFFFFFFFF;
            return this;
        }

        /**
         * Incrementally feeds a chunk of bytes into the running CRC32.
         * @param {Uint8Array|ArrayBuffer|Array} chunk
         * @returns {CRC32}
         */
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

        /**
         * Returns the finalized 32-bit unsigned CRC32 checksum.
         * @returns {number} Unsigned 32-bit integer
         */
        digest() {
            return (this.crc ^ 0xFFFFFFFF) >>> 0;
        }
    }

    /**
     * Factory function to instantiate an incremental CRC32 calculator.
     * @returns {CRC32}
     */
    function createCRC32() {
        return new CRC32();
    }

    /**
     * Calculates the single-shot CRC32 checksum of an entire buffer.
     * @param {Uint8Array|ArrayBuffer|string} data
     * @returns {number} Unsigned 32-bit integer
     */
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
    // UTILITY FUNCTIONS: EXTENSION LOOKUP, SANITIZATION, DOS DATE/TIME
    // =========================================================================

    /**
     * Determines whether a given filename or path has an extension that indicates
     * pre-compressed content, which should be stored without DEFLATE compression.
     *
     * @param {string} filename
     * @returns {boolean}
     */
    function isPreCompressedExtension(filename) {
        if (!filename || typeof filename !== 'string') return false;
        const clean = filename.split(/[?#]/)[0].trim();
        const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
        const base = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
        const dotIdx = base.lastIndexOf('.');
        if (dotIdx <= 0 || dotIdx === base.length - 1) return false;
        const ext = base.slice(dotIdx + 1).toLowerCase();
        return PRE_COMPRESSED_EXTENSIONS.has(ext);
    }

    /**
     * Sanitizes a relative file path for ZIP archiving:
     * - Normalizes all backslashes to forward slashes
     * - Strips leading slashes and drive letters (e.g. C:)
     * - Eliminates directory traversal segments ('..' and '.')
     * - Ensures non-empty valid relative filename
     *
     * @param {string} path
     * @returns {string} Sanitized relative forward-slash path
     */
    function sanitizeZipPath(path) {
        if (!path || typeof path !== 'string') return 'unnamed_file';

        // Normalize backslashes and strip Windows drive prefix (e.g. C:)
        const normalized = path.replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '');

        // Resolve segments with stack to collapse '.' and '..'
        const rawSegments = normalized.split('/');
        const stack = [];
        for (const seg of rawSegments) {
            const s = seg.trim();
            if (!s || s === '.') {
                continue;
            }
            if (s === '..') {
                if (stack.length > 0) {
                    stack.pop();
                }
            } else {
                stack.push(s);
            }
        }

        if (stack.length === 0) {
            return 'unnamed_file';
        }

        return stack.join('/');
    }

    /**
     * Converts a JavaScript Date or timestamp into MS-DOS 16-bit time and date values.
     *
     * MS-DOS Time:
     * - Bits 0–4: Seconds / 2 (0–29)
     * - Bits 5–10: Minutes (0–59)
     * - Bits 11–15: Hours (0–23)
     *
     * MS-DOS Date:
     * - Bits 0–4: Day of month (1–31)
     * - Bits 5–8: Month (1–12)
     * - Bits 9–15: Year offset from 1980 (0–127)
     *
     * @param {Date|number} [date]
     * @returns {{ dosTime: number, dosDate: number }}
     */
    function dateToDosDateTime(date) {
        const d = date instanceof Date ? date : new Date(date || Date.now());
        let year = d.getFullYear();
        if (year < 1980) year = 1980;

        const dosTime = ((d.getHours() & 0x1F) << 11) |
                        ((d.getMinutes() & 0x3F) << 5) |
                        (Math.floor(d.getSeconds() / 2) & 0x1F);

        const dosDate = (((year - 1980) & 0x7F) << 9) |
                        (((d.getMonth() + 1) & 0x0F) << 5) |
                        (d.getDate() & 0x1F);

        return { dosTime, dosDate };
    }

    /**
     * Converts MS-DOS 16-bit time and date values back into a JavaScript Date.
     *
     * @param {number} dosDate
     * @param {number} dosTime
     * @returns {Date}
     */
    function dosDateTimeToDate(dosDate, dosTime) {
        const year = ((dosDate >> 9) & 0x7F) + 1980;
        const month = ((dosDate >> 5) & 0x0F) - 1;
        const day = dosDate & 0x1F;

        const hours = (dosTime >> 11) & 0x1F;
        const minutes = (dosTime >> 5) & 0x3F;
        const seconds = (dosTime & 0x1F) * 2;

        return new Date(year, month, Math.max(1, day), hours, minutes, seconds);
    }

    // =========================================================================
    // BINARY BUILDERS FOR ZIP64 STRUCTURES
    // =========================================================================

    /**
     * Creates a standard ZIP Local File Header (30 bytes + filename bytes).
     * When General Purpose Bit 3 (0x0008) is set, CRC-32 and sizes are zeroed
     * and deferred to the 24-byte ZIP64 Data Descriptor following the payload.
     *
     * @param {string} filename - Sanitized relative file path
     * @param {boolean} [isDeflated=true] - True for DEFLATE (method 8), false for STORE (method 0)
     * @param {Object} [options={}]
     * @param {number} [options.flags] - Custom bit flags (default 0x0808)
     * @param {Date|number} [options.lastModified] - Modification timestamp
     * @param {number} [options.dosTime] - Explicit DOS time override
     * @param {number} [options.dosDate] - Explicit DOS date override
     * @returns {Uint8Array}
     */
    function createZipLocalHeader(filename, isDeflated = true, options = {}) {
        const nameBytes = new TextEncoder().encode(filename);
        const header = new Uint8Array(30 + nameBytes.length);
        const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

        const method = isDeflated ? COMPRESSION_METHODS.DEFLATE : COMPRESSION_METHODS.STORE;
        const flags = options.flags !== undefined ? options.flags : DEFAULT_GENERAL_FLAGS;

        let dosTime = options.dosTime;
        let dosDate = options.dosDate;
        if (dosTime === undefined || dosDate === undefined) {
            const dos = dateToDosDateTime(options.lastModified);
            dosTime = dos.dosTime;
            dosDate = dos.dosDate;
        }

        // 0..3: Local File Header Signature (0x04034b50)
        view.setUint32(0, ZIP_SIGNATURES.LOCAL_FILE_HEADER, true);
        // 4..5: Version needed to extract (45 for ZIP64)
        view.setUint16(4, VERSION_ZIP64, true);
        // 6..7: General Purpose Bit Flag (0x0808: Bit 3 data descriptor + Bit 11 UTF-8)
        view.setUint16(6, flags, true);
        // 8..9: Compression Method (0 or 8)
        view.setUint16(8, method, true);
        // 10..11: Last mod file time
        view.setUint16(10, dosTime, true);
        // 12..13: Last mod file date
        view.setUint16(12, dosDate, true);
        // 14..17: CRC-32 (0 when Bit 3 is set)
        view.setUint32(14, 0, true);
        // 18..21: Compressed size (0 when Bit 3 is set)
        view.setUint32(18, 0, true);
        // 22..25: Uncompressed size (0 when Bit 3 is set)
        view.setUint32(22, 0, true);
        // 26..27: File name length
        view.setUint16(26, nameBytes.length, true);
        // 28..29: Extra field length (0 in local header)
        view.setUint16(28, 0, true);

        // 30..30+N: File name
        header.set(nameBytes, 30);

        return header;
    }

    /**
     * Creates a 24-byte ZIP64 Data Descriptor appended after the streaming payload.
     * Layout: [Signature (4B) | CRC-32 (4B) | CompSize (8B uint64 LE) | UncompSize (8B uint64 LE)]
     *
     * @param {number} crc32Val - 32-bit unsigned CRC32
     * @param {number|BigInt} compSize - 64-bit compressed size in bytes
     * @param {number|BigInt} uncompSize - 64-bit uncompressed size in bytes
     * @returns {Uint8Array} Exactly 24 bytes
     */
    function createZip64DataDescriptor(crc32Val, compSize, uncompSize) {
        const desc = new Uint8Array(24);
        const view = new DataView(desc.buffer, desc.byteOffset, 24);

        // 0..3: Data Descriptor Signature (0x08074b50)
        view.setUint32(0, ZIP_SIGNATURES.DATA_DESCRIPTOR, true);
        // 4..7: CRC-32
        view.setUint32(4, crc32Val >>> 0, true);
        // 8..15: Compressed Size (64-bit uint64 LE)
        view.setBigUint64(8, BigInt(compSize), true);
        // 16..23: Uncompressed Size (64-bit uint64 LE)
        view.setBigUint64(16, BigInt(uncompSize), true);

        return desc;
    }

    /**
     * Creates a Central Directory File Header entry (46 bytes + filename + optional ZIP64 extra).
     * If uncompressed size, compressed size, or local header offset exceeds 32 bits,
     * sets standard fields to 0xFFFFFFFF and appends standard ZIP64 Extra Field (0x0001).
     *
     * @param {Object} entry
     * @param {string} entry.name - File path
     * @param {number} entry.compressionMethod - 0 or 8
     * @param {number} entry.crc32 - CRC32 checksum
     * @param {number|BigInt} entry.compressedSize
     * @param {number|BigInt} entry.uncompressedSize
     * @param {number|BigInt} entry.localHeaderOffset
     * @param {number} entry.dosTime
     * @param {number} entry.dosDate
     * @returns {Uint8Array}
     */
    function createCentralDirectoryHeader(entry) {
        const nameBytes = new TextEncoder().encode(entry.name);
        const compBig = BigInt(entry.compressedSize || 0);
        const uncompBig = BigInt(entry.uncompressedSize || 0);
        const offsetBig = BigInt(entry.localHeaderOffset || 0);

        const needsZip64 = uncompBig >= MAX_32BIT ||
                           compBig >= MAX_32BIT ||
                           offsetBig >= MAX_32BIT;

        let extraField = new Uint8Array(0);
        let zip64Comp = compBig >= MAX_32BIT ? 0xFFFFFFFF : Number(compBig);
        let zip64Uncomp = uncompBig >= MAX_32BIT ? 0xFFFFFFFF : Number(uncompBig);
        let zip64Offset = offsetBig >= MAX_32BIT ? 0xFFFFFFFF : Number(offsetBig);

        if (needsZip64) {
            const fields = [];
            if (uncompBig >= MAX_32BIT) fields.push(uncompBig);
            if (compBig >= MAX_32BIT) fields.push(compBig);
            if (offsetBig >= MAX_32BIT) fields.push(offsetBig);

            extraField = new Uint8Array(4 + fields.length * 8);
            const eview = new DataView(extraField.buffer, extraField.byteOffset, extraField.byteLength);
            eview.setUint16(0, ZIP64_EXTRA_ID, true); // Tag 0x0001
            eview.setUint16(2, fields.length * 8, true); // Data size
            let pos = 4;
            for (const val of fields) {
                eview.setBigUint64(pos, val, true);
                pos += 8;
            }
        }

        const cdHeader = new Uint8Array(46 + nameBytes.length + extraField.length);
        const view = new DataView(cdHeader.buffer, cdHeader.byteOffset, cdHeader.byteLength);

        // 0..3: Central File Header Signature (0x02014b50)
        view.setUint32(0, ZIP_SIGNATURES.CENTRAL_DIRECTORY, true);
        // 4..5: Version Made By (45: ZIP64 MS-DOS)
        view.setUint16(4, VERSION_MADE_BY, true);
        // 6..7: Version Needed to Extract (45: ZIP64)
        view.setUint16(6, VERSION_ZIP64, true);
        // 8..9: General Purpose Bit Flag (0x0808)
        view.setUint16(8, DEFAULT_GENERAL_FLAGS, true);
        // 10..11: Compression Method
        view.setUint16(10, entry.compressionMethod, true);
        // 12..13: Last mod file time
        view.setUint16(12, entry.dosTime, true);
        // 14..15: Last mod file date
        view.setUint16(14, entry.dosDate, true);
        // 16..19: CRC-32
        view.setUint32(16, entry.crc32 >>> 0, true);
        // 20..23: Compressed size
        view.setUint32(20, zip64Comp, true);
        // 24..27: Uncompressed size
        view.setUint32(24, zip64Uncomp, true);
        // 28..29: File name length
        view.setUint16(28, nameBytes.length, true);
        // 30..31: Extra field length
        view.setUint16(30, extraField.length, true);
        // 32..33: File comment length
        view.setUint16(32, 0, true);
        // 34..35: Disk number start
        view.setUint16(34, 0, true);
        // 36..37: Internal file attributes
        view.setUint16(36, 0, true);
        // 38..41: External file attributes
        view.setUint32(38, 0, true);
        // 42..45: Relative offset of local header
        view.setUint32(42, zip64Offset, true);

        // 46..46+N: File name
        cdHeader.set(nameBytes, 46);

        // 46+N..end: Extra field (ZIP64)
        if (extraField.length > 0) {
            cdHeader.set(extraField, 46 + nameBytes.length);
        }

        return cdHeader;
    }

    /**
     * Creates a 56-byte ZIP64 End of Central Directory Record (0x06064b50).
     *
     * @param {number|BigInt} entriesCount - Total entries in central directory
     * @param {number|BigInt} cdSize - Size of central directory in bytes
     * @param {number|BigInt} cdOffset - Start offset of central directory
     * @returns {Uint8Array} Exactly 56 bytes
     */
    function createZip64EndOfCentralDirectoryRecord(entriesCount, cdSize, cdOffset) {
        const record = new Uint8Array(56);
        const view = new DataView(record.buffer, record.byteOffset, 56);

        // 0..3: ZIP64 EOCD Signature (0x06064b50)
        view.setUint32(0, ZIP_SIGNATURES.ZIP64_EOCD_RECORD, true);
        // 4..11: Size of ZIP64 EOCD remaining (56 - 12 = 44 bytes)
        view.setBigUint64(4, 44n, true);
        // 12..13: Version Made By (45)
        view.setUint16(12, VERSION_MADE_BY, true);
        // 14..15: Version Needed to Extract (45)
        view.setUint16(14, VERSION_ZIP64, true);
        // 16..19: Number of this disk (0)
        view.setUint32(16, 0, true);
        // 20..23: Number of disk with start of Central Directory (0)
        view.setUint32(20, 0, true);
        // 24..31: Total number of entries in Central Directory on this disk
        view.setBigUint64(24, BigInt(entriesCount), true);
        // 32..39: Total number of entries in Central Directory
        view.setBigUint64(32, BigInt(entriesCount), true);
        // 40..47: Size of Central Directory
        view.setBigUint64(40, BigInt(cdSize), true);
        // 48..55: Offset of start of Central Directory
        view.setBigUint64(48, BigInt(cdOffset), true);

        return record;
    }

    /**
     * Creates a 20-byte ZIP64 End of Central Directory Locator (0x07064b50).
     *
     * @param {number|BigInt} zip64EocdOffset - Relative offset of ZIP64 EOCD record
     * @returns {Uint8Array} Exactly 20 bytes
     */
    function createZip64EndOfCentralDirectoryLocator(zip64EocdOffset) {
        const locator = new Uint8Array(20);
        const view = new DataView(locator.buffer, locator.byteOffset, 20);

        // 0..3: ZIP64 Locator Signature (0x07064b50)
        view.setUint32(0, ZIP_SIGNATURES.ZIP64_EOCD_LOCATOR, true);
        // 4..7: Number of disk with start of ZIP64 EOCD (0)
        view.setUint32(4, 0, true);
        // 8..15: Relative offset of ZIP64 EOCD record
        view.setBigUint64(8, BigInt(zip64EocdOffset), true);
        // 16..19: Total number of disks (1)
        view.setUint32(16, 1, true);

        return locator;
    }

    /**
     * Creates a 22-byte standard End of Central Directory Record (0x06054b50).
     * In ZIP64 archives, fields that would overflow or signal ZIP64 are set to
     * 0xFFFF / 0xFFFFFFFF to direct compliant unzippers (e.g. JSZip, Info-ZIP)
     * to inspect the ZIP64 locator and ZIP64 EOCD record.
     *
     * @param {number|BigInt} entriesCount
     * @param {number|BigInt} cdSize
     * @param {number|BigInt} cdOffset
     * @returns {Uint8Array} Exactly 22 bytes
     */
    function createEndOfCentralDirectoryRecord(entriesCount, cdSize, cdOffset) {
        const eocd = new Uint8Array(22);
        const view = new DataView(eocd.buffer, eocd.byteOffset, 22);

        // 0..3: EOCD Signature (0x06054b50)
        view.setUint32(0, ZIP_SIGNATURES.EOCD_RECORD, true);
        // 4..5: Number of this disk (0)
        view.setUint16(4, 0, true);
        // 6..7: Disk where central directory starts (0)
        view.setUint16(6, 0, true);
        // 8..9: Number of central directory records on this disk (0xFFFF signals ZIP64)
        view.setUint16(8, 0xFFFF, true);
        // 10..11: Total number of central directory records (0xFFFF signals ZIP64)
        view.setUint16(10, 0xFFFF, true);
        // 12..15: Size of central directory (0xFFFFFFFF signals ZIP64)
        view.setUint32(12, 0xFFFFFFFF, true);
        // 16..19: Offset of start of central directory (0xFFFFFFFF signals ZIP64)
        view.setUint32(16, 0xFFFFFFFF, true);
        // 20..21: ZIP comment length (0)
        view.setUint16(20, 0, true);

        return eocd;
    }

    // =========================================================================
    // CORE STREAMING ZIP64 ARCHIVE GENERATOR (createStreamingZipSource)
    // =========================================================================

    /**
     * Normalizes a file entry's data source into a WHATWG ReadableStream<Uint8Array>.
     * Supports:
     * - `file.stream()` returning ReadableStream
     * - `file.stream` as ReadableStream
     * - `file.data`, `file.content`, `file.buffer` (Uint8Array / ArrayBuffer / string)
     * - Empty stream fallback
     */
    function getReadableStreamForFile(file) {
        if (!file) {
            return new ReadableStream({ start(ctrl) { ctrl.close(); } });
        }

        let rawSource = file.stream;
        if (typeof rawSource === 'function') {
            rawSource = rawSource();
        }

        if (rawSource && typeof rawSource.getReader === 'function') {
            return rawSource;
        }

        // Support direct buffer / string payloads
        const directData = file.data !== undefined ? file.data : (file.content !== undefined ? file.content : file.buffer);
        if (directData !== undefined && directData !== null) {
            let u8;
            if (typeof directData === 'string') {
                u8 = new TextEncoder().encode(directData);
            } else if (directData instanceof Uint8Array) {
                u8 = directData;
            } else if (directData instanceof ArrayBuffer) {
                u8 = new Uint8Array(directData);
            } else if (ArrayBuffer.isView(directData)) {
                u8 = new Uint8Array(directData.buffer, directData.byteOffset, directData.byteLength);
            } else {
                u8 = new Uint8Array(0);
            }
            return new ReadableStream({
                start(controller) {
                    if (u8.byteLength > 0) {
                        controller.enqueue(u8);
                    }
                    controller.close();
                }
            });
        }

        // Default empty stream
        return new ReadableStream({
            start(controller) {
                controller.close();
            }
        });
    }

    /**
     * Async generator function that streams all ZIP64 binary chunks chunk-by-chunk:
     * - Local File Headers
     * - Streaming payload (STORE or DEFLATE via native CompressionStream)
     * - ZIP64 Data Descriptors
     * - Central Directory Headers
     * - ZIP64 EOCD Record, Locator, and standard EOCD Record
     *
     * @param {Array<Object>} files
     * @param {Object} [options={}]
     * @returns {AsyncGenerator<Uint8Array>}
     */
    async function* generateZipChunks(files, options = {}) {
        let currentArchiveOffset = 0n;
        const centralDirectoryEntries = [];

        for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
            const file = files[fileIdx];
            const sanitizedName = sanitizeZipPath(file.name || `file_${fileIdx + 1}`);

            // Adaptive compression decision:
            // 1. If file.size is known to be 0: use STORE (0 bytes payload)
            // 2. If filename extension indicates pre-compressed format: use STORE
            // 3. Otherwise: use native DEFLATE
            const isZeroByteKnown = file.size === 0;
            const isPreCompressed = isPreCompressedExtension(sanitizedName);
            const isDeflated = !isZeroByteKnown && !isPreCompressed;
            const compressionMethod = isDeflated ? COMPRESSION_METHODS.DEFLATE : COMPRESSION_METHODS.STORE;

            const localHeaderOffset = currentArchiveOffset;
            const { dosTime, dosDate } = dateToDosDateTime(file.lastModified);

            // 1. Emit Local File Header
            const localHeader = createZipLocalHeader(sanitizedName, isDeflated, {
                dosTime,
                dosDate
            });
            yield localHeader;
            currentArchiveOffset += BigInt(localHeader.byteLength);

            // 2. Stream Payload & Calculate CRC-32 and Sizes
            const inputStream = getReadableStreamForFile(file);
            const crc = new CRC32();
            let uncompBytes = 0n;
            let compBytes = 0n;

            if (isDeflated) {
                // Pipe uncompressed stream through CRC32 tap and native CompressionStream('deflate-raw')
                const tapStream = new TransformStream({
                    transform(chunk, controller) {
                        if (chunk && chunk.byteLength > 0) {
                            const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                            crc.update(u8);
                            uncompBytes += BigInt(u8.byteLength);
                            controller.enqueue(u8);
                        }
                    }
                });

                const cs = new CompressionStream('deflate-raw');
                const compressedPipeline = inputStream
                    .pipeThrough(tapStream)
                    .pipeThrough(cs);

                const compReader = compressedPipeline.getReader();
                try {
                    while (true) {
                        const { done, value } = await compReader.read();
                        if (done) break;
                        if (value && value.byteLength > 0) {
                            const u8 = value instanceof Uint8Array ? value : new Uint8Array(value);
                            compBytes += BigInt(u8.byteLength);
                            yield u8;
                            currentArchiveOffset += BigInt(u8.byteLength);
                        }
                    }
                } finally {
                    compReader.releaseLock();
                }
            } else {
                // STORE mode: stream directly without compression
                const storeReader = inputStream.getReader();
                try {
                    while (true) {
                        const { done, value } = await storeReader.read();
                        if (done) break;
                        if (value && value.byteLength > 0) {
                            const u8 = value instanceof Uint8Array ? value : new Uint8Array(value);
                            crc.update(u8);
                            uncompBytes += BigInt(u8.byteLength);
                            compBytes += BigInt(u8.byteLength);
                            yield u8;
                            currentArchiveOffset += BigInt(u8.byteLength);
                        }
                    }
                } finally {
                    storeReader.releaseLock();
                }
            }

            // 3. Emit 24-byte ZIP64 Data Descriptor
            const dataDescriptor = createZip64DataDescriptor(crc.digest(), compBytes, uncompBytes);
            yield dataDescriptor;
            currentArchiveOffset += BigInt(dataDescriptor.byteLength);

            // 4. Save metadata in Central Directory Catalog
            centralDirectoryEntries.push({
                name: sanitizedName,
                compressionMethod,
                crc32: crc.digest(),
                compressedSize: compBytes,
                uncompressedSize: uncompBytes,
                localHeaderOffset: localHeaderOffset,
                dosTime,
                dosDate,
                lastModified: file.lastModified
            });
        }

        // =====================================================================
        // CENTRAL DIRECTORY & TRAILER EMISSION
        // =====================================================================

        const cdStartOffset = currentArchiveOffset;

        // 5. Emit Central Directory Headers for all files
        for (const entry of centralDirectoryEntries) {
            const cdHeader = createCentralDirectoryHeader(entry);
            yield cdHeader;
            currentArchiveOffset += BigInt(cdHeader.byteLength);
        }

        const cdSize = currentArchiveOffset - cdStartOffset;
        const totalEntries = BigInt(centralDirectoryEntries.length);

        // 6. Emit ZIP64 End of Central Directory Record (56 bytes)
        const zip64EocdOffset = currentArchiveOffset;
        const zip64Eocd = createZip64EndOfCentralDirectoryRecord(totalEntries, cdSize, cdStartOffset);
        yield zip64Eocd;
        currentArchiveOffset += BigInt(zip64Eocd.byteLength);

        // 7. Emit ZIP64 End of Central Directory Locator (20 bytes)
        const zip64Locator = createZip64EndOfCentralDirectoryLocator(zip64EocdOffset);
        yield zip64Locator;
        currentArchiveOffset += BigInt(zip64Locator.byteLength);

        // 8. Emit standard End of Central Directory Record (22 bytes)
        const eocd = createEndOfCentralDirectoryRecord(totalEntries, cdSize, cdStartOffset);
        yield eocd;
        currentArchiveOffset += BigInt(eocd.byteLength);
    }

    /**
     * Creates a WHATWG ReadableStream<Uint8Array> representing a valid ZIP64 archive
     * generated chunk-by-chunk on the fly without buffering the archive in memory.
     *
     * @param {Array<Object>} files - Array of file descriptors:
     *   { name: string, stream: () => ReadableStream | ReadableStream, size?: number, lastModified?: number }
     * @param {Object} [options={}] - Optional configuration
     * @returns {ReadableStream<Uint8Array>}
     */
    function createStreamingZipSource(files, options = {}) {
        if (!Array.isArray(files)) {
            throw new TypeError('files must be an Array of file descriptor objects');
        }

        const iterator = generateZipChunks(files, options);

        return new ReadableStream({
            async pull(controller) {
                try {
                    const { value, done } = await iterator.next();
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
                if (typeof iterator.return === 'function') {
                    await iterator.return();
                }
            }
        });
    }

    // =========================================================================
    // ENCRYPTED MANIFEST ENVELOPE GENERATOR & PARSER
    // =========================================================================

    /**
     * Encrypts the vault files catalog JSON into a standalone authenticated envelope:
     * Layout: [Salt (32B) || IV (12B) || Length (4B uint32 BE) || Ciphertext + Tag (16B)]
     *
     * @param {Array<Object>|Object|string} filesCatalog - Catalog metadata object or array
     * @param {CryptoKey} key - AES-GCM CryptoKey
     * @returns {Promise<Uint8Array>} Standalone encrypted envelope
     */
    async function buildEncryptedManifest(filesCatalog, key) {
        if (!key) {
            throw new TypeError('CryptoKey is required to encrypt manifest');
        }

        const subtle = getSubtleCrypto();
        const manifestJson = typeof filesCatalog === 'string'
            ? filesCatalog
            : JSON.stringify(filesCatalog);
        const plaintextBytes = new TextEncoder().encode(manifestJson);

        const salt = getRandomValues(new Uint8Array(MANIFEST_SALT_LENGTH));
        const iv = getRandomValues(new Uint8Array(MANIFEST_IV_LENGTH));

        const encryptedBuf = await subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
                tagLength: 128
            },
            key,
            plaintextBytes
        );

        const ctWithTag = new Uint8Array(encryptedBuf);
        const envelope = new Uint8Array(MANIFEST_HEADER_SIZE + ctWithTag.byteLength);

        // 1. Salt (32 bytes)
        envelope.set(salt, 0);
        // 2. IV (12 bytes)
        envelope.set(iv, MANIFEST_SALT_LENGTH);

        // 3. Length: unpadded plaintext/ciphertext payload size (4 bytes uint32 BE)
        const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
        view.setUint32(MANIFEST_SALT_LENGTH + MANIFEST_IV_LENGTH, plaintextBytes.byteLength, false);

        // 4. Ciphertext + Tag (N + 16 bytes)
        envelope.set(ctWithTag, MANIFEST_HEADER_SIZE);

        return envelope;
    }

    /**
     * Decrypts and parses a standalone authenticated manifest envelope.
     * Throws an error immediately on tag failure, tampering, or invalid framing.
     *
     * @param {Uint8Array|ArrayBuffer} envelopeBytes
     * @param {CryptoKey} key - AES-GCM CryptoKey
     * @returns {Promise<Array<Object>|Object>} Parsed JSON catalog
     */
    async function parseEncryptedManifest(envelopeBytes, key) {
        if (!key) {
            throw new TypeError('CryptoKey is required to decrypt manifest');
        }
        if (!envelopeBytes || envelopeBytes.byteLength < MANIFEST_HEADER_SIZE + TAG_LENGTH) {
            throw new Error('Invalid manifest envelope: buffer too small for header and auth tag');
        }

        const env = envelopeBytes instanceof Uint8Array
            ? envelopeBytes
            : new Uint8Array(envelopeBytes);

        const subtle = getSubtleCrypto();
        const salt = env.subarray(0, MANIFEST_SALT_LENGTH);
        const iv = env.subarray(MANIFEST_SALT_LENGTH, MANIFEST_SALT_LENGTH + MANIFEST_IV_LENGTH);

        const view = new DataView(env.buffer, env.byteOffset, env.byteLength);
        const declaredLen = view.getUint32(MANIFEST_SALT_LENGTH + MANIFEST_IV_LENGTH, false);
        const ctWithTag = env.subarray(MANIFEST_HEADER_SIZE);

        if (ctWithTag.byteLength !== declaredLen + TAG_LENGTH) {
            throw new Error(`Invalid manifest envelope: declared length ${declaredLen} does not match ciphertext size ${ctWithTag.byteLength - TAG_LENGTH}`);
        }

        const decryptedBuf = await subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv,
                tagLength: 128
            },
            key,
            ctWithTag
        );

        const jsonStr = new TextDecoder().decode(decryptedBuf);
        return JSON.parse(jsonStr);
    }

    // =========================================================================
    // EXPORTS
    // =========================================================================

    return {
        // Constants
        ZIP_SIGNATURES,
        COMPRESSION_METHODS,
        VERSION_ZIP64,
        VERSION_MADE_BY,
        FLAG_DATA_DESCRIPTOR,
        FLAG_UTF8_FILENAME,
        DEFAULT_GENERAL_FLAGS,
        ZIP64_EXTRA_ID,
        PRE_COMPRESSED_EXTENSIONS,

        // CRC-32 Calculator & Helpers
        CRC32,
        createCRC32,
        crc32,

        // File & Path Helpers
        isPreCompressedExtension,
        sanitizeZipPath,
        dateToDosDateTime,
        dosDateTimeToDate,

        // Binary Builders
        createZipLocalHeader,
        createZip64DataDescriptor,
        createCentralDirectoryHeader,
        createZip64EndOfCentralDirectoryRecord,
        createZip64EndOfCentralDirectoryLocator,
        createEndOfCentralDirectoryRecord,

        // Core Streaming Packager
        createStreamingZipSource,

        // Encrypted Manifest
        buildEncryptedManifest,
        parseEncryptedManifest
    };
}));
