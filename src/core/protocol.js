// src/core/protocol.js
// Every wire format ColorCoder speaks, in one place.
// Pure, Node-safe: no DOM, no network, no canvas.
// Sections: alphabet | checksums | shared | V1 codec | V2 codec.

// ==========================================================
// 1. ALPHABET
// ==========================================================
// 62-character alphabet: a-z (26) + 0-9 (10) + space + punctuation (25).
// Lite 6-bit values 62 and 63 are intentionally unused by the encoder;
// they decode as '?' with badChars set, acting as corruption markers.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 .!?-_:;'\"()[]{}@#$%&/=+<>,";
const MAX_PAYLOAD_V2 = 1023

// ==========================================================
// 2. CHECKSUMS (djb2 over binary strings)
// ==========================================================
function djb2Checksum5(binaryString) {
    let hash = 5381;
    for (let i = 0; i < binaryString.length; i++) {
        hash = ((hash << 5) + hash) + binaryString.charCodeAt(i);
        hash = hash | 0; // Force 32-bit integer
    }
    return hash & 0x1F;
}

function djb2Checksum6(binaryString) {
    let hash = 5381;
    for (let i = 0; i < binaryString.length; i++) {
        hash = ((hash << 5) + hash) + binaryString.charCodeAt(i);
        hash = hash | 0;
    }
    return hash & 0x3F;
}

// ==========================================================
// 3. SHARED CONSTANTS
// ==========================================================
const MAX_PAYLOAD = 1023; // 10-bit length field, in PIXELS, both versions

// ==========================================================
// 4. V1 CODEC (legacy, frozen)
//    [ sync=Black ][ 18-bit header: ver2 mode1 len10 crc5 ][ payload ]
// ==========================================================
const START_MARKER = 1;
const VERSION1 = 0; // this codec writes version 0; VERSION below is an alias for old imports

function textToPayloadLiteV1(text) {
    const payload = [];
    for (const ch of text) {
        const idx = ALPHABET.indexOf(ch);
        if (idx === -1) {
            console.warn('Character not in alphabet: "' + ch + '"');
            return null;
        }
        payload.push(idx);
    }
    return payload;
}

function payloadToTextLiteV1(payload) {
    let text = '';
    let badChars = false;
    for (const val of payload) {
        if (val < 0 || val >= ALPHABET.length) { badChars = true; text += '?'; continue; }
        text += ALPHABET[val];
    }
    return { text, badChars };
}

function textToPayloadFullV1(text) {
    const bytes = new TextEncoder().encode(text);
    const payload = [];
    let buffer = 0, bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 6) { bits -= 6; payload.push((buffer >> bits) & 0x3F); }
    }
    if (bits > 0) payload.push((buffer << (6 - bits)) & 0x3F);
    return payload;
}

function payloadToTextFullV1(payload) {
    const bytes = [];
    let buffer = 0, bits = 0;
    for (const val of payload) {
        buffer = (buffer << 6) | val;
        bits += 6;
        while (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xFF); }
    }
    const badPadding = bits > 0 && (buffer & ((1 << bits) - 1)) !== 0;
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    return { text, badPadding };
}

function packHeader(h_version, mode, length, checksum) {
    const headerInt = (h_version << 16) | (mode << 15) | (length << 5) | checksum;
    return [(headerInt >> 12) & 0x3F, (headerInt >> 6) & 0x3F, headerInt & 0x3F];
}

function unpackHeader(h1, h2, h3) {
    const headerInt = (h1 << 12) | (h2 << 6) | h3;
    return {
        version:  (headerInt >> 16) & 0x03,
        mode:     (headerInt >> 15) & 0x01,
        length:   (headerInt >> 5)  & 0x3FF,
        checksum: headerInt & 0x1F
    };
}

// checksum scope: version + mode + length + payload bits
function checksumFor(version, mode, length, payload) {
    const headerBin = version.toString(2).padStart(2, '0')
        + mode.toString(2).padStart(1, '0')
        + length.toString(2).padStart(10, '0');
    const payloadBin = payload.map(v => v.toString(2).padStart(6, '0')).join('');
    return djb2Checksum5(headerBin + payloadBin);
}

function encodeV1(text, mode) {
    const payload = (mode === 0) ? textToPayloadLiteV1(text) : textToPayloadFullV1(text);
    if (!payload) return null;
    if (payload.length > MAX_PAYLOAD) {
        console.warn('Payload too long: ' + payload.length + ' > ' + MAX_PAYLOAD + ' pixels');
        return null;
    }
    const checksum = checksumFor(VERSION1, mode, payload.length, payload);
    const header = packHeader(VERSION1, mode, payload.length, checksum);
    return {
        version: VERSION1, mode, length: payload.length, checksum,
        header, payload,
        fullSequence: [START_MARKER].concat(header, payload),
        text
    };
}

