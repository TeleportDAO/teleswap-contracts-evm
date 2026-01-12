// const CC_EXCHANGE_REQUESTS = require('./test_fixtures/ccExchangeRequests.json');
// require('dotenv').config({path:"../../.env"});

// import { expect } from "chai";
// import { deployments, ethers } from "hardhat";
// import { Signer, BigNumber, Contract } from "ethers";
// import { deployMockContract, MockContract } from "@ethereum-waffle/mock-contract";

// import { UniswapV2Pair } from "../src/types/UniswapV2Pair";
// import { UniswapV2Pair__factory } from "../src/types/factories/UniswapV2Pair__factory";
// import { UniswapV2Factory } from "../src/types/UniswapV2Factory";
// import { UniswapV2Factory__factory } from "../src/types/factories/UniswapV2Factory__factory";
// import { UniswapV2Router02 } from "../src/types/UniswapV2Router02";
// import { UniswapV2Router02__factory } from "../src/types/factories/UniswapV2Router02__factory";
// import { UniswapV2Connector } from "../src/types/UniswapV2Connector";
// import { UniswapV2Connector__factory } from "../src/types/factories/UniswapV2Connector__factory";

// import { CcExchangeRouterProxy__factory } from "../src/types/factories/CcExchangeRouterProxy__factory";
// import { CcExchangeRouterLogicWithFiller__factory } from "../src/types/factories/CcExchangeRouterLogicWithFiller__factory";

// import { LockersManagerProxy__factory } from "../src/types/factories/LockersManagerProxy__factory";
// import { LockersManagerLogic__factory } from "../src/types/factories/LockersManagerLogic__factory";
// import { LockersManagerLogicLibraryAddresses } from "../src/types/factories/LockersManagerLogic__factory";

// import { LockersManagerLib } from "../src/types/LockersManagerLib";
// import { LockersManagerLib__factory } from "../src/types/factories/LockersManagerLib__factory";

// import { TeleBTCLogic } from "../src/types/TeleBTCLogic";
// import { TeleBTCLogic__factory } from "../src/types/factories/TeleBTCLogic__factory";
// import { TeleBTCProxy } from "../src/types/TeleBTCProxy";
// import { TeleBTCProxy__factory } from "../src/types/factories/TeleBTCProxy__factory";
// import { ERC20 } from "../src/types/ERC20";
// import { Erc20__factory } from "../src/types/factories/Erc20__factory";
// import { WETH } from "../src/types/WETH";
// import { WETH__factory } from "../src/types/factories/WETH__factory";

// import { advanceBlockWithTime, takeSnapshot, revertProvider } from "./block_utils";

// const { time } = require('@nomicfoundation/hardhat-network-helpers');

// describe("CcExchangeRouter", async () => {

//     let snapshotId: any;

//     // Constants
//     const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
//     const ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
//     const DUMMY_ADDRESS = "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
//     const CHAIN_ID = 1;
//     const APP_ID = 1;
//     const PROTOCOL_PERCENTAGE_FEE = 10; // Means %0.1
//     const LOCKER_PERCENTAGE_FEE = 20; // Means %0.2
//     const PRICE_WITH_DISCOUNT_RATIO = 9500; // Means %95
//     const STARTING_BLOCK_NUMBER = 1;
//     const TREASURY = "0x0000000000000000000000000000000000000002";
//     const FILLING_DELAY = 1440000;

//     // Bitcoin public key (32 bytes)
//     let LOCKER1_LOCKING_SCRIPT = '0xa9144062c8aeed4f81c2d73ff854a2957021191e20b687';

//     let LOCKER_RESCUE_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
//     let LOCKER_RESCUE_SCRIPT_P2PKH_TYPE = 1; // P2PKH

//     let telePortTokenInitialSupply = BigNumber.from(10).pow(18).mul(10000);
//     let minRequiredTNTLockedAmount = BigNumber.from(10).pow(18).mul(5);
//     let collateralRatio = 20000;
//     let liquidationRatio = 15000;

//     // Accounts
//     let proxyAdmin: Signer;
//     let deployer: Signer;
//     let signer1: Signer;
//     let signer2: Signer;
//     let locker: Signer;
//     let proxyAdminAddress: string;
//     let deployerAddress: string;
//     let lockerAddress: string;

//     // Contracts
//     let exchangeConnector: UniswapV2Connector;
//     let uniswapV2Router02: UniswapV2Router02;
//     let uniswapV2Pair: UniswapV2Pair;
//     let uniswapV2Factory: UniswapV2Factory;
//     let ccExchangeRouter: Contract;
//     let lockersLib: LockersManagerLib;
//     let lockers: Contract;
//     let teleBTC: TeleBTC;
//     let teleportDAOToken: ERC20;
//     let exchangeToken: ERC20;
//     let anotherExchangeToken: ERC20;
//     let weth: WETH;

