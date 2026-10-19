const assert = require('assert');
const qrcodegen = require('qrcode-generator');
const { decodeQRRegion, topTwoColors, snapToSymbol } = require('../src/core/qrdecode.js');

let passed = 0;
function test(name, fn) {
    try { fn(); console.log('  ok - ' + name); passed++; }
    catch (e) {
        console.error('  FAIL - ' + name);
        console.error('    ' + e.message);
        process.exitCode = 1;
    }
}

function makeMatrix(text, ec) {
    const qr = qrcodegen(0, ec || 'H');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const m = [];
    for (let y = 0; y < n; y++) {
        const row = [];
        for (let x = 0; x < n; x++) row.push(qr.isDark(y, x) ? 1 : 0);
        m.push(row);
    }
    return m;
}

function blankRGBA(W, H, fill) {
    const rgba = new Uint8ClampedArray(W * H * 4);
    if (fill) {
        for (let i = 0; i < W * H; i++) {
            rgba[i * 4] = fill[0]; rgba[i * 4 + 1] = fill[1];
            rgba[i * 4 + 2] = fill[2]; rgba[i * 4 + 3] = 255;
        }
    }
    return rgba;
}

// lightRGB null = transparent void modules
function paint(matrix, scale, rgba, W, H, ox, oy, darkRGB, lightRGB) {
    const n = matrix.length;
    for (let y = 0; y < n * scale; y++) {
        for (let x = 0; x < n * scale; x++) {
            const gy = oy + y, gx = ox + x;
            if (gy < 0 || gy >= H || gx < 0 || gx >= W) continue;
            const d = matrix[Math.floor(y / scale)][Math.floor(x / scale)];
            const c = d ? darkRGB : lightRGB;
            const o = (gy * W + gx) * 4;
            if (c === null) { rgba[o + 3] = 0; continue; }
            rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
        }
    }
}

function subRegion(rgba, W, rx, ry, rw, rh) {
    const out = new Uint8ClampedArray(rw * rh * 4);
    for (let y = 0; y < rh; y++) {
        const src = ((ry + y) * W + rx) * 4;
        out.set(rgba.subarray(src, src + rw * 4), y * rw * 4);
    }
    return out;
}

console.log('test-qrdecode:');

test('roundtrip scales 1..3 with click slop and foreign margin', () => {
    const text = 'qrdecode roundtrip';
    const m = makeMatrix(text);
    const n = m.length;
    for (const scale of [1, 2, 3]) {
        const sym = n * scale;
        const margin = 6;
        const W = sym + margin * 2 + 10, H = W;
        const rgba = blankRGBA(W, H, [120, 120, 120]);
        paint(m, scale, rgba, W, H, margin + 4, margin + 3, [10, 10, 10], [240, 240, 240]);
        const rx = 2, ry = 1, rw = sym + margin + 2, rh = sym + margin + 5;
        const res = decodeQRRegion(subRegion(rgba, W, rx, ry, rw, rh), rw, rh);
        assert.ok(res, 'scale ' + scale + ' should decode');
        assert.strictEqual(res.text, text);
        assert.strictEqual(res.bounds.w, sym);
        assert.strictEqual(res.bounds.h, sym);
    }
});

test('colored pair purple on pink', () => {
    const text = 'colors!';
    const m = makeMatrix(text);
    const scale = 2, sym = m.length * scale, pad = 4;
    const W = sym + pad * 2, H = W;
    const rgba = blankRGBA(W, H, [255, 255, 255]);
    paint(m, scale, rgba, W, H, pad, pad, [107, 50, 124], [255, 164, 208]);
    const res = decodeQRRegion(rgba, W, H);
    assert.ok(res);
    assert.strictEqual(res.text, text);
});

test('inverted pair decodes via flip', () => {
    const text = 'flip me';
    const m = makeMatrix(text);
    const scale = 2, sym = m.length * scale, pad = 4;
    const W = sym + pad * 2, H = W;
    const rgba = blankRGBA(W, H, [200, 200, 200]);
    paint(m, scale, rgba, W, H, pad, pad, [245, 245, 245], [30, 30, 30]);
    const res = decodeQRRegion(rgba, W, H);
    assert.ok(res);
    assert.strictEqual(res.text, text);
});

test('transparent light modules (void) decode', () => {
    const text = 'void light';
    const m = makeMatrix(text);
    const scale = 2, sym = m.length * scale, pad = 4;
    const W = sym + pad * 2, H = W;
    const rgba = blankRGBA(W, H, null);
    paint(m, scale, rgba, W, H, pad, pad, [20, 20, 20], null);
    const res = decodeQRRegion(rgba, W, H);
    assert.ok(res);
    assert.strictEqual(res.text, text);
});

test('survives sparse foreign noise inside symbol', () => {
    const text = 'noisy neighborhood';
    const m = makeMatrix(text);
    const scale = 3, sym = m.length * scale, pad = 4;
    const W = sym + pad * 2, H = W;
    const rgba = blankRGBA(W, H, [250, 250, 250]);
    paint(m, scale, rgba, W, H, pad, pad, [15, 15, 15], [240, 240, 240]);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 40; k++) {
        const x = pad + Math.floor(rnd() * sym), y = pad + Math.floor(rnd() * sym);
        const o = (y * W + x) * 4;
        rgba[o] = 200; rgba[o + 1] = 30; rgba[o + 2] = 30;
    }
    const res = decodeQRRegion(rgba, W, H);
    assert.ok(res);
    assert.strictEqual(res.text, text);
});

test('single color region returns null', () => {
    assert.strictEqual(decodeQRRegion(blankRGBA(40, 40, [80, 80, 80]), 40, 40), null);
});

test('thin strip like adjacent-corner click returns null', () => {
    const m = makeMatrix('strip');
    const scale = 2, sym = m.length * scale;
    const W = sym + 8, H = 12;
    const rgba = blankRGBA(W, H, [250, 250, 250]);
    paint(m, scale, rgba, W, H, 4, -2, [10, 10, 10], [240, 240, 240]);
    assert.strictEqual(decodeQRRegion(rgba, W, H), null);
});

test('topTwoColors counts void and exact rgb', () => {
    const rgba = new Uint8ClampedArray(3 * 4);
    rgba[0] = 255; rgba[1] = 0; rgba[2] = 0; rgba[3] = 255;
    rgba[4] = 255; rgba[5] = 0; rgba[6] = 0; rgba[7] = 255;
    rgba[11] = 0;
    const top = topTwoColors(rgba, 3, 1);
    assert.deepStrictEqual(top[0].rgb, [255, 0, 0]);
    assert.strictEqual(top[1].rgb, null);
});

test('snapToSymbol bbox exact', () => {
    const W = 10, H = 10;
    const rgba = blankRGBA(W, H, [250, 250, 250]);
    const o1 = (2 * W + 3) * 4, o2 = (5 * W + 7) * 4;
    rgba[o1] = 0; rgba[o1 + 1] = 0; rgba[o1 + 2] = 0; rgba[o1 + 3] = 255;
    rgba[o2] = 0; rgba[o2 + 1] = 0; rgba[o2 + 2] = 0; rgba[o2 + 3] = 255;
    const box = snapToSymbol(rgba, W, H, { rgb: [0, 0, 0], count: 2 });
    assert.deepStrictEqual([box.x, box.y, box.w, box.h], [3, 2, 5, 4]);
});

console.log('test-qrdecode: ' + passed + ' tests passed');