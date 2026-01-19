#!/usr/bin/env node

/**
 * Test ZK Proof with Realistic Bitcoin Transaction
 *
 * This script tests the ZK proof generation with a realistic Bitcoin
 * transaction structure that matches what TeleSwap would actually use:
 *
 * - P2PKH output to locker (standard 25-byte script)
 * - OP_RETURN output with commitment
 * - Realistic transaction structure
 *
 * Usage: node test_real_btc_tx.js
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');

// Circuit constants
const MAX_TX_BYTES = 1024;
const MAX_TX_BITS = MAX_TX_BYTES * 8;
const LOCKER_SCRIPT_BITS = 520;  // 65 bytes max
const MERKLE_DEPTH = 12;

// Test configuration - simulating a real TeleSwap scenario
const TEST_CONFIG = {
    // Amount being transferred (in satoshis)
    amountSatoshis: BigInt(50000000),  // 0.5 BTC

    // Target chain (Ethereum mainnet)
    chainId: BigInt(1),

    // Known locker public key hash (simulating a registered TeleSwap locker)
    // In production, this would be from the locker registry
    lockerPubKeyHash: Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex'),

    // Recipient Ethereum address
    recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8bDe0',
};

/**
 * SHA256 hash
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}

/**
 * Double SHA256 (Bitcoin style)
 */
function doubleSha256(data) {
    return sha256(sha256(data));
}

/**
 * Convert Buffer to bit array (big-endian, MSB first)
 */
function bufferToBitsBE(buffer) {
    const bits = [];
    for (let i = 0; i < buffer.length; i++) {
        for (let j = 7; j >= 0; j--) {
            bits.push((buffer[i] >> j) & 1);
        }
    }
    return bits;
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
 * Convert bits to BigInt (big-endian)
 */
function bitsToBigInt(bits) {
    let result = BigInt(0);
    for (let i = 0; i < bits.length; i++) {
        result = (result << BigInt(1)) | BigInt(bits[i]);
    }
    return result;
}

/**
 * Build a realistic Bitcoin transaction for TeleSwap private transfer
 *
 * Structure:
 * - Version: 4 bytes (version 2)
 * - Input count: 1 byte (varint)
 * - Inputs: Variable (realistic UTXO spending)
 * - Output count: 1 byte (varint)
 * - Output 0: Payment to locker (P2PKH)
 * - Output 1: OP_RETURN with commitment
 * - Locktime: 4 bytes
 */
function buildRealisticTransaction(lockerScript, amount, commitment) {
    console.log('\n📦 Building realistic Bitcoin transaction...');

    // Version 2 (supports relative lock-time)
    const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);

    // === INPUT SECTION ===
    // Simulating spending a P2PKH UTXO with a realistic signature
    const inputCount = Buffer.from([0x01]);

    // Previous transaction ID (simulating a real UTXO)
    const prevTxId = Buffer.from(
        'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        'hex'
    );

    // Previous output index (vout)
    const prevVout = Buffer.from([0x00, 0x00, 0x00, 0x00]);

    // ScriptSig for P2PKH: <sig> <pubkey>
    // Simulating a realistic DER signature (71-73 bytes) + compressed pubkey (33 bytes)
    const signature = crypto.randomBytes(71);  // DER signature
    signature[0] = 0x30;  // DER sequence tag
    signature[1] = 68;    // Length
    const pubkey = Buffer.concat([
        Buffer.from([0x02]),  // Compressed pubkey prefix
        crypto.randomBytes(32)  // X coordinate
    ]);

    const scriptSig = Buffer.concat([
        Buffer.from([signature.length]),  // Push signature length
        signature,
        Buffer.from([pubkey.length]),  // Push pubkey length
        pubkey
    ]);
    const scriptSigLen = Buffer.from([scriptSig.length]);

    // Sequence (0xffffffff for finalized, no RBF)
    const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);

    const input = Buffer.concat([
        prevTxId,
        prevVout,
        scriptSigLen,
        scriptSig,
        sequence
    ]);

    console.log(`  Input size: ${input.length} bytes (realistic P2PKH spend)`);

    // === OUTPUT SECTION ===
    const outputCount = Buffer.from([0x02]);

    // Output 0: Payment to locker (P2PKH script)
    const output0Value = Buffer.alloc(8);
    output0Value.writeBigUInt64LE(amount);
    const output0ScriptLen = Buffer.from([lockerScript.length]);
    const output0 = Buffer.concat([output0Value, output0ScriptLen, lockerScript]);

    console.log(`  Output 0: ${Number(amount)} satoshis to locker (P2PKH)`);

    // Output 1: OP_RETURN with commitment
    const output1Value = Buffer.alloc(8);  // 0 satoshis
    const opReturnScript = Buffer.concat([
        Buffer.from([0x6a]),  // OP_RETURN
        Buffer.from([0x20]),  // PUSH 32 bytes
        commitment
    ]);
    const output1ScriptLen = Buffer.from([opReturnScript.length]);
    const output1 = Buffer.concat([output1Value, output1ScriptLen, opReturnScript]);

    console.log(`  Output 1: OP_RETURN with 32-byte commitment`);

    // Locktime (0 = no lock)
    const locktime = Buffer.from([0x00, 0x00, 0x00, 0x00]);

    // Combine all parts
    const rawTx = Buffer.concat([
        version,
        inputCount,
        input,
        outputCount,
        output0,
        output1,
        locktime
    ]);

    // Calculate offsets
    const lockerOutputOffset = (version.length + inputCount.length + input.length + outputCount.length) * 8;

    console.log(`  Total TX size: ${rawTx.length} bytes`);
    console.log(`  Locker output offset: ${lockerOutputOffset} bits`);

    // Compute txId
    const txId = doubleSha256(rawTx);
    console.log(`  TxId: ${Buffer.from(txId).reverse().toString('hex')}`);

    return {
        rawTx,
        txId,
        lockerOutputOffset
    };
}

