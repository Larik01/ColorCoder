// src/core/gui.js
// Pure DOM/CSS floating panel. No dependencies on wplace internals.

const { ALPHABET } = require('./alphabet.js');

const LS_KEY = 'colorcoder-gui-state';

const defaultState = {
    x: 20, y: 20, collapsed: false, tab: 'encode',
    settings: { autoReload: false, consoleLogs: true }
};

function loadState() {
    try { return Object.assign({}, defaultState, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
    catch { return { ...defaultState }; }
}
function saveState(state) {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
}

let state = loadState();
let panel, header, body, statusEl, encodePane, decodePane, settingsPane;
let encodeBtn, textArea, modeSelect, reloadBtn;
let onEncodeCb = null;

function css() {
    return `
        #cc-panel {
            position: fixed; z-index: 999999;
            width: 320px; background: #1a1a1d; color: #e0e0e0;
            border: 1px solid #444; border-radius: 6px;
            font-family: monospace; font-size: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            display: flex; flex-direction: column;
        }
        #cc-header {
            padding: 6px 10px; background: #2a2a2e; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid #444; border-radius: 6px 6px 0 0;
            user-select: none;
        }
        #cc-header .title { font-weight: bold; color: #7fffd4; letter-spacing: 1px; }
        #cc-header .btns button {
            background: transparent; border: none; color: #aaa; cursor: pointer;
            font-size: 14px; margin-left: 8px; padding: 0 4px;
        }
        #cc-header .btns button:hover { color: #fff; }
        #cc-body { padding: 10px; display: ${state.collapsed ? 'none' : 'block'}; }
        .cc-tabs { display: flex; margin-bottom: 10px; border-bottom: 1px solid #444; }
        .cc-tabs button {
            background: transparent; border: none; color: #888; padding: 4px 10px;
            cursor: pointer; font-family: inherit; font-size: 12px;
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
        .cc-decode-result {
            background: #0f0f11; padding: 8px; border-radius: 3px; 
            margin-bottom: 8px; word-break: break-all; border: 1px solid #333;
        }
        .cc-meta { font-size: 10px; color: #888; margin-bottom: 4px; }
        .cc-shield { position: fixed; inset: 0; z-index: 999998; cursor: move; }
    `;
}

function createPanel() {
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
            <button id="cc-collapse" title="Collapse">_</button>
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
        <button data-tab="decode" class="${state.tab === 'decode' ? 'active' : ''}">Decode</button>
        <button data-tab="settings" class="${state.tab === 'settings' ? 'active' : ''}">Settings</button>
    `;
    body.appendChild(tabs);

    encodePane = document.createElement('div');
    encodePane.className = `cc-pane ${state.tab === 'encode' ? 'active' : ''}`;
    encodePane.dataset.tab = 'encode';
    encodePane.innerHTML = `
        <div class="cc-row">
            <label>Protocol: V1</label>
            <select id="cc-mode">
                <option value="0">Lite (basic chars, 1px/char)</option>
                <option value="1">Full (UTF-8, 4px/3bytes)</option>
            </select>
        </div>
        <div class="cc-row">
            <label>Message Text</label>
            <textarea id="cc-text" placeholder="Type message..."></textarea>
            <div id="cc-litewarn" class="cc-warn" style="display:none;"></div>
        </div>
        <button id="cc-encode" class="cc-btn">Create Wplace Overlay</button>
    `;
    body.appendChild(encodePane);

    decodePane = document.createElement('div');
    decodePane.className = `cc-pane ${state.tab === 'decode' ? 'active' : ''}`;
    decodePane.dataset.tab = 'decode';
    decodePane.innerHTML = `
        <div class="cc-row" style="color:#888; font-size:11px; margin-bottom:10px;">
            Alt+Click a Black sync pixel on the canvas to decode.
        </div>
        <div id="cc-decode-empty" style="color:#555; text-align:center; padding:20px;">
            No messages decoded yet.
        </div>
        <div id="cc-decode-content" style="display:none;"></div>
    `;
    body.appendChild(decodePane);

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
        <button id="cc-reset" class="cc-btn" style="background:#555; color:#fff;">Reset Panel Position</button>
    `;
    body.appendChild(settingsPane);

    statusEl = document.createElement('div');
    statusEl.className = 'cc-status';
    body.appendChild(statusEl);

    panel.appendChild(body);
    document.documentElement.appendChild(panel);

    bindEvents();
}

function bindEvents() {
    // Tabs
    body.querySelectorAll('.cc-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            state.tab = btn.dataset.tab;
            body.querySelectorAll('.cc-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            body.querySelectorAll('.cc-pane').forEach(p => p.classList.remove('active'));
            body.querySelector(`.cc-pane[data-tab="${state.tab}"]`).classList.add('active');
            saveState(state);
        });
    });

    // Header buttons
    header.querySelector('#cc-collapse').addEventListener('click', () => {
        state.collapsed = !state.collapsed;
        body.style.display = state.collapsed ? 'none' : 'block';
        header.querySelector('#cc-collapse').textContent = state.collapsed ? '+' : '_';
        saveState(state);
    });
    header.querySelector('#cc-close').addEventListener('click', () => {
        panel.style.display = 'none';
    });

    // Dragging
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

    // Encode Logic
    modeSelect = encodePane.querySelector('#cc-mode');
    textArea = encodePane.querySelector('#cc-text');
    encodeBtn = encodePane.querySelector('#cc-encode');
    const liteWarn = encodePane.querySelector('#cc-litewarn');

    function validateLite() {
        if (modeSelect.value === '0') {
            const text = textArea.value;
            const bad = [];
            for (const ch of text) {
                if (!ALPHABET.includes(ch) && !bad.includes(ch)) bad.push(ch);
            }
            if (bad.length > 0) {
                liteWarn.style.display = 'block';
                liteWarn.textContent = `Lite cannot encode: ${bad.join(', ')}. Use Full.`;
                encodeBtn.disabled = true;
            } else {
                liteWarn.style.display = 'none';
                encodeBtn.disabled = false;
            }
        } else {
            liteWarn.style.display = 'none';
            encodeBtn.disabled = false;
        }
    }

    modeSelect.addEventListener('change', validateLite);
    textArea.addEventListener('input', validateLite);
    validateLite();

    encodeBtn.addEventListener('click', () => {
        if (onEncodeCb) onEncodeCb(textArea.value, parseInt(modeSelect.value, 10));
    });

    // Settings Logic
    settingsPane.querySelector('#cc-autoreload').addEventListener('change', (e) => {
        state.settings.autoReload = e.target.checked; saveState(state);
    });
    settingsPane.querySelector('#cc-logs').addEventListener('change', (e) => {
        state.settings.consoleLogs = e.target.checked; saveState(state);
    });
    settingsPane.querySelector('#cc-reset').addEventListener('click', () => {
        state.x = 20; state.y = 20;
        panel.style.left = '20px'; panel.style.top = '20px';
        saveState(state);
    });
}

