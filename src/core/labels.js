// src/core/labels.js
// Display half of autoscan plus the label servo, incremental build.
// States: OFF, IDLE (windowed reads), DRAG (blind follow), SCROLL (zoom or
// pan subkind, quiet-timer settle). Priority SCROLL > DRAG > IDLE, but a
// held mouse button survives scroll cascades: settle returns to DRAG when
// the button is still down, and pointer deltas blind-follow in SCROLL too.
// Per-track retirement: parked (off-screen border) and dormant (proved
// absent on-screen); both stop reads, revive on border return or rescan.
// No inertia model yet by design: coast recovery comes from reconcile scans.
// Browser-only. No GUI dependency.

const { COUNT, buildTable, keyIndexOfTable } = require('./keys.js');
const { registry } = require('./intercept.js');

// ---------- tuning ----------
const WIN = 32;                  // base tracking window, device px
const WIN_GROW = 3;              // doublings: 32,64,128,256
const BUDGET = 8;                // window reads per frame in IDLE
const GRACE = 15;                // misses before a track goes dormant
const PARK_MARGIN = 64;          // device px outside buffer counts as parked
const SCROLL_QUIET_MS = 150;     // wheel cascade end detector
const PERIODIC_MS = 2000;        // reconcile cadence while anything dormant

let pickCV = null, pickGL = null;
function glOf() {
    if (!pickCV) pickCV = document.querySelector('.maplibregl-canvas');
    if (!pickCV) return null;
    if (!pickGL) pickGL = pickCV.getContext('webgl2') || pickCV.getContext('webgl');
    return pickGL;
}
function isCanvas(t) {
    return !!(t && t.closest && t.closest('.maplibregl-canvas-container'));
}

// ---------- DOM label layer ----------
let layer = null;
const elems = new Map(); // keyIndex -> element

function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;' +
        'z-index:99998;font:11px monospace;';
    document.documentElement.appendChild(layer);
    return layer;
}
function makeLabel(m) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;padding:2px 5px;' +
        'background:rgba(10,10,20,.85);color:#7fffd4;border:1px solid #7fffd466;' +
        'border-radius:3px;max-width:260px;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis;';
    el.textContent = (m.valid ? '' : '[CRC] ') + m.text;
    el.title = m.modeStr + ' | ' + m.text;
    ensureLayer().appendChild(el);
    return el;
}
function placeElem(el, cx, cy) {
    el.style.transform = 'translate(' + cx + 'px,' + cy + 'px) translate(6px,-110%)';
}
function dropLabel(ki) {
    const el = elems.get(ki);
    if (el) el.remove();
    elems.delete(ki);
}
function clearLayer() {
    if (layer) layer.innerHTML = '';
    elems.clear();
}
function showLayer() { if (layer) layer.style.display = ''; }
function hideLayer() { if (layer) layer.style.display = 'none'; }
function layerHidden() { return !!layer && layer.style.display === 'none'; }

// ---------- servo state ----------
let mode = 'off';              // 'off' | 'idle' | 'drag' | 'scroll'
let scrollKind = 'zoom';       // 'zoom' | 'pan'
const tracks = new Map();      // ki -> { fx, fy, miss, parked, dormant }
let table = null, tableSize = -1;
let rr = 0;
let lastFull = 0;
let quietTimer = 0;
let loopOn = false;
let scanPending = false;
let buttonHeld = false;        // physical M1 state, survives mode changes
let lastPX = 0, lastPY = 0;    // last seen pointer client coords
let dragX = 0, dragY = 0;      // last applied pointer coords for deltas

function armed() { return mode !== 'off'; }

function refreshTable() {
    if (tableSize !== registry.size()) {
        table = buildTable(registry.values());
        tableSize = registry.size();
    }
}
function geom() {
    const rect = pickCV.getBoundingClientRect();
    const W = pickGL.drawingBufferWidth, H = pickGL.drawingBufferHeight;
    return { rect: rect, W: W, H: H, kx: W / rect.width, ky: H / rect.height };
}
function cssOf(fx, fy, g) {
    return [
        g.rect.left + fx * g.rect.width / g.W,
        g.rect.top + (g.H - 1 - fy) * g.rect.height / g.H
    ];
}
function updateParked(t, g) {
    t.parked = (t.fx < -PARK_MARGIN || t.fx > g.W + PARK_MARGIN ||
                t.fy < -PARK_MARGIN || t.fy > g.H + PARK_MARGIN);
    if (t.parked) t.miss = 0;
}
function anyDormant() {
    for (const t of tracks.values()) if (t.dormant) return true;
    return false;
}
function blindMove(dx, dy) {
    if (!dx && !dy) return;
    if (!pickCV || !pickGL) return;
    const g = geom();
    for (const [ki, t] of tracks) {
        t.fx += dx * g.kx;
        t.fy -= dy * g.ky;
        updateParked(t, g);
        if (t.dormant) continue;
        const el = elems.get(ki);
        if (el) {
            const c = cssOf(t.fx, t.fy, g);
            placeElem(el, c[0], c[1]);
        }
    }
}
function reanchor() {
    dragX = lastPX;
    dragY = lastPY;
}

