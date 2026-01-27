/**
 * Submit ZK Proof with Invalid Arguments - Security Test
 *
 * This script tests that the contract properly rejects proofs when
 * public inputs are tampered with. It generates a VALID proof but
 * submits it with WRONG arguments.
 *
 * Test scenarios:
 * 1. Wrong merkle root - should fail proof verification
 * 2. Wrong amount - should fail proof verification
 * 3. Wrong recipient - should fail proof verification
 * 4. Wrong nullifier - should fail proof verification
 * 5. Wrong locker hash - should fail locker validation or proof verification
 *
 * Usage:
 *   CLAIM_FILE=<txid>.json npx hardhat run scripts/zk/submit-proof-with-invalid-args.ts --network polygon
 */

import { ethers, deployments } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface ClaimData {
    txid: string;
    amount: number;
    chainId: number;
    recipient: string;
    nullifier: string;
    lockerScriptHash: string;
    merkleRoots: string[];
    calldata: string;
}

interface TestResult {
    scenario: string;
    expected: string;
    actual: string;
    passed: boolean;
    error?: string;
}

async function main() {
    const network = await ethers.provider.getNetwork();

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║   Security Test: Submit Proof with Invalid Arguments       ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    // Parse arguments
    const claimArg = process.argv.find(arg => arg.startsWith("--claim="));
    const claimFileName = claimArg ? claimArg.split("=")[1] : process.env.CLAIM_FILE;

    if (!claimFileName) {
        console.error("❌ Usage: CLAIM_FILE=<txid>.json npx hardhat run scripts/zk/submit-proof-with-invalid-args.ts --network polygon");
        process.exit(1);
    }

    const claimPath = claimFileName.startsWith("/")
        ? claimFileName
        : path.join(__dirname, "../../zkproof/claims", claimFileName);

    if (!fs.existsSync(claimPath)) {
        console.error(`❌ Claim file not found: ${claimPath}`);
        console.error("   Generate a claim first with: node scripts/zk/generate-witness.js --deposit=<txid>.json");
        process.exit(1);
    }

    // Load claim data
    const claimData: ClaimData = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    console.log("Loaded Valid Claim:");
    console.log(`  TxId:      ${claimData.txid}`);
    console.log(`  Amount:    ${claimData.amount} satoshis`);
    console.log(`  Recipient: ${claimData.recipient}`);

    // Load deployment
    let claimContractAddress: string;
    try {
        const claimDeployment = await deployments.get("PrivateTransferClaim");
        claimContractAddress = claimDeployment.address;
    } catch (e) {
        console.error("❌ PrivateTransferClaim not deployed");
        process.exit(1);
    }

    console.log(`\nContract: ${claimContractAddress}`);

    // Get signer
    const [signer] = await ethers.getSigners();
    console.log(`Signer:   ${signer.address}`);

    // Connect to contract
    const claimContract = await ethers.getContractAt(
        "PrivateTransferClaim",
        claimContractAddress,
        signer
    );

    // Parse calldata to get proof components
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

    // Valid parameters (from proof)
    const validParams = {
        pA,
        pB: [pB0, pB1],
        pC,
        merkleRoots: [publicSignals[0], publicSignals[1]],
        nullifier: publicSignals[2],
        amount: publicSignals[3],
        recipient: claimData.recipient,
        lockerScriptHash: publicSignals[6],
    };

    console.log("\n─────────────────────────────────────────────────────────────");
    console.log("Valid Parameters (from proof):");
    console.log(`  merkleRoots[0]: ${validParams.merkleRoots[0].substring(0, 30)}...`);
    console.log(`  merkleRoots[1]: ${validParams.merkleRoots[1].substring(0, 30)}...`);
    console.log(`  nullifier:      ${validParams.nullifier.substring(0, 30)}...`);
    console.log(`  amount:         ${validParams.amount}`);
    console.log(`  recipient:      ${validParams.recipient}`);
    console.log(`  lockerHash:     ${validParams.lockerScriptHash.substring(0, 30)}...`);
    console.log("─────────────────────────────────────────────────────────────\n");

    const results: TestResult[] = [];

    // ═══════════════════════════════════════════════════════════════════
    // TEST 1: Wrong Merkle Root
    // ═══════════════════════════════════════════════════════════════════
    console.log("Test 1: Wrong Merkle Root");
    console.log("  Expected: Transaction should REVERT (invalid proof)");
    try {
        const wrongMerkleRoots = [
            (BigInt(validParams.merkleRoots[0]) + BigInt(1)).toString(),
            validParams.merkleRoots[1]
        ];

        await claimContract.estimateGas.claimPrivate(
            validParams.pA,
            validParams.pB,
            validParams.pC,
            wrongMerkleRoots,
            validParams.nullifier,
            validParams.amount,
            validParams.recipient,
            validParams.lockerScriptHash
        );

        results.push({
            scenario: "Wrong Merkle Root",
            expected: "REVERT",
            actual: "SUCCESS (gas estimated)",
            passed: false,
            error: "Contract accepted wrong merkle root!"
        });
        console.log("  ❌ FAILED - Contract accepted wrong merkle root!\n");
    } catch (error: any) {
        const errorMsg = error.message || error.toString();
        const isExpectedError = errorMsg.includes("invalid proof") ||
                               errorMsg.includes("revert") ||
                               errorMsg.includes("execution reverted");
        results.push({
            scenario: "Wrong Merkle Root",
            expected: "REVERT",
            actual: "REVERTED",
            passed: isExpectedError,
            error: errorMsg.substring(0, 100)
        });
        console.log(`  ✓ PASSED - Transaction reverted as expected`);
        console.log(`    Error: ${errorMsg.substring(0, 80)}...\n`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // TEST 2: Wrong Amount
    // ═══════════════════════════════════════════════════════════════════
    console.log("Test 2: Wrong Amount");
    console.log("  Expected: Transaction should REVERT (invalid proof)");
    try {
        const wrongAmount = (BigInt(validParams.amount) + BigInt(1)).toString();

        await claimContract.estimateGas.claimPrivate(
            validParams.pA,
            validParams.pB,
            validParams.pC,
            validParams.merkleRoots,
            validParams.nullifier,
            wrongAmount,
            validParams.recipient,
            validParams.lockerScriptHash
        );

        results.push({
            scenario: "Wrong Amount",
            expected: "REVERT",
            actual: "SUCCESS (gas estimated)",
            passed: false,
            error: "Contract accepted wrong amount!"
        });
        console.log("  ❌ FAILED - Contract accepted wrong amount!\n");
    } catch (error: any) {
        const errorMsg = error.message || error.toString();
        const isExpectedError = errorMsg.includes("invalid proof") ||
                               errorMsg.includes("revert") ||
                               errorMsg.includes("execution reverted");
        results.push({
            scenario: "Wrong Amount",
            expected: "REVERT",
            actual: "REVERTED",
            passed: isExpectedError,
            error: errorMsg.substring(0, 100)
        });
        console.log(`  ✓ PASSED - Transaction reverted as expected`);
        console.log(`    Error: ${errorMsg.substring(0, 80)}...\n`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // TEST 3: Wrong Recipient (Front-running attack simulation)
    // ═══════════════════════════════════════════════════════════════════
    console.log("Test 3: Wrong Recipient (Front-running attack)");
    console.log("  Expected: Transaction should REVERT (invalid proof)");
    try {
        // Use a different recipient address (attacker's address)
        const attackerAddress = "0x1111111111111111111111111111111111111111";

        await claimContract.estimateGas.claimPrivate(
            validParams.pA,
            validParams.pB,
            validParams.pC,
            validParams.merkleRoots,
            validParams.nullifier,
            validParams.amount,
            attackerAddress,  // WRONG recipient
            validParams.lockerScriptHash
        );

        results.push({
            scenario: "Wrong Recipient (Front-running)",
            expected: "REVERT",
            actual: "SUCCESS (gas estimated)",
            passed: false,
            error: "Contract accepted wrong recipient - FRONT-RUNNING VULNERABILITY!"
        });
        console.log("  ❌ FAILED - Contract accepted wrong recipient!\n");
        console.log("  ⚠️  CRITICAL: Front-running vulnerability detected!\n");
    } catch (error: any) {
        const errorMsg = error.message || error.toString();
        const isExpectedError = errorMsg.includes("invalid proof") ||
                               errorMsg.includes("revert") ||
                               errorMsg.includes("execution reverted");
        results.push({
            scenario: "Wrong Recipient (Front-running)",
            expected: "REVERT",
            actual: "REVERTED",
            passed: isExpectedError,
            error: errorMsg.substring(0, 100)
        });
        console.log(`  ✓ PASSED - Front-running attack prevented`);
        console.log(`    Error: ${errorMsg.substring(0, 80)}...\n`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // TEST 4: Wrong Nullifier
    // ═══════════════════════════════════════════════════════════════════
    console.log("Test 4: Wrong Nullifier");
    console.log("  Expected: Transaction should REVERT (invalid proof)");
    try {
        const wrongNullifier = (BigInt(validParams.nullifier) + BigInt(1)).toString();

        await claimContract.estimateGas.claimPrivate(
            validParams.pA,
            validParams.pB,
            validParams.pC,
            validParams.merkleRoots,
            wrongNullifier,
            validParams.amount,
            validParams.recipient,
            validParams.lockerScriptHash
        );

        results.push({
            scenario: "Wrong Nullifier",
            expected: "REVERT",
            actual: "SUCCESS (gas estimated)",
            passed: false,
            error: "Contract accepted wrong nullifier!"
        });
        console.log("  ❌ FAILED - Contract accepted wrong nullifier!\n");
    } catch (error: any) {
        const errorMsg = error.message || error.toString();
        const isExpectedError = errorMsg.includes("invalid proof") ||
                               errorMsg.includes("revert") ||
                               errorMsg.includes("execution reverted");
        results.push({
            scenario: "Wrong Nullifier",
            expected: "REVERT",
            actual: "REVERTED",
            passed: isExpectedError,
            error: errorMsg.substring(0, 100)
        });
        console.log(`  ✓ PASSED - Transaction reverted as expected`);
        console.log(`    Error: ${errorMsg.substring(0, 80)}...\n`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // TEST 5: Wrong Locker Script Hash
    // ═══════════════════════════════════════════════════════════════════
    console.log("Test 5: Wrong Locker Script Hash");
    console.log("  Expected: Transaction should REVERT (invalid locker or proof)");
    try {
        const wrongLockerHash = (BigInt(validParams.lockerScriptHash) + BigInt(1)).toString();

        await claimContract.estimateGas.claimPrivate(
            validParams.pA,
            validParams.pB,
            validParams.pC,
            validParams.merkleRoots,
            validParams.nullifier,
            validParams.amount,
            validParams.recipient,
            wrongLockerHash
        );

        results.push({
            scenario: "Wrong Locker Hash",
            expected: "REVERT",
            actual: "SUCCESS (gas estimated)",
            passed: false,
            error: "Contract accepted wrong locker hash!"
        });
        console.log("  ❌ FAILED - Contract accepted wrong locker hash!\n");
    } catch (error: any) {
        const errorMsg = error.message || error.toString();
        const isExpectedError = errorMsg.includes("invalid") ||
                               errorMsg.includes("revert") ||
                               errorMsg.includes("execution reverted") ||
                               errorMsg.includes("locker");
        results.push({
            scenario: "Wrong Locker Hash",
            expected: "REVERT",
            actual: "REVERTED",
            passed: isExpectedError,
            error: errorMsg.substring(0, 100)
        });
        console.log(`  ✓ PASSED - Transaction reverted as expected`);
        console.log(`    Error: ${errorMsg.substring(0, 80)}...\n`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // TEST 6: Valid Parameters (Control Test)
    // ═══════════════════════════════════════════════════════════════════
    console.log("Test 6: Valid Parameters (Control Test)");
    console.log("  Expected: Gas estimation should SUCCEED");
    try {
        const gasEstimate = await claimContract.estimateGas.claimPrivate(
            validParams.pA,
            validParams.pB,
            validParams.pC,
            validParams.merkleRoots,
            validParams.nullifier,
            validParams.amount,
            validParams.recipient,
            validParams.lockerScriptHash
        );

        results.push({
            scenario: "Valid Parameters (Control)",
            expected: "SUCCESS",
            actual: `SUCCESS (gas: ${gasEstimate.toString()})`,
            passed: true
        });
        console.log(`  ✓ PASSED - Gas estimated: ${gasEstimate.toString()}\n`);
    } catch (error: any) {
        const errorMsg = error.message || error.toString();
        results.push({
            scenario: "Valid Parameters (Control)",
            expected: "SUCCESS",
            actual: "REVERTED",
            passed: false,
            error: errorMsg.substring(0, 100)
        });
        console.log(`  ❌ FAILED - Valid proof was rejected!`);
        console.log(`    Error: ${errorMsg.substring(0, 80)}...\n`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                    TEST SUMMARY                            ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    let passedCount = 0;
    let failedCount = 0;

    for (const result of results) {
        const status = result.passed ? "✓ PASS" : "✗ FAIL";
        const color = result.passed ? "" : " ⚠️";
        console.log(`${status}: ${result.scenario}${color}`);
        if (result.passed) {
            passedCount++;
        } else {
            failedCount++;
            if (result.error) {
                console.log(`       Error: ${result.error}`);
            }
        }
    }

    console.log("\n─────────────────────────────────────────────────────────────");
    console.log(`Total: ${passedCount} passed, ${failedCount} failed`);
    console.log("─────────────────────────────────────────────────────────────");

    if (failedCount === 0) {
        console.log("\n✓ All security tests passed!");
        console.log("  The contract correctly rejects tampered public inputs.\n");
    } else {
        console.log("\n⚠️  Some security tests FAILED!");
        console.log("  Review the contract's proof verification logic.\n");
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error("\n❌ Error:", error.message);
        process.exit(1);
    });
