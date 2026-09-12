// src/core/labels.js
// Display half of autoscan: find magic markers in the WebGL framebuffer and
// pin decoded text to them as DOM labels. No servo yet: each Alt+L is a
// snapshot; labels drift on pan/zoom until you scan again.
// Browser-only.

const { registry, MAGIC_KEYS } = require('./intercept.js');

let pickCV = null, pickGL = null;

function glOf() {
    if (!pickCV) pickCV = document.querySelector('.maplibregl-canvas');
    if (!pickCV) return null;
    if (!pickGL) pickGL = pickCV.getContext('webgl2') || pickCV.getContext('webgl');
    return pickGL;
}

// v5 O(1) framebuffer matcher: bucket by B, then G, then R index
function keyIndexOf(r, g, b) {
    if (b < 239) return -1;
    let gi;
    if (g <= 16) gi = 0;
    else if (g >= 18 && g <= 50) gi = 1;
    else return -1;
    const i = Math.round((r - 1) / 34);
    if (i < 0 || i > 7) return -1;
    if (Math.abs(r - (1 + 34 * i)) > 16) return -1;
    return gi * 8 + i;
}

// ---------- DOM label layer ----------
let layer = null;
function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;' +
        'z-index:99998;font:11px monospace;';
    document.documentElement.appendChild(layer);
    return layer;
}

function clearLabels() {
    if (layer) layer.innerHTML = '';
}

function addLabel(m, x, y) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;padding:2px 5px;' +
        'background:rgba(10,10,20,.85);color:#7fffd4;border:1px solid #7fffd466;' +
        'border-radius:3px;max-width:260px;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis;';
    el.textContent = (m.valid ? '' : '[CRC] ') + m.text;
    el.title = m.modeStr + ' | ' + m.text;
    ensureLayer().appendChild(el);
    el.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(6px,-110%)';
}

// ---------- single-read framebuffer scan ----------
function scanAndLabel() {
    const gl = glOf();
    if (!gl) { console.log('[CC-LABELS] no map canvas yet'); return; }

    requestAnimationFrame(() => requestAnimationFrame(() => {
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const t0 = performance.now();
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t1 = performance.now();

        let ok = 0;
        for (let k = 1; k < 10; k++) {
            if (px[(Math.floor(H * k / 10) * W + Math.floor(W * k / 10)) * 4 + 3] > 0) ok++;
        }
        if (ok < 5) { console.log('[CC-LABELS] invalid frame, press Alt+L again'); return; }

        const sx = new Float64Array(MAGIC_KEYS.length);
        const sy = new Float64Array(MAGIC_KEYS.length);
        const sn = new Uint32Array(MAGIC_KEYS.length);

        for (let i = 0; i < px.length; i += 4) {
            const ki = keyIndexOf(px[i], px[i + 1], px[i + 2]);
            if (ki === -1) continue;
            const p = i / 4;
            sx[ki] += p % W;
            sy[ki] += Math.floor(p / W);
            sn[ki]++;
        }

        const rect = pickCV.getBoundingClientRect();
        clearLabels();
        let placed = 0;
        for (let ki = 0; ki < MAGIC_KEYS.length; ki++) {
            if (sn[ki] < 2) continue;
            const m = registry.get(MAGIC_KEYS[ki].join(','));
            if (!m) continue;
            const cx = sx[ki] / sn[ki];
            const cy = sy[ki] / sn[ki];
            const lx = rect.left + cx * rect.width / W;
            const ly = rect.top + (H - 1 - cy) * rect.height / H;
            addLabel(m, lx, ly);
            placed++;
        }

        console.log('[CC-LABELS] ' + placed + ' labels placed | read=' + (t1 - t0).toFixed(1) +
            'ms total=' + (performance.now() - t0).toFixed(1) + 'ms');
    }));
}

module.exports = { scanAndLabel, clearLabels };