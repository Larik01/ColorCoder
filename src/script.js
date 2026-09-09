// src/script.js
// Userscript ENTRY POINT.
// Runs at document-start. Wraps fetch immediately.
// Mounts GUI when DOM is ready.

const { encodeV1, decodeV1, unpackHeader, VERSION } = require('./core/v1.js');
const { readSequenceHorizontal, readPixel } = require('./core/wplace.js');
const { sequenceToPngBlob } = require('./core/render.js');
const { injectTemplate } = require('./core/templates.js');
const gui = require('./core/gui.js');

// ==========================================================
// 1. FETCH SPY (direct wrap, runs at document-start)
// ==========================================================
const origFetch = window.fetch;
window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
        const url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url || '');
        if (url.includes('/pixel/')) {
            const parts = url.split('?')[0].split('/').filter(Boolean);
            const tileY = parseInt(parts[parts.length - 1], 10);
            const tileX = parseInt(parts[parts.length - 2], 10);
            const q = new URLSearchParams(url.split('?')[1] || '');
            const px = parseInt(q.get('x'), 10);
            const py = parseInt(q.get('y'), 10);
            if ([tileX, tileY, px, py].every(n => !isNaN(n))) {
                window.dispatchEvent(new CustomEvent('cc-click', { detail: { tileX, tileY, px, py } }));
            }
        }
    } catch (e) {}
    return response;
};

// ==========================================================
// 2. DECODER (Alt+Click)
// ==========================================================
async function attemptDecode(tileX, tileY, px, py) {
    const head = await readSequenceHorizontal(tileX, tileY, px, py, 4);

    if (head[0] !== 1) {
        const c = await readPixel(tileX, tileY, px, py);
        if (gui.getSettings().consoleLogs) {
            console.log('[CC] Not a sync pixel (id ' + c.id + ' ' + c.name + '), nothing to decode here.');
        }
        return;
    }

    const header = unpackHeader(head[1], head[2], head[3]);
    if (header.version !== VERSION) {
        if (gui.getSettings().consoleLogs) console.warn('[CC] Unknown header version ' + header.version + ', cannot decode yet.');
        gui.setStatus('Unknown V' + header.version + ' protocol. Cannot decode.', 'error');
        return;
    }

    const sequence = await readSequenceHorizontal(tileX, tileY, px, py, 4 + header.length);
    const result = decodeV1(sequence);
    if (!result) return;

    const modeStr = result.mode === 0 ? 'Lite' : 'Full';
    if (gui.getSettings().consoleLogs) {
        if (result.valid) {
            console.log('%c[CC] Decoded ' + modeStr + ' message (' + result.length + ' px, crc OK)', 'color:#0c8;font-weight:bold');
        } else {
            console.log('%c[CC] Decoded ' + modeStr + ' message (' + result.length + ' px) - CORRUPTED', 'color:#c80;font-weight:bold');
        }
        console.log(result.text);
    }

    // Show in GUI instead of alert
    gui.showDecodeResult(result, { tileX, tileY, px, py });
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
// 3. ENCODER (GUI + Legacy Alt+M)
// ==========================================================
function isTyping(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

async function executeEncode(text, mode) {
    gui.setStatus('Encoding and generating PNG...', 'info');

    const enc = encodeV1(text, mode);
    if (!enc) {
        gui.setStatus('Encode failed - check text and mode.', 'error');
        return;
    }

    try {
        const blob = await sequenceToPngBlob(enc.fullSequence);
        const name = 'CC ' + (mode ? 'full' : 'lite') + ': ' + text.slice(0, 24);
        await injectTemplate(blob, name);

        gui.setStatus('Overlay injected: ' + name, 'success');
        if (gui.getSettings().consoleLogs) {
            console.log('%c[CC] Injected "' + name + '" (' + enc.length + ' px).', 'color:#0c8;font-weight:bold');
        }

        if (gui.getSettings().autoReload) {
            gui.setStatus('Reloading page...', 'info');
            setTimeout(() => location.reload(), 500);
        } else {
            // Add a reload button manually to the status area if not auto-reloading
            const btn = document.createElement('button');
            btn.textContent = 'Reload Now';
            btn.style.cssText = 'margin-top:6px; background:#7fffd4; color:#000; border:none; padding:4px 8px; cursor:pointer; font-weight:bold; width:100%; border-radius:3px;';
            btn.onclick = () => location.reload();
            document.querySelector('.cc-status').appendChild(btn);
        }
    } catch (err) {
        console.error('[CC] Inject failed:', err);
        gui.setStatus('Inject failed: ' + err.message, 'error');
    }
}

// Legacy Alt+M (still works, triggers same encode logic via prompt)
async function legacyMakeMessage() {
    const modeRaw = (prompt('Mode: l = Lite (basic chars), f = Full (any UTF-8)', 'l') || '').trim().toLowerCase();
    if (!modeRaw) return;
    const mode = modeRaw.startsWith('f') ? 1 : 0;

    const text = prompt('Message text:');
    if (!text) return;

    await executeEncode(text, mode);
}

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
});

// ==========================================================
// 4. INIT
// ==========================================================
function initApp() {
    gui.init();
    gui.onEncode(executeEncode);

    if (gui.getSettings().consoleLogs) {
        console.log('%c[CC] Ready. Alt+Click = decode, Alt+M = legacy encode, Alt+C = toggle GUI.', 'color:#0af;font-weight:bold');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}