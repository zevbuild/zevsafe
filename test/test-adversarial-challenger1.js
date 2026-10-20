/**
 * Adversarial Stress & Cryptographic Challenge Test Suite (Challenger 1)
 * test/test-adversarial-challenger1.js
 *
 * Rigorously stress-tests:
 * 1. CreditFlowController under synthetic backpressure saturation and aborts.
 * 2. OrderedReassemblyQueue under out-of-order sequencing, waiting callers, and aborts.
 * 3. StreamCrypto.deriveMasterKey intermediate key zeroization and iteration floor boundaries.
 * 4. currentV3Vault.chunkCache LRU 4-chunk (16 MB) capacity bound and eviction zeroization.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WorkerBridge = require('../js/worker-bridge.js');
const StreamCrypto = require('../js/stream-crypto.js');
const { CreditFlowController, OrderedReassemblyQueue } = WorkerBridge;

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

async function runTests() {
    console.log('===============================================================');
    console.log('  CHALLENGER 1: ADVERSARIAL CRYPTO & FLOW CONTROL TEST SUITE  ');
    console.log('===============================================================\n');

    // =========================================================================
    // 1. CreditFlowController Adversarial Abort & Concurrency
    // =========================================================================
    console.log('--- 1. CreditFlowController Backpressure & Abort Tests ---');
    {
        const controller = new CreditFlowController(2);
        await controller.acquire();
        await controller.acquire();
        assert(controller.availableCredits === 0, 'Credits exhausted to 0 after 2 acquires');
        assert(controller.inFlight === 2, 'inFlight counter is 2');

        // Queue 10 waiting callers under backpressure saturation
        const waiterPromises = [];
        const rejectionReasons = [];
        for (let i = 0; i < 10; i++) {
            waiterPromises.push(
                controller.acquire().catch(err => {
                    rejectionReasons.push(err.message);
                })
            );
        }
        assert(controller.waiters.length === 10, '10 callers are queued in waiters array');

        // Abort controller mid-backpressure
        const abortReason = new Error('Backpressure Saturation Abort Test');
        controller.abort(abortReason);

        assert(controller.isAborted === true, 'Controller isAborted flag is true');
        assert(controller.waiters.length === 0, 'Waiters queue drained immediately on abort');

        await Promise.all(waiterPromises);
        assert(rejectionReasons.length === 10, 'All 10 waiting callers were rejected without hanging');
        assert(
            rejectionReasons.every(msg => msg === 'Backpressure Saturation Abort Test'),
            'All 10 waiters received exact abort reason'
        );

        // Subsequent acquire after abort should reject immediately without queueing
        let postAbortRejected = false;
        try {
            await controller.acquire();
        } catch (err) {
            postAbortRejected = (err.message === 'Backpressure Saturation Abort Test');
        }
        assert(postAbortRejected, 'Subsequent acquire() immediately rejects post-abort');
        assert(controller.waiters.length === 0, 'Waiters queue remains 0 after post-abort acquire');

        // release() post-abort should not throw or corrupt state
        let releasePostAbortThrew = false;
        try {
            controller.release();
            controller.release();
        } catch (_) {
            releasePostAbortThrew = true;
        }
        assert(!releasePostAbortThrew, 'release() post-abort handles gracefully without throwing');
    }

    // High Concurrency Race Test for CreditFlowController
    {
        const controller = new CreditFlowController(3);
        const callers = 50;
        let acquiredCount = 0;
        let rejectedCount = 0;

        const promises = [];
        for (let i = 0; i < callers; i++) {
            promises.push(
                (async () => {
                    try {
                        await controller.acquire();
                        acquiredCount++;
                        await new Promise(r => setTimeout(r, 2));
                        controller.release();
                    } catch (err) {
                        rejectedCount++;
                    }
                })()
            );
        }

        // Trigger abort mid-flight
        setTimeout(() => {
            controller.abort(new Error('Mid-flight cancellation'));
        }, 3);

        await Promise.allSettled(promises);
        assert(
            acquiredCount + rejectedCount === callers,
            `All ${callers} concurrent callers settled cleanly (Acquired: ${acquiredCount}, Rejected: ${rejectedCount})`
        );
        assert(controller.waiters.length === 0, 'No dangling waiters remaining after concurrent race');
    }

    // =========================================================================
    // 2. OrderedReassemblyQueue Adversarial Abort & Plaintext Scrubbing
    // =========================================================================
    console.log('\n--- 2. OrderedReassemblyQueue Sequencing & Plaintext Scrubbing Tests ---');
    {
        const readyChunks = [];
        let errorCaught = null;

        const queue = new OrderedReassemblyQueue({
            onChunkReady: async (item) => {
                readyChunks.push(item.chunkIndex);
            },
            onError: (err) => {
                errorCaught = err;
            }
        });

        // Create plaintext chunks
        const plain1 = new Uint8Array([1, 1, 1, 1]);
        const plain2 = new Uint8Array([2, 2, 2, 2]);
        const plain3 = new Uint8Array([3, 3, 3, 3]);

        // Push out-of-order chunks (1, 2, 3) missing chunk 0
        await queue.push(1, { chunkIndex: 1, plainChunk: plain1 });
        await queue.push(2, { chunkIndex: 2, plainChunk: plain2 });
        await queue.push(3, { chunkIndex: 3, plainChunk: plain3 });

        assert(readyChunks.length === 0, 'No chunks emitted out of sequence while chunk 0 is missing');
        assert(queue.buffer.size === 3, 'Queue buffers 3 out-of-order chunks');

        // Create drain waiter
        let drainRejected = false;
        const drainPromise = queue.waitUntilDrained().catch(err => {
            drainRejected = (err.message === 'Reassembly Aborted');
        });

        // Abort the queue
        queue.abort(new Error('Reassembly Aborted'));

        await drainPromise;
        assert(drainRejected, 'waitUntilDrained() immediately rejected with abort error');
        assert(queue.buffer.size === 0, 'Queue buffer cleared immediately on abort');

        // Verify plaintext zeroization on aborted chunks
        const plain1Zeroed = plain1.every(b => b === 0);
        const plain2Zeroed = plain2.every(b => b === 0);
        const plain3Zeroed = plain3.every(b => b === 0);
        assert(plain1Zeroed && plain2Zeroed && plain3Zeroed, 'All buffered plaintext chunks scrubbed with zeros on abort');

        // Verify push() post-abort is discarded
        const plainPost = new Uint8Array([9, 9, 9, 9]);
        await queue.push(0, { chunkIndex: 0, plainChunk: plainPost });
        assert(readyChunks.length === 0, 'Post-abort push() ignored, onChunkReady not invoked');
        assert(queue.buffer.size === 0, 'Post-abort push() not added to buffer');
    }

    // Stress: 100 Out-of-Order chunks reassembly correctness
    {
        const sequence = [];
        const queue = new OrderedReassemblyQueue({
            onChunkReady: async (item) => {
                sequence.push(item.chunkIndex);
            }
        });

        // Push 100 chunks in reverse order 99 -> 0
        const items = [];
        for (let i = 99; i >= 0; i--) {
            items.push(queue.push(i, { chunkIndex: i }));
        }
        await Promise.all(items);
        await queue.waitUntilDrained();

        assert(sequence.length === 100, 'All 100 chunks emitted');
        let strictlyOrdered = true;
        for (let i = 0; i < 100; i++) {
            if (sequence[i] !== i) {
                strictlyOrdered = false;
                break;
            }
        }
        assert(strictlyOrdered, '100 reversed chunks emitted in strictly sequential order 0..99');
    }

    // =========================================================================
    // 3. StreamCrypto.deriveMasterKey Precursor Zeroization & Floors
    // =========================================================================
    console.log('\n--- 3. StreamCrypto.deriveMasterKey Scrubbing & Iteration Floor Tests ---');
    {
        const salt = crypto.getRandomValues(new Uint8Array(32));
        const originalEncode = TextEncoder.prototype.encode;
        let capturedPasswordBytes = null;

        TextEncoder.prototype.encode = function (str) {
            const buf = originalEncode.call(this, str);
            capturedPasswordBytes = buf;
            return buf;
        };

        const originalDeriveBits = crypto.subtle.deriveBits;
        let capturedDerivedBits = null;
        crypto.subtle.deriveBits = async function (...args) {
            const bits = await originalDeriveBits.apply(this, args);
            capturedDerivedBits = bits;
            return bits;
        };

        const originalDigest = crypto.subtle.digest;
        let capturedKeyfileHash = null;
        crypto.subtle.digest = async function (...args) {
            const res = await originalDigest.apply(this, args);
            if (args[0] === 'SHA-256') {
                capturedKeyfileHash = res;
            }
            return res;
        };

        const keyfileBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

        try {
            const key = await StreamCrypto.deriveMasterKey('SuperSecretMasterKey!2026', salt, 100, keyfileBytes);
            assert(key && key.algorithm.name === 'AES-GCM', 'deriveMasterKey succeeded with valid CryptoKey');

            // Verify passwordBytes zeroization
            const passwordZeroed = capturedPasswordBytes.every(b => b === 0);
            assert(passwordZeroed, 'passwordBytes in deriveMasterKey was zeroized with .fill(0)');

            // Verify rawKeyBytes zeroization
            const rawKeyZeroed = new Uint8Array(capturedDerivedBits).every(b => b === 0);
            assert(rawKeyZeroed, 'PBKDF2 derived rawKeyBytes in deriveMasterKey was zeroized with .fill(0)');

            // Verify keyfileHash zeroization
            const keyfileHashZeroed = new Uint8Array(capturedKeyfileHash).every(b => b === 0);
            assert(keyfileHashZeroed, 'keyfileHash in deriveMasterKey was zeroized with .fill(0)');
        } finally {
            TextEncoder.prototype.encode = originalEncode;
            crypto.subtle.deriveBits = originalDeriveBits;
            crypto.subtle.digest = originalDigest;
        }

        // Test exception scenario: ensure zeroization runs even if subtle throws
        let errorCapturedPassword = null;
        TextEncoder.prototype.encode = function (str) {
            const buf = originalEncode.call(this, str);
            errorCapturedPassword = buf;
            return buf;
        };
        const originalImportKey = crypto.subtle.importKey;
        let importKeyCallCount = 0;
        crypto.subtle.importKey = async function (...args) {
            importKeyCallCount++;
            if (importKeyCallCount === 2) {
                // Simulate AES-GCM import failure
                throw new Error('Simulated AES-GCM Import Failure');
            }
            return originalImportKey.apply(this, args);
        };

        let threwExpected = false;
        try {
            await StreamCrypto.deriveMasterKey('FailPassword', salt, 100);
        } catch (err) {
            threwExpected = (err.message === 'Simulated AES-GCM Import Failure');
        } finally {
            TextEncoder.prototype.encode = originalEncode;
            crypto.subtle.importKey = originalImportKey;
        }
        assert(threwExpected, 'deriveMasterKey propagated simulated internal exception');
        assert(
            errorCapturedPassword.every(b => b === 0),
            'passwordBytes was zeroized even when an internal exception occurred in try block'
        );

        // Iteration Floor Validation in Node environment (min 100)
        let rejectedLowIterationsNode = false;
        try {
            await StreamCrypto.deriveMasterKey('Pass', salt, 99);
        } catch (err) {
            rejectedLowIterationsNode = err instanceof RangeError && err.message.includes('at least 100');
        }
        assert(rejectedLowIterationsNode, 'Rejects iterations < 100 in Node test environment');

        // Iteration Floor Validation in Browser Simulation (process undefined -> min 100,000)
        const savedProcess = global.process;
        try {
            delete global.process;
            let rejectedLowIterationsBrowser = false;
            try {
                await StreamCrypto.deriveMasterKey('Pass', salt, 99999);
            } catch (err) {
                rejectedLowIterationsBrowser = err instanceof RangeError && err.message.includes('at least 100000');
            }
            assert(rejectedLowIterationsBrowser, 'Rejects iterations < 100,000 in simulated browser production environment');
        } finally {
            global.process = savedProcess;
        }
    }

    // =========================================================================
    // 4. app.js currentV3Vault.chunkCache LRU Eviction & Zeroization
    // =========================================================================
    console.log('\n--- 4. app.js chunkCache LRU (16 MB) & Zeroization Tests ---');
    {
        // Load app.js in a sandboxed DOM context
        const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

        const mockElement = () => ({
            style: {},
            classList: { add() {}, remove() {}, toggle() {} },
            addEventListener() {},
            setAttribute() {},
            removeAttribute() {},
            appendChild() {},
            removeChild() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
            value: '',
            textContent: '',
            innerHTML: ''
        });

        const sandbox = {
            addEventListener() {},
            removeEventListener() {},
            matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
            document: {
                documentElement: mockElement(),
                body: mockElement(),
                getElementById: () => mockElement(),
                querySelector: () => mockElement(),
                querySelectorAll: () => [],
                createElement: () => mockElement(),
                addEventListener: () => {}
            },
            navigator: { serviceWorker: { controller: null, addEventListener() {} } },
            location: { reload() {} },
            setTimeout: global.setTimeout,
            clearTimeout: global.clearTimeout,
            console: { log() {}, warn() {}, error() {} },
            Uint8Array: global.Uint8Array,
            Map: global.Map,
            Blob: global.Blob,
            TextEncoder: global.TextEncoder,
            TextDecoder: global.TextDecoder
        };
        sandbox.window = sandbox;
        sandbox.globalThis = sandbox;

        vm.createContext(sandbox);
        vm.runInContext(appCode, sandbox);

        // Open V3 Vault Explorer to instantiate chunkCache
        const catalogMock = { files: [], header: { chunkSize: 4194304 } };
        sandbox.openV3VaultExplorer('TestVault', catalogMock, null, 'TestPass');

        const vault = vm.runInContext('currentV3Vault', sandbox);
        assert(vault !== null, 'currentV3Vault initialized by openV3VaultExplorer');
        assert(vault.chunkCache !== null, 'chunkCache exists on currentV3Vault');

        const cache = vault.chunkCache;
        assert(cache._maxChunks === 4, 'chunkCache maxChunks strictly configured to 4 (16 MB cap)');

        // Allocate 6 test chunks of 4 MB each (filled with 0xAA)
        const CHUNK_SIZE = 4 * 1024 * 1024;
        const c0 = new Uint8Array(CHUNK_SIZE).fill(0xAA);
        const c1 = new Uint8Array(CHUNK_SIZE).fill(0xAA);
        const c2 = new Uint8Array(CHUNK_SIZE).fill(0xAA);
        const c3 = new Uint8Array(CHUNK_SIZE).fill(0xAA);
        const c4 = new Uint8Array(CHUNK_SIZE).fill(0xAA);
        const c5 = new Uint8Array(CHUNK_SIZE).fill(0xAA);

        // Insert first 4 chunks
        cache.set(0, c0);
        cache.set(1, c1);
        cache.set(2, c2);
        cache.set(3, c3);

        assert(cache.size === 4, 'cache size is exactly 4 chunks (16 MB)');
        assert(cache.has(0) && cache.has(1) && cache.has(2) && cache.has(3), 'cache holds chunks 0..3');

        // Insert 5th chunk (c4) -> chunk 0 must be evicted from cache
        // Note: evicted chunk must NOT be zeroized in-place (SEC-HIGH-07) to avoid
        // buffer aliasing corruption when StreamUnpacker.extractSingleFile holds references
        // to earlier chunks during multi-chunk extractions (>16 MB).
        cache.set(4, c4);
        assert(cache.size === 4, 'cache size remains capped at 4 after 5th chunk insertion');
        assert(!cache.has(0), 'oldest chunk (0) was evicted from cache');
        assert(cache.has(4), 'new chunk (4) is present in cache');
        assert(c0.some(b => b === 0xAA), 'evicted chunk 0 preserves buffer integrity for active extractions without in-place zeroization');

        // Test LRU recency refresh: access chunk 1 via get(1), then insert 6th chunk (c5)
        // Order before get(1): [1, 2, 3, 4]. After get(1): [2, 3, 4, 1].
        // Next eviction must be chunk 2, NOT chunk 1!
        const retrievedC1 = cache.get(1);
        assert(retrievedC1 === c1, 'cache.get(1) returned chunk 1');

        cache.set(5, c5);
        assert(cache.size === 4, 'cache size remains 4 after 6th chunk insertion');
        assert(!cache.has(2), 'chunk 2 was evicted (oldest after chunk 1 recency refresh)');
        assert(cache.has(1), 'chunk 1 was preserved due to LRU recency refresh');
        assert(c2.some(b => b === 0xAA), 'evicted chunk 2 preserves buffer integrity for active extractions without in-place zeroization');

        // Test delete(key) zeroization
        cache.delete(3);
        assert(!cache.has(3), 'chunk 3 removed by delete()');
        assert(cache.size === 3, 'cache size decremented to 3');
        assert(c3.every(b => b === 0), 'deleted chunk 3 was zeroized with .fill(0)');

        // Test lockV3VaultSession() session clearing & zeroization
        sandbox.lockV3VaultSession();
        const postLockVault = vm.runInContext('currentV3Vault', sandbox);
        assert(postLockVault === null, 'currentV3Vault nullified by lockV3VaultSession');
        assert(c1.every(b => b === 0), 'remaining chunk 1 zeroized by lockV3VaultSession');
        assert(c4.every(b => b === 0), 'remaining chunk 4 zeroized by lockV3VaultSession');
        assert(c5.every(b => b === 0), 'remaining chunk 5 zeroized by lockV3VaultSession');
    }

    // =========================================================================
    // 5. Multi-Chunk (> 16 MB) Single-File Extraction with chunkCache
    // =========================================================================
    console.log('\n--- 5. Multi-Chunk (> 16 MB) Single-File Extraction with chunkCache ---');
    {
        const StreamUnpacker = require('../js/stream-unpacker.js');
        const chunkSize = 32 * 1024;
        const testData = crypto.randomBytes(chunkSize * 5); // 5 chunks = spans past 4-chunk cache
        const files = [{ name: 'large_test.bin', size: testData.length, data: testData }];
        const encResult = await new Promise((resolve, reject) => {
            WorkerBridge.startEncryption({
                files,
                password: 'Password123!',
                options: { chunkSize, iterations: 100 },
                onComplete: resolve,
                onError: reject
            });
        });

        const catalog = await StreamUnpacker.readVaultManifest(encResult.vault, 'Password123!', { iterations: 100 });
        const entry = catalog.files[0];

        // Instantiate app.js style chunkCache (max 4 chunks)
        const activeChunkCache = {
            _map: new Map(),
            _maxChunks: 4,
            has(key) { return this._map.has(key); },
            get(key) {
                if (!this._map.has(key)) return undefined;
                const val = this._map.get(key);
                this._map.delete(key);
                this._map.set(key, val);
                return val;
            },
            set(key, val) {
                if (this._map.has(key)) this._map.delete(key);
                else if (this._map.size >= this._maxChunks) {
                    const oldestKey = this._map.keys().next().value;
                    this._map.delete(oldestKey);
                }
                this._map.set(key, val);
                return this;
            },
            clear() {
                for (const chunk of this._map.values()) {
                    if (chunk && typeof chunk.fill === 'function') chunk.fill(0);
                }
                this._map.clear();
            }
        };

        const extracted = await StreamUnpacker.extractSingleFile(
            encResult.vault,
            'Password123!',
            entry,
            {
                chunkCache: activeChunkCache,
                manifest: catalog,
                header: catalog.header,
                iterations: 100
            }
        );

        assert(extracted !== null && extracted.data !== null, 'extractSingleFile succeeded on 5-chunk vault');
        assert(extracted.data.length === testData.length, 'extracted byte length matches original 5-chunk data');
        assert(Buffer.from(extracted.data).equals(testData), 'extracted payload matches original bytes bit-for-bit without buffer aliasing corruption');
    }

    console.log('\n===============================================================');
    console.log(`  CHALLENGER 1 ADVERSARIAL RESULTS: ${passedTests}/${totalTests} PASSED`);
    if (failedTests > 0) {
        console.error(`  FAILURES: ${failedTests}`);
        for (const f of failures) console.error(`    - ${f}`);
    } else {
        console.log('  ALL ADVERSARIAL STRESS CHALLENGES PASSED WITH 100% SUCCESS.');
    }
    console.log('===============================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
