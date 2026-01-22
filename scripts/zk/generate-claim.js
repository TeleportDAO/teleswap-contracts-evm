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
 *   node scripts/zk/generate-claim.js --txid=<bitcoin_txid>
 *   node scripts/zk/generate-claim.js --deposit=<deposit_file>
 *
 * If you used create-btc-deposit.js, use --deposit flag with the saved file.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Circuit constants
const MAX_TX_BYTES = 1024;
const MAX_TX_BITS = MAX_TX_BYTES * 8;
const LOCKER_SCRIPT_BITS = 520;
const MERKLE_DEPTH = 12;

// Max padded transaction size: ceil((MAX_TX_BITS + 65) / 512) * 512 = 8704 bits
const MAX_PADDED_BITS = Math.ceil((MAX_TX_BITS + 65) / 512) * 512;

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

/**
 * Convert bits to BigInt
 */
function bitsToBigInt(bits) {
    let result = BigInt(0);
    for (let i = 0; i < bits.length; i++) {
        result = (result << BigInt(1)) | BigInt(bits[i]);
    }
    return result;
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
 */
function generateCircuitInputs(depositData, txParseResult, chainId, recipient) {
    console.log('\nGenerating circuit inputs...');

    const secret = Buffer.from(depositData.secret, 'hex');
    const secretBits = bufferToBitsBE(secret);

    // Locker script
    const lockerScript = Buffer.from(depositData.lockerScript, 'hex');
    const lockerScriptBits = padBits(bufferToBitsBE(lockerScript), LOCKER_SCRIPT_BITS);

    // Locker script hash (padded to 65 bytes)
    const lockerScriptPadded = Buffer.alloc(65);
    lockerScript.copy(lockerScriptPadded);
    const lockerHashBytes = sha256(lockerScriptPadded);
    const lockerHashBits = bufferToBitsBE(lockerHashBytes);
    const lockerScriptHash = bitsToBigInt(lockerHashBits.slice(0, 254));

    // Nullifier
    const nullifierInput = Buffer.concat([secret, Buffer.from([0x01])]);
    const nullifierHash = sha256(nullifierInput);
    const nullifierBits = bufferToBitsBE(nullifierHash);
    const nullifier = bitsToBigInt(nullifierBits.slice(0, 254));

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

    // Compute txId from stripped transaction (double SHA256)
    const txIdBytes = doubleSha256(strippedTx);
    const txIdBits = bufferToBitsBE(txIdBytes);

    // Apply SHA256 padding for circuit
    const { padded: paddedTx, numBlocks } = sha256PadForCircuit(strippedTx, MAX_PADDED_BITS);
    const paddedTxBits = bufferToBitsBE(paddedTx);

    // Display txId in Bitcoin's reversed format for verification
    const txIdDisplay = Buffer.from(txIdBytes).reverse().toString('hex');
    console.log(`  TxId (for verification): ${txIdDisplay}`);
    console.log(`  Stripped TX: ${strippedTx.length} bytes -> ${numBlocks} SHA256 blocks`);

    // Merkle proof (placeholder)
    const merkleProof = [];
    for (let i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.push(padBits([], 256).fill(0));
    }

    // Recipient as BigInt
    const recipientBigInt = BigInt(recipient);

    const circuitInput = {
        // PUBLIC INPUTS (7 total: merkleRoots[2] counts as 2)
        merkleRoots: ["12345", "67890"],  // Placeholder array for hidden root selection
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
        commitmentByteOffset: txParseResult.commitmentByteOffset,  // Where commitment starts in TX
        rootIndex: 0,  // Which merkle root the TX is in (private)
        merkleProof: merkleProof,
        merkleIndex: 0,

        // SINGLE TRANSACTION INPUT (used for everything)
        paddedTransaction: paddedTxBits,   // Stripped transaction with SHA256 padding
        numBlocks: numBlocks,              // Number of 512-bit blocks to process
        txId: txIdBits,                    // Expected SHA256(SHA256(stripped_transaction)) - 256 bits
    };

    console.log('  Public inputs prepared:');
    console.log(`    merkleRoots: [12345, 67890] (placeholders)`);
    console.log(`    nullifier: ${nullifier.toString().substring(0, 30)}...`);
    console.log(`    amount: ${txParseResult.amount} satoshis`);
    console.log(`    chainId: ${chainId}`);
    console.log(`    recipient: ${recipient}`);
    console.log(`    lockerScriptHash: ${lockerScriptHash.toString().substring(0, 30)}...`);
    console.log('  Private inputs:');
    console.log(`    lockerOutputByteOffset: ${txParseResult.lockerOutputByteOffset} bytes`);
    console.log(`    commitmentByteOffset: ${txParseResult.commitmentByteOffset} bytes`);

    return circuitInput;
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
        console.error('   node generate-claim.js --deposit=<txid>.json');
        console.error('   node generate-claim.js --txid=<txid> --secret=<hex> --lockerScript=<hex> --recipient=<addr>');
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
    // Generate circuit inputs
    // ═══════════════════════════════════════════════════════════════════
    const circuitInput = generateCircuitInputs(
        depositData,
        txParseResult,
        depositData.chainId,
        depositData.recipient
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
        merkleRoots: circuitInput.merkleRoots,  // Array for hidden root selection
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
    console.log(`  npm run zk:submit-claim -- --claim=${depositData.txid}.json --network polygon`);
}

main().catch(error => {
    console.error('\n❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
});
