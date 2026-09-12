// ==UserScript==
// @name         ColorCoder
// @namespace    color-coder
// @version      0.2.0
// @description  Encodes and decodes hidden pixel messages on wplace.live.
// @author       Larik01
// @match        https://wplace.live/*
// @run-at       document-start
// @noframes
// @grant        none
// @license      GPL-3.0
// ==/UserScript==
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/core/protocol.js
  var require_protocol = __commonJS({
    "src/core/protocol.js"(exports, module) {
      var ALPHABET = `abcdefghijklmnopqrstuvwxyz0123456789 .!?-_:;'"()[]{}@#$%&/=+<>`;
      function djb2Checksum5(binaryString) {
        let hash = 5381;
        for (let i = 0; i < binaryString.length; i++) {
          hash = (hash << 5) + hash + binaryString.charCodeAt(i);
          hash = hash | 0;
        }
        return hash & 31;
      }
      function djb2Checksum6(binaryString) {
        let hash = 5381;
        for (let i = 0; i < binaryString.length; i++) {
          hash = (hash << 5) + hash + binaryString.charCodeAt(i);
          hash = hash | 0;
        }
        return hash & 63;
      }
      var MAX_PAYLOAD = 1023;
      var START_MARKER = 1;
      var VERSION1 = 0;
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
        let text = "";
        let badChars = false;
        for (const val of payload) {
          if (val < 0 || val >= ALPHABET.length) {
            badChars = true;
            text += "?";
            continue;
          }
          text += ALPHABET[val];
        }
        return { text, badChars };
      }
      function textToPayloadFullV1(text) {
        const bytes = new TextEncoder().encode(text);
        const payload = [];
        let buffer = 0, bits = 0;
        for (const byte of bytes) {
          buffer = buffer << 8 | byte;
          bits += 8;
          while (bits >= 6) {
            bits -= 6;
            payload.push(buffer >> bits & 63);
          }
        }
        if (bits > 0)
          payload.push(buffer << 6 - bits & 63);
        return payload;
      }
      function payloadToTextFullV1(payload) {
        const bytes = [];
        let buffer = 0, bits = 0;
        for (const val of payload) {
          buffer = buffer << 6 | val;
          bits += 6;
          while (bits >= 8) {
            bits -= 8;
            bytes.push(buffer >> bits & 255);
          }
        }
        const badPadding = bits > 0 && (buffer & (1 << bits) - 1) !== 0;
        const text = new TextDecoder().decode(new Uint8Array(bytes));
        return { text, badPadding };
      }
      function packHeader(h_version, mode, length, checksum) {
        const headerInt = h_version << 16 | mode << 15 | length << 5 | checksum;
        return [headerInt >> 12 & 63, headerInt >> 6 & 63, headerInt & 63];
      }
      function unpackHeader2(h1, h2, h3) {
        const headerInt = h1 << 12 | h2 << 6 | h3;
        return {
          version: headerInt >> 16 & 3,
          mode: headerInt >> 15 & 1,
          length: headerInt >> 5 & 1023,
          checksum: headerInt & 31
        };
      }
      function checksumFor(version, mode, length, payload) {
        const headerBin = version.toString(2).padStart(2, "0") + mode.toString(2).padStart(1, "0") + length.toString(2).padStart(10, "0");
        const payloadBin = payload.map((v) => v.toString(2).padStart(6, "0")).join("");
        return djb2Checksum5(headerBin + payloadBin);
      }
      function encodeV12(text, mode) {
        const payload = mode === 0 ? textToPayloadLiteV1(text) : textToPayloadFullV1(text);
        if (!payload)
          return null;
        if (payload.length > MAX_PAYLOAD) {
          console.warn("Payload too long: " + payload.length + " > " + MAX_PAYLOAD + " pixels");
          return null;
        }
        const checksum = checksumFor(VERSION1, mode, payload.length, payload);
        const header = packHeader(VERSION1, mode, payload.length, checksum);
        return {
          version: VERSION1,
          mode,
          length: payload.length,
          checksum,
          header,
          payload,
          fullSequence: [START_MARKER].concat(header, payload),
          text
        };
      }
      function decodeV12(sequence) {
        if (!sequence || sequence.length < 4) {
          console.warn("Sequence too short for V1 (need >= 4 pixels)");
          return null;
        }
        const startMarkerValid = sequence[0] === START_MARKER;
        if (!startMarkerValid) {
          console.warn("Invalid start marker: expected " + START_MARKER + ", got " + sequence[0]);
        }
        const { version, mode, length, checksum } = unpackHeader2(sequence[1], sequence[2], sequence[3]);
        if (version !== VERSION1) {
          console.warn("Unknown header version " + version + ". This codec only understands V" + VERSION1 + ".");
          return { version, startMarkerValid, valid: false, unknownVersion: true, text: null };
        }
        const available = sequence.length - 4;
        const truncated = available < length;
        if (truncated) {
          console.warn("Truncated message: header says " + length + " px but only " + available + " available.");
        }
        const payload = sequence.slice(4, 4 + length);
        const computedChecksum = checksumFor(version, mode, payload.length, payload);
        const valid = computedChecksum === checksum && startMarkerValid && !truncated;
        let text, badChars = false, badPadding = false;
        if (mode === 0) {
          const r = payloadToTextLiteV1(payload);
          text = r.text;
          badChars = r.badChars;
        } else {
          const r = payloadToTextFullV1(payload);
          text = r.text;
          badPadding = r.badPadding;
        }
        if (badChars)
          console.warn('Payload contains values outside Lite alphabet; replaced with "?".');
        if (badPadding)
          console.warn("Non-zero padding bits at end of Full payload (possible corruption).");
        return {
          text,
          version,
          mode,
          length,
          storedChecksum: checksum,
          computedChecksum,
          valid,
          startMarkerValid,
          truncated,
          badChars,
          badPadding
        };
      }
      var SYNC = [26, 27, 24, 21];
      var SYNC_LEN = SYNC.length;
      var HEADER_LEN = 4;
      var PREFIX_LEN2 = SYNC_LEN + HEADER_LEN;
      var VERSION2 = 2;
      var SPACE_INDEX = ALPHABET.indexOf(" ");
      function charToIdLite(ch) {
        const idx = ALPHABET.indexOf(ch);
        if (idx === -1)
          return -1;
        if (idx === SPACE_INDEX)
          return 0;
        return idx < SPACE_INDEX ? idx + 1 : idx;
      }
      function idToCharLite(id) {
        let idx;
        if (id === 0)
          idx = SPACE_INDEX;
        else if (id <= SPACE_INDEX)
          idx = id - 1;
        else
          idx = id;
        const ch = ALPHABET[idx];
        return ch !== void 0 ? ch : "?";
      }
      function packBits(values, bitsPerValue, bitsPerPixel) {
        const vMask = (1 << bitsPerValue) - 1;
        const pMask = (1 << bitsPerPixel) - 1;
        const pixels = [];
        let buffer = 0, bits = 0;
        for (const v of values) {
          buffer = buffer << bitsPerValue | v & vMask;
          bits += bitsPerValue;
          while (bits >= bitsPerPixel) {
            bits -= bitsPerPixel;
            pixels.push(buffer >> bits & pMask);
          }
        }
        if (bits > 0)
          pixels.push(buffer << bitsPerPixel - bits & pMask);
        return pixels;
      }
      function unpackBits(pixels, bitsPerPixel, bitsPerValue) {
        const pMask = (1 << bitsPerPixel) - 1;
        const vMask = (1 << bitsPerValue) - 1;
        const values = [];
        let buffer = 0, bits = 0;
        for (const p of pixels) {
          buffer = buffer << bitsPerPixel | p & pMask;
          bits += bitsPerPixel;
          while (bits >= bitsPerValue) {
            bits -= bitsPerValue;
            values.push(buffer >> bits & vMask);
          }
        }
        const leftover = bits;
        const padBits = leftover > 0 ? buffer & (1 << leftover) - 1 : 0;
        return { values, leftover, padBits };
      }
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
            let text3 = "";
            for (const id of payload) {
              const ch = idToCharLite(id);
              if (ch === "?")
                badChars = true;
              text3 += ch;
            }
            return { text: text3, badChars, badPadding };
          }
          const r2 = unpackBits(payload, 5, 6);
          badPadding = r2.padBits !== 0;
          let text2 = "";
          for (const v of r2.values) {
            if (v < 0 || v >= ALPHABET.length) {
              badChars = true;
              text2 += "?";
              continue;
            }
            text2 += ALPHABET[v];
          }
          return { text: text2, badChars, badPadding };
        }
        const r = unpackBits(payload, free ? 5 : 6, 8);
        badPadding = r.padBits !== 0;
        const text = new TextDecoder().decode(new Uint8Array(r.values));
        return { text, badChars, badPadding };
      }
      function packHeaderV2(mode, free, length, checksum) {
        const h = (mode & 1) << 19 | (free & 1) << 18 | (length & 1023) << 8 | (checksum & 63) << 2;
        return [h >> 15 & 31, h >> 10 & 31, h >> 5 & 31, h & 31];
      }
      function unpackHeaderV22(p0, p1, p2, p3) {
        const badHeaderColors = p0 > 31 || p1 > 31 || p2 > 31 || p3 > 31;
        const h = (p0 & 31) << 15 | (p1 & 31) << 10 | (p2 & 31) << 5 | p3 & 31;
        return {
          mode: h >> 19 & 1,
          free: h >> 18 & 1,
          length: h >> 8 & 1023,
          checksum: h >> 2 & 63,
          reserved: h & 3,
          badHeaderColors
        };
      }
      function checksumForV2(mode, free, length, payload) {
        const bpp = free ? 5 : 6;
        const headerBin = (mode & 1).toString(2) + (free & 1).toString(2) + length.toString(2).padStart(10, "0");
        const payloadBin = payload.map((v) => v.toString(2).padStart(bpp, "0")).join("");
        return djb2Checksum6(headerBin + payloadBin);
      }
      function encodeV22(text, mode, free) {
        mode = mode ? 1 : 0;
        free = free ? 1 : 0;
        const payload = textToPayloadV2(text, mode, free);
        if (!payload)
          return null;
        if (payload.length > MAX_PAYLOAD) {
          console.warn("Payload too long: " + payload.length + " > " + MAX_PAYLOAD + " pixels");
          return null;
        }
        const checksum = checksumForV2(mode, free, payload.length, payload);
        const header = packHeaderV2(mode, free, payload.length, checksum);
        return {
          version: VERSION2,
          mode,
          free,
          length: payload.length,
          checksum,
          header,
          payload,
          fullSequence: SYNC.concat(header, payload),
          text
        };
      }
      function decodeV22(sequence) {
        if (!sequence || sequence.length < PREFIX_LEN2) {
          console.warn("Sequence too short for V2 (need >= " + PREFIX_LEN2 + " pixels)");
          return null;
        }
        let syncValid = true;
        for (let i = 0; i < SYNC_LEN; i++) {
          if (sequence[i] !== SYNC[i]) {
            syncValid = false;
            break;
          }
        }
        if (!syncValid)
          console.warn("Invalid V2 sync pattern.");
        const hdr = unpackHeaderV22(sequence[4], sequence[5], sequence[6], sequence[7]);
        const mode = hdr.mode, free = hdr.free, length = hdr.length, checksum = hdr.checksum, reserved = hdr.reserved, badHeaderColors = hdr.badHeaderColors;
        const available = sequence.length - PREFIX_LEN2;
        const truncated = available < length;
        if (truncated) {
          console.warn("Truncated message: header says " + length + " px but only " + available + " available.");
        }
        const payload = sequence.slice(PREFIX_LEN2, PREFIX_LEN2 + length);
        const computedChecksum = checksumForV2(mode, free, payload.length, payload);
        const valid = syncValid && !truncated && computedChecksum === checksum;
        const r = payloadToTextV2(payload, mode, free);
        if (r.badChars)
          console.warn('Payload contains values outside Lite alphabet; replaced with "?".');
        if (r.badPadding)
          console.warn("Non-zero padding bits at end of payload (possible corruption).");
        if (badHeaderColors)
          console.warn("Header contains non-free color ids (possible corruption).");
        if (reserved !== 0)
          console.warn("Reserved header bits set (" + reserved + "); newer protocol flags?");
        return {
          text: r.text,
          version: VERSION2,
          mode,
          free,
          length,
          storedChecksum: checksum,
          computedChecksum,
          valid,
          syncValid,
          truncated,
          badChars: r.badChars,
          badPadding: r.badPadding,
          badHeaderColors,
          reserved
        };
      }
      function findSyncOffset2(ids) {
        if (!ids || ids.length < SYNC_LEN)
          return -1;
        for (let off = 0; off <= ids.length - SYNC_LEN; off++) {
          let ok = true;
          for (let i = 0; i < SYNC_LEN; i++) {
            if (ids[off + i] !== SYNC[i]) {
              ok = false;
              break;
            }
          }
          if (ok)
            return off;
        }
        return -1;
      }
      module.exports = {
        // shared
        ALPHABET,
        MAX_PAYLOAD,
        djb2Checksum5,
        djb2Checksum6,
        // V1
        START_MARKER,
        VERSION1,
        VERSION: VERSION1,
        encodeV1: encodeV12,
        decodeV1: decodeV12,
        packHeader,
        unpackHeader: unpackHeader2,
        checksumFor,
        // V2
        SYNC,
        SYNC_LEN,
        HEADER_LEN,
        PREFIX_LEN: PREFIX_LEN2,
        VERSION2,
        encodeV2: encodeV22,
        decodeV2: decodeV22,
        packHeaderV2,
        unpackHeaderV2: unpackHeaderV22,
        checksumForV2,
        packBits,
        unpackBits,
        charToIdLite,
        idToCharLite,
        findSyncOffset: findSyncOffset2
      };
    }
  });

  // src/core/palette.js
  var require_palette = __commonJS({
    "src/core/palette.js"(exports, module) {
      var COLOR_PALETTE = [
        { id: 0, name: "Transparent", rgb: [0, 0, 0], premium: false },
        { id: 1, name: "Black", rgb: [0, 0, 0], premium: false },
        { id: 2, name: "Dark Gray", rgb: [60, 60, 60], premium: false },
        { id: 3, name: "Gray", rgb: [120, 120, 120], premium: false },
        { id: 4, name: "Light Gray", rgb: [210, 210, 210], premium: false },
        { id: 5, name: "White", rgb: [255, 255, 255], premium: false },
        { id: 6, name: "Deep Red", rgb: [96, 0, 24], premium: false },
        { id: 7, name: "Red", rgb: [237, 28, 36], premium: false },
        { id: 8, name: "Orange", rgb: [255, 127, 39], premium: false },
        { id: 9, name: "Gold", rgb: [246, 170, 9], premium: false },
        { id: 10, name: "Yellow", rgb: [249, 221, 59], premium: false },
        { id: 11, name: "Light Yellow", rgb: [255, 250, 188], premium: false },
        { id: 12, name: "Dark Green", rgb: [14, 185, 104], premium: false },
        { id: 13, name: "Green", rgb: [19, 230, 123], premium: false },
        { id: 14, name: "Light Green", rgb: [135, 255, 94], premium: false },
        { id: 15, name: "Dark Teal", rgb: [12, 129, 110], premium: false },
        { id: 16, name: "Teal", rgb: [16, 174, 166], premium: false },
        { id: 17, name: "Light Teal", rgb: [19, 225, 190], premium: false },
        { id: 18, name: "Dark Blue", rgb: [40, 80, 158], premium: false },
        { id: 19, name: "Blue", rgb: [64, 147, 228], premium: false },
        { id: 20, name: "Cyan", rgb: [96, 247, 242], premium: false },
        { id: 21, name: "Indigo", rgb: [107, 80, 246], premium: false },
        { id: 22, name: "Light Indigo", rgb: [153, 177, 251], premium: false },
        { id: 23, name: "Dark Purple", rgb: [120, 12, 153], premium: false },
        { id: 24, name: "Purple", rgb: [170, 56, 185], premium: false },
        { id: 25, name: "Light Purple", rgb: [224, 159, 249], premium: false },
        { id: 26, name: "Dark Pink", rgb: [203, 0, 122], premium: false },
        { id: 27, name: "Pink", rgb: [236, 31, 128], premium: false },
        { id: 28, name: "Light Pink", rgb: [243, 141, 169], premium: false },
        { id: 29, name: "Dark Brown", rgb: [104, 70, 52], premium: false },
        { id: 30, name: "Brown", rgb: [149, 104, 42], premium: false },
        { id: 31, name: "Beige", rgb: [248, 178, 119], premium: false },
        { id: 32, name: "Medium Gray", rgb: [170, 170, 170], premium: true },
        { id: 33, name: "Dark Red", rgb: [165, 14, 30], premium: true },
        { id: 34, name: "Light Red", rgb: [250, 128, 114], premium: true },
        { id: 35, name: "Dark Orange", rgb: [228, 92, 26], premium: true },
        { id: 36, name: "Light Tan", rgb: [214, 181, 148], premium: true },
        { id: 37, name: "Dark Goldenrod", rgb: [156, 132, 49], premium: true },
        { id: 38, name: "Goldenrod", rgb: [197, 173, 49], premium: true },
        { id: 39, name: "Light Goldenrod", rgb: [232, 212, 95], premium: true },
        { id: 40, name: "Dark Olive", rgb: [74, 107, 58], premium: true },
        { id: 41, name: "Olive", rgb: [90, 148, 74], premium: true },
        { id: 42, name: "Light Olive", rgb: [132, 197, 115], premium: true },
        { id: 43, name: "Dark Cyan", rgb: [15, 121, 159], premium: true },
        { id: 44, name: "Light Cyan", rgb: [187, 250, 242], premium: true },
        { id: 45, name: "Light Blue", rgb: [125, 199, 255], premium: true },
        { id: 46, name: "Dark Indigo", rgb: [77, 49, 184], premium: true },
        { id: 47, name: "Dark Slate Blue", rgb: [74, 66, 132], premium: true },
        { id: 48, name: "Slate Blue", rgb: [122, 113, 196], premium: true },
        { id: 49, name: "Light Slate Blue", rgb: [181, 174, 241], premium: true },
        { id: 50, name: "Light Brown", rgb: [219, 164, 99], premium: true },
        { id: 51, name: "Dark Beige", rgb: [209, 128, 81], premium: true },
        { id: 52, name: "Light Beige", rgb: [255, 197, 165], premium: true },
        { id: 53, name: "Dark Peach", rgb: [155, 82, 73], premium: true },
        { id: 54, name: "Peach", rgb: [209, 128, 120], premium: true },
        { id: 55, name: "Light Peach", rgb: [250, 182, 164], premium: true },
        { id: 56, name: "Dark Tan", rgb: [123, 99, 82], premium: true },
        { id: 57, name: "Tan", rgb: [156, 132, 107], premium: true },
        { id: 58, name: "Dark Slate", rgb: [51, 57, 65], premium: true },
        { id: 59, name: "Slate", rgb: [109, 117, 141], premium: true },
        { id: 60, name: "Light Slate", rgb: [179, 185, 209], premium: true },
        { id: 61, name: "Dark Stone", rgb: [109, 100, 63], premium: true },
        { id: 62, name: "Stone", rgb: [148, 140, 107], premium: true },
        { id: 63, name: "Light Stone", rgb: [205, 197, 158], premium: true }
      ];
      var FREE_IDS = COLOR_PALETTE.filter((c) => !c.premium).map((c) => c.id);
      var PREMIUM_IDS = COLOR_PALETTE.filter((c) => c.premium).map((c) => c.id);
      var EXACT = /* @__PURE__ */ new Map();
      for (const c of COLOR_PALETTE) {
        if (c.id === 0)
          continue;
        EXACT.set(c.rgb.join(","), c);
      }
      function matchColor(r, g, b, a) {
        if (a === 0)
          return COLOR_PALETTE[0];
        const exact = EXACT.get(r + "," + g + "," + b);
        if (exact)
          return exact;
        let best = COLOR_PALETTE[1];
        let bestD = Infinity;
        for (const c of COLOR_PALETTE) {
          if (c.id === 0)
            continue;
          const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        return best;
      }
      module.exports = { COLOR_PALETTE, matchColor, FREE_IDS, PREMIUM_IDS };
    }
  });

  // src/core/wplace.js
  var require_wplace = __commonJS({
    "src/core/wplace.js"(exports, module) {
      var { matchColor } = require_palette();
      var TILE_SIZE = 1e3;
      var TILE_BASE_URL = "https://backend.wplace.live/files/s0/tiles";
      var RAW_FETCH = window.fetch.bind(window);
      var tileCache = /* @__PURE__ */ new Map();
      var scratch = document.createElement("canvas");
      var scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
      function tileUrl(tileX, tileY) {
        return TILE_BASE_URL + "/" + tileX + "/" + tileY + ".png";
      }
      function fetchTileBlob(url) {
        return RAW_FETCH(url, { credentials: "omit" }).then((res) => {
          if (res.status === 404)
            return null;
          if (!res.ok)
            throw new Error("HTTP " + res.status + " for " + url);
          return res.blob();
        });
      }
      async function getTileImageData(tileX, tileY) {
        const key = tileX + "," + tileY;
        if (tileCache.has(key))
          return tileCache.get(key);
        const blob = await fetchTileBlob(tileUrl(tileX, tileY));
        if (blob === null) {
          tileCache.set(key, null);
          return null;
        }
        const bitmap = await createImageBitmap(blob);
        scratch.width = bitmap.width;
        scratch.height = bitmap.height;
        scratchCtx.drawImage(bitmap, 0, 0);
        const imageData = scratchCtx.getImageData(0, 0, bitmap.width, bitmap.height);
        if (bitmap.close)
          bitmap.close();
        tileCache.set(key, imageData);
        return imageData;
      }
      function seedTileCache(tileX, tileY, imageData) {
        tileCache.set(tileX + "," + tileY, imageData);
      }
      async function readPixel2(tileX, tileY, px, py) {
        const imageData = await getTileImageData(tileX, tileY);
        if (!imageData)
          return matchColor(0, 0, 0, 0);
        const i = (py * imageData.width + px) * 4;
        return matchColor(
          imageData.data[i],
          imageData.data[i + 1],
          imageData.data[i + 2],
          imageData.data[i + 3]
        );
      }
      async function readSequenceHorizontal2(startTileX, startTileY, startPx, startPy, length) {
        const ids = [];
        let curTileX = startTileX;
        let curPx = startPx;
        while (curPx < 0) {
          curPx += TILE_SIZE;
          curTileX -= 1;
        }
        for (let i = 0; i < length; i++) {
          const color = await readPixel2(curTileX, startTileY, curPx, startPy);
          ids.push(color.id);
          curPx++;
          if (curPx >= TILE_SIZE) {
            curPx = 0;
            curTileX++;
          }
        }
        return ids;
      }
      module.exports = {
        TILE_SIZE,
        tileUrl,
        getTileImageData,
        readPixel: readPixel2,
        readSequenceHorizontal: readSequenceHorizontal2,
        seedTileCache
      };
    }
  });

  // src/core/overlays.js
  var require_overlays = __commonJS({
    "src/core/overlays.js"(exports, module) {
      var { COLOR_PALETTE } = require_palette();
      function sequenceToPngBlob2(sequence) {
        const canvas = document.createElement("canvas");
        canvas.width = sequence.length;
        canvas.height = 1;
        const ctx = canvas.getContext("2d");
        const img = ctx.createImageData(sequence.length, 1);
        for (let x = 0; x < sequence.length; x++) {
          const c = COLOR_PALETTE[sequence[x]] || COLOR_PALETTE[1];
          img.data[x * 4] = c.rgb[0];
          img.data[x * 4 + 1] = c.rgb[1];
          img.data[x * 4 + 2] = c.rgb[2];
          img.data[x * 4 + 3] = sequence[x] === 0 ? 0 : 255;
        }
        ctx.putImageData(img, 0, 0);
        return new Promise((resolve, reject) => {
          canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
        });
      }
      var LS_KEY = "template-overlays";
      var DB_NAME = "wplace-templates";
      var STORE = "images";
      function listOverlays() {
        return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
      }
      function seedBounds() {
        const q = new URLSearchParams(location.search);
        const lat = parseFloat(q.get("lat")) || 58.34;
        const lng = parseFloat(q.get("lng")) || 14.03;
        return { north: lat + 1e-3, south: lat - 1e-3, west: lng - 1e-3, east: lng + 1e-3 };
      }
      function putImageBlob(id, blob) {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME);
          req.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
              db.createObjectStore(STORE);
            }
          };
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
              db.close();
              return reject(new Error('IDB store "images" not found'));
            }
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(blob, id);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        });
      }
      async function injectTemplate2(blob, name, opts = {}) {
        const bitmap = await createImageBitmap(blob);
        const width = bitmap.width, height = bitmap.height;
        if (bitmap.close)
          bitmap.close();
        const id = crypto.randomUUID();
        await putImageBlob(id, blob);
        const entry = {
          id,
          name,
          bounds: opts.bounds || seedBounds(),
          originalWidth: width,
          originalHeight: height,
          opacity: opts.opacity !== void 0 ? opts.opacity : 0.5,
          visible: true,
          locked: false,
          colorMetric: "lab",
          dithering: false,
          useLegacyColors: false,
          colorPaletteMode: "all",
          order: 0,
          hasPlaced: false,
          updatedAt: Date.now()
        };
        const merge = () => {
          const cur = listOverlays();
          if (!cur.some((o) => o.id === id)) {
            cur.push(entry);
            localStorage.setItem(LS_KEY, JSON.stringify(cur));
          }
        };
        merge();
        window.addEventListener("pagehide", merge);
        return entry;
      }
      module.exports = {
        sequenceToPngBlob: sequenceToPngBlob2,
        injectTemplate: injectTemplate2,
        listOverlays,
        LS_KEY,
        DB_NAME,
        STORE
      };
    }
  });

  // src/core/scan.js
  var require_scan = __commonJS({
    "src/core/scan.js"(exports, module) {
      var { SYNC } = require_protocol();
      function syncRGB(palette) {
        return SYNC.map((id) => palette[id].rgb);
      }
      function scanSync(d, W, H, rgb) {
        const hits = [];
        const c0 = rgb[0], c1 = rgb[1], c2 = rgb[2], c3 = rgb[3];
        for (let y = 0; y < H; y++) {
          const base = y * W * 4;
          for (let x = 0; x <= W - 4; x++) {
            const i = base + x * 4;
            if (d[i] === c0[0] && d[i + 1] === c0[1] && d[i + 2] === c0[2] && d[i + 3] === 255 && d[i + 4] === c1[0] && d[i + 5] === c1[1] && d[i + 6] === c1[2] && d[i + 7] === 255 && d[i + 8] === c2[0] && d[i + 9] === c2[1] && d[i + 10] === c2[2] && d[i + 11] === 255 && d[i + 12] === c3[0] && d[i + 13] === c3[1] && d[i + 14] === c3[2] && d[i + 15] === 255) {
              hits.push(x, y);
            }
          }
        }
        return hits;
      }
      function syncIndexAt(d, i, rgb) {
        if (d[i + 3] !== 255)
          return 255;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        for (let k = 0; k < 4; k++) {
          if (r === rgb[k][0] && g === rgb[k][1] && b === rgb[k][2])
            return k;
        }
        return 255;
      }
      function extractEdges(d, W, H, rgb) {
        const left = new Uint8Array(H * 3);
        const right = new Uint8Array(H * 3);
        for (let y = 0; y < H; y++) {
          const base = y * W * 4;
          for (let j = 0; j < 3; j++) {
            left[y * 3 + j] = syncIndexAt(d, base + j * 4, rgb);
            right[y * 3 + j] = syncIndexAt(d, base + (W - 3 + j) * 4, rgb);
          }
        }
        return { left, right };
      }
      function seamCheck(rightA, leftB, H, tileSize) {
        const out = [];
        const p0 = tileSize - 3, p1 = tileSize - 2, p2 = tileSize - 1;
        for (let y = 0; y < H; y++) {
          const o = y * 3;
          const w0 = rightA[o], w1 = rightA[o + 1], w2 = rightA[o + 2];
          const w3 = leftB[o], w4 = leftB[o + 1], w5 = leftB[o + 2];
          if (w0 === 0 && w1 === 1 && w2 === 2 && w3 === 3)
            out.push(p0, y);
          else if (w1 === 0 && w2 === 1 && w3 === 2 && w4 === 3)
            out.push(p1, y);
          else if (w2 === 0 && w3 === 1 && w4 === 2 && w5 === 3)
            out.push(p2, y);
        }
        return out;
      }
      function edgeSuspicious(edge, H) {
        for (let i = 0; i < H * 3; i++) {
          if (edge[i] !== 255)
            return true;
        }
        return false;
      }
      var TOL = 16;
      var STEP = 2 * TOL + 2;
      function buildKeys(palette) {
        const grid = new Array(512);
        const valid = [];
        let bi = 0;
        for (let b = 255; b >= 255 - 7 * STEP; b -= STEP) {
          let gi = 0;
          for (let g = 0; g <= 7 * STEP; g += STEP) {
            let ri = 0;
            for (let r = 1; r <= 1 + 7 * STEP; r += STEP) {
              let bad = false;
              for (const c of palette) {
                if (Math.abs(r - c.rgb[0]) <= TOL && Math.abs(g - c.rgb[1]) <= TOL && Math.abs(b - c.rgb[2]) <= TOL) {
                  bad = true;
                  break;
                }
              }
              if (!bad) {
                const idx = (bi * 8 + gi) * 8 + ri;
                grid[idx] = [r, g, b];
                valid.push(idx);
              }
              ri++;
            }
            gi++;
          }
          bi++;
        }
        return { grid, valid, tol: TOL, step: STEP };
      }
      function keyIndexOf(space, r, g, b) {
        const step = space.step, tol = space.tol, grid = space.grid;
        const bi = Math.round((255 - b) / step);
        if (bi < 0 || bi > 7 || Math.abs(b - (255 - step * bi)) > tol)
          return -1;
        const gi = Math.round(g / step);
        if (gi < 0 || gi > 7 || Math.abs(g - step * gi) > tol)
          return -1;
        const ri = Math.round((r - 1) / step);
        if (ri < 0 || ri > 7 || Math.abs(r - (1 + step * ri)) > tol)
          return -1;
        const idx = (bi * 8 + gi) * 8 + ri;
        return grid[idx] ? idx : -1;
      }
      var MARKER_W = 2;
      var MARKER_H = 2;
      function markerRect(gx, gy) {
        return { x: gx, y: gy - 1, w: MARKER_W, h: MARKER_H };
      }
      function markerClips(registry, tileX, tileY, tileSize) {
        const clips = [];
        for (const m of registry.values()) {
          const lx = m.rect.x - tileX * tileSize;
          const ly = m.rect.y - tileY * tileSize;
          const x0 = Math.max(0, lx), y0 = Math.max(0, ly);
          const x1 = Math.min(tileSize, lx + m.rect.w);
          const y1 = Math.min(tileSize, ly + m.rect.h);
          if (x0 < x1 && y0 < y1)
            clips.push([m.color, x0, y0, x1 - x0, y1 - y0]);
        }
        return clips;
      }
      function makeRegistry(space, onEvict) {
        const map = /* @__PURE__ */ new Map();
        const order = [];
        let next = 0;
        return {
          size: function() {
            return map.size;
          },
          values: function() {
            return map.values();
          },
          get: function(colorStr) {
            return map.get(colorStr);
          },
          findByIndex: function(idx) {
            const c = space.grid[idx];
            return c ? map.get(c.join(",")) : void 0;
          },
          assign: function(gx, gy, payload) {
            if (order.length >= space.valid.length) {
              const evict = order.shift();
              const old = map.get(evict);
              map.delete(evict);
              if (onEvict)
                onEvict(evict, old);
            }
            const color = space.grid[space.valid[next % space.valid.length]];
            next++;
            const colorStr = color.join(",");
            order.push(colorStr);
            const entry = Object.assign(
              { color, colorStr, rect: markerRect(gx, gy), gx, gy },
              payload
            );
            map.set(colorStr, entry);
            return entry;
          },
          dump: function() {
            return Array.from(map.values());
          }
        };
      }
      module.exports = {
        SYNC,
        syncRGB,
        scanSync,
        syncIndexAt,
        extractEdges,
        seamCheck,
        edgeSuspicious,
        TOL,
        STEP,
        buildKeys,
        keyIndexOf,
        MARKER_W,
        MARKER_H,
        markerRect,
        markerClips,
        makeRegistry
      };
    }
  });

  // src/core/keys.js
  var require_keys = __commonJS({
    "src/core/keys.js"(exports, module) {
      var G_MAX = 50;
      var COUNT = 256 * (G_MAX + 1);
      function keyColor(idx) {
        return [idx & 255, idx >> 8, 255];
      }
      function buildTable(entries) {
        const table = new Int16Array(16384).fill(-1);
        for (const e of entries) {
          table[e.color[1] << 8 | e.color[0]] = e.keyIndex;
        }
        return table;
      }
      function keyIndexOfTable(table, r, g, b) {
        if (b !== 255)
          return -1;
        if (g > 63)
          return -1;
        return table[g << 8 | r];
      }
      function makeRegistry(count, onEvict) {
        const map = /* @__PURE__ */ new Map();
        const order = [];
        return {
          size: function() {
            return map.size;
          },
          values: function() {
            return map.values();
          },
          findByIndex: function(idx) {
            return map.get(idx);
          },
          assign: function(gx, gy, payload) {
            let idx;
            if (order.length >= count) {
              idx = order.shift();
              map.delete(idx);
              if (onEvict)
                onEvict(idx);
            } else {
              idx = 0;
              while (map.has(idx))
                idx++;
            }
            order.push(idx);
            const entry = Object.assign({
              color: keyColor(idx),
              keyIndex: idx,
              rect: { x: gx, y: gy - 1, w: 2, h: 2 },
              gx,
              gy
            }, payload);
            map.set(idx, entry);
            return entry;
          },
          dump: function() {
            return Array.from(map.values());
          }
        };
      }
      module.exports = { G_MAX, COUNT, keyColor, buildTable, keyIndexOfTable, makeRegistry };
    }
  });

  // src/core/intercept.js
  var require_intercept = __commonJS({
    "src/core/intercept.js"(exports, module) {
      var { COLOR_PALETTE } = require_palette();
      var { decodeV2: decodeV22, unpackHeaderV2: unpackHeaderV22 } = require_protocol();
      var {
        syncRGB,
        scanSync,
        extractEdges,
        seamCheck,
        edgeSuspicious,
        markerRect,
        markerClips
      } = require_scan();
      var { TILE_SIZE, getTileImageData, readSequenceHorizontal: readSequenceHorizontal2, seedTileCache } = require_wplace();
      var { COUNT: KEY_COUNT, makeRegistry } = require_keys();
      var registry = makeRegistry(KEY_COUNT, (idx) => {
        console.warn("[CC-INTERCEPT] key space exhausted (" + KEY_COUNT + "); evicted oldest marker idx " + idx);
      });
      var MSGSEEN = /* @__PURE__ */ new Set();
      var DBG = { tiles: 0, found: 0, decodeOk: 0, decodeErr: 0, painted: 0 };
      var SYNC_RGB = syncRGB(COLOR_PALETTE);
      var scratchCv = document.createElement("canvas");
      var sctx = scratchCv.getContext("2d", { willReadFrequently: true });
      var modCv = document.createElement("canvas");
      var mctx = modCv.getContext("2d", { willReadFrequently: true });
      async function decodeBlobToImageData(blob) {
        const bitmap = await createImageBitmap(blob);
        const W = bitmap.width, H = bitmap.height;
        scratchCv.width = W;
        scratchCv.height = H;
        sctx.drawImage(bitmap, 0, 0);
        if (bitmap.close)
          bitmap.close();
        return sctx.getImageData(0, 0, W, H);
      }
      async function readSeq(gx, gy, len) {
        const ty = Math.floor(gy / TILE_SIZE);
        const ly = gy - ty * TILE_SIZE;
        const ids = [];
        let cx = gx;
        while (ids.length < len) {
          const tx = Math.floor(cx / TILE_SIZE);
          const lx = cx - tx * TILE_SIZE;
          const take = Math.min(len - ids.length, TILE_SIZE - lx);
          const chunk = await readSequenceHorizontal2(tx, ty, lx, ly, take);
          for (let k = 0; k < chunk.length; k++)
            ids.push(chunk[k]);
          cx += take;
        }
        return ids;
      }
      async function tryDecodeAndRegister(gx, gy) {
        const key = gx + "," + gy;
        if (MSGSEEN.has(key))
          return;
        let head, h, seq, r;
        try {
          head = await readSeq(gx, gy, 8);
          h = unpackHeaderV22(head[4], head[5], head[6], head[7]);
          seq = await readSeq(gx, gy, 8 + h.length);
          r = decodeV22(seq);
        } catch (e) {
          DBG.decodeErr++;
          return;
        }
        if (!r || r.text === null) {
          DBG.decodeErr++;
          return;
        }
        MSGSEEN.add(key);
        DBG.decodeOk++;
        const modeStr = (r.mode === 0 ? "Lite" : "Full") + (r.free ? "-free" : "");
        const entry = registry.assign(gx, gy, { text: r.text, valid: r.valid, modeStr });
        const crcStr = r.valid ? "CRC OK" : "CRC BAD (stored " + r.stored + " != " + r.computed + ")";
        console.log(
          "%c[CC-INTERCEPT] V2 " + modeStr + " @" + gx + "," + gy + " | " + r.length + " px | " + crcStr + ' | "' + r.text + '" | magic rgb(' + entry.color.join(",") + ")",
          "color:#0c8;font-weight:bold"
        );
      }
      async function processTile(tx, ty, blob) {
        DBG.tiles++;
        const img = await decodeBlobToImageData(blob);
        seedTileCache(tx, ty, img);
        const W = img.width, H = img.height;
        const hits = scanSync(img.data, W, H, SYNC_RGB);
        const edges = extractEdges(img.data, W, H, SYNC_RGB);
        const found = [];
        for (let i = 0; i < hits.length; i += 2) {
          found.push([tx * TILE_SIZE + hits[i], ty * TILE_SIZE + hits[i + 1]]);
        }
        if (edgeSuspicious(edges.right, H)) {
          const nb = await getTileImageData(tx + 1, ty);
          if (nb) {
            const nbEdges = extractEdges(nb.data, nb.width, nb.height, SYNC_RGB);
            const sh = seamCheck(edges.right, nbEdges.left, H, TILE_SIZE);
            for (let i = 0; i < sh.length; i += 2) {
              found.push([tx * TILE_SIZE + sh[i], ty * TILE_SIZE + sh[i + 1]]);
            }
          }
        }
        if (edgeSuspicious(edges.left, H)) {
          const nb = await getTileImageData(tx - 1, ty);
          if (nb) {
            const nbEdges = extractEdges(nb.data, nb.width, nb.height, SYNC_RGB);
            const sh = seamCheck(nbEdges.right, edges.left, H, TILE_SIZE);
            for (let i = 0; i < sh.length; i += 2) {
              found.push([(tx - 1) * TILE_SIZE + sh[i], ty * TILE_SIZE + sh[i + 1]]);
            }
          }
        }
        DBG.found += found.length;
        for (const [gx, gy] of found)
          await tryDecodeAndRegister(gx, gy);
        const clips = markerClips(registry, tx, ty, TILE_SIZE);
        let outBlob = null;
        if (clips.length > 0) {
          modCv.width = W;
          modCv.height = H;
          mctx.putImageData(img, 0, 0);
          for (const c of clips) {
            mctx.fillStyle = "rgb(" + c[0].join(",") + ")";
            mctx.fillRect(c[1], c[2], c[3], c[4]);
          }
          outBlob = await new Promise((r) => modCv.toBlob(r, "image/png"));
          DBG.painted++;
        }
        return outBlob;
      }
      module.exports = { processTile, registry, KEY_COUNT, DBG };
    }
  });

  // src/core/labels.js
  var require_labels = __commonJS({
    "src/core/labels.js"(exports, module) {
      var { COUNT, buildTable, keyIndexOfTable } = require_keys();
      var { registry } = require_intercept();
      var WIN = 32;
      var WIN_GROW = 3;
      var BUDGET = 8;
      var GRACE = 15;
      var PARK_MARGIN = 64;
      var SCROLL_QUIET_MS = 150;
      var PERIODIC_MS = 2e3;
      var pickCV = null;
      var pickGL = null;
      function glOf() {
        if (!pickCV)
          pickCV = document.querySelector(".maplibregl-canvas");
        if (!pickCV)
          return null;
        if (!pickGL)
          pickGL = pickCV.getContext("webgl2") || pickCV.getContext("webgl");
        return pickGL;
      }
      function isCanvas(t) {
        return !!(t && t.closest && t.closest(".maplibregl-canvas-container"));
      }
      var layer = null;
      var elems = /* @__PURE__ */ new Map();
      function ensureLayer() {
        if (layer)
          return layer;
        layer = document.createElement("div");
        layer.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:99998;font:11px monospace;";
        document.documentElement.appendChild(layer);
        return layer;
      }
      function makeLabel(m) {
        const el = document.createElement("div");
        el.style.cssText = "position:absolute;left:0;top:0;padding:2px 5px;background:rgba(10,10,20,.85);color:#7fffd4;border:1px solid #7fffd466;border-radius:3px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        el.textContent = (m.valid ? "" : "[CRC] ") + m.text;
        el.title = m.modeStr + " | " + m.text;
        ensureLayer().appendChild(el);
        return el;
      }
      function placeElem(el, cx, cy) {
        el.style.transform = "translate(" + cx + "px," + cy + "px) translate(6px,-110%)";
      }
      function dropLabel(ki) {
        const el = elems.get(ki);
        if (el)
          el.remove();
        elems.delete(ki);
      }
      function clearLayer() {
        if (layer)
          layer.innerHTML = "";
        elems.clear();
      }
      function showLayer() {
        if (layer)
          layer.style.display = "";
      }
      function hideLayer() {
        if (layer)
          layer.style.display = "none";
      }
      function layerHidden() {
        return !!layer && layer.style.display === "none";
      }
      var mode = "off";
      var scrollKind = "zoom";
      var tracks = /* @__PURE__ */ new Map();
      var table = null;
      var tableSize = -1;
      var rr = 0;
      var lastFull = 0;
      var quietTimer = 0;
      var loopOn = false;
      var scanPending = false;
      var buttonHeld = false;
      var lastPX = 0;
      var lastPY = 0;
      var dragX = 0;
      var dragY = 0;
      function armed() {
        return mode !== "off";
      }
      function refreshTable() {
        if (tableSize !== registry.size()) {
          table = buildTable(registry.values());
          tableSize = registry.size();
        }
      }
      function geom() {
        const rect = pickCV.getBoundingClientRect();
        const W = pickGL.drawingBufferWidth, H = pickGL.drawingBufferHeight;
        return { rect, W, H, kx: W / rect.width, ky: H / rect.height };
      }
      function cssOf(fx, fy, g) {
        return [
          g.rect.left + fx * g.rect.width / g.W,
          g.rect.top + (g.H - 1 - fy) * g.rect.height / g.H
        ];
      }
      function updateParked(t, g) {
        t.parked = t.fx < -PARK_MARGIN || t.fx > g.W + PARK_MARGIN || t.fy < -PARK_MARGIN || t.fy > g.H + PARK_MARGIN;
        if (t.parked)
          t.miss = 0;
      }
      function anyDormant() {
        for (const t of tracks.values())
          if (t.dormant)
            return true;
        return false;
      }
      function blindMove(dx, dy) {
        if (!dx && !dy)
          return;
        if (!pickCV || !pickGL)
          return;
        const g = geom();
        for (const [ki, t] of tracks) {
          t.fx += dx * g.kx;
          t.fy -= dy * g.ky;
          updateParked(t, g);
          if (t.dormant)
            continue;
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
      function scanAndLabel(postMode) {
        const gl = glOf();
        if (!gl) {
          console.log("[CC-LABELS] no map canvas yet");
          return;
        }
        if (scanPending)
          return;
        scanPending = true;
        if (quietTimer) {
          clearTimeout(quietTimer);
          quietTimer = 0;
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          scanPending = false;
          const g = geom();
          const t0 = performance.now();
          const px = new Uint8Array(g.W * g.H * 4);
          gl.readPixels(0, 0, g.W, g.H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const t1 = performance.now();
          let ok = 0;
          for (let k = 1; k < 10; k++) {
            if (px[(Math.floor(g.H * k / 10) * g.W + Math.floor(g.W * k / 10)) * 4 + 3] > 0)
              ok++;
          }
          if (ok < 5) {
            console.log("[CC-LABELS] invalid frame, press Alt+L again");
            return;
          }
          refreshTable();
          const sx = new Float64Array(COUNT), sy = new Float64Array(COUNT), sn = new Uint32Array(COUNT);
          for (let i = 0; i < px.length; i += 4) {
            const ki = keyIndexOfTable(table, px[i], px[i + 1], px[i + 2]);
            if (ki < 0)
              continue;
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
            if (!m) {
              tracks.delete(ki);
              dropLabel(ki);
              continue;
            }
            if (sn[ki] > 0) {
              t.fx = sx[ki] / sn[ki];
              t.fy = sy[ki] / sn[ki];
              t.miss = 0;
              t.parked = false;
              t.dormant = false;
              let el = elems.get(ki);
              if (!el) {
                el = makeLabel(m);
                elems.set(ki, el);
              }
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
            if (sn[ki] < 1 || tracks.has(ki))
              continue;
            const m = registry.findByIndex(ki);
            if (!m)
              continue;
            const fx = sx[ki] / sn[ki], fy = sy[ki] / sn[ki];
            const t = { fx, fy, miss: 0, parked: false, dormant: false };
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
          if (postMode === "drag" && buttonHeld) {
            mode = "drag";
            reanchor();
          } else {
            mode = "idle";
            kick();
          }
          console.log("[CC-LABELS] " + placed + " labels placed, " + dormant + " dormant | read=" + (t1 - t0).toFixed(1) + "ms total=" + (performance.now() - t0).toFixed(1) + "ms | servo armed" + (mode === "drag" ? " (drag held)" : ""));
        }));
      }
      function clearLabels() {
        mode = "off";
        tracks.clear();
        clearLayer();
        showLayer();
        if (quietTimer) {
          clearTimeout(quietTimer);
          quietTimer = 0;
        }
      }
      setInterval(() => {
        if (mode !== "idle" || scanPending)
          return;
        if (registry.size() === 0)
          return;
        if (!anyDormant() && tracks.size > 0)
          return;
        if (performance.now() - lastFull < PERIODIC_MS)
          return;
        scanAndLabel();
      }, 1e3);
      function kick() {
        if (!loopOn && mode === "idle" && tracks.size) {
          loopOn = true;
          requestAnimationFrame(() => requestAnimationFrame(tick));
        }
      }
      function tick() {
        loopOn = false;
        if (mode !== "idle" || !tracks.size || !pickGL)
          return;
        refreshTable();
        const g = geom();
        const kis = Array.from(tracks.keys());
        let processed = 0;
        for (let n = 0; n < kis.length && processed < BUDGET; n++) {
          const ki = kis[(rr + n) % kis.length];
          const t = tracks.get(ki);
          if (!t || t.parked || t.dormant)
            continue;
          processed++;
          const m = registry.findByIndex(ki);
          if (!m) {
            tracks.delete(ki);
            dropLabel(ki);
            continue;
          }
          const span = WIN << Math.min(t.miss, WIN_GROW);
          if (span > g.W || span > g.H) {
            t.dormant = true;
            dropLabel(ki);
            continue;
          }
          let x0 = Math.round(t.fx - span / 2);
          let y0 = Math.round(t.fy - span / 2);
          x0 = Math.max(0, Math.min(g.W - span, x0));
          y0 = Math.max(0, Math.min(g.H - span, y0));
          const buf = new Uint8Array(span * span * 4);
          pickGL.readPixels(x0, y0, span, span, pickGL.RGBA, pickGL.UNSIGNED_BYTE, buf);
          let sx = 0, sy = 0, sn = 0;
          for (let i = 0; i < buf.length; i += 4) {
            if (keyIndexOfTable(table, buf[i], buf[i + 1], buf[i + 2]) !== ki)
              continue;
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
      document.addEventListener("pointerdown", (e) => {
        if (!armed() || e.button !== 0 || !isCanvas(e.target))
          return;
        buttonHeld = true;
        lastPX = e.clientX;
        lastPY = e.clientY;
        if (quietTimer) {
          clearTimeout(quietTimer);
          quietTimer = 0;
        }
        mode = "drag";
        reanchor();
      });
      window.addEventListener("pointermove", (e) => {
        if (!armed())
          return;
        lastPX = e.clientX;
        lastPY = e.clientY;
        if (!buttonHeld)
          return;
        if (mode !== "drag" && mode !== "scroll")
          return;
        const dx = e.clientX - dragX;
        const dy = e.clientY - dragY;
        dragX = e.clientX;
        dragY = e.clientY;
        blindMove(dx, dy);
      });
      window.addEventListener("pointerup", (e) => {
        if (e.button !== 0)
          return;
        buttonHeld = false;
        if (mode !== "drag")
          return;
        if (layerHidden()) {
          enterScroll("zoom");
        } else {
          mode = "idle";
          kick();
        }
      });
      function enterScroll(kind) {
        mode = "scroll";
        scrollKind = kind;
        if (kind === "zoom")
          hideLayer();
        if (quietTimer)
          clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
          quietTimer = 0;
          if (mode !== "scroll")
            return;
          if (scrollKind === "zoom") {
            scanAndLabel(buttonHeld ? "drag" : "idle");
          } else {
            if (buttonHeld) {
              mode = "drag";
              reanchor();
            } else {
              mode = "idle";
              kick();
            }
          }
        }, SCROLL_QUIET_MS);
      }
      window.addEventListener("wheel", (e) => {
        if (!armed() || !isCanvas(e.target))
          return;
        const mul = e.deltaMode === 1 ? 33 : 1;
        const dx = e.deltaX * mul;
        const dy = e.deltaY * mul;
        const kind = e.ctrlKey || dx === 0 && Math.abs(dy) >= 48 ? "zoom" : "pan";
        if (kind === "pan" && mode === "scroll" && scrollKind === "zoom") {
          return;
        }
        enterScroll(kind);
        if (kind === "pan")
          blindMove(dx, dy);
      }, { passive: true });
      document.addEventListener("dblclick", (e) => {
        if (armed() && isCanvas(e.target))
          enterScroll("zoom");
      });
      module.exports = { scanAndLabel, clearLabels };
    }
  });

  // src/core/gui.js
  var require_gui = __commonJS({
    "src/core/gui.js"(exports, module) {
      var { ALPHABET, encodeV1: encodeV12, encodeV2: encodeV22 } = require_protocol();
      var LS_KEY = "colorcoder-gui-state";
      var defaultState = {
        x: 20,
        y: 20,
        collapsed: false,
        tab: "encode",
        enc: { proto: 2, mode: 0, free: 1 },
        settings: { autoReload: false, consoleLogs: true }
      };
      function loadState() {
        try {
          const s = Object.assign({}, defaultState, JSON.parse(localStorage.getItem(LS_KEY) || "{}"));
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
      function saveState(state2) {
        localStorage.setItem(LS_KEY, JSON.stringify(state2));
      }
      var state = loadState();
      var panel;
      var header;
      var body;
      var statusEl;
      var statusTimer = null;
      var encodePane;
      var decodePane;
      var settingsPane;
      var encodeBtn;
      var textArea;
      var modeSelect;
      var protoSelect;
      var palSelect;
      var palRow;
      var liteWarn;
      var previewEl;
      var hintEl;
      var onEncodeCb = null;
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
        #cc-body { padding: 10px; display: ${state.collapsed ? "none" : "block"}; }
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
        .cc-meta { font-size: 10px; color: #888; margin-bottom: 4px; }
        .cc-decode-result {
            background: #0f0f11; padding: 8px; border-radius: 3px;
            margin-bottom: 8px; word-break: break-all; border: 1px solid #333;
            white-space: pre-wrap;
        }
        .cc-shield { position: fixed; inset: 0; z-index: 999998; cursor: move; }
    `;
      }
      function createPanel() {
        const style = document.createElement("style");
        style.textContent = css();
        document.head.appendChild(style);
        panel = document.createElement("div");
        panel.id = "cc-panel";
        panel.style.left = state.x + "px";
        panel.style.top = state.y + "px";
        header = document.createElement("div");
        header.id = "cc-header";
        header.innerHTML = `
        <span class="title">COLORCODER</span>
        <span class="btns">
            <button id="cc-collapse" title="Collapse">_</button>
            <button id="cc-close" title="Hide (Alt+C)">x</button>
        </span>
    `;
        panel.appendChild(header);
        body = document.createElement("div");
        body.id = "cc-body";
        const tabs = document.createElement("div");
        tabs.className = "cc-tabs";
        tabs.innerHTML = `
        <button data-tab="encode" class="${state.tab === "encode" ? "active" : ""}">Encode</button>
        <button data-tab="decode" class="${state.tab === "decode" ? "active" : ""}">Decode</button>
        <button data-tab="settings" class="${state.tab === "settings" ? "active" : ""}">Settings</button>
    `;
        body.appendChild(tabs);
        encodePane = document.createElement("div");
        encodePane.className = `cc-pane ${state.tab === "encode" ? "active" : ""}`;
        encodePane.dataset.tab = "encode";
        encodePane.innerHTML = `
        <div class="cc-row">
            <label>Protocol</label>
            <select id="cc-proto">
                <option value="1">V1 (legacy)</option>
                <option value="2">V2</option>
            </select>
        </div>
        <div class="cc-row">
            <label>Mode</label>
            <select id="cc-mode">
                <option value="0">Lite (dictionary chars)</option>
                <option value="1">Full (any UTF-8)</option>
            </select>
        </div>
        <div class="cc-row" id="cc-palrow">
            <label>Palette</label>
            <select id="cc-pal">
                <option value="1">Free colors (32, 5-bit)</option>
                <option value="0">All colors (64, 6-bit)</option>
            </select>
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
        decodePane = document.createElement("div");
        decodePane.className = `cc-pane ${state.tab === "decode" ? "active" : ""}`;
        decodePane.dataset.tab = "decode";
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
        settingsPane = document.createElement("div");
        settingsPane.className = `cc-pane ${state.tab === "settings" ? "active" : ""}`;
        settingsPane.dataset.tab = "settings";
        settingsPane.innerHTML = `
        <div class="cc-row">
            <label><input type="checkbox" id="cc-autoreload" ${state.settings.autoReload ? "checked" : ""}> Auto reload after overlay injection</label>
        </div>
        <div class="cc-row">
            <label><input type="checkbox" id="cc-logs" ${state.settings.consoleLogs ? "checked" : ""}> Show console logs</label>
        </div>
        <button id="cc-reset" class="cc-btn" style="background:#555; color:#fff;">Reset Panel Position</button>
    `;
        body.appendChild(settingsPane);
        statusEl = document.createElement("div");
        statusEl.className = "cc-status";
        body.appendChild(statusEl);
        panel.appendChild(body);
        document.documentElement.appendChild(panel);
        bindEvents();
      }
      function bindEvents() {
        body.querySelectorAll(".cc-tabs button").forEach((btn) => {
          btn.addEventListener("click", () => {
            state.tab = btn.dataset.tab;
            body.querySelectorAll(".cc-tabs button").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            body.querySelectorAll(".cc-pane").forEach((p) => p.classList.remove("active"));
            body.querySelector(`.cc-pane[data-tab="${state.tab}"]`).classList.add("active");
            saveState(state);
          });
        });
        header.querySelector("#cc-collapse").addEventListener("click", () => {
          state.collapsed = !state.collapsed;
          body.style.display = state.collapsed ? "none" : "block";
          header.querySelector("#cc-collapse").textContent = state.collapsed ? "+" : "_";
          saveState(state);
        });
        header.querySelector("#cc-close").addEventListener("click", () => {
          panel.style.display = "none";
        });
        let drag = null;
        header.addEventListener("mousedown", (e) => {
          if (e.target.closest("button"))
            return;
          const shield = document.createElement("div");
          shield.className = "cc-shield";
          document.body.appendChild(shield);
          drag = { startX: e.clientX - state.x, startY: e.clientY - state.y, shield };
          e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
          if (!drag)
            return;
          state.x = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - drag.startX));
          state.y = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - drag.startY));
          panel.style.left = state.x + "px";
          panel.style.top = state.y + "px";
        });
        document.addEventListener("mouseup", () => {
          if (drag) {
            drag.shield.remove();
            drag = null;
            saveState(state);
          }
        });
        protoSelect = encodePane.querySelector("#cc-proto");
        modeSelect = encodePane.querySelector("#cc-mode");
        palSelect = encodePane.querySelector("#cc-pal");
        palRow = encodePane.querySelector("#cc-palrow");
        textArea = encodePane.querySelector("#cc-text");
        encodeBtn = encodePane.querySelector("#cc-encode");
        liteWarn = encodePane.querySelector("#cc-litewarn");
        previewEl = encodePane.querySelector("#cc-preview");
        hintEl = encodePane.querySelector("#cc-hint");
        protoSelect.value = String(state.enc.proto);
        modeSelect.value = String(state.enc.mode);
        palSelect.value = String(state.enc.free);
        function refreshEncodePane() {
          const proto = parseInt(protoSelect.value, 10);
          const mode = parseInt(modeSelect.value, 10);
          const free = parseInt(palSelect.value, 10);
          state.enc = { proto, mode, free };
          saveState(state);
          palRow.style.display = proto === 2 ? "" : "none";
          hintEl.style.display = proto === 2 && mode === 0 ? "" : "none";
          const text = textArea.value;
          const bad = [];
          if (mode === 0) {
            for (const ch of text) {
              if (!ALPHABET.includes(ch) && !bad.includes(ch))
                bad.push(ch);
            }
          }
          if (bad.length > 0) {
            liteWarn.style.display = "block";
            liteWarn.textContent = "Lite cannot encode: " + bad.join(" ") + " - use Full.";
            previewEl.textContent = "";
            encodeBtn.disabled = true;
            return;
          }
          liteWarn.style.display = "none";
          const enc = proto === 2 ? encodeV22(text, mode, free) : encodeV12(text, mode);
          if (!enc) {
            previewEl.textContent = "Message too long: payload exceeds 1023 px.";
            encodeBtn.disabled = true;
            return;
          }
          const prefix = proto === 2 ? 8 : 4;
          previewEl.textContent = "Payload " + enc.length + " px + " + prefix + " px prefix = " + (enc.length + prefix) + " px total.";
          encodeBtn.disabled = false;
        }
        protoSelect.addEventListener("change", refreshEncodePane);
        modeSelect.addEventListener("change", refreshEncodePane);
        palSelect.addEventListener("change", refreshEncodePane);
        textArea.addEventListener("input", refreshEncodePane);
        refreshEncodePane();
        encodeBtn.addEventListener("click", () => {
          clearAction();
          if (onEncodeCb) {
            onEncodeCb(textArea.value, state.enc.mode, state.enc.free, state.enc.proto);
          }
        });
        settingsPane.querySelector("#cc-autoreload").addEventListener("change", (e) => {
          state.settings.autoReload = e.target.checked;
          saveState(state);
        });
        settingsPane.querySelector("#cc-logs").addEventListener("change", (e) => {
          state.settings.consoleLogs = e.target.checked;
          saveState(state);
        });
        settingsPane.querySelector("#cc-reset").addEventListener("click", () => {
          state.x = 20;
          state.y = 20;
          panel.style.left = "20px";
          panel.style.top = "20px";
          saveState(state);
        });
      }
      function setStatus(msg, type = "info", timeout = 5e3) {
        if (statusTimer) {
          clearTimeout(statusTimer);
          statusTimer = null;
        }
        statusEl.textContent = msg;
        statusEl.className = "cc-status " + type;
        if (timeout > 0) {
          statusTimer = setTimeout(() => {
            statusEl.textContent = "";
            statusEl.className = "cc-status";
            statusTimer = null;
          }, timeout);
        }
      }
      function actionSlot() {
        return encodePane ? encodePane.querySelector("#cc-action") : null;
      }
      function clearAction() {
        const slot = actionSlot();
        if (slot)
          slot.innerHTML = "";
      }
      function showReloadButton() {
        const slot = actionSlot();
        if (!slot)
          return;
        slot.innerHTML = "";
        const btn = document.createElement("button");
        btn.className = "cc-btn";
        btn.style.background = "#555";
        btn.style.color = "#fff";
        btn.textContent = "Overlay injected - Reload Now";
        btn.onclick = () => location.reload();
        slot.appendChild(btn);
      }
      function init() {
        if (document.getElementById("cc-panel"))
          return;
        createPanel();
      }
      function show() {
        if (panel)
          panel.style.display = "flex";
      }
      function toggle() {
        if (!panel)
          init();
        else
          panel.style.display = panel.style.display === "none" ? "flex" : "none";
      }
      function onEncode(cb) {
        onEncodeCb = cb;
      }
      function showDecodeResult(result, tileInfo) {
        const empty = decodePane.querySelector("#cc-decode-empty");
        const content = decodePane.querySelector("#cc-decode-content");
        empty.style.display = "none";
        content.style.display = "block";
        const proto = result.version === 2 ? "V2" : "V1";
        let modeStr = result.mode === 0 ? "Lite" : "Full";
        if (result.version === 2)
          modeStr += result.free ? " (free colors)" : " (all colors)";
        const crcStr = result.valid ? "CRC OK" : "CRC WARNING (stored " + result.storedChecksum + " != computed " + result.computedChecksum + ")";
        const posStr = tileInfo ? "Tile: " + tileInfo.tileX + "," + tileInfo.tileY + " | Px: " + tileInfo.px + "," + tileInfo.py : "";
        let warnHtml = "";
        if (result.badChars)
          warnHtml += '<div class="cc-warn">Warning: payload contains unmapped values (replaced with "?")</div>';
        if (result.badPadding)
          warnHtml += '<div class="cc-warn">Warning: non-zero padding bits (possible corruption)</div>';
        if (result.truncated)
          warnHtml += '<div class="cc-warn">Warning: message truncated (sequence shorter than header length)</div>';
        if (result.badHeaderColors)
          warnHtml += '<div class="cc-warn">Warning: header contains non-free color ids (possible corruption)</div>';
        if (result.reserved)
          warnHtml += '<div class="cc-warn">Warning: reserved header bits set (' + result.reserved + ")</div>";
        content.innerHTML = `
        <div class="cc-meta">${proto} ${modeStr} | ${result.length} px | ${crcStr}</div>
        <div class="cc-meta">${posStr}</div>
        ${warnHtml}
        <div class="cc-decode-result">${escapeHtml(result.text || "")}</div>
        <button id="cc-copy" class="cc-btn" style="background:#555; color:#fff; margin-top:4px;">Copy Text</button>
    `;
        content.querySelector("#cc-copy").addEventListener("click", () => {
          navigator.clipboard.writeText(result.text || "").then(() => {
            setStatus("Copied to clipboard", "success");
          });
        });
        state.tab = "decode";
        body.querySelectorAll(".cc-tabs button").forEach((b) => b.classList.remove("active"));
        body.querySelector('.cc-tabs button[data-tab="decode"]').classList.add("active");
        body.querySelectorAll(".cc-pane").forEach((p) => p.classList.remove("active"));
        decodePane.classList.add("active");
        saveState(state);
      }
      function escapeHtml(str) {
        return str.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
      }
      module.exports = {
        init,
        show,
        toggle,
        setStatus,
        onEncode,
        showDecodeResult,
        clearAction,
        showReloadButton,
        getSettings: () => state.settings
      };
    }
  });

  // src/script.js
  var {
    encodeV1,
    decodeV1,
    unpackHeader,
    VERSION,
    encodeV2,
    decodeV2,
    unpackHeaderV2,
    findSyncOffset,
    PREFIX_LEN
  } = require_protocol();
  var { readSequenceHorizontal, readPixel } = require_wplace();
  var { sequenceToPngBlob, injectTemplate } = require_overlays();
  var intercept = require_intercept();
  var labels = require_labels();
  var gui = require_gui();
  var origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url || "";
    if (url.includes("/files/s0/tiles/") && url.endsWith(".png")) {
      const parts = url.split("?")[0].split("/").filter(Boolean);
      const ty = parseInt(parts[parts.length - 1], 10);
      const tx = parseInt(parts[parts.length - 2], 10);
      if (!isNaN(tx) && !isNaN(ty)) {
        return origFetch.apply(this, args).then(async (res) => {
          if (!res.ok)
            return res;
          try {
            const blob = await res.clone().blob();
            const out = await intercept.processTile(tx, ty, blob);
            if (out) {
              return new Response(out, {
                status: res.status,
                statusText: res.statusText,
                headers: { "Content-Type": "image/png" }
              });
            }
          } catch (e) {
            console.warn("[CC] intercept failed, passing clean tile", e);
          }
          return res;
        });
      }
    }
    const response = origFetch.apply(this, args);
    try {
      if (url.includes("/pixel/")) {
        response.then((res) => {
          const p = url.split("?")[0].split("/").filter(Boolean);
          const tileY = parseInt(p[p.length - 1], 10);
          const tileX = parseInt(p[p.length - 2], 10);
          const q = new URLSearchParams(url.split("?")[1] || "");
          const px = parseInt(q.get("x"), 10);
          const py = parseInt(q.get("y"), 10);
          if ([tileX, tileY, px, py].every((n) => !isNaN(n))) {
            window.dispatchEvent(new CustomEvent("cc-click", { detail: { tileX, tileY, px, py } }));
          }
          return res;
        }).catch(() => {
        });
      }
    } catch (e) {
    }
    return response;
  };
  var CLICK_INDEX = 3;
  var WINDOW_LEN = 11;
  function log(msg, style) {
    if (!gui.getSettings().consoleLogs)
      return;
    if (style)
      console.log("%c" + msg, style);
    else
      console.log(msg);
  }
  function reportDecode(result, tileInfo) {
    const proto = result.version === 2 ? "V2" : "V1";
    let modeStr = result.mode === 0 ? "Lite" : "Full";
    if (result.version === 2)
      modeStr += result.free ? "-free" : "";
    if (result.valid) {
      log(
        "[CC] Decoded " + proto + " " + modeStr + " message (" + result.length + " px, crc OK)",
        "color:#0c8;font-weight:bold"
      );
    } else {
      log(
        "[CC] Decoded " + proto + " " + modeStr + " message (" + result.length + " px) - CORRUPTED (stored " + result.storedChecksum + " != computed " + result.computedChecksum + ")",
        "color:#c80;font-weight:bold"
      );
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
      if (!result)
        return;
      reportDecode(result, { tileX, tileY, px, py });
      return;
    }
    if (win[CLICK_INDEX] === 1) {
      const header = unpackHeader(win[CLICK_INDEX + 1], win[CLICK_INDEX + 2], win[CLICK_INDEX + 3]);
      if (header.version !== VERSION) {
        log("[CC] Unknown V1 header version " + header.version + ", cannot decode.");
        gui.setStatus("Unknown V1 header version " + header.version + ".", "error");
        return;
      }
      const sequence = await readSequenceHorizontal(tileX, tileY, px, py, 4 + header.length);
      const result = decodeV1(sequence);
      if (!result)
        return;
      reportDecode(result, { tileX, tileY, px, py });
      return;
    }
    const c = await readPixel(tileX, tileY, px, py);
    log("[CC] Not a sync pixel (id " + c.id + " " + c.name + "), nothing to decode here.");
    gui.setStatus("Not a message sync pixel (" + c.name + ").", "info");
  }
  var lastClick = { alt: false, t: 0 };
  document.addEventListener("click", (e) => {
    lastClick = { alt: e.altKey, t: Date.now() };
  }, true);
  window.addEventListener("cc-click", (e) => {
    if (!lastClick.alt || Date.now() - lastClick.t > 2e3)
      return;
    const { tileX, tileY, px, py } = e.detail;
    attemptDecode(tileX, tileY, px, py).catch((err) => {
      console.error("[CC] Decode error:", err);
      gui.setStatus("Decode error: " + err.message, "error");
    });
  });
  function isTyping(target) {
    return target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  }
  async function executeEncode(text, mode, free, protocol) {
    gui.clearAction();
    gui.setStatus("Encoding and generating PNG...", "info");
    const enc = protocol === 2 ? encodeV2(text, mode, free) : encodeV1(text, mode);
    if (!enc) {
      gui.setStatus("Encode failed - character not in Lite alphabet, or message too long.", "error");
      return;
    }
    try {
      const blob = await sequenceToPngBlob(enc.fullSequence);
      const tag = (protocol === 2 ? "CC2 " : "CC ") + (mode ? "full" : "lite") + (protocol === 2 && free ? "-free" : "") + ": ";
      const name = tag + text.slice(0, 24);
      await injectTemplate(blob, name);
      log('[CC] Injected "' + name + '" (' + enc.length + " px payload).", "color:#0c8;font-weight:bold");
      if (gui.getSettings().autoReload) {
        gui.setStatus("Reloading page...", "info", 0);
        setTimeout(() => location.reload(), 500);
      } else {
        gui.setStatus("Overlay injected: " + name, "success");
        gui.showReloadButton();
      }
    } catch (err) {
      console.error("[CC] Inject failed:", err);
      gui.setStatus("Inject failed: " + err.message, "error");
    }
  }
  async function legacyMakeMessage() {
    const modeRaw = (prompt("Mode: l = Lite (basic chars), f = Full (any UTF-8)", "l") || "").trim().toLowerCase();
    if (!modeRaw)
      return;
    const mode = modeRaw.startsWith("f") ? 1 : 0;
    const text = prompt("Message text:");
    if (!text)
      return;
    await executeEncode(text, mode, 0, 1);
  }
  document.addEventListener("keydown", (e) => {
    if (!e.altKey)
      return;
    if (isTyping(e.target))
      return;
    if (e.code === "KeyM") {
      legacyMakeMessage().catch((err) => {
        console.error("[CC] Inject failed:", err);
        gui.setStatus("Inject failed: " + err.message, "error");
      });
    }
    if (e.code === "KeyC") {
      gui.toggle();
    }
    if (e.code === "KeyL") {
      if (e.shiftKey) {
        labels.clearLabels();
        console.log("[CC] labels cleared");
      } else
        labels.scanAndLabel();
      e.preventDefault();
    }
    if (e.code === "KeyS" && !e.shiftKey) {
      console.log("[CC] SUMMARY " + JSON.stringify(intercept.DBG) + " keyspace=" + intercept.KEY_COUNT + " registry=" + intercept.registry.size());
      for (const m of intercept.registry.values()) {
        console.log("[CC]   key rgb(" + m.color.join(",") + ") -> @" + m.gx + "," + m.gy + ' "' + m.text + '"');
      }
    }
  });
  function initApp() {
    gui.init();
    gui.onEncode(executeEncode);
    log(
      "[CC] Ready. Alt+Click = decode, Alt+M = legacy encode, Alt+C = GUI, Alt+L = labels, Alt+S = summary.",
      "color:#0af;font-weight:bold"
    );
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
