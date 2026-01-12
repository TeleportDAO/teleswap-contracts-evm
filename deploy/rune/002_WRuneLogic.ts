import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import verify from "../../helper-functions";
import * as dotenv from "dotenv";
dotenv.config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre;

    if (network.name != "hardhat" && process.env[`${network.name.toUpperCase()}_API_KEY`] && process.env.VERIFY_OPTION == "1") {
        await verify(
            "0x0E115dD9Bbd1d0E4Ab5B2E0f73BB705b6EE15b4D", 
            [], 
            "contracts/erc20/WRuneLogic.sol:WRuneLogic"
        )
    }
};

export default func;
func.tags = ["rune"];
