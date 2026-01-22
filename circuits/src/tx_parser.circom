pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";

/**
 * Selector for variable array indexing
 * Creates a one-hot selector based on index
 *
 * @param n - Array size
 */
template Selector(n) {
    signal input index;
    signal output out[n];

    // Create one-hot encoding: out[i] = 1 if index == i, else 0
    component isEq[n];
    for (var i = 0; i < n; i++) {
        isEq[i] = IsEqual();
        isEq[i].in[0] <== index;
        isEq[i].in[1] <== i;
        out[i] <== isEq[i].out;
    }

    // Verify exactly one is selected (index in range)
    signal sumCheck;
    var sum = 0;
    for (var i = 0; i < n; i++) {
        sum += out[i];
    }
    sumCheck <== sum;
    sumCheck === 1;
}

/**
 * Extract a single bit from array at variable offset with proper constraints
 *
 * @param n - Array size in bits
 */
template ExtractBit(n) {
    signal input bits[n];
    signal input offset;  // Must be in range [0, n-1]
    signal output out;

    // Create selector for the offset
    component selector = Selector(n);
    selector.index <== offset;

    // Compute weighted sum: out = sum(selector[i] * bits[i])
    signal products[n];
    var sum = 0;
    for (var i = 0; i < n; i++) {
        products[i] <== selector.out[i] * bits[i];
        sum += products[i];
    }
    out <== sum;
}

/**
 * Extract multiple consecutive bits from array at variable byte offset
 * Uses selector-based extraction for soundness
 *
 * NOTE: Offset is in BYTES (not bits) to reduce selector size
 *
 * @param maxBytes - Maximum array size in bytes
 * @param extractBits - Number of bits to extract
 */
