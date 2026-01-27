pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../../node_modules/circomlib/circuits/sha256/sha256compression.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * SHA256 Variable Length Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file implements SHA256 hashing for variable-length messages using
 * circomlib's Sha256compression primitive.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CRITICAL: CIRCOMLIB SHA256 BIT ORDERING
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Circomlib's Sha256 template uses these conventions:
 *
 * EXTERNAL FORMAT (Sha256 template input/output):
 *   - Big-endian bits: MSB of byte 0 at index 0
 *   - Byte 0xAB → bits [1,0,1,0,1,0,1,1] at indices [0,1,2,3,4,5,6,7]
 *
 * INTERNAL FORMAT (Sha256compression hin/out):
 *   - LSB-first WITHIN EACH 32-BIT WORD
 *   - Word W with bits [b31, b30, ..., b1, b0]:
 *     - hin[0] = b0 (LSB)
 *     - hin[1] = b1
 *     - ...
 *     - hin[31] = b31 (MSB)
 *   - For 8 words (256 bits): hin[i*32 + j] = bit j of word i
 *
 * CONVERSION (done by Sha256 template, replicated here):
 *   - Input to compression: inp[i] directly from input (big-endian byte bits)
 *   - Initial hash to compression: hin[i*32+j] = (H[i] >> j) & 1 (LSB first per word)
 *   - Output from compression: out[i*32+31-j] = compression.out[i*32+j] (LSB→MSB per word)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SHA256 INITIAL HASH VALUES (FIPS 180-4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * H0 = 0x6a09e667 (first 32 bits of fractional part of sqrt(2))
 * H1 = 0xbb67ae85 (first 32 bits of fractional part of sqrt(3))
 * H2 = 0x3c6ef372 (first 32 bits of fractional part of sqrt(5))
 * H3 = 0xa54ff53a (first 32 bits of fractional part of sqrt(7))
 * H4 = 0x510e527f (first 32 bits of fractional part of sqrt(11))
 * H5 = 0x9b05688c (first 32 bits of fractional part of sqrt(13))
 * H6 = 0x1f83d9ab (first 32 bits of fractional part of sqrt(17))
 * H7 = 0x5be0cd19 (first 32 bits of fractional part of sqrt(19))
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * SHA256 with Variable Number of Blocks
 *
 * Processes up to maxBlocks of 512-bit blocks, but outputs the hash
 * after processing exactly numBlocks blocks.
 *
 * This allows hashing variable-length messages where the prover provides:
 * - Pre-padded message (with SHA256 padding already applied)
 * - Number of blocks to process
 *
 * INPUT FORMAT:
 *   - in[maxBlocks * 512]: Big-endian bits (MSB first per byte)
 *   - First numBlocks*512 bits contain the padded message
 *   - Remaining bits are ignored (should be zeros)
 *
 * OUTPUT FORMAT:
 *   - out[256]: Big-endian bits (MSB first per byte)
 *   - Matches circomlib Sha256 output format
 *
 * Security: If prover provides wrong numBlocks, hash won't match expected value.
 *
 * @param maxBlocks - Maximum number of 512-bit blocks to support
 */
template Sha256VariableLength(maxBlocks) {
    signal input in[maxBlocks * 512];
    signal input numBlocks;  // Actual number of blocks (1 to maxBlocks)
    signal output out[256];

    // SHA256 initial hash values (H0-H7)
    var H[8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    // Validate numBlocks is in range [1, maxBlocks]
    component numBlocksGe1 = GreaterEqThan(8);
    numBlocksGe1.in[0] <== numBlocks;
    numBlocksGe1.in[1] <== 1;
    numBlocksGe1.out === 1;

    component numBlocksLeMax = LessEqThan(8);
    numBlocksLeMax.in[0] <== numBlocks;
    numBlocksLeMax.in[1] <== maxBlocks;
    numBlocksLeMax.out === 1;

    // ═══════════════════════════════════════════════════════════════════
    // COMPRESSION ROUNDS
    //
    // Process each 512-bit block through SHA256 compression function.
    // Each compression takes:
    //   - hin[256]: Current hash state (8 x 32-bit words, LSB-first per word)
    //   - inp[512]: Message block (big-endian bits)
    // And outputs:
    //   - out[256]: New hash state (8 x 32-bit words, LSB-first per word)
    // ═══════════════════════════════════════════════════════════════════
    component compression[maxBlocks];

    for (var i = 0; i < maxBlocks; i++) {
        compression[i] = Sha256compression();

        // Input hash state (from previous block or initial)
        if (i == 0) {
            // ───────────────────────────────────────────────────────────
            // FIRST BLOCK: Use SHA256 initial hash values H0-H7
            //
            // INTERNAL FORMAT: LSB-first within each 32-bit word
            //   hin[j*32 + k] = bit k of word j
            //   where k=0 is LSB, k=31 is MSB
            //
            // EXAMPLE: H[0] = 0x6a09e667
            //   Binary: 0110 1010 0000 1001 1110 0110 0110 0111
            //   hin[0] = 1 (bit 0, LSB)
            //   hin[1] = 1 (bit 1)
            //   hin[2] = 1 (bit 2)
            //   ...
            //   hin[31] = 0 (bit 31, MSB)
            // ───────────────────────────────────────────────────────────
            for (var j = 0; j < 8; j++) {
                for (var k = 0; k < 32; k++) {
                    compression[i].hin[j * 32 + k] <== (H[j] >> k) & 1;
                }
            }
        } else {
            // ───────────────────────────────────────────────────────────
            // SUBSEQUENT BLOCKS: Chain from previous compression output
            //
            // IMPORTANT: Bits must be REVERSED within each 32-bit word!
            // This matches circomlib's sha256.circom exactly:
            //   sha256compression[i].hin[32*j+k] <== sha256compression[i-1].out[32*j+31-k]
            //
            // The compression function outputs in a different bit order than
            // it expects for input. The reversal converts between formats.
            // ───────────────────────────────────────────────────────────
            for (var j = 0; j < 8; j++) {
                for (var k = 0; k < 32; k++) {
                    compression[i].hin[j * 32 + k] <== compression[i-1].out[j * 32 + 31 - k];
                }
            }
        }

        // ───────────────────────────────────────────────────────────────
        // MESSAGE BLOCK INPUT (512 bits)
        //
        // INPUT FORMAT: Big-endian bits (MSB first per byte)
        //   - inp[0..7] = byte 0 of message block (MSB at 0, LSB at 7)
        //   - inp[8..15] = byte 1 of message block
        //   - etc.
        //
        // This is the format that circomlib Sha256compression expects
        // for the message input (same as circomlib Sha256 template).
        // ───────────────────────────────────────────────────────────────
        for (var j = 0; j < 512; j++) {
            compression[i].inp[j] <== in[i * 512 + j];
        }
    }

    // Create selector signals: selector[i] = 1 if numBlocks == i+1
    component isEq[maxBlocks];
    signal selector[maxBlocks];

    for (var i = 0; i < maxBlocks; i++) {
        isEq[i] = IsEqual();
        isEq[i].in[0] <== numBlocks;
        isEq[i].in[1] <== i + 1;
        selector[i] <== isEq[i].out;
    }

    // ═══════════════════════════════════════════════════════════════════
    // WEIGHTED SUM FOR VARIABLE BLOCK SELECTION
    //
    // We compute all blocks but only output the result at numBlocks.
    // Using weighted sum: out[j] = sum(selector[i] * compression[i].out[j])
    // Since exactly one selector[i] == 1, this selects the correct output.
    //
    // Using accumulator pattern for proper signal constraints in circom.
    // ═══════════════════════════════════════════════════════════════════
    signal contributions[maxBlocks][256];
    signal partialSums[maxBlocks + 1][256];

    // Initialize partial sums to 0
    for (var j = 0; j < 256; j++) {
        partialSums[0][j] <== 0;
    }

    // Accumulate contributions from each block
    // Only the block where selector[i]==1 contributes non-zero values
    for (var i = 0; i < maxBlocks; i++) {
        for (var j = 0; j < 256; j++) {
            contributions[i][j] <== selector[i] * compression[i].out[j];
            partialSums[i + 1][j] <== partialSums[i][j] + contributions[i][j];
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // OUTPUT FORMAT
    //
    // Matches circomlib's Sha256 template output exactly:
    //   out[k] <== sha256compression[nBlocks-1].out[k]
    //
    // This is a direct copy from compression output with no reversal.
    // The output format is the same as compression.out format.
    //
    // NOTE: If you need to compare with external SHA256 implementations,
    // the bit ordering may need conversion depending on the use case.
    // For chaining with circomlib's Sha256, this format is correct.
    // ═══════════════════════════════════════════════════════════════════
    for (var k = 0; k < 256; k++) {
        out[k] <== partialSums[maxBlocks][k];
    }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Double SHA256 for Bitcoin Transaction ID
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Computes: txId = SHA256(SHA256(paddedTransaction))
 *
 * This is how Bitcoin computes transaction IDs (txid).
 *
 * INPUT FORMAT:
 *   - in[maxBlocks * 512]: Pre-padded transaction in big-endian bits
 *   - numBlocks: Number of 512-bit blocks in the padded transaction
 *
 * OUTPUT FORMAT:
 *   - out[256]: Transaction ID in big-endian bits
 *
 * PADDING NOTE:
 *   The input must already have SHA256 padding applied.
 *   The prover is responsible for correct padding.
 *   If padding is wrong, the hash won't match and proof fails.
 *
 * SECOND HASH PADDING:
 *   The first hash output is 256 bits.
 *   SHA256(256 bits) → 1 block after padding:
 *     [256 bits] + [0x80] + [191 zero bits] + [64-bit length = 256] = 512 bits
 *   This is handled internally by circomlib's Sha256(256) template.
 *
 * @param maxBlocks - Maximum number of blocks for first hash
 */
template DoubleSha256(maxBlocks) {
    signal input in[maxBlocks * 512];
    signal input numBlocks;
    signal output out[256];

    // ───────────────────────────────────────────────────────────────────
    // FIRST HASH: SHA256 of variable-length padded transaction
    //
    // Input: Big-endian bits (pre-padded)
    // Output: Big-endian bits (256-bit hash)
    // ───────────────────────────────────────────────────────────────────
    component firstHash = Sha256VariableLength(maxBlocks);
    for (var i = 0; i < maxBlocks * 512; i++) {
        firstHash.in[i] <== in[i];
    }
    firstHash.numBlocks <== numBlocks;

    // ───────────────────────────────────────────────────────────────────
    // SECOND HASH: SHA256 of first hash (fixed 256-bit input)
    //
    // circomlib's Sha256(256) internally handles padding:
    // [256-bit input][0x80][zeros][0x0100 as 64-bit BE] = 512 bits
    //
    // Input: Big-endian bits from firstHash
    // Output: Big-endian bits (final txId)
    // ───────────────────────────────────────────────────────────────────
    component secondHash = Sha256(256);
    for (var i = 0; i < 256; i++) {
        secondHash.in[i] <== firstHash.out[i];
    }

    // Output the double-hashed result (txId in big-endian bits)
    for (var i = 0; i < 256; i++) {
        out[i] <== secondHash.out[i];
    }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Verify Bitcoin Transaction ID
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Verifies that expectedTxId = SHA256(SHA256(paddedTransaction))
 *
 * INPUT FORMAT:
 *   - paddedTransaction[maxPaddedBits]: Big-endian bits, SHA256-padded
 *   - numBlocks: Number of 512-bit blocks (1 to maxBlocks)
 *   - expectedTxId[256]: Expected txId in big-endian bits
 *
 * BITCOIN TXID NOTE:
 *   Bitcoin displays txIds in REVERSED BYTE ORDER (little-endian display).
 *   Example:
 *     Internal: 0xABCD...1234
 *     Display:  0x3412...CDAB
 *
 *   This circuit uses the INTERNAL (big-endian) format for all operations.
 *   The witness generator must provide txId in internal format:
 *     txIdBits = bufferToBitsBE(doubleSha256(rawTx))
 *
 * SECURITY:
 *   - If prover provides wrong padding → hash won't match → proof fails
 *   - If prover provides wrong numBlocks → hash won't match → proof fails
 *   - The same paddedTransaction is used for output verification and txId,
 *     ensuring the proven transaction is actually the one in the Merkle tree.
 *
 * @param maxTxBits - Maximum transaction size in bits (before padding)
 */
template VerifyTxId(maxTxBits) {
    // ───────────────────────────────────────────────────────────────────
    // PADDING SIZE CALCULATION
    //
    // For a message of L bits, SHA256 padded size is:
    //   ceil((L + 65) / 512) * 512 bits
    //
    // The +65 accounts for: 1 bit (0x80) + 64 bits (length)
    // The formula ((L + 64) / 512 + 1) * 512 is equivalent.
    // ───────────────────────────────────────────────────────────────────
    var maxPaddedBits = ((maxTxBits + 64) \ 512 + 1) * 512;
    var maxBlocks = maxPaddedBits \ 512;

    signal input paddedTransaction[maxPaddedBits];
    signal input numBlocks;  // Number of 512-bit blocks after padding
    signal input expectedTxId[256];

    // ═══════════════════════════════════════════════════════════════════
    // Compute double SHA256 of the padded transaction
    //
    // txId = SHA256(SHA256(rawTx))
    // where rawTx is extracted from paddedTransaction by the hash function
    // (the padding tells SHA256 where the actual message ends)
    // ═══════════════════════════════════════════════════════════════════

    component hasher = DoubleSha256(maxBlocks);
    for (var i = 0; i < maxPaddedBits; i++) {
        hasher.in[i] <== paddedTransaction[i];
    }
    hasher.numBlocks <== numBlocks;

    // ═══════════════════════════════════════════════════════════════════
    // Verify computed hash matches expected txId
    //
    // Both hasher.out and expectedTxId are in big-endian bit format.
    // Bit-by-bit equality ensures the transaction produces the claimed txId.
    // ═══════════════════════════════════════════════════════════════════

    for (var i = 0; i < 256; i++) {
        hasher.out[i] === expectedTxId[i];
    }
}
