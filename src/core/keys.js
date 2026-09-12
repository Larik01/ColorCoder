// src/core/keys.js
// Magic marker color space, finalized by framebuffer measurements
// (tests/dumps + tests/analyze-keys.js): marker bytes roundtrip EXACT
// (zero deviation pixels in every dump), the desert (b=255, g<=50) held
// zero intruders, and no palette color or blend of palette colors can
// enter it (convexity). Therefore tolerance 0, exact match, no spacing:
// every (r, g) slot in the desert is a free key.
// 13,056 keys: idx = g*256 + r, color = (r, g, 255).
// Pure, Node-safe.

const G_MAX = 50;
const COUNT = 256 * (G_MAX + 1); // 13056

function keyColor(idx) {
    return [idx & 255, idx >> 8, 255];
}

// Exact-match table over the desert: index (g<<8)|r -> key idx or -1.
// Built per scan from the live registry, so only assigned colors can match.
function buildTable(entries) {
    const table = new Int16Array(16384).fill(-1);
    for (const e of entries) {
        table[(e.color[1] << 8) | e.color[0]] = e.keyIndex;
    }
    return table;
}

function keyIndexOfTable(table, r, g, b) {
    if (b !== 255) return -1; // exact: measurements proved zero drift
    if (g > 63) return -1;    // desert ceiling plus table guard
    return table[(g << 8) | r];
}

// FIFO registry over key indices; exhaustion evicts oldest with callback.
function makeRegistry(count, onEvict) {
    const map = new Map();
    const order = [];
    return {
        size: function () { return map.size; },
        values: function () { return map.values(); },
        findByIndex: function (idx) { return map.get(idx); },
        assign: function (gx, gy, payload) {
            let idx;
            if (order.length >= count) {
                idx = order.shift();
                map.delete(idx);
                if (onEvict) onEvict(idx);
            } else {
                idx = 0;
                while (map.has(idx)) idx++;
            }
            order.push(idx);
            const entry = Object.assign({
                color: keyColor(idx), keyIndex: idx,
                rect: { x: gx, y: gy - 1, w: 2, h: 2 }, gx: gx, gy: gy
            }, payload);
            map.set(idx, entry);
            return entry;
        },
        dump: function () { return Array.from(map.values()); }
    };
}

module.exports = { G_MAX, COUNT, keyColor, buildTable, keyIndexOfTable, makeRegistry };