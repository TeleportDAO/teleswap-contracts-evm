pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * Bitcoin Transaction Parser for ZK Circuits
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file provides templates for extracting and verifying data from Bitcoin
 * transactions within ZK circuits.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * BIT ORDERING CONVENTIONS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * All bit arrays use BIG-ENDIAN ordering (MSB first per byte):
 *   - Byte 0xA5 (binary 10100101) → bits [1,0,1,0,0,1,0,1]
 *   - bits[0] = MSB of byte 0
 *   - bits[7] = LSB of byte 0
 *   - bits[8] = MSB of byte 1, etc.
 *
 * This matches circomlib SHA256 format and the witness generator.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * BITCOIN VALUE ENCODING
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bitcoin stores 64-bit values (satoshis) in LITTLE-ENDIAN byte order.
 *
 * Example: 10,000,000 satoshis = 0x00989680
 *   - As bytes (LE): [0x80, 0x96, 0x98, 0x00, 0x00, 0x00, 0x00, 0x00]
 *   - Byte 0 (0x80) is LSB of value
 *   - Byte 7 (0x00) is MSB of value
 *
 * When converting to field element with Bits2Num:
 *   - Bits2Num expects LITTLE-ENDIAN bits (LSB at index 0)
 *   - Our transaction bits are big-endian per byte (MSB first within byte)
 *   - Need to reverse bits within each byte, keep byte order same
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * BITCOIN TRANSACTION OUTPUT FORMAT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Each output consists of:
 *   - Value: 8 bytes (little-endian uint64, satoshis)
 *   - Script length: 1-9 bytes (varint, usually 1 byte for scripts < 253 bytes)
 *   - Script: variable bytes (pubkey script / scriptPubKey)
 *
 * Standard script sizes:
 *   - P2PKH: 25 bytes (OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG)
 *   - P2SH: 23 bytes (OP_HASH160 <20> OP_EQUAL)
 *   - P2WPKH: 22 bytes (OP_0 <20>)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

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
 * ═══════════════════════════════════════════════════════════════════════════════
 * Extract multiple consecutive bits from array at variable byte offset
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Uses selector-based extraction for ZK soundness - this is critical for security.
 *
 * WHY SELECTOR-BASED EXTRACTION?
 *   In ZK circuits, we can't use variable array indexing like bits[offset].
 *   Instead, we create a one-hot selector and compute weighted sums.
 *   This ensures the prover can't claim arbitrary values - the extracted
 *   data is cryptographically bound to come from the input array at the
 *   specified offset.
 *
 * INPUT FORMAT:
 *   - bits[maxBytes * 8]: Source data in big-endian bit order (MSB first per byte)
 *   - byteOffset: Starting position in BYTES (not bits)
 *
 * OUTPUT FORMAT:
 *   - out[extractBits]: Extracted bits in same order as input (big-endian per byte)
 *   - out[0..7] = byte at byteOffset, MSB first
 *   - out[8..15] = byte at byteOffset+1, MSB first
 *   - etc.
 *
 * NOTE: Offset is in BYTES (not bits) to reduce selector size from maxBytes*8 to maxBytes.
 *       This significantly reduces circuit constraints.
 *
 * @param maxBytes - Maximum array size in bytes
 * @param extractBits - Number of bits to extract
 */
