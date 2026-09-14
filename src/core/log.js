// src/core/log.js
// Centralized logger. Avoids circular dependencies between core modules and GUI.
let muted = false;

module.exports = {
    setMuted: function(m) { muted = !!m; },
    isMuted: function() { return muted; },
    info: function(msg) { if (!muted) console.log(msg); },
    warn: function(msg) { if (!muted) console.warn(msg); },
    err: function(msg) { if (!muted) console.error(msg); },
    styled: function(msg, style) { if (!muted) console.log('%c' + msg, style); }
};