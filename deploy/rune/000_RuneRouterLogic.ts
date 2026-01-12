import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import verify from "../../helper-functions";
import * as dotenv from "dotenv";
dotenv.config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const runeRouterLib = await deploy("RuneRouterLib", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    })

    const deployedContract = await deploy("RuneRouterLogic", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        libraries: {
            "RuneRouterLib": runeRouterLib.address
        }
    });

    if (network.name != "hardhat" && process.env[`${network.name.toUpperCase()}_API_KEY`] && process.env.VERIFY_OPTION == "1") {
        await verify(
            deployedContract.address, 
            [], 
            "contracts/rune_router/RuneRouterLogic.sol:RuneRouterLogic"
        )

        await verify(
            runeRouterLib.address,
            [],
            "contracts/rune_router/RuneRouterLib.sol:RuneRouterLib"
        );
    }
};

export default func;
func.tags = ["rune"];
