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
 * Parse Bitcoin transaction to find locker output and commitment
 */
function parseTransaction(txHex, txData, lockerAddress) {
    console.log('\nParsing transaction...');

    const rawTx = Buffer.from(txHex, 'hex');
    console.log(`  Raw TX size: ${rawTx.length} bytes`);

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

    for (const vout of txData.vout) {
        if (vout.scriptpubkey_type === 'op_return') {
            // OP_RETURN script: 6a 20 <32-byte-commitment>
            const script = vout.scriptpubkey;
            if (script.startsWith('6a20') && script.length === 68) {
                commitmentHex = script.substring(4);  // Remove 6a20 prefix
                console.log(`  Found commitment: ${commitmentHex}`);
            }
        }
    }

    if (!commitmentHex) {
        throw new Error('Commitment not found in OP_RETURN output');
    }

    // Calculate locker output offset
    // We need to find the byte offset where the locker output starts in the raw TX
    // This requires parsing the TX structure

    let offset = 0;

    // Version (4 bytes)
    offset += 4;

    // Check for witness marker
    let hasWitness = false;
    if (rawTx[offset] === 0x00 && rawTx[offset + 1] === 0x01) {
        hasWitness = true;
        offset += 2;  // Skip marker and flag
    }

    // Input count (varint)
    const { value: inputCount, size: inputCountSize } = readVarInt(rawTx, offset);
    offset += inputCountSize;

    // Skip inputs
    for (let i = 0; i < inputCount; i++) {
        offset += 32;  // Previous txid
        offset += 4;   // Previous vout
        const { value: scriptLen, size: scriptLenSize } = readVarInt(rawTx, offset);
        offset += scriptLenSize;
        offset += scriptLen;  // Script
        offset += 4;   // Sequence
    }

    // Output count (varint)
    const { value: outputCount, size: outputCountSize } = readVarInt(rawTx, offset);
    offset += outputCountSize;

    // Find locker output offset
    let lockerOutputOffset = 0;
    for (let i = 0; i < outputCount; i++) {
        if (i === lockerOutputIndex) {
            lockerOutputOffset = offset * 8;  // Convert to bits
            console.log(`  Locker output offset: ${offset} bytes = ${lockerOutputOffset} bits`);
        }

        offset += 8;  // Value (8 bytes)
        const { value: scriptLen, size: scriptLenSize } = readVarInt(rawTx, offset);
        offset += scriptLenSize;
        offset += scriptLen;  // Script
    }

    return {
        lockerOutputIndex,
        lockerOutputOffset,
        amount: lockerOutput.value,
        commitment: Buffer.from(commitmentHex, 'hex'),
        rawTx,
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

    // Transaction bits
    const txBits = padBits(bufferToBitsBE(txParseResult.rawTx), MAX_TX_BITS);

    // Commitment bits
    const commitmentBits = bufferToBitsBE(txParseResult.commitment);

    // Merkle proof (placeholder)
    const merkleProof = [];
    for (let i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.push(padBits([], 256).fill(0));
    }

    // Recipient as BigInt
    const recipientBigInt = BigInt(recipient);

    const circuitInput = {
        // PUBLIC INPUTS
        merkleRoot: "12345",  // Placeholder
        nullifier: nullifier.toString(),
        amount: txParseResult.amount.toString(),
        chainId: chainId.toString(),
        recipient: recipientBigInt.toString(),
        lockerScriptHash: lockerScriptHash.toString(),

        // PRIVATE INPUTS
        secret: secretBits,
        commitmentFromTx: commitmentBits,
        transaction: txBits,
        txLength: txParseResult.rawTx.length,
        lockerScript: lockerScriptBits,
        lockerScriptLength: lockerScript.length,
        lockerOutputIndex: txParseResult.lockerOutputIndex,
        lockerOutputOffset: txParseResult.lockerOutputOffset,
        merkleProof: merkleProof,
        merkleIndex: 0,
    };

    console.log('  Public inputs prepared:');
    console.log(`    merkleRoot: 12345 (placeholder)`);
    console.log(`    nullifier: ${nullifier.toString().substring(0, 30)}...`);
    console.log(`    amount: ${txParseResult.amount} satoshis`);
    console.log(`    chainId: ${chainId}`);
    console.log(`    recipient: ${recipient}`);
    console.log(`    lockerScriptHash: ${lockerScriptHash.toString().substring(0, 30)}...`);

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
        merkleRoot: circuitInput.merkleRoot,
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
