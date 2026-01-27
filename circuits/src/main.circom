pragma circom 2.0.0;

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * Private Transfer Circuit for TeleSwap
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Proves knowledge of a Bitcoin transaction that:
 * 1. Contains a commitment derived from a secret (includes recipient for front-running protection)
 * 2. Sends BTC to a specific locker
 * 3. Amount matches the committed amount
 * 4. TX is in one of N merkle roots (hidden which one for privacy)
 * 5. TX is included in a valid Merkle tree (verified via proof)
 *
 * Without revealing the secret or the full transaction details.
 *
 * Security features:
 * - Commitment includes recipient (prevents front-running)
 * - Hidden root selection (expands anonymity set across multiple blocks)
 * - Full Merkle proof verification (ensures TX is in a valid Bitcoin block)
 * - TxId verification (ensures TX data integrity)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * IMPORTANT: TWO TYPES OF HASHES IN THIS CIRCUIT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This circuit uses SHA256 for multiple purposes. It's critical to understand
 * that some hashes MUST match Bitcoin exactly, while others are our own constructs.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ TYPE 1: BITCOIN-COMPATIBLE HASHES (Full 256-bit comparison)                 │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ These hashes MUST match what Bitcoin computes. They are compared            │
 * │ bit-by-bit (all 256 bits) with NO field modulo applied.                     │
 * │                                                                             │
 * │ • TxId = SHA256(SHA256(transaction))                                        │
 * │   - Bitcoin's transaction identifier                                        │
 * │   - Compared: 256-bit exact match                                           │
 * │   - If wrong: proof fails, can't fake transaction data                      │
 * │                                                                             │
 * │ • Commitment = SHA256(secret || amount || chainId || recipient)             │
 * │   - Stored in Bitcoin's OP_RETURN output                                    │
 * │   - Compared: 256-bit exact match (extracted from TX)                       │
 * │   - If wrong: proof fails, can't claim without knowing secret               │
 * │                                                                             │
 * │ • Merkle Proof Hashes                                                       │
 * │   - Bitcoin block's Merkle tree uses double SHA256                          │
 * │   - Compared: 256-bit exact match at each level                             │
 * │   - If wrong: computed root won't match block header                        │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ TYPE 2: SYSTEM IDENTIFIERS (Field elements with BN254 modulo)               │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ These are NOT Bitcoin hashes - they're our own constructs for the ZK        │
 * │ system. They're converted to field elements (254 bits) for use as           │
 * │ public inputs to the smart contract.                                        │
 * │                                                                             │
 * │ • Nullifier = SHA256(secret || 0x01) mod BN254_PRIME                        │
 * │   - OUR construct for double-spend prevention                               │
 * │   - Not used by Bitcoin at all                                              │
 * │   - Stored on-chain to track used claims                                    │
 * │                                                                             │
 * │ • LockerScriptHash = SHA256(lockerScript padded to 65 bytes) mod BN254      │
 * │   - OUR construct for locker identification                                 │
 * │   - Not a standard Bitcoin hash                                             │
 * │   - Used to verify deposit went to a registered locker                      │
 * │                                                                             │
 * │ • MerkleRoots (public inputs) = truncated to 254 bits                       │
 * │   - For smart contract interface only                                       │
 * │   - Internal Merkle verification uses full 256 bits                         │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * WHY BN254 MODULO FOR TYPE 2?
 * - ZK circuits use the BN254 elliptic curve (used by Groth16)
 * - BN254's scalar field is ~254 bits (prime: 21888242871839275222246405745257275088548364400416034343698204186575808495617)
 * - Public inputs must fit in this field
 * - For Type 2 hashes, this is fine because they're our constructs
 * - For Type 1 hashes, we use full 256-bit comparison (no field conversion)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY LOCKER SCRIPT HASH INSTEAD OF LOCKER SCRIPT DIRECTLY?
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The locker script hash serves as an IDENTIFIER for registered lockers.
 * We hash the script instead of using it directly because:
 *
 * 1. FIXED SIZE FOR PUBLIC INPUT
 *    - Bitcoin scripts have variable lengths (P2PKH=25, P2SH=23, P2WPKH=22 bytes)
 *    - Public inputs must be field elements (single values)
 *    - Hashing produces a fixed-size identifier regardless of script type
 *
 * 2. EFFICIENT ON-CHAIN STORAGE
 *    - Smart contract stores: mapping(uint256 => bool) isValidLockerHash
 *    - One field element per locker, not variable-length bytes
 *    - Cheaper gas for storage and comparison
 *
 * 3. CONSISTENT INTERFACE
 *    - Circuit outputs one field element for locker identification
 *    - Contract checks: require(isValidLockerHash[lockerScriptHash])
 *    - Works the same for all script types
 *
 * SECURITY MODEL:
 * - Circuit PROVES: "TX sent BTC to script S, and SHA256(S) = H"
 * - Contract VERIFIES: "H is in our registry of approved lockers"
 * - Result: Only deposits to registered lockers can mint teleBTC
 *
 * Without this verification, users could:
 * - Send BTC to their own address
 * - Generate a proof claiming it went to a "locker"
 * - Mint unbacked teleBTC (theft)
 *
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * BIT ORDERING CONVENTIONS (CRITICAL FOR CORRECTNESS)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This circuit uses BIG-ENDIAN bit ordering throughout, matching circomlib's SHA256:
 *
 * 1. BIG-ENDIAN BIT ORDER (MSB first per byte):
 *    - Byte 0xA5 (binary 10100101) → bits [1,0,1,0,0,1,0,1]
 *    - Bit index 0 = MSB of first byte
 *    - Bit index 7 = LSB of first byte
 *    - Bit index 8 = MSB of second byte, etc.
 *
 * 2. CIRCOMLIB SHA256 FORMAT:
 *    - Input: Big-endian bits (MSB first per byte)
 *    - Output: Big-endian bits (MSB first per byte)
 *    - Internally uses LSB-first per 32-bit word, but this is abstracted away
 *
 * 3. NUM2BITS / BITS2NUM (circomlib):
 *    - Num2Bits outputs LITTLE-ENDIAN (LSB at index 0)
 *    - Bits2Num expects LITTLE-ENDIAN (LSB at index 0)
 *    - We REVERSE when interfacing with SHA256's big-endian format
 *
 * 4. BITCOIN TRANSACTION VALUES:
 *    - Stored as LITTLE-ENDIAN bytes (LSB first)
 *    - Amount 10000000 sats (0x989680) stored as: [0x80, 0x96, 0x98, 0x00, ...]
 *
 * 5. FIELD ELEMENT TRUNCATION:
 *    - BN254 field supports ~254 bits
 *    - 256-bit hashes truncated to first 254 bits for public inputs
 *    - Truncation: take bits[0..253] (MSB bits preserved)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SHA256 PADDING STANDARD (RFC 6234)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * For a message of L bits:
 * 1. Append bit '1' (0x80 byte = 10000000 binary)
 * 2. Append K zero bits where K is minimum >= 0 such that (L + 1 + K) ≡ 448 mod 512
 * 3. Append 64-bit big-endian representation of L
 *
 * Result is always a multiple of 512 bits (64 bytes).
 *
 * Example: 100-byte message (800 bits)
 * - Padded size: ceil((800 + 65) / 512) * 512 = 1024 bits = 128 bytes = 2 blocks
 * - Content: [message:100][0x80:1][zeros:55][length:8] = 128 bytes
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * See: PRIVATE_TRANSFER.md and PRIVATE_TRANSFER_PLAN.md
 */