//     // Mock contracts
//     let mockBitcoinRelay: MockContract;
//     let mockInstantRouter: MockContract;
//     let mockPriceOracle: MockContract;

//     //
//     let uniswapV2Pair__factory: UniswapV2Pair__factory;

//     let address1 = "0x0000000000000000000000000000000000000001"


//     before(async () => {
//         // Sets accounts
//         [proxyAdmin, deployer, signer1, locker, signer2] = await ethers.getSigners();
//         proxyAdminAddress = await proxyAdmin.getAddress();
//         deployerAddress = await deployer.getAddress();
//         lockerAddress = await locker.getAddress();

//         teleportDAOToken = await deployTeleportDAOToken();

//         // Mocks relay contract
//         const bitcoinRelayContract = await deployments.getArtifact(
//             "IBitcoinRelay"
//         );
//         mockBitcoinRelay = await deployMockContract(
//             deployer,
//             bitcoinRelayContract.abi
//         );

//         const priceOracleContract = await deployments.getArtifact(
//             "IPriceOracle"
//         );
//         mockPriceOracle = await deployMockContract(
//             deployer,
//             priceOracleContract.abi
//         );

//         await mockPriceOracle.mock.equivalentOutputAmount.returns(100000)

//         // Mocks checkTxProof of bitcoinRelay
//         // We don't pass arguments since the request was modified and the txId is not valid
//         await mockBitcoinRelay.mock.getBlockHeaderFee.returns(0); // Fee of relay
//         await mockBitcoinRelay.mock.checkTxProof.returns(true);

//         // // Mocks instant router contract
//         // const instantRouterContract = await deployments.getArtifact(
//         //     "IInstantRouter"
//         // );
//         // mockInstantRouter = await deployMockContract(
//         //     deployer,
//         //     instantRouterContract.abi
//         // );

//         // await mockInstantRouter.mock.payBackLoan.returns(true);

//         // Deploys teleBTC contract

//         const teleBTCLogicFactory = new TeleBTCLogic__factory(deployer);
//         const teleBTCLogic = await teleBTCLogicFactory.deploy();

//         const teleBTCProxyFactory = new TeleBTCProxy__factory(deployer);
//         const teleBTCProxy = await teleBTCProxyFactory.deploy(
//             teleBTCLogic.address,    
//             proxyAdminAddress,
//             "0x"
//         );
        
//         teleBTC = await teleBTCLogic.attach(
//             teleBTCProxy.address
//         );

//         await teleBTC.initialize(
//             "TeleportDAO-BTC",
//             "teleBTC"
//         );

//         // Deploys WETH contract
//         const wethFactory = new WETH__factory(deployer);
//         weth = await wethFactory.deploy(
//             "WrappedEthereum",
//             "WETH"
//         );

//         // Deploys uniswapV2Factory
//         const uniswapV2FactoryFactory = new UniswapV2Factory__factory(deployer);
//         uniswapV2Factory = await uniswapV2FactoryFactory.deploy(
//             deployerAddress
//         );

//         // Creates uniswapV2Pair__factory object
//         uniswapV2Pair__factory = new UniswapV2Pair__factory(deployer);

//         // Deploys uniswapV2Router02 contract
//         const uniswapV2Router02Factory = new UniswapV2Router02__factory(deployer);
//         uniswapV2Router02 = await uniswapV2Router02Factory.deploy(
//             uniswapV2Factory.address,
//             weth.address // WETH
//         );

//         // Deploys uniswap connector
//         const exchangeConnectorFactory = new UniswapV2Connector__factory(deployer);
//         exchangeConnector = await exchangeConnectorFactory.deploy(
//             "TheExchangeConnector",
//             uniswapV2Router02.address
//         );

//         // Deploys exchange token
//         // We replace the exchangeToken address in ccExchangeRequests
//         const erc20Factory = new Erc20__factory(deployer);
//         exchangeToken = await erc20Factory.deploy(
//             "TestToken",
//             "TT",
//             100000
//         );

//         // Deploys an ERC20 token
//         anotherExchangeToken = await erc20Factory.deploy(
//             "AnotherTestToken",
//             "ATT",
//             100000
//         );

//         lockers = await deployLockers();

//         // Deploys ccExchangeRouter contract
//         const ccExchangeRouterLogicFactory = new CcExchangeRouterLogicWithFiller__factory(deployer);
//         const ccExchangeRouterLogic = await ccExchangeRouterLogicFactory.deploy();

