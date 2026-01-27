#!/usr/bin/env node

/**
 * Generate ZK Claim from Bitcoin Transaction
 *
 * This script:
 * 1. Fetches the Bitcoin transaction from mempool.space
 * 2. Parses transaction and extracts relevant data
 * 3. Generates circuit inputs
 * 4. Generates ZK proof
 * 5. Outputs calldata for contract submission
 *
 * Usage:
 *   node scripts/zk/generate-witness.js --txid=<bitcoin_txid>
 *   node scripts/zk/generate-witness.js --deposit=<deposit_file>
 *
 * If you used create-btc-deposit.js, use --deposit flag with the saved file.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Circuit constants - MUST match main.circom parameters
const MAX_TX_BYTES = 512;  // Must match PrivateTransferClaim(512) in main.circom
const MAX_TX_BITS = MAX_TX_BYTES * 8;
const LOCKER_SCRIPT_BITS = 520;
const MERKLE_DEPTH = 12;

// Max padded transaction size: matches circuit calculation
// ((maxTxBits + 64) \ 512 + 1) * 512 = ((4096 + 64) / 512 + 1) * 512 = 4608 bits
const MAX_PADDED_BITS = (Math.floor((MAX_TX_BITS + 64) / 512) + 1) * 512;

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.replace('--', '').split('=');
    acc[key] = value;
    return acc;
}, {});

/**
 * SHA256 hash
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}

/**
 * Double SHA256 hash (Bitcoin style)
 */
function doubleSha256(data) {
    return sha256(sha256(data));
}

/**
 * Apply correct SHA256 padding to a message
 *
 * SHA256 padding: [message][0x80][zeros...][64-bit length]
 * Length field goes at the end of the padded blocks (multiple of 512 bits)
 */
function sha256Pad(message) {
    const messageBits = message.length * 8;

    // Calculate padded size: ceil((messageBits + 65) / 512) * 512
    const paddedBits = Math.ceil((messageBits + 65) / 512) * 512;
    const paddedBytes = paddedBits / 8;

    const padded = Buffer.alloc(paddedBytes);

    // Copy message
    message.copy(padded);

    // Add 0x80 byte after message
    padded[message.length] = 0x80;

    // Zeros fill the middle (Buffer.alloc already fills with zeros)

    // Add 64-bit big-endian length at the END of the padded message
    const bitLength = BigInt(messageBits);
    padded.writeBigUInt64BE(bitLength, paddedBytes - 8);

    return padded;
}

/**
 * Apply SHA256 padding and extend to target size for circuit
 */
function sha256PadForCircuit(message, targetBits) {
    // First, apply correct SHA256 padding
    const correctlyPadded = sha256Pad(message);
    const numBlocks = correctlyPadded.length * 8 / 512;

    // Verify target is large enough
    if (targetBits < correctlyPadded.length * 8) {
        throw new Error(`Target ${targetBits} bits too small for padded message of ${correctlyPadded.length * 8} bits`);
    }
    if (targetBits % 512 !== 0) {
        throw new Error(`Target ${targetBits} bits must be multiple of 512`);
    }

    // Zero-extend to target size for circuit input array
    const targetBytes = targetBits / 8;
    const extended = Buffer.alloc(targetBytes);
    correctlyPadded.copy(extended);

    return { padded: extended, numBlocks };
}

/**
 * Convert hex to bit array (big-endian)
 */
function hexToBitsBE(hexString) {
    const bytes = Buffer.from(hexString, 'hex');
    const bits = [];
    for (let i = 0; i < bytes.length; i++) {
        for (let j = 7; j >= 0; j--) {
            bits.push((bytes[i] >> j) & 1);
        }
    }
    return bits;
}

/**
 * Convert Buffer to bit array (big-endian)
 */
function bufferToBitsBE(buffer) {
    return hexToBitsBE(buffer.toString('hex'));
}

/**
 * Pad bit array to target length
 */
