/**
 * ZevSafe Maskable Icon & Apple Touch Icon Generator
 * Rasterizes from the real assets/favicon.svg using Headless Chrome Canvas
 * Ensures exact 80% safe-zone geometry (20% padding) for maskable icons
 * and generates a circular crop preview screenshot.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8891;
const ARTIFACT_DIR = 'C:/Users/Raju/.gemini/antigravity/brain/37e702e8-7f60-43f4-9ff6-274b2cfaca31';

const svgPath = path.join(ROOT_DIR, 'assets', 'favicon.svg');
const svgRaw = fs.readFileSync(svgPath, 'utf8');
const svgBase64 = Buffer.from(svgRaw).toString('base64');
const svgDataUrl = `data:image/svg+xml;base64,${svgBase64}`;

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Icon Generator</title></head>
<body>
<canvas id="c"></canvas>
<script>
window.renderIcon = function(size, safeZonePercent, bgColor, isCircularPreview) {
    return new Promise((resolve) => {
        const c = document.getElementById('c');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, size, size);

        if (isCircularPreview) {
            // Circular mask demonstrating adaptive icon crop
            ctx.save();
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.clip();
        }

        // Background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, size, size);

        const img = new Image();
        img.onload = () => {
            const innerSize = size * (safeZonePercent / 100);
            const offset = (size - innerSize) / 2;
            ctx.drawImage(img, offset, offset, innerSize, innerSize);
            if (isCircularPreview) {
                ctx.restore();
                // Add subtle outer guide circle
                ctx.strokeStyle = 'rgba(45, 212, 191, 0.4)';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(size / 2, size / 2, (size / 2) - 2, 0, Math.PI * 2);
                ctx.stroke();
            }
            resolve(c.toDataURL('image/png'));
        };
        img.src = "${svgDataUrl}";
    });
};
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
});

function findChrome() {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of paths) {
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
            let buffer = Buffer.alloc(0);
            let currentMessageBuffers = [];
            let currentMessageOpcode = 0;

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

                    if (opcode !== 0) currentMessageOpcode = opcode;
                    currentMessageBuffers.push(payload);

                    if (fin) {
                        const fullPayload = Buffer.concat(currentMessageBuffers);
                        const msgOpcode = currentMessageOpcode;
                        currentMessageBuffers = [];
                        currentMessageOpcode = 0;

                        if (msgOpcode === 1) {
                            try {
                                const parsed = JSON.parse(fullPayload.toString('utf8'));
                                if (parsed.id && pending.has(parsed.id)) {
                                    const { res: pRes, rej: pRej } = pending.get(parsed.id);
                                    pending.delete(parsed.id);
                                    if (parsed.error) pRej(new Error(parsed.error.message));
                                    else pRes(parsed.result);
                                }
                            } catch (_) {}
                        }
                    }
                }
            });

            function send(method, params = {}) {
                return new Promise((rRes, rRej) => {
                    const id = msgId++;
                    pending.set(id, { res: rRes, rej: rRej });
                    const str = JSON.stringify({ id, method, params });
                    const payload = Buffer.from(str, 'utf8');
                    let header;
                    if (payload.length < 126) {
                        header = Buffer.from([0x81, 0x80 | payload.length]);
                    } else {
                        header = Buffer.alloc(4);
                        header[0] = 0x81;
                        header[1] = 0x80 | 126;
                        header.writeUInt16BE(payload.length, 2);
                    }
                    const mask = crypto.randomBytes(4);
                    const masked = Buffer.alloc(payload.length);
                    for (let i = 0; i < payload.length; i++) {
                        masked[i] = payload[i] ^ mask[i % 4];
                    }
                    socket.write(Buffer.concat([header, mask, masked]));
                });
            }

            function evaluate(expression) {
                return send('Runtime.evaluate', {
                    expression,
                    awaitPromise: true,
                    returnByValue: true
                }).then(r => {
                    if (r.exceptionDetails) {
                        throw new Error(`Eval error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
                    }
                    return r.result ? r.result.value : undefined;
                });
            }

            resolve({
                send,
                evaluate,
                close: () => socket.destroy()
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function getWsUrl(debugPort) {
    for (let i = 0; i < 40; i++) {
        try {
            const data = await new Promise((res, rej) => {
                const r = http.get(`http://127.0.0.1:${debugPort}/json`, (resp) => {
                    let body = '';
                    resp.on('data', c => body += c);
                    resp.on('end', () => res(body));
                });
                r.on('error', rej);
            });
            const list = JSON.parse(data);
            if (list.length > 0 && list[0].webSocketDebuggerUrl) {
                return list[0].webSocketDebuggerUrl;
            }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Timed out waiting for Chrome WebSocket URL');
}

async function run() {
    await new Promise(res => server.listen(PORT, res));
    console.log(`[Icon Server] Running on http://127.0.0.1:${PORT}`);

    const debugPort = 9291;
    const userDataDir = path.join(ROOT_DIR, '.tmp-chrome-icon-' + Date.now());
    const chromePath = findChrome();
    const chromeProc = spawn(chromePath, [
        '--headless=new',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--mute-audio',
        '--hide-scrollbars',
        `http://127.0.0.1:${PORT}/`
    ]);

    const wsUrl = await getWsUrl(debugPort);
    const cdp = await connectCDP(wsUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await new Promise(r => setTimeout(r, 1200));

    // 1. Generate icon-maskable-192.png (80% safe zone, 20% margin, #08091a bg)
    const dataUrl192 = await cdp.evaluate(`window.renderIcon(192, 80, '#08091a', false)`);
    const buf192 = Buffer.from(dataUrl192.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'icon-maskable-192.png'), buf192);
    console.log(`  ✓ Generated assets/icon-maskable-192.png (${(buf192.length / 1024).toFixed(1)} KB)`);

    // 2. Generate icon-maskable-512.png (80% safe zone, 20% margin, #08091a bg)
    const dataUrl512 = await cdp.evaluate(`window.renderIcon(512, 80, '#08091a', false)`);
    const buf512 = Buffer.from(dataUrl512.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'icon-maskable-512.png'), buf512);
    console.log(`  ✓ Generated assets/icon-maskable-512.png (${(buf512.length / 1024).toFixed(1)} KB)`);

    // 3. Generate apple-touch-icon.png (180x180, #08091a bg, 86% size)
    const dataUrl180 = await cdp.evaluate(`window.renderIcon(180, 86, '#08091a', false)`);
    const buf180 = Buffer.from(dataUrl180.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'apple-touch-icon.png'), buf180);
    console.log(`  ✓ Generated assets/apple-touch-icon.png (${(buf180.length / 1024).toFixed(1)} KB)`);

    // 4. Generate circular-crop preview screenshot for walkthrough artifact
    const dataUrlCirc = await cdp.evaluate(`window.renderIcon(512, 80, '#08091a', true)`);
    const bufCirc = Buffer.from(dataUrlCirc.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'screen-maskable-icon-preview.png'), bufCirc);
    console.log(`  ✓ Generated artifact screen-maskable-icon-preview.png (${(bufCirc.length / 1024).toFixed(1)} KB)`);

    cdp.close();
    chromeProc.kill('SIGKILL');
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    console.log('✅ Maskable & Apple touch icons generated successfully!');
}

run().catch(err => {
    console.error('Fatal icon generator error:', err);
    process.exit(1);
});