//         const ccExchangeRouterProxyFactory = new CcExchangeRouterProxy__factory(deployer);
//         const ccExchangeRouterProxy = await ccExchangeRouterProxyFactory.deploy(
//             ccExchangeRouterLogic.address,    
//             proxyAdminAddress,
//             "0x"
//         );
        
//         ccExchangeRouter = await ccExchangeRouterLogic.attach(
//             ccExchangeRouterProxy.address
//         );

//         await ccExchangeRouter.initialize(
//             STARTING_BLOCK_NUMBER,
//             PROTOCOL_PERCENTAGE_FEE,
//             CHAIN_ID,
//             lockers.address,
//             mockBitcoinRelay.address,
//             teleBTC.address,
//             TREASURY
//         );

//         // Sets exchangeConnector address in ccExchangeRouter
//         await ccExchangeRouter.setExchangeConnector(APP_ID, exchangeConnector.address);

//         await lockers.setTeleBTC(teleBTC.address)
//         await lockers.addMinter(ccExchangeRouter.address)

//         await teleBTC.addMinter(lockers.address)
//         await teleBTC.addBurner(lockers.address)

//         await ccExchangeRouter.setLockers(lockers.address)
//         // await ccExchangeRouter.setInstantRouter(mockInstantRouter.address)
//     });

//     const deployTeleportDAOToken = async (
//         _signer?: Signer
//     ): Promise<ERC20> => {
//         const erc20Factory = new Erc20__factory(
//             _signer || deployer
//         );

//         const teleportDAOToken = await erc20Factory.deploy(
//             "TeleportDAOToken",
//             "TST",
//             telePortTokenInitialSupply
//         );

//         return teleportDAOToken;
//     };

//     const deployLockersManagerLib = async (
//         _signer?: Signer
//     ): Promise<LockersManagerLib> => {
//         const LockersManagerLibFactory = new LockersManagerLib__factory(
//             _signer || deployer
//         );

//         const lockersLib = await LockersManagerLibFactory.deploy(
//         );

//         return lockersLib;
//     };

//     const deployLockers = async (
//         _signer?: Signer
//     ): Promise<Contract> => {

//         lockersLib = await deployLockersManagerLib()

//         let linkLibraryAddresses: LockersManagerLogicLibraryAddresses;

//         linkLibraryAddresses = {
//             "contracts/libraries/LockersManagerLib.sol:LockersManagerLib": lockersLib.address,
//         };

//         // Deploys lockers logic
//         const lockersLogicFactory = new LockersManagerLogic__factory(
//             linkLibraryAddresses,
//             _signer || deployer
//         );

//         const lockersLogic = await lockersLogicFactory.deploy();

//         // Deploys lockers proxy
//         const lockersProxyFactory = new LockersManagerProxy__factory(
//             _signer || deployer
//         );
//         const lockersProxy = await lockersProxyFactory.deploy(
//             lockersLogic.address,
//             proxyAdminAddress,
//             "0x"
//         )

//         const lockers = await lockersLogic.attach(
//             lockersProxy.address
//         );

//         // Initializes lockers proxy
//         await lockers.initialize(
//             teleBTC.address,
//             teleportDAOToken.address,
//             ONE_ADDRESS,
//             mockPriceOracle.address,
//             ONE_ADDRESS,
//             0,
//             minRequiredTNTLockedAmount,
//             collateralRatio,
//             liquidationRatio,
//             LOCKER_PERCENTAGE_FEE,
//             PRICE_WITH_DISCOUNT_RATIO
//         )

//         return lockers;
//     };

//     async function addLockerToLockers(): Promise<void> {

//         let lockerlocker = lockers.connect(locker)

//         await lockerlocker.requestToBecomeLocker(
//             LOCKER1_LOCKING_SCRIPT,
//             0,
//             minRequiredTNTLockedAmount,
//             LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
//             LOCKER_RESCUE_SCRIPT_P2PKH,
//             {value: minRequiredTNTLockedAmount}
//         )

//         await lockers.addLocker(lockerAddress)
//     }

//     describe.only("#ccExchangeWithFiller", async () => {
//         let oldReserveTeleBTC: BigNumber;
//         let oldReserveTT: BigNumber;
//         let oldDeployerBalanceTeleBTC: BigNumber;
//         let oldUserBalanceTeleBTC: BigNumber;
//         let oldDeployerBalanceTT: BigNumber;
//         let oldUserBalanceTT: BigNumber;
//         let oldTotalSupplyTeleBTC: BigNumber;

//         function calculateFees(request: any): [number, number, number] {
//             // Calculates fees
//             let lockerFee = Math.floor(
//                 request.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
//             );
//             let teleporterFee = Math.floor(
//                 request.bitcoinAmount*
//                 request.teleporterFee/10000
//             );
//             let protocolFee = Math.floor(
//                 request.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
//             );

