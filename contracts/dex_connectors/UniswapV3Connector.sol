// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./DexConnectorStorage.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/pool/IUniswapV3PoolState.sol";
import "@uniswap/v3-core/contracts/interfaces/pool/IUniswapV3PoolImmutables.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IPeripheryImmutableState.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IQuoterV2.sol";
import "./uniswap_v4_helpers/_LiquidityAmounts.sol";
import "./uniswap_v4_helpers/_TickMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
// import "hardhat/console.sol";

// Simplified interface for Uniswap V3 Position Manager
interface IPositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function mint(MintParams calldata params) external payable returns (
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function increaseLiquidity(IncreaseLiquidityParams calldata params) external payable returns (
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function positions(uint256 tokenId) external view returns (
        uint96 nonce,
        address operator,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 feeGrowthInside0LastX128,
        uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0,
        uint128 tokensOwed1
    );
}

contract UniswapV3Connector is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    DexConnectorStorage
{
    modifier nonZeroAddress(address _address) {
        require(_address != address(0), "UniswapV3Connector: zero address");
        _;
    }

    event ExecuteSwap(
        bool _swapToken0ToToken1,
        uint256 _neededSwapAmount,
        uint256 _receivedAmount
    );

    event SwapAndAddLiquidity(
        AddLiquidityParams _params,
        uint256 _remaining0,
        uint256 _remaining1,
        uint256 _tokenId
    );

    event FindOptimalSwapAmount(
        uint256 _newUserRatio,
        uint256 _newTargetRatio
    );

    event GetQuoteResult(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut
    );

    using SafeERC20 for IERC20;

    /// @notice This contract is used for interacting with UniswapV3 contract
    /// @param _name Name of the underlying DEX
    /// @param _exchangeRouter Address of the DEX router contract
    function initialize(
        string memory _name,
        address _exchangeRouter,
        address _quoterAddress
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        name = _name;
        exchangeRouter = _exchangeRouter;
        liquidityPoolFactory = IPeripheryImmutableState(exchangeRouter).factory();
        quoterAddress = _quoterAddress;
        wrappedNativeToken = IPeripheryImmutableState(exchangeRouter).WETH9();
    }

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice Setter for wrapped native token
    /// @dev Get address from exchange router
    function setWrappedNativeToken() external override onlyOwner {
        wrappedNativeToken = IPeripheryImmutableState(exchangeRouter).WETH9();
    }

    /// @notice Setter for exchange router
    /// @dev Set address of liquidity pool factory from the exchange router
    /// @param _exchangeRouter Address of the new exchange router contract
    function setExchangeRouter(
        address _exchangeRouter
    ) external override nonZeroAddress(_exchangeRouter) onlyOwner {
        exchangeRouter = _exchangeRouter;
        liquidityPoolFactory = IPeripheryImmutableState(exchangeRouter).factory();
    }

    /// @notice Setter for liquidity pool factory
    /// @dev Set address from exchange router
    function setLiquidityPoolFactory() external override onlyOwner {
        liquidityPoolFactory = IPeripheryImmutableState(exchangeRouter).factory();
    }

    /// @notice Setter for quoter
    function setQuoter(address _quoterAddress) external onlyOwner {
        quoterAddress = _quoterAddress;
    }

    /// @notice Setter for position manager
    function setPositionManager(address _positionManager) external onlyOwner {
        positionManager = _positionManager;
    }

    /// @notice Setter for fee tier
    /// @dev We set the fee tier that is used for exchanging tokens
    function setFeeTier(
        address _firstToken,
        address _secondToken,
        uint24 _feeTier
    ) external onlyOwner {
        feeTier[_firstToken][_secondToken] = _feeTier;
        feeTier[_secondToken][_firstToken] = _feeTier;
    }

    function setMaxIters(uint256 _maxIters) external onlyOwner {
        MAX_ITERS = _maxIters;
    }

    function setTolerance(uint256 _tolerance) external onlyOwner {
        TOLERANCE = _tolerance;
    }

    function setPrecision(uint256 _precision) external onlyOwner {
        PRECISION = _precision;
    }

    function setMinGasReserve(uint256 _minGasReserve) external onlyOwner {
        MIN_GAS_RESERVE = _minGasReserve;
    }

    function convertedPath(
        address[] memory _path
    ) public view returns (bytes memory packedData) {
        packedData = abi.encodePacked(_path[0]);

        for (uint i = 1; i < _path.length; i++) {
            address firstToken = _path[i - 1];
            address secondToken = _path[i];
            uint24 _feeTier = feeTier[firstToken][secondToken];
            packedData = abi.encodePacked(packedData, _feeTier, secondToken);
        }
    }

    function convertedPathReversed(
        address[] memory _path
    ) public view returns (bytes memory packedData) {
        packedData = abi.encodePacked(_path[_path.length - 1]);

        for (uint i = _path.length - 1; i > 0; i--) {
            address firstToken = _path[i];
            address secondToken = _path[i - 1];
            uint24 _feeTier = feeTier[firstToken][secondToken];
            packedData = abi.encodePacked(packedData, _feeTier, secondToken);
        }
    }

    /// @notice Return the needed input amount to get the output amount
    /// @dev Return (false, 0) if DEX cannot give the output amount. 
    ///      Note: No need to reverse the path for this function
    function getExactOutput(
        address[] memory _path,
        uint256 _amountOut
    ) public returns (bool, uint256) {
        if (!isPathValid(_path)) {
            return (false, 0);
        }
        (uint amountIn, , , ) = IQuoterV2(quoterAddress).quoteExactOutput(
            convertedPathReversed(_path),
            _amountOut
        );
        return (true, amountIn);
    }

    /// @notice Return the output amount for the given input amount
    /// @dev Return (false, 0) if DEX cannot swap the input amount
    function getExactInput(
        address[] memory _path,
        uint256 _amountIn
    ) public returns (bool, uint256) {
        if (!isPathValid(_path)) {
            return (false, 0);
        }
        (uint amountOut, , , ) = IQuoterV2(quoterAddress).quoteExactInput(
            convertedPath(_path),
            _amountIn
        );
        return (true, amountOut);
    }

    /// @notice Deprecated for v3
    function getInputAmount(
        uint,
        address,
        address
    ) external pure override returns (bool, uint) {
        return (true, 0);
    }

    /// @notice Deprecated for v3
    function getOutputAmount(
        uint,
        address,
        address
    ) external pure override returns (bool, uint) {
        return (true, 0);
    }

    /// @notice Return the square root price of given token pairs
    function getSqrtPriceX96(
        address[] memory _path
    )
        external
        view
        returns (uint[] memory _sqrtPriceX96, address[] memory _firstToken)
    {
        address liquidityPool;
        uint sqrtPriceX96;

        for (uint i = 0; i < _path.length - 1; i++) {
            liquidityPool = IUniswapV3Factory(liquidityPoolFactory).getPool(
                _path[i],
                _path[i + 1],
                feeTier[_path[i]][_path[i + 1]]
            );
            (sqrtPriceX96, , , , , , ) = IUniswapV3PoolState(liquidityPool).slot0();
            _sqrtPriceX96[i] = sqrtPriceX96;
            if (IUniswapV3PoolImmutables(liquidityPool).token0() == _path[i]) {
                _firstToken[i] = _path[i];
            } else {
                _firstToken[i] = _path[i + 1];
            }
        }
    }

    /// @notice Exchange input token for output token through exchange router
    /// @dev Check exchange conditions before exchanging
    ///      We assume that the input token is not WETH (it is teleBTC)
    /// @param _inputAmount Amount of input token
    /// @param _outputAmount Amount of output token
    /// @param _path List of tokens that are used for exchanging
    /// @param _to Receiver address
    /// @param _deadline Deadline of exchanging tokens
    /// @param _isFixedToken True if the input token amount is fixed
    /// @return _result True if the exchange is successful
    /// @return _amounts Amounts of tokens that are involved in exchanging
    function swap(
        uint256 _inputAmount,
        uint256 _outputAmount,
        address[] memory _path,
        address _to,
        uint256 _deadline,
        bool _isFixedToken
    )
        external
        override
        nonReentrant
        nonZeroAddress(_to)
        returns (bool _result, uint[] memory _amounts)
    {
        uint neededInputAmount;
        (_result, neededInputAmount) = _checkExchangeConditions(
            _inputAmount,
            _outputAmount,
            _path,
            _deadline,
            _isFixedToken
        );

        if (_result) {
            uint _amount;
            _amounts = new uint[](2);
            // Get tokens from user
            IERC20(_path[0]).safeTransferFrom(
                _msgSender(),
                address(this),
                neededInputAmount
            );

            // Give allowance to exchange router
            IERC20(_path[0]).approve(exchangeRouter, neededInputAmount);

            if (_isFixedToken == true) {
                _amount = ISwapRouter(exchangeRouter).exactInput(
                    _buildInputSwap(
                        neededInputAmount,
                        _outputAmount,
                        _path,
                        _to,
                        _deadline
                    )
                );
                _amounts[0] = neededInputAmount;
                _amounts[1] = _amount;
            }

            if (_isFixedToken == false) {
                _amount = ISwapRouter(exchangeRouter).exactOutput(
                    _buildOutputSwap(
                        neededInputAmount,
                        _outputAmount,
                        _path,
                        _to,
                        _deadline
                    )
                );
                _amounts[0] = _amount;
                _amounts[1] = _outputAmount;
            }
            emit Swap(_path, _amounts, _to);
        }
    }

    /// @notice Return true if the exchange path is valid
    /// @param _path List of tokens that are used for exchanging
    function isPathValid(
        address[] memory _path
    ) public view override returns (bool _result) {
        address liquidityPool;

        // Checks that path length is greater than one
        if (_path.length < 2) {
            return false;
        }

        for (uint i = 0; i < _path.length - 1; i++) {
            liquidityPool = IUniswapV3Factory(liquidityPoolFactory).getPool(
                _path[i],
                _path[i + 1],
                feeTier[_path[i]][_path[i + 1]]
            );
            if (liquidityPool == address(0)) {
                return false;
            }
        }

        return true;
    }

    function getSqrtPrice(
        address _token0,
        address _token1,
        uint24 _feeTier
    ) public view returns (uint160 _sqrtPrice) {
        address poolAddress = IUniswapV3Factory(liquidityPoolFactory).getPool(
            _token0, 
            _token1, 
            _feeTier
        );
        // Note: since slot0 is different in Ethereum and BNB, 
        // we need to use staticcall to get the data
        (bool success, bytes memory data) = poolAddress.staticcall(
            abi.encodeWithSignature("slot0()")
        );
        require(success, "Failed to get slot0");

        // Decode the returned data
        (_sqrtPrice) = abi.decode(
            data,
            (uint160)
        );
    }

    function getSqrtPriceAtTick(
        int24 _tick
    ) public pure returns (uint160) {
        return _TickMath.getSqrtPriceAtTick(_tick);
    }

    function getLiquidityForAmounts(
        uint160 _sqrtPrice,
        int24 _tickLower,
        int24 _tickUpper,
        uint256 _amount0Desired,
        uint256 _amount1Desired
    ) public pure returns (uint128) {
        return _LiquidityAmounts.getLiquidityForAmounts(
            _sqrtPrice,
            _TickMath.getSqrtPriceAtTick(_tickLower),
            _TickMath.getSqrtPriceAtTick(_tickUpper),
            _amount0Desired,
            _amount1Desired
        );
    }

    function getAmountsForLiquidity(
        uint160 _sqrtPrice,
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _liquidity
    ) public pure returns (uint256, uint256) {
        return _LiquidityAmounts.getAmountsForLiquidity(    
            _sqrtPrice,
            _TickMath.getSqrtPriceAtTick(_tickLower),
            _TickMath.getSqrtPriceAtTick(_tickUpper),
            _liquidity
        );
    }

    struct AddLiquidityParams {
        uint256 tokenId; // 0 for new position, non-zero for existing position
        address token0;
        address token1;
        uint24 feeTier;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        address user;
    }

    event Ratios(uint256 _userRatio, uint256 _rangeRatio, uint256 _totalAmount0, uint256 _totalAmount1);

    /// @notice Zap tokens into a Uniswap V3 position in one call
    /// @dev This function performs the following steps:
    ///      1. Validates gas reserve and pool existence
    ///      2. Normalizes token order to match pool configuration
    ///      3. Validates existing position parameters if updating
    ///      4. Executes optimal swaps to achieve desired token ratios
    ///      5. Mints new position or increases existing position liquidity
    ///      6. Refunds any remaining tokens to the user
    /// @param params Struct containing all parameters for the operation
    /// @return _tokenId The ID of the created/updated position
    /// @return _remaining0 Amount of token0 remaining after operation
    /// @return _remaining1 Amount of token1 remaining after operation
    function swapAndAddLiquidity(
        AddLiquidityParams memory params
    ) external nonReentrant returns (
        uint256 _tokenId,
        uint256 _remaining0,
        uint256 _remaining1
    ) {
        // Ensure sufficient gas reserve to prevent transaction failures
        require(gasleft() >= MIN_GAS_RESERVE, "UniswapV3Connector: low gas");

        // Get the pool address for the specified token pair and fee tier
        address poolAddress = IUniswapV3Factory(liquidityPoolFactory).getPool(
            params.token0,
            params.token1,
            params.feeTier
        );

        // Ensure that at least one of the amounts is greater than zero
        require(
            params.amount0Desired > 0 || params.amount1Desired > 0, 
            "UniswapV3Connector: both amounts are zero"
        );
        
        // Normalize token order to match pool's internal token ordering
        // This ensures consistent calculations and prevents errors
        if (IUniswapV3PoolImmutables(poolAddress).token0() != params.token0) {
            uint256 _tempAmount = params.amount0Desired;
            address _tempToken = params.token0;
            params.token0 = params.token1;
            params.token1 = _tempToken;
            params.amount0Desired = params.amount1Desired;
            params.amount1Desired = _tempAmount;
        }

        // Validate existing position parameters if updating an existing position
        if (params.tokenId != 0) {
            (
                , , , ,
                uint24 existingFee,
                int24 existingTickLower,
                int24 existingTickUpper,
                , , , ,
            ) = IPositionManager(positionManager).positions(params.tokenId);
            
            require(existingFee == params.feeTier, "UniswapV3Connector: Fee tier mismatch");
            require(existingTickLower == params.tickLower, "UniswapV3Connector: Tick lower mismatch");
            require(existingTickUpper == params.tickUpper, "UniswapV3Connector: Tick upper mismatch");
        }

        // Transfer tokens from user
        IERC20(params.token0).safeTransferFrom(msg.sender, address(this), params.amount0Desired);
        IERC20(params.token1).safeTransferFrom(msg.sender, address(this), params.amount1Desired);

        // Get total amounts of token0 and token1 in the current range
        (uint256 _totalAmount0, uint256 _totalAmount1) = _LiquidityAmounts.getAmountsForLiquidity(
            getSqrtPrice(params.token0, params.token1, params.feeTier), // Get current sqrt price from the pool for ratio calculations
            _TickMath.getSqrtPriceAtTick(params.tickLower),
            _TickMath.getSqrtPriceAtTick(params.tickUpper),
            IUniswapV3PoolState(poolAddress).liquidity() // Total liquidity in the current range
        );

        // Calculate the range ratio
        uint256 _rangeRatio = _totalAmount1 > 0 && _totalAmount0 <= type(uint256).max / PRECISION
            ? (_totalAmount0 * PRECISION) / _totalAmount1
            : type(uint256).max;

        // Calculate the user's current token ratio
        uint256 _userRatio;
        if (params.amount1Desired > 0 && params.amount0Desired <= type(uint256).max / PRECISION) {
            _userRatio = (params.amount0Desired * PRECISION) / params.amount1Desired;
        } else {
            _userRatio = type(uint256).max;
        }

        emit Ratios(_userRatio, _rangeRatio, _totalAmount0, _totalAmount1);
        
        // Execute swaps to achieve optimal token ratios for the position
        if (_userRatio > _rangeRatio) {
            // User has too much token0 relative to token1 - swap token0 for token1
            _executeSwap(
                true,
                params,
                _totalAmount0,
                _totalAmount1
            );
        } else if (_userRatio < _rangeRatio) {
            // User has too much token1 relative to token0 - swap token1 for token0
            _executeSwap(
                false,
                params, 
                _totalAmount1,
                _totalAmount0
            );
        }

        // Approve position manager for liquidity operations
        IERC20(params.token0).approve(positionManager, IERC20(params.token0).balanceOf(address(this)));
        IERC20(params.token1).approve(positionManager, IERC20(params.token1).balanceOf(address(this)));

        // In any case (swap or not), we need to mint a new position 
        // or increase liquidity of existing position
        if (params.tokenId == 0) {
            // Mint a new position with the optimized token amounts
            (_tokenId, , , ) = IPositionManager(positionManager).mint(
                IPositionManager.MintParams({
                    token0: params.token0,
                    token1: params.token1,
                    fee: params.feeTier,
                    tickLower: params.tickLower,
                    tickUpper: params.tickUpper,
                    amount0Desired: IERC20(params.token0).balanceOf(address(this)),
                    amount1Desired: IERC20(params.token1).balanceOf(address(this)),
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: params.user,
                    deadline: block.timestamp
                })
            );
        } else {
            // Increase liquidity of existing position
            _tokenId = params.tokenId;
            IPositionManager(positionManager).increaseLiquidity(
                IPositionManager.IncreaseLiquidityParams({
                    tokenId: params.tokenId,
                    amount0Desired: IERC20(params.token0).balanceOf(address(this)),
                    amount1Desired: IERC20(params.token1).balanceOf(address(this)),
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );
        }

        // Calculate remaining token amounts after all operations
        _remaining0 = IERC20(params.token0).balanceOf(address(this));
        _remaining1 = IERC20(params.token1).balanceOf(address(this));
        
        // Refund any remaining tokens back to the user
        if (_remaining0 > 0) {
            IERC20(params.token0).safeTransfer(msg.sender, _remaining0);
        }
        if (_remaining1 > 0) {
            IERC20(params.token1).safeTransfer(msg.sender, _remaining1);
        }
        
        // Emit event for tracking and transparency
        emit SwapAndAddLiquidity(
            params,
            _remaining0,
            _remaining1,
            _tokenId
        );
    }

    // Private functions
    function _buildInputSwap(
        uint _amountIn,
        uint _amountOutMin,
        address[] memory _path,
        address _recipient,
        uint _deadline
    ) private view returns (ISwapRouter.ExactInputParams memory) {
        return
            ISwapRouter.ExactInputParams({
                path: convertedPath(_path),
                recipient: _recipient,
                deadline: _deadline,
                amountIn: _amountIn,
                amountOutMinimum: _amountOutMin
            });
    }

    function _buildOutputSwap(
        uint _amountInMaximum,
        uint _amountOut,
        address[] memory _path,
        address _recipient,
        uint _deadline
    ) private view returns (ISwapRouter.ExactOutputParams memory) {
        return
            ISwapRouter.ExactOutputParams({
                path: convertedPathReversed(_path),
                recipient: _recipient,
                deadline: _deadline,
                amountOut: _amountOut,
                amountInMaximum: _amountInMaximum
            });
    }

    /// @notice Check if exchanging is possible or not
    /// @dev Avoid reverting by exchange router
    /// @return True if exchange conditions are satisfied
    /// @return Needed amount of input token
    function _checkExchangeConditions(
        uint256 _inputAmount,
        uint256 _outputAmount,
        address[] memory _path,
        uint256 _deadline,
        bool _isFixedToken
    ) private returns (bool, uint) {
        // Check deadline has not passed
        if (_deadline < block.timestamp) {
            return (false, 0);
        }

        if (_isFixedToken == true) {
            // Input amount is fixed
            // Find maximum output amount
            (bool success, uint outputResult) = getExactInput(_path, _inputAmount);
            if (success == false) {
                return (false, 0);
            }
            if (_outputAmount > outputResult) {
                // Result is not enough
                return (false, 0);
            }
            return (true, _inputAmount);
        } else {
            // Output amount is fixed
            // Find minimum input amount
            (bool success, uint inputResult) = getExactOutput(_path, _outputAmount);
            if (success == false) {
                return (false, 0);
            }
            if (_inputAmount < inputResult) {
                // Input amount is not enough
                return (false, 0);
            }
            return (true, inputResult);
        }
    }

    /// @notice Execute swap to achieve optimal ratio
    function _executeSwap(
        bool _swapToken0ToToken1,
        AddLiquidityParams memory params,
        uint256 _totalAmount0,
        uint256 _totalAmount1
    ) private returns (bool _success) {

        uint256 _neededSwapAmount;
        uint256 _receivedAmount;
        ISwapRouter.ExactInputSingleParams memory _params;

        if (_swapToken0ToToken1) {
            // Swap token0 to token1
            _neededSwapAmount = _findOptimalSwapAmount(
                params, 
                _totalAmount0,
                _totalAmount1
            );

            _params = ISwapRouter.ExactInputSingleParams({
                tokenIn: params.token0,
                tokenOut: params.token1,
                fee: params.feeTier,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: _neededSwapAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

            // Approve token0 for swap
            IERC20(params.token0).approve(exchangeRouter, _neededSwapAmount);
        } else {
            AddLiquidityParams memory _paramsInverted = AddLiquidityParams({
                tokenId: 0,
                token0: params.token1,
                token1: params.token0,
                feeTier: params.feeTier,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,    
                amount0Desired: params.amount1Desired,
                amount1Desired: params.amount0Desired,
                user: address(this)
            });
            // Swap token1 to token0
            _neededSwapAmount = _findOptimalSwapAmount(
                _paramsInverted,
                _totalAmount1,
                _totalAmount0
            );

            _params = ISwapRouter.ExactInputSingleParams({
                tokenIn: params.token1,
                tokenOut: params.token0,
                fee: params.feeTier,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: _neededSwapAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

            // Approve token1 for swap
            IERC20(params.token1).approve(exchangeRouter, _neededSwapAmount);
        }
        
        if (_neededSwapAmount > 0) {
            try ISwapRouter(exchangeRouter).exactInputSingle(_params) returns (uint256 __receivedAmount) {
                _receivedAmount = __receivedAmount;
                _success = true;
            } catch {
                _success = false;
            }
        }
        if (_success == true) {
            emit ExecuteSwap(
                _swapToken0ToToken1,
                _neededSwapAmount,
                _receivedAmount
            );
        }
    }

    /// @notice Find the optimal swap amount using binary search to achieve target ratio
    /// @dev This function implements a binary search algorithm to find the optimal amount of token0
    ///      to swap for token1, such that the resulting ratio between remaining assets matches
    ///      the target ratio. The search minimizes the difference between user's ratio and pool's ratio.
    ///      
    ///      Algorithm steps:
    ///      1. Calculate initial user ratio from current token amounts
    ///      2. Use binary search between 0 and amount0Desired to find optimal swap amount
    ///      3. For each midpoint, calculate new ratios after swap simulation
    ///      4. Track the best guess that minimizes the percentage difference
    ///      5. Continue until tolerance is met or max iterations reached
    ///      
    ///      Safety features:
    ///      - Guards against underflow/overflow in all calculations
    ///      - Early exit if already optimal
    ///      - Prevents infinite loops with MAX_ITERS
    ///      - Handles edge cases like zero amounts and extreme ratios
    /// @param params Struct containing token amounts, addresses, and fee tier
    /// @param _totalAmount0 Total amount of token0 in the pool before swap
    /// @param _totalAmount1 Total amount of token1 in the pool before swap
    /// @return bestGuess The optimal amount of token0 to swap for token1
    function _findOptimalSwapAmount(
        AddLiquidityParams memory params,
        uint256 _totalAmount0,
        uint256 _totalAmount1
    ) internal returns (uint256 bestGuess) {

        // Calculate the user's current token ratio
        uint256 newUserRatio = params.amount1Desired > 0 && 
            params.amount0Desired <= type(uint256).max / PRECISION
                ? (params.amount0Desired * PRECISION) / params.amount1Desired
                : type(uint256).max;

        // Initialize the best difference percentage to the maximum value
        uint256 bestDiffPercentage = type(uint256).max;

        // Initialize the binary search range
        uint256 lo = 0;
        uint256 hi = params.amount0Desired;

        uint256 newTargetRatio;
        uint256 y;

        for (uint8 i = 0; i < MAX_ITERS && lo <= hi; ++i) {

            // Calculate the midpoint of the binary search
            uint256 mid = (lo + hi) >> 1;

            // Get the quote for swapping `mid` of token0 -> token1
            if (mid == 0) {
                y = 0;
            } else {
                y = _getQuoteResult(params.token0, params.token1, params.feeTier, mid);
            }

            // New ratio after swap (guard user-side underflow + addition overflow)
            newUserRatio =
                // safe denom: params.amount1Desired + y
                ((y <= type(uint256).max - params.amount1Desired)
                    ? (params.amount1Desired + y)
                    : type(uint256).max) > 0
                &&
                // safe numer: (params.amount0Desired - mid) * PRECISION
                (params.amount0Desired >= mid ? (params.amount0Desired - mid) : 0) <= type(uint256).max / PRECISION
                    ? (((params.amount0Desired >= mid ? (params.amount0Desired - mid) : 0) * PRECISION) /
                    ((y <= type(uint256).max - params.amount1Desired)
                            ? (params.amount1Desired + y)
                            : type(uint256).max))
                    : type(uint256).max;

            // New pool ratio after swap (guard pool-side underflow + addition overflow)
            newTargetRatio =
                // safe denom: _totalAmount1 - y
                (_totalAmount1 > y ? (_totalAmount1 - y) : 0) > 0
                &&
                // safe numer pre-mul: _totalAmount0 + mid
                (_totalAmount0 <= type(uint256).max - mid) &&
                ((_totalAmount0 + mid) <= type(uint256).max / PRECISION)
                    ? (((_totalAmount0 + mid) * PRECISION) /
                    (_totalAmount1 > y ? (_totalAmount1 - y) : 0))
                    : type(uint256).max;

            // |user - pool| / pool * 100%
            uint256 diffPercentage = newTargetRatio > 0
                ? (newUserRatio > newTargetRatio
                    ? ((newUserRatio - newTargetRatio) <= type(uint256).max / ONE_HUNDRED_PERCENT
                        ? (newUserRatio - newTargetRatio) * ONE_HUNDRED_PERCENT / newTargetRatio
                        : type(uint256).max)
                    : ((newTargetRatio - newUserRatio) <= type(uint256).max / ONE_HUNDRED_PERCENT
                        ? (newTargetRatio - newUserRatio) * ONE_HUNDRED_PERCENT / newTargetRatio
                        : type(uint256).max))
                : type(uint256).max;

            // Track best-so-far
            if (diffPercentage < bestDiffPercentage) {
                bestDiffPercentage = diffPercentage;
                bestGuess = mid;
            }

            // Close enough?
            if (diffPercentage <= TOLERANCE) {
                emit FindOptimalSwapAmount(newUserRatio, newTargetRatio);
                return bestGuess;
            }

            // Binary search direction:
            // If userRatio > poolRatio, we need to swap MORE -> move right
            if (newUserRatio > newTargetRatio) {
                lo = mid + 1;
            } else {
                if (mid == 0) break; // prevent underflow on hi = mid - 1
                hi = mid - 1;
            }
        }

        emit FindOptimalSwapAmount(newUserRatio, newTargetRatio);
    }

    function _getQuoteResult(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    ) private returns (uint256 amountOut) {
        try IQuoterV2(quoterAddress).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                amountIn: amountIn,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 _amountOut, uint160, uint32, uint256) {
            amountOut = _amountOut;
        } catch {
            // If the quote fails, set the amount out to 0
            amountOut = 0;
        }
        emit GetQuoteResult(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOut
        );
    }
}