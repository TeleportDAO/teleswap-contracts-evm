import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from "hardhat";
import config from 'config';
const logger = require('node-color-log');

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments } = hre;
    const ZERO_ADD = "0x0000000000000000000000000000000000000000";

    const brc20RouterProxy = await deployments.get("Brc20RouterProxy");
    const brc20RouterLogic = await deployments.get("Brc20RouterLogic");
    const brc20RouterLib = await deployments.get("Brc20RouterLib");

    const startingBlockNumber = config.get("starting_block_number");
    const protocolPercentageFee = config.get("protocol_percentage_fee");
    const chainId = config.get("chain_id");
    const treasury = config.get("treasury");
    const locker = config.get("locker");
    const lockerLockingScript = config.get("lockerLockingScript");
    const lockerScriptType = config.get("lockerScriptType");
    const teleporter = config.get("teleporter");
    const relay = config.get("bitcoin_relay");
    const wrappedNativeToken = config.get("wrapped_native_token");

    logger.color('blue').log("-------------------------------------------------")
    logger.color('blue').bold().log("Initialize Brc20RouterLogic ...")

    const brc20RouterLogicFactory = await ethers.getContractFactory(
        "Brc20RouterLogic",
        {
            libraries: {
                Brc20RouterLib: brc20RouterLib.address
            }
        }
    );
    const brc20RouterProxyInstance = await brc20RouterLogicFactory.attach(
        brc20RouterProxy.address
    );
    const brc20RouterLogicInstance = await brc20RouterLogicFactory.attach(
        brc20RouterLogic.address
    );

    let _relay = await brc20RouterProxyInstance.relay();
    if (_relay == ZERO_ADD) {
        const initializeTx = await brc20RouterProxyInstance.initialize(
            startingBlockNumber,
            protocolPercentageFee,
            chainId,
            relay,
            locker,
            lockerLockingScript,
            lockerScriptType,
            teleporter,
            treasury,
            wrappedNativeToken
        )
        await initializeTx.wait(1)
        console.log("Initialized Brc20RouterProxy: ", initializeTx.hash)
    } else {
        console.log("Brc20RouterProxy is already initialized")
    }

    let _teleBtcLogic = await brc20RouterLogicInstance.relay()
    if (_teleBtcLogic == ZERO_ADD) {
        const initializeTx = await brc20RouterLogicInstance.initialize(
            startingBlockNumber,
            protocolPercentageFee,
            chainId,
            relay,
            locker,
            lockerLockingScript,
            lockerScriptType,
            teleporter,
            treasury,
            wrappedNativeToken
        )
        await initializeTx.wait(1)
        console.log("Initialized brc20RouterLogic: ", initializeTx.hash)
    } else {
        console.log("brc20RouterLogic is already initialized")
    }

};

export default func;