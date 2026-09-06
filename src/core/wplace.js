// src/core/wplace.js
// Browser-side Wplace canvas reader. NO Node dependencies.
// Downloads tile PNGs via GM_xmlhttpRequest (CORS-proof), decodes them to
// raw RGBA once, caches them, and reads pixels / horizontal sequences.
// Automatically crosses tile boundaries (pixel 999 -> next tile pixel 0).

const { matchColor } = require('./palette.js');

const TILE_SIZE = 1000;
const TILE_BASE_URL = 'https://backend.wplace.live/files/s0/tiles';

// In-memory cache: "tileX,tileY" -> ImageData (or null for unpainted/404 tiles)
const tileCache = new Map();

// One reusable scratch canvas for decoding tile PNGs
const scratch = document.createElement('canvas');
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });

function tileUrl(tileX, tileY) {
    return TILE_BASE_URL + '/' + tileX + '/' + tileY + '.png';
}

// GM_xmlhttpRequest wrapped in a Promise. Resolves null on 404 (unpainted tile).
function gmFetchBlob(url) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            responseType: 'blob',
            onload: (res) => {
                if (res.status === 404) return resolve(null);
                if (res.status !== 200) return reject(new Error('HTTP ' + res.status + ' for ' + url));
                resolve(res.response);
            },
            onerror: () => reject(new Error('Network error fetching ' + url))
        });
    });
}

// Fetch + decode + cache the raw ImageData of a tile
async function getTileImageData(tileX, tileY) {
    const key = tileX + ',' + tileY;
    if (tileCache.has(key)) return tileCache.get(key);

    const blob = await gmFetchBlob(tileUrl(tileX, tileY));
    if (blob === null) {
        tileCache.set(key, null);
        return null;
    }

    const bitmap = await createImageBitmap(blob);
    scratch.width = bitmap.width;
    scratch.height = bitmap.height;
    scratchCtx.drawImage(bitmap, 0, 0);
    const imageData = scratchCtx.getImageData(0, 0, bitmap.width, bitmap.height);
    if (bitmap.close) bitmap.close();

    tileCache.set(key, imageData);
    return imageData;
}

// Read a single pixel -> palette entry { id, name, rgb }
async function readPixel(tileX, tileY, px, py) {
    const imageData = await getTileImageData(tileX, tileY);
    if (!imageData) return matchColor(0, 0, 0, 0); // unpainted tile = Transparent

    const i = (py * imageData.width + px) * 4;
    return matchColor(
        imageData.data[i],
        imageData.data[i + 1],
        imageData.data[i + 2],
        imageData.data[i + 3]
    );
}

// Read `length` pixels left-to-right, crossing tile boundaries.
// Returns an array of color IDs (exactly what decodeV1 expects).
async function readSequenceHorizontal(startTileX, startTileY, startPx, startPy, length) {
    const ids = [];
    let curTileX = startTileX;
    let curPx = startPx;

    for (let i = 0; i < length; i++) {
        const color = await readPixel(curTileX, startTileY, curPx, startPy);
        ids.push(color.id);

        curPx++;
        if (curPx >= TILE_SIZE) {
            curPx = 0;
            curTileX++;
        }
    }
    return ids;
}

module.exports = {
    TILE_SIZE,
    tileUrl,
    getTileImageData,
    readPixel,
    readSequenceHorizontal
};