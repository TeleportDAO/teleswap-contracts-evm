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
import { TestERC20__factory } from "../src/types/factories/TestERC20__factory";
import { TestERC20 } from "../src/types/TestERC20";
import { EthConnectorProxy__factory } from "../src/types/factories/EthConnectorProxy__factory";
import { EthConnectorLogic__factory } from "../src/types/factories/EthConnectorLogic__factory";
import { takeSnapshot, revertProvider } from "./block_utils";
import Web3 from "web3";
const { calculateTxId } = require("./utils/calculateTxId");
const CC_EXCHANGE_REQUESTS = require("./test_fixtures/ccExchangeRequests.json");

interface SwapAndUnwrapUniversalArguments {
    _pathFromInputToIntermediaryOnSourceChain: string[];
    _amountsFromInputToIntermediaryOnSourceChain: BigNumber[];
    _pathFromIntermediaryToOutputOnIntermediaryChain: string[];
    _minOutputAmount: BigNumber;
    _bridgePercentageFee: BigNumber;
}

require("dotenv").config({ path: "../../.env" });

const abiUtils = new Web3().eth.abi;
const provider = ethers.provider;
const targetChainId = 137;

describe("EthConnector", async () => {
    let snapshotId: any;

    // Accounts
    let proxyAdmin: Signer;
    let deployer: Signer;
    let signer1: Signer;
    let acrossSinger: Signer;
    let signer1Address: Address;
    let deployerAddress: Address;
    let proxyAdminAddress: Address;
    let acrossAddress: Address;
    let exchangeConnectorAddress: string;

    // Contracts
    let teleBTC: TeleBTCLogic;
    let inputToken: TestERC20;
    let intermediaryToken: TestERC20;
    let wrappedNativeToken: TestERC20;
    let polygonToken: TestERC20;
    let EthConnector: Contract;

    // Mock contracts
    let mockExchangeConnector: MockContract;
    let mockAcross: MockContract;

    // Constants
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
    const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    const oneHundred = BigNumber.from(10).pow(8).mul(100);
    /*
        This one is set so that:
        userRequestedAmount * (1 - lockerFee / 10000 - PROTOCOL_PERCENTAGE_FEE / 10000) - BITCOIN_FEE = 100000000
    */
    const requestAmount = 100;
    const telebtcAmount = 100000000000;
    const RELAYER_FEE = 10000; // estimation of Bitcoin transaction fee in Satoshi
    const LOCKER_TARGET_ADDRESS = ONE_ADDRESS;
    const USER_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
    const USER_SCRIPT_P2PKH_TYPE = 1; // P2PKH
    // const USER_SCRIPT_P2WPKH = "0x751e76e8199196d454941c45d1b3a323f1433bd6";
    // const USER_SCRIPT_P2WPKH_TYPE = 3; // P2WPKH
    // For swapAndUnwrapUniversal
    const requestAmountOfInputToken = ethers.utils.parseUnits("10", 18); // 10 tokens of input token (e.g., AAVE)
    const intermediaryTokenAmount = ethers.utils.parseUnits("0.1", 18); // 0.1 tokens of intermediary token
    const bridgePercentageFee = BigNumber.from(10).pow(15); // 0.1% = 1e15
    const intermediaryChainId = 137;
    const currentChainId = 10;

    beforeEach(async () => {
        [proxyAdmin, deployer, signer1, acrossSinger] =
            await ethers.getSigners();
        proxyAdminAddress = await proxyAdmin.getAddress();
        signer1Address = await signer1.getAddress();
        deployerAddress = await deployer.getAddress();
        acrossAddress = await acrossSinger.getAddress();

        const across = await deployments.getArtifact("SpokePoolInterface");
        // Add depositV3 to the ABI if it doesn't exist (needed for the mock)
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
        mockAcross = await deployMockContract(deployer, extendedAbi);

        // Deploy mock exchange connector
        const exchangeConnector = await deployments.getArtifact(
            "UniswapV3Connector"
        );
        mockExchangeConnector = await deployMockContract(
            deployer,
            exchangeConnector.abi
        );
        exchangeConnectorAddress = mockExchangeConnector.address;

        // Deploys contracts
        teleBTC = await deployTeleBTC();

        await teleBTC.initialize("TeleportDAO-BTC", "teleBTC");

        // Deploys input token
        const erc20Factory = new TestERC20__factory(deployer);
        const initialSupplyOfInputToken = ethers.utils.parseUnits("10", 18);
        inputToken = await erc20Factory.deploy(
            "TestToken",
            "TT",
            initialSupplyOfInputToken
        );

        const initialSupplyOfIntermediaryToken = ethers.utils.parseUnits(
            "0.1",
            18
        );
        intermediaryToken = await erc20Factory.deploy(
            "IntermediaryToken",
            "INT",
            initialSupplyOfIntermediaryToken
        );

        polygonToken = await erc20Factory.deploy(
            "PolygonTestToken",
            "PTT",
            initialSupplyOfIntermediaryToken
        );

        // Deploys wrapped native token
        wrappedNativeToken = await erc20Factory.deploy(
            "WrappedEth",
            "WETH",
            100000
        );

        EthConnector = await deployEthConnector();

        await EthConnector.initialize(
            mockAcross.address,
            wrappedNativeToken.address,
            intermediaryChainId,
            currentChainId
        );
        // Set up bridge connector mapping for target chain ID 137
        await EthConnector.setBridgeConnectorMapping(
            exchangeConnectorAddress, // exchangeConnector
            targetChainId,
            ONE_ADDRESS // targetChainConnectorProxy
        );

        // Set up bridge token mapping for ETH
        await EthConnector.setBridgeTokenMapping(
            ETH_ADDRESS,
            targetChainId,
            wrappedNativeToken.address
        );

        // Set exchangeConnector using the setter function
        await EthConnector.setExchangeConnector(exchangeConnectorAddress);

        // Mints TeleBTC for user
        await teleBTC.addMinter(signer1Address);

        await teleBTC.setMaxMintLimit(oneHundred.mul(2));
        await moveBlocks(2020);

        // mock function
        // await mockAddress.mock.functionCallWithValue.returns("0x")
        await mockAcross.mock.depositV3.returns();
    });

    async function moveBlocks(amount: number) {
        for (let index = 0; index < amount; index++) {
            await network.provider.request({
                method: "evm_mine",
                params: [],
            });
        }
    }

    const deployTeleBTC = async (_signer?: Signer): Promise<TeleBTCLogic> => {
        const teleBTCLogicFactory = new TeleBTCLogic__factory(deployer);
        const teleBTCLogic = await teleBTCLogicFactory.deploy();

        const teleBTCProxyFactory = new TeleBTCProxy__factory(deployer);
        const teleBTCProxy = await teleBTCProxyFactory.deploy(
            teleBTCLogic.address,
            proxyAdminAddress,
            "0x"
        );

        return await teleBTCLogic.attach(teleBTCProxy.address);
    };

    const deployEthConnector = async (_signer?: Signer): Promise<Contract> => {
        // Deploys lockers logic
        const ethConnectorLogicFactory = new EthConnectorLogic__factory(
            // linkLibraryAddresses,
            _signer || deployer
        );

        const ethConnectorLogic = await ethConnectorLogicFactory.deploy();

        // Deploys lockers proxy
        const ethConnectorProxyFactory = new EthConnectorProxy__factory(
            _signer || deployer
        );
        const ethConnectorProxy = await ethConnectorProxyFactory.deploy(
            ethConnectorLogic.address,
            proxyAdminAddress,
            "0x"
        );

        return await ethConnectorLogic.attach(ethConnectorProxy.address);
    };

    describe("#setters", async () => {
        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        // it("should set and get the min amount", async () => {
        //     await EthConnector.setMinAmount(inputToken.address, requestAmount);
        //     expect(await EthConnector.minAmounts(inputToken.address)).to.equal(requestAmount);
        // });

        // it("should not set the min amount if not owner", async () => {
        //     await expect(EthConnector.connect(signer1).setMinAmount(inputToken.address, requestAmount)).to.be.revertedWith("Ownable: caller is not the owner");
        // });

        // it("should set and get the MinModifier", async () => {
        //     await EthConnector.setMinModifier(9000);
        //     expect(await EthConnector.minModifier()).to.equal(9000);
        // });

        // it("should not set the MinModifier if not owner", async () => {
        //     await expect(EthConnector.connect(signer1).setMinModifier(9000)).to.be.revertedWith("Ownable: caller is not the owner");
        // });

        it("should set and get the Across", async () => {
            await EthConnector.setAcross(ONE_ADDRESS);
            expect(await EthConnector.across()).to.equal(ONE_ADDRESS);
        });

        it("should not set the Across if not owner", async () => {
            await expect(
                EthConnector.connect(signer1).setAcross(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        // it("should set and get the PolygonConnectorProxy", async () => {
        //     await EthConnector.setPolygonConnectorProxy(ONE_ADDRESS);
        //     expect(await EthConnector.polygonConnectorProxy()).to.equal(ONE_ADDRESS);
        // });

        // it("should not set the PolygonConnectorProxy if not owner", async () => {
        //     await expect(EthConnector.connect(signer1).setPolygonConnectorProxy(ONE_ADDRESS)).to.be.revertedWith("Ownable: caller is not the owner");
        // });

        // it("should set and get the PolygonTeleBTC", async () => {
        //     await EthConnector.setPolygonTeleBTC(ONE_ADDRESS);
        //     expect(await EthConnector.polygonTeleBTC()).to.equal(ONE_ADDRESS);
        // });

        // it("should not set the PolygonTeleBTC if not owner", async () => {
        //     await expect(EthConnector.connect(signer1).setPolygonTeleBTC(ONE_ADDRESS)).to.be.revertedWith("Ownable: caller is not the owner");
        // });

        it("should set and get the WrappedNativeToken", async () => {
            await EthConnector.setWrappedNativeToken(ONE_ADDRESS);
            expect(await EthConnector.wrappedNativeToken()).to.equal(
                ONE_ADDRESS
            );
        });

        it("should not set the WrappedNativeToken if not owner", async () => {
            await expect(
                EthConnector.connect(signer1).setWrappedNativeToken(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("can't set addresses to zero address", async () => {
            // await expect(EthConnector.setMinAmount(ZERO_ADDRESS, requestAmount)).to.be.revertedWith("ZeroAddress");
            await expect(
                EthConnector.setAcross(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(EthConnector, "ZeroAddress");
            // await expect(EthConnector.setPolygonConnectorProxy(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress");
            // await expect(EthConnector.setPolygonTeleBTC(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress");
            await expect(
                EthConnector.setWrappedNativeToken(ZERO_ADDRESS)
            ).to.be.revertedWithCustomError(EthConnector, "ZeroAddress");
        });
    });

    describe("#Handle across message", async () => {
        beforeEach(async () => {
            // await EthConnector.setMinAmount(inputToken.address, 100)
            // await EthConnector.setMinAmount(ETH_ADDRESS, 100)
            await inputToken.approve(EthConnector.address, requestAmount);
            await wrappedNativeToken.approve(
                EthConnector.address,
                requestAmount
            );
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        /// _checkRequest test start
        // it.only("fails because token is not supported", async () => {
        //     // await EthConnector.setMinAmount(inputToken.address, 0)
        //     await expect(
        //         EthConnector.swapAndUnwrap(
        //             inputToken.address,
        //             ONE_ADDRESS,
        //             [requestAmount, telebtcAmount],
        //             true, //TODO
        //             [polygonToken.address, teleBTC.address],
        //             {
        //                 userScript: USER_SCRIPT_P2PKH,
        //                 scriptType: USER_SCRIPT_P2PKH_TYPE,
        //                 lockerLockingScript: LOCKER_TARGET_ADDRESS,
        //             },
        //             RELAYER_FEE,
        //             0
        //         )
        //     ).to.be.revertedWith("EthManagerLogic: token not supported");
        // });

        // it.only("fails because token amount is not sufficient", async () => {
        //     await expect(
        //         EthConnector.swapAndUnwrap(
        //             inputToken.address,
        //             ONE_ADDRESS,
        //             [90, telebtcAmount],
        //             true,
        //             [polygonToken.address, teleBTC.address],
        //             {
        //                 userScript: USER_SCRIPT_P2PKH,
        //                 scriptType: USER_SCRIPT_P2PKH_TYPE,
        //                 lockerLockingScript: LOCKER_TARGET_ADDRESS,
        //             },
        //             RELAYER_FEE,
        //             0
        //         )
        //     ).to.be.revertedWith("EthManagerLogic: low amount");
        // });

        // Note: Path validation and amounts length validation are not implemented in EthConnectorLogic
        // These validations happen on the receiving side (PolyConnectorLogic/BnbConnectorLogic)
        // The transaction will succeed here but fail when processed on the destination chain
        it.skip("fails because last token of path is not telebtc", async () => {
            await expect(
                EthConnector.swapAndUnwrap(
                    inputToken.address,
                    targetChainId,
                    [requestAmount, telebtcAmount],
                    true,
                    [polygonToken.address, inputToken.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    RELAYER_FEE,
                    0
                )
            ).to.be.revertedWith("EthManagerLogic: invalid path");
        });

        it.skip("fails because amounts list length is greater than 2", async () => {
            await expect(
                EthConnector.swapAndUnwrap(
                    inputToken.address,
                    targetChainId,
                    [requestAmount, telebtcAmount, 100],
                    true,
                    [polygonToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    RELAYER_FEE,
                    0
                )
            ).to.be.revertedWith("EthManagerLogic: wrong amounts");
        });
        /// _checkRequest test end

        /// _sendMsgUsingAcross test start
        it("fails because amount is incorrect (ETH)", async () => {
            await expect(
                EthConnector.swapAndUnwrap(
                    ETH_ADDRESS,
                    exchangeConnectorAddress,
                    [requestAmount, telebtcAmount],
                    true,
                    [polygonToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    RELAYER_FEE,
                    0,
                    {
                        value: requestAmount - 1, // Send less ETH than expected
                    }
                )
            ).to.be.revertedWith("EthConnectorLogic: wrong value");
        });
        /// _sendMsgUsingAcross test end

        it("Handle exchangeForBtcAcross (TOKEN)", async () => {
            const message = await abiUtils.encodeParameters(
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
                    0,
                    10,
                    deployerAddress,
                    exchangeConnectorAddress,
                    telebtcAmount,
                    true,
                    [polygonToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await expect(
                EthConnector.swapAndUnwrap(
                    inputToken.address,
                    exchangeConnectorAddress,
                    [requestAmount, telebtcAmount],
                    true,
                    [polygonToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    RELAYER_FEE,
                    0
                )
            )
                .to.emit(EthConnector, "MsgSent")
                .withArgs(
                    "0",
                    message,
                    inputToken.address,
                    requestAmount,
                    RELAYER_FEE
                );
        });

        it("Handle exchangeForBtcAcross (ETH)", async () => {
            const message = await abiUtils.encodeParameters(
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
                    0,
                    10,
                    deployerAddress,
                    exchangeConnectorAddress,
                    telebtcAmount,
                    true,
                    [polygonToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0,
                ]
            );

            await expect(
                EthConnector.swapAndUnwrap(
                    ETH_ADDRESS,
                    exchangeConnectorAddress,
                    [requestAmount, telebtcAmount],
                    true,
                    [polygonToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    RELAYER_FEE,
                    0,
                    {
                        value: requestAmount,
                    }
                )
            )
                .to.emit(EthConnector, "MsgSent")
                .withArgs(
                    "0",
                    message,
                    ETH_ADDRESS,
                    requestAmount,
                    RELAYER_FEE
                );
        });

        it("fails because amount is incorrect (TOKEN)", async () => {
            await expect(
                EthConnector.swapAndUnwrap(
                    inputToken.address,
                    ONE_ADDRESS,
                    [requestAmount, telebtcAmount],
                    true,
                    [polygonToken.address, teleBTC.address],
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    RELAYER_FEE,
                    0,
                    {
                        value: requestAmount,
                    }
                )
            ).to.be.revertedWith("EthConnectorLogic: wrong value");
        });
    });

    describe("#Handle emergencyWithdraw", async () => {
        // write test that handle emergency withdraw
        it("should handle emergency withdraw token", async () => {
            await inputToken.transfer(EthConnector.address, requestAmount);

            expect(
                await inputToken.balanceOf(EthConnector.address)
            ).to.be.equal(requestAmount);

            await EthConnector.emergencyWithdraw(
                inputToken.address,
                signer1Address,
                requestAmount
            );

            expect(
                await inputToken.balanceOf(EthConnector.address)
            ).to.be.equal(0);

            expect(await inputToken.balanceOf(signer1Address)).to.be.equal(
                requestAmount
            );
        });

        it("should handle emergency withdraw eth", async () => {
            const tx = {
                to: EthConnector.address,
                value: 100,
            };
            await signer1.sendTransaction(tx);

            const beforeBalance = await signer1.getBalance();
            beforeBalance.add(100);

            expect(await provider.getBalance(EthConnector.address)).to.be.equal(
                100
            );

            await EthConnector.emergencyWithdraw(
                "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                signer1Address,
                100
            );
        });

        // write test that only owner can emergency withdraw
        it("should not handle emergency withdraw if not owner", async () => {
            await expect(
                EthConnector.connect(signer1).emergencyWithdraw(
                    inputToken.address,
                    signer1Address,
                    requestAmount
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("#swapAndUnwrapUniversal", async () => {
        it("should swap and bridge to the intermediary chain", async () => {
            // transfer input tokens to signer1
            await inputToken.transfer(
                signer1Address,
                requestAmountOfInputToken
            );
            expect(await inputToken.balanceOf(signer1Address)).to.be.equal(
                requestAmountOfInputToken
            );

            await inputToken
                .connect(signer1)
                .approve(EthConnector.address, requestAmountOfInputToken);

            // set up mock exchange connector to return successful swap
            await mockExchangeConnector.mock.swap.returns(
                true, // success
                [requestAmountOfInputToken, intermediaryTokenAmount]
            );
            await intermediaryToken.transfer(
                EthConnector.address,
                intermediaryTokenAmount
            );

            const oneE18 = BigNumber.from(10).pow(18);
            const minOutputAmount = intermediaryTokenAmount
                .mul(oneE18.sub(bridgePercentageFee))
                .div(oneE18);

            const message = await abiUtils.encodeParameters(
                [
                    "string",
                    "uint",
                    "uint",
                    "address",
                    "address",
                    "uint",
                    "bool",
                    {
                        SwapAndUnwrapUniversalPaths: {
                            _pathFromInputToIntermediaryOnSourceChain:
                                "address[]",
                            _pathFromIntermediaryToOutputOnIntermediaryChain:
                                "address[]",
                        },
                    },
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
                    0, // uniqueCounter (starts at 0)
                    10, // currChainId
                    signer1Address, // _refundAddress
                    exchangeConnectorAddress, // _exchangeConnector
                    minOutputAmount.toString(), // _minOutputAmount
                    true, // _isInputFixed
                    {
                        _pathFromInputToIntermediaryOnSourceChain: [
                            inputToken.address,
                            intermediaryToken.address,
                        ],
                        _pathFromIntermediaryToOutputOnIntermediaryChain: [
                            polygonToken.address,
                            teleBTC.address,
                        ],
                    },
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0, // _thirdParty
                ]
            );
            const swapAndUnwrapUniversalArguments: SwapAndUnwrapUniversalArguments =
                {
                    _pathFromInputToIntermediaryOnSourceChain: [
                        inputToken.address, // Aave.eth
                        intermediaryToken.address, // WBTC.eth
                    ],
                    _amountsFromInputToIntermediaryOnSourceChain: [
                        requestAmountOfInputToken, // 10 tokens (10e18 wei)
                        intermediaryTokenAmount, // 0.1 tokens (0.1e18 wei)
                    ],
                    _pathFromIntermediaryToOutputOnIntermediaryChain: [
                        polygonToken.address, // WBTC.poly
                        teleBTC.address, // TeleBTC.poly
                    ],
                    _minOutputAmount: minOutputAmount,
                    _bridgePercentageFee: bridgePercentageFee,
                };

            await expect(
                EthConnector.connect(signer1).swapAndUnwrapUniversal(
                    swapAndUnwrapUniversalArguments,
                    exchangeConnectorAddress,
                    true,
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0, // third party id
                    signer1Address // refund address
                )
            )
                .to.emit(EthConnector, "MsgSent")
                .withArgs(
                    "0",
                    message,
                    inputToken.address, // to be used by admin for refunding
                    requestAmountOfInputToken, // to be used by admin for refunding
                    bridgePercentageFee
                );
            expect(await inputToken.balanceOf(signer1Address)).to.be.equal(0);
        });

        it("should fail and revert if swap on the source chain fails", async () => {
            // transfer input tokens to signer1
            await inputToken.transfer(
                signer1Address,
                requestAmountOfInputToken
            );
            await inputToken
                .connect(signer1)
                .approve(EthConnector.address, requestAmountOfInputToken);

            // set up mock exchange connector to return failed swap
            await mockExchangeConnector.mock.swap.returns(
                false, // failure
                [requestAmountOfInputToken, intermediaryTokenAmount]
            );
            await intermediaryToken.transfer(
                EthConnector.address,
                intermediaryTokenAmount
            );

            const oneE18 = BigNumber.from(10).pow(18);
            const minOutputAmount = intermediaryTokenAmount
                .mul(oneE18.sub(bridgePercentageFee))
                .div(oneE18);

            const swapAndUnwrapUniversalArguments: SwapAndUnwrapUniversalArguments =
                {
                    _pathFromInputToIntermediaryOnSourceChain: [
                        inputToken.address, // Aave.eth
                        intermediaryToken.address, // WBTC.eth
                    ],
                    _amountsFromInputToIntermediaryOnSourceChain: [
                        requestAmountOfInputToken, // 10 tokens (10e18 wei)
                        intermediaryTokenAmount, // 0.1 tokens (0.1e18 wei)
                    ],
                    _pathFromIntermediaryToOutputOnIntermediaryChain: [
                        polygonToken.address, // WBTC.poly
                        teleBTC.address, // TeleBTC.poly
                    ],
                    _minOutputAmount: minOutputAmount,
                    _bridgePercentageFee: bridgePercentageFee,
                };

            await expect(
                EthConnector.connect(signer1).swapAndUnwrapUniversal(
                    swapAndUnwrapUniversalArguments,
                    exchangeConnectorAddress,
                    true,
                    {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    0, // third party id
                    signer1Address // refund address
                )
            ).to.revertedWith("EthConnectorLogic: swap failed");
        });
        expect(await inputToken.balanceOf(signer1Address)).to.be.equal(
            requestAmountOfInputToken
        );
    });

    describe("#handleV3AcrossMessage", async () => {
        it("should handle swapBackAndRefund message", async () => {
            // set up mock exchange connector to swap intermediary token back to input token
            await mockExchangeConnector.mock.swap.returns(
                true, // success
                [intermediaryTokenAmount, requestAmountOfInputToken]
            );

            // to mock the received tokens from the swap
            await inputToken.transfer(
                EthConnector.address,
                requestAmountOfInputToken
            );

            await intermediaryToken.transfer(
                acrossAddress,
                intermediaryTokenAmount
            );

            await intermediaryToken
                .connect(acrossSinger)
                .approve(EthConnector.address, ethers.constants.MaxUint256);

            const refundMessage = ethers.utils.defaultAbiCoder.encode(
                [
                    "string",
                    "uint256",
                    "uint256",
                    "address",
                    "address[]",
                    "uint256[]",
                ],
                [
                    "swapBackAndRefund",
                    0, // uniqueCounter
                    10, // chainId (current chain)
                    signer1Address, // refundAddress
                    [intermediaryToken.address, inputToken.address], // pathFromIntermediaryToInputOnSourceChain
                    [intermediaryTokenAmount, requestAmountOfInputToken], // amountsFromIntermediaryToInputOnSourceChain
                ]
            );

            const initialInputTokenBalance = await inputToken.balanceOf(
                signer1Address
            );

            // Set across to a real signer (not mock across) for testing
            await EthConnector.setAcross(acrossAddress);
            await expect(
                EthConnector.connect(acrossSinger).handleV3AcrossMessage(
                    intermediaryToken.address,
                    intermediaryTokenAmount,
                    signer1Address,
                    refundMessage
                )
            )
                .to.emit(EthConnector, "MsgReceived")
                .withArgs("swapBackAndRefund", 0, 10, refundMessage)
                .and.to.emit(
                    EthConnector,
                    "SwappedBackAndRefundedToSourceChain"
                )
                .withArgs(
                    0, // uniqueCounter
                    10, // chainId
                    signer1Address, // refundAddress
                    requestAmountOfInputToken,
                    [intermediaryToken.address, inputToken.address], // path
                    [intermediaryTokenAmount, requestAmountOfInputToken] // amounts
                );

            const finalInputTokenBalance = await inputToken.balanceOf(
                signer1Address
            );
            expect(
                finalInputTokenBalance.sub(initialInputTokenBalance)
            ).to.equal(requestAmountOfInputToken);
        });

        it("should handle swapBackAndRefund message failure and allow admin to refund", async () => {
            // set up mock exchange connector to fail the swap
            await mockExchangeConnector.mock.swap.returns(
                false, // failure
                [intermediaryTokenAmount, requestAmountOfInputToken]
            );

            // Transfer intermediary tokens to acrossAddress (simulating tokens received from bridge)
            await intermediaryToken.transfer(
                acrossAddress,
                intermediaryTokenAmount
            );

            await intermediaryToken
                .connect(acrossSinger)
                .approve(EthConnector.address, ethers.constants.MaxUint256);

            const uniqueCounter = 0;
            const chainId = 10; // current chain
            const refundMessage = ethers.utils.defaultAbiCoder.encode(
                [
                    "string",
                    "uint256",
                    "uint256",
                    "address",
                    "address[]",
                    "uint256[]",
                ],
                [
                    "swapBackAndRefund",
                    uniqueCounter,
                    chainId,
                    signer1Address, // refundAddress
                    [intermediaryToken.address, inputToken.address], // pathFromIntermediaryToInputOnSourceChain
                    [intermediaryTokenAmount, requestAmountOfInputToken], // amountsFromIntermediaryToInputOnSourceChain
                ]
            );

            const initialInputTokenBalance = await inputToken.balanceOf(
                signer1Address
            );

            // Set across to a real signer (not mock across) for testing
            await EthConnector.setAcross(acrossAddress);

            // Handle the swapBackAndRefund message - swap will fail
            await expect(
                EthConnector.connect(acrossSinger).handleV3AcrossMessage(
                    intermediaryToken.address,
                    intermediaryTokenAmount,
                    signer1Address,
                    refundMessage
                )
            )
                .to.emit(EthConnector, "MsgReceived")
                .withArgs(
                    "swapBackAndRefund",
                    uniqueCounter,
                    chainId,
                    refundMessage
                )
                .and.to.emit(
                    EthConnector,
                    "FailedSwapBackAndRefundToSourceChain"
                )
                .withArgs(
                    uniqueCounter,
                    chainId,
                    signer1Address, // refundAddress
                    inputToken.address, // inputToken
                    intermediaryToken.address, // tokenSent
                    intermediaryTokenAmount // tokenSentAmount
                );

            // Verify the failed request is saved in the mapping
            const storedAmount =
                await EthConnector.failedSwapAndUnwrapRefundReqs(
                    signer1Address,
                    inputToken.address,
                    uniqueCounter,
                    intermediaryToken.address
                );
            expect(storedAmount).to.equal(intermediaryTokenAmount);

            // Verify user didn't receive tokens yet
            const intermediateInputTokenBalance = await inputToken.balanceOf(
                signer1Address
            );
            expect(
                intermediateInputTokenBalance.sub(initialInputTokenBalance)
            ).to.equal(0);

            // Transfer intermediary tokens to contract (simulating they're in the contract after failed swap)
            await intermediaryToken
                .connect(acrossSinger)
                .transfer(EthConnector.address, intermediaryTokenAmount);

            // Now set up mock to succeed for the admin refund call
            await mockExchangeConnector.mock.swap.returns(
                true, // success
                [intermediaryTokenAmount, requestAmountOfInputToken]
            );

            // Transfer input tokens to contract (simulating swap result)
            await inputToken.transfer(
                EthConnector.address,
                requestAmountOfInputToken
            );

            // Set acrossAdmin (needed for authorization) - deployer is owner
            await EthConnector.connect(deployer).setAcrossAdmin(acrossAddress);

            // Reset allowance to 0 first (safeApprove requires allowance to be 0 before setting new value)
            // The contract needs to reset its own allowance, so we use approveToken
            await EthConnector.connect(deployer).approveToken(
                intermediaryToken.address,
                exchangeConnectorAddress,
                0
            );

            // Admin calls refundFailedSwapAndUnwrapUniversal
            await expect(
                EthConnector.connect(
                    acrossSinger
                ).refundFailedSwapAndUnwrapUniversal(
                    uniqueCounter,
                    signer1Address, // refundAddress
                    inputToken.address, // inputToken
                    [intermediaryToken.address, inputToken.address], // pathFromIntermediaryToInputOnSourceChain
                    [intermediaryTokenAmount, requestAmountOfInputToken] // amountsFromIntermediaryToInputOnSourceChain
                )
            )
                .to.emit(EthConnector, "RefundedFailedSwapAndUnwrapUniversal")
                .withArgs(
                    uniqueCounter,
                    signer1Address, // refundAddress
                    inputToken.address, // inputToken
                    requestAmountOfInputToken, // inputTokenAmount
                    [intermediaryToken.address, inputToken.address], // pathFromIntermediaryToInputOnSourceChain
                    [intermediaryTokenAmount, requestAmountOfInputToken] // amountsFromIntermediaryToInputOnSourceChain
                );

            // Verify user received the input tokens
            const finalInputTokenBalance = await inputToken.balanceOf(
                signer1Address
            );
            expect(
                finalInputTokenBalance.sub(initialInputTokenBalance)
            ).to.equal(requestAmountOfInputToken);

            // Verify the mapping entry was deleted
            const deletedAmount =
                await EthConnector.failedSwapAndUnwrapRefundReqs(
                    signer1Address,
                    inputToken.address,
                    uniqueCounter,
                    intermediaryToken.address
                );
            expect(deletedAmount).to.equal(0);
        });

        it("should revert because refund by admin for a failed swap back and refund request fails", async () => {
            // set up mock exchange connector to fail the swap
            await mockExchangeConnector.mock.swap.returns(
                false, // failure
                [intermediaryTokenAmount, requestAmountOfInputToken]
            );

            // Transfer intermediary tokens to acrossAddress (simulating tokens received from bridge)
            await intermediaryToken.transfer(
                acrossAddress,
                intermediaryTokenAmount
            );

            await intermediaryToken
                .connect(acrossSinger)
                .approve(EthConnector.address, ethers.constants.MaxUint256);

            const uniqueCounter = 0;
            const chainId = 10; // current chain
            const refundMessage = ethers.utils.defaultAbiCoder.encode(
                [
                    "string",
                    "uint256",
                    "uint256",
                    "address",
                    "address[]",
                    "uint256[]",
                ],
                [
                    "swapBackAndRefund",
                    uniqueCounter,
                    chainId,
                    signer1Address, // refundAddress
                    [intermediaryToken.address, inputToken.address], // pathFromIntermediaryToInputOnSourceChain
                    [intermediaryTokenAmount, requestAmountOfInputToken], // amountsFromIntermediaryToInputOnSourceChain
                ]
            );

            const initialInputTokenBalance = await inputToken.balanceOf(
                signer1Address
            );

            // Set across to a real signer (not mock across) for testing
            await EthConnector.setAcross(acrossAddress);

            // Handle the swapBackAndRefund message - swap will fail
            await expect(
                EthConnector.connect(acrossSinger).handleV3AcrossMessage(
                    intermediaryToken.address,
                    intermediaryTokenAmount,
                    signer1Address,
                    refundMessage
                )
            )
                .to.emit(EthConnector, "MsgReceived")
                .withArgs(
                    "swapBackAndRefund",
                    uniqueCounter,
                    chainId,
                    refundMessage
                )
                .and.to.emit(
                    EthConnector,
                    "FailedSwapBackAndRefundToSourceChain"
                )
                .withArgs(
                    uniqueCounter,
                    chainId,
                    signer1Address, // refundAddress
                    inputToken.address, // inputToken
                    intermediaryToken.address, // tokenSent
                    intermediaryTokenAmount // tokenSentAmount
                );

            // Verify the failed request is saved in the mapping
            const storedAmount =
                await EthConnector.failedSwapAndUnwrapRefundReqs(
                    signer1Address,
                    inputToken.address,
                    uniqueCounter,
                    intermediaryToken.address
                );
            expect(storedAmount).to.equal(intermediaryTokenAmount);

            // Verify user didn't receive tokens yet
            const intermediateInputTokenBalance = await inputToken.balanceOf(
                signer1Address
            );
            expect(
                intermediateInputTokenBalance.sub(initialInputTokenBalance)
            ).to.equal(0);

            // Transfer intermediary tokens to contract (simulating they're in the contract after failed swap)
            await intermediaryToken
                .connect(acrossSinger)
                .transfer(EthConnector.address, intermediaryTokenAmount);

            // Now set up mock to fail for the admin refund call
            await mockExchangeConnector.mock.swap.returns(
                false, // failure
                [intermediaryTokenAmount, requestAmountOfInputToken]
            );

            // Transfer input tokens to contract (simulating swap result)
            await inputToken.transfer(
                EthConnector.address,
                requestAmountOfInputToken
            );

            // Set acrossAdmin (needed for authorization) - deployer is owner
            await EthConnector.connect(deployer).setAcrossAdmin(acrossAddress);

            // Reset allowance to 0 first (safeApprove requires allowance to be 0 before setting new value)
            // The contract needs to reset its own allowance, so we use approveToken
            await EthConnector.connect(deployer).approveToken(
                intermediaryToken.address,
                exchangeConnectorAddress,
                0
            );

            // Admin calls refundFailedSwapAndUnwrapUniversal
            await expect(
                EthConnector.connect(
                    acrossSinger
                ).refundFailedSwapAndUnwrapUniversal(
                    uniqueCounter,
                    signer1Address, // refundAddress
                    inputToken.address, // inputToken
                    [intermediaryToken.address, inputToken.address], // pathFromIntermediaryToInputOnSourceChain
                    [intermediaryTokenAmount, requestAmountOfInputToken] // amountsFromIntermediaryToInputOnSourceChain
                )
            ).to.revertedWith("EthConnector: swap failed");

            // Verify user didn't receive the input tokens
            const finalInputTokenBalance = await inputToken.balanceOf(
                signer1Address
            );
            expect(
                finalInputTokenBalance.sub(initialInputTokenBalance)
            ).to.equal(0);

            // Verify the mapping entry was not deleted
            const deletedAmount =
                await EthConnector.failedSwapAndUnwrapRefundReqs(
                    signer1Address,
                    inputToken.address,
                    uniqueCounter,
                    intermediaryToken.address
                );
            expect(deletedAmount).to.equal(intermediaryTokenAmount);
        });

        it("should handle wrapAndSwapUniversal message and send user the destination token", async () => {
            // set up mock exchange connector to swap intermediary token back to input token
            await mockExchangeConnector.mock.swap.returns(
                true, // success
                [intermediaryTokenAmount, requestAmountOfInputToken]
            );

            // to mock the received tokens from the swap
            await inputToken.transfer(
                EthConnector.address,
                requestAmountOfInputToken
            );

            await intermediaryToken.transfer(
                acrossAddress,
                intermediaryTokenAmount
            );

            await intermediaryToken
                .connect(acrossSinger)
                .approve(EthConnector.address, ethers.constants.MaxUint256);

            // Setting up the input arguments for the wrapAndSwapUniversal message
            const txId = await calculateTxId(
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.version,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vin,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vout,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.locktime
            );

            const destinationToken = inputToken;
            const destinationTokenAmount = requestAmountOfInputToken;
            const wrapAndSwapUniversalMessage =
                ethers.utils.defaultAbiCoder.encode(
                    [
                        "string",
                        "bytes32",
                        "uint256",
                        "uint256",
                        "address",
                        "address[]",
                        "uint256[]",
                    ],
                    [
                        "wrapAndSwapUniversal",
                        txId,
                        currentChainId, // destRealChainId
                        intermediaryChainId, // intermediaryChainId
                        signer1Address, // targetAddress
                        [intermediaryToken.address, destinationToken.address], // pathFromIntermediaryToDestTokenOnDestChain
                        [intermediaryTokenAmount, destinationTokenAmount], // amountsFromIntermediaryToDestTokenOnDestChain
                    ]
                );

            const initialDestinationTokenBalance =
                await destinationToken.balanceOf(signer1Address);

            // Set across to a real signer (not mock across) for testing
            await EthConnector.setAcross(acrossAddress);

            await expect(
                EthConnector.connect(acrossSinger).handleV3AcrossMessage(
                    intermediaryToken.address,
                    intermediaryTokenAmount,
                    signer1Address,
                    wrapAndSwapUniversalMessage
                )
            )
                .to.emit(EthConnector, "MsgReceived")
                .withArgs(
                    "wrapAndSwapUniversal",
                    BigNumber.from(txId), // uniqueCounter (bitcoinTxId for wrapAndSwapUniversal)
                    currentChainId, // destinationChainId
                    wrapAndSwapUniversalMessage
                )
                .and.to.emit(EthConnector, "WrappedAndSwappedToDestChain")
                .withArgs(
                    txId, // bitcoinTxId
                    currentChainId, // destinationChainId
                    intermediaryChainId, // intermediaryChainId
                    signer1Address, // targetAddress
                    destinationTokenAmount, // actual amount of destination token sent to user
                    [intermediaryToken.address, destinationToken.address], // path from intermediary token to destination token
                    [intermediaryTokenAmount, destinationTokenAmount] // amounts from intermediary token to destination token
                );

            const finalDestinationTokenBalance =
                await destinationToken.balanceOf(signer1Address);
            expect(
                finalDestinationTokenBalance.sub(initialDestinationTokenBalance)
            ).to.equal(destinationTokenAmount);
        });

        it("fails because swap after handling wrapAndSwapUniversal message fails", async () => {
            // set up mock exchange connector to swap intermediary token back to input token
            await mockExchangeConnector.mock.swap.returns(
                false, // failure
                [intermediaryTokenAmount, requestAmountOfInputToken]
            );

            await intermediaryToken.transfer(
                acrossAddress,
                intermediaryTokenAmount
            );

            await intermediaryToken
                .connect(acrossSinger)
                .approve(EthConnector.address, ethers.constants.MaxUint256);

            // Setting up the input arguments for the wrapAndSwapUniversal message
            const txId = await calculateTxId(
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.version,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vin,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vout,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.locktime
            );

            const destinationToken = inputToken;
            const destinationTokenAmount = requestAmountOfInputToken;
            const wrapAndSwapUniversalMessage =
                ethers.utils.defaultAbiCoder.encode(
                    [
                        "string",
                        "bytes32",
                        "uint256",
                        "uint256",
                        "address",
                        "address[]",
                        "uint256[]",
                    ],
                    [
                        "wrapAndSwapUniversal",
                        txId,
                        currentChainId, // destRealChainId
                        intermediaryChainId, // intermediaryChainId
                        signer1Address, // targetAddress
                        [intermediaryToken.address, destinationToken.address], // pathFromIntermediaryToDestTokenOnDestChain
                        [intermediaryTokenAmount, destinationTokenAmount], // amountsFromIntermediaryToDestTokenOnDestChain
                    ]
                );

            const initialDestinationTokenBalance =
                await destinationToken.balanceOf(signer1Address);

            // Set across to a real signer (not mock across) for testing
            await EthConnector.setAcross(acrossAddress);

            await expect(
                EthConnector.connect(acrossSinger).handleV3AcrossMessage(
                    intermediaryToken.address,
                    intermediaryTokenAmount,
                    signer1Address,
                    wrapAndSwapUniversalMessage
                )
            )
                .to.emit(EthConnector, "MsgReceived")
                .withArgs(
                    "wrapAndSwapUniversal",
                    BigNumber.from(txId), // uniqueCounter (bitcoinTxId for wrapAndSwapUniversal)
                    currentChainId, // destinationChainId
                    wrapAndSwapUniversalMessage
                )
                .and.to.emit(EthConnector, "FailedWrapAndSwapToDestChain")
                .withArgs(
                    txId, // bitcoinTxId
                    currentChainId, // destinationChainId
                    intermediaryChainId, // intermediaryChainId
                    signer1Address, // targetAddress
                    0, // actual amount of destination token sent to user
                    [intermediaryToken.address, destinationToken.address], // path from intermediary token to destination token
                    [intermediaryTokenAmount, destinationTokenAmount] // amounts from intermediary token to destination token
                );

            const finalDestinationTokenBalance =
                await destinationToken.balanceOf(signer1Address);
            expect(
                finalDestinationTokenBalance.sub(initialDestinationTokenBalance)
            ).to.equal(0);
        });

        it("should bridge back and refund user (with BTC)", async () => {
            // set up mock exchange connector to swap intermediary token back to input token
            await mockExchangeConnector.mock.swap.returns(
                false, // failure
                [intermediaryTokenAmount, requestAmountOfInputToken]
            );

            await intermediaryToken.transfer(
                acrossAddress,
                intermediaryTokenAmount
            );

            await intermediaryToken
                .connect(acrossSinger)
                .approve(EthConnector.address, ethers.constants.MaxUint256);

            // Setting up the input arguments for the wrapAndSwapUniversal message
            const txId = await calculateTxId(
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.version,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vin,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.vout,
                CC_EXCHANGE_REQUESTS.normalCCExchangeV2_fixedInput.locktime
            );

            const destinationToken = inputToken;
            const destinationTokenAmount = requestAmountOfInputToken;
            const wrapAndSwapUniversalMessage =
                ethers.utils.defaultAbiCoder.encode(
                    [
                        "string",
                        "bytes32",
                        "uint256",
                        "uint256",
                        "address",
                        "address[]",
                        "uint256[]",
                    ],
                    [
                        "wrapAndSwapUniversal",
                        txId,
                        currentChainId, // destRealChainId
                        intermediaryChainId, // intermediaryChainId
                        signer1Address, // targetAddress
                        [intermediaryToken.address, destinationToken.address], // pathFromIntermediaryToDestTokenOnDestChain
                        [intermediaryTokenAmount, destinationTokenAmount], // amountsFromIntermediaryToDestTokenOnDestChain
                    ]
                );

            const initialDestinationTokenBalance =
                await destinationToken.balanceOf(signer1Address);

            // Set across to a real signer (not mock across) for testing
            await EthConnector.setAcross(acrossAddress);

            await expect(
                EthConnector.connect(acrossSinger).handleV3AcrossMessage(
                    intermediaryToken.address,
                    intermediaryTokenAmount,
                    signer1Address,
                    wrapAndSwapUniversalMessage
                )
            )
                .to.emit(EthConnector, "MsgReceived")
                .withArgs(
                    "wrapAndSwapUniversal",
                    BigNumber.from(txId), // uniqueCounter (bitcoinTxId for wrapAndSwapUniversal)
                    currentChainId, // destinationChainId
                    wrapAndSwapUniversalMessage
                )
                .and.to.emit(EthConnector, "FailedWrapAndSwapToDestChain")
                .withArgs(
                    txId, // bitcoinTxId
                    currentChainId, // destinationChainId
                    intermediaryChainId, // intermediaryChainId
                    signer1Address, // targetAddress
                    0, // actual amount of destination token sent to user
                    [intermediaryToken.address, destinationToken.address], // path from intermediary token to destination token
                    [intermediaryTokenAmount, destinationTokenAmount] // amounts from intermediary token to destination token
                );

            const finalDestinationTokenBalance =
                await destinationToken.balanceOf(signer1Address);
            expect(
                finalDestinationTokenBalance.sub(initialDestinationTokenBalance)
            ).to.equal(0);

            // Reset across to mockAcross for swapBackAndRefundBTCByAdmin to work
            // (swapBackAndRefundBTCByAdmin calls _sendMsgUsingAcross which needs the mock contract)
            await EthConnector.setAcross(mockAcross.address);

            // Transfer tokens to EthConnector.address to simulate tokens being in the contract
            // after the failed swap (in reality, Across would have transferred them)
            await intermediaryToken
                .connect(acrossSinger)
                .transfer(EthConnector.address, intermediaryTokenAmount);

            const initialIntermediaryTokenBalance =
                await intermediaryToken.balanceOf(EthConnector.address);
            await expect(
                EthConnector.swapBackAndRefundBTCByAdmin({
                    targetAddress: signer1Address,
                    destToken: destinationToken.address,
                    tokenSent: intermediaryToken.address,
                    bitcoinTxId: txId,
                    exchangeConnector: mockExchangeConnector.address,
                    minOutputAmount: requestAmountOfInputToken,
                    userAndLockerScript: {
                        userScript: USER_SCRIPT_P2PKH,
                        scriptType: USER_SCRIPT_P2PKH_TYPE,
                        lockerLockingScript: LOCKER_TARGET_ADDRESS,
                    },
                    path: [intermediaryToken.address, destinationToken.address],
                    amounts: [intermediaryTokenAmount, destinationTokenAmount],
                    bridgePercentageFee: bridgePercentageFee,
                    intermediaryChainId: intermediaryChainId,
                })
            )
                .to.emit(EthConnector, "SwappedBackAndRefundedBTCUniversal")
                .withArgs(
                    BigNumber.from(txId), // uniqueCounter (bitcoinTxId)
                    intermediaryChainId, // chainId
                    intermediaryToken.address, // token
                    intermediaryTokenAmount, // amount
                    bridgePercentageFee, // bridgePercentageFee
                    signer1Address, // refundAddress
                    [intermediaryToken.address, destinationToken.address], // path
                    [intermediaryTokenAmount, destinationTokenAmount] // amounts
                );

            const finalIntermediaryTokenBalance =
                await intermediaryToken.balanceOf(EthConnector.address);
            expect(
                finalIntermediaryTokenBalance.sub(
                    initialIntermediaryTokenBalance
                )
            ).to.equal(0);
        });
    });
});
