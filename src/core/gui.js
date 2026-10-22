// src/core/gui.js
// Pure DOM/CSS floating panel: encode, qr, decode, overlays manager, settings.
// Reads palette availability from wplace.js profile cache (no network here).
// Loads collapsed (header only) on every page load; results auto-expand it.

const { ALPHABET, encodeV1, encodeV2 } = require('./protocol.js');
const { COLOR_PALETTE } = require('./palette.js');
const labels = require('./labels.js');
const overlays = require('./overlays.js');
const wplace = require('./wplace.js');
const log = require('./log.js');
const qrcodegen = require('qrcode-generator');

const LS_KEY = 'colorcoder-gui-state';

const DEF_DARK = (COLOR_PALETTE.find(c => c.name === 'Black') || COLOR_PALETTE[1]).id;
const DEF_LIGHT = (COLOR_PALETTE.find(c => c.name === 'White') || COLOR_PALETTE[31]).id;

// Mock blank-map backgrounds for the transparent-light QR preview.
// Angular low-poly landmasses in unit coordinates, drawn as vector paths at
// preview size (crisp at any scale). One vertex list, two palettes: the two
// diagonal halves are the same place in light and dark theme.
// Retune palettes and region placement by eye against wplace's real blank map.
const MAP_LIGHT = [[154, 181, 244], [223, 252, 212], [238, 236, 230]];
const MAP_DARK = [[44, 51, 69], [61, 70, 92], [51, 58, 77]];
const MAP_REGIONS = [
    { x: 0.30, y: 0.30, c: 1, r: 0.34, seed: 11 },
    { x: 0.78, y: 0.24, c: 2, r: 0.26, seed: 22 },
    { x: 0.55, y: 0.72, c: 1, r: 0.30, seed: 33 },
    { x: 0.12, y: 0.78, c: 2, r: 0.22, seed: 44 },
    { x: 0.90, y: 0.66, c: 1, r: 0.20, seed: 55 }
];
let mapPolys = null;

