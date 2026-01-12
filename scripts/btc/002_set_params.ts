import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import config from "config";
const logger = require("node-color-log");

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, network } = hre;
    const ZERO_ADD = "0x0000000000000000000000000000000000000000";
    const lockersManagerLib = await deployments.get("LockersManagerLib");
    const lockersManagerProxy = await deployments.get("LockersManagerProxy");
    const teleBTC = await deployments.get("TeleBTCProxy");
    let priceOracle;
    if (network.name == "bsquared" || network.name == "bob") {
        priceOracle = await deployments.get("PriceOracleRedStone");
    } else {
        priceOracle = await deployments.get("PriceOracle");
    }    
    const ccTransferRouterProxy = await deployments.get(
        "CcTransferRouterProxy"
    );
    const burnRouterProxy = await deployments.get("BurnRouterProxy");
    const burnRouterLib = await deployments.get("BurnRouterLib");
    const ccExchangeRouterProxy = await deployments.get(
        "CcExchangeRouterProxy"
    );
    let exchangeConnector;
    if (network.name == "bob") {
        exchangeConnector = await deployments.get("iZiSwapConnector");
    } else if (network.name == "bsquared") {
        exchangeConnector = await deployments.get("UniswapV3Connector");
    } else {
        exchangeConnector = await deployments.get("UniswapV2Connector");
    }
    // const exchangeConnector = await deployments.get("UniswapV2Connector");
    const ccExchangeRouterLib = await deployments.get("CcExchangeRouterLib");

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Set teleBTC in BurnRouter ...");

    const burnRouterLogicFactory = await ethers.getContractFactory(
        "BurnRouterLogic",
        {
            libraries: {
                BurnRouterLib: burnRouterLib.address,
            },
        }
    );
    const burnRouterProxyInstance = await burnRouterLogicFactory.attach(
        burnRouterProxy.address
    );

    const _teleBTC = await burnRouterProxyInstance.teleBTC();

    if (_teleBTC.toLowerCase() != teleBTC.address) {
        const setTeleBTCTx = await burnRouterProxyInstance.setTeleBTC(
            teleBTC.address
        );
        await setTeleBTCTx.wait(1);
        console.log("Set teleBTC in BurnRouter: ", setTeleBTCTx.hash);
    } else {
        console.log("teleBTC is already set");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger
        .color("blue")
        .bold()
        .log("Set ExchangeConnector in CcExchangeRouterProxy ...");

    const ccExchangeRouterLogicFactory = await ethers.getContractFactory(
        "CcExchangeRouterLogic",
        {
            libraries: {
                CcExchangeRouterLib: ccExchangeRouterLib.address,
            },
        }
    );
    const ccExchangeRouterProxyInstance =
        await ccExchangeRouterLogicFactory.attach(
            ccExchangeRouterProxy.address
        );
    const exchangeAppId = config.get("cc_exchange.app_id");

    const _exchangeConnector =
        await ccExchangeRouterProxyInstance.exchangeConnector(exchangeAppId);

    if (_exchangeConnector != exchangeConnector.address) {
        const setConnectorAndAppIdTx =
            await ccExchangeRouterProxyInstance.setExchangeConnector(
                exchangeAppId,
                exchangeConnector.address
            );
        await setConnectorAndAppIdTx.wait(1);
        console.log(
            "Set ExchangeConnector in CcExchangeRouterProxy: ",
            setConnectorAndAppIdTx.hash
        );
    } else {
        console.log("ExchangeConnector is already set");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger
        .color("blue")
        .bold()
        .log("Set ChainIdMapping in CcExchangeRouterProxy ...");

    const chainId = config.get("chain_id");

    const [, destinationChain] =
        await ccExchangeRouterProxyInstance.chainIdMapping(chainId);

    if (destinationChain != chainId) {
        const tx = await ccExchangeRouterProxyInstance.setChainIdMapping(
            chainId,
            chainId
        );
        await tx.wait(1);
        console.log("Set ChainIdMapping in CcExchangeRouterProxy: ", tx.hash);
    } else {
        console.log("ChainIdMapping is already set");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Set teleBTC in Locker...");

    const lockersManagerLogicFactory = await ethers.getContractFactory(
        "LockersManagerLogic",
        {
            libraries: {
                LockersManagerLib: lockersManagerLib.address,
            },
        }
    );
    const lockersInstance = await lockersManagerLogicFactory.attach(
        lockersManagerProxy.address
    );

    if ((await lockersInstance.teleBTC()).toLowerCase() != teleBTC.address) {
        const setTeleBTCTx = await lockersInstance.setTeleBTC(teleBTC.address);
        await setTeleBTCTx.wait(1);
        console.log("Set teleBTC in locker: ", setTeleBTCTx.hash);
    } else {
        console.log("teleBTC is already set");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Add routers as minter and burner ...");

    const isCCTransferMinter = await lockersInstance.minters(
        ccTransferRouterProxy.address
    );

    if (!isCCTransferMinter) {
        const addCCTransferAsMinter = await lockersInstance.addMinter(
            ccTransferRouterProxy.address
        );
        await addCCTransferAsMinter.wait(1);
        console.log(
            "Added CcTransferRouterProxy as minter: ",
            addCCTransferAsMinter.hash
        );
    } else {
        console.log("CcTransferRouterProxy is already minter");
    }

    const isCCExchangeMinter = await lockersInstance.minters(
        ccExchangeRouterProxy.address
    );

    if (!isCCExchangeMinter) {
        const addCCExchangeAsMinter = await lockersInstance.addMinter(
            ccExchangeRouterProxy.address
        );

        await addCCExchangeAsMinter.wait(1);
        console.log(
            "Added CcExchangeRouterProxy as minter: ",
            addCCExchangeAsMinter.hash
        );
    } else {
        console.log("CcExchangeRouterProxy is already minter");
    }

    const isCCBurnerBurner = await lockersInstance.burners(
        burnRouterProxy.address
    );

    if (!isCCBurnerBurner) {
        const addCCBurnerAsBurner = await lockersInstance.addBurner(
            burnRouterProxy.address
        );

        await addCCBurnerAsBurner.wait(1);
        console.log(
            "Added BurnRouterProxy as burner: ",
            addCCBurnerAsBurner.hash
        );
    } else {
        console.log("BurnRouterProxy is already burner");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Set PriceOracle in Lockers ...");

    const _priceOracleAddress = await lockersInstance.priceOracle();

    if (
        _priceOracleAddress.toLowerCase() != priceOracle.address.toLowerCase()
    ) {
        const addPriceOracle = await lockersInstance.setPriceOracle(
            priceOracle.address
        );

        await addPriceOracle.wait(1);
        console.log("Set PriceOracle in Lockers: ", addPriceOracle.hash);
    } else {
        console.log("PriceOracle is already set");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Set BurnRouterProxy in Lockers ...");

    const burnRouterProxyAddress = await lockersInstance.burnRouter();

    if (burnRouterProxyAddress != burnRouterProxy.address) {
        const addCCBurnRouter = await lockersInstance.setBurnRouter(
            burnRouterProxy.address
        );

        await addCCBurnRouter.wait(1);
        console.log("Set BurnRouterProxy in Lockers: ", addCCBurnRouter.hash);
    } else {
        console.log("BurnRouterProxy is already set");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger
        .color("blue")
        .bold()
        .log("Add LockersManager as minter and burner in TeleBTC");

    const teleBTCLogicFactory = await ethers.getContractFactory("TeleBTCLogic");
    const teleBTCInstance = await teleBTCLogicFactory.attach(teleBTC.address);

    const isLockersProxyMinter = await teleBTCInstance.minters(
        lockersManagerProxy.address
    );

    if (!isLockersProxyMinter) {
        const addLockerAsMinter = await teleBTCInstance.addMinter(
            lockersManagerProxy.address
        );
        await addLockerAsMinter.wait(1);
        console.log("Added LockersProxy as minter: ", addLockerAsMinter.hash);
    } else {
        console.log("LockersProxy is already minter");
    }

    const isLockersProxyBurner = await teleBTCInstance.burners(
        lockersManagerProxy.address
    );

    if (!isLockersProxyBurner) {
        const addLockerAsBurner = await teleBTCInstance.addBurner(
            lockersManagerProxy.address
        );

        await addLockerAsBurner.wait(1);
        console.log("Added LockersProxy as burner: ", addLockerAsBurner.hash);
    } else {
        console.log("LockersProxy is already burner");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger
        .color("blue")
        .bold()
        .log("Set ExchangeRouter in ExchangeConnector ...");

    let uniswapV2Router02;
    let uniswapV2Connector;

    if (network.name == "bob") {
        uniswapV2Router02 = config.get("uniswap_v3_swap_router");
        uniswapV2Connector = await deployments.get("iZiSwapConnector");
    } else if (network.name == "bsquared") {
        uniswapV2Router02 = config.get("uniswap_v3_swap_router");
        uniswapV2Connector = await deployments.get("UniswapV3Connector");
    } else {
        uniswapV2Router02 = config.get("uniswap_v2_router_02");
        uniswapV2Connector = await deployments.get("UniswapV2Connector");
    }

    const uniswapV2ConnectorFactory = await ethers.getContractFactory(
        "UniswapV2Connector"
    );
    const uniswapV2ConnectorInstance = await uniswapV2ConnectorFactory.attach(
        uniswapV2Connector.address
    );

    const _exchangeRouter = await uniswapV2ConnectorInstance.exchangeRouter();
    if (uniswapV2Router02 != _exchangeRouter) {
        const setExchangeRouterTx =
            await uniswapV2ConnectorInstance.setExchangeRouter(
                uniswapV2Router02
            );
        await setExchangeRouterTx.wait(1);
        console.log(
            "Set ExchangeRouter in ExchangeConnector",
            setExchangeRouterTx.hash
        );
    } else {
        console.log("ExchangeRouter is already set");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Set PriceProxies in PriceOracle ...");

    const priceOracleFactory = await ethers.getContractFactory("PriceOracle");
    const priceOracleInstance = await priceOracleFactory.attach(
        priceOracle.address
    );
    let tx;

    // TARGET NATIVE TOKEN
    const wrappedMatic = config.get("wrapped_native_token");
    const maticUSDOracle = config.get("chain_link_oracles.wrapped_native_token_usd");
    const checkMaticUSDTx = await priceOracleInstance.ChainlinkPriceProxy(
        wrappedMatic
    );

    if (checkMaticUSDTx.toLowerCase() != String(maticUSDOracle).toLowerCase()) {
        tx = await priceOracleInstance.setPriceProxy(
            wrappedMatic,
            maticUSDOracle
        );
        await tx.wait(1);
        console.log("Set MATIC/USD in PriceOracle: ", tx.hash);
    } else {
        console.log("MATIC/USD is already set");
    }

    const ONE_ADD = "0x0000000000000000000000000000000000000001";
    const checkMaticUSDTx2 = await priceOracleInstance.ChainlinkPriceProxy(
        ONE_ADD
    );

    if (
        checkMaticUSDTx2.toLowerCase() != String(maticUSDOracle).toLowerCase()
    ) {
        tx = await priceOracleInstance.setPriceProxy(ONE_ADD, maticUSDOracle);
        await tx.wait(1);
        console.log("Set MATIC/USD (ONE_ADD) in PriceOracle: ", tx.hash);
    } else {
        console.log("MATIC/USD (ONE_ADD) is already set");
    }

    // BITCOIN
    const btcUSDOracle = config.get("chain_link_oracles.btc_usd");
    const checkBitcoinUSDTx = await priceOracleInstance.ChainlinkPriceProxy(
        teleBTC.address
    );

    if (checkBitcoinUSDTx.toLowerCase() != String(btcUSDOracle).toLowerCase()) {
        tx = await priceOracleInstance.setPriceProxy(
            teleBTC.address,
            btcUSDOracle
        );
        await tx.wait(1);
        console.log("Set BTC/USD in PriceOracle: ", tx.hash);
    } else {
        console.log("BTC/USD is already set");
    }

    // USDT
    const usdt = config.get("usdt_token");
    const usdtUSDOracle = config.get("chain_link_oracles.usdt_usd");
    const checkUsdtUSDTx = await priceOracleInstance.ChainlinkPriceProxy(usdt);

    if (checkUsdtUSDTx.toLowerCase() != String(usdtUSDOracle).toLowerCase()) {
        tx = await priceOracleInstance.setPriceProxy(usdt, usdtUSDOracle);
        await tx.wait(1);
        console.log("Set USDT/USD in PriceOracle: ", tx.hash);
    } else {
        console.log("USDT/USD is already set");
    }

    // USDC
    const usdc = config.get("usdc_token");
    const usdcUSDOracle = config.get("chain_link_oracles.usdc_usd");
    const checkUsdcUSDTx = await priceOracleInstance.ChainlinkPriceProxy(usdc);

    if (checkUsdcUSDTx.toLowerCase() != String(usdcUSDOracle).toLowerCase()) {
        tx = await priceOracleInstance.setPriceProxy(usdc, usdcUSDOracle);
        await tx.wait(1);
        console.log("Set USDC/USD in PriceOracle: ", tx.hash);
    } else {
        console.log("USDC/USD is already set");
    }
};

export default func;
