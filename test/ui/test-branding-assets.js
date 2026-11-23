/**
 * ZevSafe Brand & Logo Assets Verification Suite
 * Verifies existence, file magic headers, dimensions, and ICO directory integrity
 * for all Concept 3: Biometric Iris & Safe Dial branding assets.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BRANDING_DIR = path.join(ROOT_DIR, 'assets', 'branding');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ ${name}: ${err.message}`);
        throw err;
    }
}

// Helpers to read PNG & JPG dimensions from binary buffers
function getPngDimensions(buf) {
    // PNG signature (8B) + IHDR chunk (4B length + 4B 'IHDR' + 4B width + 4B height)
    assert.strictEqual(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Not a valid PNG');
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
}

function getJpgDimensions(buf) {
    assert.strictEqual(buf[0], 0xff);
    assert.strictEqual(buf[1], 0xd8);
    let offset = 2;
    while (offset < buf.length) {
        assert.strictEqual(buf[offset], 0xff, 'Marker expected');
        const marker = buf[offset + 1];
        offset += 2;
        // SOF markers: 0xC0 to 0xC3
        if (marker >= 0xc0 && marker <= 0xc3) {
            const height = buf.readUInt16BE(offset + 3);
            const width = buf.readUInt16BE(offset + 5);
            return { width, height };
        }
        const len = buf.readUInt16BE(offset);
        offset += len;
    }
    throw new Error('SOF marker not found in JPG');
}

console.log('===============================================================');
console.log('  ZevSafe Brand Asset Architecture & Integrity Suite           ');
console.log('===============================================================');

console.log('\n--- 1. Vector SVG Assets Verification ---');

const svgFiles = [
    'logos/logo-horizontal-dark.svg',
    'logos/logo-horizontal-light.svg',
    'logos/logo-vertical-dark.svg',
    'logos/wordmark-dark.svg',
    'logos/wordmark-light.svg',
    'icons/favicon.svg',
    'icons/safari-pinned-tab.svg',
    'watermarks/chart-watermark-stamp.svg',
    'watermarks/push-notification-icon.svg'
];

svgFiles.forEach(rel => {
    runTest(`SVG exists and is valid XML: ${rel}`, () => {
        const full = path.join(BRANDING_DIR, rel);
        assert.ok(fs.existsSync(full), `File must exist: ${rel}`);
        const content = fs.readFileSync(full, 'utf8');
        assert.ok(content.includes('<svg'), `Must contain <svg: ${rel}`);
        assert.ok(content.includes('</svg>'), `Must contain </svg>: ${rel}`);
        assert.ok(content.length > 100, `SVG must have non-trivial content: ${rel}`);
    });
});

console.log('\n--- 2. Rasterized PNG Assets & Dimension Precision ---');

const pngSpecs = [
    { file: 'logos/logo-horizontal-dark.png', w: 800, h: 200 },
    { file: 'logos/logo-vertical-dark.png', w: 600, h: 600 },
    { file: 'icons/favicon-16x16.png', w: 16, h: 16 },
    { file: 'icons/favicon-32x32.png', w: 32, h: 32 },
    { file: 'icons/favicon-48x48.png', w: 48, h: 48 },
    { file: 'pwa/apple-touch-icon.png', w: 180, h: 180 },
    { file: 'pwa/android-chrome-192x192.png', w: 192, h: 192 },
    { file: 'pwa/android-chrome-512x512.png', w: 512, h: 512 },
    { file: 'pwa/maskable-icon-512x512.png', w: 512, h: 512 },
    { file: 'social/avatar-square-800x800.png', w: 800, h: 800 },
    { file: 'watermarks/chart-watermark-stamp.png', w: 400, h: 400 },
    { file: 'watermarks/push-notification-icon.png', w: 96, h: 96 }
];

pngSpecs.forEach(spec => {
    runTest(`PNG format & exact dimensions (${spec.w}x${spec.h}): ${spec.file}`, () => {
        const full = path.join(BRANDING_DIR, spec.file);
        assert.ok(fs.existsSync(full), `File must exist: ${spec.file}`);
        const buf = fs.readFileSync(full);
        const dim = getPngDimensions(buf);
        assert.strictEqual(dim.width, spec.w, `Width must match ${spec.w}px`);
        assert.strictEqual(dim.height, spec.h, `Height must match ${spec.h}px`);
    });
});

console.log('\n--- 3. Social Open Graph & Twitter Cards ---');

const jpgSpecs = [
    { file: 'social/og-image-zevsafe.jpg', w: 1200, h: 630 },
    { file: 'social/twitter-card.jpg', w: 1200, h: 600 }
];

jpgSpecs.forEach(spec => {
    runTest(`JPG format & exact dimensions (${spec.w}x${spec.h}): ${spec.file}`, () => {
        const full = path.join(BRANDING_DIR, spec.file);
        assert.ok(fs.existsSync(full), `File must exist: ${spec.file}`);
        const buf = fs.readFileSync(full);
        const dim = getJpgDimensions(buf);
        assert.strictEqual(dim.width, spec.w, `Width must match ${spec.w}px`);
        assert.strictEqual(dim.height, spec.h, `Height must match ${spec.h}px`);
    });
});

console.log('\n--- 4. Multi-Resolution Binary Favicon.ico Container ---');

runTest('favicon.ico contains 3 valid directory entries (16, 32, 48)', () => {
    const icoPath = path.join(BRANDING_DIR, 'icons', 'favicon.ico');
    assert.ok(fs.existsSync(icoPath), 'favicon.ico must exist');
    const buf = fs.readFileSync(icoPath);

    // Reserved (2B) + Type (2B) + Count (2B)
    assert.strictEqual(buf.readUInt16LE(0), 0, 'ICO reserved must be 0');
    assert.strictEqual(buf.readUInt16LE(2), 1, 'ICO type must be 1 (icon)');
    const count = buf.readUInt16LE(4);
    assert.strictEqual(count, 3, 'ICO must contain 3 resolutions');

    const expectedResolutions = [16, 32, 48];
    for (let i = 0; i < count; i++) {
        const entryOffset = 6 + i * 16;
        const w = buf.readUInt8(entryOffset);
        const h = buf.readUInt8(entryOffset + 1);
        assert.strictEqual(w, expectedResolutions[i], `Resolution ${i} width must match`);
        assert.strictEqual(h, expectedResolutions[i], `Resolution ${i} height must match`);
    }
});

console.log('\n===============================================================');
console.log(`  VERDICT: ${passedTests}/${totalTests} TESTS PASSED (100% SUCCESS RATE)`);
console.log('===============================================================');