// ---------- full scan: reseed, revive, retire ----------
function scanAndLabel(postMode) {
    const gl = glOf();
    if (!gl) { console.log('[CC-LABELS] no map canvas yet'); return; }
    if (scanPending) return;
    scanPending = true;
    if (quietTimer) { clearTimeout(quietTimer); quietTimer = 0; }

    requestAnimationFrame(() => requestAnimationFrame(() => {
        scanPending = false;
        const g = geom();
        const t0 = performance.now();
        const px = new Uint8Array(g.W * g.H * 4);
        gl.readPixels(0, 0, g.W, g.H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t1 = performance.now();

        let ok = 0;
        for (let k = 1; k < 10; k++) {
            if (px[(Math.floor(g.H * k / 10) * g.W + Math.floor(g.W * k / 10)) * 4 + 3] > 0) ok++;
        }
        if (ok < 5) { console.log('[CC-LABELS] invalid frame, press Alt+L again'); return; }

        refreshTable();
        const sx = new Float64Array(COUNT), sy = new Float64Array(COUNT), sn = new Uint32Array(COUNT);
        for (let i = 0; i < px.length; i += 4) {
            const ki = keyIndexOfTable(table, px[i], px[i + 1], px[i + 2]);
            if (ki < 0) continue;
            const p = i / 4;
            sx[ki] += p % g.W;
            sy[ki] += Math.floor(p / g.W);
            sn[ki]++;
        }

        showLayer();
        let placed = 0, dormant = 0;

        for (const ki of Array.from(tracks.keys())) {
            const t = tracks.get(ki);
            const m = registry.findByIndex(ki);
            if (!m) { tracks.delete(ki); dropLabel(ki); continue; }
            if (sn[ki] > 0) {
                t.fx = sx[ki] / sn[ki];
                t.fy = sy[ki] / sn[ki];
                t.miss = 0;
                t.parked = false;
                t.dormant = false;
                let el = elems.get(ki);
                if (!el) { el = makeLabel(m); elems.set(ki, el); }
                const c = cssOf(t.fx, t.fy, g);
                placeElem(el, c[0], c[1]);
                placed++;
            } else if (!t.parked && !t.dormant) {
                t.dormant = true;
                dropLabel(ki);
                dormant++;
            } else if (t.dormant) {
                dormant++;
            }
        }
        for (let ki = 0; ki < COUNT; ki++) {
            if (sn[ki] < 1 || tracks.has(ki)) continue;
            const m = registry.findByIndex(ki);
            if (!m) continue;
            const fx = sx[ki] / sn[ki], fy = sy[ki] / sn[ki];
            const t = { fx: fx, fy: fy, miss: 0, parked: false, dormant: false };
            updateParked(t, g);
            tracks.set(ki, t);
            if (!t.parked) {
                const el = makeLabel(m);
                elems.set(ki, el);
                const c = cssOf(fx, fy, g);
                placeElem(el, c[0], c[1]);
                placed++;
            }
        }

        lastFull = performance.now();
        if (postMode === 'drag' && buttonHeld) {
            mode = 'drag';
            reanchor();
        } else {
            mode = 'idle';
            kick();
        }
        console.log('[CC-LABELS] ' + placed + ' labels placed, ' + dormant +
            ' dormant | read=' + (t1 - t0).toFixed(1) +
            'ms total=' + (performance.now() - t0).toFixed(1) + 'ms | servo armed' +
            (mode === 'drag' ? ' (drag held)' : ''));
    }));
}

function clearLabels() {
    mode = 'off';
    tracks.clear();
    clearLayer();
    showLayer();
    if (quietTimer) { clearTimeout(quietTimer); quietTimer = 0; }
}

// ---------- reconcile: only while something is missing ----------
setInterval(() => {
    if (mode !== 'idle' || scanPending) return;
    if (registry.size() === 0) return;
    if (!anyDormant() && tracks.size > 0) return;
    if (performance.now() - lastFull < PERIODIC_MS) return;
    scanAndLabel();
}, 1000);

// ---------- IDLE loop ----------
function kick() {
    if (!loopOn && mode === 'idle' && tracks.size) {
        loopOn = true;
        requestAnimationFrame(() => requestAnimationFrame(tick));
    }
}

function tick() {
    loopOn = false;
    if (mode !== 'idle' || !tracks.size || !pickGL) return;
    refreshTable();
    const g = geom();
    const kis = Array.from(tracks.keys());
    let processed = 0;

    for (let n = 0; n < kis.length && processed < BUDGET; n++) {
        const ki = kis[(rr + n) % kis.length];
        const t = tracks.get(ki);
        if (!t || t.parked || t.dormant) continue;
        processed++;
        const m = registry.findByIndex(ki);
        if (!m) { tracks.delete(ki); dropLabel(ki); continue; }

        const span = WIN << Math.min(t.miss, WIN_GROW);
        if (span > g.W || span > g.H) { t.dormant = true; dropLabel(ki); continue; }
        let x0 = Math.round(t.fx - span / 2);
        let y0 = Math.round(t.fy - span / 2);
        x0 = Math.max(0, Math.min(g.W - span, x0));
        y0 = Math.max(0, Math.min(g.H - span, y0));

        const buf = new Uint8Array(span * span * 4);
        pickGL.readPixels(x0, y0, span, span, pickGL.RGBA, pickGL.UNSIGNED_BYTE, buf);
        let sx = 0, sy = 0, sn = 0;
        for (let i = 0; i < buf.length; i += 4) {
            if (keyIndexOfTable(table, buf[i], buf[i + 1], buf[i + 2]) !== ki) continue;
            const p = i / 4;
            sx += p % span;
            sy += Math.floor(p / span);
            sn++;
        }

        if (sn > 0) {
            t.fx = x0 + sx / sn;
            t.fy = y0 + sy / sn;
            t.miss = 0;
            updateParked(t, g);
            const el = elems.get(ki);
            if (el) {
                const c = cssOf(t.fx, t.fy, g);
                placeElem(el, c[0], c[1]);
            }
        } else {
            t.miss++;
            if (t.miss > GRACE) {
                t.dormant = true;
                dropLabel(ki);
            }
        }
    }
    rr = kis.length ? (rr + processed) % kis.length : 0;
    kick();
}

// ---------- DRAG and held-button blind follow ----------
document.addEventListener('pointerdown', (e) => {
    if (!armed() || e.button !== 0 || !isCanvas(e.target)) return;
    buttonHeld = true;
    lastPX = e.clientX; lastPY = e.clientY;
    if (quietTimer) { clearTimeout(quietTimer); quietTimer = 0; }
    mode = 'drag';
    reanchor();
});
window.addEventListener('pointermove', (e) => {
    if (!armed()) return;
    lastPX = e.clientX; lastPY = e.clientY;
    if (!buttonHeld) return;
    if (mode !== 'drag' && mode !== 'scroll') return;
    const dx = e.clientX - dragX;
    const dy = e.clientY - dragY;
    dragX = e.clientX;
    dragY = e.clientY;
    blindMove(dx, dy);
});
window.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    buttonHeld = false;
    if (mode !== 'drag') return;
    if (layerHidden()) {
        enterScroll('zoom'); // settle rescan will unhide
    } else {
        mode = 'idle';
        kick();
    }
});

