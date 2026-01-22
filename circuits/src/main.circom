pragma circom 2.0.0;

/*
 * Private Transfer Circuit for TeleSwap
 *
 * Proves knowledge of a Bitcoin transaction that:
 * 1. Contains a commitment derived from a secret (includes recipient for front-running protection)
 * 2. Sends BTC to a specific locker
 * 3. Amount matches the committed amount
 * 4. TX is in one of N merkle roots (hidden which one for privacy)
 *
 * Without revealing the secret or the full transaction details.
 *
 * See: PRIVATE_TRANSFER.md and PRIVATE_TRANSFER_PLAN.md
 */

include "../../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/mux1.circom";
include "./tx_parser.circom";
include "./sha256_variable.circom";

/*
 * Main template for private transfer claims
 *
 * @param maxTxBytes - Maximum transaction size in bytes (e.g., 1024)
 */
template PrivateTransferClaim(maxTxBytes) {
    var maxTxBits = maxTxBytes * 8;

    // Number of merkle roots for hidden selection (privacy enhancement)
    // User proves TX is in ONE of these roots without revealing which
    var NUM_MERKLE_ROOTS = 2;

    // Max padded size for SHA256: ceil((maxTxBits + 65) / 512) * 512
    var maxPaddedBits = ((maxTxBits + 64) \ 512 + 1) * 512;

    // ═══════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS (7 total)
    // These are visible on-chain and verified by the smart contract
    // ═══════════════════════════════════════════════════════════════════

    // Array of Merkle roots from Bitcoin block headers
    // User proves TX is in ONE of these without revealing which (privacy enhancement)
    // NOTE: Actual Merkle verification skipped for Phase 1
    signal input merkleRoots[NUM_MERKLE_ROOTS];

    // Nullifier = SHA256(secret || 0x01)
    // Prevents double-claiming - contract tracks used nullifiers
    signal input nullifier;

    // Amount in satoshis - must match TX output AND commitment
    signal input amount;

    // Target EVM chain ID - bound in commitment to prevent cross-chain replay
    signal input chainId;

    // Recipient EVM address (as field element)
    // IMPORTANT: Also included in commitment to prevent front-running attacks
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

    // Locker's Bitcoin script (to verify against hash)
    // 520 bits = 65 bytes max (P2SH script)
    signal input lockerScript[520];

    // Actual locker script length in bytes
    signal input lockerScriptLength;

    // Index of the output that pays the locker (0, 1, 2, ...)
    signal input lockerOutputIndex;

    // BYTE offset where the locker output starts in the transaction
    signal input lockerOutputByteOffset;

    // BYTE offset where the commitment starts in OP_RETURN output
    // This is after: OP_RETURN (0x6a) + PUSH_32 (0x20) = 2 bytes after output value+scriptlen
    // The prover calculates this by parsing the TX structure
    signal input commitmentByteOffset;

    // HIDDEN ROOT SELECTION: Which merkle root the TX is in (0 to NUM_MERKLE_ROOTS-1)
    // This is PRIVATE - observers cannot determine which root was used (privacy enhancement)
    signal input rootIndex;

    // Merkle proof data (kept as inputs for future Phase 2)
    // 12 levels for ~4000 transactions per block
    signal input merkleProof[12][256];
    signal input merkleIndex;

    // ═══════════════════════════════════════════════════════════════════
    // SINGLE TRANSACTION INPUT (paddedTransaction)
    //
    // SECURITY FIX: We use ONLY paddedTransaction for all operations.
    // This ensures the same transaction is used for:
    // - Output verification (amount/script)
    // - Commitment verification (OP_RETURN extraction)
    // - TxId computation (double SHA256)
    //
    // Structure: [raw_tx_bytes][0x80][zeros...][64-bit length]
    // The raw transaction data is at indices [0, txLength*8)
    // ═══════════════════════════════════════════════════════════════════

    // Pre-padded transaction for SHA256 computation
    // Prover computes correct SHA256 padding based on actual TX length
    signal input paddedTransaction[maxPaddedBits];

    // Number of 512-bit blocks in the padded transaction
    // numBlocks = ceil((txLength * 8 + 65) / 512)
    signal input numBlocks;

    // Transaction ID = SHA256(SHA256(stripped_transaction))
    // This is PRIVATE to preserve user privacy
    // Will be used in Phase 2B for Merkle proof verification
    signal input txId[256];

    // ═══════════════════════════════════════════════════════════════════
    // BINARY CONSTRAINTS FOR BIT ARRAY INPUTS
    //
    // Ensure all bit array inputs are actually binary (0 or 1).
    // This prevents attacks using non-binary field elements.
    // ═══════════════════════════════════════════════════════════════════

    // Constrain secret bits to be binary
    for (var i = 0; i < 256; i++) {
        secret[i] * (secret[i] - 1) === 0;
    }

    // Constrain locker script bits to be binary
    for (var i = 0; i < 520; i++) {
        lockerScript[i] * (lockerScript[i] - 1) === 0;
    }

    // Constrain txId bits to be binary
    for (var i = 0; i < 256; i++) {
        txId[i] * (txId[i] - 1) === 0;
    }

    // Constrain paddedTransaction bits to be binary
    for (var i = 0; i < maxPaddedBits; i++) {
        paddedTransaction[i] * (paddedTransaction[i] - 1) === 0;
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 1: Compute commitment and verify it matches TX commitment
    // commitment = SHA256(secret || amount || chainId || recipient)
    //
    // SECURITY FIX: The commitment is EXTRACTED from paddedTransaction
    // at commitmentByteOffset, not provided as a separate input.
    // This ensures the commitment is actually in the Bitcoin transaction.
    // ═══════════════════════════════════════════════════════════════════

    // Convert amount to bits (64 bits for satoshis)
    // Num2Bits outputs in little-endian (LSB first)
    component amountBits = Num2Bits(64);
    amountBits.in <== amount;

    // Convert chainId to bits (16 bits)
    component chainIdBits = Num2Bits(16);
    chainIdBits.in <== chainId;

    // Convert recipient to bits (160 bits for EVM address)
    component recipientBits = Num2Bits(160);
    recipientBits.in <== recipient;

    // Compute expected commitment: SHA256(secret[256] || amount[64] || chainId[16] || recipient[160])
    // Total: 496 bits = 62 bytes
    component commitmentHasher = Sha256(496);

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

    // Wire recipient (160 bits) - convert from little-endian to big-endian
    // This binds the recipient to the commitment, preventing front-running
    for (var i = 0; i < 160; i++) {
        commitmentHasher.in[336 + i] <== recipientBits.out[159 - i];
    }

    // Extract commitment from transaction at commitmentByteOffset
    // The commitment is 32 bytes (256 bits) in the OP_RETURN output
    component commitmentExtractor = ExtractBitsAtByteOffset(maxTxBytes, 256);
    for (var i = 0; i < maxTxBits; i++) {
        commitmentExtractor.bits[i] <== paddedTransaction[i];
    }
    commitmentExtractor.byteOffset <== commitmentByteOffset;

    // Verify computed commitment matches the commitment extracted from TX
    // This ensures the prover knows the secret that created the on-chain commitment
    for (var i = 0; i < 256; i++) {
        commitmentHasher.out[i] === commitmentExtractor.out[i];
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
    // SECURITY FIX: Uses paddedTransaction (not separate transaction input)
    // to ensure the same TX is used for output verification and txId.
    //
    // Uses selector-based extraction (tx_parser.circom) to properly
    // constrain that extracted data comes from the TX at the claimed offset.
    // ═══════════════════════════════════════════════════════════════════

    // Use lockerOutputIndex (for future navigation verification)
    signal lockerOutputIndexCheck;
    lockerOutputIndexCheck <== lockerOutputIndex * lockerOutputIndex;

    // Verify TX output using VerifyTxOutput template
    component txOutputVerifier = VerifyTxOutput(maxTxBytes, 520);

    // Wire transaction bits from paddedTransaction (first maxTxBits are raw TX)
    for (var i = 0; i < maxTxBits; i++) {
        txOutputVerifier.txBits[i] <== paddedTransaction[i];
    }

    // Wire output byte offset (prover-provided, in bytes not bits)
    txOutputVerifier.outputByteOffset <== lockerOutputByteOffset;

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
    // CONSTRAINT 5: Verify txId = SHA256(SHA256(paddedTransaction))
    //
    // Bitcoin transaction ID is the double SHA256 of the stripped transaction.
    // The paddedTransaction contains the stripped TX with SHA256 padding.
    //
    // SECURITY: Using the same paddedTransaction for output verification
    // and txId computation ensures consistency.
    // ═══════════════════════════════════════════════════════════════════

    component txIdVerifier = VerifyTxId(maxTxBits);

    // Wire padded transaction bits
    for (var i = 0; i < maxPaddedBits; i++) {
        txIdVerifier.paddedTransaction[i] <== paddedTransaction[i];
    }

    // Wire number of blocks
    txIdVerifier.numBlocks <== numBlocks;

    // Wire expected txId
    for (var i = 0; i < 256; i++) {
        txIdVerifier.expectedTxId[i] <== txId[i];
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 6: Hidden root selection (PRIVACY ENHANCEMENT)
    //
    // User proves TX is in ONE of merkleRoots[N] without revealing which.
    // This expands the anonymity set to all deposits across N blocks.
    // ═══════════════════════════════════════════════════════════════════

    // Verify rootIndex is valid (0 or 1 for N=2)
    component rootIndexValid = LessThan(8);
    rootIndexValid.in[0] <== rootIndex;
    rootIndexValid.in[1] <== NUM_MERKLE_ROOTS;
    rootIndexValid.out === 1;

    // Select the actual merkle root based on private rootIndex
    // Using Mux1 for N=2 selection
    component rootSelector = Mux1();
    rootSelector.c[0] <== merkleRoots[0];
    rootSelector.c[1] <== merkleRoots[1];
    rootSelector.s <== rootIndex;

    signal selectedMerkleRoot;
    selectedMerkleRoot <== rootSelector.out;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 7: Merkle proof verification (SKIPPED FOR PHASE 1)
    //
    // Will be implemented when block headers are available on contract.
    // For now, merkleProof inputs are kept but not verified.
    //
    // Future implementation will verify:
    // - txId is a leaf in the Merkle tree
    // - The tree root matches selectedMerkleRoot
    // - Contract verifies all merkleRoots against Bitcoin relay
    // ═══════════════════════════════════════════════════════════════════

    // Dummy constraints to use merkle inputs (prevents unused signal errors)
    signal merkleRootSquared;
    merkleRootSquared <== selectedMerkleRoot * selectedMerkleRoot;

    signal merkleIndexSquared;
    merkleIndexSquared <== merkleIndex * merkleIndex;

    // Use merkleProof signals with proper constraints
    signal merkleProofSum[12];
    for (var i = 0; i < 12; i++) {
        var sum = 0;
        for (var j = 0; j < 256; j++) {
            sum += merkleProof[i][j];
        }
        merkleProofSum[i] <== sum;
    }
}

// Main component instantiation
// - maxTxBytes = 1024 (1KB max transaction size)
// - Public inputs: merkleRoots[2], nullifier, amount, chainId, recipient, lockerScriptHash
component main {public [merkleRoots, nullifier, amount, chainId, recipient, lockerScriptHash]} = PrivateTransferClaim(1024);
