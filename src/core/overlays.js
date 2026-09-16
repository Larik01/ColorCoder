// src/core/overlays.js
// Turning encoded pixel sequences into wplace-native overlays:
//   1. rendering: palette-id sequence -> 1xN PNG Blob (canvas)
//   2. injection: PNG blob -> IndexedDB blob + localStorage metadata, unplaced
//   3. manager support: manifest tracking, export with base64 image blobs,
//      idempotent import (skip existing names, always fresh ids),
//      removal that survives wplace's pagehide flush.
// Browser-only (canvas, IndexedDB, localStorage). Not exercised by Node tests.

const { COLOR_PALETTE } = require('./palette.js');

// ========== storage keys ==========
const LS_KEY = 'template-overlays';
const MANIFEST_KEY = 'colorcoder-injected-templates';
const DB_NAME = 'wplace-templates';
const STORE = 'images';

// ========== manifest (what ColorCoder injected) ==========
function getManifest() {
    try { return JSON.parse(localStorage.getItem(MANIFEST_KEY) || '[]'); }
    catch (e) { return []; }
}
function saveManifest(manifest) {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
}

// ========== 1. rendering ==========

// sequence: Array<number> (palette ids) -> Promise<Blob> image/png, 1px tall
function sequenceToPngBlob(sequence) {
    const canvas = document.createElement('canvas');
    canvas.width = sequence.length;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(sequence.length, 1);

    for (let x = 0; x < sequence.length; x++) {
        const c = COLOR_PALETTE[sequence[x]] || COLOR_PALETTE[1];
        img.data[x * 4]     = c.rgb[0];
        img.data[x * 4 + 1] = c.rgb[1];
        img.data[x * 4 + 2] = c.rgb[2];
        // id 0 (Transparent) stays a real gap in the template, like BM does
        img.data[x * 4 + 3] = (sequence[x] === 0) ? 0 : 255;
    }

    ctx.putImageData(img, 0, 0);
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
}

// ========== 2. native overlay injection ==========

function listOverlays() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch (e) { return []; }
}

// Tiny box near the current map view; real positioning happens in the built-in GUI
function seedBounds() {
    const q = new URLSearchParams(location.search);
    const lat = parseFloat(q.get('lat')) || 58.34;
    const lng = parseFloat(q.get('lng')) || 14.03;
    return { north: lat + 0.001, south: lat - 0.001, west: lng - 0.001, east: lng + 0.001 };
}

function putImageBlob(id, blob) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);

        // First-time users: wplace may not have created the store yet.
        req.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }
        };

        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.close();
                return reject(new Error('IDB store "images" not found'));
            }
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(blob, id);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    });
}

function getImageBlob(id) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.close();
                return resolve(null);
            }
            const tx = db.transaction(STORE, 'readonly');
            const getReq = tx.objectStore(STORE).get(id);
            getReq.onsuccess = () => { db.close(); resolve(getReq.result || null); };
            getReq.onerror = () => { db.close(); reject(getReq.error); };
        };
    });
}

function deleteImageBlob(id) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.close();
                return resolve();
            }
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(id);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    });
}

// blob: PNG Blob; name: display name; opts: { bounds, opacity }
// Returns the created metadata entry. Ids are always freshly minted here:
// they are wplace's keys, we never reuse or rewrite them.
async function injectTemplate(blob, name, opts = {}) {
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width, height = bitmap.height;
    if (bitmap.close) bitmap.close();

    const id = crypto.randomUUID(); // metadata id AND image key
    await putImageBlob(id, blob);

    const entry = {
        id,
        name,
        bounds: opts.bounds || seedBounds(),
        originalWidth: width,
        originalHeight: height,
        opacity: opts.opacity !== undefined ? opts.opacity : 0.5,
        visible: true,
        locked: false,
        colorMetric: 'lab',
        dithering: false,
        useLegacyColors: false,
        colorPaletteMode: 'all',
        order: 0,
        hasPlaced: false,
        updatedAt: Date.now()
    };

    // The app's pagehide flush would silently drop unknown entries, so we
    // merge now AND re-merge after the app's own flush on pagehide.
    const merge = () => {
        const cur = listOverlays();
        if (!cur.some(o => o.id === id)) {
            cur.push(entry);
            localStorage.setItem(LS_KEY, JSON.stringify(cur));
        }
    };
    merge();
    window.addEventListener('pagehide', merge);

    // Manifest: remember that this id is ours, for manager features.
    const manifest = getManifest();
    if (!manifest.some(m => m.id === id)) {
        manifest.push({ id: id, name: name, timestamp: Date.now() });
        saveManifest(manifest);
    }

    return entry;
}

// ========== 3. manager: export / import / remove ==========

// Export selected templates to a single JSON download with base64 PNG blobs.
async function exportTemplates(selectedIds) {
    const overlays = listOverlays();
    const selected = overlays.filter(o => selectedIds.includes(o.id));
    const exportData = { version: 1, timestamp: Date.now(), templates: [] };

    for (const overlay of selected) {
        const blob = await getImageBlob(overlay.id);
        if (!blob) continue; // broken entry: skip rather than fail the export
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        exportData.templates.push({ metadata: overlay, imageBase64: base64 });
    }

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'colorcoder-templates-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    return exportData.templates.length;
}

// Import from an export file. Idempotent: templates whose name already exists
// are skipped. Imported templates get fresh ids minted by injectTemplate.
async function importTemplates(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.version !== 1 || !Array.isArray(data.templates)) {
        throw new Error('Invalid export file format');
    }

    const existingNames = new Set(listOverlays().map(o => o.name));
    let imported = 0;
    for (const template of data.templates) {
        const metadata = template.metadata;
        const imageBase64 = template.imageBase64;
        if (existingNames.has(metadata.name)) continue; // already present
        const byteChars = atob(imageBase64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArray], { type: 'image/png' });
        await injectTemplate(blob, metadata.name, {
            bounds: metadata.bounds,
            opacity: metadata.opacity
        });
        existingNames.add(metadata.name);
        imported++;
    }
    return imported;
}

// Remove selected templates from localStorage, IDB, and manifest.
// wplace flushes its stale in-memory list on pagehide and would re-add the
// entries we just deleted, so we re-strip them once after that flush.
async function removeTemplates(selectedIds) {
    const overlays = listOverlays();
    const toKeep = overlays.filter(o => !selectedIds.includes(o.id));
    localStorage.setItem(LS_KEY, JSON.stringify(toKeep));
    for (const id of selectedIds) await deleteImageBlob(id);
    const manifest = getManifest();
    saveManifest(manifest.filter(m => !selectedIds.includes(m.id)));

    const idSet = new Set(selectedIds);
    const reRemove = () => {
        const cur = listOverlays();
        const cleaned = cur.filter(o => !idSet.has(o.id));
        if (cleaned.length !== cur.length) {
            localStorage.setItem(LS_KEY, JSON.stringify(cleaned));
        }
    };
    window.addEventListener('pagehide', reRemove, { once: true });

    return selectedIds.length;
}

// ========== selection helpers ==========

function getOurTemplates() {
    const overlays = listOverlays();
    const manifestIds = new Set(getManifest().map(m => m.id));
    return overlays.filter(o => manifestIds.has(o.id));
}
function getAllTemplates() {
    return listOverlays();
}

module.exports = {
    sequenceToPngBlob,
    injectTemplate, listOverlays,
    exportTemplates, importTemplates, removeTemplates,
    getOurTemplates, getAllTemplates, getManifest,
    LS_KEY, MANIFEST_KEY, DB_NAME, STORE
};