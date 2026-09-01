// ============================================
// DOM ELEMENTS
// ============================================
const encryptDropZone     = document.getElementById('encrypt-drop-zone');
const encryptFolderInput  = document.getElementById('encrypt-folder-input');    // mobile input
const encryptFolderInputDz= document.getElementById('encrypt-folder-input-dz'); // desktop drop-zone input
const encryptSelectedInfo = document.getElementById('encrypt-selected-info');
const encryptPassword     = document.getElementById('encrypt-password');
const encryptConfirm      = document.getElementById('encrypt-confirm');
const btnEncrypt          = document.getElementById('btn-encrypt');

const encryptDzInner      = document.getElementById('encrypt-dz-inner');
const encryptSelectedWidget = document.getElementById('encrypt-selected-widget');
const encryptSelectedName = document.getElementById('encrypt-selected-name');
const encryptSelectedMeta = document.getElementById('encrypt-selected-meta');
const btnClearEncrypt     = document.getElementById('btn-clear-encrypt');

const decryptDropZone     = document.getElementById('decrypt-drop-zone');
const decryptFileInput    = document.getElementById('decrypt-file-input');      // mobile input
const decryptFileInputDz  = document.getElementById('decrypt-file-input-dz');  // desktop drop-zone input
const decryptSelectedInfo = document.getElementById('decrypt-selected-info');
const decryptPassword     = document.getElementById('decrypt-password');
const btnDecrypt          = document.getElementById('btn-decrypt');

const decryptDzInner      = document.getElementById('decrypt-dz-inner');
const decryptSelectedWidget = document.getElementById('decrypt-selected-widget');
const decryptSelectedName = document.getElementById('decrypt-selected-name');
const decryptSelectedMeta = document.getElementById('decrypt-selected-meta');
const btnClearDecrypt     = document.getElementById('btn-clear-decrypt');

const progressCard        = document.getElementById('progress-card');
const progressTitle       = document.getElementById('progress-title');
const progressPercentage  = document.getElementById('progress-percentage');
const progressBarFill     = document.getElementById('progress-bar-fill');
const logOutput           = document.getElementById('log-output');
const statusDot           = document.getElementById('status-dot');

// ============================================
// STATE
// ============================================
let selectedEncryptFiles      = [];
let selectedEncryptFolderName = '';
let selectedDecryptFile       = null;

// ── V2 STATE ──────────────────────────────────
let v2KeyfileEncrypt = null;  // File object for encryption keyfile
let v2KeyfileDecrypt = null;  // File object for decryption keyfile

// ============================================
// V2 CONSTANTS — Magic header bytes for format detection
// ============================================
// v1 format: [Salt(16) | IV(12) | Ciphertext]  (no magic prefix)
// v2 format: [Magic(4)=ZV2\0 | Version(1)=0x02 | Flags(1) | Salt(32) | IV(12) | Ciphertext]
// Flags bit 0 (0x01): keyfile was used
const V2_MAGIC        = new Uint8Array([0x5A, 0x56, 0x32, 0x00]); // 'ZV2\0'
const V2_VERSION_BYTE = 0x02;
const V2_FLAG_KEYFILE = 0x01;
// Offsets within a v2 file
const V2_OFFSET_VERSION  = 4;   // 1 byte
const V2_OFFSET_FLAGS    = 5;   // 1 byte
const V2_OFFSET_SALT     = 6;   // 32 bytes
const V2_OFFSET_IV       = 38;  // 12 bytes
const V2_OFFSET_CIPHER   = 50;  // rest
const V2_HEADER_SIZE     = 50;  // bytes before ciphertext
const PASSWORD_RECOVERY_WARNING = 'If you lose this password or required keyfile, decryption will not be possible. Encrypted files or folders may be permanently inaccessible.';

let lastPasswordRecoveryRecord = null;

// ============================================
// DEVICE DETECTION & ADAPTIVE UI
// ============================================

/**
 * Detects if the user is on a touch/mobile device.
 * Uses screen width AND pointer type for accuracy.
 */
const isMobile = () =>
    window.innerWidth <= 820 ||
    window.matchMedia('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|iPod|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent);

function initDeviceUI() {
    if (isMobile()) {
        // Change drop zone text for mobile
        const encryptDropText = document.querySelector('#encrypt-drop-zone .drop-primary');
        if (encryptDropText) encryptDropText.textContent = 'Tap to select files';

        const decryptDropText = document.querySelector('#decrypt-drop-zone .drop-primary');
        if (decryptDropText) decryptDropText.textContent = 'Tap to select .zev file';

        // Show mobile tabs
        const mobileTabs = document.getElementById('mobile-tabs');
        if (mobileTabs) mobileTabs.style.display = 'flex';

        // Default to encrypt tab on mobile
        if (window.innerWidth <= 520) switchTab('encrypt', false);
    }
}

/**
 * Switch between Encrypt and Decrypt panels on mobile.
 * @param {'encrypt'|'decrypt'} tab
 * @param {boolean} animate - whether to animate the switch
 */
function switchTab(tab, animate = true) {
    const encSection = document.getElementById('encrypt-section');
    const decSection = document.getElementById('decrypt-section');
    const tabEnc     = document.getElementById('tab-encrypt');
    const tabDec     = document.getElementById('tab-decrypt');

    if (!encSection || !decSection) return;

    // Only switch panels on small screens; on tablet/desktop show both
    if (window.innerWidth <= 520) {
        if (tab === 'encrypt') {
            encSection.style.display = 'block';
            decSection.style.display = 'none';
        } else {
            encSection.style.display = 'none';
            decSection.style.display = 'block';
        }
    }

    // Update top tab active state
    if (tabEnc && tabDec) {
        tabEnc.classList.toggle('mobile-tab--active', tab === 'encrypt');
        tabDec.classList.toggle('mobile-tab--active', tab === 'decrypt');
        tabEnc.setAttribute('aria-selected', tab === 'encrypt');
        tabDec.setAttribute('aria-selected', tab === 'decrypt');
    }

    // Scroll to the active card smoothly
    if (animate) {
        const target = tab === 'encrypt' ? encSection : decSection;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Wire mobile file inputs (large tap buttons shown on phone)
function onEncryptFilesSelected(files, folderName) {
    selectedEncryptFiles      = files;
    selectedEncryptFolderName = folderName;
    encryptSelectedInfo.textContent = `✅ ${folderName} — ${files.length} file(s)`;
    log(`Folder "${folderName}" selected (${files.length} files).`, 'info');
    showProgress();
}

function onDecryptFileSelected(files) {
    if (files.length > 0) {
        selectedDecryptFile = files[0];
        decryptSelectedInfo.textContent = `✅ ${selectedDecryptFile.name}`;
        log(`Vault file "${selectedDecryptFile.name}" selected.`, 'info');
        showProgress();
    }
}


// Re-check device on resize (e.g. rotation)
window.addEventListener('resize', () => {
    if (window.innerWidth > 520) {
        // Restore both panels on wider screens
        const encSection = document.getElementById('encrypt-section');
        const decSection = document.getElementById('decrypt-section');
        if (encSection) encSection.style.display = '';
        if (decSection) decSection.style.display = '';
    }
});

// Run on load
initDeviceUI();



// ============================================
// SHOW / HIDE PASSWORD TOGGLE
// ============================================
document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🙈';
            btn.setAttribute('aria-label', 'Hide password');
        } else {
            input.type = 'password';
            btn.textContent = '👁';
            btn.setAttribute('aria-label', 'Show password');
        }
    });
});

// ============================================
// DRAG & DROP — FIXED ASYNC TRAVERSAL
// ============================================

/**
 * Recursively reads a FileSystemEntry (file or directory) into a flat array.
 * Returns a Promise that resolves with all File objects, each carrying .relativeDir.
 */
function readEntryAsync(entry, pathPrefix) {
    return new Promise((resolve) => {
        if (entry.isFile) {
            entry.file(file => {
                file.relativeDir = pathPrefix + file.name;
                resolve([file]);
            }, () => resolve([])); // error reading file → skip
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const allFiles = [];

            const readBatch = () => {
                reader.readEntries(entries => {
                    if (entries.length === 0) {
                        // All batches read — done
                        resolve(allFiles);
                    } else {
                        // Chrome caps readEntries at 100 items per call — keep reading
                        const promises = entries.map(e =>
                            readEntryAsync(e, pathPrefix + entry.name + '/')
                        );
                        Promise.all(promises).then(results => {
                            results.forEach(r => allFiles.push(...r));
                            readBatch(); // read next batch
                        });
                    }
                }, () => resolve(allFiles)); // error on readEntries → return what we have
            };

            readBatch();
        } else {
            resolve([]);
        }
    });
}

