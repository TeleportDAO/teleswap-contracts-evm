pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/comparators.circom";

/*
 * Bitcoin Transaction Verification Circuit - ULTRA MINIMAL MVP
 *
 * This is the SIMPLEST possible version to test the full pipeline:
 * compile -> setup -> prove -> verify -> on-chain verification
 *
 * What it proves:
 * - We know a transaction (private)
 * - A specific vout (public) matches bytes 70-133 of the transaction
 *   (This is where vout[0] starts in this specific transaction)
 *
 * What it SKIPS:
 * - Double SHA256 hashing
 * - Merkle proof verification
 * - Dynamic offset selection
 *
 * Estimated constraints: ~500
 */

template VoutInTransaction() {
    // Transaction: 192 bytes = 1536 bits
    // Vout: 64 bytes = 512 bits
    // Fixed offset: byte 72 = bit 576 (where vout typically starts after version + vin)

    var txBits = 1536;
    var voutBits = 512;
    var voutStartBit = 560;  // byte 70 * 8 (version:4 + vin:65 + vout_count:1 = 70)

    // Public inputs
    signal input voutData[voutBits];      // The vout data (64 bytes) - PUBLIC
    signal input txHash;                   // Pre-computed tx hash - PUBLIC (for reference)

    // Private inputs
    signal input transaction[txBits];      // Full transaction (192 bytes) - PRIVATE

    // ========================================
    // Verify voutData matches transaction at fixed offset
    // ========================================

    // Simply check that each bit of voutData equals the corresponding bit in transaction
    for (var i = 0; i < voutBits; i++) {
        voutData[i] === transaction[voutStartBit + i];
    }

    // Dummy constraint on txHash to include it as a public input
    signal txHashSquared;
    txHashSquared <== txHash * txHash;
}

component main {public [voutData, txHash]} = VoutInTransaction();
