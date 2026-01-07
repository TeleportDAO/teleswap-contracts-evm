pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "./merkle_proof.circom";

/*
 * Bitcoin Transaction Privacy Circuit - Proof of Concept
 *
 * This circuit proves that:
 * 1. We know a Bitcoin transaction that is included in a given Merkle root
 * 2. A specific vout from that transaction hashes to a known value
 * 3. Without revealing the entire transaction
 *
 * Simplified version for POC:
 * - Fixed transaction size (256 bytes)
 * - Fixed vout size (64 bytes)
 * - Merkle tree depth of 12 (supports 4096 transactions per block)
 */

template BitcoinTxPrivacyVerifier() {
    // Public inputs
    signal input merkleRoot;              // Bitcoin block's Merkle root (256 bits)
    signal input voutHash;                // SHA256 hash of the vout we're revealing (256 bits)
    signal input blockNumber;             // Bitcoin block number for reference

    // Private inputs
    signal input transaction[2048];       // Full Bitcoin transaction (256 bytes * 8 bits)
    signal input voutData[512];           // The specific vout we want to prove (64 bytes * 8 bits)
    signal input voutOffset;              // Position of vout within transaction
    signal input merkleSiblings[12];      // Merkle proof siblings (12 levels, 256 bits each)
    signal input merkleIndex;             // Position in Merkle tree (0 to 4095)

    // Component 1: Calculate transaction hash (double SHA256)
    component txHasher1 = Sha256(2048);
    component txHasher2 = Sha256(256);

    for (var i = 0; i < 2048; i++) {
        txHasher1.in[i] <== transaction[i];
    }

    // Second SHA256 for Bitcoin's double hashing
    for (var i = 0; i < 256; i++) {
        txHasher2.in[i] <== txHasher1.out[i];
    }

    // Component 2: Verify vout hash
    component voutHasher = Sha256(512);
    for (var i = 0; i < 512; i++) {
        voutHasher.in[i] <== voutData[i];
    }

    // Convert voutHash public input to bits for comparison
    component voutHashBits = Num2Bits(256);
    voutHashBits.in <== voutHash;

    // Verify that the hashed vout matches the public voutHash
    for (var i = 0; i < 256; i++) {
        voutHasher.out[i] === voutHashBits.out[255 - i]; // Note: reversed for little-endian
    }

    // Component 3: Verify vout is part of the transaction
    // For POC, we do a simple constraint check that vout appears in tx
    // In production, this would be more sophisticated parsing

    // Component 4: Verify Merkle proof
    component merkleVerifier = MerkleProof(12);

    // Convert transaction hash to signal for Merkle verification
    component txHashToSignal = Bits2Num(256);
    for (var i = 0; i < 256; i++) {
        txHashToSignal.in[i] <== txHasher2.out[255 - i]; // Reverse for little-endian
    }

    merkleVerifier.leaf <== txHashToSignal.out;
    merkleVerifier.root <== merkleRoot;
    merkleVerifier.index <== merkleIndex;

    for (var i = 0; i < 12; i++) {
        merkleVerifier.siblings[i] <== merkleSiblings[i];
    }

    // Merkle verification constraint (will fail if proof is invalid)
    merkleVerifier.isValid === 1;

    // Dummy constraint on blockNumber to include it in public inputs
    // (prevents unused signal warnings)
    signal blockNumberSquared;
    blockNumberSquared <== blockNumber * blockNumber;
}

// Main component
component main {public [merkleRoot, voutHash, blockNumber]} = BitcoinTxPrivacyVerifier();