function setupDragAndDrop(dropZone, fileInput, onFilesSelected, requireFolder = false) {
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        dropZone.addEventListener(ev, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    // Highlight effect
    ['dragenter', 'dragover'].forEach(ev =>
        dropZone.addEventListener(ev, () => dropZone.classList.add('drag-over'), false)
    );
    ['dragleave', 'drop'].forEach(ev =>
        dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-over'), false)
    );

    // Handle drop
    dropZone.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;

        // Restrict drops to folders only if requireFolder is true and it's not a mobile browser
        if (requireFolder && !isMobile()) {
            if (dt.items && dt.items.length > 0) {
                const entry = dt.items[0].webkitGetAsEntry();
                if (!entry || !entry.isDirectory) {
                    alert('⚠️ Only folder uploads are supported. Please drag and drop a folder.');
                    return;
                }
            } else if (dt.files.length > 0 && !dt.files[0].webkitRelativePath) {
                alert('⚠️ Only folder uploads are supported. Please drag and drop a folder.');
                return;
            }
        }

        if (dt.items && dt.items.length > 0) {
            const rootName = dt.items[0].webkitGetAsEntry()?.name || 'files';
            const promises = [];

            for (let i = 0; i < dt.items.length; i++) {
                const entry = dt.items[i].webkitGetAsEntry();
                if (entry) {
                    promises.push(readEntryAsync(entry, ''));
                }
            }

            const results = await Promise.all(promises);
            const files = results.flat();

            if (files.length > 0) {
                onFilesSelected(files, rootName);
            } else {
                log('No readable files found in the dropped item.', 'warn');
            }
        } else {
            // Fallback for browsers without filesystem API
            const files = Array.from(dt.files);
            onFilesSelected(files, files[0]?.name || 'files');
        }
    });

    // Click to open file picker (only if not triggered from inside the browse button)
    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('.btn-browse') || e.target.closest('.btn-browse--teal')) return;
        const activeInput = isMobile() ? fileInput : (document.getElementById(fileInput.id + '-dz') || fileInput);
        if (activeInput) activeInput.click();
    });

    // Keyboard accessibility
    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const activeInput = isMobile() ? fileInput : (document.getElementById(fileInput.id + '-dz') || fileInput);
            if (activeInput) activeInput.click();
        }
    });

    // Helper to handle selected files
    const handleFiles = (inputEl) => {
        const files = Array.from(inputEl.files);
        if (files.length > 0) {
            let folderName = 'folder';
            for (const f of files) {
                if (f.webkitRelativePath) {
                    folderName = f.webkitRelativePath.split('/')[0];
                    break;
                }
            }
            if (folderName === 'folder' && files.length > 1) {
                folderName = 'secured_files';
            } else if (folderName === 'folder' && files.length === 1) {
                folderName = files[0].name.substring(0, files[0].name.lastIndexOf('.')) || files[0].name;
            }
            onFilesSelected(files, folderName);
        }
        inputEl.value = '';
    };

    // Handle browse input for mobile fileInput
    if (fileInput) {
        fileInput.addEventListener('change', () => handleFiles(fileInput));
    }

    // Handle browse input for desktop fileInput if it exists
    const desktopInput = document.getElementById(fileInput.id + '-dz');
    if (desktopInput) {
        desktopInput.addEventListener('change', () => handleFiles(desktopInput));
    }
}

// Initialize Drag & Drop
setupDragAndDrop(encryptDropZone, encryptFolderInput, (files, folderName) => {
    selectedEncryptFiles      = files;
    selectedEncryptFolderName = folderName;
    
    let totalSize = 0;
    for (const f of files) {
        totalSize += f.size;
    }
    
    if (encryptDzInner && encryptSelectedWidget) {
        encryptDzInner.style.display = 'none';
        encryptSelectedWidget.style.display = 'flex';
        encryptSelectedName.textContent = folderName;
        encryptSelectedMeta.textContent = `${files.length} file(s) · ${formatBytes(totalSize)}`;
    }
    
    encryptSelectedInfo.style.display = 'none';
    log(`Folder "${folderName}" selected (${files.length} files, ${formatBytes(totalSize)}).`, 'info');
    if (totalSize > 2.5 * 1024 * 1024 * 1024) {
        log('💡 Very large folder (>2.5 GB). For instant 25GB+ background processing with zero RAM limits, click "PC Setup (25+ GB)" in the top bar.', 'info');
    }
    showProgress();
    

}, true);

setupDragAndDrop(decryptDropZone, decryptFileInput, (files) => {
    if (files.length > 0) {
        selectedDecryptFile = files[0];
        
        if (decryptDzInner && decryptSelectedWidget) {
            decryptDzInner.style.display = 'none';
            decryptSelectedWidget.style.display = 'flex';
            decryptSelectedName.textContent = selectedDecryptFile.name;
            decryptSelectedMeta.textContent = formatBytes(selectedDecryptFile.size);
        }
        
        decryptSelectedInfo.style.display = 'none';
        log(`Vault file "${selectedDecryptFile.name}" selected (${formatBytes(selectedDecryptFile.size)}).`, 'info');
        showProgress();
    }
});

// ============================================
// PROGRESS & LOGGING HELPERS
// ============================================

function log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;
    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight;
}

function showProgress(autoScroll = false) {
    if (progressCard.style.display !== 'flex') {
        progressCard.style.display = 'flex';
        progressCard.style.animation = 'detailFadeIn 0.3s ease';
        if (autoScroll && isMobile()) {
            setTimeout(() => {
                progressCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
    }
    if (statusDot) {
        statusDot.style.background = 'var(--purple-light)';
        statusDot.style.animationPlayState = 'running';
    }
}

function updateProgress(title, percent) {
    showProgress();
    progressTitle.textContent = title;
    progressPercentage.textContent = `${Math.round(percent)}%`;
    progressBarFill.style.width = `${percent}%`;
    // Color the status dot based on state
    if (statusDot) {
        if (percent >= 100) {
            statusDot.style.background = 'var(--success)';
            statusDot.style.animationPlayState = 'paused';
        } else if (title === 'Failed') {
            statusDot.style.background = 'var(--danger)';
            statusDot.style.animationPlayState = 'paused';
        } else {
            statusDot.style.background = 'var(--purple-light)';
            statusDot.style.animationPlayState = 'running';
        }
    }
}

function resetProgress() {
    progressBarFill.style.width = '0%';
    progressPercentage.textContent = '0%';
}

function clearLogs() {
    logOutput.innerHTML = '';
}

/** Revoke an object URL after a short delay to prevent memory leaks */
function revokeAfterDelay(url, delayMs = 60000) {
    setTimeout(() => URL.revokeObjectURL(url), delayMs);
}

/** Trigger a file download and clean up the blob URL */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    revokeAfterDelay(url); // fix: revoke blob URL to avoid memory leak
}

function sanitizeFilenamePart(value, fallback = 'zevsafe-vault') {
    const cleaned = String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, '_')
        .replace(/-+/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '');
    return cleaned || fallback;
}

function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildPasswordRecoveryText(record) {
    const generatedAt = new Date().toLocaleString();
    const keyfileLine = record.keyfileRequired
        ? `Required keyfile: ${record.keyfileName || 'Selected keyfile'}\nKeyfile SHA-256 fingerprint: ${record.keyfileFingerprint || 'Unavailable'}\n`
        : 'Required keyfile: None\n';

    return [
        'ZevSafe Password Recovery Sheet',
        '================================',
        '',
        'WARNING',
        PASSWORD_RECOVERY_WARNING,
        'There is no password recovery, reset, or backdoor.',
        '',
        'Vault Details',
        '-------------',
        `Encrypted folder/project: ${record.folderName}`,
        `Vault file: ${record.vaultFilename}`,
        `Vault format: ${record.version}`,
        `Created: ${generatedAt}`,
        '',
        'Password / Encryption Key',
        '-------------------------',
        record.password,
        '',
        'Second Factor',
        '-------------',
        keyfileLine.trimEnd(),
        '',
        'Storage Instructions',
        '--------------------',
        'Print this sheet or store it offline in a secure place.',
        'Keep it separate from the encrypted vault file.',
        'Anyone with this password and required keyfile can decrypt the vault.',
        ''
    ].join('\n');
}

function downloadPasswordRecoverySheet(record = lastPasswordRecoveryRecord) {
    if (!record || !record.password) {
        alert('No password recovery details are available yet. Encrypt a folder first.');
        return;
    }

    const text = buildPasswordRecoveryText(record);
    const folderName = sanitizeFilenamePart(record.folderName || record.vaultFilename);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, `${folderName}_password_recovery_sheet.txt`);
    log(`Password recovery sheet downloaded for "${record.folderName}".`, 'success');
}

function printPasswordRecoverySheet(record = lastPasswordRecoveryRecord) {
    if (!record || !record.password) {
        alert('No password recovery details are available yet. Encrypt a folder first.');
        return;
    }

    const text = buildPasswordRecoveryText(record);
    const iframe = document.createElement('iframe');
    iframe.title = 'ZevSafe password recovery print sheet';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const printWindow = iframe.contentWindow;
    const printDocument = printWindow.document;
    printDocument.open();
    printDocument.write(`<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>ZevSafe Password Recovery Sheet</title>
    <style>
        body { font-family: Arial, sans-serif; color: #111827; margin: 32px; line-height: 1.45; }
        pre { white-space: pre-wrap; word-break: break-word; font: 14px/1.5 Consolas, monospace; }
        .warning { border: 2px solid #be123c; padding: 12px; margin-bottom: 18px; color: #be123c; font-weight: 700; }
        @media print { body { margin: 18mm; } .warning { break-inside: avoid; } }
    </style>
</head>
<body>
    <div class="warning">${escapeHtml(PASSWORD_RECOVERY_WARNING)}</div>
    <pre>${escapeHtml(text)}</pre>
</body>
</html>`);
    printDocument.close();

    setTimeout(() => {
        try {
            printWindow.focus();
            printWindow.print();
            log(`Password recovery sheet opened for printing for "${record.folderName}".`, 'success');
        } catch (err) {
            alert('Printing failed. Use Download Sheet and print the downloaded text file.');
            console.error('[ZevSafe Print Recovery Sheet]', err);
        } finally {
            setTimeout(() => {
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }, 1000);
        }
    }, 150);
}

