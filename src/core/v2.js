// src/core/v2.js
// V2 protocol codec. NO Node dependencies beyond pure modules.
// Layout: [sync 4][header 4][payload 0..1023]
//   sync   : exact free-color row [26, 27, 24, 21] (Dark Pink, Pink, Purple, Indigo).
//            Other permutations of these four are reserved protocol handshakes.
//   header : 4 free-color pixels, 5 bits each = 20 bits:
//            mode(1) | free(1) | length(10) | crc(6) | reserved(2)
//   payload: mode 0 lite, locked : 1 px = 1 char, space -> Transparent (id 0)
//            mode 0 lite, free   : 6-bit alphabet indices packed into 5-bit pixels
//            mode 1 full, locked : UTF-8 bytes packed into 6-bit pixels
//            mode 1 full, free   : UTF-8 bytes packed into 5-bit pixels
// Free pixels carry their value as palette id directly (free set = ids 0..31).

const { ALPHABET } = require('./alphabet.js');
const { djb2Checksum6 } = require('./checksum.js');

const SYNC = [26, 27, 24, 21];
const SYNC_LEN = SYNC.length;          // 4
const HEADER_LEN = 4;
const PREFIX_LEN = SYNC_LEN + HEADER_LEN; // 8
const MAX_PAYLOAD = 1023;              // 10-bit length field
const VERSION = 2;

// ---------- lite locked: char <-> palette id bijection (space -> Transparent) ----------
const SPACE_INDEX = ALPHABET.indexOf(' '); // 36

function charToIdLite(ch) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return -1;
    if (idx === SPACE_INDEX) return 0;
    return idx < SPACE_INDEX ? idx + 1 : idx;
}

function idToCharLite(id) {
    let idx;
    if (id === 0) idx = SPACE_INDEX;
    else if (id <= SPACE_INDEX) idx = id - 1;
    else idx = id;
    const ch = ALPHABET[idx];
    return ch !== undefined ? ch : '?';
}

// ---------- generic bit packing (MSB-first, zero tail padding) ----------
function packBits(values, bitsPerValue, bitsPerPixel) {
    const vMask = (1 << bitsPerValue) - 1;
    const pMask = (1 << bitsPerPixel) - 1;
    const pixels = [];
    let buffer = 0, bits = 0;
    for (const v of values) {
        buffer = (buffer << bitsPerValue) | (v & vMask);
        bits += bitsPerValue;
        while (bits >= bitsPerPixel) {
            bits -= bitsPerPixel;
            pixels.push((buffer >> bits) & pMask);
        }
    }
    if (bits > 0) pixels.push((buffer << (bitsPerPixel - bits)) & pMask);
    return pixels;
}

function unpackBits(pixels, bitsPerPixel, bitsPerValue) {
    const pMask = (1 << bitsPerPixel) - 1;
    const vMask = (1 << bitsPerValue) - 1;
    const values = [];
    let buffer = 0, bits = 0;
    for (const p of pixels) {
        buffer = (buffer << bitsPerPixel) | (p & pMask);
        bits += bitsPerPixel;
        while (bits >= bitsPerValue) {
            bits -= bitsPerValue;
            values.push((buffer >> bits) & vMask);
        }
    }
    const leftover = bits;
    const padBits = leftover > 0 ? (buffer & ((1 << leftover) - 1)) : 0;
    return { values, leftover, padBits };
}

// ---------- payload conversion ----------
function textToPayload(text, mode, free) {
    if (mode === 0) {
        if (!free) {
            const pixels = [];
            for (const ch of text) {
                const id = charToIdLite(ch);
                if (id === -1) {
                    console.warn('Character not in alphabet: "' + ch + '"');
                    return null;
                }
                pixels.push(id);
            }
            return pixels;
        }
        const indices = [];
        for (const ch of text) {
            const idx = ALPHABET.indexOf(ch);
            if (idx === -1) {
                console.warn('Character not in alphabet: "' + ch + '"');
                return null;
            }
            indices.push(idx);
        }
        return packBits(indices, 6, 5);
    }
    const bytes = Array.from(new TextEncoder().encode(text));
    return packBits(bytes, 8, free ? 5 : 6);
}

function payloadToText(payload, mode, free) {
    let badChars = false, badPadding = false;
    if (mode === 0) {
        if (!free) {
            let text = '';
            for (const id of payload) {
                const ch = idToCharLite(id);
                if (ch === '?') badChars = true;
                text += ch;
            }
            return { text, badChars, badPadding };
        }
        const r = unpackBits(payload, 5, 6);
        badPadding = r.padBits !== 0;
        let text = '';
        for (const v of r.values) {
            if (v < 0 || v >= ALPHABET.length) { badChars = true; text += '?'; continue; }
            text += ALPHABET[v];
        }
        return { text, badChars, badPadding };
    }
    const r = unpackBits(payload, free ? 5 : 6, 8);
    badPadding = r.padBits !== 0;
    const text = new TextDecoder().decode(new Uint8Array(r.values));
    return { text, badChars, badPadding };
}

