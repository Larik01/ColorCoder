// src/core/overlays.js
// Turning encoded pixel sequences into wplace-native overlays:
//   1. rendering: palette-id sequence -> 1xN PNG Blob (canvas)
//   2. injection: PNG blob -> IndexedDB blob + localStorage metadata, unplaced
// Browser-only (canvas, IndexedDB, localStorage). Not exercised by Node tests.

const { COLOR_PALETTE } = require('./palette.js');

// ========== 1. RENDERING ==========

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

// ========== 2. NATIVE OVERLAY INJECTION ==========

const LS_KEY = 'template-overlays';
const DB_NAME = 'wplace-templates';
const STORE = 'images';

function listOverlays() {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
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

// blob: PNG Blob; name: display name; opts: { bounds, opacity }
// Returns the created metadata entry.
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

    return entry;
}

module.exports = {
    sequenceToPngBlob,
    injectTemplate, listOverlays,
    LS_KEY, DB_NAME, STORE
};