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
// import {PolyConnectorLogic__factory }from "../src/types/factories/PolyConnectorLogic__factory"
// import {PolyConnectorProxy__factory }from "../src/types/factories/PolyConnectorProxy__factory"


// const abiUtils = new Web3().eth.abi;
// const web3 = new Web3();
// const provider = waffle.provider;

// describe("PolyConnector", async () => {
//     let snapshotId: any;

//     // Accounts
//     let proxyAdmin: Signer;
//     let deployer: Signer;
//     let signer1: Signer;
//     let acrossSinger: Signer;
//     let signer1Address: Address;
//     let proxyAdminAddress: Address;
//     let acrossAddress: Address;

//     // Contracts
//     let teleBTC: ERC20;
//     let inputToken: ERC20;
//     let TeleBTCDeployer: ERC20;
//     let PolyConnector: Contract;
//     let PolyConnectorWithMockedAccross: Contract;
    

//     // Mock contracts
//     let mockBrc20Router: MockContract;
//     let mockExchangeConnector: MockContract;
//     let mockAcross: MockContract;
    

//     // Constants
//     let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
//     let ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
//     let oneHundred = BigNumber.from(10).pow(8).mul(100);
//     let THIRD_PARTY_ID = 10
//     let TOKEN_ID = 20
//     let APP_ID = 30

//     /*
//         This one is set so that:
//         userRequestedAmount * (1 - lockerFee / 10000 - PROTOCOL_PERCENTAGE_FEE / 10000) - BITCOIN_FEE = 100000000
//     */
//     let userRequestedAmount = BigNumber.from(100060030);
//     let requestAmount = 100;
//     let telebtcAmount = 1000000;
//     let TRANSFER_DEADLINE = 20;
//     let PROTOCOL_PERCENTAGE_FEE = 5; // means 0.05%
//     let SLASHER_PERCENTAGE_REWARD = 5; // means 0.05%
//     let BITCOIN_FEE = 10000; // estimation of Bitcoin transaction fee in Satoshi
//     let TREASURY = "0x0000000000000000000000000000000000000002";

//     let LOCKER_TARGET_ADDRESS = ONE_ADDRESS;
//     let LOCKER1_LOCKING_SCRIPT =
//         "0x76a914748284390f9e263a4b766a75d0633c50426eb87587ac";

//     let USER_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
//     let USER_SCRIPT_P2PKH_TYPE = 1; // P2PKH

//     before(async () => {
//         [proxyAdmin, deployer, signer1, acrossSinger] =
//             await ethers.getSigners();
//         proxyAdminAddress = await proxyAdmin.getAddress();
//         signer1Address = await signer1.getAddress();
//         acrossAddress = await acrossSinger.getAddress();

//         // Mocks contracts
//         const across = await deployments.getArtifact("SpokePoolInterface");
//         mockAcross = await deployMockContract(deployer, across.abi);

//         const exchangeConnector = await deployments.getArtifact(
//             "UniswapV2Connector"
//         );
        
//         mockExchangeConnector = await deployMockContract(
//             deployer,
//             exchangeConnector.abi
//         );

//         // await mockExchangeConnector.mock.ccExchangeAndBurn
//         //     .returns(100);

//         // // mock finalization parameter
//         // await mockBitcoinRelay.mock.finalizationParameter.returns(5);

//         // Deploys contracts
//         const teleBTCLogicFactory = new Erc20__factory(deployer);
//         teleBTC = await teleBTCLogicFactory.deploy("TST", "TST", telebtcAmount * 1000);

//         const brc20Router = await deployments.getArtifact(
//             "Brc20RouterLogic"
//         );

//         mockBrc20Router = await deployMockContract(
//             deployer,
//             brc20Router.abi
//         );

//         await mockBrc20Router.mock.unwrapBrc20.returns()

//         PolyConnector = await deployPolyConnector();

//         await PolyConnector.initialize(
//             mockBrc20Router.address,
//             acrossAddress
//         );

//         PolyConnectorWithMockedAccross = await deployPolyConnector();