//             return[lockerFee, teleporterFee, protocolFee]
//         }

//         async function checksWhenExchangeSucceed(
//             _exchangeToken: any,
//             isFixedToken: boolean,
//             recipientAddress: string,
//             bitcoinAmount: number,
//             teleporterFee: number,
//             protocolFee: number,
//             lockerFee: number,
//             expectedOutputAmount: number,
//             requiredInputAmount?: number
//         ) {
//             // General checks

//             // Records new supply of teleBTC
//             let newTotalSupplyTeleBTC = await teleBTC.totalSupply();

//             // Records new teleBTC and TT balances of user
//             let newUserBalanceTeleBTC = await teleBTC.balanceOf(
//                 recipientAddress
//             );
//             let newUserBalanceTT = await _exchangeToken.balanceOf(
//                 recipientAddress
//             );

//             // Records new teleBTC and TST balances of teleporter
//             let newDeployerBalanceTeleBTC = await teleBTC.balanceOf(deployerAddress);
//             let newDeployerBalanceTT = await _exchangeToken.balanceOf(deployerAddress);

//             // Checks that extra teleBTC hasn't been minted
//             expect(newTotalSupplyTeleBTC).to.equal(
//                 oldTotalSupplyTeleBTC.add(bitcoinAmount)
//             );

//             // Checks that enough teleBTC has been minted for teleporter
//             expect(newDeployerBalanceTeleBTC).to.equal(
//                 oldDeployerBalanceTeleBTC.add(teleporterFee)
//             );

//             // Checks that teleporter TT balance hasn't changed
//             expect(newDeployerBalanceTT).to.equal(
//                 oldDeployerBalanceTT
//             );

//             // Checks that correct amount of teleBTC has been minted for protocol
//             expect(
//                 await teleBTC.balanceOf(TREASURY)
//             ).to.equal(protocolFee);

//             // Checks that correct amount of teleBTC has been minted for locker
//             expect(
//                 await teleBTC.balanceOf(lockerAddress)
//             ).to.equal(lockerFee);

//             // Checks that user received enough TT
//             expect(newUserBalanceTT).to.equal(
//                 oldUserBalanceTT.add(expectedOutputAmount)
//             );

//             if (isFixedToken == true) {
//                 // Checks that user teleBTC balance hasn't changed
//                 expect(newUserBalanceTeleBTC).to.equal(
//                     oldUserBalanceTeleBTC
//                 );
//             } else {
//                 // Checks that user received unused teleBTC
//                 if (requiredInputAmount != undefined) {
//                     expect(newUserBalanceTeleBTC).to.equal(
//                         oldUserBalanceTeleBTC.toNumber() +
//                         bitcoinAmount -
//                         teleporterFee -
//                         lockerFee -
//                         protocolFee -
//                         requiredInputAmount
//                     );
//                 }
//             }
//         }

//         async function checksWhenExchangeFails(
//             recipientAddress: string,
//             bitcoinAmount: number,
//             teleporterFee: number,
//             protocolFee: number,
//             lockerFee: number
//         ) {
//             // Records new supply of teleBTC
//             let newTotalSupplyTeleBTC = await teleBTC.totalSupply();

//             // Records new teleBTC and TST balances of user
//             let newUserBalanceTeleBTC = await teleBTC.balanceOf(
//                 recipientAddress
//             );
//             let newUserBalanceTT = await exchangeToken.balanceOf(
//                 recipientAddress
//             );

//             // Records new teleBTC and TST balances of teleporter
//             let newDeployerBalanceTeleBTC = await teleBTC.balanceOf(deployerAddress);
//             let newDeployerBalanceTT = await exchangeToken.balanceOf(deployerAddress);

//             // Checks enough teleBTC has been minted for user
//             expect(newUserBalanceTeleBTC).to.equal(
//                 oldUserBalanceTeleBTC.add(
//                     bitcoinAmount - lockerFee - teleporterFee - protocolFee
//                 )
//             );

//             // Checks that enough teleBTC has been minted for teleporter
//             expect(newDeployerBalanceTeleBTC).to.equal(
//                 oldDeployerBalanceTeleBTC.add(teleporterFee)
//             );

//             // Checks that user TT balance hasn't changed
//             expect(newUserBalanceTT).to.equal(
//                 oldUserBalanceTT
//             );

//             // Checks that correct amount of teleBTC has been minted for protocol
//             expect(
//                 await teleBTC.balanceOf(TREASURY)
//             ).to.equal(protocolFee);

//             // Checks that correct amount of teleBTC has been minted for locker
//             expect(
//                 await teleBTC.balanceOf(lockerAddress)
//             ).to.equal(lockerFee);

