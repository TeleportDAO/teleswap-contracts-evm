#!/usr/bin/env node

/**
 * ZK Proof Generator for Bitcoin Transaction Privacy
 *
 * Generates a zero-knowledge proof that demonstrates knowledge of a Bitcoin
 * transaction and a specific vout, without revealing the entire transaction.
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Convert hex string to bit array
 */
function hexToBits(hex) {
    const bytes = Buffer.from(hex, 'hex');
    const bits = [];

    for (let i = 0; i < bytes.length; i++) {
        for (let j = 7; j >= 0; j--) {
            bits.push((bytes[i] >> j) & 1);
        }
    }

    return bits;
}

/**
 * Convert bytes to bit array (little-endian)
 */
function bytesToBitsLE(bytes) {
    const bits = [];
    for (let i = 0; i < bytes.length; i++) {
        for (let j = 0; j < 8; j++) {
            bits.push((bytes[i] >> j) & 1);
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
 * Calculate SHA256 hash
 */
function sha256(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest();
}

/**
 * Calculate double SHA256 (Bitcoin style)
 */
function doubleSha256(data) {
    return sha256(sha256(data));
}

/**
 * Generate sample input for testing
 */
function generateSampleInput() {
    log("\nGenerating sample test input...", 'yellow');

    // Sample Bitcoin transaction (simplified)
    const sampleTx = Buffer.alloc(256);
    sampleTx.write("0100000001", 'hex'); // version + input count

    // Sample vout data (64 bytes)
    const sampleVout = Buffer.alloc(64);
    sampleVout.write("00e1f50500000000", 'hex'); // value: 1 BTC in satoshis

    // Calculate hashes
    const txHash = doubleSha256(sampleTx);
    const voutHash = sha256(sampleVout);

    // Sample Merkle root (would come from Bitcoin block header)
    const merkleRoot = Buffer.from("a".repeat(64), 'hex');

    // Sample Merkle siblings (12 levels for POC)
    const merkleSiblings = Array(12).fill(0).map(() =>
        Buffer.from("b".repeat(64), 'hex')
    );

    return {
        // Public inputs
        merkleRoot: BigInt('0x' + merkleRoot.toString('hex')),
        voutHash: BigInt('0x' + voutHash.toString('hex')),
        blockNumber: 800000,

        // Private inputs
        transaction: padBits(bytesToBitsLE(sampleTx), 2048),
        voutData: padBits(bytesToBitsLE(sampleVout), 512),
        voutOffset: 42,
        merkleSiblings: merkleSiblings.map(s => BigInt('0x' + s.toString('hex'))),
        merkleIndex: 42
    };
}

/**
 * Generate ZK proof
 */
async function generateProof(input, outputDir = 'zkproof/build') {
    const wasmPath = path.join(outputDir, 'main.wasm');
    const zkeyPath = path.join(outputDir, 'circuit_final.zkey');

    log("\n================================================", 'cyan');
    log("   Generating ZK Proof", 'cyan');
    log("================================================\n", 'cyan');

    // Check if required files exist
    if (!fs.existsSync(wasmPath)) {
        log(`Error: WASM file not found at ${wasmPath}`, 'red');
        log("Run: npm run circuit:compile", 'yellow');
        process.exit(1);
    }

    if (!fs.existsSync(zkeyPath)) {
        log(`Error: Proving key not found at ${zkeyPath}`, 'red');
        log("Run: npm run circuit:setup", 'yellow');
        process.exit(1);
    }

    log("Input summary:", 'yellow');
    log(`  Merkle Root: ${input.merkleRoot.toString(16)}`, 'reset');
    log(`  Vout Hash: ${input.voutHash.toString(16)}`, 'reset');
    log(`  Block Number: ${input.blockNumber}`, 'reset');
    log(`  Merkle Index: ${input.merkleIndex}`, 'reset');
    log("", 'reset');

    try {
        log("Step 1: Calculating witness...", 'yellow');
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            wasmPath,
            zkeyPath
        );

        log("✓ Witness calculated", 'green');
        log("✓ Proof generated", 'green');

        // Export proof
        const proofPath = path.join(outputDir, 'proof.json');
        const publicPath = path.join(outputDir, 'public.json');

        fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2));
        fs.writeFileSync(publicPath, JSON.stringify(publicSignals, null, 2));

        log("\nStep 2: Exporting Solidity calldata...", 'yellow');
        const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);

        const calldataPath = path.join(outputDir, 'calldata.txt');
        fs.writeFileSync(calldataPath, calldata);

        log("✓ Calldata exported", 'green');

        log("\n================================================", 'cyan');
        log("   Proof Generation Complete", 'cyan');
        log("================================================\n", 'cyan');

        log("Generated files:", 'yellow');
        log(`  - ${proofPath}`, 'reset');
        log(`  - ${publicPath}`, 'reset');
        log(`  - ${calldataPath}`, 'reset');
        log("", 'reset');

        log("Public signals:", 'yellow');
        publicSignals.forEach((signal, idx) => {
            log(`  [${idx}] ${signal}`, 'reset');
        });
        log("", 'reset');

        log("Next step:", 'yellow');
        log("  Verify the proof: npm run zk:verify-proof", 'reset');
        log("", 'reset');

        return { proof, publicSignals };

    } catch (error) {
        log("\n✗ Proof generation failed", 'red');
        log(`Error: ${error.message}`, 'red');

        if (error.message.includes('Signal not assigned')) {
            log("\nTip: Check that all circuit constraints are satisfied", 'yellow');
        }

        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        // For now, use sample input
        // TODO: Add CLI argument parsing for real Bitcoin transactions
        const input = generateSampleInput();

        // Save input for reference
        const inputPath = 'zkproof/build/input.json';
        fs.writeFileSync(inputPath, JSON.stringify(input, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        , 2));

        log(`✓ Input saved to ${inputPath}`, 'green');

        // Generate proof
        await generateProof(input);

    } catch (error) {
        log(`\nFatal error: ${error.message}`, 'red');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { generateProof, generateSampleInput };
