/**
 * ZevSafe — Application Initialization & Event Decoupling (js/init.js)
 * Extracted from index.html to satisfy strict Content Security Policy (zero 'unsafe-inline').
 *
 * Responsibilities:
 *  - Service Worker lifecycle, registration, and background cache updates
 *  - PWA Install prompt handling and banner UI state machine
 *  - Standards-compliant form submission interception (Credential Management API)
 *  - Decoupled event listeners for mobile tabs and keyfile triggers (zero inline on*)
 */

(() => {
    'use strict';

    // ── Service Worker Registration & Update Lifecycle (Phase 5: Safe Updates) ──
    let waitingWorker = null;

    function promptUpdate(worker) {
        waitingWorker = worker;
        const updateBanner = document.getElementById('pwa-update-banner');
        if (updateBanner) {
            updateBanner.classList.remove('d-none');
            requestAnimationFrame(() => updateBanner.classList.add('pwa-banner--visible'));
        }
    }

    function dismissUpdateBanner() {
        const updateBanner = document.getElementById('pwa-update-banner');
        if (updateBanner) {
            updateBanner.classList.remove('pwa-banner--visible');
            setTimeout(() => {
                updateBanner.classList.add('d-none');
            }, 350);
        }
    }

    function applyUpdate() {
        if (!waitingWorker) return;
        dismissUpdateBanner();

        // Check if vault is open or long-running crypto/streaming job is active
        const isSafe = (typeof window.canSafelyReload === 'function') ? window.canSafelyReload() : true;
        if (!isSafe) {
            const confirmed = window.confirm(
                'A vault is currently open or an operation is in progress. Updating now will reload the app and unsaved progress will be lost. Update anyway?'
            );
            if (!confirmed) {
                return;
            }
        }
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }

    const btnUpdate = document.getElementById('pwa-btn-update');
    const btnUpdateDismiss = document.getElementById('pwa-btn-update-dismiss');
    btnUpdate?.addEventListener('click', applyUpdate);
    btnUpdateDismiss?.addEventListener('click', dismissUpdateBanner);

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js', { scope: './' })
                .then(reg => {
                    console.log('[ZevSafe PWA] SW registered. Scope:', reg.scope);

                    // Check if a worker is already waiting from previous session
                    if (reg.waiting && navigator.serviceWorker.controller) {
                        promptUpdate(reg.waiting);
                    }

                    // Poll for updates when user comes back online
                    window.addEventListener('online', () => {
                        reg.update().catch(() => {});
                    });

                    // Periodic background update check (every 10 mins)
                    setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);

                    // When a new SW update is detected
                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        if (!newWorker) return;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    console.log('[ZevSafe PWA] New SW installed. Presenting update banner.');
                                    promptUpdate(newWorker);
                                } else {
                                    // First install: safe to activate immediately
                                    console.log('[ZevSafe PWA] Initial SW install. Activating cache.');
                                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                                }
                            }
                        });
                    });
                })
                .catch(err => console.warn('[ZevSafe PWA] SW registration failed:', err));

            // Auto-reload when new SW takes control, strictly guarded by canSafelyReload()
            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                const isSafe = (typeof window.canSafelyReload === 'function') ? window.canSafelyReload() : true;
                if (isSafe) {
                    refreshing = true;
                    window.location.reload();
                } else {
                    console.log('[ZevSafe PWA] Controller changed but vault is open/job running. Deferring reload.');
                    window.__zevPendingReload = true;
                    if (typeof window.showToast === 'function') {
                        window.showToast('🚀 ZevSafe updated in background. Reload will occur once vault is locked.', 'info');
                    }
                }
            });
        });
    }

    // ── PWA Install Prompt State Machine ─────────────────────────────
    let deferredInstallPrompt = null;
    const installBanner   = document.getElementById('pwa-install-banner');
    const btnInstall      = document.getElementById('pwa-btn-install');
    const btnDismiss      = document.getElementById('pwa-btn-dismiss');

    // Skip showing banner if already installed
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches
                     || window.navigator.standalone === true;

    if (!isInstalled && installBanner) {
        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            deferredInstallPrompt = e;

            // Don't show again if user dismissed recently (7 days)
            const dismissedUntil = localStorage.getItem('pwa-install-dismissed');
            if (!dismissedUntil || Date.now() > Number(dismissedUntil)) {
                installBanner.classList.remove('d-none');
                requestAnimationFrame(() => installBanner.classList.add('pwa-banner--visible'));
            }
        });
    }

    btnInstall?.addEventListener('click', async () => {
        if (!deferredInstallPrompt || !installBanner) return;
        installBanner.classList.remove('pwa-banner--visible');
        setTimeout(() => {
            installBanner.classList.add('d-none');
        }, 350);
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        console.log('[ZevSafe PWA] Install prompt outcome:', outcome);
        deferredInstallPrompt = null;
    });

    btnDismiss?.addEventListener('click', () => {
        if (!installBanner) return;
        installBanner.classList.remove('pwa-banner--visible');
        setTimeout(() => {
            installBanner.classList.add('d-none');
        }, 350);
        localStorage.setItem('pwa-install-dismissed', String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    });

    // Clean up after successful install
    window.addEventListener('appinstalled', () => {
        console.log('[ZevSafe PWA] App installed successfully!');
        if (installBanner) {
            installBanner.classList.remove('pwa-banner--visible');
            installBanner.classList.add('d-none');
        }
        deferredInstallPrompt = null;
    });

    // ── Decoupled DOM Event Listeners (Zero Inline on*) ───────────────
    function initDecoupledEventListeners() {
        // Mobile Encrypt/Decrypt Tabs
        const tabEncrypt = document.getElementById('tab-encrypt');
        const tabDecrypt = document.getElementById('tab-decrypt');

        tabEncrypt?.addEventListener('click', () => {
            if (typeof window.switchTab === 'function') {
                window.switchTab('encrypt');
            }
        });

        tabDecrypt?.addEventListener('click', () => {
            if (typeof window.switchTab === 'function') {
                window.switchTab('decrypt');
            }
        });

        // Keyfile Label Event Propagation Isolation
        const keyfileLabelEncrypt = document.getElementById('v2-keyfile-label-encrypt');
        const keyfileLabelDecrypt = document.getElementById('v2-keyfile-label-decrypt');

        keyfileLabelEncrypt?.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        keyfileLabelDecrypt?.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Credential Management API Hidden Helper Forms
        const credForm = document.getElementById('vault-credential-form');
        const decCredForm = document.getElementById('vault-decrypt-credential-form');

        credForm?.addEventListener('submit', (e) => {
            e.preventDefault();
        });

        decCredForm?.addEventListener('submit', (e) => {
            e.preventDefault();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDecoupledEventListeners);
    } else {
        initDecoupledEventListeners();
    }
})();
