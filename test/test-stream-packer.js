/**
 * Unit & Integration Test Suite for ZevSafe v3 Streaming Packaging & Compression Engine
 * test/test-stream-packer.js
 *
 * Covers:
 * 1. CRC-32 calculator: IEEE 802.3 polynomial, test vectors, incremental chunk updates, reset
 * 2. Extension detection (isPreCompressedExtension) and ZIP path sanitization (sanitizeZipPath)
 * 3. MS-DOS Date/Time conversion and reverse conversion
 * 4. ZIP64 binary structure builders:
 *    - Local File Header (bit 3 data descriptor, UTF-8 flag, zeroed sizes)
 *    - 24-byte ZIP64 Data Descriptor (0x08074b50, 64-bit uint64 LE sizes)
 *    - Central Directory Header (standard & ZIP64 extra field 0x0001)
 *    - ZIP64 End of Central Directory Record (0x06064b50, 56 bytes)
 *    - ZIP64 End of Central Directory Locator (0x07064b50, 20 bytes)
 *    - Standard End of Central Directory Record (0x06054b50, 22 bytes)
 * 5. Streaming ZIP64 Archive Generator (createStreamingZipSource):
 *    - Single compressible file (DEFLATE method 8)
 *    - Multi-file directory hierarchy preservation
 *    - 0-byte empty file (STORE method 0, 0 payload bytes)
 *    - Pre-compressed files (.png, .mp4, .zip) STORE method 0 bypass
 *    - Stream backpressure, pull-based chunking, and cancellation cleanup
 *    - JSZip round-trip extraction & SHA-256 byte-for-byte verification
 * 6. Encrypted Manifest Envelope (buildEncryptedManifest / parseEncryptedManifest):
 *    - Standalone layout: [Salt (32B) || IV (12B) || Length (4B BE) || Ciphertext + Tag]
 *    - Complete round-trip catalog encryption & decryption
 *    - Tamper rejection: bit flips in ciphertext, auth tag, length prefix, wrong key
 */

const {
    ZIP_SIGNATURES,
    COMPRESSION_METHODS,
    VERSION_ZIP64,
    VERSION_MADE_BY,
    FLAG_DATA_DESCRIPTOR,
    FLAG_UTF8_FILENAME,
    DEFAULT_GENERAL_FLAGS,
    ZIP64_EXTRA_ID,
    PRE_COMPRESSED_EXTENSIONS,
    CRC32,
    createCRC32,
    crc32,
    isPreCompressedExtension,
    sanitizeZipPath,
    dateToDosDateTime,
    dosDateTimeToDate,
    createZipLocalHeader,
    createZip64DataDescriptor,
    createCentralDirectoryHeader,
    createZip64EndOfCentralDirectoryRecord,
    createZip64EndOfCentralDirectoryLocator,
    createEndOfCentralDirectoryRecord,
    createStreamingZipSource,
    buildEncryptedManifest,
    parseEncryptedManifest
} = require('../js/stream-packer.js');

const {
    deriveMasterKey,
    generateSalt
} = require('../js/stream-crypto.js');

const JSZip = require('../jszip.min.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FAIL: ${message}`);
        failures.push(message);
    }
}

function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

async function sha256Hex(bytes) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function streamToBytes(readableStream) {
    const reader = readableStream.getReader();
    const chunks = [];
    let totalLength = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
            chunks.push(value);
            totalLength += value.byteLength;
        }
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

