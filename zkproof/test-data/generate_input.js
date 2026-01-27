#!/usr/bin/env node

/**
 * Generate Circuit Input for Private Transfer
 *
 * This script generates test input data for the Private Transfer ZK circuit.
 * It creates a sample Bitcoin transaction with a commitment in OP_RETURN.
 *
 * See: PRIVATE_TRANSFER.md and PRIVATE_TRANSFER_PLAN.md
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Circuit constants - MUST match main.circom parameters
const MAX_TX_BYTES = 512;  // Must match PrivateTransferClaim(512) in main.circom
const MAX_TX_BITS = MAX_TX_BYTES * 8;
const LOCKER_SCRIPT_BITS = 520;  // 65 bytes max
const MERKLE_DEPTH = 12;

// Max padded transaction size: matches circuit calculation
// ((maxTxBits + 64) \ 512 + 1) * 512 = ((4096 + 64) / 512 + 1) * 512 = 4608 bits
const MAX_PADDED_BITS = (Math.floor((MAX_TX_BITS + 64) / 512) + 1) * 512;

// Default locker address (P2PKH) - use environment variable or this default
// This should match the locker registered on the contract
const DEFAULT_LOCKER_ADDRESS = process.env.BTC_LOCKER_ADDRESS || '1NtQASBBziad6x5dST3jgoFqWv1eMAAnWY';

// Try to load bitcoinjs-lib for real address decoding
let bitcoin;
try {
    bitcoin = require('bitcoinjs-lib');
} catch (e) {
    bitcoin = null;
}

/**
 * SHA256 hash
 * @param {Buffer} data - Input data
 * @returns {Buffer} Hash result
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}

/**
 * Double SHA256 hash (Bitcoin style)
 * @param {Buffer} data - Input data
 * @returns {Buffer} Hash result
 */
function doubleSha256(data) {
    return sha256(sha256(data));
}

/**
 * Convert hex string to bit array (big-endian, MSB first)
 * This matches how SHA256 expects input in circom
 * @param {string} hexString - Hex string (without 0x prefix)
 * @returns {number[]} Array of bits
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
 * @param {Buffer} buffer - Input buffer
 * @returns {number[]} Array of bits
 */
function bufferToBitsBE(buffer) {
    return hexToBitsBE(buffer.toString('hex'));
}

/**
 * Pad bit array to target length
 * @param {number[]} bits - Input bits
 * @param {number} targetLength - Target length
 * @returns {number[]} Padded bits
 */
function padBits(bits, targetLength) {
    const padded = [...bits];
    while (padded.length < targetLength) {
        padded.push(0);
    }
    return padded.slice(0, targetLength);
}

/**
 * Convert bits to BigInt (big-endian)
 * @param {number[]} bits - Array of bits (MSB first)
 * @returns {BigInt} Result
 */
function bitsToBigInt(bits) {
    let result = BigInt(0);
    for (let i = 0; i < bits.length; i++) {
        result = (result << BigInt(1)) | BigInt(bits[i]);
    }
    return result;
}

/**
 * Convert BigInt to 256-bit array for merkle root comparison
 *
 * The circuit uses Bits2Num(254) with: in[i] = merkleRootBits[253-i]
 * This means only bits[0..253] are used, and:
 * - bits[253] = LSB of the field element
 * - bits[0] = MSB (bit 253) of the field element
 *
 * @param {BigInt} value - Input value (max 254 bits)
 * @returns {number[]} Array of 256 bits
 */
function bigIntToMerkleRootBits(value) {
    const bits = [];
    // Generate 254 bits in big-endian order (MSB first)
    for (let i = 253; i >= 0; i--) {
        bits.push(Number((value >> BigInt(i)) & BigInt(1)));
    }
    // Pad with 2 zeros (bits 254 and 255 are unused by circuit)
    bits.push(0);
    bits.push(0);
    return bits;  // 256 bits total
}

