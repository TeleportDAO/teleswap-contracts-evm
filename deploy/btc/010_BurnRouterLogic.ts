import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";

require("dotenv").config({ path: "../config/temp.env" });

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const burnRouterLib = await deploy("BurnRouterLib", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    });

    const deployedContract = await deploy("BurnRouterLogic", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [],
        libraries: {
            BurnRouterLib: burnRouterLib.address,
        },
    });

    if (
        network.name != "hardhat" &&
        process.env[`${network.name.toUpperCase()}_API_KEY`] &&
        process.env.VERIFY_OPTION == "1"
    ) {
        await verify(
            burnRouterLib.address,
            [],
            "contracts/routers/BurnRouterLib.sol:BurnRouterLib"
        );
        
        await verify(
            deployedContract.address,
            [],
            "contracts/routers/BurnRouterLogic.sol:BurnRouterLogic"
        );
    }
};

export default func;
func.tags = ["btc"];
