// src/alphabet.js
// 62-character alphabet: a-z (26) + 0-9 (10) + space + punctuation (25).
// Lite 6-bit values 62 and 63 are intentionally unused by the encoder;
// they decode as '?' with badChars set, acting as corruption markers.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 .!?-_:;'\"()[]{}@#$%&/=+<>";

module.exports = { ALPHABET };