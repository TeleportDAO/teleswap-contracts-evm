import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";
import config from "config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    let dexConnectorLogic;
    const proxyAdmin = config.get("proxy_admin");

    if (network.name == "bob") {
        dexConnectorLogic = await deployments.get("iZiSwapConnector");
    } else {
        dexConnectorLogic = await deployments.get("UniswapV3Connector");
    }

    const deployedContract = await deploy("DexConnectorProxy", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [dexConnectorLogic.address, proxyAdmin, "0x"],
    });

    if (
        network.name != "hardhat" &&
        process.env[`${network.name.toUpperCase()}_API_KEY`] &&
        process.env.VERIFY_OPTION == "1"
    ) {
        await verify(
            deployedContract.address,
            [dexConnectorLogic.address, proxyAdmin, "0x"],
            "contracts/dex_connectors/DexConnectorProxy.sol:DexConnectorProxy"
        );
    }
};

export default func;
func.tags = ["dex_connector"];