function dedupeHistory() {
    const seen = new Set();
    state.history = state.history.filter(e => {
        const k = e.kind + '|' + e.text;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

let pinFactory = null;
function setPinFactory(factory) { pinFactory = factory; }

function polyHash(a, b) {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function buildMapPolys() {
    mapPolys = MAP_REGIONS.map((reg, ri) => {
        const K = 9 + Math.floor(polyHash(ri, 7) * 4); // 9..12 straight edges
        const pts = [];
        for (let k = 0; k < K; k++) {
            const ang = (k / K) * Math.PI * 2;
            const rad = reg.r * (0.55 + 0.5 * polyHash(ri * 31 + k, ri + 3));
            pts.push([reg.x + Math.cos(ang) * rad, reg.y + Math.sin(ang) * rad * 0.9]);
        }
        return { c: reg.c, pts };
    });
}

function drawMap(ctx, sym, palette) {
    if (!mapPolys) buildMapPolys();
    ctx.fillStyle = 'rgb(' + palette[0].join(',') + ')';
    ctx.fillRect(0, 0, sym, sym);
    for (const poly of mapPolys) {
        ctx.fillStyle = 'rgb(' + palette[poly.c].join(',') + ')';
        ctx.beginPath();
        poly.pts.forEach((p, i) => {
            const x = p[0] * sym, y = p[1] * sym;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
    }
}

const defaultState = {
    x: 20, y: 20, collapsed: false, tab: 'encode',
    enc: { proto: 2, mode: 0, free: 1 },
    qr: { ec: 'H', scale: 1, dark: DEF_DARK, light: DEF_LIGHT, text: '' },
    settings: { autoReload: false, consoleLogs: true, autoArm: false },
    history: []
};

function loadState() {
    try {
        const s = Object.assign({}, defaultState, JSON.parse(localStorage.getItem(LS_KEY) || '{}'));
        s.enc = Object.assign({}, defaultState.enc, s.enc);
        s.qr = Object.assign({}, defaultState.qr, s.qr);
        s.settings = Object.assign({}, defaultState.settings, s.settings);
        if (typeof s.qr.dark !== 'number' || s.qr.dark < 0 || s.qr.dark > 63) s.qr.dark = defaultState.qr.dark;
        if (typeof s.qr.light !== 'number' || s.qr.light < 0 || s.qr.light > 63) s.qr.light = defaultState.qr.light;
        if (typeof s.qr.scale !== 'number') s.qr.scale = defaultState.qr.scale;
        if (['L', 'M', 'Q', 'H'].indexOf(s.qr.ec) === -1) s.qr.ec = defaultState.qr.ec;
        return s;
    } catch (e) {
        const s = Object.assign({}, defaultState);
        s.enc = Object.assign({}, defaultState.enc);
        s.qr = Object.assign({}, defaultState.qr);
        s.settings = Object.assign({}, defaultState.settings);
        return s;
    }
}
function saveState(state) {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function requestExpandedOnNextLoad() {
    localStorage.setItem('cc-start-expanded', '1');
}

let state = loadState();
let panel, header, body, statusEl, statusTimer = null;
let encodePane, decodePane, settingsPane, managerPane, qrPane;
let encodeBtn, textArea, liteWarn, previewEl, hintEl;
let onEncodeCb = null;
let onQREncodeCb = null;
let onQRToggleArmCb = null;
let qrArmBtn = null;
let qrArmVisual = false;
dedupeHistory();

function css() {
    return `
        #cc-panel {
            position: fixed; z-index: 999999;
            width: 340px; background: #1a1a1d; color: #e0e0e0;
            border: 1px solid #444; border-radius: 6px;
            font-family: monospace; font-size: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            display: flex; flex-direction: column;
            max-height: 90vh; overflow: hidden;
        }
        #cc-header {
            padding: 6px 10px; background: #2a2a2e; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid #444; border-radius: 6px 6px 0 0;
            user-select: none; flex-shrink: 0;
        }
        #cc-header .title { font-weight: bold; color: #7fffd4; letter-spacing: 1px; }
        #cc-header .btns button {
            background: transparent; border: none; color: #aaa; cursor: pointer;
            font-size: 14px; margin-left: 8px; padding: 0 4px;
        }
        #cc-header .btns button:hover { color: #fff; }
        #cc-body { padding: 10px; display: ${state.collapsed ? 'none' : 'block'}; overflow-y: auto; }
        .cc-tabs { display: flex; margin-bottom: 10px; border-bottom: 1px solid #444; }
        .cc-tabs button {
            background: transparent; border: none; color: #888; padding: 4px 6px;
            cursor: pointer; font-family: inherit; font-size: 12px; flex: 1;
        }
        .cc-tabs button.active { color: #7fffd4; border-bottom: 2px solid #7fffd4; }
        .cc-pane { display: none; }
        .cc-pane.active { display: block; }
        .cc-row { margin-bottom: 8px; }
        .cc-row label { display: block; margin-bottom: 3px; color: #aaa; }
        .cc-row input[type=text], .cc-row textarea, .cc-row select {
            width: 100%; box-sizing: border-box; background: #0f0f11; color: #fff;
            border: 1px solid #444; padding: 6px; font-family: inherit; border-radius: 3px;
        }
        .cc-row textarea { height: 60px; resize: vertical; }
        .cc-btn {
            background: #7fffd4; color: #000; border: none; padding: 6px 12px;
            cursor: pointer; font-weight: bold; border-radius: 3px; width: 100%;
            font-family: inherit; font-size: 12px;
        }
        .cc-btn:disabled { background: #555; color: #999; cursor: not-allowed; }
        .cc-status {
            margin-top: 8px; padding: 6px; border-radius: 3px; font-size: 11px;
            display: none;
        }
        .cc-status.info { display: block; background: #2c3e50; color: #fff; }
        .cc-status.success { display: block; background: #27ae60; color: #fff; }
        .cc-status.error { display: block; background: #c0392b; color: #fff; }
        .cc-warn { color: #e74c3c; font-size: 11px; margin-top: 4px; }
        .cc-meta { font-size: 10px; color: #888; margin-bottom: 4px; }
        .cc-decode-result {
            background: #0f0f11; padding: 8px; border-radius: 3px;
            margin-bottom: 8px; word-break: break-all; border: 1px solid #333;
            white-space: pre-wrap;
        }
        .cc-shield { position: fixed; inset: 0; z-index: 999998; cursor: move; }
        .cc-template-row {
            padding: 6px; border-bottom: 1px solid #333;
            display: flex; align-items: center; gap: 8px;
        }
        .cc-template-row:last-child { border-bottom: none; }
        .cc-template-row label { flex: 1; cursor: pointer; margin: 0; }
        .cc-template-name { color: #e0e0e0; font-size: 11px; }
        .cc-autoscan-section { border-top: 1px solid #333; padding-top: 8px; margin-top: 4px; }
        .cc-toggle-group {
            display: flex;
            border: 1px solid #444;
            border-radius: 4px;
            overflow: hidden;
            background: #0f0f11;
        }
        .cc-toggle-group input[type=radio] {
            display: none;
        }
        .cc-toggle-group label {
            flex: 1;
            padding: 6px 8px;
            text-align: center;
            cursor: pointer;
            color: #888;
            transition: background 0.15s, color 0.15s;
            border-right: 1px solid #444;
            margin: 0;
            font-size: 11px;
        }
        .cc-toggle-group label:last-of-type {
            border-right: none;
        }
        .cc-toggle-group input[type=radio]:checked + label {
            background: #7fffd4;
            color: #000;
            font-weight: bold;
        }
    `;
}

function createPanel() {
    // Every page load starts header-only, unless a pin navigation asked us
    // to come back expanded. The flag is one-shot.
    const startExpanded = localStorage.getItem('cc-start-expanded') === '1';
    if (startExpanded) localStorage.removeItem('cc-start-expanded');
    state.collapsed = !startExpanded;

    const style = document.createElement('style');
    style.textContent = css();
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'cc-panel';
    panel.style.left = state.x + 'px';
    panel.style.top = state.y + 'px';

    header = document.createElement('div');
    header.id = 'cc-header';
    header.innerHTML = `
        <span class="title">COLORCODER</span>
        <span class="btns">
            <button id="cc-collapse" title="Collapse">${state.collapsed ? '+' : '_'}</button>
            <button id="cc-close" title="Hide (Alt+C)">x</button>
        </span>
    `;
    panel.appendChild(header);

    body = document.createElement('div');
    body.id = 'cc-body';

    const tabs = document.createElement('div');
    tabs.className = 'cc-tabs';
    tabs.innerHTML = `
        <button data-tab="encode" class="${state.tab === 'encode' ? 'active' : ''}">Encode</button>
        <button data-tab="qr" class="${state.tab === 'qr' ? 'active' : ''}">QR</button>
        <button data-tab="decode" class="${state.tab === 'decode' ? 'active' : ''}">Decode</button>
        <button data-tab="manager" class="${state.tab === 'manager' ? 'active' : ''}">Overlays</button>
        <button data-tab="settings" class="${state.tab === 'settings' ? 'active' : ''}">Settings</button>
    `;
    body.appendChild(tabs);

    encodePane = document.createElement('div');
    encodePane.className = `cc-pane ${state.tab === 'encode' ? 'active' : ''}`;
    encodePane.dataset.tab = 'encode';
    encodePane.innerHTML = `
        <div class="cc-row">
            <label>Mode</label>
            <div class="cc-toggle-group">
                <input type="radio" name="cc-mode" id="cc-mode-lite" value="0">
                <label for="cc-mode-lite">Lite</label>
                <input type="radio" name="cc-mode" id="cc-mode-full" value="1">
                <label for="cc-mode-full">Full</label>
            </div>
        </div>
        <div class="cc-row" id="cc-palrow">
            <label>Palette</label>
            <div class="cc-toggle-group">
                <input type="radio" name="cc-pal" id="cc-pal-free" value="1">
                <label for="cc-pal-free">Free colors (32)</label>
                <input type="radio" name="cc-pal" id="cc-pal-all" value="0">
                <label for="cc-pal-all">All colors (64)</label>
            </div>
            <div id="cc-pal-note" class="cc-meta" style="display:none; color:#e67e22; margin-top:4px;"></div>
        </div>
        <div class="cc-row">
            <label>Message Text</label>
            <textarea id="cc-text" placeholder="Type message..."></textarea>
            <div id="cc-litewarn" class="cc-warn" style="display:none;"></div>
            <div id="cc-hint" class="cc-meta" style="display:none; margin-top:4px;">
                Transparent (id 0) pixels paint like any other color; Lite spaces use it.
            </div>
            <div id="cc-preview" class="cc-meta" style="margin-top:4px;"></div>
        </div>
        <button id="cc-encode" class="cc-btn">Create Wplace Overlay</button>
        <div id="cc-action" style="margin-top:6px;"></div>
    `;
    body.appendChild(encodePane);

    qrPane = document.createElement('div');
    qrPane.className = `cc-pane ${state.tab === 'qr' ? 'active' : ''}`;
    qrPane.dataset.tab = 'qr';
    qrPane.innerHTML = `
        <div class="cc-row">
            <label>Message Text</label>
            <textarea id="cc-qrtext" placeholder="Type message..."></textarea>
            <div id="cc-qr-preview" class="cc-meta" style="margin-top:4px;"></div>
            <canvas id="cc-qr-canvas" style="display:none; margin-top:6px; image-rendering: pixelated; border:1px solid #333; border-radius:3px;"></canvas>
        </div>
        <div class="cc-row">
            <label>Error correction</label>
            <div class="cc-toggle-group">
                <input type="radio" name="cc-qrec" id="cc-qrec-l" value="L">
                <label for="cc-qrec-l">L</label>
                <input type="radio" name="cc-qrec" id="cc-qrec-m" value="M">
                <label for="cc-qrec-m">M</label>
                <input type="radio" name="cc-qrec" id="cc-qrec-q" value="Q">
                <label for="cc-qrec-q">Q</label>
                <input type="radio" name="cc-qrec" id="cc-qrec-h" value="H">
                <label for="cc-qrec-h">H</label>
            </div>
        </div>
        <div class="cc-row">
            <label>Module scale</label>
            <div class="cc-toggle-group">
                <input type="radio" name="cc-qrscale" id="cc-qrscale-1" value="1">
                <label for="cc-qrscale-1">1x</label>
                <input type="radio" name="cc-qrscale" id="cc-qrscale-2" value="2">
                <label for="cc-qrscale-2">2x</label>
                <input type="radio" name="cc-qrscale" id="cc-qrscale-4" value="4">
                <label for="cc-qrscale-4">4x</label>
            </div>
        </div>
        <div class="cc-row">
            <label>Dark color</label>
            <div style="display:flex;gap:6px;align-items:center;">
                <div id="cc-qr-swatchdark" style="width:18px;height:18px;border:1px solid #444;border-radius:3px;flex-shrink:0;"></div>
                <select id="cc-qr-dark"></select>
            </div>
        </div>
        <div class="cc-row">
            <label>Light color</label>
            <div style="display:flex;gap:6px;align-items:center;">
                <div id="cc-qr-swatchlight" style="width:18px;height:18px;border:1px solid #444;border-radius:3px;flex-shrink:0;"></div>
                <select id="cc-qr-light"></select>
            </div>
        </div>
        <div id="cc-qr-lumwarn" class="cc-warn" style="display:none;"></div>
        <div id="cc-qr-lockwarn" class="cc-warn" style="display:none;"></div>
        <button id="cc-qrencode" class="cc-btn">Create QR Overlay</button>
        <div id="cc-qr-action" style="margin-top:6px;"></div>
    `;
    body.appendChild(qrPane);

    decodePane = document.createElement('div');
    decodePane.className = `cc-pane ${state.tab === 'decode' ? 'active' : ''}`;
    decodePane.dataset.tab = 'decode';
    decodePane.innerHTML = `
        <div class="cc-row" style="color:#888; font-size:11px; margin-bottom:10px;">
            Alt+Click any sync pixel: V2 purple row or V1 black marker.
        </div>
        <div class="cc-row">
            <button id="cc-qrarm" class="cc-btn" style="background:#555; color:#fff;">QR corner select</button>
        </div>
        <div id="cc-decode-empty" style="color:#555; text-align:center; padding:20px;">
            No messages decoded yet.
        </div>
        <div id="cc-decode-content" style="display:none;"></div>
    `;
    body.appendChild(decodePane);

    managerPane = document.createElement('div');
    managerPane.className = `cc-pane ${state.tab === 'manager' ? 'active' : ''}`;
    managerPane.dataset.tab = 'manager';
    managerPane.innerHTML = `
        <div class="cc-row">
            <label>Overlay Manager</label>
            <div class="cc-meta">Export, import, remove wplace overlays. Import skips names that already exist.</div>
        </div>
        <div class="cc-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <input type="checkbox" id="cc-sel-all" checked>
            <label for="cc-sel-all" id="cc-sel-all-label" style="margin:0;color:#aaa;cursor:pointer;">Select all</label>
        </div>
        <div class="cc-row">
            <div id="cc-template-list" style="max-height:280px;overflow-y:auto;border:1px solid #333;padding:4px;border-radius:3px;background:#0f0f11;"></div>
        </div>
        <div class="cc-row" style="display:flex;gap:6px;">
            <button id="cc-export" class="cc-btn" style="flex:1;" disabled>Export Selected</button>
            <button id="cc-remove" class="cc-btn" style="flex:1;background:#c0392b;" disabled>Remove Selected</button>
        </div>
        <div class="cc-row" style="display:flex;gap:6px;align-items:center;">
            <input type="file" id="cc-import-file" accept=".json" style="display:none;">
            <button id="cc-import" class="cc-btn" style="flex:1;background:#555;color:#fff;">Import from File</button>
        </div>
        <div class="cc-row">
            <label style="display:flex;align-items:center;gap:6px;color:#aaa;cursor:pointer;">
                <input type="checkbox" id="cc-import-reload" ${state.settings.autoReload ? 'checked' : ''}>
                <span style="font-size:11px;">Reload page after import / remove</span>
            </label>
        </div>
        <div id="cc-manager-status" style="margin-top:6px;"></div>
    `;
    body.appendChild(managerPane);

    settingsPane = document.createElement('div');
    settingsPane.className = `cc-pane ${state.tab === 'settings' ? 'active' : ''}`;
    settingsPane.dataset.tab = 'settings';
    settingsPane.innerHTML = `
        <div class="cc-row">
            <label><input type="checkbox" id="cc-autoreload" ${state.settings.autoReload ? 'checked' : ''}> Auto reload after overlay injection</label>
        </div>
        <div class="cc-row">
            <label><input type="checkbox" id="cc-logs" ${state.settings.consoleLogs ? 'checked' : ''}> Show console logs</label>
        </div>
        <div class="cc-row">
            <label>Scan history cap</label>
            <div style="display:flex; gap:6px; align-items:center;">
                <input type="number" id="cc-historycap" min="5" max="200" value="${state.settings.historyCap}" style="flex:1; background:#0f0f11; color:#fff; border:1px solid #444; padding:6px; font-family:inherit; border-radius:3px;">
                <span class="cc-meta" style="flex:0 0 auto;">entries</span>
            </div>
            <div class="cc-meta" style="margin-top:3px;">Oldest entries are dropped when the cap is reached.</div>
        </div>
        <div class="cc-row">
            <label>Default pin zoom</label>
            <select id="cc-gotozoom" style="width:100%; background:#0f0f11; color:#fff; border:1px solid #444; padding:6px; font-family:inherit; border-radius:3px;">
                ${[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(z => 
                    `<option value="${z}" ${state.settings.gotoZoom === z ? 'selected' : ''}>${z}${z === 15 ? ' (close)' : z <= 6 ? ' (world)' : ''}</option>`
                ).join('')}
            </select>
            <div class="cc-meta" style="margin-top:3px;">Zoom level used by Pin Location buttons.</div>
        </div>
        <div class="cc-row cc-autoscan-section">
            <div class="cc-meta" style="margin-bottom:6px;">Autoscan Labels</div>
            <button id="cc-autoscan" class="cc-btn" style="background:#7fffd4; color:#000;">Arm labels</button>
            <label style="display:block; margin-top:8px; color:#aaa;">
                <input type="checkbox" id="cc-autoarm" ${state.settings.autoArm ? 'checked' : ''}>
                Auto-arm on first discovery
            </label>
            <div class="cc-meta" style="margin-top:6px; color:#666;">
                Alt+L to arm · Alt+Shift+L to clear
            </div>
        </div>
        <button id="cc-reset" class="cc-btn" style="background:#555; color:#fff; margin-top:6px;">Reset Panel Position</button>
    `;
    body.appendChild(settingsPane);

    statusEl = document.createElement('div');
    statusEl.className = 'cc-status';
    body.appendChild(statusEl);

    panel.appendChild(body);
    document.documentElement.appendChild(panel);

    bindEvents();
}

function pushHistory(entry) {
    const key = entry.kind + '|' + entry.text;
    const existingIndex = state.history.findIndex(e => (e.kind + '|' + e.text) === key);
    if (existingIndex !== -1) {
        // Same message scanned again: refresh in place so the Go button and
        // metadata reflect the newest scan, and move it to the top.
        const existing = state.history[existingIndex];
        existing.when = Date.now();
        existing.pos = entry.pos;
        existing.meta = entry.meta;
        state.history.splice(existingIndex, 1);
        state.history.unshift(existing);
    } else {
        entry.when = Date.now();
        state.history.unshift(entry);
    }
    const cap = state.settings.historyCap || 40;
    if (state.history.length > cap) state.history = state.history.slice(0, cap);
    saveState(state);
}
function formatTimeAgo(ms) {
    const diff = Date.now() - ms;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    return day + 'd ago';
}

function renderHistoryList() {
    if (!state.history.length) return '';
    const rows = state.history.map((e, i) => {
        const badge = e.kind === 'qr' ? 'QR' : e.kind.toUpperCase();
        const preview = (e.text || '').slice(0, 30) + ((e.text || '').length > 30 ? '…' : '');
        const when = formatTimeAgo(e.when);
        const canPin = !!e.pos && !!pinFactory;
        return `
            <div class="cc-history-row" data-index="${i}" style="padding:6px; border-bottom:1px solid #333; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                    <span style="background:#555; padding:2px 6px; border-radius:3px; font-size:10px;">${badge}</span>
                    <span class="cc-meta" style="flex:1; text-align:right;">${when}</span>
                    <button class="cc-history-pin" data-index="${i}" title="Go to location"
                        style="background:#555; color:#fff; border:none; border-radius:3px; padding:2px 6px; font-size:10px; cursor:pointer;${canPin ? '' : ' opacity:0.4; cursor:not-allowed;'}"
                        ${canPin ? '' : 'disabled'}>Go</button>
                </div>
                <div style="margin-top:4px; font-size:11px; color:#ccc;">${escapeHtml(preview)}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="cc-history" style="margin-top:12px; border-top:1px solid #444; padding-top:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <div style="color:#888; font-size:11px;">History (${state.history.length})</div>
                <button id="cc-clear-history" class="cc-btn" style="width:auto; padding:3px 8px; background:#555; font-size:10px;">Clear</button>
            </div>
            <div style="max-height:200px; overflow-y:auto; border:1px solid #333; border-radius:3px; background:#0f0f11;">
                ${rows}
            </div>
        </div>
    `;
}

function wireHistoryEvents(root) {
    root.querySelectorAll('.cc-history-row').forEach(row => {
        row.addEventListener('click', (ev) => {
            if (ev.target.closest('.cc-history-pin')) return;
            selectHistoryEntry(parseInt(row.dataset.index, 10));
        });
    });
    root.querySelectorAll('.cc-history-pin').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const entry = state.history[parseInt(btn.dataset.index, 10)];
            if (entry && entry.pos && pinFactory) pinFactory(entry.pos)();
        });
    });
    const clearBtn = root.querySelector('#cc-clear-history');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            state.history = [];
            saveState(state);
            const empty = decodePane.querySelector('#cc-decode-empty');
            const content = decodePane.querySelector('#cc-decode-content');
            empty.style.display = 'block';
            content.style.display = 'none';
        });
    }
}

function selectHistoryEntry(index) {
    const entry = state.history[index];
    if (!entry) return;

    const empty = decodePane.querySelector('#cc-decode-empty');
    const content = decodePane.querySelector('#cc-decode-content');
    empty.style.display = 'none';
    content.style.display = 'block';

    if (entry.kind === 'qr') {
        const darkStr = entry.meta.dark ? 'rgb(' + entry.meta.dark.join(',') + ')' : 'transparent';
        const lightStr = entry.meta.light ? 'rgb(' + entry.meta.light.join(',') + ')' : 'transparent';
        const posStr = entry.pos
            ? 'Tile: ' + Math.floor(entry.pos.gx / 1000) + ',' + Math.floor(entry.pos.gy / 1000) +
              ' | Px: ' + (entry.pos.gx % 1000) + ',' + (entry.pos.gy % 1000)
            : '';

        content.innerHTML = `
            <div class="cc-meta">QR v${entry.meta.version} | symbol ${entry.meta.bounds.w}x${entry.meta.bounds.h} px | ${darkStr} on ${lightStr}${entry.meta.flipped ? ' | polarity retry' : ''}</div>
            <div class="cc-meta">${posStr}</div>
            <div class="cc-decode-result">${escapeHtml(entry.text || '')}</div>
            <div style="display:flex; gap:6px; margin-top:6px;">
                <button id="cc-copy" class="cc-btn" style="flex:1; background:#555; color:#fff;">Copy Text</button>
                <button id="cc-pin" class="cc-btn" style="flex:1; background:#555; color:#fff;">Go To Location</button>
            </div>
            ${renderHistoryList()}
        `;
    } else {
        const proto = (entry.kind === 'v2') ? 'V2' : 'V1';
        let modeStr = (entry.meta.mode === 0) ? 'Lite' : 'Full';
        if (entry.kind === 'v2') modeStr += entry.meta.free ? ' (free colors)' : ' (all colors)';
        const crcStr = entry.meta.valid
            ? 'CRC OK'
            : 'CRC WARNING (stored ' + entry.meta.storedChecksum + ' != computed ' + entry.meta.computedChecksum + ')';
        const posStr = entry.pos
            ? 'Tile: ' + entry.pos.tileX + ',' + entry.pos.tileY + ' | Px: ' + entry.pos.px + ',' + entry.pos.py
            : '';

        content.innerHTML = `
            <div class="cc-meta">${proto} ${modeStr} | ${entry.meta.length} px | ${crcStr}</div>
            <div class="cc-meta">${posStr}</div>
            <div class="cc-decode-result">${escapeHtml(entry.text || '')}</div>
            <div style="display:flex; gap:6px; margin-top:6px;">
                <button id="cc-copy" class="cc-btn" style="flex:1; background:#555; color:#fff;">Copy Text</button>
                <button id="cc-pin" class="cc-btn" style="flex:1; background:#555; color:#fff;">Pin Location</button>
            </div>
            ${renderHistoryList()}
        `;
    }

    content.querySelector('#cc-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(entry.text || '').then(() => {
            setStatus('Copied to clipboard', 'success');
        });
    });

    const pinBtn = content.querySelector('#cc-pin');
    if (pinFactory && entry.pos) {
        pinBtn.addEventListener('click', pinFactory(entry.pos));
        pinBtn.disabled = false;
    } else {
        pinBtn.disabled = true;
    }

    wireHistoryEvents(content);
}

