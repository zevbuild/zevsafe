// ================================================================
//  ZevSafe Service Worker — Production PWA
//  Strategy:
//    • App Shell   → Cache-First  (instant offline load)

//    • .zev files  → NEVER cached (security constraint)
//    • Blob / data URLs → NEVER cached
// ================================================================

const APP_VERSION    = 'v79';
const CONTENT_HASH   = 'b4212cb0';
const SHELL_CACHE    = `zevsafe-shell-${APP_VERSION}-${CONTENT_HASH}`;

const ALL_CACHES     = [SHELL_CACHE];

// ── App Shell Assets (precached on install) ─────────────────────
const SHELL_ASSETS = [
    './',
    './index.html',
    './roadmap/',
    './roadmap/index.html',
    './device-power/',
    './device-power/index.html',
    './knowledge/',
    './knowledge/index.html',
    './knowledge/knowledge.css',
    './knowledge/knowledge.js',
    './knowledge/airgap-usb-backup/',
    './knowledge/airgap-usb-backup/index.html',
    './knowledge/core-vault/index.html',
    './knowledge/duress-decoy/index.html',
    './knowledge/health-and-salvage/index.html',
    './knowledge/key-derivation-2fa/index.html',
    './knowledge/media-cinema/index.html',
    './knowledge/mobile-streaming/index.html',
    './knowledge/passwords-autolock/index.html',
    './knowledge/polyglot-camouflage/index.html',
    './knowledge/virtual-filesystem/index.html',
    './how-to-use-zevsafe/',
    './how-to-use-zevsafe/index.html',
    './change-log/',
    './change-log/index.html',
    './security-audit/',
    './security-audit/index.html',
    './styles.css',
    './css/media-player.css',
    './app.js',
    './js/init.js',
    './404.html',
    './jszip.min.js',
    './manifest.json',
    './favicon.svg',
    './assets/apple-touch-icon.png',
    './assets/favicon.svg',
    './assets/icon-192.png',
    './assets/icon-192.webp',
    './assets/icon-512.png',
    './assets/icon-512.webp',
    './assets/icon-maskable-192.png',
    './assets/icon-maskable-512.png',
    './assets/zevsafe-logo.png',
    './assets/zevsafe-logo.svg',
    './assets/zevsafe-logo.webp',
    './assets/zevsafe-og.png',
    './assets/zevsafe-og.webp',
    './tools/encrypt.ps1',
    './tools/decrypt.ps1',
    './tools/Encrypt-Vault.bat',
    './tools/Decrypt-Vault.bat',
    './js/a11y-manager.js',
    './js/crypto-worker.js',
    './js/device-benchmark.js',
    './js/document-viewer.js',
    './js/image-viewer.js',
    './js/media-player.js',
    './js/passphrase-words.js',
    './js/qr-engine.js',
    './js/stream-crypto.js',
    './js/stream-packer.js',
    './js/stream-saver.js',
    './js/stream-unpacker.js',
    './js/text-editor.js',
    './js/usb-backup-kit.js',
    './js/worker-bridge.js'
];

// ── Install: precache the app shell ────────────────────────────
self.addEventListener('install', event => {
    console.log(`[ZevSafe SW ${APP_VERSION}] Installing...`);
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(async cache => {
                console.log(`[ZevSafe SW] Precaching ${SHELL_ASSETS.length} shell assets`);
                const precachePromises = SHELL_ASSETS.map(async asset => {
                    try {
                        const response = await fetch(asset, { redirect: 'follow' });
                        if (response && (response.status === 200 || response.type === 'opaque')) {
                            // If response was redirected, wrap in new Response to prevent Chrome Cache API TypeError:
                            // "Failed to execute 'put' on 'Cache': Cannot cache a redirected response"
                            const responseToCache = response.redirected
                                ? new Response(response.body, {
                                      status: response.status,
                                      statusText: response.statusText,
                                      headers: response.headers
                                  })
                                : response.clone();
                            await cache.put(asset, responseToCache);
                        } else {
                            console.warn(`[ZevSafe SW] Non-200 status precaching ${asset}: ${response ? response.status : 'null'}`);
                        }
                    } catch (err) {
                        console.warn(`[ZevSafe SW] Failed to precache ${asset}:`, err);
                    }
                });
                await Promise.all(precachePromises);
            })
            .then(async () => {
                console.log(`[ZevSafe SW ${APP_VERSION}] Install complete.`);
                // Activate immediately only on first install when no clients are controlled
                const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
                if (!clientsList || clientsList.length === 0) {
                    return self.skipWaiting();
                }
                // On updates, stay in waiting until user triggers SKIP_WAITING
            })
            .catch(err => {
                console.error('[ZevSafe SW] Install failed:', err);
                throw err;
            })
    );
});

