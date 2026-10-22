// src/core/geo.js
// Wplace coordinate binding: Web Mercator projection with canvas center at
// tile (1024, 1024) = lat 0, lng 0. Canvas is 2048 tiles × 2048 tiles.

const MAP_SIZE = 2048000; // 2048 tiles * 1000 pixels per tile

// Global pixel coordinates -> geographic (lat/lng)
function gridToNav(gx, gy) {
    const lng = (gx / MAP_SIZE) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * gy) / MAP_SIZE;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lng };
}

// Geographic (lat/lng) -> global pixel coordinates
function navToGrid(lat, lng) {
    const gx = Math.round(((lng + 180) / 360) * MAP_SIZE);
    const latRad = (lat * Math.PI) / 180;
    const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const gy = Math.round((MAP_SIZE / 2) * (1 - mercY / Math.PI));
    return { gx, gy };
}

// Global pixel -> tile/px (what the info popup shows)
function gridToTilePx(gx, gy) {
    return {
        tileX: Math.floor(gx / 1000),
        tileY: Math.floor(gy / 1000),
        px: gx % 1000,
        py: gy % 1000
    };
}

// Tile/px -> global pixel
function tilePxToGrid(tileX, tileY, px, py) {
    return {
        gx: tileX * 1000 + px,
        gy: tileY * 1000 + py
    };
}

// Build a wplace share URL centered on the given global pixel coordinates
function buildGotoUrl(gx, gy, zoom) {
    const { lat, lng } = gridToNav(gx, gy);
    const z = zoom || 15;
    return `https://wplace.live/?lat=${lat}&lng=${lng}&zoom=${z}`;
}

module.exports = {
    MAP_SIZE,
    gridToNav,
    navToGrid: navToGrid,
    gridToTilePx,
    tilePxToGrid,
    buildGotoUrl
};