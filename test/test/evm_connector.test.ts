// const CC_BURN_REQUESTS = require('./test_fixtures/ccBurnRequests.json');
// require('dotenv').config({path:"../../.env"});

// import { expect } from "chai";
// import { deployments, ethers, waffle } from "hardhat";
// import { Signer, BigNumber } from "ethers";
// import {
//     deployMockContract,
//     MockContract,
// } from "@ethereum-waffle/mock-contract";
// import { Address } from "hardhat-deploy/types";
// import { Contract } from "@ethersproject/contracts";
// import { takeSnapshot, revertProvider } from "./block_utils";
// import { network } from "hardhat";
// import Web3 from "web3";
// // import { TeleBTC } from "../src/types/TeleBTC";
// // import { TeleBTC__factory } from "../src/types/factories/TeleBTC__factory";
// import { ERC20 } from "../src/types/ERC20";
// import { Erc20__factory } from "../src/types/factories/Erc20__factory";
// import {EVMConnectorLogic__factory }from "../src/types/factories/EVMConnectorLogic__factory"
// import {EVMConnectorProxy__factory }from "../src/types/factories/EVMConnectorProxy__factory"
// import { Address } from "../src/types/Address"
// import { Address__factory } from "../src/types/factories/Address__factory"
// const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// const abiUtils = new Web3().eth.abi
// const web3 = new Web3();
// const provider = waffle.provider;

// describe.only("EVMConnector", async () => {
//     let snapshotId: any;

//     // Accounts
//     let proxyAdmin: Signer;
//     let deployer: Signer;
//     let signer1: Signer;
//     let signer2: Signer;
//     let acrossSinger: Signer;
//     let signer1Address: Address;
//     let deployerAddress: Address;
//     let proxyAdminAddress: Address;
//     let acrossAddress: Address;

//     // Contracts
//     let teleBTC: ERC20;
//     let inputToken: ERC20;
//     let inputTokenSigner1: ERC20;
//     let wrappedNativeToken: ERC20;
//     let polygonToken: ERC20;
//     let TeleBTCSigner1: ERC20;
//     let EVMConnector: Contract;
//     let Address: Address;
//     let burnRouter: Contract;

//     let exchangeToken: ERC20;

//     // Mock contracts
//     let mockAddress: MockContract;
//     let mockLockers: MockContract;
//     let mockExchangeConnector: MockContract;
//     let mockAcross: MockContract;

//     // Constants
//     let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
//     let ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
//     let ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
//     let oneHundred = BigNumber.from(10).pow(8).mul(100)
//     let THIRD_PARTY_ID = 10
//     let TOKEN_ID = 20
//     let APP_ID = 30
//     /*
//         This one is set so that:
//         userRequestedAmount * (1 - lockerFee / 10000 - PROTOCOL_PERCENTAGE_FEE / 10000) - BITCOIN_FEE = 100000000
//     */
//     let userRequestedAmount = BigNumber.from(100060030);
//     let requestAmount = 100
//     let telebtcAmount  = 100000000000
//     let TRANSFER_DEADLINE = 20
//     let PROTOCOL_PERCENTAGE_FEE = 5 // means 0.05%
//     let SLASHER_PERCENTAGE_REWARD = 5 // means 0.05%
//     let RELAYER_FEE = 10000 // estimation of Bitcoin transaction fee in Satoshi
//     let TREASURY = "0x0000000000000000000000000000000000000002";

//     let LOCKER_TARGET_ADDRESS = ONE_ADDRESS;
//     let LOCKER1_LOCKING_SCRIPT = '0x76a914748284390f9e263a4b766a75d0633c50426eb87587ac';

//     let USER_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
//     let USER_SCRIPT_P2PKH_TYPE = 1; // P2PKH

//     let USER_SCRIPT_P2WPKH = "0x751e76e8199196d454941c45d1b3a323f1433bd6";
//     let USER_SCRIPT_P2WPKH_TYPE = 3; // P2WPKH

    
//     before(async () => {

//         [proxyAdmin, deployer, signer1, signer2, acrossSinger] = await ethers.getSigners();
//         proxyAdminAddress = await proxyAdmin.getAddress();
//         signer1Address = await signer1.getAddress();
//         deployerAddress = await deployer.getAddress();
//         acrossAddress = await acrossSinger.getAddress();

//         // Mocks contracts
//         // const AddressContract = await deployments.getArtifact(
//         //     "AddressTest"
//         // );
        
//         // mockAddress = await deployMockContract(
//         //     deployer,
//         //     AddressContract.abi
//         // )

//         const across = await deployments.getArtifact(
//             "SpokePoolInterface"
//         );
//         mockAcross = await deployMockContract(
//             deployer,
//             across.abi
//         )

