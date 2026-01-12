const CC_REQUESTS = require('./test_fixtures/ccTransferRequests.json');
require('dotenv').config({path:"../../.env"});

import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { Signer, BigNumber } from "ethers";
import { deployMockContract, MockContract } from "@ethereum-waffle/mock-contract";
import { Contract } from "@ethersproject/contracts";
import { Address } from "hardhat-deploy/types";

import { Brc20RouterLib } from "../src/types/Brc20RouterLib";
import { Brc20RouterProxy__factory } from "../src/types/factories/Brc20RouterProxy__factory";
import { Brc20RouterLib__factory } from "../src/types/factories/Brc20RouterLib__factory";
import { Brc20RouterLogic__factory, Brc20RouterLogicLibraryAddresses } from "../src/types/factories/Brc20RouterLogic__factory";

import { Erc20 } from "../src/types/ERC20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";

import { WBRC20Logic } from "../src/types/WBRC20Logic";
import { WBRC20Proxy } from "../src/types/WBRC20Proxy"; 
import { WBRC20Proxy__factory } from "../src/types/factories/WBRC20Proxy__factory";

const bitcoinRelayJson = require("@teleportdao/btc-evm-bridge/artifacts/contracts/relay/BitcoinRelayLogic.sol/BitcoinRelayLogic.json")

import { takeSnapshot, revertProvider } from "./block_utils";

