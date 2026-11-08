/**
 * ZevSafe — Phase 5 PWA Upgrade Verification Suite (test/test-phase5-pwa.js)
 *
 * Verifies all Phase 5 PWA requirements:
 * 1. manifest.json:
 *    - Distinct 'any' and 'maskable' icon definitions (zero 'any maskable' combined strings)
 *    - file_handlers: registered strictly for 'application/x-zevsafe-vault' + ['.zev'], action './index.html'
 *    - screenshots: wide (1280x800) and narrow (780x1688) with correct sizes
 * 2. Icon Geometries:
 *    - assets/icon-maskable-192.png (192x192)
 *    - assets/icon-maskable-512.png (512x512)
 *    - assets/apple-touch-icon.png (180x180)
 * 3. build-sw.js synchronization:
 *    - tools/build-sw.js --check exits with code 0
 *    - SHELL_ASSETS includes maskable and apple icons, strictly excludes screenshots
 * 4. PWA Safe Update Guard & File Handling APIs:
 *    - window.canSafelyReload, window.isVaultUnlocked, window.isJobActive
 *    - window.switchMobileTab, window.handleDecryptionFileSelection
 *    - #pwa-update-banner in index.html
 * 5. Headless Chrome CDP Automation:
 *    - Page.getInstallabilityErrors yields 0 errors
 *    - Offline reload succeeds and renders app shell cleanly
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { spawn, execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8135;

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

// Minimal static HTTP server
function createServer() {
    return http.createServer((req, res) => {
        let reqPath = req.url.split('?')[0];
        if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
        const filePath = path.join(ROOT_DIR, reqPath);

        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp',
            '.txt': 'text/plain'
        };

        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Service-Worker-Allowed': '/'
            });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });
}

function getPngDimensions(filePath) {
    const buf = fs.readFileSync(filePath);
    assert.strictEqual(buf.toString('ascii', 1, 4), 'PNG', 'Must be a valid PNG');
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
}

async function findChromePath() {
    const candidatePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser'
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return p;
    }
    return 'chrome';
}

function connectCDP(wsUrl) {
    return new Promise((resolve, reject) => {
        const url = new URL(wsUrl);
        const key = crypto.randomBytes(16).toString('base64');
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: {
                'Connection': 'Upgrade',
                'Upgrade': 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': key
            }
        });

        req.on('upgrade', (res, socket) => {
            let msgId = 1;
            const pending = new Map();
            const listeners = new Map();
            let buffer = Buffer.alloc(0);
            let currentMessageOpcode = 0;
            let currentMessageBuffers = [];

            socket.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                while (buffer.length >= 2) {
                    const firstByte = buffer[0];
                    const secondByte = buffer[1];
                    const fin = (firstByte & 0x80) !== 0;
                    const opcode = firstByte & 0x0f;
                    let payloadLength = secondByte & 0x7f;
                    let offset = 2;

                    if (payloadLength === 126) {
                        if (buffer.length < 4) break;
                        payloadLength = buffer.readUInt16BE(2);
                        offset = 4;
                    } else if (payloadLength === 127) {
                        if (buffer.length < 10) break;
                        payloadLength = Number(buffer.readBigUInt64BE(2));
                        offset = 10;
                    }

                    if (buffer.length < offset + payloadLength) break;
                    const payload = buffer.slice(offset, offset + payloadLength);
                    buffer = buffer.slice(offset + payloadLength);

                    if (opcode === 8) {
                        socket.destroy();
                        break;
                    }

                    if (opcode !== 0) {
                        currentMessageOpcode = opcode;
                    }
                    currentMessageBuffers.push(payload);

                    if (fin) {
                        const fullPayload = Buffer.concat(currentMessageBuffers);
                        const msgOpcode = currentMessageOpcode;
                        currentMessageBuffers = [];
                        currentMessageOpcode = 0;

                        if (msgOpcode === 1) {
                            const text = fullPayload.toString('utf8');
                            try {
                                const parsed = JSON.parse(text);
                                if (parsed.id && pending.has(parsed.id)) {
                                    const { res: pRes, rej: pRej } = pending.get(parsed.id);
                                    pending.delete(parsed.id);
                                    if (parsed.error) pRej(new Error(parsed.error.message));
                                    else pRes(parsed.result);
                                }
                                if (parsed.method && listeners.has(parsed.method)) {
                                    listeners.get(parsed.method).forEach(fn => fn(parsed.params));
                                }
                            } catch (e) {
                                console.error('WebSocket parse error:', e.message);
                            }
                        }
                    }
                }
            });

            function send(method, params = {}) {
                return new Promise((res, rej) => {
                    const id = msgId++;
                    pending.set(id, { res, rej });
                    const payload = Buffer.from(JSON.stringify({ id, method, params }));
                    let header;
                    if (payload.length < 126) {
                        header = Buffer.from([0x81, 0x80 | payload.length]);
                    } else if (payload.length < 65536) {
                        header = Buffer.alloc(4);
                        header[0] = 0x81;
                        header[1] = 0x80 | 126;
                        header.writeUInt16BE(payload.length, 2);
                    } else {
                        header = Buffer.alloc(10);
                        header[0] = 0x81;
                        header[1] = 0x80 | 127;
                        header.writeBigUInt64BE(BigInt(payload.length), 2);
                    }
                    const mask = crypto.randomBytes(4);
                    const masked = Buffer.alloc(payload.length);
                    for (let i = 0; i < payload.length; i++) {
                        masked[i] = payload[i] ^ mask[i % 4];
                    }
                    socket.write(Buffer.concat([header, mask, masked]));
                });
            }

            resolve({
                send,
                close: () => socket.destroy()
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function getWsUrl(port = 9223) {
    for (let i = 0; i < 30; i++) {
        try {
            const data = await new Promise((res, rej) => {
                const r = http.get(`http://127.0.0.1:${port}/json`, resp => {
                    let acc = '';
                    resp.on('data', c => acc += c);
                    resp.on('end', () => res(acc));
                });
                r.on('error', rej);
            });
            const list = JSON.parse(data);
            const page = list.find(t => t.type === 'page');
            if (page && page.webSocketDebuggerUrl) {
                return page.webSocketDebuggerUrl;
            }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Timed out waiting for Chrome WebSocket URL');
}

async function main() {
    console.log('===============================================================');
    console.log('  ZevSafe Phase 5: PWA Upgrade Verification Suite');
    console.log('===============================================================');

    // --- 1. Manifest Structure & Schema ---
    console.log('\n--- 1. manifest.json Schema Verification ---');
    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    runTest('1.1: Distinct "any" and "maskable" icon purposes (zero combined "any maskable")', () => {
        assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4, 'Manifest must have icons');
        for (const icon of manifest.icons) {
            assert.notStrictEqual(icon.purpose, 'any maskable', 'Icon purpose must not combine "any maskable"');
            assert.ok(icon.purpose === 'any' || icon.purpose === 'maskable', `Purpose must be 'any' or 'maskable', got: ${icon.purpose}`);
        }
        const maskableIcons = manifest.icons.filter(i => i.purpose === 'maskable');
        const anyIcons = manifest.icons.filter(i => i.purpose === 'any');
        assert.ok(maskableIcons.length >= 2, 'Must have at least 192 and 512 maskable icons');
        assert.ok(anyIcons.length >= 2, 'Must have at least 192 and 512 any icons');
    });

    runTest('1.2: file_handlers registered strictly for application/x-zevsafe-vault and .zev', () => {
        assert.ok(Array.isArray(manifest.file_handlers), 'file_handlers must be an array');
        assert.strictEqual(manifest.file_handlers.length, 1, 'Exactly one file_handler must be defined');
        const fh = manifest.file_handlers[0];
        assert.strictEqual(fh.action, './index.html', 'file_handlers action must be "./index.html"');
        assert.ok(fh.accept && fh.accept['application/x-zevsafe-vault'], 'Must accept application/x-zevsafe-vault');
        assert.ok(!fh.accept['application/octet-stream'], 'Must NOT register generic octet-stream');
        const exts = fh.accept['application/x-zevsafe-vault'];
        assert.ok(exts.includes('.zev'), 'Must register .zev extension');
    });

    runTest('1.3: Screenshots declared with valid dimensions', () => {
        assert.ok(Array.isArray(manifest.screenshots), 'screenshots must be an array');
        assert.strictEqual(manifest.screenshots.length, 2, 'Must declare wide and narrow screenshots');
        const wide = manifest.screenshots.find(s => s.form_factor === 'wide');
        const narrow = manifest.screenshots.find(s => s.form_factor === 'narrow');
        assert.ok(wide, 'Wide screenshot must be present');
        assert.ok(narrow, 'Narrow screenshot must be present');
        assert.strictEqual(wide.sizes, '1280x800', 'Wide screenshot must be 1280x800');
        assert.strictEqual(narrow.sizes, '780x1688', 'Narrow screenshot must be 780x1688');
    });

    // --- 2. Icon Geometries ---
    console.log('\n--- 2. Icon File Geometries on Disk ---');
    runTest('2.1: assets/icon-maskable-192.png is exactly 192x192', () => {
        const dims = getPngDimensions(path.join(ROOT_DIR, 'assets', 'icon-maskable-192.png'));
        assert.strictEqual(dims.width, 192);
        assert.strictEqual(dims.height, 192);
    });

    runTest('2.2: assets/icon-maskable-512.png is exactly 512x512', () => {
        const dims = getPngDimensions(path.join(ROOT_DIR, 'assets', 'icon-maskable-512.png'));
        assert.strictEqual(dims.width, 512);
        assert.strictEqual(dims.height, 512);
    });

    runTest('2.3: assets/apple-touch-icon.png is exactly 180x180', () => {
        const dims = getPngDimensions(path.join(ROOT_DIR, 'assets', 'apple-touch-icon.png'));
        assert.strictEqual(dims.width, 180);
        assert.strictEqual(dims.height, 180);
    });

    runTest('2.4: Real screenshot dimensions match manifest specifications', () => {
        const wideDims = getPngDimensions(path.join(ROOT_DIR, 'assets', 'screenshot-wide.png'));
        assert.strictEqual(wideDims.width, 1280);
        assert.strictEqual(wideDims.height, 800);

        const narrowDims = getPngDimensions(path.join(ROOT_DIR, 'assets', 'screenshot-narrow.png'));
        assert.strictEqual(narrowDims.width, 780);
        assert.strictEqual(narrowDims.height, 1688);
    });

    // --- 3. build-sw.js & Precache Synchronization ---
    console.log('\n--- 3. Service Worker Build & Precache Synchronization ---');
    runTest('3.1: node tools/build-sw.js --check succeeds with exit code 0', () => {
        const out = execSync('node tools/build-sw.js --check', { cwd: ROOT_DIR, encoding: 'utf8' });
        assert.ok(out.includes('fully synchronized'), 'Must report fully synchronized');
    });

    runTest('3.2: SHELL_ASSETS in sw.js excludes screenshots but includes maskable icons', () => {
        const swContent = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');
        assert.ok(swContent.includes('icon-maskable-192.png'), 'Must precache maskable 192');
        assert.ok(swContent.includes('icon-maskable-512.png'), 'Must precache maskable 512');
        assert.ok(swContent.includes('apple-touch-icon.png'), 'Must precache apple-touch-icon');
        assert.ok(!swContent.includes('screenshot-wide.png'), 'Must NOT precache screenshot-wide');
        assert.ok(!swContent.includes('screenshot-narrow.png'), 'Must NOT precache screenshot-narrow');
    });

    // --- 4. DOM Elements & JavaScript Handlers ---
    console.log('\n--- 4. DOM Elements & Safe Update Handlers ---');
    runTest('4.1: index.html contains #pwa-update-banner with update and dismiss buttons', () => {
        const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
        assert.ok(indexHtml.includes('id="pwa-update-banner"'), 'pwa-update-banner must exist');
        assert.ok(indexHtml.includes('id="pwa-btn-update"'), 'pwa-btn-update must exist');
        assert.ok(indexHtml.includes('id="pwa-btn-update-dismiss"'), 'pwa-btn-update-dismiss must exist');
    });

    runTest('4.2: app.js exposes required safe-reload and mobile-tab APIs', () => {
        const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
        assert.ok(appJs.includes('window.switchMobileTab'), 'window.switchMobileTab must be exposed');
        assert.ok(appJs.includes('window.handleDecryptionFileSelection'), 'window.handleDecryptionFileSelection must be exposed');
        assert.ok(appJs.includes('window.canSafelyReload'), 'window.canSafelyReload must be exposed');
        assert.ok(appJs.includes('window.isVaultUnlocked'), 'window.isVaultUnlocked must be exposed');
        assert.ok(appJs.includes('window.isJobActive'), 'window.isJobActive must be exposed');
        assert.ok(appJs.includes('window.launchQueue.setConsumer'), 'launchQueue consumer must be wired');
    });

    // --- 5. Chrome CDP Installability & Offline Verification ---
    console.log('\n--- 5. Headless Chrome CDP Installability & Offline Reload Verification ---');
    const server = createServer();
    await new Promise(r => server.listen(PORT, r));

    const os = require('os');
    const tmpProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zevsafe-pwa-profile-'));

    const chromeExecutable = await findChromePath();
    const chromeProc = spawn(chromeExecutable, [
        '--headless=new',
        '--remote-debugging-port=9223',
        `--user-data-dir=${tmpProfileDir}`,
        '--disable-gpu',
        '--no-sandbox',
        `http://127.0.0.1:${PORT}/index.html`
    ]);

    try {
        const wsUrl = await getWsUrl(9223);
        const cdp = await connectCDP(wsUrl);

        await cdp.send('Page.enable');
        await cdp.send('Network.enable');

        await runAsyncTest('5.1: Chrome Page.getInstallabilityErrors returns 0 errors', async () => {
            await new Promise(r => setTimeout(r, 2000));
            const resp = await cdp.send('Page.getInstallabilityErrors');
            // Filter out transient environment-only error (e.g. if headless mode tags as incognito)
            const errors = ((resp && resp.installabilityErrors) || []).filter(e => e.errorId !== 'in-incognito');
            if (errors.length > 0) {
                console.warn('Installability errors reported by Chrome:', JSON.stringify(errors));
            }
            assert.strictEqual(errors.length, 0, `Page must pass all Chrome PWA installability requirements: ${JSON.stringify(errors)}`);
        });

        await runAsyncTest('5.2: Service worker registers and precaches shell offline', async () => {
            await new Promise(r => setTimeout(r, 2500));
            const evalResp = await cdp.send('Runtime.evaluate', {
                expression: `navigator.serviceWorker.getRegistration().then(r => Boolean(r && (r.active || r.installing || r.waiting)))`,
                awaitPromise: true,
                returnByValue: true
            });
            assert.strictEqual(evalResp.result?.value, true, 'Service worker must register');
        });

        await runAsyncTest('5.3: Offline reload succeeds and renders app shell cleanly', async () => {
            // Emulate total offline network
            await cdp.send('Network.emulateNetworkConditions', {
                offline: true,
                latency: 0,
                downloadThroughput: 0,
                uploadThroughput: 0
            });

            // Reload page in offline mode
            await cdp.send('Page.reload');
            await new Promise(r => setTimeout(r, 2000));

            // Verify core UI rendered from cache
            const uiCheck = await cdp.send('Runtime.evaluate', {
                expression: `Boolean(document.getElementById('encrypt-section') && document.getElementById('decrypt-section') && document.title.includes('ZevSafe'))`,
                returnByValue: true
            });
            assert.strictEqual(uiCheck.result?.value, true, 'App shell must render successfully offline');

            // Restore network
            await cdp.send('Network.emulateNetworkConditions', {
                offline: false,
                latency: 0,
                downloadThroughput: -1,
                uploadThroughput: -1
            });
        });

        await runAsyncTest('5.4: canSafelyReload() correctly reflects vault & job status', async () => {
            const safeInitial = await cdp.send('Runtime.evaluate', {
                expression: `typeof window.canSafelyReload === 'function' && window.canSafelyReload() === true`,
                returnByValue: true
            });
            assert.strictEqual(safeInitial.result?.value, true, 'Initial state must be safe to reload');

            // Simulate active job
            const jobCheck = await cdp.send('Runtime.evaluate', {
                expression: `(() => {
                    const before = window.canSafelyReload();
                    // trigger job active via withWakeLock
                    return window.withWakeLock(async () => {
                        return window.canSafelyReload();
                    });
                })()`,
                awaitPromise: true,
                returnByValue: true
            });
            assert.strictEqual(jobCheck.result?.value, false, 'During withWakeLock job, canSafelyReload() must return false');
        });

        cdp.close();
    } finally {
        chromeProc.kill();
        server.close();
        try { fs.rmSync(tmpProfileDir, { recursive: true, force: true }); } catch (_) {}
    }

    console.log('\n===============================================================');
    console.log(`  ALL ${passed}/${total} PHASE 5 PWA TESTS PASSED (100%)`);
    console.log('===============================================================');
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