function padBits(bits, targetLength) {
    const padded = [...bits];
    while (padded.length < targetLength) {
        padded.push(0);
    }
    return padded.slice(0, targetLength);
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTANT: TWO TYPES OF HASHES - UNDERSTAND THIS BEFORE MODIFYING
// ═══════════════════════════════════════════════════════════════════════════════
//
// TYPE 1: BITCOIN-COMPATIBLE HASHES (Full 256-bit, NO modulo)
// ───────────────────────────────────────────────────────────────────────────────
// These MUST match Bitcoin exactly. Used for:
//   • TxId = SHA256(SHA256(transaction)) - Bitcoin's transaction identifier
//   • Commitment = SHA256(secret||amount||chainId||recipient) - stored in OP_RETURN
//   • Merkle proof hashes - Bitcoin's Merkle tree structure
//
// These are compared as 256-bit values in the circuit (bit-by-bit).
// DO NOT apply BN254 modulo to these - they must match Bitcoin!
//
// TYPE 2: SYSTEM IDENTIFIERS (254-bit field elements WITH BN254 modulo)
// ───────────────────────────────────────────────────────────────────────────────
// These are OUR constructs for the ZK system, NOT Bitcoin standards. Used for:
//   • Nullifier = SHA256(secret||0x01) % BN254_PRIME - double-spend prevention
//   • LockerScriptHash = SHA256(lockerScript) % BN254_PRIME - locker identification
//   • MerkleRoots (public inputs) - truncated for smart contract interface
//
// These are converted to field elements because:
//   • Public inputs must fit in BN254's scalar field (~254 bits)
//   • The circuit uses Bits2Num(254) which implicitly does modulo
//   • JavaScript must apply the same modulo to match
//
// WHY BN254 MODULO?
// ZK circuits use the BN254 elliptic curve. Its scalar field prime is:
// 21888242871839275222246405745257275088548364400416034343698204186575808495617
// When a 256-bit hash value exceeds this prime, it wraps around (modulo).
// The circuit does this automatically via Bits2Num; JavaScript must match.
//
// ═══════════════════════════════════════════════════════════════════════════════

// BN254 scalar field prime (used by Groth16 proofs on this curve)
const BN254_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

/**
 * Convert bits to BigInt (raw, no modulo)
 *
 * USE FOR: Bitcoin-compatible hashes (Type 1) that need full 256-bit values
 * - TxId computation
 * - Commitment comparison
 * - Merkle proof verification
 */
function bitsToBigInt(bits) {
    let result = BigInt(0);
    for (let i = 0; i < bits.length; i++) {
        result = (result << BigInt(1)) | BigInt(bits[i]);
    }
    return result;
}

/**
 * Convert bits to field element (with BN254 modulo)
 *
 * USE FOR: System identifiers (Type 2) that become public inputs
 * - Nullifier (our construct for double-spend prevention)
 * - LockerScriptHash (our construct for locker identification)
 * - MerkleRoot public inputs (truncated for contract interface)
 *
 * This matches how the circuit's Bits2Num(254) computes field elements.
 * The circuit implicitly applies modulo; we must do the same.
 */
function bitsToFieldElement(bits) {
    const raw = bitsToBigInt(bits);
    return raw % BN254_PRIME;
}

/**
 * Convert BigInt to 256-bit array for merkle root comparison
 * The circuit uses Bits2Num(254) with: in[i] = merkleRootBits[253-i]
 */
function bigIntToMerkleRootBits(value) {
    const bits = [];
    for (let i = 253; i >= 0; i--) {
        bits.push(Number((value >> BigInt(i)) & BigInt(1)));
    }
    bits.push(0);
    bits.push(0);
    return bits;
}

/**
 * Fetch transaction from mempool.space API
 */
async function fetchTransaction(txid) {
    const fetch = (await import('node-fetch')).default;

    console.log(`\nFetching transaction ${txid}...`);

    // Fetch transaction details
    const txUrl = `https://mempool.space/api/tx/${txid}`;
    const txResponse = await fetch(txUrl);
    if (!txResponse.ok) {
        throw new Error(`Failed to fetch transaction: ${txResponse.status}`);
    }
    const txData = await txResponse.json();

    // Fetch raw transaction hex
    const hexUrl = `https://mempool.space/api/tx/${txid}/hex`;
    const hexResponse = await fetch(hexUrl);
    if (!hexResponse.ok) {
        throw new Error(`Failed to fetch transaction hex: ${hexResponse.status}`);
    }
    const txHex = await hexResponse.text();

    return { txData, txHex };
}

/**
 * Fetch REAL merkle proof from mempool.space API
 * Returns the merkle proof siblings and the block's merkle root
 */
async function fetchMerkleProof(txid) {
    const fetch = (await import('node-fetch')).default;

    console.log(`\nFetching merkle proof for ${txid}...`);

    // Fetch merkle proof
    const proofUrl = `https://mempool.space/api/tx/${txid}/merkle-proof`;
    const proofResponse = await fetch(proofUrl);
    if (!proofResponse.ok) {
        throw new Error(`Failed to fetch merkle proof: ${proofResponse.status}`);
    }
    const proofData = await proofResponse.json();

    // proofData contains: { block_height, merkle, pos }
    // merkle is array of sibling hashes (hex strings, already in correct order)
    // pos is the position/index of the transaction in the block

    // Fetch block to get merkle root
    const txUrl = `https://mempool.space/api/tx/${txid}`;
    const txResponse = await fetch(txUrl);
    const txData = await txResponse.json();
    const blockHash = txData.status.block_hash;

    const blockUrl = `https://mempool.space/api/block/${blockHash}`;
    const blockResponse = await fetch(blockUrl);
    if (!blockResponse.ok) {
        throw new Error(`Failed to fetch block: ${blockResponse.status}`);
    }
    const blockData = await blockResponse.json();

    console.log(`  Block height: ${proofData.block_height}`);
    console.log(`  TX position in block: ${proofData.pos}`);
    console.log(`  Merkle proof depth: ${proofData.merkle.length}`);
    console.log(`  Block merkle root: ${blockData.merkle_root}`);

    return {
        siblings: proofData.merkle,  // Array of hex strings
        txIndex: proofData.pos,      // Position of TX in block
        merkleRoot: blockData.merkle_root,  // Block's merkle root (hex)
        blockHeight: proofData.block_height
    };
}

/**
 * Strip witness data from a SegWit transaction
 * Returns the stripped transaction: [version][inputs][outputs][locktime]
 * This is what's used for txid calculation
 */
function stripWitnessData(rawTx) {
    let offset = 0;

    // Version (4 bytes)
    const version = rawTx.slice(0, 4);
    offset += 4;

    // Check for witness marker (0x00 0x01)
    let hasWitness = false;
    if (rawTx[offset] === 0x00 && rawTx[offset + 1] === 0x01) {
        hasWitness = true;
        offset += 2;  // Skip marker and flag
    }

    // If no witness, return as-is
    if (!hasWitness) {
        return rawTx;
    }

    // Parse inputs
    const inputCountStart = offset;
    const { value: inputCount, size: inputCountSize } = readVarInt(rawTx, offset);
    offset += inputCountSize;

    // Skip input data (we'll copy it all at once later)
    const inputsStart = inputCountStart;
    for (let i = 0; i < inputCount; i++) {
        offset += 32;  // Previous txid
        offset += 4;   // Previous vout
        const { value: scriptLen, size: scriptLenSize } = readVarInt(rawTx, offset);
        offset += scriptLenSize;
        offset += scriptLen;  // Script
        offset += 4;   // Sequence
    }
    const inputsEnd = offset;

    // Parse outputs
    const outputsStart = offset;
    const { value: outputCount, size: outputCountSize } = readVarInt(rawTx, offset);
    offset += outputCountSize;

    for (let i = 0; i < outputCount; i++) {
        offset += 8;  // Value (8 bytes)
        const { value: scriptLen, size: scriptLenSize } = readVarInt(rawTx, offset);
        offset += scriptLenSize;
        offset += scriptLen;  // Script
    }
    const outputsEnd = offset;

    // Skip witness data (one stack per input)
    for (let i = 0; i < inputCount; i++) {
        const { value: stackItems, size: stackItemsSize } = readVarInt(rawTx, offset);
        offset += stackItemsSize;
        for (let j = 0; j < stackItems; j++) {
            const { value: itemLen, size: itemLenSize } = readVarInt(rawTx, offset);
            offset += itemLenSize;
            offset += itemLen;
        }
    }

    // Locktime (last 4 bytes)
    const locktime = rawTx.slice(rawTx.length - 4);

    // Build stripped transaction: version + inputs + outputs + locktime
    const strippedTx = Buffer.concat([
        version,
        rawTx.slice(inputsStart, outputsEnd),
        locktime
    ]);

    return strippedTx;
}

/**
 * Parse Bitcoin transaction to find locker output and commitment
 * Returns stripped transaction (without witness data) for circuit
 */
function parseTransaction(txHex, txData, lockerAddress) {
    console.log('\nParsing transaction...');

    const rawTx = Buffer.from(txHex, 'hex');
    console.log(`  Raw TX size: ${rawTx.length} bytes`);

    // Strip witness data for txid calculation and circuit input
    const strippedTx = stripWitnessData(rawTx);
    const hasWitness = strippedTx.length !== rawTx.length;

    if (hasWitness) {
        console.log(`  SegWit TX detected - stripped to ${strippedTx.length} bytes`);
    }

    // Find locker output
    let lockerOutputIndex = -1;
    let lockerOutput = null;

    for (let i = 0; i < txData.vout.length; i++) {
        const vout = txData.vout[i];
        if (vout.scriptpubkey_address === lockerAddress) {
            lockerOutputIndex = i;
            lockerOutput = vout;
            console.log(`  Found locker output at index ${i}`);
            console.log(`    Value: ${vout.value} satoshis`);
            break;
        }
    }

    if (lockerOutputIndex === -1) {
        throw new Error(`Locker output not found for address: ${lockerAddress}`);
    }

    // Find OP_RETURN output with commitment
    let commitmentHex = null;
    let opReturnOutputIndex = -1;

    for (let i = 0; i < txData.vout.length; i++) {
        const vout = txData.vout[i];
        if (vout.scriptpubkey_type === 'op_return') {
            // OP_RETURN script: 6a 20 <32-byte-commitment>
            const script = vout.scriptpubkey;
            if (script.startsWith('6a20') && script.length === 68) {
                commitmentHex = script.substring(4);  // Remove 6a20 prefix
                opReturnOutputIndex = i;
                console.log(`  Found commitment at output ${i}: ${commitmentHex}`);
            }
        }
    }

    if (!commitmentHex) {
        throw new Error('Commitment not found in OP_RETURN output');
    }

    // Calculate locker output offset in the STRIPPED transaction
    // This is critical - offsets must be for the stripped TX that goes to circuit
    let offset = 0;

    // Version (4 bytes)
    offset += 4;

    // Input count (varint) - no witness marker in stripped TX
    const { value: inputCount, size: inputCountSize } = readVarInt(strippedTx, offset);
    offset += inputCountSize;

    // Skip inputs
    for (let i = 0; i < inputCount; i++) {
        offset += 32;  // Previous txid
        offset += 4;   // Previous vout
        const { value: scriptLen, size: scriptLenSize } = readVarInt(strippedTx, offset);
        offset += scriptLenSize;
        offset += scriptLen;  // Script
        offset += 4;   // Sequence
    }

    // Output count (varint)
    const { value: outputCount, size: outputCountSize } = readVarInt(strippedTx, offset);
    offset += outputCountSize;

    // Find locker output offset and commitment offset (in BYTES, not bits)
    let lockerOutputByteOffset = 0;
    let commitmentByteOffset = 0;

    for (let i = 0; i < outputCount; i++) {
        if (i === lockerOutputIndex) {
            lockerOutputByteOffset = offset;  // Keep as bytes
            console.log(`  Locker output byte offset: ${offset} bytes`);
        }

        if (i === opReturnOutputIndex) {
            // Commitment starts after: value(8) + scriptLen(1) + OP_RETURN(1) + PUSH_32(1) = +11 bytes
            commitmentByteOffset = offset + 8 + 1 + 2;  // value + scriptLen varint + 6a20
            console.log(`  Commitment byte offset: ${commitmentByteOffset} bytes`);
        }

        offset += 8;  // Value (8 bytes)
        const { value: scriptLen, size: scriptLenSize } = readVarInt(strippedTx, offset);
        offset += scriptLenSize;
        offset += scriptLen;  // Script
    }

    // Verify txid matches by computing it from stripped TX
    const computedTxId = doubleSha256(strippedTx);
    const computedTxIdHex = Buffer.from(computedTxId).reverse().toString('hex');
    console.log(`  Computed TxId: ${computedTxIdHex}`);

    return {
        lockerOutputIndex,
        lockerOutputByteOffset,  // Now in bytes, not bits
        commitmentByteOffset,    // Byte offset where 32-byte commitment starts
        amount: lockerOutput.value,
        commitment: Buffer.from(commitmentHex, 'hex'),
        strippedTx,  // Use stripped TX for circuit
        rawTx,       // Keep raw for reference
    };
}

/**
 * Read variable-length integer from buffer
 */
function readVarInt(buffer, offset) {
    const first = buffer[offset];
    if (first < 0xfd) {
        return { value: first, size: 1 };
    } else if (first === 0xfd) {
        return { value: buffer.readUInt16LE(offset + 1), size: 3 };
    } else if (first === 0xfe) {
        return { value: buffer.readUInt32LE(offset + 1), size: 5 };
    } else {
        return { value: Number(buffer.readBigUInt64LE(offset + 1)), size: 9 };
    }
}

/**
 * Generate circuit inputs
 * @param {Object} depositData - Deposit data from create-btc-deposit
 * @param {Object} txParseResult - Parsed transaction data
 * @param {number} chainId - Target EVM chain ID
 * @param {string} recipient - EVM recipient address
 * @param {Object} merkleProofData - Real merkle proof from Bitcoin block
 */
function generateCircuitInputs(depositData, txParseResult, chainId, recipient, merkleProofData) {
    console.log('\nGenerating circuit inputs...');

    const secret = Buffer.from(depositData.secret, 'hex');
    const secretBits = bufferToBitsBE(secret);

    // Locker script
    const lockerScript = Buffer.from(depositData.lockerScript, 'hex');
    const lockerScriptBits = padBits(bufferToBitsBE(lockerScript), LOCKER_SCRIPT_BITS);

    // ═══════════════════════════════════════════════════════════════════
    // LOCKER SCRIPT HASH - TYPE 2: System Identifier (needs BN254 modulo)
    // ═══════════════════════════════════════════════════════════════════
    // This is NOT a Bitcoin hash - it's our construct for locker identification.
    // The circuit uses Bits2Num(254) which applies modulo automatically.
    // We must apply the same modulo here to match.
    //
    // WHY HASH INSTEAD OF SCRIPT DIRECTLY?
    // - Scripts have variable length (22-25 bytes)
    // - Public inputs must be single field elements
    // - Hashing gives fixed-size identifier for any script type
    const lockerScriptPadded = Buffer.alloc(65);
    lockerScript.copy(lockerScriptPadded);
    const lockerHashBytes = sha256(lockerScriptPadded);
    const lockerHashBits = bufferToBitsBE(lockerHashBytes);
    const lockerScriptHash = bitsToFieldElement(lockerHashBits.slice(0, 254));  // BN254 modulo applied

    // ═══════════════════════════════════════════════════════════════════
    // NULLIFIER - TYPE 2: System Identifier (needs BN254 modulo)
    // ═══════════════════════════════════════════════════════════════════
    // This is NOT a Bitcoin hash - it's our construct for double-spend prevention.
    // The circuit uses Bits2Num(254) which applies modulo automatically.
    // We must apply the same modulo here to match.
    const nullifierInput = Buffer.concat([secret, Buffer.from([0x01])]);
    const nullifierHash = sha256(nullifierInput);
    const nullifierBits = bufferToBitsBE(nullifierHash);
    const nullifier = bitsToFieldElement(nullifierBits.slice(0, 254));  // BN254 modulo applied

    // Use STRIPPED transaction (without witness data) for circuit
    const strippedTx = txParseResult.strippedTx;

    // Verify transaction fits in circuit
    if (strippedTx.length > MAX_TX_BYTES) {
        throw new Error(`Transaction too large: ${strippedTx.length} bytes > ${MAX_TX_BYTES} max`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // SINGLE TRANSACTION INPUT (paddedTransaction)
    //
    // SECURITY FIX: We use ONLY paddedTransaction for all operations.
    // The circuit extracts commitment from paddedTransaction at commitmentByteOffset.
    // This ensures the commitment is actually in the transaction.
    // ═══════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════
    // TXID - TYPE 1: Bitcoin-Compatible Hash (NO BN254 modulo)
    // ═══════════════════════════════════════════════════════════════════
    // This MUST match Bitcoin's transaction ID exactly.
    // txId = SHA256(SHA256(raw_transaction))
    // The circuit compares this as full 256 bits - NO field modulo.
    // This is used for Merkle proof verification (must match block data).
    const txIdBytes = doubleSha256(strippedTx);
    const txIdBits = bufferToBitsBE(txIdBytes);  // Full 256 bits, no modulo

    // Apply SHA256 padding for circuit
    const { padded: paddedTx, numBlocks } = sha256PadForCircuit(strippedTx, MAX_PADDED_BITS);
    const paddedTxBits = bufferToBitsBE(paddedTx);

    // Display txId in Bitcoin's reversed format for verification
    const txIdDisplay = Buffer.from(txIdBytes).reverse().toString('hex');
    console.log(`  TxId (for verification): ${txIdDisplay}`);
    console.log(`  Stripped TX: ${strippedTx.length} bytes -> ${numBlocks} SHA256 blocks`);

    // ═══════════════════════════════════════════════════════════════════
    // REAL MERKLE PROOF FROM BITCOIN BLOCK
    // ═══════════════════════════════════════════════════════════════════
    // The Merkle root has two representations:
    //
    // 1. merkleRootBits (private input) - TYPE 1: Full 256 bits
    //    Used for internal Merkle proof verification
    //    Must match Bitcoin's Merkle tree exactly
    //
    // 2. merkleRoots (public input) - TYPE 2: Field element with BN254 modulo
    //    Used for smart contract interface
    //    Truncated to 254 bits and converted to field element
    //
    // Now using REAL merkle proof from Bitcoin block!
    // ═══════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════
    // BITCOIN BYTE ORDER CONVENTION:
    // - API/Display format: reversed bytes (little-endian hex display)
    // - Internal format: big-endian bytes (used for hashing)
    //
    // mempool.space API returns hashes in DISPLAY format (reversed).
    // We need to reverse them back to INTERNAL format for the circuit.
    // ═══════════════════════════════════════════════════════════════════

    // Get real merkle root from block - REVERSE bytes from display to internal format
    const merkleRootDisplayBytes = Buffer.from(merkleProofData.merkleRoot, 'hex');
    const merkleRootInternalBytes = Buffer.from(merkleRootDisplayBytes).reverse();
    const merkleRootBitsComputed = bufferToBitsBE(merkleRootInternalBytes);  // Full 256 bits

    // Merkle depth from actual proof
    const merkleDepth = merkleProofData.siblings.length;
    console.log(`  Using REAL merkle proof: depth=${merkleDepth}, txIndex=${merkleProofData.txIndex}`);
    console.log(`  Merkle root (display/Bitcoin format): ${merkleProofData.merkleRoot}`);
    console.log(`  Merkle root (internal): ${merkleRootInternalBytes.toString('hex')}`);

    // ═══════════════════════════════════════════════════════════════════
    // BITCOIN MERKLE ROOTS (for claimPrivateWithBitcoinRoots)
    // These are in Bitcoin display format (bytes reversed) - what block explorers show
    // The contract will convert these to circuit format internally
    // ═══════════════════════════════════════════════════════════════════
    const bitcoinMerkleRoot0 = '0x' + merkleProofData.merkleRoot;  // Already in display format

    // Public input (Type 2): Apply BN254 modulo for smart contract interface
    // Contract does: (reverse(displayRoot) >> 2) % BN254_PRIME
    const merkleRoot0Value = bitsToFieldElement(merkleRootBitsComputed.slice(0, 254));
    // For hidden root selection, we use a second dummy root (root + 1)
    const merkleRoot1Value = merkleRoot0Value + BigInt(1);

    // For bitcoinMerkleRoot1: we need contract conversion to produce merkleRoot1Value
    // Contract does: (internalRoot >> 2) % BN254_PRIME = circuitRoot
    // So: internalRoot1 = internalRoot0 + 4 (because >>2 means /4)
    // Then: displayRoot1 = reverse(internalRoot1)
    const internalRoot0BigInt = BigInt('0x' + merkleRootInternalBytes.toString('hex'));
    const internalRoot1BigInt = internalRoot0BigInt + BigInt(4);
    const internalRoot1Hex = internalRoot1BigInt.toString(16).padStart(64, '0');
    const internalRoot1Bytes = Buffer.from(internalRoot1Hex, 'hex');
    const displayRoot1Bytes = Buffer.from(internalRoot1Bytes).reverse();
    const bitcoinMerkleRoot1 = '0x' + displayRoot1Bytes.toString('hex');

    // merkleRootBits for circuit (Type 1: full 256 bits for Merkle verification)
    const merkleRootBits = [
        merkleRootBitsComputed,
        bigIntToMerkleRootBits(merkleRoot1Value)
    ];

    // Convert real merkle proof siblings to bit arrays
    // Siblings are in order from leaf to root
    // REVERSE each sibling from display to internal format
    const merkleProof = [];
    for (let i = 0; i < merkleProofData.siblings.length; i++) {
        const siblingHex = merkleProofData.siblings[i];
        const siblingDisplayBytes = Buffer.from(siblingHex, 'hex');
        const siblingInternalBytes = Buffer.from(siblingDisplayBytes).reverse();  // REVERSE!
        merkleProof.push(bufferToBitsBE(siblingInternalBytes));
    }
    // Pad remaining levels with zeros (circuit expects 12 levels)
    for (let i = merkleProofData.siblings.length; i < MERKLE_DEPTH; i++) {
        merkleProof.push(padBits([], 256));
    }

    // Convert transaction index to path indices (binary representation)
    // Bit i of txIndex indicates if node is left (0) or right (1) child at level i
    const merklePathIndices = [];
    let txIndex = merkleProofData.txIndex;
    for (let i = 0; i < MERKLE_DEPTH; i++) {
        if (i < merkleDepth) {
            merklePathIndices.push(txIndex & 1);  // LSB indicates left/right
            txIndex = txIndex >> 1;
        } else {
            merklePathIndices.push(0);  // Unused levels
        }
    }
    console.log(`  Path indices: [${merklePathIndices.slice(0, merkleDepth).join(', ')}]`);

    // Recipient as BigInt
    const recipientBigInt = BigInt(recipient);

    const circuitInput = {
        // PUBLIC INPUTS (7 total: merkleRoots[2] counts as 2)
        merkleRoots: [merkleRoot0Value.toString(), merkleRoot1Value.toString()],
        nullifier: nullifier.toString(),
        amount: txParseResult.amount.toString(),
        chainId: chainId.toString(),
        recipient: recipientBigInt.toString(),
        lockerScriptHash: lockerScriptHash.toString(),

        // PRIVATE INPUTS
        secret: secretBits,
        lockerScript: lockerScriptBits,
        lockerScriptLength: lockerScript.length,
        lockerOutputIndex: txParseResult.lockerOutputIndex,
        lockerOutputByteOffset: txParseResult.lockerOutputByteOffset,
        commitmentByteOffset: txParseResult.commitmentByteOffset,
        rootIndex: 0,
        merkleProof: merkleProof,
        merklePathIndices: merklePathIndices,
        merkleDepth: merkleDepth,
        merkleRootBits: merkleRootBits,

        // SINGLE TRANSACTION INPUT (used for everything)
        paddedTransaction: paddedTxBits,
        numBlocks: numBlocks,
        txId: txIdBits,
    };

    console.log('  Public inputs prepared:');
    console.log(`    merkleRoots: [${merkleRoot0Value.toString().substring(0, 20)}..., ${merkleRoot1Value.toString().substring(0, 20)}...]`);
    console.log(`    nullifier: ${nullifier.toString().substring(0, 30)}...`);
    console.log(`    amount: ${txParseResult.amount} satoshis`);
    console.log(`    chainId: ${chainId}`);
    console.log(`    recipient: ${recipient}`);
    console.log(`    lockerScriptHash: ${lockerScriptHash.toString().substring(0, 30)}...`);
    console.log('  Private inputs:');
    console.log(`    lockerOutputByteOffset: ${txParseResult.lockerOutputByteOffset} bytes`);
    console.log(`    commitmentByteOffset: ${txParseResult.commitmentByteOffset} bytes`);
    console.log(`    merkleDepth: ${merkleDepth}`);

    // Return both circuit input and Bitcoin merkle roots (for contract call)
    const bitcoinMerkleRoots = [bitcoinMerkleRoot0, bitcoinMerkleRoot1];
    return { circuitInput, bitcoinMerkleRoots };
}

/**
 * Generate ZK proof
 */
async function generateProof(circuitInput, buildDir) {
    console.log('\nGenerating ZK proof...');

    // Save input
    const inputPath = path.join(buildDir, 'input_claim.json');
    fs.writeFileSync(inputPath, JSON.stringify(circuitInput, null, 2));

    // Generate witness
    console.log('  Calculating witness...');
    const wasmPath = path.join(buildDir, 'main_js', 'main.wasm');
    const witnessPath = path.join(buildDir, 'witness_claim.wtns');

    execSync(
        `cd ${buildDir}/main_js && node generate_witness.js main.wasm ../input_claim.json ../witness_claim.wtns`,
        { stdio: 'pipe' }
    );
    console.log('  ✓ Witness calculated');

    // Generate proof
    console.log('  Generating Groth16 proof...');
    const zkeyPath = path.join(buildDir, 'circuit_final.zkey');
    const proofPath = path.join(buildDir, 'proof_claim.json');
    const publicPath = path.join(buildDir, 'public_claim.json');

    const startTime = Date.now();
    execSync(
        `npx snarkjs groth16 prove ${zkeyPath} ${witnessPath} ${proofPath} ${publicPath}`,
        { stdio: 'pipe' }
    );
    const proofTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`  ✓ Proof generated (${proofTime}s)`);

    // Verify proof
    console.log('  Verifying proof...');
    const vkeyPath = path.join(buildDir, 'verification_key.json');
    const verifyOutput = execSync(
        `npx snarkjs groth16 verify ${vkeyPath} ${publicPath} ${proofPath}`,
        { encoding: 'utf8' }
    );

    if (!verifyOutput.includes('OK')) {
        throw new Error('Proof verification failed!');
    }
    console.log('  ✓ Proof verified');

    // Export calldata
    console.log('  Exporting Solidity calldata...');
    const calldata = execSync(
        `npx snarkjs zkey export soliditycalldata ${publicPath} ${proofPath}`,
        { encoding: 'utf8' }
    ).trim();

    return { proofPath, publicPath, calldata };
}

/**
 * Main function
 */
async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║        Generate ZK Claim from Bitcoin Transaction          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    const projectRoot = path.join(__dirname, '../..');
    const buildDir = path.join(projectRoot, 'zkproof/build');

    // ═══════════════════════════════════════════════════════════════════
    // Load deposit data
    // ═══════════════════════════════════════════════════════════════════
    let depositData;

    if (args.deposit) {
        // Load from deposit file
        const depositPath = args.deposit.startsWith('/')
            ? args.deposit
            : path.join(projectRoot, 'zkproof/deposits', args.deposit);

        if (!fs.existsSync(depositPath)) {
            console.error(`\n❌ Deposit file not found: ${depositPath}`);
            process.exit(1);
        }

        depositData = JSON.parse(fs.readFileSync(depositPath, 'utf8'));
        console.log(`\nLoaded deposit from: ${depositPath}`);
    } else if (args.txid && args.secret) {
        // Manual mode: txid + secret provided
        depositData = {
            txid: args.txid,
            secret: args.secret,
            lockerScript: args.lockerScript,
            chainId: parseInt(args.chainId || '137'),
            recipient: args.recipient,
        };

        if (!depositData.lockerScript || !depositData.recipient) {
            console.error('\n❌ When using --txid and --secret, you must also provide:');
            console.error('   --lockerScript=<hex>');
            console.error('   --recipient=<address>');
            console.error('   --chainId=<number> (optional, default 137)');
            process.exit(1);
        }
    } else {
        console.error('\n❌ Usage:');
        console.error('   node generate-witness.js --deposit=<txid>.json');
        console.error('   node generate-witness.js --txid=<txid> --secret=<hex> --lockerScript=<hex> --recipient=<addr>');
        process.exit(1);
    }

    console.log(`\nDeposit Data:`);
    console.log(`  TxId: ${depositData.txid}`);
    console.log(`  Amount: ${depositData.amount || 'will fetch'} satoshis`);
    console.log(`  Chain ID: ${depositData.chainId}`);
    console.log(`  Recipient: ${depositData.recipient}`);

    // ═══════════════════════════════════════════════════════════════════
    // Fetch and parse Bitcoin transaction
    // ═══════════════════════════════════════════════════════════════════
    const { txData, txHex } = await fetchTransaction(depositData.txid);

    // Determine locker address from script
    let lockerAddress = depositData.lockerAddress;
    if (!lockerAddress && depositData.lockerScript) {
        // Convert script to address (for P2PKH)
        const bitcoin = require('bitcoinjs-lib');
        const script = Buffer.from(depositData.lockerScript, 'hex');
        const decoded = bitcoin.address.fromOutputScript(script, bitcoin.networks.bitcoin);
        lockerAddress = decoded;
    }

    const txParseResult = parseTransaction(txHex, txData, lockerAddress);

    // ═══════════════════════════════════════════════════════════════════
    // Fetch REAL merkle proof from Bitcoin block
    // ═══════════════════════════════════════════════════════════════════
    const merkleProofData = await fetchMerkleProof(depositData.txid);

    // ═══════════════════════════════════════════════════════════════════
    // Generate circuit inputs
    // ═══════════════════════════════════════════════════════════════════
    const { circuitInput, bitcoinMerkleRoots } = generateCircuitInputs(
        depositData,
        txParseResult,
        depositData.chainId,
        depositData.recipient,
        merkleProofData  // Pass real merkle proof
    );

    // ═══════════════════════════════════════════════════════════════════
    // Generate ZK proof
    // ═══════════════════════════════════════════════════════════════════
    const { proofPath, publicPath, calldata } = await generateProof(circuitInput, buildDir);

    // ═══════════════════════════════════════════════════════════════════
    // Save claim data
    // ═══════════════════════════════════════════════════════════════════
    const claimData = {
        txid: depositData.txid,
        amount: txParseResult.amount,
        chainId: depositData.chainId,
        recipient: depositData.recipient,
        nullifier: circuitInput.nullifier,
        lockerScriptHash: circuitInput.lockerScriptHash,
        merkleRoots: circuitInput.merkleRoots,  // Array for hidden root selection (circuit format)
        bitcoinMerkleRoots: bitcoinMerkleRoots,  // Array in Bitcoin display format (bytes32)
        calldata: calldata,
        proofPath: proofPath,
        publicPath: publicPath,
        generatedAt: new Date().toISOString(),
    };

    const claimsDir = path.join(projectRoot, 'zkproof/claims');
    if (!fs.existsSync(claimsDir)) {
        fs.mkdirSync(claimsDir, { recursive: true });
    }

    const claimFile = path.join(claimsDir, `${depositData.txid}.json`);
    fs.writeFileSync(claimFile, JSON.stringify(claimData, null, 2));

    // ═══════════════════════════════════════════════════════════════════
    // Output summary
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              CLAIM PROOF GENERATED SUCCESSFULLY            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    console.log('\nClaim Data:');
    console.log(`  Amount:           ${txParseResult.amount} satoshis`);
    console.log(`  Nullifier:        ${circuitInput.nullifier.substring(0, 30)}...`);
    console.log(`  Locker Hash:      ${circuitInput.lockerScriptHash.substring(0, 30)}...`);
    console.log(`  Recipient:        ${depositData.recipient}`);

    console.log('\nGenerated Files:');
    console.log(`  Proof:    ${proofPath}`);
    console.log(`  Public:   ${publicPath}`);
    console.log(`  Claim:    ${claimFile}`);

    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Solidity Calldata:');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(calldata);

    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Next Step:');
    console.log('─────────────────────────────────────────────────────────────');
    console.log('Submit claim on Polygon:');
    console.log(`  npm run zk:submit-proof -- --claim=${depositData.txid}.json --network polygon`);
}

main().catch(error => {
    console.error('\n❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
});
