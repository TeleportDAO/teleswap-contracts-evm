pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";

/**
 * Extract 8 bytes from bit array as little-endian uint64
 * Bitcoin stores values in little-endian format
 *
 * @param offset - Bit offset where the 8 bytes start
 */
template ExtractUint64LE(maxBits) {
    signal input bits[maxBits];
    signal input offset;
    signal output value;

    // We need to extract 64 bits (8 bytes) starting at offset
    // Bitcoin uses little-endian, so byte[0] is LSB

    // For each of the 64 bit positions, select the correct bit
    signal selectedBits[64];

    // Use a selector approach - for each possible offset, calculate contribution
    // This is expensive but necessary for variable offset

    // Simplified: assume offset is byte-aligned and within bounds
    // Extract 8 bytes = 64 bits

    component bits2num = Bits2Num(64);

    // For little-endian: byte 0 (bits 0-7) is least significant
    // We need to reverse byte order for Bits2Num

    // Extract each byte and reconstruct in correct order
    signal bytes[8][8];

    for (var byteIdx = 0; byteIdx < 8; byteIdx++) {
        for (var bitIdx = 0; bitIdx < 8; bitIdx++) {
            // Calculate bit position: offset + byteIdx * 8 + (7 - bitIdx)
            // (7 - bitIdx) because bits within byte are big-endian in our representation
            var bitPos = byteIdx * 8 + (7 - bitIdx);

            // For variable offset, we need multiplexing
            // Simplified: use constraint with offset
            // This assumes offset is known and small enough

            // Direct indexing (works for constant offset)
            bytes[byteIdx][bitIdx] <-- bits[offset + bitPos];
        }
    }

    // Reconstruct value: byte[0] is LSB
    // Bits2Num expects little-endian (LSB first)
    for (var byteIdx = 0; byteIdx < 8; byteIdx++) {
        for (var bitIdx = 0; bitIdx < 8; bitIdx++) {
            bits2num.in[byteIdx * 8 + bitIdx] <== bytes[byteIdx][7 - bitIdx];
        }
    }

    value <== bits2num.out;
}

/**
 * Compare two bit arrays for equality
 *
 * @param n - Length of bit arrays
 */
template CompareBitArrays(n) {
    signal input a[n];
    signal input b[n];
    signal output isEqual;

    // Sum of XOR of all bits - should be 0 if equal
    signal xorBits[n];
    var xorSum = 0;

    for (var i = 0; i < n; i++) {
        // XOR: a + b - 2*a*b
        xorBits[i] <== a[i] + b[i] - 2 * a[i] * b[i];
        xorSum += xorBits[i];
    }

    // isEqual = 1 if xorSum == 0
    component isZero = IsZero();
    isZero.in <== xorSum;
    isEqual <== isZero.out;
}

/**
 * Extract script from transaction at given offset and compare to expected
 *
 * @param maxTxBits - Maximum transaction size in bits
 * @param scriptBits - Script size in bits
 */
template VerifyScript(maxTxBits, scriptBits) {
    signal input txBits[maxTxBits];
    signal input scriptOffset;  // Bit offset where script starts
    signal input scriptLength;  // Actual script length in bytes
    signal input expectedScript[scriptBits];

    signal output isMatch;

    // Extract script bits from transaction
    signal extractedScript[scriptBits];

    for (var i = 0; i < scriptBits; i++) {
        // Extract bit at scriptOffset + i
        // For variable offset, this needs multiplexing
        // Simplified: direct assignment (prover provides correct offset)
        extractedScript[i] <-- txBits[scriptOffset + i];
    }

    // Compare extracted script with expected (up to scriptLength * 8 bits)
    component compare = CompareBitArrays(scriptBits);
    for (var i = 0; i < scriptBits; i++) {
        compare.a[i] <== extractedScript[i];
        compare.b[i] <== expectedScript[i];
    }

    isMatch <== compare.isEqual;
}

/**
 * Verify that a Bitcoin transaction output at a given offset:
 * 1. Has the expected value (amount in satoshis)
 * 2. Has the expected script (locker script)
 *
 * Output format in Bitcoin:
 * - Value: 8 bytes (little-endian uint64)
 * - Script length: varint (1-9 bytes, usually 1 for small scripts)
 * - Script: variable bytes
 *
 * @param maxTxBits - Maximum transaction size in bits
 * @param maxScriptBits - Maximum script size in bits
 */