// ── Activate: delete stale caches from old versions ────────────
self.addEventListener('activate', event => {
    console.log(`[ZevSafe SW ${APP_VERSION}] Activating...`);
    event.waitUntil(
        caches.keys()
            .then(existingCaches => {
                const stale = existingCaches.filter(name => !ALL_CACHES.includes(name));
                console.log(`[ZevSafe SW] Deleting ${stale.length} stale cache(s):`, stale);
                return Promise.all(stale.map(name => caches.delete(name)));
            })
            .then(() => {
                console.log(`[ZevSafe SW] Active. Taking control of all clients.`);
                return self.clients.claim();
            })
    );
});

// ── Fetch: route requests to the right strategy ─────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // ── Security: skip non-GET and unsafe URL schemes ─────────
    if (request.method !== 'GET') return;
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;

    // ── Security: NEVER cache .zev vault files ─────────────────
    if (url.pathname.toLowerCase().endsWith('.zev')) return;

    // ── Security: skip chrome-extension or non-http(s) ─────────
    if (!url.protocol.startsWith('http')) return;

    // ── Route: Service Worker Synthetic Streaming Download Route ─────
    if (url.pathname === '/_stream_download' || url.pathname.endsWith('/_stream_download')) {
        const secFetchSite = (request.headers && typeof request.headers.get === 'function')
            ? request.headers.get('Sec-Fetch-Site')
            : null;
        if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
            event.respondWith(new Response('Forbidden', { status: 403 }));
            return;
        }
        event.respondWith(handleStreamDownload(url));
        return;
    }

    // ── Route: Service Worker Synthetic Media Range Streaming Route (Instant Video Playback) ─────
    if (url.pathname === '/_stream_media' || url.pathname.endsWith('/_stream_media')) {
        const secFetchSite = (request.headers && typeof request.headers.get === 'function')
            ? request.headers.get('Sec-Fetch-Site')
            : null;
        if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
            event.respondWith(new Response('Forbidden', { status: 403 }));
            return;
        }
        event.respondWith(handleStreamMedia(request, url));
        return;
    }

    // ── Route: same-origin app shell → Cache-First ────────────
    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request, SHELL_CACHE));
        return;
    }

    // ── Default: network only (for any other cross-origin) ─────
    // Intentionally let it pass through unmodified
});

// ================================================================
//  STRATEGY IMPLEMENTATIONS
// ================================================================

/**
 * Cache-First strategy.
 * 1. Return cached response immediately if found.
 * 2. Handle canonical subfolder routing aliases (/how-to-use-zevsafe/, /change-log/, /security-audit/).
 * 3. Fetch from network, sanitize redirected responses for Cache API, cache safely.
 * 4. Section-specific offline fallbacks so Chrome never redirects to homepage erroneously.
 */
const SECTION_ROUTES = [
    'roadmap',
    'master-plan',
    'device-power',
    'know-your-device-power',
    'how-to-use-zevsafe',
    'change-log',
    'security-audit',
    'knowledge',
    'knowledge/airgap-usb-backup',
    'knowledge/core-vault',
    'knowledge/duress-decoy',
    'knowledge/health-and-salvage',
    'knowledge/key-derivation-2fa',
    'knowledge/media-cinema',
    'knowledge/mobile-streaming',
    'knowledge/passwords-autolock',
    'knowledge/polyglot-camouflage',
    'knowledge/virtual-filesystem'
];

async function matchSectionRoute(pathname, cacheName) {
    for (const route of SECTION_ROUTES) {
        if (pathname.endsWith('/' + route) || pathname.endsWith('/' + route + '/index.html')) {
            const subCached = await caches.match('./' + route + '/index.html', { cacheName })
                           || await caches.match('./' + route + '/', { cacheName });
            if (subCached) return subCached;
        }
    }
    // Dynamic fallback for any /knowledge/<slug> route
    const km = pathname.match(/\/knowledge\/([a-z0-9_-]+)(?:\/index\.html)?$/i);
    if (km) {
        const slug = km[1];
        const subCached = await caches.match(`./knowledge/${slug}/index.html`, { cacheName })
                       || await caches.match(`./knowledge/${slug}/`, { cacheName });
        if (subCached) return subCached;
    }
    return null;
}

