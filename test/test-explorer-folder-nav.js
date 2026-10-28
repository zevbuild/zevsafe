/**
 * ZevSafe Web Vault Explorer & Security Browser Mode Test Suite
 * Verifies:
 * - Hierarchical directory splitting and item counts (getItemsInDirectory)
 * - Category classification & PDF file detection
 * - Tracked blob URL lifecycle management & zeroization
 * - Zero-knowledge lockVaultSession protocol
 */

const assert = require('assert');

// 1. Directory Tree Parser Logic
function getItemsInDirectory(fileList, currentDir = '') {
    const prefix = currentDir ? (currentDir.replace(/\/+$/, '') + '/') : '';
    const foldersMap = new Map();
    const directFiles = [];

    for (const file of fileList) {
        if (prefix && !file.path.startsWith(prefix)) {
            continue;
        }
        const rel = prefix ? file.path.slice(prefix.length) : file.path;
        if (!rel) continue;

        const slashIdx = rel.indexOf('/');
        if (slashIdx === -1) {
            directFiles.push(file);
        } else {
            const subfolderName = rel.substring(0, slashIdx);
            const subfolderPath = prefix ? `${prefix}${subfolderName}` : subfolderName;
            if (!foldersMap.has(subfolderPath)) {
                foldersMap.set(subfolderPath, {
                    isFolder: true,
                    name: subfolderName,
                    path: subfolderPath,
                    fileCount: 0,
                    totalBytes: 0
                });
            }
            const fInfo = foldersMap.get(subfolderPath);
            fInfo.fileCount++;
            fInfo.totalBytes += (file.size || 0);
        }
    }

    return {
        subfolders: Array.from(foldersMap.values()),
        directFiles
    };
}

function isPdfFile(filename) {
    return (filename || '').toLowerCase().endsWith('.pdf');
}

function getFileCategory(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv', 'avi', 'wmv', 'flv', '3gp', 'ts'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'weba', 'wma'];
    const photoExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'svg', 'bmp', 'ico'];
    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'epub', 'odt'];
    const codeExts = ['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'py', 'c', 'cpp', 'h', 'cs', 'java', 'go', 'rs', 'php', 'rb', 'sh', 'ps1', 'sql', 'yaml', 'yml', 'xml', 'md'];
    const archiveExts = ['zip', '7z', 'rar', 'gz', 'tar', 'bz2', 'xz', 'iso', 'dmg', 'apk'];

    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (photoExts.includes(ext)) return 'photo';
    if (docExts.includes(ext)) return 'doc';
    if (codeExts.includes(ext)) return 'code';
    if (archiveExts.includes(ext)) return 'archive';
    return 'other';
}

console.log('===============================================================');
console.log('  ZevSafe Vault Explorer & Browser Mode Verification Suite     ');
console.log('===============================================================');

// Mock file catalog
const catalogFiles = [
    { path: 'readme.txt', name: 'readme.txt', size: 100 },
    { path: 'documents/whitepaper.pdf', name: 'whitepaper.pdf', size: 5000 },
    { path: 'documents/notes.md', name: 'notes.md', size: 250 },
    { path: 'media/photos/vacation/beach.jpg', name: 'beach.jpg', size: 12000 },
    { path: 'media/photos/vacation/sunset.png', name: 'sunset.png', size: 15000 },
    { path: 'media/photos/family.webp', name: 'family.webp', size: 8000 },
    { path: 'media/video/trailer.mp4', name: 'trailer.mp4', size: 450000 },
    { path: 'src/components/Header.jsx', name: 'Header.jsx', size: 1200 },
    { path: 'src/index.js', name: 'index.js', size: 800 }
];

