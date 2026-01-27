/**
 * Register Locker Hash on PrivateTransferClaim Contract
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY LOCKER SCRIPT HASH INSTEAD OF LOCKER SCRIPT DIRECTLY?
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The locker script hash is a SYSTEM IDENTIFIER (Type 2 hash in our system).
 * It's NOT a Bitcoin standard hash - it's our construct for locker identification.
 *
 * We hash the script instead of using it directly because:
 *
 * 1. FIXED SIZE FOR PUBLIC INPUT
 *    - Bitcoin scripts have variable lengths (P2PKH=25, P2SH=23, P2WPKH=22 bytes)
 *    - ZK circuit public inputs must be single field elements (~254 bits)
 *    - Hashing produces a fixed-size identifier regardless of script type
 *
 * 2. EFFICIENT ON-CHAIN STORAGE
 *    - Smart contract stores: mapping(uint256 => bool) isValidLockerHash
 *    - One field element per locker, not variable-length bytes
 *    - Cheaper gas for storage and comparison
 *
 * 3. SECURITY MODEL
 *    - Circuit PROVES: "TX sent BTC to script S, and SHA256(S) = H"
 *    - Contract VERIFIES: "H is in our registry of approved lockers"
 *    - Result: Only deposits to registered lockers can mint teleBTC
 *
 * IMPORTANT: This hash uses BN254 field modulo because it's a public input.
 * The circuit automatically applies modulo via Bits2Num(254).
 * This script must apply the same modulo to match.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   npx hardhat run scripts/zk/register-locker.ts --network polygon
 *
 *   Or with deploy command:
 *   NETWORK=polygon TAG=zk npm run config
 *
 * Environment Variables:
 *   BTC_LOCKER_ADDRESS - Bitcoin P2PKH address of the locker
 */

import { ethers, deployments } from "hardhat";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import zkConfig from "../../config/zk.json";

// Check for bitcoinjs-lib
let bitcoin: any;
try {
    bitcoin = require("bitcoinjs-lib");
} catch (e) {
    console.error("❌ Missing bitcoinjs-lib. Install with: npm install bitcoinjs-lib");
    process.exit(1);
}

require("dotenv").config();

// BN254 scalar field prime (used by Groth16 on this curve)
const BN254_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

function sha256(data: Buffer): Buffer {
    return crypto.createHash("sha256").update(data).digest();
}

/**
 * Convert Buffer to bit array (big-endian, MSB first per byte)
 * This matches circomlib SHA256 input/output format.
 */
function bufferToBitsBE(buffer: Buffer): number[] {
    const bits: number[] = [];
    for (let i = 0; i < buffer.length; i++) {
        for (let j = 7; j >= 0; j--) {
            bits.push((buffer[i] >> j) & 1);
        }
    }
    return bits;
}

/**
 * Compute locker script hash exactly as the circuit does.
 *
 * The circuit:
 * 1. Hashes the 65-byte (520-bit) zero-padded locker script with SHA256
 * 2. Converts the first 254 bits to a field element using Bits2Num
 *    - Bits2Num.in[i] = SHA256.out[253 - i]
 *    - Result = sum(in[i] * 2^i) for i=0..253
 * 3. The result is automatically reduced modulo the BN254 field prime
 *
 * This function replicates that exact computation.
 */
function computeLockerScriptHash(lockerScript: Buffer): bigint {
    // 1. Pad locker script to 65 bytes (circuit uses 520 bits)
    const paddedScript = Buffer.alloc(65);
    lockerScript.copy(paddedScript);

    // 2. Compute SHA256
    const hash = sha256(paddedScript);

    // 3. Convert to bits (big-endian, MSB first per byte)
    const hashBits = bufferToBitsBE(hash);

    // 4. Convert to field element using Bits2Num logic:
    //    Circuit does: bits2num.in[i] = hasher.out[253 - i]
    //    Bits2Num computes: result = sum(in[i] * 2^i)
    //    So: result = sum(hashBits[253 - i] * 2^i) for i=0..253
    let fieldElement = BigInt(0);
    for (let i = 0; i < 254; i++) {
        if (hashBits[253 - i]) {
            fieldElement += BigInt(1) << BigInt(i);
        }
    }

    // 5. Apply modulo BN254 field prime (circuit does this automatically)
    fieldElement = fieldElement % BN254_PRIME;

    return fieldElement;
}

async function main() {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║           Register Locker Hash on Polygon                  ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    const lockerAddress = process.env.BTC_LOCKER_ADDRESS;
    if (!lockerAddress) {
        console.error("❌ BTC_LOCKER_ADDRESS not set in .env");
        process.exit(1);
    }

    console.log(`Locker Bitcoin Address: ${lockerAddress}`);

    // Convert address to script
    const lockerScript = bitcoin.address.toOutputScript(lockerAddress, bitcoin.networks.bitcoin);
    console.log(`Locker Script: ${lockerScript.toString("hex")}`);
    console.log(`Script Length: ${lockerScript.length} bytes`);

    // Compute hash using the same method as the circuit
    // (SHA256 of 65-byte padded script, then Bits2Num conversion with BN254 modulo)
    const lockerScriptHash = computeLockerScriptHash(lockerScript);

    console.log(`Locker Script Hash: ${lockerScriptHash.toString()}`);

    // Load deployment from hardhat-deploy
    let claimContractAddress: string;
    try {
        const deployment = await deployments.get("PrivateTransferClaim");
        claimContractAddress = deployment.address;
    } catch (e) {
        console.error(`❌ Deployment not found for PrivateTransferClaim`);
        console.error("   Run: NETWORK=<network> TAG=zk npm run deploy");
        process.exit(1);
    }

    console.log(`\nContract: ${claimContractAddress}`);

    // Get signer
    const [signer] = await ethers.getSigners();
    console.log(`Signer: ${signer.address}`);

    // Connect to contract
    const claimContract = await ethers.getContractAt(
        "PrivateTransferClaim",
        claimContractAddress,
        signer
    );

    // Check if already registered
    const isValid = await claimContract.isValidLockerHash(lockerScriptHash.toString());
    if (isValid) {
        console.log("\n✓ Locker hash already registered!");
        process.exit(0);
    }

    // Register locker hash
    console.log("\nRegistering locker hash...");
    const tx = await claimContract.registerLockerHash(
        lockerScriptHash.toString(),
        lockerScript
    );

    console.log(`  TX Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  ✓ Confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    // Verify registration
    const isNowValid = await claimContract.isValidLockerHash(lockerScriptHash.toString());
    if (isNowValid) {
        console.log("\n✓ Locker hash registered successfully!");
    } else {
        console.error("\n❌ Registration verification failed");
        process.exit(1);
    }

    // Save locker info to zkproof/lockers directory
    const network = await ethers.provider.getNetwork();
    const lockerInfo = {
        address: lockerAddress,
        script: lockerScript.toString("hex"),
        scriptHash: lockerScriptHash.toString(),
        network: network.name,
        chainId: network.chainId,
        registeredAt: new Date().toISOString(),
        txHash: tx.hash,
    };

    const lockersDir = path.join(__dirname, "../../zkproof/lockers");
    if (!fs.existsSync(lockersDir)) {
        fs.mkdirSync(lockersDir, { recursive: true });
    }

    const lockerFile = path.join(lockersDir, `${lockerAddress}.json`);
    fs.writeFileSync(lockerFile, JSON.stringify(lockerInfo, null, 2));
    console.log(`\nLocker info saved to: ${lockerFile}`);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error("\n❌ Error:", error.message);
        process.exit(1);
    });