//         // Deploys contracts
//         const teleBTCLogicFactory = new Erc20__factory(deployer);
//         teleBTC = await teleBTCLogicFactory.deploy("TST", "TST", telebtcAmount * 1000);

//         const erc20Factory = new Erc20__factory(deployer);
//         inputToken = await erc20Factory.deploy("TestToken", "TT", 100000);

//         wrappedNativeToken = await erc20Factory.deploy("WrappedNativeToken", "Native", 100000);

//         polygonToken = await erc20Factory.deploy(
//             "PolygonTestToken",
//             "PTT",
//             100000
//         );

//         EVMConnector = await deployEVMConnector();

//         await EVMConnector.initialize(
//             mockAcross.address,
//             wrappedNativeToken.address,
//             137,
//             10
//         );

//         //mock function
//         // await mockAddress.mock.functionCallWithValue.returns("0x")
//         await mockAcross.mock.deposit.returns()
//     });

//     const deployAddress = async (
//         _signer?: Signer
//     ): Promise<Address> => {
//         const AddressFactory = new Address__factory(
//             _signer || deployer
//         );

//         const Address = await AddressFactory.deploy(
//         );

//         return Address;
//     };

//     const deployEVMConnector = async (
//         _signer?: Signer
//     ): Promise<Contract> => {
//         Address = await deployAddress()
//         let linkLibraryAddresses: EVMConnectorLogicLibraryAddresses;

//         linkLibraryAddresses = {
//             "contracts/libraries/Address.sol:Address": Address.address,
//         };

//         // Deploys lockers logic
//         const EVMConnectorLogicFactory = new EVMConnectorLogic__factory(
//             // linkLibraryAddresses,
//             _signer || deployer
//         );

//         const EVMConnectorLogic = await EVMConnectorLogicFactory.deploy();

//         // Deploys lockers proxy
//         const EVMConnectorProxyFactory = new EVMConnectorProxy__factory(
//             _signer || deployer
//         );
//         const EVMConnectorProxy = await EVMConnectorProxyFactory.deploy(
//             EVMConnectorLogic.address,
//             proxyAdminAddress,
//             "0x"
//         )

//         return await EVMConnectorLogic.attach(
//             EVMConnectorProxy.address
//         );

//     };

//     async function mintTeleBTCForTest(): Promise<void> {
//         let TeleBTCSigner1 = await teleBTC.connect(signer1)
//         await TeleBTCSigner1.mint(signer1Address, oneHundred);
//     }

//     describe("#setters", async () => {

//         beforeEach(async () => {
//             snapshotId = await takeSnapshot(signer1.provider);
//         });

//         afterEach(async () => {
//             await revertProvider(signer1.provider, snapshotId);
//         });

//         it("should set and get the Across", async () => {
//             await EVMConnector.setAcross(ONE_ADDRESS);
//             expect(await EVMConnector.across()).to.equal(ONE_ADDRESS);
//         });

//         it("should not set the Across if not owner", async () => {
//             await expect(EVMConnector.connect(signer1).setAcross(ONE_ADDRESS)).to.be.revertedWith("Ownable: caller is not the owner");
//         });

//         it("should set and get the target chain connector", async () => {
//             await EVMConnector.setTargetChainConnectorProxy(ONE_ADDRESS);
//             expect(await EVMConnector.targetChainConnectorProxy()).to.equal(ONE_ADDRESS);
//         });

//         it("should not set the target chain connector if not owner", async () => {
//             await expect(EVMConnector.connect(signer1).setTargetChainConnectorProxy(ONE_ADDRESS)).to.be.revertedWith("Ownable: caller is not the owner");
//         });

//         it("should set and get wrapped native token", async () => {
//             await EVMConnector.setWrappedNativeToken(ONE_ADDRESS);
//             expect(await EVMConnector.wrappedNativeToken()).to.equal(ONE_ADDRESS);
//         });

//         it("should not set the wrapped native token if not owner", async () => {
//             await expect(EVMConnector.connect(signer1).setWrappedNativeToken(ONE_ADDRESS)).to.be.revertedWith("Ownable: caller is not the owner");
//         });

//         it("can't set addresses to zero address", async () => {
//             await expect(EVMConnector.setAcross(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress()");
//             await expect(EVMConnector.setTargetChainConnectorProxy(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress()");
//             await expect(EVMConnector.setWrappedNativeToken(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress()");
//         });
//     });

//     describe("#Handle across message", async () => {

//         beforeEach(async () => {
//             await inputToken.approve(EVMConnector.address, requestAmount)
//             snapshotId = await takeSnapshot(signer1.provider);
//         });

//         afterEach(async () => {
//             await revertProvider(signer1.provider, snapshotId);
//         });

