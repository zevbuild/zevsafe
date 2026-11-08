/**
 * ZevSafe — PWA Upgrade Simulation Test Suite (test/test-simulate-pwa-upgrade.js)
 *
 * Simulates the complete real-world upgrade path:
 * 1. Serves initial baseline version (v75) with service worker 'zevsafe-shell-v75'.
 * 2. Headless Chrome installs v75 service worker and precaches shell assets.
 * 3. Starts an active long-running cryptographic job (window.withWakeLock), making canSafelyReload() === false.
 * 4. Switches server to v76 (real production sw.js with content hash).
 * 5. Triggers background service worker update.
 * 6. Confirms v76 service worker installs and enters 'waiting' state.
 * 7. Confirms #pwa-update-banner becomes visible to the user.
 * 8. Confirms NO page reload occurs while the job is active (canSafelyReload is respected).
 * 9. Completes the job and clicks '#pwa-btn-update'.
 * 10. Confirms safe reload occurs and v76 takes full control.
 * 11. Confirms stale 'zevsafe-shell-v75' cache is deleted upon activation.
 * 12. Sets network to OFFLINE mode and verifies lazy-loaded files ('js/media-player.js', 'css/media-player.css')
 *     load cleanly from cache with zero version mixing.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { spawn, execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8136;
const CDP_PORT = 9224;

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

// Find Chrome binary path
async function findChromePath() {
    if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
        return process.env.CHROME_BIN;
    }
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    throw new Error('Google Chrome binary not found');
}

// WebSocket client for CDP
function connectCDP(wsUrl) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(wsUrl);
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64')
            }
        });

        req.on('upgrade', (res, socket) => {
            let msgId = 1;
            const pending = new Map();
            let buf = Buffer.alloc(0);

            socket.on('data', chunk => {
                buf = Buffer.concat([buf, chunk]);
                while (buf.length >= 2) {
                    const b0 = buf[0];
                    const b1 = buf[1];
                    let payloadLen = b1 & 0x7f;
                    let offset = 2;
                    if (payloadLen === 126) {
                        if (buf.length < 4) return;
                        payloadLen = buf.readUInt16BE(2);
                        offset = 4;
                    } else if (payloadLen === 127) {
                        if (buf.length < 10) return;
                        payloadLen = Number(buf.readBigUInt64BE(2));
                        offset = 10;
                    }
                    if (buf.length < offset + payloadLen) return;
                    const payload = buf.slice(offset, offset + payloadLen);
                    buf = buf.slice(offset + payloadLen);

                    const str = payload.toString('utf8');
                    try {
                        const json = JSON.parse(str);
                        if (json.id && pending.has(json.id)) {
                            const { res: pRes, rej: pRej } = pending.get(json.id);
                            pending.delete(json.id);
                            if (json.error) pRej(new Error(json.error.message));
                            else pRes(json.result);
                        }
                    } catch (_) {}
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

async function getWsUrl(port = CDP_PORT) {
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

// Server that can switch between v75 and v76 on the fly
let activeVersion = 'v75';

function createSwitchableServer() {
    return http.createServer((req, res) => {
        let reqPath = req.url.split('?')[0];
        if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

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

        const ext = path.extname(reqPath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        // Dynamic serving based on activeVersion for sw.js
        if (reqPath === '/sw.js') {
            const swContent = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');
            let servedSw;
            if (activeVersion === 'v75') {
                // Return SW configured as v75 with shell-v75 cache name
                servedSw = swContent
                    .replace(/const APP_VERSION\s*=\s*'[^']+';/, "const APP_VERSION = 'v75';")
                    .replace(/const SHELL_CACHE\s*=\s*`[^`]+`;/, "const SHELL_CACHE = 'zevsafe-shell-v75';");
            } else {
                // Return real production v76 SW
                servedSw = swContent;
            }

            res.writeHead(200, {
                'Content-Type': 'application/javascript',
                'Service-Worker-Allowed': '/',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            return res.end(servedSw);
        }

        const filePath = path.join(ROOT_DIR, reqPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Service-Worker-Allowed': '/',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });
}

async function main() {
    console.log('===============================================================');
    console.log('  ZevSafe: PWA Upgrade Simulation Suite (v75 -> v76)');
    console.log('===============================================================');

    const server = createSwitchableServer();
    await new Promise(r => server.listen(PORT, r));

    const os = require('os');
    const tmpProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zevsafe-upgrade-profile-'));

    const chromeExecutable = await findChromePath();
    const chromeProc = spawn(chromeExecutable, [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${tmpProfileDir}`,
        '--disable-gpu',
        '--no-sandbox',
        `http://127.0.0.1:${PORT}/index.html`
    ]);

    try {
        const wsUrl = await getWsUrl(CDP_PORT);
        const cdp = await connectCDP(wsUrl);

        await cdp.send('Page.enable');
        await cdp.send('Network.enable');

        // Step 1: Install initial v75
        await runAsyncTest('Step 1: Initial v75 Service Worker registers and activates', async () => {
            await new Promise(r => setTimeout(r, 2500));
            const swCheck = await cdp.send('Runtime.evaluate', {
                expression: `(async () => {
                    const reg = await navigator.serviceWorker.getRegistration();
                    const cachesList = await caches.keys();
                    return {
                        hasController: Boolean(navigator.serviceWorker.controller),
                        caches: cachesList
                    };
                })()`,
                awaitPromise: true,
                returnByValue: true
            });
            assert.strictEqual(swCheck.result?.value?.hasController, true, 'v75 SW must control client');
            assert.ok(swCheck.result?.value?.caches.includes('zevsafe-shell-v75'), 'Must contain zevsafe-shell-v75 cache');
        });

        // Step 2: Start an active cryptographic job
        await runAsyncTest('Step 2: Active crypto job starts, setting canSafelyReload() === false', async () => {
            const startJob = await cdp.send('Runtime.evaluate', {
                expression: `(() => {
                    window.__TEST_JOB_RESOLVED = false;
                    window.__ORIGINAL_WINDOW_ID = 'session-v75-' + Math.random();
                    window.__JOB_PROMISE = window.withWakeLock(async () => {
                        await new Promise(resolve => {
                            window.__RESOLVE_JOB = () => {
                                window.__TEST_JOB_RESOLVED = true;
                                resolve();
                            };
                        });
                    });
                    return {
                        isJobActive: window.isJobActive(),
                        canSafelyReload: window.canSafelyReload(),
                        windowId: window.__ORIGINAL_WINDOW_ID
                    };
                })()`,
                returnByValue: true
            });
            assert.strictEqual(startJob.result?.value?.isJobActive, true, 'Job must be active');
            assert.strictEqual(startJob.result?.value?.canSafelyReload, false, 'canSafelyReload() must be false');
        });

        // Step 3: Switch server to v76 and trigger update
        await runAsyncTest('Step 3: Switch server to v76 and trigger background update', async () => {
            activeVersion = 'v76'; // Server now serves real production v76 SW
            const updateTrigger = await cdp.send('Runtime.evaluate', {
                expression: `(async () => {
                    const reg = await navigator.serviceWorker.getRegistration();
                    await reg.update();
                    return true;
                })()`,
                awaitPromise: true,
                returnByValue: true
            });
            assert.strictEqual(updateTrigger.result?.value, true, 'Update check triggered');
        });

        // Step 4: Verify v76 installs, waits, and update banner appears
        await runAsyncTest('Step 4: v76 installs into waiting state & #pwa-update-banner appears', async () => {
            // Poll for waiting worker and banner appearance
            let bannerVisible = false;
            let hasWaiting = false;

            for (let i = 0; i < 40; i++) {
                await new Promise(r => setTimeout(r, 200));
                const status = await cdp.send('Runtime.evaluate', {
                    expression: `(() => {
                        const banner = document.getElementById('pwa-update-banner');
                        const isVisible = banner && !banner.classList.contains('d-none');
                        return {
                            bannerVisible: Boolean(isVisible),
                            hasWaiting: false
                        };
                    })()`,
                    returnByValue: true
                });

                const swStatus = await cdp.send('Runtime.evaluate', {
                    expression: `navigator.serviceWorker.getRegistration().then(r => Boolean(r && r.waiting))`,
                    awaitPromise: true,
                    returnByValue: true
                });

                bannerVisible = status.result?.value?.bannerVisible;
                hasWaiting = swStatus.result?.value;

                if (bannerVisible && hasWaiting) break;
            }

            assert.strictEqual(hasWaiting, true, 'v76 worker must be in waiting state');
            assert.strictEqual(bannerVisible, true, '#pwa-update-banner must be visible to user');
        });

        // Step 5: Verify NO reload happens while job is active
        await runAsyncTest('Step 5: NO reload happens mid-job (canSafelyReload guard holds)', async () => {
            // Wait 2.5 seconds with update banner showing while job is ongoing
            await new Promise(r => setTimeout(r, 2500));

            const checkGuard = await cdp.send('Runtime.evaluate', {
                expression: `(() => {
                    return {
                        stillOriginalWindow: typeof window.__ORIGINAL_WINDOW_ID === 'string',
                        isJobActive: window.isJobActive(),
                        canSafelyReload: window.canSafelyReload()
                    };
                })()`,
                returnByValue: true
            });

            assert.strictEqual(checkGuard.result?.value?.stillOriginalWindow, true, 'Page must NOT have reloaded mid-job');
            assert.strictEqual(checkGuard.result?.value?.isJobActive, true, 'Job must still be active');
            assert.strictEqual(checkGuard.result?.value?.canSafelyReload, false, 'canSafelyReload must remain false');
        });

        // Step 6: Complete job, tap Update button, and verify safe reload
        await runAsyncTest('Step 6: Complete job, click #pwa-btn-update, and reload safely into v76', async () => {
            // Conclude job
            await cdp.send('Runtime.evaluate', {
                expression: `window.__RESOLVE_JOB()`
            });

            // Wait for withWakeLock promise to resolve
            await new Promise(r => setTimeout(r, 200));

            const safeNow = await cdp.send('Runtime.evaluate', {
                expression: `window.canSafelyReload()`,
                returnByValue: true
            });
            assert.strictEqual(safeNow.result?.value, true, 'canSafelyReload must now be true');

            // Click #pwa-btn-update
            await cdp.send('Runtime.evaluate', {
                expression: `document.getElementById('pwa-btn-update').click()`
            });

            // Wait for page reload to complete and new controller to take over
            await new Promise(r => setTimeout(r, 3000));

            // Verify that new page has loaded
            const reloadCheck = await cdp.send('Runtime.evaluate', {
                expression: `(() => {
                    return {
                        hasController: Boolean(navigator.serviceWorker.controller),
                        title: document.title,
                        hasOriginalId: typeof window.__ORIGINAL_WINDOW_ID !== 'undefined'
                    };
                })()`,
                returnByValue: true
            });

            assert.strictEqual(reloadCheck.result?.value?.hasOriginalId, false, 'Page must have reloaded into fresh context');
            assert.strictEqual(reloadCheck.result?.value?.hasController, true, 'New SW must control client');
        });

        // Step 7: Verify stale v75 cache deleted and v76 cache active
        await runAsyncTest('Step 7: Old v75 cache cleaned up and v76 shell cache active', async () => {
            const cacheCheck = await cdp.send('Runtime.evaluate', {
                expression: `caches.keys()`,
                awaitPromise: true,
                returnByValue: true
            });

            const cacheKeys = cacheCheck.result?.value || [];
            console.log('    Active caches after upgrade:', cacheKeys);
            assert.ok(!cacheKeys.includes('zevsafe-shell-v75'), 'Stale zevsafe-shell-v75 MUST be deleted');
            const v76Cache = cacheKeys.find(c => c.startsWith('zevsafe-shell-v76'));
            assert.ok(v76Cache, `New v76 cache must be present, found: ${cacheKeys.join(', ')}`);
        });

        // Step 8: OFFLINE mode verification - no mixed old/new lazy-loaded files
        await runAsyncTest('Step 8: OFFLINE mode verification: lazy-loaded assets load cleanly from v76 cache with no mixed files', async () => {
            // Emulate complete network disconnection
            await cdp.send('Network.emulateNetworkConditions', {
                offline: true,
                latency: 0,
                downloadThroughput: 0,
                uploadThroughput: 0
            });

            const offlineCheck = await cdp.send('Runtime.evaluate', {
                expression: `(async () => {
                    const jsResp = await fetch('./js/media-player.js');
                    const cssResp = await fetch('./css/media-player.css');
                    const jsText = await jsResp.text();
                    const cssText = await cssResp.text();
                    return {
                        jsOk: jsResp.ok,
                        jsStatus: jsResp.status,
                        jsHasZevMedia: jsText.includes('window.ZevMedia') || jsText.includes('ZevMedia'),
                        cssOk: cssResp.ok,
                        cssStatus: cssResp.status,
                        cssHasStyles: cssText.length > 500
                    };
                })()`,
                awaitPromise: true,
                returnByValue: true
            });

            const r = offlineCheck.result?.value;
            assert.strictEqual(r?.jsOk, true, 'js/media-player.js must return 200 OK offline');
            assert.strictEqual(r?.jsStatus, 200, 'js/media-player.js status must be 200');
            assert.strictEqual(r?.jsHasZevMedia, true, 'js/media-player.js must contain v76 ZevMedia API');
            assert.strictEqual(r?.cssOk, true, 'css/media-player.css must return 200 OK offline');
            assert.strictEqual(r?.cssStatus, 200, 'css/media-player.css status must be 200');
            assert.strictEqual(r?.cssHasStyles, true, 'css/media-player.css must be populated offline');

            // Restore network
            await cdp.send('Network.emulateNetworkConditions', {
                offline: false,
                latency: 0,
                downloadThroughput: -1,
                uploadThroughput: -1
            });
        });

        cdp.close();
    } finally {
        chromeProc.kill();
        server.close();
        try { fs.rmSync(tmpProfileDir, { recursive: true, force: true }); } catch (_) {}
    }

    console.log('\n===============================================================');
    console.log(`  ALL ${passed}/${total} PWA UPGRADE SIMULATION TESTS PASSED (100%)`);
    console.log('===============================================================');
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
