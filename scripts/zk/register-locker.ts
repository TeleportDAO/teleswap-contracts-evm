/**
 * Register Locker Hash on PrivateTransferClaimTest Contract
 *
 * Usage:
 *   npx hardhat run scripts/zk/register-locker.ts --network polygon
 *
 * Environment Variables:
 *   BTC_LOCKER_ADDRESS - Bitcoin P2PKH address of the locker
 */

import { ethers } from "hardhat";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// Check for bitcoinjs-lib
let bitcoin: any;
try {
    bitcoin = require("bitcoinjs-lib");
} catch (e) {
    console.error("❌ Missing bitcoinjs-lib. Install with: npm install bitcoinjs-lib");
    process.exit(1);
}

require("dotenv").config();

interface DeploymentData {
    claimContract: string;
}

function sha256(data: Buffer): Buffer {
    return crypto.createHash("sha256").update(data).digest();
}

function bufferToBitsBE(buffer: Buffer): number[] {
    const bits: number[] = [];
    for (let i = 0; i < buffer.length; i++) {
        for (let j = 7; j >= 0; j--) {
            bits.push((buffer[i] >> j) & 1);
        }
    }
    return bits;
}

function bitsToBigInt(bits: number[]): bigint {
    let result = BigInt(0);
    for (let i = 0; i < bits.length; i++) {
        result = (result << BigInt(1)) | BigInt(bits[i]);
    }
    return result;
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

    // Compute hash (padded to 65 bytes as circuit expects)
    const lockerScriptPadded = Buffer.alloc(65);
    lockerScript.copy(lockerScriptPadded);
    const hashBytes = sha256(lockerScriptPadded);
    const hashBits = bufferToBitsBE(hashBytes);
    const lockerScriptHash = bitsToBigInt(hashBits.slice(0, 254));

    console.log(`Locker Script Hash: ${lockerScriptHash.toString()}`);

    // Load deployment
    const deploymentPath = path.join(__dirname, "../../deployments/zk/polygon.json");
    if (!fs.existsSync(deploymentPath)) {
        console.error(`❌ Deployment not found: ${deploymentPath}`);
        console.error("   Run: npx hardhat run scripts/zk/deploy-polygon.ts --network polygon");
        process.exit(1);
    }

    const deployment: DeploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    console.log(`\nContract: ${deployment.claimContract}`);

    // Get signer
    const [signer] = await ethers.getSigners();
    console.log(`Signer: ${signer.address}`);

    // Connect to contract
    const claimContract = await ethers.getContractAt(
        "PrivateTransferClaimTest",
        deployment.claimContract,
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

    // Save locker info
    const lockerInfo = {
        address: lockerAddress,
        script: lockerScript.toString("hex"),
        scriptHash: lockerScriptHash.toString(),
        registeredAt: new Date().toISOString(),
        txHash: tx.hash,
    };

    const lockersDir = path.join(__dirname, "../../deployments/zk/lockers");
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
