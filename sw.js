// ================================================================
//  ZevSafe Service Worker — Production PWA
//  Strategy:
//    • App Shell   → Cache-First  (instant offline load)
//    • Google Fonts → Stale-While-Revalidate (cached + refreshed)
//    • .zev files  → NEVER cached (security constraint)
//    • Blob / data URLs → NEVER cached
// ================================================================

const APP_VERSION    = 'v23';
const SHELL_CACHE    = `zevsafe-shell-${APP_VERSION}`;
const FONT_CACHE     = `zevsafe-fonts-${APP_VERSION}`;
const ALL_CACHES     = [SHELL_CACHE, FONT_CACHE];

// ── App Shell Assets (precached on install) ─────────────────────
const SHELL_ASSETS = [
    './',
    './index.html',
    './how-to-use-zevsafe/index.html',
    './styles.css',
    './app.js',
    './jszip.min.js',
    './manifest.json',
    './zevsafe-logo.png',
    './favicon.svg',
    './icon-192.png',
    './icon-512.png',
    './zevsafe-og.png',
    './js/stream-crypto.js',
    './js/stream-packer.js',
    './js/stream-unpacker.js',
    './js/crypto-worker.js',
    './js/worker-bridge.js',
    './js/stream-saver.js'
];

// ── Install: precache the app shell ────────────────────────────
self.addEventListener('install', event => {
    console.log(`[ZevSafe SW ${APP_VERSION}] Installing...`);
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => {
                console.log(`[ZevSafe SW] Precaching ${SHELL_ASSETS.length} shell assets`);
                // addAll is atomic — if any asset fails, install fails cleanly
                return cache.addAll(SHELL_ASSETS);
            })
            .then(() => {
                console.log(`[ZevSafe SW] Install complete. Activating immediately.`);
                return self.skipWaiting();
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
    if (url.pathname.endsWith('.zev')) return;

    // ── Security: skip chrome-extension or non-http(s) ─────────
    if (!url.protocol.startsWith('http')) return;

    // ── Route: Service Worker Synthetic Streaming Download Route ─────
    if (url.pathname === '/_stream_download' || url.pathname.endsWith('/_stream_download')) {
        event.respondWith(handleStreamDownload(url));
        return;
    }

    // ── Route: Google Fonts → Stale-While-Revalidate ──────────
    if (
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com'
    ) {
        event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
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
 * 2. Otherwise fetch from network, cache it, then return.
 * 3. If offline and no cache → return a friendly offline response.
 */
async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request, { cacheName });
    if (cached) {
        return cached;
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(cacheName);
            // Clone before consuming — a Response body can only be read once
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch {
        // Offline and not in cache — return the shell as fallback
        const fallback = await caches.match('./index.html', { cacheName });
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

/**
 * Stale-While-Revalidate strategy.
 * 1. Return cached response immediately (stale).
 * 2. Simultaneously fetch network response and update the cache.
 * Best for fonts — user sees instant load, cache is kept fresh.
 */
async function staleWhileRevalidate(request, cacheName) {
    const cache  = await caches.open(cacheName);
    const cached = await cache.match(request);

    // Fire the network request regardless (don't await yet)
    const networkFetch = fetch(request)
        .then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
            }
            return networkResponse;
        })
        .catch(() => null); // Fail silently if offline

    // Return cached immediately, or wait for network if no cache
    return cached || networkFetch;
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
    }
});


