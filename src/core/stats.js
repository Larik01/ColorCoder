// src/core/stats.js
// Rolling-window profiler shared by mitm, labels and (later) servo.
// Pure, Node-safe.

function makeWindow(cap) { return { cap: cap, vals: [] }; }

function push(w, v) {
    w.vals.push(v);
    if (w.vals.length > w.cap) w.vals.shift();
}

function avg(w) {
    const a = w.vals;
    return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}

function last(w) {
    return w.vals.length ? w.vals[w.vals.length - 1] : 0;
}

function makeStats(cap) {
    return {
        cap: cap,
        counters: {},
        windows: {},
        bump: function (key, n) {
            this.counters[key] = (this.counters[key] || 0) + (n === undefined ? 1 : n);
        },
        set: function (key, v) { this.counters[key] = v; },
        get: function (key) { return this.counters[key] || 0; },
        time: function (key, ms) {
            if (!this.windows[key]) this.windows[key] = makeWindow(cap);
            push(this.windows[key], ms);
        },
        avgOf: function (key) {
            return this.windows[key] ? avg(this.windows[key]) : 0;
        },
        snapshot: function () {
            const out = { counters: Object.assign({}, this.counters), windows: {} };
            for (const k in this.windows) out.windows[k] = +avg(this.windows[k]).toFixed(2);
            return out;
        }
    };
}

module.exports = { makeStats, makeWindow, push, avg, last };