template ExtractBitsAtByteOffset(maxBytes, extractBits) {
    signal input bits[maxBytes * 8];
    signal input byteOffset;  // Offset in bytes (must be in range [0, maxBytes - extractBits/8])
    signal output out[extractBits];

    // Create selector for byte offset
    component selector = Selector(maxBytes);
    selector.index <== byteOffset;

    // Declare contributions as 2D array at template scope (circom requirement)
    signal contributions[extractBits][maxBytes];

    // For each bit to extract, compute weighted sum across all possible offsets
    // out[j] = sum over all byte offsets i: selector[i] * bits[i*8 + j]
    for (var j = 0; j < extractBits; j++) {
        var sum = 0;
        for (var i = 0; i < maxBytes; i++) {
            // Bit position at byte offset i for extraction bit j
            var bitPos = i * 8 + j;
            // Only include if within bounds (should always be true for valid inputs)
            if (bitPos < maxBytes * 8) {
                contributions[j][i] <== selector.out[i] * bits[bitPos];
            } else {
                contributions[j][i] <== 0;
            }
            sum += contributions[j][i];
        }
        out[j] <== sum;
    }
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
 * Verify that a Bitcoin transaction output at a given offset:
 * 1. Has the expected value (amount in satoshis)
 * 2. Has the expected script (locker script)
 *
 * Output format in Bitcoin:
 * - Value: 8 bytes (little-endian uint64)
 * - Script length: varint (1-9 bytes, usually 1 for small scripts)
 * - Script: variable bytes
 *
 * SECURITY: Uses selector-based extraction to properly constrain that
 * the extracted value/script actually come from the transaction at the
 * claimed offset. This prevents a malicious prover from claiming arbitrary
 * amounts.
 *
 * @param maxTxBytes - Maximum transaction size in bytes
 * @param maxScriptBits - Maximum script size in bits
 */
template VerifyTxOutput(maxTxBytes, maxScriptBits) {
    signal input txBits[maxTxBytes * 8];
    signal input outputByteOffset;      // Byte offset where output starts
    signal input expectedAmount;        // Expected value in satoshis
    signal input expectedScript[maxScriptBits];
    signal input expectedScriptLength;  // In bytes

    signal output isValid;

    // ═══════════════════════════════════════════════════════════════════
    // Step 1: Extract value (8 bytes = 64 bits) at outputByteOffset
    // Uses constrained selector-based extraction
    // ═══════════════════════════════════════════════════════════════════

    component valueExtractor = ExtractBitsAtByteOffset(maxTxBytes, 64);
    for (var i = 0; i < maxTxBytes * 8; i++) {
        valueExtractor.bits[i] <== txBits[i];
    }
    valueExtractor.byteOffset <== outputByteOffset;

    // Convert little-endian bytes to value
    // Bitcoin stores values as little-endian uint64
    // Our bits are stored as big-endian within each byte (MSB first)
    // Bits2Num expects bits in little-endian order (LSB first)
    //
    // For a value like 10000000 satoshis = 0x00989680:
    // - Stored in TX as bytes: 80 96 98 00 00 00 00 00 (LE)
    // - Byte 0 (0x80) bits in our format: [1,0,0,0,0,0,0,0] (MSB first)
    // - For Bits2Num: need [0,0,0,0,0,0,0,1] (LSB first)
    component bits2num = Bits2Num(64);

    for (var byteIdx = 0; byteIdx < 8; byteIdx++) {
        for (var bitIdx = 0; bitIdx < 8; bitIdx++) {
            // Source bit: byteIdx*8 + bitIdx (MSB first within byte)
            // Dest bit: byteIdx*8 + (7-bitIdx) (LSB first within byte)
            var srcBit = byteIdx * 8 + bitIdx;
            var dstBit = byteIdx * 8 + (7 - bitIdx);
            bits2num.in[dstBit] <== valueExtractor.out[srcBit];
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
    // Script starts at outputByteOffset + 8 (value) + 1 (length) = +9 bytes

    signal scriptByteOffset;
    scriptByteOffset <== outputByteOffset + 9;

    // Extract script bits using constrained selector
    // Compare up to 25 bytes (200 bits) - handles all standard script types
    var MAX_SCRIPT_BITS = 200;  // 25 bytes

    component scriptExtractor = ExtractBitsAtByteOffset(maxTxBytes, MAX_SCRIPT_BITS);
    for (var i = 0; i < maxTxBytes * 8; i++) {
        scriptExtractor.bits[i] <== txBits[i];
    }
    scriptExtractor.byteOffset <== scriptByteOffset;

    // Compare with expected script using XOR
    signal scriptXor[MAX_SCRIPT_BITS];
    signal xorAccum[MAX_SCRIPT_BITS + 1];
    xorAccum[0] <== 0;

    for (var i = 0; i < MAX_SCRIPT_BITS; i++) {
        // XOR = a + b - 2*a*b (0 if bits match)
        scriptXor[i] <== scriptExtractor.out[i] + expectedScript[i] - 2 * scriptExtractor.out[i] * expectedScript[i];
        xorAccum[i + 1] <== xorAccum[i] + scriptXor[i];
    }

    // scriptMatch = 1 if all XORs are 0 (sum is 0)
    component scriptEqual = IsZero();
    scriptEqual.in <== xorAccum[MAX_SCRIPT_BITS];

    signal scriptMatch;
    scriptMatch <== scriptEqual.out;

    // Verify script length is valid (22-25 bytes)
    // - P2WPKH: 22 bytes
    // - P2SH:   23 bytes
    // - P2PKH:  25 bytes
    component lengthMin = GreaterEqThan(8);
    lengthMin.in[0] <== expectedScriptLength;
    lengthMin.in[1] <== 22;

    component lengthMax = LessEqThan(8);
    lengthMax.in[0] <== expectedScriptLength;
    lengthMax.in[1] <== 25;

    signal scriptLengthValid;
    scriptLengthValid <== lengthMin.out * lengthMax.out;
    scriptLengthValid === 1;

    // ═══════════════════════════════════════════════════════════════════
    // Step 3: Both must match
    // ═══════════════════════════════════════════════════════════════════

    isValid <== valueMatch * scriptMatch;
}