function bindEvents() {
    body.querySelectorAll('.cc-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            state.tab = btn.dataset.tab;
            body.querySelectorAll('.cc-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            body.querySelectorAll('.cc-pane').forEach(p => p.classList.remove('active'));
            body.querySelector(`.cc-pane[data-tab="${state.tab}"]`).classList.add('active');
            saveState(state);
            if (state.tab === 'manager') refreshTemplateList();
            if (state.tab === 'qr') refreshQRPane();
            if (state.tab === 'decode') refreshDecodePane();
        });
    });

    header.querySelector('#cc-collapse').addEventListener('click', () => {
        state.collapsed = !state.collapsed;
        body.style.display = state.collapsed ? 'none' : 'block';
        header.querySelector('#cc-collapse').textContent = state.collapsed ? '+' : '_';
        saveState(state);
    });
    header.querySelector('#cc-close').addEventListener('click', () => {
        panel.style.display = 'none';
    });

    let drag = null;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        const shield = document.createElement('div');
        shield.className = 'cc-shield';
        document.body.appendChild(shield);
        drag = { startX: e.clientX - state.x, startY: e.clientY - state.y, shield };
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!drag) return;
        state.x = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - drag.startX));
        state.y = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - drag.startY));
        panel.style.left = state.x + 'px';
        panel.style.top = state.y + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (drag) {
            drag.shield.remove();
            drag = null;
            saveState(state);
        }
    });

    // --- Encode pane ---
    const modeLite = encodePane.querySelector('#cc-mode-lite');
    const modeFull = encodePane.querySelector('#cc-mode-full');
    const palFree = encodePane.querySelector('#cc-pal-free');
    const palAll = encodePane.querySelector('#cc-pal-all');

    textArea = encodePane.querySelector('#cc-text');
    encodeBtn = encodePane.querySelector('#cc-encode');
    liteWarn = encodePane.querySelector('#cc-litewarn');
    previewEl = encodePane.querySelector('#cc-preview');
    hintEl = encodePane.querySelector('#cc-hint');

    if (state.enc.mode === 1) modeFull.checked = true; else modeLite.checked = true;
    if (state.enc.free === 1) palFree.checked = true; else palAll.checked = true;

    function refreshEncodePane() {
        const proto = 2;
        const mode = parseInt(encodePane.querySelector('input[name="cc-mode"]:checked').value, 10);
        const free = parseInt(encodePane.querySelector('input[name="cc-pal"]:checked').value, 10);
        state.enc = { proto, mode, free };
        saveState(state);

        hintEl.style.display = (mode === 0) ? '' : 'none';

        const palNote = encodePane.querySelector('#cc-pal-note');
        if (wplace.profileSeen()) {
            const missing = wplace.missingExtraCount();
            if (missing > 0) {
                palNote.textContent = missing + '/32 premium colors are not unlocked, free mode recommended.';
                palNote.style.display = 'block';
            } else {
                palNote.style.display = 'none';
            }
        } else {
            palNote.style.display = 'none';
        }

        const text = textArea.value;
        if (text.trim() === '') {
            liteWarn.style.display = 'none';
            previewEl.textContent = 'Type a message first.';
            encodeBtn.disabled = true;
            return;
        }
        const bad = [];
        if (mode === 0) {
            for (const ch of text) {
                if (!ALPHABET.includes(ch) && !bad.includes(ch)) bad.push(ch);
            }
        }
        if (bad.length > 0) {
            liteWarn.style.display = 'block';
            liteWarn.textContent = 'Lite cannot encode: ' + bad.join(' ') + ' - use Full.';
            previewEl.textContent = '';
            encodeBtn.disabled = true;
            return;
        }
        liteWarn.style.display = 'none';

        const enc = encodeV2(text, mode, free);
        if (!enc) {
            previewEl.textContent = 'Message too long: payload exceeds 1023 px.';
            encodeBtn.disabled = true;
            return;
        }
        const prefix = 8;
        previewEl.textContent = 'Payload ' + enc.length + ' px + ' + prefix +
            ' px prefix = ' + (enc.length + prefix) + ' px total.';
        encodeBtn.disabled = false;
    }

    modeLite.addEventListener('change', refreshEncodePane);
    modeFull.addEventListener('change', refreshEncodePane);
    palFree.addEventListener('change', refreshEncodePane);
    palAll.addEventListener('change', refreshEncodePane);
    textArea.addEventListener('input', refreshEncodePane);
    refreshEncodePane();

    encodeBtn.addEventListener('click', () => {
        clearAction('encode');
        if (onEncodeCb) {
            onEncodeCb(textArea.value, state.enc.mode, state.enc.free, state.enc.proto);
        }
    });

    // --- QR pane ---
    const qrText = qrPane.querySelector('#cc-qrtext');
    const qrPreview = qrPane.querySelector('#cc-qr-preview');
    const qrCanvas = qrPane.querySelector('#cc-qr-canvas');
    const qrBtn = qrPane.querySelector('#cc-qrencode');
    const qrDarkSel = qrPane.querySelector('#cc-qr-dark');
    const qrLightSel = qrPane.querySelector('#cc-qr-light');
    const qrSwatchDark = qrPane.querySelector('#cc-qr-swatchdark');
    const qrSwatchLight = qrPane.querySelector('#cc-qr-swatchlight');
    const qrLumWarn = qrPane.querySelector('#cc-qr-lumwarn');
    const qrLockWarn = qrPane.querySelector('#cc-qr-lockwarn');

    qrText.value = state.qr.text || '';

    function lum(rgb) {
        return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    }

    function fillPairSelect(sel, selectedId, forbidZero) {
        sel.innerHTML = '';
        for (let id = 0; id < 64; id++) {
            const c = COLOR_PALETTE[id];
            if (!c) continue;
            const opt = document.createElement('option');
            const locked = wplace.profileSeen() && !wplace.hasColor(id);
            const forbidden = forbidZero && id === 0;
            opt.value = String(id);
            opt.textContent = c.name + (forbidden ? ' (background only)' : locked ? ' (locked)' : '');
            if (forbidden) opt.disabled = true;
            if (id === selectedId) opt.selected = true;
            sel.appendChild(opt);
        }
    }

        function drawQRPreview(qrLive, size, fit, darkId, lightId) {
        const ctx = qrCanvas.getContext('2d');
        const dc = COLOR_PALETTE[darkId];
        const darkCss = 'rgb(' + dc.rgb.join(',') + ')';
        const sym = size * fit;
        qrCanvas.width = sym;
        qrCanvas.height = sym;
        qrCanvas.style.display = 'block';
        ctx.imageSmoothingEnabled = false;

        if (lightId === 0) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(sym, 0); ctx.lineTo(sym, sym);
            ctx.closePath();
            ctx.clip();
            drawMap(ctx, sym, MAP_LIGHT);
            ctx.restore();
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(0, sym); ctx.lineTo(sym, sym);
            ctx.closePath();
            ctx.clip();
            drawMap(ctx, sym, MAP_DARK);
            ctx.restore();
        } else {
            const lc = COLOR_PALETTE[lightId];
            ctx.fillStyle = 'rgb(' + lc.rgb.join(',') + ')';
            ctx.fillRect(0, 0, sym, sym);
        }

        ctx.fillStyle = darkCss;
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++)
                if (qrLive.isDark(y, x)) ctx.fillRect(x * fit, y * fit, fit, fit);
    }

    function refreshQRPane() {
        let dark = parseInt(qrDarkSel.value, 10);
        let light = parseInt(qrLightSel.value, 10);
        if (isNaN(dark)) dark = state.qr.dark;
        if (isNaN(light)) light = state.qr.light;
        const ec = qrPane.querySelector('input[name="cc-qrec"]:checked').value;
        const scale = parseInt(qrPane.querySelector('input[name="cc-qrscale"]:checked').value, 10);
        state.qr = { ec, scale, dark, light, text: qrText.value };
        saveState(state);

        fillPairSelect(qrDarkSel, dark, true);
        fillPairSelect(qrLightSel, light, false);

        const dc = COLOR_PALETTE[dark] || COLOR_PALETTE[DEF_DARK];
        const lc = COLOR_PALETTE[light] || COLOR_PALETTE[DEF_LIGHT];
        qrSwatchDark.style.background = 'rgb(' + dc.rgb.join(',') + ')';
        qrSwatchLight.style.background = 'rgb(' + lc.rgb.join(',') + ')';

        if (light === 0) {
            qrLumWarn.style.display = 'block';
            qrLumWarn.style.color = '#e67e22';
            qrLumWarn.textContent = 'Transparent background: only dark modules paint. Reads on light canvas or theme; busy or dark backgrounds may break decode.';
        } else {
            const dl = lum(dc.rgb), ll = lum(lc.rgb);
            if (dl >= ll) {
                qrLumWarn.style.display = 'block';
                qrLumWarn.style.color = '#e74c3c';
                qrLumWarn.textContent = 'Inverted pair: the dark color is brighter than the light one, decoders will fail.';
            } else if (ll - dl < 0.2) {
                qrLumWarn.style.display = 'block';
                qrLumWarn.style.color = '#e67e22';
                qrLumWarn.textContent = 'Low contrast pair, decoders may struggle.';
            } else {
                qrLumWarn.style.display = 'none';
            }
        }

        const lockedChosen = [];
        for (const id of [dark, light]) {
            if (id !== 0 && wplace.profileSeen() && !wplace.hasColor(id) && lockedChosen.indexOf(id) === -1) {
                lockedChosen.push(id);
            }
        }
        if (lockedChosen.length > 0) {
            qrLockWarn.style.display = 'block';
            qrLockWarn.style.color = '#e67e22';
            qrLockWarn.textContent = lockedChosen.map(id => COLOR_PALETTE[id].name).join(', ') +
                (lockedChosen.length > 1 ? ' are' : ' is') +
                ' not unlocked on this account; creating will ask for confirmation.';
        } else {
            qrLockWarn.style.display = 'none';
        }

        const text = qrText.value;
        if (text.trim() === '') {
            qrPreview.textContent = 'Type a message first.';
            qrCanvas.style.display = 'none';
            qrBtn.disabled = true;
            return;
        }
        let info = null, tooLong = false, qrLive = null;
        try {
            const qr = qrcodegen(0, ec);
            qr.addData(text);
            qr.make();
            const size = qr.getModuleCount();
            let darks = 0;
            for (let y = 0; y < size; y++)
                for (let x = 0; x < size; x++)
                    if (qr.isDark(y, x)) darks++;
            info = { version: (size - 17) / 4, size: size, darks: darks };
            qrLive = qr;
        } catch (e) {
            tooLong = true;
        }
        if (tooLong) {
            qrPreview.textContent = 'Message too long for QR at EC ' + ec + '.';
            qrCanvas.style.display = 'none';
            qrBtn.disabled = true;
            return;
        }
        const paintPx = (light === 0 ? info.darks : info.size * info.size) * scale * scale;
        qrPreview.textContent = 'v' + info.version + ', ' + info.size + ' modules, ' +
            (info.size * scale) + ' px canvas, ' + dc.name + ' on ' + lc.name +
            ' (' + paintPx + ' px to paint)';
        const fit = Math.max(1, Math.min(4, Math.floor(300 / info.size)));
        drawQRPreview(qrLive, info.size, fit, dark, light);
        qrBtn.disabled = false;
    }
    window.refreshQRPane = refreshQRPane;

    qrPane.querySelectorAll('input[name="cc-qrec"]').forEach(r => r.addEventListener('change', refreshQRPane));
    qrPane.querySelectorAll('input[name="cc-qrscale"]').forEach(r => r.addEventListener('change', refreshQRPane));
    qrDarkSel.addEventListener('change', refreshQRPane);
    qrLightSel.addEventListener('change', refreshQRPane);
    qrText.addEventListener('input', refreshQRPane);

    // restore saved radio state
    const ecRadio = qrPane.querySelector('input[name="cc-qrec"][value="' + state.qr.ec + '"]');
    if (ecRadio) ecRadio.checked = true;
    const scaleRadio = qrPane.querySelector('input[name="cc-qrscale"][value="' + state.qr.scale + '"]');
    if (scaleRadio) scaleRadio.checked = true;
    refreshQRPane();

    qrBtn.addEventListener('click', () => {
        clearAction('qr');
        if (!onQREncodeCb) {
            setStatus('QR encode wires in the next step.', 'info');
            return;
        }
        onQREncodeCb(qrText.value, {
            ec: state.qr.ec, scale: state.qr.scale,
            dark: state.qr.dark, light: state.qr.light
        });
    });

    // --- QR corner select arm ---
    qrArmBtn = decodePane.querySelector('#cc-qrarm');
    qrArmBtn.addEventListener('click', () => {
        if (onQRToggleArmCb) onQRToggleArmCb();
    });
    updateQRArmButton();

    // --- Overlays manager ---
    const templateList = managerPane.querySelector('#cc-template-list');
    const exportBtn = managerPane.querySelector('#cc-export');
    const removeBtn = managerPane.querySelector('#cc-remove');
    const importBtn = managerPane.querySelector('#cc-import');
    const importFile = managerPane.querySelector('#cc-import-file');
    const importReload = managerPane.querySelector('#cc-import-reload');
    const managerStatus = managerPane.querySelector('#cc-manager-status');
    const selAll = managerPane.querySelector('#cc-sel-all');
    const selAllLabel = managerPane.querySelector('#cc-sel-all-label');

    function updateSelectionButtons() {
        const all = templateList.querySelectorAll('input[type="checkbox"]');
        const checked = templateList.querySelectorAll('input[type="checkbox"]:checked');
        const count = checked.length;
        exportBtn.disabled = count === 0;
        removeBtn.disabled = count === 0;
        exportBtn.textContent = count > 0 ? 'Export Selected (' + count + ')' : 'Export Selected';
        removeBtn.textContent = count > 0 ? 'Remove Selected (' + count + ')' : 'Remove Selected';
        selAll.checked = count > 0 && count === all.length;
        selAll.indeterminate = count > 0 && count < all.length;
        selAllLabel.textContent = 'Select all (' + count + '/' + all.length + ')';
    }

    window.refreshTemplateList = function() {
        const templates = overlays.getAllTemplates();
        templateList.innerHTML = '';

        if (templates.length === 0) {
            templateList.innerHTML = '<div style="color:#555;text-align:center;padding:16px;">No templates found</div>';
            selAll.checked = false;
            selAll.indeterminate = false;
            selAllLabel.textContent = 'Select all (0/0)';
            exportBtn.disabled = true;
            removeBtn.disabled = true;
            exportBtn.textContent = 'Export Selected';
            removeBtn.textContent = 'Remove Selected';
            return;
        }

        templates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        templates.forEach(t => {
            const row = document.createElement('div');
            row.className = 'cc-template-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.dataset.id = t.id;
            checkbox.addEventListener('change', updateSelectionButtons);

            const shortId = (t.id || '').slice(0, 8);
            const dt = new Date(t.updatedAt || Date.now());
            const when = dt.toLocaleDateString() + ' ' +
                dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const label = document.createElement('label');
            label.innerHTML = `
                <div class="cc-template-name">${escapeHtml(t.name)}</div>
                <div class="cc-meta">${t.originalWidth}×${t.originalHeight} px · ${when} · id ${shortId}</div>
            `;

            row.appendChild(checkbox);
            row.appendChild(label);
            templateList.appendChild(row);
        });

        updateSelectionButtons();
    };

    function getSelectedIds() {
        const checked = templateList.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checked).map(cb => cb.dataset.id);
    }

    function setManagerStatus(msg, color) {
        managerStatus.textContent = msg;
        managerStatus.style.color = color || '#e0e0e0';
        managerStatus.style.fontSize = '11px';
        managerStatus.style.marginTop = '6px';
    }

    selAll.addEventListener('change', () => {
        templateList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = selAll.checked;
        });
        updateSelectionButtons();
    });

    exportBtn.addEventListener('click', async () => {
        const ids = getSelectedIds();
        if (ids.length === 0) return;
        setManagerStatus('Exporting...', '#7fffd4');
        exportBtn.disabled = true;
        try {
            const count = await overlays.exportTemplates(ids);
            setManagerStatus('Exported ' + count + ' template(s). Check your downloads.', '#27ae60');
        } catch (err) {
            log.err('[CC-Manager] Export failed: ' + err.message);
            setManagerStatus('Export failed: ' + err.message, '#e74c3c');
        }
        exportBtn.disabled = false;
        updateSelectionButtons();
    });

    removeBtn.addEventListener('click', async () => {
        const ids = getSelectedIds();
        if (ids.length === 0) return;

        const names = ids.map(id => {
            const t = overlays.getAllTemplates().find(o => o.id === id);
            return t ? t.name : id;
        });
        const msg = 'Remove ' + ids.length + ' template(s)?\n\n' + names.join('\n') + '\n\nThis cannot be undone.';
        if (!confirm(msg)) return;

        setManagerStatus('Removing...', '#7fffd4');
        removeBtn.disabled = true;
        try {
            const count = await overlays.removeTemplates(ids);
            setManagerStatus('Removed ' + count + ' template(s).', '#27ae60');
            refreshTemplateList();
            if (importReload.checked) {
                setManagerStatus('Removed. Reloading in 2s...', '#7fffd4');
                setTimeout(() => location.reload(), 2000);
            }
        } catch (err) {
            log.err('[CC-Manager] Remove failed: ' + err.message);
            setManagerStatus('Remove failed: ' + err.message, '#e74c3c');
        }
        removeBtn.disabled = false;
    });

    importBtn.addEventListener('click', () => importFile.click());

    importFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setManagerStatus('Importing...', '#7fffd4');
        importBtn.disabled = true;
        try {
            const count = await overlays.importTemplates(file);
            setManagerStatus('Imported ' + count + '. Names already present were skipped.', '#27ae60');
            refreshTemplateList();
            if (importReload.checked && count > 0) {
                setManagerStatus('Reloading in 2s...', '#7fffd4');
                setTimeout(() => location.reload(), 2000);
            }
        } catch (err) {
            log.err('[CC-Manager] Import failed: ' + err.message);
            setManagerStatus('Import failed: ' + err.message, '#e74c3c');
        }
        importBtn.disabled = false;
        importFile.value = '';
    });

    // --- Settings ---
    settingsPane.querySelector('#cc-autoreload').addEventListener('change', (e) => {
        state.settings.autoReload = e.target.checked;
        saveState(state);
    });
    settingsPane.querySelector('#cc-logs').addEventListener('change', (e) => {
        state.settings.consoleLogs = e.target.checked;
        log.setMuted(!e.target.checked);
        saveState(state);
    });
    settingsPane.querySelector('#cc-historycap').addEventListener('change', (e) => {
        let v = parseInt(e.target.value, 10);
        if (isNaN(v) || v < 5) v = 5;
        if (v > 200) v = 200;
        e.target.value = v;
        state.settings.historyCap = v;
        if (state.history.length > v) {
            state.history = state.history.slice(0, v);
        }
        saveState(state);
    });
    settingsPane.querySelector('#cc-gotozoom').addEventListener('change', (e) => {
        state.settings.gotoZoom = parseInt(e.target.value, 10);
        saveState(state);
    });
    settingsPane.querySelector('#cc-reset').addEventListener('click', () => {
        state.x = 20; state.y = 20;
        panel.style.left = '20px'; panel.style.top = '20px';
        saveState(state);
    });

    // --- Autoscan ---
    const armBtn = settingsPane.querySelector('#cc-autoscan');
    const autoArmCb = settingsPane.querySelector('#cc-autoarm');

    function updateArmButton() {
        const armed = labels.isArmed();
        armBtn.textContent = armed ? 'Disarm labels' : 'Arm labels';
        armBtn.style.background = armed ? '#c0392b' : '#7fffd4';
        armBtn.style.color = '#fff';
    }
    armBtn.addEventListener('click', () => {
        if (labels.isArmed()) {
            labels.clearLabels();
        } else {
            labels.scanAndLabel();
        }
    });
    autoArmCb.addEventListener('change', (e) => {
        state.settings.autoArm = e.target.checked;
        saveState(state);
        localStorage.setItem('cc-autoArm', e.target.checked ? '1' : '0');
    });
    autoArmCb.checked = !!state.settings.autoArm;

    setInterval(updateArmButton, 500);
    updateArmButton();

    if (state.tab === 'manager') refreshTemplateList();
    if (state.tab === 'qr') refreshQRPane();
    if (state.tab === 'decode') refreshDecodePane();
}

