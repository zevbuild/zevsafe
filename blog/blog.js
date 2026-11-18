/**
 * ZevSafe Knowledge & Security Blog Engine (blog.js)
 * 100% Client-Side, Zero-Knowledge, Zero-Network
 */

(function () {
    'use strict';

    // ── INITIALIZATION ────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        initReadingProgressBar();
        initSearchAndFilter();
        initCodeCopyButtons();
        initPbkdf2Calculator();
        initZv3HeaderInspector();
        initTableOfContentsScrollSpy();
    });

    // ── 1. TOP READING PROGRESS BAR ───────────────────────────────────────────
    function initReadingProgressBar() {
        const progressBar = document.querySelector('.blog-reading-progress');
        if (!progressBar) return;

        let ticking = false;
        function updateProgress() {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
            progressBar.style.width = Math.min(100, Math.max(0, progress)) + '%';
            ticking = false;
        }

        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(updateProgress);
                ticking = true;
            }
        }, { passive: true });
    }

    // ── 2. INSTANT SEARCH & CATEGORY FILTERING ────────────────────────────────
    function initSearchAndFilter() {
        const searchInput = document.getElementById('blog-search');
        const filterPills = document.querySelectorAll('.blog-filter-pill');
        const cards = document.querySelectorAll('.blog-card');
        const countDisplay = document.getElementById('blog-search-count');
        const emptyState = document.getElementById('blog-empty-state');
        const featuredCard = document.querySelector('.blog-featured-card');

        if (!cards.length) return;

        let activeCategory = 'all';

        function applyFilter() {
            const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
            let visibleCount = 0;

            cards.forEach(card => {
                const title = (card.querySelector('.blog-card-title')?.textContent || '').toLowerCase();
                const desc = (card.querySelector('.blog-card-desc')?.textContent || '').toLowerCase();
                const tags = (card.getAttribute('data-tags') || '').toLowerCase();
                const category = (card.getAttribute('data-category') || '').toLowerCase();
                const searchData = (card.getAttribute('data-search') || '').toLowerCase();

                const matchesQuery = !query || 
                    title.includes(query) || 
                    desc.includes(query) || 
                    tags.includes(query) || 
                    searchData.includes(query);

                const matchesCategory = (activeCategory === 'all') || (category === activeCategory);

                if (matchesQuery && matchesCategory) {
                    card.style.display = '';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });

            // Handle featured card visibility when searching
            if (featuredCard) {
                if (query.length > 0 || activeCategory !== 'all') {
                    const fTitle = (featuredCard.querySelector('.blog-featured-title')?.textContent || '').toLowerCase();
                    const fDesc = (featuredCard.querySelector('.blog-featured-desc')?.textContent || '').toLowerCase();
                    const fCategory = (featuredCard.getAttribute('data-category') || '').toLowerCase();
                    const fMatch = (!query || fTitle.includes(query) || fDesc.includes(query)) && 
                                   (activeCategory === 'all' || fCategory === activeCategory);
                    featuredCard.style.display = fMatch ? '' : 'none';
                } else {
                    featuredCard.style.display = '';
                }
            }

            if (countDisplay) {
                countDisplay.textContent = `Showing ${visibleCount} of ${cards.length} articles`;
            }

            if (emptyState) {
                emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
            }
        }

        // Search input listener
        if (searchInput) {
            searchInput.addEventListener('input', applyFilter);

            // Keyboard shortcuts: '/' to focus, 'ESC' to clear
            window.addEventListener('keydown', (e) => {
                if (e.key === '/' && document.activeElement !== searchInput && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                    e.preventDefault();
                    searchInput.focus();
                    searchInput.select();
                } else if (e.key === 'Escape' && document.activeElement === searchInput) {
                    searchInput.value = '';
                    searchInput.blur();
                    applyFilter();
                }
            });
        }

        // Category filter pills listener
        filterPills.forEach(pill => {
            pill.addEventListener('click', () => {
                filterPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                activeCategory = pill.getAttribute('data-category') || 'all';
                applyFilter();
            });
        });
    }

    // ── 3. CODE COPY BUTTONS ──────────────────────────────────────────────────
    function initCodeCopyButtons() {
        const containers = document.querySelectorAll('.blog-code-container');
        containers.forEach(container => {
            let header = container.querySelector('.blog-code-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'blog-code-header';
                header.innerHTML = `<span>Code Specification</span>`;
                container.prepend(header);
            }

            let btn = header.querySelector('.blog-code-copy-btn');
            if (!btn) {
                btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'blog-code-copy-btn';
                btn.textContent = 'Copy';
                btn.setAttribute('aria-label', 'Copy code to clipboard');
                header.appendChild(btn);
            }

            btn.addEventListener('click', async () => {
                const codeEl = container.querySelector('pre code') || container.querySelector('pre');
                if (!codeEl) return;
                const text = codeEl.innerText || codeEl.textContent;

                try {
                    await navigator.clipboard.writeText(text);
                    btn.textContent = 'Copied! ✓';
                    btn.style.color = 'var(--blog-emerald-light)';
                    setTimeout(() => {
                        btn.textContent = 'Copy';
                        btn.style.color = '';
                    }, 2200);
                } catch (err) {
                    btn.textContent = 'Error';
                    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                }
            });
        });
    }

    // ── 4. INTERACTIVE PBKDF2 WORK FACTOR & BRUTE-FORCE ESTIMATOR ─────────────
    function initPbkdf2Calculator() {
        const calcBox = document.querySelector('.interactive-calc-box');
        if (!calcBox) return;

        const roundsSelect = document.getElementById('calc-rounds');
        const entropySelect = document.getElementById('calc-entropy');
        const hardwareSelect = document.getElementById('calc-hardware');

        const outLatency = document.getElementById('calc-out-latency');
        const outKeyspace = document.getElementById('calc-out-keyspace');
        const outTime = document.getElementById('calc-out-time');
        const outCost = document.getElementById('calc-out-cost');

        function recalculate() {
            if (!roundsSelect || !entropySelect || !hardwareSelect) return;

            const rounds = parseInt(roundsSelect.value, 10) || 600000;
            const entropyBits = parseFloat(entropySelect.value) || 77.5; // default 6-word Diceware
            const gpuHashRateBase = parseFloat(hardwareSelect.value) || 15000; // hashes/sec at 600k rounds

            // Scale hash rate inversely with PBKDF2 rounds relative to standard 600,000
            const effectiveHashRate = gpuHashRateBase * (600000 / rounds);

            // Estimated derivation latency on a single user CPU core
            const latencyMs = Math.round((rounds / 600000) * 280);

            // Total keyspace: 2^(entropyBits)
            const totalCombinations = Math.pow(2, entropyBits);

            // Average trials to crack (50% keyspace)
            const avgTrials = totalCombinations / 2;

            // Seconds to crack = avgTrials / effectiveHashRate
            const seconds = avgTrials / Math.max(1, effectiveHashRate);

            // Format latency
            if (outLatency) {
                outLatency.textContent = `~${latencyMs} ms`;
            }

            // Format keyspace
            if (outKeyspace) {
                outKeyspace.textContent = `2^${Math.round(entropyBits)}`;
            }

            // Format crack time
            if (outTime) {
                outTime.textContent = formatHumanTime(seconds);
            }

            // Estimated electricity cost: Assume hardware consumes 450W per GPU unit
            if (outCost) {
                const kWhPerSecond = (450 / 1000) / 3600;
                const totalKWh = seconds * kWhPerSecond;
                const costDollars = totalKWh * 0.15; // $0.15 / kWh
                outCost.textContent = formatHumanCost(costDollars);
            }
        }

        function formatHumanTime(sec) {
            if (!isFinite(sec) || sec > 1e20) return '∞ (Untouchable)';
            const minute = 60;
            const hour = minute * 60;
            const day = hour * 24;
            const year = day * 365.25;
            const millionYears = year * 1e6;
            const billionYears = year * 1e9;

            if (sec > billionYears * 100) return '> 100 Billion Years';
            if (sec > billionYears) return `${(sec / billionYears).toFixed(1)} Billion Years`;
            if (sec > millionYears) return `${(sec / millionYears).toFixed(1)} Million Years`;
            if (sec > year * 1000) return `${(sec / (year * 1000)).toFixed(0)}k Years`;
            if (sec > year) return `${(sec / year).toFixed(1)} Years`;
            if (sec > day) return `${(sec / day).toFixed(0)} Days`;
            if (sec > hour) return `${(sec / hour).toFixed(1)} Hours`;
            return `${Math.round(sec)} Seconds`;
        }

        function formatHumanCost(dollars) {
            if (!isFinite(dollars) || dollars > 1e18) return '> $10 Quadrillion';
            if (dollars > 1e12) return `$${(dollars / 1e12).toFixed(1)} Trillion`;
            if (dollars > 1e9) return `$${(dollars / 1e9).toFixed(1)} Billion`;
            if (dollars > 1e6) return `$${(dollars / 1e6).toFixed(1)} Million`;
            if (dollars > 1e3) return `$${(dollars / 1e3).toFixed(0)}k`;
            return `$${Math.round(dollars).toLocaleString()}`;
        }

        [roundsSelect, entropySelect, hardwareSelect].forEach(el => {
            if (el) el.addEventListener('change', recalculate);
        });

        recalculate();
    }

    // ── 5. INTERACTIVE ZV3 57-BYTE HEADER INSPECTOR ───────────────────────────
    function initZv3HeaderInspector() {
        const inspector = document.querySelector('.zv3-inspector-box');
        if (!inspector) return;

        const segments = inspector.querySelectorAll('.zv3-byte-seg');
        const titleEl = inspector.querySelector('.zv3-info-title');
        const descEl = inspector.querySelector('.zv3-info-desc');

        const BYTE_DATA = {
            magic: {
                title: 'Bytes 0..3: Magic Identifier ("ZV3\\0")',
                desc: 'Fixed 4-byte ASCII constant (0x5A 0x56 0x33 0x00). Formally identifies the file as a Version 3 STREAM AEAD container. Parsers instantly reject any file lacking these 4 bytes before deriving keys.'
            },
            version: {
                title: 'Byte 4: Container Format Version (0x03)',
                desc: 'Single 8-bit unsigned integer enforcing container schema v3. Guarantees backwards and forwards cryptographic parser isolation across Web, Android, and Desktop tools.'
            },
            flags: {
                title: 'Byte 5: Bitmask Flags (0x01 = Keyfile 2FA, 0x02 = Duress)',
                desc: 'Bit 0 indicates whether a physical hardware keyfile was mixed into PBKDF2 output. Bit 1 indicates duress capability. In v8.27+, Bit 1 is zeroed out for plausible deniability.'
            },
            chunksize: {
                title: 'Bytes 6..9: Chunk Size (Uint32 Big-Endian)',
                desc: 'Specifies the maximum plaintext size per encrypted AEAD block. Default is 4,194,304 bytes (4 MB). Enables streaming multi-gigabyte vaults under strict < 150 MB RAM ceilings.'
            },
            salt: {
                title: 'Bytes 10..41: PBKDF2-SHA512 CSPRNG Salt (32 Bytes)',
                desc: 'Cryptographically secure 256-bit random salt generated via window.crypto.getRandomValues(). Guarantees rainbow table and precomputed hash immunity across all vaults.'
            },
            baseiv: {
                title: 'Bytes 42..48: Base IV Prefix (7 Bytes)',
                desc: '7-byte random CSPRNG prefix. Combined with a 4-byte big-endian chunk counter and a 1-byte isLast flag to form unique, non-repeating 12-byte IVs for every single chunk.'
            },
            manifest: {
                title: 'Bytes 49..56: Tail Manifest Byte Offset (Uint64 Big-Endian)',
                desc: '64-bit integer pointing to the exact byte offset where the encrypted directory catalog begins. Allows O(1) instant catalog browsing without reading preceding multi-gigabyte chunks.'
            }
        };

        segments.forEach(seg => {
            seg.addEventListener('click', () => {
                segments.forEach(s => s.classList.remove('active'));
                seg.classList.add('active');
                const key = seg.getAttribute('data-segment');
                if (key && BYTE_DATA[key]) {
                    if (titleEl) titleEl.textContent = BYTE_DATA[key].title;
                    if (descEl) descEl.textContent = BYTE_DATA[key].desc;
                }
            });
        });
    }

    // ── 6. TABLE OF CONTENTS SCROLL SPY ───────────────────────────────────────
    function initTableOfContentsScrollSpy() {
        const tocLinks = document.querySelectorAll('.blog-toc-list a');
        if (!tocLinks.length) return;

        const headingMap = [];
        tocLinks.forEach(link => {
            const targetId = link.getAttribute('href')?.replace('#', '');
            if (targetId) {
                const el = document.getElementById(targetId);
                if (el) headingMap.push({ id: targetId, link, el });
            }
        });

        if (!headingMap.length) return;

        let ticking = false;
        function updateActiveSection() {
            const scrollPos = window.scrollY + 120;
            let current = headingMap[0];

            for (let i = 0; i < headingMap.length; i++) {
                if (headingMap[i].el.offsetTop <= scrollPos) {
                    current = headingMap[i];
                } else {
                    break;
                }
            }

            tocLinks.forEach(l => l.classList.remove('active'));
            if (current && current.link) {
                current.link.classList.add('active');
            }
            ticking = false;
        }

        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(updateActiveSection);
                ticking = true;
            }
        }, { passive: true });
    }

})();
