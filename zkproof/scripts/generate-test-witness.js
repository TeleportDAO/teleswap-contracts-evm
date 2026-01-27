#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Generate Circuit Input for Private Transfer ZK Proof
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This script generates input data for the PrivateTransferClaim circuit.
 * It creates all required signals in the exact format the circuit expects.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CRITICAL: BIT ORDERING CONVENTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * All bit arrays use BIG-ENDIAN ordering (MSB first per byte):
 *   - Byte 0xA5 (binary 10100101) → bits [1,0,1,0,0,1,0,1]
 *   - Bit index 0 = MSB of byte 0 (most significant bit)
 *   - Bit index 7 = LSB of byte 0 (least significant bit)
 *   - Bit index 8 = MSB of byte 1, etc.
 *
 * This matches circomlib's SHA256 input/output format exactly.
 *
 * CONVERSION FUNCTION: bufferToBitsBE()
 *   - Converts Node.js Buffer to bit array
 *   - Iterates bytes in order, extracts bits MSB first (j=7 down to j=0)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SHA256 PADDING CONVENTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This script applies SHA256 padding for the circuit's variable-length hash.
 *
 * Padding format (RFC 6234):
 *   [message bytes][0x80][zeros...][64-bit big-endian length]
 *
 * Total padded length is always a multiple of 64 bytes (512 bits).
 *
 * Example for 124-byte message:
 *   - Message length = 124 bytes = 992 bits
 *   - Padded size = ceil((992 + 65) / 512) * 512 = 1536 bits = 192 bytes
 *   - Structure: [124 bytes message][0x80][59 zero bytes][8 bytes length]
 *   - Length field (BE): 0x00000000000003E0 = 992
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMMITMENT FORMAT (MUST MATCH CIRCUIT)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * commitment = SHA256(secret || amount || chainId || recipient)
 *
 * Components (62 bytes = 496 bits total):
 *   - secret:    32 bytes (256 bits) - random bytes, big-endian
 *   - amount:     8 bytes (64 bits)  - big-endian uint64 (writeBigUInt64BE)
 *   - chainId:    2 bytes (16 bits)  - big-endian uint16 (writeUInt16BE)
 *   - recipient: 20 bytes (160 bits) - EVM address bytes
 *
 * The circuit reconstructs this by:
 *   1. Taking secret bits directly (already big-endian)
 *   2. Converting amount/chainId/recipient from field elements using Num2Bits
 *   3. Reversing Num2Bits output (little-endian) to big-endian for SHA256
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NULLIFIER FORMAT (MUST MATCH CIRCUIT)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * nullifier = SHA256(secret || 0x01)[0:254 bits]
 *
 * The 0x01 suffix in big-endian bits: [0,0,0,0,0,0,0,1]
 * Truncation to 254 bits for BN254 field element compatibility.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOCKER SCRIPT HASH FORMAT (MUST MATCH CIRCUIT)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * lockerScriptHash = SHA256(lockerScript padded to 65 bytes)[0:254 bits]
 *
 * Why 65 bytes? Consistent hashing regardless of actual script length.
 * Standard scripts are 22-25 bytes, padded with zeros to 65 bytes.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Circuit Parameters (from main.circom):
 *   - maxTxBytes = 512
 *   - maxPaddedBits = 4608 (9 blocks of 512 bits)
 *   - LOCKER_SCRIPT_BITS = 520 (65 bytes)
 *   - MERKLE_DEPTH = 12
 *   - NUM_MERKLE_ROOTS = 2
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// FIELD CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// BN254 scalar field prime (used by Groth16 proofs)
// All field elements in the circuit are automatically reduced modulo this prime
const BN254_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT CONSTANTS - Must match main.circom
// ═══════════════════════════════════════════════════════════════════════════

const MAX_TX_BYTES = 512;
const MAX_TX_BITS = MAX_TX_BYTES * 8;  // 4096
const LOCKER_SCRIPT_BITS = 520;  // 65 bytes max
const MERKLE_DEPTH = 12;
const NUM_MERKLE_ROOTS = 2;