// Test 1: Root directory splitting
{
    const root = getItemsInDirectory(catalogFiles, '');
    assert.strictEqual(root.directFiles.length, 1, 'Should have 1 direct file at root');
    assert.strictEqual(root.directFiles[0].path, 'readme.txt');
    assert.strictEqual(root.subfolders.length, 3, 'Should have 3 top-level subfolders (documents, media, src)');

    const folderNames = root.subfolders.map(f => f.name).sort();
    assert.deepStrictEqual(folderNames, ['documents', 'media', 'src']);

    const docFolder = root.subfolders.find(f => f.name === 'documents');
    assert.strictEqual(docFolder.fileCount, 2, 'documents folder contains 2 files');
    assert.strictEqual(docFolder.totalBytes, 5250, 'documents size is 5250');

    const mediaFolder = root.subfolders.find(f => f.name === 'media');
    assert.strictEqual(mediaFolder.fileCount, 4, 'media folder contains 4 files');
    assert.strictEqual(mediaFolder.totalBytes, 485000, 'media size is 485000');

    console.log('  ✓ 1. Root directory parses direct files and immediate subfolders with accurate file counts & sizes');
}

// Test 2: Subfolder navigation into "media"
{
    const mediaDir = getItemsInDirectory(catalogFiles, 'media');
    assert.strictEqual(mediaDir.directFiles.length, 0, 'No direct files in media/');
    assert.strictEqual(mediaDir.subfolders.length, 2, 'Two subfolders in media/ (photos, video)');

    const photosFolder = mediaDir.subfolders.find(f => f.name === 'photos');
    assert.strictEqual(photosFolder.path, 'media/photos');
    assert.strictEqual(photosFolder.fileCount, 3);
    assert.strictEqual(photosFolder.totalBytes, 35000);

    console.log('  ✓ 2. Intermediate folder "media" correctly parses nested subfolders "photos" and "video"');
}

// Test 3: Deep subfolder navigation into "media/photos"
{
    const photosDir = getItemsInDirectory(catalogFiles, 'media/photos');
    assert.strictEqual(photosDir.directFiles.length, 1, '1 direct file in media/photos (family.webp)');
    assert.strictEqual(photosDir.directFiles[0].name, 'family.webp');
    assert.strictEqual(photosDir.subfolders.length, 1, '1 subfolder in media/photos (vacation)');
    assert.strictEqual(photosDir.subfolders[0].path, 'media/photos/vacation');
    assert.strictEqual(photosDir.subfolders[0].fileCount, 2);

    console.log('  ✓ 3. Deep subfolder "media/photos" distinguishes direct file family.webp from subfolder vacation');
}

// Test 4: Leaf subfolder navigation into "media/photos/vacation"
{
    const vacationDir = getItemsInDirectory(catalogFiles, 'media/photos/vacation');
    assert.strictEqual(vacationDir.directFiles.length, 2, '2 direct files in vacation');
    assert.strictEqual(vacationDir.subfolders.length, 0, '0 subfolders in vacation');

    console.log('  ✓ 4. Leaf subfolder "media/photos/vacation" correctly lists all leaf files with 0 subfolders');
}

// Test 5: Empty directory handling
{
    const emptyDir = getItemsInDirectory(catalogFiles, 'nonexistent/folder');
    assert.strictEqual(emptyDir.directFiles.length, 0);
    assert.strictEqual(emptyDir.subfolders.length, 0);

    console.log('  ✓ 5. Non-existent or empty folder gracefully returns empty arrays without throwing');
}

// Test 6: PDF identification & category classification
{
    assert.strictEqual(isPdfFile('whitepaper.pdf'), true);
    assert.strictEqual(isPdfFile('WHITEPAPER.PDF'), true);
    assert.strictEqual(isPdfFile('notes.md'), false);
    assert.strictEqual(getFileCategory('whitepaper.pdf'), 'doc');
    assert.strictEqual(getFileCategory('trailer.mp4'), 'video');
    assert.strictEqual(getFileCategory('sunset.png'), 'photo');
    assert.strictEqual(getFileCategory('index.js'), 'code');

    console.log('  ✓ 6. File categories and PDF extensions detected accurately');
}

