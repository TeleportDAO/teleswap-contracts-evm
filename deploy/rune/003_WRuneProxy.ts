import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import verify from "../../helper-functions";
import * as dotenv from "dotenv";
dotenv.config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre;

    const proxyAdmin = "0x24004F4f6D2e75B039d528E82B100355D8b1D4Fb";
    const WRUNELogic = "0x0E115dD9Bbd1d0E4Ab5B2E0f73BB705b6EE15b4D"

    if (network.name != "hardhat" && process.env[`${network.name.toUpperCase()}_API_KEY`] && process.env.VERIFY_OPTION == "1") {
        await verify(
            "0x588204367BCc4AC0C2b18A053035F19188Ccf7a6", 
            [
                WRUNELogic,
                proxyAdmin,
                "0x"
            ], 
            "contracts/erc20/WRuneProxy.sol:WRuneProxy"
        )
    }
};

export default func;
func.tags = ["rune"];