//         ////// _checkRequest test start
//         // it.only("fails because token is not supported", async () => {
//         //     // await EVMConnector.setMinAmount(inputToken.address, 0)
//         //     await expect(
//         //         EVMConnector.swapAndUnwrap(
//         //             inputToken.address,
//         //             ONE_ADDRESS,
//         //             [requestAmount, telebtcAmount],
//         //             true, //TODO
//         //             [polygonToken.address, teleBTC.address],
//         //             { 
//         //                 userScript: USER_SCRIPT_P2PKH,
//         //                 scriptType: USER_SCRIPT_P2PKH_TYPE,
//         //                 lockerLockingScript: LOCKER_TARGET_ADDRESS,
//         //             },
//         //             RELAYER_FEE,
//         //             0
//         //         )
//         //     ).to.be.revertedWith("EVMConnectorLogic: token not supported");
//         // });

//         // it.only("fails because token amount is not sufficient", async () => {
//         //     await expect(
//         //         EVMConnector.swapAndUnwrap(
//         //             inputToken.address,
//         //             ONE_ADDRESS,
//         //             [90, telebtcAmount],
//         //             true,
//         //             [polygonToken.address, teleBTC.address],
//         //             { 
//         //                 userScript: USER_SCRIPT_P2PKH,
//         //                 scriptType: USER_SCRIPT_P2PKH_TYPE,
//         //                 lockerLockingScript: LOCKER_TARGET_ADDRESS,
//         //             },
//         //             RELAYER_FEE,
//         //             0
//         //         )
//         //     ).to.be.revertedWith("EVMConnectorLogic: low amount");
//         // });

//         // it("fails because last token of path is not telebtc", async () => {
//         //     await expect(
//         //         EVMConnector.swapAndUnwrap(
//         //             inputToken.address,
//         //             ONE_ADDRESS,
//         //             [requestAmount, telebtcAmount],
//         //             true,
//         //             [polygonToken.address, inputToken.address],
//         //             { 
//         //                 userScript: USER_SCRIPT_P2PKH,
//         //                 scriptType: USER_SCRIPT_P2PKH_TYPE,
//         //                 lockerLockingScript: LOCKER_TARGET_ADDRESS,
//         //             },
//         //             RELAYER_FEE,
//         //             0
//         //         )
//         //     ).to.be.revertedWith("EVMConnectorLogic: invalid path");
//         // });

//         // it("fails because amounts list length is greater than 2", async () => {
//         //     await expect(
//         //         EVMConnector.swapAndUnwrap(
//         //             inputToken.address,
//         //             ONE_ADDRESS,
//         //             [requestAmount, telebtcAmount, 100],
//         //             true,
//         //             [polygonToken.address, teleBTC.address],
//         //             { 
//         //                 userScript: USER_SCRIPT_P2PKH,
//         //                 scriptType: USER_SCRIPT_P2PKH_TYPE,
//         //                 lockerLockingScript: LOCKER_TARGET_ADDRESS,
//         //             },
//         //             RELAYER_FEE,
//         //             0
//         //         )
//         //     ).to.be.revertedWith("EVMConnectorLogic: wrong amounts");
//         // });
//         ////// _checkRequest test end

//         ////// _sendMsgUsingAcross test start
//         it("fails because amount is incorrect (ETH)", async () => {
//             await expect(
//                 EVMConnector.swapAndUnwrap(
//                     ETH_ADDRESS,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount, 
//                     telebtcAmount,
//                     [polygonToken.address, teleBTC.address],
//                     { 
//                         userScript: USER_SCRIPT_P2PKH,
//                         scriptType: USER_SCRIPT_P2PKH_TYPE,
//                         lockerLockingScript: LOCKER_TARGET_ADDRESS,
//                     },
//                     RELAYER_FEE,
//                 )
//             ).to.be.revertedWith("EVMConnectorLogic: wrong value");
//         });
//         ////// _sendMsgUsingAcross test end


//         it("Handle swapAndUnwrap (TOKEN)", async () => {
//             let message = await abiUtils.encodeParameters([
//                 'string',
//                 'uint',
//                 'uint',
//                 'address',
//                 'uint',
//                 'uint',
//                 'uint',
//                 'uint',
//                 'uint',
//                 'address[]',
//                 {
//                     "UserAndLockerScript": {
//                         "userScript": "bytes",
//                         "scriptType": "uint"
//                     }
//                 }
//             ], [
//                 "unwrapBrc20",
//                 0,
//                 10,
//                 deployerAddress,
//                 THIRD_PARTY_ID,
//                 TOKEN_ID,
//                 APP_ID,
//                 requestAmount, 
//                 telebtcAmount,
//                 [polygonToken.address, teleBTC.address],
//                 { 
//                     userScript: USER_SCRIPT_P2PKH,
//                     scriptType: USER_SCRIPT_P2PKH_TYPE
//                 }
//             ])