//         await PolyConnectorWithMockedAccross.initialize(
//             mockBrc20Router.address,
//             signer1Address
//         );

//         // Deploys input token
//         const erc20Factory = new Erc20__factory(deployer);
//         inputToken = await erc20Factory.deploy("TestToken", "TT", 100000);

//         // Mints TeleBTC for user
//         // await teleBTC.addMinter(signer1Address);
//         TeleBTCDeployer = await teleBTC.connect(deployer);

//         // await teleBTC.setMaxMintLimit(oneHundred.mul(2));
//         await moveBlocks(2020);

//         await TeleBTCDeployer.transfer(signer1Address, telebtcAmount);

//         // Sets mock contracts outputs
//         // let lastSubmittedHeight = 100;
//         // await setLockersIsLocker(true);
//         // await setLockersGetLockerTargetAddress();
//         // await setRelayLastSubmittedHeight(lastSubmittedHeight);
//         // await setSwap(true, [requestAmount, telebtcAmount]);

//         // let protocolFee = Math.floor(
//         //     (telebtcAmount * PROTOCOL_PERCENTAGE_FEE) / 10000
//         // );
//         // let burntAmount: number;
//         // burntAmount = telebtcAmount - BITCOIN_FEE - protocolFee;

//         // await setLockersBurnReturn(burntAmount);
//         await PolyConnector.setAcross(acrossSinger.getAddress())
//     });

//     async function moveBlocks(amount: number) {
//         for (let index = 0; index < amount; index++) {
//             await network.provider.request({
//                 method: "evm_mine",
//                 params: [],
//             });
//         }
//     }

//     const parseSignatureToRSV = (signatureHex: string) => {
//         // Ensure the hex string starts with '0x'
//         if (!signatureHex.startsWith("0x")) {
//             throw new Error("Signature must start with 0x");
//         }

//         // Convert the hex string to a Buffer
//         const signatureBuffer = Buffer.from(signatureHex.slice(2), "hex");

//         // Check the length of the signature (should be 65 bytes)
//         if (signatureBuffer.length !== 65) {
//             throw new Error("Invalid signature length");
//         }

//         // Extract r, s, and v from the signature
//         const r = `0x${signatureBuffer.subarray(0, 32).toString("hex")}`;
//         const s = `0x${signatureBuffer.subarray(32, 64).toString("hex")}`;
//         const v = signatureBuffer[64];

//         return { r, s, v };
//     };

//     const deployPolyConnector = async (_signer?: Signer): Promise<Contract> => {
//         const PolyConnectorLogicFactory = new PolyConnectorLogic__factory(
//             _signer || deployer
//         );

//         const PolyConnectorLogic = await PolyConnectorLogicFactory.deploy();

//         // Deploys lockers proxy
//         const PolyConnectorProxyFactory = new PolyConnectorProxy__factory(
//             _signer || deployer
//         );
//         const PolyConnectorProxy = await PolyConnectorProxyFactory.deploy(
//             PolyConnectorLogic.address,
//             proxyAdminAddress,
//             "0x"
//         );

//         return await PolyConnectorLogic.attach(PolyConnectorProxy.address);
//     };

//     async function setSwap(result: boolean, amounts: number[]): Promise<void> {
//         await mockExchangeConnector.mock.swap.returns(result, amounts);
//     }

//     describe("#setters", async () => {
//         beforeEach(async () => {
//             snapshotId = await takeSnapshot(signer1.provider);
//         });

//         afterEach(async () => {
//             await revertProvider(signer1.provider, snapshotId);
//         });

//         //write test setBurnRouter and getBurnRouter

//         it("should set and get the BurnRouter", async () => {
//             await PolyConnector.setBrc20RouterProxy(mockBrc20Router.address);
//             expect(await PolyConnector.brc20RouterProxy()).to.equal(
//                 mockBrc20Router.address
//             );
//         });

