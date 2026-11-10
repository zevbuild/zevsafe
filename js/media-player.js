/**
 * ZevSafe Dedicated Cinema Media Player & Image Lightbox Engine
 * js/media-player.js (Phase 3 Upgrade — visibility & transport correctness)
 *
 * Implements:
 * 1. Low-memory streaming video/audio player (< 60 MB RAM via HTTP 206 Service Worker streaming)
 * 2. Mobile-first zero-clutter stage, safe area insets & 44x44px touch targets
 * 3. Scrubber: 28px touch area, thin visible track, 16px dragging thumb with touch-action: none
 * 4. Double-tap ±10s seek, single-tap controls toggle, pinch-to-zoom & 1-finger pan
 * 5. Fullscreen automatic landscape orientation lock
 * 6. 2.5 GB phone memory guardrail
 * 7. Forensic Studio Drawer: WebAudio GainNode boost, Vocal Clarity EQ, bookmarks, A-B looper,
 *    forensic loupe, frame stepping, frame snapshots & video filters
 * 8. In-vault Image Lightbox Viewer with pan, zoom and rotation
 */

(function (global) {
    'use strict';

    // =====================================================
    // 🎬 CINEMA MEDIA PLAYER STATE (PRO CINEMA 3.0 STUDIO)
    // =====================================================

    let currentMediaBlobUrl = null;
    let currentMediaFilename = '';
    let currentMediaBlob = null;
    let currentMediaPlaylist = []; // [{ path, name, category, mimeType, size, offset, localHeaderOffset }]
    let currentMediaIndex = -1;
    let currentMediaFitMode = 'fit'; // 'fit', 'fill', '16:9', '4:3'
    let currentMediaFitCover = false;
    let currentMediaRotation = 0; // 0, 90, 180, 270
    let currentMediaFlipH = 1; // 1 or -1
    let currentMediaFlipV = 1; // 1 or -1
    let currentMediaFilters = { bright: false, contrast: false, invert: false, cctv: false };
    let currentMediaIsLooping = false;
    let currentMediaShowRemaining = false;
    let currentMediaAudioBoost = false;
    let currentMediaAudioCtx = null;
    let currentMediaGainNode = null;
    let currentMediaAudioSource = null;
    let isTimelineScrubbing = false;

    // On-Demand Range Streaming State (< 60 MB RAM peak across multi-GB files)
    let activeMediaStreamId = null;
    let activeMediaChannel = null;
    let activeMediaChunkCache = null;
    let activeMediaHeartbeatTimer = null;
    let currentStreamingItem = null;
    let currentStreamingTargetEntry = null;
    let currentStreamingMime = null;

    function stopActiveMediaHeartbeat() {
        if (activeMediaHeartbeatTimer) {
            clearInterval(activeMediaHeartbeatTimer);
            activeMediaHeartbeatTimer = null;
        }
    }

    function startActiveMediaHeartbeat() {
        stopActiveMediaHeartbeat();
        if (!activeMediaStreamId) return;
        activeMediaHeartbeatTimer = setInterval(() => {
            if (!activeMediaStreamId || !navigator.serviceWorker || !navigator.serviceWorker.controller) return;
            try {
                navigator.serviceWorker.controller.postMessage({
                    type: 'MEDIA_STREAM_HEARTBEAT',
                    streamId: activeMediaStreamId
                });
            } catch (_) {}
        }, 8000);
    }

    function bindStreamChannelPort(port, targetEntry) {
        if (!port) return;
        port.onmessage = async (event) => {
            const msg = event.data;
            if (!msg || msg.type !== 'READ_MEDIA_RANGE') return;
            const { requestId, start, end } = msg;
            try {
                const currentVault = global.currentV3Vault;
                const keyOrPassword = currentVault ? (currentVault.masterKey || currentVault.password) : null;
                if (!currentVault || !currentVault.file || !keyOrPassword) {
                    throw new Error('Vault session expired or unavailable for range reading');
                }
                const rangeBytes = await StreamUnpacker.extractFileRange(
                    currentVault.file,
                    keyOrPassword,
                    targetEntry,
                    start,
                    end,
                    {
                        keyfileBytes: currentVault.keyfileBytes,
                        manifest: currentVault.catalog,
                        header: currentVault.catalog?.header,
                        chunkCache: activeMediaChunkCache
                    }
                );
                port.postMessage({
                    type: 'MEDIA_RANGE_DATA',
                    requestId,
                    data: rangeBytes
                }, [rangeBytes.buffer]);
            } catch (err) {
                console.error('[Media Range Stream Error]', err);
                port.postMessage({
                    type: 'MEDIA_RANGE_ERROR',
                    requestId,
                    error: err.message
                });
            }
        };
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'RECONNECT_MEDIA_STREAM') {
                const reqStreamId = event.data.streamId;
                if (reqStreamId && reqStreamId === activeMediaStreamId && currentStreamingTargetEntry) {
                    try {
                        if (activeMediaChannel) {
                            try { activeMediaChannel.port1.close(); } catch (_) {}
                        }
                        activeMediaChannel = new MessageChannel();
                        bindStreamChannelPort(activeMediaChannel.port1, currentStreamingTargetEntry);
                        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                            navigator.serviceWorker.controller.postMessage({
                                type: 'REGISTER_MEDIA_STREAM',
                                streamId: activeMediaStreamId,
                                fileSize: currentStreamingItem?.size || 0,
                                mimeType: currentStreamingMime || 'video/mp4',
                                filename: currentStreamingItem?.name || ''
                            }, [activeMediaChannel.port2]);
                        }
                    } catch (rErr) {
                        console.warn('[ZevMedia] Reconnect stream error:', rErr);
                    }
                }
            }
        });
    }

    // Player 3.0 Pro Studio State
    let currentMediaZoom = 1.0; // 1.0 to 5.0
    let isTheaterMode = false;
    let currentMediaPanX = 0;
    let currentMediaPanY = 0;
    let isMediaPanning = false;
    let mediaPanStartX = 0;
    let mediaPanStartY = 0;
    let mediaLoopPointA = null; // in seconds
    let mediaLoopPointB = null; // in seconds
    let currentMediaBookmarks = []; // [{ time, label }]
    let currentMediaAmbientGlow = false;
    let ambientAnimFrameId = null;
    let currentMediaVocalFilter = null;
    let currentMediaVocalClarity = false;

    // Dedicated Image Lightbox Viewer State
    let currentImageBlobUrl = null;
    let currentImageFilename = '';
    let currentImageBlob = null;
    let currentImagePlaylist = []; // [{ path, name, size }]
    let currentImageIndex = -1;
    let imageZoomLevel = 1.0;
    let imageRotationDeg = 0;
    let imagePanX = 0;
    let imagePanY = 0;
    let isPanningImage = false;
    let panStartX = 0;
    let panStartY = 0;

    // Inactivity Auto-Hide Timer
    let cinemaInactivityTimer = null;

    // Safe helper getters
    function getActiveCinemaMedia() {
        const v = document.getElementById('cinema-video');
        const a = document.getElementById('cinema-audio');
        const visible = el => {
            if (!el || el.classList.contains('d-none')) return false;
            if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
                const cs = window.getComputedStyle(el);
                return cs.display !== 'none' && cs.visibility !== 'hidden';
            }
            return el.style.display !== 'none';
        };
        if (visible(v)) return v;
        if (visible(a)) return a;
        return null;
    }

    async function playWithErrorSurface(el) {
        if (!el) return;
        el.addEventListener('error', () => {
            const e = el.error;
            const codeMsg = {
                1: 'ABORTED — loading was aborted',
                2: 'NETWORK — network/pipeline error',
                3: 'DECODE — video track cannot be decoded (audio may still play)',
                4: 'SRC_NOT_SUPPORTED — container/codec unsupported'
            }[e?.code] || '';
            const msg = `Media element error — code ${e ? e.code : '?'}${codeMsg ? ' (' + codeMsg + ')' : ''}, ${e ? e.message : 'unknown'}`;
            if (typeof showToast === 'function') showToast(msg, 'error');
            console.warn('[ZevMedia]', msg, el, e);
        }, { once: true });

        try {
            await el.play();
        } catch (err) {
            const msg = `play() rejected — ${err.name}: ${err.message}`;
            if (typeof showToast === 'function') showToast(msg, 'warning');
            console.warn('[ZevMedia]', msg, el);
        }
    }

    function updatePlayBtnUI(isPlaying) {
        const btn = document.getElementById('btn-media-play');
        if (btn) {
            btn.innerHTML = isPlaying ? '⏸️ Pause' : '▶️ Play';
            btn.title = isPlaying ? 'Pause (Space)' : 'Play (Space)';
            btn.setAttribute('aria-label', isPlaying ? 'Pause media' : 'Play media');
        }
    }

    function updateVolumeMuteUI(media) {
        if (!media) return;
        const muteBtn = document.getElementById('btn-media-mute');
        const volSlider = document.getElementById('media-volume-slider');
        if (volSlider) volSlider.value = media.muted ? '0' : String(media.volume);
        if (muteBtn) {
            const isMuted = media.muted || media.volume === 0;
            muteBtn.textContent = isMuted ? '🔇' : (media.volume < 0.5 ? '🔉' : '🔊');
            muteBtn.title = isMuted ? 'Unmute (M)' : 'Mute (M)';
            muteBtn.setAttribute('aria-label', isMuted ? 'Unmute audio' : 'Mute audio');
        }
    }

    function formatTime(sec) {
        if (typeof global.formatTime === 'function') return global.formatTime(sec);
        if (isNaN(sec) || !isFinite(sec)) return '0:00';
        const s = Math.floor(sec);
        const m = Math.floor(s / 60);
        const remS = s % 60;
        return `${m}:${remS < 10 ? '0' : ''}${remS}`;
    }

    function showToast(msg, type = 'info') {
        if (typeof global.showToast === 'function') global.showToast(msg, type);
        else console.log(`[Toast ${type}] ${msg}`);
    }

    function log(msg, type = 'info') {
        if (typeof global.log === 'function') global.log(msg, type);
        else console.log(`[Log ${type}] ${msg}`);
    }

    // =====================================================
    // ⏱️ CINEMA INACTIVITY AUTO-HIDE OVERLAY (2.5s)
    // =====================================================

    function clearCinemaInactivityTimer() {
        if (cinemaInactivityTimer) {
            clearTimeout(cinemaInactivityTimer);
            cinemaInactivityTimer = null;
        }
    }

    function resetCinemaInactivityTimer() {
        clearCinemaInactivityTimer();
        const modal = document.getElementById('vault-media-modal');
        if (!modal || modal.classList.contains('d-none') || modal.style.display === 'none') return;

        modal.classList.remove('cinema-ui--hidden');

        // Do not auto-hide if Forensic Studio Drawer is open
        const toolsBar = document.getElementById('media-tools-bar');
        if (toolsBar && toolsBar.classList.contains('is-open')) return;

        const media = getActiveCinemaMedia();
        if (media && !media.paused && media.tagName === 'VIDEO') {
            cinemaInactivityTimer = setTimeout(() => {
                if (!modal.classList.contains('d-none') && modal.style.display !== 'none' && !media.paused && (!toolsBar || !toolsBar.classList.contains('is-open'))) {
                    modal.classList.add('cinema-ui--hidden');
                }
            }, 2500);
        }
    }

    // =====================================================
    // 🚀 ON-DEMAND HTTP 206 RANGE STREAMING EVALUATION
    // =====================================================

    function canStreamRange(item, targetEntry) {
        if (!item || (item.category !== 'video' && item.category !== 'audio')) return false;
        const entry = targetEntry || item.entry || item;
        if (entry && entry.compressed) return false;
        const v3Vault = global.currentV3Vault;
        if (!v3Vault || !v3Vault.file || (!v3Vault.masterKey && !v3Vault.password)) return false;
        if (typeof StreamUnpacker === 'undefined' || typeof StreamUnpacker.extractFileRange !== 'function') return false;
        if (typeof navigator === 'undefined' || !navigator.serviceWorker || !navigator.serviceWorker.controller) return false;
        return true;
    }

    // =====================================================
    // 🎬 PLAY MEDIA BY INDEX (CORE STREAMING PIPELINE)
    // =====================================================

    /**
     * Resolve catalog entry for media item and bind offsets.
     */
    function _resolveMediaTargetEntry(item, v3Vault) {
        const catalogEntry = (v3Vault && v3Vault.catalog && Array.isArray(v3Vault.catalog.files))
            ? v3Vault.catalog.files.find(f => f.path === item.path || f.name === item.name)
            : null;

        const targetEntry = {
            ...(catalogEntry || {}),
            ...(item.entry || {}),
            ...item
        };

        if (catalogEntry) {
            if (item.offset === undefined) item.offset = catalogEntry.offset;
            if (item.localHeaderOffset === undefined) item.localHeaderOffset = catalogEntry.localHeaderOffset;
            if (item.chunkStart === undefined) item.chunkStart = catalogEntry.chunkStart;
            if (item.chunkEnd === undefined) item.chunkEnd = catalogEntry.chunkEnd;
            if (item.compressed === undefined) item.compressed = catalogEntry.compressed;
        }

        return targetEntry;
    }

    /**
     * Reset active video/audio elements, tear down previous stream channel, and reset view transforms.
     */
    function _resetMediaPlaybackElements(videoEl, audioEl, item) {
        if (videoEl) {
            try {
                videoEl.pause();
                videoEl.removeAttribute('src');
                videoEl.load();
            } catch (_) {}
        }
        if (audioEl) {
            try {
                audioEl.pause();
                audioEl.removeAttribute('src');
                audioEl.load();
            } catch (_) {}
        }

        if (currentMediaBlobUrl && currentMediaBlobUrl.startsWith('blob:')) {
            if (typeof global.revokeTrackedBlobUrl === 'function') global.revokeTrackedBlobUrl(currentMediaBlobUrl);
            currentMediaBlobUrl = null;
        }

        // Close previous active media stream
        stopActiveMediaHeartbeat();
        currentStreamingItem = null;
        currentStreamingTargetEntry = null;
        currentStreamingMime = null;
        stopActiveMediaHeartbeat();
        currentStreamingItem = null;
        currentStreamingTargetEntry = null;
        currentStreamingMime = null;
        if (activeMediaStreamId) {
            if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
                try {
                    navigator.serviceWorker.controller.postMessage({
                        type: 'CLOSE_MEDIA_STREAM',
                        streamId: activeMediaStreamId
                    });
                } catch (_) {}
            }
            if (activeMediaChannel) {
                try { activeMediaChannel.port1.close(); } catch (_) {}
                activeMediaChannel = null;
            }
            activeMediaStreamId = null;
        }
        if (activeMediaChunkCache) {
            if (typeof activeMediaChunkCache.clear === 'function') activeMediaChunkCache.clear();
            activeMediaChunkCache = null;
        }

        currentMediaBlob = null;
        currentMediaFilename = item.name;

        // Reset transforms
        resetVideoTransforms();
        resetVideoZoom();
        clearMediaABLoop();
        currentMediaBookmarks = [];
        renderMediaBookmarks();
    }

    function showCinemaVideo() {
        const v = document.getElementById('cinema-video');
        const a = document.getElementById('cinema-audio');
        if (v) {
            v.classList.remove('d-none');
            v.style.display = 'block';
        }
        if (a) {
            try { a.pause(); } catch (_) {}
            a.classList.add('d-none');
            a.style.display = 'none';
            a.removeAttribute('src');
            try { a.load(); } catch (_) {}
        }
    }

    function showCinemaAudio() {
        const v = document.getElementById('cinema-video');
        const a = document.getElementById('cinema-audio');
        if (a) {
            a.classList.remove('d-none');
            a.style.display = 'block';
        }
        if (v) {
            try { v.pause(); } catch (_) {}
            v.classList.add('d-none');
            v.style.display = 'none';
            v.removeAttribute('src');
            try { v.load(); } catch (_) {}
        }
    }

    /**
     * Update media player modal title, counter, badges, and loader state.
     */
    function _updateMediaModalHeaderState(modal, item, index) {
        const badge = document.getElementById('media-modal-badge');
        const title = document.getElementById('media-modal-title');
        const counter = document.getElementById('media-modal-counter');
        const prevBtn = document.getElementById('btn-media-prev');
        const nextBtn = document.getElementById('btn-media-next');
        const loader = document.getElementById('media-loading-indicator');
        const loaderText = document.getElementById('media-loading-text');

        modal.classList.remove('d-none');
        modal.style.display = 'flex';
        modal.classList.remove('cinema-ui--hidden');
        if (loader && item && item.size > 0) {
            loader.classList.remove('d-none');
            loader.style.display = 'flex';
        }
        if (loaderText) loaderText.textContent = `Buffering ${item.name}…`;

        if (title) title.textContent = item.name;
        if (counter) counter.textContent = `${index + 1} / ${currentMediaPlaylist.length}`;
        if (badge) {
            badge.textContent = item.category === 'video' ? '🎬 Video' : '🎵 Audio';
            badge.className = 'media-type-badge ' + (item.category === 'video' ? 'badge-video' : 'badge-audio');
        }

        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) nextBtn.disabled = index === currentMediaPlaylist.length - 1;
    }

    async function playMediaByIndex(index) {
        if (!currentMediaPlaylist || index < 0 || index >= currentMediaPlaylist.length) return;
        currentMediaIndex = index;
        const item = currentMediaPlaylist[index];

        const isMobilePhone = (window.innerWidth <= 768 && window.innerHeight <= 950) ||
            (typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.userAgentData && navigator.userAgentData.mobile)));

        // Phase 2 Directive 5: 2.5 GB Phone Memory Guardrail is enforced conditionally in setupDirectBlobPlayback

        const v3Vault = global.currentV3Vault;
        const targetEntry = _resolveMediaTargetEntry(item, v3Vault);

        const modal = document.getElementById('vault-media-modal');
        const videoEl = document.getElementById('cinema-video');
        const audioEl = document.getElementById('cinema-audio');

        if (!modal || (!global.currentDecryptedZip && !v3Vault)) return;

        _resetMediaPlaybackElements(videoEl, audioEl, item);
        _updateMediaModalHeaderState(modal, item, index);

        // 1. Check On-Demand Range Streaming Path
        if (canStreamRange(item)) {
            await setupRangeStreaming(videoEl, item, targetEntry);
            return;
        }

        // 2. Direct Blob In-Memory Fallback
        await setupDirectBlobPlayback(item);
    }

    async function setupRangeStreaming(videoElOrItem, itemOrTargetEntry, maybeTargetEntry) {
        let videoEl = null;
        let item = null;
        let targetEntry = null;

        if (videoElOrItem && (videoElOrItem.tagName === 'VIDEO' || videoElOrItem.nodeType === 1)) {
            videoEl = videoElOrItem;
            item = itemOrTargetEntry;
            targetEntry = maybeTargetEntry || (item ? (item.entry || item) : {});
        } else {
            videoEl = document.getElementById('cinema-video');
            item = videoElOrItem;
            targetEntry = itemOrTargetEntry || (item ? (item.entry || item) : {});
        }

        const audioEl = document.getElementById('cinema-audio');
        const loader = document.getElementById('media-loading-indicator');
        const loaderText = document.getElementById('media-loading-text');

        try {
            if (loaderText) loaderText.textContent = `Streaming ${item.name} via on-demand HTTP 206…`;
            activeMediaStreamId = 'stream_' + Date.now() + '_' + Math.random().toString(36).slice(2);
            activeMediaChannel = new MessageChannel();
            activeMediaChunkCache = (typeof StreamUnpacker !== 'undefined' && typeof StreamUnpacker.createBoundedChunkCache === 'function')
                ? StreamUnpacker.createBoundedChunkCache(6)
                : new Map();

            currentStreamingItem = item;
            currentStreamingTargetEntry = targetEntry;
            const streamMime = item.mimeType || (item.category === 'video' ? 'video/mp4' : 'audio/mp3');
            currentStreamingMime = streamMime;

            bindStreamChannelPort(activeMediaChannel.port1, targetEntry);

            let swTarget = (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) || null;
            if (!swTarget && typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.ready) {
                const registration = await navigator.serviceWorker.ready;
                swTarget = registration ? registration.active : null;
            }
            if (!swTarget) {
                throw new Error('Service Worker controller is not available for media range streaming');
            }

            swTarget.postMessage({
                type: 'REGISTER_MEDIA_STREAM',
                streamId: activeMediaStreamId,
                fileSize: item.size,
                mimeType: streamMime,
                filename: item.name
            }, [activeMediaChannel.port2]);

            startActiveMediaHeartbeat();

            const streamUrl = `/_stream_media?id=${encodeURIComponent(activeMediaStreamId)}&filename=${encodeURIComponent(item.name)}`;
            currentMediaBlobUrl = streamUrl;
            currentMediaBlob = null;
            currentMediaFilename = item.name;

            const speedSelect = document.getElementById('media-speed-select');
            const rate = parseFloat(speedSelect?.value || '1');
            const toolsBar = document.getElementById('media-tools-bar');
            const snapBtn = document.getElementById('btn-media-snapshot');
            const fitBtn = document.getElementById('btn-media-fit');
            const pipBtn = document.getElementById('btn-media-pip');
            const stepBackBtn = document.getElementById('btn-media-step-back');
            const stepFwdBtn = document.getElementById('btn-media-step-fwd');
            const btnToggleTools = document.getElementById('btn-toggle-tools');
            if (btnToggleTools) {
                btnToggleTools.style.display = item.category === 'video' ? 'inline-flex' : 'none';
                btnToggleTools.classList.remove('is-active');
                btnToggleTools.innerHTML = '🎛️ Studio ▾';
            }
            if (toolsBar) {
                toolsBar.classList.remove('is-open');
                if (window.innerWidth <= 768) {
                    toolsBar.classList.add('is-collapsed');
                }
            }

            if (item.category === 'video' && videoEl) {
                showCinemaVideo();
                videoEl.className = 'media-player-element' + (currentMediaFitCover ? ' media-player-element--cover' : '');
                videoEl.src = streamUrl;
                videoEl.playbackRate = rate;
                resetVideoTransforms();
                if (toolsBar) toolsBar.style.display = 'flex';
                if (snapBtn) snapBtn.style.display = 'inline-flex';
                if (fitBtn) fitBtn.style.display = 'inline-flex';
                if (pipBtn) pipBtn.style.display = 'inline-flex';
                if (stepBackBtn) stepBackBtn.style.display = 'inline-flex';
                if (stepFwdBtn) stepFwdBtn.style.display = 'inline-flex';
                videoEl.load();
                await playWithErrorSurface(videoEl);
            } else if (audioEl) {
                showCinemaAudio();
                audioEl.className = 'media-player-element';
                audioEl.src = streamUrl;
                audioEl.playbackRate = rate;
                if (toolsBar) toolsBar.style.display = 'none';
                if (snapBtn) snapBtn.style.display = 'none';
                if (fitBtn) fitBtn.style.display = 'none';
                if (pipBtn) pipBtn.style.display = 'none';
                if (stepBackBtn) stepBackBtn.style.display = 'none';
                if (stepFwdBtn) stepFwdBtn.style.display = 'none';
                audioEl.load();
                await playWithErrorSurface(audioEl);
            }

            if (loader) {
                loader.classList.add('d-none');
                loader.style.display = 'none';
            }
            resetCinemaInactivityTimer();
        } catch (err) {
            console.warn('[ZevSafe Range Stream Fallback]', err);
            await setupDirectBlobPlayback(item);
        }
    }

    async function setupDirectBlobPlayback(item) {
        // Phase 2 Directive 5: 2.5 GB Phone Memory Guardrail (applies ONLY to memory buffering fallback)
        const isMobilePhone = (window.innerWidth <= 768 && window.innerHeight <= 950) ||
            (typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.userAgentData && navigator.userAgentData.mobile)));
        if (isMobilePhone && item.size > 2.5 * 1024 * 1024 * 1024) {
            showToast('⚠️ File exceeds 2.5 GB mobile memory limit. Use desktop or a v3 vault for streaming.', 'warning');
            const loaderText = document.getElementById('media-loading-text');
            if (loaderText) loaderText.textContent = 'File exceeds phone memory limit (2.5 GB)';
            const loader = document.getElementById('media-loading-indicator');
            if (loader) { loader.classList.add('d-none'); loader.style.display = 'none'; }
            if (item.category === 'video') showCinemaVideo();
            else showCinemaAudio();
            return;
        }

        const videoEl = document.getElementById('cinema-video');
        const audioEl = document.getElementById('cinema-audio');
        const loader = document.getElementById('media-loading-indicator');
        const loaderText = document.getElementById('media-loading-text');

        try {
            if (loaderText) loaderText.textContent = `Extracting ${item.name}…`;
            let rawBlob = null;
            if (typeof global.getDecryptedFileBlob === 'function') {
                rawBlob = await global.getDecryptedFileBlob(item.path);
            } else {
                throw new Error('getDecryptedFileBlob function is not available.');
            }

            currentMediaBlob = new Blob([rawBlob], { type: item.mimeType });
            if (typeof global.createTrackedBlobUrl === 'function') {
                currentMediaBlobUrl = global.createTrackedBlobUrl(currentMediaBlob);
            } else {
                currentMediaBlobUrl = URL.createObjectURL(currentMediaBlob);
            }

            if (item.category === 'video' && videoEl) {
                showCinemaVideo();
                videoEl.className = 'media-player-element' + (currentMediaFitCover ? ' media-player-element--cover' : '');
                videoEl.src = currentMediaBlobUrl;
                videoEl.load();
                await playWithErrorSurface(videoEl);
            } else if (audioEl) {
                showCinemaAudio();
                audioEl.className = 'media-player-element';
                audioEl.src = currentMediaBlobUrl;
                audioEl.load();
                await playWithErrorSurface(audioEl);
            }

            if (loader) {
                loader.classList.add('d-none');
                loader.style.display = 'none';
            }
            resetCinemaInactivityTimer();
        } catch (err) {
            if (loader) loader.style.display = 'none';
            showToast(`Failed to load ${item.name}: ${err.message}`, 'error');
        }
    }

    function openMediaPlayerByPath(filePath) {
        // Synchronize with active vault playlist if global updated or current playlist is empty
        if (Array.isArray(global.currentMediaPlaylist) && global.currentMediaPlaylist.length > 0) {
            currentMediaPlaylist = [...global.currentMediaPlaylist];
        } else if (Array.isArray(global.currentDecryptedFileList)) {
            currentMediaPlaylist = [];
            for (const fileItem of global.currentDecryptedFileList) {
                const mediaCat = (typeof global.getMediaCategory === 'function')
                    ? global.getMediaCategory(fileItem.name)
                    : (/.(mp4|webm|mov|mkv)$/i.test(fileItem.name) ? 'video' : (/.(mp3|wav|ogg|m4a|flac)$/i.test(fileItem.name) ? 'audio' : null));
                if (mediaCat) {
                    const v3Vault = global.currentV3Vault;
                    const catalogEntry = fileItem.entry || (v3Vault && v3Vault.catalog && Array.isArray(v3Vault.catalog.files)
                        ? v3Vault.catalog.files.find(f => f.path === fileItem.path || f.name === fileItem.name)
                        : null);
                    currentMediaPlaylist.push({
                        ...(catalogEntry || {}),
                        path: fileItem.path,
                        name: fileItem.name,
                        category: mediaCat,
                        mimeType: fileItem.mimeType || (typeof global.getMediaMimeType === 'function' ? global.getMediaMimeType(fileItem.name) : (mediaCat === 'video' ? 'video/mp4' : 'audio/mp3')),
                        size: fileItem.size,
                        entry: catalogEntry || fileItem.entry
                    });
                }
            }
        }
        let idx = currentMediaPlaylist.findIndex(f => f.path === filePath);
        if (idx === -1 && Array.isArray(global.currentDecryptedFileList)) {
            const fileItem = global.currentDecryptedFileList.find(f => f.path === filePath);
            if (fileItem) {
                const mediaCat = (typeof global.getMediaCategory === 'function')
                    ? global.getMediaCategory(fileItem.name)
                    : (/.(mp4|webm|mov|mkv)$/i.test(fileItem.name) ? 'video' : (/.(mp3|wav|ogg|m4a|flac)$/i.test(fileItem.name) ? 'audio' : 'video'));
                const v3Vault = global.currentV3Vault;
                const catalogEntry = fileItem.entry || (v3Vault && v3Vault.catalog && Array.isArray(v3Vault.catalog.files)
                    ? v3Vault.catalog.files.find(f => f.path === fileItem.path || f.name === fileItem.name)
                    : null);
                const mediaObj = {
                    ...(catalogEntry || {}),
                    path: fileItem.path,
                    name: fileItem.name,
                    category: mediaCat,
                    mimeType: fileItem.mimeType || (typeof global.getMediaMimeType === 'function' ? global.getMediaMimeType(fileItem.name) : (mediaCat === 'video' ? 'video/mp4' : 'audio/mp3')),
                    size: fileItem.size,
                    entry: catalogEntry || fileItem.entry
                };
                currentMediaPlaylist.push(mediaObj);
                idx = currentMediaPlaylist.length - 1;
            }
        }
        if (idx !== -1) {
            playMediaByIndex(idx);
        }
    }

    function closeMediaPlayer() {
        clearCinemaInactivityTimer();
        const modal = document.getElementById('vault-media-modal');
        const videoEl = document.getElementById('cinema-video');
        const audioEl = document.getElementById('cinema-audio');
        const loader = document.getElementById('media-loading-indicator');

        if (modal) {
            modal.classList.add('d-none');
            modal.style.display = 'none';
        }
        if (loader) {
            loader.classList.add('d-none');
            loader.style.display = 'none';
        }

        if (videoEl) {
            if (typeof videoEl.pause === 'function') videoEl.pause();
            if (typeof videoEl.removeAttribute === 'function') videoEl.removeAttribute('src');
            if (typeof videoEl.load === 'function') videoEl.load();
            videoEl.classList.add('d-none');
            videoEl.style.display = 'none';
        }
        if (audioEl) {
            if (typeof audioEl.pause === 'function') audioEl.pause();
            if (typeof audioEl.removeAttribute === 'function') audioEl.removeAttribute('src');
            if (typeof audioEl.load === 'function') audioEl.load();
            audioEl.classList.add('d-none');
            audioEl.style.display = 'none';
        }

        if (currentMediaBlobUrl) {
            if (currentMediaBlobUrl.startsWith('blob:') && typeof global.revokeTrackedBlobUrl === 'function') {
                global.revokeTrackedBlobUrl(currentMediaBlobUrl);
            }
            currentMediaBlobUrl = null;
        }

        stopActiveMediaHeartbeat();
        currentStreamingItem = null;
        currentStreamingTargetEntry = null;
        currentStreamingMime = null;
        if (activeMediaStreamId) {
            if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
                try {
                    navigator.serviceWorker.controller.postMessage({
                        type: 'CLOSE_MEDIA_STREAM',
                        streamId: activeMediaStreamId
                    });
                } catch (_) {}
            }
            if (activeMediaChannel) {
                try { activeMediaChannel.port1.close(); } catch (_) {}
                activeMediaChannel = null;
            }
            activeMediaStreamId = null;
        }
        if (activeMediaChunkCache) {
            if (typeof activeMediaChunkCache.clear === 'function') activeMediaChunkCache.clear();
            activeMediaChunkCache = null;
        }

        currentMediaBlob = null;
        currentMediaFilename = '';

        resetVideoTransforms();
        resetVideoZoom();
        clearMediaABLoop();
        currentMediaBookmarks = [];
        renderMediaBookmarks();

        if (ambientAnimFrameId) {
            cancelAnimationFrame(ambientAnimFrameId);
            ambientAnimFrameId = null;
        }
        currentMediaAmbientGlow = false;
        const ambientBtn = document.getElementById('btn-media-ambient');
        if (ambientBtn) {
            ambientBtn.textContent = '✨ Ambient: Off';
            ambientBtn.style.background = '';
            ambientBtn.style.color = '';
        }
        const ambientCanvas = document.getElementById('cinema-ambient-canvas');
        if (ambientCanvas) ambientCanvas.classList.remove('active');

        if (currentMediaGainNode) currentMediaGainNode.gain.value = 1.0;
        currentMediaAudioBoost = false;
        const boostBtn = document.getElementById('btn-media-audio-boost');
        if (boostBtn) boostBtn.classList.remove('is-active');

        if (currentMediaVocalFilter) currentMediaVocalFilter.gain.value = 0.0;
        currentMediaVocalClarity = false;
        const vocalBtn = document.getElementById('btn-media-vocal-clarity');
        if (vocalBtn) vocalBtn.classList.remove('is-active');

        const progressEl = document.getElementById('media-timeline-progress');
        const thumbEl = document.getElementById('media-timeline-thumb');
        const bufferEl = document.getElementById('media-timeline-buffer');
        if (progressEl) progressEl.style.width = '0%';
        if (thumbEl) thumbEl.style.left = '0%';
        if (bufferEl) bufferEl.style.width = '0%';

        updatePlayBtnUI(false);

        const hotkeysModal = document.getElementById('media-hotkeys-modal');
        if (hotkeysModal) {
            hotkeysModal.classList.add('d-none');
            hotkeysModal.style.display = 'none';
        }

        const modalContainer = document.querySelector('.media-modal-container');
        if (modalContainer) modalContainer.classList.remove('media-modal-container--theater');
        isTheaterMode = false;
        const theaterBtn = document.getElementById('btn-media-theater');
        if (theaterBtn) {
            theaterBtn.textContent = '🔲 Theater';
            theaterBtn.classList.remove('is-active');
        }

        const specsBadge = document.getElementById('media-forensic-specs');
        if (specsBadge) {
            specsBadge.style.display = 'none';
            specsBadge.textContent = '';
        }

        const bar = document.getElementById('media-tools-bar');
        if (bar) {
            bar.classList.remove('is-collapsed');
            bar.classList.remove('is-open');
        }
        const btnToggleTools = document.getElementById('btn-toggle-tools');
        if (btnToggleTools) {
            btnToggleTools.classList.remove('is-active');
            btnToggleTools.innerHTML = '🎛️ Studio ▾';
        }
    }

    // =====================================================
    // 🔍 FORENSIC VIDEO STUDIO & TOOLS
    // =====================================================

    function stepVideoFrame(frames) {
        const video = document.getElementById('cinema-video');
        if (!video || !video.duration) return;
        video.pause();
        updatePlayBtnUI(false);
        const frameDelta = (1 / 30) * frames;
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + frameDelta));
        updateTimelineScrubber(video);
        showToast(frames > 0 ? '⯮ Step forward 1 frame' : '⯬ Step back 1 frame', 'info');
    }

    function captureVideoFrameSnapshot() {
        const video = document.getElementById('cinema-video');
        if (!video || !video.videoWidth || !video.videoHeight) {
            showToast('⚠️ No active video frame to capture.', 'warn');
            return;
        }
        try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            canvas.toBlob((blob) => {
                if (!blob) return;
                const baseName = currentMediaFilename ? currentMediaFilename.replace(/\.[^/.]+$/, '') : 'Snapshot';
                const timeStr = Math.floor(video.currentTime);
                const snapName = `${baseName}_frame_${timeStr}s.png`;

                if (global.currentV3Vault && global.currentV3Vault.editedFiles) {
                    global.currentV3Vault.editedFiles.set(`snapshots/${snapName}`, blob);
                }

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = snapName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);

                showToast(`📸 Saved frame snapshot: "${snapName}"`, 'success');
            }, 'image/png');
        } catch (err) {
            showToast(`Failed to capture frame snapshot: ${err.message}`, 'error');
        }
    }

    function setVideoZoom(zoom) {
        currentMediaZoom = Math.max(1.0, Math.min(5.0, zoom));
        if (currentMediaZoom === 1.0) {
            currentMediaPanX = 0;
            currentMediaPanY = 0;
        }
        applyVideoTransforms();
        showCinemaZoomBadge();
    }

    function nudgeVideoZoom(delta) {
        setVideoZoom(currentMediaZoom + delta);
    }

    function resetVideoZoom() {
        currentMediaZoom = 1.0;
        currentMediaPanX = 0;
        currentMediaPanY = 0;
        applyVideoTransforms();
        showCinemaZoomBadge();
    }

    function showCinemaZoomBadge() {
        const badge = document.getElementById('cinema-zoom-badge');
        const stage = document.getElementById('cinema-video-stage');
        if (badge) {
            badge.textContent = `${Math.round(currentMediaZoom * 100)}%`;
            badge.style.opacity = currentMediaZoom > 1.0 ? '1' : '0';
        }
        if (stage) {
            stage.classList.toggle('is-zoomed', currentMediaZoom > 1.0);
        }
    }

    function applyVideoTransforms() {
        const video = document.getElementById('cinema-video');
        if (!video) return;

        let filterStr = '';
        if (currentMediaFilters.bright) filterStr += 'brightness(1.4) ';
        if (currentMediaFilters.contrast) filterStr += 'contrast(1.6) ';
        if (currentMediaFilters.invert) filterStr += 'invert(1) ';
        if (currentMediaFilters.cctv) filterStr += 'grayscale(1) contrast(2) hue-rotate(90deg) ';

        video.style.filter = filterStr.trim();
        video.style.transform = `translate(${currentMediaPanX}px, ${currentMediaPanY}px) scale(${currentMediaZoom}) rotate(${currentMediaRotation}deg) scale(${currentMediaFlipH}, ${currentMediaFlipV})`;
    }

    function resetVideoTransforms() {
        currentMediaRotation = 0;
        currentMediaFlipH = 1;
        currentMediaFlipV = 1;
        currentMediaFilters = { bright: false, contrast: false, invert: false, cctv: false };
        ['bright', 'contrast', 'invert', 'cctv'].forEach(f => {
            const btn = document.getElementById(`btn-filter-${f}`);
            if (btn) btn.classList.remove('is-active');
        });
        resetVideoZoom();
        applyVideoTransforms();
    }

    function rotateVideo(deg) {
        currentMediaRotation = (currentMediaRotation + deg + 360) % 360;
        applyVideoTransforms();
        showToast(`↺ Rotation: ${currentMediaRotation}°`, 'info');
    }

    function flipVideo(axis) {
        if (axis === 'h') currentMediaFlipH *= -1;
        else currentMediaFlipV *= -1;
        applyVideoTransforms();
        showToast(axis === 'h' ? '⇄ Flipped Horizontally' : '⇅ Flipped Vertically', 'info');
    }

    function toggleVideoFilter(type) {
        if (currentMediaFilters[type] !== undefined) {
            currentMediaFilters[type] = !currentMediaFilters[type];
            const btn = document.getElementById(`btn-filter-${type}`);
            if (btn) btn.classList.toggle('is-active', currentMediaFilters[type]);
            applyVideoTransforms();
            showToast(`${type.toUpperCase()} filter: ${currentMediaFilters[type] ? 'ON' : 'OFF'}`, 'info');
        }
    }

    // A-B Segment Looper
    function setMediaLoopPointA() {
        const media = getActiveCinemaMedia();
        if (!media || !media.duration) return;
        mediaLoopPointA = media.currentTime;
        if (mediaLoopPointB !== null && mediaLoopPointB <= mediaLoopPointA) {
            mediaLoopPointB = null;
        }
        updateABLoopUI(media);
        showToast(`[A] Loop Point A set at ${formatTime(mediaLoopPointA)}`, 'info');
    }

    function setMediaLoopPointB() {
        const media = getActiveCinemaMedia();
        if (!media || !media.duration) return;
        if (mediaLoopPointA === null) {
            mediaLoopPointA = 0;
        }
        if (media.currentTime <= mediaLoopPointA) {
            showToast('⚠️ Loop Point B must be after Point A.', 'warn');
            return;
        }
        mediaLoopPointB = media.currentTime;
        updateABLoopUI(media);
        showToast(`[B] Loop Point B set at ${formatTime(mediaLoopPointB)}. A-B Loop Active.`, 'success');
    }

    function clearMediaABLoop() {
        mediaLoopPointA = null;
        mediaLoopPointB = null;
        updateABLoopUI();
        showToast('✕ A-B Loop cleared', 'info');
    }

    function updateABLoopUI(media) {
        const markerA = document.getElementById('media-timeline-marker-a');
        const markerB = document.getElementById('media-timeline-marker-b');
        const rangeEl = document.getElementById('media-timeline-ab-range');
        const m = media || getActiveCinemaMedia();
        if (!m || !m.duration) return;

        if (mediaLoopPointA !== null) {
            const pctA = (mediaLoopPointA / m.duration) * 100;
            if (markerA) {
                markerA.style.display = 'block';
                markerA.style.left = `${pctA}%`;
                markerA.title = `Loop Point A: ${formatTime(mediaLoopPointA)}`;
            }
        } else if (markerA) {
            markerA.style.display = 'none';
        }

        if (mediaLoopPointB !== null) {
            const pctB = (mediaLoopPointB / m.duration) * 100;
            if (markerB) {
                markerB.style.display = 'block';
                markerB.style.left = `${pctB}%`;
                markerB.title = `Loop Point B: ${formatTime(mediaLoopPointB)}`;
            }
        } else if (markerB) {
            markerB.style.display = 'none';
        }

        if (rangeEl) {
            if (mediaLoopPointA !== null && mediaLoopPointB !== null) {
                const startPct = (mediaLoopPointA / m.duration) * 100;
                const endPct = (mediaLoopPointB / m.duration) * 100;
                rangeEl.style.display = 'block';
                rangeEl.style.left = `${startPct}%`;
                rangeEl.style.width = `${Math.max(0, endPct - startPct)}%`;
            } else {
                rangeEl.style.display = 'none';
            }
        }
    }

    // Timestamp Bookmarks
    function addMediaBookmark() {
        const media = getActiveCinemaMedia();
        if (!media || !media.duration) return;
        const t = media.currentTime;
        currentMediaBookmarks.push({ time: t, label: `Bookmark at ${formatTime(t)}` });
        currentMediaBookmarks.sort((a, b) => a.time - b.time);
        renderMediaBookmarks();
        showToast(`📌 Bookmark added at ${formatTime(t)}`, 'success');
    }

    function renderMediaBookmarks() {
        const wrap = document.getElementById('media-timeline-bookmarks-wrap');
        const media = getActiveCinemaMedia();
        if (!wrap || !media || !media.duration) {
            if (wrap) wrap.innerHTML = '';
            return;
        }
        wrap.innerHTML = '';
        currentMediaBookmarks.forEach((b) => {
            const pin = document.createElement('div');
            pin.className = 'media-timeline-bookmark-pin';
            pin.style.left = `${(b.time / media.duration) * 100}%`;
            pin.title = b.label;
            pin.addEventListener('click', (e) => {
                e.stopPropagation();
                media.currentTime = b.time;
                showToast(`Jumped to ${b.label}`, 'info');
            });
            wrap.appendChild(pin);
        });
    }

    // Audio Boost 200% & Vocal Clarity EQ
    function ensureAudioContext(media) {
        if (!currentMediaAudioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return null;
            currentMediaAudioCtx = new AudioContextClass();
        }
        if (!currentMediaAudioSource && currentMediaAudioCtx && media) {
            try {
                currentMediaAudioSource = currentMediaAudioCtx.createMediaElementSource(media);
                currentMediaGainNode = currentMediaAudioCtx.createGain();
                currentMediaGainNode.gain.value = 1.0;
                currentMediaAudioSource.connect(currentMediaGainNode);
                currentMediaGainNode.connect(currentMediaAudioCtx.destination);
            } catch (e) {
                console.warn('[AudioContext Binding]', e);
            }
        }
        if (currentMediaAudioCtx && currentMediaAudioCtx.state === 'suspended') {
            currentMediaAudioCtx.resume().catch(() => {});
        }
        return currentMediaAudioCtx;
    }

    function toggleAudioGainBoost() {
        const media = getActiveCinemaMedia();
        if (!media) return;
        ensureAudioContext(media);
        if (!currentMediaGainNode) {
            showToast('⚠️ WebAudio GainNode unavailable in this browser.', 'warn');
            return;
        }
        currentMediaAudioBoost = !currentMediaAudioBoost;
        currentMediaGainNode.gain.value = currentMediaAudioBoost ? 2.0 : 1.0;
        const btn = document.getElementById('btn-media-audio-boost');
        if (btn) btn.classList.toggle('is-active', currentMediaAudioBoost);
        showToast(currentMediaAudioBoost ? '⚡ Audio Boost 200% Active' : '⚡ Audio Boost: Normal (100%)', 'info');
    }

    function toggleVocalClarity() {
        const media = getActiveCinemaMedia();
        if (!media) return;
        ensureAudioContext(media);
        if (!currentMediaAudioCtx || !currentMediaAudioSource) {
            showToast('⚠️ WebAudio Equalizer unavailable in this browser.', 'warn');
            return;
        }
        if (!currentMediaVocalFilter) {
            currentMediaVocalFilter = currentMediaAudioCtx.createBiquadFilter();
            currentMediaVocalFilter.type = 'peaking';
            currentMediaVocalFilter.frequency.value = 2500;
            currentMediaVocalFilter.Q.value = 1.4;
            currentMediaVocalFilter.gain.value = 0.0;

            try {
                currentMediaAudioSource.disconnect();
                currentMediaAudioSource.connect(currentMediaVocalFilter);
                currentMediaVocalFilter.connect(currentMediaGainNode || currentMediaAudioCtx.destination);
            } catch (e) {
                console.warn('[Vocal Filter Binding]', e);
            }
        }

        currentMediaVocalClarity = !currentMediaVocalClarity;
        currentMediaVocalFilter.gain.value = currentMediaVocalClarity ? 7.5 : 0.0;
        const btn = document.getElementById('btn-media-vocal-clarity');
        if (btn) btn.classList.toggle('is-active', currentMediaVocalClarity);
        showToast(currentMediaVocalClarity ? '🎙️ Vocal Clarity EQ: Speech Boost Active' : '🎙️ Vocal Clarity EQ: Off', 'info');
    }

    // Ambient Backlight Glow
    function toggleAmbientGlow() {
        currentMediaAmbientGlow = !currentMediaAmbientGlow;
        const btn = document.getElementById('btn-media-ambient');
        const canvas = document.getElementById('cinema-ambient-canvas');

        if (btn) {
            btn.textContent = currentMediaAmbientGlow ? '✨ Ambient: On' : '✨ Ambient: Off';
            btn.style.background = currentMediaAmbientGlow ? 'rgba(139, 92, 246, 0.3)' : '';
            btn.style.color = currentMediaAmbientGlow ? '#c084fc' : '';
        }
        if (canvas) canvas.classList.toggle('active', currentMediaAmbientGlow);

        if (currentMediaAmbientGlow) {
            updateAmbientGlow();
            showToast('✨ Immersive Ambient Glow enabled', 'info');
        } else if (ambientAnimFrameId) {
            cancelAnimationFrame(ambientAnimFrameId);
            ambientAnimFrameId = null;
        }
    }

    function updateAmbientGlow() {
        if (!currentMediaAmbientGlow) return;
        const video = document.getElementById('cinema-video');
        const canvas = document.getElementById('cinema-ambient-canvas');
        if (!video || !canvas || video.paused || video.ended || !video.videoWidth) {
            ambientAnimFrameId = requestAnimationFrame(updateAmbientGlow);
            return;
        }
        try {
            const ctx = canvas.getContext('2d');
            if (canvas.width !== 64 || canvas.height !== 36) {
                canvas.width = 64;
                canvas.height = 36;
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (_) {}
        ambientAnimFrameId = requestAnimationFrame(updateAmbientGlow);
    }

    // Scrubber update
    function updateTimelineScrubber(media) {
        if (!media || !media.duration) return;
        const progressEl = document.getElementById('media-timeline-progress');
        const thumbEl = document.getElementById('media-timeline-thumb');
        const bufferEl = document.getElementById('media-timeline-buffer');
        const timeDisplay = document.getElementById('media-time-display');

        const cur = media.currentTime;
        const dur = media.duration;
        const pct = Math.max(0, Math.min(100, (cur / dur) * 100));

        if (progressEl) progressEl.style.width = `${pct}%`;
        if (thumbEl) thumbEl.style.left = `${pct}%`;

        if (bufferEl && media.buffered && media.buffered.length > 0) {
            try {
                const bufEnd = media.buffered.end(media.buffered.length - 1);
                const bufPct = Math.max(0, Math.min(100, (bufEnd / dur) * 100));
                bufferEl.style.width = `${bufPct}%`;
            } catch (_) {}
        }

        if (timeDisplay) {
            if (currentMediaShowRemaining) {
                const rem = Math.max(0, dur - cur);
                timeDisplay.textContent = `-${formatTime(rem)}`;
            } else {
                timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
            }
        }
    }

    function showCinemaCenterRipple(icon) {
        const r = document.getElementById('cinema-center-ripple');
        if (!r) return;
        r.textContent = icon;
        r.classList.add('active');
        setTimeout(() => r.classList.remove('active'), 350);
    }

    function showCinemaGestureBadge(side, text) {
        const badge = document.getElementById(`cinema-gesture-${side}`);
        if (!badge) return;
        badge.textContent = text;
        badge.classList.add('show');
        setTimeout(() => badge.classList.remove('show'), 400);
    }

    function nudgePlaybackSpeed(direction) {
        const select = document.getElementById('media-speed-select');
        if (!select) return;
        const options = Array.from(select.options);
        const currIdx = select.selectedIndex;
        const nextIdx = Math.max(0, Math.min(options.length - 1, currIdx + direction));
        if (nextIdx !== currIdx) {
            select.selectedIndex = nextIdx;
            select.dispatchEvent(new Event('change'));
            showToast(`Playback speed: ${options[nextIdx].text}`, 'info');
        }
    }

    function toggleTheaterMode() {
        const modalContainer = document.querySelector('.media-modal-container');
        const theaterBtn = document.getElementById('btn-media-theater');
        if (!modalContainer) return;
        isTheaterMode = !isTheaterMode;
        modalContainer.classList.toggle('media-modal-container--theater', isTheaterMode);
        if (theaterBtn) {
            theaterBtn.textContent = isTheaterMode ? '🔲 Standard' : '🔲 Theater';
            theaterBtn.classList.toggle('is-active', isTheaterMode);
        }
        showToast(isTheaterMode ? '🔲 Expansive Theater Mode: Active' : '🔲 Theater Mode: Standard View', 'info');
    }

    function toggleHotkeysModal() {
        const modal = document.getElementById('media-hotkeys-modal');
        if (!modal) return;
        const isHidden = modal.classList.contains('d-none') || modal.style.display === 'none' || !modal.style.display;
        if (isHidden) {
            modal.classList.remove('d-none');
            modal.style.display = 'flex';
        } else {
            modal.classList.add('d-none');
            modal.style.display = 'none';
        }
    }

    // Fullscreen with Automatic Landscape Orientation Lock & iOS CSS Fallback (Directive 4)
    async function requestPlayerFullscreen() {
        const container = document.querySelector('.media-modal-container');
        if (!container) return;
        let nativeSuccess = false;
        const req = container.requestFullscreen || container.webkitRequestFullscreen || container.mozRequestFullScreen || container.msRequestFullscreen;
        if (req && document.fullscreenEnabled !== false) {
            try {
                await req.call(container);
                nativeSuccess = true;
            } catch (_) {}
        }
        if (!nativeSuccess) {
            container.classList.add('media-fullscreen--pseudo');
        }
        try {
            if (screen.orientation && typeof screen.orientation.lock === 'function') {
                screen.orientation.lock('landscape').catch(() => {});
            }
        } catch (_) {}
    }

    async function exitPlayerFullscreen() {
        const container = document.querySelector('.media-modal-container');
        if (container) container.classList.remove('media-fullscreen--pseudo');
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exit && document.fullscreenElement) {
            try { await exit.call(document); } catch (_) {}
        }
        try {
            if (screen.orientation && typeof screen.orientation.unlock === 'function') {
                screen.orientation.unlock();
            }
        } catch (_) {}
    }

    function updateVideoForensicSpecs(video, isStream) {
        const specsEl = document.getElementById('media-forensic-specs');
        if (!specsEl || !video) return;
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return;

        let resLabel = `${w}×${h}`;
        if (w >= 3840 || h >= 2160) resLabel = '4K UHD';
        else if (w >= 2560 || h >= 1440) resLabel = '2K QHD';
        else if (w >= 1920 || h >= 1080) resLabel = '1080p FHD';
        else if (w >= 1280 || h >= 720) resLabel = '720p HD';
        else if (h >= 480) resLabel = '480p SD';

        const streamTag = isStream ? '⚡ Stream' : '💾 Buffer';
        specsEl.textContent = `${resLabel} · ${streamTag}`;
        specsEl.title = `Forensic Stream Specs: ${w}×${h} px · Pipeline: ${isStream ? 'HTTP 206 Partial Content Range Stream' : 'Buffered Memory Blob'}`;
        specsEl.style.display = 'inline-flex';
    }

    // =====================================================
    // 🖼️ IN-VAULT IMAGE LIGHTBOX VIEWER
    // =====================================================

    function applyImageTransform() {
        const img = document.getElementById('lightbox-image');
        const badge = document.getElementById('image-zoom-badge');
        if (img) {
            img.style.transform = `translate(${imagePanX}px, ${imagePanY}px) scale(${imageZoomLevel}) rotate(${imageRotationDeg}deg)`;
        }
        if (badge) {
            badge.textContent = `${Math.round(imageZoomLevel * 100)}%`;
        }
    }

    function resetImageZoom() {
        imageZoomLevel = 1.0;
        imageRotationDeg = 0;
        imagePanX = 0;
        imagePanY = 0;
        applyImageTransform();
    }

    function zoomImage(delta) {
        imageZoomLevel = Math.max(0.2, Math.min(5.0, +(imageZoomLevel + delta).toFixed(2)));
        if (imageZoomLevel <= 1.0) {
            imagePanX = 0;
            imagePanY = 0;
        }
        applyImageTransform();
    }

    function rotateImage(deg = 90) {
        imageRotationDeg = (imageRotationDeg + deg) % 360;
        applyImageTransform();
    }

    async function showImageByIndex(index) {
        if (!currentImagePlaylist || index < 0 || index >= currentImagePlaylist.length) return;
        currentImageIndex = index;
        const item = currentImagePlaylist[index];

        const modal = document.getElementById('vault-image-modal');
        const title = document.getElementById('image-modal-title');
        const counter = document.getElementById('image-modal-counter');
        const dimBadge = document.getElementById('image-dim-badge');
        const prevBtn = document.getElementById('btn-image-prev');
        const nextBtn = document.getElementById('btn-image-next');
        const img = document.getElementById('lightbox-image');

        if (!modal || !img) return;

        if (title) title.textContent = item.name;
        if (counter) counter.textContent = `${index + 1} / ${currentImagePlaylist.length}`;
        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) nextBtn.disabled = index === currentImagePlaylist.length - 1;
        if (dimBadge) dimBadge.textContent = '…';

        resetImageZoom();

        if (currentImageBlobUrl && currentImageBlobUrl.startsWith('blob:') && typeof global.revokeTrackedBlobUrl === 'function') {
            global.revokeTrackedBlobUrl(currentImageBlobUrl);
            currentImageBlobUrl = null;
        }

        try {
            let rawBlob = null;
            if (typeof global.getDecryptedFileBlob === 'function') {
                rawBlob = await global.getDecryptedFileBlob(item.path);
            } else {
                throw new Error('getDecryptedFileBlob function is not available.');
            }

            currentImageBlob = new Blob([rawBlob], { type: item.mimeType || 'image/jpeg' });
            if (typeof global.createTrackedBlobUrl === 'function') {
                currentImageBlobUrl = global.createTrackedBlobUrl(currentImageBlob);
            } else {
                currentImageBlobUrl = URL.createObjectURL(currentImageBlob);
            }

            img.onload = () => {
                if (dimBadge && img.naturalWidth && img.naturalHeight) {
                    dimBadge.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
                }
            };
            img.src = currentImageBlobUrl;
            modal.classList.remove('d-none');
            modal.style.display = 'flex';
        } catch (err) {
            showToast(`Failed to view image: ${err.message}`, 'error');
        }
    }

    function openImageViewerByPath(filePath) {
        if (global.ZevImageViewer && typeof global.ZevImageViewer.openImageViewerByPath === 'function') {
            return global.ZevImageViewer.openImageViewerByPath(filePath);
        }
        if (typeof require !== 'undefined') {
            try { require('./image-viewer.js'); } catch (_) {}
            if (global.ZevImageViewer && typeof global.ZevImageViewer.openImageViewerByPath === 'function') {
                return global.ZevImageViewer.openImageViewerByPath(filePath);
            }
        }
        if (!currentImagePlaylist || currentImagePlaylist.length === 0) {
            if (Array.isArray(global.currentImagePlaylist) && global.currentImagePlaylist.length > 0) {
                currentImagePlaylist = [...global.currentImagePlaylist];
            } else if (Array.isArray(global.currentDecryptedFileList)) {
                currentImagePlaylist = [];
                for (const fileItem of global.currentDecryptedFileList) {
                    const isPhoto = (typeof global.getFileCategory === 'function' && global.getFileCategory(fileItem.name) === 'photo') ||
                        /.(jpg|jpeg|png|gif|webp|svg|avif|bmp)$/i.test(fileItem.name || fileItem.path || '');
                    if (isPhoto) {
                        currentImagePlaylist.push({
                            path: fileItem.path,
                            name: fileItem.name,
                            size: fileItem.size,
                            mimeType: fileItem.mimeType,
                            entry: fileItem.entry || fileItem
                        });
                    }
                }
            }
        }
        let idx = currentImagePlaylist.findIndex(p => p.path === filePath);
        if (idx === -1 && Array.isArray(global.currentDecryptedFileList)) {
            const fileItem = global.currentDecryptedFileList.find(f => f.path === filePath);
            if (fileItem) {
                currentImagePlaylist.push({
                    path: fileItem.path,
                    name: fileItem.name,
                    size: fileItem.size,
                    mimeType: fileItem.mimeType,
                    entry: fileItem.entry || fileItem
                });
                idx = currentImagePlaylist.length - 1;
            }
        }
        if (idx !== -1) {
            showImageByIndex(idx);
        }
    }

    function closeImageViewer() {
        const modal = document.getElementById('vault-image-modal');
        const img = document.getElementById('lightbox-image');
        if (modal) {
            modal.classList.add('d-none');
            modal.style.display = 'none';
        }
        if (img) {
            img.removeAttribute('src');
        }
        if (currentImageBlobUrl && currentImageBlobUrl.startsWith('blob:') && typeof global.revokeTrackedBlobUrl === 'function') {
            global.revokeTrackedBlobUrl(currentImageBlobUrl);
            currentImageBlobUrl = null;
        }
        currentImageBlob = null;
        currentImageFilename = '';
    }

    // =====================================================
    // 🎛️ EVENT LISTENERS & USER INTERACTION WIRING
    // =====================================================

    function _initMediaModalBaseControls() {
        const mediaModal = document.getElementById('vault-media-modal');
        const closeMediaBtn = document.getElementById('btn-close-media');
        const mediaOpenTabBtn = document.getElementById('btn-media-open-tab');
        const mediaDlBtn = document.getElementById('btn-media-download');

        closeMediaBtn?.addEventListener('click', closeMediaPlayer);
        mediaModal?.addEventListener('click', (e) => {
            if (e.target.id === 'vault-media-modal') closeMediaPlayer();
        });

        mediaOpenTabBtn?.addEventListener('click', () => {
            if (currentMediaBlobUrl) {
                window.open(currentMediaBlobUrl, '_blank', 'noopener,noreferrer');
            }
        });

        mediaDlBtn?.addEventListener('click', async () => {
            if (currentMediaBlob && currentMediaFilename) {
                if (typeof global.triggerDownload === 'function') global.triggerDownload(currentMediaBlob, currentMediaFilename);
            } else if (currentMediaIndex >= 0 && currentMediaPlaylist && currentMediaPlaylist[currentMediaIndex]) {
                const item = currentMediaPlaylist[currentMediaIndex];
                try {
                    showToast(`Extracting ${item.name} for download…`, 'info');
                    const rawBlob = await global.getDecryptedFileBlob(item.path);
                    const blob = new Blob([rawBlob], { type: item.mimeType });
                    if (typeof global.triggerDownload === 'function') global.triggerDownload(blob, item.name);
                } catch (err) {
                    showToast(`Failed to download: ${err.message}`, 'error');
                }
            }
        });
    }

    function _initMediaElementSyncEvents() {
        ['cinema-video', 'cinema-audio'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('play', () => {
                updatePlayBtnUI(true);
                if (currentMediaAmbientGlow) updateAmbientGlow();
                resetCinemaInactivityTimer();
            });
            el.addEventListener('pause', () => {
                updatePlayBtnUI(false);
                clearCinemaInactivityTimer();
            });
            el.addEventListener('ended', () => {
                updatePlayBtnUI(false);
                clearCinemaInactivityTimer();
                if (currentMediaIsLooping) {
                    el.currentTime = 0;
                    playWithErrorSurface(el);
                    updatePlayBtnUI(true);
                } else if (currentMediaIndex < currentMediaPlaylist.length - 1) {
                    playMediaByIndex(currentMediaIndex + 1);
                }
            });
            el.addEventListener('timeupdate', () => {
                if (mediaLoopPointA !== null && mediaLoopPointB !== null && el.currentTime >= mediaLoopPointB) {
                    el.currentTime = mediaLoopPointA;
                    if (el.paused) playWithErrorSurface(el);
                }
                updateTimelineScrubber(el);
            });
            el.addEventListener('progress', () => {
                updateTimelineScrubber(el);
            });
            el.addEventListener('volumechange', () => updateVolumeMuteUI(el));
            el.addEventListener('loadedmetadata', () => {
                if (id === 'cinema-video') {
                    updateVideoForensicSpecs(el, !!activeMediaStreamId);
                } else {
                    const specsEl = document.getElementById('media-forensic-specs');
                    if (specsEl) {
                        specsEl.textContent = activeMediaStreamId ? 'Audio · ⚡ Range Stream' : 'Audio · 💾 Buffer';
                        specsEl.title = 'Audio Track Pipeline: ' + (activeMediaStreamId ? 'Instant Range Stream' : 'Buffered Memory');
                        specsEl.style.display = 'inline-flex';
                    }
                }
            });
        });
    }

    function _initMediaPlaybackAndVolumeControls() {
        const mediaModal = document.getElementById('vault-media-modal');
        if (mediaModal) {
            ['mousemove', 'pointerdown', 'touchstart', 'keydown'].forEach(ev => {
                mediaModal.addEventListener(ev, resetCinemaInactivityTimer, { passive: true });
            });
        }

        // Play/Pause
        document.getElementById('btn-media-play')?.addEventListener('click', () => {
            const media = getActiveCinemaMedia();
            if (!media) return;
            if (media.paused) {
                playWithErrorSurface(media);
                showCinemaCenterRipple('▶');
            } else {
                media.pause();
                showCinemaCenterRipple('⏸');
            }
        });

        // Mute
        document.getElementById('btn-media-mute')?.addEventListener('click', () => {
            const media = getActiveCinemaMedia();
            if (!media) return;
            media.muted = !media.muted;
            updateVolumeMuteUI(media);
        });

        // Volume slider
        document.getElementById('media-volume-slider')?.addEventListener('input', (e) => {
            const media = getActiveCinemaMedia();
            if (!media) return;
            const val = parseFloat(e.target.value);
            media.volume = val;
            if (val > 0 && media.muted) media.muted = false;
            else if (val === 0) media.muted = true;
            updateVolumeMuteUI(media);
        });

        // Prev / Next / Seek
        document.getElementById('btn-media-prev')?.addEventListener('click', () => {
            if (currentMediaIndex > 0) playMediaByIndex(currentMediaIndex - 1);
        });
        document.getElementById('btn-media-next')?.addEventListener('click', () => {
            if (currentMediaIndex < currentMediaPlaylist.length - 1) playMediaByIndex(currentMediaIndex + 1);
        });
        document.getElementById('btn-media-rewind10')?.addEventListener('click', () => {
            const media = getActiveCinemaMedia();
            if (media) {
                media.currentTime = Math.max(0, media.currentTime - 10);
                showCinemaGestureBadge('left', '⏪ 10s');
            }
        });
        document.getElementById('btn-media-forward10')?.addEventListener('click', () => {
            const media = getActiveCinemaMedia();
            if (media) {
                media.currentTime = Math.min(media.duration || 0, media.currentTime + 10);
                showCinemaGestureBadge('right', '10s ⏩');
            }
        });

        // Frame Steppers
        document.getElementById('btn-media-step-back')?.addEventListener('click', () => stepVideoFrame(-1));
        document.getElementById('btn-media-step-fwd')?.addEventListener('click', () => stepVideoFrame(1));
    }

    function _initMediaStudioDrawerAndTools() {
        // Theater & Hotkeys
        document.getElementById('btn-media-theater')?.addEventListener('click', toggleTheaterMode);
        document.getElementById('btn-media-hotkeys')?.addEventListener('click', toggleHotkeysModal);
        document.getElementById('btn-close-hotkeys')?.addEventListener('click', () => {
            const m = document.getElementById('media-hotkeys-modal');
            if (m) {
                m.classList.add('d-none');
                m.style.display = 'none';
            }
        });

        // Studio Drawer Toggle
        const btnToggleTools = document.getElementById('btn-toggle-tools');
        const toolsBar = document.getElementById('media-tools-bar');
        if (window.innerWidth <= 768 && toolsBar) {
            toolsBar.classList.add('is-collapsed');
        }
        btnToggleTools?.addEventListener('click', (e) => {
            if (e) e.stopPropagation();
            const bar = document.getElementById('media-tools-bar');
            if (!bar) return;
            const isMobile = window.innerWidth <= 768 || window.innerHeight <= 500;
            if (isMobile) {
                const isOpen = bar.classList.contains('is-open');
                bar.classList.toggle('is-open', !isOpen);
                bar.classList.remove('is-collapsed');
                btnToggleTools.classList.toggle('is-active', !isOpen);
                btnToggleTools.innerHTML = !isOpen ? '🎛️ Studio ▴' : '🎛️ Studio ▾';
            } else {
                const isCollapsed = bar.classList.contains('is-collapsed');
                bar.classList.toggle('is-collapsed', !isCollapsed);
                btnToggleTools.classList.toggle('is-active', isCollapsed);
                btnToggleTools.innerHTML = isCollapsed ? '🎛️ Studio ▴' : '🎛️ Studio ▾';
            }
            resetCinemaInactivityTimer();
        });

        document.getElementById('btn-close-tools-drawer')?.addEventListener('click', (e) => {
            if (e) e.stopPropagation();
            const bar = document.getElementById('media-tools-bar');
            if (bar) bar.classList.remove('is-open');
            if (btnToggleTools) {
                btnToggleTools.classList.remove('is-active');
                btnToggleTools.innerHTML = '🎛️ Studio ▾';
            }
            resetCinemaInactivityTimer();
        });

        document.getElementById('btn-media-snapshot')?.addEventListener('click', captureVideoFrameSnapshot);
        document.getElementById('btn-media-ambient')?.addEventListener('click', toggleAmbientGlow);
        document.getElementById('btn-media-loop')?.addEventListener('click', () => {
            currentMediaIsLooping = !currentMediaIsLooping;
            const btn = document.getElementById('btn-media-loop');
            if (btn) {
                btn.textContent = currentMediaIsLooping ? '🔁 Loop: On' : '🔁 Loop: Off';
                btn.style.background = currentMediaIsLooping ? 'rgba(56, 189, 248, 0.25)' : '';
                btn.style.color = currentMediaIsLooping ? '#38bdf8' : '';
            }
            showToast(currentMediaIsLooping ? '🔁 Single-video loop enabled' : '🔁 Playlist auto-advance enabled', 'info');
        });

        // Boost & Vocal EQ
        document.getElementById('btn-media-audio-boost')?.addEventListener('click', toggleAudioGainBoost);
        document.getElementById('btn-media-vocal-clarity')?.addEventListener('click', toggleVocalClarity);
        document.getElementById('btn-media-bookmark')?.addEventListener('click', addMediaBookmark);

        // Zoom Controls
        document.getElementById('btn-media-zoom-in')?.addEventListener('click', () => nudgeVideoZoom(0.25));
        document.getElementById('btn-media-zoom-out')?.addEventListener('click', () => nudgeVideoZoom(-0.25));
        document.getElementById('btn-media-zoom-reset')?.addEventListener('click', resetVideoZoom);

        // A-B Segment Loop Controls
        document.getElementById('btn-media-ab-a')?.addEventListener('click', setMediaLoopPointA);
        document.getElementById('btn-media-ab-b')?.addEventListener('click', setMediaLoopPointB);
        document.getElementById('btn-media-ab-clear')?.addEventListener('click', clearMediaABLoop);

        // Rotation & Flip
        document.getElementById('btn-media-rot-left')?.addEventListener('click', () => rotateVideo(-90));
        document.getElementById('btn-media-rot-right')?.addEventListener('click', () => rotateVideo(90));
        document.getElementById('btn-media-flip-h')?.addEventListener('click', () => flipVideo('h'));
        document.getElementById('btn-media-flip-v')?.addEventListener('click', () => flipVideo('v'));

        // Real-Time Video Filters
        document.getElementById('btn-filter-bright')?.addEventListener('click', () => toggleVideoFilter('bright'));
        document.getElementById('btn-filter-contrast')?.addEventListener('click', () => toggleVideoFilter('contrast'));
        document.getElementById('btn-filter-invert')?.addEventListener('click', () => toggleVideoFilter('invert'));
        document.getElementById('btn-filter-cctv')?.addEventListener('click', () => toggleVideoFilter('cctv'));
        document.getElementById('btn-filter-reset')?.addEventListener('click', resetVideoTransforms);
    }

    function _initMediaScrubberAndTimeline() {
        // Time display toggle
        document.getElementById('media-time-display')?.addEventListener('click', () => {
            currentMediaShowRemaining = !currentMediaShowRemaining;
            const media = getActiveCinemaMedia();
            if (media) updateTimelineScrubber(media);
        });

        // Precision Scrubber (Touch Area >= 28px, 16px Dragging Thumb, touch-action: none)
        const timelineWrap = document.getElementById('media-timeline-wrap');
        if (timelineWrap) {
            function seekFromPointer(clientX) {
                const media = getActiveCinemaMedia();
                if (!media || !media.duration) return;
                const rect = timelineWrap.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                media.currentTime = pct * media.duration;
                updateTimelineScrubber(media);
            }

            timelineWrap.addEventListener('mousedown', (e) => {
                isTimelineScrubbing = true;
                timelineWrap.classList.add('is-dragging');
                seekFromPointer(e.clientX);
                const onMouseMove = (ev) => {
                    if (isTimelineScrubbing) seekFromPointer(ev.clientX);
                };
                const onMouseUp = () => {
                    isTimelineScrubbing = false;
                    timelineWrap.classList.remove('is-dragging');
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                };
                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });

            timelineWrap.addEventListener('mousemove', (e) => {
                const media = getActiveCinemaMedia();
                if (!media || !media.duration) return;
                const rect = timelineWrap.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const tooltip = document.getElementById('media-timeline-tooltip');
                if (tooltip) {
                    tooltip.style.left = (pct * 100) + '%';
                    tooltip.textContent = formatTime(pct * media.duration);
                }
            });

            timelineWrap.addEventListener('touchstart', (e) => {
                isTimelineScrubbing = true;
                timelineWrap.classList.add('is-dragging');
                if (e.touches && e.touches[0]) seekFromPointer(e.touches[0].clientX);
            }, { passive: true });

            timelineWrap.addEventListener('touchmove', (e) => {
                if (isTimelineScrubbing && e.touches && e.touches[0]) seekFromPointer(e.touches[0].clientX);
            }, { passive: true });

            timelineWrap.addEventListener('touchend', () => {
                isTimelineScrubbing = false;
                timelineWrap.classList.remove('is-dragging');
            });
        }
    }

    function _initMediaVideoStageGestures() {
        const videoStage = document.getElementById('cinema-video-stage');
        if (!videoStage) return;

        // Gesture State Machine: Double-Tap Accumulation & 250ms Single-Tap Delay
        let accumulatedSeekDelta = 0;
        let accumulateSeekTimer = null;
        let lastTouchTapTime = 0;
        let lastTouchTapX = 0;
        let singleTapTimer = null;
        let touchPinchDist = null;
        let touchPinchStartZoom = 1.0;
        let touchPanStartX = 0;
        let touchPanStartY = 0;
        let isTouchPanning = false;
        let panMoved = false;

        function applyDoubleTapSeek(relX, width, media) {
            if (!media) return;
            // Directive 1: When zoom > 1x, disable seek double-tap (double-tap resets zoom)
            if (currentMediaZoom > 1.05) {
                resetVideoZoom();
                return;
            }

            if (relX < width * 0.35) {
                // Seek backward
                if (accumulatedSeekDelta > 0) accumulatedSeekDelta = 0;
                accumulatedSeekDelta -= 10;
                media.currentTime = Math.max(0, media.currentTime - 10);
                showCinemaGestureBadge('left', `${accumulatedSeekDelta}s`);
                clearTimeout(accumulateSeekTimer);
                accumulateSeekTimer = setTimeout(() => { accumulatedSeekDelta = 0; }, 800);
            } else if (relX > width * 0.65) {
                // Seek forward
                if (accumulatedSeekDelta < 0) accumulatedSeekDelta = 0;
                accumulatedSeekDelta += 10;
                media.currentTime = Math.min(media.duration || 0, media.currentTime + 10);
                showCinemaGestureBadge('right', `+${accumulatedSeekDelta}s`);
                clearTimeout(accumulateSeekTimer);
                accumulateSeekTimer = setTimeout(() => { accumulatedSeekDelta = 0; }, 800);
            } else {
                // Center double-tap
                const mediaFullscreenBtn = document.getElementById('btn-media-fullscreen');
                mediaFullscreenBtn?.click();
            }
        }

        videoStage.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) nudgeVideoZoom(0.25);
            else if (e.deltaY > 0) nudgeVideoZoom(-0.25);
        }, { passive: false });

        videoStage.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches.length === 2) {
                clearTimeout(singleTapTimer);
                singleTapTimer = null;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                touchPinchDist = Math.hypot(dx, dy);
                touchPinchStartZoom = currentMediaZoom;
            } else if (e.touches && e.touches.length === 1) {
                if (currentMediaZoom > 1.0) {
                    isTouchPanning = true;
                    panMoved = false;
                    touchPanStartX = e.touches[0].clientX - currentMediaPanX;
                    touchPanStartY = e.touches[0].clientY - currentMediaPanY;
                }
            }
        }, { passive: true });

        videoStage.addEventListener('touchmove', (e) => {
            if (e.touches && e.touches.length === 2 && touchPinchDist) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                if (touchPinchDist > 0) {
                    const factor = dist / touchPinchDist;
                    setVideoZoom(touchPinchStartZoom * factor);
                }
            } else if (e.touches && e.touches.length === 1 && isTouchPanning && currentMediaZoom > 1.0) {
                panMoved = true;
                currentMediaPanX = e.touches[0].clientX - touchPanStartX;
                currentMediaPanY = e.touches[0].clientY - touchPanStartY;
                applyVideoTransforms();
            }
        }, { passive: true });

        videoStage.addEventListener('touchend', (e) => {
            if (!e.touches || e.touches.length < 2) {
                touchPinchDist = null;
            }
            if (!e.touches || e.touches.length === 0) {
                if (isTouchPanning) {
                    isTouchPanning = false;
                    applyVideoTransforms();
                }

                // Mobile Tap / Double-Tap detection on 1-finger release
                if (!panMoved && e.changedTouches && e.changedTouches.length === 1) {
                    const now = Date.now();
                    const clientX = e.changedTouches[0].clientX;
                    const rect = videoStage.getBoundingClientRect();
                    const relX = clientX - rect.left;

                    if (now - lastTouchTapTime < 300 && Math.abs(clientX - lastTouchTapX) < 40) {
                        // Accumulated Double-Tap Seek (Left 35% = -10s, Right 35% = +10s)
                        clearTimeout(singleTapTimer);
                        singleTapTimer = null;
                        lastTouchTapTime = 0;
                        const media = getActiveCinemaMedia();
                        applyDoubleTapSeek(relX, rect.width, media);
                    } else {
                        lastTouchTapTime = now;
                        lastTouchTapX = clientX;
                        singleTapTimer = setTimeout(() => {
                            const modal = document.getElementById('vault-media-modal');
                            const bar = document.getElementById('media-tools-bar');
                            const btnToggle = document.getElementById('btn-toggle-tools');
                            // Dismiss open drawer on stage tap
                            if (bar && bar.classList.contains('is-open')) {
                                bar.classList.remove('is-open');
                                if (btnToggle) {
                                    btnToggle.classList.remove('is-active');
                                    btnToggle.innerHTML = '🎛️ Studio ▾';
                                }
                                resetCinemaInactivityTimer();
                                return;
                            }
                            // Single tap toggles controls visibility
                            if (modal) {
                                modal.classList.toggle('cinema-ui--hidden');
                                resetCinemaInactivityTimer();
                            }
                        }, 250);
                    }
                }
                panMoved = false;
            }
        });

        // Desktop Mouse Drag Pan
        videoStage.addEventListener('mousedown', (e) => {
            if (currentMediaZoom > 1.0 && e.button === 0) {
                isMediaPanning = true;
                panMoved = false;
                mediaPanStartX = e.clientX - currentMediaPanX;
                mediaPanStartY = e.clientY - currentMediaPanY;
                applyVideoTransforms();
                const onMove = (ev) => {
                    if (isMediaPanning) {
                        if (Math.abs(ev.clientX - (mediaPanStartX + currentMediaPanX)) > 4 ||
                            Math.abs(ev.clientY - (mediaPanStartY + currentMediaPanY)) > 4) {
                            panMoved = true;
                        }
                        currentMediaPanX = ev.clientX - mediaPanStartX;
                        currentMediaPanY = ev.clientY - mediaPanStartY;
                        applyVideoTransforms();
                    }
                };
                const onUp = () => {
                    isMediaPanning = false;
                    applyVideoTransforms();
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            }
        });

        // Desktop Mouse Click
        videoStage.addEventListener('click', (e) => {
            if (panMoved) {
                panMoved = false;
                return;
            }
            const modal = document.getElementById('vault-media-modal');
            const bar = document.getElementById('media-tools-bar');
            const btnToggle = document.getElementById('btn-toggle-tools');

            if (bar && bar.classList.contains('is-open')) {
                const target = e.target;
                if (!target || (!target.closest('#media-tools-bar') && !target.closest('#btn-toggle-tools'))) {
                    bar.classList.remove('is-open');
                    if (btnToggle) {
                        btnToggle.classList.remove('is-active');
                        btnToggle.innerHTML = '🎛️ Studio ▾';
                    }
                    resetCinemaInactivityTimer();
                    return;
                }
            }

            if (modal && modal.classList.contains('cinema-ui--hidden')) {
                modal.classList.remove('cinema-ui--hidden');
                resetCinemaInactivityTimer();
                return;
            }

            const media = getActiveCinemaMedia();
            if (!media) return;

            if (e.detail === 2) {
                const rect = videoStage.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                applyDoubleTapSeek(clickX, rect.width, media);
            } else if (e.detail === 1) {
                // Desktop click toggles play/pause or controls
                if (window.innerWidth > 768) {
                    if (media.paused) {
                        playWithErrorSurface(media);
                        showCinemaCenterRipple('▶');
                    } else {
                        media.pause();
                        showCinemaCenterRipple('⏸');
                    }
                } else {
                    modal.classList.toggle('cinema-ui--hidden');
                    resetCinemaInactivityTimer();
                }
            }
        });
    }

    function _initMediaSecondaryControls() {
        const mediaFitBtn = document.getElementById('btn-media-fit');
        const mediaPipBtn = document.getElementById('btn-media-pip');
        const mediaFullscreenBtn = document.getElementById('btn-media-fullscreen');

        // Aspect Ratio
        const aspectModes = ['fit', 'fill', '16:9', '4:3'];
        let aspectIdx = 0;
        mediaFitBtn?.addEventListener('click', () => {
            aspectIdx = (aspectIdx + 1) % aspectModes.length;
            currentMediaFitMode = aspectModes[aspectIdx];
            const video = document.getElementById('cinema-video');
            if (!video) return;

            video.classList.remove('media-player-element--cover');
            video.style.aspectRatio = '';
            video.style.objectFit = '';

            if (currentMediaFitMode === 'fill') {
                video.classList.add('media-player-element--cover');
                if (mediaFitBtn) mediaFitBtn.textContent = '↔️ Fill';
            } else if (currentMediaFitMode === '16:9') {
                video.style.aspectRatio = '16/9';
                video.style.objectFit = 'contain';
                if (mediaFitBtn) mediaFitBtn.textContent = '↔️ 16:9';
            } else if (currentMediaFitMode === '4:3') {
                video.style.aspectRatio = '4/3';
                video.style.objectFit = 'contain';
                if (mediaFitBtn) mediaFitBtn.textContent = '↔️ 4:3';
            } else {
                if (mediaFitBtn) mediaFitBtn.textContent = '↔️ Fit';
            }
            showToast(`↔️ Aspect Ratio: ${currentMediaFitMode.toUpperCase()}`, 'info');
        });

        // Picture-in-Picture
        const pipSupported = ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled) ||
                              (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.requestPictureInPicture);
        if (!pipSupported && mediaPipBtn) {
            mediaPipBtn.style.display = 'none';
        }
        mediaPipBtn?.addEventListener('click', async () => {
            const video = document.getElementById('cinema-video');
            if (!video) return;
            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else if (video.requestPictureInPicture) {
                    await video.requestPictureInPicture();
                }
            } catch (err) {
                console.warn('[PiP Error]', err);
            }
        });

        // Fullscreen Toggle
        mediaFullscreenBtn?.addEventListener('click', async () => {
            const container = document.querySelector('.media-modal-container');
            const isNative = !!document.fullscreenElement;
            const isPseudo = container && container.classList.contains('media-fullscreen--pseudo');
            if (!isNative && !isPseudo) {
                await requestPlayerFullscreen();
            } else {
                await exitPlayerFullscreen();
            }
        });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                const container = document.querySelector('.media-modal-container');
                if (container) container.classList.remove('media-fullscreen--pseudo');
                try {
                    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
                        screen.orientation.unlock();
                    }
                } catch (_) {}
            }
        });

        // Speed Select
        document.getElementById('media-speed-select')?.addEventListener('change', (e) => {
            const media = getActiveCinemaMedia();
            if (media) media.playbackRate = parseFloat(e.target.value || '1');
        });

        // Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            const mediaModalEl = document.getElementById('vault-media-modal');
            if (!mediaModalEl || mediaModalEl.classList.contains('d-none') || mediaModalEl.style.display === 'none') return;

            const media = getActiveCinemaMedia();
            if (!media) return;

            if (e.key === ' ' || e.code === 'Space' || e.key === 'k' || e.key === 'K') {
                e.preventDefault();
                if (media.paused) {
                    playWithErrorSurface(media);
                    showCinemaCenterRipple('▶');
                } else {
                    media.pause();
                    showCinemaCenterRipple('⏸');
                }
            } else if (e.key === 'ArrowLeft' && e.shiftKey) {
                e.preventDefault();
                if (currentMediaIndex > 0) playMediaByIndex(currentMediaIndex - 1);
            } else if (e.key === 'ArrowRight' && e.shiftKey) {
                e.preventDefault();
                if (currentMediaIndex < currentMediaPlaylist.length - 1) playMediaByIndex(currentMediaIndex + 1);
            } else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
                e.preventDefault();
                media.currentTime = Math.max(0, media.currentTime - 10);
                showCinemaGestureBadge('left', '⏪ 10s');
            } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
                e.preventDefault();
                media.currentTime = Math.min(media.duration || 0, media.currentTime + 10);
                showCinemaGestureBadge('right', '10s ⏩');
            } else if (e.key === '<' || (e.shiftKey && e.key === ',')) {
                e.preventDefault();
                nudgePlaybackSpeed(-1);
            } else if (e.key === '>' || (e.shiftKey && e.key === '.')) {
                e.preventDefault();
                nudgePlaybackSpeed(1);
            } else if (e.key === ',') {
                e.preventDefault();
                stepVideoFrame(-1);
            } else if (e.key === '.') {
                e.preventDefault();
                stepVideoFrame(1);
            } else if (e.key === '[') {
                e.preventDefault();
                setMediaLoopPointA();
            } else if (e.key === ']') {
                e.preventDefault();
                setMediaLoopPointB();
            } else if (e.key === '\\') {
                e.preventDefault();
                clearMediaABLoop();
            } else if (e.key === 'v' || e.key === 'V') {
                e.preventDefault();
                toggleVocalClarity();
            } else if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                nudgeVideoZoom(0.25);
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                nudgeVideoZoom(-0.25);
            } else if (e.key === '0') {
                e.preventDefault();
                resetVideoZoom();
            } else if (e.key === 'b' || e.key === 'B') {
                e.preventDefault();
                toggleAudioGainBoost();
            } else if (e.key === 'r' || e.key === 'R') {
                e.preventDefault();
                rotateVideo(90);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                media.volume = Math.min(1, +(media.volume + 0.05).toFixed(2));
                updateVolumeMuteUI(media);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                media.volume = Math.max(0, +(media.volume - 0.05).toFixed(2));
                updateVolumeMuteUI(media);
            } else if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                mediaFullscreenBtn?.click();
            } else if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                toggleTheaterMode();
            } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                toggleHotkeysModal();
            } else if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                mediaPipBtn?.click();
            } else if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                if (e.shiftKey) {
                    addMediaBookmark();
                } else {
                    media.muted = !media.muted;
                    updateVolumeMuteUI(media);
                }
            } else if (e.key === 'Escape') {
                const hotkeysModal = document.getElementById('media-hotkeys-modal');
                if (hotkeysModal && (!hotkeysModal.classList.contains('d-none') || (hotkeysModal.style.display && hotkeysModal.style.display !== 'none'))) {
                    hotkeysModal.classList.add('d-none');
                    hotkeysModal.style.display = 'none';
                } else {
                    closeMediaPlayer();
                }
            }
        });
    }

    function _initImageLightboxModalEvents() {
        const imageModal = document.getElementById('vault-image-modal');
        const closeImageBtn = document.getElementById('btn-close-image-modal');
        const imageOpenTabBtn = document.getElementById('btn-image-open-tab');
        const imageDlBtn = document.getElementById('btn-image-download');
        const imagePrevBtn = document.getElementById('btn-image-prev');
        const imageNextBtn = document.getElementById('btn-image-next');
        const imageZoomInBtn = document.getElementById('btn-image-zoom-in');
        const imageZoomOutBtn = document.getElementById('btn-image-zoom-out');
        const imageZoomResetBtn = document.getElementById('btn-image-zoom-reset');
        const imageRotateBtn = document.getElementById('btn-image-rotate');
        const imageFullscreenBtn = document.getElementById('btn-image-fullscreen');
        const imageViewport = document.getElementById('image-viewport');

        closeImageBtn?.addEventListener('click', closeImageViewer);
        imageModal?.addEventListener('click', (e) => {
            if (e.target.id === 'vault-image-modal') closeImageViewer();
        });

        imageOpenTabBtn?.addEventListener('click', () => {
            if (currentImageBlobUrl) {
                const isSvg = (currentImageFilename || '').toLowerCase().endsWith('.svg');
                if (isSvg) {
                    showToast('Opening SVG in a new tab is restricted for security. Please save to inspect.', 'info');
                    return;
                }
                window.open(currentImageBlobUrl, '_blank', 'noopener,noreferrer');
            }
        });

        imageDlBtn?.addEventListener('click', () => {
            if (currentImageBlob && currentImageFilename) {
                if (typeof global.triggerDownload === 'function') global.triggerDownload(currentImageBlob, currentImageFilename);
                showToast(`Saved "${currentImageFilename}"`, 'success');
            }
        });

        imagePrevBtn?.addEventListener('click', () => {
            if (currentImageIndex > 0) showImageByIndex(currentImageIndex - 1);
        });

        imageNextBtn?.addEventListener('click', () => {
            if (currentImageIndex < currentImagePlaylist.length - 1) showImageByIndex(currentImageIndex + 1);
        });

        imageZoomInBtn?.addEventListener('click', () => zoomImage(0.25));
        imageZoomOutBtn?.addEventListener('click', () => zoomImage(-0.25));
        imageZoomResetBtn?.addEventListener('click', resetImageZoom);
        imageRotateBtn?.addEventListener('click', rotateImage);

        imageFullscreenBtn?.addEventListener('click', () => {
            const container = document.querySelector('.image-modal-container') || imageViewport;
            if (!container) return;
            if (!document.fullscreenElement) {
                container.requestFullscreen?.() || container.webkitRequestFullscreen?.();
            } else {
                document.exitFullscreen?.() || document.webkitExitFullscreen?.();
            }
        });

        imageViewport?.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isPanningImage = true;
            panStartX = e.clientX - imagePanX;
            panStartY = e.clientY - imagePanY;
            imageViewport.classList.add('is-dragging');
        });

        window.addEventListener('mousemove', (e) => {
            if (!isPanningImage) return;
            imagePanX = e.clientX - panStartX;
            imagePanY = e.clientY - panStartY;
            applyImageTransform();
        });

        window.addEventListener('mouseup', () => {
            if (isPanningImage) {
                isPanningImage = false;
                imageViewport?.classList.remove('is-dragging');
            }
        });

        imageViewport?.addEventListener('wheel', (e) => {
            const modal = document.getElementById('vault-image-modal');
            if (!modal || modal.classList.contains('d-none') || modal.style.display === 'none') return;
            e.preventDefault();
            if (e.deltaY < 0) zoomImage(0.15);
            else if (e.deltaY > 0) zoomImage(-0.15);
        }, { passive: false });

        imageViewport?.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (imageZoomLevel > 1.0) resetImageZoom();
            else zoomImage(1.5);
        });
    }

    let _isMediaPlayerUIInitialized = false;

    function initMediaPlayerUI() {
        if (_isMediaPlayerUIInitialized) return;
        _isMediaPlayerUIInitialized = true;

        _initMediaModalBaseControls();
        _initMediaElementSyncEvents();
        _initMediaPlaybackAndVolumeControls();
        _initMediaStudioDrawerAndTools();
        _initMediaScrubberAndTimeline();
        _initMediaVideoStageGestures();
        _initMediaSecondaryControls();
        _initImageLightboxModalEvents();
    }

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMediaPlayerUI);
    } else {
        initMediaPlayerUI();
    }

    
    /**
     * Complete lifecycle scrub of all player streams, channels, caches, and blob URLs.
     * Invoked on vault lock, auto-lock, duress and panic.
     */
    function cleanupActiveSession() {
        // 1. Close media elements
        const video = document.getElementById('cinema-video');
        const audio = document.getElementById('cinema-audio');
        if (video) {
            try { video.pause(); } catch (_) {}
            video.removeAttribute('src');
            try { video.load(); } catch (_) {}
            video.style.display = 'none';
        }
        if (audio) {
            try { audio.pause(); } catch (_) {}
            audio.removeAttribute('src');
            try { audio.load(); } catch (_) {}
            audio.style.display = 'none';
        }
        const img = document.getElementById('lightbox-image');
        if (img) {
            img.src = '';
            img.style.display = 'none';
        }

        // 2. Terminate SW range streaming session and channel
        if (activeMediaChannel) {
            try {
                if (activeMediaStreamId && navigator.serviceWorker && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({
                        type: 'CLOSE_MEDIA_STREAM',
                        streamId: activeMediaStreamId
                    });
                }
            } catch (_) {}
            try { activeMediaChannel.port1.close(); } catch (_) {}
            activeMediaChannel = null;
        }
        activeMediaStreamId = null;

        // 3. Clear memory chunk cache
        if (activeMediaChunkCache && typeof activeMediaChunkCache.clear === 'function') {
            activeMediaChunkCache.clear();
        }

        // 4. Revoke blob URLs
        if (currentMediaBlobUrl) {
            if (typeof revokeTrackedBlobUrl === 'function') revokeTrackedBlobUrl(currentMediaBlobUrl);
            currentMediaBlobUrl = null;
        }
        if (currentImageBlobUrl) {
            if (typeof revokeTrackedBlobUrl === 'function') revokeTrackedBlobUrl(currentImageBlobUrl);
            currentImageBlobUrl = null;
        }
        currentMediaBlob = null;
        currentImageBlob = null;

        // 5. Exit fullscreen
        exitPlayerFullscreen();

        // 6. Reset state
        currentMediaIndex = -1;
        currentMediaPlaylist = [];
        currentImageIndex = -1;
        currentImagePlaylist = [];

        // 7. Hide modals
        const mediaModal = document.getElementById('vault-media-modal');
        if (mediaModal) {
            mediaModal.classList.add('d-none');
            mediaModal.style.display = 'none';
        }
        const imageModal = document.getElementById('vault-image-modal');
        if (imageModal) {
            imageModal.classList.add('d-none');
            imageModal.style.display = 'none';
        }
    }

    // Export to global scope
        // Directive 3: Expose explicit window.ZevMedia API
    const ZevMedia = {
        playMediaByIndex,
        openMediaPlayerByPath,
        closeMediaPlayer,
        openImageViewerByPath,
        closeImageViewer,
        showImageByIndex,
        getActiveCinemaMedia,
        stepVideoFrame,
        captureVideoFrameSnapshot,
        setVideoZoom,
        nudgeVideoZoom,
        resetVideoZoom,
        rotateVideo,
        flipVideo,
        toggleVideoFilter,
        setMediaLoopPointA,
        setMediaLoopPointB,
        clearMediaABLoop,
        addMediaBookmark,
        toggleAudioGainBoost,
        toggleVocalClarity,
        toggleAmbientGlow,
        toggleTheaterMode,
        toggleHotkeysModal,
        requestPlayerFullscreen,
        exitPlayerFullscreen,
        cleanupActiveSession,
        isLoaded: () => true
    };
    global.ZevMedia = ZevMedia;

    global.cleanupActiveSession = cleanupActiveSession;
    global.requestPlayerFullscreen = requestPlayerFullscreen;
    global.exitPlayerFullscreen = exitPlayerFullscreen;
    global.playMediaByIndex = playMediaByIndex;
    global.openMediaPlayerByPath = openMediaPlayerByPath;
    global.closeMediaPlayer = closeMediaPlayer;
    global.canStreamRange = canStreamRange;
    global.setupRangeStreaming = setupRangeStreaming;
    global.setupDirectBlobPlayback = setupDirectBlobPlayback;
    global.stepVideoFrame = stepVideoFrame;
    global.captureVideoFrameSnapshot = captureVideoFrameSnapshot;
    global.setVideoZoom = setVideoZoom;
    global.nudgeVideoZoom = nudgeVideoZoom;
    global.resetVideoZoom = resetVideoZoom;
    global.showCinemaZoomBadge = showCinemaZoomBadge;
    global.applyVideoTransforms = applyVideoTransforms;
    global.resetVideoTransforms = resetVideoTransforms;
    global.rotateVideo = rotateVideo;
    global.flipVideo = flipVideo;
    global.toggleVideoFilter = toggleVideoFilter;
    global.setMediaLoopPointA = setMediaLoopPointA;
    global.setMediaLoopPointB = setMediaLoopPointB;
    global.clearMediaABLoop = clearMediaABLoop;
    global.updateABLoopUI = updateABLoopUI;
    global.addMediaBookmark = addMediaBookmark;
    global.renderMediaBookmarks = renderMediaBookmarks;
    global.toggleAudioGainBoost = toggleAudioGainBoost;
    global.toggleVocalClarity = toggleVocalClarity;
    global.toggleAmbientGlow = toggleAmbientGlow;
    global.updateAmbientGlow = updateAmbientGlow;
    global.updateTimelineScrubber = updateTimelineScrubber;
    global.showCinemaCenterRipple = showCinemaCenterRipple;
    global.showCinemaGestureBadge = showCinemaGestureBadge;
    global.resetCinemaInactivityTimer = resetCinemaInactivityTimer;
    global.clearCinemaInactivityTimer = clearCinemaInactivityTimer;
    global.nudgePlaybackSpeed = nudgePlaybackSpeed;
    global.toggleTheaterMode = toggleTheaterMode;
    global.toggleHotkeysModal = toggleHotkeysModal;
    global.openImageViewerByPath = openImageViewerByPath;
    global.closeImageViewer = closeImageViewer;
    global.showImageByIndex = showImageByIndex;
    global.applyImageTransform = applyImageTransform;
    global.resetImageZoom = resetImageZoom;
    global.zoomImage = zoomImage;
    global.rotateImage = rotateImage;
    global.initMediaPlayerUI = initMediaPlayerUI;

})(typeof window !== 'undefined' ? window : this);
