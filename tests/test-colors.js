const { COLOR_PALETTE, getColor, getColorName, pixelsToRGB, savePNG, readPNG } = require('./pngio.js');
const { matchColor } = require('../src/core/palette.js');
const fs = require('fs');
const path = require('path');

console.log('=== COLOR TESTS ===\n');

const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Test 1: Palette size
console.log('Test 1: Palette');
console.log('  Total colors:', COLOR_PALETTE.length);
console.log(COLOR_PALETTE.length === 64 ? '  OK: 64 colors loaded\n' : '  FAIL: expected 64\n');

// Test 2: Lookup all ids
console.log('Test 2: Color Lookup');
let okLookup = true;
for (let i = 0; i < 64; i++) {
    const rgb = getColor(i);
    const name = getColorName(i);
    if (!Array.isArray(rgb) || rgb.length !== 3 || typeof name !== 'string' || !name) okLookup = false;
}
console.log('  spot check: 1 = ' + getColorName(1) + ', 63 = ' + getColorName(63));
console.log(okLookup ? '  OK: all 64 lookups work\n' : '  FAIL: bad lookup result\n');

// Test 3: Out of range throws
console.log('Test 3: Out Of Range');
try {
    getColor(64);
    console.log('  FAIL: should have thrown for index 64\n');
} catch (e) {
    console.log('  OK: correctly threw for index 64\n');
}

// Test 4: pixelsToRGB
console.log('Test 4: Pixels To RGB');
const rgbArray = pixelsToRGB([1, 5, 7, 63]);
const okRgb = rgbArray.length === 4 && rgbArray[0].join(',') === COLOR_PALETTE[1].rgb.join(',');
console.log('  [1,5,7,63] -> ' + rgbArray.map(r => '[' + r.join(',') + ']').join(' '));
console.log(okRgb ? '  OK: RGB conversion works\n' : '  FAIL\n');

// Test 5: matchColor (alpha / exact / nearest)
console.log('Test 5: Match Color');
const trans = matchColor(0, 0, 0, 0);
const black = matchColor(0, 0, 0, 255);
const near = matchColor(61, 61, 61, 255); // closest to Dark Gray (60,60,60)
console.log('  alpha=0 -> ' + trans.name + ' | (0,0,0,255) -> ' + black.name + ' | (61,61,61) -> ' + near.name);
console.log(trans.id === 0 && black.id === 1 && near.id === 2 ? '  OK: matching works\n' : '  FAIL\n');

// Test 6: PNG save/read round trip (skip id 0 = transparent, alpha handling is app-specific)
console.log('Test 6: PNG Save/Read Round Trip');
const pixels = [];
for (let i = 1; i <= 63; i++) pixels.push(i);
const pngPath = path.join(outputDir, 'color-roundtrip.png');
savePNG(pixels, 9, 7, pngPath);
const back = readPNG(pngPath).pixels;
const okPng = back.length === 63 && back.every((v, i) => v === pixels[i]);
console.log('  saved+read 9x7 grid: ' + (okPng ? 'identical' : 'MISMATCH'));
console.log(okPng ? '  OK: PNG round trip successful\n' : '  FAIL\n');

console.log('=== TESTS COMPLETE ===');