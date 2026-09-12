// src/core/magic.js
// Magic color key space, registry with FIFO eviction, marker geometry.
// Pure, Node-safe. Tolerance and step are the two safety constants:
// framebuffer matching accepts +-TOL per channel, so keys must differ by
// more than 2*TOL in some channel; STEP = 2*TOL+2 guarantees that on the grid.

const TOL = 16;
const STEP = 2 * TOL + 2; // 34

const MARKER_W = 2;
const MARKER_H = 2;

// 8x8x8 grid over R=1..239, G=0..238, B=255..17, rejecting any grid point
// within TOL of a palette color in ALL three channels.
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

// 2x2 block above the sync start. No special cases: clipping handles
// canvas edges, tile edges and seam straddles uniformly.
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
// callback; never silent overwrite, which is what made squares vanish.
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
    buildKeys, keyIndexOf, markerRect, markerClips, makeRegistry,
    TOL, STEP, MARKER_W, MARKER_H
};