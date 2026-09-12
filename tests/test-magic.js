// tests/test-magic.js
const assert = require('assert');
const { COLOR_PALETTE } = require('../src/core/palette.js');
const { buildKeys, keyIndexOf, markerClips, makeRegistry, TOL } = require('../src/core/magic.js');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

console.log('test-magic:');

const space = buildKeys(COLOR_PALETTE);

ok('key space is large', () => {
    assert(space.valid.length > 400, 'expected >400 keys, got ' + space.valid.length);
});

ok('any two keys differ by more than 2*TOL in some channel', () => {
    for (let a = 0; a < space.valid.length; a++) {
        for (let b = a + 1; b < space.valid.length; b++) {
            const ka = space.grid[space.valid[a]], kb = space.grid[space.valid[b]];
            const sep = Math.abs(ka[0] - kb[0]) > 2 * TOL ||
                        Math.abs(ka[1] - kb[1]) > 2 * TOL ||
                        Math.abs(ka[2] - kb[2]) > 2 * TOL;
            assert(sep, 'keys too close: ' + ka + ' vs ' + kb);
        }
    }
});

ok('no key is within TOL of any palette color in all channels', () => {
    for (const idx of space.valid) {
        const k = space.grid[idx];
        for (const c of COLOR_PALETTE) {
            const near = Math.abs(k[0] - c.rgb[0]) <= TOL &&
                         Math.abs(k[1] - c.rgb[1]) <= TOL &&
                         Math.abs(k[2] - c.rgb[2]) <= TOL;
            assert(!near, 'key ' + k + ' collides with palette ' + c.id);
        }
    }
});

ok('keyIndexOf roundtrips every key, accepts +-TOL, rejects TOL+1', () => {
    for (const idx of space.valid) {
        const k = space.grid[idx];
        assert.strictEqual(keyIndexOf(space, k[0], k[1], k[2]), idx);
        assert.strictEqual(keyIndexOf(space, k[0] + TOL, k[1] + TOL, k[2] - TOL), idx);
        assert.strictEqual(keyIndexOf(space, k[0] + TOL + 1, k[1], k[2]), -1);
        assert.strictEqual(keyIndexOf(space, k[0], k[1] - (TOL + 1), k[2]), -1);
    }
});

ok('marker clips split correctly across a tile seam', () => {
    const mini = { grid: [[1, 0, 255], [35, 0, 255]], valid: [0, 1], tol: TOL, step: 34 };
    const reg = makeRegistry(mini);
    reg.assign(999, 500, { text: 'seam' });
    const a = markerClips(reg, 0, 0, 1000);
    const b = markerClips(reg, 1, 0, 1000);
    assert.strictEqual(a.length, 1);
    assert.strictEqual(b.length, 1);
    assert.strictEqual(a[0][3], 1); // one column in tile 0
    assert.strictEqual(b[0][3], 1); // one column in tile 1
    assert.strictEqual(a[0][4], 2); // two rows
});

ok('registry evicts FIFO on exhaustion and recycles the color', () => {
    const mini = { grid: [[1, 0, 255], [35, 0, 255]], valid: [0, 1], tol: TOL, step: 34 };
    const evicted = [];
    const reg = makeRegistry(mini, (colorStr) => evicted.push(colorStr));
    const e1 = reg.assign(10, 10, { text: 'one' });
    const e2 = reg.assign(20, 20, { text: 'two' });
    assert.strictEqual(reg.size(), 2);

    const e3 = reg.assign(30, 30, { text: 'three' });
    assert.strictEqual(reg.size(), 2);
    assert.strictEqual(evicted.length, 1);
    assert.strictEqual(evicted[0], e1.colorStr);

    // The evicted ENTRY is gone; its COLOR is immediately recycled by e3,
    // because a two-key ring has no free slot. What leaves the registry
    // is the old rect, which is what stops the old marker being repainted.
    assert.strictEqual(reg.get(e1.colorStr), e3);
    assert.strictEqual(reg.get(e2.colorStr), e2);

    const dump = reg.dump();
    assert.strictEqual(dump.length, 2);
    assert(!dump.some(m => m.text === 'one'), 'evicted entry still in dump');
    assert(dump.some(m => m.text === 'two'));
    assert(dump.some(m => m.text === 'three'));
    assert.strictEqual(dump.find(m => m.text === 'three').gx, 30);
});

console.log('test-magic: ' + passed + ' test groups passed, keyspace=' + space.valid.length);