// ---------- SCROLL: top of the hierarchy ----------
function enterScroll(kind) {
    mode = 'scroll';
    scrollKind = kind;
    if (kind === 'zoom') hideLayer();
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
        quietTimer = 0;
        if (mode !== 'scroll') return;
        if (scrollKind === 'zoom') {
            scanAndLabel(buttonHeld ? 'drag' : 'idle');
        } else {
            if (buttonHeld) {
                mode = 'drag';
                reanchor();
            } else {
                mode = 'idle';
                kick();
            }
        }
    }, SCROLL_QUIET_MS);
}

window.addEventListener('wheel', (e) => {
    if (!armed() || !isCanvas(e.target)) return;
    const mul = e.deltaMode === 1 ? 33 : 1; // Firefox line-mode normalization
    const dx = e.deltaX * mul;
    const dy = e.deltaY * mul;
    const kind = (e.ctrlKey || (dx === 0 && Math.abs(dy) >= 48)) ? 'zoom' : 'pan';
    if (kind === 'pan' && mode === 'scroll' && scrollKind === 'zoom') {
        return; // zoom cascade already hiding; do not unhide-follow
    }
    enterScroll(kind);
    if (kind === 'pan') blindMove(dx, dy);
}, { passive: true });

document.addEventListener('dblclick', (e) => {
    if (armed() && isCanvas(e.target)) enterScroll('zoom');
});

module.exports = { scanAndLabel, clearLabels };