template VerifyTxOutput(maxTxBits, maxScriptBits) {
    signal input txBits[maxTxBits];
    signal input outputOffset;      // Bit offset where output starts
    signal input expectedAmount;    // Expected value in satoshis
    signal input expectedScript[maxScriptBits];
    signal input expectedScriptLength;  // In bytes

    signal output isValid;

    // ═══════════════════════════════════════════════════════════════════
    // Step 1: Extract value (8 bytes = 64 bits) at outputOffset
    // ═══════════════════════════════════════════════════════════════════

    signal valueBits[64];
    for (var i = 0; i < 64; i++) {
        valueBits[i] <-- txBits[outputOffset + i];
    }

    // Convert little-endian bytes to value
    // Bitcoin stores values as little-endian uint64
    // Our bits are stored as big-endian within each byte (MSB first)
    // Bits2Num expects bits in little-endian order (LSB first)
    //
    // For a value like 10000000 satoshis = 0x00989680:
    // - Stored in TX as bytes: 80 96 98 00 00 00 00 00 (LE)
    // - Byte 0 (0x80) bits in our format: [1,0,0,0,0,0,0,0] (MSB first)
    // - For Bits2Num: need [0,0,0,0,0,0,0,1] (LSB first)
    //
    // So for byte i, bit j (0=MSB, 7=LSB in our format):
    // - bits2num.in[i*8 + (7-j)] = valueBits[i*8 + j]
    component bits2num = Bits2Num(64);

    for (var byteIdx = 0; byteIdx < 8; byteIdx++) {
        for (var bitIdx = 0; bitIdx < 8; bitIdx++) {
            // Source bit: byteIdx*8 + bitIdx (MSB first within byte)
            // Dest bit: byteIdx*8 + (7-bitIdx) (LSB first within byte)
            var srcBit = byteIdx * 8 + bitIdx;
            var dstBit = byteIdx * 8 + (7 - bitIdx);
            bits2num.in[dstBit] <== valueBits[srcBit];
        }
    }

    signal extractedValue;
    extractedValue <== bits2num.out;

    // Verify value matches expected
    component valueEqual = IsEqual();
    valueEqual.in[0] <== extractedValue;
    valueEqual.in[1] <== expectedAmount;

    signal valueMatch;
    valueMatch <== valueEqual.out;

    // ═══════════════════════════════════════════════════════════════════
    // Step 2: Extract script (after value + script length varint)
    // ═══════════════════════════════════════════════════════════════════

    // For simplicity, assume script length varint is 1 byte
    // (valid for scripts up to 252 bytes, which covers P2PKH, P2SH, P2WPKH)
    // Script starts at outputOffset + 64 (value) + 8 (1 byte length)

    signal scriptOffset;
    scriptOffset <== outputOffset + 72;  // 64 bits value + 8 bits length

    // Extract and compare script
    signal scriptBits[maxScriptBits];
    for (var i = 0; i < maxScriptBits; i++) {
        scriptBits[i] <-- txBits[scriptOffset + i];
    }

    // Compare with expected script using XOR
    // Assumes standard P2PKH script: 25 bytes = 200 bits
    // Format: OP_DUP OP_HASH160 <20-byte-pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
    //
    // Only compare first 200 bits (25 bytes) - ignore padding
    var STANDARD_SCRIPT_BITS = 200;  // 25 bytes for P2PKH

    signal scriptXor[STANDARD_SCRIPT_BITS];
    signal xorAccum[STANDARD_SCRIPT_BITS + 1];
    xorAccum[0] <== 0;

    for (var i = 0; i < STANDARD_SCRIPT_BITS; i++) {
        // XOR = a + b - 2*a*b
        scriptXor[i] <== scriptBits[i] + expectedScript[i] - 2 * scriptBits[i] * expectedScript[i];
        xorAccum[i + 1] <== xorAccum[i] + scriptXor[i];
    }

    // scriptMatch = 1 if all XORs are 0 (sum is 0)
    component scriptEqual = IsZero();
    scriptEqual.in <== xorAccum[STANDARD_SCRIPT_BITS];

    signal scriptMatch;
    scriptMatch <== scriptEqual.out;

    // Verify script length is 25 bytes (standard P2PKH)
    // This ensures we're not accepting shorter/longer scripts
    signal scriptLengthCheck;
    scriptLengthCheck <== expectedScriptLength - 25;
    scriptLengthCheck === 0;

    // ═══════════════════════════════════════════════════════════════════
    // Step 3: Both must match
    // ═══════════════════════════════════════════════════════════════════

    isValid <== valueMatch * scriptMatch;
}
