/**
 * ZevSafe Modular In-Vault Text Editor
 * js/text-editor.js
 *
 * Lazy-loaded ONLY when the user clicks the ✏️ Edit button on a text/code file.
 * Provides: line-numbered textarea editing, Tab-indent, Ctrl+S save, in-session
 * write-back for both V3 streaming vaults and legacy JSZip vaults.
 * Zero external network calls. 100% Client-Side.
 */
(function (global) {
    'use strict';

    // ─── private state (shared with document-viewer via accessor callbacks) ───

    let _hasUnsavedChanges = false;
    let _isEditingText = false;
    let _isInitialized = false;

    // ─── helpers that delegate back to app.js globals ────────────────────────

    function getV3Vault() { return global.currentV3Vault || null; }
    function getDecryptedZip() { return global.currentDecryptedZip || null; }
    function getDecryptedFileList() { return global.currentDecryptedFileList || []; }

    function formatBytes(bytes) {
        if (typeof global.formatBytes === 'function') return global.formatBytes(bytes);
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function showToast(msg, type = 'info') {
        if (typeof global.showToast === 'function') global.showToast(msg, type);
        else console.log(`[ZevSafe Toast] [${type}] ${msg}`);
    }

    // ─── Line-number sync ─────────────────────────────────────────────────────

    function syncTextareaLineNumbers() {
        const textareaEl = document.getElementById('text-code-textarea');
        const linesEl    = document.getElementById('text-line-numbers');
        if (!textareaEl || !linesEl) return;
        const count = textareaEl.value.split('\n').length;
        linesEl.textContent = Array.from({ length: Math.max(1, count) }, (_, i) => i + 1).join('\n');
    }

    // ─── Toggle edit / preview mode ───────────────────────────────────────────

    function toggleTextEditMode() {
        const codeEl    = document.getElementById('text-code-content');
        const textareaEl = document.getElementById('text-code-textarea');
        const editBtn   = document.getElementById('btn-text-edit');
        const saveBtn   = document.getElementById('btn-text-save-changes');
        const meta      = document.getElementById('text-modal-meta');

        if (!codeEl || !textareaEl) return;

        // Notify document-viewer of the new editing state
        const docViewer = global.ZevDocViewer;
        const state = docViewer ? docViewer.getState() : {};
        const currentTextContent = state.currentTextContent || codeEl.textContent;
        const currentTextBlob    = state.currentTextBlob    || null;
        const currentEditingPath = state.currentEditingPath || '';
        const isTextWordWrapped  = state.isTextWordWrapped  || false;

        if (_isEditingText) {
            // ── Back to preview mode ──────────────────────────────────────────
            const newContent = textareaEl.value;
            if (docViewer && typeof docViewer.setTextContent === 'function') {
                docViewer.setTextContent(newContent);
            }
            codeEl.textContent = newContent;
            codeEl.classList.remove('d-none');
            codeEl.style.display = 'block';
            textareaEl.classList.add('d-none');
            textareaEl.style.display = 'none';
            if (editBtn) editBtn.textContent = '✏️ Edit';
            if (saveBtn) saveBtn.style.display = _hasUnsavedChanges ? 'inline-flex' : 'none';
            _isEditingText = false;
            if (docViewer && typeof docViewer.setEditingState === 'function') {
                docViewer.setEditingState(false);
            }
            const lineCount = newContent.split('\n').length;
            if (meta && currentTextBlob) {
                const v3 = getV3Vault();
                const isEdited = v3?.editedFiles?.has(currentEditingPath)
                    || getDecryptedFileList().find(f => f.path === currentEditingPath)?.isEdited;
                meta.textContent = `${lineCount} lines · ${formatBytes(currentTextBlob.size)}${isEdited ? ' · (Edited)' : ''}`;
            }
        } else {
            // ── Enter editing mode ────────────────────────────────────────────
            textareaEl.value     = currentTextContent;
            codeEl.classList.add('d-none');
            codeEl.style.display = 'none';
            textareaEl.classList.remove('d-none');
            textareaEl.style.display = 'block';
            textareaEl.className = `text-code-content text-code-textarea ${isTextWordWrapped ? 'is-wrapped' : ''}`;
            if (editBtn) editBtn.textContent = '👁️ Preview';
            if (saveBtn) saveBtn.style.display = 'inline-flex';
            _isEditingText = true;
            if (docViewer && typeof docViewer.setEditingState === 'function') {
                docViewer.setEditingState(true);
            }
            syncTextareaLineNumbers();
            textareaEl.focus();
        }
    }

    // ─── Save in-session ──────────────────────────────────────────────────────

    async function saveTextFileChanges() {
        const docViewer = global.ZevDocViewer;
        const state = docViewer ? docViewer.getState() : {};
        const currentEditingPath = state.currentEditingPath || '';
        if (!currentEditingPath) return;

        const textareaEl = document.getElementById('text-code-textarea');
        const codeEl     = document.getElementById('text-code-content');
        const saveBtn    = document.getElementById('btn-text-save-changes');
        const meta       = document.getElementById('text-modal-meta');
        const searchInput = document.getElementById('explorer-search-input');

        const updatedText = textareaEl ? textareaEl.value : (state.currentTextContent || '');
        if (codeEl) codeEl.textContent = updatedText;

        const newBlob = new Blob([updatedText], { type: 'text/plain;charset=utf-8' });

        // 1. Push update back into document-viewer state
        if (docViewer && typeof docViewer.setTextContent === 'function') {
            docViewer.setTextContent(updatedText, newBlob);
        }

        // 2. In-session overlay — V3 streaming vaults
        const v3Vault = getV3Vault();
        if (v3Vault) {
            if (!v3Vault.editedFiles) v3Vault.editedFiles = new Map();
            v3Vault.editedFiles.set(currentEditingPath, newBlob);
        }

        // 3. In-session mutation — legacy JSZip vaults
        const decryptedZip = getDecryptedZip();
        if (decryptedZip) decryptedZip.file(currentEditingPath, updatedText);

        // 4. Update file-list metadata
        const fileList = getDecryptedFileList();
        const fileItem = fileList.find(f => f.path === currentEditingPath);
        if (fileItem) {
            fileItem.size    = newBlob.size;
            fileItem.isEdited = true;
            if (fileItem.entry) fileItem.entry.size = newBlob.size;
        }

        _hasUnsavedChanges = false;

        // 5. UI feedback
        const lines = updatedText.split('\n');
        if (meta) meta.textContent = `${lines.length} lines · ${formatBytes(newBlob.size)} · (Edited)`;

        if (saveBtn) {
            const orig = saveBtn.textContent;
            saveBtn.textContent = '✅ Saved';
            setTimeout(() => { if (saveBtn) saveBtn.textContent = orig; }, 1500);
        }

        const currentTextFilename = state.currentTextFilename || currentEditingPath.split('/').pop();
        showToast(`Changes saved to "${currentTextFilename}" (in-session)`, 'success');

        if (typeof global.renderExplorerFileList === 'function') {
            global.renderExplorerFileList(searchInput ? searchInput.value : '');
        }
    }

    // ─── Keyboard shortcuts in textarea ──────────────────────────────────────

    function handleTextareaKeydown(e) {
        const textarea = e.target;
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end   = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 4;
            _hasUnsavedChanges = true;
            syncTextareaLineNumbers();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            saveTextFileChanges();
        }
    }

    // ─── Create new text note ─────────────────────────────────────────────────

    async function createNewTextFile() {
        const v3Vault            = getV3Vault();
        const decryptedZip       = getDecryptedZip();
        const decryptedFolderName = global.currentDecryptedFolderName || '';

        if (!decryptedFolderName && !v3Vault && !decryptedZip) {
            showToast('Open a decrypted vault before creating a note.', 'warn');
            return;
        }

        const inputName = prompt('Enter filename for new text note:', 'note.txt');
        if (!inputName) return;
        let filename = inputName.trim();
        if (!filename) return;

        filename = filename.replace(/[\/\\]/g, '');
        if (!filename.includes('.')) filename += '.txt';

        const explorerDir = global.explorerCurrentDir || '';
        const prefix      = explorerDir ? (explorerDir.replace(/\/+$/, '') + '/') : '';
        const newPath     = prefix + filename;

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
        if (decryptedZip) decryptedZip.file(newPath, '');

        const newItem = {
            path: newPath, name: filename,
            dirPath: explorerDir || '',
            size: 0, isEdited: true,
            entry: { path: newPath, size: 0 }
        };
        fileList.push(newItem);

        if (typeof global.updateCategoryFilterCounts === 'function') global.updateCategoryFilterCounts();
        const searchInput = document.getElementById('explorer-search-input');
        if (typeof global.renderExplorerFileList === 'function') {
            global.renderExplorerFileList(searchInput ? searchInput.value : '');
        }

        showToast(`Created note "${filename}". Opening editor...`, 'success');

        // Open viewer via document-viewer
        const docViewer = global.ZevDocViewer;
        if (docViewer && typeof docViewer.openTextViewerByPath === 'function') {
            await docViewer.openTextViewerByPath(newPath);
        }
        // Then immediately enter edit mode
        if (!_isEditingText) toggleTextEditMode();
    }

    // ─── Wire up edit-mode event listeners (called once after DOM is ready) ──

    function initTextEditorUI() {
        if (_isInitialized) return;
        _isInitialized = true;

        const textEditBtn = document.getElementById('btn-text-edit');
        const textSaveBtn = document.getElementById('btn-text-save-changes');
        const textareaEl  = document.getElementById('text-code-textarea');

        textEditBtn?.addEventListener('click', toggleTextEditMode);
        textSaveBtn?.addEventListener('click', saveTextFileChanges);

        textareaEl?.addEventListener('input', () => {
            _hasUnsavedChanges = true;
            syncTextareaLineNumbers();
        });
        textareaEl?.addEventListener('scroll', () => {
            const linesEl = document.getElementById('text-line-numbers');
            if (linesEl) linesEl.scrollTop = textareaEl.scrollTop;
        });
        textareaEl?.addEventListener('keydown', handleTextareaKeydown);
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    global.ZevTextEditor = {
        isLoaded: () => true,
        toggleTextEditMode,
        saveTextFileChanges,
        syncTextareaLineNumbers,
        handleTextareaKeydown,
        createNewTextFile,
        initUI: initTextEditorUI,
        getState: () => ({
            isEditingText:     _isEditingText,
            hasUnsavedChanges: _hasUnsavedChanges
        }),
        setUnsavedChanges: (val) => { _hasUnsavedChanges = val; }
    };

})(typeof window !== 'undefined' ? window : globalThis);
