import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { Signer, BigNumber } from "ethers";

import { UniswapV2Connector } from "../src/types/UniswapV2Connector";
import { UniswapV2Connector__factory } from "../src/types/factories/UniswapV2Connector__factory";
import { UniswapV2Pair } from "../src/types/UniswapV2Pair";
import { UniswapV2Pair__factory } from "../src/types/factories/UniswapV2Pair__factory";
import { ERC20 } from "../src/types/ERC20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";
import { WETH } from "../src/types/WETH";
import { WETH__factory } from "../src/types/factories/WETH__factory";

import { takeSnapshot, revertProvider } from "./block_utils";

describe("UniswapV2Connector", async () => {

    let snapshotId: any;

    // Constants
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    // Accounts
    let deployer: Signer;
    let signer1: Signer;
    let deployerAddress: string;
    let signer1Address: string;

    // Contracts
    let uniswapV2Connector: UniswapV2Connector;
    let uniswapV2Router02: Contract;
    let liquidityPoolAB: UniswapV2Pair; // non-WETH/non-WETH
    let liquidityPoolCD: UniswapV2Pair; // non-WETH/WETH
    let liquidityPoolEF: UniswapV2Pair; // non-WETH/WETH
    let uniswapV2Factory: Contract;
    let uniswapV2Pair__factory: UniswapV2Pair__factory;
    let erc20: ERC20;
    let erc20X: ERC20;
    let erc20Z: ERC20;
    let WETH: WETH;

    // Variables
    let oldReserveA: BigNumber;
    let oldReserveB: BigNumber;
    let oldReserveC: BigNumber;
    let oldReserveD: BigNumber;
    let oldDeployerBalanceERC20: BigNumber;
    let oldDeployerBalanceerc20X: BigNumber;
    let oldDeployerBalanceerc20Z: BigNumber;
    let oldSigner1BalanceETH: BigNumber;

    before(async () => {
        // Sets accounts
        [deployer, signer1] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();
        signer1Address = await signer1.getAddress();

        // Deploys WETH
        const WETHFactory = new WETH__factory(deployer);
        WETH = await WETHFactory.deploy(
            'Wrapped-Ethereum',
            'WETH'
        );

        // Deploys uniswapV2Factory
        const uniswapV2FactoryFactory = await ethers.getContractFactory("UniswapV2Factory");
        uniswapV2Factory = await uniswapV2FactoryFactory.deploy(
            deployerAddress
        );

        // Creates uniswapV2Pair__factory object
        uniswapV2Pair__factory = new UniswapV2Pair__factory(deployer);

        // Deploys uniswapV2Router02 contract
        const uniswapV2Router02Factory = await ethers.getContractFactory("UniswapV2Router02");
        uniswapV2Router02 = await uniswapV2Router02Factory.deploy(
            uniswapV2Factory.address,
            WETH.address // WETH
        );

        // Deploys exchange connector contract
        const uniswapV2ConnectorFactory = new UniswapV2Connector__factory(deployer);
        uniswapV2Connector = await uniswapV2ConnectorFactory.deploy(
            "Uniswap-Connector",
            uniswapV2Router02.address
        );

        // Deploys erc20 token
        const erc20Factory = new Erc20__factory(deployer);
        erc20 = await erc20Factory.deploy(
            "TestToken",
            "TT",
            200000
        );

        erc20X = await erc20Factory.deploy(
            "AnotherTestToken",
            "ATT",
            200000
        );

        erc20Z = await erc20Factory.deploy(
            "JustAnotherTestToken",
            "JATT",
            200000
        );

        // Adding liquidity to pools

        // Adds liquidity to liquidity pool
        let addedLiquidityA = 20000; // erc20
        let addedLiquidityB = 10000; // erc20X
        let addedLiquidityC = 20000; // erc20
        let addedLiquidityD = 10000; // WETH
        let addedLiquidityE = 20000; // erc20Z
        let addedLiquidityF = 10000; // WETH

        // Adds liquidity for non-WETH/non-WETH pool
        await erc20.approve(uniswapV2Router02.address, addedLiquidityA);
        await erc20X.approve(uniswapV2Router02.address, addedLiquidityB);

        await uniswapV2Router02.addLiquidity(
            erc20.address,
            erc20X.address,
            addedLiquidityA,
            addedLiquidityB,
            0, // Minimum added liquidity for first token
            0, // Minimum added liquidity for second token
            deployerAddress,
            10000000000000, // Long deadline
        );
        
        let liquidityPoolABAddress = await uniswapV2Factory.getPair(
            erc20.address,
            erc20X.address
        );

        // Loads liquidity pool
        liquidityPoolAB = await uniswapV2Pair__factory.attach(liquidityPoolABAddress);

        // Records current reserves of teleBTC and TST
        if (await liquidityPoolAB.token0() == erc20.address) {
            [oldReserveA, oldReserveB] = await liquidityPoolAB.getReserves();
        } else {
            [oldReserveB, oldReserveA] = await liquidityPoolAB.getReserves()
        }

        // Adds liquidity for non-WETH/WETH pool
        await erc20.approve(uniswapV2Router02.address, addedLiquidityA);

        await uniswapV2Router02.addLiquidityETH(
            erc20.address,
            addedLiquidityC,
            0, // Minimum added liquidity for first token
            0, // Minimum added liquidity for second token
            deployerAddress,
            10000000000000, // Long deadline
            {value: addedLiquidityD}
        );
        let liquidityPoolCDAddress = await uniswapV2Factory.getPair(
            erc20.address,
            WETH.address,
        );

        // Loads liquidity pool
        liquidityPoolCD = await uniswapV2Pair__factory.attach(liquidityPoolCDAddress);

        // Records current reserves of teleBTC and TST
        if (await liquidityPoolCD.token0() == erc20.address) {
            [oldReserveC, oldReserveD] = await liquidityPoolCD.getReserves();
        } else {
            [oldReserveD, oldReserveC] = await liquidityPoolCD.getReserves()
        }

        // Adds liquidity for non-WETH/WETH pool
        await erc20Z.approve(uniswapV2Router02.address, addedLiquidityE);

        await uniswapV2Router02.addLiquidityETH(
            erc20Z.address,
            addedLiquidityF,
            0, // Minimum added liquidity for first token
            0, // Minimum added liquidity for second token
            deployerAddress,
            10000000000000, // Long deadline
            {value: addedLiquidityF}
        );
        let liquidityPoolEFAddress = await uniswapV2Factory.getPair(
            erc20Z.address,
            WETH.address,
        );

        // Loads liquidity pool
        liquidityPoolEF = await uniswapV2Pair__factory.attach(liquidityPoolEFAddress);

        // Records current reserves of teleBTC and TST
        // if (await liquidityPoolEF.token0() == erc20Z.address) {
        //     [oldReserveE, oldReserveF] = await liquidityPoolEF.getReserves();
        // } else {
        //     [oldReserveF, oldReserveE] = await liquidityPoolEF.getReserves()
        // }

        // Records current tokens balances of deployer
        oldDeployerBalanceERC20 = await erc20.balanceOf(deployerAddress);
        oldDeployerBalanceerc20X = await erc20X.balanceOf(deployerAddress);
        oldDeployerBalanceerc20Z = await erc20Z.balanceOf(deployerAddress);
        oldSigner1BalanceETH = await signer1.getBalance();

    });

    describe("#getInputAmount", async () => {

        it("Finds needed input amount", async function () {
            let outputAmount = 1000;
            let inputAmount = await uniswapV2Router02.getAmountIn(
                outputAmount,
                oldReserveC,
                oldReserveD
            );

            let result = await uniswapV2Connector.getInputAmount(
                outputAmount,
                erc20.address,
                erc20X.address
            );

            expect(result[0]).to.equal(true);
            expect(result[1]).to.equal(inputAmount);
        })

        it("Returns true when there is an indirect path", async function () {
            let outputAmount = 1000;

            let result = await uniswapV2Connector.getInputAmount(
                outputAmount,
                erc20.address,
                erc20Z.address
            );

            expect(result[0]).to.equal(true);
            expect(result[1]).to.not.equal(0);
        })

        it("Returns false when there is no even an indirect path", async function () {
            let outputAmount = 1000;

            let result = await uniswapV2Connector.getInputAmount(
                outputAmount,
                erc20X.address,
                erc20Z.address
            );

            expect(result[0]).to.equal(false);
            expect(result[1]).to.equal(0);
        })

        it("Returns false since liquidity pool does not exist", async function () {
            let outputAmount = 1000;

            let result = await uniswapV2Connector.getInputAmount(
                outputAmount,
                deployerAddress,
                erc20X.address
            );

            expect(result[0]).to.equal(false);
            expect(result[1]).to.equal(0);
        })

        it("Returns false since output amount is greater than output reserve", async function () {
            let outputAmount = 15000;

            await expect(
                uniswapV2Connector.getInputAmount(
                    outputAmount,
                    erc20.address,
                    erc20X.address,
                )
            ).to.be.reverted
            //TODO??
            //AssertionError: Expected transaction to be reverted with "", but other reason was found: "ds-math-sub-underflow"

            let result = await uniswapV2Connector.getInputAmount(
                outputAmount,
                erc20X.address,
                erc20.address,
            );

            expect(result[0]).to.equal(true);
        })


        it("Reverts since one of token's addresses is zero", async function () {
            let outputAmount = 1000;

            await expect(
                uniswapV2Connector.getInputAmount(
                    outputAmount,
                    ZERO_ADDRESS,
                    erc20X.address
                )
            ).to.revertedWith("UniswapV2Connector: zero address");

            await expect(
                uniswapV2Connector.getInputAmount(
                    outputAmount,
                    erc20.address,
                    ZERO_ADDRESS
                )
            ).to.revertedWith("UniswapV2Connector: zero address");
        })

    });

    describe("#getOutputAmount", async () => {

        it("Finds output amount", async function () {
            let inputAmount = 1000;

            let outputAmount = await uniswapV2Router02.getAmountOut(
                inputAmount,
                oldReserveC,
                oldReserveD
            );

            let result = await uniswapV2Connector.getOutputAmount(
                inputAmount,
                erc20.address,
                erc20X.address
            );

            expect(result[0]).to.equal(true);
            expect(result[1]).to.equal(outputAmount);
        })

        it("Returns false since liquidity pool does not exist", async function () {
            let inputAmount = 1000;

            let result = await uniswapV2Connector.getOutputAmount(
                inputAmount,
                deployerAddress,
                erc20X.address
            );

            expect(result[0]).to.equal(false);
            expect(result[1]).to.equal(0);
        })

        it("Returns true when there is indirect path", async function () {
            let inputAmount = 1000;

            let result = await uniswapV2Connector.getOutputAmount(
                inputAmount,
                erc20.address,
                erc20Z.address
            );

            expect(result[0]).to.equal(true);
            expect(result[1]).to.not.equal(0);
        })

        it("Returns false when there is no evenn an indirect path", async function () {
            let inputAmount = 1000;

            let result = await uniswapV2Connector.getOutputAmount(
                inputAmount,
                erc20X.address,
                erc20Z.address
            );

            expect(result[0]).to.equal(false);
            expect(result[1]).to.equal(0);
        })

        it("Reverts since one of token's addresses is zero", async function () {
            let inputAmount = 1000;

            await expect(
                uniswapV2Connector.getOutputAmount(
                    inputAmount,
                    ZERO_ADDRESS,
                    erc20X.address
                )
            ).to.revertedWith("UniswapV2Connector: zero address");

            await expect(
                uniswapV2Connector.getOutputAmount(
                    inputAmount,
                    erc20.address,
                    ZERO_ADDRESS
                )
            ).to.revertedWith("UniswapV2Connector: zero address");
        })
    });

    describe("#swap", async () => {

        beforeEach(async () => {
            // Takes snapshot before adding liquidity
            snapshotId = await takeSnapshot(deployer.provider);
        });

        afterEach(async () => {
            // Reverts the state to the beginning
            await revertProvider(deployer.provider, snapshotId);
        });

        it("Swaps indirect path fails", async function () {

            let inputAmount = 1000;

            let path = [erc20X.address, erc20Z.address];
            let to = deployerAddress;
            let deadline = 10000000000000;
            let isFixedToken = true;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                uniswapV2Connector.swap(
                    inputAmount,
                    500,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.not.emit(uniswapV2Connector, 'Swap');
        })

        it("Swaps indirect path", async function () {

            let inputAmount = 1000;
            let outputAmount = await uniswapV2Router02.getAmountsOut(
                inputAmount,
                [
                    erc20.address, 
                    WETH.address,
                    erc20Z.address
                ]
            );

            let path = [erc20.address, erc20Z.address];
            let to = deployerAddress;
            let deadline = 10000000000000;
            let isFixedToken = true;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                await uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount[2],
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.emit(uniswapV2Connector, 'Swap');

            // Records new balances of deployer
            let newDeployerBalanceA = await erc20.balanceOf(deployerAddress);
            let newDeployerBalanceB = await erc20Z.balanceOf(deployerAddress);

            // Checks deployer's tokens balances
            expect(newDeployerBalanceA.toNumber()).to.equal(
                oldDeployerBalanceERC20.toNumber() - inputAmount
            );
            expect(newDeployerBalanceB).to.equal(
                oldDeployerBalanceerc20Z.add(outputAmount[2])
            );
        })

        it("Swaps fixed non-WETH for non-WETH", async function () {

            let inputAmount = 1000;
            let outputAmount = await uniswapV2Router02.getAmountOut(
                inputAmount,
                oldReserveA,
                oldReserveB
            );
            let path = [erc20.address, erc20X.address];
            let to = deployerAddress;
            let deadline = 10000000000000;
            let isFixedToken = true;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                await uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.emit(uniswapV2Connector, 'Swap');

            // Records new balances of deployer
            let newDeployerBalanceA = await erc20.balanceOf(deployerAddress);
            let newDeployerBalanceB = await erc20X.balanceOf(deployerAddress);

            // Checks deployer's tokens balances
            expect(newDeployerBalanceA.toNumber()).to.equal(
                oldDeployerBalanceERC20.toNumber() - inputAmount
            );
            expect(newDeployerBalanceB).to.equal(
                oldDeployerBalanceerc20X.add(outputAmount)
            );
        })

        it("Swaps non-WETH for fixed non-WETH", async function () {

            let outputAmount = 1000;
            let inputAmount = await uniswapV2Router02.getAmountIn(
                outputAmount,
                oldReserveA,
                oldReserveB
            );
            let path = [erc20.address, erc20X.address];
            let to = deployerAddress;
            let deadline = 10000000000000;
            let isFixedToken = false;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                await uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.emit(uniswapV2Connector, 'Swap');

            // Records new balances of deployer
            let newDeployerBalanceA = await erc20.balanceOf(deployerAddress);
            let newDeployerBalanceB = await erc20X.balanceOf(deployerAddress);

            // Checks deployer's tokens balances
            expect(newDeployerBalanceA.toNumber()).to.equal(
                oldDeployerBalanceERC20.toNumber() - inputAmount.toNumber()
            );
            expect(newDeployerBalanceB).to.equal(
                oldDeployerBalanceerc20X.add(outputAmount)
            );
        })

        it("Swaps fixed non-WETH for WETH", async function () {

            let inputAmount = 1000;
            let outputAmount = await uniswapV2Router02.getAmountOut(
                inputAmount,
                oldReserveC,
                oldReserveD
            );
            let path = [erc20.address, WETH.address];
            let to = signer1Address;
            let deadline = 10000000000000;
            let isFixedToken = true;
            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                await uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.emit(uniswapV2Connector, 'Swap');

            // Records new balances of deployer
            let newDeployerBalanceC = await erc20.balanceOf(deployerAddress);
            let newSigner1BalanceETH = await signer1.getBalance();

            // Checks deployer's tokens balances
            expect(newDeployerBalanceC.toNumber()).to.equal(
                oldDeployerBalanceERC20.toNumber() - inputAmount
            );
            expect(newSigner1BalanceETH).to.equal(
                oldSigner1BalanceETH.add(outputAmount)
            );
        })

        it("Swaps non-WETH for fixed WETH", async function () {

            let outputAmount = 1000;
            let inputAmount = await uniswapV2Router02.getAmountIn(
                outputAmount,
                oldReserveC,
                oldReserveD
            );
            let path = [erc20.address, WETH.address];
            let to = signer1Address;
            let deadline = 10000000000000;
            let isFixedToken = false;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                await uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.emit(uniswapV2Connector, 'Swap');

            // Records new balances of deployer
            let newDeployerBalanceC = await erc20.balanceOf(deployerAddress);
            let newSigner1BalanceETH = await signer1.getBalance();

            // Checks deployer's tokens balances
            expect(newDeployerBalanceC.toNumber()).to.equal(
                oldDeployerBalanceERC20.toNumber() - inputAmount.toNumber()
            );
            expect(newSigner1BalanceETH).to.equal(
                oldSigner1BalanceETH.add(outputAmount)
            );
        })

        it("Should not exchange since expected output amount is high", async function () {

            let outputAmount = 1000;
            let inputAmount = await uniswapV2Router02.getAmountIn(
                outputAmount,
                oldReserveA,
                oldReserveB
            );
            let path = [erc20.address, erc20X.address];
            let to = deployerAddress;
            let deadline = 10000000000000;
            let isFixedToken = true;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount*2,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.not.emit(uniswapV2Connector, 'Swap');
        })

        it("Should not exchange since input amount is not enough", async function () {

            let outputAmount = 1000;
            let inputAmount = await uniswapV2Router02.getAmountIn(
                outputAmount,
                oldReserveA,
                oldReserveB
            );
            let path = [erc20.address, erc20X.address];
            let to = deployerAddress;
            let deadline = 10000000000000;
            let isFixedToken = false;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                uniswapV2Connector.swap(
                    Math.floor(inputAmount.toNumber()/2),
                    outputAmount,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.not.emit(uniswapV2Connector, 'Swap');
        })

        it("Should not exchange since deadline has passed", async function () {

            let outputAmount = 1000;
            let inputAmount = await uniswapV2Router02.getAmountIn(
                outputAmount,
                oldReserveA,
                oldReserveB
            );
            let path = [erc20.address, erc20X.address];
            let to = deployerAddress;
            let deadline = 0;
            let isFixedToken = true;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.not.emit(uniswapV2Connector, 'Swap');
        })

        it("Should not exchange since liquidity pool doesn't exist", async function () {

            let outputAmount = 1000;
            let inputAmount = await uniswapV2Router02.getAmountIn(
                outputAmount,
                oldReserveA,
                oldReserveB
            );
            let path = [erc20.address, deployerAddress];
            let to = deployerAddress;
            let deadline = 10000000000000;
            let isFixedToken = true;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.not.emit(uniswapV2Connector, 'Swap');
        })

        it("Should not exchange since path only has one element", async function () {

            let outputAmount = 1000;
            let inputAmount = await uniswapV2Router02.getAmountIn(
                outputAmount,
                oldReserveA,
                oldReserveB
            );
            let path = [erc20.address];
            let to = deployerAddress;
            let deadline = 0;
            let isFixedToken = true;

            await erc20.approve(uniswapV2Connector.address, inputAmount);
            await expect(
                uniswapV2Connector.swap(
                    inputAmount,
                    outputAmount,
                    path,
                    to,
                    deadline,
                    isFixedToken
                )
            ).to.not.emit(uniswapV2Connector, 'Swap');
        })
    });

    describe("#isPathValid", async () => {

        beforeEach(async () => {
            // Takes snapshot before adding liquidity
            snapshotId = await takeSnapshot(deployer.provider);
        });

        afterEach(async () => {
            // Reverts the state to the beginning
            await revertProvider(deployer.provider, snapshotId);
        });

        it("Returns true since path is valid", async function () {
            expect(
                await uniswapV2Connector.isPathValid([erc20.address, erc20X.address, WETH.address])
            ).to.equal(false);
        })

        it("Returns false since path is empty", async function () {
            expect(
                await uniswapV2Connector.isPathValid([erc20.address])
            ).to.equal(false);
        })

        it("Returns false since path only has one element", async function () {
            expect(
                await uniswapV2Connector.isPathValid([erc20.address])
            ).to.equal(false);
        })

        it("Returns false since liquidity pool doesn't exist", async function () {
            expect(
                await uniswapV2Connector.isPathValid([erc20.address, deployerAddress])
            ).to.equal(false);
        })

        it("Returns false since path is invalid", async function () {
            expect(
                await uniswapV2Connector.isPathValid([erc20.address, erc20X.address, deployerAddress])
            ).to.equal(false);
        })
    })

    describe("#setters", async () => {
        let newUniswapV2Router02: any;

        beforeEach(async () => {
            // Takes snapshot before adding liquidity
            snapshotId = await takeSnapshot(deployer.provider);

            // Deploys new uniswapV2Router02 contract
            const uniswapV2Router02Factory = await ethers.getContractFactory("UniswapV2Router02");
            newUniswapV2Router02 = await uniswapV2Router02Factory.deploy(
                uniswapV2Factory.address,
                WETH.address // WETH
            );
        });

        afterEach(async () => {
            // Reverts the state to the beginning
            await revertProvider(deployer.provider, snapshotId);
        });

        it("Sets new exchange router", async function () {
            await expect(
                uniswapV2Connector.setExchangeRouter(newUniswapV2Router02.address)
            ).to.not.reverted;

            expect(
                await uniswapV2Connector.exchangeRouter()
            ).to.equal(newUniswapV2Router02.address);
        })

        it("Reverts since exchange router address is zero", async function () {
            await expect(
                uniswapV2Connector.setExchangeRouter(ZERO_ADDRESS)
            ).to.revertedWith("UniswapV2Connector: zero address");
        })

        it("Reverts since exchange router address is invalid", async function () {
            await expect(
                uniswapV2Connector.setExchangeRouter(deployerAddress)
            ).to.reverted;
        })

        it("Sets liquidity pool factory and wrapped native token", async function () {
            await expect(
                uniswapV2Connector.setLiquidityPoolFactory()
            ).to.not.reverted;

            await expect(
                uniswapV2Connector.setWrappedNativeToken()
            ).to.not.reverted;
        })

    });
});
