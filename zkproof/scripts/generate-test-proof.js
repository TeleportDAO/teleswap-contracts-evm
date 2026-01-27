#!/usr/bin/env node

/**
 * ZK Proof Generator for Private Transfer
 *
 * Generates a zero-knowledge proof for the Private Transfer circuit.
 * Uses snarkjs for witness calculation and proof generation.
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

// Import the input generator
const { generateCircuitInput } = require("./generate-test-witness.js");

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Generate ZK proof from input
 */
async function generateProof(input, outputDir = 'zkproof/build') {
    const wasmPath = path.join(outputDir, 'main_js', 'main.wasm');
    const zkeyPath = path.join(outputDir, 'circuit_final.zkey');

    log("\n================================================", 'cyan');
    log("   ZK Proof Generator - Private Transfer", 'cyan');
    log("================================================\n", 'cyan');

    // Check required files
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

    // Display input summary
    log("Input Summary:", 'yellow');
    log(`  Amount: ${input.amount} satoshis`, 'dim');
    log(`  Chain ID: ${input.chainId}`, 'dim');
    log(`  Padded TX bits: ${input.paddedTransaction.length}`, 'dim');
    log(`  Num blocks: ${input.numBlocks}`, 'dim');
    log(`  Merkle depth: ${input.merkleDepth}`, 'dim');
    log("", 'reset');

    try {
        log("Step 1: Calculating witness...", 'yellow');
        const startWitness = Date.now();

        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            wasmPath,
            zkeyPath
        );

        const witnessTime = ((Date.now() - startWitness) / 1000).toFixed(2);
        log(`  Witness calculated (${witnessTime}s)`, 'green');
        log(`  Proof generated`, 'green');

        // Save outputs
        const proofPath = path.join(outputDir, 'proof.json');
        const publicPath = path.join(outputDir, 'public.json');

        fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2));
        fs.writeFileSync(publicPath, JSON.stringify(publicSignals, null, 2));

        log("\nStep 2: Exporting Solidity calldata...", 'yellow');
        const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);

        const calldataPath = path.join(outputDir, 'calldata.txt');
        fs.writeFileSync(calldataPath, calldata);
        log(`  Calldata exported`, 'green');

        // Display results
        log("\n================================================", 'cyan');
        log("   Proof Generation Complete", 'cyan');
        log("================================================\n", 'cyan');

        log("Generated files:", 'yellow');
        log(`  ${proofPath}`, 'dim');
        log(`  ${publicPath}`, 'dim');
        log(`  ${calldataPath}`, 'dim');
        log("", 'reset');

        // Parse and display public signals
        // Order: merkleRoots[0], merkleRoots[1], nullifier, amount, chainId, recipient, lockerScriptHash
        const signalNames = [
            'merkleRoots[0]',
            'merkleRoots[1]',
            'nullifier',
            'amount',
            'chainId',
            'recipient',
            'lockerScriptHash'
        ];

        log("Public signals:", 'yellow');
        for (let i = 0; i < Math.min(publicSignals.length, signalNames.length); i++) {
            const name = signalNames[i];
            const value = publicSignals[i];
            const display = value.length > 40 ? value.substring(0, 37) + '...' : value;
            log(`  [${i}] ${name}: ${display}`, 'dim');
        }
        log("", 'reset');

        log("Next steps:", 'yellow');
        log("  1. Verify proof: npm run zk:verify-test-proof", 'dim');
        log("  2. Submit on-chain: npm run zk:submit-proof", 'dim');
        log("", 'reset');

        return { proof, publicSignals };

    } catch (error) {
        log("\n Error: Proof generation failed", 'red');
        log(`${error.message}`, 'red');

        if (error.message.includes('Assert Failed')) {
            log("\nConstraint not satisfied. Common causes:", 'yellow');
            log("  - Commitment mismatch (check secret/amount/chainId/recipient)", 'dim');
            log("  - Nullifier mismatch (check secret || 0x01)", 'dim');
            log("  - Locker script hash mismatch (check 65-byte padding)", 'dim');
            log("  - TxId mismatch (check SHA256 padding)", 'dim');
            log("  - Merkle proof invalid", 'dim');
        }

        throw error;
    }
}

/**
 * Verify proof locally
 */
async function verifyProof(outputDir = 'zkproof/build') {
    const vkeyPath = path.join(outputDir, 'verification_key.json');
    const proofPath = path.join(outputDir, 'proof.json');
    const publicPath = path.join(outputDir, 'public.json');

    if (!fs.existsSync(vkeyPath) || !fs.existsSync(proofPath) || !fs.existsSync(publicPath)) {
        log("Missing verification files. Run proof generation first.", 'red');
        return false;
    }

    const vkey = JSON.parse(fs.readFileSync(vkeyPath));
    const proof = JSON.parse(fs.readFileSync(proofPath));
    const publicSignals = JSON.parse(fs.readFileSync(publicPath));

    log("\nVerifying proof...", 'yellow');
    const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);

    if (isValid) {
        log("Proof is VALID", 'green');
    } else {
        log("Proof is INVALID", 'red');
    }

    return isValid;
}

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'generate';

    try {
        if (command === 'verify') {
            await verifyProof();
        } else if (command === 'generate') {
            // Generate fresh input
            log("\nGenerating circuit input...", 'yellow');
            const input = generateCircuitInput();

            // Save input for debugging
            const inputPath = 'zkproof/build/input.json';
            fs.mkdirSync(path.dirname(inputPath), { recursive: true });
            fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
            log(`Input saved to ${inputPath}`, 'green');

            // Generate proof
            await generateProof(input);

            // Verify locally
            await verifyProof();

        } else {
            log(`Unknown command: ${command}`, 'red');
            log("Usage: node generate-test-proof.js [generate|verify]", 'yellow');
            process.exit(1);
        }

    } catch (error) {
        log(`\nFatal error: ${error.message}`, 'red');
        if (process.env.DEBUG) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run
if (require.main === module) {
    main().then(() => {
        process.exit(0);
    });
}

module.exports = { generateProof, verifyProof };
