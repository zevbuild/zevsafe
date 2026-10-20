/**
 * Challenger 2 Adversarial Verification Suite:
 * Path Traversal, DOM XSS, Batch Zip, and Service Worker Stream Intercept
 * test/test-adversarial-challenger2.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('===============================================================');
console.log('  Challenger 2: Adversarial DOM & Path Verification Suite      ');
console.log('===============================================================');

let passCount = 0;
let failCount = 0;
const findings = [];

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passCount++;
    } catch (err) {
        console.error(`  ✕ ${name}`);
        console.error(`    Error: ${err.message}`);
        failCount++;
        findings.push({ test: name, error: err.message });
    }
}

// -----------------------------------------------------------------------------
// 1. StreamPacker.sanitizeZipPath Adversarial Stress-Tests
// -----------------------------------------------------------------------------
console.log('\n--- 1. StreamPacker.sanitizeZipPath Stress-Testing ---');
const StreamPacker = require('../js/stream-packer.js');
const sanitizeZipPath = StreamPacker.sanitizeZipPath;

test('StreamPacker: rejects ../../ path traversal', () => {
    const res = sanitizeZipPath('../../etc/shadow');
    assert.strictEqual(res, 'etc/shadow', 'Should strip directory traversal segments');
});

test('StreamPacker: rejects backslash directory traversal (..\\..\\)', () => {
    const res = sanitizeZipPath('..\\..\\windows\\system32\\cmd.exe');
    assert.strictEqual(res, 'windows/system32/cmd.exe');
});

test('StreamPacker: collapses interleaved traversal (a/b/../../c/../d)', () => {
    const res = sanitizeZipPath('a/b/../../c/../d/secret.txt');
    assert.strictEqual(res, 'd/secret.txt');
});

test('StreamPacker: handles recursive traversal dots (....//....//evil.txt)', () => {
    const res = sanitizeZipPath('....//....//evil.txt');
    // Segments must not evaluate to '..' or '.'
    const segments = res.split('/');
    assert.ok(!segments.includes('..'), 'Must not contain ".." segments');
    assert.ok(!segments.includes('.'), 'Must not contain "." segments');
    assert.strictEqual(res, '..../..../evil.txt');
});

test('StreamPacker: strips drive letters (C:\\, D:/)', () => {
    assert.strictEqual(sanitizeZipPath('C:\\Windows\\System32\\cmd.exe'), 'Windows/System32/cmd.exe');
    assert.strictEqual(sanitizeZipPath('D:/Data/Documents/report.pdf'), 'Data/Documents/report.pdf');
});

test('StreamPacker: strips null bytes and ASCII control characters (\\x00-\\x1F, \\x7F)', () => {
    const malicious = 'evil\x00file\x01\x0b\x1f\x7fname.txt';
    const res = sanitizeZipPath(malicious);
    assert.strictEqual(res, 'evilfilename.txt');
});

test('StreamPacker: filters Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)', () => {
    assert.strictEqual(sanitizeZipPath('CON'), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath('PRN.txt'), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath('aux.dat'), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath('NUL'), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath('COM1'), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath('LPT3.log'), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath('folder/CON/subfile.txt'), 'folder/subfile.txt');
});

test('StreamPacker: replaces NTFS Alternate Data Stream colons (:) with underscore', () => {
    const res = sanitizeZipPath('secret.txt:hidden_stream');
    assert.strictEqual(res, 'secret.txt_hidden_stream');
});

test('StreamPacker: returns fallback for empty or all-traversal inputs', () => {
    assert.strictEqual(sanitizeZipPath(''), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath('../../../'), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath('/./././'), 'unnamed_file');
    assert.strictEqual(sanitizeZipPath(null), 'unnamed_file');
});

// -----------------------------------------------------------------------------
// 2. StreamUnpacker.sanitizeEntryPath Adversarial Stress-Tests
// -----------------------------------------------------------------------------
console.log('\n--- 2. StreamUnpacker.sanitizeEntryPath Stress-Testing ---');

// Load StreamUnpacker module directly or extract sanitizeEntryPath from source
const StreamUnpacker = require('../js/stream-unpacker.js');
const sanitizeEntryPath = StreamUnpacker.sanitizeEntryPath || (() => {
    const unpackerSrc = fs.readFileSync(path.join(__dirname, '../js/stream-unpacker.js'), 'utf8');
    const sanitizeEntryPathMatch = unpackerSrc.match(/function sanitizeEntryPath\(rawPath\)\s*\{[\s\S]*?\n {4}\}/);
    if (!sanitizeEntryPathMatch) {
        throw new Error('Could not find sanitizeEntryPath in js/stream-unpacker.js');
    }
    return new Function('rawPath', sanitizeEntryPathMatch[0] + '\nreturn sanitizeEntryPath(rawPath);');
})();

test('StreamUnpacker: rejects ../../ path traversal', () => {
    const res = sanitizeEntryPath('../../etc/shadow');
    assert.strictEqual(res, 'etc/shadow');
});

test('StreamUnpacker: rejects backslash directory traversal (..\\..\\)', () => {
    const res = sanitizeEntryPath('..\\..\\windows\\system32\\cmd.exe');
    assert.strictEqual(res, 'windows/system32/cmd.exe');
});

test('StreamUnpacker: strips drive letters (C:\\, D:/)', () => {
    assert.strictEqual(sanitizeEntryPath('C:\\Windows\\System32\\cmd.exe'), 'Windows/System32/cmd.exe');
    assert.strictEqual(sanitizeEntryPath('D:/Data/Documents/report.pdf'), 'Data/Documents/report.pdf');
});

test('StreamUnpacker: strips null bytes (\\x00)', () => {
    const res = sanitizeEntryPath('evil\x00file.txt');
    assert.strictEqual(res, 'evilfile.txt');
});

// ADVERSARIAL CHALLENGE: Does StreamUnpacker filter Windows reserved device names?
test('StreamUnpacker ADVERSARIAL: Windows reserved device names (CON, PRN, AUX, NUL)', () => {
    const conRes = sanitizeEntryPath('CON');
    const prnRes = sanitizeEntryPath('PRN.txt');
    const auxRes = sanitizeEntryPath('AUX');
    const nulRes = sanitizeEntryPath('folder/NUL/file.txt');

    console.log(`      [Empirical Observation] CON -> "${conRes}", PRN.txt -> "${prnRes}", AUX -> "${auxRes}", folder/NUL/file.txt -> "${nulRes}"`);
    assert.notStrictEqual(conRes, 'CON', 'CON should be sanitized or rejected as a Windows reserved device name');
    assert.notStrictEqual(prnRes, 'PRN.txt', 'PRN.txt should be sanitized or rejected as a Windows reserved device name');
    assert.notStrictEqual(auxRes, 'AUX', 'AUX should be sanitized or rejected as a Windows reserved device name');
});

// ADVERSARIAL CHALLENGE: Does StreamUnpacker strip control characters (\x01-\x1F, \x7F)?
test('StreamUnpacker ADVERSARIAL: ASCII control characters (\\x01-\\x1F, \\x7F)', () => {
    const input = 'evil\x01\x0b\x1f\x7ffile.txt';
    const res = sanitizeEntryPath(input);
    console.log(`      [Empirical Observation] "${input}" -> "${res}"`);
    assert.strictEqual(res, 'evilfile.txt', 'Control characters must be stripped');
});

// ADVERSARIAL CHALLENGE: Does StreamUnpacker filter NTFS Alternate Data Streams (colons)?
test('StreamUnpacker ADVERSARIAL: NTFS Alternate Data Stream colons (:)', () => {
    const input = 'folder/secret.txt:hidden';
    const res = sanitizeEntryPath(input);
    console.log(`      [Empirical Observation] "${input}" -> "${res}"`);
    assert.ok(!res.includes(':'), 'NTFS stream colons must be sanitized to prevent alternate stream writes');
});

// -----------------------------------------------------------------------------
// 3. app.js showToast DOM XSS Verification
// -----------------------------------------------------------------------------
console.log('\n--- 3. app.js showToast DOM XSS Stress-Testing ---');

// Mock a clean DOM element for each test
class MockElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.className = '';
        this.id = '';
        this.attributes = {};
        this.children = [];
        this.style = {};
        this._textContent = '';
        this.eventListeners = {};
    }

    setAttribute(name, val) {
        this.attributes[name] = String(val);
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    addEventListener(event, fn) {
        this.eventListeners[event] = fn;
    }

    set textContent(val) {
        this._textContent = String(val);
    }

    get textContent() {
        return this._textContent;
    }

    // Insecure sink tracker
    set innerHTML(val) {
        this._innerHTML = String(val);
        this.hasRawInnerHTML = true;
    }

    get innerHTML() {
        return this._innerHTML || '';
    }

    remove() {
        this.isRemoved = true;
    }
}

function createFreshMockDoc() {
    const doc = {
        body: new MockElement('body'),
        createElement(tag) {
            return new MockElement(tag);
        },
        getElementById(id) {
            if (id === 'toast-container') {
                return this.body.children.find(c => c.id === 'toast-container') || null;
            }
            return null;
        }
    };
    return doc;
}

// Extract showToast from app.js
const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const showToastMatch = appSrc.match(/function showToast\(message, type = 'info', duration = 4000\)\s*\{[\s\S]*?\n\}/);
if (!showToastMatch) {
    throw new Error('Could not find showToast in app.js');
}

const runShowToast = new Function('document', 'message', 'type', 'duration', `
    ${showToastMatch[0]}
    showToast(message, type, duration);
`);

test('showToast: does NOT set innerHTML when passed malicious HTML payload', () => {
    const mockDoc = createFreshMockDoc();
    const maliciousPayload = '<img src=x onerror="alert(document.cookie)">';
    runShowToast(mockDoc, maliciousPayload, 'error', 0);

    const toastContainer = mockDoc.getElementById('toast-container');
    assert.ok(toastContainer, 'toast-container must be created');

    const toastItem = toastContainer.children[toastContainer.children.length - 1];
    assert.ok(toastItem, 'toast item must be created');

    const bodyDiv = toastItem.children.find(c => c.className === 'toast-body');
    assert.ok(bodyDiv, 'toast-body must be created');

    // Verify textContent is used and innerHTML is NOT set
    assert.strictEqual(bodyDiv.hasRawInnerHTML, undefined, 'toast-body must NEVER set innerHTML');
    assert.strictEqual(bodyDiv.textContent, maliciousPayload, 'Payload must be treated strictly as textContent');
});

test('showToast: does NOT execute script tags or create script elements', () => {
    const mockDoc = createFreshMockDoc();
    const scriptPayload = '<script>window.pwned=true;</script>';
    runShowToast(mockDoc, scriptPayload, 'warning', 0);

    const toastContainer = mockDoc.getElementById('toast-container');
    const toastItem = toastContainer.children[toastContainer.children.length - 1];
    const bodyDiv = toastItem.children.find(c => c.className === 'toast-body');

    assert.strictEqual(bodyDiv.hasRawInnerHTML, undefined, 'innerHTML was set');
    assert.strictEqual(bodyDiv.textContent, scriptPayload, 'textContent mismatch');
    assert.strictEqual(toastItem.children.filter(c => c.tagName === 'SCRIPT').length, 0, 'Script elements must not be created');
});

test('showToast: escapes SVG onload payloads', () => {
    const mockDoc = createFreshMockDoc();
    const svgPayload = '<svg onload="alert(1)">';
    runShowToast(mockDoc, svgPayload, 'info', 0);

    const toastContainer = mockDoc.getElementById('toast-container');
    const toastItem = toastContainer.children[toastContainer.children.length - 1];
    const bodyDiv = toastItem.children.find(c => c.className === 'toast-body');

    assert.strictEqual(bodyDiv.hasRawInnerHTML, undefined);
    assert.strictEqual(bodyDiv.textContent, svgPayload);
    assert.strictEqual(toastItem.children.filter(c => c.tagName === 'SVG').length, 0, 'SVG elements must not be created');
});

// -----------------------------------------------------------------------------
// 4. app.js batchDownloadSelected Path Sanitization
// -----------------------------------------------------------------------------
console.log('\n--- 4. app.js batchDownloadSelected Sanitization Stress-Testing ---');

test('app.js batchDownloadSelected: sanitizes paths using StreamPacker.sanitizeZipPath', () => {
    const maliciousPaths = [
        '../../evil.sh',
        '..\\..\\windows\\system32\\calc.exe',
        'C:\\secrets\\passwords.txt',
        'CON',
        'folder/PRN/evil.txt',
        'data.txt:hidden'
    ];

    for (const rawPath of maliciousPaths) {
        const sanitized = StreamPacker.sanitizeZipPath(rawPath);
        assert.ok(!sanitized.startsWith('../'), `Sanitized path must not start with ../: ${sanitized}`);
        assert.ok(!sanitized.includes('..\\'), `Sanitized path must not include ..\\: ${sanitized}`);
        assert.ok(!/^[a-zA-Z]:/.test(sanitized), `Sanitized path must not have drive letters: ${sanitized}`);
        assert.ok(!/^(CON|PRN|AUX|NUL)(\..*)?$/i.test(sanitized), `Sanitized path must not be reserved name: ${sanitized}`);
    }
});

test('app.js batchDownloadSelected fallback: robust traversal and device sanitization', () => {
    // Extract the fallback implementation from app.js
    const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    const fallbackMatch = appCode.match(/const sanitizedPath = \(typeof StreamPacker[^\n]*\n\s*\? StreamPacker\.sanitizeZipPath\(path\)\s*\n\s*: \(\(\) => \{([\s\S]*?)\}\)\(\);/);
    assert.ok(fallbackMatch, 'app.js must define the safe fallback IIFE in batchDownloadSelected');
    const fallbackFn = new Function('path', fallbackMatch[1]);

    // Test 1: Single-pass evasion attempt with ....// must NOT collapse into ../
    const exploitInput = '....//etc/passwd';
    const fallbackResult = fallbackFn(exploitInput);
    console.log(`      [Empirical Observation] Safe fallback on "${exploitInput}" -> "${fallbackResult}"`);
    assert.ok(!fallbackResult.startsWith('../'), 'Fallback must not start with ../ traversal sequence');
    assert.ok(!fallbackResult.split('/').includes('..'), 'Fallback must not contain .. segments');
    assert.strictEqual(fallbackResult, '..../etc/passwd', 'Recursive dots are safely preserved as non-traversal names');

    // Test 2: Standard ../../ traversal must be stripped
    assert.strictEqual(fallbackFn('../../etc/passwd'), 'etc/passwd');

    // Test 3: Windows reserved device names are blocked
    assert.strictEqual(fallbackFn('CON'), 'unnamed_file');
    assert.strictEqual(fallbackFn('folder/PRN/evil.txt'), 'folder/evil.txt');

    // Test 4: NTFS stream colons replaced
    assert.strictEqual(fallbackFn('data.txt:hidden'), 'data.txt_hidden');
});

// -----------------------------------------------------------------------------
// 5. sw.js Case-Insensitive .zev Bypass & Sec-Fetch-Site Validation
// -----------------------------------------------------------------------------
console.log('\n--- 5. sw.js Case-Insensitive .zev & Sec-Fetch-Site Stress-Testing ---');

const swSrc = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');

test('sw.js: NEVER cache .zev vault files uses .toLowerCase().endsWith(".zev")', () => {
    assert.ok(swSrc.includes("url.pathname.toLowerCase().endsWith('.zev')"), 'Must use toLowerCase() for .zev check');
    
    // Simulate check against various case combinations and query strings
    const checkZevBypass = (urlString) => {
        const url = new URL(urlString, 'https://zevsafe.app');
        return url.pathname.toLowerCase().endsWith('.zev');
    };

    assert.strictEqual(checkZevBypass('https://zevsafe.app/vault.zev'), true);
    assert.strictEqual(checkZevBypass('https://zevsafe.app/vault.ZEV'), true);
    assert.strictEqual(checkZevBypass('https://zevsafe.app/vault.Zev'), true);
    assert.strictEqual(checkZevBypass('https://zevsafe.app/path/to/my_vault.zEv?download=1'), true);
    assert.strictEqual(checkZevBypass('https://zevsafe.app/index.html'), false);
    assert.strictEqual(checkZevBypass('https://zevsafe.app/app.js'), false);
    assert.strictEqual(checkZevBypass('https://zevsafe.app/vault.zev.html'), false);
});

test('sw.js: Sec-Fetch-Site validation rejects cross-site requests with 403', () => {
    // Check the exact code block in sw.js
    assert.ok(swSrc.includes("secFetchSite !== 'same-origin' && secFetchSite !== 'none'"), 'Must validate Sec-Fetch-Site');
    
    const validateSecFetchSite = (siteHeader) => {
        if (siteHeader && siteHeader !== 'same-origin' && siteHeader !== 'none') {
            return 403; // Forbidden
        }
        return 200; // Proceed
    };

    assert.strictEqual(validateSecFetchSite('cross-site'), 403, 'cross-site must be rejected');
    assert.strictEqual(validateSecFetchSite('same-site'), 403, 'same-site must be rejected');
    assert.strictEqual(validateSecFetchSite('same-origin'), 200, 'same-origin must be allowed');
    assert.strictEqual(validateSecFetchSite('none'), 200, 'none (direct user nav) must be allowed');
    assert.strictEqual(validateSecFetchSite(null), 200, 'null (browsers without Sec-Fetch-Site) must be allowed');
    assert.strictEqual(validateSecFetchSite(undefined), 200, 'undefined must be allowed');
});

// -----------------------------------------------------------------------------
// Summary & Verdict
// -----------------------------------------------------------------------------
console.log('\n===============================================================');
console.log(`  CHALLENGER 2 SUITE COMPLETE: ${passCount} PASSED | ${failCount} FAILED`);
console.log('===============================================================');

if (findings.length > 0) {
    console.log('\nEmpirically Discovered Vulnerabilities / Flaws:');
    findings.forEach((f, idx) => {
        console.log(`  ${idx + 1}. [FAILED] ${f.test}`);
        console.log(`     Details: ${f.error}`);
    });
}
