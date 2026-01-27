/**
 * Submit ZK Claim
 *
 * This script submits a generated ZK proof to the PrivateTransferClaim contract.
 *
 * Usage:
 *   npx hardhat run scripts/zk/submit-proof.ts --network polygon -- --claim=<txid>.json
 *
 * Or with npm:
 *   npm run zk:submit-proof -- --claim=<txid>.json --network polygon
 */

import { ethers, deployments } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import zkConfig from "../../config/zk.json";

interface ClaimData {
    txid: string;
    amount: number;
    chainId: number;
    recipient: string;
    nullifier: string;
    lockerScriptHash: string;
    merkleRoots: string[];  // Array of 2 roots for hidden selection
    calldata: string;
}

async function main() {
    const network = await ethers.provider.getNetwork();

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log(`║           Submit ZK Claim on ${network.name.padEnd(24)}║`);
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    // Parse arguments - support both --claim= arg and CLAIM_FILE env var
    const claimArg = process.argv.find(arg => arg.startsWith("--claim="));
    const claimFileName = claimArg ? claimArg.split("=")[1] : process.env.CLAIM_FILE;

    if (!claimFileName) {
        console.error("❌ Usage: CLAIM_FILE=<txid>.json npx hardhat run scripts/zk/submit-proof.ts --network polygon");
        console.error("   Or:   npx hardhat run scripts/zk/submit-proof.ts --network polygon (with --claim=<file> in argv)");
        process.exit(1);
    }
    const claimPath = claimFileName.startsWith("/")
        ? claimFileName
        : path.join(__dirname, "../../zkproof/claims", claimFileName);

    if (!fs.existsSync(claimPath)) {
        console.error(`❌ Claim file not found: ${claimPath}`);
        process.exit(1);
    }

    // Load claim data
    const claimData: ClaimData = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    console.log("Claim Data:");
    console.log(`  TxId:     ${claimData.txid}`);
    console.log(`  Amount:   ${claimData.amount} satoshis`);
    console.log(`  Recipient: ${claimData.recipient}`);

    // Load deployment data from hardhat-deploy
    let claimContractAddress: string;
    let verifierAddress: string;
    try {
        const claimDeployment = await deployments.get("PrivateTransferClaim");
        const verifierDeployment = await deployments.get("Groth16Verifier");
        claimContractAddress = claimDeployment.address;
        verifierAddress = verifierDeployment.address;
    } catch (e) {
        console.error(`❌ Deployment not found for ZK contracts`);
        console.error("   Run: NETWORK=<network> TAG=zk npm run deploy");
        process.exit(1);
    }

    console.log(`\nContract: ${claimContractAddress}`);

    // Get signer
    const [signer] = await ethers.getSigners();
    console.log(`Signer:   ${signer.address}`);

    const balance = await signer.getBalance();
    console.log(`Balance:  ${ethers.utils.formatEther(balance)} MATIC`);

    // Parse calldata to get proof components
    // Calldata format: ["pA[0]","pA[1]"],["pB[0][0]",...],["pC[0]","pC[1]"],["pub[0]",...]
    const calldataMatch = claimData.calldata.match(/\[(.*?)\],\[\[(.*?)\],\[(.*?)\]\],\[(.*?)\],\[(.*?)\]/);
    if (!calldataMatch) {
        console.error("❌ Failed to parse calldata");
        process.exit(1);
    }

    const parseArray = (s: string) => s.split(",").map(x => x.replace(/"/g, "").trim());

    const pA = parseArray(calldataMatch[1]);
    const pB0 = parseArray(calldataMatch[2]);
    const pB1 = parseArray(calldataMatch[3]);
    const pC = parseArray(calldataMatch[4]);
    const publicSignals = parseArray(calldataMatch[5]);

    // Extract locker hash from public signals (circuit computes this internally)
    // Public signals order: [merkleRoots[0], merkleRoots[1], nullifier, amount, chainId, recipient, lockerScriptHash]
    const lockerScriptHashFromProof = BigInt(publicSignals[6]).toString();

    console.log("\nProof Components:");
    console.log(`  pA: [${pA[0].substring(0, 20)}..., ${pA[1].substring(0, 20)}...]`);
    console.log(`  pC: [${pC[0].substring(0, 20)}..., ${pC[1].substring(0, 20)}...]`);
    console.log(`  Public signals: ${publicSignals.length} values`);
    console.log(`  Locker hash (from proof): ${lockerScriptHashFromProof.substring(0, 30)}...`);

    // Connect to contract
    const claimContract = await ethers.getContractAt(
        "PrivateTransferClaim",
        claimContractAddress,
        signer
    );

    // Check if locker hash is registered (use hash from proof, not claim file)
    const isValidLocker = await claimContract.isValidLockerHash(lockerScriptHashFromProof);
    if (!isValidLocker) {
        console.error("\n❌ Locker hash not registered!");
        console.error(`   Hash from proof: ${lockerScriptHashFromProof}`);
        console.error("   Register it first with: npm run zk:register-locker --network polygon");
        process.exit(1);
    }
    console.log("✓ Locker hash is registered");

    // Check if nullifier already used
    const isUsed = await claimContract.isNullifierUsed(claimData.nullifier);
    if (isUsed) {
        console.error("\n❌ Nullifier already used! This claim was already processed.");
        process.exit(1);
    }
    console.log("✓ Nullifier not yet used");

    // Estimate gas
    // Public signals order: [merkleRoots[0], merkleRoots[1], nullifier, amount, chainId, recipient, lockerScriptHash]
    console.log("\nEstimating gas...");
    try {
        const gasEstimate = await claimContract.estimateGas.claimPrivate(
            pA,
            [pB0, pB1],
            pC,
            [publicSignals[0], publicSignals[1]],  // merkleRoots array
            publicSignals[2],  // nullifier
            publicSignals[3],  // amount
            claimData.recipient,
            publicSignals[6],  // lockerScriptHash
        );
        console.log(`  Estimated gas: ${gasEstimate.toString()}`);
    } catch (error: any) {
        console.error(`\n❌ Gas estimation failed: ${error.message}`);
        console.error("   This usually means the proof is invalid or inputs don't match.");
        process.exit(1);
    }

    // Confirm submission
    console.log("\n─────────────────────────────────────────────────────────────");
    console.log("REVIEW BEFORE SUBMITTING:");
    console.log(`  Amount:    ${claimData.amount} satoshis`);
    console.log(`  Recipient: ${claimData.recipient}`);
    console.log(`  Contract:  ${claimContractAddress}`);
    console.log("─────────────────────────────────────────────────────────────");

    const readline = require("readline");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const answer = await new Promise<string>(resolve => {
        rl.question("\nSubmit claim? (yes/no): ", resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== "yes") {
        console.log("\n❌ Claim NOT submitted.");
        process.exit(0);
    }

    // Submit claim
    // Public signals order: [merkleRoots[0], merkleRoots[1], nullifier, amount, chainId, recipient, lockerScriptHash]
    console.log("\nSubmitting claim...");
    const tx = await claimContract.claimPrivate(
        pA,
        [pB0, pB1],
        pC,
        [publicSignals[0], publicSignals[1]],  // merkleRoots array
        publicSignals[2],  // nullifier
        publicSignals[3],  // amount
        claimData.recipient,
        publicSignals[6],  // lockerScriptHash
    );

    console.log(`  TX Hash: ${tx.hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log(`  ✓ Confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    // Check for PrivateClaim event
    const claimEvent = receipt.events?.find((e: any) => e.event === "PrivateClaim");
    if (claimEvent) {
        console.log("\n✓ PrivateClaim event emitted!");
        console.log(`  Nullifier: ${claimEvent.args.nullifier.toString().substring(0, 30)}...`);
        console.log(`  Recipient: ${claimEvent.args.recipient}`);
        console.log(`  Amount:    ${claimEvent.args.amount.toString()} satoshis`);
    }

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                  CLAIM SUCCESSFUL!                         ║");
    console.log("╚════════════════════════════════════════════════════════════╝");

    // Get block explorer from config
    const networkConfig = (zkConfig.supported_networks as Record<string, { block_explorer: string }>)[network.name];
    const blockExplorer = networkConfig?.block_explorer || "https://etherscan.io";
    console.log(`\nView on block explorer:`);
    console.log(`  ${blockExplorer}/tx/${tx.hash}`);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error("\n❌ Error:", error.message);
        process.exit(1);
    });
