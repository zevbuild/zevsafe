/**
 * ZevSafe Knowledge Base & Service Manual Engine
 * Zero-Knowledge, 100% Client-Side
 */

(function () {
    'use strict';

    const STORAGE_KEY_MODE = 'zevsafe_kb_mode';
    const DEFAULT_MODE = 'combined';

    // ── PERSPECTIVE CONTROLLER (Simple / Technical / Combined) ──
    function initPerspective() {
        let currentMode = localStorage.getItem(STORAGE_KEY_MODE) || DEFAULT_MODE;
        setMode(currentMode);

        const buttons = document.querySelectorAll('.kb-perspective-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-mode');
                if (mode) {
                    setMode(mode);
                }
            });
        });
    }

    function setMode(mode) {
        document.documentElement.setAttribute('data-knowledge-mode', mode);
        try {
            localStorage.setItem(STORAGE_KEY_MODE, mode);
        } catch (e) {
            // Ignore storage failure in private windows
        }

        const buttons = document.querySelectorAll('.kb-perspective-btn');
        buttons.forEach(btn => {
            if (btn.getAttribute('data-mode') === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // ── READING PROGRESS BAR ──
    function initReadingProgress() {
        const progressBar = document.querySelector('.kb-reading-progress');
        if (!progressBar) return;

        window.addEventListener('scroll', () => {
            const winScroll = document.documentElement.scrollTop || document.body.scrollTop;
            const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrolled = height > 0 ? (winScroll / height) * 100 : 0;
            progressBar.style.width = scrolled + '%';
        }, { passive: true });
    }

    // ── SEARCH & FILTER (HUB PAGE) ──
    function initSearch() {
        const searchInput = document.getElementById('kb-search');
        if (!searchInput) return;

        const cards = document.querySelectorAll('.kb-card');
        const countDisplay = document.getElementById('kb-search-count');
        const emptyState = document.getElementById('kb-empty-search');

        function performFilter() {
            const query = searchInput.value.trim().toLowerCase();
            let visibleCount = 0;

            cards.forEach(card => {
                const title = (card.querySelector('.kb-card-title')?.textContent || '').toLowerCase();
                const desc = (card.querySelector('.kb-card-desc')?.textContent || '').toLowerCase();
                const tags = (card.getAttribute('data-tags') || '').toLowerCase();
                const searchKeys = (card.getAttribute('data-search') || '').toLowerCase();

                const isMatch = !query || 
                    title.includes(query) || 
                    desc.includes(query) || 
                    tags.includes(query) || 
                    searchKeys.includes(query);

                if (isMatch) {
                    card.style.display = '';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });

            if (countDisplay) {
                countDisplay.textContent = `Showing ${visibleCount} of ${cards.length} services`;
            }

            if (emptyState) {
                emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
            }
        }

        searchInput.addEventListener('input', performFilter);

        // Global hotkey: '/' to focus search, 'Escape' to clear
        window.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            } else if (e.key === 'Escape' && document.activeElement === searchInput) {
                searchInput.value = '';
                performFilter();
                searchInput.blur();
            }
        });
    }

    // ── CODE COPY HANDLER ──
    function showToast(message) {
        let toast = document.querySelector('.kb-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'kb-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 2200);
    }

    function initCodeCopy() {
        const copyButtons = document.querySelectorAll('.kb-copy-btn');
        copyButtons.forEach(btn => {
            btn.addEventListener('click', async () => {
                const block = btn.closest('.kb-code-block');
                const codeElem = block ? block.querySelector('.kb-code-body') : null;
                if (!codeElem) return;

                const text = codeElem.textContent;
                try {
                    await navigator.clipboard.writeText(text);
                    const originalText = btn.textContent;
                    btn.textContent = 'Copied!';
                    showToast('Snippet copied to clipboard');
                    setTimeout(() => {
                        btn.textContent = originalText;
                    }, 2000);
                } catch (err) {
                    showToast('Failed to copy');
                }
            });
        });
    }

    // ── SCROLLSPY / TOC HIGHLIGHT ──
    function initScrollspy() {
        const tocLinks = document.querySelectorAll('.kb-toc-link');
        if (tocLinks.length === 0) return;

        const sections = [];
        tocLinks.forEach(link => {
            const targetId = link.getAttribute('href');
            if (targetId && targetId.startsWith('#')) {
                const el = document.getElementById(targetId.substring(1));
                if (el) sections.push({ link, el });
            }
        });

        window.addEventListener('scroll', () => {
            const scrollPos = window.scrollY + 120;
            let current = null;

            for (const item of sections) {
                if (item.el.offsetTop <= scrollPos) {
                    current = item.link;
                }
            }

            tocLinks.forEach(link => link.classList.remove('active'));
            if (current) {
                current.classList.add('active');
            }
        }, { passive: true });
    }

    // ── INITIALIZATION ──
    document.addEventListener('DOMContentLoaded', () => {
        initPerspective();
        initReadingProgress();
        initSearch();
        initCodeCopy();
        initScrollspy();
    });
})();