// --- Status line, action slots, arm visual ---

function expandBody() {
    if (!state.collapsed) return;
    state.collapsed = false;
    if (body) body.style.display = 'block';
    if (header) {
        const btn = header.querySelector('#cc-collapse');
        if (btn) btn.textContent = '_';
    }
    saveState(state);
}

function setStatus(msg, type = 'info', timeout = 5000) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    statusEl.textContent = msg;
    statusEl.className = 'cc-status ' + type;
    if (timeout > 0) {
        statusTimer = setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'cc-status';
            statusTimer = null;
        }, timeout);
    }
}

function slotFor(pane) {
    const root = (pane === 'qr') ? qrPane : encodePane;
    if (!root) return null;
    return root.querySelector(pane === 'qr' ? '#cc-qr-action' : '#cc-action');
}

function clearAction(pane = 'encode') {
    const slot = slotFor(pane);
    if (slot) slot.innerHTML = '';
}

// If the decode tab is open and nothing is currently displayed, but history
// exists from a previous session, surface the most recent entry so the list
// is visible without needing a fresh decode.
function refreshDecodePane() {
    if (state.tab !== 'decode') return;
    const content = decodePane.querySelector('#cc-decode-content');
    if (content && content.style.display === 'block') return; // already showing
    if (state.history && state.history.length) selectHistoryEntry(0);
}

