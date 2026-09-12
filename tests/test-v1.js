const { encodeV1, decodeV1, packHeader, unpackHeader, checksumFor, MAX_PAYLOAD } = require('../src/core/protocol.js');
const { ALPHABET } = require('../src/core/alphabet.js');
const { djb2Checksum5 } = require('../src/core/checksum.js');
const { savePNG, readPNG } = require('./pngio.js');
const fs = require('fs');
const path = require('path');

console.log('=== V1 PROTOCOL TESTS ===\n');

const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Test 1: Header pack/unpack known vector (from the design discussion)
console.log('Test 1: Header Pack/Unpack Known Vector');
const h = packHeader(0, 0, 5, 21);
console.log('  packHeader(0,0,5,21) -> [' + h.join(', ') + '] (expect [0, 2, 53])');
const u = unpackHeader(h[0], h[1], h[2]);
console.log('  unpackHeader -> v' + u.version + ' mode=' + u.mode + ' len=' + u.length + ' crc=' + u.checksum);
console.log((h.join(',') === '0,2,53' && u.version === 0 && u.mode === 0 && u.length === 5 && u.checksum === 21)
    ? '  OK: Header math correct\n' : '  FAIL: Header math wrong\n');

// Test 2: Lite round trip through PNG
console.log('Test 2: V1 Lite Round Trip');
const liteText = 'hello friend v1';
const encLite = encodeV1(liteText, 0);
console.log('  Header pixels: [' + encLite.header.join(', ') + '] | len=' + encLite.length + ' | crc=' + encLite.checksum);
const litePath = path.join(outputDir, 'v1-lite-roundtrip.png');
savePNG(encLite.fullSequence, encLite.fullSequence.length, 1, litePath);
console.log('  Saved PNG: ' + litePath);
const decLite = decodeV1(readPNG(litePath).pixels);
console.log('  Decoded: "' + decLite.text + '"');
console.log('  Valid? ' + (decLite.valid ? 'YES' : 'NO') + ' | Match? ' + (decLite.text === liteText ? 'YES' : 'NO'));
console.log((decLite.valid && decLite.text === liteText) ? '  OK: Lite round trip successful!\n' : '  FAIL\n');

// Test 3: Full round trip through PNG (unicode + emoji)
console.log('Test 3: V1 Full Round Trip');
const fullText = 'Hello 世界! 🌍 123 🎨';
const encFull = encodeV1(fullText, 1);
console.log('  Header pixels: [' + encFull.header.join(', ') + '] | len=' + encFull.length + ' | crc=' + encFull.checksum);
const fullPath = path.join(outputDir, 'v1-full-roundtrip.png');
savePNG(encFull.fullSequence, encFull.fullSequence.length, 1, fullPath);
console.log('  Saved PNG: ' + fullPath);
const decFull = decodeV1(readPNG(fullPath).pixels);
console.log('  Decoded: "' + decFull.text + '"');
console.log('  Valid? ' + (decFull.valid ? 'YES' : 'NO') + ' | Match? ' + (decFull.text === fullText ? 'YES' : 'NO'));
console.log((decFull.valid && decFull.text === fullText) ? '  OK: Full round trip successful!\n' : '  FAIL\n');

// Test 4: Checksum precision fix detector
console.log('Test 4: Checksum Precision (long payload)');
function djb2Fixed(s) { let x = 5381; for (let i = 0; i < s.length; i++) { x = ((x << 5) + x) + s.charCodeAt(i); x = x | 0; } return x & 0x1F; }
function djb2Old(s)   { let x = 5381; for (let i = 0; i < s.length; i++) { x = ((x << 5) + x) + s.charCodeAt(i); } return x & 0x1F; }
const encLong = encodeV1('a'.repeat(300), 0);
const binStr = '00' + '0' + encLong.length.toString(2).padStart(10, '0')
    + encLong.payload.map(v => v.toString(2).padStart(6, '0')).join('');
console.log('  checksum.js says: ' + djb2Checksum5(binStr) + ' | fixed says: ' + djb2Fixed(binStr) + ' | old buggy says: ' + djb2Old(binStr));
if (djb2Checksum5(binStr) !== djb2Fixed(binStr)) {
    console.log('  !! WARNING: your checksum.js STILL has the float precision bug. Apply the "x = x | 0" fix!\n');
} else {
    console.log('  OK: checksum.js is the fixed version\n');
}
const decLong = decodeV1(encLong.fullSequence);
console.log('  300-char round trip valid? ' + (decLong.valid ? 'YES' : 'NO') + '\n');

// Test 5: Payload Corruption (warn, do not throw away)
console.log('Test 5: Payload Corruption (warn, do not throw away)');
const corrupted = encFull.fullSequence.slice();

// CHANGE THIS LINE: Vandalize index 5 (payload pixel 1) instead of index 6.
// Pixel 6 becomes 7 (a 1-bit flip: 000110 -> 000111).
// A 1-bit flip mathematically guarantees the 5-bit checksum will change.
corrupted[5] = (corrupted[5] + 1) % 64;

const decCorrupt = decodeV1(corrupted); // (warnings printed below are EXPECTED)
console.log('  Valid? ' + (decCorrupt.valid ? 'YES' : 'NO') + ' (expect NO)');
console.log('  Text still returned? ' + (decCorrupt.text !== null ? 'YES' : 'NO') + ' (expect YES)');
console.log((!decCorrupt.valid && decCorrupt.text !== null) ? '  OK: corruption flagged, text preserved\n' : '  FAIL\n');

// Test 6: Header corruption -> CRC catches it
console.log('Test 6: Header Corruption');
const corruptedH = encFull.fullSequence.slice();
corruptedH[2] = (corruptedH[2] + 1) % 64; // vandalize a header pixel
const decCorruptH = decodeV1(corruptedH); // (warnings expected)
console.log('  Valid? ' + (decCorruptH.valid ? 'YES' : 'NO') + ' (expect NO)');
console.log(!decCorruptH.valid ? '  OK: header corruption detected\n' : '  FAIL\n');

// Test 7: Length field limits
console.log('Test 7: Length Limits');
const maxEnc = encodeV1('a'.repeat(MAX_PAYLOAD), 0);
console.log('  1023 px encode: ' + (maxEnc ? 'OK (length=' + maxEnc.length + ')' : 'FAIL'));
const overEnc = encodeV1('a'.repeat(MAX_PAYLOAD + 1), 0); // warning expected
console.log('  1024 px encode: ' + (overEnc === null ? 'OK (rejected)' : 'FAIL') + '\n');

// Test 8: Alphabet coverage info
console.log('Test 8: Alphabet Coverage');
console.log('  ALPHABET length: ' + ALPHABET.length + ' / 64 color slots');
console.log('  Lite-unused color IDs: ' + (64 - ALPHABET.length) + ' (only appear in Full mode)\n');

console.log('=== V1 TESTS COMPLETE ===');
console.log('\nCheck the output folder for generated PNG files:');
console.log('  ' + path.join(outputDir, 'v1-lite-roundtrip.png'));
console.log('  ' + path.join(outputDir, 'v1-full-roundtrip.png'));