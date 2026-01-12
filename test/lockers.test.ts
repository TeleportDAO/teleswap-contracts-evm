require('dotenv').config({path:"../../.env"});

import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";  // Add this import
import { deployments, ethers } from "hardhat";
import { Signer, BigNumber } from "ethers";
import { deployMockContract, MockContract } from "@ethereum-waffle/mock-contract";
import { Contract } from "@ethersproject/contracts";
import { Address } from "hardhat-deploy/types";
import { LockersManagerProxy__factory } from "../src/types/factories/LockersManagerProxy__factory";
import { LockersManagerLogic__factory } from "../src/types/factories/LockersManagerLogic__factory";
import { LockersManagerLogicLibraryAddresses } from "../src/types/factories/LockersManagerLogic__factory";
import { LockersManagerLib } from "../src/types/LockersManagerLib";
import { LockersManagerLib__factory } from "../src/types/factories/LockersManagerLib__factory";
import { TeleBTCLogic__factory } from "../src/types/factories/TeleBTCLogic__factory";
import { TeleBTCLogic } from "../src/types/TeleBTCLogic";
import { TeleBTCProxy__factory } from "../src/types/factories/TeleBTCProxy__factory";
import { ERC20 } from "../src/types/ERC20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
import { advanceBlockWithTime, takeSnapshot, revertProvider } from "./block_utils";

