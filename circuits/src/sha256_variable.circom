pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../../node_modules/circomlib/circuits/sha256/sha256compression.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";

/**
 * SHA256 with Variable Number of Blocks
 *
 * Processes up to maxBlocks of 512-bit blocks, but outputs the hash
 * after processing exactly numBlocks blocks.
 *
 * This allows hashing variable-length messages where the prover provides:
 * - Pre-padded message (with SHA256 padding)
 * - Number of blocks to process
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

    // Process all blocks
    component compression[maxBlocks];

    for (var i = 0; i < maxBlocks; i++) {
        compression[i] = Sha256compression();

        // Input hash state (from previous block or initial)
        if (i == 0) {
            // First block uses initial hash values
            // IMPORTANT: circomlib uses LSB-first bit order (bit 0 at position 0)
            for (var j = 0; j < 8; j++) {
                for (var k = 0; k < 32; k++) {
                    compression[i].hin[j * 32 + k] <== (H[j] >> k) & 1;
                }
            }
        } else {
            // Subsequent blocks use output of previous compression
            // IMPORTANT: Must reverse bits within each 32-bit word (matches circomlib)
            for (var j = 0; j < 8; j++) {
                for (var k = 0; k < 32; k++) {
                    compression[i].hin[j * 32 + k] <== compression[i-1].out[j * 32 + 31 - k];
                }
            }
        }

        // Input message block (512 bits)
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

    // Compute weighted sum: out[j] = sum(selector[i] * compression[i].out[j])
    // Using accumulator pattern for proper constraints
    signal contributions[maxBlocks][256];
    signal partialSums[maxBlocks + 1][256];

    // Initialize partial sums to 0
    for (var j = 0; j < 256; j++) {
        partialSums[0][j] <== 0;
    }

    // Accumulate contributions
    for (var i = 0; i < maxBlocks; i++) {
        for (var j = 0; j < 256; j++) {
            contributions[i][j] <== selector[i] * compression[i].out[j];
            partialSums[i + 1][j] <== partialSums[i][j] + contributions[i][j];
        }
    }

    // Output is the final sum
    for (var j = 0; j < 256; j++) {
        out[j] <== partialSums[maxBlocks][j];
    }
}

/**
 * Double SHA256 for Bitcoin Transaction ID
 *
 * Computes: txId = SHA256(SHA256(paddedTransaction))
 *
 * The prover provides:
 * - paddedTransaction: transaction with correct SHA256 padding
 * - numBlocks: number of 512-bit blocks in padded transaction
 *
 * @param maxBlocks - Maximum number of blocks for first hash
 */
template DoubleSha256(maxBlocks) {
    signal input in[maxBlocks * 512];
    signal input numBlocks;
    signal output out[256];

    // First SHA256 with variable blocks
    component firstHash = Sha256VariableLength(maxBlocks);
    for (var i = 0; i < maxBlocks * 512; i++) {
        firstHash.in[i] <== in[i];
    }
    firstHash.numBlocks <== numBlocks;

    // Second SHA256 (fixed 256-bit input)
    // 256 bits -> 1 block after padding (256 + 1 + 191 + 64 = 512)
    component secondHash = Sha256(256);
    for (var i = 0; i < 256; i++) {
        secondHash.in[i] <== firstHash.out[i];
    }

    // Output
    for (var i = 0; i < 256; i++) {
        out[i] <== secondHash.out[i];
    }
}

/**
 * Verify Bitcoin Transaction ID
 *
 * Verifies that txId = SHA256(SHA256(paddedTransaction))
 *
 * The prover provides:
 * - paddedTransaction: transaction with correct SHA256 padding
 * - numBlocks: number of 512-bit blocks to process
 * - expectedTxId: the expected transaction ID
 *
 * Security:
 * - If prover provides wrong padding → hash won't match → proof fails
 * - If prover provides wrong numBlocks → hash won't match → proof fails
 * - txId will be verified against Merkle proof in Phase 2B
 *
 * @param maxTxBits - Maximum transaction size in bits
 */
template VerifyTxId(maxTxBits) {
    // Calculate max padded size: ceil((maxTxBits + 65) / 512) * 512
    var maxPaddedBits = ((maxTxBits + 64) \ 512 + 1) * 512;
    var maxBlocks = maxPaddedBits \ 512;

    signal input paddedTransaction[maxPaddedBits];
    signal input numBlocks;  // Number of 512-bit blocks after padding
    signal input expectedTxId[256];

    // ═══════════════════════════════════════════════════════════════════
    // Compute double SHA256 of the padded transaction
    // ═══════════════════════════════════════════════════════════════════

    component hasher = DoubleSha256(maxBlocks);
    for (var i = 0; i < maxPaddedBits; i++) {
        hasher.in[i] <== paddedTransaction[i];
    }
    hasher.numBlocks <== numBlocks;

    // ═══════════════════════════════════════════════════════════════════
    // Verify computed hash matches expected txId
    // ═══════════════════════════════════════════════════════════════════

    for (var i = 0; i < 256; i++) {
        hasher.out[i] === expectedTxId[i];
    }
}
