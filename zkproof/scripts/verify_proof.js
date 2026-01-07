#!/usr/bin/env node

/**
 * ZK Proof Verifier
 *
 * Verifies a zero-knowledge proof off-chain using the verification key.
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
 * Verify ZK proof
 */
async function verifyProof(proofPath, publicPath, vkeyPath) {
    log("\n================================================", 'cyan');
    log("   Verifying ZK Proof", 'cyan');
    log("================================================\n", 'cyan');

    // Check if files exist
    if (!fs.existsSync(proofPath)) {
        log(`Error: Proof file not found at ${proofPath}`, 'red');
        log("Generate a proof first: npm run zk:generate-proof", 'yellow');
        process.exit(1);
    }

    if (!fs.existsSync(publicPath)) {
        log(`Error: Public signals file not found at ${publicPath}`, 'red');
        process.exit(1);
    }

    if (!fs.existsSync(vkeyPath)) {
        log(`Error: Verification key not found at ${vkeyPath}`, 'red');
        log("Run trusted setup: npm run circuit:setup", 'yellow');
        process.exit(1);
    }

    try {
        // Load files
        log("Loading proof files...", 'yellow');
        const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
        const publicSignals = JSON.parse(fs.readFileSync(publicPath, 'utf8'));
        const vKey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

        log("✓ Files loaded", 'green');
        log("", 'reset');

        // Display public signals
        log("Public signals:", 'yellow');
        const signalNames = ['merkleRoot', 'voutHash', 'blockNumber'];
        publicSignals.forEach((signal, idx) => {
            const name = signalNames[idx] || `signal[${idx}]`;
            log(`  ${name}: ${signal}`, 'reset');
        });
        log("", 'reset');

        // Verify the proof
        log("Verifying proof...", 'yellow');
        const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);

        log("", 'reset');
        log("================================================", 'cyan');
        log("   Verification Result", 'cyan');
        log("================================================\n", 'cyan');

        if (isValid) {
            log("✓ PROOF IS VALID", 'green');
            log("", 'reset');
            log("The proof successfully demonstrates:", 'yellow');
            log("  1. Knowledge of a Bitcoin transaction", 'reset');
            log("  2. Transaction is included in the specified Merkle root", 'reset');
            log("  3. The revealed vout hash matches the transaction", 'reset');
            log("  4. All without revealing the full transaction", 'reset');
            log("", 'reset');
            return true;
        } else {
            log("✗ PROOF IS INVALID", 'red');
            log("", 'reset');
            log("Possible reasons:", 'yellow');
            log("  - Proof was tampered with", 'reset');
            log("  - Public signals don't match the proof", 'reset');
            log("  - Wrong verification key used", 'reset');
            log("", 'reset');
            return false;
        }

    } catch (error) {
        log("\n✗ Verification failed", 'red');
        log(`Error: ${error.message}`, 'red');
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    const buildDir = 'zkproof/build';

    const proofPath = path.join(buildDir, 'proof.json');
    const publicPath = path.join(buildDir, 'public.json');
    const vkeyPath = path.join(buildDir, 'verification_key.json');

    try {
        const isValid = await verifyProof(proofPath, publicPath, vkeyPath);
        process.exit(isValid ? 0 : 1);
    } catch (error) {
        log(`\nFatal error: ${error.message}`, 'red');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { verifyProof };
