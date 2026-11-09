/**
 * ZevSafe Modular In-Vault Document & PDF Viewer
 * js/document-viewer.js
 *
 * Dedicated in-browser text/code editor, note creator, and PDF document previewer.
 * Lazy-loaded strictly on demand when user clicks on a document or PDF in Decrypted Vault Explorer.
 * Zero external network calls. Bounded memory (< 5 MB text preview).
 * 100% Client-Side.
 */
(function(global) {
    'use strict';

    let currentTextBlob = null;
    let currentTextFilename = '';
    let currentTextContent = '';
    let isTextWordWrapped = false;
    let currentEditingPath = '';
    let isEditingText = false;
    let hasUnsavedChanges = false;
    let currentPdfBlobUrl = null;
    let _isInitialized = false;

    function getDecryptedFileList() {
        return global.currentDecryptedFileList || [];
    }

    function getV3Vault() {
        return global.currentV3Vault || null;
    }

    function getDecryptedZip() {
        return global.currentDecryptedZip || null;
    }

    function formatBytes(bytes) {
        if (typeof global.formatBytes === 'function') {
            return global.formatBytes(bytes);
        }
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function showToast(msg, type = 'info') {
        if (typeof global.showToast === 'function') {
            global.showToast(msg, type);
        } else {
            console.log(`[ZevSafe Toast] [${type}] ${msg}`);
        }
    }

    function createTrackedBlobUrl(blob) {
        if (typeof global.createTrackedBlobUrl === 'function') {
            return global.createTrackedBlobUrl(blob);
        }
        return URL.createObjectURL(blob);
    }

    function revokeTrackedBlobUrl(url) {
        if (typeof global.revokeTrackedBlobUrl === 'function') {
            global.revokeTrackedBlobUrl(url);
        } else if (url && url.startsWith('blob:')) {
            try { URL.revokeObjectURL(url); } catch (_) {}
        }
    }

    function sanitizeFilenamePart(value, fallback = 'document') {
        if (typeof global.sanitizeFilenamePart === 'function') {
            return global.sanitizeFilenamePart(value, fallback);
        }
        if (!value || typeof value !== 'string') return fallback;
        const sanitized = value.replace(/[/\\?%*:|"<>]/g, '_').trim();
        return sanitized || fallback;
    }

    function triggerDownload(blob, filename) {
        if (typeof global.triggerDownload === 'function') {
            return global.triggerDownload(blob, filename);
        }
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 150);
    }

    function renderSafeMarkdown(md) {
        if (typeof global.renderSafeMarkdown === 'function') {
            return global.renderSafeMarkdown(md);
        }
        return (md || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * Opens and displays a decrypted text or source code file with line numbers and editing.
     * @param {string} filePath - Path within vault
     */
    async function openTextViewerByPath(filePath) {
        const fileList = getDecryptedFileList();
        const fileItem = fileList.find(f => f.path === filePath);
        if (!fileItem) return;

        const modal = document.getElementById('vault-text-modal');
        const title = document.getElementById('text-modal-title');
        const badge = document.getElementById('text-modal-badge');
        const meta = document.getElementById('text-modal-meta');
        const codeEl = document.getElementById('text-code-content');
        const textareaEl = document.getElementById('text-code-textarea');
        const linesEl = document.getElementById('text-line-numbers');
        const loader = document.getElementById('text-loading-indicator');
        const editorView = document.getElementById('text-editor-view');
        const pdfFrame = document.getElementById('pdf-preview-frame');
        const wrapBtn = document.getElementById('btn-text-wrap');
        const copyBtn = document.getElementById('btn-text-copy');
        const openTabBtn = document.getElementById('btn-text-open-tab');
        const editBtn = document.getElementById('btn-text-edit');
        const saveBtn = document.getElementById('btn-text-save-changes');

        if (!modal) return;
        modal.classList.remove('d-none');
        modal.style.display = 'flex';

        currentEditingPath = filePath;
        isEditingText = false;
        hasUnsavedChanges = false;

        const ext = (fileItem.name || '').split('.').pop().toUpperCase();
        if (badge) badge.textContent = `📄 ${ext || 'TXT'}`;
        if (title) title.textContent = fileItem.name;
        if (meta) meta.textContent = `Loading · ${formatBytes(fileItem.size)}`;

        if (wrapBtn) wrapBtn.style.display = 'inline-flex';
        if (copyBtn) copyBtn.style.display = 'inline-flex';
        if (openTabBtn) openTabBtn.style.display = 'none';
        if (editBtn) {
            editBtn.style.display = 'inline-flex';
            editBtn.textContent = '✏️ Edit';
        }
        if (saveBtn) saveBtn.style.display = 'none';

        if (loader) loader.style.display = 'flex';
        if (editorView) editorView.style.display = 'none';
        if (pdfFrame) {
            pdfFrame.style.display = 'none';
            pdfFrame.src = 'about:blank';
        }
        if (codeEl) {
            codeEl.textContent = '';
            codeEl.style.display = 'block';
        }
        if (textareaEl) {
            textareaEl.value = '';
            textareaEl.style.display = 'none';
        }
        if (linesEl) linesEl.innerHTML = '';

        try {
            if (typeof global.getDecryptedFileBlob !== 'function') {
                throw new Error('Vault decryption runtime not ready.');
            }
            const blob = await global.getDecryptedFileBlob(filePath);
            currentTextBlob = blob;
            currentTextFilename = fileItem.name;

            // Bounded memory protection: limit live text preview and in-browser editing to 5 MB
            if (blob.size > 5 * 1024 * 1024) {
                currentTextContent = '⚠️ This document is larger than 5 MB. Please download the file to inspect complete contents.';
                if (editBtn) editBtn.style.display = 'none';
            } else {
                currentTextContent = await blob.text();
            }

            const lines = currentTextContent.split('\n');
            const lineCount = lines.length;

            if (meta) meta.textContent = `${lineCount} lines · ${formatBytes(blob.size)}${fileItem.isEdited ? ' · (Edited)' : ''}`;
            if (codeEl) {
                codeEl.textContent = currentTextContent;
                codeEl.className = `text-code-content ${isTextWordWrapped ? 'is-wrapped' : ''}`;
            }
            if (textareaEl) {
                textareaEl.value = currentTextContent;
                textareaEl.className = `text-code-content text-code-textarea ${isTextWordWrapped ? 'is-wrapped' : ''}`;
            }
            if (linesEl) {
                linesEl.textContent = Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1).join('\n');
            }

            const btnMd = document.getElementById('btn-text-markdown');
            const mdBody = document.getElementById('markdown-preview-body');
            const isMd = (fileItem.name || '').toLowerCase().endsWith('.md') || (fileItem.name || '').toLowerCase().endsWith('.markdown');
            if (btnMd) {
                btnMd.style.display = isMd ? 'inline-flex' : 'none';
                btnMd.onclick = () => {
                    if (!mdBody || !editorView) return;
                    if (mdBody.style.display === 'none') {
                        const currentText = textareaEl && textareaEl.style.display !== 'none' ? textareaEl.value : (codeEl?.textContent || '');
                        mdBody.innerHTML = renderSafeMarkdown(currentText);
                        mdBody.style.display = 'block';
                        editorView.style.display = 'none';
                        btnMd.textContent = '👁️ Raw View';
                    } else {
                        mdBody.style.display = 'none';
                        editorView.style.display = 'flex';
                        btnMd.textContent = '📖 Markdown';
                    }
                };
            }
            if (mdBody) mdBody.style.display = 'none';

            if (loader) loader.style.display = 'none';
            if (editorView) editorView.style.display = 'flex';
        } catch (err) {
            console.error('[Text Viewer Error]', err);
            if (loader) loader.style.display = 'none';
            showToast(`Failed to extract text document: ${err.message}`, 'error');
        }
    }

    /**
     * Opens and renders decrypted PDF document in-browser using tracked blob URL.
     * @param {string} filePath - Vault file path
     */
    async function openPdfViewerByPath(filePath) {
        const fileList = getDecryptedFileList();
        const fileItem = fileList.find(f => f.path === filePath);
        if (!fileItem) return;

        const modal = document.getElementById('vault-text-modal');
        const title = document.getElementById('text-modal-title');
        const badge = document.getElementById('text-modal-badge');
        const meta = document.getElementById('text-modal-meta');
        const loader = document.getElementById('text-loading-indicator');
        const editorView = document.getElementById('text-editor-view');
        const pdfFrame = document.getElementById('pdf-preview-frame');
        const wrapBtn = document.getElementById('btn-text-wrap');
        const copyBtn = document.getElementById('btn-text-copy');
        const openTabBtn = document.getElementById('btn-text-open-tab');
        const editBtn = document.getElementById('btn-text-edit');
        const saveBtn = document.getElementById('btn-text-save-changes');

        if (!modal) return;
        modal.classList.remove('d-none');
        modal.style.display = 'flex';

        currentEditingPath = '';
        isEditingText = false;
        hasUnsavedChanges = false;

        if (badge) badge.textContent = '📄 PDF';
        if (title) title.textContent = fileItem.name;
        if (meta) meta.textContent = `Loading · ${formatBytes(fileItem.size)}`;

        if (wrapBtn) wrapBtn.style.display = 'none';
        if (copyBtn) copyBtn.style.display = 'none';
        if (editBtn) editBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'none';
        if (openTabBtn) openTabBtn.style.display = 'inline-flex';

        if (loader) loader.style.display = 'flex';
        if (editorView) editorView.style.display = 'none';
        if (pdfFrame) {
            pdfFrame.style.display = 'none';
            pdfFrame.src = 'about:blank';
        }

        try {
            if (typeof global.getDecryptedFileBlob !== 'function') {
                throw new Error('Vault decryption runtime not ready.');
            }
            const rawBlob = await global.getDecryptedFileBlob(filePath);
            const pdfBlob = new Blob([rawBlob], { type: 'application/pdf' });
            currentTextBlob = pdfBlob;
            currentTextFilename = fileItem.name;

            if (currentPdfBlobUrl) {
                revokeTrackedBlobUrl(currentPdfBlobUrl);
                currentPdfBlobUrl = null;
            }

            currentPdfBlobUrl = createTrackedBlobUrl(pdfBlob);

            if (meta) meta.textContent = `PDF Document · ${formatBytes(pdfBlob.size)}`;
            if (loader) loader.style.display = 'none';

            if (pdfFrame) {
                pdfFrame.style.display = 'block';
                pdfFrame.src = currentPdfBlobUrl;
            }
        } catch (err) {
            console.error('[PDF Viewer Error]', err);
            if (loader) loader.style.display = 'none';
            showToast(`Failed to extract PDF document: ${err.message}`, 'error');
        }
    }

    function syncTextareaLineNumbers() {
        const textareaEl = document.getElementById('text-code-textarea');
        const linesEl = document.getElementById('text-line-numbers');
        if (!textareaEl || !linesEl) return;
        const count = textareaEl.value.split('\n').length;
        linesEl.textContent = Array.from({ length: Math.max(1, count) }, (_, i) => i + 1).join('\n');
    }

    function toggleTextEditMode() {
        const codeEl = document.getElementById('text-code-content');
        const textareaEl = document.getElementById('text-code-textarea');
        const editBtn = document.getElementById('btn-text-edit');
        const saveBtn = document.getElementById('btn-text-save-changes');
        const meta = document.getElementById('text-modal-meta');

        if (!codeEl || !textareaEl) return;

        if (isEditingText) {
            // Switch back to view/preview mode
            currentTextContent = textareaEl.value;
            codeEl.textContent = currentTextContent;
            codeEl.style.display = 'block';
            textareaEl.style.display = 'none';
            if (editBtn) editBtn.textContent = '✏️ Edit';
            if (saveBtn) saveBtn.style.display = hasUnsavedChanges ? 'inline-flex' : 'none';
            isEditingText = false;
            const count = currentTextContent.split('\n').length;
            if (meta && currentTextBlob) {
                const v3Vault = getV3Vault();
                const isEdited = v3Vault?.editedFiles?.has(currentEditingPath) || getDecryptedFileList().find(f => f.path === currentEditingPath)?.isEdited;
                meta.textContent = `${count} lines · ${formatBytes(currentTextBlob.size)}${isEdited ? ' · (Edited)' : ''}`;
            }
        } else {
            // Switch to interactive editing mode
            textareaEl.value = currentTextContent;
            codeEl.style.display = 'none';
            textareaEl.style.display = 'block';
            textareaEl.className = `text-code-content text-code-textarea ${isTextWordWrapped ? 'is-wrapped' : ''}`;
            if (editBtn) editBtn.textContent = '👁️ Preview';
            if (saveBtn) saveBtn.style.display = 'inline-flex';
            isEditingText = true;
            syncTextareaLineNumbers();
            textareaEl.focus();
        }
    }

    async function saveTextFileChanges() {
        if (!currentEditingPath) return;
        const textareaEl = document.getElementById('text-code-textarea');
        const codeEl = document.getElementById('text-code-content');
        const saveBtn = document.getElementById('btn-text-save-changes');
        const meta = document.getElementById('text-modal-meta');
        const searchInput = document.getElementById('explorer-search-input');

        const updatedText = textareaEl ? textareaEl.value : currentTextContent;
        currentTextContent = updatedText;
        if (codeEl) codeEl.textContent = updatedText;

        const newBlob = new Blob([updatedText], { type: 'text/plain;charset=utf-8' });
        currentTextBlob = newBlob;

        // 1. In-session overlay for V3 streaming vaults
        const v3Vault = getV3Vault();
        if (v3Vault) {
            if (!v3Vault.editedFiles) {
                v3Vault.editedFiles = new Map();
            }
            v3Vault.editedFiles.set(currentEditingPath, newBlob);
        }

        // 2. In-session mutation for legacy JSZip vaults
        const decryptedZip = getDecryptedZip();
        if (decryptedZip) {
            decryptedZip.file(currentEditingPath, updatedText);
        }

        // 3. Update file item metadata in currentDecryptedFileList
        const fileList = getDecryptedFileList();
        const fileItem = fileList.find(f => f.path === currentEditingPath);
        if (fileItem) {
            fileItem.size = newBlob.size;
            fileItem.isEdited = true;
            if (fileItem.entry) fileItem.entry.size = newBlob.size;
        }

        hasUnsavedChanges = false;

        // 4. Update UI feedback
        const lines = updatedText.split('\n');
        if (meta) meta.textContent = `${lines.length} lines · ${formatBytes(newBlob.size)} · (Edited)`;

        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = '✅ Saved';
            setTimeout(() => {
                if (saveBtn) saveBtn.textContent = originalText;
            }, 1500);
        }

        showToast(`Changes saved to "${currentTextFilename}" (in-session)`, 'success');

        // Re-render file list to reflect updated file size and edited badge
        if (typeof global.renderExplorerFileList === 'function') {
            global.renderExplorerFileList(searchInput ? searchInput.value : '');
        }
    }

    function handleTextareaKeydown(e) {
        const textarea = e.target;
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;
            textarea.value = value.substring(0, start) + '    ' + value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 4;
            hasUnsavedChanges = true;
            syncTextareaLineNumbers();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            saveTextFileChanges();
        }
    }

    async function createNewTextFile() {
        const v3Vault = getV3Vault();
        const decryptedZip = getDecryptedZip();
        const decryptedFolderName = global.currentDecryptedFolderName || '';

        if (!decryptedFolderName && !v3Vault && !decryptedZip) {
            showToast('Open a decrypted vault before creating a note.', 'warn');
            return;
        }

        const inputName = prompt('Enter filename for new text note:', 'note.txt');
        if (!inputName) return;
        let filename = inputName.trim();
        if (!filename) return;

        // Sanitize filename to avoid path traversal
        filename = filename.replace(/[\/\\]/g, '');
        if (!filename.includes('.')) {
            filename += '.txt';
        }

        const explorerDir = global.explorerCurrentDir || '';
        const prefix = explorerDir ? (explorerDir.replace(/\/+$/, '') + '/') : '';
        const newPath = prefix + filename;

        const fileList = getDecryptedFileList();
        if (fileList.some(f => f.path.toLowerCase() === newPath.toLowerCase())) {
            showToast(`A file named "${filename}" already exists in this folder.`, 'warn');
            return;
        }

        const emptyBlob = new Blob([''], { type: 'text/plain;charset=utf-8' });

        if (v3Vault) {
            if (!v3Vault.editedFiles) v3Vault.editedFiles = new Map();
            v3Vault.editedFiles.set(newPath, emptyBlob);
        }

        if (decryptedZip) {
            decryptedZip.file(newPath, '');
        }

        const newItem = {
            path: newPath,
            name: filename,
            dirPath: explorerDir || '',
            size: 0,
            isEdited: true,
            entry: { path: newPath, size: 0 }
        };
        fileList.push(newItem);

        if (typeof global.updateCategoryFilterCounts === 'function') {
            global.updateCategoryFilterCounts();
        }
        const searchInput = document.getElementById('explorer-search-input');
        if (typeof global.renderExplorerFileList === 'function') {
            global.renderExplorerFileList(searchInput ? searchInput.value : '');
        }

        showToast(`Created note "${filename}". Opening editor...`, 'success');

        await openTextViewerByPath(newPath);
        if (!isEditingText) {
            toggleTextEditMode();
        }
    }

    function closeTextViewer() {
        if (isEditingText && hasUnsavedChanges) {
            if (!confirm('You have unsaved changes in this document. Discard them?')) {
                return;
            }
        }

        const modal = document.getElementById('vault-text-modal');
        const loader = document.getElementById('text-loading-indicator');
        const codeEl = document.getElementById('text-code-content');
        const textareaEl = document.getElementById('text-code-textarea');
        const linesEl = document.getElementById('text-line-numbers');
        const pdfFrame = document.getElementById('pdf-preview-frame');
        const editBtn = document.getElementById('btn-text-edit');
        const saveBtn = document.getElementById('btn-text-save-changes');

        if (modal) {
            modal.classList.add('d-none');
            modal.style.display = 'none';
        }
        if (loader) loader.style.display = 'none';
        if (codeEl) {
            codeEl.textContent = '';
            codeEl.style.display = 'block';
        }
        if (textareaEl) {
            textareaEl.value = '';
            textareaEl.style.display = 'none';
        }
        if (linesEl) linesEl.textContent = '';
        if (pdfFrame) {
            pdfFrame.src = 'about:blank';
            pdfFrame.style.display = 'none';
        }
        const mdBody = document.getElementById('markdown-preview-body');
        if (mdBody) {
            mdBody.style.display = 'none';
            mdBody.innerHTML = '';
        }
        const btnMd = document.getElementById('btn-text-markdown');
        if (btnMd) {
            btnMd.style.display = 'none';
            btnMd.textContent = '📖 Markdown';
        }
        const editorView = document.getElementById('text-editor-view');
        if (editorView) editorView.style.display = 'flex';

        if (editBtn) {
            editBtn.textContent = '✏️ Edit';
            editBtn.style.display = 'inline-flex';
        }
        if (saveBtn) saveBtn.style.display = 'none';

        if (currentPdfBlobUrl) {
            revokeTrackedBlobUrl(currentPdfBlobUrl);
            currentPdfBlobUrl = null;
        }
        currentTextBlob = null;
        currentTextFilename = '';
        currentTextContent = '';
        currentEditingPath = '';
        isEditingText = false;
        hasUnsavedChanges = false;
    }

    async function copyTextToClipboard() {
        if (!currentTextContent) return;
        const btn = document.getElementById('btn-text-copy');
        const orig = btn ? btn.innerHTML : '📋 Copy';
        try {
            await navigator.clipboard.writeText(currentTextContent);
            if (btn) {
                btn.innerHTML = '✅ Copied!';
                setTimeout(() => { btn.innerHTML = orig; }, 2000);
            }
            showToast('Document copied to clipboard!', 'success');
        } catch (err) {
            console.error('[Copy Error]', err);
            showToast('Failed to copy to clipboard', 'error');
        }
    }

    function toggleTextWrap() {
        isTextWordWrapped = !isTextWordWrapped;
        const codeEl = document.getElementById('text-code-content');
        const textareaEl = document.getElementById('text-code-textarea');
        const btn = document.getElementById('btn-text-wrap');
        if (codeEl) {
            if (isTextWordWrapped) codeEl.classList.add('is-wrapped');
            else codeEl.classList.remove('is-wrapped');
        }
        if (textareaEl) {
            if (isTextWordWrapped) textareaEl.classList.add('is-wrapped');
            else textareaEl.classList.remove('is-wrapped');
        }
        if (btn) {
            btn.textContent = isTextWordWrapped ? '↔️ Unwrap' : '↩️ Wrap';
        }
    }

    function initDocumentViewerUI() {
        if (_isInitialized) return;
        _isInitialized = true;

        const textModal = document.getElementById('vault-text-modal');
        const closeTextBtn = document.getElementById('btn-close-text-modal');
        const textWrapBtn = document.getElementById('btn-text-wrap');
        const textCopyBtn = document.getElementById('btn-text-copy');
        const textDlBtn = document.getElementById('btn-text-download');
        const textOpenTabBtn = document.getElementById('btn-text-open-tab');
        const textEditBtn = document.getElementById('btn-text-edit');
        const textSaveBtn = document.getElementById('btn-text-save-changes');
        const textareaEl = document.getElementById('text-code-textarea');

        closeTextBtn?.addEventListener('click', closeTextViewer);
        textModal?.addEventListener('click', (e) => {
            if (e.target.id === 'vault-text-modal') closeTextViewer();
        });

        textEditBtn?.addEventListener('click', toggleTextEditMode);
        textSaveBtn?.addEventListener('click', saveTextFileChanges);
        textWrapBtn?.addEventListener('click', toggleTextWrap);
        textCopyBtn?.addEventListener('click', copyTextToClipboard);

        textareaEl?.addEventListener('input', () => {
            hasUnsavedChanges = true;
            syncTextareaLineNumbers();
        });
        textareaEl?.addEventListener('scroll', () => {
            const linesEl = document.getElementById('text-line-numbers');
            if (linesEl) linesEl.scrollTop = textareaEl.scrollTop;
        });
        textareaEl?.addEventListener('keydown', handleTextareaKeydown);

        textOpenTabBtn?.addEventListener('click', () => {
            if (currentPdfBlobUrl) {
                window.open(currentPdfBlobUrl, '_blank', 'noopener,noreferrer');
            }
        });

        textDlBtn?.addEventListener('click', () => {
            if (currentTextBlob && currentTextFilename) {
                triggerDownload(currentTextBlob, sanitizeFilenamePart(currentTextFilename, 'document'));
                showToast(`Saved "${currentTextFilename}"`, 'success');
            }
        });
    }

    // Public API
    const ZevDocViewer = {
        isLoaded: () => true,
        openTextViewerByPath,
        openPdfViewerByPath,
        closeTextViewer,
        createNewTextFile,
        toggleTextEditMode,
        saveTextFileChanges,
        copyTextToClipboard,
        toggleTextWrap,
        initUI: initDocumentViewerUI,
        getState: () => ({
            isEditingText,
            hasUnsavedChanges,
            currentEditingPath,
            currentTextFilename,
            isTextWordWrapped
        })
    };

    global.ZevDocViewer = ZevDocViewer;

    // Auto-init UI if document is loaded
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initDocumentViewerUI);
        } else {
            initDocumentViewerUI();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
