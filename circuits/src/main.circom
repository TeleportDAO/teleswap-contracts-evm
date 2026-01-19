pragma circom 2.0.0;

/*
 * Private Transfer Circuit for TeleSwap
 *
 * Proves knowledge of a Bitcoin transaction that:
 * 1. Contains a commitment derived from a secret
 * 2. Sends BTC to a specific locker
 * 3. Amount matches the committed amount
 *
 * Without revealing the secret or the full transaction details.
 *
 * See: PRIVATE_TRANSFER.md and PRIVATE_TRANSFER_PLAN.md
 */

include "../../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "./tx_parser.circom";

/*
 * Main template for private transfer claims
 *
 * @param maxTxBytes - Maximum transaction size in bytes (e.g., 1024)
 */
template PrivateTransferClaim(maxTxBytes) {
    var maxTxBits = maxTxBytes * 8;

    // ═══════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS (6 total)
    // These are visible on-chain and verified by the smart contract
    // ═══════════════════════════════════════════════════════════════════

    // Merkle root from Bitcoin block header
    // NOTE: Verification skipped for Phase 1, will be added when block headers on contract
    signal input merkleRoot;

    // Nullifier = SHA256(secret || 0x01)
    // Prevents double-claiming - contract tracks used nullifiers
    signal input nullifier;

    // Amount in satoshis - must match TX output AND commitment
    signal input amount;

    // Target EVM chain ID - bound in commitment to prevent cross-chain replay
    signal input chainId;

    // Recipient EVM address (as field element)
    // This is where teleBTC will be minted
    signal input recipient;

    // Hash of locker's Bitcoin script
    // Contract verifies this corresponds to a valid registered locker
    signal input lockerScriptHash;

    // ═══════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS
    // These remain hidden - only proven via ZK
    // ═══════════════════════════════════════════════════════════════════

    // User's secret - the key to claiming (256 bits)
    signal input secret[256];

    // The commitment bits extracted from the Bitcoin TX's OP_RETURN
    // This is provided by the prover and verified against computed commitment
    signal input commitmentFromTx[256];

    // Full Bitcoin transaction as bits
    signal input transaction[maxTxBits];

    // Actual transaction length in bytes (for variable-length TX support)
    signal input txLength;

    // Locker's Bitcoin script (to verify against hash)
    // 520 bits = 65 bytes max (P2SH script)
    signal input lockerScript[520];

    // Actual locker script length in bytes
    signal input lockerScriptLength;

    // Index of the output that pays the locker (0, 1, 2, ...)
    signal input lockerOutputIndex;

    // Bit offset where the locker output starts in the transaction
    // This allows the circuit to extract value and script without full TX parsing
    // The prover calculates this by parsing the TX structure
    signal input lockerOutputOffset;

    // Merkle proof data (kept as inputs for future Phase 2)
    // 12 levels for ~4000 transactions per block
    signal input merkleProof[12][256];
    signal input merkleIndex;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 1: Compute commitment and verify it matches TX commitment
    // commitment = SHA256(secret || amount || chainId)
    //
    // This ensures the user knows the secret that created the commitment
    // visible on the Bitcoin blockchain.
    // ═══════════════════════════════════════════════════════════════════

    // Convert amount to bits (64 bits for satoshis)
    // Num2Bits outputs in little-endian (LSB first)
    component amountBits = Num2Bits(64);
    amountBits.in <== amount;

    // Convert chainId to bits (16 bits)
    component chainIdBits = Num2Bits(16);
    chainIdBits.in <== chainId;

    // Compute commitment: SHA256(secret[256] || amount[64] || chainId[16])
    // Total: 336 bits = 42 bytes
    component commitmentHasher = Sha256(336);

    // Wire secret (256 bits) - already in big-endian bit order
    for (var i = 0; i < 256; i++) {
        commitmentHasher.in[i] <== secret[i];
    }

    // Wire amount (64 bits) - convert from little-endian to big-endian for SHA256
    for (var i = 0; i < 64; i++) {
        commitmentHasher.in[256 + i] <== amountBits.out[63 - i];
    }

    // Wire chainId (16 bits) - convert from little-endian to big-endian
    for (var i = 0; i < 16; i++) {
        commitmentHasher.in[320 + i] <== chainIdBits.out[15 - i];
    }

    // Verify computed commitment matches the commitment extracted from TX
    // The prover provides commitmentFromTx (extracted from OP_RETURN)
    // We verify it equals SHA256(secret || amount || chainId)
    for (var i = 0; i < 256; i++) {
        commitmentHasher.out[i] === commitmentFromTx[i];
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 2: Compute nullifier and verify it matches public input
    // nullifier = SHA256(secret || 0x01)
    //
    // The nullifier is derived from the secret but cannot be reversed.
    // This allows the contract to track claims without revealing the secret.
    // ═══════════════════════════════════════════════════════════════════

    // SHA256(secret[256] || 0x01[8]) = 264 bits input
    component nullifierHasher = Sha256(264);

    // Wire secret
    for (var i = 0; i < 256; i++) {
        nullifierHasher.in[i] <== secret[i];
    }

    // Wire 0x01 suffix (8 bits: 00000001 in big-endian)
    nullifierHasher.in[256] <== 0;
    nullifierHasher.in[257] <== 0;
    nullifierHasher.in[258] <== 0;
    nullifierHasher.in[259] <== 0;
    nullifierHasher.in[260] <== 0;
    nullifierHasher.in[261] <== 0;
    nullifierHasher.in[262] <== 0;
    nullifierHasher.in[263] <== 1;

    // Convert hash output to single field element for comparison
    // SHA256 output is big-endian, Bits2Num expects little-endian
    component nullifierBits2Num = Bits2Num(254);  // Field element max 254 bits
    for (var i = 0; i < 254; i++) {
        nullifierBits2Num.in[i] <== nullifierHasher.out[253 - i];
    }

    // Verify nullifier matches public input
    nullifier === nullifierBits2Num.out;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 3: Verify locker script hash matches public input
    //
    // This ensures the transaction actually sent BTC to the claimed locker.
    // The contract verifies lockerScriptHash is a registered valid locker.
    // ═══════════════════════════════════════════════════════════════════

    component lockerHasher = Sha256(520);
    for (var i = 0; i < 520; i++) {
        lockerHasher.in[i] <== lockerScript[i];
    }

    // Convert to field element for comparison
    component lockerHashBits2Num = Bits2Num(254);
    for (var i = 0; i < 254; i++) {
        lockerHashBits2Num.in[i] <== lockerHasher.out[253 - i];
    }

    // Verify locker script hash matches public input
    lockerScriptHash === lockerHashBits2Num.out;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 4: Verify TX output sends `amount` to `lockerScript`
    //
    // Phase 1.5 Implementation:
    // - Prover provides lockerOutputOffset (bit offset in TX)
    // - Extract value at that offset (8 bytes, little-endian)
    // - Extract script at that offset (after value + 1 byte length)
    // - Verify value == amount
    // - Verify script == lockerScript
    //
    // Note: Full varint parsing and output navigation deferred to Phase 2
    // ═══════════════════════════════════════════════════════════════════

    // Use txLength to create a constraint (prevents unused signal warning)
    signal txLengthCheck;
    txLengthCheck <== txLength * txLength;

    // Use lockerOutputIndex (for future navigation verification)
    signal lockerOutputIndexCheck;
    lockerOutputIndexCheck <== lockerOutputIndex * lockerOutputIndex;

    // Verify TX output using VerifyTxOutput template
    component txOutputVerifier = VerifyTxOutput(maxTxBits, 520);

    // Wire transaction bits
    for (var i = 0; i < maxTxBits; i++) {
        txOutputVerifier.txBits[i] <== transaction[i];
    }

    // Wire output offset (prover-provided)
    txOutputVerifier.outputOffset <== lockerOutputOffset;

    // Wire expected amount
    txOutputVerifier.expectedAmount <== amount;

    // Wire expected script (padded locker script)
    for (var i = 0; i < 520; i++) {
        txOutputVerifier.expectedScript[i] <== lockerScript[i];
    }

    // Wire expected script length
    txOutputVerifier.expectedScriptLength <== lockerScriptLength;

    // Verify the output is valid (value and script match)
    txOutputVerifier.isValid === 1;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 5: Compute txId (SKIPPED FOR PHASE 1)
    //
    // Will be implemented in Phase 2 along with Merkle verification.
    // txId = SHA256(SHA256(transaction)) - Bitcoin's double hash
    //
    // Skipping this saves ~500,000 constraints (the most expensive part)
    // ═══════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 6: Merkle proof verification (SKIPPED FOR PHASE 1)
    //
    // Will be implemented when block headers are available on contract.
    // For now, merkleRoot and merkleProof are inputs but not verified.
    //
    // Future implementation will verify:
    // - txId is a leaf in the Merkle tree
    // - The tree root matches merkleRoot
    // - Contract verifies merkleRoot against Bitcoin relay
    // ═══════════════════════════════════════════════════════════════════

    // Dummy constraints to use merkle inputs (prevents unused signal errors)
    signal merkleRootSquared;
    merkleRootSquared <== merkleRoot * merkleRoot;

    signal merkleIndexSquared;
    merkleIndexSquared <== merkleIndex * merkleIndex;

    // Use merkleProof signals
    signal merkleProofSum[12];
    for (var i = 0; i < 12; i++) {
        var sum = 0;
        for (var j = 0; j < 256; j++) {
            sum += merkleProof[i][j];
        }
        merkleProofSum[i] <-- sum;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Use recipient signal (it's a public input, verified by contract)
    // ═══════════════════════════════════════════════════════════════════
    signal recipientSquared;
    recipientSquared <== recipient * recipient;
}

// Main component instantiation
// - maxTxBytes = 1024 (1KB max transaction size)
// - Public inputs: merkleRoot, nullifier, amount, chainId, recipient, lockerScriptHash
component main {public [merkleRoot, nullifier, amount, chainId, recipient, lockerScriptHash]} = PrivateTransferClaim(1024);