/**
 * Generate circuit input for a realistic TeleSwap private transfer
 */
function generateRealisticInput() {
    console.log('\n🔐 TeleSwap Private Transfer - Realistic Test');
    console.log('================================================\n');

    const { amountSatoshis, chainId, lockerPubKeyHash, recipientAddress } = TEST_CONFIG;

    // === Step 1: Generate user's secret ===
    const secretBytes = crypto.randomBytes(32);
    const secretBits = bufferToBitsBE(secretBytes);
    console.log('Step 1: User generates secret');
    console.log(`  Secret: ${secretBytes.toString('hex').substring(0, 16)}...`);

    // === Step 2: Compute commitment ===
    // commitment = SHA256(secret || amount || chainId)
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64BE(amountSatoshis);

    const chainIdBuffer = Buffer.alloc(2);
    chainIdBuffer.writeUInt16BE(Number(chainId));

    const commitmentInput = Buffer.concat([secretBytes, amountBuffer, chainIdBuffer]);
    const commitment = sha256(commitmentInput);

    console.log('\nStep 2: Compute commitment');
    console.log(`  commitment = SHA256(secret || amount || chainId)`);
    console.log(`  Amount: ${amountSatoshis} satoshis (${Number(amountSatoshis) / 100000000} BTC)`);
    console.log(`  Chain ID: ${chainId} (Ethereum mainnet)`);
    console.log(`  Commitment: ${commitment.toString('hex')}`);

    // === Step 3: Build locker script (P2PKH) ===
    // OP_DUP OP_HASH160 <20-byte-pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
    const lockerScriptBytes = Buffer.concat([
        Buffer.from([0x76, 0xa9, 0x14]),  // OP_DUP OP_HASH160 PUSH(20)
        lockerPubKeyHash,
        Buffer.from([0x88, 0xac])  // OP_EQUALVERIFY OP_CHECKSIG
    ]);

    console.log('\nStep 3: Locker script (P2PKH)');
    console.log(`  Script: ${lockerScriptBytes.toString('hex')}`);
    console.log(`  Length: ${lockerScriptBytes.length} bytes`);

    // Compute locker script hash (padded to 65 bytes as circuit expects)
    const lockerScriptPadded = Buffer.alloc(65);
    lockerScriptBytes.copy(lockerScriptPadded);
    const lockerHashBytes = sha256(lockerScriptPadded);
    const lockerHashBits = bufferToBitsBE(lockerHashBytes);
    const lockerScriptHash = bitsToBigInt(lockerHashBits.slice(0, 254));

    console.log(`  Script hash: ${lockerHashBytes.toString('hex').substring(0, 32)}...`);

    // === Step 4: Build Bitcoin transaction ===
    const { rawTx, txId, lockerOutputOffset } = buildRealisticTransaction(
        lockerScriptBytes,
        amountSatoshis,
        commitment
    );

    // === Step 5: Compute nullifier ===
    // nullifier = SHA256(secret || 0x01)
    const nullifierInput = Buffer.concat([secretBytes, Buffer.from([0x01])]);
    const nullifierHash = sha256(nullifierInput);
    const nullifierBits = bufferToBitsBE(nullifierHash);
    const nullifierValue = bitsToBigInt(nullifierBits.slice(0, 254));

    console.log('\nStep 5: Compute nullifier');
    console.log(`  nullifier = SHA256(secret || 0x01)`);
    console.log(`  Nullifier: ${nullifierHash.toString('hex').substring(0, 32)}...`);

    // === Step 6: Prepare Merkle proof (placeholder) ===
    console.log('\nStep 6: Merkle proof (placeholder for Phase 1)');
    const merkleProof = [];
    for (let i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.push(bufferToBitsBE(crypto.randomBytes(32)));
    }
    const merkleRoot = BigInt(12345);  // Placeholder

    // === Step 7: Recipient address ===
    const recipient = BigInt(recipientAddress);
    console.log(`\nStep 7: Recipient address`);
    console.log(`  Address: ${recipientAddress}`);

    // === Build circuit input ===
    const txBits = padBits(bufferToBitsBE(rawTx), MAX_TX_BITS);
    const commitmentBits = bufferToBitsBE(commitment);
    const lockerScriptBits = padBits(bufferToBitsBE(lockerScriptBytes), LOCKER_SCRIPT_BITS);

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
        commitmentFromTx: commitmentBits,
        transaction: txBits,
        txLength: rawTx.length,
        lockerScript: lockerScriptBits,
        lockerScriptLength: lockerScriptBytes.length,
        lockerOutputIndex: 0,
        lockerOutputOffset: lockerOutputOffset,
        merkleProof: merkleProof,
        merkleIndex: 0
    };

    console.log('\n================================================');
    console.log('📊 Circuit Input Summary');
    console.log('================================================');
    console.log('\nPUBLIC INPUTS (visible on-chain):');
    console.log(`  merkleRoot:       ${merkleRoot} (placeholder)`);
    console.log(`  nullifier:        ${nullifierValue.toString().substring(0, 30)}...`);
    console.log(`  amount:           ${amountSatoshis} satoshis`);
    console.log(`  chainId:          ${chainId}`);
    console.log(`  recipient:        ${recipientAddress}`);
    console.log(`  lockerScriptHash: ${lockerScriptHash.toString().substring(0, 30)}...`);

    console.log('\nPRIVATE INPUTS (hidden in ZK proof):');
    console.log(`  secret:           256 bits`);
    console.log(`  commitmentFromTx: 256 bits`);
    console.log(`  transaction:      ${rawTx.length} bytes (padded to ${MAX_TX_BYTES})`);
    console.log(`  lockerScript:     ${lockerScriptBytes.length} bytes (P2PKH)`);
    console.log(`  lockerOutputOffset: ${lockerOutputOffset} bits`);

    return circuitInput;
}

