// src/core/palette.js
// Pure palette data + color matching. NO Node dependencies (no pngjs, no fs)
// so it can be safely bundled into the Tampermonkey userscript by esbuild.

const COLOR_PALETTE = [
    { id: 0, name: "Transparent", rgb: [0, 0, 0] },
    { id: 1, name: "Black", rgb: [0, 0, 0] },
    { id: 2, name: "Dark Gray", rgb: [60, 60, 60] },
    { id: 3, name: "Gray", rgb: [120, 120, 120] },
    { id: 4, name: "Light Gray", rgb: [210, 210, 210] },
    { id: 5, name: "White", rgb: [255, 255, 255] },
    { id: 6, name: "Deep Red", rgb: [96, 0, 24] },
    { id: 7, name: "Red", rgb: [237, 28, 36] },
    { id: 8, name: "Orange", rgb: [255, 127, 39] },
    { id: 9, name: "Gold", rgb: [246, 170, 9] },
    { id: 10, name: "Yellow", rgb: [249, 221, 59] },
    { id: 11, name: "Light Yellow", rgb: [255, 250, 188] },
    { id: 12, name: "Dark Green", rgb: [14, 185, 104] },
    { id: 13, name: "Green", rgb: [19, 230, 123] },
    { id: 14, name: "Light Green", rgb: [135, 255, 94] },
    { id: 15, name: "Dark Teal", rgb: [12, 129, 110] },
    { id: 16, name: "Teal", rgb: [16, 174, 166] },
    { id: 17, name: "Light Teal", rgb: [19, 225, 190] },
    { id: 18, name: "Dark Blue", rgb: [40, 80, 158] },
    { id: 19, name: "Blue", rgb: [64, 147, 228] },
    { id: 20, name: "Cyan", rgb: [96, 247, 242] },
    { id: 21, name: "Indigo", rgb: [107, 80, 246] },
    { id: 22, name: "Light Indigo", rgb: [153, 177, 251] },
    { id: 23, name: "Dark Purple", rgb: [120, 12, 153] },
    { id: 24, name: "Purple", rgb: [170, 56, 185] },
    { id: 25, name: "Light Purple", rgb: [224, 159, 249] },
    { id: 26, name: "Dark Pink", rgb: [203, 0, 122] },
    { id: 27, name: "Pink", rgb: [236, 31, 128] },
    { id: 28, name: "Light Pink", rgb: [243, 141, 169] },
    { id: 29, name: "Dark Brown", rgb: [104, 70, 52] },
    { id: 30, name: "Brown", rgb: [149, 104, 42] },
    { id: 31, name: "Beige", rgb: [248, 178, 119] },
    { id: 32, name: "Medium Gray", rgb: [170, 170, 170] },
    { id: 33, name: "Dark Red", rgb: [165, 14, 30] },
    { id: 34, name: "Light Red", rgb: [250, 128, 114] },
    { id: 35, name: "Dark Orange", rgb: [228, 92, 26] },
    { id: 36, name: "Light Tan", rgb: [214, 181, 148] },
    { id: 37, name: "Dark Goldenrod", rgb: [156, 132, 49] },
    { id: 38, name: "Goldenrod", rgb: [197, 173, 49] },
    { id: 39, name: "Light Goldenrod", rgb: [232, 212, 95] },
    { id: 40, name: "Dark Olive", rgb: [74, 107, 58] },
    { id: 41, name: "Olive", rgb: [90, 148, 74] },
    { id: 42, name: "Light Olive", rgb: [132, 197, 115] },
    { id: 43, name: "Dark Cyan", rgb: [15, 121, 159] },
    { id: 44, name: "Light Cyan", rgb: [187, 250, 242] },
    { id: 45, name: "Light Blue", rgb: [125, 199, 255] },
    { id: 46, name: "Dark Indigo", rgb: [77, 49, 184] },
    { id: 47, name: "Dark Slate Blue", rgb: [74, 66, 132] },
    { id: 48, name: "Slate Blue", rgb: [122, 113, 196] },
    { id: 49, name: "Light Slate Blue", rgb: [181, 174, 241] },
    { id: 50, name: "Light Brown", rgb: [219, 164, 99] },
    { id: 51, name: "Dark Beige", rgb: [209, 128, 81] },
    { id: 52, name: "Light Beige", rgb: [255, 197, 165] },
    { id: 53, name: "Dark Peach", rgb: [155, 82, 73] },
    { id: 54, name: "Peach", rgb: [209, 128, 120] },
    { id: 55, name: "Light Peach", rgb: [250, 182, 164] },
    { id: 56, name: "Dark Tan", rgb: [123, 99, 82] },
    { id: 57, name: "Tan", rgb: [156, 132, 107] },
    { id: 58, name: "Dark Slate", rgb: [51, 57, 65] },
    { id: 59, name: "Slate", rgb: [109, 117, 141] },
    { id: 60, name: "Light Slate", rgb: [179, 185, 209] },
    { id: 61, name: "Dark Stone", rgb: [109, 100, 63] },
    { id: 62, name: "Stone", rgb: [148, 140, 107] },
    { id: 63, name: "Light Stone", rgb: [205, 197, 158] }
];

// Fast exact-match lookup "r,g,b" -> entry (Transparent skipped, handled via alpha)
const EXACT = new Map();
for (const c of COLOR_PALETTE) {
    if (c.id === 0) continue;
    EXACT.set(c.rgb.join(','), c);
}

// Alpha-aware matcher: a=0 -> Transparent; exact match; nearest-color fallback
function matchColor(r, g, b, a) {
    if (a === 0) return COLOR_PALETTE[0];
    const exact = EXACT.get(r + ',' + g + ',' + b);
    if (exact) return exact;

    let best = COLOR_PALETTE[1];
    let bestD = Infinity;
    for (const c of COLOR_PALETTE) {
        if (c.id === 0) continue;
        const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
    }
    return best;
}

module.exports = { COLOR_PALETTE, matchColor };