// ============================================
// PROGRESS TRACKER — Real-Time Stage System
// ============================================
//
// Provides visual progress for: Compress → Encrypt/Decrypt → Save
//
// Design rules:
//  • Compression % is REAL    — from JSZip meta.percent callback
//  • Crypto % is ANIMATED     — smooth fill during blocking AES call
//  • Sizes & timing are REAL  — from actual byte counts + performance.now()
//  • No passwords, keys, or sensitive data are ever exposed in the UI
//
const ProgressTracker = (() => {
    // ── DOM refs (grabbed lazily, safe since this runs after DOMContentLoaded) ──
    const $ = id => document.getElementById(id);

    // Pill state constants
    const STATE = { IDLE: 'idle', ACTIVE: 'active', DONE: 'done', ERROR: 'error' };

    // Internal timing
    let _opStart    = 0;  // whole operation start (performance.now)
    let _stageStart = 0;  // current stage start
    let _rafId      = null; // requestAnimationFrame handle for animated fill
    let _opMode     = 'encrypt'; // 'encrypt' | 'decrypt'

    // ── Helpers ──────────────────────────────────────────────────

    /** Format elapsed milliseconds as "1.23s" or "123ms" */
    function _fmtTime(ms) {
        return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
    }

    /** Set a stage pill state: idle | active | done | error */
    function _setPillState(pillId, state, pct = '—') {
        const pill = $(pillId);
        if (!pill) return;
        pill.dataset.state = state;
        const pctEl = pill.querySelector('.stage-pill-pct');
        if (pctEl) pctEl.textContent = pct;
    }

    /** Set a stage connector as filled (active) or not */
    function _setConnector(connId, active) {
        const conn = $(connId);
        if (conn) conn.classList.toggle('stage-connector--active', active);
    }

    /** Update a detail card's sub-bar fill */
    function _setSubBar(barId, pct) {
        const bar = $(barId);
        if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }

    /** Set a badge text + class */
    function _setBadge(badgeId, text, cls = '') {
        const el = $(badgeId);
        if (!el) return;
        el.textContent = text;
        el.className = `sd-badge${cls ? ' ' + cls : ''}`;
    }

    /** Show a detail card */
    function _showDetail(detailId) {
        const el = $(detailId);
        if (el) el.style.display = '';
        const details = $('stage-details');
        if (details) details.style.display = '';
    }

    /** Cancel any running requestAnimationFrame animation */
    function _stopRaf() {
        if (_rafId !== null) {
            cancelAnimationFrame(_rafId);
            _rafId = null;
        }
    }

    /**
     * Animate a sub-bar from `from` to `to` over `durationMs`.
     * Uses requestAnimationFrame — does NOT block the main thread.
     */
    function _animateBar(barId, from, to, durationMs, onDone) {
        _stopRaf();
        const startTime = performance.now();
        const range = to - from;

        function tick(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / durationMs, 1);
            // Ease-out cubic for smooth deceleration
            const eased = 1 - Math.pow(1 - t, 3);
            _setSubBar(barId, from + range * eased);
            if (t < 1) {
                _rafId = requestAnimationFrame(tick);
            } else {
                _rafId = null;
                if (onDone) onDone();
            }
        }
        _rafId = requestAnimationFrame(tick);
    }

    // ── Public API ────────────────────────────────────────────────

    /**
     * Call before starting any operation.
     * Resets all stage pills and detail cards.
     * @param {'encrypt'|'decrypt'} mode
     */
    function reset(mode = 'encrypt') {
        _opStart    = performance.now();
        _stageStart = _opStart;
        _opMode     = mode;
        _stopRaf();

        // Reset all pills
        ['stage-compress', 'stage-crypto', 'stage-save'].forEach(id => {
            _setPillState(id, STATE.IDLE, '—');
        });
        _setConnector('stage-conn-1', false);
        _setConnector('stage-conn-2', false);

        // Reset crypto pill label/icon based on mode
        const cryptoLabel = $('stage-crypto-label');
        const cryptoIcon  = $('stage-crypto-icon');
        if (cryptoLabel) cryptoLabel.textContent = mode === 'encrypt' ? 'Encrypt' : 'Decrypt';
        if (cryptoIcon)  cryptoIcon.textContent  = mode === 'encrypt' ? '🔐' : '🔓';

        // Reset detail card labels
        const sdCryptoTitle = $('sd-crypto-title');
        const sdCryptoIcon  = $('sd-crypto-icon');
        const sdSaveTitle   = $('sd-save-title');
        if (sdCryptoTitle) sdCryptoTitle.textContent = mode === 'encrypt' ? 'Encryption' : 'Decryption';
        if (sdCryptoIcon)  sdCryptoIcon.textContent  = mode === 'encrypt' ? '🔐' : '🔓';
        if (sdSaveTitle)   sdSaveTitle.textContent   = mode === 'encrypt' ? 'Output Vault' : 'Decrypted Output';

        // Hide all detail cards
        ['detail-compress', 'detail-crypto', 'detail-save'].forEach(id => {
            const el = $(id);
            if (el) el.style.display = 'none';
        });
        const detailsWrap = $('stage-details');
        if (detailsWrap) detailsWrap.style.display = 'none';

        // Reset metrics
        [
            'sd-original-size','sd-compressed-size','sd-ratio','sd-compress-time',
            'sd-crypto-size','sd-crypto-time','sd-output-name','sd-output-size','sd-total-time','sd-vault-version'
        ].forEach(id => { const el = $(id); if (el) el.textContent = '—'; });

        $('sd-auth-tag') && ($('sd-auth-tag').textContent = 'Pending');
        _setSubBar('sd-compress-bar', 0);
        _setSubBar('sd-crypto-bar', 0);
        _setBadge('sd-compress-status', 'In Progress', 'sd-badge--active');
        _setBadge('sd-crypto-status',   'In Progress', 'sd-badge--active');
        _setBadge('sd-save-status',     'Waiting');
    }

    /**
     * Compression stage — real progress from JSZip meta.percent callback.
     * Call this inside the JSZip generateAsync progress callback.
     * @param {number} percent   0–100 real value from JSZip
     * @param {number} origBytes total original file bytes (sum of input files)
     */
    function onCompressProgress(percent, origBytes) {
        const elapsed = performance.now() - _stageStart;

        // Activate pill on first call
        if (percent > 0 && percent < 100) {
            _setPillState('stage-compress', STATE.ACTIVE, `${Math.round(percent)}%`);
        }

        // Show compress detail card
        _showDetail('detail-compress');

        // Update metrics
        const origEl = $('sd-original-size');
        if (origEl && origBytes > 0) origEl.textContent = formatBytes(origBytes);

        const timeEl = $('sd-compress-time');
        if (timeEl) timeEl.textContent = _fmtTime(elapsed);

        // Update sub-bar with real value
        _setSubBar('sd-compress-bar', percent);

        // Update pill pct
        _setPillState('stage-compress', STATE.ACTIVE, `${Math.round(percent)}%`);
    }

    /**
     * Compression complete.
     * @param {number} origBytes      total original bytes
     * @param {number} compressedBytes  compressed ZIP bytes
     */
    function onCompressDone(origBytes, compressedBytes) {
        const elapsed = performance.now() - _stageStart;

        _stopRaf();
        _setSubBar('sd-compress-bar', 100);
        _setPillState('stage-compress', STATE.DONE, '✓');
        _setConnector('stage-conn-1', true);
        _setBadge('sd-compress-status', 'Done ✓', 'sd-badge--done');

        // Real metrics
        const ratio = origBytes > 0 ? ((1 - compressedBytes / origBytes) * 100).toFixed(1) : '0';
        $('sd-original-size')   && ($('sd-original-size').textContent   = formatBytes(origBytes));
        $('sd-compressed-size') && ($('sd-compressed-size').textContent = formatBytes(compressedBytes));
        $('sd-ratio')           && ($('sd-ratio').textContent           = `${ratio}% smaller`);
        $('sd-compress-time')   && ($('sd-compress-time').textContent   = _fmtTime(elapsed));

        // Reset stage timer for crypto
        _stageStart = performance.now();
    }

    /**
     * Crypto stage begin.
     * Since AES-GCM has no progress callback, we animate the bar
     * from 0% toward ~90% over `estimatedMs` ms, then hold.
     * When done, onCryptoDone() fills it to 100%.
     * @param {number} dataBytes    bytes being processed (zipBuffer size)
     * @param {number} estimatedMs  estimated time for the operation (rough guess)
     */
    function onCryptoStart(dataBytes, estimatedMs = 3000) {
        _setPillState('stage-crypto', STATE.ACTIVE, '…');
        _showDetail('detail-crypto');

        $('sd-crypto-size') && ($('sd-crypto-size').textContent = formatBytes(dataBytes));
        $('sd-auth-tag')    && ($('sd-auth-tag').textContent    = 'Processing…');
        _setBadge('sd-crypto-status', 'Processing', 'sd-badge--active');

        // Animate sub-bar to 90% over estimatedMs (we stop short of 100 until done)
        _animateBar('sd-crypto-bar', 0, 90, estimatedMs);

        // Reset stage timer
        _stageStart = performance.now();
    }

    /**
     * Crypto stage complete.
     * @param {boolean} authPassed   true = AES-GCM tag verified (decrypt only)
     * @param {string}  version      'v1' | 'v2' | '' (encrypt, not applicable)
     */
    function onCryptoDone(authPassed = true, version = '') {
        const elapsed = performance.now() - _stageStart;

        _stopRaf();
        _setSubBar('sd-crypto-bar', 100);
        _setPillState('stage-crypto', authPassed ? STATE.DONE : STATE.ERROR, authPassed ? '✓' : '✗');
        _setConnector('stage-conn-2', authPassed);

        if (authPassed) {
            _setBadge('sd-crypto-status', 'Done ✓', 'sd-badge--done');
            $('sd-auth-tag') && ($('sd-auth-tag').textContent = _opMode === 'decrypt' ? '✅ Verified' : '✅ Applied');
        } else {
            _setBadge('sd-crypto-status', 'Failed ✗', 'sd-badge--error');
            $('sd-auth-tag') && ($('sd-auth-tag').textContent = '❌ Failed');
        }

        $('sd-crypto-time') && ($('sd-crypto-time').textContent = _fmtTime(elapsed));
        _stageStart = performance.now();
    }

    /**
     * Save/output stage complete.
     * @param {string}  filename   output filename
     * @param {number}  sizeBytes  output file size in bytes
     * @param {string}  version    vault format version ('v1' | 'v2')
     */
    function onSaveDone(filename, sizeBytes, version) {
        const totalElapsed = performance.now() - _opStart;

        _setPillState('stage-save', STATE.DONE, '✓');
        _showDetail('detail-save');
        _setBadge('sd-save-status', 'Done ✓', 'sd-badge--done');

        $('sd-output-name')  && ($('sd-output-name').textContent  = filename);
        $('sd-output-size')  && ($('sd-output-size').textContent  = formatBytes(sizeBytes));
        $('sd-total-time')   && ($('sd-total-time').textContent   = _fmtTime(totalElapsed));
        $('sd-vault-version')&& ($('sd-vault-version').textContent= version || '—');
    }

    /**
     * Mark an error state on the current active stage pill.
     * @param {'compress'|'crypto'|'save'} stage
     */
    function onError(stage) {
        _stopRaf();
        const pillMap = { compress: 'stage-compress', crypto: 'stage-crypto', save: 'stage-save' };
        if (pillMap[stage]) _setPillState(pillMap[stage], STATE.ERROR, '✗');
    }

    // Expose public methods
    return { reset, onCompressProgress, onCompressDone, onCryptoStart, onCryptoDone, onSaveDone, onError };
})();