//             // Checks extra teleBTC hasn't been minted
//             expect(newTotalSupplyTeleBTC).to.equal(
//                 oldTotalSupplyTeleBTC.add(bitcoinAmount)
//             );
//         }

//         beforeEach("Adds liquidity to liquidity pool", async () => {
//             // Takes snapshot before adding liquidity
//             snapshotId = await takeSnapshot(deployer.provider);

//             // Adds liquidity to teleBTC-TST liquidity pool
//             await teleBTC.addMinter(deployerAddress)
//             await teleBTC.mint(deployerAddress, 10000000);
//             await teleBTC.approve(uniswapV2Router02.address, 10000);
//             await exchangeToken.approve(uniswapV2Router02.address, 10000);
//             let addedLiquidityA = 10000;
//             let addedLiquidityB = 10000;

//             // console.log(await teleBTC.balanceOf(deployerAddress))
//             // await uniswapV2Router02.addLiquidity(
//             //     teleBTC.address,
//             //     exchangeToken.address,
//             //     addedLiquidityA,
//             //     addedLiquidityB,
//             //     0, // Minimum added liquidity for first token
//             //     0, // Minimum added liquidity for second token
//             //     deployerAddress,
//             //     1000000000000000, // Long deadline
//             // );

//             // // Creates liquidity pool of TeleBTC-WETH and adds liquidity in it
//             // await teleBTC.approve(uniswapV2Router02.address, 10000);
//             // await uniswapV2Router02.addLiquidityETH(
//             //     teleBTC.address,
//             //     10000,
//             //     0, // Minimum added liquidity for first token
//             //     0, // Minimum added liquidity for second token
//             //     deployerAddress,
//             //     10000000000000, // Long deadline
//             //     {value: 10000}
//             // );

//             let liquidityPoolAddress = await uniswapV2Factory.getPair(
//                 teleBTC.address,
//                 exchangeToken.address
//             );

//             // Records total supply of teleBTC
//             oldTotalSupplyTeleBTC = await teleBTC.totalSupply();


//             // Loads teleBTC-TST liquidity pool
//             uniswapV2Pair = await uniswapV2Pair__factory.attach(liquidityPoolAddress);

//             // Records current reserves of teleBTC and TT
//             // if (await uniswapV2Pair.token0() == teleBTC.address) {
//             //     [oldReserveTeleBTC, oldReserveTT] = await uniswapV2Pair.getReserves();
//             // } else {
//             //     [oldReserveTT, oldReserveTeleBTC] = await uniswapV2Pair.getReserves()
//             // }

//             // Records current teleBTC and TT balances of user and teleporter
//             oldUserBalanceTeleBTC = await teleBTC.balanceOf(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress
//             );
//             oldDeployerBalanceTeleBTC = await teleBTC.balanceOf(deployerAddress);
//             oldUserBalanceTT = await exchangeToken.balanceOf(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress
//             );
//             oldDeployerBalanceTT = await exchangeToken.balanceOf(deployerAddress);


//             await ccExchangeRouter.setFillerWithdrawInterval(144000);

//             await addLockerToLockers();
//         });

//         afterEach(async () => {
//             // Reverts the state to the before of adding liquidity
//             await revertProvider(deployer.provider, snapshotId);
//         });

//         async function getTimestamp(): Promise<number> {
//             let lastBlockNumber = await ethers.provider.getBlockNumber();
//             let lastBlock = await ethers.provider.getBlock(lastBlockNumber);
//             return lastBlock.timestamp;
//         }

//         it("Filler can fill a txId", async function () {
//             let txId = "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d"
//             await exchangeToken.approve(ccExchangeRouter.address, 1000);
//             await expect(
//                 ccExchangeRouter.fillTx(
//                     txId,
//                     exchangeToken.address,
//                     1000

//                 )
//             ).to.emit(
//                 ccExchangeRouter, "NewFill"
//             ).withArgs(deployerAddress, txId, exchangeToken.address, 1000);
//         })

//         it("When first filler fill a tx, a timer will be started and it will be not changed", async function () {
//             let txId = "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d"
//             await exchangeToken.approve(ccExchangeRouter.address, 2000);
//             await exchangeToken.transfer(signer1.address, 1000);
//             await exchangeToken.connect(signer1).approve(ccExchangeRouter.address, 1000);

//             await expect(
//                 ccExchangeRouter.fillTx(
//                     txId,
//                     exchangeToken.address,
//                     1000
//                 )
//             ).to.emit(
//                 ccExchangeRouter, "TxIdFillStart"
//             )

//             let oldFillingStartTime = await ccExchangeRouter.txsFillData(txId).startingTime