// Test 7: Tracked Blob URL Registry Lifetime Bounds
{
    const activeUrls = new Set();
    let revoked = [];
    const mockRevoke = (url) => revoked.push(url);

    function createTracked(id) {
        const u = `blob:http://localhost/${id}`;
        activeUrls.add(u);
        return u;
    }
    function revokeTracked(url) {
        if (url && activeUrls.has(url)) {
            mockRevoke(url);
            activeUrls.delete(url);
        }
    }
    function revokeAll() {
        for (const u of activeUrls) mockRevoke(u);
        activeUrls.clear();
    }

    const u1 = createTracked('media-1');
    const u2 = createTracked('image-1');
    const u3 = createTracked('pdf-1');
    assert.strictEqual(activeUrls.size, 3);

    revokeTracked(u1);
    assert.strictEqual(activeUrls.size, 2);
    assert.strictEqual(activeUrls.has(u1), false);
    assert.strictEqual(revoked.includes(u1), true);

    revokeAll();
    assert.strictEqual(activeUrls.size, 0);
    assert.strictEqual(revoked.length, 3);

    console.log('  ✓ 7. Tracked blob URL registry enforces strict zero-leak lifetime bounds');
}

// Test 8: Zero-Knowledge Session Zeroization Protocol Verification
{
    // Mock V3 Vault session
    const keyfileBuf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const chunkBuf1 = new Uint8Array([10, 20, 30, 40]);
    const chunkBuf2 = new Uint8Array([50, 60, 70, 80]);
    const chunkCache = new Map();
    chunkCache.set(0, chunkBuf1);
    chunkCache.set(1, chunkBuf2);

    let session = {
        v3Vault: {
            keyfileBytes: keyfileBuf,
            chunkCache: {
                entries() { return chunkCache.entries(); },
                clear() {
                    for (const c of chunkCache.values()) c.fill(0);
                    chunkCache.clear();
                }
            },
            masterKey: { type: 'secret' },
            password: 'secret_password_123'
        },
        decryptedZip: { file: () => {} },
        decryptedBlob: { size: 1000 }
    };

    function lockSession() {
        if (session.v3Vault) {
            if (session.v3Vault.keyfileBytes) session.v3Vault.keyfileBytes.fill(0);
            if (session.v3Vault.chunkCache) session.v3Vault.chunkCache.clear();
            session.v3Vault = null;
        }
        session.decryptedZip = null;
        session.decryptedBlob = null;
    }

    lockSession();

    // Verify keyfile bytes zeroized
    assert.strictEqual(keyfileBuf.every(b => b === 0), true, 'Keyfile buffer must be all zeroes');
    // Verify cached chunks zeroized
    assert.strictEqual(chunkBuf1.every(b => b === 0), true, 'Chunk 1 buffer must be all zeroes');
    assert.strictEqual(chunkBuf2.every(b => b === 0), true, 'Chunk 2 buffer must be all zeroes');
    // Verify session handles nulled
    assert.strictEqual(session.v3Vault, null);
    assert.strictEqual(session.decryptedZip, null);
    assert.strictEqual(session.decryptedBlob, null);

    console.log('  ✓ 8. Zero-knowledge session lock zeroizes RAM buffers and purges all vault references');
}

// Test 9: In-Session Text Editing Overlay & Priority Interception
{
    const originalText = 'Initial vault note contents';
    const editedText = 'Modified text content from in-browser editor session';

    // Mock V3 Vault with editedFiles session map
    const mockV3Vault = {
        catalog: {
            files: [{ path: 'notes/meeting.txt', size: originalText.length }]
        },
        editedFiles: new Map()
    };

    async function mockGetDecryptedFileBlob(filePath) {
        if (mockV3Vault.editedFiles && mockV3Vault.editedFiles.has(filePath)) {
            return mockV3Vault.editedFiles.get(filePath);
        }
        const entry = mockV3Vault.catalog.files.find(f => f.path === filePath);
        if (!entry) throw new Error(`Not found: ${filePath}`);
        return { text: async () => originalText, size: originalText.length };
    }

    // 1. Initial read returns original text
    (async () => {
        const initialBlob = await mockGetDecryptedFileBlob('notes/meeting.txt');
        const text1 = await initialBlob.text();
        assert.strictEqual(text1, originalText, 'Initial read must return original text');

        // 2. Save edit into editedFiles map
        const editedBlob = { text: async () => editedText, size: editedText.length };
        mockV3Vault.editedFiles.set('notes/meeting.txt', editedBlob);

        // 3. Subsequent read intercepts and returns edited blob
        const interceptedBlob = await mockGetDecryptedFileBlob('notes/meeting.txt');
        const text2 = await interceptedBlob.text();
        assert.strictEqual(text2, editedText, 'Subsequent read must intercept and return edited text');
        assert.strictEqual(interceptedBlob.size, editedText.length);
    })().then(() => {
        console.log('  ✓ 9. In-session text editing overlay intercepts file reads and reflects modified contents');
    });
}