//         //write test setBurnRouter that only owner can change
//         it("should not set the BurnRouter if not owner", async () => {
//             await expect(
//                 PolyConnector.connect(signer1).setBrc20RouterProxy(
//                     mockBrc20Router.address
//                 )
//             ).to.be.revertedWith("Ownable: caller is not the owner");
//         });

//         //write test setAcross and getAcross
//         it("should set and get the Across", async () => {
//             await PolyConnector.setAcross(mockAcross.address);
//             expect(await PolyConnector.across()).to.equal(mockAcross.address);
//         });

//         //write test setAcross that only owner can change
//         it("should not set the Across if not owner", async () => {
//             await expect(
//                 PolyConnector.connect(signer1).setAcross(mockAcross.address)
//             ).to.be.revertedWith("Ownable: caller is not the owner");
//         });

//         it("can't set addresses to zero address", async () => {
//             await expect(
//                 PolyConnector.setBrc20RouterProxy(ZERO_ADDRESS)
//             ).to.be.revertedWith("ZeroAddress");
//             await expect(
//                 PolyConnector.setAcross(ZERO_ADDRESS)
//             ).to.be.revertedWith("ZeroAddress");
//         });
//     });

//     describe("#Handle across message V3", async () => {

//         beforeEach(async () => {
//             snapshotId = await takeSnapshot(signer1.provider);
//         });

//         afterEach(async () => {
//             await revertProvider(signer1.provider, snapshotId);
//         });

//         it("should handle across message", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint",
//                             "lockerLockingScript": "bytes"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE,
//                         "lockerLockingScript": LOCKER_TARGET_ADDRESS
//                     }
//                 ]
//             );


//             await expect(
//                 PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
//                     inputToken.address,
//                     requestAmount,
//                     signer1Address,
//                     message
//                 )
//             )
//                 .to.emit(PolyConnector, "MsgReceived")
//                 .withArgs(
//                     "unwrapBrc20",
//                     0,
//                     1,
//                     message
//                 )
//                 .to.emit(PolyConnector, "NewSwapAndUnwrapBrc20")
//                 .withArgs(
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     USER_SCRIPT_P2PKH,
//                     USER_SCRIPT_P2PKH_TYPE,
//                 );
                
//         });

//         it("should not handle across message if not across", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint",
//                             "lockerLockingScript": "bytes"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE,
//                         "lockerLockingScript": LOCKER_TARGET_ADDRESS
//                     }
//                 ]
//             );

//             await expect(
//                 PolyConnector.connect(signer1).handleV3AcrossMessage(
//                     inputToken.address,
//                     requestAmount,
//                     signer1Address,
//                     message
//                 )
//             ).to.be.revertedWith("PolyConnectorLogic: not across");
//         });

//         it("should not handle across message if purpose is not swapAndUnwrap", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint",
//                             "lockerLockingScript": "bytes"
//                         }
//                     }
//                 ],
//                 [
//                     "mew",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE,
//                         "lockerLockingScript": LOCKER_TARGET_ADDRESS
//                     }
//                 ]
//             );

//             await expect(
//                 PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
//                     inputToken.address,
//                     requestAmount,
//                     signer1Address,
//                     message
//                 )
//             ).to.not.emit(PolyConnector, "NewSwapAndUnwrapBrc20");
//         });

//         it("should not handle across message if unwrap fails", async () => {
//             await mockBrc20Router.mock.unwrapBrc20.reverts()

//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             await expect(
//                 PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
//                     inputToken.address,
//                     requestAmount,
//                     signer1Address,
//                     message
//                 )
//             )
//                 .to.emit(PolyConnector, "FailedSwapAndUnwrapBrc20")
//                 .withArgs(
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     USER_SCRIPT_P2PKH,
//                     USER_SCRIPT_P2PKH_TYPE,
//                 );
//         });
//     });

//     describe("#Handle Failed CcExchangeAndBurn ", async () => {
//         beforeEach(async () => {
//             snapshotId = await takeSnapshot(signer1.provider);
//             await mockBrc20Router.mock.unwrapBrc20.reverts()
//         });