async function cacheFirst(request, cacheName) {
    let cached = await caches.match(request, { cacheName });
    if (cached) {
        return cached;
    }

    const reqUrl = new URL(request.url);
    const pathname = reqUrl.pathname.replace(/\/+$/, ''); // strips trailing slashes

    // ── Subfolder canonical alias resolution ─────────────────────────
    const sectionMatch = await matchSectionRoute(pathname, cacheName);
    if (sectionMatch) return sectionMatch;
    if (pathname === '' || pathname === '/' || pathname.endsWith('/index.html')) {
        const rootCached = await caches.match('./index.html', { cacheName })
                        || await caches.match('./', { cacheName });
        if (rootCached) return rootCached;
    }

    // Graceful alias for tools/ scripts if requested without prefix
    if (pathname.endsWith('/encrypt.ps1') && !pathname.includes('/tools/')) {
        const toolCached = await caches.match('./tools/encrypt.ps1', { cacheName });
        if (toolCached) return toolCached;
    }
    if (pathname.endsWith('/decrypt.ps1') && !pathname.includes('/tools/')) {
        const toolCached = await caches.match('./tools/decrypt.ps1', { cacheName });
        if (toolCached) return toolCached;
    }

    // Graceful alias for assets/ images if requested from root without prefix
    const imgMatch = pathname.match(/\/(icon-\d+\.(?:png|webp)|zevsafe-(?:logo|og)\.(?:png|webp)|favicon\.svg)$/);
    if (imgMatch && !pathname.includes('/assets/')) {
        const assetCached = await caches.match('./assets/' + imgMatch[1], { cacheName });
        if (assetCached) return assetCached;
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(cacheName);
            // CRITICAL FIX FOR CHROME: If response was redirected, wrapping it in new Response prevents:
            // "TypeError: Failed to execute 'put' on 'Cache': Cannot cache a redirected response"
            const responseToCache = networkResponse.redirected
                ? new Response(networkResponse.body, {
                      status: networkResponse.status,
                      statusText: networkResponse.statusText,
                      headers: networkResponse.headers
                  })
                : networkResponse.clone();
            cache.put(request, responseToCache).catch(err => {
                console.warn('[ZevSafe SW] Cache put failed:', err);
            });
        }
        return networkResponse;
    } catch {
        // Offline fallback: check section routes first
        const sectionFallback = await matchSectionRoute(pathname, cacheName);
        if (sectionFallback) return sectionFallback;

        // Fallback for root app
        const fallback = await caches.match('./index.html', { cacheName })
                      || await caches.match('./', { cacheName });
        if (fallback) return fallback;

        // Last resort: basic offline page
        return new Response(
            `<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#08091a;color:#f1f5f9;">
                <h1>🔒 ZevSafe</h1>
                <p>You are offline. Please reconnect once to load the app, then it works fully offline.</p>
            </body></html>`,
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

// ================================================================
//  SERVICE WORKER STREAMING DOWNLOAD ENGINE (Tier 2 Adapter)
// ================================================================

const pendingDownloads = new Map();

/**
 * Handles synthetic GET /_stream_download requests.
 * Streams data from the registered MessagePort directly into the browser's download pipeline.
 */
function handleStreamDownload(url) {
    const downloadId = url.searchParams.get('id');
    const queryFilename = url.searchParams.get('filename') || 'vault.zev';
    const record = pendingDownloads.get(downloadId);

    const filename = record ? record.filename : queryFilename;
    const expectedSize = record ? record.expectedSize : 0;
    const port = record ? record.port : null;

    // Sanitize filename & format RFC 5987 header (Tests 2.19.3, 2.19.4)
    const cleanName = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const asciiFallback = cleanName.replace(/[^\x20-\x7E]/g, '_');
    const rfc5987Name = encodeURIComponent(cleanName);

    const headers = new Headers({
        'Content-Type': 'application/octet-stream; charset=utf-8',
        'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${rfc5987Name}`,
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
    });
    if (expectedSize > 0) {
        headers.set('Content-Length', String(expectedSize));
    }

    if (!port) {
        return new Response('Download stream expired or missing registration', { status: 410, headers });
    }

    const readable = new ReadableStream({
        start(controller) {
            port.onmessage = (msgEvent) => {
                const msg = msgEvent.data;
                if (!msg) return;

                if (msg.type === 'CHUNK') {
                    const chunkData = msg.chunk instanceof Uint8Array ? msg.chunk : new Uint8Array(msg.chunk);
                    controller.enqueue(chunkData);
                    // Send ACK for backpressure flow control (bounds memory <= 4 MB)
                    port.postMessage({ type: 'ACK' });
                } else if (msg.type === 'DONE') {
                    try { controller.close(); } catch (_) {}
                    pendingDownloads.delete(downloadId);
                    port.close();
                } else if (msg.type === 'ABORT' || msg.type === 'ERROR') {
                    try { controller.error(new Error(msg.reason || msg.message || 'Aborted')); } catch (_) {}
                    pendingDownloads.delete(downloadId);
                    port.close();
                }
            };

            port.onmessageerror = (err) => {
                try { controller.error(err); } catch (_) {}
                pendingDownloads.delete(downloadId);
                port.close();
            };
        },
        cancel(reason) {
            // Browser download was cancelled or disconnected by user (Test 2.19.2)
            try {
                port.postMessage({ type: 'DISCONNECTED', reason: String(reason) });
                port.close();
            } catch (_) {}
            pendingDownloads.delete(downloadId);
        }
    });

    return new Response(readable, { headers, status: 200, statusText: 'OK' });
}

// ================================================================
//  ON-DEMAND MEDIA STREAMING ENGINE (HTTP 206 Partial Content)
// ================================================================

const activeMediaStreams = new Map();
const pendingMediaRanges = new Map();

/**
 * Handles synthetic GET and HEAD /_stream_media requests with HTTP 206 Partial Content.
 * Delivers on-demand range streaming directly to HTML5 <video> and <audio> elements
 * without decrypting the entire file upfront (< 60 MB RAM peak across multi-GB files).
 */
async function handleStreamMedia(request, url) {
    const streamId = url.searchParams.get('id');
    let session = activeMediaStreams.get(streamId);

    if (!session) {
        // If the service worker process was restarted while playback was in progress,
        // broadcast a RECONNECT_MEDIA_STREAM event to client windows and wait briefly for re-registration
        try {
            const allClients = await self.clients.matchAll({ type: 'window' });
            if (allClients && allClients.length > 0) {
                for (const client of allClients) {
                    client.postMessage({ type: 'RECONNECT_MEDIA_STREAM', streamId });
                }
                // Allow up to 1000ms for client to re-register the port
                for (let retry = 0; retry < 10; retry++) {
                    await new Promise(r => setTimeout(r, 100));
                    session = activeMediaStreams.get(streamId);
                    if (session) break;
                }
            }
        } catch (_) {}
    }

    if (!session) {
        return new Response('Media stream expired or missing registration', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }

    const totalSize = session.fileSize || 0;
    const mimeType = session.mimeType || 'video/mp4';

    // Handle HTTP HEAD request from video players probing seekability and duration
    if (request.method === 'HEAD') {
        return new Response(null, {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Length': String(totalSize),
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache, no-store'
            }
        });
    }

    const rangeHeader = request.headers.get('Range');
    let start = 0;
    let end = totalSize > 0 ? totalSize - 1 : 0;
    const DEFAULT_SLICE = 2 * 1024 * 1024; // 2 MB slice bounds memory and provides instant seek (< 30ms)

    if (rangeHeader) {
        const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (!matches) {
            return new Response('Malformed Range Header', {
                status: 416,
                headers: {
                    'Content-Range': `bytes */${totalSize}`,
                    'Cache-Control': 'no-store'
                }
            });
        }
        start = parseInt(matches[1], 10);
        if (matches[2]) {
            end = parseInt(matches[2], 10);
        } else {
            end = Math.min(start + DEFAULT_SLICE - 1, totalSize - 1);
        }
    } else {
        // No Range header provided: serve initial slice
        end = Math.min(DEFAULT_SLICE - 1, totalSize - 1);
    }

    if (start >= totalSize || start < 0 || end < start) {
        return new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
                'Content-Range': `bytes */${totalSize}`,
                'Cache-Control': 'no-store'
            }
        });
    }

    end = Math.min(end, totalSize - 1);

    try {
        const rangeData = await new Promise((resolve, reject) => {
            const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            const timer = setTimeout(() => {
                pendingMediaRanges.delete(requestId);
                reject(new Error('Media range request timed out'));
            }, 15000);

            pendingMediaRanges.set(requestId, {
                resolve: (data) => {
                    clearTimeout(timer);
                    resolve(data);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                }
            });

            session.port.postMessage({
                type: 'READ_MEDIA_RANGE',
                requestId,
                streamId,
                start,
                end
            });
        });

        const actualBytes = rangeData instanceof Uint8Array ? rangeData : new Uint8Array(rangeData);
        const actualLength = actualBytes.byteLength;
        const actualEnd = start + actualLength - 1;

        const headers = new Headers({
            'Content-Type': mimeType,
            'Content-Range': `bytes ${start}-${actualEnd}/${totalSize}`,
            'Content-Length': String(actualLength),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache, no-store',
            'X-Content-Type-Options': 'nosniff'
        });

        return new Response(actualBytes, {
            status: 206,
            statusText: 'Partial Content',
            headers
        });
    } catch (err) {
        console.error('[ZevSafe SW] Range request failed:', err);
        return new Response('Range Extraction Error: ' + err.message, {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }
}

// ── Message handler: force-skip waiting and register streams ────
self.addEventListener('message', event => {
    const data = event.data;
    if (!data) return;

    if (data.type === 'SKIP_WAITING') {
        console.log('[ZevSafe SW] Received SKIP_WAITING. Activating new SW now.');
        self.skipWaiting();
    } else if (data.type === 'REGISTER_DOWNLOAD' || data.type === 'REGISTER_STREAM') {
        const downloadId = data.downloadId || data.id;
        const filename = data.filename || 'download.zev';
        const expectedSize = data.expectedSize || data.size || 0;
        const port = event.ports && event.ports[0];
        if (downloadId && port) {
            pendingDownloads.set(downloadId, {
                port,
                filename,
                expectedSize,
                createdAt: Date.now()
            });
            try { port.postMessage({ type: 'STREAM_REGISTERED', id: downloadId }); } catch (_) {}

            // Auto-cleanup after 60s if fetch never arrives
            setTimeout(() => {
                if (pendingDownloads.has(downloadId)) {
                    pendingDownloads.delete(downloadId);
                }
            }, 60000);
        }
    } else if (data.type === 'REGISTER_MEDIA_STREAM') {
        const streamId = data.streamId || data.id;
        const fileSize = data.fileSize || data.size || 0;
        const mimeType = data.mimeType || 'video/mp4';
        const filename = data.filename || 'media';
        const port = event.ports && event.ports[0];
        if (streamId && port) {
            if (activeMediaStreams.has(streamId)) {
                try { activeMediaStreams.get(streamId).port.close(); } catch (_) {}
            }
            activeMediaStreams.set(streamId, {
                port,
                fileSize,
                mimeType,
                filename,
                createdAt: Date.now()
            });

            port.onmessage = (msgEvt) => {
                const msg = msgEvt.data;
                if (!msg) return;
                if (msg.type === 'MEDIA_RANGE_DATA') {
                    const req = pendingMediaRanges.get(msg.requestId);
                    if (req) {
                        pendingMediaRanges.delete(msg.requestId);
                        req.resolve(msg.data);
                    }
                } else if (msg.type === 'MEDIA_RANGE_ERROR') {
                    const req = pendingMediaRanges.get(msg.requestId);
                    if (req) {
                        pendingMediaRanges.delete(msg.requestId);
                        req.reject(new Error(msg.error || 'Media range read failure'));
                    }
                }
            };

            port.onmessageerror = (err) => {
                console.warn('[ZevSafe SW] Media stream port error:', err);
            };

            try { port.postMessage({ type: 'MEDIA_STREAM_REGISTERED', streamId }); } catch (_) {}
        }
    } else if (data.type === 'CLOSE_ALL_MEDIA_STREAMS') {
        for (const [id, session] of activeMediaStreams.entries()) {
            try { session.port.close(); } catch (_) {}
        }
        activeMediaStreams.clear();
    } else if (data.type === 'MEDIA_STREAM_HEARTBEAT') {
        const streamId = data.streamId || data.id;
        if (streamId && activeMediaStreams.has(streamId)) {
            const session = activeMediaStreams.get(streamId);
            session.lastHeartbeat = Date.now();
        }
    } else if (data.type === 'CLOSE_MEDIA_STREAM') {
        const streamId = data.streamId || data.id;
        if (streamId && activeMediaStreams.has(streamId)) {
            const session = activeMediaStreams.get(streamId);
            try { session.port.close(); } catch (_) {}
            activeMediaStreams.delete(streamId);
        }
    }
});


