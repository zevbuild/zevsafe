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
const strengthWrap        = document.getElementById('strength-wrap');
const strengthBar         = document.getElementById('strength-bar');
const strengthLabel       = document.getElementById('strength-label');
const statusDot           = document.getElementById('status-dot');

// ============================================
// STATE
// ============================================
let selectedEncryptFiles      = [];
let selectedEncryptFolderName = '';
let selectedDecryptFile       = null;

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
        if (decryptDropText) decryptDropText.textContent = 'Tap to select .enc file';

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
// PASSWORD STRENGTH METER
// ============================================
encryptPassword.addEventListener('input', () => {
    const pw = encryptPassword.value;
    if (!pw) {
        strengthWrap.style.display = 'none';
        return;
    }
    strengthWrap.style.display = 'flex';

    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 16) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    const levels = [
        { label: 'Very Weak', color: '#ef4444', width: '20%' },
        { label: 'Weak',      color: '#f97316', width: '40%' },
        { label: 'Fair',      color: '#f59e0b', width: '60%' },
        { label: 'Strong',    color: '#10b981', width: '80%' },
        { label: 'Very Strong', color: '#6366f1', width: '100%' },
    ];
    const level = levels[Math.min(score - 1, 4)] || levels[0];
    strengthBar.style.background = level.color;
    strengthBar.style.width = level.width;
    strengthLabel.textContent = level.label;
    strengthLabel.style.color = level.color;
});

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
        } else {
            input.type = 'password';
            btn.textContent = '👁';
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

function showProgress() {
    progressCard.style.display = 'flex';
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

// ============================================
// CRYPTOGRAPHIC UTILITIES (Web Crypto API)
// ============================================

/**
 * Derives an AES-256-GCM key from a password and salt using PBKDF2-SHA256.
 * @param {string} password
 * @param {Uint8Array} salt  - 16-byte random salt
 * @returns {CryptoKey}
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
// ENCRYPTION WORKFLOW
// ============================================

btnEncrypt.addEventListener('click', async () => {
    if (selectedEncryptFiles.length === 0) {
        alert('⚠️ Please select or drop a folder first.');
        return;
    }

    const password = encryptPassword.value;
    const confirm  = encryptConfirm.value;

    if (!password) {
        alert('⚠️ Please enter a password.');
        return;
    }
    if (password.length < 8) {
        alert('⚠️ Password must be at least 8 characters long.');
        return;
    }
    if (password !== confirm) {
        alert('⚠️ Passwords do not match. Please re-enter.');
        return;
    }

    btnEncrypt.disabled = true;
    clearLogs();
    resetProgress();
    log(`Starting encryption of "${selectedEncryptFolderName}" (${selectedEncryptFiles.length} files)...`, 'info');
    updateProgress('Compressing folder...', 0);

    try {
        // Step 1: Package folder into a ZIP archive in browser memory
        const zip = new JSZip();
        for (const file of selectedEncryptFiles) {
            const path = file.relativeDir || file.webkitRelativePath || file.name;
            zip.file(path, file);
        }

        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        }, (meta) => {
            updateProgress(`Compressing: ${meta.percent.toFixed(0)}%`, meta.percent * 0.6);
        });

        log(`Compression complete. ZIP size: ${(zipBlob.size / 1024).toFixed(1)} KB`, 'info');
        updateProgress('Deriving encryption key...', 62);

        // Step 2: Generate cryptographically random Salt (16 bytes) and IV (12 bytes)
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv   = window.crypto.getRandomValues(new Uint8Array(12));

        // Step 3: Derive AES-GCM-256 key from password via PBKDF2
        const key = await deriveKey(password, salt);

        log('Encrypting with AES-256-GCM...', 'info');
        updateProgress('Encrypting data...', 78);

        // Step 4: Encrypt the ZIP bytes
        const zipBuffer  = await zipBlob.arrayBuffer();
        const ciphertext = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            zipBuffer
        );

        updateProgress('Building vault file...', 95);

        // Step 5: Assemble output: [Salt (16)] + [IV (12)] + [Ciphertext]
        const combined = new Uint8Array(16 + 12 + ciphertext.byteLength);
        combined.set(salt, 0);
        combined.set(iv,   16);
        combined.set(new Uint8Array(ciphertext), 28);

        // Step 6: Download as .enc file
        const encBlob  = new Blob([combined], { type: 'application/octet-stream' });
        const filename = `${selectedEncryptFolderName}.enc`;
        triggerDownload(encBlob, filename);

        log(`✅ Vault created: "${filename}" (${(combined.byteLength / 1024).toFixed(1)} KB)`, 'success');
        updateProgress('✅ Encryption complete!', 100);
        showPasswordSavePrompt(password);
        
        // Reset encrypt selected widget
        selectedEncryptFiles = [];
        selectedEncryptFolderName = '';
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
    }
});

// ============================================
// DECRYPTION WORKFLOW
// ============================================

btnDecrypt.addEventListener('click', async () => {
    if (!selectedDecryptFile) {
        alert('⚠️ Please select or drop a .enc vault file first.');
        return;
    }

    const password = decryptPassword.value;
    if (!password) {
        alert('⚠️ Please enter your decryption password.');
        return;
    }

    btnDecrypt.disabled = true;
    clearLogs();
    resetProgress();
    log(`Reading vault file "${selectedDecryptFile.name}"...`, 'info');
    updateProgress('Reading vault file...', 5);

    try {
        const arrayBuffer = await selectedDecryptFile.arrayBuffer();

        // Minimum size check: Salt(16) + IV(12) + GCM tag(16) = 44 bytes minimum
        if (arrayBuffer.byteLength < 44) {
            throw new Error('File is too small to be a valid vault — may be corrupted or not a .enc file.');
        }

        log('Parsing cryptographic parameters from file header...', 'info');
        updateProgress('Parsing header...', 20);

        // Step 1: Extract Salt (bytes 0–15), IV (bytes 16–27), Ciphertext (bytes 28+)
        const salt       = new Uint8Array(arrayBuffer, 0, 16);
        const iv         = new Uint8Array(arrayBuffer, 16, 12);
        const ciphertext = new Uint8Array(arrayBuffer, 28);

        log('Deriving key from password (PBKDF2, 100k iterations)...', 'info');
        updateProgress('Deriving key...', 40);

        // Step 2: Re-derive the same key using the stored salt + provided password
        const key = await deriveKey(password, salt);

        log('Decrypting with AES-256-GCM...', 'info');
        updateProgress('Decrypting data...', 60);

        // Step 3: Decrypt — GCM authentication tag is verified automatically here.
        //         If password is wrong, this line throws DOMException: OperationError.
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            ciphertext
        );

        log('✅ Authenticated! Extracting folder archive...', 'success');
        updateProgress('Extracting ZIP...', 80);

        // Step 4: Load the decrypted ZIP and re-download it
        const zip = await JSZip.loadAsync(decryptedBuffer); // validates ZIP structure

        const folderName    = selectedDecryptFile.name.replace(/\.enc$/i, '');
        const decryptedBlob = new Blob([decryptedBuffer], { type: 'application/zip' });
        triggerDownload(decryptedBlob, `${folderName}_decrypted.zip`);

        log(`✅ Saved: "${folderName}_decrypted.zip" — extract it to restore your files.`, 'success');
        updateProgress('✅ Decryption complete!', 100);


        
        // Reset decrypt selected widget
        selectedDecryptFile = null;
        if (decryptDzInner && decryptSelectedWidget) {
            decryptDzInner.style.display = '';
            decryptSelectedWidget.style.display = 'none';
        }
        decryptSelectedInfo.style.display = '';
        decryptSelectedInfo.textContent = 'No file selected';

    } catch (err) {
        // AES-GCM throws OperationError for wrong password or tampered data
        if (err.name === 'OperationError') {
            log('❌ Decryption failed: Wrong password or the file has been tampered with.', 'error');
        } else {
            log(`❌ Error: ${err.message}`, 'error');
        }
        updateProgress('Failed', 0);
        console.error('[ZevSafe Decrypt]', err);
    } finally {
        btnDecrypt.disabled = false;
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

function showPasswordSavePrompt(password) {
    const modal = document.getElementById('pw-save-modal');
    const displayInput = document.getElementById('pw-save-display');
    const btnSavePwManager = document.getElementById('btn-save-pw-manager');
    
    if (!modal || !displayInput) return;
    
    displayInput.value = password;
    
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
    const btnSavePwManager = document.getElementById('btn-save-pw-manager');
    const pwSaveModal = document.getElementById('pw-save-modal');
    
    btnClosePwModal?.addEventListener('click', closePwModal);
    
    pwSaveModal?.addEventListener('click', (e) => {
        if (e.target.id === 'pw-save-modal') {
            closePwModal();
        }
    });
    
    btnCopyPw?.addEventListener('click', async () => {
        const passwordVal = document.getElementById('pw-save-display')?.value || '';
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
    
    btnSavePwManager?.addEventListener('click', async () => {
        const passwordVal = document.getElementById('pw-save-display')?.value || '';
        if (!passwordVal) return;
        
        try {
            const credential = new PasswordCredential({
                id: 'zevsafe-vault',
                password: passwordVal,
                name: 'ZevSafe Vault Key'
            });
            await navigator.credentials.store(credential);
            log('Password manager prompted successfully.', 'success');
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