//         afterEach(async () => {
//             await revertProvider(signer1.provider, snapshotId);
//         });

//         it("can re do fail cc exchange", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             await PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
//                 inputToken.address,
//                 requestAmount,
//                 signer1Address,
//                 message
//             );

//             await expect(
//                 await PolyConnector.failedReqs(
//                     signer1Address,
//                     1,
//                     inputToken.address
//                 )
//             ).to.equal(BigNumber.from(requestAmount));

//             await mockBrc20Router.mock.unwrapBrc20.returns()

//             let messageHex = await web3.utils.soliditySha3({
//                 type: "bytes",
//                 value: message,
//             });
//             if (messageHex != null) {
//                 let signature;
//                 let rsv;
//                 signature = await signer1.signMessage(
//                     ethers.utils.arrayify(messageHex)
//                 );
//                 rsv = await parseSignatureToRSV(signature);
//                 await setSwap(true, [requestAmount, telebtcAmount]);

//                 await expect(
//                     PolyConnector.connect(signer1).retrySwapAndUnwrap(
//                         message,
//                         rsv.v,
//                         rsv.r,
//                         rsv.s
//                     )
//                 )
//                     .to.emit(PolyConnector, "NewSwapAndUnwrapBrc20")
//                     .withArgs(
//                         1,
//                         signer1Address,
//                         THIRD_PARTY_ID,
//                         TOKEN_ID,
//                         APP_ID,
//                         requestAmount,
//                         telebtcAmount,
//                         [inputToken.address, teleBTC.address],
//                         USER_SCRIPT_P2PKH,
//                         USER_SCRIPT_P2PKH_TYPE,
//                     );

//                 await expect(
//                     await PolyConnector.failedReqs(
//                         signer1Address,
//                         1,
//                         inputToken.address
//                     )
//                 ).to.equal(0);
//             }
//         });

//         it("fail re do fail cc exchange because amount is greater than available", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             await PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
//                 inputToken.address,
//                 requestAmount,
//                 signer1Address,
//                 message
//             );

//             await mockBrc20Router.mock.unwrapBrc20.returns()
//             let reDoMessage = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount + 1,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             let messageHex = await web3.utils.soliditySha3({
//                 type: "bytes",
//                 value: reDoMessage,
//             });
//             if (messageHex != null) {
//                 let signature;
//                 let rsv;
//                 signature = await signer1.signMessage(
//                     ethers.utils.arrayify(messageHex)
//                 );
//                 rsv = await parseSignatureToRSV(signature);
//                 await setSwap(true, [requestAmount, telebtcAmount]);

//                 await expect(
//                     PolyConnector.connect(signer1).retrySwapAndUnwrap(
//                         reDoMessage,
//                         rsv.v,
//                         rsv.r,
//                         rsv.s
//                     )
//                 ).to.be.revertedWith("PolyConnectorLogic: low balance");
//             }
//         });

//         it("fail re do fail cc exchange because amount is zero", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     0,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             await PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
//                 inputToken.address,
//                 requestAmount,
//                 signer1Address,
//                 message
//             );

//             await mockBrc20Router.mock.unwrapBrc20.returns()
//             let reDoMessage = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount + 1,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             let messageHex = await web3.utils.soliditySha3({
//                 type: "bytes",
//                 value: reDoMessage,
//             });
//             if (messageHex != null) {
//                 let signature;
//                 let rsv;
//                 signature = await signer1.signMessage(
//                     ethers.utils.arrayify(messageHex)
//                 );
//                 rsv = await parseSignatureToRSV(signature);
//                 await setSwap(true, [requestAmount, telebtcAmount]);

//                 await expect(
//                     PolyConnector.connect(signer1).retrySwapAndUnwrap(
//                         reDoMessage,
//                         rsv.v,
//                         rsv.r,
//                         rsv.s
//                     )
//                 ).to.be.revertedWith("PolyConnectorLogic: low balance");
//             }
//         });

