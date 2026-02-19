import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import verify from "../../helper-functions";

require("dotenv").config({ path: "../config/temp.env" });

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const ccExchangeRouterLib = await deploy("CcExchangeRouterLib", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    });

    const ccExchangeRouterLibExtensionUniversal = await deploy(
        "CcExchangeRouterLibExtensionUniversal",
        {
            from: deployer,
            log: true,
            skipIfAlreadyDeployed: true,
        }
    );

    const deployedContract = await deploy("CcExchangeRouterLogicUniversal", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [],
        libraries: {
            CcExchangeRouterLib: ccExchangeRouterLib.address,
            CcExchangeRouterLibExtensionUniversal: ccExchangeRouterLibExtensionUniversal.address,
        },
    });

    if (
        network.name != "hardhat" &&
        process.env[`${network.name.toUpperCase()}_API_KEY`] &&
        process.env.VERIFY_OPTION == "1"
    ) {
        // Verify the library
        await verify(
            ccExchangeRouterLib.address,
            [],
            "contracts/routers/CcExchangeRouterLib.sol:CcExchangeRouterLib"
        );
        await verify(
            ccExchangeRouterLibExtensionUniversal.address,
            [],
            "contracts/routers/CcExchangeRouterLibExtensionUniversal.sol:CcExchangeRouterLibExtensionUniversal"
        );
        await verify(
            deployedContract.address,
            [],
            "contracts/routers/CcExchangeRouterLogicUniversal.sol:CcExchangeRouterLogicUniversal"
        );
    }
};

export default func;
func.tags = ["btc"];
