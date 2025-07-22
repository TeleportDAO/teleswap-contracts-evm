require('dotenv').config({path:"../../.env"});

import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { deployments, ethers } from "hardhat";
import { Signer, BigNumber, ContractFactory, Contract } from "ethers";
import { takeSnapshot, revertProvider } from "./block_utils";
import { deployMockContract } from "@ethereum-waffle/mock-contract";

// Import our connector
import { UniswapV3Connector } from "../src/types/UniswapV3Connector";
import { UniswapV3Connector__factory } from "../src/types/factories/UniswapV3Connector__factory";

// Import ERC20 for test tokens
import { ERC20 } from "../src/types/ERC20";

describe("UniswapV3Connector - swapAndAddLiquidity", async function() {
    this.bail(true); // Stop on first failure

    let snapshotId: any;

    // Constants
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const FEE_TIER_001 = 100; // 0.01%

    // Accounts
    let deployer: Signer;
    let user: Signer;
    let deployerAddress: string;
    let userAddress: string;

    // Uniswap V3 contracts
    let swapRouter: Contract;
    let quoterV2: Contract;
    let positionManager: Contract;
    let weth9: Contract;
    let uniswapV3Factory: Contract;
    let pool: Contract;

    // Our connector
    let uniswapV3Connector: UniswapV3Connector;

    // Test tokens (8 decimals)
    let tokenA: any;
    let tokenB: any;

    before(async () => {
        // Set up accounts
        [deployer, user] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();
        userAddress = await user.getAddress();

        // Deploy test tokens first
        const TestERC20Factory = await ethers.getContractFactory("erc20");
        
        tokenA = await TestERC20Factory.deploy(
            "TokenA",
            "TKA",
            ethers.utils.parseUnits("1000000", 8) // 1M tokens initial supply
        ) as unknown as ERC20;

        tokenB = await TestERC20Factory.deploy(
            "TokenB", 
            "TKB",
            ethers.utils.parseUnits("1000000", 8) // 1M tokens initial supply
        ) as unknown as ERC20;

        // Mock contract ABIs
        const WETH9_ABI = [
            "function deposit() external payable",
            "function withdraw(uint) external",
            "function balanceOf(address) external view returns (uint)",
            "function transfer(address, uint) external returns (bool)",
            "function approve(address, uint) external returns (bool)"
        ];

        const FACTORY_ABI = [
            "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)",
            "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
        ];

        const ROUTER_ABI = [
            "function factory() external view returns (address)",
            "function WETH9() external view returns (address)",
            "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)",
            "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external returns (uint256 amountOut)"
        ];

        const QUOTER_ABI = [
            "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
            "function quoteExactOutput(bytes path, uint256 amountOut) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
        ];

        const POSITION_MANAGER_ABI = [
            "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
            "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
            "function increaseLiquidity(tuple(uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external returns (uint128 liquidity, uint256 amount0, uint256 amount1)"
        ];

        const POOL_ABI = [
            "function initialize(uint160 sqrtPriceX96) external",
            "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
            "function token0() external view returns (address)",
            "function token1() external view returns (address)"
        ];

        // Deploy mock contracts
        weth9 = await deployMockContract(deployer, WETH9_ABI);
        uniswapV3Factory = await deployMockContract(deployer, FACTORY_ABI);
        swapRouter = await deployMockContract(deployer, ROUTER_ABI);
        quoterV2 = await deployMockContract(deployer, QUOTER_ABI);
        positionManager = await deployMockContract(deployer, POSITION_MANAGER_ABI);
        pool = await deployMockContract(deployer, POOL_ABI);

        // Setup basic mock responses
        await swapRouter.mock.factory.returns(uniswapV3Factory.address);
        await swapRouter.mock.WETH9.returns(weth9.address);
        await uniswapV3Factory.mock.getPool.returns(pool.address);
        await pool.mock.initialize.returns();
        await pool.mock.token0.returns(tokenA.address);
        await pool.mock.token1.returns(tokenB.address);
        await pool.mock.slot0.returns(
            ethers.BigNumber.from("79228162514264337593543950336"), // sqrtPriceX96
            0, // tick
            0, // observationIndex
            0, // observationCardinality
            0, // observationCardinalityNext
            0, // feeProtocol
            true // unlocked
        );

        // Deploy our UniswapV3Connector
        const uniswapV3ConnectorFactory = new UniswapV3Connector__factory(deployer);
        uniswapV3Connector = await uniswapV3ConnectorFactory.deploy();

        // Initialize the connector
        await uniswapV3Connector.initialize(
            "UniswapV3-Connector",
            swapRouter.address,
            quoterV2.address
        );

        // Set position manager
        await uniswapV3Connector.setPositionManager(positionManager.address);

        // Set fee tier for token pair
        await uniswapV3Connector.setFeeTier(tokenA.address, tokenB.address, FEE_TIER_001);

        // Mock quoter responses
        await quoterV2.mock.quoteExactInputSingle.returns(
            ethers.utils.parseUnits("98", 8), // amountOut
            0, // sqrtPriceX96After
            0, // initializedTicksCrossed
            0 // gasEstimate
        );

        // Setup mock responses for swaps and quotes
        await swapRouter.mock.exactInputSingle.returns(ethers.utils.parseUnits("98", 8)); // Default return

        // Mock specific swap scenarios
        await swapRouter.mock.exactInputSingle.withArgs(
            {
                tokenIn: tokenA.address,
                tokenOut: tokenB.address,
                fee: FEE_TIER_001,
                recipient: userAddress,
                deadline: ethers.constants.MaxUint256,
                amountIn: ethers.utils.parseUnits("100", 8),
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            }
        ).returns(ethers.utils.parseUnits("98", 8)); // 98% output matching quoter

        await swapRouter.mock.exactInputSingle.withArgs(
            {
                tokenIn: tokenB.address,
                tokenOut: tokenA.address,
                fee: FEE_TIER_001,
                recipient: userAddress,
                deadline: ethers.constants.MaxUint256,
                amountIn: ethers.utils.parseUnits("100", 8),
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            }
        ).returns(ethers.utils.parseUnits("97", 8)); // 97% output matching quoter

        await swapRouter.mock.exactInputSingle.withArgs(
            {
                tokenIn: tokenA.address,
                tokenOut: tokenB.address,
                fee: FEE_TIER_001,
                recipient: userAddress,
                deadline: ethers.constants.MaxUint256,
                amountIn: ethers.utils.parseUnits("1000", 8),
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            }
        ).returns(ethers.utils.parseUnits("960", 8)); // 96% output matching quoter

        await swapRouter.mock.exactInputSingle.withArgs(
            {
                tokenIn: tokenB.address,
                tokenOut: tokenA.address,
                fee: FEE_TIER_001,
                recipient: userAddress,
                deadline: ethers.constants.MaxUint256,
                amountIn: ethers.utils.parseUnits("1000", 8),
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            }
        ).returns(ethers.utils.parseUnits("950", 8)); // 95% output matching quoter

        // // Mock specific quote scenarios
        // await quoterV2.mock.quoteExactInputSingle.withArgs({
        //     tokenIn: tokenA.address,
        //     tokenOut: tokenB.address,
        //     fee: FEE_TIER_001,
        //     amountIn: ethers.utils.parseUnits("1000", 8),
        //     sqrtPriceLimitX96: 0
        // }).returns(
        //     ethers.utils.parseUnits("980", 8), // 98% output
        //     ethers.BigNumber.from("79228162514264337593543950336"), // sqrtPriceX96After
        //     0, // initializedTicksCrossed
        //     ethers.BigNumber.from("100000") // gasEstimate
        // );

        // await quoterV2.mock.quoteExactInputSingle.withArgs({
        //     tokenIn: tokenB.address,
        //     tokenOut: tokenA.address,
        //     fee: FEE_TIER_001,
        //     amountIn: ethers.utils.parseUnits("1000", 8),
        //     sqrtPriceLimitX96: 0
        // }).returns(
        //     ethers.utils.parseUnits("970", 8), // 97% output
        //     ethers.BigNumber.from("79228162514264337593543950336"), // sqrtPriceX96After
        //     0, // initializedTicksCrossed
        //     ethers.BigNumber.from("100000") // gasEstimate
        // );

        // Transfer some tokens to user for testing
        await tokenA.transfer(userAddress, ethers.utils.parseUnits("10000", 8));
        await tokenB.transfer(userAddress, ethers.utils.parseUnits("10000", 8));
    });

    beforeEach(async () => {
        snapshotId = await takeSnapshot(deployer.provider);
    });

    afterEach(async () => {
        await revertProvider(deployer.provider, snapshotId);
    });

    describe("#swapAndAddLiquidity", async () => {
        it("should successfully create a new position with optimal token ratios", async () => {
            console.log("=== Test: Create new position ===");
            const amount0Desired = ethers.utils.parseUnits("1000", 8); // 1000 tokenA
            const amount1Desired = ethers.utils.parseUnits("1100", 8);  // 800 tokenB (imbalanced)

            const tickLower = -500;
            const tickUpper = 500;

            // Mock position manager responses for new position
            await positionManager.mock.mint.returns(
                1, // tokenId
                ethers.BigNumber.from("1000000"), // liquidity
                amount0Desired.mul(90).div(100), // amount0 (90% of desired)
                amount1Desired.mul(90).div(100)  // amount1 (90% of desired)
            );

            console.log("Amount0Desired:", amount0Desired.toString());
            console.log("Amount1Desired:", amount1Desired.toString());
            console.log("TickLower:", tickLower);
            console.log("TickUpper:", tickUpper);

            // Approve tokens
            console.log("Approving tokens...");
            await tokenA.connect(user).approve(uniswapV3Connector.address, amount0Desired);
            await tokenB.connect(user).approve(uniswapV3Connector.address, amount1Desired);

            // Record balances before
            const balanceBeforeA = await tokenA.balanceOf(userAddress);
            const balanceBeforeB = await tokenB.balanceOf(userAddress);
            console.log("Balance before - TokenA:", balanceBeforeA.toString());
            console.log("Balance before - TokenB:", balanceBeforeB.toString());

            // Execute swapAndAddLiquidity
            console.log("Executing swapAndAddLiquidity...");

                    // Mock quoter responses
        await quoterV2.mock.quoteExactInputSingle.returns(
            ethers.utils.parseUnits("98", 8), // amountOut
            0, // sqrtPriceX96After
            0, // initializedTicksCrossed
            0 // gasEstimate
        );
            const tx = await uniswapV3Connector.connect(user).swapAndAddLiquidity({
                tokenId: 0, // New position
                token0: tokenA.address,
                token1: tokenB.address,
                feeTier: FEE_TIER_001,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                user: userAddress
            });

            console.log("Transaction hash:", tx.hash);
            const receipt = await tx.wait();
            console.log("Transaction status:", receipt.status);
            
            // Check that the transaction was successful
            expect(receipt.status).to.equal(1);

            // Check that user's balance decreased
            const balanceAfterA = await tokenA.balanceOf(userAddress);
            const balanceAfterB = await tokenB.balanceOf(userAddress);
            console.log("Balance after - TokenA:", balanceAfterA.toString());
            console.log("Balance after - TokenB:", balanceAfterB.toString());
            expect(balanceBeforeA.sub(balanceAfterA)).to.be.gt(0);
            expect(balanceBeforeB.sub(balanceAfterB)).to.be.gt(0);
        });

        it("should increase liquidity of existing position", async () => {
            console.log("=== Test: Increase existing position liquidity ===");
            const initialAmount0 = ethers.utils.parseUnits("500", 8);
            const initialAmount1 = ethers.utils.parseUnits("500", 8);
            const additionalAmount0 = ethers.utils.parseUnits("300", 8);
            const additionalAmount1 = ethers.utils.parseUnits("300", 8);

            const tickLower = -500;
            const tickUpper = 500;

            // Mock position manager responses for initial position
            await positionManager.mock.mint.returns(
                1, // tokenId
                ethers.BigNumber.from("500000"), // liquidity
                initialAmount0.mul(90).div(100), // amount0 (90% of desired)
                initialAmount1.mul(90).div(100)  // amount1 (90% of desired)
            );

            // Mock position manager responses for position info
            await positionManager.mock.positions.returns(
                0, // nonce
                userAddress, // operator
                tokenA.address, // token0
                tokenB.address, // token1
                FEE_TIER_001, // fee
                tickLower, // tickLower
                tickUpper, // tickUpper
                ethers.BigNumber.from("500000"), // liquidity
                0, // feeGrowthInside0LastX128
                0, // feeGrowthInside1LastX128
                0, // tokensOwed0
                0  // tokensOwed1
            );

            // Mock position manager responses for increasing liquidity
            await positionManager.mock.increaseLiquidity.returns(
                ethers.BigNumber.from("300000"), // additional liquidity
                additionalAmount0.mul(90).div(100), // amount0 (90% of desired)
                additionalAmount1.mul(90).div(100)  // amount1 (90% of desired)
            );

            // Create initial position
            console.log("Creating initial position...");
            await tokenA.connect(user).approve(uniswapV3Connector.address, initialAmount0);
            await tokenB.connect(user).approve(uniswapV3Connector.address, initialAmount1);

            const initialTx = await uniswapV3Connector.connect(user).swapAndAddLiquidity({
                tokenId: 0,
                token0: tokenA.address,
                token1: tokenB.address,
                feeTier: FEE_TIER_001,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: initialAmount0,
                amount1Desired: initialAmount1
            });

            const initialReceipt = await initialTx.wait();
            console.log("Initial position created, status:", initialReceipt.status);

            // Add more liquidity to existing position
            console.log("Adding more liquidity to existing position...");
            await tokenA.connect(user).approve(uniswapV3Connector.address, additionalAmount0);
            await tokenB.connect(user).approve(uniswapV3Connector.address, additionalAmount1);

            const additionalTx = await uniswapV3Connector.connect(user).swapAndAddLiquidity({
                tokenId: 1, // From initial position
                token0: tokenA.address,
                token1: tokenB.address,
                feeTier: FEE_TIER_001,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: additionalAmount0,
                amount1Desired: additionalAmount1
            });

            const additionalReceipt = await additionalTx.wait();
            console.log("Additional liquidity added, status:", additionalReceipt.status);

            // Verify transaction was successful
            expect(additionalReceipt.status).to.equal(1);
        });

        it("should revert when position manager is not set", async () => {
            console.log("=== Test: Position manager not set ===");
            // Temporarily set position manager to zero
            await uniswapV3Connector.setPositionManager(ZERO_ADDRESS);

            const amount0Desired = ethers.utils.parseUnits("100", 8);
            const amount1Desired = ethers.utils.parseUnits("100", 8);

            const tickLower = -500;
            const tickUpper = 500;

            await tokenA.connect(user).approve(uniswapV3Connector.address, amount0Desired);
            await tokenB.connect(user).approve(uniswapV3Connector.address, amount1Desired);

            console.log("Attempting to call swapAndAddLiquidity with no position manager...");
            await expect(
                uniswapV3Connector.connect(user).swapAndAddLiquidity({
                    tokenId: 0,
                    token0: tokenA.address,
                    token1: tokenB.address,
                    feeTier: FEE_TIER_001,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired
                })
            ).to.be.revertedWith("Position manager not set");

            // Restore position manager
            await uniswapV3Connector.setPositionManager(positionManager.address);
        });

        it("should revert when tokens are the same", async () => {
            console.log("=== Test: Same tokens ===");
            const amount0Desired = ethers.utils.parseUnits("100", 8);
            const amount1Desired = ethers.utils.parseUnits("100", 8);

            const tickLower = -500;
            const tickUpper = 500;

            await tokenA.connect(user).approve(uniswapV3Connector.address, amount0Desired);

            console.log("Attempting to call swapAndAddLiquidity with same tokens...");
            await expect(
                uniswapV3Connector.connect(user).swapAndAddLiquidity({
                    tokenId: 0,
                    token0: tokenA.address,
                    token1: tokenA.address, // Same token
                    feeTier: FEE_TIER_001,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired
                })
            ).to.be.revertedWith("Same tokens");
        });

        it("should revert when amounts are zero", async () => {
            console.log("=== Test: Zero amounts ===");
            const tickLower = -500;
            const tickUpper = 500;

            console.log("Attempting to call swapAndAddLiquidity with zero amounts...");
            await expect(
                uniswapV3Connector.connect(user).swapAndAddLiquidity({
                    tokenId: 0,
                    token0: tokenA.address,
                    token1: tokenB.address,
                    feeTier: FEE_TIER_001,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: 0,
                    amount1Desired: 0
                })
            ).to.be.revertedWith("Zero amounts");
        });

        it("should revert when tick range is invalid", async () => {
            console.log("=== Test: Invalid tick range ===");
            const amount0Desired = ethers.utils.parseUnits("100", 8);
            const amount1Desired = ethers.utils.parseUnits("100", 8);

            const tickLower = 500; // Higher than upper
            const tickUpper = -500; // Lower than lower

            await tokenA.connect(user).approve(uniswapV3Connector.address, amount0Desired);
            await tokenB.connect(user).approve(uniswapV3Connector.address, amount1Desired);

            console.log("Attempting to call swapAndAddLiquidity with invalid tick range...");
            await expect(
                uniswapV3Connector.connect(user).swapAndAddLiquidity({
                    tokenId: 0,
                    token0: tokenA.address,
                    token1: tokenB.address,
                    feeTier: FEE_TIER_001,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired
                })
            ).to.be.revertedWith("Invalid tick range");
        });

        it("should revert when existing position parameters don't match", async () => {
            console.log("=== Test: Position parameters mismatch ===");
            const amount0Desired = ethers.utils.parseUnits("100", 8);
            const amount1Desired = ethers.utils.parseUnits("100", 8);

            const tickLower = -500;
            const tickUpper = 500;

            // Mock position manager responses for initial position
            await positionManager.mock.mint.returns(
                1, // tokenId
                ethers.BigNumber.from("100000"), // liquidity
                amount0Desired.mul(90).div(100), // amount0 (90% of desired)
                amount1Desired.mul(90).div(100)  // amount1 (90% of desired)
            );

            // Mock position manager responses for position info with different fee tier
            await positionManager.mock.positions.returns(
                0, // nonce
                userAddress, // operator
                tokenA.address, // token0
                tokenB.address, // token1
                500, // fee (different from FEE_TIER_001)
                tickLower, // tickLower
                tickUpper, // tickUpper
                ethers.BigNumber.from("100000"), // liquidity
                0, // feeGrowthInside0LastX128
                0, // feeGrowthInside1LastX128
                0, // tokensOwed0
                0  // tokensOwed1
            );

            // Create initial position
            console.log("Creating initial position...");
            await tokenA.connect(user).approve(uniswapV3Connector.address, amount0Desired);
            await tokenB.connect(user).approve(uniswapV3Connector.address, amount1Desired);

            const initialTx = await uniswapV3Connector.connect(user).swapAndAddLiquidity({
                tokenId: 0,
                token0: tokenA.address,
                token1: tokenB.address,
                feeTier: FEE_TIER_001,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired
            });

            const initialReceipt = await initialTx.wait();
            console.log("Initial position created, status:", initialReceipt.status);

            // Try to add liquidity with different fee tier
            console.log("Attempting to add liquidity with different fee tier...");
            await tokenA.connect(user).approve(uniswapV3Connector.address, amount0Desired);
            await tokenB.connect(user).approve(uniswapV3Connector.address, amount1Desired);

            await expect(
                uniswapV3Connector.connect(user).swapAndAddLiquidity({
                    tokenId: 1,
                    token0: tokenA.address,
                    token1: tokenB.address,
                    feeTier: 500, // Different fee tier
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired
                })
            ).to.be.revertedWith("Fee tier mismatch");
        });

        it("should handle extreme price ranges correctly", async () => {
            console.log("=== Test: Extreme price ranges ===");
            const amount0Desired = ethers.utils.parseUnits("1000", 8);
            const amount1Desired = ethers.utils.parseUnits("1000", 8);

            // Use a very wide tick range
            const tickLower = -887220; // Very low tick
            const tickUpper = 887220;  // Very high tick

            // Mock position manager responses for extreme range
            await positionManager.mock.mint.returns(
                1, // tokenId
                ethers.BigNumber.from("1000000"), // liquidity
                amount0Desired.mul(90).div(100), // amount0 (90% of desired)
                amount1Desired.mul(90).div(100)  // amount1 (90% of desired)
            );

            console.log("TickLower:", tickLower);
            console.log("TickUpper:", tickUpper);

            await tokenA.connect(user).approve(uniswapV3Connector.address, amount0Desired);
            await tokenB.connect(user).approve(uniswapV3Connector.address, amount1Desired);

            console.log("Executing swapAndAddLiquidity with extreme tick range...");
            const tx = await uniswapV3Connector.connect(user).swapAndAddLiquidity({
                tokenId: 0,
                token0: tokenA.address,
                token1: tokenB.address,
                feeTier: FEE_TIER_001,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired
            });

            const receipt = await tx.wait();
            console.log("Transaction status:", receipt.status);
            expect(receipt.status).to.equal(1);
        });

        it("should refund unused tokens", async () => {
            console.log("=== Test: Refund unused tokens ===");
            const amount0Desired = ethers.utils.parseUnits("1000", 8);
            const amount1Desired = ethers.utils.parseUnits("1000", 8);

            const tickLower = -500;
            const tickUpper = 500;

            // Mock position manager responses with partial token usage
            await positionManager.mock.mint.returns(
                1, // tokenId
                ethers.BigNumber.from("1000000"), // liquidity
                amount0Desired.mul(80).div(100), // amount0 (80% of desired - more refund)
                amount1Desired.mul(80).div(100)  // amount1 (80% of desired - more refund)
            );

            // Record initial balances
            const initialBalanceA = await tokenA.balanceOf(userAddress);
            const initialBalanceB = await tokenB.balanceOf(userAddress);
            console.log("Initial balance - TokenA:", initialBalanceA.toString());
            console.log("Initial balance - TokenB:", initialBalanceB.toString());

            // Approve tokens
            console.log("Approving tokens...");
            await tokenA.connect(user).approve(uniswapV3Connector.address, amount0Desired);
            await tokenB.connect(user).approve(uniswapV3Connector.address, amount1Desired);

            // Execute swapAndAddLiquidity
            console.log("Executing swapAndAddLiquidity...");
            const tx = await uniswapV3Connector.connect(user).swapAndAddLiquidity({
                tokenId: 0,
                token0: tokenA.address,
                token1: tokenB.address,
                feeTier: FEE_TIER_001,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired
            });

            const receipt = await tx.wait();
            console.log("Transaction status:", receipt.status);

            // Check final balances
            const finalBalanceA = await tokenA.balanceOf(userAddress);
            const finalBalanceB = await tokenB.balanceOf(userAddress);
            console.log("Final balance - TokenA:", finalBalanceA.toString());
            console.log("Final balance - TokenB:", finalBalanceB.toString());

            // Should have used some tokens but not all
            expect(finalBalanceA).to.be.lt(initialBalanceA);
            expect(finalBalanceB).to.be.lt(initialBalanceB);
            
            // Should have refunded some tokens
            expect(finalBalanceA).to.be.gt(initialBalanceA.sub(amount0Desired));
            expect(finalBalanceB).to.be.gt(initialBalanceB.sub(amount1Desired));
        });
    });
}); 