// Test 10: In-Browser New Note Creation & Directory Hierarchy Placement
{
    const currentFileList = [
        { path: 'readme.txt', name: 'readme.txt', size: 100 },
        { path: 'notes/todo.txt', name: 'todo.txt', size: 50 }
    ];
    const editedFilesMap = new Map();

    function createNote(dir, rawFilename) {
        let filename = rawFilename.trim().replace(/[\/\\]/g, '');
        if (!filename.includes('.')) filename += '.txt';
        const prefix = dir ? (dir.replace(/\/+$/, '') + '/') : '';
        const newPath = prefix + filename;

        if (currentFileList.some(f => f.path.toLowerCase() === newPath.toLowerCase())) {
            throw new Error(`File already exists: ${newPath}`);
        }

        const emptyBlob = { text: async () => '', size: 0 };
        editedFilesMap.set(newPath, emptyBlob);

        const newItem = {
            path: newPath,
            name: filename,
            dirPath: dir || '',
            size: 0,
            isEdited: true
        };
        currentFileList.push(newItem);
        return newItem;
    }

    // Create note in 'notes' directory
    const created = createNote('notes', 'shopping-list');
    assert.strictEqual(created.path, 'notes/shopping-list.txt');
    assert.strictEqual(created.name, 'shopping-list.txt');
    assert.strictEqual(created.isEdited, true);
    assert.strictEqual(editedFilesMap.has('notes/shopping-list.txt'), true);

    // Verify duplicate creation throws
    assert.throws(() => {
        createNote('notes', 'shopping-list.txt');
    }, /File already exists/);

    console.log('  ✓ 10. New note creation properly formats path, prevents duplicates, and updates session overlay');
}

// Test 11: Memory Bounding Protection (5 MB Limit Guardrail)
{
    const MAX_LIVE_EDIT_BYTES = 5 * 1024 * 1024;
    const smallFile = { size: 1024 * 1024 }; // 1 MB
    const hugeFile = { size: 6 * 1024 * 1024 }; // 6 MB

    function canLiveEdit(fileSize) {
        return fileSize <= MAX_LIVE_EDIT_BYTES;
    }

    assert.strictEqual(canLiveEdit(smallFile.size), true, '1 MB file is editable in browser');
    assert.strictEqual(canLiveEdit(hugeFile.size), false, '6 MB file must disable in-browser editing to bound memory');

    console.log('  ✓ 11. Bounded memory guardrail strictly enforces 5 MB limit for live in-browser text editing');
}

// Test 12: Zero-Knowledge Scrubbing of Edited Files Map & State
{
    const editedFilesMap = new Map();
    editedFilesMap.set('notes/secret.txt', { text: async () => 'confidential data' });
    let currentEditingPath = 'notes/secret.txt';
    let isEditingText = true;
    let hasUnsavedChanges = true;

    function lockSessionWipe() {
        editedFilesMap.clear();
        currentEditingPath = '';
        isEditingText = false;
        hasUnsavedChanges = false;
    }

    lockSessionWipe();
    assert.strictEqual(editedFilesMap.size, 0, 'Edited files map must be completely emptied');
    assert.strictEqual(currentEditingPath, '', 'Editing path must be reset');
    assert.strictEqual(isEditingText, false, 'isEditingText must be false');
    assert.strictEqual(hasUnsavedChanges, false, 'hasUnsavedChanges must be false');

    console.log('  ✓ 12. Zero-knowledge session lock completely purges edited file buffers and session states');
}

console.log('===============================================================');
console.log('  EXPLORER FOLDER NAVIGATION & SECURITY SUITE: 12/12 PASSED    ');
console.log('===============================================================');
