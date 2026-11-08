/**
 * ZevSafe — Accessibility Manager & WAI-ARIA Controller (js/a11y-manager.js)
 *
 * Responsibilities (WCAG 2.1 AA / Section 508):
 * 1. Modal Lifecycle:
 *    - Traps keyboard focus inside active dialogs (Tab / Shift+Tab wrapping)
 *    - Applies 'inert' to background page content while dialog is open
 *    - Safe Escape key dismissal (blocks dismissal during active crypto jobs without confirmation)
 *    - Restores keyboard focus to opening trigger element on modal dismissal
 * 2. Vault Explorer Roving Tabindex:
 *    - Single tab stop for explorer file/folder list (role="listbox" / role="option")
 *    - Arrow key navigation (Up/Down/Left/Right/Home/End)
 *    - Enter / Space activation
 *    - Delete key handling (guarded against focused inputs and running media sessions)
 * 3. Screen Reader Live Announcements:
 *    - Polite live region for progress milestones (0%, 25%, 50%, 75%, 100%), toasts, and vault state
 *    - Assertive alert region (role="alert") for errors and job failures
 *    - Debounced password strength announcements (categorical labels only, zero password data)
 *    - Progress bar semantics (role="progressbar", aria-valuenow/min/max)
 */

(() => {
    'use strict';

    // ── 1. Screen Reader Live Regions ─────────────────────────────────
    let politeRegion = null;
    let alertRegion = null;
    let lastAnnouncedMilestone = -1;
    let pwStrengthTimer = null;

    function ensureLiveRegions() {
        if (!politeRegion) {
            politeRegion = document.getElementById('a11y-polite-region');
            if (!politeRegion) {
                politeRegion = document.createElement('div');
                politeRegion.id = 'a11y-polite-region';
                politeRegion.className = 'sr-only';
                politeRegion.setAttribute('role', 'status');
                politeRegion.setAttribute('aria-live', 'polite');
                politeRegion.setAttribute('aria-atomic', 'true');
                document.body.appendChild(politeRegion);
            }
        }
        if (!alertRegion) {
            alertRegion = document.getElementById('a11y-alert-region');
            if (!alertRegion) {
                alertRegion = document.createElement('div');
                alertRegion.id = 'a11y-alert-region';
                alertRegion.className = 'sr-only';
                alertRegion.setAttribute('role', 'alert');
                alertRegion.setAttribute('aria-live', 'assertive');
                alertRegion.setAttribute('aria-atomic', 'true');
                document.body.appendChild(alertRegion);
            }
        }
    }

    function announcePolite(message) {
        ensureLiveRegions();
        if (!politeRegion || !message) return;
        // Clear then update to ensure screen reader detects repeated strings
        politeRegion.textContent = '';
        requestAnimationFrame(() => {
            politeRegion.textContent = message;
        });
    }

    function announceAlert(message) {
        ensureLiveRegions();
        if (!alertRegion || !message) return;
        alertRegion.textContent = '';
        requestAnimationFrame(() => {
            alertRegion.textContent = message;
        });
    }

    /**
     * Announces progress milestones (0%, 25%, 50%, 75%, 100%) and phase names politely.
     * Prevents flooding the assistive technology on every tick.
     */
    function announceProgressMilestone(percent, phaseName) {
        const rounded = Math.floor(percent);
        const milestones = [0, 25, 50, 75, 100];
        const hitMilestone = milestones.find(m => rounded >= m && lastAnnouncedMilestone < m);

        if (hitMilestone !== undefined) {
            lastAnnouncedMilestone = hitMilestone;
            const text = phaseName
                ? `${phaseName}: ${hitMilestone}%`
                : `Progress: ${hitMilestone}%`;
            announcePolite(text);
        }

        // Reset milestone tracker on start or completion
        if (rounded >= 100 || rounded === 0) {
            if (rounded >= 100) lastAnnouncedMilestone = -1;
        }

        // Update progress bar ARIA attributes if present
        const progressFill = document.getElementById('progress-bar-fill');
        if (progressFill) {
            progressFill.setAttribute('role', 'progressbar');
            progressFill.setAttribute('aria-valuenow', String(rounded));
            progressFill.setAttribute('aria-valuemin', '0');
            progressFill.setAttribute('aria-valuemax', '100');
            if (phaseName) {
                progressFill.setAttribute('aria-valuetext', `${phaseName} ${rounded}%`);
            }
        }
    }

    /**
     * Debounced password strength announcement (only categorical label, never password content).
     */
    function announcePasswordStrength(tierLabel) {
        if (pwStrengthTimer) clearTimeout(pwStrengthTimer);
        pwStrengthTimer = setTimeout(() => {
            if (tierLabel) {
                announcePolite(`Password strength: ${tierLabel}`);
            }
        }, 500);
    }

    // ── 2. Modal Focus Trap, Inert Background & Safe Escape ──────────
    const modalStack = [];
    const FOCUSABLE_SELECTOR = 'button:not([disabled]):not([aria-hidden="true"]), [href], input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"]), select:not([disabled]):not([aria-hidden="true"]), textarea:not([disabled]):not([aria-hidden="true"]), [tabindex]:not([tabindex="-1"])';

    function setBackgroundInert(isInert) {
        const mainLandmark = document.getElementById('main-content') || document.querySelector('main');
        const headerLandmark = document.querySelector('header');
        const footerLandmark = document.querySelector('footer');
        const heroSection = document.querySelector('.hero');
        const bgElements = [mainLandmark, headerLandmark, footerLandmark, heroSection].filter(Boolean);

        for (const el of bgElements) {
            // Guard: Never set inert on an element if it contains ANY active modal in the stack
            if (isInert && modalStack.some(entry => el.contains(entry.modalEl))) continue;
            if (isInert) {
                el.setAttribute('inert', '');
                el.setAttribute('aria-hidden', 'true');
            } else {
                el.removeAttribute('inert');
                el.removeAttribute('aria-hidden');
            }
        }
    }

    function openModalA11y(modalEl, openerEl = null) {
        if (!modalEl) return;
        const previousActive = openerEl || document.activeElement;

        // Nested modal handling: if another modal is currently active
        if (modalStack.length > 0) {
            const prevEntry = modalStack[modalStack.length - 1];
            // Only inert previous modal if it does NOT contain the new modal (i.e. sibling dialogs)
            if (!prevEntry.modalEl.contains(modalEl) && !modalEl.contains(prevEntry.modalEl)) {
                prevEntry.modalEl.setAttribute('inert', '');
                prevEntry.modalEl.setAttribute('aria-hidden', 'true');
            }
        }

        // Ensure proper ARIA attributes
        if (!modalEl.getAttribute('role')) modalEl.setAttribute('role', 'dialog');
        modalEl.setAttribute('aria-modal', 'true');

        // Apply inert to background landmarks
        setBackgroundInert(true);

        const trapHandler = (e) => {
            if (e.key === 'Tab') {
                const focusables = Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR))
                    .filter(el => el.offsetParent !== null || el === document.activeElement);
                if (focusables.length === 0) {
                    e.preventDefault();
                    return;
                }
                const first = focusables[0];
                const last = focusables[focusables.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first || !modalEl.contains(document.activeElement)) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (document.activeElement === last || !modalEl.contains(document.activeElement)) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            } else if (e.key === 'Escape') {
                // Check if active operation is running
                const isJobActive = (typeof window.isJobActive === 'function') && window.isJobActive();
                if (isJobActive) {
                    const confirmClose = window.confirm('An encryption or decryption operation is in progress. Closing this dialog will not stop the background job, but unsaved views may close. Close dialog?');
                    if (!confirmClose) {
                        e.preventDefault();
                        return;
                    }
                }

                // If media player has active zoom or theater, allow player's own handler to deal with it first
                if (modalEl.id === 'vault-media-modal' && typeof window.ZevMedia !== 'undefined') {
                    // Let media-player.js keydown listener handle Escape if custom state active
                    if (window.ZevMedia.isZoomed && window.ZevMedia.isZoomed()) return;
                }

                // Trigger modal close button
                const closeBtn = modalEl.querySelector('.modal-close-btn, .btn-close-modal, .media-btn-close, [data-modal-close]');
                if (closeBtn) {
                    e.preventDefault();
                    closeBtn.click();
                }
            }
        };

        modalEl.addEventListener('keydown', trapHandler);
        modalStack.push({ modalEl, openerEl: previousActive, trapHandler });

        // Shift initial focus to primary input or first focusable control
        requestAnimationFrame(() => {
            const initialFocus = modalEl.querySelector('[autofocus], input:not([type="hidden"]), select, textarea, button:not([disabled])');
            if (initialFocus) {
                initialFocus.focus();
            } else {
                modalEl.setAttribute('tabindex', '-1');
                modalEl.focus();
            }
        });
    }

    function closeModalA11y(modalEl) {
        if (!modalEl) return;
        const entryIdx = modalStack.findIndex(item => item.modalEl === modalEl);
        if (entryIdx === -1) return;

        const { openerEl, trapHandler } = modalStack[entryIdx];
        modalEl.removeEventListener('keydown', trapHandler);
        modalEl.removeAttribute('inert');
        modalEl.removeAttribute('aria-hidden');
        modalStack.splice(entryIdx, 1);

        // Restore previous modal in stack if nested
        if (modalStack.length > 0) {
            const topModal = modalStack[modalStack.length - 1];
            if (topModal.modalEl.hasAttribute('inert')) {
                topModal.modalEl.removeAttribute('inert');
                topModal.modalEl.removeAttribute('aria-hidden');
            }
        } else {
            // Restore background landmarks if no more modals are open
            setBackgroundInert(false);
            if (typeof document !== 'undefined') {
                document.querySelectorAll('[inert]').forEach(el => el.removeAttribute('inert'));
            }
        }

        // Restore focus to opener element
        if (openerEl && typeof openerEl.focus === 'function') {
            requestAnimationFrame(() => {
                openerEl.focus();
            });
        }
    }

    function closeAllModalsA11y() {
        while (modalStack.length > 0) {
            const { modalEl, trapHandler } = modalStack.pop();
            if (modalEl) {
                modalEl.removeEventListener('keydown', trapHandler);
                modalEl.removeAttribute('inert');
                modalEl.removeAttribute('aria-hidden');
            }
        }
        setBackgroundInert(false);
        if (typeof document !== 'undefined') {
            document.querySelectorAll('[inert]').forEach(el => el.removeAttribute('inert'));
        }
    }

    // ── 3. Vault Explorer Roving Tabindex ────────────────────────────
    /**
     * Initializes or refreshes roving tabindex on the explorer items container.
     * Container gets role="listbox", items get role="option".
     * Only 1 item has tabindex="0", all others have tabindex="-1".
     */
    function updateExplorerRovingTabindex(containerEl, activeIndex = 0) {
        if (!containerEl) return;
        containerEl.setAttribute('role', 'listbox');
        containerEl.setAttribute('aria-label', 'Decrypted vault files and directories');

        const items = Array.from(containerEl.querySelectorAll('.explorer-item, .explorer-grid-card'));
        if (items.length === 0) return;

        const safeIndex = Math.max(0, Math.min(activeIndex, items.length - 1));

        items.forEach((item, idx) => {
            item.setAttribute('role', 'option');
            item.setAttribute('tabindex', idx === safeIndex ? '0' : '-1');
            item.setAttribute('aria-selected', item.classList.contains('is-selected') || Boolean(item.querySelector('input:checked')));
        });
    }

    function handleExplorerKeydown(e, containerEl, onSelect, onDelete) {
        const items = Array.from(containerEl.querySelectorAll('.explorer-item, .explorer-grid-card'));
        if (items.length === 0) return;

        const currentActive = document.activeElement.closest('.explorer-item, .explorer-grid-card');
        const currentIndex = items.indexOf(currentActive);
        const isInputFocused = e.target.matches('input, textarea, select, [contenteditable]');

        // 1. Delete Key: Guard against active input / media player conflict
        if (e.key === 'Delete') {
            if (isInputFocused) return; // Allow normal input character deletion

            const isMediaActive = Boolean(document.getElementById('vault-media-modal') && !document.getElementById('vault-media-modal').classList.contains('d-none'));
            if (isMediaActive) return; // Never conflict with media player

            if (currentActive) {
                e.preventDefault();
                if (typeof onDelete === 'function') {
                    onDelete(currentActive);
                } else {
                    const delBtn = currentActive.querySelector('.explorer-file-del-btn');
                    if (delBtn) {
                        delBtn.click();
                    }
                }
            }
            return;
        }

        // 2. F2: Rename shortcut
        if (e.key === 'F2') {
            if (isInputFocused) return;
            if (currentActive) {
                e.preventDefault();
                const renameBtn = currentActive.querySelector('.explorer-file-rename-btn');
                if (renameBtn) renameBtn.click();
            }
            return;
        }

        // 3. Plain D: Download/Save shortcut (strictly plain D/d; never Ctrl/Cmd/Alt to avoid browser bookmark collision)
        if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const isMediaActive = Boolean(document.getElementById('vault-media-modal') && !document.getElementById('vault-media-modal').classList.contains('d-none'));
            if (isMediaActive) return;

            if (isInputFocused) return;
            if (currentActive) {
                e.preventDefault();
                const dlBtn = currentActive.querySelector('.explorer-file-dl-btn');
                if (dlBtn) dlBtn.click();
            }
            return;
        }

        // 4. Ctrl+A / Cmd+A: Select all items
        if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
            if (isInputFocused) return;
            e.preventDefault();
            const selectAllBtn = document.getElementById('explorer-btn-select-all');
            if (selectAllBtn) {
                selectAllBtn.click();
            } else {
                items.forEach(it => {
                    const cb = it.querySelector('.explorer-item-cb, .explorer-grid-cb');
                    if (cb && !cb.checked) cb.click();
                });
            }
            return;
        }

        // 5. ?: Open hotkeys cheatsheet
        if (e.key === '?' && !isInputFocused) {
            e.preventDefault();
            const hotkeysBtn = document.getElementById('btn-media-hotkeys');
            if (hotkeysBtn) {
                hotkeysBtn.click();
            } else {
                const hotkeysModal = document.getElementById('media-hotkeys-modal');
                if (hotkeysModal) hotkeysModal.classList.remove('d-none');
            }
            return;
        }

        // If focus is not currently on an item in this list, do not intercept arrows
        if (currentIndex === -1) return;

        let nextIndex = currentIndex;

        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowRight':
                e.preventDefault();
                nextIndex = (currentIndex + 1) % items.length;
                break;
            case 'ArrowUp':
            case 'ArrowLeft':
                e.preventDefault();
                nextIndex = (currentIndex - 1 + items.length) % items.length;
                break;
            case 'Home':
                e.preventDefault();
                nextIndex = 0;
                break;
            case 'End':
                e.preventDefault();
                nextIndex = items.length - 1;
                break;
            case 'Enter':
                // If target is an internal button or checkbox, let native event proceed
                if (e.target.matches('button, input, a')) return;
                e.preventDefault();
                if (typeof onSelect === 'function') {
                    onSelect(currentActive, false);
                } else {
                    const playBtn = currentActive.querySelector('.explorer-file-play-btn, .explorer-file-view-btn');
                    if (playBtn) playBtn.click();
                    else currentActive.click();
                }
                return;
            case ' ':
                // If target is an internal button or checkbox, let native event proceed
                if (e.target.matches('button, input, a')) return;
                e.preventDefault();
                if (typeof onSelect === 'function') {
                    onSelect(currentActive, true);
                } else {
                    const cb = currentActive.querySelector('.explorer-item-cb, .explorer-grid-cb');
                    if (cb) {
                        cb.click();
                        currentActive.setAttribute('aria-selected', cb.checked ? 'true' : 'false');
                    } else {
                        currentActive.click();
                    }
                }
                return;
            default:
                return;
        }

        // Multi-select with Shift+Arrow
        if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            const curCb = currentActive ? currentActive.querySelector('.explorer-item-cb, .explorer-grid-cb') : null;
            if (curCb && !curCb.checked) curCb.click();
            const targetCb = items[nextIndex] ? items[nextIndex].querySelector('.explorer-item-cb, .explorer-grid-cb') : null;
            if (targetCb) {
                targetCb.click();
                items[nextIndex].setAttribute('aria-selected', targetCb.checked ? 'true' : 'false');
            }
        }

        if (nextIndex !== currentIndex) {
            items[currentIndex].setAttribute('tabindex', '-1');
            items[nextIndex].setAttribute('tabindex', '0');
            items[nextIndex].focus();
        }
    }

    // ── 4. Form Password Reveal Toggle Accessibility ──────────────────
    function setupPasswordToggleA11y(btnId, inputId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (!btn || !input) return;

        btn.setAttribute('aria-pressed', input.type === 'text' ? 'true' : 'false');
        btn.setAttribute('aria-label', input.type === 'text' ? 'Hide password' : 'Show password');

        btn.addEventListener('click', () => {
            // Update ARIA states on toggle click
            setTimeout(() => {
                const isPlain = input.type === 'text';
                btn.setAttribute('aria-pressed', isPlain ? 'true' : 'false');
                btn.setAttribute('aria-label', isPlain ? 'Hide password' : 'Show password');
            }, 50);
        });
    }


    // ── 5. Automatic Modal Mutation Observers ─────────────────────────
    const MODAL_IDS = [
        'vault-explorer-modal', 'vault-media-modal', 'media-hotkeys-modal',
        'vault-image-modal', 'vault-text-modal', 'pw-save-modal', 'usb-backup-modal',
        'paper-safe-modal', 'qr-scanner-modal', 'install-pwa-modal', 'vault-health-modal',
        'vault-salvage-modal', 'pw-generator-modal'
    ];

    function initModalObservers() {
        MODAL_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el || el._a11yObserved) return;
            el._a11yObserved = true;

            const observer = new MutationObserver(mutations => {
                for (const m of mutations) {
                    if (m.type === 'attributes' && m.attributeName === 'class') {
                        const isVisible = !el.classList.contains('d-none');
                        const isTracked = modalStack.some(entry => entry.modalEl === el);
                        if (isVisible && !isTracked) {
                            openModalA11y(el);
                        } else if (!isVisible && isTracked) {
                            closeModalA11y(el);
                        }
                    }
                }
            });
            observer.observe(el, { attributes: true, attributeFilter: ['class'] });
        });
    }

    function setupAllPasswordToggles() {
        document.querySelectorAll('.toggle-pw').forEach(btn => {
            const targetId = btn.dataset.target;
            const input = targetId ? document.getElementById(targetId) : null;
            if (!input) return;

            btn.setAttribute('aria-pressed', input.type === 'text' ? 'true' : 'false');
            btn.setAttribute('aria-label', input.type === 'text' ? 'Hide password' : 'Show password');

            if (!btn._a11yWired) {
                btn._a11yWired = true;
                btn.addEventListener('click', () => {
                    setTimeout(() => {
                        const isPlain = input.type === 'text';
                        btn.setAttribute('aria-pressed', isPlain ? 'true' : 'false');
                        btn.setAttribute('aria-label', isPlain ? 'Hide password' : 'Show password');
                    }, 20);
                });
            }
        });
    }

    // ── Public API Surface ───────────────────────────────────────────
    window.ZevA11y = {
        announcePolite,
        announceAlert,
        announceProgressMilestone,
        announcePasswordStrength,
        openModalA11y,
        closeModalA11y,
        closeAllModals: closeAllModalsA11y,
        updateExplorerRovingTabindex,
        handleExplorerKeydown,
        setupPasswordToggleA11y,
        ensureLiveRegions
    };

    // Auto-initialize live regions, modal observers and password toggles on DOMContentLoaded
    function initA11y() {
        ensureLiveRegions();
        initModalObservers();
        setupAllPasswordToggles();

        if (typeof window !== 'undefined') {
            window.addEventListener('zevsafe-vault-locked', closeAllModalsA11y);
            window.addEventListener('zevsafe-panic', closeAllModalsA11y);
            window.addEventListener('pagehide', closeAllModalsA11y);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initA11y);
    } else {
        initA11y();
    }
})();
