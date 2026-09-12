// src/core/intercept.js
// Autoscan pipeline. For every tile PNG the map fetches: decode it once,
// scan for V2 sync rows (including cross-tile seams), decode any messages
// found, register them under a magic color, paint 2x2 magic markers above
// the syncs, return the modified PNG blob to the map renderer.
// Our own reads stay clean because wplace.js fetches through RAW_FETCH and
// we seed its cache with the clean ImageData here.
// Browser-only.

const { COLOR_PALETTE } = require('./palette.js');
const { decodeV2, unpackHeaderV2 } = require('./protocol.js');
const {
    syncRGB, scanSync, extractEdges, seamCheck, edgeSuspicious,
    markerRect, markerClips
} = require('./scan.js');
const { TILE_SIZE, getTileImageData, readSequenceHorizontal, seedTileCache } = require('./wplace.js');

// ---------- magic color space: 16 tolerance-safe keys (v5 semantics) ----------
const MAGIC_KEYS = [];
for (const g of [0, 34]) {
    for (let r = 1; r <= 239; r += 34) MAGIC_KEYS.push([r, g, 255]);
}
let nextKey = 0;

const registry = new Map(); // "r,g,b" -> { color, rect, gx, gy, text, valid, modeStr }

// Positions registered this page load; stops re-decoding on every refetch.
// Set only AFTER success, so a transient read failure retries next refetch.
const MSGSEEN = new Set();

// Lifetime counters, printed only by the Alt+S summary.
const DBG = { tiles: 0, found: 0, decodeOk: 0, decodeErr: 0, painted: 0 };

const SYNC_RGB = syncRGB(COLOR_PALETTE);

// ---------- scratch canvases ----------
const scratchCv = document.createElement('canvas');
const sctx = scratchCv.getContext('2d', { willReadFrequently: true });
const modCv = document.createElement('canvas');
const mctx = modCv.getContext('2d', { willReadFrequently: true });

async function decodeBlobToImageData(blob) {
    const bitmap = await createImageBitmap(blob);
    const W = bitmap.width, H = bitmap.height;
    scratchCv.width = W; scratchCv.height = H;
    sctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    return sctx.getImageData(0, 0, W, H);
}

// Global-coordinate reader: wplace.readSequenceHorizontal wants
// (tileX, tileY, px, py, length), so convert globals and chunk across tiles.
async function readSeq(gx, gy, len) {
    const ty = Math.floor(gy / TILE_SIZE);
    const ly = gy - ty * TILE_SIZE;
    const ids = [];
    let cx = gx;
    while (ids.length < len) {
        const tx = Math.floor(cx / TILE_SIZE);
        const lx = cx - tx * TILE_SIZE;
        const take = Math.min(len - ids.length, TILE_SIZE - lx);
        const chunk = await readSequenceHorizontal(tx, ty, lx, ly, take);
        for (let k = 0; k < chunk.length; k++) ids.push(chunk[k]);
        cx += take;
    }
    return ids;
}

async function tryDecodeAndRegister(gx, gy) {
    const key = gx + ',' + gy;
    if (MSGSEEN.has(key)) return;

    let head, h, seq, r;
    try {
        head = await readSeq(gx, gy, 8);
        h = unpackHeaderV2(head[4], head[5], head[6], head[7]);
        seq = await readSeq(gx, gy, 8 + h.length);
        r = decodeV2(seq);
    } catch (e) {
        DBG.decodeErr++;
        return; // transient (abort etc.): retry on next refetch
    }
    if (!r || r.text === null) { DBG.decodeErr++; return; }

    MSGSEEN.add(key);
    DBG.decodeOk++;

    const modeStr = (r.mode === 0 ? 'Lite' : 'Full') + (r.free ? '-free' : '');

    if (nextKey > 0 && nextKey % MAGIC_KEYS.length === 0) {
        console.warn('[CC-INTERCEPT] magic key space wrapped; labels may collide');
    }
    const color = MAGIC_KEYS[nextKey % MAGIC_KEYS.length];
    nextKey++;

    registry.set(color.join(','), {
        color, rect: markerRect(gx, gy), gx, gy,
        text: r.text, valid: r.valid, modeStr
    });

    const crcStr = r.valid ? 'CRC OK' :
        'CRC BAD (stored ' + r.stored + ' != ' + r.computed + ')';
    console.log('%c[CC-INTERCEPT] V2 ' + modeStr + ' @' + gx + ',' + gy +
        ' | ' + r.length + ' px | ' + crcStr + ' | "' + r.text +
        '" | magic rgb(' + color.join(',') + ')',
        'color:#0c8;font-weight:bold');
}

// ---------- per-fetch pipeline ----------
async function processTile(tx, ty, blob) {
    DBG.tiles++;
    const img = await decodeBlobToImageData(blob);
    seedTileCache(tx, ty, img);

    const W = img.width, H = img.height;
    const hits = scanSync(img.data, W, H, SYNC_RGB);
    const edges = extractEdges(img.data, W, H, SYNC_RGB);

    const found = [];
    for (let i = 0; i < hits.length; i += 2) {
        found.push([tx * TILE_SIZE + hits[i], ty * TILE_SIZE + hits[i + 1]]);
    }

    if (edgeSuspicious(edges.right, H)) {
        const nb = await getTileImageData(tx + 1, ty);
        if (nb) {
            const nbEdges = extractEdges(nb.data, nb.width, nb.height, SYNC_RGB);
            const sh = seamCheck(edges.right, nbEdges.left, H, TILE_SIZE);
            for (let i = 0; i < sh.length; i += 2) {
                found.push([tx * TILE_SIZE + sh[i], ty * TILE_SIZE + sh[i + 1]]);
            }
        }
    }
    if (edgeSuspicious(edges.left, H)) {
        const nb = await getTileImageData(tx - 1, ty);
        if (nb) {
            const nbEdges = extractEdges(nb.data, nb.width, nb.height, SYNC_RGB);
            const sh = seamCheck(nbEdges.right, edges.left, H, TILE_SIZE);
            for (let i = 0; i < sh.length; i += 2) {
                found.push([(tx - 1) * TILE_SIZE + sh[i], ty * TILE_SIZE + sh[i + 1]]);
            }
        }
    }
    DBG.found += found.length;

    for (const [gx, gy] of found) await tryDecodeAndRegister(gx, gy);

    const clips = markerClips(registry, tx, ty, TILE_SIZE);
    let outBlob = null;
    if (clips.length > 0) {
        modCv.width = W; modCv.height = H;
        mctx.putImageData(img, 0, 0);
        for (const c of clips) {
            mctx.fillStyle = 'rgb(' + c[0].join(',') + ')';
            mctx.fillRect(c[1], c[2], c[3], c[4]);
        }
        outBlob = await new Promise(r => modCv.toBlob(r, 'image/png'));
        DBG.painted++;
    }
    return outBlob;
}

module.exports = { processTile, registry, MAGIC_KEYS, DBG };