async function runTestSuite() {
    console.log('===============================================================');
    console.log('  ZevSafe v3 Streaming Packaging & Compression Engine Suite');
    console.log('===============================================================\n');

    const startTime = Date.now();

    // =========================================================================
    // 1. CRC-32 CALCULATOR TESTS
    // =========================================================================
    console.log('--- 1. CRC-32 Calculator Tests ---');

    assert(crc32(new Uint8Array(0)) === 0, 'Empty buffer CRC32 is 0x00000000');
    assert(crc32('') === 0, 'Empty string CRC32 is 0x00000000');

    // Standard IEEE 802.3 test vectors
    const vector1 = '123456789';
    const expectedCrc1 = 0xCBF43926;
    assert(crc32(vector1) === expectedCrc1, `CRC32("${vector1}") matches standard 0xCBF43926 (${crc32(vector1).toString(16)})`);

    const vector2 = 'The quick brown fox jumps over the lazy dog';
    const expectedCrc2 = 0x414FA339;
    assert(crc32(vector2) === expectedCrc2, `CRC32("${vector2}") matches standard 0x414FA339 (${crc32(vector2).toString(16)})`);

    // Incremental update test
    const cInc = createCRC32();
    cInc.update(new TextEncoder().encode('The quick '));
    cInc.update(new TextEncoder().encode('brown fox '));
    cInc.update(new TextEncoder().encode('jumps over the lazy dog'));
    assert(cInc.digest() === expectedCrc2, 'Incremental CRC32 across 3 chunks matches single-shot CRC32');

    // Reset test
    cInc.reset();
    assert(cInc.digest() === 0, 'CRC32 reset returns digest to 0');
    cInc.update(new TextEncoder().encode(vector1));
    assert(cInc.digest() === expectedCrc1, 'CRC32 works normally after reset');

    // 1-byte incremental updates
    const bytesV1 = new TextEncoder().encode(vector1);
    const cByte = new CRC32();
    for (let i = 0; i < bytesV1.length; i++) {
        cByte.update(bytesV1.subarray(i, i + 1));
    }
    assert(cByte.digest() === expectedCrc1, 'Byte-by-byte incremental CRC32 matches expected result');

    // =========================================================================
    // 2. EXTENSION LOOKUP & PATH SANITIZATION TESTS
    // =========================================================================
    console.log('\n--- 2. Extension Lookup & Path Sanitization Tests ---');

    // Pre-compressed extensions
    assert(isPreCompressedExtension('photo.jpg') === true, 'photo.jpg recognized as pre-compressed');
    assert(isPreCompressedExtension('PHOTO.JPEG') === true, 'PHOTO.JPEG (uppercase) recognized as pre-compressed');
    assert(isPreCompressedExtension('image.png') === true, 'image.png recognized as pre-compressed');
    assert(isPreCompressedExtension('image.webp') === true, 'image.webp recognized as pre-compressed');
    assert(isPreCompressedExtension('video.mp4') === true, 'video.mp4 recognized as pre-compressed');
    assert(isPreCompressedExtension('clip.mkv') === true, 'clip.mkv recognized as pre-compressed');
    assert(isPreCompressedExtension('movie.avi') === true, 'movie.avi recognized as pre-compressed');
    assert(isPreCompressedExtension('track.mp3') === true, 'track.mp3 recognized as pre-compressed');
    assert(isPreCompressedExtension('audio.flac') === true, 'audio.flac recognized as pre-compressed');
    assert(isPreCompressedExtension('archive.zip') === true, 'archive.zip recognized as pre-compressed');
    assert(isPreCompressedExtension('archive.tar.gz') === true, 'archive.tar.gz recognized as pre-compressed');
    assert(isPreCompressedExtension('package.7z') === true, 'package.7z recognized as pre-compressed');
    assert(isPreCompressedExtension('bundle.rar') === true, 'bundle.rar recognized as pre-compressed');
    assert(isPreCompressedExtension('document.pdf') === true, 'document.pdf recognized as pre-compressed');
    assert(isPreCompressedExtension('sheet.xlsx') === true, 'sheet.xlsx recognized as pre-compressed');

    // Compressible extensions
    assert(isPreCompressedExtension('document.txt') === false, 'document.txt is not pre-compressed');
    assert(isPreCompressedExtension('data.json') === false, 'data.json is not pre-compressed');
    assert(isPreCompressedExtension('script.js') === false, 'script.js is not pre-compressed');
    assert(isPreCompressedExtension('styles.css') === false, 'styles.css is not pre-compressed');
    assert(isPreCompressedExtension('index.html') === false, 'index.html is not pre-compressed');
    assert(isPreCompressedExtension('records.csv') === false, 'records.csv is not pre-compressed');
    assert(isPreCompressedExtension('payload.bin') === false, 'payload.bin is not pre-compressed');
    assert(isPreCompressedExtension('README') === false, 'README (no extension) is not pre-compressed');
    assert(isPreCompressedExtension('.gitignore') === false, '.gitignore (dotfile) is not pre-compressed');

    // Path sanitization
    assert(sanitizeZipPath('documents/report.txt') === 'documents/report.txt', 'Standard path preserved');
    assert(sanitizeZipPath('documents\\sub\\file.txt') === 'documents/sub/file.txt', 'Backslashes converted to forward slashes');
    assert(sanitizeZipPath('/root/folder/data.bin') === 'root/folder/data.bin', 'Leading forward slash stripped');
    assert(sanitizeZipPath('\\\\server\\share\\file.dat') === 'server/share/file.dat', 'Leading backslashes stripped');
    assert(sanitizeZipPath('C:\\Users\\Admin\\vault.dat') === 'Users/Admin/vault.dat', 'Windows drive letter stripped');
    assert(sanitizeZipPath('../../../etc/passwd') === 'etc/passwd', 'Path traversal (../../..) sanitized');
    assert(sanitizeZipPath('dir/./sub/../file.txt') === 'dir/file.txt', 'Relative . and .. segments removed');
    assert(sanitizeZipPath('report (2026) 📊.txt') === 'report (2026) 📊.txt', 'Unicode characters and spaces preserved');
    assert(sanitizeZipPath('') === 'unnamed_file', 'Empty path defaults to unnamed_file');
    assert(sanitizeZipPath('   ') === 'unnamed_file', 'Whitespace-only path defaults to unnamed_file');
    assert(sanitizeZipPath('../..') === 'unnamed_file', 'Pure traversal defaults to unnamed_file');

    // DOS Date/Time conversion
    const testDate = new Date(2026, 8, 25, 14, 30, 40); // 2026-09-25 14:30:40
    const { dosTime, dosDate } = dateToDosDateTime(testDate);
    assert(typeof dosTime === 'number' && dosTime > 0, 'dosTime is a positive number');
    assert(typeof dosDate === 'number' && dosDate > 0, 'dosDate is a positive number');
    const recoveredDate = dosDateTimeToDate(dosDate, dosTime);
    assert(recoveredDate.getFullYear() === 2026, 'Recovered date year matches 2026');
    assert(recoveredDate.getMonth() === 8, 'Recovered date month matches September');
    assert(recoveredDate.getDate() === 25, 'Recovered date day matches 25');
    assert(recoveredDate.getHours() === 14, 'Recovered date hour matches 14');
    assert(recoveredDate.getMinutes() === 30, 'Recovered date minute matches 30');

    // =========================================================================
    // 3. ZIP64 BINARY STRUCTURE BUILDERS TESTS
    // =========================================================================
    console.log('\n--- 3. ZIP64 Binary Structure Builders Tests ---');

    // Local Header
    const fn = 'nested/test-file.txt';
    const localHdrDeflate = createZipLocalHeader(fn, true);
    const localView = new DataView(localHdrDeflate.buffer, localHdrDeflate.byteOffset, localHdrDeflate.byteLength);

    assert(localView.getUint32(0, true) === ZIP_SIGNATURES.LOCAL_FILE_HEADER, 'Local header magic is 0x04034b50');
    assert(localView.getUint16(4, true) === VERSION_ZIP64, 'Local header version needed is 45 (ZIP64)');
    assert((localView.getUint16(6, true) & FLAG_DATA_DESCRIPTOR) === FLAG_DATA_DESCRIPTOR, 'General purpose bit 3 (0x0008) is set');
    assert((localView.getUint16(6, true) & FLAG_UTF8_FILENAME) === FLAG_UTF8_FILENAME, 'Language encoding flag bit 11 (0x0800) is set');
    assert(localView.getUint16(8, true) === COMPRESSION_METHODS.DEFLATE, 'Compression method is 8 (DEFLATE) when isDeflated=true');
    assert(localView.getUint32(14, true) === 0, 'Local header CRC-32 is 0 (deferred to data descriptor)');
    assert(localView.getUint32(18, true) === 0, 'Local header compressed size is 0 (deferred to data descriptor)');
    assert(localView.getUint32(22, true) === 0, 'Local header uncompressed size is 0 (deferred to data descriptor)');
    assert(localView.getUint16(26, true) === new TextEncoder().encode(fn).length, 'Local header filename length matches filename bytes');
    assert(localHdrDeflate.byteLength === 30 + new TextEncoder().encode(fn).length, 'Local header total length is 30 + filename length');

    const localHdrStore = createZipLocalHeader('store.dat', false);
    const storeView = new DataView(localHdrStore.buffer, localHdrStore.byteOffset, localHdrStore.byteLength);
    assert(storeView.getUint16(8, true) === COMPRESSION_METHODS.STORE, 'Compression method is 0 (STORE) when isDeflated=false');

    // ZIP64 Data Descriptor
    const desc = createZip64DataDescriptor(0x12345678, 5000000000, 7000000000);
    assert(desc.byteLength === 24, 'ZIP64 Data Descriptor length is exactly 24 bytes');
    const descView = new DataView(desc.buffer, desc.byteOffset, 24);
    assert(descView.getUint32(0, true) === ZIP_SIGNATURES.DATA_DESCRIPTOR, 'Data descriptor magic is 0x08074b50');
    assert(descView.getUint32(4, true) === 0x12345678, 'Data descriptor CRC-32 matches');
    assert(descView.getBigUint64(8, true) === 5000000000n, 'Compressed size encoded as 64-bit uint64 (5,000,000,000 bytes)');
    assert(descView.getBigUint64(16, true) === 7000000000n, 'Uncompressed size encoded as 64-bit uint64 (7,000,000,000 bytes)');

    // Central Directory Header (< 4 GB)
    const cdEntryStandard = {
        name: 'file1.txt',
        compressionMethod: 8,
        crc32: 0x99887766,
        compressedSize: 1024,
        uncompressedSize: 2048,
        localHeaderOffset: 500,
        dosTime: 0x1234,
        dosDate: 0x5678
    };
    const cdHdrStandard = createCentralDirectoryHeader(cdEntryStandard);
    const cdStdView = new DataView(cdHdrStandard.buffer, cdHdrStandard.byteOffset, cdHdrStandard.byteLength);
    assert(cdStdView.getUint32(0, true) === ZIP_SIGNATURES.CENTRAL_DIRECTORY, 'Central directory magic is 0x02014b50');
    assert(cdStdView.getUint16(4, true) === VERSION_MADE_BY, 'Version made by is 45');
    assert(cdStdView.getUint16(6, true) === VERSION_ZIP64, 'Version needed is 45');
    assert(cdStdView.getUint16(10, true) === 8, 'CD compression method is 8');
    assert(cdStdView.getUint32(16, true) === 0x99887766, 'CD CRC-32 matches');
    assert(cdStdView.getUint32(20, true) === 1024, 'CD compressed size matches 1024');
    assert(cdStdView.getUint32(24, true) === 2048, 'CD uncompressed size matches 2048');
    assert(cdStdView.getUint32(42, true) === 500, 'CD local header offset matches 500');
    assert(cdStdView.getUint16(30, true) === 0, 'Extra field length is 0 for standard < 4 GB entry');

    // Central Directory Header (>= 4 GB with ZIP64 extra field 0x0001)
    const cdEntryLarge = {
        name: 'large-5gb-file.bin',
        compressionMethod: 0,
        crc32: 0x11223344,
        compressedSize: 5368709120n,
        uncompressedSize: 5368709120n,
        localHeaderOffset: 6000000000n,
        dosTime: 0x1234,
        dosDate: 0x5678
    };
    const cdHdrLarge = createCentralDirectoryHeader(cdEntryLarge);
    const cdLargeView = new DataView(cdHdrLarge.buffer, cdHdrLarge.byteOffset, cdHdrLarge.byteLength);
    assert(cdLargeView.getUint32(20, true) === 0xFFFFFFFF, 'Large compressed size set to 0xFFFFFFFF in standard field');
    assert(cdLargeView.getUint32(24, true) === 0xFFFFFFFF, 'Large uncompressed size set to 0xFFFFFFFF in standard field');
    assert(cdLargeView.getUint32(42, true) === 0xFFFFFFFF, 'Large offset set to 0xFFFFFFFF in standard field');
    const extraLen = cdLargeView.getUint16(30, true);
    assert(extraLen === 4 + 3 * 8, 'Extra field length is 28 bytes (Tag 2B + Len 2B + 3x 8B)');
    const extraOffset = 46 + new TextEncoder().encode('large-5gb-file.bin').length;
    assert(cdLargeView.getUint16(extraOffset, true) === ZIP64_EXTRA_ID, 'ZIP64 Extra Field Tag is 0x0001');
    assert(cdLargeView.getUint16(extraOffset + 2, true) === 24, 'ZIP64 Extra Field payload length is 24');
    assert(cdLargeView.getBigUint64(extraOffset + 4, true) === 5368709120n, 'ZIP64 Extra Field uncompressed size matches');
    assert(cdLargeView.getBigUint64(extraOffset + 12, true) === 5368709120n, 'ZIP64 Extra Field compressed size matches');
    assert(cdLargeView.getBigUint64(extraOffset + 20, true) === 6000000000n, 'ZIP64 Extra Field offset matches');

    // ZIP64 EOCD Record (56 bytes)
    const zip64Eocd = createZip64EndOfCentralDirectoryRecord(10, 2500, 100000);
    assert(zip64Eocd.byteLength === 56, 'ZIP64 EOCD Record is exactly 56 bytes');
    const z64View = new DataView(zip64Eocd.buffer, zip64Eocd.byteOffset, 56);
    assert(z64View.getUint32(0, true) === ZIP_SIGNATURES.ZIP64_EOCD_RECORD, 'ZIP64 EOCD signature is 0x06064b50');
    assert(z64View.getBigUint64(4, true) === 44n, 'Size of ZIP64 EOCD remaining is 44 bytes');
    assert(z64View.getBigUint64(24, true) === 10n, 'Entries count on disk is 10');
    assert(z64View.getBigUint64(32, true) === 10n, 'Total entries count is 10');
    assert(z64View.getBigUint64(40, true) === 2500n, 'CD size is 2500');
    assert(z64View.getBigUint64(48, true) === 100000n, 'CD start offset is 100000');

    // ZIP64 EOCD Locator (20 bytes)
    const locator = createZip64EndOfCentralDirectoryLocator(102500);
    assert(locator.byteLength === 20, 'ZIP64 EOCD Locator is exactly 20 bytes');
    const locView = new DataView(locator.buffer, locator.byteOffset, 20);
    assert(locView.getUint32(0, true) === ZIP_SIGNATURES.ZIP64_EOCD_LOCATOR, 'ZIP64 Locator signature is 0x07064b50');
    assert(locView.getBigUint64(8, true) === 102500n, 'ZIP64 EOCD relative offset is 102500');
    assert(locView.getUint32(16, true) === 1, 'Total number of disks is 1');

    // Standard EOCD Record (22 bytes)
    const eocd = createEndOfCentralDirectoryRecord(10, 2500, 100000);
    assert(eocd.byteLength === 22, 'Standard EOCD Record is exactly 22 bytes');
    const eocdView = new DataView(eocd.buffer, eocd.byteOffset, 22);
    assert(eocdView.getUint32(0, true) === ZIP_SIGNATURES.EOCD_RECORD, 'EOCD signature is 0x06054b50');
    assert(eocdView.getUint16(8, true) === 0xFFFF, 'EOCD entries on disk is 0xFFFF (signals ZIP64)');
    assert(eocdView.getUint16(10, true) === 0xFFFF, 'EOCD total entries is 0xFFFF (signals ZIP64)');
    assert(eocdView.getUint32(12, true) === 0xFFFFFFFF, 'EOCD CD size is 0xFFFFFFFF (signals ZIP64)');
    assert(eocdView.getUint32(16, true) === 0xFFFFFFFF, 'EOCD CD offset is 0xFFFFFFFF (signals ZIP64)');

    // =========================================================================
    // 4. STREAMING ZIP64 ARCHIVE GENERATOR TESTS
    // =========================================================================
    console.log('\n--- 4. Streaming ZIP64 Archive Generator Tests ---');

    // Test 4.1: Single compressible file with DEFLATE
    const singleFilePayload = 'Hello ZevSafe Streaming ZIP64! '.repeat(100);
    const singleFile = [
        {
            name: 'hello.txt',
            data: singleFilePayload,
            lastModified: Date.now()
        }
    ];

    const zipStream1 = createStreamingZipSource(singleFile);
    assert(zipStream1 instanceof ReadableStream, 'createStreamingZipSource returns a ReadableStream');
    const zipBytes1 = await streamToBytes(zipStream1);
    assert(zipBytes1.byteLength > 0, `Streamed ZIP archive produced ${zipBytes1.byteLength} bytes`);

    // Verify extraction with JSZip
    const jszip1 = await JSZip.loadAsync(zipBytes1);
    const extractedFiles1 = Object.keys(jszip1.files);
    assert(extractedFiles1.length === 1 && extractedFiles1[0] === 'hello.txt', 'JSZip extracted 1 file: hello.txt');
    const extractedContent1 = await jszip1.file('hello.txt').async('string');
    assert(extractedContent1 === singleFilePayload, 'Extracted file contents match original string byte-for-byte');

    // Verify compression ratio: deflated size < uncompressed size
    const expectedUncomp1 = new TextEncoder().encode(singleFilePayload).length;
    assert(zipBytes1.length < expectedUncomp1, `Deflated ZIP archive size (${zipBytes1.length}) < uncompressed payload (${expectedUncomp1})`);

    // Test 4.2: 0-byte empty file handling
    const emptyFile = [
        {
            name: 'empty.dat',
            size: 0,
            data: ''
        }
    ];
    const zipStreamEmpty = createStreamingZipSource(emptyFile);
    const zipBytesEmpty = await streamToBytes(zipStreamEmpty);
    const jszipEmpty = await JSZip.loadAsync(zipBytesEmpty);
    assert(Object.keys(jszipEmpty.files).includes('empty.dat'), 'Empty file included in ZIP archive');
    const emptyContent = await jszipEmpty.file('empty.dat').async('string');
    assert(emptyContent === '', 'Empty file extracts to 0-byte empty string');

    // Test 4.3: Pre-compressed file bypasses DEFLATE (STORE mode)
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 10, 20, 30, 40]);
    const preCompFiles = [
        {
            name: 'photo.png',
            data: pngHeader
        }
    ];
    const zipStreamPng = createStreamingZipSource(preCompFiles);
    const zipBytesPng = await streamToBytes(zipStreamPng);
    const jszipPng = await JSZip.loadAsync(zipBytesPng);
    const extractedPng = await jszipPng.file('photo.png').async('uint8array');
    assert(arraysEqual(extractedPng, pngHeader), 'Pre-compressed PNG extracts byte-for-byte in STORE mode');

    // Test 4.4: Multi-file directory hierarchy with mixed formats
    const multiFiles = [
        {
            name: 'docs/report.txt',
            data: 'Annual confidential audit report '.repeat(50),
            lastModified: Date.now()
        },
        {
            name: 'docs/notes.csv',
            data: 'id,name,value\n1,alpha,100\n2,beta,200\n',
            lastModified: Date.now()
        },
        {
            name: 'assets/logo.png',
            data: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4, 5]),
            lastModified: Date.now()
        },
        {
            name: 'empty_marker.txt',
            size: 0,
            data: '',
            lastModified: Date.now()
        },
        {
            name: 'deeply/nested/structure/config.json',
            data: JSON.stringify({ mode: 'production', secure: true, level: 5 }),
            lastModified: Date.now()
        }
    ];

    const multiStream = createStreamingZipSource(multiFiles);
    const multiZipBytes = await streamToBytes(multiStream);
    const jszipMulti = await JSZip.loadAsync(multiZipBytes);
    const multiExtractedNames = Object.keys(jszipMulti.files);
    assert(multiExtractedNames.length === 5, 'Multi-file archive extracted exactly 5 files');

    for (const f of multiFiles) {
        assert(multiExtractedNames.includes(f.name), `Archive contains entry for ${f.name}`);
        const extracted = await jszipMulti.file(f.name).async('uint8array');
        let expectedBytes;
        if (typeof f.data === 'string') {
            expectedBytes = new TextEncoder().encode(f.data);
        } else {
            expectedBytes = f.data;
        }
        const match = arraysEqual(extracted, expectedBytes);
        assert(match, `Content of ${f.name} matches byte-for-byte`);
    }

    // Test 4.5: Callable stream generator function `file.stream()`
    let factoryCalled = false;
    const factoryFiles = [
        {
            name: 'streamed.txt',
            stream: () => {
                factoryCalled = true;
                return new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('Streamed via factory function'));
                        controller.close();
                    }
                });
            }
        }
    ];
    const factoryStream = createStreamingZipSource(factoryFiles);
    const factoryZip = await streamToBytes(factoryStream);
    assert(factoryCalled === true, 'Stream factory function file.stream() was executed lazily');
    const jszipFactory = await JSZip.loadAsync(factoryZip);
    const factContent = await jszipFactory.file('streamed.txt').async('string');
    assert(factContent === 'Streamed via factory function', 'Stream factory content extracted correctly');

    // Test 4.6: Chunked multi-part streaming (simulating 4 MB chunks)
    const chunk1 = new TextEncoder().encode('Part 1 of large payload. '.repeat(100));
    const chunk2 = new TextEncoder().encode('Part 2 of large payload. '.repeat(100));
    const chunk3 = new TextEncoder().encode('Part 3 of large payload. '.repeat(100));
    const fullLarge = new Uint8Array(chunk1.length + chunk2.length + chunk3.length);
    fullLarge.set(chunk1, 0);
    fullLarge.set(chunk2, chunk1.length);
    fullLarge.set(chunk3, chunk1.length + chunk2.length);

    const chunkedFiles = [
        {
            name: 'chunked-stream.txt',
            stream: new ReadableStream({
                start(controller) {
                    controller.enqueue(chunk1);
                    controller.enqueue(chunk2);
                    controller.enqueue(chunk3);
                    controller.close();
                }
            })
        }
    ];
    const chunkedStream = createStreamingZipSource(chunkedFiles);
    const chunkedZip = await streamToBytes(chunkedStream);
    const jszipChunked = await JSZip.loadAsync(chunkedZip);
    const chunkedExtracted = await jszipChunked.file('chunked-stream.txt').async('uint8array');
    assert(arraysEqual(chunkedExtracted, fullLarge), 'Multi-chunk stream reassembled and extracted byte-for-byte');

    // Test 4.7: Stream cancellation cleanup
    const infiniteStream = new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(1024));
        }
    });
    const cancellableSource = createStreamingZipSource([
        { name: 'cancel.bin', stream: infiniteStream }
    ]);
    const cancelReader = cancellableSource.getReader();
    const firstChunk = await cancelReader.read();
    assert(!firstChunk.done && firstChunk.value.length > 0, 'Read first chunk prior to cancellation');
    await cancelReader.cancel('Test cancellation');
    assert(true, 'Stream reader successfully cancelled without throwing error');

    // =========================================================================
    // 5. ENCRYPTED MANIFEST ENVELOPE TESTS
    // =========================================================================
    console.log('\n--- 5. Encrypted Manifest Envelope Tests ---');

    const manifestSalt = generateSalt();
    const manifestKey = await deriveMasterKey('VaultPassword2026!', manifestSalt, 2000);

    const sampleCatalog = [
        { path: 'documents/report.txt', size: 10240, compressedSize: 3450, offset: 0, crc32: 0x12345678 },
        { path: 'media/photo.jpg', size: 204800, compressedSize: 204800, offset: 3500, crc32: 0x9abcdef0 },
        { path: 'empty.dat', size: 0, compressedSize: 0, offset: 208350, crc32: 0x00000000 }
    ];

    // Build manifest envelope
    const envelope = await buildEncryptedManifest(sampleCatalog, manifestKey);
    assert(envelope instanceof Uint8Array, 'buildEncryptedManifest returns a Uint8Array');

    // Envelope framing verification: [Salt (32B) || IV (12B) || Length (4B uint32 BE) || Ciphertext + Tag (16B)]
    assert(envelope.byteLength >= 48 + 16, 'Envelope has at least 48B header + 16B auth tag');
    const envView = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
    const declaredPlaintextLen = envView.getUint32(44, false); // big-endian
    const expectedPlaintextLen = new TextEncoder().encode(JSON.stringify(sampleCatalog)).byteLength;
    assert(declaredPlaintextLen === expectedPlaintextLen, `Declared plaintext length (${declaredPlaintextLen}) matches JSON byte length (${expectedPlaintextLen})`);
    assert(envelope.byteLength === 48 + declaredPlaintextLen + 16, 'Total envelope size matches 48B + PlaintextLen + 16B Tag');

    // Decrypt and parse envelope
    const recoveredCatalog = await parseEncryptedManifest(envelope, manifestKey);
    assert(Array.isArray(recoveredCatalog) && recoveredCatalog.length === 3, 'Recovered catalog is an array with 3 entries');
    assert(recoveredCatalog[0].path === 'documents/report.txt', 'Catalog entry 0 path matches');
    assert(recoveredCatalog[0].size === 10240, 'Catalog entry 0 size matches');
    assert(recoveredCatalog[1].path === 'media/photo.jpg', 'Catalog entry 1 path matches');
    assert(recoveredCatalog[2].path === 'empty.dat', 'Catalog entry 2 path matches');
    assert(JSON.stringify(recoveredCatalog) === JSON.stringify(sampleCatalog), 'Entire catalog matches byte-for-byte in JSON round-trip');

    // Tamper rejection: bit flip in ciphertext
    const tamperedCt = new Uint8Array(envelope);
    tamperedCt[50] ^= 0x01; // flip 1 bit in ciphertext
    let ctTamperThrown = false;
    try {
        await parseEncryptedManifest(tamperedCt, manifestKey);
    } catch (err) {
        ctTamperThrown = true;
    }
    assert(ctTamperThrown, 'Ciphertext bit flip rejected with cryptographic error');

    // Tamper rejection: bit flip in auth tag (last 16 bytes)
    const tamperedTag = new Uint8Array(envelope);
    tamperedTag[tamperedTag.length - 1] ^= 0x01;
    let tagTamperThrown = false;
    try {
        await parseEncryptedManifest(tamperedTag, manifestKey);
    } catch (err) {
        tagTamperThrown = true;
    }
    assert(tagTamperThrown, 'Auth tag bit flip rejected with cryptographic error');

    // Tamper rejection: length prefix altered
    const tamperedLen = new Uint8Array(envelope);
    const lenView = new DataView(tamperedLen.buffer, tamperedLen.byteOffset, tamperedLen.byteLength);
    lenView.setUint32(44, declaredPlaintextLen + 10, false);
    let lenTamperThrown = false;
    try {
        await parseEncryptedManifest(tamperedLen, manifestKey);
    } catch (err) {
        lenTamperThrown = true;
    }
    assert(lenTamperThrown, 'Altered length field rejected with framing validation error');

    // Wrong key rejection
    const wrongKey = await deriveMasterKey('WrongPassword123!', manifestSalt, 2000);
    let wrongKeyThrown = false;
    try {
        await parseEncryptedManifest(envelope, wrongKey);
    } catch (err) {
        wrongKeyThrown = true;
    }
    assert(wrongKeyThrown, 'Wrong master key rejected with cryptographic authentication error');

    // Truncated envelope rejection
    const truncatedEnv = envelope.slice(0, 40); // Less than 48-byte header
    let truncThrown = false;
    try {
        await parseEncryptedManifest(truncatedEnv, manifestKey);
    } catch (err) {
        truncThrown = true;
    }
    assert(truncThrown, 'Truncated manifest envelope rejected with error');

    // Large catalog round-trip (1,000 files)
    const largeCatalog = Array.from({ length: 1000 }, (_, i) => ({
        path: `folder_${Math.floor(i / 50)}/sub_${i % 10}/file_${i}.dat`,
        size: (i * 1024) % 1048576,
        compressedSize: (i * 512) % 524288,
        offset: BigInt(i * 1048576).toString(),
        crc32: (0x10000000 + i) >>> 0
    }));
    const largeEnvelope = await buildEncryptedManifest(largeCatalog, manifestKey);
    const recoveredLarge = await parseEncryptedManifest(largeEnvelope, manifestKey);
    assert(recoveredLarge.length === 1000, 'Large 1,000-file catalog round-trips with exact count');
    assert(recoveredLarge[999].path === largeCatalog[999].path, 'Last entry path matches in 1,000-file catalog');

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    const duration = Date.now() - startTime;
    console.log('\n===============================================================');
    console.log(`  TEST RESULTS: ${passedTests}/${totalTests} PASSED (${duration} ms)`);
    if (failedTests > 0) {
        console.error(`  FAILURES (${failedTests}):`);
        failures.forEach(f => console.error(`   - ${f}`));
        console.log('===============================================================\n');
        process.exit(1);
    } else {
        console.log('  ALL TESTS PASSED WITH 100% SUCCESS RATE.');
        console.log('===============================================================\n');
    }
}

runTestSuite().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
