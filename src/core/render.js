// src/core/render.js
// Renders a palette-id sequence into a 1xN PNG Blob with exact palette RGBs.
// Browser-only (canvas). Used by templates.js and, later, GUI previews.

const { COLOR_PALETTE } = require('./palette.js');

// sequence: Array<number> (palette ids) -> Promise<Blob> image/png, 1px tall
function sequenceToPngBlob(sequence) {
    const canvas = document.createElement('canvas');
    canvas.width = sequence.length;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(sequence.length, 1);

    for (let x = 0; x < sequence.length; x++) {
        const c = COLOR_PALETTE[sequence[x]] || COLOR_PALETTE[1];
        img.data[x * 4]     = c.rgb[0];
        img.data[x * 4 + 1] = c.rgb[1];
        img.data[x * 4 + 2] = c.rgb[2];
        // id 0 (Transparent) stays a real gap in the template, like BM does
        img.data[x * 4 + 3] = (sequence[x] === 0) ? 0 : 255;
    }

    ctx.putImageData(img, 0, 0);
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
}

module.exports = { sequenceToPngBlob };