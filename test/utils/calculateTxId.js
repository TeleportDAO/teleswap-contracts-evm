const crypto = require('crypto');

/**
 * Calculate Bitcoin transaction ID from transaction components
 * Returns the txid with bytes reversed
 * @param {string} version - 4-byte version number in hex
 * @param {string} vin - Transaction inputs in hex
 * @param {string} vout - Transaction outputs in hex
 * @param {string} locktime - 4-byte locktime in hex
 * @returns {string} Transaction ID with reversed byte order
 */
function calculateTxId(version, vin, vout, locktime) {
    // Remove '0x' prefix if present
    version = version.replace('0x', '');
    vin = vin.replace('0x', '');
    vout = vout.replace('0x', '');
    locktime = locktime.replace('0x', '');

    // Concatenate all components
    const txData = version + vin + vout + locktime;

    // Convert hex string to buffer
    const txBuffer = Buffer.from(txData, 'hex');

    // Perform double SHA256
    const firstHash = crypto.createHash('sha256').update(txBuffer).digest();
    const secondHash = crypto.createHash('sha256').update(firstHash).digest();

    // Convert to hex string without 0x prefix
    const hexString = secondHash.toString('hex');
    
    return '0x' + hexString;
}

function revertBytes(hexString) {
    // Remove 0x prefix if present
    hexString = hexString.replace('0x', '');

    // Split into bytes (2 characters each)
    const bytes = [];
    for (let i = 0; i < hexString.length; i += 2) {
        bytes.push(hexString.substr(i, 2));
    }

    // Reverse the bytes and join
    const reversedHex = bytes.reverse().join('');

    // Return with 0x prefix
    return '0x' + reversedHex;
}

module.exports = {
    calculateTxId
}; 