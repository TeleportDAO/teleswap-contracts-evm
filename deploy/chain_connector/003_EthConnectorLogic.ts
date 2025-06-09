import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    if (
        network.name == "hardhat" ||
        (network.name != "amoy" && network.name != "polygon")
    ) {
        const deployedContract = await deploy("EthConnectorLogic", {
            from: deployer,
            log: true,
            skipIfAlreadyDeployed: true,
            args: [],
            gasLimit: 5000000
        });

        if (
            network.name != "hardhat" &&
            process.env[`${network.name.toUpperCase()}_API_KEY`] &&
            process.env.VERIFY_OPTION == "1"
        ) {
            await verify(
                deployedContract.address,
                [],
                "contracts/chain_connectors/EthConnectorLogic.sol:EthConnectorLogic"
            );
        }
    }
};

export default func;
func.tags = ["chain_connector"];
