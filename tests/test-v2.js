// tests/test-v2.js
const assert = require('assert');
const { encodeV2, decodeV2, packHeaderV2, unpackHeaderV2, ALPHABET } = require('../src/core/protocol.js');

const MAX_PAYLOAD = 1023; // 10-bit length field, per protocol spec

let passed = 0;
function test(name, fn) {
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

console.log('test-v2:');

test('roundtrip Lite locked', () => {
    const text = 'hello world';
    const enc = encodeV2(text, 0, 0);
    assert(enc, 'encode returned null');
    const dec = decodeV2(enc.fullSequence);
    assert(dec, 'decode returned null');
    assert.strictEqual(dec.text, text);
    assert.strictEqual(dec.mode, 0);
    assert.strictEqual(dec.free, 0);
    assert(dec.valid, 'CRC should match');
});

test('roundtrip Lite free', () => {
    const text = 'hello world';
    const enc = encodeV2(text, 0, 1);
    assert(enc, 'encode returned null');
    const dec = decodeV2(enc.fullSequence);
    assert(dec, 'decode returned null');
    assert.strictEqual(dec.text, text);
    assert.strictEqual(dec.free, 1);
    assert(dec.valid, 'CRC should match');
});

test('roundtrip Full locked', () => {
    const text = 'Hello 🌍';
    const enc = encodeV2(text, 1, 0);
    assert(enc, 'encode returned null');
    const dec = decodeV2(enc.fullSequence);
    assert(dec, 'decode returned null');
    assert.strictEqual(dec.text, text);
    assert.strictEqual(dec.mode, 1);
    assert.strictEqual(dec.free, 0);
    assert(dec.valid, 'CRC should match');
});

test('roundtrip Full free', () => {
    const text = 'Hello 🌍';
    const enc = encodeV2(text, 1, 1);
    assert(enc, 'encode returned null');
    const dec = decodeV2(enc.fullSequence);
    assert(dec, 'decode returned null');
    assert.strictEqual(dec.text, text);
    assert.strictEqual(dec.free, 1);
    assert(dec.valid, 'CRC should match');
});

test('sync pattern is correct', () => {
    const enc = encodeV2('test', 0, 0);
    const SYNCID = [26, 27, 24, 21];
    for (let i = 0; i < 4; i++) {
        assert.strictEqual(enc.fullSequence[i], SYNCID[i], 'sync pixel ' + i + ' mismatch');
    }
});

test('header uses only free colors', () => {
    const enc = encodeV2('test', 0, 0);
    for (let i = 4; i < 8; i++) {
        assert(enc.fullSequence[i] <= 31,
            'header pixel ' + i + ' should be a free color id (0..31), got ' + enc.fullSequence[i]);
    }
});

test('max payload length', () => {
    const text = 'a'.repeat(MAX_PAYLOAD);
    const enc = encodeV2(text, 0, 0);
    assert(enc, 'should encode max length');
    assert.strictEqual(enc.length, MAX_PAYLOAD);
});

test('overflow returns null', () => {
    const text = 'a'.repeat(MAX_PAYLOAD + 1);
    const enc = encodeV2(text, 0, 0);
    assert.strictEqual(enc, null, 'should reject overflow');
});

test('Lite locked rejects non-alphabet', () => {
    const enc = encodeV2('hello™', 0, 0);
    assert.strictEqual(enc, null, 'should reject non-alphabet in Lite locked');
});

test('Lite free accepts full alphabet', () => {
    const text = ALPHABET;
    const enc = encodeV2(text, 0, 1);
    assert(enc, 'should encode full alphabet in Lite free');
});

test('header pack/unpack roundtrip', () => {
    const packed = packHeaderV2(1, 1, 500);
    const h = unpackHeaderV2(packed[0], packed[1], packed[2], packed[3]);
    assert.strictEqual(h.mode, 1);
    assert.strictEqual(h.free, 1);
    assert.strictEqual(h.length, 500);
});

test('checksum detects corruption', () => {
    const text = 'test';
    const enc = encodeV2(text, 0, 0);
    const corrupted = enc.fullSequence.slice();
    corrupted[10] = (corrupted[10] + 1) % 64;
    const dec = decodeV2(corrupted);
    assert(dec, 'decode should return result');
    assert(!dec.valid, 'CRC should fail');
});

test('decode handles truncation', () => {
    const text = 'hello';
    const enc = encodeV2(text, 0, 0);
    const truncated = enc.fullSequence.slice(0, 10);
    const dec = decodeV2(truncated);
    assert(dec, 'decode should return result');
    assert(dec.truncated, 'should flag truncation');
});

test('windowed sync search finds offset sync', () => {
    const { findSyncOffset } = require('../src/core/protocol.js');
    const SYNCID = [26, 27, 24, 21];
    const window = [5, 10, 15].concat(SYNCID).concat([20, 25]);
    const off = findSyncOffset(window);
    assert.strictEqual(off, 3, 'should find sync at offset 3');
});

console.log('test-v2: ' + passed + ' tests passed');