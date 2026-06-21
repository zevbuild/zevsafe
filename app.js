// ============================================
// DOM ELEMENTS
// ============================================
const encryptDropZone    = document.getElementById('encrypt-drop-zone');
const encryptFolderInput = document.getElementById('encrypt-folder-input');
const encryptSelectedInfo = document.getElementById('encrypt-selected-info');
const encryptPassword    = document.getElementById('encrypt-password');
const encryptConfirm     = document.getElementById('encrypt-confirm');
const btnEncrypt         = document.getElementById('btn-encrypt');

const decryptDropZone    = document.getElementById('decrypt-drop-zone');
const decryptFileInput   = document.getElementById('decrypt-file-input');
const decryptSelectedInfo = document.getElementById('decrypt-selected-info');
const decryptPassword    = document.getElementById('decrypt-password');
const btnDecrypt         = document.getElementById('btn-decrypt');

const progressCard       = document.getElementById('progress-card');
const progressTitle      = document.getElementById('progress-title');
const progressPercentage = document.getElementById('progress-percentage');
const progressBarFill    = document.getElementById('progress-bar-fill');
const logOutput          = document.getElementById('log-output');
const strengthWrap       = document.getElementById('strength-wrap');
const strengthBar        = document.getElementById('strength-bar');
const strengthLabel      = document.getElementById('strength-label');

// ============================================
// STATE
// ============================================
let selectedEncryptFiles      = [];
let selectedEncryptFolderName = '';
let selectedDecryptFile       = null;

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

function setupDragAndDrop(dropZone, fileInput, onFilesSelected) {
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

    // Click to open file picker (only if not triggered from inside the label)
    dropZone.addEventListener('click', (e) => {
        // Don't re-trigger if the label or its children were clicked
        if (e.target.closest('.btn-file-select')) return;
        fileInput.click();
    });

    // Keyboard accessibility
    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });

    // Handle browse input
    fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files);
        if (files.length > 0) {
            let folderName = 'folder';
            if (files[0].webkitRelativePath) {
                folderName = files[0].webkitRelativePath.split('/')[0];
            }
            onFilesSelected(files, folderName);
        }
        // Reset input so same folder can be re-selected
        fileInput.value = '';
    });
}

// Initialize Drag & Drop
setupDragAndDrop(encryptDropZone, encryptFolderInput, (files, folderName) => {
    selectedEncryptFiles      = files;
    selectedEncryptFolderName = folderName;
    encryptSelectedInfo.textContent = `✅ ${folderName} — ${files.length} file(s)`;
    log(`Folder "${folderName}" selected (${files.length} files).`, 'info');
    showProgress();
});

setupDragAndDrop(decryptDropZone, decryptFileInput, (files) => {
    if (files.length > 0) {
        selectedDecryptFile = files[0];
        decryptSelectedInfo.textContent = `✅ ${selectedDecryptFile.name}`;
        log(`Vault file "${selectedDecryptFile.name}" selected.`, 'info');
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
}

function updateProgress(title, percent) {
    showProgress();
    progressTitle.textContent = title;
    progressPercentage.textContent = `${Math.round(percent)}%`;
    progressBarFill.style.width = `${percent}%`;
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
        await JSZip.loadAsync(decryptedBuffer); // validates ZIP structure

        const decryptedBlob = new Blob([decryptedBuffer], { type: 'application/zip' });
        const folderName    = selectedDecryptFile.name.replace(/\.enc$/i, '');
        triggerDownload(decryptedBlob, `${folderName}_decrypted.zip`);

        log(`✅ Saved: "${folderName}_decrypted.zip" — extract it to restore your files.`, 'success');
        updateProgress('✅ Decryption complete!', 100);

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