// ---------- header pack/unpack (20 bits = 4 free-color pixels) ----------
// [ mode(1) | free(1) | length(10) | crc(6) | reserved(2) ]

function packHeaderV2(mode, free, length, checksum) {
    const h = ((mode & 1) << 19) | ((free & 1) << 18) | ((length & 0x3FF) << 8) |
              ((checksum & 0x3F) << 2);
    return [(h >> 15) & 0x1F, (h >> 10) & 0x1F, (h >> 5) & 0x1F, h & 0x1F];
}

function unpackHeaderV2(p0, p1, p2, p3) {
    const badHeaderColors = (p0 > 31 || p1 > 31 || p2 > 31 || p3 > 31);
    const h = ((p0 & 0x1F) << 15) | ((p1 & 0x1F) << 10) | ((p2 & 0x1F) << 5) | (p3 & 0x1F);
    return {
        mode:     (h >> 19) & 1,
        free:     (h >> 18) & 1,
        length:   (h >> 8) & 0x3FF,
        checksum: (h >> 2) & 0x3F,
        reserved: h & 3,
        badHeaderColors
    };
}

// crc scope: mode + free + length bits, then transmitted payload pixel bits
function checksumForV2(mode, free, length, payload) {
    const bpp = free ? 5 : 6;
    const headerBin = (mode & 1).toString(2) + (free & 1).toString(2) +
        length.toString(2).padStart(10, '0');
    const payloadBin = payload.map(v => v.toString(2).padStart(bpp, '0')).join('');
    return djb2Checksum6(headerBin + payloadBin);
}

// ---------- encode / decode ----------

function encodeV2(text, mode, free) {
    mode = mode ? 1 : 0;
    free = free ? 1 : 0;
    const payload = textToPayload(text, mode, free);
    if (!payload) return null;
    if (payload.length > MAX_PAYLOAD) {
        console.warn('Payload too long: ' + payload.length + ' > ' + MAX_PAYLOAD + ' pixels');
        return null;
    }
    const checksum = checksumForV2(mode, free, payload.length, payload);
    const header = packHeaderV2(mode, free, payload.length, checksum);
    return {
        version: VERSION, mode, free, length: payload.length, checksum,
        header, payload,
        fullSequence: SYNC.concat(header, payload),
        text
    };
}

// Warns on corruption but still returns the text (never silently throws away)
function decodeV2(sequence) {
    if (!sequence || sequence.length < PREFIX_LEN) {
        console.warn('Sequence too short for V2 (need >= ' + PREFIX_LEN + ' pixels)');
        return null;
    }
    let syncValid = true;
    for (let i = 0; i < SYNC_LEN; i++) {
        if (sequence[i] !== SYNC[i]) { syncValid = false; break; }
    }
    if (!syncValid) console.warn('Invalid V2 sync pattern.');

    const hdr = unpackHeaderV2(sequence[4], sequence[5], sequence[6], sequence[7]);
    const mode = hdr.mode, free = hdr.free, length = hdr.length,
          checksum = hdr.checksum, reserved = hdr.reserved,
          badHeaderColors = hdr.badHeaderColors;

    const available = sequence.length - PREFIX_LEN;
    const truncated = available < length;
    if (truncated) {
        console.warn('Truncated message: header says ' + length + ' px but only ' + available + ' available.');
    }

    const payload = sequence.slice(PREFIX_LEN, PREFIX_LEN + length);
    const computedChecksum = checksumForV2(mode, free, payload.length, payload);
    const valid = syncValid && !truncated && (computedChecksum === checksum);

    const r = payloadToText(payload, mode, free);
    if (r.badChars) console.warn('Payload contains values outside Lite alphabet; replaced with "?".');
    if (r.badPadding) console.warn('Non-zero padding bits at end of payload (possible corruption).');
    if (badHeaderColors) console.warn('Header contains non-free color ids (possible corruption).');
    if (reserved !== 0) console.warn('Reserved header bits set (' + reserved + '); newer protocol flags?');

    return {
        text: r.text, version: VERSION, mode, free, length,
        storedChecksum: checksum, computedChecksum,
        valid, syncValid, truncated,
        badChars: r.badChars, badPadding: r.badPadding,
        badHeaderColors, reserved
    };
}

// ---------- sync search for windowed Alt+Click ----------
// Returns offset of SYNC inside an id window, or -1.
function findSyncOffset(ids) {
    if (!ids || ids.length < SYNC_LEN) return -1;
    for (let off = 0; off <= ids.length - SYNC_LEN; off++) {
        let ok = true;
        for (let i = 0; i < SYNC_LEN; i++) {
            if (ids[off + i] !== SYNC[i]) { ok = false; break; }
        }
        if (ok) return off;
    }
    return -1;
}

module.exports = {
    encodeV2, decodeV2,
    packHeaderV2, unpackHeaderV2, checksumForV2,
    packBits, unpackBits,
    charToIdLite, idToCharLite,
    findSyncOffset,
    SYNC, SYNC_LEN, HEADER_LEN, PREFIX_LEN, MAX_PAYLOAD, VERSION
};