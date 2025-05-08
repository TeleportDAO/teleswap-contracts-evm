const CC_BURN_REQUESTS = require('./test_fixtures/ccBurnRequests.json');
require('dotenv').config({path:"../../.env"});

import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { Signer, BigNumber } from "ethers";
import { deployMockContract, MockContract } from "@ethereum-waffle/mock-contract";
import { Address } from "hardhat-deploy/types";
import { Contract } from "@ethersproject/contracts";
import "@nomicfoundation/hardhat-chai-matchers";  // Add this import

import { TeleBTCLogic } from "../src/types/TeleBTCLogic";
import { TeleBTCLogic__factory } from "../src/types/factories/TeleBTCLogic__factory";
import { TeleBTCProxy } from "../src/types/TeleBTCProxy";
import { TeleBTCProxy__factory } from "../src/types/factories/TeleBTCProxy__factory";
import { Erc20 } from "../src/types/ERC20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";
import { WETH } from "../src/types/WETH";
import { WETH__factory } from "../src/types/factories/WETH__factory";

import { BurnRouterLib } from "../src/types/BurnRouterLib";
import { BurnRouterLib__factory } from "../src/types/factories/BurnRouterLib__factory";

import { BurnRouterProxy__factory } from "../src/types/factories/BurnRouterProxy__factory";
import { BurnRouterLogic__factory } from "../src/types/factories/BurnRouterLogic__factory";
import { BurnRouterLogicLibraryAddresses } from "../src/types/factories/BurnRouterLogic__factory";

import { takeSnapshot, revertProvider } from "./block_utils";
import { network } from "hardhat"

