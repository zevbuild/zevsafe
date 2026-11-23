/**
 * ZevSafe Brand & Logo Asset Production Generator
 * Uses Headless Microsoft Edge / Chrome via CDP WebSocket
 * Produces pixel-perfect PNGs, JPGs, and multi-resolution ICO for Concept 3: Biometric Iris & Safe Dial.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const BRANDING_DIR = path.join(ROOT_DIR, 'assets', 'branding');
const PORT = 8896;
const DEBUG_PORT = 9296;

// Ensure directories exist
const DIRS = [
    path.join(BRANDING_DIR, 'logos'),
    path.join(BRANDING_DIR, 'icons'),
    path.join(BRANDING_DIR, 'pwa'),
    path.join(BRANDING_DIR, 'social'),
    path.join(BRANDING_DIR, 'watermarks')
];
for (const d of DIRS) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Read SVGs
const logoHorizDarkSvg = fs.readFileSync(path.join(BRANDING_DIR, 'logos', 'logo-horizontal-dark.svg'), 'utf8');
const logoVertDarkSvg = fs.readFileSync(path.join(BRANDING_DIR, 'logos', 'logo-vertical-dark.svg'), 'utf8');
const faviconSvg = fs.readFileSync(path.join(BRANDING_DIR, 'icons', 'favicon.svg'), 'utf8');
const stampSvg = fs.readFileSync(path.join(BRANDING_DIR, 'watermarks', 'chart-watermark-stamp.svg'), 'utf8');
const pushSvg = fs.readFileSync(path.join(BRANDING_DIR, 'watermarks', 'push-notification-icon.svg'), 'utf8');

function toDataUrl(svgStr) {
    return `data:image/svg+xml;base64,${Buffer.from(svgStr).toString('base64')}`;
}

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Brand Generator</title></head>
<body style="margin:0; background:#000;">
<canvas id="c"></canvas>
<script>
window.renderSvg = function(dataUrl, width, height, bgColor) {
    return new Promise((resolve) => {
        const c = document.getElementById('c');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, width, height);

        if (bgColor) {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);
        }

        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(c.toDataURL('image/png'));
        };
        img.src = dataUrl;
    });
};

window.renderPwaIcon = function(dataUrl, size, safeZonePercent, bgColor) {
    return new Promise((resolve) => {
        const c = document.getElementById('c');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, size, size);

        ctx.fillStyle = bgColor || '#071426';
        ctx.fillRect(0, 0, size, size);

        const img = new Image();
        img.onload = () => {
            const innerSize = size * (safeZonePercent / 100);
            const offset = (size - innerSize) / 2;
            ctx.drawImage(img, offset, offset, innerSize, innerSize);
            resolve(c.toDataURL('image/png'));
        };
        img.src = dataUrl;
    });
};

window.renderSocialCard = function(width, height, isTwitter) {
    return new Promise((resolve) => {
        const c = document.getElementById('c');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d');

        // Background Gradient
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, '#071426');
        bgGrad.addColorStop(0.5, '#0a1024');
        bgGrad.addColorStop(1, '#050711');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Ambient Glowing Orbs
        const glow1 = ctx.createRadialGradient(240, height / 2, 20, 240, height / 2, 280);
        glow1.addColorStop(0, 'rgba(36, 213, 197, 0.22)');
        glow1.addColorStop(0.5, 'rgba(57, 135, 255, 0.12)');
        glow1.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow1;
        ctx.fillRect(0, 0, width, height);

        const glow2 = ctx.createRadialGradient(width - 200, 100, 10, width - 200, 100, 350);
        glow2.addColorStop(0, 'rgba(57, 135, 255, 0.15)');
        glow2.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow2;
        ctx.fillRect(0, 0, width, height);

        // Grid lines (cyber security motif)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let x = 40; x < width; x += 60) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
        for (let y = 40; y < height; y += 60) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }

        // Draw Biometric Iris Symbol on the Left
        const emblemImg = new Image();
        emblemImg.onload = () => {
            const emblemSize = isTwitter ? 260 : 280;
            const emblemY = (height - emblemSize) / 2;
            const emblemX = 80;
            ctx.drawImage(emblemImg, emblemX, emblemY, emblemSize, emblemSize);

            // Right Content Area
            const textX = 410;

            // Security Badge Pill
            const pillY = isTwitter ? 110 : 125;
            ctx.fillStyle = 'rgba(36, 213, 197, 0.12)';
            ctx.strokeStyle = 'rgba(36, 213, 197, 0.4)';
            ctx.lineWidth = 1.5;
            roundRect(ctx, textX, pillY, 360, 36, 18, true, true);

            ctx.font = 'bold 14px system-ui, sans-serif';
            ctx.fillStyle = '#24D5C5';
            ctx.fillText('🛡️  100% IN-BROWSER ZERO-KNOWLEDGE', textX + 24, pillY + 23);

            // Brand Title
            const titleY = pillY + 95;
            ctx.font = '900 82px system-ui, sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText('Zev', textX, titleY);
            const zevWidth = ctx.measureText('Zev').width;
            ctx.fillStyle = '#24D5C5';
            ctx.fillText('Safe', textX + zevWidth, titleY);

            // Headline
            const headY = titleY + 54;
            ctx.font = 'bold 28px system-ui, sans-serif';
            ctx.fillStyle = '#E2E8F0';
            ctx.fillText('Military-Grade Client-Side Vault Suite', textX, headY);

            // Trust Strip Specifications
            const specY = headY + 44;
            ctx.font = '500 17px system-ui, sans-serif';
            ctx.fillStyle = '#94A3B8';
            ctx.fillText('AES-256-GCM  •  PBKDF2 & Argon2id  •  5 GB Streaming  •  Air-Gapped', textX, specY);

            // Bottom Domain Bar
            const barY = height - 55;
            ctx.font = '600 16px monospace';
            ctx.fillStyle = '#64748B';
            ctx.fillText('https://zevsafe.pages.dev  |  .zsafe Container Architecture', textX, barY);

            resolve(c.toDataURL('image/jpeg', 0.96));
        };
        emblemImg.src = ${JSON.stringify(toDataUrl(faviconSvg))};

        function roundRect(ctx, x, y, w, h, r, fill, stroke) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            if (fill) ctx.fill();
            if (stroke) ctx.stroke();
        }
    });
};
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
});

function connectWs(url) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const key = crypto.randomBytes(16).toString('base64');
        const req = http.request({
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
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

            resolve({ send, evaluate, close: () => socket.destroy() });
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
            const pageTarget = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || (list.length > 0 ? list[0] : null);
            if (pageTarget && pageTarget.webSocketDebuggerUrl) {
                return pageTarget.webSocketDebuggerUrl;
            }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Timed out waiting for Chrome/Edge WebSocket URL');
}

function writeDataUrlToFile(dataUrl, destPath) {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(destPath, buffer);
    console.log(`  ✓ Generated [${buffer.length} bytes]: ${path.relative(ROOT_DIR, destPath)}`);
    return buffer;
}

function createIcoFromPngs(pngItems) {
    // pngItems: [{ width, height, buffer }]
    const count = pngItems.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // Reserved
    header.writeUInt16LE(1, 2); // 1 = ICO type
    header.writeUInt16LE(count, 4); // Count

    let offset = 6 + (count * 16);
    const dirEntries = [];

    for (const item of pngItems) {
        const entry = Buffer.alloc(16);
        entry.writeUInt8(item.width >= 256 ? 0 : item.width, 0);
        entry.writeUInt8(item.height >= 256 ? 0 : item.height, 1);
        entry.writeUInt8(0, 2); // Color palette
        entry.writeUInt8(0, 3); // Reserved
        entry.writeUInt16LE(1, 4); // Color planes
        entry.writeUInt16LE(32, 6); // Bits per pixel
        entry.writeUInt32LE(item.buffer.length, 8); // Image size
        entry.writeUInt32LE(offset, 12); // Image offset
        dirEntries.push(entry);
        offset += item.buffer.length;
    }

    return Buffer.concat([header, ...dirEntries, ...pngItems.map(p => p.buffer)]);
}

async function run() {
    console.log('===============================================================');
    console.log('  ZevSafe Brand Asset Production Generator (Concept 3)');
    console.log('===============================================================');

    await new Promise(res => server.listen(PORT, res));
    console.log(`[Asset Server] Serving generator on port ${PORT}`);

    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const userDataDir = path.join(ROOT_DIR, '.tmp-branding-gen-' + Date.now());

    const browser = spawn(edgePath, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--mute-audio',
        '--hide-scrollbars',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${userDataDir}`,
        `http://127.0.0.1:${PORT}/`
    ]);

    try {
        const wsUrl = await getWsUrl(DEBUG_PORT);
        const cdp = await connectWs(wsUrl);

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

        // Wait until script functions are available on window
        let ready = false;
        for (let i = 0; i < 30; i++) {
            const isFn = await cdp.evaluate('typeof window.renderSvg === "function"');
            if (isFn) { ready = true; break; }
            await new Promise(r => setTimeout(r, 200));
        }
        if (!ready) throw new Error('Timeout waiting for window.renderSvg to initialize');

        console.log('\n--- 1. Logos Generation ---');
        // 1. logo-horizontal-dark.png (800x200)
        let dataUrl = await cdp.evaluate(`window.renderSvg(${JSON.stringify(toDataUrl(logoHorizDarkSvg))}, 800, 200, '#071426')`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'logos', 'logo-horizontal-dark.png'));

        // 2. logo-vertical-dark.png (600x600)
        dataUrl = await cdp.evaluate(`window.renderSvg(${JSON.stringify(toDataUrl(logoVertDarkSvg))}, 600, 600, null)`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'logos', 'logo-vertical-dark.png'));

        console.log('\n--- 2. Favicons Generation ---');
        // 3. favicon-16x16.png
        dataUrl = await cdp.evaluate(`window.renderPwaIcon(${JSON.stringify(toDataUrl(faviconSvg))}, 16, 85, '#071426')`);
        const fav16 = writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'icons', 'favicon-16x16.png'));

        // 4. favicon-32x32.png
        dataUrl = await cdp.evaluate(`window.renderPwaIcon(${JSON.stringify(toDataUrl(faviconSvg))}, 32, 85, '#071426')`);
        const fav32 = writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'icons', 'favicon-32x32.png'));

        // 5. favicon-48x48.png
        dataUrl = await cdp.evaluate(`window.renderPwaIcon(${JSON.stringify(toDataUrl(faviconSvg))}, 48, 85, '#071426')`);
        const fav48 = writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'icons', 'favicon-48x48.png'));

        // 6. favicon.ico (multi-res bundle)
        const icoBuf = createIcoFromPngs([
            { width: 16, height: 16, buffer: fav16 },
            { width: 32, height: 32, buffer: fav32 },
            { width: 48, height: 48, buffer: fav48 }
        ]);
        const icoPath = path.join(BRANDING_DIR, 'icons', 'favicon.ico');
        fs.writeFileSync(icoPath, icoBuf);
        console.log(`  ✓ Generated Multi-Res ICO [${icoBuf.length} bytes]: ${path.relative(ROOT_DIR, icoPath)}`);

        console.log('\n--- 3. PWA Icons Generation ---');
        // 7. apple-touch-icon.png (180x180)
        dataUrl = await cdp.evaluate(`window.renderPwaIcon(${JSON.stringify(toDataUrl(faviconSvg))}, 180, 80, '#071426')`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'pwa', 'apple-touch-icon.png'));

        // 8. android-chrome-192x192.png (192x192)
        dataUrl = await cdp.evaluate(`window.renderPwaIcon(${JSON.stringify(toDataUrl(faviconSvg))}, 192, 85, '#071426')`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'pwa', 'android-chrome-192x192.png'));

        // 9. android-chrome-512x512.png (512x512)
        dataUrl = await cdp.evaluate(`window.renderPwaIcon(${JSON.stringify(toDataUrl(faviconSvg))}, 512, 85, '#071426')`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'pwa', 'android-chrome-512x512.png'));

        // 10. maskable-icon-512x512.png (512x512 with certified 80% safe zone, 20% padding)
        dataUrl = await cdp.evaluate(`window.renderPwaIcon(${JSON.stringify(toDataUrl(faviconSvg))}, 512, 80, '#071426')`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'pwa', 'maskable-icon-512x512.png'));

        console.log('\n--- 4. Social Cards & Avatar Generation ---');
        // 11. og-image-zevsafe.jpg (1200x630)
        dataUrl = await cdp.evaluate(`window.renderSocialCard(1200, 630, false)`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'social', 'og-image-zevsafe.jpg'));

        // 12. twitter-card.jpg (1200x600)
        dataUrl = await cdp.evaluate(`window.renderSocialCard(1200, 600, true)`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'social', 'twitter-card.jpg'));

        // 13. avatar-square-800x800.png (800x800)
        dataUrl = await cdp.evaluate(`window.renderPwaIcon(${JSON.stringify(toDataUrl(faviconSvg))}, 800, 82, '#071426')`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'social', 'avatar-square-800x800.png'));

        console.log('\n--- 5. Watermarks & Notifications ---');
        // 14. chart-watermark-stamp.png (400x400)
        dataUrl = await cdp.evaluate(`window.renderSvg(${JSON.stringify(toDataUrl(stampSvg))}, 400, 400, null)`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'watermarks', 'chart-watermark-stamp.png'));

        // 15. push-notification-icon.png (96x96)
        dataUrl = await cdp.evaluate(`window.renderSvg(${JSON.stringify(toDataUrl(pushSvg))}, 96, 96, null)`);
        writeDataUrlToFile(dataUrl, path.join(BRANDING_DIR, 'watermarks', 'push-notification-icon.png'));

        cdp.close();
        console.log('\n===============================================================');
        console.log('  ALL BRANDING ASSETS GENERATED SUCCESSFULLY!');
        console.log('===============================================================');
    } finally {
        browser.kill();
        server.close();
        try {
            fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch (_) {}
    }
}

run().catch(err => {
    console.error('Fatal generator error:', err);
    process.exit(1);
});