/**
 * Apply correct SHA256 padding to a message
 *
 * SHA256 padding: [message][0x80][zeros...][64-bit length]
 * Length field goes at the end of the padded blocks (multiple of 512 bits)
 *
 * @param {Buffer} message - Original message
 * @returns {Buffer} Correctly padded message
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
 *
 * @param {Buffer} message - Original message
 * @param {number} targetBits - Target size in bits (must be multiple of 512)
 * @returns {{padded: Buffer, numBlocks: number}} Padded buffer and actual block count
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
 * Generate test input for the Private Transfer circuit
 *
 * Creates:
 * - A random secret
 * - Commitment = SHA256(secret || amount || chainId)
 * - Nullifier = SHA256(secret || 0x01)
 * - A mock Bitcoin transaction with the commitment in OP_RETURN
 * - A mock locker script
 */
function generateTestInput() {
    console.log('\n🔧 Private Transfer Circuit Input Generator');
    console.log('=============================================\n');

    // ═══════════════════════════════════════════════════════════
    // Step 1: Generate random secret
    // ═══════════════════════════════════════════════════════════
    const secretBytes = crypto.randomBytes(32);
    const secretBits = bufferToBitsBE(secretBytes);
    console.log(`✓ Generated secret: ${secretBytes.toString('hex').substring(0, 16)}...`);

    // ═══════════════════════════════════════════════════════════
    // Step 2: Define amount, chainId, and recipient
    // NOTE: Recipient is defined here because it's part of commitment
    // ═══════════════════════════════════════════════════════════
    const amountSatoshis = BigInt(10000000);  // 0.1 BTC = 10,000,000 satoshis
    const chainId = BigInt(1);  // Ethereum mainnet
    const recipientBytes = crypto.randomBytes(20);
    const recipientAddress = '0x' + recipientBytes.toString('hex');
    const recipient = BigInt(recipientAddress);

    console.log(`✓ Amount: ${amountSatoshis} satoshis (${Number(amountSatoshis) / 100000000} BTC)`);
    console.log(`✓ Chain ID: ${chainId}`);
    console.log(`✓ Recipient: ${recipientAddress}`);

    // ═══════════════════════════════════════════════════════════
    // Step 3: Compute commitment = SHA256(secret || amount || chainId || recipient)
    // Total: 32 + 8 + 2 + 20 = 62 bytes (496 bits)
    // This matches the circuit's commitment calculation
    // ═══════════════════════════════════════════════════════════
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64BE(amountSatoshis);

    const chainIdBuffer = Buffer.alloc(2);
    chainIdBuffer.writeUInt16BE(Number(chainId));

    const commitmentInput = Buffer.concat([secretBytes, amountBuffer, chainIdBuffer, recipientBytes]);
    const commitment = sha256(commitmentInput);
    console.log(`✓ Commitment: ${commitment.toString('hex')}`);

    // ═══════════════════════════════════════════════════════════
    // Step 4: Compute nullifier = SHA256(secret || 0x01)
    // ═══════════════════════════════════════════════════════════
    const nullifierInput = Buffer.concat([secretBytes, Buffer.from([0x01])]);
    const nullifierHash = sha256(nullifierInput);
    const nullifierBits = bufferToBitsBE(nullifierHash);
    // Take first 254 bits for field element (BN254 field size)
    const nullifierValue = bitsToBigInt(nullifierBits.slice(0, 254));
    console.log(`✓ Nullifier: ${nullifierHash.toString('hex').substring(0, 32)}...`);

    // ═══════════════════════════════════════════════════════════
    // Step 5: Create locker script from registered address (P2PKH)
    // ═══════════════════════════════════════════════════════════
    // Uses the registered locker address to ensure hash matches contract
    let lockerScriptBytes;

    if (bitcoin) {
        // Use real address conversion via bitcoinjs-lib
        try {
            lockerScriptBytes = bitcoin.address.toOutputScript(DEFAULT_LOCKER_ADDRESS, bitcoin.networks.bitcoin);
            console.log(`✓ Using registered locker address: ${DEFAULT_LOCKER_ADDRESS}`);
        } catch (e) {
            console.log(`⚠ Failed to decode address, using hardcoded script: ${e.message}`);
            // Fallback: hardcoded script for 1NtQASBBziad6x5dST3jgoFqWv1eMAAnWY
            lockerScriptBytes = Buffer.from('76a914f01330d32d8f0df50b52966d735832ad0ab0df1c88ac', 'hex');
        }
    } else {
        // Fallback: hardcoded script for 1NtQASBBziad6x5dST3jgoFqWv1eMAAnWY
        // This is OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
        console.log(`⚠ bitcoinjs-lib not available, using hardcoded script for ${DEFAULT_LOCKER_ADDRESS}`);
        lockerScriptBytes = Buffer.from('76a914f01330d32d8f0df50b52966d735832ad0ab0df1c88ac', 'hex');
    }
    const lockerScriptBits = padBits(bufferToBitsBE(lockerScriptBytes), LOCKER_SCRIPT_BITS);
    const lockerScriptLength = lockerScriptBytes.length;

    // Compute locker script hash
    // IMPORTANT: Circuit hashes 520 bits (65 bytes) with zero-padding
    // We must hash the PADDED version to match the circuit
    const lockerScriptPadded = Buffer.alloc(65);  // 520 bits = 65 bytes
    lockerScriptBytes.copy(lockerScriptPadded);   // Copy actual bytes, rest is zeros
    const lockerHashBytes = sha256(lockerScriptPadded);
    const lockerHashBits = bufferToBitsBE(lockerHashBytes);
    const lockerScriptHash = bitsToBigInt(lockerHashBits.slice(0, 254));
    console.log(`✓ Locker script: ${lockerScriptBytes.toString('hex')}`);
    console.log(`✓ Locker script hash: ${lockerHashBytes.toString('hex').substring(0, 32)}...`);

    // ═══════════════════════════════════════════════════════════
    // Step 6: Build mock Bitcoin transaction
    // ═══════════════════════════════════════════════════════════

    // Transaction structure:
    // - Version: 4 bytes
    // - Input count: 1 byte (varint)
    // - Input: ~41 bytes (txid:32 + vout:4 + scriptSig:1+0 + sequence:4)
    // - Output count: 1 byte (varint)
    // - Output 0: value (8) + scriptLen (1) + script (25) = 34 bytes (locker output)
    // - Output 1: value (8) + scriptLen (1) + OP_RETURN (1) + commitment (32) = 42 bytes
    // - Locktime: 4 bytes

    // Version
    const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);

    // Input (simplified - 1 input)
    const inputCount = Buffer.from([0x01]);
    const prevTxId = crypto.randomBytes(32);
    const prevVout = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const scriptSigLen = Buffer.from([0x00]);  // Empty scriptSig for simplicity
    const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const input = Buffer.concat([prevTxId, prevVout, scriptSigLen, sequence]);

    // Output count (2 outputs)
    const outputCount = Buffer.from([0x02]);

    // Output 0: Payment to locker
    const output0Value = Buffer.alloc(8);
    output0Value.writeBigUInt64LE(amountSatoshis);  // Bitcoin uses little-endian
    const output0ScriptLen = Buffer.from([lockerScriptBytes.length]);
    const output0 = Buffer.concat([output0Value, output0ScriptLen, lockerScriptBytes]);

    // Output 1: OP_RETURN with commitment
    const output1Value = Buffer.alloc(8);  // 0 satoshis for OP_RETURN
    const opReturnScript = Buffer.concat([
        Buffer.from([0x6a]),  // OP_RETURN
        Buffer.from([0x20]),  // PUSH 32 bytes
        commitment
    ]);
    const output1ScriptLen = Buffer.from([opReturnScript.length]);
    const output1 = Buffer.concat([output1Value, output1ScriptLen, opReturnScript]);

    // Locktime
    const locktime = Buffer.from([0x00, 0x00, 0x00, 0x00]);

    // Combine into full transaction
    const rawTx = Buffer.concat([
        version,
        inputCount,
        input,
        outputCount,
        output0,
        output1,
        locktime
    ]);

    // Calculate locker output byte offset (where output0 starts)
    // Offset = version(4) + inputCount(1) + input(41) + outputCount(1) = 47 bytes
    const lockerOutputByteOffset = version.length + inputCount.length + input.length + outputCount.length;
    console.log(`✓ Locker output byte offset: ${lockerOutputByteOffset} bytes`);

    console.log(`✓ Transaction size: ${rawTx.length} bytes`);

    // Calculate commitment BYTE offset in transaction (where the 32-byte commitment starts)
    // version(4) + inputCount(1) + input(41) + outputCount(1) + output0(34) + output1Value(8) + output1ScriptLen(1) + OP_RETURN(1) + PUSH(1) = 92 bytes
    const commitmentByteOffset = version.length + inputCount.length + input.length +
        outputCount.length + output0.length + output1Value.length + output1ScriptLen.length + 2;  // +2 for OP_RETURN and PUSH opcode

    console.log(`✓ Commitment byte offset: ${commitmentByteOffset} bytes`);

    // ═══════════════════════════════════════════════════════════
    // Step 6b: Compute txId and SHA256-padded transaction
    // txId = SHA256(SHA256(transaction))
    //
    // The prover provides paddedTransaction with correct SHA256 padding.
    // The circuit verifies that hash(paddedTransaction) == txId.
    // ═══════════════════════════════════════════════════════════

    // Apply SHA256 padding to transaction
    // Padding is correct for actual length, then zero-extended to MAX_PADDED_BITS
    const { padded: paddedTx, numBlocks } = sha256PadForCircuit(rawTx, MAX_PADDED_BITS);
    const paddedTxBits = bufferToBitsBE(paddedTx);

    console.log(`✓ TX length: ${rawTx.length} bytes -> ${numBlocks} SHA256 blocks`);

    // Compute txId (double SHA256)
    const txIdBytes = doubleSha256(rawTx);
    const txIdBits = bufferToBitsBE(txIdBytes);

    // Display txId in Bitcoin's reversed format (little-endian display)
    console.log(`✓ TxId: ${Buffer.from(txIdBytes).reverse().toString('hex')}`);

    // ═══════════════════════════════════════════════════════════
    // Step 7: Create valid Merkle proof for testing
    // Circuit expects NUM_MERKLE_ROOTS = 2 for hidden root selection
    //
    // We use depth=1 for simplicity:
    // - leaf = txId
    // - sibling[0] = zero hash
    // - root = DoubleSHA256(txId || sibling) when pathIndices[0] = 0
    // ═══════════════════════════════════════════════════════════

    // Use depth 1 for test (simplest valid proof)
    const merkleDepth = 1;

    // Sibling at level 0 is all zeros (32 bytes)
    const sibling0 = Buffer.alloc(32);

    // Compute the merkle root: DoubleSHA256(txId || sibling0)
    // pathIndices[0] = 0 means txId is the left child
    const merkleInput = Buffer.concat([txIdBytes, sibling0]);
    const computedMerkleRoot = doubleSha256(merkleInput);
    const merkleRootBitsComputed = bufferToBitsBE(computedMerkleRoot);

    // Convert to field element (first 254 bits)
    const merkleRoot0Value = bitsToBigInt(merkleRootBitsComputed.slice(0, 254));

    // Create placeholder second root (different value)
    const merkleRoot1Value = merkleRoot0Value + BigInt(1);

    const merkleRoots = [
        merkleRoot0Value.toString(),
        merkleRoot1Value.toString()
    ];

    // merkleRootBits: must match the full 256-bit hash for proper comparison
    // For root 0, use the actual computed hash bits
    // For root 1, create bits that match the field element
    const merkleRootBits = [
        merkleRootBitsComputed,  // Root 0: actual computed merkle root
        bigIntToMerkleRootBits(merkleRoot1Value)  // Root 1: placeholder
    ];

    // Create merkle proof array (12 levels, but only first is used)
    const merkleProof = [];
    merkleProof.push(bufferToBitsBE(sibling0));  // Level 0 sibling
    for (let i = 1; i < MERKLE_DEPTH; i++) {
        // Unused levels get zero siblings
        merkleProof.push(padBits([], 256));
    }

    // Path indices: 0 means leaf is left child (txId || sibling)
    const merklePathIndices = Array(MERKLE_DEPTH).fill(0);

    const rootIndex = 0;  // Use root 0 (the valid computed one)
    console.log(`✓ Merkle root computed: ${computedMerkleRoot.toString('hex').substring(0, 16)}...`);
    console.log(`✓ Merkle depth: ${merkleDepth}`);
    console.log(`✓ Root index: ${rootIndex} (private)`);

    // ═══════════════════════════════════════════════════════════
    // Build circuit input object
    //
    // SECURITY FIX: We now use ONLY paddedTransaction for all operations.
    // The circuit extracts commitment from paddedTransaction at commitmentByteOffset.
    // This ensures the commitment is actually in the transaction.
    // ═══════════════════════════════════════════════════════════

    const circuitInput = {
        // PUBLIC INPUTS (7 total: merkleRoots[2] counts as 2)
        merkleRoots: merkleRoots,  // Array of 2 roots for hidden selection
        nullifier: nullifierValue.toString(),
        amount: amountSatoshis.toString(),
        chainId: chainId.toString(),
        recipient: recipient.toString(),
        lockerScriptHash: lockerScriptHash.toString(),

        // PRIVATE INPUTS
        secret: secretBits,
        lockerScript: lockerScriptBits,
        lockerScriptLength: lockerScriptLength,
        lockerOutputIndex: 0,
        lockerOutputByteOffset: lockerOutputByteOffset,  // Byte offset where locker output starts
        commitmentByteOffset: commitmentByteOffset,      // Byte offset where commitment starts in OP_RETURN
        rootIndex: rootIndex,  // Which merkle root the TX is in (private)
        merkleProof: merkleProof,
        merklePathIndices: merklePathIndices,
        merkleDepth: merkleDepth,
        merkleRootBits: merkleRootBits,

        // SINGLE TRANSACTION INPUT (used for everything)
        paddedTransaction: paddedTxBits,  // Transaction with SHA256 padding
        numBlocks: numBlocks,             // Number of 512-bit blocks to process
        txId: txIdBits,                   // Expected SHA256(SHA256(transaction)) - 256 bits
    };

    console.log('\n📊 Input Summary:');
    console.log('─────────────────');
    console.log('PUBLIC INPUTS:');
    console.log(`  merkleRoots:      [${merkleRoots[0]}, ${merkleRoots[1]}] (placeholders)`);
    console.log(`  nullifier:        ${nullifierValue.toString().substring(0, 20)}...`);
    console.log(`  amount:           ${amountSatoshis} satoshis`);
    console.log(`  chainId:          ${chainId}`);
    console.log(`  recipient:        ${recipientAddress}`);
    console.log(`  lockerScriptHash: ${lockerScriptHash.toString().substring(0, 20)}...`);
    console.log('\nPRIVATE INPUTS:');
    console.log(`  secret:           ${secretBits.length} bits`);
    console.log(`  paddedTransaction:${paddedTxBits.length} bits (${rawTx.length} bytes actual TX)`);
    console.log(`  numBlocks:        ${numBlocks}`);
    console.log(`  txId:             ${txIdBits.length} bits (circuit verifies hash)`);
    console.log(`  lockerScript:     ${lockerScriptBits.length} bits (${lockerScriptLength} bytes actual)`);
    console.log(`  lockerOutputByteOffset: ${lockerOutputByteOffset} bytes`);
    console.log(`  commitmentByteOffset:   ${commitmentByteOffset} bytes`);
    console.log(`  rootIndex:        ${rootIndex}`);

    return circuitInput;
}

/**
 * Main function
 */
function main() {
    try {
        const circuitInput = generateTestInput();

        // Ensure build directory exists
        const buildDir = path.join(__dirname, '..', 'build');
        if (!fs.existsSync(buildDir)) {
            fs.mkdirSync(buildDir, { recursive: true });
        }

        // Write to file
        const outputFile = path.join(buildDir, 'input.json');
        fs.writeFileSync(outputFile, JSON.stringify(circuitInput, null, 2));

        console.log(`\n✅ Circuit input saved to: ${outputFile}`);
        console.log('\n🚀 Next steps:');
        console.log('   1. Install circom: https://docs.circom.io/getting-started/installation/');
        console.log('   2. Compile circuit:  npm run circuit:compile');
        console.log('   3. Run setup:        npm run circuit:setup');
        console.log('   4. Generate proof:   npm run zk:generate-proof');
        console.log('   5. Verify proof:     npm run zk:verify-proof');
        console.log('');

    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { generateTestInput, sha256, hexToBitsBE, bufferToBitsBE };
