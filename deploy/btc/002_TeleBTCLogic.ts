import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const deployedContract = await deploy("TeleBTCLogic", {
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
            "contracts/erc20/TeleBTCLogic.sol:TeleBTCLogic"
        );
    }
};

export default func;
func.tags = ["btc"];
