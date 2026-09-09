// tests/test-v2.js
// Node-side roundtrip, wire-shape and corruption tests for the V2 codec.
const assert = require('assert');
const { ALPHABET } = require('../src/core/alphabet.js');
const {
    encodeV2, decodeV2, packBits, unpackBits,
    charToIdLite, idToCharLite, findSyncOffset,
    SYNC, PREFIX_LEN, MAX_PAYLOAD
} = require('../src/core/v2.js');

let passed = 0;
function ok(name, fn) {
    fn();
    passed++;
    console.log('  ok - ' + name);
}

console.log('test-v2:');

ok('space maps to Transparent (0) and the bijection covers the alphabet', () => {
    assert.strictEqual(charToIdLite(' '), 0);
    assert.strictEqual(idToCharLite(0), ' ');
    const seen = new Set();
    for (const ch of ALPHABET) {
        const id = charToIdLite(ch);
        assert(id >= 0 && id <= 63, 'id out of range');
        assert(!seen.has(id), 'duplicate id');
        seen.add(id);
        assert.strictEqual(idToCharLite(id), ch);
    }
    assert.strictEqual(seen.size, ALPHABET.length);
    // ids not covered by the alphabet decode as corruption markers
    for (let id = 0; id <= 63; id++) {
        if (!seen.has(id)) assert.strictEqual(idToCharLite(id), '?');
    }
});

const cases = [
    ['lite locked',        0, 0, 'hello world 123'],
    ['lite free',          0, 1, 'hello world 123'],
    ['full locked',        1, 0, 'Unicode: Привет, мир! ✓'],
    ['full free',          1, 1, 'Unicode: Привет, мир! ✓'],
    ['lite free odd len',  0, 1, 'abc'],
    ['full free one byte', 1, 1, 'x'],
    ['empty lite locked',  0, 0, ''],
    ['empty full free',    1, 1, '']
];
for (const [name, mode, free, text] of cases) {
    ok('roundtrip ' + name, () => {
        const enc = encodeV2(text, mode, free);
        assert(enc, 'encode returned null');
        const dec = decodeV2(enc.fullSequence);
        assert(dec, 'decode returned null');
        assert.strictEqual(dec.text, text);
        assert.strictEqual(dec.valid, true);
        assert.strictEqual(dec.mode, mode);
        assert.strictEqual(dec.free, free);
        assert.strictEqual(dec.badPadding, false);
    });
}

ok('wire shape: sync exact, header and free payload within 0..31', () => {
    const enc = encodeV2('shape test', 0, 1);
    for (let i = 0; i < SYNC.length; i++) assert.strictEqual(enc.fullSequence[i], SYNC[i]);
    for (let i = 0; i < 4; i++) assert(enc.header[i] <= 31, 'header pixel not free');
    for (const p of enc.payload) assert(p <= 31, 'free payload pixel > 31');
    assert.strictEqual(enc.fullSequence.length, PREFIX_LEN + enc.length);
});

ok('wire shape: locked payload within 0..63', () => {
    const enc = encodeV2('shape test', 0, 0);
    for (const p of enc.payload) assert(p <= 63);
});

ok('single pixel corruption: crc fails, text still returned', () => {
    const enc = encodeV2('corruption check message', 1, 1);
    const seq = enc.fullSequence.slice();
    const idx = PREFIX_LEN + 2;
    seq[idx] = (seq[idx] + 7) % 32;
    const dec = decodeV2(seq);
    assert.strictEqual(dec.valid, false);
    assert(dec.text !== null);
});

ok('truncated sequence flagged', () => {
    const enc = encodeV2('truncation test', 0, 1);
    const seq = enc.fullSequence.slice(0, PREFIX_LEN + 2);
    const dec = decodeV2(seq);
    assert.strictEqual(dec.truncated, true);
    assert.strictEqual(dec.valid, false);
});

ok('non-zero tail padding flagged', () => {
    const enc = encodeV2('abc', 0, 1); // 18 bits -> 4 px, 2 pad bits
    const seq = enc.fullSequence.slice();
    seq[seq.length - 1] |= 0x03;
    const dec = decodeV2(seq);
    assert.strictEqual(dec.badPadding, true);
});

ok('wrong sync rejected', () => {
    const enc = encodeV2('sync test', 0, 0);
    const seq = enc.fullSequence.slice();
    seq[0] = 5;
    const dec = decodeV2(seq);
    assert.strictEqual(dec.syncValid, false);
    assert.strictEqual(dec.valid, false);
});

ok('overlong payload rejected at encode', () => {
    const text = 'a'.repeat(MAX_PAYLOAD + 1); // lite locked: 1 px per char
    assert.strictEqual(encodeV2(text, 0, 0), null);
});

ok('packBits/unpackBits symmetry', () => {
    const vals = [0, 63, 36, 1, 62];
    const px = packBits(vals, 6, 5);
    const r = unpackBits(px, 5, 6);
    assert.deepStrictEqual(r.values, vals);
    assert.strictEqual(r.padBits, 0);
});

ok('findSyncOffset locates pattern inside a window', () => {
    const win = [9, 9, 9].concat(SYNC, [9, 9]);
    assert.strictEqual(findSyncOffset(win), 3);
    assert.strictEqual(findSyncOffset([9, 9, 9, 9]), -1);
});

console.log('test-v2: ' + passed + ' test groups passed');