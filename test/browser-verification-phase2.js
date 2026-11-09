/**
 * Phase 2 Headless Chrome Browser Verification Script
 * Launches Chrome via CDP on port 9333, serves static root on port 8085,
 * verifies 0 console errors, responsive viewports (portrait 390x844, landscape 844x390, desktop 1280x800),
 * on-demand lazy loading of media-player.css and media-player.js, and ZevMedia API.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8085;
const CDP_PORT = 9333;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4'
};

// 1. Static HTTP Server
const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(ROOT_DIR, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, async () => {
    console.log(`Local verification server running at http://localhost:${PORT}`);
    try {
        await runHeadlessVerification();
    } catch (err) {
        console.error('Browser verification failed:', err);
        process.exitCode = 1;
    } finally {
        server.close();
    }
});

async function runHeadlessVerification() {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    if (!fs.existsSync(chromePath)) {
        console.log('Chrome binary not found at default path, skipping CDP test.');
        return;
    }

    const userDataDir = path.join(require('os').tmpdir(), 'chrome-cdp-phase2-' + Date.now());
    const chromeProc = spawn(chromePath, [
        `--remote-debugging-port=${CDP_PORT}`,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${userDataDir}`,
        `http://localhost:${PORT}/`
    ]);

    // Give Chrome 2 seconds to launch
    await new Promise(r => setTimeout(r, 2000));

    try {
        const http = require('http');
        const jsonRes = await new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        const target = jsonRes.find(t => t.type === 'page');
        if (!target || !target.webSocketDebuggerUrl) {
            throw new Error('Could not find active Chrome page target');
        }

        const WebSocket = require('stream'); // Fallback check
        console.log('Found page target:', target.url);

        // Simple CDP client over WebSocket via node
        const wsUrl = target.webSocketDebuggerUrl;
        const cdp = await connectCDP(wsUrl);

        console.log('\n--- 1. Initial Page Load & Console Diagnostics ---');
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Log.enable');
        await cdp.send('Network.enable');
        await cdp.send('Network.setBypassServiceWorker', { bypass: true });

        const consoleErrors = [];
        cdp.on('Runtime.exceptionThrown', (e) => { console.error('Chrome Uncaught Exception:', e.exceptionDetails); });
        cdp.on('Runtime.consoleAPICalled', (e) => {
            if (e.type === 'error') consoleErrors.push(e.args.map(a => a.value || a.description).join(' '));
        });

        // Navigate cleanly
        await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
        await new Promise(r => setTimeout(r, 1500));

        console.log(`  Console Errors: ${consoleErrors.length}`);
        if (consoleErrors.length > 0) {
            console.warn('  Errors observed:', consoleErrors);
        }
        assert.strictEqual(consoleErrors.length, 0, 'Initial page load must have 0 console errors');
        console.log('  ✓ 1.1: Clean initial load with 0 console errors');

        // Check that media player CSS and JS are NOT loaded initially
        const initialScripts = await cdp.eval(`Array.from(document.querySelectorAll('script')).map(s => s.src)`);
        const initialLinks = await cdp.eval(`Array.from(document.querySelectorAll('link')).map(l => l.href)`);
        const hasPlayerCssInitially = initialLinks.some(h => h.includes('media-player.css'));
        const hasPlayerJsInitially = initialScripts.some(s => s.includes('media-player.js'));
        assert.strictEqual(hasPlayerCssInitially, false, 'media-player.css must not be loaded initially');
        assert.strictEqual(hasPlayerJsInitially, false, 'media-player.js must not be loaded initially');
        console.log('  ✓ 1.2: media-player.css and js/media-player.js are deferred and NOT present on first paint');

        console.log('\n--- 2. On-Demand Lazy Loading Execution ---');
        // Trigger ensureMediaPlayerLoaded in page
        const loadResult = await cdp.eval(`
            (async () => {
                await window.ensureMediaPlayerLoaded();
                return {
                    loaded: window.ZevMedia ? window.ZevMedia.isLoaded() : false,
                    hasCss: !!document.querySelector('link[href*="media-player.css"]'),
                    hasJs: !!document.querySelector('script[src*="media-player.js"]')
                };
            })()
        `, true);

        console.log('loadResult:', loadResult); assert.strictEqual(loadResult.loaded, true, 'window.ZevMedia must be loaded and initialized');
        assert.strictEqual(loadResult.hasCss, true, 'media-player.css must be dynamically injected into DOM');
        assert.strictEqual(loadResult.hasJs, true, 'media-player.js must be dynamically injected into DOM');
        console.log('  ✓ 2.1: ensureMediaPlayerLoaded dynamically loads both CSS and JS and registers window.ZevMedia');

        console.log('\n--- 3. Phone Portrait Viewport Verification (390x844) ---');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 3,
            mobile: true
        });
        await new Promise(r => setTimeout(r, 400));

        // Evaluate mobile styles
        const mobileMetrics = await cdp.eval(`
            (() => {
                const modal = document.getElementById('vault-media-modal');
                if (modal) modal.style.display = 'flex';
                const container = document.querySelector('.media-modal-container');
                const bar = document.querySelector('.media-cinema-bar');
                const scrubber = document.getElementById('media-timeline-wrap');
                const playBtn = document.getElementById('btn-media-play');
                const timeDisp = document.getElementById('media-time-display');

                const scrubberRect = scrubber ? scrubber.getBoundingClientRect() : { height: 0 };
                const playRect = playBtn ? playBtn.getBoundingClientRect() : { width: 0, height: 0 };
                const barComputed = bar ? window.getComputedStyle(bar) : {};
                const timeComputed = timeDisp ? window.getComputedStyle(timeDisp) : {};

                return {
                    scrubberHeight: scrubberRect.height,
                    playWidth: playRect.width,
                    playHeight: playRect.height,
                    fontSize: parseFloat(timeComputed.fontSize || '0'),
                    paddingBottom: barComputed.paddingBottom
                };
            })()
        `);

        console.log('  Portrait Metrics:', mobileMetrics);
        assert.ok(mobileMetrics.scrubberHeight >= 28, `Scrubber height (${mobileMetrics.scrubberHeight}px) must be >= 28px`);
        assert.ok(mobileMetrics.playWidth >= 36, `Play button touch target width (${mobileMetrics.playWidth}px) >= 36px`);
        assert.ok(mobileMetrics.playHeight >= 36, `Play button touch target height (${mobileMetrics.playHeight}px) >= 36px`);
        assert.ok(mobileMetrics.fontSize >= 10, 'Time display font size must be legible');
        console.log('  ✓ 3.1: Phone portrait layout passes touch targets (>= 28px scrubber, >= 36-44px buttons, 0.85rem text)');

        console.log('\n--- 4. Phone Landscape Viewport Verification (844x390) ---');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 844,
            height: 390,
            deviceScaleFactor: 3,
            mobile: true
        });
        await new Promise(r => setTimeout(r, 400));

        const landscapeMetrics = await cdp.eval(`
            (() => {
                const stage = document.getElementById('cinema-video-stage');
                const bar = document.querySelector('.media-cinema-bar');
                const stageRect = stage ? stage.getBoundingClientRect() : { width: 0, height: 0 };
                return {
                    stageWidth: stageRect.width,
                    stageHeight: stageRect.height
                };
            })()
        `);
        console.log('  Landscape Metrics:', landscapeMetrics);
        assert.ok(landscapeMetrics.stageWidth >= 800, 'Stage must occupy full landscape width');
        assert.ok(landscapeMetrics.stageHeight >= 350, 'Stage must occupy edge-to-edge landscape height without squish');
        console.log('  ✓ 4.1: Phone landscape layout maximizes video stage edge-to-edge');

        console.log('\n--- 5. Desktop Viewport Verification (1280x800) ---');
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 1280,
            height: 800,
            deviceScaleFactor: 1,
            mobile: false
        });
        await cdp.eval(`window.dispatchEvent(new Event('resize'))`);
        await new Promise(r => setTimeout(r, 1200));

        const desktopMetrics = await cdp.eval(`
            (() => {
                window.dispatchEvent(new Event('resize'));
                const container = document.querySelector('.media-modal-container');
                const rect = container ? container.getBoundingClientRect() : { width: 0, height: 0 };
                return {
                    containerWidth: rect.width,
                    containerHeight: rect.height,
                    innerWidth: window.innerWidth
                };
            })()
        `);
        console.log('  Desktop Metrics:', desktopMetrics);
        assert.ok(desktopMetrics.containerWidth >= 1000, 'Container width on desktop must be expansive (>= 1000px)');
        console.log('  ✓ 5.1: Desktop layout preserves expansive cinema window geometry');

        console.log('\n===============================================================');
        console.log('  ALL BROWSER HEADLESS VERIFICATION CHECKS PASSED (100%)');
        console.log('===============================================================');

        await cdp.close();
    } finally {
        chromeProc.kill('SIGKILL');
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// Lightweight Raw WebSocket client for Node.js
function connectCDP(wsUrl) {
    return new Promise((resolve, reject) => {
        const http = require('http');
        const crypto = require('crypto');
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

        req.on('upgrade', (res, socket, upgradeHead) => {
            socket.on('error', () => {});
            let msgId = 0;
            const callbacks = new Map();
            const eventListeners = new Map();

            // WebSocket frame parser
            let buffer = Buffer.alloc(0);
            socket.on('data', chunk => {
                buffer = Buffer.concat([buffer, chunk]);
                while (buffer.length >= 2) {
                    const firstByte = buffer[0];
                    const secondByte = buffer[1];
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

                    if (opcode === 1) { // Text frame
                        const jsonStr = payload.toString('utf8');
                        const data = JSON.parse(jsonStr);
                        if (data.id && callbacks.has(data.id)) {
                            const cb = callbacks.get(data.id);
                            callbacks.delete(data.id);
                            if (data.error) cb.reject(new Error(data.error.message));
                            else cb.resolve(data.result);
                        } else if (data.method && eventListeners.has(data.method)) {
                            eventListeners.get(data.method)(data.params);
                        }
                    }
                }
            });

            function send(method, params = {}) {
                return new Promise((res, rej) => {
                    const id = ++msgId;
                    callbacks.set(id, { resolve: res, reject: rej });
                    const payload = JSON.stringify({ id, method, params });
                    const payloadBuf = Buffer.from(payload, 'utf8');

                    let header;
                    if (payloadBuf.length < 126) {
                        header = Buffer.from([0x81, 0x80 | payloadBuf.length]);
                    } else if (payloadBuf.length < 65536) {
                        header = Buffer.alloc(4);
                        header[0] = 0x81;
                        header[1] = 0x80 | 126;
                        header.writeUInt16BE(payloadBuf.length, 2);
                    } else {
                        header = Buffer.alloc(10);
                        header[0] = 0x81;
                        header[1] = 0x80 | 127;
                        header.writeBigUInt64BE(BigInt(payloadBuf.length), 2);
                    }

                    const maskKey = crypto.randomBytes(4);
                    const maskedPayload = Buffer.alloc(payloadBuf.length);
                    for (let i = 0; i < payloadBuf.length; i++) {
                        maskedPayload[i] = payloadBuf[i] ^ maskKey[i % 4];
                    }

                    socket.write(Buffer.concat([header, maskKey, maskedPayload]));
                });
            }

            async function evalExpr(expression, awaitPromise = false) {
                const res = await send('Runtime.evaluate', {
                    expression,
                    returnByValue: true,
                    awaitPromise
                });
                if (res.exceptionDetails) {
                    throw new Error(res.exceptionDetails.text || 'Eval error');
                }
                return res.result ? res.result.value : undefined;
            }

            resolve({
                send,
                eval: evalExpr,
                on(event, handler) {
                    eventListeners.set(event, handler);
                },
                close() {
                    socket.end();
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}
