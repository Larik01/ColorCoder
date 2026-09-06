// scripts/build.js
// Bundles src/script.js + all core/ modules into ONE userscript file,
// then prepends the ==UserScript== header from src/meta.js.
// Usage:  node scripts/build.js          -> minified (distribution, like BM)
//         node scripts/build.js --dev    -> readable (debugging)

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const dev = process.argv.includes('--dev');
const root = path.join(__dirname, '..');

// 1. Load header and stamp version from package.json
const meta = fs.readFileSync(path.join(root, 'src', 'meta.js'), 'utf8').trim();
const pkg = require(path.join(root, 'package.json'));
const header = meta.replace('{{VERSION}}', pkg.version);

// 2. Bundle everything into a single JS blob
const result = esbuild.buildSync({
    entryPoints: [path.join(root, 'src', 'script.js')],
    bundle: true,
    minify: !dev,
    write: false,
    target: ['es2020'],
    logLevel: 'warning'
});

// 3. Glue header + bundle -> dist/script.user.js
const bundle = result.outputFiles[0].text;
const out = header + '\n' + bundle;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'script.user.js'), out);

console.log('Built dist/script.user.js (' + out.length + ' bytes, ' +
    (dev ? 'readable dev build' : 'minified') + ')');