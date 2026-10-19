// src/core/qrdecode.js
// Pure QR decode pipeline over raw RGBA rectangles.
// Node + browser safe: no DOM, no network, no wplace imports.
// Stages: histogram -> polarity order -> dark-bbox snap -> crop ->
// nearest-neighbor upscale -> black/white remap -> jsQR.
// The flip retry swaps polarity AND snap anchor as a fallback.
// Transparent void (alpha < 128) participates as a color entry with rgb null,
// luminance Infinity, so it always takes the light role unless flipped.

const jsqrMod = require('jsqr');
const jsQR = jsqrMod.default || jsqrMod;

const MIN_SIDE = 64; // jsQR wants a few pixels per module; upscale below this

function lum(rgb) {
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function entryLum(entry) {
    return entry.rgb === null ? Infinity : lum(entry.rgb);
}

// Entries: { rgb: [r,g,b] or null for void, count }, sorted by count desc.
function colorHistogram(rgba, w, h) {
    const map = new Map();
    let voidCount = 0;
    for (let i = 0; i < w * h; i++) {
        if (rgba[i * 4 + 3] < 128) { voidCount++; continue; }
        const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
        map.set(key, (map.get(key) || 0) + 1);
    }
    const out = [];
    if (voidCount > 0) out.push({ rgb: null, count: voidCount });
    for (const [key, count] of map) {
        out.push({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], count });
    }
    out.sort((a, b) => b.count - a.count);
    return out;
}

function topTwoColors(rgba, w, h) {
    const hist = colorHistogram(rgba, w, h);
    if (hist.length < 2) return null;
    return [hist[0], hist[1]];
}

// Bounding box of pixels matching entry (exact rgb, or void by alpha).
function snapToSymbol(rgba, w, h, entry) {
    let minX = -1, minY = -1, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const hit = entry.rgb === null
                ? rgba[i + 3] < 128
                : (rgba[i + 3] >= 128 && rgba[i] === entry.rgb[0] &&
                   rgba[i + 1] === entry.rgb[1] && rgba[i + 2] === entry.rgb[2]);
            if (!hit) continue;
            count++;
            if (minX === -1) { minX = x; minY = y; maxX = x; maxY = y; }
            else {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (count === 0 || minX === -1) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count };
}

function cropRGBA(rgba, w, h, box) {
    const out = new Uint8ClampedArray(box.w * box.h * 4);
    for (let y = 0; y < box.h; y++) {
        const src = ((box.y + y) * w + box.x) * 4;
        out.set(rgba.subarray(src, src + box.w * 4), y * box.w * 4);
    }
    return { data: out, width: box.w, height: box.h };
}

// Nearest-neighbor integer-ish upscale so jsQR gets several pixels per module.
function upscaleNN(rgba, w, h, f) {
    if (f <= 1) return { data: rgba, width: w, height: h };
    const ow = w * f, oh = h * f;
    const out = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < oh; y++) {
        const sy = Math.floor(y / f);
        const rowSrc = sy * w * 4;
        const rowDst = y * ow * 4;
        for (let x = 0; x < ow; x++) {
            const si = rowSrc + Math.floor(x / f) * 4;
            const di = rowDst + x * 4;
            out[di] = rgba[si]; out[di + 1] = rgba[si + 1];
            out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
        }
    }
    return { data: out, width: ow, height: oh };
}

function dist2(px, rgb) {
    const dr = px[0] - rgb[0], dg = px[1] - rgb[1], db = px[2] - rgb[2];
    return dr * dr + dg * dg + db * db;
}

// Rebuild as pristine black-on-white RGBA: dark side -> black, light side ->
// white, foreign opaque pixels clamped to the nearer opaque entry, void
// pixels follow the void entry's side.
function remap(rgba, w, h, darkEntry, lightEntry) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        const px = [rgba[o], rgba[o + 1], rgba[o + 2]];
        let darkSide;
        if (rgba[o + 3] < 128) {
            darkSide = (darkEntry.rgb === null);
        } else if (darkEntry.rgb && px[0] === darkEntry.rgb[0] && px[1] === darkEntry.rgb[1] && px[2] === darkEntry.rgb[2]) {
            darkSide = true;
        } else if (lightEntry.rgb && px[0] === lightEntry.rgb[0] && px[1] === lightEntry.rgb[1] && px[2] === lightEntry.rgb[2]) {
            darkSide = false;
        } else {
            const cand = [];
            if (darkEntry.rgb) cand.push([dist2(px, darkEntry.rgb), true]);
            if (lightEntry.rgb) cand.push([dist2(px, lightEntry.rgb), false]);
            cand.sort((a, b) => a[0] - b[0]);
            darkSide = cand.length ? cand[0][1] : true;
        }
        const v = darkSide ? 0 : 255;
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
    }
    return { data: out, width: w, height: h };
}

// Main entry: raw RGBA rectangle in, decoded result or null.
function decodeQRRegion(rgba, w, h) {
    const pair = topTwoColors(rgba, w, h);
    if (!pair) return null;
    const [a, b] = pair;
    const firstDark = entryLum(a) <= entryLum(b) ? a : b;
    const firstLight = (firstDark === a) ? b : a;
    for (const flip of [false, true]) {
        const dark = flip ? firstLight : firstDark;
        const light = flip ? firstDark : firstLight;
        const box = snapToSymbol(rgba, w, h, dark);
        if (!box) continue;
        if (box.w < 5 || box.h < 5) continue;
        const ratio = box.w / box.h;
        if (ratio < 0.5 || ratio > 2) continue;
        const cropped = cropRGBA(rgba, w, h, box);
        const f = Math.max(1, Math.ceil(MIN_SIDE / Math.max(cropped.width, cropped.height)));
        const up = upscaleNN(cropped.data, cropped.width, cropped.height, f);
        const bw = remap(up.data, up.width, up.height, dark, light);
        const res = jsQR(bw.data, bw.width, bw.height);
        if (res) {
            return {
                text: res.data,
                version: res.version,
                dark: dark.rgb,
                light: light.rgb,
                flipped: flip,
                bounds: { x: box.x, y: box.y, w: box.w, h: box.h }
            };
        }
    }
    return null;
}

module.exports = {
    lum, entryLum, colorHistogram, topTwoColors,
    snapToSymbol, cropRGBA, upscaleNN, remap, decodeQRRegion
};