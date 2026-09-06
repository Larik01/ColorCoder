// src/core/templates.js
// Writes a template overlay straight into wplace's built-in overlay system:
// PNG blob -> IndexedDB, metadata -> localStorage, unplaced (hasPlaced: false).
// The app's pagehide flush would silently drop unknown entries, so we register
// a LATER pagehide listener that merges our entry back after the app's flush.
// Browser-only. The user positions the result with the built-in GUI.

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

    const merge = () => {
        const cur = listOverlays();
        if (!cur.some(o => o.id === id)) {
            cur.push(entry);
            localStorage.setItem(LS_KEY, JSON.stringify(cur));
        }
    };
    merge();                               // now
    window.addEventListener('pagehide', merge); // after the app's own flush

    return entry;
}

module.exports = { injectTemplate, listOverlays };