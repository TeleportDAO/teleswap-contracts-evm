import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";
import zkConfig from "../../config/zk.json";

import * as dotenv from "dotenv";
dotenv.config();

// Network name to chain ID mapping
const NETWORK_CHAIN_IDS: Record<string, number> = {
    polygon: 137,
    ethereum: 1,
    arbitrum: 42161,
    base: 8453,
    hardhat: 31337,
};

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network, ethers, upgrades } = hre;
    const { deployer } = await getNamedAccounts();

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║   Deploying PrivateTransferClaim (Upgradeable)              ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    // Check if already deployed
    const existingDeployment = await deployments.getOrNull("PrivateTransferClaim");
    if (existingDeployment) {
        console.log(`  Reusing existing deployment at: ${existingDeployment.address}`);

        // Still verify the contract state
        const claimContract = await ethers.getContractAt("PrivateTransferClaim", existingDeployment.address);
        const zkVerifier = await claimContract.zkVerifier();
        const deployedChainId = await claimContract.claimChainId();
        const owner = await claimContract.owner();

        console.log("\n  Verification:");
        console.log(`    zkVerifier: ${zkVerifier}`);
        console.log(`    chainId: ${deployedChainId.toString()}`);
        console.log(`    owner: ${owner}`);
        console.log("    ✓ Existing deployment verified\n");
        return;
    }

    // Get chain ID from network name
    const chainId = NETWORK_CHAIN_IDS[network.name] || 137;
    console.log(`  Network: ${network.name}`);
    console.log(`  Chain ID: ${chainId}`);

    // Get the verifier address from previous deployment
    const verifierDeployment = await deployments.get("Groth16Verifier");
    console.log(`  Verifier Address: ${verifierDeployment.address}`);

    // LockersManager address (zero for now, minting is disabled)
    const lockersManager = ethers.constants.AddressZero;
    console.log(`  LockersManager: ${lockersManager} (minting disabled)`);

    // Deploy using OpenZeppelin upgrades
    const ClaimContract = await ethers.getContractFactory("PrivateTransferClaim");
    const claimContract = await upgrades.deployProxy(
        ClaimContract,
        [verifierDeployment.address, lockersManager, chainId],
        { initializer: "initialize" }
    );
    await claimContract.deployed();

    console.log(`  PrivateTransferClaim Proxy deployed at: ${claimContract.address}`);

    // Get implementation address for verification
    const implAddress = await upgrades.erc1967.getImplementationAddress(claimContract.address);
    console.log(`  Implementation deployed at: ${implAddress}`);

    // Save deployment info using hardhat-deploy format
    const artifact = await deployments.getExtendedArtifact("PrivateTransferClaim");
    await deployments.save("PrivateTransferClaim", {
        address: claimContract.address,
        ...artifact,
    });

    // Verify deployment
    const zkVerifier = await claimContract.zkVerifier();
    const deployedChainId = await claimContract.claimChainId();
    const owner = await claimContract.owner();

    console.log("\n  Verification:");
    console.log(`    zkVerifier: ${zkVerifier}`);
    console.log(`    chainId: ${deployedChainId.toString()}`);
    console.log(`    owner: ${owner}`);

    if (zkVerifier !== verifierDeployment.address) {
        throw new Error("Verifier address mismatch!");
    }
    if (deployedChainId.toNumber() !== chainId) {
        throw new Error("Chain ID mismatch!");
    }
    console.log("    ✓ Deployment verified\n");

    // Verify on block explorer
    if (
        network.name != "hardhat" &&
        process.env[`${network.name.toUpperCase()}_API_KEY`] &&
        process.env.VERIFY_OPTION == "1"
    ) {
        // Verify implementation
        await verify(
            implAddress,
            [],
            "contracts/zk/PrivateTransferClaim.sol:PrivateTransferClaim"
        );
    }

    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                  ZK DEPLOYMENT COMPLETE                    ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`\n  Groth16Verifier:       ${verifierDeployment.address}`);
    console.log(`  PrivateTransferClaim:  ${claimContract.address}`);
    console.log("\n  Next Steps:");
    console.log("    1. Register locker hash: npm run zk:register-locker");
    console.log("    2. Create BTC deposit:   npm run zk:create-deposit");
    console.log("    3. Generate witness:     npm run zk:generate-witness");
    console.log("    4. Submit proof:         npm run zk:submit-proof\n");
};

export default func;
func.tags = ["zk", "zk-claim"];
func.dependencies = ["zk-verifier"];