include "../../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/mux1.circom";
include "./tx_parser.circom";
include "./sha256_variable.circom";
include "./merkle_proof.circom";

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
    //
    // FORMAT: All are field elements (max ~254 bits for BN254 curve)
    // Hash-derived values are truncated from 256 to 254 bits (MSB preserved)
    // ═══════════════════════════════════════════════════════════════════

    // Array of Merkle roots from Bitcoin block headers
    // User proves TX is in ONE of these without revealing which (privacy enhancement)
    // Contract verifies ALL roots are valid Bitcoin block headers via relay
    //
    // FORMAT: Field element = first 254 bits of 256-bit Merkle root
    //         Conversion: Bits2Num(merkleRootBits[0..253]) with bit reversal for LE
    signal input merkleRoots[NUM_MERKLE_ROOTS];

    // Nullifier = SHA256(secret || 0x01)[0:254]
    // Prevents double-claiming - contract tracks used nullifiers
    //
    // FORMAT: Field element = first 254 bits of SHA256 output
    //         Witness computes: sha256(secret || 0x01), take bits[0..253], convert to BigInt
    signal input nullifier;

    // Amount in satoshis - must match TX output AND commitment
    //
    // FORMAT: Field element, direct value (e.g., 10000000 for 0.1 BTC)
    //         Max: ~2^64 satoshis (Bitcoin's max supply fits in 51 bits)
    signal input amount;

    // Target EVM chain ID - bound in commitment to prevent cross-chain replay
    //
    // FORMAT: Field element, direct value (e.g., 137 for Polygon)
    //         Typical values: 1 (Ethereum), 137 (Polygon), 56 (BSC)
    signal input chainId;

    // Recipient EVM address (as field element)
    // IMPORTANT: Also included in commitment to prevent front-running attacks
    // This is where teleBTC will be minted
    //
    // FORMAT: Field element = 160-bit address as number
    //         Witness computes: BigInt('0x' + addressHex)
    signal input recipient;

    // Hash of locker's Bitcoin script
    // Contract verifies this corresponds to a valid registered locker
    //
    // FORMAT: Field element = first 254 bits of SHA256(lockerScript padded to 65 bytes)
    //         The 65-byte padding ensures consistent hashing regardless of script length
    signal input lockerScriptHash;

    // ═══════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS
    // These remain hidden - only proven via ZK
    //
    // BIT ARRAY FORMAT: All bit arrays use BIG-ENDIAN ordering (MSB first per byte)
    // This matches circomlib SHA256 input/output format.
    // ═══════════════════════════════════════════════════════════════════

    // User's secret - the key to claiming (256 bits = 32 bytes)
    //
    // FORMAT: Big-endian bits (MSB of byte 0 at index 0)
    //         Witness: bufferToBitsBE(secretBytes)
    //         Example: secret 0xAB... → bits[0]=1, bits[1]=0, bits[2]=1, bits[3]=0, ...
    signal input secret[256];

    // Locker's Bitcoin script (to verify against hash)
    // 520 bits = 65 bytes max (covers P2PKH:25, P2SH:23, P2WPKH:22 bytes)
    //
    // FORMAT: Big-endian bits, zero-padded to 520 bits
    //         Actual script bytes at start, then zeros
    //         Witness: padBits(bufferToBitsBE(lockerScriptBytes), 520)
    //
    // IMPORTANT: Circuit hashes ALL 520 bits. Witness must hash the same
    //            65-byte (zero-padded) buffer to match lockerScriptHash.
    signal input lockerScript[520];

    // Actual locker script length in bytes (22-25 for standard scripts)
    //
    // FORMAT: Integer value
    //         Constrained to [22, 25] in tx_parser.circom
    signal input lockerScriptLength;

    // Index of the output that pays the locker (0, 1, 2, ...)
    //
    // FORMAT: Integer value (currently used for future navigation verification)
    signal input lockerOutputIndex;

    // BYTE offset where the locker output starts in the transaction
    //
    // FORMAT: Integer value (byte position, not bit position)
    //         Example: If output starts at byte 47, this is 47
    //         Witness calculates: version(4) + inputCount(1) + inputs(...) + outputCount(1)
    signal input lockerOutputByteOffset;

    // BYTE offset where the commitment starts in OP_RETURN output
    // This is after: OP_RETURN (0x6a) + PUSH_32 (0x20) = 2 bytes after output value+scriptlen
    // The prover calculates this by parsing the TX structure
    //
    // FORMAT: Integer value (byte position, not bit position)
    //         Witness calculates: lockerOutputByteOffset + output0.length + 8 + 1 + 2
    signal input commitmentByteOffset;

    // HIDDEN ROOT SELECTION: Which merkle root the TX is in (0 to NUM_MERKLE_ROOTS-1)
    // This is PRIVATE - observers cannot determine which root was used (privacy enhancement)
    //
    // FORMAT: Integer value, constrained to be binary (0 or 1 for N=2)
    signal input rootIndex;

    // Merkle proof data for Bitcoin block inclusion verification
    // 12 levels support up to ~4096 transactions per block
    //
    // FORMAT: merkleProof[level][256] = sibling hash at that level, big-endian bits
    //         Level 0 is closest to leaf (txId), level depth-1 is closest to root
    //         Unused levels (>= depth) should be zeros
    signal input merkleProof[12][256];  // Sibling hashes at each level

    // Path indices: bit i indicates if current hash is left (0) or right (1) child at level i
    //
    // FORMAT: Binary values (0 or 1), constrained in circuit
    //         0 = current node is LEFT child, sibling is RIGHT
    //         1 = current node is RIGHT child, sibling is LEFT
    signal input merklePathIndices[12];

    // Actual depth of the Merkle tree (1 to 12, depends on number of TXs in block)
    //
    // FORMAT: Integer value in [1, 12]
    //         depth=1 means 2 TXs, depth=12 means up to 4096 TXs
    signal input merkleDepth;

    // Full 256-bit representation of merkle roots (private)
    // These must match the public merkleRoots when truncated to 254 bits
    // We need the full 256 bits for accurate Merkle root comparison
    //
    // FORMAT: merkleRootBits[rootIdx][256] = big-endian bits of merkle root
    //         Public merkleRoots[i] = Bits2Num(merkleRootBits[i][0..253] reversed)
    signal input merkleRootBits[2][256];

    // ═══════════════════════════════════════════════════════════════════
    // SINGLE TRANSACTION INPUT (paddedTransaction)
    //
    // SECURITY FIX: We use ONLY paddedTransaction for all operations.
    // This ensures the same transaction is used for:
    // - Output verification (amount/script)
    // - Commitment verification (OP_RETURN extraction)
    // - TxId computation (double SHA256)
    //
    // ═══════════════════════════════════════════════════════════════════
    // SHA256 PADDING STRUCTURE:
    // ═══════════════════════════════════════════════════════════════════
    //
    // For a transaction of L bytes (L*8 bits):
    //
    //   [raw_tx_bytes: L bytes][0x80: 1 byte][zeros: K bytes][length: 8 bytes]
    //
    // Where K is chosen so total is multiple of 64 bytes (512 bits).
    //
    // EXAMPLE: 124-byte transaction
    //   - L = 124 bytes = 992 bits
    //   - Padded size = ceil((992 + 65) / 512) * 512 = 1536 bits = 192 bytes = 3 blocks
    //   - Structure: [tx:124][0x80:1][zeros:59][length:8] = 192 bytes
    //   - Length field (big-endian): 0x00000000000003E0 = 992
    //
    // BIT FORMAT: Big-endian (MSB first per byte)
    //   - paddedTransaction[0..7] = bits of byte 0 (version[0]) in MSB-first order
    //   - paddedTransaction[8..15] = bits of byte 1 (version[1])
    //   - etc.
    //
    // ═══════════════════════════════════════════════════════════════════

    // Pre-padded transaction for SHA256 computation
    // Prover computes correct SHA256 padding based on actual TX length
    //
    // FORMAT: Big-endian bits, zero-extended to maxPaddedBits
    //         First (numBlocks * 512) bits contain the actual padded transaction
    //         Remaining bits are zeros (ignored by variable-length SHA256)
    //
    // WITNESS GENERATION:
    //   1. rawTx = serialized Bitcoin transaction
    //   2. paddedTx = sha256Pad(rawTx)  // Apply SHA256 padding
    //   3. paddedBits = bufferToBitsBE(paddedTx)  // Convert to big-endian bits
    //   4. Extend with zeros to maxPaddedBits
    signal input paddedTransaction[maxPaddedBits];

    // Number of 512-bit blocks in the padded transaction
    // numBlocks = ceil((txLength * 8 + 65) / 512)
    //
    // FORMAT: Integer value in [1, maxBlocks]
    //         maxBlocks = maxPaddedBits / 512 = 9 for maxTxBytes=512
    //
    // SECURITY: If prover lies about numBlocks, the computed hash won't match
    //           expectedTxId, and the proof will fail.
    signal input numBlocks;

    // Transaction ID = SHA256(SHA256(raw_transaction))
    // This is PRIVATE to preserve user privacy
    // Used for Merkle proof verification
    //
    // FORMAT: Big-endian bits (256 bits)
    //         Witness: bufferToBitsBE(doubleSha256(rawTx))
    //
    // NOTE ON DISPLAY ORDER: Bitcoin displays txIds in reversed byte order.
    //       Internal txId 0xABCD... displays as 0x...DCBA
    //       We use the INTERNAL (non-reversed) format for hashing/proofs.
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
    // ┌─────────────────────────────────────────────────────────────────┐
    // │ HASH TYPE: BITCOIN-COMPATIBLE (Type 1)                          │
    // │ - Full 256-bit comparison, NO field modulo                      │
    // │ - Must match the commitment stored in Bitcoin's OP_RETURN       │
    // │ - Compared bit-by-bit: commitmentHasher.out[i] === extracted[i] │
    // └─────────────────────────────────────────────────────────────────┘
    //
    // SECURITY FIX: The commitment is EXTRACTED from paddedTransaction
    // at commitmentByteOffset, not provided as a separate input.
    // This ensures the commitment is actually in the Bitcoin transaction.
    //
    // ═══════════════════════════════════════════════════════════════════
    // COMMITMENT FORMAT (62 bytes = 496 bits):
    // ═══════════════════════════════════════════════════════════════════
    //
    //   [secret: 32 bytes][amount: 8 bytes BE][chainId: 2 bytes BE][recipient: 20 bytes]
    //
    // All components in BIG-ENDIAN byte order, then big-endian bits per byte.
    //
    // WITNESS MUST COMPUTE THE SAME WAY:
    //   commitmentInput = Buffer.concat([
    //     secretBytes,                          // 32 bytes
    //     amountBuf.writeBigUInt64BE(amount),   // 8 bytes big-endian
    //     chainIdBuf.writeUInt16BE(chainId),    // 2 bytes big-endian
    //     recipientBytes                        // 20 bytes
    //   ]);
    //   commitment = sha256(commitmentInput);
    //
    // ═══════════════════════════════════════════════════════════════════

    // Convert amount to bits (64 bits for satoshis)
    //
    // Num2Bits OUTPUT FORMAT: Little-endian (LSB at index 0)
    //   - amountBits.out[0] = bit 0 (LSB) of amount
    //   - amountBits.out[63] = bit 63 (MSB) of amount
    component amountBits = Num2Bits(64);
    amountBits.in <== amount;

    // Convert chainId to bits (16 bits)
    //
    // Num2Bits OUTPUT FORMAT: Little-endian (LSB at index 0)
    component chainIdBits = Num2Bits(16);
    chainIdBits.in <== chainId;

    // Convert recipient to bits (160 bits for EVM address)
    //
    // Num2Bits OUTPUT FORMAT: Little-endian (LSB at index 0)
    component recipientBits = Num2Bits(160);
    recipientBits.in <== recipient;

    // Compute expected commitment: SHA256(secret[256] || amount[64] || chainId[16] || recipient[160])
    // Total: 496 bits = 62 bytes
    //
    // SHA256 INPUT FORMAT: Big-endian bits (MSB first per byte)
    component commitmentHasher = Sha256(496);

    // Wire secret (256 bits) - already in big-endian bit order from witness
    // secret[0..7] = byte 0 in MSB-first order
    // secret[8..15] = byte 1 in MSB-first order, etc.
    for (var i = 0; i < 256; i++) {
        commitmentHasher.in[i] <== secret[i];
    }

    // Wire amount (64 bits) - convert from little-endian to big-endian for SHA256
    //
    // CONVERSION EXPLANATION:
    //   Num2Bits gives: out[0]=LSB, out[63]=MSB (little-endian)
    //   SHA256 wants: in[0]=MSB of byte 0, in[7]=LSB of byte 0, in[8]=MSB of byte 1, ...
    //   For big-endian NUMBER representation: in[0]=bit63, in[1]=bit62, ..., in[63]=bit0
    //   So: in[i] = out[63-i]
    //
    // This produces the same bit pattern as writeBigUInt64BE in witness.
    for (var i = 0; i < 64; i++) {
        commitmentHasher.in[256 + i] <== amountBits.out[63 - i];
    }

    // Wire chainId (16 bits) - convert from little-endian to big-endian
    //
    // Same conversion logic as amount: in[i] = out[15-i]
    for (var i = 0; i < 16; i++) {
        commitmentHasher.in[320 + i] <== chainIdBits.out[15 - i];
    }

    // Wire recipient (160 bits) - convert from little-endian to big-endian
    // This binds the recipient to the commitment, preventing front-running
    //
    // Same conversion logic: in[i] = out[159-i]
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
    // ┌─────────────────────────────────────────────────────────────────┐
    // │ HASH TYPE: SYSTEM IDENTIFIER (Type 2)                           │
    // │ - Converted to field element (254 bits) via Bits2Num            │
    // │ - NOT a Bitcoin hash - this is OUR construct                    │
    // │ - Used for double-spend prevention on the smart contract        │
    // │ - BN254 modulo is applied (values > prime wrap around)          │
    // │ - JavaScript must compute the same way: hash % BN254_PRIME      │
    // └─────────────────────────────────────────────────────────────────┘
    //
    // The nullifier is derived from the secret but cannot be reversed.
    // This allows the contract to track claims without revealing the secret.
    //
    // ═══════════════════════════════════════════════════════════════════
    // NULLIFIER FORMAT (33 bytes = 264 bits):
    // ═══════════════════════════════════════════════════════════════════
    //
    //   [secret: 32 bytes][0x01: 1 byte]
    //
    // WITNESS COMPUTES:
    //   nullifierInput = Buffer.concat([secretBytes, Buffer.from([0x01])]);
    //   nullifierHash = sha256(nullifierInput);
    //   nullifierBits = bufferToBitsBE(nullifierHash);
    //   nullifier = bitsToBigInt(nullifierBits.slice(0, 254));  // Truncate to field
    //
    // ═══════════════════════════════════════════════════════════════════

    // SHA256(secret[256] || 0x01[8]) = 264 bits input
    component nullifierHasher = Sha256(264);

    // Wire secret (256 bits, big-endian from input)
    for (var i = 0; i < 256; i++) {
        nullifierHasher.in[i] <== secret[i];
    }

    // Wire 0x01 suffix (8 bits: 00000001 in big-endian bit order)
    //
    // BIG-ENDIAN BIT ORDER for byte 0x01:
    //   - Bit 7 (MSB) = 0  → index 256
    //   - Bit 6 = 0        → index 257
    //   - Bit 5 = 0        → index 258
    //   - Bit 4 = 0        → index 259
    //   - Bit 3 = 0        → index 260
    //   - Bit 2 = 0        → index 261
    //   - Bit 1 = 0        → index 262
    //   - Bit 0 (LSB) = 1  → index 263
    nullifierHasher.in[256] <== 0;
    nullifierHasher.in[257] <== 0;
    nullifierHasher.in[258] <== 0;
    nullifierHasher.in[259] <== 0;
    nullifierHasher.in[260] <== 0;
    nullifierHasher.in[261] <== 0;
    nullifierHasher.in[262] <== 0;
    nullifierHasher.in[263] <== 1;

    // Convert hash output to single field element for comparison
    //
    // SHA256 OUTPUT FORMAT: Big-endian bits
    //   - out[0] = MSB of hash (bit 255)
    //   - out[255] = LSB of hash (bit 0)
    //
    // BITS2NUM INPUT FORMAT: Little-endian bits
    //   - in[0] = LSB of number
    //   - in[253] = bit 253 of number
    //
    // CONVERSION: Reverse the first 254 bits
    //   - nullifierBits2Num.in[0] = nullifierHasher.out[253] (becomes LSB)
    //   - nullifierBits2Num.in[253] = nullifierHasher.out[0] (becomes bit 253)
    //
    // TRUNCATION: We only use bits 0-253 of the hash (ignore bits 254-255)
    //   This is safe because it's consistent between circuit and witness.
    component nullifierBits2Num = Bits2Num(254);  // Field element max 254 bits
    for (var i = 0; i < 254; i++) {
        nullifierBits2Num.in[i] <== nullifierHasher.out[253 - i];
    }

    // Verify nullifier matches public input
    nullifier === nullifierBits2Num.out;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 3: Verify locker script hash matches public input
    //
    // ┌─────────────────────────────────────────────────────────────────┐
    // │ HASH TYPE: SYSTEM IDENTIFIER (Type 2)                           │
    // │ - Converted to field element (254 bits) via Bits2Num            │
    // │ - NOT a standard Bitcoin hash - this is OUR construct           │
    // │ - Used to identify registered lockers on the smart contract     │
    // │ - BN254 modulo is applied (values > prime wrap around)          │
    // │ - JavaScript must compute the same way: hash % BN254_PRIME      │
    // └─────────────────────────────────────────────────────────────────┘
    //
    // WHY HASH INSTEAD OF SCRIPT DIRECTLY?
    // - Scripts have variable length (22-25 bytes for standard types)
    // - Public inputs must be single field elements
    // - Hashing gives a fixed-size identifier for any script type
    // - Enables efficient on-chain storage: mapping(uint256 => bool)
    //
    // This ensures the transaction actually sent BTC to the claimed locker.
    // The contract verifies lockerScriptHash is a registered valid locker.
    //
    // ═══════════════════════════════════════════════════════════════════
    // LOCKER SCRIPT HASH FORMAT:
    // ═══════════════════════════════════════════════════════════════════
    //
    // Circuit hashes the FULL 520 bits (65 bytes) of lockerScript input.
    // This includes:
    //   - Actual script bytes (22-25 bytes for standard scripts)
    //   - Zero padding to fill 65 bytes
    //
    // WITNESS MUST COMPUTE THE SAME WAY:
    //   lockerScriptPadded = Buffer.alloc(65);  // All zeros
    //   lockerScriptBytes.copy(lockerScriptPadded);  // Copy script to start
    //   lockerHashBytes = sha256(lockerScriptPadded);  // Hash 65 bytes
    //   lockerHashBits = bufferToBitsBE(lockerHashBytes);
    //   lockerScriptHash = bitsToBigInt(lockerHashBits.slice(0, 254));
    //
    // WHY 65 BYTES? Consistent hashing regardless of actual script length.
    //   Different script types have different lengths (P2PKH=25, P2SH=23, etc.)
    //   By always hashing 65 bytes, we get a consistent interface.
    //
    // ═══════════════════════════════════════════════════════════════════

    // Hash the full 520-bit (65-byte) locker script (including zero padding)
    component lockerHasher = Sha256(520);
    for (var i = 0; i < 520; i++) {
        lockerHasher.in[i] <== lockerScript[i];
    }

    // Convert to field element for comparison
    //
    // Same conversion as nullifier: reverse first 254 bits for Bits2Num
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
    // ┌─────────────────────────────────────────────────────────────────┐
    // │ HASH TYPE: BITCOIN-COMPATIBLE (Type 1)                          │
    // │ - Full 256-bit comparison, NO field modulo                      │
    // │ - MUST match Bitcoin's transaction ID exactly                   │
    // │ - Bitcoin computes: txId = SHA256(SHA256(raw_transaction))      │
    // │ - Compared bit-by-bit: computedTxId[i] === expectedTxId[i]      │
    // │ - Used for Merkle proof verification (must match block data)    │
    // └─────────────────────────────────────────────────────────────────┘
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
    // CONSTRAINT 6: Verify merkleRootBits matches public merkleRoots
    //
    // The public merkleRoots are field elements (max 254 bits).
    // The private merkleRootBits contain the full 256-bit representation.
    // We verify consistency by checking truncated bits match field elements.
    // ═══════════════════════════════════════════════════════════════════

    // Constrain merkleRootBits to be binary
    for (var r = 0; r < NUM_MERKLE_ROOTS; r++) {
        for (var i = 0; i < 256; i++) {
            merkleRootBits[r][i] * (merkleRootBits[r][i] - 1) === 0;
        }
    }

    // Verify rootIndex is valid (0 or 1 for N=2)
    component rootIndexValid = LessThan(8);
    rootIndexValid.in[0] <== rootIndex;
    rootIndexValid.in[1] <== NUM_MERKLE_ROOTS;
    rootIndexValid.out === 1;

    // SECURITY: Explicit binary constraint on rootIndex
    // This ensures Mux1 selector behaves correctly (selects, not interpolates)
    rootIndex * (rootIndex - 1) === 0;

    // Convert merkleRootBits to field elements and verify they match public inputs
    // We truncate to 254 bits (field element size)
    component rootBitsToNum[NUM_MERKLE_ROOTS];
    for (var r = 0; r < NUM_MERKLE_ROOTS; r++) {
        rootBitsToNum[r] = Bits2Num(254);
        // SHA256 output is big-endian, Bits2Num expects little-endian
        for (var i = 0; i < 254; i++) {
            rootBitsToNum[r].in[i] <== merkleRootBits[r][253 - i];
        }
        // Verify truncated bits match the public input
        rootBitsToNum[r].out === merkleRoots[r];
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRAINT 7: Merkle proof verification
    //
    // ┌─────────────────────────────────────────────────────────────────┐
    // │ HASH TYPE: BITCOIN-COMPATIBLE (Type 1) - Internal verification  │
    // │ - Full 256-bit hashes used throughout Merkle computation        │
    // │ - MUST match Bitcoin's Merkle tree structure exactly            │
    // │ - Bitcoin uses: parent = SHA256(SHA256(left || right))          │
    // │ - Final root compared against full 256-bit merkleRootBits       │
    // │                                                                 │
    // │ NOTE: Public merkleRoots inputs are truncated to 254 bits       │
    // │ (for smart contract interface), but internal verification       │
    // │ uses the full 256-bit merkleRootBits for accuracy.              │
    // └─────────────────────────────────────────────────────────────────┘
    //
    // Verifies that txId is included in the Merkle tree with one of the
    // provided roots. The specific root used is hidden (privacy).
    //
    // Bitcoin Merkle tree uses double SHA256:
    //   parent = SHA256(SHA256(left_child || right_child))
    //
    // The contract should verify that ALL merkleRoots correspond to valid
    // Bitcoin block headers via the Bitcoin relay.
    // ═══════════════════════════════════════════════════════════════════

    // Constrain merklePathIndices to be binary
    for (var i = 0; i < 12; i++) {
        merklePathIndices[i] * (merklePathIndices[i] - 1) === 0;
    }

    // Verify Merkle proof using the VerifyMerkleProofHiddenRoot template
    // This proves txId is in the Merkle tree with the selected root
    component merkleVerifier = VerifyMerkleProofHiddenRoot(12, NUM_MERKLE_ROOTS);

    // Wire the leaf (txId)
    for (var i = 0; i < 256; i++) {
        merkleVerifier.leaf[i] <== txId[i];
    }

    // Wire the siblings (merkle proof)
    for (var i = 0; i < 12; i++) {
        for (var j = 0; j < 256; j++) {
            merkleVerifier.siblings[i][j] <== merkleProof[i][j];
        }
    }

    // Wire the path indices
    for (var i = 0; i < 12; i++) {
        merkleVerifier.pathIndices[i] <== merklePathIndices[i];
    }

    // Wire the depth
    merkleVerifier.depth <== merkleDepth;

    // Wire the possible roots (as bit arrays)
    for (var r = 0; r < NUM_MERKLE_ROOTS; r++) {
        for (var i = 0; i < 256; i++) {
            merkleVerifier.possibleRoots[r][i] <== merkleRootBits[r][i];
        }
    }

    // Wire the root index (private selection)
    merkleVerifier.rootIndex <== rootIndex;
}

// Main component instantiation
// - maxTxBytes = 512 (512 bytes max transaction size - covers most standard transactions)
// - Public inputs: merkleRoots[2], nullifier, amount, chainId, recipient, lockerScriptHash
component main {public [merkleRoots, nullifier, amount, chainId, recipient, lockerScriptHash]} = PrivateTransferClaim(512);