describe.only("brc20 router", async () => {

    // Constants
    let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    let ONE_ADDRESS = "0x0000000000000000000000000000000000000001";
    let TWO_ADDRESS = "0x0000000000000000000000000000000000000002";
    const CHAIN_ID = 80002;
    const OTHER_CHAIN_ID = 144;
    const MAPPED_CHAIN_ID = 137;
    const APP_ID = 0;
    const PROTOCOL_PERCENTAGE_FEE = 10; // Means %0.1
    const LOCKER_PERCENTAGE_FEE = 20; // Means %0.2
    const PRICE_WITH_DISCOUNT_RATIO = 9500; // Means %95
    const STARTING_BLOCK_NUMBER = 1;
    const TREASURY = "0x0000000000000000000000000000000000000002";
    const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001"
    const NATIVE_TOKEN_DECIMAL = 18;
    const ONE_HOUNDRED_PERCENT = 10000;
    const BRC_20_NAME = "t001";
    const BRC_20_DECIMAL = 18;
    const BRC_20_INDEX = 1;

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
    // let teleBTC: TeleBTC;
    // let teleportDAOToken: ERC20;
    let brc20RouterLib: Brc20RouterLib;
    let brc20Router: Contract;
    let exchangeToken: Erc20;
    let brc20Token: WBRC20Proxy;

    // Mock contracts
    let mockBitcoinRelay: MockContract;
    let mockExchangeConnector: MockContract;
    let mockAcross: MockContract;
    let mockDestinationToken: MockContract;
    let mockPriceOracle: MockContract;

    let beginning: any;

    before(async () => {
        // Sets accounts
        [proxyAdmin, deployer, signer1, locker] = await ethers.getSigners();

        proxyAdminAddress = await proxyAdmin.getAddress();
        lockerAddress = await locker.getAddress();
        deployerAddress = await deployer.getAddress();
    
        // Mocks relay contract
        mockBitcoinRelay = await deployMockContract(
            deployer,
            bitcoinRelayJson.abi
        );

        // Mocks swap connector
        const exchangeConnector = await deployments.getArtifact(
            "UniswapV2Connector"
        );

        mockExchangeConnector = await deployMockContract(
            deployer,
            exchangeConnector.abi
        )

        // Mocks across
        const across = await deployments.getArtifact(
            "SpokePoolInterface"
        );

        mockAcross = await deployMockContract(
            deployer,
            across.abi
        )

        // Mocks price oracle
        const priceOracle = await deployments.getArtifact(
            "IPriceOracle"
        );

        mockPriceOracle = await deployMockContract(
            deployer,
            priceOracle.abi
        )
        mockPriceOracle.mock.equivalentOutputAmount.returns(20)

        // Mocks destination token

        const destinationToken = await deployments.getArtifact(
            "erc20"
        );

        mockDestinationToken = await deployMockContract(
            deployer,
            destinationToken.abi
        )
        mockDestinationToken.mock.approve.returns()

        await setRelayReturn(true);
        await setExchangeReturn(true);
        await setAcrossReturn();

        brc20Router = await deployBrc20Router();

        await brc20Router.addBrc20(BRC_20_NAME, BRC_20_DECIMAL, BRC_20_INDEX)
        await brc20Router.setExchangeConnector(1, mockExchangeConnector.address)

        const erc20Factory = new Erc20__factory(deployer);
        exchangeToken = await erc20Factory.deploy("TestToken", "TT", 100000);
        await exchangeToken.transfer(await signer1.getAddress(), 1000)

    });

    const deployBrc20Lib = async (
        _signer?: Signer
    ): Promise<Brc20RouterLib> => {
        const Brc20LibFactory = new Brc20RouterLib__factory(
            _signer || deployer
        );

        const Brc20Lib = await Brc20LibFactory.deploy(
        );

        return Brc20Lib;
    };

    const deployBrc20Router = async (
        _signer?: Signer
    ): Promise<Contract> => {

        brc20RouterLib = await deployBrc20Lib()

        let linkLibraryAddresses: Brc20RouterLogicLibraryAddresses;

        linkLibraryAddresses = {
            "contracts/router/Brc20RouterLib.sol:Brc20RouterLib": brc20RouterLib.address,
        };

        // Deploys brc20Router logic
        const brc20RouterLogicFactory = new Brc20RouterLogic__factory(
            linkLibraryAddresses,
            _signer || deployer
        );

        const brc20RouterLogic = await brc20RouterLogicFactory.deploy();

        // Deploys brc20Router proxy
        const brc20RouterProxyFactory = new Brc20RouterProxy__factory(
            _signer || deployer
        );
        const brc20RouterProxy = await brc20RouterProxyFactory.deploy(
            brc20RouterLogic.address,
            proxyAdminAddress,
            "0x"
        )

        const brc20Router = await brc20RouterLogic.attach(
            brc20RouterProxy.address
        );

        let s = await signer1.getAddress()
        // Initializes brc20Router proxy
        await brc20Router.initialize(
            1,
            5,
            CHAIN_ID,
            mockBitcoinRelay.address,
            s,
            s,
            3,
            s,
            s,
            mockPriceOracle.address,
            s
        )

        return brc20Router;
    };

    async function setRelayReturn(isTrue: boolean): Promise<void> {
        await mockBitcoinRelay.mock.getBlockHeaderFee.returns(0); // Sets fee of using relay
        await mockBitcoinRelay.mock.checkTxProof.returns(isTrue); // Sets result of checking tx proof
    }

    async function setExchangeReturn(isTrue: boolean): Promise<void> {
        await mockExchangeConnector.mock.isPathValid.returns(isTrue); 
        await mockExchangeConnector.mock.swap.returns(isTrue, [1, 1]); 
    }

    async function setAcrossReturn(): Promise<void> {
        await mockAcross.mock.deposit.returns();
    }

    describe("#setters", async () => {

        beforeEach(async () => {
            beginning = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, beginning);
        });

        it("Sets protocol percentage fee", async function () {
            await brc20Router.setStartingBlockNumber(100)

            expect(
                await brc20Router.startingBlockNumber()
            ).to.equal(100);
        })

        // it("Sets protocol percentage fee", async function () {
        //     await expect(
        //         ccTransferRouter.setProtocolPercentageFee(20000)
        //     ).to.be.revertedWith("CCTransferRouter: protocol fee is out of range");
        //     // CCTransferRouter: protocol fee is out of range
        // })

        // it("Reverts since protocol percentage fee is greater than 10000", async function () {
        //     await expect(
        //         ccTransferRouter.setProtocolPercentageFee(10001)
        //     ).to.revertedWith("CCTransferRouter: protocol fee is out of range");
        // })

        // it("Sets relay, brc20Router, instant router, teleBTC and treasury", async function () {
        //     await expect(
        //         await ccTransferRouter.setRelay(ONE_ADDRESS)
        //     ).to.emit(
        //         ccTransferRouter, "NewRelay"
        //     ).withArgs(mockBitcoinRelay.address, ONE_ADDRESS);


        //     expect(
        //         await ccTransferRouter.relay()
        //     ).to.equal(ONE_ADDRESS);

        //     await expect(
        //         await ccTransferRouter.setbrc20Router(ONE_ADDRESS)
        //     ).to.emit(
        //         ccTransferRouter, "Newbrc20Router"
        //     ).withArgs(brc20Router.address, ONE_ADDRESS);

        //     expect(
        //         await ccTransferRouter.brc20Router()
        //     ).to.equal(ONE_ADDRESS);

        //     await expect(
        //         ccTransferRouter.connect(signer1).setbrc20Router(ONE_ADDRESS)
        //     ).to.be.revertedWith("Ownable: caller is not the owner")

        //     await expect(
        //         await ccTransferRouter.setInstantRouter(ONE_ADDRESS)
        //     ).to.emit(
        //         ccTransferRouter, "NewInstantRouter"
        //     ).withArgs(deployerAddress, ONE_ADDRESS);

        //     expect(
        //         await ccTransferRouter.instantRouter()
        //     ).to.equal(ONE_ADDRESS);

        //     await expect(
        //         ccTransferRouter.connect(signer1).setInstantRouter(ONE_ADDRESS)
        //     ).to.be.revertedWith("Ownable: caller is not the owner")

        //     await expect(
        //         await ccTransferRouter.setTeleBTC(ONE_ADDRESS)
        //     ).to.emit(
        //         ccTransferRouter, "NewTeleBTC"
        //     ).withArgs(teleBTC.address, ONE_ADDRESS);

        //     expect(
        //         await ccTransferRouter.teleBTC()
        //     ).to.equal(ONE_ADDRESS);

        //     await expect(
        //         ccTransferRouter.connect(signer1).setTeleBTC(ONE_ADDRESS)
        //     ).to.be.revertedWith("Ownable: caller is not the owner")

        //     await expect(
        //         await ccTransferRouter.setTreasury(ONE_ADDRESS)
        //     ).to.emit(
        //         ccTransferRouter, "NewTreasury"
        //     ).withArgs(TREASURY, ONE_ADDRESS);


        //     expect(
        //         await ccTransferRouter.treasury()
        //     ).to.equal(ONE_ADDRESS);

        //     await expect(
        //         ccTransferRouter.connect(signer1).setTreasury(ONE_ADDRESS)
        //     ).to.be.revertedWith("Ownable: caller is not the owner")

        //     await expect(
        //         ccTransferRouter.connect(signer1).renounceOwnership()
        //     ).to.be.revertedWith("Ownable: caller is not the owner")

        //     await ccTransferRouter.renounceOwnership()

        // })

        // it("Reverts since given address is zero", async function () {
        //     await expect(
        //         ccTransferRouter.setRelay(ZERO_ADDRESS)
        //     ).to.revertedWith("ZeroAddress()");

        //     await expect(
        //         ccTransferRouter.setbrc20Router(ZERO_ADDRESS)
        //     ).to.revertedWith("ZeroAddress()");

        //     await expect(
        //         ccTransferRouter.setInstantRouter(ZERO_ADDRESS)
        //     ).to.revertedWith("ZeroAddress()");

        //     await expect(
        //         ccTransferRouter.setTeleBTC(ZERO_ADDRESS)
        //     ).to.revertedWith("ZeroAddress()");

        //     await expect(
        //         ccTransferRouter.setTreasury(ZERO_ADDRESS)
        //     ).to.revertedWith("ZeroAddress()");
        // })

        
        // it("Reverts since new starting block number is less than what is set before", async function () {
        //     await expect(
        //         ccTransferRouter.setStartingBlockNumber(STARTING_BLOCK_NUMBER - 1)
        //     ).to.revertedWith("CCTransferRouter: low startingBlockNumber");
        // })

        // it("Only owner can set functions", async function () {
        //     await expect(
        //         ccTransferRouter.connect(signer1).setStartingBlockNumber(1)
        //     ).to.be.revertedWith("Ownable: caller is not the owner")

        //     await expect(
        //         ccTransferRouter.connect(signer1).setProtocolPercentageFee(1)
        //     ).to.be.revertedWith("Ownable: caller is not the owner")

        //     await expect(
        //         ccTransferRouter.connect(signer1).setRelay(ONE_ADDRESS)
        //     ).to.be.revertedWith("Ownable: caller is not the owner")

        // })
    });

    describe("#wrap brc20", async () => {

        beforeEach(async () => {
            beginning = await takeSnapshot(signer1.provider);
            await brc20Router.setChainIdMapping(CHAIN_ID, MAPPED_CHAIN_ID)
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, beginning);
        });

        it("wrap brc20", async function () {
            await expect(
                brc20Router.connect(signer1).wrapBrc20(
                    "0x02000000",
                    "0x0284735472e7285cb1f4d2c6c4aff935b526189dd4521ae80a2837062743072b1d0000000000fdffffff9d64e6881f136dcd9648125331ff0e6d3d1b14a9ab1d38d0605d5748b99c523b0100000000fdffffff",
                    "0x03580200000000000017a91440059ea01abcf5ead734dec719932b75f4876916870000000000000000296a27008900000100000000008ac7230489e8000027ae10feb0a4b20bfa10623b2f15302e9a0d00c200ca329600000000001600147a8567d9d956adf354628db7a0f9475a60d33c0d",
                    "0x00000000",
                    2869704,
                    "0x84735472e7285cb1f4d2c6c4aff935b526189dd4521ae80a2837062743072b1d4b201dd63bd6c4c0dbec882020b8050acabd638c4cd2f36f3694a040058ac9f7de0cf1f526eba63f73c7ab06187cb7b0f48355c30deaf57797d6b8c167506c813317326802359d796dc4c087e3c01b5d6192bb408234842ca0e044a52dcaeebf1926f97c9a532b88e94125f2a400bd7a3db75705b5e77226128e629b079505c80136ab612be316d6c2f5eaa7fca3b0c69883beecb79ad74640ac6fc345f81d49f88e424db11d129187e395fafaab65bb6252d88af6b7a5bd92547b9b37af4386a393f2c615a68012a08e851a2b93e6951f34045aef228743581e467bc7660bdf8b0f024788e14f2712fe86a24840e684ee5c0bf633b6f8e464784663c64211d6dbe6495e2893a4f74a79c635089f6fce44bf7f876391807518cf8ab6f5543fb6",
                    691,
                    []
                )
            ).to.emit(
                brc20Router, "NewWrap"
            )
        })
    });

    describe("#wrap and swap brc20", async () => {

        beforeEach(async () => {
            beginning = await takeSnapshot(signer1.provider);
            await brc20Router.setChainIdMapping(CHAIN_ID, MAPPED_CHAIN_ID)
            await brc20Router.setChainIdMapping(OTHER_CHAIN_ID, OTHER_CHAIN_ID)
            await brc20Router.supportChain(OTHER_CHAIN_ID)
            await brc20Router.setAcross(mockAcross.address)
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, beginning);
        });

        it("wrap and swap brc20", async function () {
            let brc20 = await brc20Router.supportedBrc20s(1)
            let res = "0x03580200000000000017a91440059ea01abcf5ead734dec719932b75f48769168700000000000000004d6a4b008901000100000000008ac7230489e8000027ae10feb0a4b20bfa10623b2f15302e9a0d00c200eb5667fb4b6dfebeb16874b9f26dea002fcefc3f000000000000000000000000000000005a279600000000001600147a8567d9d956adf354628db7a0f9475a60d33c0d".replace("eb5667fb4b6dfebeb16874b9f26dea002fcefc3f", mockDestinationToken.address.substring(2))
            await expect(
                brc20Router.connect(signer1).wrapBrc20(
                    "0x02000000",
                    "0x028fc4eea3bd609e35a2fb148113ff68a5455bd5ef85a13fdc285645ff462dc1130000000000fdffffff77968f182690f88ff6300c50737a87f61b293efe31e65dc23c92e2ad35f136b80100000000fdffffff",
                    res,
                    "0x00000000",
                    2869704,
                    "0x84735472e7285cb1f4d2c6c4aff935b526189dd4521ae80a2837062743072b1d4b201dd63bd6c4c0dbec882020b8050acabd638c4cd2f36f3694a040058ac9f7de0cf1f526eba63f73c7ab06187cb7b0f48355c30deaf57797d6b8c167506c813317326802359d796dc4c087e3c01b5d6192bb408234842ca0e044a52dcaeebf1926f97c9a532b88e94125f2a400bd7a3db75705b5e77226128e629b079505c80136ab612be316d6c2f5eaa7fca3b0c69883beecb79ad74640ac6fc345f81d49f88e424db11d129187e395fafaab65bb6252d88af6b7a5bd92547b9b37af4386a393f2c615a68012a08e851a2b93e6951f34045aef228743581e467bc7660bdf8b0f024788e14f2712fe86a24840e684ee5c0bf633b6f8e464784663c64211d6dbe6495e2893a4f74a79c635089f6fce44bf7f876391807518cf8ab6f5543fb6",
                    691,
                    [brc20, mockDestinationToken.address]
                )
            ).to.emit(
                brc20Router, "NewWrapAndSwap"
            )
        })

        it("wrap and swap brc20 to other chain", async function () {
            let brc20 = await brc20Router.supportedBrc20s(1)
            let res = "0x03580200000000000017a91440059ea01abcf5ead734dec719932b75f48769168700000000000000004d6a4b008901000100000000008ac7230489e8000027ae10feb0a4b20bfa10623b2f15302e9a0d00c200eb5667fb4b6dfebeb16874b9f26dea002fcefc3f000000000000000000000000000000005a279600000000001600147a8567d9d956adf354628db7a0f9475a60d33c0d".replace("eb5667fb4b6dfebeb16874b9f26dea002fcefc3f", mockDestinationToken.address.substring(2))
            await expect(
                brc20Router.connect(signer1).wrapBrc20(
                    "0x02000000",
                    "0x028fc4eea3bd609e35a2fb148113ff68a5455bd5ef85a13fdc285645ff462dc1130000000000fdffffff77968f182690f88ff6300c50737a87f61b293efe31e65dc23c92e2ad35f136b80100000000fdffffff",
                    res,
                    "0x00000000",
                    2869704,
                    "0x84735472e7285cb1f4d2c6c4aff935b526189dd4521ae80a2837062743072b1d4b201dd63bd6c4c0dbec882020b8050acabd638c4cd2f36f3694a040058ac9f7de0cf1f526eba63f73c7ab06187cb7b0f48355c30deaf57797d6b8c167506c813317326802359d796dc4c087e3c01b5d6192bb408234842ca0e044a52dcaeebf1926f97c9a532b88e94125f2a400bd7a3db75705b5e77226128e629b079505c80136ab612be316d6c2f5eaa7fca3b0c69883beecb79ad74640ac6fc345f81d49f88e424db11d129187e395fafaab65bb6252d88af6b7a5bd92547b9b37af4386a393f2c615a68012a08e851a2b93e6951f34045aef228743581e467bc7660bdf8b0f024788e14f2712fe86a24840e684ee5c0bf633b6f8e464784663c64211d6dbe6495e2893a4f74a79c635089f6fce44bf7f876391807518cf8ab6f5543fb6",
                    691,
                    [brc20, mockDestinationToken.address]
                )
            ).to.emit(
                brc20Router, "NewWrapAndSwap"
            )
        })
    });

    describe("#unwrap brc20", async () => {

        beforeEach(async () => {
            beginning = await takeSnapshot(signer1.provider);
            await brc20Router.setAcross(mockAcross.address)
            await exchangeToken.connect(signer1).approve(brc20Router.address, 1000)

            const wbrc20Factory = new WBRC20Proxy__factory(deployer);
            brc20Token = await wbrc20Factory.attach(await brc20Router.supportedBrc20s(1));
            await brc20Token.mint(brc20Router.address, 1000)
            
            console.log(brc20Router.address)
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, beginning);
        });

        it("unwrap and swap brc20", async function () {
            
            await expect(
                brc20Router.connect(signer1).unwrapBrc20(
                    0,
                    1,
                    20,
                    "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c",
                    1,
                    1,
                    40,
                    [exchangeToken.address, brc20Token.address]
                )
            ).to.be.revertedWith("mew")
        })

        // it("wrap and swap brc20 to other chain", async function () {
        //     let brc20 = await brc20Router.supportedBrc20s(1)
        //     let res = "0x03580200000000000017a91440059ea01abcf5ead734dec719932b75f48769168700000000000000004d6a4b008901000100000000008ac7230489e8000027ae10feb0a4b20bfa10623b2f15302e9a0d00c200eb5667fb4b6dfebeb16874b9f26dea002fcefc3f000000000000000000000000000000005a279600000000001600147a8567d9d956adf354628db7a0f9475a60d33c0d".replace("eb5667fb4b6dfebeb16874b9f26dea002fcefc3f", mockDestinationToken.address.substring(2))
        //     await expect(
        //         brc20Router.connect(signer1).wrapBrc20(
        //             "0x02000000",
        //             "0x028fc4eea3bd609e35a2fb148113ff68a5455bd5ef85a13fdc285645ff462dc1130000000000fdffffff77968f182690f88ff6300c50737a87f61b293efe31e65dc23c92e2ad35f136b80100000000fdffffff",
        //             res,
        //             "0x00000000",
        //             2869704,
        //             "0x84735472e7285cb1f4d2c6c4aff935b526189dd4521ae80a2837062743072b1d4b201dd63bd6c4c0dbec882020b8050acabd638c4cd2f36f3694a040058ac9f7de0cf1f526eba63f73c7ab06187cb7b0f48355c30deaf57797d6b8c167506c813317326802359d796dc4c087e3c01b5d6192bb408234842ca0e044a52dcaeebf1926f97c9a532b88e94125f2a400bd7a3db75705b5e77226128e629b079505c80136ab612be316d6c2f5eaa7fca3b0c69883beecb79ad74640ac6fc345f81d49f88e424db11d129187e395fafaab65bb6252d88af6b7a5bd92547b9b37af4386a393f2c615a68012a08e851a2b93e6951f34045aef228743581e467bc7660bdf8b0f024788e14f2712fe86a24840e684ee5c0bf633b6f8e464784663c64211d6dbe6495e2893a4f74a79c635089f6fce44bf7f876391807518cf8ab6f5543fb6",
        //             691,
        //             [brc20, mockDestinationToken.address]
        //         )
        //     ).to.emit(
        //         brc20Router, "NewWrapAndSwap"
        //     )
        // })
    });
    // describe("#third party", async () => {

    //     beforeEach(async () => {
    //         beginning = await takeSnapshot(signer1.provider);
    //         await ccTransferRouter.setThirdPartyAddress(1, THIRD_PARTY_ADDRESS)
    //         await ccTransferRouter.setThirdPartyFee(1, THIRD_PARTY_PERCENTAGE_FEE)
    //         await addLockerTobrc20Router();
    //     });

    //     afterEach(async () => {
    //         await revertProvider(signer1.provider, beginning);
    //     });

    //     it("Third party gets its fee", async function () {
    //         let prevSupply = await teleBTC.totalSupply();
    //         // Mocks relay to return true after checking tx proof
    //         await setRelayReturn(true);

    //         // Calculates fees
    //         let lockerFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
    //         );
    //         let teleporterFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*CC_REQUESTS.normalCCTransfer_withThirdParty.teleporterFee/10000
    //         );
    //         let protocolFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
    //         );
    //         let thirdPartyFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*THIRD_PARTY_PERCENTAGE_FEE/10000
    //         );   

    //         // Calculates amount that user should have received
    //         let receivedAmount = CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount - lockerFee - teleporterFee - protocolFee - thirdPartyFee;

    //         await expect(
    //             await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
    //         ).to.equal(0)

    //         // Checks that ccTransfer is executed successfully
    //         await expect(
    //             await ccTransferRouter.wrap(
    //                 {
    //                     version: CC_REQUESTS.normalCCTransfer_withThirdParty.version,
    //                     vin: CC_REQUESTS.normalCCTransfer_withThirdParty.vin,
    //                     vout: CC_REQUESTS.normalCCTransfer_withThirdParty.vout,
    //                     locktime: CC_REQUESTS.normalCCTransfer_withThirdParty.locktime,
    //                     blockNumber: CC_REQUESTS.normalCCTransfer_withThirdParty.blockNumber,
    //                     intermediateNodes: CC_REQUESTS.normalCCTransfer_withThirdParty.intermediateNodes,
    //                     index: CC_REQUESTS.normalCCTransfer_withThirdParty.index
    //                 },
    //                 LOCKER1_LOCKING_SCRIPT,
    //             )
    //         ).to.emit(ccTransferRouter, "NewWrap").withArgs(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.txId,
    //             LOCKER1_LOCKING_SCRIPT,
    //             lockerAddress,
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.recipientAddress,
    //             deployerAddress,
    //             [CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount, receivedAmount],
    //             [teleporterFee, lockerFee, protocolFee, thirdPartyFee],
    //             1,
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.chainId
    //         );

    //         await expect(
    //             await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
    //         ).to.equal(thirdPartyFee)
    //     })

    //     it("can change third party address", async function () {
    //         let NEW_THIRD_PARTY_ADDRESS = "0x0000000000000000000000000000000000000201"
    //         await ccTransferRouter.setThirdPartyAddress(1, NEW_THIRD_PARTY_ADDRESS)

    //         let prevSupply = await teleBTC.totalSupply();
    //         // Mocks relay to return true after checking tx proof
    //         await setRelayReturn(true);

    //         // Calculates fees
    //         let lockerFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
    //         );
    //         let teleporterFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*CC_REQUESTS.normalCCTransfer_withThirdParty.teleporterFee/10000
    //         );
    //         let protocolFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
    //         );
    //         let thirdPartyFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*THIRD_PARTY_PERCENTAGE_FEE/10000
    //         );   

    //         // Calculates amount that user should have received
    //         let receivedAmount = CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount - lockerFee - teleporterFee - protocolFee - thirdPartyFee;

    //         await expect(
    //             await teleBTC.balanceOf(NEW_THIRD_PARTY_ADDRESS)
    //         ).to.equal(0)

    //         // Checks that ccTransfer is executed successfully
    //         await expect(
    //             await ccTransferRouter.wrap(
    //                 {
    //                     version: CC_REQUESTS.normalCCTransfer_withThirdParty.version,
    //                     vin: CC_REQUESTS.normalCCTransfer_withThirdParty.vin,
    //                     vout: CC_REQUESTS.normalCCTransfer_withThirdParty.vout,
    //                     locktime: CC_REQUESTS.normalCCTransfer_withThirdParty.locktime,
    //                     blockNumber: CC_REQUESTS.normalCCTransfer_withThirdParty.blockNumber,
    //                     intermediateNodes: CC_REQUESTS.normalCCTransfer_withThirdParty.intermediateNodes,
    //                     index: CC_REQUESTS.normalCCTransfer_withThirdParty.index
    //                 },
    //                 LOCKER1_LOCKING_SCRIPT,
    //             )
    //         ).to.emit(ccTransferRouter, "NewWrap").withArgs(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.txId,
    //             LOCKER1_LOCKING_SCRIPT,
    //             lockerAddress,
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.recipientAddress,
    //             deployerAddress,
    //             [CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount, receivedAmount],
    //             [teleporterFee, lockerFee, protocolFee, thirdPartyFee],
    //             1,
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.chainId
    //         );

    //         await expect(
    //             await teleBTC.balanceOf(NEW_THIRD_PARTY_ADDRESS)
    //         ).to.equal(thirdPartyFee)
    //     })

    //     it("can change third party fee", async function () {
    //         let NEW_THIRD_PARTY_PERCENTAGE_FEE = 50
    //         await ccTransferRouter.setThirdPartyFee(1, NEW_THIRD_PARTY_PERCENTAGE_FEE)

    //         let prevSupply = await teleBTC.totalSupply();
    //         // Mocks relay to return true after checking tx proof
    //         await setRelayReturn(true);

    //         // Calculates fees
    //         let lockerFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*LOCKER_PERCENTAGE_FEE/10000
    //         );
    //         let teleporterFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*CC_REQUESTS.normalCCTransfer_withThirdParty.teleporterFee/10000
    //         );
    //         let protocolFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*PROTOCOL_PERCENTAGE_FEE/10000
    //         );
    //         let thirdPartyFee = Math.floor(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount*NEW_THIRD_PARTY_PERCENTAGE_FEE/10000
    //         );   

    //         // Calculates amount that user should have received
    //         let receivedAmount = CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount - lockerFee - teleporterFee - protocolFee - thirdPartyFee;

    //         await expect(
    //             await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
    //         ).to.equal(0)

    //         // Checks that ccTransfer is executed successfully
    //         await expect(
    //             await ccTransferRouter.wrap(
    //                 {
    //                     version: CC_REQUESTS.normalCCTransfer_withThirdParty.version,
    //                     vin: CC_REQUESTS.normalCCTransfer_withThirdParty.vin,
    //                     vout: CC_REQUESTS.normalCCTransfer_withThirdParty.vout,
    //                     locktime: CC_REQUESTS.normalCCTransfer_withThirdParty.locktime,
    //                     blockNumber: CC_REQUESTS.normalCCTransfer_withThirdParty.blockNumber,
    //                     intermediateNodes: CC_REQUESTS.normalCCTransfer_withThirdParty.intermediateNodes,
    //                     index: CC_REQUESTS.normalCCTransfer_withThirdParty.index
    //                 },
    //                 LOCKER1_LOCKING_SCRIPT,
    //             )
    //         ).to.emit(ccTransferRouter, "NewWrap").withArgs(
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.txId,
    //             LOCKER1_LOCKING_SCRIPT,
    //             lockerAddress,
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.recipientAddress,
    //             deployerAddress,
    //             [CC_REQUESTS.normalCCTransfer_withThirdParty.bitcoinAmount, receivedAmount],
    //             [teleporterFee, lockerFee, protocolFee, thirdPartyFee],
    //             1,
    //             CC_REQUESTS.normalCCTransfer_withThirdParty.chainId
    //         );

    //         await expect(
    //             await teleBTC.balanceOf(THIRD_PARTY_ADDRESS)
    //         ).to.equal(thirdPartyFee)
    //     })

    //     it("only owner can set third party address", async function () {
    //         await expect(
    //             ccTransferRouter.connect(signer1).setThirdPartyAddress(1, THIRD_PARTY_ADDRESS)
    //         ).to.be.revertedWith("Ownable: caller is not the owner")
    //     })

    //     it("only owner can set third party fee", async function () {
    //         await expect(
    //             ccTransferRouter.connect(signer1).setThirdPartyFee(1, THIRD_PARTY_PERCENTAGE_FEE)
    //         ).to.be.revertedWith("Ownable: caller is not the owner")
    //     })

    // });
});