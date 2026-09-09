// src/core/palette.js
// Pure palette data + color matching. NO Node dependencies (no pngjs, no fs)
// so it can be safely bundled into the Tampermonkey userscript by esbuild.

const COLOR_PALETTE = [
    { id: 0,  name: "Transparent",      rgb: [  0,   0,   0], premium: false },
    { id: 1,  name: "Black",            rgb: [  0,   0,   0], premium: false },
    { id: 2,  name: "Dark Gray",        rgb: [ 60,  60,  60], premium: false },
    { id: 3,  name: "Gray",             rgb: [120, 120, 120], premium: false },
    { id: 4,  name: "Light Gray",       rgb: [210, 210, 210], premium: false },
    { id: 5,  name: "White",            rgb: [255, 255, 255], premium: false },
    { id: 6,  name: "Deep Red",         rgb: [ 96,   0,  24], premium: false },
    { id: 7,  name: "Red",              rgb: [237,  28,  36], premium: false },
    { id: 8,  name: "Orange",           rgb: [255, 127,  39], premium: false },
    { id: 9,  name: "Gold",             rgb: [246, 170,   9], premium: false },
    { id: 10, name: "Yellow",           rgb: [249, 221,  59], premium: false },
    { id: 11, name: "Light Yellow",     rgb: [255, 250, 188], premium: false },
    { id: 12, name: "Dark Green",       rgb: [ 14, 185, 104], premium: false },
    { id: 13, name: "Green",            rgb: [ 19, 230, 123], premium: false },
    { id: 14, name: "Light Green",      rgb: [135, 255,  94], premium: false },
    { id: 15, name: "Dark Teal",        rgb: [ 12, 129, 110], premium: false },
    { id: 16, name: "Teal",             rgb: [ 16, 174, 166], premium: false },
    { id: 17, name: "Light Teal",       rgb: [ 19, 225, 190], premium: false },
    { id: 18, name: "Dark Blue",        rgb: [ 40,  80, 158], premium: false },
    { id: 19, name: "Blue",             rgb: [ 64, 147, 228], premium: false },
    { id: 20, name: "Cyan",             rgb: [ 96, 247, 242], premium: false },
    { id: 21, name: "Indigo",           rgb: [107,  80, 246], premium: false },
    { id: 22, name: "Light Indigo",     rgb: [153, 177, 251], premium: false },
    { id: 23, name: "Dark Purple",      rgb: [120,  12, 153], premium: false },
    { id: 24, name: "Purple",           rgb: [170,  56, 185], premium: false },
    { id: 25, name: "Light Purple",     rgb: [224, 159, 249], premium: false },
    { id: 26, name: "Dark Pink",        rgb: [203,   0, 122], premium: false },
    { id: 27, name: "Pink",             rgb: [236,  31, 128], premium: false },
    { id: 28, name: "Light Pink",       rgb: [243, 141, 169], premium: false },
    { id: 29, name: "Dark Brown",       rgb: [104,  70,  52], premium: false },
    { id: 30, name: "Brown",            rgb: [149, 104,  42], premium: false },
    { id: 31, name: "Beige",            rgb: [248, 178, 119], premium: false },
    { id: 32, name: "Medium Gray",      rgb: [170, 170, 170], premium: true },
    { id: 33, name: "Dark Red",         rgb: [165,  14,  30], premium: true },
    { id: 34, name: "Light Red",        rgb: [250, 128, 114], premium: true },
    { id: 35, name: "Dark Orange",      rgb: [228,  92,  26], premium: true },
    { id: 36, name: "Light Tan",        rgb: [214, 181, 148], premium: true },
    { id: 37, name: "Dark Goldenrod",   rgb: [156, 132,  49], premium: true },
    { id: 38, name: "Goldenrod",        rgb: [197, 173,  49], premium: true },
    { id: 39, name: "Light Goldenrod",  rgb: [232, 212,  95], premium: true },
    { id: 40, name: "Dark Olive",       rgb: [ 74, 107,  58], premium: true },
    { id: 41, name: "Olive",            rgb: [ 90, 148,  74], premium: true },
    { id: 42, name: "Light Olive",      rgb: [132, 197, 115], premium: true },
    { id: 43, name: "Dark Cyan",        rgb: [ 15, 121, 159], premium: true },
    { id: 44, name: "Light Cyan",       rgb: [187, 250, 242], premium: true },
    { id: 45, name: "Light Blue",       rgb: [125, 199, 255], premium: true },
    { id: 46, name: "Dark Indigo",      rgb: [ 77,  49, 184], premium: true },
    { id: 47, name: "Dark Slate Blue",  rgb: [ 74,  66, 132], premium: true },
    { id: 48, name: "Slate Blue",       rgb: [122, 113, 196], premium: true },
    { id: 49, name: "Light Slate Blue", rgb: [181, 174, 241], premium: true },
    { id: 50, name: "Light Brown",      rgb: [219, 164,  99], premium: true },
    { id: 51, name: "Dark Beige",       rgb: [209, 128,  81], premium: true },
    { id: 52, name: "Light Beige",      rgb: [255, 197, 165], premium: true },
    { id: 53, name: "Dark Peach",       rgb: [155,  82,  73], premium: true },
    { id: 54, name: "Peach",            rgb: [209, 128, 120], premium: true },
    { id: 55, name: "Light Peach",      rgb: [250, 182, 164], premium: true },
    { id: 56, name: "Dark Tan",         rgb: [123,  99,  82], premium: true },
    { id: 57, name: "Tan",              rgb: [156, 132, 107], premium: true },
    { id: 58, name: "Dark Slate",       rgb: [ 51,  57,  65], premium: true },
    { id: 59, name: "Slate",            rgb: [109, 117, 141], premium: true },
    { id: 60, name: "Light Slate",      rgb: [179, 185, 209], premium: true },
    { id: 61, name: "Dark Stone",       rgb: [109, 100,  63], premium: true },
    { id: 62, name: "Stone",            rgb: [148, 140, 107], premium: true },
    { id: 63, name: "Light Stone",      rgb: [205, 197, 158], premium: true }
];

// Extract subsets for easy V2 free-color filtering
const FREE_IDS = COLOR_PALETTE.filter(c => !c.premium).map(c => c.id);
const PREMIUM_IDS = COLOR_PALETTE.filter(c => c.premium).map(c => c.id);

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

module.exports = { COLOR_PALETTE, matchColor, FREE_IDS, PREMIUM_IDS };