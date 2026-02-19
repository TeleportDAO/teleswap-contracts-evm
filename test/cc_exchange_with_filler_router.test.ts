// @ts-nocheck
/* eslint-disable camelcase */
/* eslint-disable node/no-missing-import */
/* eslint-disable node/no-extraneous-import */
/* eslint-disable import/no-unresolved */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-unused-vars */
/* eslint-disable prefer-const */
/* eslint-disable eqeqeq */
import "@nomicfoundation/hardhat-chai-matchers";
import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { Signer, BigNumber, Contract } from "ethers";
import {
    deployMockContract,
    MockContract,
} from "@ethereum-waffle/mock-contract";

import { UniswapV2Pair } from "../src/types/UniswapV2Pair";
import { UniswapV2Pair__factory } from "../src/types/factories/UniswapV2Pair__factory";
import { UniswapV2Factory } from "../src/types/UniswapV2Factory";
import { UniswapV2Factory__factory } from "../src/types/factories/UniswapV2Factory__factory";
import { UniswapV2Router02 } from "../src/types/UniswapV2Router02";
import { UniswapV2Router02__factory } from "../src/types/factories/UniswapV2Router02__factory";
import { UniswapV2Connector } from "../src/types/UniswapV2Connector";
import { UniswapV2Connector__factory } from "../src/types/factories/UniswapV2Connector__factory";

import { CcExchangeRouterProxy__factory } from "../src/types/factories/CcExchangeRouterProxy__factory";
import {
    CcExchangeRouterLogic__factory,
    CcExchangeRouterLogicLibraryAddresses,
} from "../src/types/factories/CcExchangeRouterLogic__factory";

import { LockersManagerProxy__factory } from "../src/types/factories/LockersManagerProxy__factory";
import {
    LockersManagerLogic__factory,
    LockersManagerLogicLibraryAddresses,
} from "../src/types/factories/LockersManagerLogic__factory";

import { LockersManagerLib } from "../src/types/LockersManagerLib";
import { LockersManagerLib__factory } from "../src/types/factories/LockersManagerLib__factory";

import { TeleBTCLogic__factory } from "../src/types/factories/TeleBTCLogic__factory";
import { TeleBTCProxy__factory } from "../src/types/factories/TeleBTCProxy__factory";
import { TeleBTC } from "../src/types/TeleBTC";
import { Erc20 } from "../src/types/ERC20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";
import { WETH } from "../src/types/WETH";
import { WETH__factory } from "../src/types/factories/WETH__factory";
import { CcExchangeRouterLib } from "../src/types/CcExchangeRouterLib";
import { CcExchangeRouterLib__factory } from "../src/types/factories/CcExchangeRouterLib__factory";
import { CcExchangeRouterLibExtension } from "../src/types/CcExchangeRouterLibExtension";
import { CcExchangeRouterLibExtension__factory } from "../src/types/factories/CcExchangeRouterLibExtension__factory";

import { BurnRouterLib } from "../src/types/BurnRouterLib";
import { BurnRouterLib__factory } from "../src/types/factories/BurnRouterLib__factory";

import { BurnRouterProxy__factory } from "../src/types/factories/BurnRouterProxy__factory";
import {
    BurnRouterLogic__factory,
    BurnRouterLogicLibraryAddresses,
} from "../src/types/factories/BurnRouterLogic__factory";

import {
    advanceBlockWithTime,
    takeSnapshot,
    revertProvider,
} from "./block_utils";

const CC_EXCHANGE_REQUESTS = require("./test_fixtures/ccExchangeRequests.json");
require("dotenv").config({ path: "../../.env" });

