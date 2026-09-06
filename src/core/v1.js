const { ALPHABET } = require('./alphabet.js');
const { djb2Checksum5 } = require('./checksum.js');

const START_MARKER = 1;
const VERSION = 0;          // this codec writes version 0
const MAX_PAYLOAD = 1023;   // 10-bit length field

// ---------- payload conversion (same math as lite.js / full.js) ----------

function textToPayloadLite(text) {
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

function payloadToTextLite(payload) {
    let text = '';
    let badChars = false;
    for (const val of payload) {
        if (val < 0 || val >= ALPHABET.length) { badChars = true; text += '?'; continue; }
        text += ALPHABET[val];
    }
    return { text, badChars };
}

function textToPayloadFull(text) {
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

function payloadToTextFull(payload) {
    const bytes = [];
    let buffer = 0, bits = 0;
    for (const val of payload) {
        buffer = (buffer << 6) | val;
        bits += 6;
        while (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xFF); }
    }
    // leftover <8 bits must be zero padding; non-zero = possible corruption
    const badPadding = bits > 0 && (buffer & ((1 << bits) - 1)) !== 0;
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    return { text, badPadding };
}

// ---------- header pack/unpack (18 bits = 3 pixels) ----------
// [ version (2b) | mode (1b) | length (10b) | checksum (5b) ]

function packHeader(version, mode, length, checksum) {
    const headerInt = (version << 16) | (mode << 15) | (length << 5) | checksum;
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

// ---------- encode / decode ----------

function encodeV1(text, mode) {
    const payload = (mode === 0) ? textToPayloadLite(text) : textToPayloadFull(text);
    if (!payload) return null;
    if (payload.length > MAX_PAYLOAD) {
        console.warn('Payload too long: ' + payload.length + ' > ' + MAX_PAYLOAD + ' pixels');
        return null;
    }
    const checksum = checksumFor(VERSION, mode, payload.length, payload);
    const header = packHeader(VERSION, mode, payload.length, checksum);
    return {
        version: VERSION, mode, length: payload.length, checksum,
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

    if (version !== VERSION) {
        console.warn('Unknown header version ' + version + '. This codec only understands V' + VERSION + '.');
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
        const r = payloadToTextLite(payload);
        text = r.text; badChars = r.badChars;
    } else {
        const r = payloadToTextFull(payload);
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

module.exports = {
    encodeV1, decodeV1,
    packHeader, unpackHeader, checksumFor,
    START_MARKER, VERSION, MAX_PAYLOAD
};