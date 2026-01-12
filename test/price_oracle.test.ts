import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { BigNumber, Signer} from "ethers";
import { deployMockContract, MockContract } from "@ethereum-waffle/mock-contract";

import { PriceOracle } from "../src/types/PriceOracle";
import { PriceOracle__factory } from "../src/types/factories/PriceOracle__factory";
import { ERC20 } from "../src/types/ERC20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";

import { takeSnapshot, revertProvider } from "./block_utils";


describe("PriceOracle", async () => {

    // Constants
    let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    let ONE_ADDRESS = "0x0000000000000000000000000000000000000001";
    let TWO_ADDRESS = "0x0000000000000000000000000000000000000001";

    // Accounts
    let deployer: Signer;
    let signer1: Signer;
    let deployerAddress: string;
    let signer1Address: string;

    // Contracts
    let priceOracle: PriceOracle;
    let erc20: ERC20;
    let _erc20: ERC20;

    // Mock contracts
    let mockPriceProxy: MockContract;
    let _mockPriceProxy: MockContract;
    let mockExchangeConnector: MockContract;

    // Values
    let acceptableDelay: number;

    let snapshotId: any;

    before(async () => {
        // Sets accounts
        [deployer, signer1] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();
        signer1Address = await signer1.getAddress();

        // Deploys erc20 contracts
        const erc20Factory = new Erc20__factory(deployer);
        erc20 = await erc20Factory.deploy(
            "TestToken",
            "TT",
            1000
        );
        _erc20 = await erc20Factory.deploy(
            "AnotherTestToken",
            "ATT",
            1000
        );
        
        // Deploys collateralPool contract
        acceptableDelay = 120; // seconds
        const priceOracleFactory = new PriceOracle__factory(deployer);
        priceOracle = await priceOracleFactory.deploy(acceptableDelay, TWO_ADDRESS);

        // Mocks price proxy contract
        const AggregatorV3InterfaceContract = await deployments.getArtifact(
            "AggregatorV3Interface"
        );
        mockPriceProxy = await deployMockContract(
            deployer,
            AggregatorV3InterfaceContract.abi
        );
        _mockPriceProxy = await deployMockContract(
            deployer,
            AggregatorV3InterfaceContract.abi
        );

        // Mocks exchange connector contract
        const ExchangeConnectorContract = await deployments.getArtifact(
            "IExchangeConnector"
        );
        mockExchangeConnector = await deployMockContract(
            deployer,
            ExchangeConnectorContract.abi
        );

    });

    async function mockFunctionsPriceProxy(        
        roundID: number,
        price: number,
        startedAt: number,
        timeStamp: number,
        answeredInRound: number,
        decimals: number
    ): Promise<void> {
        await mockPriceProxy.mock.latestRoundData.returns(
            roundID,
            price,
            startedAt,
            timeStamp,
            answeredInRound
        );
        await mockPriceProxy.mock.decimals.returns(decimals);
    }

    async function _mockFunctionsPriceProxy(        
        roundID: number,
        price: number,
        startedAt: number,
        timeStamp: number,
        answeredInRound: number,
        decimals: number
    ): Promise<void> {
        await _mockPriceProxy.mock.latestRoundData.returns(
            roundID,
            price,
            startedAt,
            timeStamp,
            answeredInRound
        );
        await _mockPriceProxy.mock.decimals.returns(decimals);
    }

    async function setNextBlockTimestamp(        
        addedTimestamp: number,
    ): Promise<void> {
        let lastBlockNumber = await ethers.provider.getBlockNumber();
        let lastBlock = await ethers.provider.getBlock(lastBlockNumber);
        let lastBlockTimestamp = lastBlock.timestamp;
        await ethers.provider.send("evm_setNextBlockTimestamp", [lastBlockTimestamp + addedTimestamp])
        await ethers.provider.send("evm_mine", []);
    }

    async function getLastBlockTimestamp(): Promise<number> {
        let lastBlockNumber = await ethers.provider.getBlockNumber();
        let lastBlock = await ethers.provider.getBlock(lastBlockNumber);
        return lastBlock.timestamp;
    }

    async function mockFunctionsExchangeConnector(        
        result: boolean,
        outputAmount: number,
    ): Promise<void> {
        await mockExchangeConnector.mock.getOutputAmount.returns(
            result,
            outputAmount
        );

        await mockExchangeConnector.mock.wrappedNativeToken.returns(
            ONE_ADDRESS
        );
    }

    describe("#addExchangeConnector", async () => {

        beforeEach(async() => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async() => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Adds an exchange router", async function () {
            await expect(
                await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address)
            ).to.emit(priceOracle, "ExchangeConnectorAdded").withArgs(
                deployerAddress,
                mockExchangeConnector.address
            );

            expect(
                await priceOracle.exchangeRoutersList(0)
            ).to.equal(deployerAddress);

            expect(
                await priceOracle.getExchangeRoutersListLength()
            ).to.equal(1);  
            
            expect(
                await priceOracle.exchangeConnector(deployerAddress)
            ).to.equal(mockExchangeConnector.address);
        })

        it("Reverts since exchange router already exists", async function () {
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);

            expect(
                priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address)
            ).to.revertedWith("PriceOracle: exchange router already exists");
        })

    });

    describe("#removeExchangeConnector", async () => {

        beforeEach(async() => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async() => {
            await revertProvider(signer1.provider, snapshotId);
        });

        //works when run with only
        it("Removes an exchange router", async function () {
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await priceOracle.addExchangeConnector(TWO_ADDRESS, mockExchangeConnector.address);

            expect(
                await priceOracle.removeExchangeConnector(0)
            ).to.emit(priceOracle, "ExchangeConnectorRemoved").withArgs(
                deployerAddress
            );

            expect(
                await priceOracle.getExchangeRoutersListLength()
            ).to.equal(1);  
            
            expect(
                await priceOracle.exchangeConnector(deployerAddress)
            ).to.equal(ZERO_ADDRESS);
        })

        it("Reverts since exchange router doesn't exist", async function () {
            await expect(
                priceOracle.removeExchangeConnector(0)
            ).to.revertedWith("PriceOracle: Index is out of bound");
        })

    });

    describe("#setPriceProxy", async () => {

        beforeEach(async() => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async() => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Sets a price proxy", async function () {
            await expect(
                await priceOracle.setPriceProxy(erc20.address, mockPriceProxy.address)
            ).to.emit(priceOracle, 'SetPriceProxy').withArgs(
                erc20.address,
                mockPriceProxy.address
            );

            expect(
                await priceOracle.ChainlinkPriceProxy(erc20.address)
            ).to.equal(mockPriceProxy.address);
        })

        it("Removes a price proxy", async function () {
            await expect(
                await priceOracle.setPriceProxy(erc20.address, ZERO_ADDRESS)
            ).to.emit(priceOracle, 'SetPriceProxy').withArgs(
                erc20.address,
                ZERO_ADDRESS
            );

            expect(
                await priceOracle.ChainlinkPriceProxy(erc20.address)
            ).to.equal(ZERO_ADDRESS);
        })

        it("Reverts since one of tokens is zero", async function () {
            await expect(
                priceOracle.setPriceProxy(ZERO_ADDRESS, mockPriceProxy.address)
            ).to.revertedWith("PriceOracle: zero address");
        })

    });

    describe("#equivalentOutputAmountFromOracle", async () => {
        let roundID: number;
        let price: number;
        let startedAt: number;
        let timeStamp: number;
        let answeredInRound: number;
        let decimals: number;
        // ERC20 decimals
        let erc20Decimals: number;
        let _erc20Decimals: number;

        beforeEach(async() => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async() => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Gets equal amount of output token when TT/ATT proxy has been set", async function () {
            let amountIn = 1000; // TT token
            roundID = 1;
            let price0 = 24;
            let price1 = 2;
            price = price0/price1;
            startedAt = 1;
            timeStamp = await getLastBlockTimestamp();
            answeredInRound = 1;
            let decimals0 = 1;
            let decimals1 = 2;
            decimals = decimals0 - decimals1;
            erc20Decimals = 8;
            _erc20Decimals = 18;
            await priceOracle.setPriceProxy(erc20.address, mockPriceProxy.address);
            await priceOracle.setPriceProxy(_erc20.address, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            
            expect(
                await priceOracle.equivalentOutputAmountFromOracle(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals, 
                    erc20.address, 
                    _erc20.address
                )
            ).to.equal(Math.floor(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals)));
        })

        it("Gets equal amount of output token when ATT/TT proxy has been set", async function () {
            let amountIn = 1000; // TT token
            roundID = 1;
            let price0 = 12345; // ATT/TT
            let price1 = 1;
            price = price0/price1;
            startedAt = 1;
            timeStamp = await getLastBlockTimestamp();
            answeredInRound = 1;
            let decimals0 = 1;
            let decimals1 = 2;
            decimals = decimals0 - decimals1;
            erc20Decimals = 18;
            _erc20Decimals = 8;
            await priceOracle.setPriceProxy(erc20.address, mockPriceProxy.address);
            await priceOracle.setPriceProxy(_erc20.address, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);

            expect(
                await priceOracle.equivalentOutputAmountFromOracle(
                    amountIn, 
                    erc20Decimals, 
                    _erc20Decimals, 
                    erc20.address, 
                    _erc20.address
                )
            ).to.equal(Math.floor((amountIn*Math.pow(10, _erc20Decimals - erc20Decimals - decimals)/price)))
        })

        it("Gets equal amount of output token when input token is native token", async function () {
            let amountIn = 100; // Native token
            roundID = 1;
            let price0 = 123;
            let price1 = 1;
            price = price0/price1;
            startedAt = 1;
            timeStamp = await getLastBlockTimestamp();
            answeredInRound = 1;
            let decimals0 = 1;
            let decimals1 = 2;
            decimals = decimals0 - decimals1;
            let nativeTokenDecimals = 8;
            _erc20Decimals = 18;
            await priceOracle.setPriceProxy(TWO_ADDRESS, mockPriceProxy.address);
            await priceOracle.setPriceProxy(_erc20.address, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);

            expect(
                await priceOracle.equivalentOutputAmountFromOracle(
                    amountIn,
                    nativeTokenDecimals,
                    _erc20Decimals, 
                    ONE_ADDRESS, // Native token 
                    _erc20.address
                )
            ).to.equal(Math.floor(amountIn*price*Math.pow(10, _erc20Decimals - nativeTokenDecimals - decimals)));
        })

        it("Gets equal amount of output token when output token is native token", async function () {
            let amountIn = 1000; // TT token
            roundID = 1;
            let price0 = 123;
            let price1 = 1;
            price = price0/price1;
            startedAt = 1;
            timeStamp = await getLastBlockTimestamp();
            answeredInRound = 1;
            let decimals0 = 1;
            let decimals1 = 2;
            decimals = decimals0 - decimals1;
            erc20Decimals = 18;
            let nativeTokenDecimals = 8;
            
            await priceOracle.setPriceProxy(erc20.address, mockPriceProxy.address);
            await priceOracle.setPriceProxy(TWO_ADDRESS, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);

            expect(
                await priceOracle.equivalentOutputAmountFromOracle(
                    amountIn,
                    erc20Decimals, 
                    nativeTokenDecimals,
                    erc20.address,
                    ONE_ADDRESS // Native token 
                )
            ).to.equal(Math.floor(amountIn*price*Math.pow(10, nativeTokenDecimals - erc20Decimals - decimals)));
        })

        it("Gets equal amount of output token when price decimal is zero", async function () {
            let amountIn = 1000;
            roundID = 1;
            let price0 = 1234;
            let price1 = 2;
            startedAt = 1;
            timeStamp = await getLastBlockTimestamp();
            answeredInRound = 1;
            decimals = 0;
            erc20Decimals = 18;
            _erc20Decimals = 8;
            await priceOracle.setPriceProxy(erc20.address, mockPriceProxy.address);
            await priceOracle.setPriceProxy(_erc20.address, _mockPriceProxy.address);

            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals);

            expect(
                await priceOracle.equivalentOutputAmountFromOracle(
                    amountIn, 
                    erc20Decimals, 
                    _erc20Decimals, 
                    erc20.address, 
                    _erc20.address
                )
            ).to.equal(Math.floor(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals)));
        })

        it("Gets equal amount of output token when all decimals are zero", async function () {
            let amountIn = 1000;
            roundID = 1;
            let price0 = 123;
            let price1 = 1;
            price = price0/price1;
            startedAt = 1;
            timeStamp = await getLastBlockTimestamp();
            answeredInRound = 1;
            decimals = 0;
            erc20Decimals = 0;
            _erc20Decimals = 0;
            await priceOracle.setPriceProxy(erc20.address, mockPriceProxy.address);
            await priceOracle.setPriceProxy(_erc20.address, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals);
            expect(
                await priceOracle.equivalentOutputAmountFromOracle(
                    amountIn, 
                    erc20Decimals, 
                    _erc20Decimals, 
                    erc20.address, 
                    _erc20.address
                )
            ).to.equal(Math.floor(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals)));
        })

        it("Reverts since one of the tokens is zero", async function () {
            let amountIn = 1000;
            await expect(
                priceOracle.equivalentOutputAmountFromOracle(
                    amountIn, 
                    18, 
                    18, 
                    ZERO_ADDRESS, 
                    erc20.address
                )
            ).to.revertedWith("PriceOracle: zero address");

            await expect(
                priceOracle.equivalentOutputAmountFromOracle(
                    amountIn, 
                    18, 
                    18, 
                    erc20.address, 
                    ZERO_ADDRESS
                )
            ).to.revertedWith("PriceOracle: zero address");
        })

        it("Reverts since returned price is zero", async function () {
            let amountIn = 1000; // TT token
            roundID = 1;
            let price0 = 123;
            let price1 = 1;
            price = price0/price1;
            startedAt = 1;
            timeStamp = await getLastBlockTimestamp();
            answeredInRound = 1;
            let decimals0 = 1;
            let decimals1 = 2;
            decimals = decimals0 - decimals1;
            erc20Decimals = 18;
            _erc20Decimals = 8;

            await priceOracle.setPriceProxy(erc20.address, mockPriceProxy.address);
            await priceOracle.setPriceProxy(_erc20.address, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, 0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);

            await expect(
                priceOracle.equivalentOutputAmountFromOracle(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals, 
                    erc20.address, 
                    _erc20.address
                )
            ).to.revertedWith("PriceOracle: zero price for input token");

            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, 0, startedAt, timeStamp, answeredInRound, decimals1);

            await expect(
                priceOracle.equivalentOutputAmountFromOracle(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals, 
                    erc20.address, 
                    _erc20.address
                )
            ).to.revertedWith("PriceOracle: zero price for output token");

            await priceOracle.setPriceProxy(erc20.address, ZERO_ADDRESS);
            await priceOracle.setPriceProxy(_erc20.address, mockPriceProxy.address);

            await expect(
                priceOracle.equivalentOutputAmountFromOracle(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals, 
                    erc20.address, 
                    _erc20.address
                )
            ).to.be.revertedWith("PriceOracle: oracle not exist or up to date");

        })

        it("Reverts since one of the tokens doesn't exist", async function () {
            let amountIn = 1000;
            await expect(
                priceOracle.equivalentOutputAmountFromOracle(
                    amountIn, 
                    18, 
                    18, 
                    erc20.address, 
                    deployerAddress
                )
            ).to.revertedWith("PriceOracle: oracle not exist or up to date");
        })

    });

    describe("#equivalentOutputAmountFromExchange", async () => {

        beforeEach(async() => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async() => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Gets equal amount of output token", async function () {
            let inputAmount = 1000;
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            expect(
                await priceOracle.equivalentOutputAmountFromExchange(
                    deployerAddress,
                    inputAmount,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(100);
        })

        it("Gets equal amount of output token when input token is native token", async function () {
            let inputAmount = 1000;
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            expect(
                await priceOracle.equivalentOutputAmountFromExchange(
                    deployerAddress,
                    inputAmount,
                    ONE_ADDRESS,
                    _erc20.address
                )
            ).to.equal(100);
        })

        it("Gets equal amount of output token when output token is native token", async function () {
            let inputAmount = 1000;
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            expect(
                await priceOracle.equivalentOutputAmountFromExchange(
                    deployerAddress,
                    inputAmount,
                    erc20.address,
                    ONE_ADDRESS
                )
            ).to.equal(100);
        })

        it("Reverts since one of the tokens is zero", async function () {
            let inputAmount = 1000;
            await expect(
                priceOracle.equivalentOutputAmountFromExchange(
                    deployerAddress,
                    inputAmount,
                    ZERO_ADDRESS,
                    _erc20.address
                )
            ).to.revertedWith("PriceOracle: zero address");

            await expect(
                priceOracle.equivalentOutputAmountFromExchange(
                    deployerAddress,
                    inputAmount,
                    erc20.address,
                    ZERO_ADDRESS
                )
            ).to.revertedWith("PriceOracle: zero address");
        })

        it("Reverts since pair does not exist in exchange", async function () {
            let inputAmount = 1000;
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(false, 0);
            expect(
                priceOracle.equivalentOutputAmountFromExchange(
                    deployerAddress,
                    inputAmount,
                    deployerAddress,
                    _erc20.address
                )
            ).to.revertedWith("PriceOracle: Pair does not exist on exchange");
        })

    });

    describe("#equivalentOutputAmount", async () => {
        let roundID: number;
        let price: number;
        let startedAt: number;
        let timeStamp: number;
        let answeredInRound: number;
        let decimals: number;
        // ERC20 decimals
        let erc20Decimals: number;
        let _erc20Decimals: number;

        // Sets inputs values
        let amountIn = 1000; // TT token
        roundID = 1;
        let price0 = 123;
        let price1 = 2;
        price = price0/price1;
        startedAt = 1;
        answeredInRound = 1;
        let decimals0 = 1;
        let decimals1 = 2;
        decimals = decimals0 - decimals1;
        erc20Decimals = 8;
        _erc20Decimals = 18;
        
        beforeEach(async() => {
            snapshotId = await takeSnapshot(signer1.provider);
            await priceOracle.setPriceProxy(erc20.address, mockPriceProxy.address);
            await priceOracle.setPriceProxy(_erc20.address, _mockPriceProxy.address);
        });

        afterEach(async() => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Gets equal amount of output token when delay is not acceptable, but no other exchange exists (only oracle)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            await setNextBlockTimestamp(240);
            await expect(
                priceOracle.equivalentOutputAmount(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.be.revertedWith("PriceOracle: oracle not exist or up to date");
            // hardhat doesn't work properly but it works on testnet
            // https://mumbai.polygonscan.com/address/0x4b50faE17C1541D8299238300Ba760f7De27e9cc
        })

        it("Gets equal amount of output token when delay is not acceptable, but exchange does not have the pair (only oracle)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(false, 0);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            await setNextBlockTimestamp(240);
            await expect(
                priceOracle.equivalentOutputAmount(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.be.revertedWith("PriceOracle: oracle not exist or up to date");
            // hardhat doesn't work properly but it works on testnet
            // https://mumbai.polygonscan.com/address/0x4b50faE17C1541D8299238300Ba760f7De27e9cc
        })

        it("Gets equal amount of output token when delay is acceptable (only oracle)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            await setNextBlockTimestamp(1);
            expect(
                await priceOracle.equivalentOutputAmount(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals));
        })

        it("Gets equal amount of output token when delay is acceptable (oracle and router)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
        expect(
            await priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(Math.floor(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals)));
        })

        it("Gets equal amount of output token when delay is not acceptable (oracle and router)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            await setNextBlockTimestamp(240);
        expect(
            await priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(Math.floor(100));
        })

        it("Gets equal amount of output token when delay is not acceptable and input token is native token (oracle and router)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await priceOracle.setPriceProxy(ONE_ADDRESS, mockPriceProxy.address);
            await mockFunctionsExchangeConnector(true, 100);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            await setNextBlockTimestamp(240);
            
        expect(
            await priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals, // Native token decimal
                    _erc20Decimals,
                    ONE_ADDRESS,
                    _erc20.address
                )
            ).to.equal(Math.floor(100));
        })

        it("Gets equal amount of output token when delay is acceptable and input token is native token (oracle and router)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await priceOracle.setPriceProxy(ONE_ADDRESS, mockPriceProxy.address);
            await mockFunctionsExchangeConnector(true, 100);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            
        expect(
            await priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals, // Native token decimal
                    _erc20Decimals,
                    ONE_ADDRESS,
                    _erc20.address
                )
            ).to.equal(Math.floor(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals)));
        })

        it("Gets equal amount of output token when delay is not acceptable and output token is native token (oracle and router)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            await priceOracle.setPriceProxy(ONE_ADDRESS, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            await setNextBlockTimestamp(240);
        expect(
            await priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals, // Native token decimal
                    erc20.address,
                    ONE_ADDRESS
                )
            ).to.equal(Math.floor(100));
        })

        it("Gets equal amount of output token when delay is acceptable and output token is native token (oracle and router)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            await priceOracle.setPriceProxy(ONE_ADDRESS, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
        expect(
            await priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals, // Native token decimal
                    erc20.address,
                    ONE_ADDRESS
                )
            ).to.equal(Math.floor(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals)));
        })

        it("Gets equal amount of output token when delay is not acceptable and output token is native token (oracle and router)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            await priceOracle.setPriceProxy(ONE_ADDRESS, _mockPriceProxy.address);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, (timeStamp + 10000), answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, (timeStamp + 10000), answeredInRound, decimals1);
        expect(
            await priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals, // Native token decimal
                    erc20.address,
                    ONE_ADDRESS
                )
            ).to.equal(Math.floor(100));
        })

        it("Gets equal amount of output token when price proxy doesn't exist (only router)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(true, 100);
            await priceOracle.setPriceProxy(erc20.address, ZERO_ADDRESS);
            await setNextBlockTimestamp(240);
            expect(
                await priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(Math.floor(100));
        })

        it("Gets equal amount of output token when delay is acceptable, but no other exchange exists (only oracle)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            expect(
                await priceOracle.equivalentOutputAmount(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals));
        })

        it("Gets equal amount of output token when delay is acceptable, but no other exchange exists (only oracle)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            expect(
                await priceOracle.equivalentOutputAmount(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals));
        })

        it("Gets equal amount of output token when delay is acceptable, but exchange does not have the pair (only oracle)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(false, 0);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            expect(
                await priceOracle.equivalentOutputAmount(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals));
        })

        it("Gets equal amount of output token when delay is acceptable, but exchange does not have the pair (only oracle)", async function () {
            timeStamp = await getLastBlockTimestamp();
            await priceOracle.addExchangeConnector(deployerAddress, mockExchangeConnector.address);
            await mockFunctionsExchangeConnector(false, 0);
            await mockFunctionsPriceProxy(roundID, price0, startedAt, timeStamp, answeredInRound, decimals0);
            await _mockFunctionsPriceProxy(roundID, price1, startedAt, timeStamp, answeredInRound, decimals1);
            expect(
                await priceOracle.equivalentOutputAmount(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.equal(amountIn*price*Math.pow(10, _erc20Decimals - erc20Decimals - decimals));
        })

        it("Reverts since no price feed was found (no oracle no router)", async function () {
            timeStamp = await getLastBlockTimestamp();;
            await mockFunctionsExchangeConnector(false, 0);
            await priceOracle.setPriceProxy(erc20.address, ZERO_ADDRESS);
            await setNextBlockTimestamp(240);
            await expect(
                priceOracle.equivalentOutputAmountByAverage(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.revertedWith("PriceOracle: no price feed is available");
        })

        it("Reverts since no price feed was found (no oracle)", async function () {
            timeStamp = await getLastBlockTimestamp();;
            await mockFunctionsExchangeConnector(false, 0);
            await priceOracle.setPriceProxy(erc20.address, ZERO_ADDRESS);
            await setNextBlockTimestamp(240);

            await expect(
                priceOracle.equivalentOutputAmount(
                    amountIn,
                    erc20Decimals,
                    _erc20Decimals,
                    erc20.address,
                    _erc20.address
                )
            ).to.revertedWith("PriceOracle: oracle not exist or up to date");
        })

        

    });

    describe("#setters", async () => {

        beforeEach(async() => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async() => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Sets acceptable delay", async function () {
            await expect(
                priceOracle.setAcceptableDelay(100)
            ).to.emit(
                priceOracle, "NewAcceptableDelay"
            ).withArgs(acceptableDelay, 100);

            expect(
                await priceOracle.acceptableDelay()
            ).to.equal(100);

            await expect(
                priceOracle.connect(signer1).setAcceptableDelay(100)
            ).to.be.revertedWith("Ownable: caller is not the owner");

        })

        it("Sets oracle native token", async function () {
            await expect(
                priceOracle.setOracleNativeToken(ONE_ADDRESS)
            ).to.emit(
                priceOracle, "NewOracleNativeToken"
            ).withArgs(TWO_ADDRESS, ONE_ADDRESS);

            expect(
                await priceOracle.oracleNativeToken()
            ).to.equal(ONE_ADDRESS);

            await expect(
                priceOracle.connect(signer1).setOracleNativeToken(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

        })

        it("Reverts since given address is zero", async function () {
            expect(
                priceOracle.setOracleNativeToken(ZERO_ADDRESS)
            ).to.revertedWith("PriceOracle: zero address");
        })

        it("renounceOwnership", async function () {
            await expect(
                priceOracle.connect(signer1).renounceOwnership()
            ).to.revertedWith("Ownable: caller is not the owner");
                
            await priceOracle.renounceOwnership()
        })

    });

});
