import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import verify from "../../helper-functions";
import * as dotenv from "dotenv";
dotenv.config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const brc20RouterLib = await deploy("Brc20RouterLib", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    })

    const deployedContract = await deploy("Brc20RouterLogic", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        libraries: {
            "Brc20RouterLib": brc20RouterLib.address
        }
    });

    if (network.name != "hardhat" && process.env[`${network.name.toUpperCase()}_API_KEY`] && process.env.VERIFY_OPTION == "1") {
        await verify(
            deployedContract.address, 
            [], 
            "contracts/brc20_router/Brc20RouterLogic.sol:Brc20RouterLogic"
        )
    }
};

export default func;
func.tags = ["brc20"];