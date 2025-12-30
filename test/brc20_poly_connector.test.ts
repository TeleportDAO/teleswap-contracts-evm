/* eslint-disable camelcase */
/* eslint-disable node/no-missing-import */
/* eslint-disable node/no-extraneous-import */
import "@nomicfoundation/hardhat-chai-matchers";
import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import { Signer, BigNumber } from "ethers";
import {
    deployMockContract,
    MockContract,
} from "@ethereum-waffle/mock-contract";
import { Address } from "hardhat-deploy/types";
import { Contract } from "@ethersproject/contracts";
import { TeleBTCLogic } from "../src/types/TeleBTCLogic";
import { TeleBTCLogic__factory } from "../src/types/factories/TeleBTCLogic__factory";
import { TeleBTCProxy__factory } from "../src/types/factories/TeleBTCProxy__factory";
import { Erc20 as ERC20 } from "../src/types/Erc20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";
import { PolyConnectorProxy__factory } from "../src/types/factories/PolyConnectorProxy__factory";
import { PolyConnectorLogic__factory } from "../src/types/factories/PolyConnectorLogic__factory";
import { BurnRouterLib } from "../src/types/BurnRouterLib";
import { BurnRouterLib__factory } from "../src/types/factories/BurnRouterLib__factory";
import { BurnRouterProxy__factory } from "../src/types/factories/BurnRouterProxy__factory";
import {
    BurnRouterLogic__factory,
    BurnRouterLogicLibraryAddresses,
} from "../src/types/factories/BurnRouterLogic__factory";
import { takeSnapshot, revertProvider } from "./block_utils";
import CC_EXCHANGE_REQUESTS from "./test_fixtures/ccExchangeRequests.json";
import Web3 from "web3";
const { calculateTxId } = require("./utils/calculateTxId");

const abiUtils = new Web3().eth.abi;
const web3 = new Web3();
const provider = ethers.provider;

// TODO: ADD TESTS FOR CHAIN ID

