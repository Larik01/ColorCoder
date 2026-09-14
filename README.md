# ColorCoder

Encode, hide, and read secret messages in the pixel canvas of [wplace.live](https://wplace.live).  
Unofficial tool — not affiliated with wplace.

## Userscript usage

Click [link](https://github.com/Larik01/ColorCoder/raw/refs/heads/main/dist/script.user.js) to install with Tampermonkey (or build your own, see Build & test below).

    Alt+C           toggle the ColorCoder GUI (encode, decode, settings)
    Alt+Click       decode the message starting at the clicked pixel (V2 or V1 fallback)
    Alt+M           legacy: prompt for mode + text -> inject an *unplaced* template -> reload;
                    then place it with the native overlay GUI
    Alt+L           arm autoscan labels (scan framebuffer, track markers)
    Alt+Shift+L     clear labels and disarm
    Alt+S           dump autoscan counters and registry to console

## What it does

- **Autoscan**: intercepts every tile PNG the map fetches, scans for V2 sync rows (including cross-tile seams), decodes messages, registers them under unique magic marker colors, and paints 2x2 markers above each sync. A servo tracks those markers across pan, drag, and zoom with windowed framebuffer reads and dead reckoning during coast.
- **Manual decode**: Alt+Click any sync pixel to decode that message (V2 windowed first, V1 fallback).
- **Encode + inject**: type text in the GUI → overlay appears in wplace's native template list → place it with the native GUI.
- **Collapsible labels**: each autoscan label is a diamond pin plus an expandable bubble with honest `pre-wrap` text; clicking a bubble opens the full decode view in the GUI.
- **Auto-arm option**: enable in Settings to arm labels automatically when the first message is discovered.
- Supports 4 encoding modes in V2: Lite/Full text, using either All (64) or Free (32) colors.

## Autoscan pipeline

Every tile PNG fetched by the map passes through `intercept.js`:

1. Decode the tile to RGBA, seed the clean tile cache (so our own reads bypass the modified PNG).
2. Scan for the 4-pixel V2 sync row, plus seam checks for syncs straddling tile boundaries.
3. For each sync, decode the payload via `readSeq` (which chunks across tile boundaries).
4. Register the message under a unique magic color from a 13,056-key exact-match desert space (b=255, g≤50).
5. Paint 2x2 markers of that color above the sync row in the tile image, return the modified PNG blob.

The servo in `labels.js` tracks those markers:

- **IDLE**: round-robin windowed reads (32/64/128/256 px), eight per frame, exact single-color match.
- **DRAG**: blind follow while M1 held, zero reads.
- **SCROLL**: hide labels on wheel/pinch/dblclick, rescan after 150 ms quiet; trackpad pan blind-follows.
- **Retirement**: off-screen labels go parked (no reads, revive on border return); proved-absent labels go dormant (no reads, revive on rescan).
- **Reconcile**: periodic rescan while anything is dormant, so coast and zoom-fade recover within 2 seconds of settle.

## The V2 protocol

V2 introduces a highly visible 4-pixel sync pattern and a 4-pixel header that only uses free colors, making messages paintable by new users.

```
[ pixels 0-3 ]    [ pixels 4-7 ]         [ pixels 8...          ]
[ 4-px sync ]     [ 20-bit header ]      [ payload (N pixels)   ]
```

Sync: exact sequence of rare free colors `[26, 27, 24, 21]` (Dark Pink, Pink, Purple, Indigo).

Header (always uses 32 free colors, 5 bits each = 20 bits):

```
mode     1 bit    0 = Lite, 1 = Full
free     1 bit    0 = All colors (6-bit payload), 1 = Free colors (5-bit payload)
length  10 bits   payload length in PIXELS (max 1023)
crc      6 bits   djb2 mod 64 over mode+free+length+payload bit-string
reserved 2 bits   (must be 0)
```

Payload modes:
- **Lite locked** — 1 pixel = 1 char (6-bit). Space maps to Transparent (id 0).
- **Lite free** — 6-bit alphabet indices packed into 5-bit pixels (6 px = 5 chars).
- **Full locked** — UTF-8 bytes packed into 6-bit pixels (4 px = 3 bytes).
- **Full free** — UTF-8 bytes packed into 5-bit pixels (8 px = 5 bytes).

**Corruption policy** — decode anyway, warn on CRC mismatch, bad padding, or truncation. Never silently drop.

## The V1 protocol (Legacy)

64 colors = 6 bits per pixel.

```
[ pixel 0 ]        [ pixels 1-3 ]          [ pixels 4...        ]
[ sync=Black ]     [ 18-bit header ]       [ payload (N pixels) ]
```

Header, high → low bit:

```
version  2 bits   format version (currently 0)
mode     1 bit    0 = Lite, 1 = Full
length  10 bits   payload length in PIXELS (max 1023)
crc      5 bits   djb2 mod 32 over version+mode+length+payload bit-string
```

- **Lite** — 1 pixel = 1 character, 62-char alphabet (a-z, 0-9, punctuation; ids 62-63 unused).
- **Full** — UTF-8 bytes bit-packed into 6-bit chunks (4 pixels = 3 bytes), base64-style.

## Repository layout

```
src/
  meta.js         ==UserScript== header (prepended by build, version auto-stamped)
  script.js       entry point: hotkeys, fetch-spy, decode + inject flows
  core/
    protocol.js   V1 + V2 codecs (encode/decode, header pack/unpack, sync search)
    palette.js    64-color wplace palette + RGB matching (browser & Node safe)
    scan.js       sync row scanner, edge extraction, seam checks, marker painting helpers
    keys.js       13,056-key exact-match desert color space + FIFO registry
    wplace.js     live-canvas reader (tile fetch, pixel reads, boundary walk)
    intercept.js  autoscan pipeline (tile decode, scan, register, paint markers)
    labels.js     servo tracking (windowed reads, drag/scroll hierarchy, retirement)
    overlays.js   PNG blob generation + wplace native template injection
    gui.js        floating draggable UI panel (encode, decode, settings, autoscan controls)
    log.js        centralized logger with mute toggle
scripts/build.js  esbuild bundle + header glue -> dist/script.user.js
tests/            Node test suite (npm test) + framebuffer dumps + analyzers
```

## Build & test

```
npm install
npm test          # protocol + color + keys tests (Node)
npm run dev       # readable bundle  -> dist/script.user.js
npm run build     # minified bundle -> dist/script.user.js
```

## Technical notes (hard-won)

- Click coordinates come from intercepting the page's own `/pixel/{tileX}/{tileY}?x=..&y=..` fetch — no map projection math needed.
- Canvas tiles live at `backend.wplace.live/files/s0/tiles/{x}/{y}.png`, 1000x1000; the reader walks horizontally across tile boundaries.
- The autoscan intercepts tile PNG fetches, decodes them to ImageData, scans for sync rows, and returns a modified PNG with magic markers painted. The clean ImageData is seeded into a cache so our own sequence reads bypass the modified PNG.
- Magic markers live in a color desert (b=255, g≤50) that no palette color or blend can enter, enabling exact-match with zero tolerance and 13,056 unique keys.
- The servo tracks markers via windowed `readPixels` around last-known positions, with dead reckoning during all-miss ticks, blind follow during drag, and hide-and-rescan on wheel/pinch/dblclick.
- Native overlays are client-side: PNG blobs in IndexedDB (`wplace-templates` / `images`, keyed by a UUID that is also the metadata `id`) plus a metadata array in `localStorage["template-overlays"]`.
- The wplace client rewrites that localStorage key from memory on `pagehide`, silently dropping entries it didn't load itself. The injector registers a *later* `pagehide` listener and merges its entry back after the app's flush.
- Injected templates use `hasPlaced: false` + seeded bounds so the native GUI treats them like freshly uploaded, unplaced overlays.

## Credits

- [BlueMarble](https://github.com/SwingTheVine/Wplace-BlueMarble/tree/main) — the community overlay userscript for wplace: inspiration for the fetch-interception technique and the tile-CDN layout. No code was copied.
- wplace.live — the platform. Be a good guest: respect the site and its community.

## License

GPL-3.0 — see [LICENSE](LICENSE).