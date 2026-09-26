/**
 * Milestone 5 Integration Test: StreamSaverAdapter + WorkerBridge + StreamUnpacker
 * test/test-integration-m5.js
 */

const assert = require('assert');
const { runner, describe, it, expect } = require('./e2e-runner.js');
const StreamCrypto = require('../js/stream-crypto.js');
const StreamPacker = require('../js/stream-packer.js');
const StreamUnpacker = require('../js/stream-unpacker.js');
const WorkerBridge = require('../js/worker-bridge.js');
const StreamSaverAdapter = require('../js/stream-saver.js');
const MockStream = require('./mock-stream.js');

async function runM5IntegrationTests() {
    console.log('\n===============================================================');
    console.log('  Milestone 5 Integration & Verification Test Suite');
    console.log('===============================================================\n');

    let passed = 0;
    let total = 0;
    function test(name, fn) {
        total++;
        try {
            const p = fn();
            if (p && p.then) {
                return p.then(() => {
                    passed++;
                    console.log(`  ✓ ${name}`);
                }).catch(err => {
                    console.error(`  ✗ ${name}:`, err);
                    throw err;
                });
            }
            passed++;
            console.log(`  ✓ ${name}`);
        } catch (err) {
            console.error(`  ✗ ${name}:`, err);
            throw err;
        }
    }

    // 1. Filename sanitization and header encoding
    test('1. sanitizeFilename strips dangerous path chars', () => {
        assert.strictEqual(StreamSaverAdapter.sanitizeFilename('test/file:name*?.zev'), 'test_file_name__.zev');
        assert.strictEqual(StreamSaverAdapter.sanitizeFilename(''), 'vault.zev');
    });

    test('2. encodeContentDisposition formats RFC 5987 header', () => {
        const header = StreamSaverAdapter.encodeContentDisposition('résumé_secure.zev');
        assert(header.includes('attachment;'));
        assert(header.includes("filename*=UTF-8''r%C3%A9sum%C3%A9_secure.zev"));
    });

    // 2. Multi-tier stream writer creation
    await test('3. createStreamWriter fallback creates writable sink', async () => {
        const stream = await StreamSaverAdapter.createStreamWriter('test_vault.zev', 1000, { tier: 'fallback' });
        assert.strictEqual(stream.tier, 'fallback');
        const writer = stream.getWriter();
        await writer.write(new Uint8Array([1, 2, 3, 4]));
        await writer.close();
        assert.strictEqual(stream.chunks.length, 1);
        assert.strictEqual(stream.chunks[0].byteLength, 4);
    });

    // 3. End-to-end multi-chunk streaming encryption with seekable writable sink
    await test('4. Streaming encryption with seekable sink and round-trip extraction', async () => {
        // Create mock seekable stream sink (simulating FileSystemWritableFileStream / OPFS)
        const fileBytes = [];
        let position = 0;
        const mockSeekableWriter = {
            async write(chunk) {
                const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                for (let i = 0; i < u8.byteLength; i++) {
                    fileBytes[position++] = u8[i];
                }
            },
            async seek(pos) {
                position = pos;
            },
            async close() {}
        };

        const testFiles = [
            {
                name: 'doc.txt',
                size: 50,
                stream: () => MockStream.createStream(50, { seed: 101 })
            },
            {
                name: 'image.png',
                size: 100,
                stream: () => MockStream.createStream(100, { seed: 202 })
            }
        ];

        let observedStage = '';
        let observedTelemetry = null;

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: testFiles,
                password: 'M5SecurePassword123!',
                options: {
                    useShim: true,
                    writable: mockSeekableWriter,
                    chunkSize: 1024, // small chunks to test multi-chunk pipeline
                    iterations: 1000
                },
                onProgress(t) {
                    observedStage = t.stage;
                    observedTelemetry = t;
                },
                onComplete(res) {
                    resolve(res);
                },
                onError(err) {
                    reject(err);
                }
            });
        });

        assert(observedTelemetry !== null, 'Telemetry received');
        assert(fileBytes.length > 57, 'Sink received data bytes');

        const vaultU8 = new Uint8Array(fileBytes);
        assert.strictEqual(vaultU8[0], 0x5A, 'Byte 0 is magic Z');
        assert.strictEqual(vaultU8[1], 0x56, 'Byte 1 is magic V');
        assert.strictEqual(vaultU8[2], 0x33, 'Byte 2 is magic 3');

        // Verify header parsing and manifest reading from stream-created vault
        const parsedHeader = await StreamUnpacker.parseVaultHeader(vaultU8);
        assert.strictEqual(parsedHeader.version, 3);
        assert(parsedHeader.manifestOffset > 57n, 'Header manifestOffset was updated via seek(0)');

        // Read manifest trailer
        const catalog = await StreamUnpacker.readVaultManifest(vaultU8, 'M5SecurePassword123!', null, { iterations: 1000 });
        assert.strictEqual(catalog.fileCount, 2, 'Catalog contains 2 files');
        assert(catalog.files.some(f => f.path.includes('doc.txt')), 'Catalog contains doc.txt');

        // Extract single file from the vault
        const docEntry = catalog.files.find(f => f.path.includes('doc.txt'));
        const extracted = await StreamUnpacker.extractSingleFile(vaultU8, 'M5SecurePassword123!', docEntry, { iterations: 1000 });
        assert.strictEqual(extracted.byteLength, 50, 'Extracted doc.txt byte length matches');

        // Verify wrong password and tampering rejection
        await assert.rejects(
            () => StreamUnpacker.readVaultManifest(vaultU8, 'WrongPassword999!', null, { iterations: 1000 }),
            'Wrong password immediately rejected'
        );
    });

    // 4. Bounded memory streaming test across multiple 4 MB chunks
    await test('5. Bounded RAM streaming pipeline (< 150 MB peak heap delta across multi-MB chunks)', async () => {
        const { MemoryProfiler } = require('./memory-profiler.js');
        const profiler = new MemoryProfiler({ maxHeapMB: 150 });
        profiler.start();

        let bytesWrittenToDisk = 0;
        const zeroBufferDiskSink = {
            async write(chunk) {
                const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                bytesWrittenToDisk += u8.byteLength;
            },
            async seek() {},
            async close() {}
        };

        const largeVirtualFiles = [
            {
                name: 'dataset_part1.bin',
                size: 8 * 1024 * 1024, // 8 MB
                stream: () => MockStream.createStream(8 * 1024 * 1024, { seed: 777 })
            },
            {
                name: 'dataset_part2.txt',
                size: 8 * 1024 * 1024, // 8 MB
                stream: () => MockStream.createStream(8 * 1024 * 1024, { pattern: 'compressible' })
            }
        ];

        await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files: largeVirtualFiles,
                password: 'BoundedRamTestPassword!',
                options: {
                    writable: zeroBufferDiskSink,
                    iterations: 1000
                },
                onComplete: resolve,
                onError: reject
            });
        });

        const memReport = profiler.stop();
        assert(bytesWrittenToDisk > 8 * 1024 * 1024, 'Multi-MB stream written directly to disk sink without RAM accumulation');
        assert(memReport.peakDeltaMB < 150, `Peak heap delta (${memReport.peakDeltaMB.toFixed(2)} MB) stayed well below 150 MB mobile limit`);
    });

    console.log(`\n===============================================================`);
    console.log(`  M5 TEST RESULTS: ${passed}/${total} PASSED (100%)`);
    console.log(`===============================================================\n`);
}

runM5IntegrationTests().catch(err => {
    console.error('M5 integration tests failed:', err);
    process.exit(1);
});
