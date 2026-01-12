import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, network } from "hardhat";
import config from "config";
const logger = require("node-color-log");

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, network } = hre;
    const ZERO_ADD = "0x0000000000000000000000000000000000000000";
    const lockersManagerLib = await deployments.get("LockersManagerLib");
    const lockersManagerLogic = await deployments.get("LockersManagerLogic");
    const teleBTC = await deployments.get("TeleBTCProxy");
    const teleBTCLogic = await deployments.get("TeleBTCLogic");
    let priceOracle;
    if (network.name == "bsquared" || network.name == "bob") {
        priceOracle = await deployments.get("PriceOracleRedStone");
    } else {
        priceOracle = await deployments.get("PriceOracle");
    }
    // const priceOracle = await deployments.get("PriceOracle");
    const ccTransferRouterLogic = await deployments.get(
        "CcTransferRouterLogic"
    );
    const ccTransferRouterProxy = await deployments.get(
        "CcTransferRouterProxy"
    );
    const lockersManagerProxy = await deployments.get("LockersManagerProxy");
    const burnRouterLib = await deployments.get("BurnRouterLib");
    const burnRouterLogic = await deployments.get("BurnRouterLogic");
    const burnRouterProxy = await deployments.get("BurnRouterProxy");
    const ccExchangeRouterLogic = await deployments.get(
        "CcExchangeRouterLogic"
    );
    const ccExchangeRouterProxy = await deployments.get(
        "CcExchangeRouterProxy"
    );
    const ccExchangeRouterLib = await deployments.get("CcExchangeRouterLib");

    const minTSTLockedAmount = 0;
    const startingBlockHeight = config.get("starting_block_height");
    const protocolPercentageFee = config.get(
        "cc_transfer.protocol_percentage_fee"
    );
    const chainId = config.get("chain_id");
    const appId = config.get("cc_transfer.app_id");
    const treasuryAddress = config.get("treasury");
    const bitcoinRelay = config.get("bitcoin_relay");
    const collateralRatio = config.get("lockers_contract.collateral_ratio");
    const liquidationRatio = config.get("lockers_contract.liquidation_ratio");
    const lockerPercentageFee = config.get(
        "lockers_contract.locker_percentage_fee"
    );
    const priceWithDiscountRatio = config.get(
        "lockers_contract.price_with_discount_ratio"
    );
    const slasherPercentageReward = config.get(
        "cc_burn.slasher_percentage_reward"
    );
    const bitcoinFee = config.get("cc_burn.bitcoin_fee");
    const transferDeadLine = config.get("cc_burn.transfer_deadLine");
    const chainID = config.get("chain_id");
    const wrappedNativeToken = config.get("wrapped_native_token");

    let across;
    if(network.name == "polygon") {
        across = config.get("across");
    } else {
        across = ZERO_ADD;
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Initialize LockersManager ...");

    const lockersManagerLogicFactory = await ethers.getContractFactory(
        "LockersManagerLogic",
        {
            libraries: {
                LockersManagerLib: lockersManagerLib.address,
            },
        }
    );
    const lockersManagerProxyInstance = await lockersManagerLogicFactory.attach(
        lockersManagerProxy.address
    );
    const lockersManagerLogicInstance = await lockersManagerLogicFactory.attach(
        lockersManagerLogic.address
    );

    let _teleBtcProxy = await lockersManagerProxyInstance.teleBTC();
    if (_teleBtcProxy == ZERO_ADD) {
        const initializeTx = await lockersManagerProxyInstance.initialize(
            teleBTC.address,
            priceOracle.address,
            burnRouterProxy.address,
            minTSTLockedAmount,
            collateralRatio,
            liquidationRatio,
            lockerPercentageFee,
            priceWithDiscountRatio
        );
        await initializeTx.wait(1);
        console.log("Initialized lockersManagerProxy: ", initializeTx.hash);
    } else {
        console.log("lockersManagerProxy is already initialized");
    }

    let _teleBtcLogic = await lockersManagerLogicInstance.teleBTC();
    if (_teleBtcLogic == ZERO_ADD) {
        const initializeTx = await lockersManagerLogicInstance.initialize(
            teleBTC.address,
            priceOracle.address,
            burnRouterProxy.address,
            minTSTLockedAmount,
            collateralRatio,
            liquidationRatio,
            lockerPercentageFee,
            priceWithDiscountRatio
        );
        await initializeTx.wait(1);
        console.log("Initialized lockersManagerLogic: ", initializeTx.hash);
    } else {
        console.log("lockersManagerLogic is already initialized");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Initialize CcTransferRouter ...");

    const ccTransferRouterLogicFactory = await ethers.getContractFactory(
        "CcTransferRouterLogic"
    );
    const ccTransferRouterProxyInstance =
        await ccTransferRouterLogicFactory.attach(
            ccTransferRouterProxy.address
        );
    const ccTransferRouterLogicInstance =
        await ccTransferRouterLogicFactory.attach(
            ccTransferRouterLogic.address
        );

    let _relayProxy = await ccTransferRouterProxyInstance.relay();
    if (_relayProxy == ZERO_ADD) {
        const initializeTx = await ccTransferRouterProxyInstance.initialize(
            startingBlockHeight,
            protocolPercentageFee,
            chainId,
            appId,
            bitcoinRelay,
            lockersManagerProxy.address,
            teleBTC.address,
            treasuryAddress
        );
        await initializeTx.wait(1);
        console.log("Initialized CcTransferRouterProxy: ", initializeTx.hash);
    } else {
        console.log("CcTransferRouterProxy is already initialized");
    }

    let _relayLogic = await ccTransferRouterLogicInstance.relay();
    if (_relayLogic == ZERO_ADD) {
        const initializeTx = await ccTransferRouterLogicInstance.initialize(
            startingBlockHeight,
            protocolPercentageFee,
            chainId,
            appId,
            bitcoinRelay,
            lockersManagerProxy.address,
            teleBTC.address,
            treasuryAddress
        );
        await initializeTx.wait(1);
        console.log("Initialized CcTransferRouterLogic: ", initializeTx.hash);
    } else {
        console.log("CcTransferRouterLogic is already initialized");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Initialize BurnRouter ...");

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
    const burnRouterLogicInstance = await burnRouterLogicFactory.attach(
        burnRouterLogic.address
    );

    _relayProxy = await burnRouterProxyInstance.relay();
    if (_relayProxy == ZERO_ADD) {
        const initializeTx = await burnRouterProxyInstance.initialize(
            startingBlockHeight,
            bitcoinRelay,
            lockersManagerProxy.address,
            treasuryAddress,
            teleBTC.address,
            transferDeadLine,
            protocolPercentageFee,
            slasherPercentageReward,
            bitcoinFee,
            wrappedNativeToken
        );
        await initializeTx.wait(1);
        console.log("Initialized BurnRouterProxy: ", initializeTx.hash);
    } else {
        console.log("BurnRouterProxy is already initialized");
    }

    _relayLogic = await burnRouterLogicInstance.relay();
    if (_relayLogic == ZERO_ADD) {
        const initializeTx = await burnRouterLogicInstance.initialize(
            startingBlockHeight,
            bitcoinRelay,
            lockersManagerProxy.address,
            treasuryAddress,
            teleBTC.address,
            transferDeadLine,
            protocolPercentageFee,
            slasherPercentageReward,
            bitcoinFee,
            wrappedNativeToken
        );
        await initializeTx.wait(1);
        console.log("Initialized BurnRouterLogic: ", initializeTx.hash);
    } else {
        console.log("BurnRouterLogic is already initialized");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Initialize CcExchangeRouter ...");
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
    const ccExchangeRouterLogicInstance =
        await ccExchangeRouterLogicFactory.attach(
            ccExchangeRouterLogic.address
        );

    _relayProxy = await ccExchangeRouterProxyInstance.relay();
    if (_relayProxy == ZERO_ADD) {
        const initializeTx = await ccExchangeRouterProxyInstance.initialize(
            startingBlockHeight,
            protocolPercentageFee,
            chainID,
            lockersManagerProxy.address,
            bitcoinRelay,
            teleBTC.address,
            treasuryAddress,
            across,
            burnRouterProxy.address
        );
        await initializeTx.wait(1);
        console.log("Initialize CcExchangeRouterProxy: ", initializeTx.hash);
    } else {
        console.log("CcExchangeRouterProxy is already initialized");
    }

    _relayLogic = await ccExchangeRouterLogicInstance.relay();
    if (_relayLogic == ZERO_ADD) {
        const initializeTx = await ccExchangeRouterLogicInstance.initialize(
            startingBlockHeight,
            protocolPercentageFee,
            chainID,
            lockersManagerProxy.address,
            bitcoinRelay,
            teleBTC.address,
            treasuryAddress,
            across,
            burnRouterProxy.address
        );
        await initializeTx.wait(1);
        console.log("Initialize CcExchangeRouterLogic: ", initializeTx.hash);
    } else {
        console.log("CcExchangeRouterLogic is already initialized");
    }

    logger
        .color("blue")
        .log("-------------------------------------------------");
    logger.color("blue").bold().log("Initialize TeleBTC ...");

    const teleBTCLogicFactory = await ethers.getContractFactory("TeleBTCLogic");
    const teleBTCProxyInstance = await teleBTCLogicFactory.attach(
        teleBTC.address
    );
    const teleBTCLogicInstance = await teleBTCLogicFactory.attach(
        teleBTCLogic.address
    );

    let _ownerProxy = await teleBTCProxyInstance.owner();
    if (_ownerProxy == ZERO_ADD) {
        const tokenName = "teleBTC";
        const tokenSymbol = "TELEBTC";

        const initializeTxProxy = await teleBTCProxyInstance.initialize(
            tokenName,
            tokenSymbol
        );
        await initializeTxProxy.wait(1);
        console.log("Initialize TeleBTCProxy: ", initializeTxProxy.hash);
    } else {
        console.log("TeleBTCProxy is already initialized");
    }

    let _ownerLogic = await teleBTCLogicInstance.owner();
    if (_ownerLogic == ZERO_ADD) {
        const tokenName = "teleBTC";
        const tokenSymbol = "TELEBTC";

        const initializeTx = await teleBTCLogicInstance.initialize(
            tokenName,
            tokenSymbol
        );
        await initializeTx.wait(1);
        console.log("Initialize TeleBTCLogic: ", initializeTx.hash);
    } else {
        console.log("TeleBTCLogic is already initialized");
    }
};

export default func;