function showReloadButton(pane = 'encode') {
    const slot = slotFor(pane);
    if (!slot) return;
    slot.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'cc-btn';
    btn.style.background = '#555';
    btn.style.color = '#fff';
    btn.textContent = 'Overlay injected - Reload Now';
    btn.onclick = () => location.reload();
    slot.appendChild(btn);
}

function showMissingColorsWarning(missingIds, onForce, pane = 'encode') {
    const slot = slotFor(pane);
    if (!slot) return;
    slot.innerHTML = '';

    const list = document.createElement('div');
    list.style.cssText = 'background:#0f0f11; padding:6px; border:1px solid #e67e22; border-radius:3px; margin-bottom:6px;';

    const header2 = document.createElement('div');
    header2.style.cssText = 'color:#e67e22; font-size:11px; margin-bottom:4px;';
    header2.textContent = 'Uses colors you have not unlocked:';
    list.appendChild(header2);

    for (const id of missingIds) {
        const c = COLOR_PALETTE[id];
        if (!c) continue;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:11px; color:#e0e0e0;';

        const swatch = document.createElement('div');
        swatch.style.cssText = 'width:12px; height:12px; border-radius:2px; border:1px solid #444; background:rgb(' + c.rgb.join(',') + '); flex-shrink:0;';

        const name = document.createElement('span');
        name.textContent = c.name;

        row.appendChild(swatch);
        row.appendChild(name);
        list.appendChild(row);
    }
    slot.appendChild(list);

    const btn = document.createElement('button');
    btn.className = 'cc-btn';
    btn.style.background = '#e67e22';
    btn.style.color = '#fff';
    btn.textContent = 'Create anyway';
    btn.onclick = onForce;
    slot.appendChild(btn);
}

