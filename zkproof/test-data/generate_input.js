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

// Circuit constants
const MAX_TX_BYTES = 1024;
const MAX_TX_BITS = MAX_TX_BYTES * 8;
const LOCKER_SCRIPT_BITS = 520;  // 65 bytes max
const MERKLE_DEPTH = 12;

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
    // Step 2: Define amount and chainId
    // ═══════════════════════════════════════════════════════════
    const amountSatoshis = BigInt(10000000);  // 0.1 BTC = 10,000,000 satoshis
    const chainId = BigInt(1);  // Ethereum mainnet

    console.log(`✓ Amount: ${amountSatoshis} satoshis (${Number(amountSatoshis) / 100000000} BTC)`);
    console.log(`✓ Chain ID: ${chainId}`);

    // ═══════════════════════════════════════════════════════════
    // Step 3: Compute commitment = SHA256(secret || amount || chainId)
    // Total: 32 + 8 + 2 = 42 bytes
    // ═══════════════════════════════════════════════════════════
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64BE(amountSatoshis);

    const chainIdBuffer = Buffer.alloc(2);
    chainIdBuffer.writeUInt16BE(Number(chainId));

    const commitmentInput = Buffer.concat([secretBytes, amountBuffer, chainIdBuffer]);
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
    // Step 5: Create mock locker script (P2PKH style)
    // ═══════════════════════════════════════════════════════════
    // OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
    const lockerPubKeyHash = crypto.randomBytes(20);
    const lockerScriptBytes = Buffer.concat([
        Buffer.from([0x76, 0xa9, 0x14]),  // OP_DUP OP_HASH160 PUSH(20)
        lockerPubKeyHash,
        Buffer.from([0x88, 0xac])  // OP_EQUALVERIFY OP_CHECKSIG
    ]);
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

    // Calculate locker output offset (bit offset where output0 starts)
    // Offset = version(4) + inputCount(1) + input(41) + outputCount(1) = 47 bytes = 376 bits
    const lockerOutputOffsetBytes = version.length + inputCount.length + input.length + outputCount.length;
    const lockerOutputOffset = lockerOutputOffsetBytes * 8;
    console.log(`✓ Locker output offset: ${lockerOutputOffsetBytes} bytes = ${lockerOutputOffset} bits`);

    console.log(`✓ Transaction size: ${rawTx.length} bytes`);

    // Calculate commitment offset in transaction
    // version(4) + inputCount(1) + input(41) + outputCount(1) + output0(34) + output1Value(8) + output1ScriptLen(1) + OP_RETURN(1) + PUSH(1) = 92 bytes
    const commitmentOffset = version.length + inputCount.length + input.length +
        outputCount.length + output0.length + output1Value.length + output1ScriptLen.length + 2;  // +2 for OP_RETURN and PUSH opcode

    console.log(`✓ Commitment offset: ${commitmentOffset} bytes`);

    // Pad transaction to MAX_TX_BITS
    const txBits = padBits(bufferToBitsBE(rawTx), MAX_TX_BITS);

    // Compute txId (double SHA256)
    const txId = doubleSha256(rawTx);
    console.log(`✓ TxId: ${Buffer.from(txId).reverse().toString('hex')}`);

    // ═══════════════════════════════════════════════════════════
    // Step 7: Create mock Merkle proof (placeholder for Phase 2)
    // ═══════════════════════════════════════════════════════════
    const merkleProof = [];
    for (let i = 0; i < MERKLE_DEPTH; i++) {
        const sibling = crypto.randomBytes(32);
        merkleProof.push(bufferToBitsBE(sibling));
    }
    const merkleIndex = 0;  // Leaf position
    const merkleRoot = BigInt(12345);  // Placeholder - not verified in Phase 1

    // ═══════════════════════════════════════════════════════════
    // Step 8: Define recipient address
    // ═══════════════════════════════════════════════════════════
    const recipientAddress = '0x' + crypto.randomBytes(20).toString('hex');
    const recipient = BigInt(recipientAddress);
    console.log(`✓ Recipient: ${recipientAddress}`);

    // ═══════════════════════════════════════════════════════════
    // Build circuit input object
    // ═══════════════════════════════════════════════════════════

    // Convert commitment to bits for circuit input
    const commitmentBits = bufferToBitsBE(commitment);

    const circuitInput = {
        // PUBLIC INPUTS
        merkleRoot: merkleRoot.toString(),
        nullifier: nullifierValue.toString(),
        amount: amountSatoshis.toString(),
        chainId: chainId.toString(),
        recipient: recipient.toString(),
        lockerScriptHash: lockerScriptHash.toString(),

        // PRIVATE INPUTS
        secret: secretBits,
        commitmentFromTx: commitmentBits,  // Commitment extracted from TX's OP_RETURN
        transaction: txBits,
        txLength: rawTx.length,
        lockerScript: lockerScriptBits,
        lockerScriptLength: lockerScriptLength,
        lockerOutputIndex: 0,
        lockerOutputOffset: lockerOutputOffset,  // Bit offset where locker output starts
        merkleProof: merkleProof,
        merkleIndex: merkleIndex
    };

    console.log('\n📊 Input Summary:');
    console.log('─────────────────');
    console.log('PUBLIC INPUTS:');
    console.log(`  merkleRoot:       ${merkleRoot} (placeholder)`);
    console.log(`  nullifier:        ${nullifierValue.toString().substring(0, 20)}...`);
    console.log(`  amount:           ${amountSatoshis} satoshis`);
    console.log(`  chainId:          ${chainId}`);
    console.log(`  recipient:        ${recipientAddress}`);
    console.log(`  lockerScriptHash: ${lockerScriptHash.toString().substring(0, 20)}...`);
    console.log('\nPRIVATE INPUTS:');
    console.log(`  secret:           ${secretBits.length} bits`);
    console.log(`  commitmentFromTx: ${commitmentBits.length} bits`);
    console.log(`  transaction:      ${txBits.length} bits (${rawTx.length} bytes actual)`);
    console.log(`  lockerScript:     ${lockerScriptBits.length} bits (${lockerScriptLength} bytes actual)`);

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