/**
 * Run the full test: generate input, generate proof, verify proof
 */
async function runTest() {
    const projectRoot = path.join(__dirname, '..', '..');
    const buildDir = path.join(__dirname, '..', 'build');

    try {
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║     TeleSwap Private Transfer - Realistic Bitcoin TX Test  ║');
        console.log('╚════════════════════════════════════════════════════════════╝');

        // Step 1: Generate realistic input
        const circuitInput = generateRealisticInput();

        // Save input
        const inputPath = path.join(buildDir, 'input_realistic.json');
        fs.writeFileSync(inputPath, JSON.stringify(circuitInput, null, 2));
        console.log(`\n✓ Input saved to: ${inputPath}`);

        // Step 2: Generate witness
        console.log('\n📝 Generating witness...');
        const wasmPath = path.join(buildDir, 'main_js', 'main.wasm');
        const witnessPath = path.join(buildDir, 'witness_realistic.wtns');

        if (!fs.existsSync(wasmPath)) {
            throw new Error(`WASM file not found: ${wasmPath}\nRun 'npm run zk:setup' first.`);
        }

        execSync(
            `cd ${buildDir}/main_js && node generate_witness.js main.wasm ../input_realistic.json ../witness_realistic.wtns`,
            { stdio: 'pipe' }
        );
        console.log('✓ Witness generated');

        // Step 3: Generate proof
        console.log('\n🔐 Generating ZK proof...');
        const zkeyPath = path.join(buildDir, 'circuit_final.zkey');
        const proofPath = path.join(buildDir, 'proof_realistic.json');
        const publicPath = path.join(buildDir, 'public_realistic.json');

        if (!fs.existsSync(zkeyPath)) {
            throw new Error(`Zkey file not found: ${zkeyPath}\nRun 'npm run zk:setup' first.`);
        }

        const startTime = Date.now();
        execSync(
            `npx snarkjs groth16 prove ${zkeyPath} ${witnessPath} ${proofPath} ${publicPath}`,
            { stdio: 'pipe', cwd: projectRoot }
        );
        const proofTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✓ Proof generated (${proofTime}s)`);

        // Step 4: Verify proof
        console.log('\n✅ Verifying proof...');
        const vkeyPath = path.join(buildDir, 'verification_key.json');

        const verifyOutput = execSync(
            `npx snarkjs groth16 verify ${vkeyPath} ${publicPath} ${proofPath}`,
            { encoding: 'utf8', cwd: projectRoot }
        );

        if (verifyOutput.includes('OK')) {
            console.log('✓ PROOF IS VALID');
        } else {
            throw new Error('Proof verification failed');
        }

        // Step 5: Display public signals
        console.log('\n📤 Public signals (would be submitted on-chain):');
        const publicSignals = JSON.parse(fs.readFileSync(publicPath, 'utf8'));
        console.log(`  [0] merkleRoot:       ${publicSignals[0]}`);
        console.log(`  [1] nullifier:        ${publicSignals[1].substring(0, 30)}...`);
        console.log(`  [2] amount:           ${publicSignals[2]} satoshis`);
        console.log(`  [3] chainId:          ${publicSignals[3]}`);
        console.log(`  [4] recipient:        ${publicSignals[4].substring(0, 30)}...`);
        console.log(`  [5] lockerScriptHash: ${publicSignals[5].substring(0, 30)}...`);

        // Step 6: Generate Solidity calldata
        console.log('\n📋 Generating Solidity calldata...');
        const calldataOutput = execSync(
            `npx snarkjs zkey export soliditycalldata ${publicPath} ${proofPath}`,
            { encoding: 'utf8', cwd: projectRoot }
        );

        const calldataPath = path.join(buildDir, 'calldata_realistic.txt');
        fs.writeFileSync(calldataPath, calldataOutput);
        console.log(`✓ Calldata saved to: ${calldataPath}`);

        // Summary
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                    TEST PASSED ✓                           ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log('\nGenerated files:');
        console.log(`  - ${inputPath}`);
        console.log(`  - ${witnessPath}`);
        console.log(`  - ${proofPath}`);
        console.log(`  - ${publicPath}`);
        console.log(`  - ${calldataPath}`);

        console.log('\n📌 What this test proved:');
        console.log('  1. User knows secret that creates commitment in Bitcoin TX');
        console.log('  2. Bitcoin TX sends correct amount to registered locker');
        console.log('  3. Nullifier is correctly derived from secret');
        console.log('  4. Proof can be verified on-chain');

        console.log('\n📌 In production, the smart contract would also verify:');
        console.log('  - lockerScriptHash is in the registered lockers list');
        console.log('  - nullifier has not been used before');
        console.log('  - merkleRoot is a valid Bitcoin block header (Phase 2)');

    } catch (error) {
        console.error(`\n❌ Test failed: ${error.message}`);
        if (error.stdout) console.error('stdout:', error.stdout.toString());
        if (error.stderr) console.error('stderr:', error.stderr.toString());
        process.exit(1);
    }
}

// Run test
runTest();