//         it("can re do fail cc exchange with less than request amount", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             await PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
//                 inputToken.address,
//                 requestAmount,
//                 signer1Address,
//                 message
//             );

//             await expect(
//                 await PolyConnector.failedReqs(
//                     signer1Address,
//                     1,
//                     inputToken.address
//                 )
//             ).to.equal(BigNumber.from(requestAmount));

//             await inputToken.transfer(PolyConnector.address, requestAmount);

//             await mockBrc20Router.mock.unwrapBrc20.returns()
//             let reDoMessage = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount - 10,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             let messageHex = await web3.utils.soliditySha3({
//                 type: "bytes",
//                 value: reDoMessage,
//             });
//             if (messageHex != null) {
//                 let signature;
//                 let rsv;
//                 signature = await signer1.signMessage(
//                     ethers.utils.arrayify(messageHex)
//                 );
//                 rsv = await parseSignatureToRSV(signature);
//                 await setSwap(true, [requestAmount, telebtcAmount]);

//                 await expect(
//                     PolyConnector.connect(signer1).retrySwapAndUnwrap(
//                         reDoMessage,
//                         rsv.v,
//                         rsv.r,
//                         rsv.s
//                     )
//                 )
//                 .to.emit(PolyConnector, "NewSwapAndUnwrapBrc20")
//                 .withArgs(
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount - 10,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     USER_SCRIPT_P2PKH,
//                     USER_SCRIPT_P2PKH_TYPE,
//                 );

//                 await expect(
//                     await PolyConnector.failedReqs(
//                         signer1Address,
//                         1,
//                         inputToken.address
//                     )
//                 ).to.equal(10);
//             }
//         });

//         // test is commented because can't call function with mocked across
//         // it("can withdraw Funds To Eth", async () => {
//         //     let message = abiUtils.encodeParameters(
//         //         [
//         //             "string",
//         //             "uint",
//         //             "uint",
//         //             "address",
//         //             "uint",
//         //             "uint",
//         //             "uint",
//         //             "uint",
//         //             "uint",
//         //             "address[]",
//         //             {
//         //                 "UserAndLockerScript": {
//         //                     "userScript": "bytes",
//         //                     "scriptType": "uint"
//         //                 }
//         //             }
//         //         ],
//         //         [
//         //             "unwrapBrc20",
//         //             "1",
//         //             1,
//         //             signer1Address,
//         //             THIRD_PARTY_ID,
//         //             TOKEN_ID,
//         //             APP_ID,
//         //             requestAmount,
//         //             telebtcAmount,
//         //             [inputToken.address, teleBTC.address],
//         //             { 
//         //                 "userScript": USER_SCRIPT_P2PKH,
//         //                 "scriptType": USER_SCRIPT_P2PKH_TYPE
//         //             }
//         //         ]
//         //     );

//         //     await PolyConnector.connect(acrossSinger).handleV3AcrossMessage(
//         //         inputToken.address,
//         //         requestAmount,
//         //         signer1Address,
//         //         message
//         //     );

//         //     await expect(
//         //         await PolyConnector.failedReqs(signer1Address, 1, inputToken.address)
//         //     ).to.equal(BigNumber.from(requestAmount))

//         //     let reDoMessage = abiUtils.encodeParameters(
//         //         ["uint256", "address", "uint", "int64"],
//         //         [1, inputToken.address, requestAmount, 1000]
//         //     );

//         //     let messageHex = await web3.utils.soliditySha3(
//         //         {
//         //             type: 'bytes',
//         //             value: reDoMessage
//         //         }
//         //     )
//         //     if (messageHex != null) {
//         //         let signature
//         //         let rsv
//         //         signature = await signer1.signMessage(ethers.utils.arrayify(messageHex))
//         //         rsv = await parseSignatureToRSV(signature)
//         //         await setSwap(true, [requestAmount, telebtcAmount])

//         //         await PolyConnector.connect(signer1).withdrawFundsToSourceChain(
//         //             reDoMessage,
//         //             rsv.v,
//         //             rsv.r,
//         //             rsv.s
//         //         )