// --- Public API ---

function init() {
    if (document.getElementById('cc-panel')) return;
    createPanel();
}

function show() {
    if (panel) panel.style.display = 'flex';
}

function toggle() {
    if (!panel) init();
    else panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function setStatus(msg, type = 'info') {
    statusEl.textContent = msg;
    statusEl.className = 'cc-status ' + type;
}

function onEncode(cb) { onEncodeCb = cb; }

function showDecodeResult(result, tileInfo) {
    const empty = decodePane.querySelector('#cc-decode-empty');
    const content = decodePane.querySelector('#cc-decode-content');
    empty.style.display = 'none';
    content.style.display = 'block';

    const modeStr = result.mode === 0 ? 'Lite' : 'Full';
    const crcStr = result.valid ? 'CRC OK' : `CRC WARNING (Stored: ${result.storedChecksum} != Computed: ${result.computedChecksum})`;
    const posStr = tileInfo ? `Tile: ${tileInfo.tileX},${tileInfo.tileY} | Px: ${tileInfo.px},${tileInfo.py}` : '';

    let warnHtml = '';
    if (result.badChars) warnHtml += '<div class="cc-warn">Warning: Payload contains unmapped chars (replaced with "?")</div>';
    if (result.badPadding) warnHtml += '<div class="cc-warn">Warning: Non-zero padding bits (possible corruption)</div>';
    if (result.truncated) warnHtml += '<div class="cc-warn">Warning: Message truncated (sequence too short)</div>';

    content.innerHTML = `
        <div class="cc-meta">${modeStr} | ${result.length} px | ${crcStr}</div>
        <div class="cc-meta">${posStr}</div>
        ${warnHtml}
        <div class="cc-decode-result">${escapeHtml(result.text || '')}</div>
        <button id="cc-copy" class="cc-btn" style="background:#555; color:#fff; margin-top:4px;">Copy Text</button>
    `;

    content.querySelector('#cc-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(result.text || '').then(() => {
            setStatus('Copied to clipboard', 'success');
        });
    });

    // Auto switch to decode tab
    state.tab = 'decode';
    body.querySelectorAll('.cc-tabs button').forEach(b => b.classList.remove('active'));
    body.querySelector('.cc-tabs button[data-tab="decode"]').classList.add('active');
    body.querySelectorAll('.cc-pane').forEach(p => p.classList.remove('active'));
    decodePane.classList.add('active');
    saveState(state);
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

module.exports = { init, show, toggle, setStatus, onEncode, showDecodeResult, getSettings: () => state.settings };