// ============================================
// CRYPTOGRAPHIC UTILITIES (Web Crypto API)
// ============================================

/**
 * ZevSafe v1 key derivation — PBKDF2-SHA256, 100,000 iterations, 16-byte salt.
 * Preserved exactly — DO NOT MODIFY — needed for backward-compat decryption.
 * @param {string} password
 * @param {Uint8Array} salt  - 16-byte random salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// ============================================
// V2 CRYPTOGRAPHIC UTILITIES
// ============================================

/**
 * ZevSafe v2 key derivation — PBKDF2-SHA512, 600,000 iterations, 32-byte salt.
 * Significantly stronger than v1. Produces a raw 256-bit key bytes array
 * so we can optionally XOR-mix a keyfile hash before importing to AES-GCM.
 * @param {string} password
 * @param {Uint8Array} salt - 32-byte random salt
 * @returns {Promise<Uint8Array>} - 32 raw key bytes
 */
async function deriveKeyV2Raw(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const keyBits = await window.crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 600000,
            hash: 'SHA-512'
        },
        keyMaterial,
        256  // 32 bytes
    );
    return new Uint8Array(keyBits);
}

/**
 * Read a File as an ArrayBuffer and return its SHA-256 hash as Uint8Array.
 * Used to derive a 32-byte keyfile factor.
 * @param {File} file
 * @returns {Promise<Uint8Array>} 32-byte SHA-256 digest
 */
async function hashKeyfile(file) {
    const buf = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', buf);
    return new Uint8Array(digest);
}

/**
 * XOR two equal-length Uint8Arrays together.
 * Used to mix the keyfile hash into the derived password key bytes.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {Uint8Array}
 */
function xorBytes(a, b) {
    const result = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) result[i] = a[i] ^ b[i];
    return result;
}

/**
 * Import raw 32 key bytes into an AES-GCM CryptoKey for encrypt/decrypt.
 * @param {Uint8Array} rawBytes - exactly 32 bytes
 * @returns {Promise<CryptoKey>}
 */
