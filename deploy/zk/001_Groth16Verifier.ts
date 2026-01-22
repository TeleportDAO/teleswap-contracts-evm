import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";

import * as dotenv from "dotenv";
dotenv.config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║   Deploying Groth16Verifier                                 ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    const deployedContract = await deploy("Groth16Verifier", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    });

    console.log(`  Groth16Verifier deployed at: ${deployedContract.address}`);

    if (
        network.name != "hardhat" &&
        process.env[`${network.name.toUpperCase()}_API_KEY`] &&
        process.env.VERIFY_OPTION == "1"
    ) {
        await verify(
            deployedContract.address,
            [],
            "contracts/zk/Groth16Verifier.sol:Groth16Verifier"
        );
    }
};

export default func;
func.tags = ["zk", "zk-verifier"];