describe("Lockers", async function() {
    this.bail(true); // Stop on first failure

    let snapshotId: any;

    // Constants
    let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    let ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
    let telePortTokenInitialSupply = BigNumber.from(10).pow(18).mul(10000);
    let minRequiredTSTLockedAmount = BigNumber.from(10).pow(18).mul(500);
    let minRequiredNativeTokenLockedAmount = BigNumber.from(10).pow(18).mul(5);
    let minRequiredExchangeTokenLockedAmount = BigNumber.from(10).pow(18).mul(10);
    let btcAmountToSlash = BigNumber.from(10).pow(8).mul(1)
    let collateralRatio = 20000;
    let liquidationRatio = 15000;
    const LOCKER_PERCENTAGE_FEE = 0;
    const PRICE_WITH_DISCOUNT_RATIO = 9500; // Means %95
    const INACTIVATION_DELAY = 10000;
    const ONE_HOUNDRED_PERCENT = 10000;
    const UPPER_HEALTH_FACTOR = 12500;
    const NATIVE_TOKEN_DECIMAL = 18
    const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001"
    const FEE_ESTIMATE = BigNumber.from(10).pow(15)

    // Bitcoin public key (32 bytes)
    let LOCKER1 = '0x03789ed0bb717d88f7d321a368d905e7430207ebbd82bd342cf11ae157a7ace5fd';
    let LOCKER1_PUBKEY__HASH = '0x4062c8aeed4f81c2d73ff854a2957021191e20b6';

    let LOCKER_RESCUE_SCRIPT_P2PKH = "0x12ab8dc588ca9d5787dde7eb29569da63c3a238c";
    let LOCKER_RESCUE_SCRIPT_P2PKH_TYPE = 1; // P2PKH

    let REQUIRED_LOCKED_AMOUNT =  1000; // amount of required TST

    // Accounts
    let proxyAdmin: Signer;
    let deployer: Signer;
    let signer1: Signer;
    let signer2: Signer;
    let signer3: Signer;
    let ccBurnSimulator: Signer;
    let proxyAdminAddress: Address;
    let deployerAddress: Address;
    let signer1Address: Address;
    let signer2Address: Address;
    let signer3Address: Address;
    let ccBurnSimulatorAddress: Address;

    // Contracts
    let lockersLib: LockersManagerLib;
    let lockers: Contract;
    let lockers2: Contract;
    let lockersAsAdmin: Contract;
    let teleportSystemToken: ERC20;
    let teleBTC: TeleBTCLogic;

    // Mock contracts
    let mockExchangeConnector: MockContract;
    let mockPriceOracle: MockContract;
    let mockBurnRouter: MockContract;

    let exchangeToken: ERC20;

    before(async () => {
        // Sets accounts
        [proxyAdmin, deployer, signer1, signer2,ccBurnSimulator, signer3] = await ethers.getSigners();
        proxyAdminAddress = await proxyAdmin.getAddress()
        deployerAddress = await deployer.getAddress();
        signer1Address = await signer1.getAddress();
        signer2Address = await signer2.getAddress();
        ccBurnSimulatorAddress = await ccBurnSimulator.getAddress();
        signer3Address = await signer3.getAddress();

        teleportSystemToken = await deployTelePortDaoToken()

        const priceOracleContract = await deployments.getArtifact(
            "IPriceOracle"
        );
        mockPriceOracle = await deployMockContract(
            deployer,
            priceOracleContract.abi
        );

        const burnRouterContract = await deployments.getArtifact(
            "BurnRouterLogic"
        );
        mockBurnRouter = await deployMockContract(
            deployer,
            burnRouterContract.abi
        );

        // Deploys lockers contract
        lockers = await deployLockers();
        lockers2 = await deployLockers();

        // Deploys teleBTC contract
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

        // Initializes lockers proxy
        await lockers.initialize(
            teleBTC.address,
            mockPriceOracle.address,
            ccBurnSimulatorAddress,
            minRequiredTSTLockedAmount,
            collateralRatio,
            liquidationRatio,
            LOCKER_PERCENTAGE_FEE,
            PRICE_WITH_DISCOUNT_RATIO
        )

        await lockers.setTST(teleportSystemToken.address)

        // Sets burnRouter address
        // await lockers.setBurnRouter(ccBurnSimulatorAddress)

        await teleBTC.addMinter(deployerAddress)

        await teleBTC.addMinter(lockers.address)
        await teleBTC.addBurner(lockers.address)

        // lockersAsAdmin = await lockers.connect(proxyAdmin)

        // await lockers.setTeleBTC(teleBTC.address)

        // whitelist native token
        await lockers.addCollateralToken(NATIVE_TOKEN_ADDRESS, NATIVE_TOKEN_DECIMAL)

        // Deploys exchange token
        const erc20Factory = new Erc20__factory(deployer);
        exchangeToken = await erc20Factory.deploy(
            "TestToken",
            "TT",
            minRequiredExchangeTokenLockedAmount.mul(10)
        );

        await exchangeToken.transfer(signer1Address, minRequiredExchangeTokenLockedAmount)

        // whitelist exchange token
        await lockers.addCollateralToken(exchangeToken.address, await exchangeToken.decimals())
    });

    beforeEach(async () => {
        // Takes snapshot
        snapshotId = await takeSnapshot(deployer.provider);
    });

    afterEach(async () => {
        // Reverts the state
        await revertProvider(deployer.provider, snapshotId);
    });

    async function getTimestamp(): Promise<number> {
        let lastBlockNumber = await ethers.provider.getBlockNumber();
        let lastBlock = await ethers.provider.getBlock(lastBlockNumber);
        return lastBlock.timestamp;
    }

    const deployTelePortDaoToken = async (
        _signer?: Signer
    ): Promise<ERC20> => {
        const erc20Factory = new Erc20__factory(
            _signer || deployer
        );

        const teleportSystemToken = await erc20Factory.deploy(
            "TelePortDAOToken",
            "TST",
            telePortTokenInitialSupply
        );

        return teleportSystemToken;
    };

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

        return lockers;
    };

    describe("#initialize", async () => {

        it("initialize can be called only once", async function () {
            await expect(
                lockers.initialize(
                    teleBTC.address,
                    mockPriceOracle.address,
                    ONE_ADDRESS,
                    minRequiredTSTLockedAmount,
                    collateralRatio,
                    liquidationRatio,
                    LOCKER_PERCENTAGE_FEE,
                    PRICE_WITH_DISCOUNT_RATIO
                )
            ).to.be.revertedWith("Initializable: contract is already initialized")
        })

        it("initialize cant be called LR greater than CR", async function () {
            await expect(
                lockers2.initialize(
                    teleBTC.address,
                    mockPriceOracle.address,
                    ONE_ADDRESS,
                    minRequiredTSTLockedAmount,
                    liquidationRatio,
                    collateralRatio,
                    LOCKER_PERCENTAGE_FEE,
                    PRICE_WITH_DISCOUNT_RATIO
                )
            ).to.be.revertedWithCustomError(lockers2, "InvalidValue")
        })

        it("initialize cant be called with Price discount greater than 100%", async function () {
            await expect(
                lockers2.initialize(
                    teleBTC.address,
                    mockPriceOracle.address,
                    ONE_ADDRESS,
                    minRequiredTSTLockedAmount,
                    collateralRatio,
                    liquidationRatio,
                    LOCKER_PERCENTAGE_FEE,
                    PRICE_WITH_DISCOUNT_RATIO + 10000
                )
            ).to.be.revertedWithCustomError(lockers2, "InvalidValue")
        })

    })

    describe("#addMinter", async () => {

        it("can't add zero address as minter", async function () {
            await expect(
                lockers.addMinter(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")
        })

        it("only owner can add a minter", async function () {

            let lockersSigner1 = await lockers.connect(signer1)

            await expect(
                lockersSigner1.addMinter(
                    ONE_ADDRESS
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("owner successfully adds a minter", async function () {

            await expect(
                await lockers.addMinter(
                    ONE_ADDRESS
                )
            ).to.emit(
                lockers, "MinterAdded"
            ).withArgs(ONE_ADDRESS);
        })

        it("can't add an account that already is minter", async function () {

            await lockers.addMinter(
                ONE_ADDRESS
            )

            await expect(
                lockers.addMinter(
                    ONE_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "AlreadyHasRole")
        })

    })

    describe("#removeMinter", async () => {

        it("only owner can add a minter", async function () {

            let lockersSigner1 = await lockers.connect(signer1)

            await expect(
                lockersSigner1.removeMinter(
                    ONE_ADDRESS
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("owner can't remove an account from minter that it's not minter ATM", async function () {

            await expect(
                lockers.removeMinter(
                    ONE_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "NotMinter")
        })

        it("owner successfully removes an account from minters", async function () {

            await lockers.addMinter(
                ONE_ADDRESS
            )

            await expect(
                await lockers.removeMinter(
                    ONE_ADDRESS
                )
            ).to.emit(
                lockers, "MinterRemoved"
            ).withArgs(ONE_ADDRESS);
        })

    })

    describe("#addBurner", async () => {

        it("can't add zero address as burner", async function () {
            await expect(
                lockers.addBurner(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")
        })

        it("only owner can add a burner", async function () {

            let lockersSigner1 = await lockers.connect(signer1)

            await expect(
                lockersSigner1.addBurner(
                    ONE_ADDRESS
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("owner successfully adds a burner", async function () {

            await expect(
                await lockers.addBurner(
                    ONE_ADDRESS
                )
            ).to.emit(
                lockers, "BurnerAdded"
            ).withArgs(ONE_ADDRESS);
        })

        it("can't add an account that already is burner", async function () {

            await lockers.addBurner(
                ONE_ADDRESS
            )

            await expect(
                lockers.addBurner(
                    ONE_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "AlreadyHasRole")
        })
    })

    describe("#removeBurner", async () => {

        it("only owner can add a burner", async function () {

            let lockersSigner1 = await lockers.connect(signer1)

            await expect(
                lockersSigner1.removeBurner(
                    ONE_ADDRESS
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        // it("owner can't remove an account from burners that it's not burner ATM", async function () {

        //     await expect(
        //         lockers.removeBurner(
        //             ONE_ADDRESS
        //         )
        //     ).to.be.revertedWith("Lockers: account does not have role")
        // })

        it("owner successfully removes an account from burner", async function () {

            await lockers.addBurner(
                ONE_ADDRESS
            )

            await expect(
                await lockers.removeBurner(
                    ONE_ADDRESS
                )
            ).to.emit(
                lockers, "BurnerRemoved"
            ).withArgs(ONE_ADDRESS);
        })

    })

    describe("#pauseLocker", async () => {

        it("only admin can pause locker", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.pauseLocker()
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

        it("contract paused successsfully", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await lockers.pauseLocker()

            // TODO is this correct?
            // await expect(
            //     lockerSigner1.selfRemoveLocker()
            // ).to.be.revertedWith("Pausable: paused")

            await expect(
                lockerSigner1.slashIdleLocker(
                    signer1Address,
                    0,
                    deployerAddress,
                    10000,
                    ccBurnSimulatorAddress
                )
            ).to.be.revertedWith("Pausable: paused")

            await expect(
                lockerSigner1.liquidateLocker(
                    signer1Address,
                    10000
                )
            ).to.be.revertedWith("Pausable: paused")

            await expect(
                lockerSigner1.mint(
                    signer1Address,
                    signer2Address,
                    10000
                )
            ).to.be.revertedWith("Pausable: paused")

            await expect(
                lockerSigner1.burn(
                    signer1Address,
                    10000
                )
            ).to.be.revertedWith("Pausable: paused")

            await expect(
                lockerSigner1.buySlashedCollateralOfLocker(
                    signer1Address,
                    10000
                )
            ).to.be.revertedWith("Pausable: paused")

            await expect(
                lockerSigner1.slashThiefLocker(
                    signer1Address,
                    10000,
                    signer1Address,
                    10000
                )
            ).to.be.revertedWith("Pausable: paused")

        });

        it("can't pause when already paused", async function () {

            await lockers.pauseLocker()

            await expect(
                lockers.pauseLocker()
            ).to.be.revertedWith("Pausable: paused")

        });

    });

    describe("#unPauseLocker", async () => {

        it("only admin can un-pause locker", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.unPauseLocker()
            ).to.be.revertedWith("Ownable: caller is not the owner")

        });

        it("can't un-pause when already un-paused", async function () {

            await expect(
                lockers.unPauseLocker()
            ).to.be.revertedWith("Pausable: not paused")

        });

        it("contract un-paused successsfully", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await lockers.pauseLocker()

            await expect(
                lockers.liquidateLocker(
                    signer1Address,
                    10000
                )
            ).to.be.revertedWith("Pausable: paused")

            await lockers.unPauseLocker()

            await expect(
                lockers.liquidateLocker(
                    signer1Address,
                    10000
                )
            ).to.be.revertedWith("Lockers: input address is not a valid locker")

        });

    });

    describe("#setTeleportSystemToken",async () => {

        it("non owners can't call setTeleportSystemToken", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setTST(
                    ONE_ADDRESS
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setTeleportSystemToken", async function () {

            await expect(
                await lockers.setTST(
                    ONE_ADDRESS
                )
            ).to.emit(
                lockers, "NewTST"
            ).withArgs(teleportSystemToken.address, ONE_ADDRESS);

            expect(
                await lockers.TeleportSystemToken()
            ).to.equal(ONE_ADDRESS)
        })
    })

    describe("#setLockerPercentageFee",async () => {

        it("can't set locker percentage fee more than max fee", async function () {
            await expect(
                lockers.setLockerPercentageFee(
                    10001
                )
            ).to.be.revertedWithCustomError(lockers, "InvalidValue")
        })

        it("non owners can't call setLockerPercentageFee", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setLockerPercentageFee(
                    2100
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setLockerPercentageFee", async function () {

            await expect(
                await lockers.setLockerPercentageFee(
                    2100
                )
            ).to.emit(
                lockers, "NewLockerPercentageFee"
            ).withArgs(LOCKER_PERCENTAGE_FEE, 2100);

            expect(
                await lockers.lockerPercentageFee()
            ).to.equal(2100)
        })
    })

    describe("#setPriceWithDiscountRatio",async () => {

        it("non owners can't call setPriceWithDiscountRatio", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setPriceWithDiscountRatio(
                    2100
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setPriceWithDiscountRatio", async function () {

            await expect(
                await lockers.setPriceWithDiscountRatio(
                    2100
                )
            ).to.emit(
                lockers, "NewPriceWithDiscountRatio"
            ).withArgs(PRICE_WITH_DISCOUNT_RATIO, 2100);

            expect(
                await lockers.priceWithDiscountRatio()
            ).to.equal(2100)
        })
    })

    describe("#setMinRequiredTSTLockedAmount",async () => {
        it("non owners can't call setMinRequiredTSTLockedAmount", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setMinRequiredTSTLockedAmount(
                    REQUIRED_LOCKED_AMOUNT
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setMinRequiredTSTLockedAmount", async function () {

            await expect(
                await lockers.setMinRequiredTSTLockedAmount(
                    REQUIRED_LOCKED_AMOUNT + 55
                )
            ).to.emit(
                lockers, "NewMinRequiredTSTLockedAmount"
            ).withArgs(minRequiredTSTLockedAmount, REQUIRED_LOCKED_AMOUNT + 55);

            expect(
                await lockers.minRequiredTSTLockedAmount()
            ).to.equal(REQUIRED_LOCKED_AMOUNT + 55)
        })
    })

    describe("#setPriceOracle",async () => {

        it("price oracle can't be zero address", async function () {

            await expect(
                lockers.setPriceOracle(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")
        })

        it("non owners can't call setPriceOracle", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setPriceOracle(
                    ONE_ADDRESS
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setPriceOracle", async function () {

            await expect(
                await lockers.setPriceOracle(
                    ONE_ADDRESS
                )
            ).to.emit(
                lockers, "NewPriceOracle"
            ).withArgs(mockPriceOracle.address, ONE_ADDRESS);


            expect(
                await lockers.priceOracle()
            ).to.equal(ONE_ADDRESS)
        })
    })

    describe("#setBurnRouter",async () => {

        it("cc burn router can't be zero address", async function () {

            await expect(
                lockers.setBurnRouter(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")
        })

        it("non owners can't call setBurnRouter", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setBurnRouter(
                    ONE_ADDRESS
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setBurnRouter", async function () {

            await expect(
                await lockers.setBurnRouter(
                    ONE_ADDRESS
                )
            ).to.emit(
                lockers, "NewBurnRouter"
            ).withArgs(ccBurnSimulatorAddress, ONE_ADDRESS);

            expect(
                await lockers.burnRouter()
            ).to.equal(ONE_ADDRESS)
        })
    })

    // describe("#setExchangeConnector",async () => {

    //     it("exchange connector can't be zero address", async function () {

    //         await expect(
    //             lockers.setExchangeConnector(
    //                 ZERO_ADDRESS
    //             )
    //         ).to.be.revertedWith("ZeroAddress")
    //     })

    //     it("non owners can't call setExchangeConnector", async function () {
    //         let lockerSigner1 = lockers.connect(signer1)

    //         await expect(
    //             lockerSigner1.setExchangeConnector(
    //                 ONE_ADDRESS
    //             )
    //         ).to.be.revertedWith("Ownable: caller is not the owner")
    //     })

    //     it("only owner can call setExchangeConnector", async function () {

    //         await expect(
    //             await lockers.setExchangeConnector(
    //                 ONE_ADDRESS
    //             )
    //         ).to.emit(
    //             lockers, "NewExchangeConnector"
    //         ).withArgs(mockExchangeConnector.address, ONE_ADDRESS);

    //         expect(
    //             await lockers.exchangeConnector()
    //         ).to.equal(ONE_ADDRESS)
    //     })
    // })

    describe("#setTeleBTC",async () => {

        it("tele BTC can't be zero address", async function () {

            await expect(
                lockers.setTeleBTC(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")
        })

        it("non owners can't call setTeleBTC", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setTeleBTC(
                    ONE_ADDRESS
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setTeleBTC", async function () {

            await expect(
                await lockers.setTeleBTC(
                    ONE_ADDRESS
                )
            ).to.emit(
                lockers, "NewTeleBTC"
            ).withArgs(teleBTC.address, ONE_ADDRESS);

            expect(
                await lockers.teleBTC()
            ).to.equal(ONE_ADDRESS)
        })
    })

    describe("#setCollateralRatio",async () => {

        it("non owners can't call setCollateralRatio", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setCollateralRatio(
                    1234
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setCollateralRatio", async function () {

            await expect(
                await lockers.setCollateralRatio(
                    21000
                )
            ).to.emit(
                lockers, "NewCollateralRatio"
            ).withArgs(collateralRatio, 21000);

            expect(
                await lockers.collateralRatio()
            ).to.equal(21000)
        })

        it("can't set it less than liquidationRatio", async function () {

            await expect(
                lockers.setCollateralRatio(
                    10
                )
            ).to.be.revertedWithCustomError(lockers, "InvalidValue")
        })
    })

    describe("#setLiquidationRatio",async () => {

        it("non owners can't call setLiquidationRatio", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.setLiquidationRatio(
                    1234
                )
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("only owner can call setLiquidationRatio", async function () {

            await expect(
                await lockers.setLiquidationRatio(
                    19000
                )
            ).to.emit(
                lockers, "NewLiquidationRatio"
            ).withArgs(liquidationRatio, 19000);

            expect(
                await lockers.liquidationRatio()
            ).to.equal(19000)
        })
    })

    describe("#modifiers", async () => {
        it("can't set zero address", async function () {
            await expect(
                lockers.setTeleBTC(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")

            await expect(
                lockers.setBurnRouter(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")

            await expect(
                lockers.setPriceOracle(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")

            await expect(
                lockers.addBurner(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")

            await expect(
                lockers.addMinter(
                    ZERO_ADDRESS
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")

        })
    });

    describe("#requestToBecomeLocker", async () => {

        it("setting low TeleportDao token", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    NATIVE_TOKEN_ADDRESS,
                    minRequiredTSTLockedAmount.sub(1),
                    minRequiredNativeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: minRequiredNativeTokenLockedAmount}
                )
            ).to.be.revertedWith("Lockers: low TST")
        })

        it("not approving TeleportDao token", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    NATIVE_TOKEN_ADDRESS,
                    minRequiredTSTLockedAmount,
                    minRequiredNativeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: minRequiredNativeTokenLockedAmount}
                )
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
        })

        it("low message value", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    NATIVE_TOKEN_ADDRESS,
                    minRequiredTSTLockedAmount,
                    minRequiredNativeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: minRequiredNativeTokenLockedAmount.sub(10)}
                )
            ).to.be.revertedWith("Lockers: wrong msg value")
        })

        it("successful request to become locker", async function () {
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)
            
            let oldBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let oldBalance = await ethers.provider.getBalance(signer1Address)
            await expect(
                await lockerSigner1.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    NATIVE_TOKEN_ADDRESS,
                    minRequiredTSTLockedAmount,
                    minRequiredNativeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: minRequiredNativeTokenLockedAmount}
                )
            ).to.emit(lockers, "RequestAddLocker").withArgs(
                signer1Address,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                NATIVE_TOKEN_ADDRESS,
                minRequiredNativeTokenLockedAmount
            )

            await expect(
                await lockers.totalNumberOfCandidates()
            ).to.equal(1)

            let newBalance = await ethers.provider.getBalance(signer1Address)
            let newBalanceTST = await teleportSystemToken.balanceOf(signer1Address)

            await expect (oldBalanceTST.sub(newBalanceTST)).to.be.equal(minRequiredTSTLockedAmount)
            await expect (oldBalance.sub(newBalance)).to.be.closeTo(minRequiredNativeTokenLockedAmount, FEE_ESTIMATE)
        })

        it("successful request to become locker (exchange token)", async function () {
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)
            let oldBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let oldBalanceToken = await exchangeToken.balanceOf(signer1Address)
            await expect(
                await lockerSigner1.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    exchangeToken.address,
                    minRequiredTSTLockedAmount,
                    minRequiredExchangeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: 0}
                )
            ).to.emit(lockers, "RequestAddLocker").withArgs(
                signer1Address,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                exchangeToken.address,
                minRequiredExchangeTokenLockedAmount
            )

            expect(
                await lockers.totalNumberOfCandidates()
            ).to.equal(1)

            let newBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let newBalanceToken = await exchangeToken.balanceOf(signer1Address)

            await expect (oldBalanceTST.sub(newBalanceTST)).to.be.equal(minRequiredTSTLockedAmount)
            await expect (oldBalanceToken.sub(newBalanceToken)).to.be.equal(minRequiredExchangeTokenLockedAmount)

        })

        it("failed to request to become locker with exchange token because msg value is not zero", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    exchangeToken.address,
                    minRequiredTSTLockedAmount,
                    minRequiredNativeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: minRequiredNativeTokenLockedAmount}
                )
            ).to.be.revertedWith("Lockers: wrong msg value")

        })

        it("failed to request to become locker because token is not whitelisted", async function () {
            await lockers.addCollateralToken(exchangeToken.address, 0)

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    exchangeToken.address,
                    minRequiredTSTLockedAmount,
                    minRequiredNativeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: minRequiredNativeTokenLockedAmount}
                )
            ).to.be.revertedWith("Lockers: not whitelisted")

        })

        it("a locker can't requestToBecomeLocker twice", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await expect(
                lockerSigner1.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    NATIVE_TOKEN_ADDRESS,
                    minRequiredTSTLockedAmount,
                    minRequiredNativeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: minRequiredNativeTokenLockedAmount}
                )
            ).to.be.revertedWith("Lockers: is candidate")

        })

        it("a redeem script hash can't be used twice", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            let lockerSigner2 = lockers.connect(signer2)

            await expect(
                lockerSigner2.requestToBecomeLocker(
                    // LOCKER1,
                    LOCKER1_PUBKEY__HASH,
                    NATIVE_TOKEN_ADDRESS,
                    minRequiredTSTLockedAmount,
                    minRequiredNativeTokenLockedAmount,
                    LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                    LOCKER_RESCUE_SCRIPT_P2PKH,
                    {value: minRequiredNativeTokenLockedAmount}
                )
            ).to.be.revertedWith("Lockers: used locking script")

        })
    });

    describe("#revokeRequest", async () => {

        it("trying to revoke a non existing request", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.revokeRequest()
            ).to.be.revertedWithCustomError(lockers, "NotRequested")
        })

        it("successful revoke", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            let oldBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let oldBalance = await ethers.provider.getBalance(signer1Address);

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockerSigner1.revokeRequest()

            let newBalance = await ethers.provider.getBalance(signer1Address)
            let newBalanceTST = await teleportSystemToken.balanceOf(signer1Address)

            await expect(
                await lockers.totalNumberOfCandidates()
            ).to.equal(0)

            await expect (newBalanceTST.sub(oldBalanceTST)).to.be.equal(0)
            await expect (oldBalance.sub(newBalance)).to.be.closeTo(BigNumber.from(0), FEE_ESTIMATE)
        })

        it("successful revoke (exchange token)", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)
            let oldBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let oldBalanceToken = await exchangeToken.balanceOf(signer1Address)
            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            )

            await expect (
                await exchangeToken.balanceOf(signer1Address)
            ).to.be.equal(0)

            await lockerSigner1.revokeRequest()

            expect(
                await lockers.totalNumberOfCandidates()
            ).to.equal(0)

            let newBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let newBalanceToken = await exchangeToken.balanceOf(signer1Address)
            await expect (oldBalanceTST.sub(newBalanceTST)).to.be.equal(0)
            await expect (oldBalanceToken.sub(newBalanceToken)).to.be.equal(0)
        })

    });

    describe("#addLocker", async () => {

        it("only owner can add locker", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })

        it("trying to add a non existing request as a locker", async function () {
            await expect(
                lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.be.revertedWithCustomError(lockers, "NotRequested")
        })

        it("adding a locker", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded").withArgs(
                signer1Address,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                NATIVE_TOKEN_ADDRESS,
                minRequiredNativeTokenLockedAmount,
                ONE_HOUNDRED_PERCENT,
                anyValue
            )

            expect(
                await lockers.totalNumberOfCandidates()
            ).to.equal(0)

            expect(
                await lockers.totalNumberOfLockers()
            ).to.equal(1)

            let theLockerMapping = await lockers.lockersMapping(signer1Address)
            expect(
                theLockerMapping[0]
            ).to.equal(LOCKER1_PUBKEY__HASH)

            expect(
                await lockers.getLockerTargetAddress(
                    LOCKER1_PUBKEY__HASH
                )
            ).to.equal(signer1Address)

            expect(
                await lockers.isLocker(
                    LOCKER1_PUBKEY__HASH
                )
            ).to.equal(true)
        })

        it("adding a locker (exchange token)", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            )

            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded").withArgs(
                signer1Address,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                exchangeToken.address,
                minRequiredExchangeTokenLockedAmount,
                ONE_HOUNDRED_PERCENT,
                anyValue
            )

            expect(
                await lockers.totalNumberOfCandidates()
            ).to.equal(0)

            expect(
                await lockers.totalNumberOfLockers()
            ).to.equal(1)

            let theLockerMapping = await lockers.lockersMapping(signer1Address)
            expect(
                theLockerMapping[0]
            ).to.equal(LOCKER1_PUBKEY__HASH)

            expect(
                await lockers.getLockerTargetAddress(
                    LOCKER1_PUBKEY__HASH
                )
            ).to.equal(signer1Address)

            expect(
                await lockers.isLocker(
                    LOCKER1_PUBKEY__HASH
                )
            ).to.equal(true)
        })
    });

    describe("#requestInactivation", async () => {

        it("trying to request to remove a non existing locker", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.requestInactivation()
            ).to.be.revertedWithCustomError(lockers, "NotLocker")
        })

        it("successfully request to be removed", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await expect(
                await lockerSigner1.requestInactivation()
            ).to.emit(lockers, "RequestInactivateLocker").withArgs(
                signer1Address,
                anyValue,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                NATIVE_TOKEN_ADDRESS,
                minRequiredNativeTokenLockedAmount,
                0
            )

            await expect(
                lockerSigner1.requestInactivation()
            ).to.be.revertedWith("Lockers: already requested")
        })

        //TODO add test for lockerInactivationTimestamp

    });

    describe("#requestActivation", async () => {

        it("trying to activate a non existing locker", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.requestActivation()
            ).to.be.revertedWithCustomError(lockers, "NotLocker")
        })

        it("successfully request to be activated", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await expect(
                await lockerSigner1.requestInactivation()
            ).to.emit(lockers, "RequestInactivateLocker")

            await expect(
                await lockerSigner1.requestActivation()
            ).to.emit(lockers, "ActivateLocker").withArgs(
                signer1Address,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                NATIVE_TOKEN_ADDRESS,
                minRequiredNativeTokenLockedAmount,
                0
            )
        })

        it("successfully request to be activated(exchange token)", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await expect(
                await lockerSigner1.requestInactivation()
            ).to.emit(lockers, "RequestInactivateLocker")

            await expect(
                await lockerSigner1.requestActivation()
            ).to.emit(lockers, "ActivateLocker").withArgs(
                signer1Address,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                exchangeToken.address,
                minRequiredExchangeTokenLockedAmount,
                0
            )
        })

    });

    describe("#selfRemoveLocker", async () => {

        it("a non-existing locker can't be removed", async function () {

            let lockerSigner1 = await lockers.connect(signer1)

            await expect(
                lockerSigner1.selfRemoveLocker()
            ).to.be.revertedWithCustomError(lockers, "NotLocker")
        })

        it("can't remove a locker if it doesn't request to be removed", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await expect(
                lockerSigner1.selfRemoveLocker()
            ).to.be.revertedWithCustomError(lockers, "LockerActive")
        })

        it("the locker can't be removed because netMinted is not zero", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000);
            await lockers.addMinter(signer2Address);
            let lockerSigner2 = lockers.connect(signer2)

            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, 1000);

            await lockerSigner1.requestInactivation();

            // Forwards block.timestamp to inactivate locker
            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY);
            
            let teleBTCSigner1 = teleBTC.connect(signer1)
            await teleBTCSigner1.approve(lockers.address, "1000");

            await expect(
                lockerSigner1.selfRemoveLocker()
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
        })

        it("the locker is removed successfully", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            let oldBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let oldBalance = await ethers.provider.getBalance(signer1Address)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await lockerSigner1.requestInactivation()
            
            // Forwards block.timestamp to inactivate locker
            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY);

            await expect(
                await lockerSigner1.selfRemoveLocker()
            ).to.emit(lockers, "LockerRemoved").withArgs(
                signer1Address,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                NATIVE_TOKEN_ADDRESS,
                minRequiredNativeTokenLockedAmount
            )

            expect(
                await lockers.totalNumberOfLockers()
            ).to.equal(0)

            let newBalance = await ethers.provider.getBalance(signer1Address)
            let newBalanceTST = await teleportSystemToken.balanceOf(signer1Address)

            await expect (oldBalanceTST.sub(newBalanceTST)).to.be.equal(0)
            await expect (oldBalance.sub(newBalance)).to.be.closeTo(BigNumber.from(0), FEE_ESTIMATE)
        })

        it("the locker is removed successfully (exchange token)", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            let oldBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let oldBalanceToken = await exchangeToken.balanceOf(signer1Address)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            )

            await expect (
                await exchangeToken.balanceOf(signer1Address)
            ).to.be.equal(0)

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await lockerSigner1.requestInactivation()

            // Forwards block.timestamp to inactivate locker
            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY);

            await expect(
                await lockerSigner1.selfRemoveLocker()
            ).to.emit(lockers, "LockerRemoved").withArgs(
                signer1Address,
                LOCKER1_PUBKEY__HASH,
                minRequiredTSTLockedAmount,
                exchangeToken.address,
                minRequiredExchangeTokenLockedAmount
            )

            let newBalanceTST = await teleportSystemToken.balanceOf(signer1Address)
            let newBalanceToken = await exchangeToken.balanceOf(signer1Address)
            await expect (oldBalanceTST.sub(newBalanceTST)).to.be.equal(0)
            await expect (oldBalanceToken.sub(newBalanceToken)).to.be.equal(0)

            expect(
                await lockers.totalNumberOfLockers()
            ).to.equal(0)
        })

    });

    describe("#slashIdleLocker", async () => {

        it("only cc burn can call slash locker function", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockerSigner1.slashIdleLocker(
                    signer1Address,
                    0,
                    deployerAddress,
                    btcAmountToSlash,
                    ccBurnSimulatorAddress
                )
            ).to.be.revertedWithCustomError(lockersLib, "NotBurnRouter")
        })

        it("slash locker reverts when the target address is not locker", async function () {
            let lockerCCBurnSimulator = lockers.connect(ccBurnSimulator)

            await expect(
                lockerCCBurnSimulator.slashIdleLocker(
                    signer1Address,
                    0,
                    deployerAddress,
                    btcAmountToSlash,
                    ccBurnSimulatorAddress
                )
            ).to.be.revertedWith("Lockers: input address is not a valid locker")
        })

        it("can't slash more than collateral", async function () {

            await mockPriceOracle.mock.equivalentOutputAmount.returns(
                BigNumber.from(10).pow(18).mul(6)
            )
            // await mockExchangeConnector.mock.getInputAmount.returns(true, minRequiredTSTLockedAmount.div(10))
            // await mockExchangeConnector.mock.swap.returns(true, [2500, 5000])

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded")

            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)

            await expect(
                await lockerCCBurnSigner.slashIdleLocker(
                    signer1Address,
                    0,
                    deployerAddress,
                    10000,
                    ccBurnSimulatorAddress
                )
            ).to.emit(lockerCCBurnSigner, "LockerSlashed")

        })


        it("cc burn can slash a locker", async function () {

            let _equivalentOutputAmount = 10000
            let reward = 30000
            let amount = 10000
            let rewardPlusAmount = reward + amount

            let oldBalanceSinger2 = await ethers.provider.getBalance(signer2Address)
            let oldBalanceSinger3 = await ethers.provider.getBalance(signer3Address)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(_equivalentOutputAmount)

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await expect(
                await lockers.addLocker(signer1Address, 1)
            ).to.emit(lockers, "LockerAdded")

            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)

            await expect(
                await lockerCCBurnSigner.slashIdleLocker(
                    signer1Address,
                    reward,
                    signer2Address,
                    amount,
                    signer3Address
                )
            ).to.emit(lockers, "LockerSlashed").withArgs(
                signer1Address,
                NATIVE_TOKEN_ADDRESS,
                _equivalentOutputAmount * reward / rewardPlusAmount,
                signer2Address,
                _equivalentOutputAmount,
                signer3Address,
                _equivalentOutputAmount,
                anyValue,
                true
            )
            
            let newBalanceSinger2 = await ethers.provider.getBalance(signer2Address)
            let newBalanceSinger3 = await ethers.provider.getBalance(signer3Address)

            await expect (
                newBalanceSinger2.sub(oldBalanceSinger2)
            ).to.be.equal((_equivalentOutputAmount * reward / rewardPlusAmount))

            await expect (
                newBalanceSinger3.sub(oldBalanceSinger3)
            ).to.be.equal((_equivalentOutputAmount * amount / rewardPlusAmount))
        })


        it("cc burn can slash a locker (token collateral)", async function () {

            let _equivalentOutputAmount = 10000
            await mockPriceOracle.mock.equivalentOutputAmount.returns(_equivalentOutputAmount)

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            )

            await expect(
                await lockers.addLocker(signer1Address, 1)
            ).to.emit(lockers, "LockerAdded")

            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)

            let reward = 30000
            let amount = 10000
            let rewardPlusAmount = reward + amount

            await expect(
                await lockerCCBurnSigner.slashIdleLocker(
                    signer1Address,
                    reward,
                    signer2Address,
                    amount,
                    signer3Address
                )
            ).to.emit(lockers, "LockerSlashed").withArgs(
                signer1Address,
                exchangeToken.address,
                _equivalentOutputAmount * reward / rewardPlusAmount,
                signer2Address,
                _equivalentOutputAmount,
                signer3Address,
                _equivalentOutputAmount,
                anyValue,
                true
            )

            await expect (
                await exchangeToken.balanceOf(signer2Address)
            ).to.be.equal((_equivalentOutputAmount * reward / rewardPlusAmount))

            await expect (
                await exchangeToken.balanceOf(signer3Address)
            ).to.be.equal((_equivalentOutputAmount * amount / rewardPlusAmount))

        })

    });

    describe("#slashTheifLocker", async () => {

        it("only cc burn can call slash locker function", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockers.slashThiefLocker(
                    signer1Address,
                    0,
                    deployerAddress,
                    btcAmountToSlash
                )
            ).to.be.revertedWithCustomError(lockersLib, "NotBurnRouter")
        })

        it("slash locker reverts when the target address is not locker", async function () {
            let lockerCCBurnSimulator = lockers.connect(ccBurnSimulator)

            await expect(
                lockerCCBurnSimulator.slashThiefLocker(
                    signer1Address,
                    0,
                    deployerAddress,
                    btcAmountToSlash
                )
            ).to.be.revertedWith("Lockers: input address is not a valid locker")
        })

        it("cc burn can slash a locker", async function () {

            let TNTAmount = 10000;
            let TeleBTCAmount = 1000;
            let reward = 1000;
            let oldBalanceSinger2 = await ethers.provider.getBalance(signer2Address)
            // Initialize mock contract (how much TNT locker should be penalized)
            await mockPriceOracle.mock.equivalentOutputAmount.returns(TNTAmount)

            // Signer 1 becomes a locker
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)
            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            let lockerSigner1 = lockers.connect(signer1)
            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )
            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded")

            // Locker mints some TeleBTC and gets BTC on Bitcoin
            await lockers.addMinter(signer1Address);
            await lockerSigner1.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, TeleBTCAmount);

            // ccBurn calls to slash the locker
            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)
            
            await expect(
                await lockerCCBurnSigner.slashThiefLocker(
                    signer1Address,
                    reward,
                    signer2Address,
                    TeleBTCAmount
                )
            ).to.emit(lockers, "LockerSlashed").withArgs(
                signer1Address,
                NATIVE_TOKEN_ADDRESS,
                TNTAmount * reward / TeleBTCAmount,
                signer2Address,
                TeleBTCAmount,
                lockers.address,
                TNTAmount * liquidationRatio / ONE_HOUNDRED_PERCENT + TNTAmount * reward / TeleBTCAmount,
                anyValue,
                false
            )

            let newBalanceSinger2 = await ethers.provider.getBalance(signer2Address)
            await expect(
                newBalanceSinger2.sub(oldBalanceSinger2)
            ).to.be.equal(TNTAmount * reward / TeleBTCAmount)

        })

        it("cc burn can slash a locker (reliability factor = 3/4)", async function () {

            let TNTAmount = 10000;
            let TeleBTCAmount = 1000;
            let reward = 1000;
            let oldBalanceSinger2 = await ethers.provider.getBalance(signer2Address)
            // Initialize mock contract (how much TNT locker should be penalized)
            await mockPriceOracle.mock.equivalentOutputAmount.returns(TNTAmount)

            // Signer 1 becomes a locker
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)
            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            let lockerSigner1 = lockers.connect(signer1)
            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )
            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT*3/4)
            ).to.emit(lockers, "LockerAdded")

            // Locker mints some TeleBTC and gets BTC on Bitcoin
            await lockers.addMinter(signer1Address);
            await lockerSigner1.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, TeleBTCAmount);

            // ccBurn calls to slash the locker
            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)
            
            await expect(
                await lockerCCBurnSigner.slashThiefLocker(
                    signer1Address,
                    reward,
                    signer2Address,
                    TeleBTCAmount
                )
            ).to.emit(lockers, "LockerSlashed").withArgs(
                signer1Address,
                NATIVE_TOKEN_ADDRESS,
                TNTAmount * reward / TeleBTCAmount,
                signer2Address,
                TeleBTCAmount,
                lockers.address,
                TNTAmount * liquidationRatio * 3 / (4 * ONE_HOUNDRED_PERCENT) + TNTAmount * reward / TeleBTCAmount,
                anyValue,
                false
            )

            let newBalanceSinger2 = await ethers.provider.getBalance(signer2Address)
            await expect(
                newBalanceSinger2.sub(oldBalanceSinger2)
            ).to.be.equal(TNTAmount * reward / TeleBTCAmount)

        })

        it("cc burn can slash a locker (token collateral)", async function () {
            let TNTAmount = 10000;
            let TeleBTCAmount = 1000;
            let reward = 1000;
            // Initialize mock contract (how much TNT locker should be penalized)
            await mockPriceOracle.mock.equivalentOutputAmount.returns(TNTAmount)

            // Signer 1 becomes a locker
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)
            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            let lockerSigner1 = lockers.connect(signer1)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            )
            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded")

            // Locker mints some TeleBTC and gets BTC on Bitcoin
            await lockers.addMinter(signer1Address);
            await lockerSigner1.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, TeleBTCAmount);

            // ccBurn calls to slash the locker
            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)

            await expect(
                await lockerCCBurnSigner.slashThiefLocker(
                    signer1Address,
                    reward,
                    signer2Address,
                    TeleBTCAmount
                )
            ).to.emit(lockers, "LockerSlashed").withArgs(
                signer1Address,
                exchangeToken.address,
                TNTAmount * reward / TeleBTCAmount,
                signer2Address,
                TeleBTCAmount,
                lockers.address,
                TNTAmount * liquidationRatio / ONE_HOUNDRED_PERCENT + TNTAmount * reward / TeleBTCAmount,
                anyValue,
                false
            )

            await expect(
                await exchangeToken.balanceOf(signer2Address)
            ).to.be.equal(TNTAmount * reward / TeleBTCAmount)

        })
    });

    describe("#buySlashedCollateralOfLocker", async () => {

        it("reverts when the target address is not locker", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockers.buySlashedCollateralOfLocker(
                    signer1Address,
                    10
                )
            ).to.be.revertedWith("Lockers: input address is not a valid locker")
        })

        it("reverts the target address is zero", async function () {
            let lockerSigner1 = lockers.connect(signer1)

            await expect(
                lockers.buySlashedCollateralOfLocker(
                    ZERO_ADDRESS,
                    10
                )
            ).to.be.revertedWith("Lockers: input address is not a valid locker")
        })

        it("not enough slashed amount to buy", async function () {

            let TNTAmount = 10000;
            let TeleBTCAmount = 1000;
            // Initialize mock contract (how much TNT locker should be penalized)
            await mockPriceOracle.mock.equivalentOutputAmount.returns(TNTAmount)

            // Signer 1 becomes a locker
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)
            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            let lockerSigner1 = lockers.connect(signer1)
            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )
            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded")

            // Locker mints some TeleBTC and gets BTC on Bitcoin
            await lockers.addMinter(signer1Address);
            await lockerSigner1.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, TeleBTCAmount);

            // ccBurn calls to slash the locker
            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)

            await expect(
                await lockerCCBurnSigner.slashThiefLocker(
                    signer1Address,
                    0,
                    deployerAddress,
                    TeleBTCAmount
                )
            ).to.emit(lockerCCBurnSigner, "LockerSlashed")

            // Someone buys slashed collateral with discount
            let lockerSigner2 = lockers.connect(signer2)
            await expect(
                lockers.buySlashedCollateralOfLocker(
                    signer1Address,
                    TNTAmount * liquidationRatio + 1
                )
            ).to.be.revertedWith("Lockers: not enough slashed collateral to buy")
        })

        it("can't slash because needed BTC is more than existing", async function () {

            let TNTAmount = 10000;
            let TeleBTCAmount = 1000;
            // Initialize mock contract (how much TNT locker should be penalized)
            await mockPriceOracle.mock.equivalentOutputAmount.returns(TNTAmount)

            // Signer 1 becomes a locker
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)
            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            let lockerSigner1 = lockers.connect(signer1)
            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )
            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded")

            // Locker mints some TeleBTC and gets BTC on Bitcoin
            await lockers.addMinter(signer1Address);
            await lockerSigner1.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, TeleBTCAmount);

            // ccBurn calls to slash the locker
            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(minRequiredNativeTokenLockedAmount.div(5))

            await expect(
                await lockerCCBurnSigner.slashThiefLocker(
                    signer1Address,
                    0,
                    deployerAddress,
                    TeleBTCAmount
                )
            ).to.emit(lockerCCBurnSigner, "LockerSlashed")

            // Someone buys slashed collateral with discount
            let lockerSigner2 = lockers.connect(signer2)
            await expect(
                lockerSigner2.buySlashedCollateralOfLocker(
                    signer1Address,
                    BigNumber.from(10).pow(18).mul(1)
                )
            ).to.be.reverted;

        })

        it("can buy slashing amount", async function () {

            let TNTAmount = 10000;
            let TeleBTCAmount = 1000;
            // Initialize mock contract (how much TNT locker should be penalized)
            await mockPriceOracle.mock.equivalentOutputAmount.returns(TNTAmount)

            // Signer 1 becomes a locker
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)
            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            let lockerSigner1 = lockers.connect(signer1)
            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )
            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded")

            // Locker mints some TeleBTC and gets BTC on Bitcoin
            await lockers.addMinter(signer1Address);
            await lockerSigner1.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, TeleBTCAmount);

            // ccBurn calls to slash the locker
            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(minRequiredNativeTokenLockedAmount.div(5))

            await lockerCCBurnSigner.slashThiefLocker(
                signer1Address,
                0,
                deployerAddress,
                TeleBTCAmount
            );

            let theLocker = await lockers.lockersMapping(signer1Address)

            expect(
                theLocker[6]
            ).to.equal(TeleBTCAmount)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(TeleBTCAmount)

            await teleBTC.mint(signer2Address, 10000000)

            let teleBTCSigner2 = await teleBTC.connect(signer2);

            await teleBTCSigner2.approve(lockers.address, 1 + TeleBTCAmount*95/100) // add 1 bcz of precision loss

            let collateralAmount = BigNumber.from(10).pow(18).mul(1)

            //TODO concept?
            let neededTeleBTC = theLocker.slashingTeleBTCAmount.mul(
                collateralAmount
            ).div(theLocker.reservedCollateralTokenForSlash).add(1)

            // Someone buys slashed collateral with discount
            let lockerSigner2 = lockers.connect(signer2)
            await expect(
                await lockerSigner2.buySlashedCollateralOfLocker(
                    signer1Address,
                    collateralAmount
                )
            ).to.emit(lockers, "LockerSlashedCollateralSold").withArgs(
                signer1Address,
                signer2Address,
                NATIVE_TOKEN_ADDRESS,
                collateralAmount,
                neededTeleBTC, 
                anyValue
            )

        })

        it("can buy slashing amount (exchange Token)", async function () {

            let TNTAmount = 10000;
            let TeleBTCAmount = 1000;
            // Initialize mock contract (how much TNT locker should be penalized)
            await mockPriceOracle.mock.equivalentOutputAmount.returns(TNTAmount)

            // Signer 1 becomes a locker
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)
            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)
            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            )
            await expect(
                await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)
            ).to.emit(lockers, "LockerAdded")

            // Locker mints some TeleBTC and gets BTC on Bitcoin
            await lockers.addMinter(signer1Address);
            await lockerSigner1.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, TeleBTCAmount);

            // ccBurn calls to slash the locker
            let lockerCCBurnSigner = await lockers.connect(ccBurnSimulator)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(minRequiredExchangeTokenLockedAmount.div(5))

            await lockerCCBurnSigner.slashThiefLocker(
                signer1Address,
                0,
                deployerAddress,
                TeleBTCAmount
            );

            let theLocker = await lockers.lockersMapping(signer1Address)

            expect(
                theLocker[6]
            ).to.equal(TeleBTCAmount)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(TeleBTCAmount)

            await teleBTC.mint(signer2Address, 10000000)

            let teleBTCSigner2 = await teleBTC.connect(signer2);

            await teleBTCSigner2.approve(lockers.address, 1 + TeleBTCAmount*95/100) // add 1 bcz of precision loss
            // Someone buys slashed collateral with discount
            let lockerSigner2 = lockers.connect(signer2)
            
            let collateralAmount = minRequiredExchangeTokenLockedAmount.div(5)
            let neededTeleBTC = theLocker.slashingTeleBTCAmount.mul(collateralAmount).div(theLocker.reservedCollateralTokenForSlash).add(1)

            await expect(
                lockerSigner2.buySlashedCollateralOfLocker(
                    signer1Address,
                    collateralAmount
                )
            ).to.emit(lockers, "LockerSlashedCollateralSold").withArgs(
                signer1Address,
                signer2Address,
                exchangeToken.address,
                collateralAmount,
                neededTeleBTC,
                anyValue
            )

        })


    });

    describe("#mint", async () => {

        let amount;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("only minter can mint with non zero value", async function () {
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            let lockerSigner2 = lockers.connect(signer2)

            amount = 1000;

            await expect (
                lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, amount)
            ).to.be.revertedWithCustomError(lockers, "NotMinter")
        })

        it("Mints tele BTC", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            amount = 1000;
            let lockerFee = Math.floor(amount*LOCKER_PERCENTAGE_FEE/10000);

            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, amount);

            let theLockerMapping = await lockers.lockersMapping(signer1Address);

            expect(
                theLockerMapping[5]
            ).to.equal(1000);

            // Checks that enough teleBTC has been minted for user
            expect(
                await teleBTC.balanceOf(ONE_ADDRESS)
            ).to.equal(amount - lockerFee);

            // Checks that enough teleBTC has been minted for locker
            expect(
                await teleBTC.balanceOf(signer1Address)
            ).to.equal(lockerFee);
        })


        it("can't mint tele BTC above capacity", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, 1);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await expect(
                lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, "25000000000000000000001")
            ).to.be.revertedWith("Lockers: insufficient capacity")

        })

    });

    describe("#burn", async () => {

        let amount;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("only burner can burn with non zero value", async function () {
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await lockers.addMinter(signer2Address)

            let lockerSigner2 = lockers.connect(signer2)

            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, signer2Address, 1000)

            let theLockerMapping = await lockers.lockersMapping(signer1Address);

            expect(
                theLockerMapping[5]
            ).to.equal(1000);

            await teleBTC.mint(signer2Address, 10000000)

            let teleBTCSigner2 = teleBTC.connect(signer2)

            amount = 900;

            await teleBTCSigner2.approve(lockers.address, amount);

            await expect (
                lockerSigner2.burn(LOCKER1_PUBKEY__HASH, amount)
            ).to.be.revertedWithCustomError(lockers, "NotBurner")

        })

        it("Burns tele BTC", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await lockers.addMinter(signer2Address)
            await lockers.addBurner(signer2Address)

            let lockerSigner2 = lockers.connect(signer2)

            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, signer2Address, 1000)

            let theLockerMapping = await lockers.lockersMapping(signer1Address);

            expect(
                theLockerMapping[5]
            ).to.equal(1000);

            await teleBTC.mint(signer2Address, 10000000)

            let teleBTCSigner2 = teleBTC.connect(signer2)

            amount = 900;
            let lockerFee = Math.floor(amount*LOCKER_PERCENTAGE_FEE/10000);

            await teleBTCSigner2.approve(lockers.address, amount);

            await lockerSigner2.burn(LOCKER1_PUBKEY__HASH, amount);

            theLockerMapping = await lockers.lockersMapping(signer1Address);

            expect(
                theLockerMapping[5]
            ).to.equal(1000 - amount + lockerFee);


        })

        it("can't burn if lockers net minted is not sufficient", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT)

            await lockers.addMinter(signer2Address)
            await lockers.addBurner(signer2Address)

            let lockerSigner2 = lockers.connect(signer2)

            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, signer2Address, 1)

            await teleBTC.mint(signer2Address, 10000000)

            let teleBTCSigner2 = teleBTC.connect(signer2)

            amount = 900;

            await teleBTCSigner2.approve(lockers.address, amount);

            await expect (
                lockerSigner2.burn(LOCKER1_PUBKEY__HASH, amount)
            ).to.be.revertedWithCustomError(lockers, "InsufficientFunds")


        })

    });

    describe("#liquidateLocker", async () => {

        const calculateNeededTeleBTC = async (_amount, _address: string, _decimal, _price) => {
            let res1 = (_amount.mul(_price).mul(PRICE_WITH_DISCOUNT_RATIO))
            let res2 = BigNumber.from(ONE_HOUNDRED_PERCENT).mul(BigNumber.from(10).pow(_decimal))
            return res1.div(res2).add(1)
        }
        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("liquidate locker reverts when the target address is zero", async function () {
            let lockerCCBurnSimulator = lockers.connect(ccBurnSimulator)

            await expect(
                lockerCCBurnSimulator.liquidateLocker(
                    ZERO_ADDRESS,
                    1000
                )
            ).to.be.revertedWith("Lockers: input address is not a valid locker")
        })

        it("liquidate locker reverts when the amount is zero", async function () {
            let lockerCCBurnSimulator = lockers.connect(ccBurnSimulator)

            await expect(
                lockerCCBurnSimulator.liquidateLocker(
                    signer1Address,
                    0
                )
            ).to.be.revertedWithCustomError(lockers, "ZeroValue")
        })

        it("liquidate locker reverts when the target address is not locker", async function () {
            let lockerCCBurnSimulator = lockers.connect(ccBurnSimulator)

            await expect(
                lockerCCBurnSimulator.liquidateLocker(
                    signer1Address,
                    1000
                )
            ).to.be.revertedWith("Lockers: input address is not a valid locker")
        })

        it("can't liquidate because it's above liquidation ratio", async function () {

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, 5000000);

            await expect(
                lockerSigner2.liquidateLocker(signer1Address, 5000)
            ).to.be.revertedWith("Lockers: is healthy")

        });

        it("can't liquidate because it's above the liquidated amount", async function () {

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(50000000);
            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, 25000000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(7000000);

            await expect(
                lockerSigner2.liquidateLocker(
                    signer1Address,
                    BigNumber.from(10).pow(18).mul(3)
                )
            ).to.be.revertedWith("Lockers: not enough collateral to buy")

        });

        it("successfully liquidate the locker", async function () {

            await lockers.setBurnRouter(mockBurnRouter.address);
            await mockBurnRouter.mock.unwrap.returns(8000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(50000000);
            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, signer2Address, 25000000);


            let teleBTCSigner2 = await teleBTC.connect(signer2);

            await teleBTCSigner2.approve(lockers.address, 13300000 + 1) // add 1 bcz of precision loss

            let signer2NativeTokenBalanceBefore = await teleBTC.provider.getBalance(signer2Address)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(7000000);
            let collateralAmount = BigNumber.from(10).pow(18).mul(2)


            let oldHealthFactor = await lockers.getLockerHealthFactor(signer1Address)
            await expect(Number(oldHealthFactor)).to.be.lessThan(ONE_HOUNDRED_PERCENT)

            let neededTeleBTC = await calculateNeededTeleBTC(collateralAmount, NATIVE_TOKEN_ADDRESS, NATIVE_TOKEN_DECIMAL, 7000000)

            await expect(
                await lockerSigner2.liquidateLocker(
                    signer1Address,
                    collateralAmount
                )
            ).to.emit(lockerSigner2, "LockerLiquidated").withArgs(
                signer1Address,
                signer2Address,
                NATIVE_TOKEN_ADDRESS,
                collateralAmount,
                neededTeleBTC,
                anyValue
            )

            let signer2NativeTokenBalanceAfter = await teleBTC.provider.getBalance(signer2Address)

            await expect(
                signer2NativeTokenBalanceAfter.sub(signer2NativeTokenBalanceBefore)
            ).to.be.closeTo(BigNumber.from(10).pow(18).mul(2), BigNumber.from(10).pow(15).mul(1))

            // because we use mock for ccburn, we have to burn it manually
            await teleBTC.mint(signer2Address, 10000000)
            await lockers.addBurner(signer2Address)
            await teleBTCSigner2.approve(lockers.address, neededTeleBTC)
            await lockerSigner2.burn(LOCKER1_PUBKEY__HASH, neededTeleBTC)

            let newHealthFactor = await lockers.getLockerHealthFactor(signer1Address)
            await expect (Number(newHealthFactor)).to.be.greaterThan(Number(oldHealthFactor))

        });

        it("successfully liquidate the locker (exchange token)", async function () {

            await lockers.setBurnRouter(mockBurnRouter.address);
            await mockBurnRouter.mock.unwrap.returns(8000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(50000000);
            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, signer2Address, 25000000);


            let teleBTCSigner2 = await teleBTC.connect(signer2);

            await teleBTCSigner2.approve(lockers.address, 13300000 + 1) // add 1 bcz of precision loss

            let signer2NativeTokenBalanceBefore = await exchangeToken.balanceOf(signer2Address)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(3000000);
            let collateralAmount = BigNumber.from(10).pow(18).mul(2)

            let oldHealthFactor = await lockers.getLockerHealthFactor(signer1Address)
            await expect(Number(oldHealthFactor)).to.be.lessThan(ONE_HOUNDRED_PERCENT)

            let neededTeleBTC = await calculateNeededTeleBTC(collateralAmount, NATIVE_TOKEN_ADDRESS, NATIVE_TOKEN_DECIMAL, 3000000)

            await expect(
                await lockerSigner2.liquidateLocker(
                    signer1Address,
                    collateralAmount
                )
            ).to.emit(lockerSigner2, "LockerLiquidated").withArgs(
                signer1Address,
                signer2Address,
                exchangeToken.address,
                collateralAmount,
                neededTeleBTC,
                anyValue
            )

            let signer2NativeTokenBalanceAfter = await exchangeToken.balanceOf(signer2Address)

            await expect(
                signer2NativeTokenBalanceAfter.sub(signer2NativeTokenBalanceBefore)
            ).to.be.equal(collateralAmount)

            // because we use mock for ccburn, we have to burn it manually
            await teleBTC.mint(signer2Address, 10000000)
            await lockers.addBurner(signer2Address)
            await teleBTCSigner2.approve(lockers.address, neededTeleBTC)
            await lockerSigner2.burn(LOCKER1_PUBKEY__HASH, neededTeleBTC)

            let newHealthFactor = await lockers.getLockerHealthFactor(signer1Address)
            await expect (Number(newHealthFactor)).to.be.greaterThan(Number(oldHealthFactor))

        });

        it("only can liquidate locker till it reaches upper health factor", async function () {
                
            await lockers.setBurnRouter(mockBurnRouter.address);
            await mockBurnRouter.mock.unwrap.returns(8000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(50000000);
            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, signer2Address, 25000000);


            let teleBTCSigner2 = await teleBTC.connect(signer2);


            await mockPriceOracle.mock.equivalentOutputAmount.returns(7000000);

            const calculateHealthFactor = async (mid, priceOfOneUnitOfCollateral) => {
                let neededTeleBTC = await calculateNeededTeleBTC(mid, NATIVE_TOKEN_ADDRESS, NATIVE_TOKEN_DECIMAL, priceOfOneUnitOfCollateral)
                let res1 = BigNumber.from(priceOfOneUnitOfCollateral).mul(minRequiredNativeTokenLockedAmount.sub(mid)).mul(ONE_HOUNDRED_PERCENT).mul(BigNumber.from(10).pow(1 + await teleBTC.decimals()))
                let res2 = (((await lockers.lockersMapping(signer1Address)).netMinted).sub(neededTeleBTC)).mul(liquidationRatio).mul(ONE_HOUNDRED_PERCENT).mul(BigNumber.from(10).pow(1 + await exchangeToken.decimals()))

                if (res2 <= 0) return true
                return res1.div(res2) > UPPER_HEALTH_FACTOR
            }

            await teleBTC.mint(signer2Address, 10000000)
            let l = BigNumber.from(0), r = minRequiredNativeTokenLockedAmount
            while (r.sub(l) > BigNumber.from(1)) {
                let mid = (l.add(r)).div(2)
                if (await calculateHealthFactor(mid, 7000000))
                    r = mid;
                else
                    l = mid
            }
            await teleBTCSigner2.approve(lockers.address, l.add(1)) // add 1 bcz of precision loss
            await expect(
                lockerSigner2.liquidateLocker(
                    signer1Address,
                    l.div(BigNumber.from(10).pow(14)).mul(BigNumber.from(10).pow(14))
                )
            ).to.be.revertedWith("Lockers: not enough collateral to buy")
                
            l = l.div(BigNumber.from(10).pow(15)).mul(BigNumber.from(10).pow(15))
            await lockerSigner2.liquidateLocker(
                signer1Address,
                l
            )

            await lockers.addBurner(signer2Address)
            let neededTeleBTC = await calculateNeededTeleBTC(l, NATIVE_TOKEN_ADDRESS, NATIVE_TOKEN_DECIMAL, 7000000)

            // because we use mock for ccburn, we have to burn it manually
            await teleBTCSigner2.approve(lockers.address, neededTeleBTC)
            await lockerSigner2.burn(LOCKER1_PUBKEY__HASH, neededTeleBTC)

            let newHealthFactor = await lockers.getLockerHealthFactor(signer1Address)
            await expect(UPPER_HEALTH_FACTOR - Number(newHealthFactor)).to.be.lessThan(50)
            
        });

        it("only can liquidate locker till it reaches upper health factor (reliability factor = 3/4)", async function () {
                
            await lockers.setBurnRouter(mockBurnRouter.address);
            await mockBurnRouter.mock.unwrap.returns(8000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT * 3 / 4);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(50000000);
            await lockerSigner2.mint(LOCKER1_PUBKEY__HASH, signer2Address, 25000000);


            let teleBTCSigner2 = await teleBTC.connect(signer2);


            await mockPriceOracle.mock.equivalentOutputAmount.returns(3500000);

            let oldHealthFactor = await lockers.getLockerHealthFactor(signer1Address)
            await expect(Number(oldHealthFactor)).to.be.lessThan(ONE_HOUNDRED_PERCENT)

            await teleBTC.mint(signer2Address, 10000000)
            //maximum buyable will be greater than nativeLockedAmount
            await teleBTCSigner2.approve(lockers.address, minRequiredNativeTokenLockedAmount.add(1)) // add 1 bcz of precision loss

            await expect(
                lockerSigner2.liquidateLocker(
                    signer1Address,
                    minRequiredNativeTokenLockedAmount.add(1)
                )
            ).to.be.revertedWith("Lockers: not enough collateral to buy")
                
            await lockerSigner2.liquidateLocker(
                signer1Address,
                minRequiredNativeTokenLockedAmount
            )

            // because we use mock for ccburn, we have to burn it manually
            await lockers.addBurner(signer2Address)
            let neededTeleBTC = await calculateNeededTeleBTC(minRequiredNativeTokenLockedAmount, NATIVE_TOKEN_ADDRESS, NATIVE_TOKEN_DECIMAL, 3500000)
            await teleBTCSigner2.approve(lockers.address, neededTeleBTC)
            await lockerSigner2.burn(LOCKER1_PUBKEY__HASH, neededTeleBTC)

            let newHealthFactor = await lockers.getLockerHealthFactor(signer1Address)
            await expect(Number(newHealthFactor)).to.be.equal(0)
            
        });
    });

    describe("#addCollateral", async () => {

        it("can't add collateral for a non locker account", async function () {

            await expect(
                lockers.addCollateral(
                    signer1Address,
                    10000,
                    {value: 10000}
                )
            ).to.be.revertedWith("Lockers: no locker");
        })

        it("adding collateral to the locker", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            let theLockerBefore = await lockers.lockersMapping(signer1Address)

            await expect(
                await lockerSigner1.addCollateral(
                    signer1Address,
                    10000,
                    {value: 10000}
                )
            ).to.emit(lockerSigner1, "CollateralAdded").withArgs(
                signer1Address,
                NATIVE_TOKEN_ADDRESS,
                10000,
                minRequiredNativeTokenLockedAmount.add(10000),
                anyValue
            )
            

            let theLockerAfter = await lockers.lockersMapping(signer1Address)

            expect(
                theLockerAfter[4].sub(theLockerBefore[4])
            ).to.equal(10000)

        })

        it("adding collateral to the locker (exchange token)", async function () {
            let addingCollateral = 10000;
            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount.sub(addingCollateral),
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            let theLockerBefore = await lockers.lockersMapping(signer1Address)

            let oldBalanceToken = await exchangeToken.balanceOf(signer1Address)

            await expect(
                await lockerSigner1.addCollateral(
                    signer1Address,
                    addingCollateral,
                    {value: 0}
                )
            ).to.emit(lockerSigner1, "CollateralAdded").withArgs(
                signer1Address,
                exchangeToken.address,
                addingCollateral,
                minRequiredExchangeTokenLockedAmount,
                anyValue
            )
            

            let theLockerAfter = await lockers.lockersMapping(signer1Address)

            let newBalanceToken = await exchangeToken.balanceOf(signer1Address)

            await expect(
                theLockerAfter[4].sub(theLockerBefore[4])
            ).to.equal(addingCollateral)

            await expect(
                oldBalanceToken - newBalanceToken
            ).to.be.equal(addingCollateral)

        })

        it("revert since has non zero msg value (exchange token)", async function () {

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await expect (
                lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            )).to.be.revertedWith("Lockers: wrong msg value")
        })

    });

    // describe("#priceOfOneUnitOfCollateralInBTC", async () => {
    //     it("return what price oracle returned", async function () {

    //         await mockPriceOracle.mock.equivalentOutputAmount.returns(10000)

    //         let lockerSigner1 = await lockers.connect(signer1)

    //         expect(
    //             await lockerSigner1.priceOfOneUnitOfCollateralInBTC(NATIVE_TOKEN_ADDRESS)
    //         ).to.equal(10000)
    //     })
    // })

    describe("#mint", async () => {

        it("only owner can call renounceOwnership", async function () {
            await expect(
                lockers.connect(signer1).renounceOwnership()
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await lockers.renounceOwnership()
        })


        it("can't mint because receipt is zero address", async function () {

            await lockers.setBurnRouter(mockBurnRouter.address);
            await mockBurnRouter.mock.unwrap.returns(8000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(50000000);

            await expect (
                lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ZERO_ADDRESS, 25000000)
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")
        })

        it("can't mint since locker is inactive", async function () {

            await lockers.setBurnRouter(mockBurnRouter.address);
            await mockBurnRouter.mock.unwrap.returns(8000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockerSigner1.requestInactivation();

            expect(
                await lockers.isLockerActive(signer1Address)
            ).to.equal(true)

            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY + 10);
            

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(50000000);

            await expect (
                lockerSigner2.mint(LOCKER1_PUBKEY__HASH, signer2Address, 25000000)
            ).to.be.revertedWithCustomError(lockers, "LockerNotActive")
        })

        it("can't mint since locker locking script is wrong", async function () {

            await lockers.setBurnRouter(mockBurnRouter.address);
            await mockBurnRouter.mock.unwrap.returns(8000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockerSigner1.requestInactivation();

            expect(
                await lockers.isLockerActive(signer1Address)
            ).to.equal(true)

            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY + 10);
            

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            await mockPriceOracle.mock.equivalentOutputAmount.returns(50000000);

            await expect (
                lockerSigner2.mint(LOCKER1_PUBKEY__HASH + "00", signer2Address, 25000000)
            ).to.be.revertedWithCustomError(lockers, "ZeroAddress")
        })
        
    })

    describe("#reliability factor", async () => {
        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("locker capacity changes by changing reliability factor", async function () {

            await lockers.setBurnRouter(mockBurnRouter.address);
            await mockBurnRouter.mock.unwrap.returns(8000);

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, 10000);

            let oldCapacity = await lockers.getLockerCapacity(signer1Address)

            await lockers.setLockerReliabilityFactor(signer1Address, 5000)

            let newCapicity = await lockers.getLockerCapacity(signer1Address)

            await expect(
                oldCapacity
            ).to.be.equal(newCapicity.div(2))

        })

        it("can't mint usual amount when reliability > one hundred", async function () {
            
            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000);

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            await lockers.addMinter(signer2Address);

            let lockerSigner2 = lockers.connect(signer2)

            let amount = (await lockers.getLockerCapacity(signer1Address));

            await lockers.setLockerReliabilityFactor(signer1Address, 20000)

            await expect (
                lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, amount)
            ).to.be.revertedWith("Lockers: insufficient capacity")

            lockerSigner2.mint(LOCKER1_PUBKEY__HASH, ONE_ADDRESS, amount.div(2))
        })
        
    })

    describe("#removeCollateral", async () => {

        it("can't remove collateral for a non locker account", async function () {

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000)

            let lockerSigner1 = await lockers.connect(signer1)

            await expect(
                lockerSigner1.removeCollateral(
                    1000
                )
            ).to.be.revertedWith("Lockers: no locker")
        })

        it("reverts because it's more than capacity", async function () {

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000)

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            // Forwards block.timestamp to inactivate locker
            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY);

            await expect(
                lockerSigner1.removeCollateral(
                    (minRequiredNativeTokenLockedAmount.div(2)).add(1)
                )
            ).to.be.revertedWith("Lockers: more than max removable collateral")

            await expect(
                lockerSigner1.removeCollateral(
                    (minRequiredNativeTokenLockedAmount.div(2))
                )
            ).to.be.revertedWithCustomError(lockerSigner1, "LockerActive")

        })


        it("reverts because it's more than capacity", async function () {

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000)

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            // inactivate the locker
            await lockerSigner1.requestInactivation();

            // Forwards block.timestamp to inactivate locker
            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY);

            await expect(
                lockerSigner1.removeCollateral(
                    (minRequiredNativeTokenLockedAmount.div(2)).add(1)
                )
            ).to.be.revertedWith("Lockers: more than max removable collateral")

        })

        it("remove collateral successfully", async function () {

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000)

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                NATIVE_TOKEN_ADDRESS,
                minRequiredTSTLockedAmount,
                minRequiredNativeTokenLockedAmount.mul(2),
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: minRequiredNativeTokenLockedAmount.mul(2)}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            let theLockerBalanceBefore = await teleBTC.provider.getBalance(signer1Address);

            // inactivate the locker
            await lockerSigner1.requestInactivation();
            
            // Forwards block.timestamp to inactivate locker
            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY);

            await expect(
                await lockerSigner1.removeCollateral(
                    minRequiredNativeTokenLockedAmount.div(4)
                )
            ).to.emit(lockerSigner1, "CollateralRemoved").withArgs(
                signer1Address,
                NATIVE_TOKEN_ADDRESS,
                minRequiredNativeTokenLockedAmount.div(4),
                minRequiredNativeTokenLockedAmount.div(4).mul(7),
                anyValue
            )

            
            let theLockerBalanceAfter = await teleBTC.provider.getBalance(signer1Address)

            expect(
                theLockerBalanceAfter.sub(theLockerBalanceBefore)
            ).to.be.closeTo(minRequiredNativeTokenLockedAmount.div(4), BigNumber.from(10).pow(15).mul(1))

        })

        it("remove collateral successfully (exchange token)", async function () {

            await mockPriceOracle.mock.equivalentOutputAmount.returns(10000)

            await teleportSystemToken.transfer(signer1Address, minRequiredTSTLockedAmount)

            let teleportSystemTokenSigner1 = teleportSystemToken.connect(signer1)

            await teleportSystemTokenSigner1.approve(lockers.address, minRequiredTSTLockedAmount)
            await exchangeToken.connect(signer1).approve(lockers.address, minRequiredExchangeTokenLockedAmount)

            let lockerSigner1 = lockers.connect(signer1)

            await lockerSigner1.requestToBecomeLocker(
                // LOCKER1,
                LOCKER1_PUBKEY__HASH,
                exchangeToken.address,
                minRequiredTSTLockedAmount,
                minRequiredExchangeTokenLockedAmount,
                LOCKER_RESCUE_SCRIPT_P2PKH_TYPE,
                LOCKER_RESCUE_SCRIPT_P2PKH,
                {value: 0}
            );

            await lockers.addLocker(signer1Address, ONE_HOUNDRED_PERCENT);

            let theLockerBalanceBefore = await exchangeToken.balanceOf(signer1Address)

            // inactivate the locker
            await lockerSigner1.requestInactivation();
            
            // Forwards block.timestamp to inactivate locker
            let lastBlockTimestamp = await getTimestamp();
            await advanceBlockWithTime(deployer.provider, lastBlockTimestamp + INACTIVATION_DELAY);

            await expect(
                await lockerSigner1.removeCollateral(
                    minRequiredExchangeTokenLockedAmount.div(4)
                )
            ).to.emit(lockerSigner1, "CollateralRemoved").withArgs(
                signer1Address,
                exchangeToken.address,
                minRequiredExchangeTokenLockedAmount.div(4),
                minRequiredExchangeTokenLockedAmount.mul(3).div(4),
                anyValue
            )

            
            let theLockerBalanceAfter = await exchangeToken.balanceOf(signer1Address)

            await expect(
                theLockerBalanceAfter.sub(theLockerBalanceBefore)
            ).to.be.equal(minRequiredExchangeTokenLockedAmount.div(4))

        })

    });
})
