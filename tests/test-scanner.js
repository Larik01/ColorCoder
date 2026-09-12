// tests/test-scanner.js
const assert = require('assert');
const { COLOR_PALETTE } = require('../src/core/palette.js');
const { syncRGB, scanSync, extractEdges, seamCheck, edgeSuspicious } = require('../src/core/scanner.js');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

console.log('test-scanner:');

const W = 1000, H = 1000;
const RGB = syncRGB(COLOR_PALETTE);

function blank() { return new Uint8Array(W * H * 4); } // alpha 0 everywhere
function plant(d, x, y, k) {
    const i = (y * W + x) * 4;
    d[i] = RGB[k][0]; d[i + 1] = RGB[k][1]; d[i + 2] = RGB[k][2]; d[i + 3] = 255;
}
function plantSync(d, x, y) { for (let k = 0; k < 4; k++) plant(d, x + k, y, k); }

ok('finds a sync fully inside a tile', () => {
    const d = blank();
    plantSync(d, 500, 500);
    const hits = scanSync(d, W, H, RGB);
    assert.deepStrictEqual(hits, [500, 500]);
});

ok('finds a sync at the maximum in-tile offset', () => {
    const d = blank();
    plantSync(d, 996, 7);
    const hits = scanSync(d, W, H, RGB);
    assert.deepStrictEqual(hits, [996, 7]);
});

ok('no false positives on solid palette fills', () => {
    for (const id of [1, 5, 21, 26, 27, 24]) {
        const d = blank();
        const c = COLOR_PALETTE[id].rgb;
        for (let i = 0; i < d.length; i += 4) {
            d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
        assert.deepStrictEqual(scanSync(d, W, H, RGB), []);
    }
});

function seamCase(startPx) {
    const a = blank(), b = blank();
    for (let k = 0; k < 4; k++) {
        const px = startPx + k;
        if (px < 1000) plant(a, px, 300, k);
        else plant(b, px - 1000, 300, k);
    }
    return { a, b };
}

for (const start of [997, 998, 999]) {
    ok('seam detection for sync starting at ' + start, () => {
        const { a, b } = seamCase(start);
        const ea = extractEdges(a, W, H, RGB);
        const eb = extractEdges(b, W, H, RGB);
        assert(edgeSuspicious(ea.right, H));
        assert(edgeSuspicious(eb.left, H));
        const hits = seamCheck(ea.right, eb.left, H, W);
        assert.deepStrictEqual(hits, [start, 300]);
    });
}

ok('clean edges are not suspicious', () => {
    const d = blank();
    plantSync(d, 500, 500);
    const e = extractEdges(d, W, H, RGB);
    assert(!edgeSuspicious(e.left, H));
    assert(!edgeSuspicious(e.right, H));
});

console.log('test-scanner: ' + passed + ' test groups passed');