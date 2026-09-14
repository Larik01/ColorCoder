// tests/test-keys.js
// Guards the 13,056-key exact-match desert space and the FIFO registry.
const assert = require('assert');
const { COLOR_PALETTE } = require('../src/core/palette.js');
const { COUNT, keyColor, buildTable, keyIndexOfTable, makeRegistry, G_MAX } = require('../src/core/keys.js');

let passed = 0;
function ok(name, fn) {
    try {
        fn();
        console.log('  ok - ' + name);
        passed++;
    } catch (e) {
        console.error('  FAIL - ' + name);
        console.error('    ' + e.message);
        process.exitCode = 1;
    }
}

console.log('test-keys:');

ok('space size is 256 x (G_MAX+1) = 13056', () => {
    assert.strictEqual(COUNT, 256 * (G_MAX + 1));
    assert.strictEqual(COUNT, 13056);
});

ok('every key lives in the desert and equals no palette color', () => {
    const pal = new Set(COLOR_PALETTE.map(c => c.rgb.join(',')));
    for (let idx = 0; idx < COUNT; idx++) {
        const c = keyColor(idx);
        assert.strictEqual(c[2], 255, 'key blue must be 255');
        assert(c[1] <= G_MAX, 'key green above desert ceiling');
        assert(!pal.has(c.join(',')), 'key equals palette color: ' + c);
    }
});

ok('exact table matches only assigned keys, rejects everything else', () => {
    const reg = makeRegistry(COUNT);
    const e1 = reg.assign(10, 10, { text: 'a' });
    const e2 = reg.assign(20, 20, { text: 'b' });
    const table = buildTable(reg.values());
    assert.strictEqual(keyIndexOfTable(table, e1.color[0], e1.color[1], 255), e1.keyIndex);
    assert.strictEqual(keyIndexOfTable(table, e2.color[0], e2.color[1], 255), e2.keyIndex);
    assert.strictEqual(keyIndexOfTable(table, e1.color[0] + 2, e1.color[1], 255), -1, 'neighbor r must not match');
    assert.strictEqual(keyIndexOfTable(table, e1.color[0], e1.color[1] + 1, 255), -1, 'neighbor g must not match');
    assert.strictEqual(keyIndexOfTable(table, e1.color[0], e1.color[1], 254), -1, 'blue off by one must not match');
    for (const c of COLOR_PALETTE) {
        assert.strictEqual(keyIndexOfTable(table, c.rgb[0], c.rgb[1], c.rgb[2]), -1,
            'palette color matched a key: ' + c.rgb);
    }
});

ok('registry FIFO eviction recycles the oldest index', () => {
    const evicted = [];
    const reg = makeRegistry(3, (idx) => evicted.push(idx));
    const a = reg.assign(1, 1, { text: 'one' });
    reg.assign(2, 2, { text: 'two' });
    reg.assign(3, 3, { text: 'three' });
    const d = reg.assign(4, 4, { text: 'four' });
    assert.strictEqual(evicted.length, 1, 'one eviction expected');
    assert.strictEqual(d.keyIndex, a.keyIndex, 'oldest index recycled');
    assert.strictEqual(reg.size(), 3);
    assert.strictEqual(reg.findByIndex(a.keyIndex).gx, 4, 'old entry replaced');
});

ok('registry assigns distinct indices and stores payloads', () => {
    const reg = makeRegistry(COUNT);
    const a = reg.assign(5, 5, { text: 'x' });
    const b = reg.assign(6, 6, { text: 'y' });
    assert.notStrictEqual(a.keyIndex, b.keyIndex);
    assert.strictEqual(reg.findByIndex(b.keyIndex).text, 'y');
    assert.strictEqual(a.color.join(','), reg.findByIndex(a.keyIndex).color.join(','));
    assert.deepStrictEqual(a.rect, { x: 5, y: 4, w: 2, h: 2 }, 'marker rect sits above the sync');
});

console.log('test-keys: ' + passed + ' test groups passed, keyspace=' + COUNT);