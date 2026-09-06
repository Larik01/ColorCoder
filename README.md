# ColorCoder

Encode, hide, and read secret messages in the pixel canvas of [wplace.live](https://wplace.live).
Unofficial tool — not affiliated with wplace.
## Userscript usage

Install `dist/script.user.js` with Tampermonkey (or build your own, see Build & test below).

    Alt+Click   decode the message starting at the clicked pixel
    Alt+M       prompt for mode + text -> inject an *unplaced* template -> reload;
                then place it with the native overlay GUI

## What it does

- **Encodes** text into a horizontal string of wplace palette pixels (V1 protocol).
- **Decodes** messages straight from the live canvas: Alt+Click the black sync pixel.
- **Injects** encoded strips into wplace's *built-in* template/overlay system
  (type text → overlay appears in the native list → place it with the native GUI).

## The V1 protocol

64 colors = 6 bits per pixel.

    [ pixel 0 ]        [ pixels 1-3 ]          [ pixels 4...        ]
    [ sync=Black ]     [ 18-bit header ]       [ payload (N pixels) ]

Header, high → low bit:

    version  2 bits   format version (currently 0; value 3 reserved as escape hatch)
    mode     1 bit    0 = Lite, 1 = Full
    length  10 bits   payload length in PIXELS (max 1023)
    crc      5 bits   djb2 mod 32 over version+mode+length+payload bit-string

- **Lite** — 1 pixel = 1 character, 62-char alphabet (a-z, 0-9, punctuation; ids 62-63 unused).
- **Full** — UTF-8 bytes bit-packed into 6-bit chunks (4 pixels = 3 bytes), base64-style.
- **Corruption policy** — decode anyway, warn on CRC mismatch. Never silently drop.

The version field is the upgrade path: future formats (2D blocks, bigger CRC, ...)
pick a new version number; old decoders say "unknown version" instead of producing garbage.

## Repository layout

    src/
      meta.js        ==UserScript== header (prepended by build, version auto-stamped)
      script.js      entry point: hotkeys, fetch-spy, decode + inject flows
      core/
        alphabet.js  Lite alphabet
        checksum.js  5-bit djb2
        palette.js   64-color wplace palette + RGB matching (browser & Node safe)
        colors.js    Node-only PNG IO (savePNG/readPNG) used by tests
        v1.js        V1 codec (encode/decode, header pack/unpack)
        render.js    pixel-id sequence -> 1xN PNG Blob (canvas)
        wplace.js    live-canvas reader (tile fetch, pixel reads, boundary walk)
        templates.js writes overlays into wplace's native storage (IDB + localStorage)
    scripts/build.js esbuild bundle + header glue -> dist/script.user.js
    tests/           Node test suite (npm test)

## Build & test

    npm install
    npm test          # protocol + color tests (Node)
    npm run dev       # readable bundle  -> dist/script.user.js
    npm run build     # minified bundle -> dist/script.user.js

## Technical notes (hard-won)

- Click coordinates come from intercepting the page's own
  `/api/pixel/{tileX}/{tileY}?x=..&y=..` fetch — no map projection math needed.
- Canvas tiles live at `backend.wplace.live/files/s0/tiles/{x}/{y}.png`, 1000x1000;
  the reader walks horizontally across tile boundaries.
- Native overlays are client-side: PNG blobs in IndexedDB (`wplace-templates` /
  `images`, keyed by a UUID that is also the metadata `id`) plus a metadata array
  in `localStorage["template-overlays"]`.
- The wplace client rewrites that localStorage key from memory on `pagehide`,
  silently dropping entries it didn't load itself. The injector registers a
  *later* `pagehide` listener and merges its entry back after the app's flush.
- Injected templates use `hasPlaced: false` + seeded bounds so the native GUI
  treats them like freshly uploaded, unplaced overlays.

## Credits

- [BlueMarble](https://github.com/SwingTheVine/Wplace-BlueMarble/tree/main) — the community
  overlay userscript for wplace: inspiration for the fetch-interception technique
  and the tile-CDN layout. No code was copied.
- wplace.live — the platform. Be a good guest: respect the site and its community.

## License

GPL-3.0 — see [LICENSE](LICENSE).