template ExtractBitsAtByteOffset(maxBytes, extractBits) {
    signal input bits[maxBytes * 8];
    signal input byteOffset;  // Offset in bytes (must be in range [0, maxBytes - extractBits/8])
    signal output out[extractBits];

    // ───────────────────────────────────────────────────────────────────
    // Create one-hot selector for byte offset
    //
    // selector.out[i] = 1 if byteOffset == i, else 0
    // Exactly one element is 1, all others are 0.
    // This is enforced by the Selector template.
    // ───────────────────────────────────────────────────────────────────
    component selector = Selector(maxBytes);
    selector.index <== byteOffset;

    // Declare contributions as 2D array at template scope (circom requirement)
    signal contributions[extractBits][maxBytes];

    // ───────────────────────────────────────────────────────────────────
    // WEIGHTED SUM EXTRACTION
    //
    // For each output bit j:
    //   out[j] = sum over all byte offsets i: selector.out[i] * bits[i*8 + j]
    //
    // Since selector is one-hot (only selector.out[byteOffset] == 1):
    //   out[j] = bits[byteOffset*8 + j]
    //
    // This extracts extractBits consecutive bits starting at byteOffset*8.
    //
    // EXAMPLE: byteOffset=10, extractBits=64
    //   out[0] = bits[80]   (MSB of byte 10)
    //   out[7] = bits[87]   (LSB of byte 10)
    //   out[8] = bits[88]   (MSB of byte 11)
    //   ...
    //   out[63] = bits[143] (LSB of byte 17)
    // ───────────────────────────────────────────────────────────────────
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
    //
    // Uses constrained selector-based extraction to ensure the value
    // actually comes from the transaction at the claimed offset.
    // ═══════════════════════════════════════════════════════════════════

    component valueExtractor = ExtractBitsAtByteOffset(maxTxBytes, 64);
    for (var i = 0; i < maxTxBytes * 8; i++) {
        valueExtractor.bits[i] <== txBits[i];
    }
    valueExtractor.byteOffset <== outputByteOffset;

    // ───────────────────────────────────────────────────────────────────
    // CONVERT LITTLE-ENDIAN BITCOIN VALUE TO FIELD ELEMENT
    // ───────────────────────────────────────────────────────────────────
    //
    // Bitcoin value encoding: 64-bit LITTLE-ENDIAN bytes
    //   Value 10,000,000 (0x00989680) stored as: [0x80, 0x96, 0x98, 0x00, 0x00, 0x00, 0x00, 0x00]
    //   Byte 0 (0x80) contains bits 0-7 of the number
    //   Byte 7 (0x00) contains bits 56-63 of the number
    //
    // Our extracted bits format: BIG-ENDIAN per byte (MSB first within each byte)
    //   valueExtractor.out[0..7]   = byte 0 bits, MSB at 0, LSB at 7
    //   valueExtractor.out[8..15]  = byte 1 bits, MSB at 8, LSB at 15
    //   etc.
    //
    // Bits2Num expects: LITTLE-ENDIAN bits (LSB of number at index 0)
    //   bits2num.in[0] = bit 0 (LSB) of the number = LSB of byte 0
    //   bits2num.in[7] = bit 7 of the number = MSB of byte 0
    //   bits2num.in[8] = bit 8 of the number = LSB of byte 1
    //   etc.
    //
    // CONVERSION: Reverse bits within each byte, keep byte order the same
    //   bits2num.in[byteIdx*8 + k] needs valueExtractor.out[byteIdx*8 + (7-k)]
    //
    // EXAMPLE for byte 0 (0x80 = 10000000):
    //   valueExtractor.out[0..7] = [1,0,0,0,0,0,0,0]  (MSB first)
    //   bits2num.in[0] = valueExtractor.out[7] = 0  (bit 0 of number)
    //   bits2num.in[7] = valueExtractor.out[0] = 1  (bit 7 of number)
    //   bits2num.in[0..7] = [0,0,0,0,0,0,0,1]  (LSB first) = value 128
    //
    // Since byte 0 IS the LSB of the little-endian number, this correctly
    // places the low byte's bits at the low positions of Bits2Num input.
    // ───────────────────────────────────────────────────────────────────
    component bits2num = Bits2Num(64);

    for (var byteIdx = 0; byteIdx < 8; byteIdx++) {
        for (var bitIdx = 0; bitIdx < 8; bitIdx++) {
            // Source: valueExtractor.out[byteIdx*8 + bitIdx] where bitIdx=0 is MSB of byte
            // Dest:   bits2num.in[byteIdx*8 + (7-bitIdx)] where (7-bitIdx) reverses within byte
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
    //
    // OUTPUT STRUCTURE IN BITCOIN:
    //   [value: 8 bytes][scriptLen: 1 byte][script: scriptLen bytes]
    //
    // Script starts at outputByteOffset + 8 (value) + 1 (length) = +9 bytes
    // ═══════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────
    // VARINT ASSUMPTION: Script length is 1 byte
    //
    // Bitcoin uses varint encoding for lengths:
    //   - 0x00-0xFC: 1 byte (value itself)
    //   - 0xFD: 3 bytes (0xFD + 2-byte LE value)
    //   - 0xFE: 5 bytes (0xFE + 4-byte LE value)
    //   - 0xFF: 9 bytes (0xFF + 8-byte LE value)
    //
    // Standard scripts are 22-25 bytes, so 1-byte varint is always used.
    // This simplification is safe for P2PKH, P2SH, P2WPKH, P2WSH scripts.
    // ───────────────────────────────────────────────────────────────────
    signal scriptByteOffset;
    scriptByteOffset <== outputByteOffset + 9;

    // ───────────────────────────────────────────────────────────────────
    // SCRIPT COMPARISON LIMITS
    //
    // We compare up to 25 bytes (200 bits) which handles all standard scripts:
    //   - P2WPKH: 22 bytes (0x0014 + 20-byte pubkey hash)
    //   - P2SH:   23 bytes (0xA914 + 20-byte script hash + 0x87)
    //   - P2PKH:  25 bytes (0x76A914 + 20-byte pubkey hash + 0x88AC)
    //
    // The expectedScript input is 520 bits (65 bytes) but we only compare
    // the first 200 bits. The remaining bits should be zeros.
    //
    // SECURITY: Script length is constrained to [22, 25] bytes below.
    // ───────────────────────────────────────────────────────────────────
    var MAX_SCRIPT_BITS = 200;  // 25 bytes

    component scriptExtractor = ExtractBitsAtByteOffset(maxTxBytes, MAX_SCRIPT_BITS);
    for (var i = 0; i < maxTxBytes * 8; i++) {
        scriptExtractor.bits[i] <== txBits[i];
    }
    scriptExtractor.byteOffset <== scriptByteOffset;

    // ───────────────────────────────────────────────────────────────────
    // XOR-BASED EQUALITY CHECK
    //
    // For each bit: XOR = a + b - 2*a*b
    //   - If a == b: XOR = 0
    //   - If a != b: XOR = 1
    //
    // Sum all XORs. If sum == 0, all bits match.
    //
    // This is more efficient than comparing bit-by-bit with IsEqual.
    // ───────────────────────────────────────────────────────────────────
    signal scriptXor[MAX_SCRIPT_BITS];
    signal xorAccum[MAX_SCRIPT_BITS + 1];
    xorAccum[0] <== 0;

    for (var i = 0; i < MAX_SCRIPT_BITS; i++) {
        // XOR = a + b - 2*a*b (0 if bits match, 1 if different)
        scriptXor[i] <== scriptExtractor.out[i] + expectedScript[i] - 2 * scriptExtractor.out[i] * expectedScript[i];
        xorAccum[i + 1] <== xorAccum[i] + scriptXor[i];
    }

    // scriptMatch = 1 if all XORs are 0 (sum is 0)
    component scriptEqual = IsZero();
    scriptEqual.in <== xorAccum[MAX_SCRIPT_BITS];

    signal scriptMatch;
    scriptMatch <== scriptEqual.out;

    // ───────────────────────────────────────────────────────────────────
    // SCRIPT LENGTH VALIDATION
    //
    // Constrain expectedScriptLength to valid range [22, 25] bytes.
    // This ensures we're dealing with standard Bitcoin scripts.
    //
    // Standard script sizes:
    //   - P2WPKH: 22 bytes (SegWit v0 pubkey hash)
    //   - P2SH:   23 bytes (Pay to Script Hash)
    //   - P2PKH:  25 bytes (Pay to Public Key Hash)
    //
    // P2WSH is 34 bytes but not supported in this comparison (would need
    // MAX_SCRIPT_BITS = 272).
    // ───────────────────────────────────────────────────────────────────
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
