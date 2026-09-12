// tests/pngio.js
// Node-only PNG IO toolkit for tests. Never bundled into the userscript.
// Moved verbatim from src/core/colors.js; only the palette path changed.

const PNG = require('pngjs').PNG;
const fs = require('fs');

const { COLOR_PALETTE } = require('../src/core/palette.js');

// Get RGB color by index (0-63)
function getColor(index) {
    if (index < 0 || index >= COLOR_PALETTE.length) {
        throw new Error('Invalid color index: ' + index + '. Must be 0-63');
    }
    return COLOR_PALETTE[index].rgb;
}

// Get color name by index
function getColorName(index) {
    if (index < 0 || index >= COLOR_PALETTE.length) {
        return 'Unknown';
    }
    return COLOR_PALETTE[index].name;
}

// Convert pixel values to RGB array
function pixelsToRGB(pixels) {
    return pixels.map(function(val) {
        return getColor(val);
    });
}

// Convert RGB + Alpha to color index (for testing PNG reading)
function rgbToIndex(r, g, b, a) {
    // Handle transparent pixel (index 0)
    if (a === 0) {
        return 0;
    }

    // For black pixels with alpha > 0, treat as index 1 (Black)
    if (r === 0 && g === 0 && b === 0 && a > 0) {
        return 1;
    }

    // Find exact match in palette for non-black colors
    for (let i = 0; i < COLOR_PALETTE.length; i++) {
        const color = COLOR_PALETTE[i].rgb;
        if (color[0] === r && color[1] === g && color[2] === b) {
            return i;
        }
    }

    // If no exact match, find closest (for testing robustness)
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < COLOR_PALETTE.length; i++) {
        const color = COLOR_PALETTE[i].rgb;
        const dist = Math.sqrt(
            Math.pow(color[0] - r, 2) +
            Math.pow(color[1] - g, 2) +
            Math.pow(color[2] - b, 2)
        );
        if (dist < closestDist) {
            closestDist = dist;
            closest = i;
        }
    }
    return closest;
}

// Convert pixel indices to PNG buffer with proper alpha
function pixelsToPNG(pixels, width, height) {
    const totalPixels = width * height;

    if (pixels.length !== totalPixels) {
        throw new Error('Pixel count mismatch: expected ' + totalPixels + ', got ' + pixels.length);
    }

    // Create PNG
    const png = new PNG({ width: width, height: height });

    // Fill pixel data with proper alpha
    for (let i = 0; i < totalPixels; i++) {
        const index = pixels[i];
        const rgb = getColor(index);
        const idx = i * 4;

        png.data[idx] = rgb[0];     // R
        png.data[idx + 1] = rgb[1]; // G
        png.data[idx + 2] = rgb[2]; // B

        // Alpha: 0 for Transparent (index 0), 255 for everything else
        png.data[idx + 3] = (index === 0) ? 0 : 255;
    }

    return PNG.sync.write(png);
}

// Save PNG to file
function savePNG(pixels, width, height, filepath) {
    const buffer = pixelsToPNG(pixels, width, height);
    fs.writeFileSync(filepath, buffer);
    return filepath;
}

// Read PNG file and convert to pixel indices (for testing only)
function readPNG(filepath) {
    const buffer = fs.readFileSync(filepath);
    const png = PNG.sync.read(buffer);

    const pixels = [];
    const totalPixels = png.width * png.height;

    for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        const a = png.data[idx + 3];

        const index = rgbToIndex(r, g, b, a);
        pixels.push(index);
    }

    return { pixels, width: png.width, height: png.height };
}

module.exports = {
    COLOR_PALETTE,
    getColor,
    getColorName,
    pixelsToRGB,
    rgbToIndex,
    pixelsToPNG,
    savePNG,
    readPNG
};