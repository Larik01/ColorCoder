// src/core/scan.js
// Message discovery, in three sections:
//   1. sync search over raw tile pixels + cross-tile seam math
//   2. magic color key space and O(1) framebuffer matcher
//   3. marker geometry and the FIFO registry
// Pure, Node-safe: plain RGBA byte arrays and plain objects only.

const { SYNC } = require('./protocol.js');

// ========== 1. SYNC SEARCH ==========

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

// ========== 2. MAGIC COLOR KEY SPACE ==========
// Framebuffer matching accepts +-TOL per channel, so keys must differ by
// more than 2*TOL in some channel; STEP = 2*TOL+2 guarantees that on the grid.
// The 8x8x8 grid rejects any point within TOL of a palette color in ALL
// three channels, so no painted message pixel can ever read as a key.

const TOL = 16;
const STEP = 2 * TOL + 2; // 34

function buildKeys(palette) {
    const grid = new Array(512);
    const valid = [];
    let bi = 0;
    for (let b = 255; b >= 255 - 7 * STEP; b -= STEP) {
        let gi = 0;
        for (let g = 0; g <= 7 * STEP; g += STEP) {
            let ri = 0;
            for (let r = 1; r <= 1 + 7 * STEP; r += STEP) {
                let bad = false;
                for (const c of palette) {
                    if (Math.abs(r - c.rgb[0]) <= TOL &&
                        Math.abs(g - c.rgb[1]) <= TOL &&
                        Math.abs(b - c.rgb[2]) <= TOL) { bad = true; break; }
                }
                if (!bad) {
                    const idx = (bi * 8 + gi) * 8 + ri;
                    grid[idx] = [r, g, b];
                    valid.push(idx);
                }
                ri++;
            }
            gi++;
        }
        bi++;
    }
    return { grid: grid, valid: valid, tol: TOL, step: STEP };
}

function keyIndexOf(space, r, g, b) {
    const step = space.step, tol = space.tol, grid = space.grid;
    const bi = Math.round((255 - b) / step);
    if (bi < 0 || bi > 7 || Math.abs(b - (255 - step * bi)) > tol) return -1;
    const gi = Math.round(g / step);
    if (gi < 0 || gi > 7 || Math.abs(g - step * gi) > tol) return -1;
    const ri = Math.round((r - 1) / step);
    if (ri < 0 || ri > 7 || Math.abs(r - (1 + step * ri)) > tol) return -1;
    const idx = (bi * 8 + gi) * 8 + ri;
    return grid[idx] ? idx : -1;
}

// ========== 3. MARKER GEOMETRY + REGISTRY ==========
// 2x2 block above the sync start. No special cases: clipping handles
// canvas edges, tile edges and seam straddles uniformly.

const MARKER_W = 2;
const MARKER_H = 2;

function markerRect(gx, gy) {
    return { x: gx, y: gy - 1, w: MARKER_W, h: MARKER_H };
}

// Intersection of every registry marker with one tile, in tile-local coords.
function markerClips(registry, tileX, tileY, tileSize) {
    const clips = [];
    for (const m of registry.values()) {
        const lx = m.rect.x - tileX * tileSize;
        const ly = m.rect.y - tileY * tileSize;
        const x0 = Math.max(0, lx), y0 = Math.max(0, ly);
        const x1 = Math.min(tileSize, lx + m.rect.w);
        const y1 = Math.min(tileSize, ly + m.rect.h);
        if (x0 < x1 && y0 < y1) clips.push([m.color, x0, y0, x1 - x0, y1 - y0]);
    }
    return clips;
}

// FIFO registry. Exhaustion evicts the oldest marker with an explicit
// callback; never silent overwrite, which is what once made squares vanish.
function makeRegistry(space, onEvict) {
    const map = new Map();   // "r,g,b" -> entry
    const order = [];        // FIFO of color strings
    let next = 0;
    return {
        size: function () { return map.size; },
        values: function () { return map.values(); },
        get: function (colorStr) { return map.get(colorStr); },
        findByIndex: function (idx) {
            const c = space.grid[idx];
            return c ? map.get(c.join(',')) : undefined;
        },
        assign: function (gx, gy, payload) {
            if (order.length >= space.valid.length) {
                const evict = order.shift();
                const old = map.get(evict);
                map.delete(evict);
                if (onEvict) onEvict(evict, old);
            }
            const color = space.grid[space.valid[next % space.valid.length]];
            next++;
            const colorStr = color.join(',');
            order.push(colorStr);
            const entry = Object.assign(
                { color: color, colorStr: colorStr, rect: markerRect(gx, gy), gx: gx, gy: gy },
                payload
            );
            map.set(colorStr, entry);
            return entry;
        },
        dump: function () { return Array.from(map.values()); }
    };
}

module.exports = {
    SYNC, syncRGB, scanSync, syncIndexAt, extractEdges, seamCheck, edgeSuspicious,
    TOL, STEP, buildKeys, keyIndexOf,
    MARKER_W, MARKER_H, markerRect, markerClips, makeRegistry
};