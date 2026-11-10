/**
 * ZevSafe Modular In-Vault Image Lightbox Viewer
 * js/image-viewer.js
 *
 * Dedicated in-browser image lightbox viewer with pan, zoom, rotate and playlist navigation.
 * Lazy-loaded strictly on demand when user clicks on an image/photo in Decrypted Vault Explorer.
 * Zero external network calls. 100% Client-Side.
 */
(function (global) {
    'use strict';

    // Image Lightbox State
    let currentImageBlobUrl = null;
    let currentImageFilename = '';
    let currentImageBlob = null;
    let currentImagePlaylist = []; // [{ path, name, size, mimeType, entry }]
    let currentImageIndex = -1;
    let imageZoomLevel = 1.0;
    let imageRotationDeg = 0;
    let imagePanX = 0;
    let imagePanY = 0;
    let isPanningImage = false;
    let panStartX = 0;
    let panStartY = 0;
    let _isInitialized = false;

    function showToast(msg, type = 'info') {
        if (typeof global.showToast === 'function') {
            global.showToast(msg, type);
        } else {
            console.log(`[ZevSafe Toast] [${type}] ${msg}`);
        }
    }

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
        if (typeof deg !== 'number' || isNaN(deg)) deg = 90;
        imageRotationDeg = (((imageRotationDeg || 0) + deg) % 360 + 360) % 360;
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
            currentImageFilename = item.name || item.path;

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
            img.style.display = 'block';
            modal.classList.remove('d-none');
            modal.style.display = 'flex';
        } catch (err) {
            showToast(`Failed to view image: ${err.message}`, 'error');
        }
    }

    function openImageViewerByPath(filePath) {
        if (!currentImagePlaylist || currentImagePlaylist.length === 0) {
            if (Array.isArray(global.currentImagePlaylist) && global.currentImagePlaylist.length > 0) {
                currentImagePlaylist = [...global.currentImagePlaylist];
            } else if (Array.isArray(global.currentDecryptedFileList)) {
                currentImagePlaylist = [];
                for (const fileItem of global.currentDecryptedFileList) {
                    const isPhoto = (typeof global.getFileCategory === 'function' && global.getFileCategory(fileItem.name) === 'photo') ||
                        /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)$/i.test(fileItem.name || fileItem.path || '');
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
            img.style.display = 'none';
        }
        if (currentImageBlobUrl && currentImageBlobUrl.startsWith('blob:') && typeof global.revokeTrackedBlobUrl === 'function') {
            global.revokeTrackedBlobUrl(currentImageBlobUrl);
            currentImageBlobUrl = null;
        }
        currentImageBlob = null;
        currentImageFilename = '';
    }

    function initImageLightboxModalEvents() {
        if (_isInitialized) return;
        _isInitialized = true;

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
        imageRotateBtn?.addEventListener('click', () => rotateImage(90));

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

    const ZevImageViewer = {
        isLoaded: () => true,
        openImageViewerByPath,
        closeImageViewer,
        showImageByIndex,
        applyImageTransform,
        resetImageZoom,
        zoomImage,
        rotateImage,
        initUI: initImageLightboxModalEvents,
        getState: () => ({
            currentImagePlaylist,
            currentImageIndex,
            currentImageFilename,
            imageZoomLevel,
            imageRotationDeg,
            imagePanX,
            imagePanY
        })
    };

    global.ZevImageViewer = ZevImageViewer;
    global.openImageViewerByPath = openImageViewerByPath;
    global.closeImageViewer = closeImageViewer;
    global.showImageByIndex = showImageByIndex;
    global.applyImageTransform = applyImageTransform;
    global.resetImageZoom = resetImageZoom;
    global.zoomImage = zoomImage;
    global.rotateImage = rotateImage;

    // Auto-init UI if document is loaded
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initImageLightboxModalEvents);
        } else {
            initImageLightboxModalEvents();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