function updateQRArmButton() {
    if (!qrArmBtn) return;
    qrArmBtn.textContent = qrArmVisual ? 'Cancel corner select' : 'QR corner select';
    qrArmBtn.style.background = qrArmVisual ? '#c0392b' : '#555';
}

function setQRArmed(armed) {
    qrArmVisual = !!armed;
    updateQRArmButton();
}

function showDecodeResult(result, tileInfo, onPin) {
    show();

    // Push to history
    pushHistory({
        kind: result.version === 2 ? 'v2' : 'v1',
        text: result.text,
        pos: tileInfo,
        meta: {
            mode: result.mode,
            free: result.free,
            length: result.length,
            valid: result.valid,
            storedChecksum: result.storedChecksum,
            computedChecksum: result.computedChecksum
        }
    });

    const empty = decodePane.querySelector('#cc-decode-empty');
    const content = decodePane.querySelector('#cc-decode-content');
    empty.style.display = 'none';
    content.style.display = 'block';

    const proto = (result.version === 2) ? 'V2' : 'V1';
    let modeStr = (result.mode === 0) ? 'Lite' : 'Full';
    if (result.version === 2) modeStr += result.free ? ' (free colors)' : ' (all colors)';
    const crcStr = result.valid
        ? 'CRC OK'
        : 'CRC WARNING (stored ' + result.storedChecksum + ' != computed ' + result.computedChecksum + ')';
    const posStr = tileInfo
        ? 'Tile: ' + tileInfo.tileX + ',' + tileInfo.tileY + ' | Px: ' + tileInfo.px + ',' + tileInfo.py
        : '';

    let warnHtml = '';
    if (result.badChars) warnHtml += '<div class="cc-warn">Warning: payload contains unmapped values (replaced with "?")</div>';
    if (result.badPadding) warnHtml += '<div class="cc-warn">Warning: non-zero padding bits (possible corruption)</div>';
    if (result.truncated) warnHtml += '<div class="cc-warn">Warning: message truncated (sequence shorter than header length)</div>';
    if (result.badHeaderColors) warnHtml += '<div class="cc-warn">Warning: header contains non-free color ids (possible corruption)</div>';
    if (result.reserved) warnHtml += '<div class="cc-warn">Warning: reserved header bits set (' + result.reserved + ')</div>';

    content.innerHTML = `
        <div class="cc-meta">${proto} ${modeStr} | ${result.length} px | ${crcStr}</div>
        <div class="cc-meta">${posStr}</div>
        ${warnHtml}
        <div class="cc-decode-result">${escapeHtml(result.text || '')}</div>
        <div style="display:flex; gap:6px; margin-top:6px;">
            <button id="cc-copy" class="cc-btn" style="flex:1; background:#555; color:#fff;">Copy Text</button>
            <button id="cc-pin" class="cc-btn" style="flex:1; background:#555; color:#fff;">Pin Location</button>
        </div>
        ${renderHistoryList()}
    `;

    content.querySelector('#cc-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(result.text || '').then(() => {
            setStatus('Copied to clipboard', 'success');
        });
    });

    const pinBtn = content.querySelector('#cc-pin');
    if (onPin) {
        pinBtn.addEventListener('click', onPin);
    } else {
        pinBtn.disabled = true;
    }

    // Wire history row clicks
    wireHistoryEvents(content);

    state.tab = 'decode';
    body.querySelectorAll('.cc-tabs button').forEach(b => b.classList.remove('active'));
    body.querySelector('.cc-tabs button[data-tab="decode"]').classList.add('active');
    body.querySelectorAll('.cc-pane').forEach(p => p.classList.remove('active'));
    decodePane.classList.add('active');
    saveState(state);
}