//             await expect(
//                 ccExchangeRouter.connect(signer1).fillTx(
//                     txId,
//                     exchangeToken.address,
//                     1000
//                 )
//             ).to.not.emit(
//                 ccExchangeRouter, "TxIdFillStart"
//             )

//             let newFillingStartTime = await ccExchangeRouter.txsFillData(txId).startingTime

//             await expect(
//                 oldFillingStartTime
//             ).to.be.equal(
//                 newFillingStartTime
//             )
//         })

//         it("A filler can't fill a tx twice", async function () {
//             let txId = "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d"
//             await exchangeToken.approve(ccExchangeRouter.address, 2000);

//             await expect(
//                 ccExchangeRouter.fillTx(
//                     txId,
//                     exchangeToken.address,
//                     1000
//                 )
//             ).to.emit(
//                 ccExchangeRouter, "TxIdFillStart"
//             )


//             await expect(
//                 ccExchangeRouter.fillTx(
//                     txId,
//                     exchangeToken.address,
//                     1000
//                 )
//             ).to.be.revertedWith(
//                 "CCExchangeRouter: already filled txid"
//             )
//         })

//         it("filler can't withdraw funds before transaction is submitted or filling time interval is passed", async function () {
//             let txId = "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d"
//             await exchangeToken.approve(ccExchangeRouter.address, 1000);
//             await ccExchangeRouter.fillTx(
//                 txId,
//                 exchangeToken.address,
//                 1000
//             )

//             await expect(
//                 ccExchangeRouter.returnUnusedFills(
//                     txId
//                 )
//             ).to.be.revertedWith(
//                 "CCExchangeRouter: request is not proccessed yet or time interval for withdraw is not passed"
//             )
//         })

//         it("filler can withdraw funds after filling time interval is passed", async function () {
//             let txId = "0x344e6fed192d01647ef2f715e29474ba6eef54cc197d9f59d3d05cf249f3a09d"
//             await exchangeToken.approve(ccExchangeRouter.address, 1000);
//             await ccExchangeRouter.fillTx(
//                 txId,
//                 exchangeToken.address,
//                 1000
//             )

//             let lastBlockTimestamp = await getTimestamp();
//             await advanceBlockWithTime(deployer.provider, FILLING_DELAY + 1);

//             await expect(
//                 ccExchangeRouter.returnUnusedFills(
//                     txId
//                 )
//             ).to.emit(
//                 exchangeToken, "Transfer"
//             ).withArgs(ccExchangeRouter.address, deployer.address, 1000)
//         })

//         it("fill tx successfully (one filler more than needed amount)", async function () {
//             await exchangeToken.approve(ccExchangeRouter.address, 1000);
//             await ccExchangeRouter.fillTx(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId,
//                 exchangeToken.address,
//                 1000
//             )

//             // Replaces dummy address in vout with exchange token address
//             let vout = CC_EXCHANGE_REQUESTS.fixedRateCCExchange.vout;
//             vout = vout.replace(DUMMY_ADDRESS, exchangeToken.address.slice(2, exchangeToken.address.length));

//             // Calculates fees
//             let [lockerFee, teleporterFee, protocolFee] = calculateFees(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange
//             );

//             // Exchanges teleBTC for TT
//             expect(
//                 await ccExchangeRouter.ccExchange(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.version,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.vin,
//                     vout,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.locktime,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.blockNumber,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.intermediateNodes,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.index,
//                     LOCKER1_LOCKING_SCRIPT,
//                 )
//             ).to.emit(ccExchangeRouter, 'CCExchange').withArgs(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress,
//                 teleBTC.address,
//                 exchangeToken.address,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.bitcoinAmount - teleporterFee - lockerFee - protocolFee,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount,
//                 0,
//                 deployerAddress,
//                 teleporterFee
//             );


//             await expect(
//                 ccExchangeRouter.returnUnusedFills(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.emit(
//                 exchangeToken, "Transfer"
//             ).withArgs(ccExchangeRouter.address, deployer.address, 1000 - CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount)

//             await expect(
//                 ccExchangeRouter.receiveFillBenefit(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.emit(
//                 teleBTC, "Transfer"
//             ).withArgs(ccExchangeRouter.address, deployer.address, CC_EXCHANGE_REQUESTS.fixedRateCCExchange.bitcoinAmount - teleporterFee - lockerFee - protocolFee)

//         })

//         it("fill tx with ethereum successfully (one filler more than needed amount)", async function () {
//             await ccExchangeRouter.fillTx(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.txId,
//                 address1,
//                 BigNumber.from("1000000000000000000000"),
//                 {value: BigNumber.from("1000000000000000000000")}
//             )

//             // Replaces dummy address in vout with exchange token address
//             let vout = CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.vout;
//             vout = vout.replace(DUMMY_ADDRESS, address1.slice(2, address1.length));