describe("PolyConnector", async () => {
    let snapshotId: any;

    // Accounts
    let proxyAdmin: Signer;
    let deployer: Signer;
    let signer1: Signer;
    let acrossSinger: Signer;
    let signer1Address: Address;
    let proxyAdminAddress: Address;
    let acrossAddress: Address;

    // Contracts
    let teleBTC: TeleBTCLogic;
    let inputToken: ERC20;
    let TeleBTCSigner1: TeleBTCLogic;
    let PolyConnector: Contract;
    let PolyConnectorWithMockedAccross: Contract;
    let burnRouterLib: BurnRouterLib;
    let burnRouter: Contract;

    // Mock contracts
    let mockBitcoinRelay: MockContract;
    let mockLockers: MockContract;
    let mockExchangeConnector: MockContract;
    let mockAcross: MockContract;

    // Constants
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
    const oneHundred = BigNumber.from(10).pow(8).mul(100);
    /*
        This one is set so that:
        userRequestedAmount * (1 - lockerFee / 10000 - PROTOCOL_PERCENTAGE_FEE / 10000) - BITCOIN_FEE = 100000000
    */
    // const userRequestedAmount = BigNumber.from(100060030);
    const requestAmount = 100;
    const telebtcAmount = 1000000000;
    const TRANSFER_DEADLINE = 20;
    const PROTOCOL_PERCENTAGE_FEE = 5; // means 0.05%
    const LOCKER_PERCENTAGE_FEE = 10; // means 0.1%
    const SLASHER_PERCENTAGE_REWARD = 5; // means 0.05%
    const BITCOIN_FEE = 10000; // estimation of Bitcoin transaction fee in Satoshi
    const TREASURY = "0x0000000000000000000000000000000000000002";

    const LOCKER_TARGET_ADDRESS = ONE_ADDRESS;
    // const LOCKER1_LOCKING_SCRIPT =
    //     "0x76a914748284390f9e263a4b766a75d0633c50426eb87587ac";

    const USER_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
    const USER_SCRIPT_P2PKH_TYPE = 1; // P2PKH

    before(async () => {
        [proxyAdmin, deployer, signer1, acrossSinger] =
            await ethers.getSigners();
        proxyAdminAddress = await proxyAdmin.getAddress();
        signer1Address = await signer1.getAddress();
        acrossAddress = await acrossSinger.getAddress();

        // Mocks contracts

        const bitcoinRelay = await deployments.getArtifact("IBitcoinRelay");
        mockBitcoinRelay = await deployMockContract(deployer, bitcoinRelay.abi);

        const lockers = await deployments.getArtifact("LockersManagerLogic");
        mockLockers = await deployMockContract(deployer, lockers.abi);

        const across = await deployments.getArtifact("SpokePoolInterface");
        // Add depositV3 and deposit to the ABI if they don't exist (needed for the mock)
        const extendedAbi = [...across.abi];
        if (!extendedAbi.find((item: any) => item.name === "depositV3")) {
            extendedAbi.push({
                inputs: [
                    { name: "depositor", type: "address" },
                    { name: "recipient", type: "address" },
                    { name: "inputToken", type: "address" },
                    { name: "outputToken", type: "address" },
                    { name: "inputAmount", type: "uint256" },
                    { name: "outputAmount", type: "uint256" },
                    { name: "destinationChainId", type: "uint256" },
                    { name: "exclusiveRelayer", type: "address" },
                    { name: "quoteTimestamp", type: "uint32" },
                    { name: "fillDeadline", type: "uint32" },
                    { name: "exclusivityDeadline", type: "uint32" },
                    { name: "message", type: "bytes" },
                ],
                name: "depositV3",
                outputs: [],
                stateMutability: "payable",
                type: "function",
            });
        }
        // Remove existing deposit function if it exists (might have wrong signature)
        const depositIndex = extendedAbi.findIndex(
            (item: any) => item.name === "deposit"
        );
        if (depositIndex !== -1) {
            extendedAbi.splice(depositIndex, 1);
        }
        // Add deposit function with correct signature
        extendedAbi.push({
            inputs: [
                { name: "depositor", type: "bytes32" },
                { name: "recipient", type: "bytes32" },
                { name: "inputToken", type: "bytes32" },
                { name: "outputToken", type: "bytes32" },
                { name: "inputAmount", type: "uint256" },
                { name: "outputAmount", type: "uint256" },
                { name: "destinationChainId", type: "uint256" },
                { name: "exclusiveRelayer", type: "bytes32" },
                { name: "quoteTimestamp", type: "uint32" },
                { name: "fillDeadline", type: "uint32" },
                { name: "exclusivityDeadline", type: "uint32" },
                { name: "message", type: "bytes" },
            ],
            name: "deposit",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
        });
        mockAcross = await deployMockContract(deployer, extendedAbi);

        const exchangeConnector = await deployments.getArtifact(
            "UniswapV2Connector"
        );
        mockExchangeConnector = await deployMockContract(
            deployer,
            exchangeConnector.abi
        );

        // await mockExchangeConnector.mock.ccExchangeAndBurn
        //     .returns(100);

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

        teleBTC = await teleBTCLogic.attach(teleBTCProxy.address);

        await teleBTC.initialize("TeleportDAO-BTC", "teleBTC");

        burnRouter = await deployBurnRouter();

        await burnRouter.initialize(
            1,
            mockBitcoinRelay.address,
            mockLockers.address,
            TREASURY,
            teleBTC.address,
            TRANSFER_DEADLINE,
            PROTOCOL_PERCENTAGE_FEE,
            LOCKER_PERCENTAGE_FEE,
            SLASHER_PERCENTAGE_REWARD,
            BITCOIN_FEE,
            ONE_ADDRESS
        );

        PolyConnector = await deployPolyConnector();

        await PolyConnector.initialize(
            mockLockers.address,
            burnRouter.address,
            acrossAddress,
            ZERO_ADDRESS
        );

        PolyConnectorWithMockedAccross = await deployPolyConnector();

        await PolyConnectorWithMockedAccross.initialize(
            mockLockers.address,
            burnRouter.address,
            signer1Address,
            ZERO_ADDRESS
        );

        // Deploys input token
        const erc20Factory = new Erc20__factory(deployer);
        inputToken = await erc20Factory.deploy("TestToken", "TT", 100000);

        // Mints TeleBTC for user
        await teleBTC.addMinter(signer1Address);
        TeleBTCSigner1 = await teleBTC.connect(signer1);

        await teleBTC.setMaxMintLimit(oneHundred.mul(2));
        await moveBlocks(2020);

        await TeleBTCSigner1.mint(signer1Address, telebtcAmount);

        // Sets mock contracts outputs
        const lastSubmittedHeight = 100;
        await setLockersIsLocker(true);
        await setLockersGetLockerTargetAddress();
        await setRelayLastSubmittedHeight(lastSubmittedHeight);
        await setSwap(true, [requestAmount, telebtcAmount]);

        const protocolFee = Math.floor(
            (telebtcAmount * PROTOCOL_PERCENTAGE_FEE) / 10000
        );
        const burntAmount = telebtcAmount - BITCOIN_FEE - protocolFee;

        await setLockersBurnReturn(burntAmount);
    });

    async function moveBlocks(amount: number) {
        for (let index = 0; index < amount; index++) {
            await network.provider.request({
                method: "evm_mine",
                params: [],
            });
        }
    }

    const parseSignatureToRSV = (signatureHex: string) => {
        // Ensure the hex string starts with '0x'
        if (!signatureHex.startsWith("0x")) {
            throw new Error("Signature must start with 0x");
        }

        // Convert the hex string to a Buffer
        const signatureBuffer = Buffer.from(signatureHex.slice(2), "hex");

        // Check the length of the signature (should be 65 bytes)
        if (signatureBuffer.length !== 65) {
            throw new Error("Invalid signature length");
        }

        // Extract r, s, and v from the signature
        const r = `0x${signatureBuffer.subarray(0, 32).toString("hex")}`;
        const s = `0x${signatureBuffer.subarray(32, 64).toString("hex")}`;
        const v = signatureBuffer[64];

        return { r, s, v };
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

        const linkLibraryAddresses: BurnRouterLogicLibraryAddresses = {
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

    const deployPolyConnector = async (_signer?: Signer): Promise<Contract> => {
        const PolyConnectorLogicFactory = new PolyConnectorLogic__factory(
            _signer || deployer
        );

        const PolyConnectorLogic = await PolyConnectorLogicFactory.deploy();

        // Deploys lockers proxy
        const PolyConnectorProxyFactory = new PolyConnectorProxy__factory(
            _signer || deployer
        );
        const PolyConnectorProxy = await PolyConnectorProxyFactory.deploy(
            PolyConnectorLogic.address,
            proxyAdminAddress,
            "0x"
        );

        return await PolyConnectorLogic.attach(PolyConnectorProxy.address);
    };

    async function setLockersIsLocker(isLocker: boolean): Promise<void> {
        await mockLockers.mock.isLocker.returns(isLocker);
    }

    async function setLockersGetLockerTargetAddress(): Promise<void> {
        await mockLockers.mock.getLockerTargetAddress.returns(
            LOCKER_TARGET_ADDRESS
        );
    }

    async function setLockersBurnReturn(burntAmount: number): Promise<void> {
        await mockLockers.mock.burn.returns(burntAmount);
    }

    async function setRelayLastSubmittedHeight(
        blockNumber: number
    ): Promise<void> {
        await mockBitcoinRelay.mock.lastSubmittedHeight.returns(blockNumber);
    }

    async function setSwap(result: boolean, amounts: number[]): Promise<void> {
        await mockExchangeConnector.mock.swap.returns(result, amounts);
    }

    describe("#setters", async () => {
        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        // write test setLockerProxy and getLockerProxy
        it("should set and get the LockerProxy", async () => {
            await PolyConnector.setLockersProxy(mockLockers.address);
            expect(await PolyConnector.lockersProxy()).to.equal(
                mockLockers.address
            );
        });

        // write test setLockerProxy that only owner can change
        it("should not set the LockerProxy if not owner", async () => {
            await expect(
                PolyConnector.connect(signer1).setLockersProxy(
                    mockLockers.address
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        // write test setBurnRouter and getBurnRouter

        it("should set and get the BurnRouter", async () => {
            await PolyConnector.setBurnRouterProxy(burnRouter.address);
            expect(await PolyConnector.burnRouterProxy()).to.equal(
                burnRouter.address
            );
        });

        // write test setBurnRouter that only owner can change
        it("should not set the BurnRouter if not owner", async () => {
            await expect(
                PolyConnector.connect(signer1).setBurnRouterProxy(
                    burnRouter.address
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        // write test setAcross and getAcross
        it("should set and get the Across", async () => {
            await PolyConnector.setAcross(mockAcross.address);
            expect(await PolyConnector.across()).to.equal(mockAcross.address);
        });

        // write test setAcross that only owner can change
        it("should not set the Across if not owner", async () => {
            await expect(
                PolyConnector.connect(signer1).setAcross(mockAcross.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        // write test setAcross and getAcrossV3
        it("should set and get the AcrossV3", async () => {
            await PolyConnector.setAcross(mockAcross.address);
            expect(await PolyConnector.across()).to.equal(mockAcross.address);
        });

        // write test setAcross that only owner can change
        it("should not set the AcrossV3 if not owner", async () => {
            await expect(
                PolyConnector.connect(signer1).setAcross(mockAcross.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("can't set addresses to zero address", async () => {
            await expect(
                PolyConnector.setLockersProxy(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(PolyConnector, "ZeroAddress");
            await expect(
                PolyConnector.setBurnRouterProxy(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(PolyConnector, "ZeroAddress");
            await expect(
                PolyConnector.setAcross(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(PolyConnector, "ZeroAddress");
        });
    });

    describe("#Handle across message V3", async () => {
        const protocolFee = Math.floor(
            (telebtcAmount * PROTOCOL_PERCENTAGE_FEE) / 10000
        );

        beforeEach(async () => {
            // Sends teleBTC to burnRouter (since we mock swap)

            snapshotId = await takeSnapshot(signer1.provider);

            await TeleBTCSigner1.transfer(burnRouter.address, telebtcAmount);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("should handle across message", async () => {
            const lockerFee = Math.floor(
                (telebtcAmount * LOCKER_PERCENTAGE_FEE) / 10000
            );
            const burntAmount =
                telebtcAmount - BITCOIN_FEE - protocolFee - lockerFee;

            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "address",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapAndUnwrap",
                    "1",
                    1,
                    signer1Address,
                    mockExchangeConnector.address,
                    burntAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await setLockersBurnReturn(burntAmount);

            await inputToken.transfer(PolyConnector.address, requestAmount);

            await expect(
                PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    message
                )
            )
                .to.emit(PolyConnector, "NewSwapAndUnwrap")
                .withArgs(
                    1,
                    1,
                    mockExchangeConnector.address,
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER_TARGET_ADDRESS,
                    0,
                    [inputToken.address, teleBTC.address],
                    0
                );
        });

        it("should not handle across message if not across", async () => {
            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "address",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapAndUnwrap",
                    "1",
                    1,
                    signer1Address,
                    mockExchangeConnector.address,
                    telebtcAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await expect(
                PolyConnector.connect(signer1).handleV3AcrossMessage(
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    message
                )
            ).to.be.revertedWith("PolygonConnectorLogic: not across");
        });

        it("should not handle across message if purpose is not swapAndUnwrap", async () => {
            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "address",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "test",
                    "1",
                    1,
                    signer1Address,
                    mockExchangeConnector.address,
                    telebtcAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await expect(
                PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    message
                )
            ).to.not.emit(PolyConnector, "NewSwapAndUnwrapUniversal");
        });

        it("should not handle across message if ccExchangeAndBurn fails", async () => {
            await setLockersIsLocker(false);

            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "address",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapAndUnwrap",
                    "1",
                    1,
                    signer1Address,
                    mockExchangeConnector.address,
                    telebtcAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await setSwap(false, [requestAmount, telebtcAmount]);

            await expect(
                PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    message
                )
            )
                .to.emit(PolyConnector, "FailedSwapAndUnwrap")
                .withArgs(
                    1,
                    1,
                    mockExchangeConnector.address,
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    [inputToken.address, teleBTC.address],
                    0
                );
        });
    });

    describe("#Handle Failed CcExchangeAndBurn ", async () => {
        // let protocolFee = Math.floor(
        //     (telebtcAmount * PROTOCOL_PERCENTAGE_FEE) / 10000
        // );
        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
            // Sends teleBTC to burnRouter (since we mock swap)
            await TeleBTCSigner1.transfer(burnRouter.address, telebtcAmount);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("retry failed swap and unwrap", async () => {
            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "address",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapAndUnwrap",
                    "1",
                    1,
                    signer1Address,
                    mockExchangeConnector.address,
                    telebtcAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await setSwap(false, [requestAmount, telebtcAmount]);

            await PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                inputToken.address,
                requestAmount,
                signer1Address,
                message
            );

            expect(
                await PolyConnector.newFailedReqs(
                    signer1Address,
                    1,
                    1,
                    inputToken.address
                )
            ).to.eq(BigNumber.from(requestAmount));

            await inputToken.transfer(PolyConnector.address, requestAmount);

            const reDoMessage = abiUtils.encodeParameters(
                ["uint256", "uint256", "address", "int64"],
                [
                    1, // chainId
                    1, // uniqueCounter
                    inputToken.address, // token
                    1000, // relayerFeePercentage
                ]
            );

            const messageHex = await web3.utils.soliditySha3({
                type: "bytes",
                value: reDoMessage,
            });
            if (messageHex != null) {
                const signature = await signer1.signMessage(
                    ethers.utils.arrayify(messageHex)
                );
                const rsv = await parseSignatureToRSV(signature);
                await setSwap(true, [requestAmount, telebtcAmount]);

                // Set across to mockAcross.address and mock depositV3 for withdrawFundsToSourceChain
                await PolyConnector.setAcross(mockAcross.address);
                await mockAcross.mock.depositV3.returns();

                await expect(
                    PolyConnector.connect(signer1).withdrawFundsToSourceChain(
                        reDoMessage,
                        rsv.v,
                        rsv.r,
                        rsv.s
                    )
                )
                    .to.emit(PolyConnector, "WithdrawnFundsToSourceChain")
                    .withArgs(
                        1, // uniqueCounter
                        1, // chainId
                        inputToken.address, // token
                        requestAmount, // amount
                        1000, // relayerFeePercentage
                        signer1Address // user
                    );

                await expect(
                    await PolyConnector.newFailedReqs(
                        signer1Address,
                        1,
                        1,
                        inputToken.address
                    )
                ).to.equal(0);
            }
        });

        it("fail re do fail cc exchange because amount is greater than available", async () => {
            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "address",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapAndUnwrap",
                    "1",
                    1,
                    signer1Address,
                    mockExchangeConnector.address,
                    telebtcAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await setSwap(false, [requestAmount, telebtcAmount]);

            await PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                inputToken.address,
                requestAmount,
                signer1Address,
                message
            );

            await inputToken.transfer(PolyConnector.address, requestAmount);

            const reDoMessage = abiUtils.encodeParameters(
                ["uint256", "uint256", "address", "int64"],
                [
                    1, // chainId
                    1, // uniqueCounter
                    inputToken.address, // token
                    1000, // relayerFeePercentage
                ]
            );

            const messageHex = await web3.utils.soliditySha3({
                type: "bytes",
                value: reDoMessage,
            });
            if (messageHex != null) {
                const signature = await signer1.signMessage(
                    ethers.utils.arrayify(messageHex)
                );
                const rsv = await parseSignatureToRSV(signature);
                await setSwap(true, [requestAmount, telebtcAmount]);

                await PolyConnector.setAcross(mockAcross.address);
                await mockAcross.mock.depositV3.returns();

                await PolyConnector.connect(signer1).withdrawFundsToSourceChain(
                    reDoMessage,
                    rsv.v,
                    rsv.r,
                    rsv.s
                );

                await expect(
                    PolyConnector.connect(signer1).withdrawFundsToSourceChain(
                        reDoMessage,
                        rsv.v,
                        rsv.r,
                        rsv.s
                    )
                ).to.be.revertedWith(
                    "PolygonConnectorLogic: already withdrawn"
                );
            }
        });

        // test is commented because can't call function with mocked across
        // it("can withdraw Funds To Eth", async () => {
        //     let message = abiUtils.encodeParameters([
        //         'string',
        //         'uint',
        //         'address',
        //         'address',
        //         'uint',
        //         'address[]',
        //         'bytes',
        //         'uint',
        //         'bytes'
        //     ], [
        //         "swapAndUnwrap",
        //         "1",
        //         signer1Address,
        //         mockExchangeConnector.address,
        //         telebtcAmount,
        //         [inputToken.address, teleBTC.address],
        //         USER_SCRIPT_P2PKH,
        //         USER_SCRIPT_P2PKH_TYPE,
        //         LOCKER1_LOCKING_SCRIPT
        //     ])

        //     await setSwap(false, [requestAmount, telebtcAmount])
        //     await mockAcross.mock.deposit.returns()
        //     await PolyConnectorWithMockedAccross.connect(signer1).handleV3AcrossMessage(
        //         inputToken.address,
        //         requestAmount,
        //         signer1Address,
        //         message
        //     )

        //     await expect(
        //         await PolyConnectorWithMockedAccross.failedReqs(signer1Address, inputToken.address)
        //     ).to.equal(BigNumber.from(requestAmount))

        //     await inputToken.transfer(
        //         PolyConnectorWithMockedAccross.address,
        //         requestAmount
        //     );

        //     let reDoMessage = abiUtils.encodeParameters([
        //         'address',
        //         'uint',
        //         'int64'
        //     ], [
        //         inputToken.address,
        //         requestAmount,
        //         1000
        //     ])

        //     let messageHex = await web3.utils.soliditySha3(
        //         {
        //             type: 'bytes',
        //             value: reDoMessage
        //         }
        //     )
        //     if (messageHex != null) {
        //         let signature
        //         let rsv
        //         signature = await signer1.signMessage(ethers.utils.arrayify(messageHex))
        //         rsv = await parseSignatureToRSV(signature)
        //         await setSwap(true, [requestAmount, telebtcAmount])

        //         await PolyConnectorWithMockedAccross.connect(signer1).withdrawFundsToSourceChain(
        //             reDoMessage,
        //             rsv.v,
        //             rsv.r,
        //             rsv.s
        //         )

        //         await expect(
        //             await PolyConnectorWithMockedAccross.failedReqs(signer1Address, inputToken.address)
        //         ).to.equal(0)
        //     }

        // });

        it("can't withdraw funds to eth if amount is zero", async () => {
            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "address",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapAndUnwrap",
                    "1",
                    1,
                    signer1Address,
                    mockExchangeConnector.address,
                    telebtcAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await setSwap(false, [requestAmount, telebtcAmount]);
            await mockAcross.mock.depositFor.returns();

            // TODO: fix this test. function should be called by across, not signer1.
            // await PolyConnectorWithMockedAccross.setAcross(mockAcross.address);

            await PolyConnectorWithMockedAccross.connect(
                signer1
            ).handleV3AcrossMessage(
                inputToken.address,
                requestAmount,
                signer1Address,
                message
            );

            expect(
                await PolyConnectorWithMockedAccross.newFailedReqs(
                    signer1Address,
                    1,
                    1,
                    inputToken.address
                )
            ).to.eq(BigNumber.from(requestAmount));

            await inputToken.transfer(
                PolyConnectorWithMockedAccross.address,
                requestAmount
            );

            const reDoMessage = abiUtils.encodeParameters(
                ["uint256", "uint256", "address", "int64"],
                [1, 1, inputToken.address, 1000]
            );

            const messageHex = await web3.utils.soliditySha3({
                type: "bytes",
                value: reDoMessage,
            });
            if (messageHex != null) {
                // let signature;
                // let rsv;
                // const signature = await signer1.signMessage(
                //     ethers.utils.arrayify(messageHex)
                // );
                // const rsv = await parseSignatureToRSV(signature);
                // await setSwap(true, [requestAmount, telebtcAmount]);
                // await PolyConnectorWithMockedAccross.connect(
                //     signer1
                // ).withdrawFundsToSourceChain(reDoMessage, rsv.v, rsv.r, rsv.s);
                // await expect(
                //     PolyConnectorWithMockedAccross.connect(
                //         signer1
                //     ).withdrawFundsToSourceChain(reDoMessage, rsv.v, rsv.r, rsv.s)
                // ).to.be.revertedWith("PolygonConnectorLogic: already withdrawn");
            }
        });

        // it("can't withdraw Funds To Eth if amount is greater than user request amount", async () => {
        //     let message = abiUtils.encodeParameters(
        //         [
        //             "string",
        //             "uint",
        //             "uint",
        //             "address",
        //             "address",
        //             "uint",
        //             "bool",
        //             "address[]",
        //             {
        //                 "UserAndLockerScript": {
        //                     "userScript": "bytes",
        //                     "scriptType": "uint",
        //                     "lockerLockingScript": "bytes"
        //                 }
        //             },
        //             "uint"
        //         ],
        //         [
        //             "swapAndUnwrap",
        //             "1",
        //             1,
        //             signer1Address,
        //             mockExchangeConnector.address,
        //             telebtcAmount,
        //             true,
        //             [inputToken.address, teleBTC.address],
        //             {
        //                 "userScript": USER_SCRIPT_P2PKH,
        //                 "scriptType": USER_SCRIPT_P2PKH_TYPE,
        //                 "lockerLockingScript": LOCKER_TARGET_ADDRESS
        //             },
        //             0
        //         ]
        //     );

        //     await setSwap(false, [requestAmount, telebtcAmount]);
        //     await mockAcross.mock.deposit.returns();
        //     await PolyConnectorWithMockedAccross.connect(
        //         signer1
        //     ).handleV3AcrossMessage(
        //         inputToken.address,
        //         requestAmount,
        //         signer1Address,
        //         message
        //     );

        //     await expect(
        //         await PolyConnectorWithMockedAccross.failedReqs(
        //             signer1Address,
        //             1,
        //             inputToken.address
        //         )
        //     ).to.equal(BigNumber.from(requestAmount));

        //     await inputToken.transfer(
        //         PolyConnectorWithMockedAccross.address,
        //         requestAmount
        //     );

        //     let reDoMessage = abiUtils.encodeParameters(
        //         ["uint256", "address", "uint", "int64"],
        //         [1, inputToken.address, requestAmount + 1, 1000]
        //     );

        //     let messageHex = await web3.utils.soliditySha3({
        //         type: "bytes",
        //         value: reDoMessage,
        //     });
        //     if (messageHex != null) {
        //         let signature;
        //         let rsv;
        //         signature = await signer1.signMessage(
        //             ethers.utils.arrayify(messageHex)
        //         );
        //         rsv = await parseSignatureToRSV(signature);
        //         await setSwap(true, [requestAmount, telebtcAmount]);

        //         await expect(
        //             PolyConnectorWithMockedAccross.connect(
        //                 signer1
        //             ).withdrawFundsToSourceChain(reDoMessage, rsv.v, rsv.r, rsv.s)
        //         ).to.be.revertedWith("PolygonConnectorLogic: low balance");
        //     }
        // });
    });

    describe("#Handle emergencyWithdraw", async () => {
        // write test that handle emergency withdraw
        it("should handle emergency withdraw token", async () => {
            await inputToken.transfer(PolyConnector.address, requestAmount);

            expect(await inputToken.balanceOf(PolyConnector.address)).to.eq(
                BigNumber.from(requestAmount)
            );

            await PolyConnector.emergencyWithdraw(
                inputToken.address,
                signer1Address,
                requestAmount
            );

            await expect(
                await inputToken.balanceOf(PolyConnector.address)
            ).to.be.equal(0);

            await expect(
                await inputToken.balanceOf(signer1Address)
            ).to.be.equal(requestAmount);
        });

        it("should handle emergency withdraw eth", async () => {
            const tx = {
                to: PolyConnector.address,
                value: 100,
            };
            await signer1.sendTransaction(tx);

            const beforeBalance = await signer1.getBalance();
            beforeBalance.add(100);

            expect(await provider.getBalance(PolyConnector.address)).to.eq(100);

            await PolyConnector.emergencyWithdraw(
                "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                signer1Address,
                100
            );
        });

        // write test that only owner can emergency withdraw
        it("should not handle emergency withdraw if not owner", async () => {
            await expect(
                PolyConnector.connect(signer1).emergencyWithdraw(
                    inputToken.address,
                    signer1Address,
                    requestAmount
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Handle received swap and unwrap universal from across", async () => {
        const protocolFee = Math.floor(
            (telebtcAmount * PROTOCOL_PERCENTAGE_FEE) / 10000
        );

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);

            await TeleBTCSigner1.transfer(burnRouter.address, telebtcAmount);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("should swap and unwrap successfully", async () => {
            const lockerFee = Math.floor(
                (telebtcAmount * LOCKER_PERCENTAGE_FEE) / 10000
            );
            const burntAmount =
                telebtcAmount - BITCOIN_FEE - protocolFee - lockerFee;

            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "bytes32",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapAndUnwrapUniversal",
                    "0",
                    1,
                    ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32),
                    mockExchangeConnector.address,
                    burntAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await setLockersBurnReturn(burntAmount);

            await inputToken.transfer(PolyConnector.address, requestAmount);

            await expect(
                PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    message
                )
            )
                .to.emit(PolyConnector, "NewSwapAndUnwrapUniversal")
                .withArgs(
                    0,
                    1,
                    mockExchangeConnector.address,
                    inputToken.address,
                    requestAmount,
                    ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32),
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    LOCKER_TARGET_ADDRESS,
                    0,
                    [inputToken.address, teleBTC.address],
                    0
                );
        });

        it("admin should withdraw funds to source chain if the swap and unwrap fails", async () => {
            // const lockerFee = Math.floor(
            //     (telebtcAmount * LOCKER_PERCENTAGE_FEE) / 10000
            // ); // to fail the swap and unwrap
            const burntAmount = telebtcAmount - BITCOIN_FEE - protocolFee;

            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "bytes32",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapAndUnwrapUniversal",
                    "0",
                    1,
                    ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32),
                    mockExchangeConnector.address,
                    burntAmount,
                    true,
                    [inputToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await setLockersBurnReturn(burntAmount);

            await inputToken.transfer(PolyConnector.address, requestAmount);

            await expect(
                PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    message
                )
            )
                .to.emit(PolyConnector, "FailedSwapAndUnwrapUniversal")
                .withArgs(
                    0,
                    1,
                    mockExchangeConnector.address,
                    inputToken.address,
                    requestAmount,
                    ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32),
                    USER_SCRIPT_P2PKH,
                    USER_SCRIPT_P2PKH_TYPE,
                    [inputToken.address, teleBTC.address],
                    0
                );

            await PolyConnector.setAcross(mockAcross.address);

            // Mock the deposit function
            await mockAcross.mock.deposit.returns();

            await PolyConnector.setBridgeTokenMapping(
                inputToken.address,
                1, // source chain ID (Ethereum)
                inputToken.address // destination token (same token on source chain)
            );

            // Set bridge connector mapping for chainId 1 (required for _sendMessageUsingAcrossUniversal)
            await PolyConnector.setBridgeConnectorMapping(
                1, // chainId (Ethereum)
                ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32) // bridge connector address on source chain
            );

            // Set bridge token mapping universal for chainId 1 (required for _sendMessageUsingAcrossUniversal)
            await PolyConnector.setBridgeTokenMappingUniversal(
                inputToken.address,
                1, // chainId (Ethereum)
                ethers.utils.hexZeroPad(inputToken.address.toLowerCase(), 32) // destination token as bytes32
            );

            const bridgePercentageFee = BigNumber.from(10).pow(15); // 0.1% = 1e15
            // For swapAndUnwrapUniversal
            const requestAmountOfInputToken = ethers.utils.parseUnits("10", 18); // 10 tokens of input token (e.g., AAVE)
            const intermediaryTokenAmount = ethers.utils.parseUnits("0.1", 18); // 0.1 tokens of intermediary token

            await expect(
                PolyConnector.withdrawFundsToSourceChainByAdminUniversal(
                    ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32),
                    1, // chainId (Ethereum)
                    0, // uniqueCounter
                    inputToken.address,
                    bridgePercentageFee,
                    [
                        ethers.utils.hexZeroPad(
                            inputToken.address.toLowerCase(),
                            32
                        ),
                        ethers.utils.hexZeroPad(
                            inputToken.address.toLowerCase(),
                            32
                        ),
                    ], // path from intermediary to input on source chain
                    [intermediaryTokenAmount, requestAmountOfInputToken]
                )
            )
                .to.emit(PolyConnector, "WithdrewFundsToSourceChainUniversal")
                .withArgs(
                    0, // uniqueCounter
                    1, // chainId
                    inputToken.address,
                    requestAmount,
                    bridgePercentageFee,
                    ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32), // refundAddress
                    [
                        ethers.utils.hexZeroPad(
                            inputToken.address.toLowerCase(),
                            32
                        ),
                        ethers.utils.hexZeroPad(
                            inputToken.address.toLowerCase(),
                            32
                        ),
                    ], // path from intermediary to input on source chain
                    [intermediaryTokenAmount, requestAmountOfInputToken] // amounts from intermediary to input on source chain
                );
        });

        it("handles swapBackAndRefundBTC message and refunds user with BTC", async () => {
            const protocolFee = Math.floor(
                (telebtcAmount * PROTOCOL_PERCENTAGE_FEE) / 10000
            );
            const lockerFee = Math.floor(
                (telebtcAmount * LOCKER_PERCENTAGE_FEE) / 10000
            );
            const burntAmount =
                telebtcAmount - BITCOIN_FEE - protocolFee - lockerFee;

            // Set up mocks for successful swap and unwrap
            await setLockersBurnReturn(burntAmount);

            // Transfer tokens to PolyConnector (simulating tokens received from Across)
            await inputToken.transfer(PolyConnector.address, requestAmount);

            const uniqueCounter = await calculateTxId(
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.version,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vin,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vout,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.locktime
            );

            // Encode the swapBackAndRefundBTC message with all required parameters
            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "bytes32",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapBackAndRefundBTC",
                    uniqueCounter, // uniqueCounter (bitcoinTxId)
                    1, // chainId
                    ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32), // refundAddress
                    mockExchangeConnector.address, // exchangeConnector
                    burntAmount, // outputAmount (expected TeleBTC amount to burn)
                    true, // isInputFixed
                    [inputToken.address, teleBTC.address], // path
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0, // thirdParty
                ]
            );

            await expect(
                PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    message
                )
            )
                .to.emit(PolyConnector, "NewSwapAndUnwrapUniversal")
                .withArgs(
                    uniqueCounter, // uniqueCounter
                    1, // chainId
                    mockExchangeConnector.address, // exchangeConnector
                    inputToken.address, // inputToken
                    requestAmount, // inputAmount
                    ethers.utils.hexZeroPad(signer1Address.toLowerCase(), 32), // userTargetAddress
                    USER_SCRIPT_P2PKH, // userScript
                    USER_SCRIPT_P2PKH_TYPE, // scriptType
                    LOCKER_TARGET_ADDRESS, // lockerTargetAddress
                    0, // requestIdOfLocker (burnRequestCounter - 1, which is 0 in this case)
                    [inputToken.address, teleBTC.address], // path
                    0 // thirdPartyId
                );
        });

        it("handles swapBackAndRefundBTC failure then admin retry succeeds", async () => {
            const protocolFee = Math.floor(
                (telebtcAmount * PROTOCOL_PERCENTAGE_FEE) / 10000
            );
            const burntAmount = telebtcAmount - BITCOIN_FEE - protocolFee;

            await setLockersBurnReturn(burntAmount);

            // Transfer tokens to PolyConnector (simulating tokens received from Across)
            await inputToken.transfer(PolyConnector.address, requestAmount);

            const uniqueCounter = await calculateTxId(
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.version,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vin,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vout,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.locktime
            );

            const refundAddress = ethers.utils.hexZeroPad(
                signer1Address.toLowerCase(),
                32
            );

            // Encode the swapBackAndRefundBTC message with all required parameters
            const message = abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "bytes32",
                    "address",
                    "uint",
                    "bool",
                    "address[]",
                    {
                        UserAndLockerScript: {
                            userScript: "bytes",
                            scriptType: "uint",
                            lockerLockingScript: "bytes",
                        },
                    },
                    "uint",
                ],
                [
                    "swapBackAndRefundBTC",
                    uniqueCounter, // uniqueCounter (bitcoinTxId)
                    1, // chainId
                    refundAddress, // refundAddress
                    mockExchangeConnector.address, // exchangeConnector
                    burntAmount, // outputAmount (expected TeleBTC amount to burn)
                    true, // isInputFixed
                    [inputToken.address, teleBTC.address], // path
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0, // thirdParty
                ]
            );

            // First attempt: swap fails
            await expect(
                PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
                    inputToken.address,
                    requestAmount,
                    signer1Address,
                    message
                )
            )
                .to.emit(PolyConnector, "FailedSwapAndUnwrapUniversal")
                .withArgs(
                    uniqueCounter, // uniqueCounter
                    1, // chainId
                    mockExchangeConnector.address, // exchangeConnector
                    inputToken.address, // inputToken
                    requestAmount, // inputAmount
                    refundAddress, // userTargetAddress
                    USER_SCRIPT_P2PKH, // userScript
                    USER_SCRIPT_P2PKH_TYPE, // scriptType
                    [inputToken.address, teleBTC.address], // path
                    0 // thirdPartyId
                );

            // Verify tokens are still in the contract (saved for admin retry)
            const tokenBalance = await inputToken.balanceOf(
                PolyConnector.address
            );
            expect(tokenBalance).to.equal(requestAmount);

            // Set currChainId to 1 (to match the chainId in the message)
            // This is needed for the admin function to find the failed request
            await PolyConnector.setCurrChainId(1);

            // Verify the failed request is stored correctly
            // Note: The contract stores uniqueCounter as bytes32, so we need to check with bytes32
            const storedAmount = await PolyConnector.newFailedRefundBTCReqs(
                refundAddress,
                1, // chainId
                uniqueCounter, // bitcoinTxId (bytes32)
                inputToken.address
            );
            expect(storedAmount).to.equal(requestAmount);

            // set up mocks for successful swap (admin retry)
            const lockerFee = Math.floor(
                (telebtcAmount * LOCKER_PERCENTAGE_FEE) / 10000
            );
            const correctBurntAmount =
                telebtcAmount - BITCOIN_FEE - protocolFee - lockerFee;

            await setLockersBurnReturn(correctBurntAmount);

            const teleBTCBalance = await teleBTC.balanceOf(burnRouter.address);
            if (teleBTCBalance.lt(telebtcAmount)) {
                await TeleBTCSigner1.transfer(
                    burnRouter.address,
                    telebtcAmount
                );
            }

            // Admin retries the swap
            await expect(
                PolyConnector.connect(deployer).swapBackAndRefundBTCByAdmin(
                    uniqueCounter, // _bitcoinTxId
                    inputToken.address, // _token (intermediary token)
                    refundAddress, // _refundAddress
                    mockExchangeConnector.address, // _exchangeConnector
                    correctBurntAmount, // _minOutputAmount (use correct amount with lockerFee)
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    }, // _userAndLockerScript
                    [inputToken.address, teleBTC.address], // _path
                    [requestAmount, telebtcAmount], // _amounts
                    { gasLimit: 5000000 } // Increase gas limit to ensure enough gas for storage operations. Note: without this, the transaction will revert silently.
                )
            )
                .to.emit(PolyConnector, "NewSwapAndUnwrapUniversal")
                .withArgs(
                    uniqueCounter, // uniqueCounter
                    1, // chainId
                    mockExchangeConnector.address, // exchangeConnector
                    inputToken.address, // inputToken
                    requestAmount, // inputAmount
                    refundAddress, // userTargetAddress
                    USER_SCRIPT_P2PKH, // userScript
                    USER_SCRIPT_P2PKH_TYPE, // scriptType
                    LOCKER_TARGET_ADDRESS, // lockerTargetAddress
                    0, // requestIdOfLocker (burnRequestCounter - 1)
                    [inputToken.address, teleBTC.address], // path
                    0 // thirdPartyId
                );
        });
    });
});