function showQRResult(result, tileInfo, onPin) {
    show();

    // Push to history
    const gx = tileInfo ? tileInfo.tileX * 1000 + tileInfo.px : 0;
    const gy = tileInfo ? tileInfo.tileY * 1000 + tileInfo.py : 0;
    pushHistory({
        kind: 'qr',
        text: result.text,
        pos: { gx, gy },
        meta: {
            version: result.version,
            dark: result.dark,
            light: result.light,
            flipped: result.flipped,
            bounds: result.bounds
        }
    });

    const empty = decodePane.querySelector('#cc-decode-empty');
    const content = decodePane.querySelector('#cc-decode-content');
    empty.style.display = 'none';
    content.style.display = 'block';

    const darkStr = result.dark ? 'rgb(' + result.dark.join(',') + ')' : 'transparent';
    const lightStr = result.light ? 'rgb(' + result.light.join(',') + ')' : 'transparent';
    const posStr = tileInfo
        ? 'Tile: ' + tileInfo.tileX + ',' + tileInfo.tileY + ' | Px: ' + tileInfo.px + ',' + tileInfo.py
        : '';

    content.innerHTML = `
        <div class="cc-meta">QR v${result.version} | symbol ${result.bounds.w}x${result.bounds.h} px | ${darkStr} on ${lightStr}${result.flipped ? ' | polarity retry' : ''}</div>
        <div class="cc-meta">${posStr}</div>
        <div class="cc-decode-result">${escapeHtml(result.text || '')}</div>
        <div style="display:flex; gap:6px; margin-top:6px;">
            <button id="cc-copy" class="cc-btn" style="flex:1; background:#555; color:#fff;">Copy Text</button>
            <button id="cc-pin" class="cc-btn" style="flex:1; background:#555; color:#fff;">Pin Location</button>
        </div>
        ${renderHistoryList()}
    `;

    content.querySelector('#cc-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(result.text || '').then(() => {
            setStatus('Copied to clipboard', 'success');
        });
    });

    const pinBtn = content.querySelector('#cc-pin');
    if (onPin) {
        pinBtn.addEventListener('click', onPin);
    } else {
        pinBtn.disabled = true;
    }

    // Wire history row clicks
    wireHistoryEvents(content);

    state.tab = 'decode';
    body.querySelectorAll('.cc-tabs button').forEach(b => b.classList.remove('active'));
    body.querySelector('.cc-tabs button[data-tab="decode"]').classList.add('active');
    body.querySelectorAll('.cc-pane').forEach(p => p.classList.remove('active'));
    decodePane.classList.add('active');
    saveState(state);
}
// --- Public API ---

