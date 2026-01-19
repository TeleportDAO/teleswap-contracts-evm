#!/usr/bin/env node

/**
 * ZK Proof Generator for Private Transfer
 *
 * Generates a zero-knowledge proof for the Private Transfer circuit.
 * Uses input from zkproof/test-data/generate_input.js
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

// Import the input generator
const { generateTestInput } = require("../test-data/generate_input.js");

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
 * Generate ZK proof
 */
async function generateProof(input, outputDir = 'zkproof/build') {
    const wasmPath = path.join(outputDir, 'main_js', 'main.wasm');
    const zkeyPath = path.join(outputDir, 'circuit_final.zkey');

    log("\n================================================", 'cyan');
    log("   Generating ZK Proof (Private Transfer)", 'cyan');
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
    log(`  Amount: ${input.amount} satoshis`, 'reset');
    log(`  Chain ID: ${input.chainId}`, 'reset');
    log(`  Transaction bits: ${input.transaction.length}`, 'reset');
    log(`  TX length: ${input.txLength} bytes`, 'reset');
    log(`  Secret bits: ${input.secret.length}`, 'reset');
    log("", 'reset');

    try {
        log("Step 1: Calculating witness...", 'yellow');
        const startTime = Date.now();

        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            wasmPath,
            zkeyPath
        );

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`✓ Witness calculated (${elapsed}s)`, 'green');
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

        log("Public signals (6 values):", 'yellow');
        const signalNames = ['merkleRoot', 'nullifier', 'amount', 'chainId', 'recipient', 'lockerScriptHash'];
        publicSignals.forEach((signal, idx) => {
            const name = signalNames[idx] || `signal_${idx}`;
            const display = signal.length > 40 ? signal.substring(0, 40) + '...' : signal;
            log(`  [${idx}] ${name}: ${display}`, 'reset');
        });
        log("", 'reset');

        log("Next step:", 'yellow');
        log("  Verify the proof: npm run zk:verify-proof", 'reset');
        log("", 'reset');

        return { proof, publicSignals };

    } catch (error) {
        log("\n✗ Proof generation failed", 'red');
        log(`Error: ${error.message}`, 'red');

        if (error.message.includes('Assert Failed')) {
            log("\nTip: A constraint was not satisfied. Check:", 'yellow');
            log("  - Commitment matches SHA256(secret || amount || chainId)", 'yellow');
            log("  - Nullifier matches SHA256(secret || 0x01)", 'yellow');
            log("  - Locker script hash is correct", 'yellow');
        }

        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        // Generate fresh input using the test-data generator
        log("\n📝 Generating circuit input...", 'yellow');
        const input = generateTestInput();

        // Save input for reference
        const inputPath = 'zkproof/build/input.json';
        fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
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

module.exports = { generateProof };
