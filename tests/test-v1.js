// tests/test-v1.js
const assert = require('assert');
const { encodeV1, decodeV1, unpackHeader, ALPHABET } = require('../src/core/protocol.js');

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

console.log('test-v1:');

test('roundtrip Lite', () => {
    const text = 'hello world 123';
    const enc = encodeV1(text, 0);
    assert(enc, 'encode returned null');
    const dec = decodeV1(enc.fullSequence);
    assert(dec, 'decode returned null');
    assert.strictEqual(dec.text, text);
    assert.strictEqual(dec.mode, 0);
    assert.strictEqual(dec.version, 0);
    assert(dec.valid, 'CRC should match');
});

test('roundtrip Full UTF-8', () => {
    const text = 'Hello 🌍 café';
    const enc = encodeV1(text, 1);
    assert(enc, 'encode returned null');
    const dec = decodeV1(enc.fullSequence);
    assert(dec, 'decode returned null');
    assert.strictEqual(dec.text, text);
    assert.strictEqual(dec.mode, 1);
    assert(dec.valid, 'CRC should match');
});

test('Lite alphabet coverage', () => {
    for (const ch of ALPHABET) {
        const enc = encodeV1(ch, 0);
        assert(enc, 'failed to encode: ' + ch);
    }
});

test('Lite rejects non-alphabet chars', () => {
    const enc = encodeV1('hello™world', 0);
    assert.strictEqual(enc, null, 'should reject non-alphabet chars');
});

test('max payload length', () => {
    const text = 'a'.repeat(MAX_PAYLOAD);
    const enc = encodeV1(text, 0);
    assert(enc, 'should encode max length');
    assert.strictEqual(enc.length, MAX_PAYLOAD);
});

test('overflow returns null', () => {
    const text = 'a'.repeat(MAX_PAYLOAD + 1);
    const enc = encodeV1(text, 0);
    assert.strictEqual(enc, null, 'should reject overflow');
});

test('header unpacks from encoded sequence', () => {
    const enc = encodeV1('hello', 1);
    assert(enc, 'encode returned null');
    const h = unpackHeader(enc.fullSequence[1], enc.fullSequence[2], enc.fullSequence[3]);
    assert.strictEqual(h.version, 0);
    assert.strictEqual(h.mode, 1);
    assert.strictEqual(h.length, enc.length);
});

test('checksum detects corruption', () => {
    const enc = encodeV1('test', 0);
    assert(enc, 'encode returned null');
    const corrupted = enc.fullSequence.slice();
    corrupted[5] = (corrupted[5] + 1) % 64; // flip one payload pixel (payload starts at 4)
    const dec = decodeV1(corrupted);
    assert(dec, 'decode should still return result');
    assert(!dec.valid, 'CRC should fail on corruption');
});

test('decode handles truncation', () => {
    const enc = encodeV1('hello', 0);
    assert(enc, 'encode returned null');
    const truncated = enc.fullSequence.slice(0, 6); // header says 5 px, only 2 present
    const dec = decodeV1(truncated);
    assert(dec, 'decode should return result');
    assert(dec.truncated, 'should flag truncation');
});

console.log('test-v1: ' + passed + ' tests passed');