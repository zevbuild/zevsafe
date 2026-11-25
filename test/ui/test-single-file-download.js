/**
 * Automated Verification Suite: Single Files Download & Extraction Fixes
 *
 * Verifies:
 * 1. triggerDownload handles Uint8Array, Blob, and custom filenames cleanly
 * 2. revokeAfterDelay default is safe (60000ms, not premature 3000ms)
 * 3. getDecryptedFileBlob assigns valid MIME type and handles edited / zip entries
 * 4. Explorer download buttons preserve exact filenames (.env, spaces, extensions)
 * 5. Single-file vault (#btn-explorer-download-all) displays "Download File" and triggers direct extraction
 * 6. StreamUnpacker bounded cache preserves multi-chunk eviction integrity
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '../..');
const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
const streamUnpackerJs = fs.readFileSync(path.join(ROOT_DIR, 'js/stream-unpacker.js'), 'utf8');
const docViewerJs = fs.readFileSync(path.join(ROOT_DIR, 'js/document-viewer.js'), 'utf8');

const StreamUnpacker = require('../../js/stream-unpacker.js');
const WorkerBridge = require('../../js/worker-bridge.js');

let passed = 0;
let total = 0;

function runTest(name, fn) {
    total++;
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

async function runAsyncTest(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

console.log('===============================================================');
console.log('  ZevSafe Single Files Download & Extraction Verification      ');
console.log('===============================================================');

// ── 1. STATIC CODE AUDIT ─────────────────────────────────────
console.log('\n--- 1. Static Code Audit in app.js & stream-unpacker.js ---');

runTest('1.1: revokeAfterDelay default timeout is 60s (not 3s)', () => {
    assert.ok(appJs.includes('revokeAfterDelay(url, delayMs = 60000)'), 'Must default to 60000ms');
    assert.ok(!appJs.includes('revokeAfterDelay(url, delayMs = 3000)'), 'Must not have 3000ms premature revocation');
});

runTest('1.2: triggerDownload wraps non-Blob buffers and tracks URL', () => {
    assert.ok(appJs.includes('actualBlob = (blob instanceof Blob) ? blob : new Blob([blob]'), 'Must wrap non-blob data');
    assert.ok(appJs.includes('activeBlobUrls.add(url)'), 'Must track blob url in activeBlobUrls');
});

runTest('1.3: getDecryptedFileBlob assigns MIME type to decrypted Blob', () => {
    assert.ok(appJs.includes("const mimeType = (typeof getMediaMimeType === 'function' ? getMediaMimeType(filePath) : '') || 'application/octet-stream';"), 'Must detect MIME type');
    assert.ok(appJs.includes('return new Blob([dataBytes], { type: mimeType });'), 'Must construct Blob with MIME type');
});

runTest('1.4: Explorer file download buttons preserve original filename', () => {
    assert.ok(appJs.includes("triggerDownload(fileBlob, file.name || sanitizeFilenamePart(file.name, 'file'));"), 'File card/row download must preserve file.name');
});

runTest('1.5: Single-file vault fast-path implemented for #btn-explorer-download-all', () => {
    assert.ok(appJs.includes("currentDecryptedFileList.length === 1"), 'Must check for single file vault');
    assert.ok(appJs.includes("dlAllBtn.textContent = '⬇️ Download File';"), 'Must label button "Download File" for single file');
    assert.ok(appJs.includes("triggerDownload(blob, singleFile.name);"), 'Must directly trigger single file download');
});

runTest('1.6: openVaultExplorer clears currentV3Vault state', () => {
    assert.ok(appJs.includes('currentV3Vault = null;'), 'openVaultExplorer must reset currentV3Vault');
});

runTest('1.7: reEncryptVaultToZev handles res.vault / res.vaultBytes', () => {
    assert.ok(appJs.includes('res.vault || res.vaultBytes || res.encryptedBytes'), 'reEncryptVaultToZev must handle res.vault from WorkerBridge');
});

runTest('1.8: Document viewer preserves filename on download', () => {
    assert.ok(docViewerJs.includes('currentTextFilename || (typeof sanitizeFilenamePart'), 'docViewer must preserve currentTextFilename');
});

runTest('1.9: triggerDownload sanitizes download filename for OS compatibility', () => {
    assert.ok(appJs.includes('function sanitizeDownloadFilename('), 'Must define sanitizeDownloadFilename');
    assert.ok(appJs.includes('const safeFilename = sanitizeDownloadFilename(filename || \'download\');'), 'Must sanitize download filename');
});

runTest('1.10: reEncryptVaultToZev falls back to currentDecryptedPassword for legacy vaults', () => {
    assert.ok(appJs.includes('currentDecryptedPassword ||'), 'reEncryptVaultToZev must preserve legacy decrypted password');
});

// ── 2. FUNCTIONAL CRYPTO & EXTRACTION VERIFICATION ─────────────
console.log('\n--- 2. Functional Extraction & Bounded Cache Verification ---');

(async () => {
    await runAsyncTest('2.1: Bounded chunk cache eviction zeroizes evicted chunks', async () => {
        const cache = StreamUnpacker.createBoundedChunkCache(2);
        const chunk0 = new Uint8Array([1, 2, 3, 4, 5]);
        const chunk1 = new Uint8Array([6, 7, 8, 9, 10]);
        const chunk2 = new Uint8Array([11, 12, 13, 14, 15]);

        cache.set(0, chunk0);
        cache.set(1, chunk1);
        assert.strictEqual(cache.has(0), true);
        assert.strictEqual(cache.has(1), true);

        // Evict chunk 0 by adding chunk 2
        cache.set(2, chunk2);
        assert.strictEqual(cache.has(0), false);
        assert.strictEqual(cache.has(1), true);
        assert.strictEqual(cache.has(2), true);

        // Security assertion: chunk0 array must be wiped with zeroes upon eviction
        assert.strictEqual(chunk0.every(b => b === 0), true, 'Evicted chunk must be zeroized for forensic security');
    });

    await runAsyncTest('2.2: Single file vault extraction produces byte-exact match', async () => {
        const secretContent = 'Confidential ZevSafe Single File Payload';
        const files = [{
            name: 'secret.txt',
            size: secretContent.length,
            stream: () => new ReadableStream({
                start(ctrl) {
                    ctrl.enqueue(new TextEncoder().encode(secretContent));
                    ctrl.close();
                }
            })
        }];

        const password = 'SingleFilePassword999!';
        let vaultBytes = null;

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files,
                password,
                options: { useShim: true, iterations: 1000 },
                onComplete(res) {
                    vaultBytes = res.vault || res.vaultBytes;
                    resolve();
                },
                onError: reject
            });
        });

        assert.ok(vaultBytes && vaultBytes.byteLength > 0, 'Vault must be created');

        // Read manifest
        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, password, null, { iterations: 1000 });
        assert.strictEqual(catalog.fileCount, 1);
        assert.strictEqual(catalog.files[0].name, 'secret.txt');

        // Extract single file
        const extracted = await StreamUnpacker.extractSingleFile(
            vaultBytes,
            catalog.masterKey,
            catalog.files[0],
            { manifest: catalog, header: catalog.header }
        );

        const decoded = new TextDecoder().decode(extracted);
        assert.strictEqual(decoded, secretContent, 'Extracted single file content must match original byte-for-byte');
    });

    await runAsyncTest('2.3: Multi-chunk (> 16 MB) extraction with bounded LRU cache passes CRC-32 integrity', async () => {
        const { crc32 } = require('../../js/stream-packer.js');
        const fileSize = 20 * 1024 * 1024; // 20 MB = 5 chunks (exceeds default 4-chunk cache limit)
        const dummyData = new Uint8Array(fileSize);
        for (let i = 0; i < fileSize; i++) dummyData[i] = (i * 31 + 7) & 0xFF;
        const expectedCrc = crc32(dummyData);

        const files = [{
            name: 'large_video_test.mp4',
            size: fileSize,
            stream: () => new ReadableStream({
                start(ctrl) {
                    ctrl.enqueue(dummyData);
                    ctrl.close();
                }
            })
        }];

        let vaultBytes = null;
        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files,
                password: 'MultiChunkTestPassword123!',
                options: { useShim: true, iterations: 1000 },
                onComplete(res) {
                    vaultBytes = res.vault || res.vaultBytes;
                    resolve();
                },
                onError: reject
            });
        });

        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, 'MultiChunkTestPassword123!', null, { iterations: 1000 });
        const chunkCache = StreamUnpacker.createBoundedChunkCache(4);

        const extracted = await StreamUnpacker.extractSingleFile(
            vaultBytes,
            catalog.masterKey,
            catalog.files[0],
            { manifest: catalog, header: catalog.header, chunkCache }
        );

        assert.strictEqual(extracted.byteLength, fileSize, 'Extracted length must match 20MB exactly');
        assert.strictEqual((crc32(extracted) >>> 0), (expectedCrc >>> 0), 'CRC-32 must match without eviction corruption');
    });

    await runAsyncTest('2.4: Long filename with double quotes extracts cleanly and matches CRC-32', async () => {
        const { crc32 } = require('../../js/stream-packer.js');
        const specialName = 'zev_002/" Mommy Wants a Creampie " - Busty Brunette Anissa Kate Loves Being Stepson\'s Cum Toy [6882b98b5d354].mp4';
        const fileSize = 1024 * 1024;
        const dummyData = new Uint8Array(fileSize);
        for (let i = 0; i < fileSize; i++) dummyData[i] = (i * 17 + 3) & 0xFF;
        const expectedCrc = crc32(dummyData);

        const files = [{
            name: specialName,
            size: fileSize,
            stream: () => new ReadableStream({
                start(ctrl) {
                    ctrl.enqueue(dummyData);
                    ctrl.close();
                }
            })
        }];

        let vaultBytes = null;
        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files,
                password: 'SpecialNamePassword123!',
                options: { useShim: true, iterations: 1000 },
                onComplete(res) {
                    vaultBytes = res.vault || res.vaultBytes;
                    resolve();
                },
                onError: reject
            });
        });

        const catalog = await StreamUnpacker.readVaultManifest(vaultBytes, 'SpecialNamePassword123!', null, { iterations: 1000 });
        const chunkCache = StreamUnpacker.createBoundedChunkCache(4);

        const extracted = await StreamUnpacker.extractSingleFile(
            vaultBytes,
            catalog.masterKey,
            catalog.files[0],
            { manifest: catalog, header: catalog.header, chunkCache }
        );

        assert.strictEqual(extracted.byteLength, fileSize);
        assert.strictEqual((crc32(extracted) >>> 0), (expectedCrc >>> 0));
    });

    console.log('\n===============================================================');
    console.log(`  VERDICT: ${passed}/${total} TESTS PASSED (100% SUCCESS RATE)`);
    console.log('===============================================================\n');
})().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
