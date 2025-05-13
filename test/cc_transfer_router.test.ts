const CC_REQUESTS = require('./test_fixtures/ccTransferRequests.json');
require('dotenv').config({path:"../../.env"});
import "@nomicfoundation/hardhat-chai-matchers";

import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { Signer, BigNumber } from "ethers";
import { deployMockContract, MockContract } from "@ethereum-waffle/mock-contract";
import { Contract } from "@ethersproject/contracts";
import { Address } from "hardhat-deploy/types";

import { CcTransferRouterProxy__factory } from "../src/types/factories/CcTransferRouterProxy__factory";
import { CcTransferRouterLogic__factory } from "../src/types/factories/CcTransferRouterLogic__factory";

import { LockersManagerProxy__factory } from "../src/types/factories/LockersManagerProxy__factory";
import { LockersManagerLogic__factory } from "../src/types/factories/LockersManagerLogic__factory";
import { LockersManagerLogicLibraryAddresses } from "../src/types/factories/LockersManagerLogic__factory";

import { LockersManagerLib } from "../src/types/LockersManagerLib";
import { LockersManagerLib__factory } from "../src/types/factories/LockersManagerLib__factory";

import { TeleBTCLogic } from "../src/types/TeleBTCLogic";
import { TeleBTCLogic__factory } from "../src/types/factories/TeleBTCLogic__factory";
import { TeleBTCProxy } from "../src/types/TeleBTCProxy";
import { TeleBTCProxy__factory } from "../src/types/factories/TeleBTCProxy__factory";
import { ERC20 } from "../src/types/ERC20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";

import { takeSnapshot, revertProvider } from "./block_utils";