async function importAesKey(rawBytes) {
    return window.crypto.subtle.importKey(
        'raw',
        rawBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Full ZevSafe v2 key derivation pipeline.
 * 1. Derive 32 raw key bytes via PBKDF2-SHA512/600k
 * 2. If keyfileBytes provided, XOR-mix SHA-256(keyfile) into key bytes
 * 3. Import final bytes as AES-GCM-256 CryptoKey
 * @param {string} password
 * @param {Uint8Array} salt - 32-byte salt
 * @param {Uint8Array|null} keyfileBytes - optional keyfile hash (32 bytes)
 * @returns {Promise<CryptoKey>}
 */
async function deriveKeyV2(password, salt, keyfileBytes = null) {
    let rawKey = await deriveKeyV2Raw(password, salt);
    if (keyfileBytes && keyfileBytes.length === 32) {
        rawKey = xorBytes(rawKey, keyfileBytes);
    }
    return importAesKey(rawKey);
}

/**
 * Detect whether a file buffer is a v2-format vault.
 * Checks for the 4-byte magic header: 0x5A 0x56 0x32 0x00 ('ZV2\0')
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
function isV2Format(buffer) {
    if (buffer.byteLength < V2_HEADER_SIZE + 1) return false;
    const view = new Uint8Array(buffer, 0, 4);
    return (
        view[0] === V2_MAGIC[0] &&
        view[1] === V2_MAGIC[1] &&
        view[2] === V2_MAGIC[2] &&
        view[3] === V2_MAGIC[3]
    );
}

// ============================================
// PERFORMANCE UTILITIES — SMART COMPRESSION
// ============================================

/**
 * Detects if a set of files consists mostly of pre-compressed formats.
 * Pre-compressed media/archives (JPEG, PNG, WEBP, MP4, MOV, MKV, MP3, ZIP, PDF, etc.)
 * gain 0% size benefit from DEFLATE but consume heavy CPU cycles on mobile devices.
 */
function shouldStoreUncompressed(files) {
    if (!files || files.length === 0) return false;
    const mediaExts = new Set([
        'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'avif',
        'mp4', 'mov', 'mkv', 'avi', 'webm', 'mp3', 'aac', 'flac', 'ogg', 'wav',
        'zip', '7z', 'rar', 'gz', 'tar', 'bz2', 'xz', 'pdf', 'iso'
    ]);

    let mediaBytes = 0;
    let totalBytes = 0;

    for (const f of files) {
        const ext = (f.name || '').split('.').pop().toLowerCase();
        const size = f.size || 0;
        totalBytes += size;
        if (mediaExts.has(ext)) {
            mediaBytes += size;
        }
    }

    // If >60% of total size is pre-compressed media, use STORE mode
    return totalBytes > 0 && (mediaBytes / totalBytes) >= 0.60;
}

// ============================================
// ENCRYPTION WORKFLOW  (v1 + v2)
// ============================================

btnEncrypt.addEventListener('click', async () => {
    if (selectedEncryptFiles.length === 0) {
        alert('⚠️ Please select or drop a folder first.');
        return;
    }

    const password = encryptPassword.value;
    const confirm  = encryptConfirm.value;

    if (!password) {
        alert('⚠️ Please enter a password or PIN.');
        return;
    }
    if (password.length < 4) {
        alert('⚠️ Password must be at least 4 characters or digits long.');
        return;
    }
    if (password !== confirm) {
        alert('⚠️ Passwords do not match. Please re-enter.');
        return;
    }

    // Detect whether v2 mode is active
    const v2Toggle = document.getElementById('v2-mode-toggle');
    const useV2    = v2Toggle ? v2Toggle.checked : false;
    const recoveryRecord = {
        folderName: selectedEncryptFolderName || 'ZevSafe vault',
        vaultFilename: '',
        version: useV2 ? 'v2 enhanced' : 'v1 standard',
        password,
        keyfileRequired: false,
        keyfileName: '',
        keyfileFingerprint: ''
    };

    const encBtnContent = btnEncrypt.querySelector('.btn-content');
    const encOrigText   = encBtnContent ? encBtnContent.textContent : 'Encrypt & Download';
    btnEncrypt.disabled = true;
    btnEncrypt.classList.add('btn--loading');
    if (encBtnContent) encBtnContent.textContent = '🔒 Encrypting Vault…';

    clearLogs();
    resetProgress();
    ProgressTracker.reset('encrypt');  // ← stage tracker init
    showProgress(true);
    log(`Starting ${useV2 ? 'v2 (Enhanced)' : 'v1 (Standard)'} encryption of "${selectedEncryptFolderName}" (${selectedEncryptFiles.length} files)...`, 'info');
    if (useV2) log('🔒 v2 mode: PBKDF2-SHA512 · 600,000 iterations · 32-byte salt' + (v2KeyfileEncrypt ? ' · Keyfile active' : ''), 'info');
    updateProgress('Compressing folder...', 0);

    // Pre-calculate total original size for tracker
    const _origTotalBytes = selectedEncryptFiles.reduce((sum, f) => sum + f.size, 0);

    try {
        // Step 1: Package folder into a ZIP archive in browser memory
        const zip = new JSZip();
        for (const file of selectedEncryptFiles) {
            const path = file.relativeDir || file.webkitRelativePath || file.name;
            zip.file(path, file);
        }

        // Performance Optimization: Check whether folder is mostly pre-compressed media
        const useStoreMode = shouldStoreUncompressed(selectedEncryptFiles);
        const compressionMethod = useStoreMode ? 'STORE' : 'DEFLATE';
        const compressionOpts = useStoreMode ? undefined : { level: 1 }; // Fast Level 1 DEFLATE (5x-10x faster)

        log(`⚡ Packaging mode: ${useStoreMode ? 'Ultra-Fast Store (Pre-compressed media detected)' : 'Fast DEFLATE (Level 1)'}`, 'info');

        // Step 1: Generate Uint8Array directly in one allocation (skips duplicate Blob->ArrayBuffer allocations)
        let zipBytes = await zip.generateAsync({
            type: 'uint8array',
            compression: compressionMethod,
            ...(compressionOpts ? { compressionOptions: compressionOpts } : {})
        }, (meta) => {
            updateProgress(`Packaging: ${meta.percent.toFixed(0)}%`, meta.percent * 0.6);
            ProgressTracker.onCompressProgress(meta.percent, _origTotalBytes);  // ← real % + real size
        });

        const zipDataSize = zipBytes.byteLength;
        log(`Packaging complete. Vault archive size: ${formatBytes(zipDataSize)}`, 'info');
        ProgressTracker.onCompressDone(_origTotalBytes, zipDataSize);  // ← real sizes
        updateProgress('Deriving encryption key...', 62);

        let encBlob, filename;

        if (useV2) {
            // ── V2 ENCRYPTION PATH ──────────────────────────────────────────
            // V2 format: [Magic(4) | Version(1) | Flags(1) | Salt(32) | IV(12) | Ciphertext]

            const salt  = window.crypto.getRandomValues(new Uint8Array(32));  // 32-byte salt
            const iv    = window.crypto.getRandomValues(new Uint8Array(12));
            let   flags = 0x00;

            // Hash keyfile if provided
            let keyfileHash = null;
            if (v2KeyfileEncrypt) {
                log('🗝️ Hashing keyfile (SHA-256)...', 'info');
                keyfileHash = await hashKeyfile(v2KeyfileEncrypt);
                recoveryRecord.keyfileRequired = true;
                recoveryRecord.keyfileName = v2KeyfileEncrypt.name;
                recoveryRecord.keyfileFingerprint = bytesToHex(keyfileHash);
                flags |= V2_FLAG_KEYFILE;
                log('Keyfile hash mixed into key material.', 'info');
            }

            log('Deriving key: PBKDF2-SHA512, 600,000 iterations...', 'info');
            updateProgress('Deriving v2 key (stronger)...', 65);
            const key = await deriveKeyV2(password, salt, keyfileHash);

            log('Encrypting with AES-256-GCM (v2)...', 'info');
            updateProgress('Encrypting data...', 80);
            const _v2EncEstimate = Math.max(500, zipDataSize / (50 * 1024 * 1024) * 1000);
            ProgressTracker.onCryptoStart(zipDataSize, _v2EncEstimate);  // ← animated

            const ciphertext = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                zipBytes.buffer
            );
            // Free unencrypted raw bytes from JS memory immediately
            zipBytes = null;
            ProgressTracker.onCryptoDone(true, 'v2');  // ← real completion

            updateProgress('Building v2 vault file...', 95);

            // Assemble v2 header (50 bytes)
            const headerBytes = new Uint8Array(V2_HEADER_SIZE);
            headerBytes.set(V2_MAGIC, 0);                    // bytes 0–3
            headerBytes[V2_OFFSET_VERSION] = V2_VERSION_BYTE;// byte  4
            headerBytes[V2_OFFSET_FLAGS]   = flags;          // byte  5
            headerBytes.set(salt, V2_OFFSET_SALT);           // bytes 6–37
            headerBytes.set(iv,   V2_OFFSET_IV);             // bytes 38–49

            // Zero-copy Blob creation by reference: browser's C++ blob engine combines them with 0 duplicate RAM
            encBlob = new Blob([headerBytes, ciphertext], { type: 'application/octet-stream' });
            const totalVaultLength = V2_HEADER_SIZE + ciphertext.byteLength;

            filename = `${selectedEncryptFolderName}.zev`;
            recoveryRecord.vaultFilename = filename;
            triggerDownload(encBlob, filename);
            ProgressTracker.onSaveDone(filename, totalVaultLength, 'v2');  // ← real output stats

            log(`✅ v2 Vault created: "${filename}" (${formatBytes(totalVaultLength)})`, 'success');
            if (flags & V2_FLAG_KEYFILE) log('🗝️ This vault requires BOTH the password AND the keyfile to decrypt.', 'warn');

        } else {
            // ── V1 ENCRYPTION PATH (unchanged format, memory-optimized) ─────
            // V1 format: [Salt(16) | IV(12) | Ciphertext]  — no magic header

            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const iv   = window.crypto.getRandomValues(new Uint8Array(12));

            const key = await deriveKey(password, salt);

            log('Encrypting with AES-256-GCM...', 'info');
            updateProgress('Encrypting data...', 78);
            const _v1EncEstimate = Math.max(300, zipDataSize / (80 * 1024 * 1024) * 1000);
            ProgressTracker.onCryptoStart(zipDataSize, _v1EncEstimate);  // ← animated

            const ciphertext = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                zipBytes.buffer
            );
            // Free unencrypted raw bytes from JS memory immediately
            zipBytes = null;
            ProgressTracker.onCryptoDone(true, 'v1');  // ← real completion

            updateProgress('Building vault file...', 95);

            // Assemble v1 header (28 bytes)
            const headerBytes = new Uint8Array(28);
            headerBytes.set(salt, 0);
            headerBytes.set(iv,   16);

            // Zero-copy Blob creation by reference
            encBlob = new Blob([headerBytes, ciphertext], { type: 'application/octet-stream' });
            const totalVaultLength = 28 + ciphertext.byteLength;

            filename = `${selectedEncryptFolderName}.zev`;
            recoveryRecord.vaultFilename = filename;
            triggerDownload(encBlob, filename);
            ProgressTracker.onSaveDone(filename, totalVaultLength, 'v1');  // ← real output stats

            log(`✅ Vault created: "${filename}" (${formatBytes(totalVaultLength)})`, 'success');
        }

        updateProgress('✅ Encryption complete!', 100);
        showPasswordSavePrompt(recoveryRecord);

        // Reset encrypt selected widget
        selectedEncryptFiles = [];
        selectedEncryptFolderName = '';
        v2KeyfileEncrypt = null;
        updateKeyfileBadge('encrypt', null);
        if (encryptDzInner && encryptSelectedWidget) {
            encryptDzInner.style.display = '';
            encryptSelectedWidget.style.display = 'none';
        }
        encryptSelectedInfo.style.display = '';
        encryptSelectedInfo.textContent = 'No folder selected';

    } catch (err) {
        log(`❌ Encryption failed: ${err.message}`, 'error');
        updateProgress('Failed', 0);
        console.error('[ZevSafe Encrypt]', err);
    } finally {
        btnEncrypt.disabled = false;
        btnEncrypt.classList.remove('btn--loading');
        if (encBtnContent) encBtnContent.textContent = encOrigText;
    }
});

// ============================================
// DECRYPTION WORKFLOW  (auto-detects v1 / v2)
// ============================================

