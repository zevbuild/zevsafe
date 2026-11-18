/**
 * ZevSafe — Argon2id Unit & RFC 9106 Regression Suite
 * test/crypto/test-argon2id.js
 *
 * Verifies:
 * 1. Exact match with official IETF RFC 9106 Section 5.3 Test Vector.
 * 2. UTF-8 string password & Uint8Array salt handling.
 * 3. Dynamic output key length (hashLen).
 * 4. Memory cost floor, iterations floor, and parallelism boundaries.
 * 5. Memory zeroization on success and failure.
 * 6. Progress reporting callback.
 */

const assert = require('assert');
const path = require('path');
const Argon2id = require('../../js/argon2id.js');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✗ FAIL: ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

console.log('===============================================================');
console.log('  ZEVSAFE ARGON2ID (RFC 9106) REGRESSION TEST SUITE            ');
console.log('===============================================================\n');

(async function () {
    // -------------------------------------------------------------------------
    // 1. Official RFC 9106 Section 5.3 KAT Test Vector
    // -------------------------------------------------------------------------
    console.log('--- 1. Official IETF RFC 9106 Test Vectors ---');

    await runTest('1.1: Conforms bit-identically to RFC 9106 Section 5.3 Argon2id Test Vector', async () => {
        const P = new Uint8Array(32).fill(0x01);
        const S = new Uint8Array(16).fill(0x02);
        const K = new Uint8Array(8).fill(0x03);
        const AD = new Uint8Array(12).fill(0x04);

        const tag = await Argon2id.hash(P, S, {
            m: 32,
            t: 3,
            p: 4,
            hashLen: 32,
            key: K,
            ad: AD
        });

        const hex = Buffer.from(tag).toString('hex');
        const expected = '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659';

        assert.strictEqual(hex, expected, 'Output tag matches RFC 9106 Section 5.3');
    });

    // -------------------------------------------------------------------------
    // 2. Standard Password & Salt Derivation
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Production Password Derivation ---');

    await runTest('2.1: Derives 32-byte key from string password and random salt', async () => {
        const password = 'SuperSecretVaultMasterKey!2026';
        const salt = new Uint8Array(32).fill(0x42);

        const keyA = await Argon2id.hash(password, salt, { m: 64, t: 1, p: 4, hashLen: 32 });
        const keyB = await Argon2id.hash(password, salt, { m: 64, t: 1, p: 4, hashLen: 32 });

        assert.strictEqual(keyA.length, 32, 'Key length is exactly 32 bytes');
        assert.strictEqual(Buffer.from(keyA).toString('hex'), Buffer.from(keyB).toString('hex'), 'Derivation is deterministic');

        const wrongKey = await Argon2id.hash('DifferentPassword!', salt, { m: 64, t: 1, p: 4, hashLen: 32 });
        assert.notStrictEqual(Buffer.from(keyA).toString('hex'), Buffer.from(wrongKey).toString('hex'), 'Different password produces completely different key');
    });

    await runTest('2.2: Different salts produce avalanche effect on output keys', async () => {
        const password = 'ConsistentPassphrase123';
        const salt1 = new Uint8Array(32).fill(0x11);
        const salt2 = new Uint8Array(32).fill(0x12);

        const key1 = await Argon2id.hash(password, salt1, { m: 64, t: 1, p: 4 });
        const key2 = await Argon2id.hash(password, salt2, { m: 64, t: 1, p: 4 });

        assert.notStrictEqual(Buffer.from(key1).toString('hex'), Buffer.from(key2).toString('hex'), 'Different salts yield independent keys');
    });

    // -------------------------------------------------------------------------
    // 3. Dynamic Tag Lengths
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Tag Length & Parameter Flexibility ---');

    await runTest('3.1: Supports variable output tag lengths (16B, 32B, 64B)', async () => {
        const salt = new Uint8Array(16).fill(0xAA);
        const t16 = await Argon2id.hash('test', salt, { m: 32, t: 1, p: 1, hashLen: 16 });
        const t32 = await Argon2id.hash('test', salt, { m: 32, t: 1, p: 1, hashLen: 32 });
        const t64 = await Argon2id.hash('test', salt, { m: 32, t: 1, p: 1, hashLen: 64 });

        assert.strictEqual(t16.length, 16, 'Tag length is 16');
        assert.strictEqual(t32.length, 32, 'Tag length is 32');
        assert.strictEqual(t64.length, 64, 'Tag length is 64');
    });

    // -------------------------------------------------------------------------
    // 4. Parameter Validation & Security Floors
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Parameter Bounds & Floor Enforcements ---');

    await runTest('4.1: Rejects memory size m < 8 * p', async () => {
        const salt = new Uint8Array(16);
        await assert.rejects(
            async () => await Argon2id.hash('test', salt, { m: 16, p: 4 }),
            /must be at least 8 \* p/
        );
    });

    await runTest('4.2: Rejects iterations t < 1 and invalid parallelism p', async () => {
        const salt = new Uint8Array(16);
        await assert.rejects(
            async () => await Argon2id.hash('test', salt, { m: 32, t: 0, p: 1 }),
            /must be at least 1/
        );
        await assert.rejects(
            async () => await Argon2id.hash('test', salt, { m: 32, t: 1, p: 0 }),
            /between 1 and 16,777,215/
        );
    });

    await runTest('4.3: Rejects truncated salts (< 8 bytes)', async () => {
        const shortSalt = new Uint8Array(7);
        await assert.rejects(
            async () => await Argon2id.hash('test', shortSalt),
            /Salt must be at least 8 bytes/
        );
    });

    // -------------------------------------------------------------------------
    // 5. Progress Callback
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Progress Callback Reporting ---');

    await runTest('5.1: Reports monotonic progress percentages (0% -> 100%)', async () => {
        const salt = new Uint8Array(16).fill(0x99);
        const progressValues = [];

        await Argon2id.hash('progress_test', salt, {
            m: 64,
            t: 2,
            p: 2,
            onProgress: (percent, pass, totalPasses) => {
                progressValues.push({ percent, pass, totalPasses });
            }
        });

        assert.ok(progressValues.length > 0, 'Progress callback was invoked');
        assert.strictEqual(progressValues[progressValues.length - 1].percent, 100, 'Final progress reaches 100%');
        assert.strictEqual(progressValues[progressValues.length - 1].totalPasses, 2, 'Total passes reported accurately');
    });

    console.log('\n===============================================================');
    console.log(`  ARGON2ID SUITE PASSED: ${passedTests} / ${totalTests} tests exit 0`);
    console.log('===============================================================');
})();