// Max padded size: ((4096 + 64) / 512 + 1) * 512 = 4608 bits = 9 blocks
const MAX_PADDED_BITS = (Math.floor((MAX_TX_BITS + 64) / 512) + 1) * 512;

// ═══════════════════════════════════════════════════════════════════════════
// CRYPTOGRAPHIC UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SHA256 hash
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}

/**
 * Double SHA256 (Bitcoin-style)
 */
function doubleSha256(data) {
    return sha256(sha256(data));
}

// ═══════════════════════════════════════════════════════════════════════════
// BIT CONVERSION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Convert Buffer to bit array (big-endian, MSB first per byte)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This is the format circomlib SHA256 expects for input and output.
 *
 * CONVERSION LOGIC:
 *   For each byte in buffer (in order):
 *     Extract bits from MSB (position 7) to LSB (position 0)
 *
 * EXAMPLE:
 *   Buffer: [0xA5, 0x3C] = [10100101, 00111100]
 *   Output: [1,0,1,0,0,1,0,1, 0,0,1,1,1,1,0,0]
 *            ↑─────────────↑  ↑─────────────↑
 *               byte 0           byte 1
 *
 * BIT INDEX MAPPING:
 *   bits[i*8 + j] = bit (7-j) of buffer[i]
 *   OR equivalently: bits[i*8 + (7-k)] = bit k of buffer[i]
 *
 * MATCHING CIRCUIT FORMAT:
 *   - Circuit's SHA256 input: Big-endian bits (MSB first per byte)
 *   - Circuit's secret[256]: Big-endian bits
 *   - Circuit's txId[256]: Big-endian bits
 *   - All match this function's output format
 *
 * @param {Buffer} buffer - Input buffer
 * @returns {number[]} Array of bits (0s and 1s), length = buffer.length * 8
 */
function bufferToBitsBE(buffer) {
    const bits = [];
    for (let i = 0; i < buffer.length; i++) {
        // Extract bits from MSB (j=7) to LSB (j=0)
        for (let j = 7; j >= 0; j--) {
            bits.push((buffer[i] >> j) & 1);
        }
    }
    return bits;
}

/**
 * Convert bit array to Buffer (big-endian)
 *
 * @param {number[]} bits - Array of bits
 * @returns {Buffer} Result buffer
 */
function bitsBEToBuffer(bits) {
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8 && i + j < bits.length; j++) {
            byte = (byte << 1) | bits[i + j];
        }
        bytes.push(byte);
    }
    return Buffer.from(bytes);
}

/**
 * Pad bit array to target length with zeros
 */
