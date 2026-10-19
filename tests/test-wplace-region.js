const assert = require('assert');
const wplace = require('../src/core/wplace.js');

const tests = [];
let passed = 0;
function test(name, fn) { tests.push([name, fn]); }

function makeTile(rgb, alpha) {
    const data = new Uint8ClampedArray(1000 * 1000 * 4);
    for (let i = 0; i < 1000 * 1000; i++) {
        data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1];
        data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = alpha === undefined ? 255 : alpha;
    }
    return { width: 1000, height: 1000, data };
}

function px(region, x, y) {
    const i = (y * region.width + x) * 4;
    return [region.data[i], region.data[i + 1], region.data[i + 2], region.data[i + 3]];
}

console.log('test-wplace-region:');

test('stitches across a vertical tile seam', async () => {
    wplace.seedTileCache(0, 0, makeTile([255, 0, 0]));
    wplace.seedTileCache(1, 0, makeTile([0, 0, 255]));
    const r = await wplace.readRegionRGBA(998, 0, 4, 2);
    assert.ok(r);
    assert.deepStrictEqual(px(r, 0, 0), [255, 0, 0, 255]);
    assert.deepStrictEqual(px(r, 1, 0), [255, 0, 0, 255]);
    assert.deepStrictEqual(px(r, 2, 0), [0, 0, 255, 255]);
    assert.deepStrictEqual(px(r, 3, 1), [0, 0, 255, 255]);
});

test('stitches across both axes at a corner', async () => {
    wplace.seedTileCache(0, 0, makeTile([255, 0, 0]));
    wplace.seedTileCache(1, 0, makeTile([0, 255, 0]));
    wplace.seedTileCache(0, 1, makeTile([0, 0, 255]));
    wplace.seedTileCache(1, 1, makeTile([255, 255, 0]));
    const r = await wplace.readRegionRGBA(999, 999, 2, 2);
    assert.ok(r);
    assert.deepStrictEqual(px(r, 0, 0), [255, 0, 0, 255]);
    assert.deepStrictEqual(px(r, 1, 0), [0, 255, 0, 255]);
    assert.deepStrictEqual(px(r, 0, 1), [0, 0, 255, 255]);
    assert.deepStrictEqual(px(r, 1, 1), [255, 255, 0, 255]);
});

test('unpainted tile inside region returns null', async () => {
    wplace.seedTileCache(0, 0, makeTile([255, 0, 0]));
    wplace.seedTileCache(1, 0, null);
    const r = await wplace.readRegionRGBA(998, 0, 4, 4);
    assert.strictEqual(r, null);
});

test('transparent pixels pass through as void', async () => {
    wplace.seedTileCache(0, 0, makeTile([128, 128, 128], 0));
    const r = await wplace.readRegionRGBA(0, 0, 2, 2);
    assert.ok(r);
    assert.deepStrictEqual(px(r, 0, 0), [128, 128, 128, 0]);
});

(async () => {
    for (const [name, fn] of tests) {
        try { await fn(); console.log('  ok - ' + name); passed++; }
        catch (e) {
            console.error('  FAIL - ' + name);
            console.error('    ' + e.message);
            process.exitCode = 1;
        }
    }
    console.log('test-wplace-region: ' + passed + ' tests passed');
})();