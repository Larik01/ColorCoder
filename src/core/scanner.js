// src/core/scanner.js
// V2 sync search over raw tile pixels, plus cross-tile seam math.
// Pure, Node-safe: everything works on plain RGBA byte arrays.

const SYNC = [26, 27, 24, 21]; // Dark Pink, Pink, Purple, Indigo

function syncRGB(palette) {
    return SYNC.map(id => palette[id].rgb);
}

// In-tile scan: tight byte loop, early reject on the first channel.
// Returns flat [x, y, x, y, ...] of sync start positions.
function scanSync(d, W, H, rgb) {
    const hits = [];
    const c0 = rgb[0], c1 = rgb[1], c2 = rgb[2], c3 = rgb[3];
    for (let y = 0; y < H; y++) {
        const base = y * W * 4;
        for (let x = 0; x <= W - 4; x++) {
            const i = base + x * 4;
            if (d[i] === c0[0] && d[i + 1] === c0[1] && d[i + 2] === c0[2] && d[i + 3] === 255 &&
                d[i + 4] === c1[0] && d[i + 5] === c1[1] && d[i + 6] === c1[2] && d[i + 7] === 255 &&
                d[i + 8] === c2[0] && d[i + 9] === c2[1] && d[i + 10] === c2[2] && d[i + 11] === 255 &&
                d[i + 12] === c3[0] && d[i + 13] === c3[1] && d[i + 14] === c3[2] && d[i + 15] === 255) {
                hits.push(x, y);
            }
        }
    }
    return hits;
}

// Which sync color (0..3) is at byte offset i, or 255 for anything else.
function syncIndexAt(d, i, rgb) {
    if (d[i + 3] !== 255) return 255;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    for (let k = 0; k < 4; k++) {
        if (r === rgb[k][0] && g === rgb[k][1] && b === rgb[k][2]) return k;
    }
    return 255;
}

// First and last 3 columns as sync-index strips, for seam checks.
function extractEdges(d, W, H, rgb) {
    const left = new Uint8Array(H * 3);
    const right = new Uint8Array(H * 3);
    for (let y = 0; y < H; y++) {
        const base = y * W * 4;
        for (let j = 0; j < 3; j++) {
            left[y * 3 + j] = syncIndexAt(d, base + j * 4, rgb);
            right[y * 3 + j] = syncIndexAt(d, base + (W - 3 + j) * 4, rgb);
        }
    }
    return { left: left, right: right };
}

// Slide the 4-color sync across the 6-value seam window.
// rightA = right edge of tile X, leftB = left edge of tile X+1.
// Returned px values are tile-local to tile X: tileSize-3, -2, -1.
function seamCheck(rightA, leftB, H, tileSize) {
    const out = [];
    const p0 = tileSize - 3, p1 = tileSize - 2, p2 = tileSize - 1;
    for (let y = 0; y < H; y++) {
        const o = y * 3;
        const w0 = rightA[o], w1 = rightA[o + 1], w2 = rightA[o + 2];
        const w3 = leftB[o], w4 = leftB[o + 1], w5 = leftB[o + 2];
        if (w0 === 0 && w1 === 1 && w2 === 2 && w3 === 3) out.push(p0, y);
        else if (w1 === 0 && w2 === 1 && w3 === 2 && w4 === 3) out.push(p1, y);
        else if (w2 === 0 && w3 === 1 && w4 === 2 && w5 === 3) out.push(p2, y);
    }
    return out;
}

function edgeSuspicious(edge, H) {
    for (let i = 0; i < H * 3; i++) {
        if (edge[i] !== 255) return true;
    }
    return false;
}

module.exports = { SYNC, syncRGB, scanSync, syncIndexAt, extractEdges, seamCheck, edgeSuspicious };