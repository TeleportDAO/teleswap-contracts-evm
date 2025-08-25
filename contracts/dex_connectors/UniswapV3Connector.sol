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
        uint256 _receivedAmount,
        uint256 _totalAmount0,
        uint256 _totalAmount1
    );

    event SwapFailed(
        ISwapRouter.ExactInputSingleParams _params
    );

    event SwapAndAddLiquidity(
        AddLiquidityParams _params,
        uint256 _remaining0,
        uint256 _remaining1,
        uint256 _tokenId
    );

    event FindOptimalSwapAmount(
        uint256 _newUserRatio,
        uint256 _newTargetRatio,
        uint256 _targetRatio
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

    /// @notice Zap tokens into a Uniswap V3 position in one call
    function swapAndAddLiquidity(
        AddLiquidityParams memory params
    ) external nonReentrant returns (
        uint256 _tokenId,
        uint256 _remaining0,
        uint256 _remaining1
    ) {
        // Find the pool address
        address poolAddress = IUniswapV3Factory(liquidityPoolFactory).getPool(
            params.token0, 
            params.token1, 
            params.feeTier
        );
        
        // If token order is different from pool, swap token addresses and amounts
        if (IUniswapV3PoolImmutables(poolAddress).token0() != params.token0) {
            uint256 _tempAmount = params.amount0Desired;
            address _tempToken = params.token0;
            params.token0 = params.token1;
            params.token1 = _tempToken;
            params.amount0Desired = params.amount1Desired;
            params.amount1Desired = _tempAmount;
        }

        // If tokenId is non-zero, validate existing position parameters
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

        // Pull in tokens and approve
        IERC20(params.token0).safeTransferFrom(msg.sender, address(this), params.amount0Desired);
        IERC20(params.token1).safeTransferFrom(msg.sender, address(this), params.amount1Desired);
        IERC20(params.token0).approve(exchangeRouter, params.amount0Desired);
        IERC20(params.token1).approve(exchangeRouter, params.amount1Desired);
        IERC20(params.token0).approve(positionManager, type(uint256).max);
        IERC20(params.token1).approve(positionManager, type(uint256).max);

        // Get current sqrt price from the pool
        uint160 _sqrtPrice = getSqrtPrice(params.token0, params.token1, params.feeTier);

        // Calculate the maximum liquidity that can be provided with the given token amounts
        uint128 _maxLiquidity = _LiquidityAmounts.getLiquidityForAmounts(
            _sqrtPrice,
            _TickMath.getSqrtPriceAtTick(params.tickLower),
            _TickMath.getSqrtPriceAtTick(params.tickUpper),
            params.amount0Desired,
            params.amount1Desired
        );

        // Then get the optimal amounts for that liquidity
        (uint256 _optimalAmount0, uint256 _optimalAmount1) = _LiquidityAmounts.getAmountsForLiquidity(
            _sqrtPrice,
            _TickMath.getSqrtPriceAtTick(params.tickLower),
            _TickMath.getSqrtPriceAtTick(params.tickUpper),
            _maxLiquidity
        );

        // Note: we multiply by PRECISION to add precision to the ratio
        uint256 _rangeRatio;
        if (_optimalAmount1 > 0 && _optimalAmount0 <= type(uint256).max / PRECISION) {
            _rangeRatio = (_optimalAmount0 * PRECISION) / _optimalAmount1;
        } else {
            _rangeRatio = type(uint256).max;
        }

        uint256 _userRatio;
        if (params.amount1Desired > 0 && params.amount0Desired <= type(uint256).max / PRECISION) {
            _userRatio = (params.amount0Desired * PRECISION) / params.amount1Desired;
        } else {
            _userRatio = type(uint256).max;
        }
        
        bool _success;
        if (_userRatio > _rangeRatio) {
            // Swap token0 to token1
            _success = _executeSwap(
                poolAddress,
                true,
                params.amount0Desired, // Initial guess
                params,
                _rangeRatio
            );
        } else if (_userRatio < _rangeRatio && _rangeRatio > 0) {
            // Swap token1 to token0
            _success = _executeSwap(
                poolAddress,
                false,
                params.amount1Desired, // Initial guess
                params,
                _optimalAmount0 > 0 && _optimalAmount1 <= type(uint256).max / PRECISION
                    ? _optimalAmount1 * PRECISION / _optimalAmount0
                    : type(uint256).max
            );
        }

        if (_success == true) {
            // Mint position or increase liquidity and refund
            if (params.tokenId == 0) {
                // Mint new position
                (_tokenId, , , ) = IPositionManager(positionManager).mint(
                    IPositionManager.MintParams({
                        token0: params.token0,
                        token1: params.token1,
                        fee: params.feeTier,
                        tickLower: params.tickLower,
                        tickUpper: params.tickUpper,
                        amount0Desired: IERC20(params.token0).balanceOf(address(this)), // Use the whole amount of token0
                        amount1Desired: IERC20(params.token1).balanceOf(address(this)), // Use the whole amount of token1
                        amount0Min: 0,
                        amount1Min: 0,
                        recipient: params.user, // Mint to user
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
        }

        // Refund remaining tokens
        _remaining0 = IERC20(params.token0).balanceOf(address(this)); // Remaining amount of token0
        _remaining1 = IERC20(params.token1).balanceOf(address(this)); // Remaining amount of token1
        
        if (_remaining0 > 0) IERC20(params.token0).safeTransfer(msg.sender, _remaining0);
        if (_remaining1 > 0) IERC20(params.token1).safeTransfer(msg.sender, _remaining1);
        
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
        address _poolAddress,
        bool _swapToken0ToToken1,
        uint256 _initialGuess,
        AddLiquidityParams memory params,
        uint256 _targetRatio
    ) private returns (bool _success) {

        uint256 _neededSwapAmount;
        uint256 _receivedAmount;
        ISwapRouter.ExactInputSingleParams memory _params;

        uint160 _sqrtPrice = getSqrtPrice(params.token0, params.token1, params.feeTier);

        // Get total amounts of token0 and token1 in the current range
        (uint256 _totalAmount0, uint256 _totalAmount1) = _LiquidityAmounts.getAmountsForLiquidity(
            _sqrtPrice,
            _TickMath.getSqrtPriceAtTick(params.tickLower),
            _TickMath.getSqrtPriceAtTick(params.tickUpper),
            IUniswapV3PoolState(_poolAddress).liquidity() // Total liquidity in the current range
        );

        emit TotalAmounts(
            _totalAmount0,
            _totalAmount1
        );

        if (_swapToken0ToToken1) {
            // Swap token0 to token1
            _neededSwapAmount = _findOptimalSwapAmount(
                _initialGuess,
                params, 
                _targetRatio,
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
                _initialGuess,
                _paramsInverted,
                _targetRatio,
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
        }
        
        if (_neededSwapAmount > 0) {
            try ISwapRouter(exchangeRouter).exactInputSingle(_params) returns (uint256 __receivedAmount) {
                _receivedAmount = __receivedAmount;
                _success = true;
            } catch {
                emit SwapFailed(
                    _params
                );
                _success = false;
            }
        }
        if (_success == true) {
            emit ExecuteSwap(
                _swapToken0ToToken1,
                _neededSwapAmount,
                _receivedAmount,
                _totalAmount0,
                _totalAmount1
            );
        }
    }

    /// @notice Estimate how much of tokenIn to swap so that
    ///         (in - x)/(out + y) ≈ targetRatio
    /// @dev This function uses a binary search to find the optimal swap amount.
    function _findOptimalSwapAmount(
        uint256 _initialGuess,
        AddLiquidityParams memory params,
        uint256 _targetRatio,
        uint256 _totalAmount0,
        uint256 _totalAmount1
    ) internal returns (uint256) {
        if (params.amount0Desired == 0) return 0; // We cannot swap 0 tokens

        uint256 newUserRatio = params.amount1Desired > 0 && params.amount0Desired <= type(uint256).max / PRECISION
            ? (params.amount0Desired * PRECISION) / params.amount1Desired
            : type(uint256).max;

        // Quick ratio check
        if (newUserRatio == _targetRatio) return 0;

        uint256 bestGuess = 0;
        uint256 bestDiffPercentage = type(uint256).max;
        
        // Start with larger steps and then reduce
        uint256 step = _initialGuess > 8 ? _initialGuess / 8 : 1; // Start with 1/8 of initial guess, minimum 1
        uint256 currentGuess = _initialGuess;

        uint256 newTargetRatio;
        uint256 y;
        
        for (uint8 i = 0; i < MAX_ITERS; ++i) {
            // Try currentGuess position
            if (currentGuess == 0) {
                y = 0;
            } else {
                y = _getQuoteResult(params.token0, params.token1, params.feeTier, currentGuess);
            }
            
            // New ratio after swap
            newUserRatio = (params.amount1Desired + y) > 0 && (params.amount0Desired - currentGuess) <= type(uint256).max / PRECISION
                ? ((params.amount0Desired - currentGuess) * PRECISION) / (params.amount1Desired + y)
                : type(uint256).max;

            // New pool ratio after swap
            newTargetRatio = (_totalAmount1 - y) > 0 && (_totalAmount0 + currentGuess) <= type(uint256).max / PRECISION
                ? ((_totalAmount0 + currentGuess) * PRECISION) / (_totalAmount1 - y)
                : type(uint256).max;

            // Difference between new user ratio and new pool ratio
            uint256 diffPercentage = newTargetRatio > 0 
                ? (newUserRatio > newTargetRatio 
                    ? ((newUserRatio - newTargetRatio) <= type(uint256).max / ONE_HUNDRED_PERCENT
                        ? (newUserRatio - newTargetRatio) * ONE_HUNDRED_PERCENT / newTargetRatio
                        : type(uint256).max)
                    : ((newTargetRatio - newUserRatio) <= type(uint256).max / ONE_HUNDRED_PERCENT
                        ? (newTargetRatio - newUserRatio) * ONE_HUNDRED_PERCENT / newTargetRatio
                        : type(uint256).max))
                : type(uint256).max;

            if (diffPercentage < bestDiffPercentage) {
                bestDiffPercentage = diffPercentage;
                bestGuess = currentGuess;
            } else {
                // Reduce step size exponentially
                step = step / 2;
                if (step == 0) break;
            }
            
            // If difference is less than tolerance, return the best guess
            if (diffPercentage <= TOLERANCE) {
                emit FindOptimalSwapAmount(
                    newUserRatio,
                    newTargetRatio,
                    _targetRatio
                );
                return bestGuess;
            }
            
            // Determine direction and step
            if (newUserRatio > newTargetRatio) {
                // Need to swap more (increase currentGuess)
                currentGuess = currentGuess + step;
                // To avoid swapping more than the amount of token0, set maximum to amount0Desired
                if (currentGuess > params.amount0Desired) {
                    currentGuess = params.amount0Desired;
                }
            } else {
                // Need to swap less (decrease currentGuess)
                // To avoid swapping 0 tokens, set minimum to 1
                currentGuess = currentGuess > step ? currentGuess - step : 1;
            }
        }

        emit FindOptimalSwapAmount(
            newUserRatio,
            newTargetRatio,
            _targetRatio
        );
        
        return bestGuess;
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

    event GetQuoteResult(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut
    );

    function _binarySearch(
        address _tokenIn,
        address _tokenOut,
        uint24 _fee,
        uint256 amountIn,
        uint256 amountOut,
        uint256 targetRatio
    ) private returns (uint256) {

    }

    event TotalAmounts(
        uint256 _totalAmount0,
        uint256 _totalAmount1
    );
}