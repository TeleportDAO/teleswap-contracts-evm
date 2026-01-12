import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";
import config from "config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    
    const proxyAdmin = config.get("proxy_admin");
    const ccExchangeRouterLogic = await deployments.get(
        "CcExchangeRouterLogic"
    );

    const deployedContract = await deploy("CcExchangeRouterProxy", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [ccExchangeRouterLogic.address, proxyAdmin, "0x"],
    });

    if (
        network.name != "hardhat" &&
        process.env[`${network.name.toUpperCase()}_API_KEY`] &&
        process.env.VERIFY_OPTION == "1"
    ) {
        await verify(
            deployedContract.address,
            [ccExchangeRouterLogic.address, proxyAdmin, "0x"],
            "contracts/routers/CcExchangeRouterProxy.sol:CcExchangeRouterProxy"
        );
    }
};

export default func;
func.tags = ["btc"];