describe("CcExchangeRouter", async () => {
    let snapshotId: any;

    // Constants
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
    const DUMMY_ADDRESS = "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    const CHAIN_ID = 1;
    const APP_ID = 1;
    const PROTOCOL_PERCENTAGE_FEE = 10; // Means %0.1
    const LOCKER_PERCENTAGE_FEE = 20; // Means %0.2
    const PRICE_WITH_DISCOUNT_RATIO = 9500; // Means %95
    const STARTING_BLOCK_NUMBER = 1;
    const TREASURY = "0x0000000000000000000000000000000000000002";
    const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001";
    const NATIVE_TOKEN_DECIMAL = 18;
    const ONE_HOUNDRED_PERCENT = 10000;
    const BITCOIN_FEE = 10;
    const FILLING_DELAY = 1440000;

    // Mock burn amount
    const BURN_AMOUNT = 10;

    // Bitcoin public key (32 bytes)
    let LOCKER1_LOCKING_SCRIPT =
        "0xa9144062c8aeed4f81c2d73ff854a2957021191e20b687";
    let LOCKER_TARGET_ADDRESS = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

    let LOCKER_RESCUE_SCRIPT_P2PKH =
        "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
    let LOCKER_RESCUE_SCRIPT_P2PKH_TYPE = 1; // P2PKH

    let USER_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
    let USER_SCRIPT_P2PKH_TYPE = 1; // P2PKH

    let telePortTokenInitialSupply = BigNumber.from(10).pow(18).mul(10000);
    let minRequiredTNTLockedAmount = BigNumber.from(10).pow(18).mul(5);
    let collateralRatio = 20000;
    let liquidationRatio = 15000;

    // Accounts
    let proxyAdmin: Signer;
    let deployer: Signer;
    let filler: Signer;
    let signer1: Signer;
    let signer2: Signer;
    let locker: Signer;
    let proxyAdminAddress: string;
    let deployerAddress: string;
    let fillerAddress: string;
    let signer1Address: string;
    let signer2Address: string;
    let lockerAddress: string;

    // Contracts
    let exchangeConnector: UniswapV2Connector;
    let uniswapV2Router02: UniswapV2Router02;
    let uniswapV2Pair: UniswapV2Pair;
    let uniswapV2Factory: UniswapV2Factory;
    let ccExchangeRouter: Contract;
    let lockersLib: LockersManagerLib;
    let lockers: Contract;
    let teleBTC: TeleBTC;
    let teleportDAOToken: Erc20;
    let exchangeToken: Erc20;
    let anotherExchangeToken: Erc20;
    let weth: WETH;
    let burnRouterLib: BurnRouterLib;
    let burnRouter: Contract;

    // Mock contracts
    let mockBitcoinRelay: MockContract;
    let mockInstantRouter: MockContract;
    let mockPriceOracle: MockContract;
    let mockAcross: MockContract;
    let mockLockers: MockContract;

    //
    let uniswapV2Pair__factory: UniswapV2Pair__factory;

    let address1 = "0x0000000000000000000000000000000000000001";

    before(async () => {
        // Sets accounts
        [proxyAdmin, deployer, signer1, locker, signer2, filler] =
            await ethers.getSigners();
        proxyAdminAddress = await proxyAdmin.getAddress();
        deployerAddress = await deployer.getAddress();
        fillerAddress = await filler.getAddress();
        signer1Address = await signer1.getAddress();
        signer2Address = await signer2.getAddress();
        lockerAddress = await locker.getAddress();

        teleportDAOToken = await deployTeleportDAOToken();

        // Mocks relay contract
        const bitcoinRelayContract = await deployments.getArtifact(
            "IBitcoinRelay"
        );
        mockBitcoinRelay = await deployMockContract(
            deployer,
            bitcoinRelayContract.abi
        );

        const priceOracleContract = await deployments.getArtifact(
            "IPriceOracle"
        );
        mockPriceOracle = await deployMockContract(
            deployer,
            priceOracleContract.abi
        );

        await mockPriceOracle.mock.equivalentOutputAmount.returns(100000);

        // Mocks checkTxProof of bitcoinRelay
        // We don't pass arguments since the request was modified and the txId is not valid
        await mockBitcoinRelay.mock.getBlockHeaderFee.returns(0); // Fee of relay
        await mockBitcoinRelay.mock.checkTxProof.returns(true);
        await mockBitcoinRelay.mock.finalizationParameter.returns(5);

        // Mocks across
        const across = {
            abi: [
                {
                    inputs: [
                        { type: "address", name: "depositor" },
                        { type: "address", name: "recipient" },
                        { type: "address", name: "inputToken" },
                        { type: "address", name: "outputToken" },
                        { type: "uint256", name: "inputAmount" },
                        { type: "uint256", name: "outputAmount" },
                        { type: "uint256", name: "destinationChainId" },
                        { type: "address", name: "exclusiveRelayer" },
                        { type: "uint32", name: "quoteTimestamp" },
                        { type: "uint32", name: "fillDeadline" },
                        { type: "uint32", name: "exclusivityDeadline" },
                        { type: "bytes", name: "message" },
                    ],
                    name: "depositV3",
                    outputs: [],
                    stateMutability: "nonpayable",
                    type: "function",
                },
            ],
        };

        // Mocks across
        mockAcross = await deployMockContract(deployer, across.abi);
        await mockAcross.mock.depositV3.returns();

        // // Mocks instant router contract
        // const instantRouterContract = await deployments.getArtifact(
        //     "IInstantRouter"
        // );
        // mockInstantRouter = await deployMockContract(
        //     deployer,
        //     instantRouterContract.abi
        // );

        // await mockInstantRouter.mock.payBackLoan.returns(true);

        // Deploys teleBTC contract

        const teleBTCLogicFactory = new TeleBTCLogic__factory(deployer);
        const teleBTCLogic = await teleBTCLogicFactory.deploy();

        const teleBTCProxyFactory = new TeleBTCProxy__factory(deployer);
        const teleBTCProxy = await teleBTCProxyFactory.deploy(
            teleBTCLogic.address,
            proxyAdminAddress,
            "0x"
        );

        teleBTC = await teleBTCLogic.attach(teleBTCProxy.address);

        await teleBTC.initialize("TeleportDAO-BTC", "teleBTC");

        // Deploys WETH contract
        const wethFactory = new WETH__factory(deployer);
        weth = await wethFactory.deploy("WrappedEthereum", "WETH");

        // Deploys uniswapV2Factory
        const uniswapV2FactoryFactory = new UniswapV2Factory__factory(deployer);
        uniswapV2Factory = await uniswapV2FactoryFactory.deploy(
            deployerAddress
        );

        // Creates uniswapV2Pair__factory object
        uniswapV2Pair__factory = new UniswapV2Pair__factory(deployer);

        // Deploys uniswapV2Router02 contract
        const uniswapV2Router02Factory = new UniswapV2Router02__factory(
            deployer
        );
        uniswapV2Router02 = await uniswapV2Router02Factory.deploy(
            uniswapV2Factory.address,
            weth.address // WETH
        );

        // Deploys uniswap connector
        const exchangeConnectorFactory = new UniswapV2Connector__factory(
            deployer
        );
        exchangeConnector = await exchangeConnectorFactory.deploy();
        await exchangeConnector.initialize(
            "TheExchangeConnector",
            uniswapV2Router02.address
        );

        // Deploys exchange token
        // We replace the exchangeToken address in ccExchangeRequests
        const erc20Factory = new Erc20__factory(deployer);
        exchangeToken = await erc20Factory.deploy("TestToken", "TT", 100000);

        // Deploys an ERC20 token
        anotherExchangeToken = await erc20Factory.deploy(
            "AnotherTestToken",
            "ATT",
            100000
        );

        lockers = await deployLockers();

        // Deploys burn router

        const LockersManagerLogic = await deployments.getArtifact(
            "LockersManagerLogic"
        );
        mockLockers = await deployMockContract(
            deployer,
            LockersManagerLogic.abi
        );

        burnRouter = await deployBurnRouter();
        await burnRouter.initialize(
            1,
            mockBitcoinRelay.address,
            mockLockers.address,
            TREASURY,
            teleBTC.address,
            10,
            PROTOCOL_PERCENTAGE_FEE,
            LOCKER_PERCENTAGE_FEE,
            10,
            BITCOIN_FEE,
            weth.address
        );

        await mockLockers.mock.burn.returns(BURN_AMOUNT);
        await mockLockers.mock.isLocker.returns(true);
        await mockLockers.mock.getLockerTargetAddress.returns(
            LOCKER_TARGET_ADDRESS
        );
        await mockBitcoinRelay.mock.lastSubmittedHeight.returns(100);

        // Deploys ccExchangeRouter contract
        let linkLibraryAddresses: CcExchangeRouterLogicLibraryAddresses;

        let ccExchangeRouterLib = await deployCcExchangeRouterLib();
        let ccExchangeRouterLibExtension =
            await deployCcExchangeRouterLibExtension();
        linkLibraryAddresses = {
            "contracts/routers/CcExchangeRouterLib.sol:CcExchangeRouterLib":
                ccExchangeRouterLib.address,
            "contracts/routers/CcExchangeRouterLibExtension.sol:CcExchangeRouterLibExtension":
                ccExchangeRouterLibExtension.address,
        };
        const ccExchangeRouterLogicFactory = new CcExchangeRouterLogic__factory(
            linkLibraryAddresses,
            deployer
        );
        const ccExchangeRouterLogic =
            await ccExchangeRouterLogicFactory.deploy();

        const ccExchangeRouterProxyFactory = new CcExchangeRouterProxy__factory(
            deployer
        );
        const ccExchangeRouterProxy = await ccExchangeRouterProxyFactory.deploy(
            ccExchangeRouterLogic.address,
            proxyAdminAddress,
            "0x"
        );

        ccExchangeRouter = await ccExchangeRouterLogic.attach(
            ccExchangeRouterProxy.address
        );

        await ccExchangeRouter.initialize(
            STARTING_BLOCK_NUMBER,
            PROTOCOL_PERCENTAGE_FEE,
            LOCKER_PERCENTAGE_FEE,
            CHAIN_ID,
            lockers.address,
            mockBitcoinRelay.address,
            teleBTC.address,
            TREASURY,
            mockAcross.address,
            burnRouter.address
        );

        // Sets exchangeConnector address in ccExchangeRouter
        await ccExchangeRouter.setExchangeConnector(
            APP_ID,
            exchangeConnector.address
        );

        await lockers.setTeleBTC(teleBTC.address);
        await lockers.addMinter(ccExchangeRouter.address);

        await teleBTC.addMinter(lockers.address);
        await teleBTC.addBurner(lockers.address);

        await ccExchangeRouter.setLockers(lockers.address);
        // await ccExchangeRouter.setInstantRouter(mockInstantRouter.address)
    });

    const deployTeleportDAOToken = async (_signer?: Signer): Promise<Erc20> => {
        const erc20Factory = new Erc20__factory(_signer || deployer);

        const teleportDAOToken = await erc20Factory.deploy(
            "TeleportDAOToken",
            "TST",
            telePortTokenInitialSupply
        );

        return teleportDAOToken;
    };

    const deployLockersManagerLib = async (
        _signer?: Signer
    ): Promise<LockersManagerLib> => {
        const LockersManagerLibFactory = new LockersManagerLib__factory(
            _signer || deployer
        );

        const lockersLib = await LockersManagerLibFactory.deploy();

        return lockersLib;
    };

    const deployLockers = async (_signer?: Signer): Promise<Contract> => {
        lockersLib = await deployLockersManagerLib();

        let linkLibraryAddresses: LockersManagerLogicLibraryAddresses;

        linkLibraryAddresses = {
            "contracts/lockersManager/LockersManagerLib.sol:LockersManagerLib":
                lockersLib.address,
        };

        // Deploys lockers logic
        const lockersLogicFactory = new LockersManagerLogic__factory(
            linkLibraryAddresses,
            _signer || deployer
        );

        const lockersLogic = await lockersLogicFactory.deploy();

        // Deploys lockers proxy
        const lockersProxyFactory = new LockersManagerProxy__factory(
            _signer || deployer
        );
        const lockersProxy = await lockersProxyFactory.deploy(
            lockersLogic.address,
            proxyAdminAddress,
            "0x"
        );

        const lockers = await lockersLogic.attach(lockersProxy.address);

        // Initializes lockers proxy
        await lockers.initialize(
            teleBTC.address,
            mockPriceOracle.address,
            ONE_ADDRESS,
            0,
            collateralRatio,
            liquidationRatio,
            LOCKER_PERCENTAGE_FEE,
            PRICE_WITH_DISCOUNT_RATIO
        );

        await lockers.setTST(teleportDAOToken.address);
        return lockers;
    };

    async function addLockerToLockers(): Promise<void> {
        // TODO change locker to target locker
        let lockerlocker = lockers.connect(locker);

        await lockers.addCollateralToken(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL
        );
        await lockerlocker.requestToBecomeLocker(
            LOCKER1_LOCKING_SCRIPT,
            NATIVE_TOKEN_ADDRESS,
            0,
            minRequiredTNTLockedAmount,
            LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
            LOCKER_RESCUE_SCRIPT_P2PKH,
            { value: minRequiredTNTLockedAmount }
        );

        await lockers.addLocker(lockerAddress, ONE_HOUNDRED_PERCENT);
    }

    const deployCcExchangeRouterLib = async (
        _signer?: Signer
    ): Promise<CcExchangeRouterLib> => {
        const CcExchangeRouterFactory = new CcExchangeRouterLib__factory(
            _signer || deployer
        );

        const CcExchangeRouter = await CcExchangeRouterFactory.deploy();

        return CcExchangeRouter;
    };

    const deployCcExchangeRouterLibExtension = async (
        _signer?: Signer
    ): Promise<CcExchangeRouterLibExtension> => {
        const CcExchangeRouterLibExtensionFactory =
            new CcExchangeRouterLibExtension__factory(_signer || deployer);

        const CcExchangeRouterLibExtension =
            await CcExchangeRouterLibExtensionFactory.deploy();

        return CcExchangeRouterLibExtension;
    };

    const deployBurnRouterLib = async (
        _signer?: Signer
    ): Promise<BurnRouterLib> => {
        const BurnRouterLibFactory = new BurnRouterLib__factory(
            _signer || deployer
        );

        const burnRouterLib = await BurnRouterLibFactory.deploy();

        return burnRouterLib;
    };

    const deployBurnRouter = async (_signer?: Signer): Promise<Contract> => {
        burnRouterLib = await deployBurnRouterLib();
        let linkLibraryAddresses: BurnRouterLogicLibraryAddresses;

        linkLibraryAddresses = {
            "contracts/routers/BurnRouterLib.sol:BurnRouterLib":
                burnRouterLib.address,
        };

        // Deploys lockers logic
        const burnRouterLogicFactory = new BurnRouterLogic__factory(
            linkLibraryAddresses,
            _signer || deployer
        );

        const burnRouterLogic = await burnRouterLogicFactory.deploy();

        // Deploys lockers proxy
        const burnRouterProxyFactory = new BurnRouterProxy__factory(
            _signer || deployer
        );
        const burnRouterProxy = await burnRouterProxyFactory.deploy(
            burnRouterLogic.address,
            proxyAdminAddress,
            "0x"
        );

        return await burnRouterLogic.attach(burnRouterProxy.address);
    };

    describe.only("#ccExchangeWithFiller", async () => {
        let oldReserveTeleBTC: BigNumber;
        let oldReserveTT: BigNumber;
        let oldDeployerBalanceTeleBTC: BigNumber;
        let oldUserBalanceTeleBTC: BigNumber;
        let oldDeployerBalanceTT: BigNumber;
        let oldUserBalanceTT: BigNumber;
        let oldTotalSupplyTeleBTC: BigNumber;

        function calculateFees(request: any): [number, number, number] {
            // Calculates fees
            let lockerFee = Math.floor(
                (request.bitcoinAmount * LOCKER_PERCENTAGE_FEE) / 10000
            );
            let teleporterFee = Math.floor(
                (request.bitcoinAmount * request.teleporterFee) / 10000
            );
            let protocolFee = Math.floor(
                (request.bitcoinAmount * PROTOCOL_PERCENTAGE_FEE) / 10000
            );

            return [lockerFee, teleporterFee, protocolFee];
        }

        async function checksWhenExchangeSucceed(
            _exchangeToken: any,
            isFixedToken: boolean,
            recipientAddress: string,
            bitcoinAmount: number,
            teleporterFee: number,
            protocolFee: number,
            lockerFee: number,
            expectedOutputAmount: number,
            requiredInputAmount?: number
        ) {
            // General checks

            // Records new supply of teleBTC
            let newTotalSupplyTeleBTC = await teleBTC.totalSupply();

            // Records new teleBTC and TT balances of user
            let newUserBalanceTeleBTC = await teleBTC.balanceOf(
                recipientAddress
            );
            let newUserBalanceTT = await _exchangeToken.balanceOf(
                recipientAddress
            );

            // Records new teleBTC and TST balances of teleporter
            let newDeployerBalanceTeleBTC = await teleBTC.balanceOf(
                deployerAddress
            );
            let newDeployerBalanceTT = await _exchangeToken.balanceOf(
                deployerAddress
            );

            // Checks that extra teleBTC hasn't been minted
            expect(newTotalSupplyTeleBTC).to.equal(
                oldTotalSupplyTeleBTC.add(bitcoinAmount)
            );

            // Checks that enough teleBTC has been minted for teleporter
            expect(newDeployerBalanceTeleBTC).to.equal(
                oldDeployerBalanceTeleBTC.add(teleporterFee)
            );

            // Checks that teleporter TT balance hasn't changed
            expect(newDeployerBalanceTT).to.equal(oldDeployerBalanceTT);

            // Checks that correct amount of teleBTC has been minted for protocol
            expect(await teleBTC.balanceOf(TREASURY)).to.equal(protocolFee);

            // Checks that correct amount of teleBTC has been minted for locker
            expect(await teleBTC.balanceOf(lockerAddress)).to.equal(lockerFee);

            // Checks that user received enough TT
            expect(newUserBalanceTT).to.equal(
                oldUserBalanceTT.add(expectedOutputAmount)
            );

            if (isFixedToken == true) {
                // Checks that user teleBTC balance hasn't changed
                expect(newUserBalanceTeleBTC).to.equal(oldUserBalanceTeleBTC);
            } else {
                // Checks that user received unused teleBTC
                if (requiredInputAmount != undefined) {
                    expect(newUserBalanceTeleBTC).to.equal(
                        oldUserBalanceTeleBTC.toNumber() +
                            bitcoinAmount -
                            teleporterFee -
                            lockerFee -
                            protocolFee -
                            requiredInputAmount
                    );
                }
            }
        }

        async function checksWhenExchangeFails(
            recipientAddress: string,
            bitcoinAmount: number,
            teleporterFee: number,
            protocolFee: number,
            lockerFee: number
        ) {
            // Records new supply of teleBTC
            let newTotalSupplyTeleBTC = await teleBTC.totalSupply();

            // Records new teleBTC and TST balances of user
            let newUserBalanceTeleBTC = await teleBTC.balanceOf(
                recipientAddress
            );
            let newUserBalanceTT = await exchangeToken.balanceOf(
                recipientAddress
            );

            // Records new teleBTC and TST balances of teleporter
            let newDeployerBalanceTeleBTC = await teleBTC.balanceOf(
                deployerAddress
            );
            let newDeployerBalanceTT = await exchangeToken.balanceOf(
                deployerAddress
            );

            // Checks enough teleBTC has been minted for user
            expect(newUserBalanceTeleBTC).to.equal(
                oldUserBalanceTeleBTC.add(
                    bitcoinAmount - lockerFee - teleporterFee - protocolFee
                )
            );

            // Checks that enough teleBTC has been minted for teleporter
            expect(newDeployerBalanceTeleBTC).to.equal(
                oldDeployerBalanceTeleBTC.add(teleporterFee)
            );

            // Checks that user TT balance hasn't changed
            expect(newUserBalanceTT).to.equal(oldUserBalanceTT);

            // Checks that correct amount of teleBTC has been minted for protocol
            expect(await teleBTC.balanceOf(TREASURY)).to.equal(protocolFee);

            // Checks that correct amount of teleBTC has been minted for locker
            expect(await teleBTC.balanceOf(lockerAddress)).to.equal(lockerFee);

            // Checks extra teleBTC hasn't been minted
            expect(newTotalSupplyTeleBTC).to.equal(
                oldTotalSupplyTeleBTC.add(bitcoinAmount)
            );
        }

        beforeEach("Adds liquidity to liquidity pool", async () => {
            // Takes snapshot before adding liquidity
            snapshotId = await takeSnapshot(deployer.provider);

            // Adds liquidity to teleBTC-TST liquidity pool
            await teleBTC.addMinter(deployerAddress);
            await teleBTC.mint(deployerAddress, 10000000);
            await teleBTC.approve(uniswapV2Router02.address, 10000);
            await exchangeToken.approve(uniswapV2Router02.address, 10000);
            let addedLiquidityA = 10000;
            let addedLiquidityB = 10000;

            await teleBTC.mint(fillerAddress, 10000000);
            await teleBTC
                .connect(filler)
                .approve(uniswapV2Router02.address, 10000);
            await exchangeToken
                .connect(filler)
                .approve(uniswapV2Router02.address, 10000);

            // console.log(await teleBTC.balanceOf(deployerAddress))
            // await uniswapV2Router02.addLiquidity(
            //     teleBTC.address,
            //     exchangeToken.address,
            //     addedLiquidityA,
            //     addedLiquidityB,
            //     0, // Minimum added liquidity for first token
            //     0, // Minimum added liquidity for second token
            //     deployerAddress,
            //     1000000000000000, // Long deadline
            // );

            // // Creates liquidity pool of TeleBTC-WETH and adds liquidity in it
            // await teleBTC.approve(uniswapV2Router02.address, 10000);
            // await uniswapV2Router02.addLiquidityETH(
            //     teleBTC.address,
            //     10000,
            //     0, // Minimum added liquidity for first token
            //     0, // Minimum added liquidity for second token
            //     deployerAddress,
            //     10000000000000, // Long deadline
            //     {value: 10000}
            // );

            let liquidityPoolAddress = await uniswapV2Factory.getPair(
                teleBTC.address,
                exchangeToken.address
            );

            // Records total supply of teleBTC
            oldTotalSupplyTeleBTC = await teleBTC.totalSupply();

            // Loads teleBTC-TST liquidity pool
            uniswapV2Pair = await uniswapV2Pair__factory.attach(
                liquidityPoolAddress
            );

            // Records current reserves of teleBTC and TT
            // if (await uniswapV2Pair.token0() == teleBTC.address) {
            //     [oldReserveTeleBTC, oldReserveTT] = await uniswapV2Pair.getReserves();
            // } else {
            //     [oldReserveTT, oldReserveTeleBTC] = await uniswapV2Pair.getReserves()
            // }

            // Records current teleBTC and TT balances of user and teleporter
            oldUserBalanceTeleBTC = await teleBTC.balanceOf(
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress
            );
            oldDeployerBalanceTeleBTC = await teleBTC.balanceOf(
                deployerAddress
            );
            oldUserBalanceTT = await exchangeToken.balanceOf(
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress
            );
            oldDeployerBalanceTT = await exchangeToken.balanceOf(
                deployerAddress
            );

            // await ccExchangeRouter.setFillerWithdrawInterval(144000);

            await addLockerToLockers();
        });

        afterEach(async () => {
            // Reverts the state to the before of adding liquidity
            await revertProvider(deployer.provider, snapshotId);
        });

        async function getTimestamp(): Promise<number> {
            let lastBlockNumber = await ethers.provider.getBlockNumber();
            let lastBlock = await ethers.provider.getBlock(lastBlockNumber);
            return lastBlock.timestamp;
        }

        // Helper function to prepare fillTxUniversal parameters
        function prepareFillParams(
            txId: string,
            recipientAddress: string,
            intermediaryToken: string,
            fillAmount: number,
            userRequestedAmount: number,
            destChainId: number = CHAIN_ID,
            bridgePercentageFee: number = 0
        ) {
            return {
                txId: txId,
                recipient: ethers.utils.hexZeroPad(recipientAddress, 32),
                intermediaryToken: intermediaryToken,
                outputToken: ethers.utils.hexZeroPad(intermediaryToken, 32),
                fillAmount: fillAmount,
                userRequestedAmount: userRequestedAmount,
                destRealChainId: destChainId,
                bridgePercentageFee: bridgePercentageFee,
                lockerLockingScript: LOCKER1_LOCKING_SCRIPT,
                pathFromIntermediaryToDestTokenOnDestChain: [],
                amountsFromIntermediaryToDestTokenOnDestChain: [],
            };
        }

        it("Filler can fill a transaction with a non-native token on the current chain", async function () {
            let txId =
                "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d";

            // Set up intermediary token mapping (required by contract)
            await ccExchangeRouter.setIntermediaryTokenMapping(
                "0x" + exchangeToken.address.slice(-16),
                CHAIN_ID,
                ethers.utils.hexZeroPad(exchangeToken.address, 32)
            );

            let recipient = ethers.utils.hexZeroPad(
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress,
                32
            );
            let outputToken = ethers.utils.hexZeroPad(
                exchangeToken.address,
                32
            );
            let userRequestedAmount =
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount;
            let destRealChainId = CHAIN_ID;
            let bridgePercentageFee = 0;
            let fillAmount = 1000;
            // finalAmount = fillAmount * (MAX_BRIDGE_FEE - bridgePercentageFee) / MAX_BRIDGE_FEE
            // With bridgePercentageFee = 0, finalAmount = fillAmount = 1000
            let finalAmount = fillAmount;

            await exchangeToken.transfer(fillerAddress, fillAmount);
            await exchangeToken
                .connect(filler)
                .approve(ccExchangeRouter.address, fillAmount);
            await expect(
                ccExchangeRouter
                    .connect(filler)
                    .fillTxUniversal(
                        txId,
                        recipient,
                        exchangeToken.address,
                        outputToken,
                        fillAmount,
                        userRequestedAmount,
                        destRealChainId,
                        bridgePercentageFee,
                        LOCKER1_LOCKING_SCRIPT,
                        [],
                        []
                    )
            )
                .to.emit(ccExchangeRouter, "RequestFilledUniversal")
                .withArgs(
                    fillerAddress, // filler
                    recipient.toLowerCase(), // user (bytes32)
                    LOCKER_TARGET_ADDRESS, // lockerTargetAddress
                    txId, // bitcoinTxId
                    [teleBTC.address, exchangeToken.address], // inputAndOutputToken
                    [
                        fillAmount,
                        finalAmount,
                        userRequestedAmount,
                        destRealChainId,
                        bridgePercentageFee,
                    ], // amountArgs: [fillAmount, finalAmount, userRequestedAmount, destinationChainId, bridgePercentageFee]
                    [], // pathFromIntermediaryToDestTokenOnDestChain
                    [] // amountsFromIntermediaryToDestTokenOnDestChain
                );
        });

        it("Filler can fill a universal transaction (swap on destination chain)", async function () {
            let txId =
                "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d";

            // Set up for cross-chain transaction (destination chain 2)
            await ccExchangeRouter.setChainIdMapping(2, 2);
            await ccExchangeRouter.setDestConnectorProxyMapping(
                2,
                ethers.utils.hexZeroPad(exchangeConnector.address, 32)
            );

            // Set up intermediary token mapping (required by contract)
            await ccExchangeRouter.setIntermediaryTokenMapping(
                "0x" + exchangeToken.address.slice(-16),
                CHAIN_ID,
                ethers.utils.hexZeroPad(exchangeToken.address, 32)
            );

            // Set up intermediary token mapping for destination chain (required for universal swap validation)
            await ccExchangeRouter.setIntermediaryTokenMapping(
                "0x" + exchangeToken.address.slice(-16),
                2, // destination chain ID
                ethers.utils.hexZeroPad(exchangeToken.address, 32)
            );

            // Set bridge token ID mapping for destination chain
            await ccExchangeRouter.setBridgeTokenIDMapping(
                "0x" + exchangeToken.address.slice(-16),
                2, // destination chain ID
                ethers.utils.hexZeroPad(exchangeToken.address, 32)
            );

            let recipient = ethers.utils.hexZeroPad(
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress,
                32
            );
            let outputToken = ethers.utils.hexZeroPad(
                exchangeToken.address,
                32
            );
            let userRequestedAmount =
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount;
            let destRealChainId = 2; // Different chain for universal swap
            let bridgePercentageFee = 0;
            let fillAmount = 1000;
            // finalAmount = fillAmount * (MAX_BRIDGE_FEE - bridgePercentageFee) / MAX_BRIDGE_FEE
            // With bridgePercentageFee = 0, finalAmount = fillAmount = 1000
            let finalAmount = fillAmount;

            // Path from intermediary token to destination token on destination chain
            // For a simple swap where intermediary = destination, path is [intermediary, destination]
            let pathFromIntermediaryToDestTokenOnDestChain = [
                ethers.utils
                    .hexZeroPad(exchangeToken.address, 32)
                    .toLowerCase(),
                ethers.utils
                    .hexZeroPad(exchangeToken.address, 32)
                    .toLowerCase(),
            ];

            // Amounts for each step in the path (same amount for both steps in this case)
            let amountsFromIntermediaryToDestTokenOnDestChain = [
                finalAmount,
                finalAmount,
            ];

            await exchangeToken.transfer(fillerAddress, fillAmount);
            await exchangeToken
                .connect(filler)
                .approve(ccExchangeRouter.address, fillAmount);
            await expect(
                ccExchangeRouter
                    .connect(filler)
                    .fillTxUniversal(
                        txId,
                        recipient,
                        exchangeToken.address,
                        outputToken,
                        fillAmount,
                        userRequestedAmount,
                        destRealChainId,
                        bridgePercentageFee,
                        LOCKER1_LOCKING_SCRIPT,
                        pathFromIntermediaryToDestTokenOnDestChain,
                        amountsFromIntermediaryToDestTokenOnDestChain
                    )
            )
                .to.emit(ccExchangeRouter, "RequestFilledUniversal")
                .withArgs(
                    fillerAddress, // filler
                    recipient.toLowerCase(), // user (bytes32)
                    LOCKER_TARGET_ADDRESS, // lockerTargetAddress
                    txId, // bitcoinTxId
                    [teleBTC.address, exchangeToken.address], // inputAndOutputToken
                    [
                        fillAmount,
                        finalAmount,
                        userRequestedAmount,
                        destRealChainId,
                        bridgePercentageFee,
                    ], // amountArgs: [fillAmount, finalAmount, userRequestedAmount, destinationChainId, bridgePercentageFee]
                    pathFromIntermediaryToDestTokenOnDestChain, // pathFromIntermediaryToDestTokenOnDestChain
                    amountsFromIntermediaryToDestTokenOnDestChain // amountsFromIntermediaryToDestTokenOnDestChain
                );
        });

        it("Filler can fill a transaction with the native token (ETH) on the current chain", async function () {
            let txId =
                "0x724edeed41361abc535f38c074f164c05dda05431139d39eeb474702b085a9d1";

            // Set wrapped native token (WETH)
            await ccExchangeRouter.setWrappedNativeToken(weth.address);

            // Set up intermediary token mapping for native token
            // The mapping key is bytes8(uint64(uint256(_outputToken)))
            // For NATIVE_TOKEN_ADDRESS (0x0000...0001), last 8 bytes = 0x0000000000000001
            await ccExchangeRouter.setIntermediaryTokenMapping(
                "0x0000000000000001",
                CHAIN_ID,
                ethers.utils.hexZeroPad(weth.address, 32)
            );

            let recipient = ethers.utils.hexZeroPad(
                CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth
                    .recipientAddress,
                32
            );
            // For native token, outputToken should be bytes32 of NATIVE_TOKEN_ADDRESS
            let outputToken = ethers.utils.hexZeroPad(NATIVE_TOKEN_ADDRESS, 32);
            let userRequestedAmount =
                CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.exchangeAmount;
            let destRealChainId = CHAIN_ID; // Current chain
            let bridgePercentageFee = 0;
            let fillAmount = BigNumber.from("1000000000000000000000"); // 1000 ETH

            // finalAmount = fillAmount * (MAX_BRIDGE_FEE - bridgePercentageFee) / MAX_BRIDGE_FEE
            // With bridgePercentageFee = 0, finalAmount = fillAmount
            let finalAmount = fillAmount;

            // Filler needs to wrap ETH to WETH first
            await weth.connect(filler).deposit({ value: fillAmount });
            await weth
                .connect(filler)
                .approve(ccExchangeRouter.address, fillAmount);

            // Get recipient's ETH balance before
            let recipientAddress =
                CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth
                    .recipientAddress;
            let oldRecipientEthBalance = await ethers.provider.getBalance(
                recipientAddress
            );

            await expect(
                ccExchangeRouter.connect(filler).fillTxUniversal(
                    txId,
                    recipient,
                    weth.address, // intermediaryToken is WETH
                    outputToken,
                    fillAmount,
                    userRequestedAmount,
                    destRealChainId,
                    bridgePercentageFee,
                    LOCKER1_LOCKING_SCRIPT,
                    [],
                    []
                )
            )
                .to.emit(ccExchangeRouter, "RequestFilledUniversal")
                .withArgs(
                    fillerAddress,
                    recipient.toLowerCase(),
                    LOCKER_TARGET_ADDRESS,
                    txId,
                    [teleBTC.address, weth.address],
                    [
                        fillAmount,
                        finalAmount,
                        userRequestedAmount,
                        destRealChainId,
                        bridgePercentageFee,
                    ],
                    [],
                    []
                );

            // Check that recipient received native ETH
            let newRecipientEthBalance = await ethers.provider.getBalance(
                recipientAddress
            );
            expect(newRecipientEthBalance.sub(oldRecipientEthBalance)).to.equal(
                fillAmount
            );
        });

        it("A filler can't fill a tx twice with same parameters", async function () {
            let txId =
                "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d";

            // Set up intermediary token mapping
            await ccExchangeRouter.setIntermediaryTokenMapping(
                "0x" + exchangeToken.address.slice(-16),
                CHAIN_ID,
                ethers.utils.hexZeroPad(exchangeToken.address, 32)
            );

            let recipient = ethers.utils.hexZeroPad(
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress,
                32
            );
            let outputToken = ethers.utils.hexZeroPad(
                exchangeToken.address,
                32
            );
            let userRequestedAmount =
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount;
            let destRealChainId = CHAIN_ID;
            let bridgePercentageFee = 0;
            let fillAmount = 1000;

            await exchangeToken.transfer(fillerAddress, fillAmount * 2);
            await exchangeToken
                .connect(filler)
                .approve(ccExchangeRouter.address, fillAmount * 2);

            // First fill should succeed
            await expect(
                ccExchangeRouter
                    .connect(filler)
                    .fillTxUniversal(
                        txId,
                        recipient,
                        exchangeToken.address,
                        outputToken,
                        fillAmount,
                        userRequestedAmount,
                        destRealChainId,
                        bridgePercentageFee,
                        LOCKER1_LOCKING_SCRIPT,
                        [],
                        []
                    )
            ).to.emit(ccExchangeRouter, "RequestFilledUniversal");

            // Second fill with same parameters should fail
            await expect(
                ccExchangeRouter
                    .connect(filler)
                    .fillTxUniversal(
                        txId,
                        recipient,
                        exchangeToken.address,
                        outputToken,
                        fillAmount,
                        userRequestedAmount,
                        destRealChainId,
                        bridgePercentageFee,
                        LOCKER1_LOCKING_SCRIPT,
                        [],
                        []
                    )
            ).to.be.revertedWith("ExchangeRouter: already filled");
        });

        it("can't fill tx because fillers provide insufficient amount", async function () {
            let txId =
                "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d";

            // Set up intermediary token mapping
            await ccExchangeRouter.setIntermediaryTokenMapping(
                "0x" + exchangeToken.address.slice(-16),
                CHAIN_ID,
                ethers.utils.hexZeroPad(exchangeToken.address, 32)
            );

            let recipient = ethers.utils.hexZeroPad(
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress,
                32
            );
            let outputToken = ethers.utils.hexZeroPad(
                exchangeToken.address,
                32
            );
            let userRequestedAmount =
                CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount;
            let destRealChainId = CHAIN_ID;
            let bridgePercentageFee = 0;
            let fillAmount = 10; // Insufficient amount (less than userRequestedAmount which is 17)

            // With bridgePercentageFee = 0, finalAmount = fillAmount = 10
            // But userRequestedAmount = 17, so finalAmount (10) < userRequestedAmount (17)
            // This should fail with "ExchangeRouter: insufficient fill amount"

            await exchangeToken.transfer(fillerAddress, fillAmount);
            await exchangeToken
                .connect(filler)
                .approve(ccExchangeRouter.address, fillAmount);

            await expect(
                ccExchangeRouter
                    .connect(filler)
                    .fillTxUniversal(
                        txId,
                        recipient,
                        exchangeToken.address,
                        outputToken,
                        fillAmount,
                        userRequestedAmount,
                        destRealChainId,
                        bridgePercentageFee,
                        LOCKER1_LOCKING_SCRIPT,
                        [],
                        []
                    )
            ).to.be.revertedWith("ExchangeRouter: insufficient fill amount");
        });
    });
});
