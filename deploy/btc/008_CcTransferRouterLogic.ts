import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
// import config from 'config'
// import { BigNumber } from 'ethers';
import verify from "../../helper-functions";

import * as dotenv from "dotenv";
dotenv.config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const deployedContract = await deploy("CcTransferRouterLogic", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    });

    if (
        network.name != "hardhat" &&
        process.env[`${network.name.toUpperCase()}_API_KEY`] &&
        process.env.VERIFY_OPTION == "1"
    ) {
        await verify(
            deployedContract.address,
            [],
            "contracts/routers/CcTransferRouterLogic.sol:CcTransferRouterLogic"
        );
    }
};

export default func;
func.tags = ["btc"];