btnDecrypt.addEventListener('click', async () => {
    if (!selectedDecryptFile) {
        alert('⚠️ Please select or drop a .zev vault file first.');
        return;
    }

    const password = decryptPassword.value;
    if (!password) {
        alert('⚠️ Please enter your decryption password.');
        return;
    }

    const decBtnContent = btnDecrypt.querySelector('.btn-content');
    const decOrigText   = decBtnContent ? decBtnContent.textContent : 'Decrypt & Download';
    btnDecrypt.disabled = true;
    btnDecrypt.classList.add('btn--loading');
    if (decBtnContent) decBtnContent.textContent = '🔓 Decrypting Vault…';

    clearLogs();
    resetProgress();
    ProgressTracker.reset('decrypt');  // ← stage tracker init
    showProgress(true);
    log(`Reading vault file "${selectedDecryptFile.name}"...`, 'info');
    updateProgress('Reading vault file...', 5);

    try {
        const arrayBuffer = await selectedDecryptFile.arrayBuffer();

        // Minimum size check
        if (arrayBuffer.byteLength < 44) {
            throw new Error('File is too small to be a valid vault — may be corrupted or not a .zev file.');
        }

        updateProgress('Detecting vault version...', 15);

        // ── AUTO-DETECT VERSION ──────────────────────────────────────────────
        const vaultIsV2 = isV2Format(arrayBuffer);
        log(`Vault format: ${vaultIsV2 ? 'v2 (Enhanced)' : 'v1 (Standard)'}`, 'info');

        let decryptedBuffer;

        if (vaultIsV2) {
            // ── V2 DECRYPTION PATH ───────────────────────────────────────────
            if (arrayBuffer.byteLength < V2_HEADER_SIZE + 1) {
                throw new Error('v2 vault header is incomplete — file may be corrupted.');
            }

            const view    = new Uint8Array(arrayBuffer);
            const version = view[V2_OFFSET_VERSION];
            const flags   = view[V2_OFFSET_FLAGS];
            const hasKeyfile = (flags & V2_FLAG_KEYFILE) !== 0;

            log(`v2 header — version: 0x0${version}, flags: 0x0${flags}${hasKeyfile ? ' (keyfile required)' : ''}`, 'info');

            if (hasKeyfile && !v2KeyfileDecrypt) {
                throw new Error('This v2 vault was encrypted with a keyfile. Please select the keyfile and try again.');
            }

            const salt       = new Uint8Array(arrayBuffer, V2_OFFSET_SALT, 32);
            const iv         = new Uint8Array(arrayBuffer, V2_OFFSET_IV,   12);
            const ciphertext = new Uint8Array(arrayBuffer, V2_OFFSET_CIPHER);

            log('Deriving v2 key: PBKDF2-SHA512, 600,000 iterations...', 'info');
            updateProgress('Deriving v2 key (this is stronger, takes ~3s)...', 35);

            let keyfileHash = null;
            if (hasKeyfile) {
                log('🗝️ Hashing keyfile for key derivation...', 'info');
                keyfileHash = await hashKeyfile(v2KeyfileDecrypt);
            }

            const key = await deriveKeyV2(password, salt, keyfileHash);

            log('Decrypting with AES-256-GCM (v2)...', 'info');
            updateProgress('Decrypting data...', 65);
            const _v2DecEstimate = Math.max(500, ciphertext.byteLength / (50 * 1024 * 1024) * 1000);
            ProgressTracker.onCryptoStart(ciphertext.byteLength, _v2DecEstimate);  // ← animated

            // GCM tag verification is automatic — throws OperationError if wrong
            decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                ciphertext
            );
            ProgressTracker.onCryptoDone(true, 'v2');  // ← auth tag verified!

        } else {
            // ── V1 DECRYPTION PATH (unchanged) ──────────────────────────────
            // V1 format: [Salt(16) | IV(12) | Ciphertext]
            log('Parsing v1 cryptographic header...', 'info');
            updateProgress('Parsing header...', 20);

            const salt       = new Uint8Array(arrayBuffer, 0, 16);
            const iv         = new Uint8Array(arrayBuffer, 16, 12);
            const ciphertext = new Uint8Array(arrayBuffer, 28);

            log('Deriving key from password (PBKDF2-SHA256, 100k iterations)...', 'info');
            updateProgress('Deriving key...', 40);

            const key = await deriveKey(password, salt);

            log('Decrypting with AES-256-GCM...', 'info');
            updateProgress('Decrypting data...', 60);
            const _v1DecEstimate = Math.max(300, ciphertext.byteLength / (80 * 1024 * 1024) * 1000);
            ProgressTracker.onCryptoStart(ciphertext.byteLength, _v1DecEstimate);  // ← animated

            // GCM auth tag verified automatically — throws OperationError if wrong
            decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                ciphertext
            );
            ProgressTracker.onCryptoDone(true, 'v1');  // ← auth tag verified!
        }

        log('✅ Authenticated! Extracting folder archive...', 'success');
        updateProgress('Extracting ZIP...', 80);

        // Validate ZIP structure
        const unzipped = await JSZip.loadAsync(decryptedBuffer);

        const folderName    = selectedDecryptFile.name.replace(/\.zev$/i, '');
        const decryptedBlob = new Blob([decryptedBuffer], { type: 'application/zip' });
        ProgressTracker.onSaveDone(`${folderName}_decrypted.zip`, decryptedBuffer.byteLength, vaultIsV2 ? 'v2' : 'v1');  // ← real output

        log(`✅ Decryption successful! Opening Vault Explorer for "${folderName}"...`, 'success');
        updateProgress('✅ Decryption complete!', 100);

        // Open the in-browser Decrypted Vault File Explorer so the user can choose to download individual files or the full ZIP
        openVaultExplorer(folderName, unzipped, decryptedBlob);

        // Reset decrypt selected widget
        selectedDecryptFile = null;
        v2KeyfileDecrypt = null;
        updateKeyfileBadge('decrypt', null);
        if (decryptDzInner && decryptSelectedWidget) {
            decryptDzInner.style.display = '';
            decryptSelectedWidget.style.display = 'none';
        }
        decryptSelectedInfo.style.display = '';
        decryptSelectedInfo.textContent = 'No file selected';

    } catch (err) {
        // AES-GCM throws OperationError for wrong password or tampered data
        if (err.name === 'OperationError') {
            ProgressTracker.onCryptoDone(false);  // ← auth tag FAILED — shows ❌
            ProgressTracker.onError('crypto');
            log('❌ Decryption failed: Wrong password, wrong keyfile, or the file has been tampered with.', 'error');
        } else {
            ProgressTracker.onError('crypto');
            log(`❌ Error: ${err.message}`, 'error');
        }
        updateProgress('Failed', 0);
        console.error('[ZevSafe Decrypt]', err);
    } finally {
        btnDecrypt.disabled = false;
        btnDecrypt.classList.remove('btn--loading');
        if (decBtnContent) decBtnContent.textContent = decOrigText;
    }
});

// ============================================
// AUTO-THEME PREFERENCE TRACKING
// ============================================
function initThemeEngine() {
    const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (isDark) => {
        document.documentElement.classList.toggle('light-theme', !isDark);
    };
    applyTheme(themeMediaQuery.matches);
    themeMediaQuery.addEventListener('change', e => applyTheme(e.matches));
}

// Run theme check immediately
initThemeEngine();



// ============================================
// PASSWORD PRESERVATION FLOW
// ============================================

function showPasswordSavePrompt(recordOrPassword) {
    const modal = document.getElementById('pw-save-modal');
    const displayInput = document.getElementById('pw-save-display');
    const btnSavePwManager = document.getElementById('btn-save-pw-manager');
    const vaultSummary = document.getElementById('pw-vault-summary');
    
    if (!modal || !displayInput) return;

    const record = typeof recordOrPassword === 'string'
        ? {
            folderName: selectedEncryptFolderName || 'ZevSafe vault',
            vaultFilename: selectedEncryptFolderName ? `${selectedEncryptFolderName}.zev` : 'ZevSafe vault',
            version: 'unknown',
            password: recordOrPassword,
            keyfileRequired: false,
            keyfileName: '',
            keyfileFingerprint: ''
        }
        : recordOrPassword;

    lastPasswordRecoveryRecord = record;
    displayInput.value = record.password;
    if (vaultSummary) {
        while (vaultSummary.firstChild) {
            vaultSummary.removeChild(vaultSummary.firstChild);
        }
        [
            ['Folder', record.folderName],
            ['Vault', record.vaultFilename || `${record.folderName}.zev`],
            ['Keyfile', record.keyfileRequired ? `${record.keyfileName || 'Required'} required` : 'Not required']
        ].forEach(([label, value]) => {
            const row = document.createElement('div');
            const labelEl = document.createElement('strong');
            labelEl.textContent = `${label}: `;
            row.appendChild(labelEl);
            row.appendChild(document.createTextNode(value));
            vaultSummary.appendChild(row);
        });
    }
    
    // Check if Credential Management API is supported and in a secure context
    if (window.PasswordCredential && navigator.credentials) {
        btnSavePwManager.style.display = '';
    } else {
        btnSavePwManager.style.display = 'none';
    }
    
    modal.style.display = 'flex';
}

function closePwModal() {
    const modal = document.getElementById('pw-save-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Wire up the password save modal events
document.addEventListener('DOMContentLoaded', () => {
    const btnClosePwModal = document.getElementById('btn-close-pw-modal');
    const btnCopyPw = document.getElementById('btn-copy-pw');
    const btnPrintPwSheet = document.getElementById('btn-print-pw-sheet');
    const btnDownloadPwSheet = document.getElementById('btn-download-pw-sheet');
    const btnSavePwManager = document.getElementById('btn-save-pw-manager');
    const pwSaveModal = document.getElementById('pw-save-modal');
    
    btnClosePwModal?.addEventListener('click', closePwModal);
    
    pwSaveModal?.addEventListener('click', (e) => {
        if (e.target.id === 'pw-save-modal') {
            closePwModal();
        }
    });
    
    btnCopyPw?.addEventListener('click', async () => {
        const passwordVal = lastPasswordRecoveryRecord?.password || document.getElementById('pw-save-display')?.value || '';
        try {
            await navigator.clipboard.writeText(passwordVal);
            btnCopyPw.textContent = '✅ Copied!';
            setTimeout(() => {
                btnCopyPw.textContent = '📋 Copy';
            }, 2000);
        } catch (err) {
            alert('Failed to copy password. Please select and copy manually.');
        }
    });

    btnDownloadPwSheet?.addEventListener('click', () => {
        downloadPasswordRecoverySheet();
    });

    btnPrintPwSheet?.addEventListener('click', () => {
        printPasswordRecoverySheet();
    });
    
    btnSavePwManager?.addEventListener('click', async () => {
        const passwordVal = lastPasswordRecoveryRecord?.password || document.getElementById('pw-save-display')?.value || '';
        if (!passwordVal) return;
        
        try {
            const credentialId = lastPasswordRecoveryRecord?.vaultFilename || lastPasswordRecoveryRecord?.folderName || 'zevsafe-vault';
            const credential = new PasswordCredential({
                id: credentialId,
                password: passwordVal,
                name: `ZevSafe Vault Key - ${credentialId}`
            });
            await navigator.credentials.store(credential);
            log(`Password manager prompted for "${credentialId}".`, 'success');
            closePwModal();
        } catch (err) {
            console.error('Credential storage failed:', err);
            alert('Could not save to password manager. Please copy manually.');
        }
    });

    // Wire up upload widget clear buttons
    const btnClearEncrypt = document.getElementById('btn-clear-encrypt');
    const btnClearDecrypt = document.getElementById('btn-clear-decrypt');
    
    btnClearEncrypt?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedEncryptFiles = [];
        selectedEncryptFolderName = '';
        if (encryptDzInner && encryptSelectedWidget) {
            encryptDzInner.style.display = '';
            encryptSelectedWidget.style.display = 'none';
        }
        encryptSelectedInfo.style.display = '';
        encryptSelectedInfo.textContent = 'No folder selected';
        log('Folder selection cleared.', 'info');
    });

    btnClearDecrypt?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedDecryptFile = null;
        if (decryptDzInner && decryptSelectedWidget) {
            decryptDzInner.style.display = '';
            decryptSelectedWidget.style.display = 'none';
        }
        decryptSelectedInfo.style.display = '';
        decryptSelectedInfo.textContent = 'No file selected';
        log('Vault file selection cleared.', 'info');
    });


});