describe("CcTransferRouter", async function() {
    this.bail(true); // Stop on first failure

    // Constants
    let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    let ONE_ADDRESS = "0x0000000000000000000000000000000000000001";
    let TWO_ADDRESS = "0x0000000000000000000000000000000000000002";
    const CHAIN_ID = 1;
    const APP_ID = 0;
    const PROTOCOL_PERCENTAGE_FEE = 10; // Means %0.1
    const LOCKER_PERCENTAGE_FEE = 20; // Means %0.2
    const PRICE_WITH_DISCOUNT_RATIO = 9500; // Means %95
    const STARTING_BLOCK_NUMBER = 1;
    const TREASURY = "0x0000000000000000000000000000000000000002";
    const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001"
    const NATIVE_TOKEN_DECIMAL = 18;
    const ONE_HOUNDRED_PERCENT = 10000;

    let THIRD_PARTY_PERCENTAGE_FEE = 10 // means 0.1%
    let THIRD_PARTY_ADDRESS = "0x0000000000000000000000000000000000000200"

    let LOCKER1_LOCKING_SCRIPT = '0xa9144062c8aeed4f81c2d73ff854a2957021191e20b687';

    let LOCKER_RESCUE_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
    let LOCKER_RESCUE_SCRIPT_P2PKH_TYPE = 1; // P2PKH

    let teleportTokenInitialSupply = BigNumber.from(10).pow(18).mul(10000);
    let minRequiredTNTLockedAmount = BigNumber.from(10).pow(18).mul(5);
    let collateralRatio = 20000;
    let liquidationRatio = 15000;

    // Accounts
    let proxyAdmin: Signer;
    let deployer: Signer;
    let signer1: Signer;
    let locker: Signer;
    let proxyAdminAddress: Address;
    let lockerAddress: Address;
    let deployerAddress: Address;

    // Contracts
    let ccTransferRouter: Contract;
    let teleBTC: TeleBTCLogic;
    let teleportDAOToken: ERC20;
    let lockersLib: LockersManagerLib;
    let lockers: Contract;

    // Mock contracts
    let mockBitcoinRelay: MockContract;
    let mockInstantRouter: MockContract;
    let mockPriceOracle: MockContract;

    let beginning: any;

    before(async () => {
        // Sets accounts
        [proxyAdmin, deployer, signer1, locker] = await ethers.getSigners();

        proxyAdminAddress = await proxyAdmin.getAddress();
        lockerAddress = await locker.getAddress();
        deployerAddress = await deployer.getAddress();

        teleportDAOToken = await deployTeleportDAOToken();

        // Mocks relay contract
        const bitcoinRelayContract = await deployments.getArtifact(
            "IBitcoinRelay"
        );
        mockBitcoinRelay = await deployMockContract(
            deployer,
            bitcoinRelayContract.abi
        );

        // Mocks price oracle contract
        const priceOracleContract = await deployments.getArtifact(
            "IPriceOracle"
        );
        mockPriceOracle = await deployMockContract(
            deployer,
            priceOracleContract.abi
        );
        // Sets equivalentOutputAmount to return 100000
        await mockPriceOracle.mock.equivalentOutputAmount.returns(100000)

        // Deploys ccTransferRouter contract
        const ccTransferRouterLogicFactory = new CcTransferRouterLogic__factory(deployer);
        const ccTransferRouterLogic = await ccTransferRouterLogicFactory.deploy();

        const ccTransferRouterProxyFactory = new CcTransferRouterProxy__factory(deployer);
        const ccTransferRouterProxy = await ccTransferRouterProxyFactory.deploy(
            ccTransferRouterLogic.address,    
            proxyAdminAddress,
            "0x"
        );
        
        ccTransferRouter = await ccTransferRouterLogic.attach(
            ccTransferRouterProxy.address
        );

        await ccTransferRouter.initialize(
            STARTING_BLOCK_NUMBER,
            PROTOCOL_PERCENTAGE_FEE,
            LOCKER_PERCENTAGE_FEE,
            CHAIN_ID,
            APP_ID,
            mockBitcoinRelay.address,
            ONE_ADDRESS,
            TWO_ADDRESS,
            TREASURY
        );

        // Deploys contracts
        const teleBTCLogicFactory = new TeleBTCLogic__factory(deployer);
        const teleBTCLogic = await teleBTCLogicFactory.deploy();

        const teleBTCProxyFactory = new TeleBTCProxy__factory(deployer);
        const teleBTCProxy = await teleBTCProxyFactory.deploy(
            teleBTCLogic.address,    
            proxyAdminAddress,
            "0x"
        );
        
        teleBTC = await teleBTCLogic.attach(
            teleBTCProxy.address
        );

        await teleBTC.initialize(
            "TeleportDAO-BTC",
            "teleBTC"
        );

        // Set teleBTC address in ccTransferRouter
        await ccTransferRouter.setTeleBTC(teleBTC.address);

        // Deploys lockers contract
        lockers = await deployLockers();
        await lockers.setTeleBTC(teleBTC.address)
        await lockers.addMinter(ccTransferRouter.address)

        // Adds lockers contract as minter and burner in teleBTC
        await teleBTC.addMinter(lockers.address)
        await teleBTC.addBurner(lockers.address)

        await ccTransferRouter.setLockers(lockers.address)
        await ccTransferRouter.setInstantRouter(deployerAddress)
    });

    const deployLockersManagerLib = async (
        _signer?: Signer
    ): Promise<LockersManagerLib> => {
        const LockersManagerLibFactory = new LockersManagerLib__factory(
            _signer || deployer
        );

        const lockersLib = await LockersManagerLibFactory.deploy(
        );

        return lockersLib;
    };

    const deployLockers = async (
        _signer?: Signer
    ): Promise<Contract> => {

        lockersLib = await deployLockersManagerLib()

        let linkLibraryAddresses: LockersManagerLogicLibraryAddresses;

        linkLibraryAddresses = {
            "contracts/lockersManager/LockersManagerLib.sol:LockersManagerLib": lockersLib.address,
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
        )

        const lockers = await lockersLogic.attach(
            lockersProxy.address
        );

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
        )

        await lockers.setTST(teleportDAOToken.address)

        return lockers;
    };

    const deployTeleportDAOToken = async (
        _signer?: Signer
    ): Promise<ERC20> => {
        const erc20Factory = new Erc20__factory(
            _signer || deployer
        );

        const teleportDAOToken = await erc20Factory.deploy(
            "TelePortDAOToken",
            "TST",
            teleportTokenInitialSupply
        );

        return teleportDAOToken;
    };

    async function setRelayReturn(isTrue: boolean): Promise<void> {
        await mockBitcoinRelay.mock.getBlockHeaderFee.returns(0); // Sets fee of using relay
        await mockBitcoinRelay.mock.checkTxProof.returns(isTrue); // Sets result of checking tx proof
    }

    async function addLockerToLockers(): Promise<void> {
        let lockerlocker = lockers.connect(locker);

        await lockers.addCollateralToken(NATIVE_TOKEN_ADDRESS, NATIVE_TOKEN_DECIMAL)
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

    async function checkFees(
        recipientAddress: string,
        receivedAmount: number,
        teleporterFee: number,
        protocolFee: number,
        lockerFee: number,
        prevSupply: number,
        bitcoinAmount: number
    ): Promise<void> {
        // Checks that enough teleBTC has been minted for user
        expect(
            await teleBTC.balanceOf(recipientAddress)
        ).to.equal(receivedAmount);

        // Checks that enough teleBTC has been minted for teleporter
        expect(
            await teleBTC.balanceOf(await deployer.getAddress())
        ).to.equal(teleporterFee);

        // Checks that correct amount of teleBTC has been minted for protocol
        expect(
            await teleBTC.balanceOf(TREASURY)
        ).to.equal(protocolFee);

        // Checks that correct amount of teleBTC has been minted for locker
        expect(
            await teleBTC.balanceOf(lockerAddress)
        ).to.equal(lockerFee);

        // Checks that correct amount of teleBTC has been minted in total
        expect(
            await teleBTC.totalSupply()
        ).to.equal(prevSupply + bitcoinAmount);
    }

    describe("#ccTransfer", async () => {

        beforeEach(async () => {
            beginning = await takeSnapshot(signer1.provider);
            await addLockerToLockers();
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, beginning);
        });

        it("Mints teleBTC for normal cc transfer request (relay fee is zero)", async function () {
            let prevSupply = await teleBTC.totalSupply();
            // Mocks relay to return true after checking tx proof
            await setRelayReturn(true);

            // Calculates fees
            let lockerFee = Math.floor(
                CC_REQUESTS.normalCCTransfer.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
            );
            let teleporterFee = Math.floor(
                CC_REQUESTS.normalCCTransfer.bitcoinAmount*CC_REQUESTS.normalCCTransfer.teleporterFee/10000
            );
            let protocolFee = Math.floor(
                CC_REQUESTS.normalCCTransfer.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
            );

            // Calculates amount that user should have received
            let receivedAmount = CC_REQUESTS.normalCCTransfer.bitcoinAmount - lockerFee - teleporterFee - protocolFee;

            // Checks that ccTransfer is executed successfully
            await expect(
                await ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer.version,
                        vin: CC_REQUESTS.normalCCTransfer.vin,
                        vout: CC_REQUESTS.normalCCTransfer.vout,
                        locktime: CC_REQUESTS.normalCCTransfer.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer.index
                    },
                    LOCKER1_LOCKING_SCRIPT,
                )
            ).to.emit(ccTransferRouter, "NewWrap").withArgs(
                CC_REQUESTS.normalCCTransfer.txId,
                LOCKER1_LOCKING_SCRIPT,
                lockerAddress,
                CC_REQUESTS.normalCCTransfer.recipientAddress,
                deployerAddress,
                [CC_REQUESTS.normalCCTransfer.bitcoinAmount, receivedAmount],
                [teleporterFee, lockerFee, protocolFee, 0],
                0,
                CC_REQUESTS.normalCCTransfer.chainId
            );

            await checkFees(
                CC_REQUESTS.normalCCTransfer.recipientAddress,
                receivedAmount,
                teleporterFee,
                protocolFee,
                lockerFee,
                prevSupply.toNumber(),
                CC_REQUESTS.normalCCTransfer.bitcoinAmount
            );
        })

        it("Mints teleBTC for normal cc transfer request (relay fee is non-zero)", async function () {
            let prevSupply = await teleBTC.totalSupply();

            let relayFee = 1;
            let msgValue = 1;

            // Mocks relay to return true after checking tx proof
            await setRelayReturn(true);
            // Sets fee of using relay
            await mockBitcoinRelay.mock.getBlockHeaderFee.returns(relayFee);

            // Calculates fees
            let lockerFee = Math.floor(
                CC_REQUESTS.normalCCTransfer.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
            );
            let teleporterFee = Math.floor(
                CC_REQUESTS.normalCCTransfer.bitcoinAmount*CC_REQUESTS.normalCCTransfer.teleporterFee/10000
            );
            let protocolFee = Math.floor(
                CC_REQUESTS.normalCCTransfer.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
            );

            // Calculates amount that user should have received
            let receivedAmount = CC_REQUESTS.normalCCTransfer.bitcoinAmount - lockerFee - teleporterFee - protocolFee;

            // Gets deployer ETH balance before sending request
            let prevETHBalance = await deployer.getBalance();

            // Checks that ccTransfer is executed successfully

            let tx = await ccTransferRouter.wrap(
                {
                    version: CC_REQUESTS.normalCCTransfer.version,
                    vin: CC_REQUESTS.normalCCTransfer.vin,
                    vout: CC_REQUESTS.normalCCTransfer.vout,
                    locktime: CC_REQUESTS.normalCCTransfer.locktime,
                    blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                    intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                    index: CC_REQUESTS.normalCCTransfer.index
                },
                LOCKER1_LOCKING_SCRIPT,
                {value: msgValue}
            );

            await expect(
                tx
            ).to.emit(ccTransferRouter, "NewWrap").withArgs(
                CC_REQUESTS.normalCCTransfer.txId,
                LOCKER1_LOCKING_SCRIPT,
                lockerAddress,
                CC_REQUESTS.normalCCTransfer.recipientAddress,
                deployerAddress,
                [CC_REQUESTS.normalCCTransfer.bitcoinAmount, receivedAmount],
                [teleporterFee, lockerFee, protocolFee, 0],
                0,
                CC_REQUESTS.normalCCTransfer.chainId
            );

            // Finds tx cost
            const receipt = await tx.wait();
            const txCost = receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice);

            // Gets deployer ETH balance after sending request
            let newETHBalance = await deployer.getBalance();

            expect(
                newETHBalance
            ).to.equal(
                prevETHBalance.sub(txCost).sub(relayFee),
                "Wrong ETH balance"
            );

            await checkFees(
                CC_REQUESTS.normalCCTransfer.recipientAddress,
                receivedAmount,
                teleporterFee,
                protocolFee,
                lockerFee,
                prevSupply.toNumber(),
                CC_REQUESTS.normalCCTransfer.bitcoinAmount
            );
        })

        it("Mints teleBTC for normal cc transfer request (zero teleporter fee)", async function () {
            let prevSupply = await teleBTC.totalSupply();
            // Mocks relay to return true after checking tx proof
            await setRelayReturn(true);

            // Calculates fees
            let lockerFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_zeroFee.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
            );
            let teleporterFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_zeroFee.bitcoinAmount*CC_REQUESTS.normalCCTransfer_zeroFee.teleporterFee/10000
            );
            let protocolFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_zeroFee.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
            );

            // Calculates amount that user should have received
            let receivedAmount = CC_REQUESTS.normalCCTransfer_zeroFee.bitcoinAmount - lockerFee - teleporterFee - protocolFee;

            // Checks that ccTransfer is executed successfully
            await expect(
                await ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_zeroFee.version,
                        vin: CC_REQUESTS.normalCCTransfer_zeroFee.vin,
                        vout: CC_REQUESTS.normalCCTransfer_zeroFee.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_zeroFee.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_zeroFee.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_zeroFee.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_zeroFee.index
                    },
                    LOCKER1_LOCKING_SCRIPT,
                )
            ).to.emit(ccTransferRouter, "NewWrap").withArgs(
                CC_REQUESTS.normalCCTransfer_zeroFee.txId,
                LOCKER1_LOCKING_SCRIPT,
                lockerAddress,
                CC_REQUESTS.normalCCTransfer_zeroFee.recipientAddress,
                deployerAddress,
                [CC_REQUESTS.normalCCTransfer_zeroFee.bitcoinAmount, receivedAmount],
                [teleporterFee, lockerFee, protocolFee, 0],
                0,
                CC_REQUESTS.normalCCTransfer_zeroFee.chainId
            );

            await checkFees(
                CC_REQUESTS.normalCCTransfer_zeroFee.recipientAddress,
                receivedAmount,
                teleporterFee,
                protocolFee,
                lockerFee,
                prevSupply.toNumber(),
                CC_REQUESTS.normalCCTransfer_zeroFee.bitcoinAmount
            );
        })

        it("Mints teleBTC for normal cc transfer request (zero protocol fee)", async function () {
            let prevSupply = await teleBTC.totalSupply();

            // Sets protocol fee
            await ccTransferRouter.setProtocolPercentageFee(0);

            // Mocks relay to return true after checking tx proof
            await setRelayReturn(true);

            // Calculates fees
            let lockerFee = Math.floor(
                CC_REQUESTS.normalCCTransfer.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
            );
            let teleporterFee = Math.floor(
                CC_REQUESTS.normalCCTransfer.bitcoinAmount*CC_REQUESTS.normalCCTransfer.teleporterFee/10000
            );
            let protocolFee = 0;

            // Calculates amount that user should have received
            let receivedAmount = CC_REQUESTS.normalCCTransfer.bitcoinAmount - lockerFee - teleporterFee - protocolFee;

            // Checks that ccTransfer is executed successfully
            await expect(
                await ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer.version,
                        vin: CC_REQUESTS.normalCCTransfer.vin,
                        vout: CC_REQUESTS.normalCCTransfer.vout,
                        locktime: CC_REQUESTS.normalCCTransfer.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer.index
                    },
                    LOCKER1_LOCKING_SCRIPT,
                )
            ).to.emit(ccTransferRouter, "NewWrap").withArgs(
                CC_REQUESTS.normalCCTransfer.txId,
                LOCKER1_LOCKING_SCRIPT,
                lockerAddress,
                CC_REQUESTS.normalCCTransfer.recipientAddress,
                deployerAddress,
                [CC_REQUESTS.normalCCTransfer.bitcoinAmount, receivedAmount],
                [teleporterFee, lockerFee, protocolFee, 0],
                0,
                CC_REQUESTS.normalCCTransfer.chainId
            );

            await checkFees(
                CC_REQUESTS.normalCCTransfer.recipientAddress,
                receivedAmount,
                teleporterFee,
                protocolFee,
                lockerFee,
                prevSupply.toNumber(),
                CC_REQUESTS.normalCCTransfer.bitcoinAmount
            );
        })

        it("Reverts since request belongs to an old block header", async function () {
            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer.version,
                        vin: CC_REQUESTS.normalCCTransfer.vin,
                        vout: CC_REQUESTS.normalCCTransfer.vout,
                        locktime: CC_REQUESTS.normalCCTransfer.locktime,
                        blockNumber: STARTING_BLOCK_NUMBER - 1,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: request is too old");
        })

        it("Reverts if the request has been used before", async function () {
            await setRelayReturn(true);

            await ccTransferRouter.wrap(
                {
                    version: CC_REQUESTS.normalCCTransfer.version,
                    vin: CC_REQUESTS.normalCCTransfer.vin,
                    vout: CC_REQUESTS.normalCCTransfer.vout,
                    locktime: CC_REQUESTS.normalCCTransfer.locktime,
                    blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                    intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                    index: CC_REQUESTS.normalCCTransfer.index
                },
                LOCKER1_LOCKING_SCRIPT,
            );

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer.version,
                        vin: CC_REQUESTS.normalCCTransfer.vin,
                        vout: CC_REQUESTS.normalCCTransfer.vout,
                        locktime: CC_REQUESTS.normalCCTransfer.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: request has been used before");
        })

        it("Reverts if the request has not been finalized on the relay", async function () {

            // Sets relay to return false after checking tx proof
            await setRelayReturn(false);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer.version,
                        vin: CC_REQUESTS.normalCCTransfer.vin,
                        vout: CC_REQUESTS.normalCCTransfer.vout,
                        locktime: CC_REQUESTS.normalCCTransfer.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: transaction has not been finalized yet");
        })

        it("Reverts if the percentage fee is out of range [0,10000)", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_invalidFee.version,
                        vin: CC_REQUESTS.normalCCTransfer_invalidFee.vin,
                        vout: CC_REQUESTS.normalCCTransfer_invalidFee.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_invalidFee.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_invalidFee.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_invalidFee.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_invalidFee.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: wrong fee");
        })

        it("Reverts if chain id is invalid", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_invalidChainId.version,
                        vin: CC_REQUESTS.normalCCTransfer_invalidChainId.vin,
                        vout: CC_REQUESTS.normalCCTransfer_invalidChainId.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_invalidChainId.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_invalidChainId.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_invalidChainId.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_invalidChainId.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: chain id is not correct");
        })

        it("Reverts if app id is invalid", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_invalidAppId.version,
                        vin: CC_REQUESTS.normalCCTransfer_invalidAppId.vin,
                        vout: CC_REQUESTS.normalCCTransfer_invalidAppId.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_invalidAppId.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_invalidAppId.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_invalidAppId.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_invalidAppId.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: app id is not correct");
        })

        it("Reverts if user sent BTC to invalid locker", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_invalidLocker.version,
                        vin: CC_REQUESTS.normalCCTransfer_invalidLocker.vin,
                        vout: CC_REQUESTS.normalCCTransfer_invalidLocker.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_invalidLocker.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_invalidLocker.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_invalidLocker.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_invalidLocker.index
                    },
                    CC_REQUESTS.normalCCTransfer_invalidLocker.desiredRecipient
                )
            ).to.revertedWith("CCTransferRouter: no locker with the given locking script exists");
        })

        it("Reverts if no BTC has been sent to locker", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_invalidLocker.version,
                        vin: CC_REQUESTS.normalCCTransfer_invalidLocker.vin,
                        vout: CC_REQUESTS.normalCCTransfer_invalidLocker.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_invalidLocker.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_invalidLocker.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_invalidLocker.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_invalidLocker.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: input amount is zero");
        })

        it("Reverts if data length is wrong", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_invalidLength.version,
                        vin: CC_REQUESTS.normalCCTransfer_invalidLength.vin,
                        vout: CC_REQUESTS.normalCCTransfer_invalidLength.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_invalidLength.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_invalidLength.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_invalidLength.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_invalidLength.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: invalid len");
        })

        it("Reverts if speed is wrong", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_invalidSpeed.version,
                        vin: CC_REQUESTS.normalCCTransfer_invalidSpeed.vin,
                        vout: CC_REQUESTS.normalCCTransfer_invalidSpeed.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_invalidSpeed.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_invalidSpeed.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_invalidSpeed.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_invalidSpeed.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: speed is out of range");
        })

        it("Reverts if locktime is not zero", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_invalidSpeed.version,
                        vin: CC_REQUESTS.normalCCTransfer_invalidSpeed.vin,
                        vout: CC_REQUESTS.normalCCTransfer_invalidSpeed.vout,
                        locktime: "0x10000000",
                        blockNumber: CC_REQUESTS.normalCCTransfer_invalidSpeed.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_invalidSpeed.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_invalidSpeed.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: lock time is non -zero");
        })

        it("only instant router can wrap", async function () {
            await setRelayReturn(true);

            await expect(
                ccTransferRouter.connect(signer1).wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer.version,
                        vin: CC_REQUESTS.normalCCTransfer.vin,
                        vout: CC_REQUESTS.normalCCTransfer.vout,
                        locktime: CC_REQUESTS.normalCCTransfer.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: invalid sender");
        })

        it("Reverts if msg.value is lower than relay fee", async function () {
            await setRelayReturn(true);
            await mockBitcoinRelay.mock.getBlockHeaderFee.returns(1); // Sets fee of using relay
            //TODO fix chain id
            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer.version,
                        vin: CC_REQUESTS.normalCCTransfer.vin,
                        vout: CC_REQUESTS.normalCCTransfer.vout,
                        locktime: CC_REQUESTS.normalCCTransfer.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: paid fee is not sufficient");
        })

        // it("Mints teleBTC for instant cc transfer request", async function () {
        //     let prevSupply = await teleBTC.totalSupply();
        //     // Mocks relay to return true after checking tx proof
        //     await setRelayReturn(true);

        //     // Calculates fees
        //     let lockerFee = Math.floor(
        //         CC_REQUESTS.instantCCTransfer.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
        //     );
        //     let teleporterFee = Math.floor(
        //         CC_REQUESTS.instantCCTransfer.bitcoinAmount*CC_REQUESTS.normalCCTransfer.teleporterFee/10000
        //     );
        //     let protocolFee = Math.floor(
        //         CC_REQUESTS.instantCCTransfer.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
        //     );

        //     let receivedAmount = CC_REQUESTS.instantCCTransfer.bitcoinAmount - lockerFee - teleporterFee - protocolFee;

        //     await expect(
        //         await ccTransferRouter.wrap(
        //             CC_REQUESTS.instantCCTransfer.version,
        //             CC_REQUESTS.instantCCTransfer.vin,
        //             CC_REQUESTS.instantCCTransfer.vout,
        //             CC_REQUESTS.instantCCTransfer.locktime,
        //             CC_REQUESTS.instantCCTransfer.blockNumber,
        //             CC_REQUESTS.instantCCTransfer.intermediateNodes,
        //             CC_REQUESTS.instantCCTransfer.index,
        //             LOCKER1_LOCKING_SCRIPT
        //         )
        //     ).to.emit(ccTransferRouter, 'CCTransfer').withArgs(
        //         LOCKER1_LOCKING_SCRIPT,
        //         0,
        //         lockerAddress,
        //         CC_REQUESTS.instantCCTransfer.recipientAddress,
        //         CC_REQUESTS.instantCCTransfer.bitcoinAmount,
        //         receivedAmount,
        //         CC_REQUESTS.instantCCTransfer.speed,
        //         deployerAddress,
        //         teleporterFee,
        //         0,
        //         protocolFee,
        //         CC_REQUESTS.instantCCTransfer.txId
        //     );

        //     // Checks that enough teleBTC allowance has been given to instant router
        //     expect(
        //         await teleBTC.allowance(ccTransferRouter.address, mockInstantRouter.address)
        //     ).to.equal(receivedAmount);

        //     // Checks that enough teleBTC has been minted for teleporter
        //     expect(
        //         await teleBTC.balanceOf(await deployer.getAddress())
        //     ).to.equal(teleporterFee);

        //     // Checks that correct amount of teleBTC has been minted for protocol
        //     expect(
        //         await teleBTC.balanceOf(TREASURY)
        //     ).to.equal(protocolFee);

        //     // Checks that correct amount of teleBTC has been minted for locker
        //     expect(
        //         await teleBTC.balanceOf(lockerAddress)
        //     ).to.equal(lockerFee);

        //     // Checks that correct amount of teleBTC has been minted in total
        //     expect(
        //         await teleBTC.totalSupply()
        //     ).to.equal(prevSupply + CC_REQUESTS.instantCCTransfer.bitcoinAmount)
        // })

    });

    describe("#isRequestUsed", async () => {

        beforeEach(async () => {
            beginning = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, beginning);
        });

        it("Checks if the request has been used before (unused)", async function () {
            expect(
                await ccTransferRouter.isRequestUsed(CC_REQUESTS.normalCCTransfer.txId)
            ).to.equal(false);
        })

        it("Reverts since the request has been executed before", async function () {
            await setRelayReturn(true);
            await addLockerToLockers();
            await ccTransferRouter.wrap(
                {
                    version: CC_REQUESTS.normalCCTransfer.version,
                    vin: CC_REQUESTS.normalCCTransfer.vin,
                    vout: CC_REQUESTS.normalCCTransfer.vout,
                    locktime: CC_REQUESTS.normalCCTransfer.locktime,
                    blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                    intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                    index: CC_REQUESTS.normalCCTransfer.index
                },
                LOCKER1_LOCKING_SCRIPT
            );

            expect(
                await ccTransferRouter.isRequestUsed(CC_REQUESTS.normalCCTransfer.txId)
            ).to.equal(true);

            await expect(
                ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer.version,
                        vin: CC_REQUESTS.normalCCTransfer.vin,
                        vout: CC_REQUESTS.normalCCTransfer.vout,
                        locktime: CC_REQUESTS.normalCCTransfer.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer.index
                    },
                    LOCKER1_LOCKING_SCRIPT
                )
            ).to.revertedWith("CCTransferRouter: request has been used before");
        })

    });

    describe("#setters", async () => {

        beforeEach(async () => {
            beginning = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, beginning);
        });

        it("Sets protocol percentage fee", async function () {
            await expect(
                ccTransferRouter.setProtocolPercentageFee(100)
            ).to.emit(
                ccTransferRouter, "NewProtocolPercentageFee"
            ).withArgs(PROTOCOL_PERCENTAGE_FEE, 100);

            expect(
                await ccTransferRouter.protocolPercentageFee()
            ).to.equal(100);
        })

        it("Sets protocol percentage fee", async function () {
            await expect(
                ccTransferRouter.setProtocolPercentageFee(20000)
            ).to.be.revertedWith("CCTransferRouter: protocol fee is out of range");
            // CCTransferRouter: protocol fee is out of range
        })

        it("Reverts since protocol percentage fee is greater than 10000", async function () {
            await expect(
                ccTransferRouter.setProtocolPercentageFee(10001)
            ).to.revertedWith("CCTransferRouter: protocol fee is out of range");
        })

        it("Sets relay, lockers, instant router, teleBTC and treasury", async function () {
            await expect(
                await ccTransferRouter.setRelay(ONE_ADDRESS)
            ).to.emit(
                ccTransferRouter, "NewRelay"
            ).withArgs(mockBitcoinRelay.address, ONE_ADDRESS);


            expect(
                await ccTransferRouter.relay()
            ).to.equal(ONE_ADDRESS);

            await expect(
                await ccTransferRouter.setLockers(ONE_ADDRESS)
            ).to.emit(
                ccTransferRouter, "NewLockers"
            ).withArgs(lockers.address, ONE_ADDRESS);

            expect(
                await ccTransferRouter.lockers()
            ).to.equal(ONE_ADDRESS);

            await expect(
                ccTransferRouter.connect(signer1).setLockers(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                await ccTransferRouter.setInstantRouter(ONE_ADDRESS)
            ).to.emit(
                ccTransferRouter, "NewInstantRouter"
            ).withArgs(deployerAddress, ONE_ADDRESS);

            expect(
                await ccTransferRouter.instantRouter()
            ).to.equal(ONE_ADDRESS);

            await expect(
                ccTransferRouter.connect(signer1).setInstantRouter(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                await ccTransferRouter.setTeleBTC(ONE_ADDRESS)
            ).to.emit(
                ccTransferRouter, "NewTeleBTC"
            ).withArgs(teleBTC.address, ONE_ADDRESS);

            expect(
                await ccTransferRouter.teleBTC()
            ).to.equal(ONE_ADDRESS);

            await expect(
                ccTransferRouter.connect(signer1).setTeleBTC(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                await ccTransferRouter.setTreasury(ONE_ADDRESS)
            ).to.emit(
                ccTransferRouter, "NewTreasury"
            ).withArgs(TREASURY, ONE_ADDRESS);


            expect(
                await ccTransferRouter.treasury()
            ).to.equal(ONE_ADDRESS);

            await expect(
                ccTransferRouter.connect(signer1).setTreasury(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                ccTransferRouter.connect(signer1).renounceOwnership()
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await ccTransferRouter.renounceOwnership()

        })

        it("Reverts since given address is zero", async function () {
            await expect(
                ccTransferRouter.setRelay(ZERO_ADDRESS)
            ).to.revertedWithCustomError(ccTransferRouter, "ZeroAddress");

            await expect(
                ccTransferRouter.setLockers(ZERO_ADDRESS)
            ).to.revertedWithCustomError(ccTransferRouter, "ZeroAddress");

            await expect(
                ccTransferRouter.setInstantRouter(ZERO_ADDRESS)
            ).to.revertedWithCustomError(ccTransferRouter, "ZeroAddress");

            await expect(
                ccTransferRouter.setTeleBTC(ZERO_ADDRESS)
            ).to.revertedWithCustomError(ccTransferRouter, "ZeroAddress");

            await expect(
                ccTransferRouter.setTreasury(ZERO_ADDRESS)
            ).to.revertedWithCustomError(ccTransferRouter, "ZeroAddress");
        })

        
        it("Reverts since new starting block number is less than what is set before", async function () {
            await expect(
                ccTransferRouter.setStartingBlockNumber(STARTING_BLOCK_NUMBER - 1)
            ).to.revertedWith("CCTransferRouter: low startingBlockNumber");
        })

        it("Only owner can set functions", async function () {
            await expect(
                ccTransferRouter.connect(signer1).setStartingBlockNumber(1)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                ccTransferRouter.connect(signer1).setProtocolPercentageFee(1)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                ccTransferRouter.connect(signer1).setRelay(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

        })
    });

    describe("#third party", async () => {

        beforeEach(async () => {
            beginning = await takeSnapshot(signer1.provider);
            await ccTransferRouter.setThirdPartyAddress(1, THIRD_PARTY_ADDRESS)
            await ccTransferRouter.setThirdPartyFee(1, THIRD_PARTY_PERCENTAGE_FEE)
            await addLockerToLockers();
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, beginning);
        });

        it("Third party gets its fee", async function () {
            let prevSupply = await teleBTC.totalSupply();
            // Mocks relay to return true after checking tx proof
            await setRelayReturn(true);

            // Calculates fees
            let lockerFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
            );
            let teleporterFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*CC_REQUESTS.normalCCTransfer_withThirdParty.teleporterFee/10000
            );
            let protocolFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
            );
            let thirdPartyFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*THIRD_PARTY_PERCENTAGE_FEE/10000
            );   

            // Calculates amount that user should have received
            let receivedAmount = CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount - lockerFee - teleporterFee - protocolFee - thirdPartyFee;

            await expect(
                await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
            ).to.equal(0)

            // Checks that ccTransfer is executed successfully
            await expect(
                await ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_withThirdParty.version,
                        vin: CC_REQUESTS.normalCCTransfer_withThirdParty.vin,
                        vout: CC_REQUESTS.normalCCTransfer_withThirdParty.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_withThirdParty.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_withThirdParty.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_withThirdParty.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_withThirdParty.index
                    },
                    LOCKER1_LOCKING_SCRIPT,
                )
            ).to.emit(ccTransferRouter, "NewWrap").withArgs(
                CC_REQUESTS.normalCCTransfer_withThirdParty.txId,
                LOCKER1_LOCKING_SCRIPT,
                lockerAddress,
                CC_REQUESTS.normalCCTransfer_withThirdParty.recipientAddress,
                deployerAddress,
                [CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount, receivedAmount],
                [teleporterFee, lockerFee, protocolFee, thirdPartyFee],
                1,
                CC_REQUESTS.normalCCTransfer_withThirdParty.chainId
            );

            await expect(
                await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
            ).to.equal(thirdPartyFee)
        })

        it("can change third party address", async function () {
            let NEW_THIRD_PARTY_ADDRESS = "0x0000000000000000000000000000000000000201"
            await ccTransferRouter.setThirdPartyAddress(1, NEW_THIRD_PARTY_ADDRESS)

            let prevSupply = await teleBTC.totalSupply();
            // Mocks relay to return true after checking tx proof
            await setRelayReturn(true);

            // Calculates fees
            let lockerFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
            );
            let teleporterFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*CC_REQUESTS.normalCCTransfer_withThirdParty.teleporterFee/10000
            );
            let protocolFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
            );
            let thirdPartyFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*THIRD_PARTY_PERCENTAGE_FEE/10000
            );   

            // Calculates amount that user should have received
            let receivedAmount = CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount - lockerFee - teleporterFee - protocolFee - thirdPartyFee;

            await expect(
                await teleBTC.balanceOf(NEW_THIRD_PARTY_ADDRESS)
            ).to.equal(0)

            // Checks that ccTransfer is executed successfully
            await expect(
                await ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_withThirdParty.version,
                        vin: CC_REQUESTS.normalCCTransfer_withThirdParty.vin,
                        vout: CC_REQUESTS.normalCCTransfer_withThirdParty.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_withThirdParty.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_withThirdParty.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_withThirdParty.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_withThirdParty.index
                    },
                    LOCKER1_LOCKING_SCRIPT,
                )
            ).to.emit(ccTransferRouter, "NewWrap").withArgs(
                CC_REQUESTS.normalCCTransfer_withThirdParty.txId,
                LOCKER1_LOCKING_SCRIPT,
                lockerAddress,
                CC_REQUESTS.normalCCTransfer_withThirdParty.recipientAddress,
                deployerAddress,
                [CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount, receivedAmount],
                [teleporterFee, lockerFee, protocolFee, thirdPartyFee],
                1,
                CC_REQUESTS.normalCCTransfer_withThirdParty.chainId
            );

            await expect(
                await teleBTC.balanceOf(NEW_THIRD_PARTY_ADDRESS)
            ).to.equal(thirdPartyFee)
        })

        it("can change third party fee", async function () {
            let NEW_THIRD_PARTY_PERCENTAGE_FEE = 50
            await ccTransferRouter.setThirdPartyFee(1, NEW_THIRD_PARTY_PERCENTAGE_FEE)

            let prevSupply = await teleBTC.totalSupply();
            // Mocks relay to return true after checking tx proof
            await setRelayReturn(true);

            // Calculates fees
            let lockerFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
            );
            let teleporterFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*CC_REQUESTS.normalCCTransfer_withThirdParty.teleporterFee/10000
            );
            let protocolFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
            );
            let thirdPartyFee = Math.floor(
                CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*NEW_THIRD_PARTY_PERCENTAGE_FEE/10000
            );   

            // Calculates amount that user should have received
            let receivedAmount = CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount - lockerFee - teleporterFee - protocolFee - thirdPartyFee;

            await expect(
                await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
            ).to.equal(0)

            // Checks that ccTransfer is executed successfully
            await expect(
                await ccTransferRouter.wrap(
                    {
                        version: CC_REQUESTS.normalCCTransfer_withThirdParty.version,
                        vin: CC_REQUESTS.normalCCTransfer_withThirdParty.vin,
                        vout: CC_REQUESTS.normalCCTransfer_withThirdParty.vout,
                        locktime: CC_REQUESTS.normalCCTransfer_withThirdParty.locktime,
                        blockNumber: CC_REQUESTS.normalCCTransfer_withThirdParty.blockNumber,
                        intermediateNodes: CC_REQUESTS.normalCCTransfer_withThirdParty.intermediateNodes,
                        index: CC_REQUESTS.normalCCTransfer_withThirdParty.index
                    },
                    LOCKER1_LOCKING_SCRIPT,
                )
            ).to.emit(ccTransferRouter, "NewWrap").withArgs(
                CC_REQUESTS.normalCCTransfer_withThirdParty.txId,
                LOCKER1_LOCKING_SCRIPT,
                lockerAddress,
                CC_REQUESTS.normalCCTransfer_withThirdParty.recipientAddress,
                deployerAddress,
                [CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount, receivedAmount],
                [teleporterFee, lockerFee, protocolFee, thirdPartyFee],
                1,
                CC_REQUESTS.normalCCTransfer_withThirdParty.chainId
            );

            await expect(
                await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
            ).to.equal(thirdPartyFee)
        })

        it("only owner can set third party address", async function () {
            await expect(
                ccTransferRouter.connect(signer1).setThirdPartyAddress(1, THIRD_PARTY_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can set third party fee", async function () {
            await expect(
                ccTransferRouter.connect(signer1).setThirdPartyFee(1, THIRD_PARTY_PERCENTAGE_FEE)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

    });
});