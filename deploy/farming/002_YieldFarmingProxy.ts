import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import config from 'config';
import verify from "../../helper-functions";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const proxyAdmin = config.get("proxyAdmin");
    const yieldFarmingLogic = await deployments.get("YieldFarmingLogic");

    const theArgs = [
        yieldFarmingLogic.address,
        proxyAdmin,
        "0x"
    ];

    const deployedContract = await deploy("YieldFarmingProxy", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: theArgs
    });

    if (network.name != "hardhat" && process.env[`${network.name.toUpperCase()}_API_KEY`] && process.env.VERIFY_OPTION == "1") {
        await verify(
            deployedContract.address, 
            theArgs, 
            "contracts/YieldFarmingProxy.sol:YieldFarmingProxy"
        );
    }
};

export default func;
func.tags = ["farming"];