function padBits(bits, targetLength) {
    const result = [...bits];
    while (result.length < targetLength) {
        result.push(0);
    }
    return result.slice(0, targetLength);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Convert bits (big-endian) to BigInt
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CONVERSION LOGIC:
 *   Treats bit array as a big-endian number (MSB at index 0).
 *   Shifts in each bit from left to right.
 *
 * EXAMPLE:
 *   bits = [1, 0, 1, 1] (MSB first)
 *   result = 0
 *   i=0: result = (0 << 1) | 1 = 1
 *   i=1: result = (1 << 1) | 0 = 2
 *   i=2: result = (2 << 1) | 1 = 5
 *   i=3: result = (5 << 1) | 1 = 11 = 0b1011 ✓
 *
 * CIRCUIT MATCHING:
 *   Circuit uses Bits2Num which expects LITTLE-ENDIAN (LSB at index 0).
 *   Circuit reverses SHA256 output bits before Bits2Num:
 *     nullifierBits2Num.in[i] = nullifierHasher.out[253 - i]
 *
 *   This function converts big-endian bits to BigInt directly.
 *   The result matches what the circuit computes via:
 *     reverse(SHA256_output[0:254]) → Bits2Num → field element
 *
 * NOTE: The circuit automatically applies modulo BN254_PRIME to field elements.
 *   When converting 254-bit hashes to field elements, apply the same modulo
 *   using bitsToFieldElement() instead of this function.
 *
 * USED FOR:
 *   - Raw bit conversion without modulo (e.g., merkle root bits)
 *
 * @param {number[]} bits - Big-endian bit array (MSB at index 0)
 * @returns {BigInt} The numeric value (may exceed field prime)
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
 * This matches how the circuit computes field elements from hash bits.
 * The Bits2Num output is automatically reduced modulo the BN254 field prime.
 *
 * USED FOR:
 *   - nullifier: SHA256(secret || 0x01)[0:254] mod BN254_PRIME
 *   - lockerScriptHash: SHA256(padded_script)[0:254] mod BN254_PRIME
 *   - merkleRoots: SHA256(merkle_node)[0:254] mod BN254_PRIME
 *
 * @param {number[]} bits - Big-endian bit array (MSB at index 0), typically 254 bits
 * @returns {BigInt} Field element (< BN254_PRIME)
 */
function bitsToFieldElement(bits) {
    const raw = bitsToBigInt(bits);
    return raw % BN254_PRIME;
}

/**
 * Convert BigInt to 256 bits (big-endian)
 */
function bigIntTo256Bits(value) {
    const bits = [];
    for (let i = 255; i >= 0; i--) {
        bits.push(Number((value >> BigInt(i)) & BigInt(1)));
    }
    return bits;
}

// ═══════════════════════════════════════════════════════════════════════════
// SHA256 PADDING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Apply SHA256 padding to a message (RFC 6234 / FIPS 180-4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SHA256 PADDING STRUCTURE:
 *   [original message][0x80][zero bytes...][64-bit big-endian length]
 *
 * PADDING RULES:
 *   1. Append byte 0x80 (binary 10000000) - the "1 bit" followed by 7 zeros
 *   2. Append K zero bytes where K is minimum such that:
 *      (message.length + 1 + K + 8) is a multiple of 64 bytes
 *   3. Append original message length in BITS as 64-bit big-endian integer
 *
 * Total padded length is always a multiple of 64 bytes (512 bits = 1 block).
 *
 * EXAMPLE - 100 byte message:
 *   - Message length = 100 bytes = 800 bits
 *   - Need: (100 + 1 + K + 8) ≡ 0 mod 64
 *   - K = 64 - ((100 + 1 + 8) % 64) = 64 - 45 = 19 (if 45 != 0)
 *   - Actually: 100 + 1 + 8 = 109, 109 % 64 = 45, need 64 - 45 = 19 more
 *   - Padded size = 100 + 1 + 19 + 8 = 128 bytes = 2 blocks
 *   - Structure: [100 bytes message][0x80][19 zero bytes][0x0000000000000320]
 *                                                         ↑ 800 in hex = 0x320
 *
 * CIRCUIT COMPATIBILITY:
 *   The circuit's Sha256VariableLength expects pre-padded input.
 *   This function produces the exact padding the circuit needs.
 *
 * @param {Buffer} message - Original message (unpadded)
 * @returns {Buffer} Padded message ready for SHA256 compression
 */
function sha256Pad(message) {
    const msgBits = message.length * 8;
    // Padded size: ceil((msgBits + 65) / 512) * 512 bits
    // The +65 accounts for: 1 bit (from 0x80) + 64 bits (length field)
    const paddedBits = Math.ceil((msgBits + 65) / 512) * 512;
    const paddedBytes = paddedBits / 8;

    const padded = Buffer.alloc(paddedBytes);  // Initialized with zeros
    message.copy(padded);                       // Copy message to start
    padded[message.length] = 0x80;              // Append 0x80 (10000000 binary)
    // Zero bytes are already there from Buffer.alloc
    // Append 64-bit big-endian message length (in BITS, not bytes)
    padded.writeBigUInt64BE(BigInt(msgBits), paddedBytes - 8);

    return padded;
}

/**
 * Apply SHA256 padding and extend to circuit's max size
 *
 * @param {Buffer} message - Original message
 * @param {number} targetBits - Target size (must be >= padded size)
 * @returns {{paddedBits: number[], numBlocks: number}}
 */
function sha256PadForCircuit(message, targetBits) {
    const padded = sha256Pad(message);
    const numBlocks = padded.length * 8 / 512;

    if (targetBits < padded.length * 8) {
        throw new Error(`Message too large: ${message.length} bytes -> ${padded.length * 8} padded bits > ${targetBits} max`);
    }

    // Convert to bits and zero-extend to target size
    const bits = bufferToBitsBE(padded);
    while (bits.length < targetBits) {
        bits.push(0);
    }

    return { paddedBits: bits, numBlocks };
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate circuit input for a private transfer claim
 *
 * @param {Object} params - Optional parameters to override defaults
 * @returns {Object} Circuit input object
 */
function generateCircuitInput(params = {}) {
    console.log('\n=== Private Transfer Circuit Input Generator ===\n');

    // ─────────────────────────────────────────────────────────────────────
    // 1. GENERATE SECRET (256 bits = 32 bytes)
    // ─────────────────────────────────────────────────────────────────────
    const secretBytes = params.secret || crypto.randomBytes(32);
    const secretBits = bufferToBitsBE(secretBytes);
    console.log(`Secret: ${secretBytes.toString('hex').slice(0, 16)}...`);

    // ─────────────────────────────────────────────────────────────────────
    // 2. DEFINE AMOUNT, CHAINID, RECIPIENT
    // ─────────────────────────────────────────────────────────────────────
    const amount = params.amount !== undefined ? BigInt(params.amount) : BigInt(10000000); // 0.1 BTC
    const chainId = params.chainId !== undefined ? BigInt(params.chainId) : BigInt(137);   // Polygon
    const recipientBytes = params.recipient || crypto.randomBytes(20);
    const recipient = BigInt('0x' + recipientBytes.toString('hex'));

    console.log(`Amount: ${amount} satoshis (${Number(amount) / 1e8} BTC)`);
    console.log(`ChainId: ${chainId}`);
    console.log(`Recipient: 0x${recipientBytes.toString('hex')}`);

    // ─────────────────────────────────────────────────────────────────────
    // 3. COMPUTE COMMITMENT = SHA256(secret[32] || amount[8 BE] || chainId[2 BE] || recipient[20])
    //    Total: 32 + 8 + 2 + 20 = 62 bytes = 496 bits
    //
    //    BYTE ORDER - BIG-ENDIAN:
    //    ────────────────────────
    //    - amount: writeBigUInt64BE → MSB of amount at byte 0
    //    - chainId: writeUInt16BE → MSB of chainId at byte 0
    //
    //    CIRCUIT MATCHING:
    //    ─────────────────
    //    The circuit does:
    //      1. Num2Bits(amount) → little-endian bits (LSB at index 0)
    //      2. Reverse: commitmentHasher.in[256+i] = amountBits.out[63-i]
    //         This puts MSB at index 0 → big-endian number representation
    //
    //    Example: amount = 10000000 (0x989680)
    //      - writeBigUInt64BE: [0x00,0x00,0x00,0x00,0x00,0x98,0x96,0x80]
    //      - As big-endian bits: 0000...100110001001011010000000
    //      - Circuit Num2Bits gives LSB-first, then reverses to MSB-first
    //      - Result matches byte representation converted to bits
    //
    //    Both produce the same 496 bits fed to SHA256.
    // ─────────────────────────────────────────────────────────────────────
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64BE(amount);

    const chainIdBuf = Buffer.alloc(2);
    chainIdBuf.writeUInt16BE(Number(chainId));

    const commitmentInput = Buffer.concat([secretBytes, amountBuf, chainIdBuf, recipientBytes]);
    const commitment = sha256(commitmentInput);
    console.log(`Commitment: ${commitment.toString('hex')}`);

    // ─────────────────────────────────────────────────────────────────────
    // 4. COMPUTE NULLIFIER = SHA256(secret[32] || 0x01)
    //    Total: 33 bytes = 264 bits
    //
    //    TRUNCATION TO 254 BITS:
    //    ────────────────────────
    //    BN254 (the elliptic curve used by Groth16) has a prime field of
    //    ~254 bits. Field elements must be < p ≈ 2^254.
    //
    //    SHA256 outputs 256 bits, but we can only use 254 bits as a field element.
    //    We take bits[0:254] (the 254 MSBs) and discard bits[254:256].
    //
    //    This is safe because:
    //    1. Both circuit and witness use the same truncation
    //    2. 254 bits provides ~10^76 uniqueness (more than enough)
    //    3. Collision probability is negligible
    //
    //    CIRCUIT DOES THE SAME:
    //      nullifierBits2Num.in[i] = nullifierHasher.out[253 - i]  // for i in [0,254)
    //      (This reverses bits 0-253 for Bits2Num's little-endian input)
    // ─────────────────────────────────────────────────────────────────────
    const nullifierInput = Buffer.concat([secretBytes, Buffer.from([0x01])]);
    const nullifierHash = sha256(nullifierInput);
    const nullifierBits = bufferToBitsBE(nullifierHash);
    // Truncate to 254 bits and apply BN254 modulo (circuit does this automatically)
    const nullifier = bitsToFieldElement(nullifierBits.slice(0, 254));
    console.log(`Nullifier: ${nullifierHash.toString('hex').slice(0, 32)}...`);

    // ─────────────────────────────────────────────────────────────────────
    // 5. CREATE LOCKER SCRIPT (P2PKH format)
    //    Circuit hashes the 65-byte (520 bit) padded version
    //
    //    WHY 65-BYTE PADDING:
    //    ────────────────────
    //    Different script types have different lengths:
    //      - P2PKH:  25 bytes (OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG)
    //      - P2SH:   23 bytes (OP_HASH160 <20> OP_EQUAL)
    //      - P2WPKH: 22 bytes (OP_0 <20>)
    //
    //    To provide a consistent interface, we always hash 65 bytes.
    //    The actual script is placed at the start, padded with zeros.
    //
    //    CIRCUIT MATCHING:
    //    ─────────────────
    //    Circuit does: component lockerHasher = Sha256(520);
    //    It hashes all 520 bits (65 bytes) of the lockerScript input.
    //
    //    For hash to match:
    //    - We hash 65-byte padded buffer
    //    - Circuit hashes 520-bit padded bit array
    //    - Both are [script bytes][zeros to fill 65 bytes]
    //
    //    TRUNCATION:
    //    ───────────
    //    lockerScriptHash = SHA256(padded)[0:254 bits] for field element
    // ─────────────────────────────────────────────────────────────────────
    // Default P2PKH script for address 1NtQASBBziad6x5dST3jgoFqWv1eMAAnWY
    // OP_DUP OP_HASH160 <20-byte-pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
    const lockerScriptBytes = params.lockerScript ||
        Buffer.from('76a914f01330d32d8f0df50b52966d735832ad0ab0df1c88ac', 'hex');
    const lockerScriptLength = lockerScriptBytes.length;

    // Pad to 65 bytes for hashing (circuit hashes full 520 bits)
    // Buffer.alloc initializes with zeros
    const lockerScriptPadded = Buffer.alloc(65);
    lockerScriptBytes.copy(lockerScriptPadded);  // Copy script to start

    // Hash the 65-byte padded version
    const lockerHashBytes = sha256(lockerScriptPadded);
    const lockerHashBits = bufferToBitsBE(lockerHashBytes);
    // Truncate to 254 bits and apply BN254 modulo (circuit does this automatically)
    const lockerScriptHash = bitsToFieldElement(lockerHashBits.slice(0, 254));

    // For circuit input: pad the bit array (not the buffer)
    // This produces identical bits: [script bits][zero bits to fill 520]
    const lockerScriptBits = padBits(bufferToBitsBE(lockerScriptBytes), LOCKER_SCRIPT_BITS);

    console.log(`Locker script: ${lockerScriptBytes.toString('hex')} (${lockerScriptLength} bytes)`);
    console.log(`Locker hash: ${lockerHashBytes.toString('hex').slice(0, 32)}...`);

    // ─────────────────────────────────────────────────────────────────────
    // 6. BUILD BITCOIN TRANSACTION
    //
    // Structure:
    //   [version:4][inputCount:1][input:41][outputCount:1]
    //   [output0:value(8)+scriptLen(1)+script(25)][output1:OP_RETURN with commitment]
    //   [locktime:4]
    // ─────────────────────────────────────────────────────────────────────

    // Version
    const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);

    // Single input (simplified)
    const inputCount = Buffer.from([0x01]);
    const prevTxId = crypto.randomBytes(32);
    const prevVout = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const scriptSigLen = Buffer.from([0x00]);
    const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const txInput = Buffer.concat([prevTxId, prevVout, scriptSigLen, sequence]);

    // Two outputs
    const outputCount = Buffer.from([0x02]);

    // Output 0: Payment to locker
    const output0Value = Buffer.alloc(8);
    output0Value.writeBigUInt64LE(amount);  // Bitcoin is little-endian
    const output0ScriptLen = Buffer.from([lockerScriptBytes.length]);
    const output0 = Buffer.concat([output0Value, output0ScriptLen, lockerScriptBytes]);

    // Output 1: OP_RETURN with commitment
    const output1Value = Buffer.alloc(8);  // 0 satoshis
    const opReturnScript = Buffer.concat([
        Buffer.from([0x6a]),  // OP_RETURN
        Buffer.from([0x20]),  // PUSH 32 bytes
        commitment
    ]);
    const output1ScriptLen = Buffer.from([opReturnScript.length]);
    const output1 = Buffer.concat([output1Value, output1ScriptLen, opReturnScript]);

    // Locktime
    const locktime = Buffer.from([0x00, 0x00, 0x00, 0x00]);

    // Complete transaction
    const rawTx = Buffer.concat([
        version, inputCount, txInput, outputCount, output0, output1, locktime
    ]);

    console.log(`Transaction size: ${rawTx.length} bytes`);

    // ─────────────────────────────────────────────────────────────────────
    // 7. CALCULATE OFFSETS
    // ─────────────────────────────────────────────────────────────────────

    // Locker output starts after: version(4) + inputCount(1) + input(41) + outputCount(1) = 47
    const lockerOutputByteOffset = version.length + inputCount.length + txInput.length + outputCount.length;

    // Commitment byte offset:
    // lockerOutputByteOffset + output0(8+1+25=34) + output1Value(8) + output1ScriptLen(1) + OP_RETURN(1) + PUSH(1) = 47+34+8+1+1+1 = 92
    const commitmentByteOffset = lockerOutputByteOffset + output0.length +
        output1Value.length + output1ScriptLen.length + 2;

    console.log(`Locker output byte offset: ${lockerOutputByteOffset}`);
    console.log(`Commitment byte offset: ${commitmentByteOffset}`);

    // Verify commitment is at the right place
    const extractedCommitment = rawTx.slice(commitmentByteOffset, commitmentByteOffset + 32);
    if (!extractedCommitment.equals(commitment)) {
        throw new Error('Commitment offset verification failed!');
    }
    console.log('Commitment offset verified OK');

    // ─────────────────────────────────────────────────────────────────────
    // 8. COMPUTE TXID AND PADDED TRANSACTION
    //
    //    BITCOIN TXID:
    //    ─────────────
    //    txId = SHA256(SHA256(raw_transaction))
    //
    //    DISPLAY vs INTERNAL FORMAT:
    //    ───────────────────────────
    //    Bitcoin displays txIds in REVERSED BYTE ORDER (little-endian display).
    //      Internal: 0xABCDEF...123456
    //      Display:  0x563412...EFCDAB (bytes reversed)
    //
    //    We use the INTERNAL format for all cryptographic operations.
    //    The circuit expects internal format (non-reversed).
    //
    //    PADDED TRANSACTION:
    //    ───────────────────
    //    The circuit's variable-length SHA256 expects pre-padded input.
    //    We apply SHA256 padding here and extend with zeros to max size.
    //
    //    Structure: [raw_tx][0x80][zeros][64-bit length][more zeros to max]
    //    The numBlocks tells the circuit how many blocks contain real data.
    // ─────────────────────────────────────────────────────────────────────

    // Apply SHA256 padding for circuit's variable-length hash
    const { paddedBits: paddedTxBits, numBlocks } = sha256PadForCircuit(rawTx, MAX_PADDED_BITS);

    // Compute txId = doubleSHA256(rawTx) in INTERNAL (non-reversed) format
    const txIdBytes = doubleSha256(rawTx);
    const txIdBits = bufferToBitsBE(txIdBytes);  // Big-endian bits

    console.log(`Padded TX: ${numBlocks} blocks (${numBlocks * 512} bits)`);
    // Display in reversed format (how Bitcoin explorers show it)
    console.log(`TxId: ${Buffer.from(txIdBytes).reverse().toString('hex')} (display order)`);

    // ─────────────────────────────────────────────────────────────────────
    // 9. BUILD MERKLE PROOF
    //
    //    BITCOIN MERKLE TREE:
    //    ────────────────────
    //    Bitcoin uses double SHA256 for Merkle tree nodes:
    //      parent = SHA256(SHA256(left_child || right_child))
    //
    //    Simple case: depth=1, single sibling (zeros for testing)
    //    root = doubleSHA256(txId || sibling) when pathIndex=0
    //
    //    PATH INDICES:
    //    ─────────────
    //    pathIndices[i] = 0 means current node is LEFT child at level i
    //    pathIndices[i] = 1 means current node is RIGHT child at level i
    //
    //    BIT FORMAT:
    //    ───────────
    //    All hashes (txId, siblings, root) use big-endian bits.
    //    This matches the circuit's internal format.
    //
    //    HIDDEN ROOT SELECTION:
    //    ──────────────────────
    //    Circuit supports proving inclusion in one of N roots (N=2).
    //    The specific root used is hidden (privacy feature).
    //    merkleRootBits[0] and merkleRootBits[1] are the full 256-bit roots.
    //    Public merkleRoots[0] and merkleRoots[1] are truncated to 254 bits.
    // ─────────────────────────────────────────────────────────────────────

    const merkleDepth = 1;
    const sibling0 = Buffer.alloc(32);  // zeros (for testing)

    // Compute merkle root: txId is left child (pathIndex=0)
    // parent = doubleSHA256(left || right) = doubleSHA256(txId || sibling0)
    const merkleInput = Buffer.concat([txIdBytes, sibling0]);
    const computedMerkleRoot = doubleSha256(merkleInput);
    const merkleRootBits = bufferToBitsBE(computedMerkleRoot);  // Big-endian bits
    // Truncate to 254 bits and apply BN254 modulo (circuit does this automatically)
    const merkleRoot0 = bitsToFieldElement(merkleRootBits.slice(0, 254));

    // Second root (placeholder, different value for privacy set)
    // Create a different 256-bit root by flipping some bits in the original
    // This ensures merkleRootBits[1] has the same structure as a real hash
    const merkleRoot1Bytes = Buffer.from(computedMerkleRoot);
    merkleRoot1Bytes[0] ^= 0x01;  // Flip one bit to make it different
    const merkleRoot1Bits = bufferToBitsBE(merkleRoot1Bytes);
    // Truncate to 254 bits and apply BN254 modulo
    const merkleRoot1 = bitsToFieldElement(merkleRoot1Bits.slice(0, 254));

    console.log(`Merkle root: ${computedMerkleRoot.toString('hex').slice(0, 32)}...`);

    // Build merkle proof array (12 levels max, only first 'depth' are used)
    const merkleProof = [];
    merkleProof.push(bufferToBitsBE(sibling0));  // Level 0: actual sibling
    for (let i = 1; i < MERKLE_DEPTH; i++) {
        merkleProof.push(new Array(256).fill(0));  // Unused levels: zeros
    }

    // Path indices: 0 means leaf/current is left child
    // For our simple test: txId is always left child at all levels
    const merklePathIndices = new Array(MERKLE_DEPTH).fill(0);

    // merkleRootBits for hidden root selection (full 256 bits for each root)
    // These are private inputs; circuit verifies they match public merkleRoots
    const merkleRootBitsArray = [
        merkleRootBits,    // Root 0: actual computed root (256 bits)
        merkleRoot1Bits    // Root 1: placeholder different root (256 bits)
    ];

    const rootIndex = 0;  // Use root 0 (private: circuit hides which root is used)

    // ─────────────────────────────────────────────────────────────────────
    // 10. ASSEMBLE FINAL INPUT OBJECT
    // ─────────────────────────────────────────────────────────────────────

    const circuitInput = {
        // PUBLIC INPUTS (7 total)
        merkleRoots: [merkleRoot0.toString(), merkleRoot1.toString()],
        nullifier: nullifier.toString(),
        amount: amount.toString(),
        chainId: chainId.toString(),
        recipient: recipient.toString(),
        lockerScriptHash: lockerScriptHash.toString(),

        // PRIVATE INPUTS
        secret: secretBits,
        lockerScript: lockerScriptBits,
        lockerScriptLength: lockerScriptLength,
        lockerOutputIndex: 0,
        lockerOutputByteOffset: lockerOutputByteOffset,
        commitmentByteOffset: commitmentByteOffset,
        rootIndex: rootIndex,
        merkleProof: merkleProof,
        merklePathIndices: merklePathIndices,
        merkleDepth: merkleDepth,
        merkleRootBits: merkleRootBitsArray,
        paddedTransaction: paddedTxBits,
        numBlocks: numBlocks,
        txId: txIdBits,
    };

    // ─────────────────────────────────────────────────────────────────────
    // 11. VALIDATION
    // ─────────────────────────────────────────────────────────────────────

    console.log('\n--- Input Validation ---');
    console.log(`secret: ${secretBits.length} bits (expected 256)`);
    console.log(`lockerScript: ${lockerScriptBits.length} bits (expected 520)`);
    console.log(`paddedTransaction: ${paddedTxBits.length} bits (expected ${MAX_PADDED_BITS})`);
    console.log(`txId: ${txIdBits.length} bits (expected 256)`);
    console.log(`merkleProof: ${merkleProof.length} levels (expected 12)`);
    console.log(`merklePathIndices: ${merklePathIndices.length} (expected 12)`);
    console.log(`merkleRootBits: ${merkleRootBitsArray.length} roots (expected 2)`);

    // Verify all bits are binary
    const allBinary = (arr) => arr.every(b => b === 0 || b === 1);
    if (!allBinary(secretBits)) throw new Error('secret contains non-binary values');
    if (!allBinary(lockerScriptBits)) throw new Error('lockerScript contains non-binary values');
    if (!allBinary(paddedTxBits)) throw new Error('paddedTransaction contains non-binary values');
    if (!allBinary(txIdBits)) throw new Error('txId contains non-binary values');
    console.log('All bit arrays are binary: OK');

    return circuitInput;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

function main() {
    try {
        const input = generateCircuitInput();

        // Ensure output directory exists
        const outputDir = path.join(__dirname, '..', 'build');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Write input
        const outputPath = path.join(outputDir, 'input.json');
        fs.writeFileSync(outputPath, JSON.stringify(input, null, 2));
        console.log(`\nInput saved to: ${outputPath}`);

        // Also export for reference
        const publicInputs = {
            merkleRoots: input.merkleRoots,
            nullifier: input.nullifier,
            amount: input.amount,
            chainId: input.chainId,
            recipient: input.recipient,
            lockerScriptHash: input.lockerScriptHash,
        };
        console.log('\nPublic inputs:', JSON.stringify(publicInputs, null, 2));

        console.log('\nNext steps:');
        console.log('  1. Compile circuit: circom circuits/src/main.circom --r1cs --wasm --sym -o zkproof/build');
        console.log('  2. Generate witness: node zkproof/build/main_js/generate_witness.js zkproof/build/main_js/main.wasm zkproof/build/input.json zkproof/build/witness.wtns');
        console.log('  3. Generate proof: snarkjs groth16 prove zkproof/build/circuit_final.zkey zkproof/build/witness.wtns zkproof/build/proof.json zkproof/build/public.json');

    } catch (error) {
        console.error(`\nError: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { generateCircuitInput, bufferToBitsBE, sha256, doubleSha256 };
