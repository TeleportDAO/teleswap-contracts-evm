pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/mux1.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * Bitcoin Merkle Tree Verification
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bitcoin's Merkle tree uses double SHA256 for internal nodes:
 *   parent = SHA256(SHA256(left_child || right_child))
 *
 * The tree is built from transaction IDs (themselves double SHA256 of raw tx).
 * If a level has an odd number of nodes, the last node is duplicated.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * BITCOIN MERKLE TREE STRUCTURE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                    [Root]                 <- Stored in block header
 *                   /      \
 *              [H01]        [H23]           <- Level depth-1
 *             /    \       /    \
 *          [H0]   [H1]  [H2]   [H3]         <- Level 1
 *           |      |     |      |
 *         txId0  txId1 txId2  txId3         <- Level 0 (leaves)
 *
 * Each internal node: parent = doubleSHA256(left || right)
 * where || denotes concatenation of 256-bit hashes.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * BIT ORDERING CONVENTIONS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * All 256-bit hashes in this circuit use BIG-ENDIAN bit ordering:
 *   - Bit index 0 = MSB of byte 0
 *   - Bit index 7 = LSB of byte 0
 *   - Bit index 8 = MSB of byte 1
 *   - etc.
 *
 * This matches circomlib's SHA256 input/output format.
 *
 * BITCOIN DISPLAY ORDER vs INTERNAL ORDER:
 *   - Bitcoin explorers show txIds/merkle roots in REVERSED BYTE ORDER
 *   - Internal representation (used for hashing) is big-endian bytes
 *   - This circuit uses the INTERNAL (big-endian) format
 *
 * Example:
 *   Internal txId:  0xABCDEF...123456
 *   Display txId:   0x563412...EFCDAB (bytes reversed)
 *
 * WITNESS GENERATION must use internal format:
 *   txIdBits = bufferToBitsBE(doubleSha256(rawTx))  // NOT reversed
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PROOF STRUCTURE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * - leaf[256]: The txId we're proving inclusion for (big-endian bits)
 * - siblings[maxDepth][256]: Sibling hashes at each level (bottom to top)
 * - pathIndices[maxDepth]: Direction at each level
 *     0 = leaf/current is LEFT child, sibling is RIGHT
 *     1 = leaf/current is RIGHT child, sibling is LEFT
 * - depth: Actual tree depth (1 to maxDepth)
 *
 * Verification computes from leaf to root, comparing against expected root.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Bitcoin Double SHA256 Hash for Merkle Node
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Computes: SHA256(SHA256(left || right))
 * where left and right are 256-bit hashes (big-endian bits)
 *
 * INPUT FORMAT:
 *   - left[256]: Left child hash, big-endian bits
 *   - right[256]: Right child hash, big-endian bits
 *
 * OUTPUT FORMAT:
 *   - out[256]: Parent hash, big-endian bits
 *
 * CONCATENATION:
 *   The 512-bit input to first SHA256 is [left || right]:
 *     - Bits 0-255: left[0-255]
 *     - Bits 256-511: right[0-255]
 *
 * SHA256 PADDING (handled by circomlib):
 *   First hash: 512 bits → 1024 bits padded (2 blocks)
 *     [512 bits data][0x80][zeros][0x0200 as 64-bit BE]
 *   Second hash: 256 bits → 512 bits padded (1 block)
 *     [256 bits data][0x80][zeros][0x0100 as 64-bit BE]
 */
