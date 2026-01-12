import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import verify from "../../helper-functions";
import config from 'config';
import * as dotenv from "dotenv";
dotenv.config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const proxyAdmin = config.get("proxy_admin");
    const brc20RouterLogic = await deployments.get("RuneRouterLogic")

    const deployedContract = await deploy("RuneRouterProxy", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [
            brc20RouterLogic.address,
            proxyAdmin,
            "0x"
        ],
    });

    if (network.name != "hardhat" && process.env[`${network.name.toUpperCase()}_API_KEY`] && process.env.VERIFY_OPTION == "1") {
        await verify(
            deployedContract.address, 
            [
                brc20RouterLogic.address,
                proxyAdmin,
                "0x"
            ], 
            "contracts/rune_router/RuneRouterProxy.sol:RuneRouterProxy"
        )
    }
};

export default func;
func.tags = ["rune"];