describe("BurnRouter", async function() {
    this.bail(true); // Stop on first failure
    let snapshotId: any;

    // Accounts
    let proxyAdmin: Signer;
    let deployer: Signer;
    let signer1: Signer;
    let signer2: Signer;
    let signer1Address: Address;
    let deployerAddress: Address;
    let proxyAdminAddress: Address;

    // Contracts
    let teleBTC: TeleBTCLogic;
    let inputToken: Erc20;
    let inputTokenSigner1: Erc20;
    let TeleBTCSigner1: TeleBTCLogic;
    let burnRouterLib: BurnRouterLib;
    let burnRouter: Contract;
    let burnRouterSigner1: Contract;
    let burnRouterSigner2: Contract;
    let burnRouterLocker: Contract;
    let weth: WETH;

    // Mock contracts
    let mockBitcoinRelay: MockContract;
    let mockLockers: MockContract;
    let mockExchangeConnector: MockContract;

    // Constants
    let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    let ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
    let oneHundred = BigNumber.from(10).pow(8).mul(100)
    /*
        This one is set so that:
        userRequestedAmount * (1 - lockerFee / 10000 - PROTOCOL_PERCENTAGE_FEE / 10000) - DUST_SATOSHI_AMOUNT = 100000000
    */
    let userRequestedAmount = BigNumber.from(100060030);
    let TRANSFER_DEADLINE = 20
    let PROTOCOL_PERCENTAGE_FEE = 5 // means 0.05%
    let THIRD_PARTY_PERCENTAGE_FEE = 10 // means 0.1%
    let THIRD_PARTY_ADDRESS = "0x0000000000000000000000000000000000000200"
    let SLASHER_PERCENTAGE_REWARD = 5 // means 0.05%
    let BITCOIN_FEE = 10000 // estimation of Bitcoin transaction fee in Satoshi
    let DUST_SATOSHI_AMOUNT = 1000
    let TREASURY = "0x0000000000000000000000000000000000000002";

    let LOCKER_TARGET_ADDRESS = ONE_ADDRESS;
    let LOCKER1_LOCKING_SCRIPT = '0x76a914748284390f9e263a4b766a75d0633c50426eb87587ac';

    let USER_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
    let USER_SCRIPT_P2PKH_TYPE = 1; // P2PKH

    let USER_SCRIPT_P2WPKH = "0x751e76e8199196d454941c45d1b3a323f1433bd6";
    let USER_SCRIPT_P2WPKH_TYPE = 3; // P2WPKH

    let MAX_PROTOCOL_FEE = 10000;
    before(async () => {

        [proxyAdmin, deployer, signer1, signer2] = await ethers.getSigners();
        proxyAdminAddress = await proxyAdmin.getAddress();
        signer1Address = await signer1.getAddress();
        deployerAddress = await deployer.getAddress();
        LOCKER_TARGET_ADDRESS = deployerAddress
        // Mocks contracts
    
        const bitcoinRelay = await deployments.getArtifact(
            "IBitcoinRelay"
        );
        mockBitcoinRelay = await deployMockContract(
            deployer,
            bitcoinRelay.abi
        )

        const lockers = await deployments.getArtifact(
            "LockersManagerLogic"
        );
        mockLockers = await deployMockContract(
            deployer,
            lockers.abi
        )

        const exchangeConnector = await deployments.getArtifact(
            "UniswapV2Connector"
        );
        mockExchangeConnector = await deployMockContract(
            deployer,
            exchangeConnector.abi
        )

        // mock finalization parameter
        await mockBitcoinRelay.mock.finalizationParameter.returns(5);

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

        // Deploys WETH contract
        const wethFactory = new WETH__factory(deployer);
        weth = await wethFactory.deploy("WrappedEthereum", "WETH");

        burnRouter = await deployBurnRouter();

        await burnRouter.initialize(
            1,
            mockBitcoinRelay.address,
            mockLockers.address,
            TREASURY,
            teleBTC.address,
            TRANSFER_DEADLINE,
            PROTOCOL_PERCENTAGE_FEE,
            SLASHER_PERCENTAGE_REWARD,
            BITCOIN_FEE,
            weth.address
        );

        // Deploys input token
        const erc20Factory = new Erc20__factory(deployer);
        inputToken = await erc20Factory.deploy(
            "TestToken",
            "TT",
            100000
        );
        inputTokenSigner1 = await inputToken.connect(signer1);

        // Mints TeleBTC for user
        await teleBTC.addMinter(signer1Address)
        TeleBTCSigner1 = await teleBTC.connect(signer1);

        await teleBTC.setMaxMintLimit(oneHundred.mul(2));
        await moveBlocks(2020)

        await TeleBTCSigner1.mint(signer1Address, oneHundred);

        // Connects signer1 and signer2 to burnRouter
        burnRouterSigner1 = await burnRouter.connect(signer1);
        burnRouterSigner2 = await burnRouter.connect(signer2);
        burnRouterLocker = await burnRouter.connect(deployer);
    });

    async function moveBlocks(amount: number) {
        for (let index = 0; index < amount; index++) {
          await network.provider.request({
            method: "evm_mine",
            params: [],
          })
        }
    }

    const deployTeleBTC = async (
        _signer?: Signer
    ): Promise<TeleBTCLogic> => {
        const teleBTCLogicFactory = new TeleBTCLogic__factory(
            _signer || deployer
        );

        const teleBTCLogic = await teleBTCLogicFactory.deploy();

        await teleBTCLogic.initialize(
            "TeleportDAO-BTC",
            "teleBTC"
        );

        return teleBTCLogic;
    };

    const deployBurnRouterLib = async (
        _signer?: Signer
    ): Promise<BurnRouterLib> => {
        const BurnRouterLibFactory = new BurnRouterLib__factory(
            _signer || deployer
        );

        const burnRouterLib = await BurnRouterLibFactory.deploy(
        );

        return burnRouterLib;
    };

    const deployBurnRouter = async (
        _signer?: Signer
    ): Promise<Contract> => {
        burnRouterLib = await deployBurnRouterLib()
        let linkLibraryAddresses: BurnRouterLogicLibraryAddresses;

        linkLibraryAddresses = {
            "contracts/routers/BurnRouterLib.sol:BurnRouterLib": burnRouterLib.address,
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
        )

        return await burnRouterLogic.attach(
            burnRouterProxy.address
        );

    };

    async function setLockersSlashIdleLockerReturn(): Promise<void> {
        await mockLockers.mock.slashIdleLocker
            .returns(true);
    }

    async function setLockersSlashThiefLockerReturn(): Promise<void> {
        await mockLockers.mock.slashThiefLocker
            .returns(true);
    }

    async function setLockersIsLocker(isLocker: boolean): Promise<void> {
        await mockLockers.mock.isLocker
            .returns(isLocker);
    }

    async function setLockersGetLockerTargetAddress(): Promise<void> {
        await mockLockers.mock.getLockerTargetAddress
            .returns(LOCKER_TARGET_ADDRESS);
    }

    async function setLockersBurnReturn(burntAmount: number): Promise<void> {
        await mockLockers.mock.burn
            .returns(burntAmount);
    }

    async function setRelayLastSubmittedHeight(blockNumber: number): Promise<void> {
        await mockBitcoinRelay.mock.lastSubmittedHeight.returns(blockNumber);
    }

    async function setRelayCheckTxProofReturn(isFinal: boolean, relayFee?: number): Promise<void> {
        await mockBitcoinRelay.mock.getBlockHeaderFee.returns(relayFee || 0); // Fee of relay
        await mockBitcoinRelay.mock.checkTxProof
            .returns(isFinal);
    }

    async function setSwap(result: boolean, amounts: number[]): Promise<void> {
        await mockExchangeConnector.mock.swap
            .returns(result, amounts);
    }

    async function mintTeleBTCForTest(): Promise<void> {
        let TeleBTCSigner1 = await teleBTC.connect(signer1)
        await TeleBTCSigner1.mint(signer1Address, oneHundred);
    }

    async function sendBurnRequest(
        burnReqBlockNumber: number,
        _userRequestedAmount: BigNumber,
        USER_SCRIPT: any,
        USER_SCRIPT_TYPE: any
    ): Promise<number> {
        // Gives allowance to burnRouter
        await TeleBTCSigner1.approve(
            burnRouter.address,
            _userRequestedAmount
        );

        // Sets mock contracts outputs
        await setLockersIsLocker(true);
        await setRelayLastSubmittedHeight(burnReqBlockNumber);
        let protocolFee = Math.floor(_userRequestedAmount.toNumber()*PROTOCOL_PERCENTAGE_FEE/10000);
        let burntAmount = _userRequestedAmount.toNumber() - protocolFee - BITCOIN_FEE;
        await setLockersBurnReturn(burntAmount);
        // first burntAmount should have been
        // burntAmount - lockerFee but in this case we have assumed lockerFee = 0

        await setLockersGetLockerTargetAddress();

        // Burns TeleBTC
        await burnRouterSigner1.unwrap(
            _userRequestedAmount,
            USER_SCRIPT,
            USER_SCRIPT_TYPE,
            LOCKER1_LOCKING_SCRIPT,
            0
        );

        return burntAmount;
    }

    async function provideProof(burnReqBlockNumber: number) {

        // Set mocks contracts outputs

        await setLockersIsLocker(true);
        await setRelayCheckTxProofReturn(true);

        let burntAmount: number;
        let protocolFee = Math.floor(userRequestedAmount.toNumber()*PROTOCOL_PERCENTAGE_FEE/10000);
        burntAmount = userRequestedAmount.toNumber() - BITCOIN_FEE - protocolFee;
        await setLockersBurnReturn(burntAmount);

        await setLockersGetLockerTargetAddress();

        // Provide proof that the locker has paid the burnt amount to the user(s)
        await expect(
            await burnRouterLocker.burnProof(
                CC_BURN_REQUESTS.burnProof_valid.version,
                CC_BURN_REQUESTS.burnProof_valid.vin,
                CC_BURN_REQUESTS.burnProof_valid.vout,
                CC_BURN_REQUESTS.burnProof_valid.locktime,
                burnReqBlockNumber,
                CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                1,
                LOCKER1_LOCKING_SCRIPT,
                [0],
                [0]
            )
        ).to.emit(burnRouter, "PaidUnwrap").withArgs(
            LOCKER_TARGET_ADDRESS,
            0,
            CC_BURN_REQUESTS.burnProof_valid.txId,
            0
        );
    }

    describe("#unwrap", async () => {

        beforeEach(async () => {
            // Gives allowance to burnRouter to burn tokens
            await TeleBTCSigner1.approve(
                burnRouter.address,
                userRequestedAmount
            );
            snapshotId = await takeSnapshot(signer1.provider);

        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Swap TeleBTC for BTC", async function () {
            let lastSubmittedHeight = 100;

            // Gives allowance to burnRouter to burn tokens
            await TeleBTCSigner1.approve(
                burnRouter.address,
                userRequestedAmount
            );

            // Sets mock contracts outputs
            await setRelayLastSubmittedHeight(lastSubmittedHeight);
            await setLockersIsLocker(true);

            // Finds amount of teleBTC that user should receive on Bitcoin
            let protocolFee = Math.floor(userRequestedAmount.toNumber()*PROTOCOL_PERCENTAGE_FEE/10000);
            let burntAmount = userRequestedAmount.toNumber() - protocolFee - BITCOIN_FEE;
            await setLockersBurnReturn(burntAmount);
            // first burntAmount should have been
            // burntAmount - lockerFee but in this case we have assumed lockerFee = 0

            await setLockersGetLockerTargetAddress();

            let prevBalanceSigner1 = await teleBTC.balanceOf(signer1Address);

            // Burns teleBTC
            await expect(
                await burnRouterSigner1.unwrap(
                    userRequestedAmount,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.emit(burnRouter, "NewUnwrap").withArgs(
                USER_SCRIPT_P2PKH,
                USER_SCRIPT_P2PKH_TYPE,
                LOCKER_TARGET_ADDRESS,
                signer1Address,
                0,
                lastSubmittedHeight + TRANSFER_DEADLINE,
                0,
                teleBTC.address,
                [userRequestedAmount, userRequestedAmount, burntAmount],
                [BITCOIN_FEE, 0, protocolFee, 0]
            );

            let newBalanceSigner1 = await teleBTC.balanceOf(signer1Address);

            // Checks user's balance
            expect(newBalanceSigner1).to.equal(prevBalanceSigner1.sub(userRequestedAmount));

            // Checks that protocol fee has been received
            let treasuryBalance = await teleBTC.balanceOf(TREASURY);
            expect(treasuryBalance).to.equal(protocolFee);

            // Gets the burn request that has been saved in the contract
            let theBurnRequest = await burnRouter.burnRequests(LOCKER_TARGET_ADDRESS, 0);

            expect(theBurnRequest.burntAmount).to.equal(burntAmount);

        })

        it("Reverts since user script length is incorrect", async function () {
            // Sets mock contracts outputs
            await setLockersIsLocker(true);

            await expect(
                burnRouterSigner1.unwrap(
                    userRequestedAmount,
                    USER_SCRIPT_P2PKH + "00",
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("BurnRouterLogic: invalid script");

            await expect(
                burnRouterSigner1.unwrap(
                    userRequestedAmount,
                    USER_SCRIPT_P2PKH,
                    4,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("BurnRouterLogic: invalid script");
        })

        it("Reverts since requested amount doesn't cover Bitcoin fee", async function () {
            let lastSubmittedHeight = 100;

            // Gives allowance to burnRouter to burn tokens
            await TeleBTCSigner1.approve(
                burnRouter.address,
                BITCOIN_FEE + DUST_SATOSHI_AMOUNT - 1
            );

            // Sets mock contracts outputs
            await setRelayLastSubmittedHeight(lastSubmittedHeight);
            await setLockersIsLocker(true);
            ;
            await setLockersGetLockerTargetAddress();

            // Burns teleBTC
            await expect(
                burnRouterSigner1.unwrap(
                    BITCOIN_FEE + DUST_SATOSHI_AMOUNT - 1,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("BurnRouterLogic: low amount");

        })

        it("Reverts since allowance is not enough", async function () {

            // Sets mock contracts outputs
            await setLockersIsLocker(true);

            await setLockersGetLockerTargetAddress();

            // Gives allowance to burnRouter to burn tokens
            await TeleBTCSigner1.approve(
                burnRouter.address,
                0
            );

            await expect(
                burnRouterSigner1.unwrap(
                    userRequestedAmount,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("ERC20: insufficient allowance")
        })

        it("Reverts since locker's locking script is not valid", async function () {

            await setLockersIsLocker(false);

            await expect(
                burnRouterSigner1.unwrap(
                    userRequestedAmount,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("BurnRouterLogic: not locker")
        })

    });

    describe("#swapAndUnwrap", async () => {

        let inputTokenAmount = 100;
        let lastSubmittedHeight = 100;
        let protocolFee = Math.floor(userRequestedAmount.toNumber() * PROTOCOL_PERCENTAGE_FEE / 10000);
        let _burntAmount = userRequestedAmount.toNumber() - protocolFee;
        let burntAmount = _burntAmount - BITCOIN_FEE; 
        // ^ burntAmount should be (burntAmount - lockerFee) but here we assumed lockerFee = 0

        beforeEach(async () => {
            // Sends teleBTC to burnRouter (since we mock swap)
            await TeleBTCSigner1.transfer(
                burnRouter.address,
                userRequestedAmount
            );

            // Sends some inputToken to signer1 then he gives allowance to burnRouter
            await inputToken.transfer(
                signer1Address,
                inputTokenAmount
            );
            await inputTokenSigner1.approve(
                burnRouter.address,
                inputTokenAmount
            );

            // Sets mock contracts outputs
            await setRelayLastSubmittedHeight(lastSubmittedHeight);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();
            await setLockersBurnReturn(burntAmount); // Sets amount of teleBTC that user receives on Bitcoin

            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Swap input token for BTC", async function () {

            let prevBalanceSigner1 = await inputToken.balanceOf(signer1Address);

            await setSwap(true, [inputTokenAmount, userRequestedAmount.toNumber()])

            // Exchanges input token then burns teleBTC
            await expect(
                await burnRouterSigner1.swapAndUnwrap(
                    mockExchangeConnector.address,
                    [inputTokenAmount, userRequestedAmount],
                    false, // output token amount is fixed
                    [inputToken.address, teleBTC.address], // exchange path
                    10000000000, // deadline
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.emit(burnRouter, "NewUnwrap").withArgs(
                USER_SCRIPT_P2PKH,
                USER_SCRIPT_P2PKH_TYPE,
                LOCKER_TARGET_ADDRESS,
                signer1Address,
                0,
                lastSubmittedHeight + TRANSFER_DEADLINE,
                0,
                inputToken.address,
                [inputTokenAmount, userRequestedAmount, burntAmount],
                [BITCOIN_FEE, 0, protocolFee, 0]
            );

            let newBalanceSigner1 = await inputToken.balanceOf(signer1Address);

            // Checks user's balance
            expect(newBalanceSigner1).to.equal(prevBalanceSigner1.sub(inputTokenAmount));

            // Checks that protocol fee has been received
            let treasuryBalance = await teleBTC.balanceOf(TREASURY);
            expect(treasuryBalance).to.equal(protocolFee);

            // Gets the burn request that has been saved in the contract
            let theBurnRequest = await burnRouter.burnRequests(LOCKER_TARGET_ADDRESS, 0);

            expect(theBurnRequest.burntAmount).to.equal(burntAmount);

        })

        it("Reverts since exchange path is invalid", async function () {
            await expect(
                burnRouterSigner1.swapAndUnwrap(
                    mockExchangeConnector.address,
                    [inputTokenAmount, userRequestedAmount],
                    false, // output token amount is fixed
                    [inputToken.address, inputToken.address], // exchange path
                    10000000000, // deadline
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("BurnRouterLogic: invalid path");
        })

        it("Reverts since amounts is wrong", async function () {
            await expect(
                burnRouterSigner1.swapAndUnwrap(
                    mockExchangeConnector.address,
                    [inputTokenAmount, userRequestedAmount, userRequestedAmount],
                    false, // output token amount is fixed
                    [inputToken.address, teleBTC.address], // exchange path
                    10000000000, // deadline
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("BurnRouterLogic: wrong amounts");
        })

        it("Reverts since exchange failed", async function () {
            await setSwap(false, [inputTokenAmount, userRequestedAmount.toNumber()])
            await expect(
                burnRouterSigner1.swapAndUnwrap(
                    mockExchangeConnector.address,
                    [inputTokenAmount, userRequestedAmount],
                    false, // output token amount is fixed
                    [inputToken.address, teleBTC.address], // exchange path
                    10000000000, // deadline
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("BurnRouterLogic: exchange failed");
        })

        it("Reverts since exchanged teleBTC is low", async function () {
            await setSwap(true, [inputTokenAmount, BITCOIN_FEE + DUST_SATOSHI_AMOUNT - 1])
            await expect(
                burnRouterSigner1.swapAndUnwrap(
                    mockExchangeConnector.address,
                    [inputTokenAmount, userRequestedAmount],
                    false, // output token amount is fixed
                    [inputToken.address, teleBTC.address], // exchange path
                    10000000000, // deadline
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    0
                )
            ).to.be.revertedWith("BurnRouterLogic: low amount");
        })

    });

    describe("#burnProof", async () => {
        let burnReqBlockNumber = 100;

        let burntAmount: number;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);

            // Mints TeleBTC for test
            await mintTeleBTCForTest();

            // Sends a burn request
            burntAmount = await sendBurnRequest(
                burnReqBlockNumber,
                userRequestedAmount,
                USER_SCRIPT_P2PKH,
                USER_SCRIPT_P2PKH_TYPE
            );
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Submits a valid burn proof (for P2PKH)", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await expect(
                await burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER1_LOCKING_SCRIPT,
                    [0],
                    [0]
                )
            ).to.emit(burnRouter, "PaidUnwrap").withArgs(
                LOCKER_TARGET_ADDRESS,
                0,
                CC_BURN_REQUESTS.burnProof_valid.txId,
                0
            );
        })

        it("Reverts since _burnReqIndexes is not sorted", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER1_LOCKING_SCRIPT,
                    [0, 1],
                    [1, 0]
                )
            ).to.be.revertedWith("BurnRouterLogic: un-sorted vout indexes")
        })

        it("Submits a valid burn proof (for P2WPKH)", async function () {

            // Sends a burn request
            burntAmount = await sendBurnRequest(
                burnReqBlockNumber,
                userRequestedAmount,
                USER_SCRIPT_P2WPKH,
                USER_SCRIPT_P2WPKH_TYPE
            );

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await expect(
                await burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_validP2WPKH.version,
                    CC_BURN_REQUESTS.burnProof_validP2WPKH.vin,
                    CC_BURN_REQUESTS.burnProof_validP2WPKH.vout,
                    CC_BURN_REQUESTS.burnProof_validP2WPKH.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_validP2WPKH.intermediateNodes,
                    1,
                    LOCKER1_LOCKING_SCRIPT,
                    [1], // Burn req index
                    [0]
                )
            ).to.emit(burnRouter, "PaidUnwrap").withArgs(
                LOCKER_TARGET_ADDRESS,
                1,
                CC_BURN_REQUESTS.burnProof_validP2WPKH.txId,
                0
            );

            expect(
                await burnRouter.isUsedAsBurnProof(
                    CC_BURN_REQUESTS.burnProof_validP2WPKH.txId
                )
            ).to.equal(true);
        })

        it("Submits a valid burn proof which doesn't have change vout", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await expect(
                await burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_validWithoutChange.version,
                    CC_BURN_REQUESTS.burnProof_validWithoutChange.vin,
                    CC_BURN_REQUESTS.burnProof_validWithoutChange.vout,
                    CC_BURN_REQUESTS.burnProof_validWithoutChange.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_validWithoutChange.intermediateNodes,
                    1,
                    LOCKER1_LOCKING_SCRIPT,
                    [0],
                    [0]
                )
            ).to.emit(burnRouter, "PaidUnwrap").withArgs(
                LOCKER_TARGET_ADDRESS,
                0,
                CC_BURN_REQUESTS.burnProof_validWithoutChange.txId,
                0
            );

            expect(
                await burnRouter.isUsedAsBurnProof(
                    CC_BURN_REQUESTS.burnProof_validWithoutChange.txId
                )
            ).to.equal(true);
        })

        it("Reverts since locktime is non-zero", async function () {
            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    '0x00000001',
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER_TARGET_ADDRESS,
                    [0],
                    [0]
                )
            ).to.be.revertedWith("BurnRouterLogic: non-zero lock time")
        })

        it("Reverts if locking script is not valid", async function () {
            // Sets mock contracts outputs
            await setLockersIsLocker(false);

            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER_TARGET_ADDRESS,
                    [0],
                    [0]
                )
            ).to.be.revertedWith("BurnRouterLogic: not locker")
        })

        it("Reverts if given indexes doesn't match", async function () {

            // Set mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            // Should revert when start index is bigger than end index
            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER_TARGET_ADDRESS,
                    [0, 1],
                    [0]
                )
            ).to.be.revertedWith("BurnRouterLogic: wrong indexes")

            // Should revert when end index is bigger than total number of burn requests
            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER_TARGET_ADDRESS,
                    [0],
                    [0, 1]
                )
            ).to.be.revertedWith("BurnRouterLogic: wrong indexes")
        })

        it("Reverts since paid fee is not enough", async function () {
            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true, 1);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER_TARGET_ADDRESS,
                    [0],
                    [0]
                )
            ).to.be.revertedWith("BitcoinRelay: low fee");
        })

        it("Reverts if locker's tx has not been finalized on relay", async function () {
            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(false);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER_TARGET_ADDRESS,
                    [0],
                    [0]
                )
            ).to.be.revertedWith("BurnRouterLogic: not finalized");
        })

        it("Reverts if vout is null", async function () {
            // Sends a burn request
            await sendBurnRequest(burnReqBlockNumber, userRequestedAmount, USER_SCRIPT_P2PKH, USER_SCRIPT_P2PKH_TYPE);

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            // Should revert with a wrong start index
            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    "0x0000",
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER_TARGET_ADDRESS,
                    [0],
                    [0]
                )
            ).to.be.revertedWith("BitcoinHelper: vout is null")
        })

        it("Doesn't accept burn proof since the paid amount is not exact", async function () {
            let wrongUserRequestAmount = BigNumber.from(100080000)
            let burnReqBlockNumber = 100;

            // Send a burn request
            await sendBurnRequest(burnReqBlockNumber, wrongUserRequestAmount, USER_SCRIPT_P2PKH, USER_SCRIPT_P2PKH_TYPE);

            // Set mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            // Should revert with a wrong start index
            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER_TARGET_ADDRESS,
                    [1],
                    [1]
                )
            ).to.be.reverted

            expect(
                await burnRouterSigner1.isTransferred(LOCKER_TARGET_ADDRESS, 0)
            ).to.equal(false);
        })

        it("Doesn't accept burn proof since the proof has been submitted before", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await burnRouterLocker.burnProof(
                CC_BURN_REQUESTS.burnProof_valid.version,
                CC_BURN_REQUESTS.burnProof_valid.vin,
                CC_BURN_REQUESTS.burnProof_valid.vout,
                CC_BURN_REQUESTS.burnProof_valid.locktime,
                burnReqBlockNumber + 5,
                CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                1,
                LOCKER1_LOCKING_SCRIPT,
                [0],
                [0]
            );

            expect(
                await burnRouterSigner1.isTransferred(LOCKER_TARGET_ADDRESS, 0)
            ).to.equal(true);

            await expect(
                burnRouterSigner1.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + 5,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER1_LOCKING_SCRIPT,
                    [0],
                    [0]
                )
            ).to.be.reverted
        })

        it("Doesn't accept burn proof since deadline is passed", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await expect(
                burnRouterLocker.burnProof(
                    CC_BURN_REQUESTS.burnProof_valid.version,
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.burnProof_valid.locktime,
                    burnReqBlockNumber + TRANSFER_DEADLINE + 1,
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    1,
                    LOCKER1_LOCKING_SCRIPT,
                    [0],
                    [0]
                )
            ).to.be.reverted

            expect(
                await burnRouterSigner1.isTransferred(LOCKER_TARGET_ADDRESS, 0)
            ).to.equal(false);
        })

        it("Doesn't accept burn proof since change address is invalid", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setLockersGetLockerTargetAddress();

            await expect(
                burnRouterLocker.burnProof(
                CC_BURN_REQUESTS.burnProof_invalidChange.version,
                CC_BURN_REQUESTS.burnProof_invalidChange.vin,
                CC_BURN_REQUESTS.burnProof_invalidChange.vout,
                CC_BURN_REQUESTS.burnProof_invalidChange.locktime,
                burnReqBlockNumber + 5,
                CC_BURN_REQUESTS.burnProof_invalidChange.intermediateNodes,
                1,
                LOCKER1_LOCKING_SCRIPT,
                [0],
                [0]
            )).to.be.reverted;

            expect(
                await burnRouterSigner1.isTransferred(LOCKER_TARGET_ADDRESS, 0)
            ).to.equal(false);

            expect(
                await burnRouter.isUsedAsBurnProof(
                    CC_BURN_REQUESTS.burnProof_invalidChange.txId
                )
            ).to.equal(false);

        })
    });

    describe("#disputeBurn", async () => {
        let burnReqBlockNumber = 100;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
            // Mints TeleBTC for test
            await mintTeleBTCForTest();

            // Sends a burn request
            await sendBurnRequest(100, userRequestedAmount, USER_SCRIPT_P2PKH, USER_SCRIPT_P2PKH_TYPE);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });
        it("only owner can dispute burn", async function () {
            await expect(
                burnRouter.connect(signer1).disputeBurn(
                        LOCKER_TARGET_ADDRESS,
                        [0]
                    )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("Disputes locker successfully", async function () {
            // Sets mock contracts
            await setRelayLastSubmittedHeight(burnReqBlockNumber + TRANSFER_DEADLINE + 1);
            await setLockersSlashIdleLockerReturn();
            await setLockersIsLocker(true);

            await expect(
                burnRouterLocker.disputeBurn(
                    LOCKER_TARGET_ADDRESS,
                    [0]
                )
            ).to.not.be.reverted;
        })

        it("Reverts since locker has been slashed before", async function () {
            // Sets mock contracts
            await setRelayLastSubmittedHeight(burnReqBlockNumber + TRANSFER_DEADLINE + 1);
            await setLockersSlashIdleLockerReturn();
            await setLockersIsLocker(true);

            await burnRouterLocker.disputeBurn(
                LOCKER_TARGET_ADDRESS,
                [0]
            );

            await expect(
                burnRouterLocker.disputeBurn(
                    LOCKER_TARGET_ADDRESS,
                    [0]
                )
            ).to.be.revertedWith("BurnRouterLogic: already paid")
        })

        it("Reverts since locking script is invalid", async function () {

            // Sets mock contracts outputs
            await setLockersIsLocker(false);

            await expect(
                burnRouterLocker.disputeBurn(
                    LOCKER_TARGET_ADDRESS,
                    [0]
                )
            ).to.be.revertedWith("BurnRouterLogic: not locker")
        })

        it("Reverts since locker has paid before hand", async function () {

            // Sets mock contracts outputs
            await setLockersIsLocker(true);
            await setLockersSlashIdleLockerReturn();

            // Pays the burnt amount and provides proof
            await provideProof(burnReqBlockNumber + 5);

            await expect(
                burnRouterLocker.disputeBurn(
                    LOCKER_TARGET_ADDRESS,
                    [0]
                )
            ).to.be.revertedWith("BurnRouterLogic: already paid")
        })

        it("Reverts since deadline hasn't reached", async function () {
            // Set mock contracts outputs
            await setLockersIsLocker(true);
            await setRelayLastSubmittedHeight(100);

            // Locker will not get slashed because the deadline of transfer has not reached
            await expect(
                burnRouterLocker.disputeBurn(
                    LOCKER_TARGET_ADDRESS,
                    [0]
                )
            ).to.be.revertedWith("BurnRouterLogic: deadline not passed")
        })

    });

    describe("#disputeLocker", async () => {
        let burnReqBlockNumber = 100;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Dispute the locker who has sent its BTC to external account", async function () {
            await expect(
                burnRouter.connect(signer1).disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("Dispute the locker who has sent its BTC to external account", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setRelayLastSubmittedHeight(burnReqBlockNumber + TRANSFER_DEADLINE + 1);
            await setLockersGetLockerTargetAddress();
            await setLockersSlashThiefLockerReturn();

            await expect(
                await burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.emit(burnRouter, "LockerDispute").withArgs(
                LOCKER_TARGET_ADDRESS,
                LOCKER1_LOCKING_SCRIPT,
                burnReqBlockNumber,
                CC_BURN_REQUESTS.disputeLocker_input.txId,
                CC_BURN_REQUESTS.disputeLocker_input.OutputValue +
                CC_BURN_REQUESTS.disputeLocker_input.OutputValue*SLASHER_PERCENTAGE_REWARD/10000
            );
        })

        it("Reverts since inputs are not valid", async function () {

            await expect(
                burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("BurnRouterLogic: wrong inputs");

            await expect(
                burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("BurnRouterLogic: wrong inputs");

            await expect(
                burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1]
                )
            ).to.be.revertedWith("BurnRouterLogic: wrong inputs")
        })

        it("Reverts since locking script is not valid", async function () {

            // Sets mock contracts outputs
            await setLockersIsLocker(false);

            await expect(
                burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("BurnRouterLogic: not locker");
        })

        it("Reverts since input tx has not finalized", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(false);
            await setLockersIsLocker(true);

            await expect(
                burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("BurnRouterLogic: not finalized");
        })

        it("Reverts since input tx has been used as burn proof", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(false);
            await setLockersIsLocker(true);

            await expect(
                burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("BurnRouterLogic: not finalized");
        })

        it("Reverts since outpoint doesn't match with output tx", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setRelayLastSubmittedHeight(burnReqBlockNumber + TRANSFER_DEADLINE + 1);
            await setLockersGetLockerTargetAddress();
            await setLockersSlashIdleLockerReturn();

            await expect(
                burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_invalidOutput.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_invalidOutput.vin,
                    CC_BURN_REQUESTS.disputeLocker_invalidOutput.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_invalidOutput.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("BurnRouterLogic: wrong output tx");
        })

        it("Reverts since tx doesn't belong to locker", async function () {

            // Sets mock contracts outputs
            await setRelayCheckTxProofReturn(true);
            await setLockersIsLocker(true);
            await setRelayLastSubmittedHeight(burnReqBlockNumber + TRANSFER_DEADLINE + 1);
            await setLockersGetLockerTargetAddress();
            await setLockersSlashIdleLockerReturn();

            await expect(
                burnRouter.disputeLocker(
                    "0x76a914748284390f9e263a4b766a75d0633c50426eb87587ab",
                    [CC_BURN_REQUESTS.disputeLocker_input.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.disputeLocker_input.vin,
                    CC_BURN_REQUESTS.disputeLocker_input.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.disputeLocker_input.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.disputeLocker_input.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("BurnRouterLogic: not for locker");
        })

        it("Reverts since locker may submit input tx as burn proof", async function () {

            // Sets mock contracts outputs
            await setLockersIsLocker(true);
            await setRelayCheckTxProofReturn(true);
            await setRelayLastSubmittedHeight(burnReqBlockNumber);
            await setLockersGetLockerTargetAddress();
            await setLockersSlashIdleLockerReturn();

            // User sends a burn request and locker provides burn proof for it
            await sendBurnRequest(100, userRequestedAmount, USER_SCRIPT_P2PKH, USER_SCRIPT_P2PKH_TYPE);
            await provideProof(burnReqBlockNumber + 5);

            await expect(
                burnRouter.disputeLocker(
                    LOCKER1_LOCKING_SCRIPT,
                    [CC_BURN_REQUESTS.burnProof_valid.version, CC_BURN_REQUESTS.disputeLocker_output.version],
                    CC_BURN_REQUESTS.burnProof_valid.vin,
                    CC_BURN_REQUESTS.burnProof_valid.vout,
                    CC_BURN_REQUESTS.disputeLocker_output.vin,
                    CC_BURN_REQUESTS.disputeLocker_output.vout,
                    [CC_BURN_REQUESTS.burnProof_valid.locktime, CC_BURN_REQUESTS.disputeLocker_output.locktime],
                    CC_BURN_REQUESTS.burnProof_valid.intermediateNodes,
                    [0, 1, burnReqBlockNumber]
                )
            ).to.be.revertedWith("BurnRouterLogic: already used");
        })
    });

    describe("#setters", async () => {

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Sets protocol percentage fee", async function () {
            await expect(
                burnRouter.setProtocolPercentageFee(100)
            ).to.emit(
                burnRouter, "NewProtocolPercentageFee"
            ).withArgs(PROTOCOL_PERCENTAGE_FEE, 100);

            expect(
                await burnRouter.protocolPercentageFee()
            ).to.equal(100);
        })

        it("Reverts since protocol percentage fee is greater than 10000", async function () {
            await expect(
                burnRouter.setProtocolPercentageFee(10001)
            ).to.be.revertedWith("BurnRouterLogic: invalid fee");
        })

        it("Sets transfer deadline", async function () {

            await mockBitcoinRelay.mock.finalizationParameter.returns(10);

            await expect(
                burnRouter.setTransferDeadline(100)
            ).to.emit(
                burnRouter, "NewTransferDeadline"
            ).withArgs(TRANSFER_DEADLINE, 100);


            expect(
                await burnRouter.transferDeadline()
            ).to.equal(100);
        })

        it("Reverts since transfer deadline is smaller than relay finalizatio parameter", async function () {
            await mockBitcoinRelay.mock.finalizationParameter.returns(10);

            await expect(
                burnRouter.setTransferDeadline(9)
            ).to.be.revertedWith("BurnRouterLogic: low deadline");

        })

        it("Reverts since transfer deadline is smaller than relay finalizatio parameter", async function () {
            await mockBitcoinRelay.mock.finalizationParameter.returns(10);

            await expect(
                burnRouter.setTransferDeadline(10)
            ).to.be.revertedWith("BurnRouterLogic: low deadline");

        })

        it("Sets slasher reward", async function () {
            await expect(
                burnRouter.setSlasherPercentageReward(100)
            ).to.emit(
                burnRouter, "NewSlasherPercentageFee"
            ).withArgs(SLASHER_PERCENTAGE_REWARD, 100);

            expect(
                await burnRouter.slasherPercentageReward()
            ).to.equal(100);
        })

        it("Reverts since slasher reward is greater than 100", async function () {
            await expect(
                burnRouter.setSlasherPercentageReward(10001)
            ).to.be.revertedWith("BurnRouterLogic: invalid reward");
        })

        it("Sets bitcoin fee", async function () {
            await expect(
                burnRouter.setNetworkFee(100)
            ).to.emit(
                burnRouter, "NewNetworkFee"
            ).withArgs(BITCOIN_FEE, 100);


            expect(
                await burnRouter.bitcoinFee()
            ).to.equal(100);
        })

        it("Reverts since network fee is greater than 10000", async function () {
            await expect(
                burnRouter.connect(signer1).setNetworkFee(10001)
            ).to.be.revertedWith("BurnRouterLogic: not oracle");
        })

        it("Sets relay, lockers, teleBTC and treasury", async function () {
            await expect(
                burnRouter.setRelay(ONE_ADDRESS)
            ).to.emit(
                burnRouter, "NewRelay"
            ).withArgs(mockBitcoinRelay.address, ONE_ADDRESS);

            expect(
                await burnRouter.relay()
            ).to.equal(ONE_ADDRESS);

            await expect(
                burnRouter.setLockers(ONE_ADDRESS)
            ).to.emit(
                burnRouter, "NewLockers"
            ).withArgs(mockLockers.address, ONE_ADDRESS);

            expect(
                await burnRouter.lockers()
            ).to.equal(ONE_ADDRESS);

            await expect(
                burnRouter.setTeleBTC(ONE_ADDRESS)
            ).to.emit(
                burnRouter, "NewTeleBTC"
            ).withArgs(teleBTC.address, ONE_ADDRESS);

            expect(
                await burnRouter.teleBTC()
            ).to.equal(ONE_ADDRESS);

            await expect(
                burnRouter.setTreasury(ONE_ADDRESS)
            ).to.emit(
                burnRouter, "NewTreasury"
            ).withArgs(TREASURY, ONE_ADDRESS);


            expect(
                await burnRouter.treasury()
            ).to.equal(ONE_ADDRESS);

        })

        it("Reverts since starting block number is low", async function () {
            await expect(
                burnRouter.setStartingBlockNumber(1)
            ).to.be.revertedWith("BurnRouterLogic: low startingBlockNumber");
        })

        it("Reverts since given address is zero", async function () {
            await expect(
                burnRouter.setRelay(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(burnRouter, "ZeroAddress");

            await expect(
                burnRouter.setLockers(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(burnRouter, "ZeroAddress");

            await expect(
                burnRouter.setTeleBTC(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(burnRouter, "ZeroAddress");

            await expect(
                burnRouter.setTreasury(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(burnRouter, "ZeroAddress");
        })

        it("Reverts since given address is zero", async function () {
            await burnRouter.setThirdPartyAddress(1, ONE_ADDRESS)
            
            expect(
                await burnRouter.thirdPartyAddress(1)
            ).to.equal(ONE_ADDRESS);

            await burnRouter.setThirdPartyFee(1, 1)
            
            expect(
                await burnRouter.thirdPartyFee(1)
            ).to.equal(1);
        })

        it("Reverts since caller is not owner", async function () {
            await expect(
                burnRouter.connect(signer1).setRelay(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                burnRouter.connect(signer1).setLockers(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                burnRouter.connect(signer1).setTeleBTC(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                burnRouter.connect(signer1).setTreasury(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                burnRouter.connect(signer1).setProtocolPercentageFee(100)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            
            await expect(
                burnRouter.connect(signer1).setSlasherPercentageReward(100)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                burnRouter.connect(signer1).setNetworkFeeOracle(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                burnRouter.connect(signer1).setThirdPartyFee(1, 1)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                burnRouter.connect(signer1).setThirdPartyAddress(1, ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                burnRouter.connect(signer1).setStartingBlockNumber(1)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        })

    });

    describe("#renounce ownership", async () => {
        it("owner can't renounce ownership", async function () {
            await burnRouter.renounceOwnership()
            expect(
                await burnRouter.owner()
            ).to.equal(deployerAddress);
        })

        it("only owner can renounce ownership", async function () {
            await expect(
                burnRouter.connect(signer1).renounceOwnership()
            ).to.be.revertedWith("Ownable: caller is not the owner");
        })
    });

    describe("#third party", async () => {

        beforeEach(async () => {
            // Gives allowance to burnRouter to burn tokens
            await TeleBTCSigner1.approve(
                burnRouter.address,
                userRequestedAmount
            );
            
            await burnRouter.setThirdPartyAddress(1, THIRD_PARTY_ADDRESS)
            await burnRouter.setThirdPartyFee(1, THIRD_PARTY_PERCENTAGE_FEE)
            snapshotId = await takeSnapshot(signer1.provider);

        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Third party gets its fee", async function () {
            let lastSubmittedHeight = 100;

            // Gives allowance to burnRouter to burn tokens
            await TeleBTCSigner1.approve(
                burnRouter.address,
                userRequestedAmount
            );

            // Sets mock contracts outputs
            await setRelayLastSubmittedHeight(lastSubmittedHeight);
            await setLockersIsLocker(true);

            // Finds amount of teleBTC that user should receive on Bitcoin
            let protocolFee = Math.floor(userRequestedAmount.toNumber()*PROTOCOL_PERCENTAGE_FEE/10000);
            let thirdPartyFee = Math.floor(userRequestedAmount.toNumber()*THIRD_PARTY_PERCENTAGE_FEE/10000);
            let burntAmount = userRequestedAmount.toNumber() - protocolFee - thirdPartyFee - BITCOIN_FEE;
            await setLockersBurnReturn(burntAmount);
            // first burntAmount should have been
            // burntAmount - lockerFee but in this case we have assumed lockerFee = 0

            ;
            await setLockersGetLockerTargetAddress();

            let prevBalanceSigner1 = await teleBTC.balanceOf(signer1Address);

            await expect(
                await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
            ).to.equal(0)

            // Burns teleBTC

            await expect(
                await burnRouterSigner1.unwrap(
                    userRequestedAmount,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    1
                )
            ).to.emit(burnRouter, "NewUnwrap").withArgs(
                USER_SCRIPT_P2PKH,
                USER_SCRIPT_P2PKH_TYPE,
                LOCKER_TARGET_ADDRESS,
                signer1Address,
                0,
                lastSubmittedHeight + TRANSFER_DEADLINE,
                1,
                teleBTC.address,
                [userRequestedAmount, userRequestedAmount, burntAmount],
                [BITCOIN_FEE, 0, protocolFee, thirdPartyFee]
            );

            let newBalanceSigner1 = await teleBTC.balanceOf(signer1Address);

            // Checks user's balance
            await expect(
                await newBalanceSigner1
            ).to.equal(prevBalanceSigner1.sub(userRequestedAmount));

            // Checks that protocol fee has been received
            await expect(
                await teleBTC.balanceOf(TREASURY)
            ).to.equal(protocolFee);

            // Gets the burn request that has been saved in the contract
            let theBurnRequest = await burnRouter.burnRequests(LOCKER_TARGET_ADDRESS, 0);

            await expect(
                await theBurnRequest.burntAmount
            ).to.equal(burntAmount);

            await expect(
                await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
            ).to.equal(thirdPartyFee)
        })

        it("can change third party address", async function () {
            let NEW_THIRD_PARTY_ADDRESS = "0x0000000000000000000000000000000000000201"
            await burnRouter.setThirdPartyAddress(1, NEW_THIRD_PARTY_ADDRESS)

            let lastSubmittedHeight = 100;

            // Gives allowance to burnRouter to burn tokens
            await TeleBTCSigner1.approve(
                burnRouter.address,
                userRequestedAmount
            );

            // Sets mock contracts outputs
            await setRelayLastSubmittedHeight(lastSubmittedHeight);
            await setLockersIsLocker(true);

            // Finds amount of teleBTC that user should receive on Bitcoin
            let protocolFee = Math.floor(userRequestedAmount.toNumber()*PROTOCOL_PERCENTAGE_FEE/10000);
            let thirdPartyFee = Math.floor(userRequestedAmount.toNumber()*THIRD_PARTY_PERCENTAGE_FEE/10000);
            let burntAmount = userRequestedAmount.toNumber() - protocolFee - thirdPartyFee - BITCOIN_FEE;
            await setLockersBurnReturn(burntAmount);

            // first burntAmount should have been
            // burntAmount - lockerFee but in this case we have assumed lockerFee = 0

            ;
            await setLockersGetLockerTargetAddress();

            let prevBalanceSigner1 = await teleBTC.balanceOf(signer1Address);

            await expect(
                await teleBTC.balanceOf(NEW_THIRD_PARTY_ADDRESS)
            ).to.equal(0)

            // Burns teleBTC

            await expect(
                await burnRouterSigner1.unwrap(
                    userRequestedAmount,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    1
                )
            ).to.emit(burnRouter, "NewUnwrap").withArgs(
                USER_SCRIPT_P2PKH,
                USER_SCRIPT_P2PKH_TYPE,
                LOCKER_TARGET_ADDRESS,
                signer1Address,
                0,
                lastSubmittedHeight + TRANSFER_DEADLINE,
                1,
                teleBTC.address,
                [userRequestedAmount, userRequestedAmount, burntAmount],
                [BITCOIN_FEE, 0, protocolFee, thirdPartyFee]
            );

            let newBalanceSigner1 = await teleBTC.balanceOf(signer1Address);

            // Checks user's balance
            await expect(
                await newBalanceSigner1
            ).to.equal(prevBalanceSigner1.sub(userRequestedAmount));

            // Checks that protocol fee has been received
            await expect(
                await teleBTC.balanceOf(TREASURY)
            ).to.equal(protocolFee);

            // Gets the burn request that has been saved in the contract
            let theBurnRequest = await burnRouter.burnRequests(LOCKER_TARGET_ADDRESS, 0);

            await expect(
                await theBurnRequest.burntAmount
            ).to.equal(burntAmount);

            await expect(
                await teleBTC.balanceOf(NEW_THIRD_PARTY_ADDRESS)
            ).to.equal(thirdPartyFee)
        })

        it("can change third party fee", async function () {
            let NEW_THIRD_PARTY_PERCENTAGE_FEE = 50
            await burnRouter.setThirdPartyFee(1, NEW_THIRD_PARTY_PERCENTAGE_FEE)

            let lastSubmittedHeight = 100;

            // Gives allowance to burnRouter to burn tokens
            await TeleBTCSigner1.approve(
                burnRouter.address,
                userRequestedAmount
            );

            // Sets mock contracts outputs
            await setRelayLastSubmittedHeight(lastSubmittedHeight);
            await setLockersIsLocker(true);

            // Finds amount of teleBTC that user should receive on Bitcoin
            let protocolFee = Math.floor(userRequestedAmount.toNumber()*PROTOCOL_PERCENTAGE_FEE/10000);
            let thirdPartyFee = Math.floor(userRequestedAmount.toNumber()*NEW_THIRD_PARTY_PERCENTAGE_FEE/10000);
            let burntAmount = userRequestedAmount.toNumber() - protocolFee - thirdPartyFee - BITCOIN_FEE;
            await setLockersBurnReturn(burntAmount);
            // first burntAmount should have been
            // burntAmount - lockerFee but in this case we have assumed lockerFee = 0

            ;
            await setLockersGetLockerTargetAddress();

            let prevBalanceSigner1 = await teleBTC.balanceOf(signer1Address);

            await expect(
                await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
            ).to.equal(0)

            // Burns teleBTC

            await expect(
                await burnRouterSigner1.unwrap(
                    userRequestedAmount,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER1_LOCKING_SCRIPT,
                    1
                )
            ).to.emit(burnRouter, "NewUnwrap").withArgs(
                USER_SCRIPT_P2PKH,
                USER_SCRIPT_P2PKH_TYPE,
                LOCKER_TARGET_ADDRESS,
                signer1Address,
                0,
                lastSubmittedHeight + TRANSFER_DEADLINE,
                1,
                teleBTC.address,
                [userRequestedAmount, userRequestedAmount, burntAmount],
                [BITCOIN_FEE, 0, protocolFee, thirdPartyFee]
            );

            let newBalanceSigner1 = await teleBTC.balanceOf(signer1Address);

            // Checks user's balance
            await expect(
                await newBalanceSigner1
            ).to.equal(prevBalanceSigner1.sub(userRequestedAmount));

            // Checks that protocol fee has been received
            await expect(
                await teleBTC.balanceOf(TREASURY)
            ).to.equal(protocolFee);

            // Gets the burn request that has been saved in the contract
            let theBurnRequest = await burnRouter.burnRequests(LOCKER_TARGET_ADDRESS, 0);

            await expect(
                await theBurnRequest.burntAmount
            ).to.equal(burntAmount);

            await expect(
                await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
            ).to.equal(thirdPartyFee)
        })

        it("only owner can set third party address", async function () {
            await expect(
                burnRouterSigner1.setThirdPartyAddress(1, THIRD_PARTY_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can set third party fee", async function () {
            await expect(
                burnRouterSigner1.setThirdPartyFee(1, THIRD_PARTY_PERCENTAGE_FEE)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

    });
});