function init() {
    if (document.getElementById('cc-panel')) return;
    log.setMuted(!state.settings.consoleLogs);
    createPanel();
}

function show() {
    if (panel) panel.style.display = 'flex';
    expandBody();
    if (state.tab === 'manager' && window.refreshTemplateList) window.refreshTemplateList();
    if (state.tab === 'qr' && window.refreshQRPane) window.refreshQRPane();
    if (state.tab === 'decode') refreshDecodePane();
}

function toggle() {
    if (!panel) init();
    else panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    if (panel.style.display === 'flex') {
        if (state.tab === 'manager' && window.refreshTemplateList) window.refreshTemplateList();
        if (state.tab === 'qr' && window.refreshQRPane) window.refreshQRPane();
        if (state.tab === 'decode') refreshDecodePane();
    }
}

function onEncode(cb) { onEncodeCb = cb; }
function onQREncode(cb) { onQREncodeCb = cb; }
function onQRToggleArm(cb) { onQRToggleArmCb = cb; }



function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

module.exports = {
    init, show, toggle, setStatus, onEncode, onQREncode, onQRToggleArm, setQRArmed, setPinFactory,
    showDecodeResult, showQRResult,
    clearAction, showReloadButton, showMissingColorsWarning,
    getSettings: () => state.settings,
    requestExpandedOnNextLoad
};