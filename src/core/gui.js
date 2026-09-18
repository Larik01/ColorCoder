// src/core/gui.js
// Pure DOM/CSS floating panel: encode, decode, overlays manager, settings.
// Fetches user profile on init to determine palette availability.

const { ALPHABET, encodeV1, encodeV2 } = require('./protocol.js');
const labels = require('./labels.js');
const overlays = require('./overlays.js');
const wplace = require('./wplace.js');
const log = require('./log.js');

const LS_KEY = 'colorcoder-gui-state';

const defaultState = {
    x: 20, y: 20, collapsed: false, tab: 'encode',
    enc: { proto: 2, mode: 0, free: 1 },
    settings: { autoReload: false, consoleLogs: true, autoArm: false }
};

function loadState() {
    try {
        const s = Object.assign({}, defaultState, JSON.parse(localStorage.getItem(LS_KEY) || '{}'));
        s.enc = Object.assign({}, defaultState.enc, s.enc);
        s.settings = Object.assign({}, defaultState.settings, s.settings);
        return s;
    } catch (e) {
        const s = Object.assign({}, defaultState);
        s.enc = Object.assign({}, defaultState.enc);
        s.settings = Object.assign({}, defaultState.settings);
        return s;
    }
}
function saveState(state) {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
}

let state = loadState();
let panel, header, body, statusEl, statusTimer = null;
let encodePane, decodePane, settingsPane, managerPane;
let encodeBtn, textArea, liteWarn, previewEl, hintEl;
let onEncodeCb = null;

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
            background: transparent; border: none; color: #888; padding: 4px 8px;
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
        
        /* Circle toggle groups */
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

    decodePane = document.createElement('div');
    decodePane.className = `cc-pane ${state.tab === 'decode' ? 'active' : ''}`;
    decodePane.dataset.tab = 'decode';
    decodePane.innerHTML = `
        <div class="cc-row" style="color:#888; font-size:11px; margin-bottom:10px;">
            Alt+Click any sync pixel: V2 purple row or V1 black marker.
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
        clearAction();
        if (onEncodeCb) {
            onEncodeCb(textArea.value, state.enc.mode, state.enc.free, state.enc.proto);
        }
    });

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
}

// --- Status line and action slot ---

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

function actionSlot() {
    return encodePane ? encodePane.querySelector('#cc-action') : null;
}

function clearAction() {
    const slot = actionSlot();
    if (slot) slot.innerHTML = '';
}

function showReloadButton() {
    const slot = actionSlot();
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

function showMissingColorsWarning(missingIds, onForce) {
    const slot = actionSlot();
    if (!slot) return;
    slot.innerHTML = '';

    const { COLOR_PALETTE } = require('./palette.js');

    const list = document.createElement('div');
    list.style.cssText = 'background:#0f0f11; padding:6px; border:1px solid #e67e22; border-radius:3px; margin-bottom:6px;';

    const header = document.createElement('div');
    header.style.cssText = 'color:#e67e22; font-size:11px; margin-bottom:4px;';
    header.textContent = 'Uses colors you have not unlocked:';
    list.appendChild(header);

    for (const id of missingIds) {
        const c = COLOR_PALETTE[id];
        if (!c) continue;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:11px; color:#e0e0e0;';

        const swatch = document.createElement('div');
        swatch.style.cssText = `width:12px; height:12px; border-radius:2px; border:1px solid #444; background:rgb(${c.rgb.join(',')}); flex-shrink:0;`;

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

// --- Public API ---

function init() {
    if (document.getElementById('cc-panel')) return;
    log.setMuted(!state.settings.consoleLogs);
    createPanel();
}

function show() {
    if (panel) panel.style.display = 'flex';
    if (state.tab === 'manager' && window.refreshTemplateList) window.refreshTemplateList();
}

function toggle() {
    if (!panel) init();
    else panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    if (panel.style.display === 'flex' && state.tab === 'manager' && window.refreshTemplateList) {
        window.refreshTemplateList();
    }
}

function onEncode(cb) { onEncodeCb = cb; }

function showDecodeResult(result, tileInfo) {
    show();

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
        <button id="cc-copy" class="cc-btn" style="background:#555; color:#fff; margin-top:4px;">Copy Text</button>
    `;

    content.querySelector('#cc-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(result.text || '').then(() => {
            setStatus('Copied to clipboard', 'success');
        });
    });

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

module.exports = {
    init, show, toggle, setStatus, onEncode, showDecodeResult,
    clearAction, showReloadButton, showMissingColorsWarning,
    getSettings: () => state.settings
};