//         //         await expect(
//         //             await PolyConnector.failedReqs(signer1Address, 1, inputToken.address)
//         //         ).to.equal(0)
//         //     }

//         // });

//         it("can't withdraw Funds To Eth if amount is zero", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             await PolyConnector.connect(
//                 acrossSinger
//             ).handleV3AcrossMessage(
//                 inputToken.address,
//                 requestAmount,
//                 signer1Address,
//                 message
//             );

//             await expect(
//                 await PolyConnector.connect(signer1).failedReqs(
//                     signer1Address,
//                     1,
//                     inputToken.address
//                 )
//             ).to.equal(BigNumber.from(requestAmount));

//             let reDoMessage = abiUtils.encodeParameters(
//                 ["uint256", "address", "uint", "int64"],
//                 [1, inputToken.address, 0, 1000]
//             );

//             let messageHex = await web3.utils.soliditySha3({
//                 type: "bytes",
//                 value: reDoMessage,
//             });
//             if (messageHex != null) {
//                 let signature;
//                 let rsv;
//                 signature = await signer1.signMessage(
//                     ethers.utils.arrayify(messageHex)
//                 );
//                 rsv = await parseSignatureToRSV(signature);
//                 await setSwap(true, [requestAmount, telebtcAmount]);

//                 await expect(
//                     PolyConnector.connect(signer1).withdrawFundsToSourceChain(reDoMessage, rsv.v, rsv.r, rsv.s)
//                 ).to.be.revertedWith("PolyConnectorLogic: low balance");
//             }
//         });

//         it("can't withdraw Funds To Eth if amount is greater than user request amount", async () => {
//             let message = abiUtils.encodeParameters(
//                 [
//                     "string",
//                     "uint",
//                     "uint",
//                     "address",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "uint",
//                     "address[]",
//                     {
//                         "UserAndLockerScript": {
//                             "userScript": "bytes",
//                             "scriptType": "uint"
//                         }
//                     }
//                 ],
//                 [
//                     "unwrapBrc20",
//                     "1",
//                     1,
//                     signer1Address,
//                     THIRD_PARTY_ID,
//                     TOKEN_ID,
//                     APP_ID,
//                     requestAmount,
//                     telebtcAmount,
//                     [inputToken.address, teleBTC.address],
//                     { 
//                         "userScript": USER_SCRIPT_P2PKH,
//                         "scriptType": USER_SCRIPT_P2PKH_TYPE
//                     }
//                 ]
//             );

//             await PolyConnector.connect(
//                 acrossSinger
//             ).handleV3AcrossMessage(
//                 inputToken.address,
//                 requestAmount,
//                 signer1Address,
//                 message
//             );

//             await expect(
//                 await PolyConnector.connect(signer1).failedReqs(
//                     signer1Address,
//                     1,
//                     inputToken.address
//                 )
//             ).to.equal(BigNumber.from(requestAmount));

//             let reDoMessage = abiUtils.encodeParameters(
//                 ["uint256", "address", "uint", "int64"],
//                 [1, inputToken.address, requestAmount + 1, 1000]
//             );

//             let messageHex = await web3.utils.soliditySha3({
//                 type: "bytes",
//                 value: reDoMessage,
//             });
//             if (messageHex != null) {
//                 let signature;
//                 let rsv;
//                 signature = await signer1.signMessage(
//                     ethers.utils.arrayify(messageHex)
//                 );
//                 rsv = await parseSignatureToRSV(signature);
//                 await setSwap(true, [requestAmount, telebtcAmount]);

//                 await expect(
//                     PolyConnector.connect(signer1).withdrawFundsToSourceChain(reDoMessage, rsv.v, rsv.r, rsv.s)
//                 ).to.be.revertedWith("PolyConnectorLogic: low balance");
//             }
//         });