function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


// ============================================
// V2 UI — MODE TOGGLE, KEYFILE WIRING
// ============================================

/**
 * Update the keyfile badge display next to the keyfile input button.
 * @param {'encrypt'|'decrypt'} side
 * @param {File|null} file
 */
function updateKeyfileBadge(side, file) {
    const badge = document.getElementById(`v2-keyfile-badge-${side}`);
    const clearBtn = document.getElementById(`v2-keyfile-clear-${side}`);
    if (!badge) return;
    if (file) {
        badge.textContent = `🗝️ ${file.name}`;
        badge.style.display = 'inline-flex';
        if (clearBtn) clearBtn.style.display = 'flex';
    } else {
        badge.textContent = '';
        badge.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
    }
}

/**
 * Wire up all v2 UI interactions once DOM is available.
 * Called from DOMContentLoaded (already set up below) or immediately
 * if DOM is already loaded.
 */
function initV2UI() {
    // ── V2 mode toggle ───────────────────────────────────────────────────
    const v2Toggle   = document.getElementById('v2-mode-toggle');
    const v2Panel    = document.getElementById('v2-options-panel');

    if (v2Toggle && v2Panel) {
        v2Toggle.addEventListener('change', () => {
            v2Panel.style.display = v2Toggle.checked ? 'block' : 'none';
            v2Toggle.setAttribute('aria-checked', v2Toggle.checked ? 'true' : 'false');
            if (!v2Toggle.checked) {
                // Clear keyfile when v2 mode is disabled
                v2KeyfileEncrypt = null;
                updateKeyfileBadge('encrypt', null);
            }
        });
    }

    // ── Encrypt keyfile picker ────────────────────────────────────────────
    const encKeyfileInput = document.getElementById('v2-keyfile-input-encrypt');
    if (encKeyfileInput) {
        encKeyfileInput.addEventListener('change', () => {
            v2KeyfileEncrypt = encKeyfileInput.files[0] || null;
            updateKeyfileBadge('encrypt', v2KeyfileEncrypt);
            encKeyfileInput.value = '';
            if (v2KeyfileEncrypt) log(`🗝️ Keyfile selected: "${v2KeyfileEncrypt.name}" (${formatBytes(v2KeyfileEncrypt.size)})`, 'info');
        });
    }

    // ── Decrypt keyfile picker ────────────────────────────────────────────
    const decKeyfileInput = document.getElementById('v2-keyfile-input-decrypt');
    if (decKeyfileInput) {
        decKeyfileInput.addEventListener('change', () => {
            v2KeyfileDecrypt = decKeyfileInput.files[0] || null;
            updateKeyfileBadge('decrypt', v2KeyfileDecrypt);
            decKeyfileInput.value = '';
            if (v2KeyfileDecrypt) log(`🗝️ Keyfile selected: "${v2KeyfileDecrypt.name}" (${formatBytes(v2KeyfileDecrypt.size)})`, 'info');
        });
    }

    // ── Clear buttons ─────────────────────────────────────────────────────
    document.getElementById('v2-keyfile-clear-encrypt')?.addEventListener('click', () => {
        v2KeyfileEncrypt = null;
        updateKeyfileBadge('encrypt', null);
        log('Keyfile cleared.', 'info');
    });
    document.getElementById('v2-keyfile-clear-decrypt')?.addEventListener('click', () => {
        v2KeyfileDecrypt = null;
        updateKeyfileBadge('decrypt', null);
        log('Keyfile cleared.', 'info');
    });
}

// Run v2 UI init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initV2UI);
} else {
    initV2UI();
}

// ============================================
// IN-BROWSER DECRYPTED VAULT FILE EXPLORER
// ============================================

let currentDecryptedZip = null;
let currentDecryptedFolderName = '';
let currentDecryptedBlob = null;
let currentDecryptedFileList = [];

/**
 * Returns a suitable icon based on file extension.
 */
function getFileIcon(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const iconMap = {
        pdf: '📄',
        doc: '📝', docx: '📝', txt: '📄', md: '📝', rtf: '📝',
        xls: '📊', xlsx: '📊', csv: '📊',
        ppt: '📽️', pptx: '📽️',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', heic: '🖼️',
        mp4: '🎬', mov: '🎬', mkv: '🎬', avi: '🎬', webm: '🎬',
        mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵',
        zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
        js: '💻', ts: '💻', html: '🌐', css: '🎨', json: '⚙️', py: '🐍', c: '💻', cpp: '💻', java: '☕'
    };
    return iconMap[ext] || '📄';
}

/**
 * Open and populate the Decrypted Vault File Explorer modal.
 */
function openVaultExplorer(folderName, zipInstance, fullZipBlob) {
    currentDecryptedFolderName = folderName;
    currentDecryptedZip = zipInstance;
    currentDecryptedBlob = fullZipBlob;

    const modal = document.getElementById('vault-explorer-modal');
    const modalTitle = document.getElementById('explorer-modal-title');
    const modalMeta = document.getElementById('explorer-modal-meta');
    const searchInput = document.getElementById('explorer-search-input');
    const clearSearchBtn = document.getElementById('btn-clear-explorer-search');

    if (!modal) return;

    // Reset search
    if (searchInput) searchInput.value = '';
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';

    // Parse all files from JSZip
    currentDecryptedFileList = [];
    let totalBytes = 0;

    zipInstance.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
            const size = zipEntry._data ? (zipEntry._data.uncompressedSize || 0) : 0;
            totalBytes += size;
            currentDecryptedFileList.push({
                path: relativePath,
                name: relativePath.split('/').pop() || relativePath,
                dirPath: relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '',
                size: size,
                entry: zipEntry
            });
        }
    });

    if (modalTitle) modalTitle.textContent = `${folderName}`;
    if (modalMeta) modalMeta.textContent = `${currentDecryptedFileList.length} file(s) · ${formatBytes(totalBytes || fullZipBlob.size)}`;

    renderExplorerFileList('');
    modal.style.display = 'flex';
}

function closeVaultExplorer() {
    const modal = document.getElementById('vault-explorer-modal');
    if (modal) modal.style.display = 'none';
}

/**
 * Detect if a file is a playable media file (video or audio)
 */
function getMediaCategory(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv', 'avi'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'weba'];
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    return null;
}

function getMediaMimeType(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const mimeMap = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        mkv: 'video/x-matroska',
        m4v: 'video/mp4',
        ogv: 'video/ogg',
        avi: 'video/x-msvideo',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        aac: 'audio/aac',
        m4a: 'audio/mp4',
        weba: 'audio/webm'
    };
    return mimeMap[ext] || 'application/octet-stream';
}

// Media player state
let currentMediaBlobUrl = null;
let currentMediaFilename = '';
let currentMediaBlob = null;

function openMediaPlayer(fileBlob, filename, category) {
    const modal = document.getElementById('vault-media-modal');
    const badge = document.getElementById('media-modal-badge');
    const title = document.getElementById('media-modal-title');
    const body = document.getElementById('media-modal-body');

    if (!modal || !body) return;

    // Clean up previous URL
    if (currentMediaBlobUrl) {
        URL.revokeObjectURL(currentMediaBlobUrl);
        currentMediaBlobUrl = null;
    }

    currentMediaBlob = fileBlob;
    currentMediaFilename = filename;
    currentMediaBlobUrl = URL.createObjectURL(fileBlob);

    if (badge) badge.textContent = category === 'video' ? '🎬 Video' : '🎵 Audio';
    if (title) title.textContent = filename;

    body.innerHTML = '';

    if (category === 'video') {
        const video = document.createElement('video');
        video.className = 'media-player-element';
        video.controls = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('preload', 'auto');
        video.src = currentMediaBlobUrl;
        body.appendChild(video);
    } else {
        const audio = document.createElement('audio');
        audio.className = 'media-player-element';
        audio.controls = true;
        audio.autoplay = true;
        audio.setAttribute('preload', 'auto');
        audio.src = currentMediaBlobUrl;
        body.appendChild(audio);
    }

    modal.style.display = 'flex';
}

function closeMediaPlayer() {
    const modal = document.getElementById('vault-media-modal');
    const body = document.getElementById('media-modal-body');
    if (modal) modal.style.display = 'none';
    if (body) {
        const mediaElem = body.querySelector('video, audio');
        if (mediaElem) {
            mediaElem.pause();
            mediaElem.src = '';
        }
        body.innerHTML = '';
    }
    if (currentMediaBlobUrl) {
        URL.revokeObjectURL(currentMediaBlobUrl);
        currentMediaBlobUrl = null;
    }
}

/**
 * Render file list with search filtering.
 */
