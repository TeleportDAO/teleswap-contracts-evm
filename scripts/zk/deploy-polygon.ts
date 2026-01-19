/**
 * Deploy ZK Private Transfer contracts to Polygon Mainnet
 *
 * Usage:
 *   npx hardhat run scripts/zk/deploy-polygon.ts --network polygon
 *
 * Prerequisites:
 *   - PRIVATE_KEY in .env file
 *   - MATIC for gas fees
 *
 * Deploys:
 *   1. Groth16Verifier - ZK proof verifier
 *   2. PrivateTransferClaimTest - Test version (no minting)
 */

import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Configuration
const POLYGON_CHAIN_ID = 137;

interface DeploymentResult {
    network: string;
    chainId: number;
    verifier: string;
    claimContract: string;
    deployer: string;
    timestamp: string;
    txHashes: {
        verifier: string;
        claimContract: string;
    };
}

async function main() {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║   Deploy ZK Private Transfer to Polygon Mainnet            ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    // Get deployer
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    // Check balance
    const balance = await deployer.getBalance();
    console.log("Balance:", ethers.utils.formatEther(balance), "MATIC");

    if (balance.lt(ethers.utils.parseEther("0.1"))) {
        throw new Error("Insufficient MATIC balance. Need at least 0.1 MATIC for deployment.");
    }

    // Get network info
    const network = await ethers.provider.getNetwork();
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);

    if (network.chainId !== POLYGON_CHAIN_ID) {
        throw new Error(`Expected Polygon (chainId ${POLYGON_CHAIN_ID}), got ${network.chainId}`);
    }

    console.log("\n─────────────────────────────────────────────────────────────\n");

    // ═══════════════════════════════════════════════════════════════════
    // Step 1: Deploy Groth16Verifier
    // ═══════════════════════════════════════════════════════════════════
    console.log("Step 1: Deploying Groth16Verifier...");

    const Verifier = await ethers.getContractFactory("Groth16Verifier");
    const verifier = await Verifier.deploy();
    await verifier.deployed();

    const verifierTx = verifier.deployTransaction;
    console.log("  TX Hash:", verifierTx.hash);
    console.log("  Address:", verifier.address);
    console.log("  Gas Used:", (await verifierTx.wait()).gasUsed.toString());

    // ═══════════════════════════════════════════════════════════════════
    // Step 2: Deploy PrivateTransferClaimTest (upgradeable)
    // ═══════════════════════════════════════════════════════════════════
    console.log("\nStep 2: Deploying PrivateTransferClaimTest (upgradeable)...");

    const ClaimContract = await ethers.getContractFactory("PrivateTransferClaimTest");
    const claimContract = await upgrades.deployProxy(
        ClaimContract,
        [verifier.address, POLYGON_CHAIN_ID],
        { initializer: "initialize" }
    );
    await claimContract.deployed();

    const claimTx = claimContract.deployTransaction;
    console.log("  TX Hash:", claimTx.hash);
    console.log("  Proxy Address:", claimContract.address);
    console.log("  Gas Used:", (await claimTx.wait()).gasUsed.toString());

    // ═══════════════════════════════════════════════════════════════════
    // Step 3: Verify deployment
    // ═══════════════════════════════════════════════════════════════════
    console.log("\nStep 3: Verifying deployment...");

    const zkVerifier = await claimContract.zkVerifier();
    const chainId = await claimContract.claimChainId();
    const owner = await claimContract.owner();

    console.log("  zkVerifier:", zkVerifier);
    console.log("  chainId:", chainId.toString());
    console.log("  owner:", owner);

    if (zkVerifier !== verifier.address) {
        throw new Error("Verifier address mismatch!");
    }
    if (chainId.toNumber() !== POLYGON_CHAIN_ID) {
        throw new Error("Chain ID mismatch!");
    }
    console.log("  ✓ Deployment verified");

    // ═══════════════════════════════════════════════════════════════════
    // Step 4: Save deployment info
    // ═══════════════════════════════════════════════════════════════════
    const deployment: DeploymentResult = {
        network: "polygon",
        chainId: POLYGON_CHAIN_ID,
        verifier: verifier.address,
        claimContract: claimContract.address,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        txHashes: {
            verifier: verifierTx.hash,
            claimContract: claimTx.hash,
        },
    };

    const deploymentDir = path.join(__dirname, "../../deployments/zk");
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const deploymentPath = path.join(deploymentDir, "polygon.json");
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
    console.log("\nDeployment saved to:", deploymentPath);

    // ═══════════════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                  DEPLOYMENT COMPLETE                       ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("\nContract Addresses:");
    console.log("  Groth16Verifier:          ", verifier.address);
    console.log("  PrivateTransferClaimTest: ", claimContract.address);
    console.log("\nPolygonscan Links:");
    console.log(`  Verifier: https://polygonscan.com/address/${verifier.address}`);
    console.log(`  Claim:    https://polygonscan.com/address/${claimContract.address}`);
    console.log("\nNext Steps:");
    console.log("  1. Register locker hash: npm run zk:register-locker --network polygon");
    console.log("  2. Create BTC deposit:   npm run zk:create-deposit");
    console.log("  3. Generate proof:       npm run zk:generate-claim --txid=<btc_txid>");
    console.log("  4. Submit claim:         npm run zk:submit-claim --network polygon");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Deployment failed:", error.message);
        process.exit(1);
    });
