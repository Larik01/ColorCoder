// src/script.js
// Userscript ENTRY POINT. Bundled by esbuild with the core/ modules.
//   Alt+Click a Black sync pixel -> decode message, print to console
//   Alt+M                          -> encode text, inject as unplaced overlay, reload

const { encodeV1, decodeV1, unpackHeader, VERSION } = require('./core/v1.js');
const { readSequenceHorizontal, readPixel } = require('./core/wplace.js');
const { sequenceToPngBlob } = require('./core/render.js');
const { injectTemplate } = require('./core/templates.js');

// ==========================================================
// 1. FETCH SPY (page context) - captures clicked tile/pixel
// ==========================================================
function injectSpy() {
    const s = document.createElement('script');
    s.textContent = `(() => {
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
                        window.postMessage({ type: 'WPLACE_CLICK_DECODE', tileX, tileY, px, py }, '*');
                    }
                }
            } catch (e) {}
            return response;
        };
    })();`;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
}

// ==========================================================
// 2. DECODER (Alt+Click)
// ==========================================================
async function attemptDecode(tileX, tileY, px, py) {
    const head = await readSequenceHorizontal(tileX, tileY, px, py, 4);

    if (head[0] !== 1) {
        const c = await readPixel(tileX, tileY, px, py);
        console.log('[WM] Not a sync pixel (id ' + c.id + ' ' + c.name + '), nothing to decode here.');
        return;
    }

    const header = unpackHeader(head[1], head[2], head[3]);
    if (header.version !== VERSION) {
        console.warn('[WM] Unknown header version ' + header.version + ', cannot decode yet.');
        return;
    }

    const sequence = await readSequenceHorizontal(tileX, tileY, px, py, 4 + header.length);
    const result = decodeV1(sequence);
    if (!result) return;

    const modeStr = result.mode === 0 ? 'Lite' : 'Full';
    if (result.valid) {
        console.log('%c[WM] Decoded ' + modeStr + ' message (' + result.length + ' px, crc OK)',
            'color:#0c8;font-weight:bold');
    } else {
        console.log('%c[WM] Decoded ' + modeStr + ' message (' + result.length +
            ' px) - CORRUPTED (stored crc ' + result.storedChecksum +
            ' != computed ' + result.computedChecksum + ')',
            'color:#c80;font-weight:bold');
    }
    alert((result.valid ? '' : '⚠ CORRUPTED (crc mismatch)\n') + result.text);
    console.log(result.text);
}

let lastClick = { alt: false, t: 0 };
document.addEventListener('click', (e) => {
    lastClick = { alt: e.altKey, t: Date.now() };
}, true);

window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'WPLACE_CLICK_DECODE') return;
    if (!lastClick.alt || Date.now() - lastClick.t > 2000) return;
    attemptDecode(d.tileX, d.tileY, d.px, d.py)
        .catch(err => console.error('[WM] Decode error:', err));
});

// ==========================================================
// 3. ENCODER (Alt+M) - text -> PNG -> unplaced overlay -> reload
// ==========================================================
function isTyping(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

async function makeMessage() {
    const modeRaw = (prompt('Mode: l = Lite (basic chars), f = Full (any UTF-8)', 'l') || '').trim().toLowerCase();
    if (!modeRaw) return;
    const mode = modeRaw.startsWith('f') ? 1 : 0;

    const text = prompt('Message text:');
    if (!text) return;

    const enc = encodeV1(text, mode);
    if (!enc) { alert('Encode failed - character not in Lite alphabet?'); return; }

    const blob = await sequenceToPngBlob(enc.fullSequence);
    const name = 'WM ' + (mode ? 'full' : 'lite') + ': ' + text.slice(0, 24);
    await injectTemplate(blob, name);

    console.log('%c[WM] Injected "' + name + '" (' + enc.length + ' px). Reloading...',
        'color:#0c8;font-weight:bold');
    location.reload(); // pagehide merge wins the race; template is in the list after boot
}

document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    if (isTyping(e.target)) return;
    if (e.code === 'KeyM') {
        makeMessage().catch(err => {
            console.error('[WM] Inject failed:', err);
            alert('Inject failed: ' + err.message);
        });
    }
});

// ==========================================================
// 4. INIT
// ==========================================================
injectSpy();
console.log('%c[WM] Ready. Alt+Click = decode, Alt+M = make message.',
    'color:#0af;font-weight:bold');