//             await expect(
//                 EVMConnector.swapAndUnwrap(
//                     inputToken.address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount, 
//                     telebtcAmount,
//                     [polygonToken.address, teleBTC.address],
//                     { 
//                         userScript: USER_SCRIPT_P2PKH,
//                         scriptType: USER_SCRIPT_P2PKH_TYPE
//                     },
//                     RELAYER_FEE,
//                 )
//             ).to.emit(EVMConnector, 'MsgSent').withArgs(
//                 "0",
//                 message,
//                 inputToken.address,
//                 requestAmount
//             );
//         });

//         it("Handle exchangeForBtcAcross (ETH)", async () => {
//             let message = await abiUtils.encodeParameters([
//                 'string',
//                 'uint',
//                 'uint',
//                 'address',
//                 'uint',
//                 'uint',
//                 'uint',
//                 'uint',
//                 'uint',
//                 'address[]',
//                 {
//                     "UserAndLockerScript": {
//                         "userScript": "bytes",
//                         "scriptType": "uint"
//                     }
//                 }
//             ], [
//                 "unwrapBrc20",
//                 0,
//                 10,
//                 deployerAddress,
//                 THIRD_PARTY_ID,
//                 TOKEN_ID,
//                 APP_ID,
//                 requestAmount, 
//                 telebtcAmount,
//                 [polygonToken.address, teleBTC.address],
//                 { 
//                     userScript: USER_SCRIPT_P2PKH,
//                     scriptType: USER_SCRIPT_P2PKH_TYPE
//                 }
//             ])

//             await expect(
//                 EVMConnector.swapAndUnwrap(
//                     ETH_ADDRESS,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount, 
//                     telebtcAmount,
//                     [polygonToken.address, teleBTC.address],
//                     { 
//                         userScript: USER_SCRIPT_P2PKH,
//                         scriptType: USER_SCRIPT_P2PKH_TYPE
//                     },
//                     RELAYER_FEE,
//                     {
//                         value: requestAmount
//                     }
//                 )
//             ).to.emit(EVMConnector, 'MsgSent').withArgs(
//                 "0",
//                 message,
//                 ETH_ADDRESS,
//                 requestAmount
//             );
//         });

//         it("fails because amount is incorrect (TOKEN)", async () => {
//             await expect(
//                 EVMConnector.swapAndUnwrap(
//                     inputToken.address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount, 
//                     telebtcAmount,
//                     [polygonToken.address, teleBTC.address],
//                     { 
//                         userScript: USER_SCRIPT_P2PKH,
//                         scriptType: USER_SCRIPT_P2PKH_TYPE,
//                         lockerLockingScript: LOCKER_TARGET_ADDRESS,
//                     },
//                     RELAYER_FEE,
//                     {
//                         value: requestAmount
//                     }
//                 )
//             ).to.be.revertedWith("EVMConnectorLogic: wrong value");
//         });
      
//     });

//     describe("#Handle emergencyWithdraw", async () => {
//         //write test that handle emergency withdraw
//         it("should handle emergency withdraw token", async () => {
//             await inputToken.transfer(
//                 EVMConnector.address,
//                 requestAmount
//             );

//             await expect (
//                 await inputToken.balanceOf(EVMConnector.address)
//             ).to.be.equal(requestAmount)

//             await EVMConnector.emergencyWithdraw(
//                 inputToken.address,
//                 signer1Address,
//                 requestAmount
//             )

//             await expect (
//                 await inputToken.balanceOf(EVMConnector.address)
//             ).to.be.equal(0)

//             await expect (
//                 await inputToken.balanceOf(signer1Address)
//             ).to.be.equal(requestAmount)

//         });

//         it("should handle emergency withdraw eth", async () => {
//             let tx = {
//                 to: EVMConnector.address,
//                 value: 100
//             };
//             await signer1.sendTransaction(tx);

//             let beforeBalance = await signer1.getBalance()
//             beforeBalance.add(100)

//             await expect (
//                 await provider.getBalance(EVMConnector.address)
//             ).to.be.equal(100)

//             await EVMConnector.emergencyWithdraw(
//                 "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
//                 signer1Address,
//                 100
//             )

//         });

//         // write test that only owner can emergency withdraw
//         it("should not handle emergency withdraw if not owner", async () => {
//             await expect (
//                 EVMConnector.connect(signer1).emergencyWithdraw(
//                     inputToken.address,
//                     signer1Address,
//                     requestAmount
//                 )
//             ).to.be.revertedWith("Ownable: caller is not the owner")
//         });
//     });


// });
