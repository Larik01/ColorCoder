// DJB2 checksum (5 bits) - works on binary string
function djb2Checksum5(binaryString) {
    let hash = 5381;
    for (let i = 0; i < binaryString.length; i++) {
        hash = ((hash << 5) + hash) + binaryString.charCodeAt(i);
        hash = hash | 0; // <--- THE FIX: Force 32-bit integer
    }
    return hash & 0x1F;
}

module.exports = { djb2Checksum5 };