function renderExplorerFileList(query = '') {
    const listEl = document.getElementById('explorer-file-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    const q = query.trim().toLowerCase();
    const filtered = q
        ? currentDecryptedFileList.filter(f => f.path.toLowerCase().includes(q))
        : currentDecryptedFileList;

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'explorer-empty';
        empty.textContent = q ? `No files match "${query}"` : 'No files found in vault.';
        listEl.appendChild(empty);
        return;
    }

    filtered.forEach(file => {
        const row = document.createElement('div');
        row.className = 'explorer-item';

        const left = document.createElement('div');
        left.className = 'explorer-item-left';

        const icon = document.createElement('span');
        icon.className = 'explorer-item-icon';
        icon.textContent = getFileIcon(file.name);

        const info = document.createElement('div');
        info.className = 'explorer-item-info';

        const name = document.createElement('span');
        name.className = 'explorer-item-name';
        name.textContent = file.name;
        name.title = file.path;

        const path = document.createElement('span');
        path.className = 'explorer-item-path';
        path.textContent = file.dirPath ? `${file.dirPath}/` : '';

        info.appendChild(name);
        if (file.dirPath) info.appendChild(path);

        left.appendChild(icon);
        left.appendChild(info);

        const right = document.createElement('div');
        right.className = 'explorer-item-right';

        const size = document.createElement('span');
        size.className = 'explorer-item-size';
        size.textContent = file.size > 0 ? formatBytes(file.size) : '';
        right.appendChild(size);

        // Auto-Detect Video and Audio files for instant playback
        const mediaCategory = getMediaCategory(file.name);
        if (mediaCategory) {
            const playBtn = document.createElement('button');
            playBtn.className = 'explorer-file-play-btn';
            playBtn.title = `Play ${file.name} directly in browser`;
            playBtn.innerHTML = '▶️ Play';
            playBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    playBtn.textContent = '⏳ ...';
                    const rawBlob = await currentDecryptedZip.file(file.path).async('blob');
                    const mimeType = getMediaMimeType(file.name);
                    const mediaBlob = new Blob([rawBlob], { type: mimeType });
                    openMediaPlayer(mediaBlob, file.name, mediaCategory);
                    playBtn.innerHTML = '▶️ Play';
                } catch (err) {
                    console.error('[Media Play Error]', err);
                    alert(`Failed to load media: ${err.message}`);
                    playBtn.innerHTML = '▶️ Play';
                }
            });
            right.appendChild(playBtn);
        }

        const dlBtn = document.createElement('button');
        dlBtn.className = 'explorer-file-dl-btn';
        dlBtn.title = `Download ${file.name}`;
        dlBtn.innerHTML = '⬇️ Save';
        dlBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                dlBtn.textContent = '⏳ ...';
                const fileBlob = await currentDecryptedZip.file(file.path).async('blob');
                triggerDownload(fileBlob, file.name);
                dlBtn.textContent = '✅ Saved';
                setTimeout(() => { dlBtn.innerHTML = '⬇️ Save'; }, 2000);
            } catch (err) {
                console.error('[Explorer Download]', err);
                alert(`Failed to extract file: ${err.message}`);
                dlBtn.innerHTML = '⬇️ Save';
            }
        });

        right.appendChild(dlBtn);

        row.appendChild(left);
        row.appendChild(right);
        listEl.appendChild(row);
    });
}

// Wire up Explorer & Media Player UI event listeners
function initExplorerUI() {
    const searchInput = document.getElementById('explorer-search-input');
    const clearSearchBtn = document.getElementById('btn-clear-explorer-search');
    const closeBtn = document.getElementById('btn-close-explorer');
    const doneBtn = document.getElementById('btn-done-explorer');
    const dlAllBtn = document.getElementById('btn-explorer-download-all');
    const modal = document.getElementById('vault-explorer-modal');

    // Media modal elements
    const mediaModal = document.getElementById('vault-media-modal');
    const closeMediaBtn = document.getElementById('btn-close-media-modal');
    const mediaOpenTabBtn = document.getElementById('btn-media-open-tab');
    const mediaDlBtn = document.getElementById('btn-media-download');

    searchInput?.addEventListener('input', () => {
        const val = searchInput.value;
        if (clearSearchBtn) clearSearchBtn.style.display = val ? 'block' : 'none';
        renderExplorerFileList(val);
    });

    clearSearchBtn?.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        renderExplorerFileList('');
    });

    closeBtn?.addEventListener('click', closeVaultExplorer);
    doneBtn?.addEventListener('click', closeVaultExplorer);

    dlAllBtn?.addEventListener('click', () => {
        if (currentDecryptedBlob && currentDecryptedFolderName) {
            dlAllBtn.textContent = '⏳ Downloading...';
            triggerDownload(currentDecryptedBlob, `${currentDecryptedFolderName}_decrypted.zip`);
            log(`✅ Downloaded full vault: "${currentDecryptedFolderName}_decrypted.zip"`, 'success');
            setTimeout(() => {
                dlAllBtn.textContent = '⬇️ Download Full ZIP';
            }, 2000);
        }
    });

    modal?.addEventListener('click', (e) => {
        if (e.target.id === 'vault-explorer-modal') closeVaultExplorer();
    });

    // Media modal events
    closeMediaBtn?.addEventListener('click', closeMediaPlayer);
    mediaModal?.addEventListener('click', (e) => {
        if (e.target.id === 'vault-media-modal') closeMediaPlayer();
    });

    mediaOpenTabBtn?.addEventListener('click', () => {
        if (currentMediaBlobUrl) {
            window.open(currentMediaBlobUrl, '_blank');
        }
    });

    mediaDlBtn?.addEventListener('click', () => {
        if (currentMediaBlob && currentMediaFilename) {
            triggerDownload(currentMediaBlob, currentMediaFilename);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initExplorerUI();
        initPcSetupButton();
    });
} else {
    initExplorerUI();
    initPcSetupButton();
}

/**
 * Generates and downloads the 1-Click ZevSafe PC Desktop Setup (25+ GB) toolkit.
 */
async function downloadPcSetupToolkit() {
    const btn = document.getElementById('btn-download-pc-setup');
    const origText = btn ? btn.textContent : '💻 PC Setup (25+ GB)';
    try {
        if (btn) btn.textContent = '⏳ Creating Package...';

        const zip = new JSZip();

        const encryptBatContent = `@echo off\r\ntitle ZevSafe 25GB+ Vault Encryptor\r\nsetlocal EnableDelayedExpansion\r\n\r\necho ===================================================\r\necho   ZevSafe - 25GB+ Zero-RAM Folder Encryptor (PC)\r\necho ===================================================\r\necho.\r\n\r\nset "TARGET_FOLDER=%~1"\r\n\r\nif "%TARGET_FOLDER%"=="" (\r\n    echo Drag and drop a folder here or enter its path:\r\n    set /p "TARGET_FOLDER=Path: "\r\n)\r\n\r\nset "TARGET_FOLDER=%TARGET_FOLDER:"=%"\r\n\r\nif "%TARGET_FOLDER%"=="" (\r\n    echo [ERROR] No folder specified. Exiting.\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0encrypt.ps1" "%TARGET_FOLDER%"\r\n\r\necho.\r\necho ===================================================\r\necho   Process finished. Press any key to exit.\r\necho ===================================================\r\npause >nul`;

        const decryptBatContent = `@echo off\r\ntitle ZevSafe 25GB+ Vault Decryptor\r\nsetlocal EnableDelayedExpansion\r\n\r\necho ===================================================\r\necho   ZevSafe - 25GB+ Zero-RAM Vault Decryptor (PC)\r\necho ===================================================\r\necho.\r\n\r\nset "TARGET_FILE=%~1"\r\n\r\nif "%TARGET_FILE%"=="" (\r\n    echo Drag and drop a .zev vault file here or enter its path:\r\n    set /p "TARGET_FILE=Path: "\r\n)\r\n\r\nset "TARGET_FILE=%TARGET_FILE:"=%"\r\n\r\nif "%TARGET_FILE%"=="" (\r\n    echo [ERROR] No .zev file specified. Exiting.\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0decrypt.ps1" "%TARGET_FILE%"\r\n\r\necho.\r\necho ===================================================\r\necho   Process finished. Press any key to exit.\r\necho ===================================================\r\npause >nul`;

        let encPs1 = '';
        let decPs1 = '';
        try {
            const r1 = await fetch('encrypt.ps1');
            encPs1 = await r1.text();
            const r2 = await fetch('decrypt.ps1');
            decPs1 = await r2.text();
        } catch (e) {
            console.warn('Could not fetch ps1 files dynamically', e);
        }

        const readmeContent = `=======================================================
  ZevSafe PC Desktop Setup (25GB - 100GB+ Zero-RAM)
=======================================================

HOW TO USE (NO MANUAL CONFIGURATION REQUIRED):

1. TO ENCRYPT A FOLDER:
   - Drag and drop any folder onto "Encrypt-Vault.bat" (or double click it).
   - Enter your secure password when prompted.
   - It will stream and create your ".zev" vault directly on your drive with 0 RAM limits!

2. TO DECRYPT A VAULT:
   - Drag and drop your ".zev" file onto "Decrypt-Vault.bat" (or double click it).
   - Enter your password to restore your original folder!

COMPATIBILITY:
- 100% compatible with https://zevsafe.pages.dev
- Works on Windows 10, 11, and Windows Server out of the box with standard PowerShell.
`;

        zip.file('Encrypt-Vault.bat', encryptBatContent);
        zip.file('Decrypt-Vault.bat', decryptBatContent);
        if (encPs1) zip.file('encrypt.ps1', encPs1);
        if (decPs1) zip.file('decrypt.ps1', decPs1);
        zip.file('README.txt', readmeContent);

        const blob = await zip.generateAsync({ type: 'blob' });
        triggerDownload(blob, 'ZevSafe-PC-Setup-25GB.zip');
        log('✅ Downloaded "ZevSafe-PC-Setup-25GB.zip" — extract it on your PC for 1-click 25GB+ processing.', 'success');

        if (btn) {
            btn.textContent = '✅ Downloaded!';
            setTimeout(() => { btn.textContent = origText; }, 2500);
        }
    } catch (err) {
        console.error('[PC Setup Download Error]', err);
        alert(`Failed to create PC toolkit: ${err.message}`);
        if (btn) btn.textContent = origText;
    }
}

function initPcSetupButton() {
    document.querySelectorAll('.btn-download-pc-setup, #btn-download-pc-setup').forEach(btn => {
        btn.addEventListener('click', downloadPcSetupToolkit);
    });
}