//             // Calculates fees
//             let [lockerFee, teleporterFee, protocolFee] = calculateFees(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth
//             );

//             // Exchanges teleBTC for TT
//             expect(
//                 await ccExchangeRouter.ccExchange(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.version,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.vin,
//                     vout,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.locktime,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.blockNumber,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.intermediateNodes,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.index,
//                     LOCKER1_LOCKING_SCRIPT,
//                 )
//             ).to.emit(ccExchangeRouter, 'CCExchange').withArgs(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.recipientAddress,
//                 teleBTC.address,
//                 address1,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.bitcoinAmount - teleporterFee - lockerFee - protocolFee,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.exchangeAmount,
//                 0,
//                 deployerAddress,
//                 teleporterFee
//             );

//             let oldEthBalance = await ccExchangeRouter.provider.getBalance(deployerAddress)
            
//             await ccExchangeRouter.returnUnusedFills(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.txId
//             )

//             let newEthBalance = await ccExchangeRouter.provider.getBalance(deployerAddress)

//             await expect(newEthBalance - oldEthBalance).to.be.greaterThan(900000000000000000000)

//             await expect(
//                 ccExchangeRouter.receiveFillBenefit(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.txId
//                 )
//             ).to.emit(
//                 teleBTC, "Transfer"
//             ).withArgs(ccExchangeRouter.address, deployer.address, CC_EXCHANGE_REQUESTS.fixedRateCCExchangeWithEth.bitcoinAmount - teleporterFee - lockerFee - protocolFee)

//         })

//         it("can't withdraw remaining amount of last fill twice", async function () {
//             await exchangeToken.approve(ccExchangeRouter.address, 1000);
//             await ccExchangeRouter.fillTx(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId,
//                 exchangeToken.address,
//                 1000
//             )

//             // Replaces dummy address in vout with exchange token address
//             let vout = CC_EXCHANGE_REQUESTS.fixedRateCCExchange.vout;
//             vout = vout.replace(DUMMY_ADDRESS, exchangeToken.address.slice(2, exchangeToken.address.length));

//             // Calculates fees
//             let [lockerFee, teleporterFee, protocolFee] = calculateFees(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange
//             );

//             // Exchanges teleBTC for TT
//             await ccExchangeRouter.ccExchange(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.version,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.vin,
//                 vout,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.locktime,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.blockNumber,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.intermediateNodes,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.index,
//                 LOCKER1_LOCKING_SCRIPT,
//             )

//             await expect(
//                 ccExchangeRouter.returnUnusedFills(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.emit(
//                 exchangeToken, "Transfer"
//             ).withArgs(ccExchangeRouter.address, deployer.address, 1000 - CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount)

//             await expect(
//                 ccExchangeRouter.returnUnusedFills(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.not.emit(
//                 exchangeToken, "Transfer"
//             )

//         })

//         it("can't fill tx because fillers provide insufficient amount", async function () {
//             await exchangeToken.approve(ccExchangeRouter.address, 10);
//             await ccExchangeRouter.fillTx(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId,
//                 exchangeToken.address,
//                 10
//             )

//             // Replaces dummy address in vout with exchange token address
//             let vout = CC_EXCHANGE_REQUESTS.fixedRateCCExchange.vout;
//             vout = vout.replace(DUMMY_ADDRESS, exchangeToken.address.slice(2, exchangeToken.address.length));

//             // Calculates fees
//             let [lockerFee, teleporterFee, protocolFee] = calculateFees(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange
//             );

//             console.log(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.bitcoinAmount - teleporterFee - lockerFee - protocolFee,
//                 oldReserveTeleBTC,
//                 oldReserveTT
//             )
//             let expectedOutputAmount = await uniswapV2Router02.getAmountOut(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.bitcoinAmount - teleporterFee - lockerFee - protocolFee,
//                 oldReserveTeleBTC,
//                 oldReserveTT
//             );

//             // Exchanges teleBTC for TT
//             expect(
//                 await ccExchangeRouter.ccExchange(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.version,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.vin,
//                     vout,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.locktime,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.blockNumber,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.intermediateNodes,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.index,
//                     LOCKER1_LOCKING_SCRIPT,
//                 )
//             ).to.emit(ccExchangeRouter, 'CCExchange').withArgs(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress,
//                 teleBTC.address,
//                 exchangeToken.address,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.bitcoinAmount - teleporterFee - lockerFee - protocolFee,
//                 expectedOutputAmount,
//                 0,
//                 deployerAddress,
//                 teleporterFee
//             );

//             await expect(
//                 ccExchangeRouter.returnUnusedFills(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.emit(
//                 exchangeToken, "Transfer"
//             ).withArgs(ccExchangeRouter.address, deployer.address, 10)

