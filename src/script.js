// src/script.js
// Userscript ENTRY POINT. Bundled by esbuild with the core/ modules.
//   Alt+Click any sync pixel -> manual decode (V2 windowed first, V1 fallback)
//   Alt+M                    -> legacy V1 encode via prompts
//   Alt+C                    -> toggle GUI
//   Alt+L                    -> scan framebuffer and place labels
//   Alt+Shift+L              -> clear labels
//   Alt+S                    -> counters and registry dump

const { encodeV1, decodeV1, unpackHeader, VERSION,
        encodeV2, decodeV2, unpackHeaderV2, findSyncOffset, PREFIX_LEN } = require('./core/protocol.js');
const { readSequenceHorizontal, readPixel } = require('./core/wplace.js');
const { sequenceToPngBlob, injectTemplate } = require('./core/overlays.js');
const intercept = require('./core/intercept.js');
const labels = require('./core/labels.js');
const gui = require('./core/gui.js');

// ==========================================================
// 1. SINGLE FETCH WRAP: tile intercept + click spy
//    wplace.js captured RAW_FETCH at module eval, before this wrap exists,
//    so all of our own reads bypass everything below.
// ==========================================================
const origFetch = window.fetch;
window.fetch = function (...args) {
    const url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url || '');

    // Branch A: tile PNGs -> autoscan pipeline
    if (url.includes('/files/s0/tiles/') && url.endsWith('.png')) {
        const parts = url.split('?')[0].split('/').filter(Boolean);
        const ty = parseInt(parts[parts.length - 1], 10);
        const tx = parseInt(parts[parts.length - 2], 10);
        if (!isNaN(tx) && !isNaN(ty)) {
            return origFetch.apply(this, args).then(async (res) => {
                if (!res.ok) return res;
                try {
                    const blob = await res.clone().blob();
                    const out = await intercept.processTile(tx, ty, blob);
                    if (out) {
                        return new Response(out, {
                            status: res.status, statusText: res.statusText,
                            headers: { 'Content-Type': 'image/png' }
                        });
                    }
                } catch (e) {
                    console.warn('[CC] intercept failed, passing clean tile', e);
                }
                return res;
            });
        }
    }

    // Branch B: everything else passes through; /pixel/ feeds the click spy
    const response = origFetch.apply(this, args);
    try {
        if (url.includes('/pixel/')) {
            response.then((res) => {
                const p = url.split('?')[0].split('/').filter(Boolean);
                const tileY = parseInt(p[p.length - 1], 10);
                const tileX = parseInt(p[p.length - 2], 10);
                const q = new URLSearchParams(url.split('?')[1] || '');
                const px = parseInt(q.get('x'), 10);
                const py = parseInt(q.get('y'), 10);
                if ([tileX, tileY, px, py].every(n => !isNaN(n))) {
                    window.dispatchEvent(new CustomEvent('cc-click', { detail: { tileX, tileY, px, py } }));
                }
                return res;
            }).catch(() => {});
        }
    } catch (e) {}
    return response;
};

// ==========================================================
// 2. MANUAL DECODER (Alt+Click)
// ==========================================================
const CLICK_INDEX = 3;
const WINDOW_LEN = 11;

function log(msg, style) {
    if (!gui.getSettings().consoleLogs) return;
    if (style) console.log('%c' + msg, style);
    else console.log(msg);
}

function reportDecode(result, tileInfo) {
    const proto = (result.version === 2) ? 'V2' : 'V1';
    let modeStr = (result.mode === 0) ? 'Lite' : 'Full';
    if (result.version === 2) modeStr += result.free ? '-free' : '';
    if (result.valid) {
        log('[CC] Decoded ' + proto + ' ' + modeStr + ' message (' + result.length + ' px, crc OK)',
            'color:#0c8;font-weight:bold');
    } else {
        log('[CC] Decoded ' + proto + ' ' + modeStr + ' message (' + result.length +
            ' px) - CORRUPTED (stored ' + result.storedChecksum +
            ' != computed ' + result.computedChecksum + ')',
            'color:#c80;font-weight:bold');
    }
    log(result.text);
    gui.showDecodeResult(result, tileInfo);
}

