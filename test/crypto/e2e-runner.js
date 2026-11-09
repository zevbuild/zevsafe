/**
 * ZevSafe 5 GB Streaming Architecture - Opaque-Box E2E Test Runner
 * test/e2e-runner.js
 *
 * Zero-dependency, browser- and Node-compatible test execution harness.
 * Supports asynchronous test execution, per-test timeouts, deep assertions,
 * structured JSON test reports, memory profiling telemetry, and real-time DOM/console reporting.
 */

(function (global) {
    'use strict';

    // Global Test Registry
    const suites = [];
    let currentSuite = null;
    const globalBeforeAll = [];
    const globalAfterAll = [];
    const globalBeforeEach = [];
    const globalAfterEach = [];

    // Deep equality helper
    function deepEqual(a, b) {
        if (Object.is(a, b)) return true;
        if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') {
            return false;
        }

        // Uint8Array / TypedArray comparison
        if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
            if (a.byteLength !== b.byteLength) return false;
            const u8A = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
            const u8B = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
            for (let i = 0; i < u8A.length; i++) {
                if (u8A[i] !== u8B[i]) return false;
            }
            return true;
        }

        // ArrayBuffer comparison
        if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) {
            if (a.byteLength !== b.byteLength) return false;
            const u8A = new Uint8Array(a);
            const u8B = new Uint8Array(b);
            for (let i = 0; i < u8A.length; i++) {
                if (u8A[i] !== u8B[i]) return false;
            }
            return true;
        }

        // Array comparison
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!deepEqual(a[i], b[i])) return false;
            }
            return true;
        }

        // Plain object comparison
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const k of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) {
                return false;
            }
        }
        return true;
    }

    /**
     * Assertion Object with fluent matcher interface
     */
    class Expectation {
        constructor(actual, isNegated = false) {
            this.actual = actual;
            this.isNegated = isNegated;
        }

        get not() {
            return new Expectation(this.actual, !this.isNegated);
        }

        _assert(condition, message, expectedValue) {
            const passed = this.isNegated ? !condition : condition;
            if (!passed) {
                const prefix = this.isNegated ? 'Expected NOT to: ' : 'Expected: ';
                const err = new Error(prefix + message + (expectedValue !== undefined ? `\nReceived: ${this._stringify(this.actual)}\nExpected: ${this._stringify(expectedValue)}` : `\nReceived: ${this._stringify(this.actual)}`));
                err.isAssertionError = true;
                throw err;
            }
        }

        _stringify(val) {
            if (val === undefined) return 'undefined';
            if (val === null) return 'null';
            if (ArrayBuffer.isView(val)) return `[TypedArray byteLength=${val.byteLength}]`;
            if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`;
            try {
                return JSON.stringify(val);
            } catch {
                return String(val);
            }
        }

        toBe(expected) {
            this._assert(Object.is(this.actual, expected), `be identical (${this._stringify(expected)})`, expected);
        }

        toEqual(expected) {
            this._assert(deepEqual(this.actual, expected), `be deeply equal to expected object`, expected);
        }

        toBeTruthy() {
            this._assert(Boolean(this.actual), 'be truthy');
        }

        toBeFalsy() {
            this._assert(!this.actual, 'be falsy');
        }

        toBeNull() {
            this._assert(this.actual === null, 'be null', null);
        }

        toBeUndefined() {
            this._assert(this.actual === undefined, 'be undefined', undefined);
        }

        toBeDefined() {
            this._assert(this.actual !== undefined, 'be defined');
        }

        toBeGreaterThan(expected) {
            this._assert(this.actual > expected, `be greater than ${expected}`, expected);
        }

        toBeGreaterThanOrEqual(expected) {
            this._assert(this.actual >= expected, `be greater than or equal to ${expected}`, expected);
        }

        toBeLessThan(expected) {
            this._assert(this.actual < expected, `be less than ${expected}`, expected);
        }

        toBeLessThanOrEqual(expected) {
            this._assert(this.actual <= expected, `be less than or equal to ${expected}`, expected);
        }

        toBeCloseTo(expected, delta = 0.001) {
            const diff = Math.abs(this.actual - expected);
            this._assert(diff <= delta, `be close to ${expected} within delta ${delta} (actual diff: ${diff})`, expected);
        }

        toContain(item) {
            if (typeof this.actual === 'string') {
                this._assert(this.actual.includes(item), `contain substring "${item}"`, item);
            } else if (Array.isArray(this.actual)) {
                this._assert(this.actual.includes(item) || this.actual.some(x => deepEqual(x, item)), `contain element ${this._stringify(item)}`, item);
            } else if (this.actual instanceof Set || this.actual instanceof Map) {
                this._assert(this.actual.has(item), `contain key/item ${this._stringify(item)}`, item);
            } else {
                throw new Error('toContain() target must be string, Array, Set, or Map');
            }
        }

        toHaveLength(len) {
            const actualLen = this.actual != null ? (this.actual.length !== undefined ? this.actual.length : this.actual.size) : undefined;
            this._assert(actualLen === len, `have length ${len}, got ${actualLen}`, len);
        }

        toThrow(expectedPattern = null) {
            if (typeof this.actual !== 'function') {
                throw new Error('toThrow() requires a function as actual');
            }
            let threw = false;
            let caughtError = null;
            try {
                this.actual();
            } catch (err) {
                threw = true;
                caughtError = err;
            }

            if (!threw) {
                this._assert(false, 'function to throw an error, but it returned normally');
                return;
            }

            if (expectedPattern) {
                const message = caughtError ? String(caughtError.message || caughtError) : '';
                if (typeof expectedPattern === 'string') {
                    this._assert(message.includes(expectedPattern), `throw error containing message "${expectedPattern}", got "${message}"`);
                } else if (expectedPattern instanceof RegExp) {
                    this._assert(expectedPattern.test(message), `throw error matching pattern ${expectedPattern}, got "${message}"`);
                }
            } else {
                this._assert(true, 'threw error as expected');
            }
        }

        async toReject(expectedPattern = null) {
            let threw = false;
            let caughtError = null;

            try {
                if (typeof this.actual === 'function') {
                    await this.actual();
                } else if (this.actual && typeof this.actual.then === 'function') {
                    await this.actual;
                } else {
                    throw new Error('toReject() requires a Promise or an async function');
                }
            } catch (err) {
                threw = true;
                caughtError = err;
            }

            if (!threw) {
                this._assert(false, 'promise to reject, but it resolved successfully');
                return;
            }

            if (expectedPattern) {
                const message = caughtError ? String(caughtError.message || caughtError.name || caughtError) : '';
                if (typeof expectedPattern === 'string') {
                    this._assert(message.includes(expectedPattern), `reject with error containing "${expectedPattern}", got "${message}"`);
                } else if (expectedPattern instanceof RegExp) {
                    this._assert(expectedPattern.test(message), `reject with error matching ${expectedPattern}, got "${message}"`);
                }
            } else {
                this._assert(true, 'rejected as expected');
            }
        }
    }

    function expect(actual) {
        return new Expectation(actual);
    }

    /**
     * Test Suite Definition
     */
    class TestSuite {
        constructor(title, options = {}) {
            this.title = title;
            this.tier = options.tier || 1;
            this.feature = options.feature || null;
            this.tests = [];
            this.beforeAllFns = [];
            this.afterAllFns = [];
            this.beforeEachFns = [];
            this.afterEachFns = [];
        }

        addTest(test) {
            this.tests.push(test);
        }
    }

    /**
     * Individual Test Definition
     */
    class TestCase {
        constructor(title, fn, options = {}) {
            this.title = title;
            this.fn = fn;
            this.timeoutMs = options.timeoutMs || 10000;
            this.tier = options.tier || 1;
            this.feature = options.feature || null;
            this.suiteTitle = options.suiteTitle || '';
            this.status = 'pending'; // pending | passed | failed | skipped
            this.durationMs = 0;
            this.error = null;
            this.memoryReport = null;
        }

        async run(suite) {
            const start = performance.now();
            let timerId = null;

            // Timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                timerId = setTimeout(() => {
                    reject(new Error(`Test timed out after ${this.timeoutMs}ms: "${this.title}"`));
                }, this.timeoutMs);
            });

            try {
                // Execute test function
                const testPromise = Promise.resolve().then(() => this.fn());
                await Promise.race([testPromise, timeoutPromise]);
                this.status = 'passed';
            } catch (err) {
                this.status = 'failed';
                this.error = err;
            } finally {
                if (timerId) clearTimeout(timerId);
                this.durationMs = Math.round(performance.now() - start);
            }
        }
    }

    // Suite registration
    function describe(title, fnOrOptions, fnOrOptions2 = {}) {
        const fn = typeof fnOrOptions === 'function' ? fnOrOptions : fnOrOptions2;
        const options = typeof fnOrOptions === 'object' ? fnOrOptions : (typeof fnOrOptions2 === 'object' ? fnOrOptions2 : {});
        const suite = new TestSuite(title, options);
        suites.push(suite);
        const prevSuite = currentSuite;
        currentSuite = suite;
        try {
            if (typeof fn === 'function') fn();
        } finally {
            currentSuite = prevSuite;
        }
    }

    function it(title, fn, optionsOrTimeout = {}) {
        if (!currentSuite) {
            describe('Default Suite', () => it(title, fn, optionsOrTimeout));
            return;
        }

        let opts = {};
        if (typeof optionsOrTimeout === 'number') {
            opts.timeoutMs = optionsOrTimeout;
        } else if (typeof optionsOrTimeout === 'object') {
            opts = { ...optionsOrTimeout };
        }

        const test = new TestCase(title, fn, {
            ...opts,
            tier: opts.tier !== undefined ? opts.tier : currentSuite.tier,
            feature: opts.feature !== undefined ? opts.feature : currentSuite.feature,
            suiteTitle: currentSuite.title
        });

        currentSuite.addTest(test);
    }

    function beforeAll(fn) {
        if (currentSuite) currentSuite.beforeAllFns.push(fn);
        else globalBeforeAll.push(fn);
    }

    function afterAll(fn) {
        if (currentSuite) currentSuite.afterAllFns.push(fn);
        else globalAfterAll.push(fn);
    }

    function beforeEach(fn) {
        if (currentSuite) currentSuite.beforeEachFns.push(fn);
        else globalBeforeEach.push(fn);
    }

    function afterEach(fn) {
        if (currentSuite) currentSuite.afterEachFns.push(fn);
        else globalAfterEach.push(fn);
    }

    /**
     * Test Runner Engine
     */
    class TestRunner {
        constructor() {
            this.suites = suites;
            this.results = null;
            this.isRunning = false;
            this.shouldAbort = false;
            this.filterFn = null;
            this.listeners = {
                onStart: [],
                onTestStart: [],
                onTestEnd: [],
                onSuiteStart: [],
                onSuiteEnd: [],
                onFinish: []
            };
        }

        on(event, callback) {
            if (this.listeners[event]) this.listeners[event].push(callback);
            return this;
        }

        emit(event, data) {
            if (this.listeners[event]) {
                for (const fn of this.listeners[event]) {
                    try { fn(data); } catch (e) { console.error('Error in runner listener:', e); }
                }
            }
        }

        setFilter({ tier = null, feature = null, search = null } = {}) {
            this.filterFn = (test) => {
                if (tier !== null && test.tier !== tier) return false;
                if (feature !== null && test.feature !== feature) return false;
                if (search) {
                    const term = search.toLowerCase();
                    const titleMatch = test.title.toLowerCase().includes(term);
                    const suiteMatch = test.suiteTitle.toLowerCase().includes(term);
                    if (!titleMatch && !suiteMatch) return false;
                }
                return true;
            };
        }

        clearFilter() {
            this.filterFn = null;
        }

        abort() {
            this.shouldAbort = true;
        }

        async run() {
            if (this.isRunning) return this.results;
            this.isRunning = true;
            this.shouldAbort = false;

            const startTime = performance.now();
            let total = 0;
            let passed = 0;
            let failed = 0;
            let skipped = 0;
            const executedTests = [];

            // Memory Profiler initialization
            const hasProfiler = typeof global.MemoryProfiler !== 'undefined';
            const profiler = hasProfiler ? new global.MemoryProfiler({ targetLimitMB: 150, strictLimitMB: 200 }) : null;
            if (profiler) profiler.start();

            this.emit('onStart', { totalSuites: this.suites.length });

            try {
                // Global beforeAll
                for (const fn of globalBeforeAll) await fn();

                for (const suite of this.suites) {
                    if (this.shouldAbort) break;

                    const suiteFilteredTests = suite.tests.filter(t => !this.filterFn || this.filterFn(t));
                    if (suiteFilteredTests.length === 0) continue;

                    this.emit('onSuiteStart', { suite, testCount: suiteFilteredTests.length });

                    // Suite beforeAll
                    for (const fn of suite.beforeAllFns) await fn();

                    for (const test of suiteFilteredTests) {
                        if (this.shouldAbort) {
                            test.status = 'skipped';
                            skipped++;
                            total++;
                            continue;
                        }

                        total++;
                        this.emit('onTestStart', { test, suite });

                        // Run before hooks
                        for (const fn of globalBeforeEach) await fn();
                        for (const fn of suite.beforeEachFns) await fn();

                        // Run test
                        await test.run(suite);

                        // Run after hooks
                        for (const fn of suite.afterEachFns) await fn();
                        for (const fn of globalAfterEach) await fn();

                        if (test.status === 'passed') passed++;
                        else if (test.status === 'failed') failed++;
                        else skipped++;

                        executedTests.push({
                            title: test.title,
                            suiteTitle: test.suiteTitle,
                            tier: test.tier,
                            feature: test.feature,
                            status: test.status,
                            durationMs: test.durationMs,
                            error: test.error ? (test.error.message || String(test.error)) : null,
                            stack: test.error ? test.error.stack : null
                        });

                        this.emit('onTestEnd', { test, suite });
                    }

                    // Suite afterAll
                    for (const fn of suite.afterAllFns) await fn();
                    this.emit('onSuiteEnd', { suite });
                }

                // Global afterAll
                for (const fn of globalAfterAll) await fn();
            } finally {
                let memReport = null;
                if (profiler) {
                    memReport = profiler.stop();
                }

                const totalDuration = Math.round(performance.now() - startTime);

                this.results = {
                    timestamp: new Date().toISOString(),
                    total,
                    passed,
                    failed,
                    skipped,
                    durationMs: totalDuration,
                    peakMemoryMB: memReport ? memReport.peakMB : 0,
                    memoryReport: memReport,
                    tests: executedTests,
                    success: failed === 0
                };

                // Store globally for headless inspection
                global.__ZEV_TEST_RESULTS__ = this.results;

                this.isRunning = false;
                this.emit('onFinish', this.results);
            }

            return this.results;
        }
    }

    const runner = new TestRunner();

    // Export API
    const exportsObj = {
        describe,
        it,
        expect,
        beforeAll,
        afterAll,
        beforeEach,
        afterEach,
        runner,
        suites
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exportsObj;
    } else {
        Object.assign(global, exportsObj);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