//         })

//         it("fill tx successfully (three fillers more than needed amount)", async function () {
//             await exchangeToken.approve(ccExchangeRouter.address, 5);
//             await exchangeToken.transfer(signer1.address, 20);
//             await exchangeToken.connect(signer1).approve(ccExchangeRouter.address, 20);
//             await exchangeToken.transfer(signer2.address, 20);
//             await exchangeToken.connect(signer2).approve(ccExchangeRouter.address, 20);

//             await ccExchangeRouter.fillTx(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId,
//                 exchangeToken.address,
//                 5
//             )

//             await ccExchangeRouter.connect(signer1).fillTx(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId,
//                 exchangeToken.address,
//                 20
//             )

//             await ccExchangeRouter.connect(signer2).fillTx(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId,
//                 exchangeToken.address,
//                 20
//             )

//             // Replaces dummy address in vout with exchange token address
//             let vout = CC_EXCHANGE_REQUESTS.fixedRateCCExchange.vout;
//             vout = vout.replace(DUMMY_ADDRESS, exchangeToken.address.slice(2, exchangeToken.address.length));

//             // Calculates fees
//             let [lockerFee, teleporterFee, protocolFee] = calculateFees(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange
//             );

//             // Exchanges teleBTC for TT
//             expect(
//                 await ccExchangeRouter.ccExchange(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.version,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.vin,
//                     vout,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.locktime,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.blockNumber,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.intermediateNodes,
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.index,
//                     LOCKER1_LOCKING_SCRIPT,
//                 )
//             ).to.emit(ccExchangeRouter, 'CCExchange').withArgs(
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.recipientAddress,
//                 teleBTC.address,
//                 exchangeToken.address,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.bitcoinAmount - teleporterFee - lockerFee - protocolFee,
//                 CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount,
//                 0,
//                 deployerAddress,
//                 teleporterFee
//             );

//             await expect(
//                 ccExchangeRouter.returnUnusedFills(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.not.emit(
//                 exchangeToken, "Transfer"
//             )

//             await expect(
//                 ccExchangeRouter.connect(signer1).returnUnusedFills(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.emit(
//                 exchangeToken, "Transfer"
//             ).withArgs(ccExchangeRouter.address, signer1.address, 25 - CC_EXCHANGE_REQUESTS.fixedRateCCExchange.exchangeAmount)


//             await expect(
//                 ccExchangeRouter.connect(signer2).returnUnusedFills(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.emit(
//                 exchangeToken, "Transfer"
//             ).withArgs(ccExchangeRouter.address, signer2.address, 20)


//             await expect(
//                 ccExchangeRouter.receiveFillBenefit(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.emit(
//                 teleBTC, "Transfer"
//             ).withArgs(ccExchangeRouter.address, deployer.address, Math.floor((CC_EXCHANGE_REQUESTS.fixedRateCCExchange.bitcoinAmount - teleporterFee - lockerFee - protocolFee) * 5 / 17))

//             await expect(
//                 ccExchangeRouter.connect(signer1).receiveFillBenefit(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.emit(
//                 teleBTC, "Transfer"
//             ).withArgs(ccExchangeRouter.address, signer1.address, Math.floor((CC_EXCHANGE_REQUESTS.fixedRateCCExchange.bitcoinAmount - teleporterFee - lockerFee - protocolFee) * 12 / 17))

//             await expect(
//                 ccExchangeRouter.receiveFillBenefit(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.not.emit(
//                 teleBTC, "Transfer"
//             )

//             await expect(
//                 ccExchangeRouter.connect(signer1).receiveFillBenefit(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.not.emit(
//                 teleBTC, "Transfer"
//             )

//             await expect(
//                 ccExchangeRouter.connect(signer2).receiveFillBenefit(
//                     CC_EXCHANGE_REQUESTS.fixedRateCCExchange.txId
//                 )
//             ).to.not.emit(
//                 teleBTC, "Transfer"
//             )
//         })
//     });


//     describe("#setters", async () => {

//         beforeEach(async () => {
//             snapshotId = await takeSnapshot(signer1.provider);
//         });

//         afterEach(async () => {
//             await revertProvider(signer1.provider, snapshotId);
//         });

//         it("Sets filler withdraw interval", async function () {
//             await expect(
//                 ccExchangeRouter.setFillerWithdrawInterval(100)
//             ).to.emit(
//                 ccExchangeRouter, "NewFillerWithdrawInterval"
//             ).withArgs(0, 100);

//             expect(
//                 await ccExchangeRouter.fillerWithdrawInterval()
//             ).to.equal(100);
//         })

//     });

// });