//         // it("can withdraw Funds To Eth if amount is less than user request amount", async () => {
//         //     let message = abiUtils.encodeParameters([
//         //         'string',
//         //         'uint',
//         //         'address',
//         //         'address',
//         //         'uint',
//         //         'address[]',
//         //         'bytes',
//         //         'uint',
//         //         'bytes'
//         //     ], [
//         //         "swapAndUnwrap",
//         //         "1",
//         //         signer1Address,
//         //         mockExchangeConnector.address,
//         //         telebtcAmount,
//         //         [inputToken.address, teleBTC.address],
//         //         USER_SCRIPT_P2PKH,
//         //         USER_SCRIPT_P2PKH_TYPE,
//         //         LOCKER1_LOCKING_SCRIPT
//         //     ])

//         //     await setSwap(false, [requestAmount, telebtcAmount])
//         //     await mockAcross.mock.deposit.returns()
//         //     await PolyConnectorWithMockedAccross.connect(signer1).handleV3AcrossMessage(
//         //         inputToken.address,
//         //         requestAmount,
//         //         signer1Address,
//         //         message
//         //     )

//         //     await expect(
//         //         await PolyConnectorWithMockedAccross.failedReqs(signer1Address, inputToken.address)
//         //     ).to.equal(BigNumber.from(requestAmount))

//         //     await inputToken.transfer(
//         //         PolyConnectorWithMockedAccross.address,
//         //         requestAmount
//         //     );

//         //     let reDoMessage = abiUtils.encodeParameters([
//         //         'address',
//         //         'uint',
//         //         'int64'
//         //     ], [
//         //         inputToken.address,
//         //         requestAmount - 10,
//         //         1000
//         //     ])

//         //     let messageHex = await web3.utils.soliditySha3(
//         //         {
//         //             type: 'bytes',
//         //             value: reDoMessage
//         //         }
//         //     )
//         //     if (messageHex != null) {
//         //         let signature
//         //         let rsv
//         //         signature = await signer1.signMessage(ethers.utils.arrayify(messageHex))
//         //         rsv = await parseSignatureToRSV(signature)
//         //         await setSwap(true, [requestAmount, telebtcAmount])

//         //         await PolyConnectorWithMockedAccross.connect(signer1).withdrawFundsToSourceChain(
//         //             reDoMessage,
//         //             rsv.v,
//         //             rsv.r,
//         //             rsv.s
//         //         )

//         //         await expect(
//         //             await PolyConnectorWithMockedAccross.failedReqs(signer1Address, inputToken.address)
//         //         ).to.equal(10)
//         //     }
//         // });
//     });

//     describe("#Handle emergencyWithdraw", async () => {
//         it("should handle emergency withdraw token", async () => {
//             await inputToken.transfer(PolyConnector.address, requestAmount);

//             await expect(
//                 await inputToken.balanceOf(PolyConnector.address)
//             ).to.be.equal(requestAmount);

//             await PolyConnector.emergencyWithdraw(
//                 inputToken.address,
//                 signer1Address,
//                 requestAmount
//             );

//             await expect(
//                 await inputToken.balanceOf(PolyConnector.address)
//             ).to.be.equal(0);

//             await expect(
//                 await inputToken.balanceOf(signer1Address)
//             ).to.be.equal(requestAmount);
//         });

//         it("should handle emergency withdraw eth", async () => {
//             let tx = {
//                 to: PolyConnector.address,
//                 value: 100,
//             };
//             await signer1.sendTransaction(tx);

//             let beforeBalance = await signer1.getBalance();
//             beforeBalance.add(100);

//             await expect(
//                 await provider.getBalance(PolyConnector.address)
//             ).to.be.equal(100);

//             await PolyConnector.emergencyWithdraw(
//                 "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
//                 signer1Address,
//                 100
//             );
//         });

//         // write test that only owner can emergency withdraw
//         it("should not handle emergency withdraw if not owner", async () => {
//             await expect(
//                 PolyConnector.connect(signer1).emergencyWithdraw(
//                     inputToken.address,
//                     signer1Address,
//                     requestAmount
//                 )
//             ).to.be.revertedWith("Ownable: caller is not the owner");
//         });
//     });
// });