async function attemptDecode(tileX, tileY, px, py) {
    const win = await readSequenceHorizontal(tileX, tileY, px - CLICK_INDEX, py, WINDOW_LEN);

    const off = findSyncOffset(win);
    if (off !== -1) {
        const hdr = unpackHeaderV2(win[off + 4], win[off + 5], win[off + 6], win[off + 7]);
        const total = off + PREFIX_LEN + hdr.length;
        const seq = await readSequenceHorizontal(tileX, tileY, px - CLICK_INDEX, py, total);
        const result = decodeV2(seq.slice(off));
        if (!result) return;
        reportDecode(result, { tileX, tileY, px, py });
        return;
    }

    if (win[CLICK_INDEX] === 1) {
        const header = unpackHeader(win[CLICK_INDEX + 1], win[CLICK_INDEX + 2], win[CLICK_INDEX + 3]);
        if (header.version !== VERSION) {
            log('[CC] Unknown V1 header version ' + header.version + ', cannot decode.');
            gui.setStatus('Unknown V1 header version ' + header.version + '.', 'error');
            return;
        }
        const sequence = await readSequenceHorizontal(tileX, tileY, px, py, 4 + header.length);
        const result = decodeV1(sequence);
        if (!result) return;
        reportDecode(result, { tileX, tileY, px, py });
        return;
    }

    const c = await readPixel(tileX, tileY, px, py);
    log('[CC] Not a sync pixel (id ' + c.id + ' ' + c.name + '), nothing to decode here.');
    gui.setStatus('Not a message sync pixel (' + c.name + ').', 'info');
}

let lastClick = { alt: false, t: 0 };
document.addEventListener('click', (e) => {
    lastClick = { alt: e.altKey, t: Date.now() };
}, true);

window.addEventListener('cc-click', (e) => {
    if (!lastClick.alt || Date.now() - lastClick.t > 2000) return;
    const { tileX, tileY, px, py } = e.detail;
    attemptDecode(tileX, tileY, px, py)
        .catch(err => {
            console.error('[CC] Decode error:', err);
            gui.setStatus('Decode error: ' + err.message, 'error');
        });
});

// ==========================================================
// 3. ENCODER (GUI + legacy Alt+M)
// ==========================================================
function isTyping(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

async function executeEncode(text, mode, free, protocol) {
    gui.clearAction();
    gui.setStatus('Encoding and generating PNG...', 'info');

    const enc = (protocol === 2) ? encodeV2(text, mode, free) : encodeV1(text, mode);
    if (!enc) {
        gui.setStatus('Encode failed - character not in Lite alphabet, or message too long.', 'error');
        return;
    }

    try {
        const blob = await sequenceToPngBlob(enc.fullSequence);
        const tag = (protocol === 2 ? 'CC2 ' : 'CC ') +
            (mode ? 'full' : 'lite') +
            (protocol === 2 && free ? '-free' : '') + ': ';
        const name = tag + text.slice(0, 24);
        await injectTemplate(blob, name);

        log('[CC] Injected "' + name + '" (' + enc.length + ' px payload).', 'color:#0c8;font-weight:bold');

        if (gui.getSettings().autoReload) {
            gui.setStatus('Reloading page...', 'info', 0);
            setTimeout(() => location.reload(), 500);
        } else {
            gui.setStatus('Overlay injected: ' + name, 'success');
            gui.showReloadButton();
        }
    } catch (err) {
        console.error('[CC] Inject failed:', err);
        gui.setStatus('Inject failed: ' + err.message, 'error');
    }
}

async function legacyMakeMessage() {
    const modeRaw = (prompt('Mode: l = Lite (basic chars), f = Full (any UTF-8)', 'l') || '').trim().toLowerCase();
    if (!modeRaw) return;
    const mode = modeRaw.startsWith('f') ? 1 : 0;

    const text = prompt('Message text:');
    if (!text) return;

    await executeEncode(text, mode, 0, 1);
}

// ==========================================================
// 4. HOTKEYS
// ==========================================================
document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    if (isTyping(e.target)) return;

    if (e.code === 'KeyM') {
        legacyMakeMessage().catch(err => {
            console.error('[CC] Inject failed:', err);
            gui.setStatus('Inject failed: ' + err.message, 'error');
        });
    }
    if (e.code === 'KeyC') {
        gui.toggle();
    }
    if (e.code === 'KeyL') {
        if (e.shiftKey) { labels.clearLabels(); console.log('[CC] labels cleared'); }
        else labels.scanAndLabel();
        e.preventDefault();
    }
    if (e.code === 'KeyS' && !e.shiftKey) {
        console.log('[CC] SUMMARY ' + JSON.stringify(intercept.DBG) +
            ' registry=' + intercept.registry.size);
        for (const m of intercept.registry.values()) {
            console.log('[CC]   key rgb(' + m.color.join(',') + ') -> @' +
                m.gx + ',' + m.gy + ' "' + m.text + '"');
        }
    }
});

// ==========================================================
// 5. INIT
// ==========================================================
function initApp() {
    gui.init();
    gui.onEncode(executeEncode);
    log('[CC] Ready. Alt+Click = decode, Alt+M = legacy encode, Alt+C = GUI, Alt+L = labels, Alt+S = summary.',
        'color:#0af;font-weight:bold');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}