// Warns on corruption but still returns the text (never silently throws away)
function decodeV1(sequence) {
    if (!sequence || sequence.length < 4) {
        console.warn('Sequence too short for V1 (need >= 4 pixels)');
        return null;
    }
    const startMarkerValid = sequence[0] === START_MARKER;
    if (!startMarkerValid) {
        console.warn('Invalid start marker: expected ' + START_MARKER + ', got ' + sequence[0]);
    }

    const { version, mode, length, checksum } = unpackHeader(sequence[1], sequence[2], sequence[3]);

    if (version !== VERSION1) {
        console.warn('Unknown header version ' + version + '. This codec only understands V' + VERSION1 + '.');
        return { version, startMarkerValid, valid: false, unknownVersion: true, text: null };
    }

    const available = sequence.length - 4;
    const truncated = available < length;
    if (truncated) {
        console.warn('Truncated message: header says ' + length + ' px but only ' + available + ' available.');
    }

    const payload = sequence.slice(4, 4 + length);
    const computedChecksum = checksumFor(version, mode, payload.length, payload);
    const valid = (computedChecksum === checksum) && startMarkerValid && !truncated;

    let text, badChars = false, badPadding = false;
    if (mode === 0) {
        const r = payloadToTextLiteV1(payload);
        text = r.text; badChars = r.badChars;
    } else {
        const r = payloadToTextFullV1(payload);
        text = r.text; badPadding = r.badPadding;
    }
    if (badChars) console.warn('Payload contains values outside Lite alphabet; replaced with "?".');
    if (badPadding) console.warn('Non-zero padding bits at end of Full payload (possible corruption).');

    return {
        text, version, mode, length,
        storedChecksum: checksum, computedChecksum,
        valid, startMarkerValid, truncated, badChars, badPadding
    };
}

// ==========================================================
// 5. V2 CODEC
//    [ sync 4 px ][ header 4 px free-color ][ payload 0..1023 px ]
//    header 20 bits: mode1 free1 len10 crc6 reserved2
// ==========================================================
const SYNC = [26, 27, 24, 21]; // Dark Pink, Pink, Purple, Indigo
const SYNC_LEN = SYNC.length;
const HEADER_LEN = 4;
const PREFIX_LEN = SYNC_LEN + HEADER_LEN;
const VERSION2 = 2;
const SPACE_INDEX = ALPHABET.indexOf(' '); // 36

// ---- lite locked: char <-> palette id bijection (space -> Transparent) ----
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

// ---- generic bit packing (MSB-first, zero tail padding) ----
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

// ---- payload conversion, four modes ----
function textToPayloadV2(text, mode, free) {
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

function payloadToTextV2(payload, mode, free) {
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

// ---- header pack/unpack (20 bits = 4 free-color pixels) ----
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

function encodeV2(text, mode, free) {
    mode = mode ? 1 : 0;
    free = free ? 1 : 0;
    const payload = textToPayloadV2(text, mode, free);
    if (!payload) return null;
    if (payload.length > MAX_PAYLOAD) {
        console.warn('Payload too long: ' + payload.length + ' > ' + MAX_PAYLOAD + ' pixels');
        return null;
    }
    const checksum = checksumForV2(mode, free, payload.length, payload);
    const header = packHeaderV2(mode, free, payload.length, checksum);
    return {
        version: VERSION2, mode, free, length: payload.length, checksum,
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

    const r = payloadToTextV2(payload, mode, free);
    if (r.badChars) console.warn('Payload contains values outside Lite alphabet; replaced with "?".');
    if (r.badPadding) console.warn('Non-zero padding bits at end of payload (possible corruption).');
    if (badHeaderColors) console.warn('Header contains non-free color ids (possible corruption).');
    if (reserved !== 0) console.warn('Reserved header bits set (' + reserved + '); newer protocol flags?');

    return {
        text: r.text, version: VERSION2, mode, free, length,
        storedChecksum: checksum, computedChecksum,
        valid, syncValid, truncated,
        badChars: r.badChars, badPadding: r.badPadding,
        badHeaderColors, reserved
    };
}

// ---- sync search for windowed Alt+Click ----
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
    // shared
    ALPHABET, MAX_PAYLOAD,
    djb2Checksum5, djb2Checksum6,
    // V1
    START_MARKER, VERSION1, VERSION: VERSION1,
    encodeV1, decodeV1, packHeader, unpackHeader, checksumFor,
    // V2
    SYNC, SYNC_LEN, HEADER_LEN, PREFIX_LEN, VERSION2, MAX_PAYLOAD_V2,
    encodeV2, decodeV2, packHeaderV2, unpackHeaderV2, checksumForV2,
    packBits, unpackBits, charToIdLite, idToCharLite, findSyncOffset
};