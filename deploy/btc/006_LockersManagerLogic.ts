import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const lockersManagerLib = await deploy("LockersManagerLib", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    });

    const deployedContract = await deploy("LockersManagerLogic", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        libraries: {
            LockersManagerLib: lockersManagerLib.address,
        },
    });

    if (
        network.name != "hardhat" &&
        process.env[`${network.name.toUpperCase()}_API_KEY`] &&
        process.env.VERIFY_OPTION == "1"
    ) {
        await verify(
            lockersManagerLib.address,
            [],
            "contracts/lockersManager/LockersManagerLib.sol:LockersManagerLib"
        );
        await verify(
            deployedContract.address,
            [],
            "contracts/lockersManager/LockersManagerLogic.sol:LockersManagerLogic"
        );
    }
};

export default func;
func.tags = ["btc"];