template DoubleSha256_512() {
    signal input left[256];
    signal input right[256];
    signal output out[256];

    // ───────────────────────────────────────────────────────────────────
    // First SHA256: hash(left || right) - 512 bits input
    //
    // Input is big-endian bits: left[0] is MSB of left hash's byte 0
    // circomlib Sha256(512) handles padding internally
    // ───────────────────────────────────────────────────────────────────
    component firstHash = Sha256(512);

    // Wire left child (256 bits) to positions 0-255
    for (var i = 0; i < 256; i++) {
        firstHash.in[i] <== left[i];
    }
    // Wire right child (256 bits) to positions 256-511
    for (var i = 0; i < 256; i++) {
        firstHash.in[256 + i] <== right[i];
    }

    // ───────────────────────────────────────────────────────────────────
    // Second SHA256: hash(firstHash) - 256 bits input
    //
    // Both firstHash.out and secondHash.in are big-endian bits
    // Direct wiring without conversion
    // ───────────────────────────────────────────────────────────────────
    component secondHash = Sha256(256);
    for (var i = 0; i < 256; i++) {
        secondHash.in[i] <== firstHash.out[i];
    }

    // Output the parent hash (big-endian bits)
    for (var i = 0; i < 256; i++) {
        out[i] <== secondHash.out[i];
    }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Merkle Tree Single Level Computation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Computes the parent hash from current hash and sibling hash.
 *
 * DIRECTION SEMANTICS:
 *   direction = 0: current is LEFT child, sibling is RIGHT
 *                  parent = doubleSHA256(current || sibling)
 *
 *   direction = 1: current is RIGHT child, sibling is LEFT
 *                  parent = doubleSHA256(sibling || current)
 *
 * INPUT FORMAT:
 *   - current[256]: Hash at current level, big-endian bits
 *   - sibling[256]: Sibling hash from proof, big-endian bits
 *   - direction: 0 or 1 (binary constrained)
 *
 * OUTPUT FORMAT:
 *   - parent[256]: Parent hash, big-endian bits
 *
 * MUX1 BEHAVIOR:
 *   Mux1 outputs: c[0] if s=0, c[1] if s=1
 *   For proper selection, s MUST be binary (0 or 1).
 *   Non-binary s would cause linear interpolation, not selection!
 */
template MerkleHashLevel() {
    signal input current[256];
    signal input sibling[256];
    signal input direction;  // 0 = current is left, 1 = current is right
    signal output parent[256];

    // ───────────────────────────────────────────────────────────────────
    // SECURITY: Direction must be binary (0 or 1)
    //
    // This constraint is CRITICAL for Mux1 correctness.
    // Without it, a malicious prover could use direction = 0.5
    // which would cause Mux1 to output (c[0] + c[1]) / 2 instead
    // of selecting one or the other.
    // ───────────────────────────────────────────────────────────────────
    direction * (direction - 1) === 0;

    // ───────────────────────────────────────────────────────────────────
    // SELECT LEFT AND RIGHT CHILDREN BASED ON DIRECTION
    //
    // direction=0: current is left, sibling is right
    //   left[i] = current[i], right[i] = sibling[i]
    //
    // direction=1: sibling is left, current is right
    //   left[i] = sibling[i], right[i] = current[i]
    // ───────────────────────────────────────────────────────────────────
    signal left[256];
    signal right[256];

    component leftMux[256];
    component rightMux[256];

    for (var i = 0; i < 256; i++) {
        // Left = current if direction=0, sibling if direction=1
        leftMux[i] = Mux1();
        leftMux[i].c[0] <== current[i];  // Selected when direction=0
        leftMux[i].c[1] <== sibling[i];  // Selected when direction=1
        leftMux[i].s <== direction;
        left[i] <== leftMux[i].out;

        // Right = sibling if direction=0, current if direction=1
        rightMux[i] = Mux1();
        rightMux[i].c[0] <== sibling[i];  // Selected when direction=0
        rightMux[i].c[1] <== current[i];  // Selected when direction=1
        rightMux[i].s <== direction;
        right[i] <== rightMux[i].out;
    }

    // ───────────────────────────────────────────────────────────────────
    // COMPUTE PARENT: doubleSHA256(left || right)
    //
    // This is Bitcoin's Merkle tree hash function.
    // Both children are 256 bits, concatenated to 512 bits, then double-hashed.
    // ───────────────────────────────────────────────────────────────────
    component hasher = DoubleSha256_512();
    for (var i = 0; i < 256; i++) {
        hasher.left[i] <== left[i];
        hasher.right[i] <== right[i];
    }

    // Output parent hash (big-endian bits)
    for (var i = 0; i < 256; i++) {
        parent[i] <== hasher.out[i];
    }
}

/**
 * Bitcoin Merkle Proof Verification
 *
 * Verifies that a leaf (txId) is included in a Merkle tree with the given root.
 *
 * @param maxDepth - Maximum supported tree depth (12 for ~4096 transactions)
 *
 * Inputs:
 * - leaf[256]: The transaction ID (bits, big-endian)
 * - siblings[maxDepth][256]: Sibling hashes at each level
 * - pathIndices[maxDepth]: Direction bits (0=left, 1=right)
 * - depth: Actual tree depth (1 to maxDepth)
 * - expectedRoot[256]: The expected Merkle root (bits, big-endian)
 *
 * Computation:
 * Starting from the leaf, we compute parent hashes up to the root.
 * At level i, if pathIndices[i] = 0, leaf is left child; if 1, leaf is right child.
 * After `depth` levels, the computed hash should equal expectedRoot.
 */
template VerifyMerkleProof(maxDepth) {
    signal input leaf[256];
    signal input siblings[maxDepth][256];
    signal input pathIndices[maxDepth];
    signal input depth;
    signal input expectedRoot[256];

    // ═══════════════════════════════════════════════════════════════════
    // Validate inputs
    // ═══════════════════════════════════════════════════════════════════

    // Depth must be in [1, maxDepth]
    component depthGe1 = GreaterEqThan(8);
    depthGe1.in[0] <== depth;
    depthGe1.in[1] <== 1;
    depthGe1.out === 1;

    component depthLeMax = LessEqThan(8);
    depthLeMax.in[0] <== depth;
    depthLeMax.in[1] <== maxDepth;
    depthLeMax.out === 1;

    // All pathIndices must be binary
    for (var i = 0; i < maxDepth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
    }

    // All sibling bits must be binary
    for (var i = 0; i < maxDepth; i++) {
        for (var j = 0; j < 256; j++) {
            siblings[i][j] * (siblings[i][j] - 1) === 0;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Compute hash at each level
    // ═══════════════════════════════════════════════════════════════════

    // hashes[0] = leaf
    // hashes[i+1] = hash(hashes[i], siblings[i]) based on pathIndices[i]
    signal hashes[maxDepth + 1][256];

    // Initialize level 0 with the leaf
    for (var i = 0; i < 256; i++) {
        hashes[0][i] <== leaf[i];
    }

    // Compute each level
    component levels[maxDepth];

    for (var i = 0; i < maxDepth; i++) {
        levels[i] = MerkleHashLevel();

        for (var j = 0; j < 256; j++) {
            levels[i].current[j] <== hashes[i][j];
            levels[i].sibling[j] <== siblings[i][j];
        }
        levels[i].direction <== pathIndices[i];

        for (var j = 0; j < 256; j++) {
            hashes[i + 1][j] <== levels[i].parent[j];
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Select the computed root at the actual depth
    // ═══════════════════════════════════════════════════════════════════

    // Create selector: isDepth[i] = 1 if depth == i+1
    component depthSelector[maxDepth];
    signal isDepth[maxDepth];

    for (var i = 0; i < maxDepth; i++) {
        depthSelector[i] = IsEqual();
        depthSelector[i].in[0] <== depth;
        depthSelector[i].in[1] <== i + 1;
        isDepth[i] <== depthSelector[i].out;
    }

    // Compute the root at the correct depth using weighted sum
    signal contributions[maxDepth][256];
    signal computedRoot[256];

    for (var j = 0; j < 256; j++) {
        var sum = 0;
        for (var i = 0; i < maxDepth; i++) {
            contributions[i][j] <== isDepth[i] * hashes[i + 1][j];
            sum += contributions[i][j];
        }
        computedRoot[j] <== sum;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Verify computed root matches expected root
    // ═══════════════════════════════════════════════════════════════════

    for (var i = 0; i < 256; i++) {
        computedRoot[i] === expectedRoot[i];
    }
}

/**
 * Merkle Proof Verification with Hidden Root Selection
 *
 * Same as VerifyMerkleProof, but the expected root is selected from an array
 * of possible roots using a private index. This provides privacy by hiding
 * which specific Bitcoin block contains the transaction.
 *
 * The contract will verify that ALL provided roots correspond to valid Bitcoin
 * blocks via the Bitcoin relay. The user proves their TX is in ONE of them
 * without revealing which one.
 *
 * @param maxDepth - Maximum tree depth (12)
 * @param numRoots - Number of possible roots (2)
 */
template VerifyMerkleProofHiddenRoot(maxDepth, numRoots) {
    signal input leaf[256];
    signal input siblings[maxDepth][256];
    signal input pathIndices[maxDepth];
    signal input depth;
    signal input possibleRoots[numRoots][256];  // Array of possible roots (as bits)
    signal input rootIndex;                      // Which root (private)

    // ═══════════════════════════════════════════════════════════════════
    // Validate inputs
    // ═══════════════════════════════════════════════════════════════════

    // rootIndex must be in [0, numRoots-1]
    component rootIndexValid = LessThan(8);
    rootIndexValid.in[0] <== rootIndex;
    rootIndexValid.in[1] <== numRoots;
    rootIndexValid.out === 1;

    // SECURITY: Explicit binary constraint on rootIndex
    // This ensures Mux1 selector behaves correctly (selects, not interpolates)
    // Without this, a malicious prover could use non-binary values that pass
    // the LessThan check but cause Mux1 to output linear combinations
    rootIndex * (rootIndex - 1) === 0;

    // Depth must be in [1, maxDepth]
    component depthGe1 = GreaterEqThan(8);
    depthGe1.in[0] <== depth;
    depthGe1.in[1] <== 1;
    depthGe1.out === 1;

    component depthLeMax = LessEqThan(8);
    depthLeMax.in[0] <== depth;
    depthLeMax.in[1] <== maxDepth;
    depthLeMax.out === 1;

    // All pathIndices must be binary
    for (var i = 0; i < maxDepth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
    }

    // All sibling bits must be binary
    for (var i = 0; i < maxDepth; i++) {
        for (var j = 0; j < 256; j++) {
            siblings[i][j] * (siblings[i][j] - 1) === 0;
        }
    }

    // All possibleRoots bits must be binary
    for (var i = 0; i < numRoots; i++) {
        for (var j = 0; j < 256; j++) {
            possibleRoots[i][j] * (possibleRoots[i][j] - 1) === 0;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Compute hash at each level (same as VerifyMerkleProof)
    // ═══════════════════════════════════════════════════════════════════

    signal hashes[maxDepth + 1][256];

    for (var i = 0; i < 256; i++) {
        hashes[0][i] <== leaf[i];
    }

    component levels[maxDepth];

    for (var i = 0; i < maxDepth; i++) {
        levels[i] = MerkleHashLevel();

        for (var j = 0; j < 256; j++) {
            levels[i].current[j] <== hashes[i][j];
            levels[i].sibling[j] <== siblings[i][j];
        }
        levels[i].direction <== pathIndices[i];

        for (var j = 0; j < 256; j++) {
            hashes[i + 1][j] <== levels[i].parent[j];
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Select the computed root at the actual depth
    // ═══════════════════════════════════════════════════════════════════

    component depthSelector[maxDepth];
    signal isDepth[maxDepth];

    for (var i = 0; i < maxDepth; i++) {
        depthSelector[i] = IsEqual();
        depthSelector[i].in[0] <== depth;
        depthSelector[i].in[1] <== i + 1;
        isDepth[i] <== depthSelector[i].out;
    }

    signal depthContributions[maxDepth][256];
    signal computedRoot[256];

    for (var j = 0; j < 256; j++) {
        var sum = 0;
        for (var i = 0; i < maxDepth; i++) {
            depthContributions[i][j] <== isDepth[i] * hashes[i + 1][j];
            sum += depthContributions[i][j];
        }
        computedRoot[j] <== sum;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Select expected root from possibleRoots using private rootIndex
    // ═══════════════════════════════════════════════════════════════════

    // For numRoots = 2, use Mux1 for each bit
    signal selectedRoot[256];
    component rootMux[256];

    for (var j = 0; j < 256; j++) {
        rootMux[j] = Mux1();
        rootMux[j].c[0] <== possibleRoots[0][j];
        rootMux[j].c[1] <== possibleRoots[1][j];
        rootMux[j].s <== rootIndex;
        selectedRoot[j] <== rootMux[j].out;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Verify computed root matches selected root
    // ═══════════════════════════════════════════════════════════════════

    for (var i = 0; i < 256; i++) {
        computedRoot[i] === selectedRoot[i];
    }
}
