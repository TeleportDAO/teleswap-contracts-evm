import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import config from "config";
const logger = require("node-color-log");

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, network } = hre;
    const ZERO_ADD = "0x0000000000000000000000000000000000000000";
    let name;
    let dexConnectorLogic;
    let dexConnectorLogicFactory;

    const exchangeRouter = config.get("uniswap_v3_swap_router");
    const quoterAddress = config.get("uniswap_v3_quoter");
    const dexConnectorProxy = await deployments.get("DexConnectorProxy");

    if (network.name == "bob") {
        name = "iZiSwapConnector";
        dexConnectorLogic = await deployments.get("iZiSwapConnector");   
        dexConnectorLogicFactory = await ethers.getContractFactory(
            "iZiSwapConnector"
        );
    } else {
        name = "UniswapV3Connector";
        dexConnectorLogic = await deployments.get("UniswapV3Connector");   
        dexConnectorLogicFactory = await ethers.getContractFactory(
            "UniswapV3Connector"
        );
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Initialize DexConnector ...");

    const dexConnectorProxyInstance =
        await dexConnectorLogicFactory.attach(dexConnectorLogic.address);
    const dexConnectorLogicInstance =
        await dexConnectorLogicFactory.attach(dexConnectorProxy.address);

    let _liquidityPoolFactory = await dexConnectorProxyInstance.liquidityPoolFactory();
    if (_liquidityPoolFactory == ZERO_ADD) {
        const initializeTx = await dexConnectorProxyInstance.initialize(
            name,
            exchangeRouter,
            quoterAddress
        );
        await initializeTx.wait(1);
        console.log("Initialized DexConnectorProxy: ", initializeTx.hash);
    } else {
        console.log("DexConnectorProxy is already initialized");
    }

    let _liquidityPoolFactoryLogic = await dexConnectorLogicInstance.liquidityPoolFactory();
    if (_liquidityPoolFactoryLogic == ZERO_ADD) {
        const initializeTx = await dexConnectorLogicInstance.initialize(
            name,
            exchangeRouter,
            quoterAddress
        );
        await initializeTx.wait(1);
        console.log("Initialized DexConnectorLogic: ", initializeTx.hash);
    } else {
        console.log("DexConnectorLogic is already initialized");
    }

};

export default func;
