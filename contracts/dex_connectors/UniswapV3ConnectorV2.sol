// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./DexConnectorStorage.sol";
import "./interfaces/IPositionManager.sol";
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

/// @notice SwapRouter02 interface — same functions as V1 ISwapRouter but without `deadline` in param structs
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactOutputParams {
        bytes path;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn);
    function exactOutput(ExactOutputParams calldata params) external payable returns (uint256 amountIn);
}

contract UniswapV3ConnectorV2 is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    DexConnectorStorage
{
    using SafeERC20 for IERC20;

    modifier nonZeroAddress(address _address) {
        require(_address != address(0), "UniswapV3ConnectorV2: zero address");
        _;
    }

    /// @notice This contract is used for interacting with UniswapV3 SwapRouter02
    /// @param _name Name of the underlying DEX
    /// @param _exchangeRouter Address of the SwapRouter02 contract
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

    // ============ Public Getters ============

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

    /// @notice Return true if the exchange path is valid
    function isPathValid(
        address[] memory _path
    ) public view override returns (bool _result) {
        address liquidityPool;

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
        (bool success, bytes memory data) = poolAddress.staticcall(
            abi.encodeWithSignature("slot0()")
        );
        require(success, "Failed to get slot0");

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

    // ============ Public Setters ============

    /// @notice Setter for wrapped native token
    function setWrappedNativeToken() external override onlyOwner {
        wrappedNativeToken = IPeripheryImmutableState(exchangeRouter).WETH9();
    }

    /// @notice Setter for exchange router
    function setExchangeRouter(
        address _exchangeRouter
    ) external override nonZeroAddress(_exchangeRouter) onlyOwner {
        exchangeRouter = _exchangeRouter;
        liquidityPoolFactory = IPeripheryImmutableState(exchangeRouter).factory();
    }

    /// @notice Setter for liquidity pool factory
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

    /// @notice Emergency withdrawal function to withdraw tokens by owner
    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyOwner nonZeroAddress(_to) {
        if (_token == address(0)) {
            uint256 balance = address(this).balance;
            uint256 amount = _amount == 0 ? balance : _amount;
            (bool success, ) = _to.call{value: amount}("");
            require(success, "UniswapV3ConnectorV2: transfer failed");
        } else {
            uint256 balance = IERC20(_token).balanceOf(address(this));
            uint256 amount = _amount == 0 ? balance : _amount;
            require(amount <= balance, "UniswapV3ConnectorV2: insufficient balance");
            IERC20(_token).safeTransfer(_to, amount);
        }
    }

    function renounceOwnership() public virtual override onlyOwner {}

    // ============ Public Business Logic ============

    /// @notice Exchange input token for output token through SwapRouter02
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
                _amount = ISwapRouter02(exchangeRouter).exactInput(
                    ISwapRouter02.ExactInputParams({
                        path: convertedPath(_path),
                        recipient: _to,
                        amountIn: neededInputAmount,
                        amountOutMinimum: _outputAmount
                    })
                );
                _amounts[0] = neededInputAmount;
                _amounts[1] = _amount;
            }

            if (_isFixedToken == false) {
                _amount = ISwapRouter02(exchangeRouter).exactOutput(
                    ISwapRouter02.ExactOutputParams({
                        path: convertedPathReversed(_path),
                        recipient: _to,
                        amountOut: _outputAmount,
                        amountInMaximum: neededInputAmount
                    })
                );
                _amounts[0] = _amount;
                _amounts[1] = _outputAmount;
            }
            emit Swap(_path, _amounts, _to);
        }
    }

    /// @notice Zap tokens into a Uniswap V3 position in one call
    function swapAndAddLiquidity(
        AddLiquidityParams memory params
    ) external nonReentrant returns (
        uint256 _tokenId,
        uint256 _remaining0,
        uint256 _remaining1
    ) {
        require(gasleft() >= MIN_GAS_RESERVE, "UniswapV3ConnectorV2: low gas");

        address poolAddress = IUniswapV3Factory(liquidityPoolFactory).getPool(
            params.token0,
            params.token1,
            params.feeTier
        );

        require(
            params.amount0Desired > 0 || params.amount1Desired > 0,
            "UniswapV3ConnectorV2: both amounts are zero"
        );

        if (IUniswapV3PoolImmutables(poolAddress).token0() != params.token0) {
            uint256 _tempAmount = params.amount0Desired;
            address _tempToken = params.token0;
            params.token0 = params.token1;
            params.token1 = _tempToken;
            params.amount0Desired = params.amount1Desired;
            params.amount1Desired = _tempAmount;
        }

        if (params.tokenId != 0) {
            (
                , , , ,
                uint24 existingFee,
                int24 existingTickLower,
                int24 existingTickUpper,
                , , , ,
            ) = IPositionManager(positionManager).positions(params.tokenId);

            require(existingFee == params.feeTier, "UniswapV3ConnectorV2: Fee tier mismatch");
            require(existingTickLower == params.tickLower, "UniswapV3ConnectorV2: Tick lower mismatch");
            require(existingTickUpper == params.tickUpper, "UniswapV3ConnectorV2: Tick upper mismatch");
        }

        IERC20(params.token0).safeTransferFrom(msg.sender, address(this), params.amount0Desired);
        IERC20(params.token1).safeTransferFrom(msg.sender, address(this), params.amount1Desired);

        (uint256 _totalAmount0, uint256 _totalAmount1) = _LiquidityAmounts.getAmountsForLiquidity(
            getSqrtPrice(params.token0, params.token1, params.feeTier),
            _TickMath.getSqrtPriceAtTick(params.tickLower),
            _TickMath.getSqrtPriceAtTick(params.tickUpper),
            IUniswapV3PoolState(poolAddress).liquidity()
        );

        uint256 _rangeRatio = _totalAmount1 > 0 && _totalAmount0 <= type(uint256).max / PRECISION
            ? (_totalAmount0 * PRECISION) / _totalAmount1
            : type(uint256).max;

        uint256 _userRatio;
        if (params.amount1Desired > 0 && params.amount0Desired <= type(uint256).max / PRECISION) {
            _userRatio = (params.amount0Desired * PRECISION) / params.amount1Desired;
        } else {
            _userRatio = type(uint256).max;
        }

        if (_userRatio > _rangeRatio) {
            _executeSwap(true, params, _totalAmount0, _totalAmount1);
        } else if (_userRatio < _rangeRatio) {
            _executeSwap(false, params, _totalAmount0, _totalAmount1);
        }

        IERC20(params.token0).approve(positionManager, IERC20(params.token0).balanceOf(address(this)));
        IERC20(params.token1).approve(positionManager, IERC20(params.token1).balanceOf(address(this)));

        if (params.tokenId == 0) {
            try IPositionManager(positionManager).mint(
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
            ) returns (uint256 tokenId, uint128, uint256, uint256) {
                _tokenId = tokenId;
            } catch {
                _tokenId = 0;
            }
        } else {
            _tokenId = params.tokenId;
            try IPositionManager(positionManager).increaseLiquidity(
                IPositionManager.IncreaseLiquidityParams({
                    tokenId: params.tokenId,
                    amount0Desired: IERC20(params.token0).balanceOf(address(this)),
                    amount1Desired: IERC20(params.token1).balanceOf(address(this)),
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            ) returns (uint128, uint256, uint256) {
            } catch {
                _tokenId = 0;
            }
        }

        _remaining0 = IERC20(params.token0).balanceOf(address(this));
        _remaining1 = IERC20(params.token1).balanceOf(address(this));

        if (_remaining0 > 0) {
            IERC20(params.token0).safeTransfer(msg.sender, _remaining0);
        }
        if (_remaining1 > 0) {
            IERC20(params.token1).safeTransfer(msg.sender, _remaining1);
        }

        emit SwapAndAddLiquidity(params, _remaining0, _remaining1, _tokenId);
    }

    // ============ Private Functions ============

    /// @notice Check if exchanging is possible or not
    function _checkExchangeConditions(
        uint256 _inputAmount,
        uint256 _outputAmount,
        address[] memory _path,
        uint256 _deadline,
        bool _isFixedToken
    ) private returns (bool, uint) {
        if (_deadline < block.timestamp) {
            return (false, 0);
        }

        if (_isFixedToken == true) {
            (bool success, uint outputResult) = getExactInput(_path, _inputAmount);
            if (success == false) {
                return (false, 0);
            }
            if (_outputAmount > outputResult) {
                return (false, 0);
            }
            return (true, _inputAmount);
        } else {
            (bool success, uint inputResult) = getExactOutput(_path, _outputAmount);
            if (success == false) {
                return (false, 0);
            }
            if (_inputAmount < inputResult) {
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
        ISwapRouter02.ExactInputSingleParams memory _params;

        if (_swapToken0ToToken1) {
            _neededSwapAmount = _findOptimalSwapAmount(
                params,
                _totalAmount0,
                _totalAmount1
            );

            _params = ISwapRouter02.ExactInputSingleParams({
                tokenIn: params.token0,
                tokenOut: params.token1,
                fee: params.feeTier,
                recipient: address(this),
                amountIn: _neededSwapAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

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
            _neededSwapAmount = _findOptimalSwapAmount(
                _paramsInverted,
                _totalAmount1,
                _totalAmount0
            );

            _params = ISwapRouter02.ExactInputSingleParams({
                tokenIn: params.token1,
                tokenOut: params.token0,
                fee: params.feeTier,
                recipient: address(this),
                amountIn: _neededSwapAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

            IERC20(params.token1).approve(exchangeRouter, _neededSwapAmount);
        }

        if (_neededSwapAmount > 0) {
            try ISwapRouter02(exchangeRouter).exactInputSingle(_params) returns (uint256 __receivedAmount) {
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
    function _findOptimalSwapAmount(
        AddLiquidityParams memory params,
        uint256 _totalAmount0,
        uint256 _totalAmount1
    ) internal returns (uint256 bestGuess) {

        uint256 newUserRatio = params.amount1Desired > 0 &&
            params.amount0Desired <= type(uint256).max / PRECISION
                ? (params.amount0Desired * PRECISION) / params.amount1Desired
                : type(uint256).max;

        uint256 bestDiffPercentage = type(uint256).max;

        uint256 lo = 0;
        uint256 hi = params.amount0Desired;

        uint256 newTargetRatio;
        uint256 y;

        for (uint8 i = 0; i < MAX_ITERS && lo <= hi; ++i) {

            uint256 mid = (lo + hi) >> 1;

            if (mid == 0) {
                y = 0;
            } else {
                y = _getQuoteResult(params.token0, params.token1, params.feeTier, mid);
            }

            newUserRatio =
                ((y <= type(uint256).max - params.amount1Desired)
                    ? (params.amount1Desired + y)
                    : type(uint256).max) > 0
                &&
                (params.amount0Desired >= mid ? (params.amount0Desired - mid) : 0) <= type(uint256).max / PRECISION
                    ? (((params.amount0Desired >= mid ? (params.amount0Desired - mid) : 0) * PRECISION) /
                    ((y <= type(uint256).max - params.amount1Desired)
                            ? (params.amount1Desired + y)
                            : type(uint256).max))
                    : type(uint256).max;

            newTargetRatio =
                (_totalAmount1 > y ? (_totalAmount1 - y) : 0) > 0
                &&
                (_totalAmount0 <= type(uint256).max - mid) &&
                ((_totalAmount0 + mid) <= type(uint256).max / PRECISION)
                    ? (((_totalAmount0 + mid) * PRECISION) /
                    (_totalAmount1 > y ? (_totalAmount1 - y) : 0))
                    : type(uint256).max;

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
                bestGuess = mid;
            }

            if (diffPercentage <= TOLERANCE) {
                emit FindOptimalSwapAmount(bestGuess, newUserRatio, newTargetRatio);
                return bestGuess;
            }

            if (newUserRatio > newTargetRatio) {
                lo = mid + 1;
            } else {
                if (mid == 0) break;
                hi = mid - 1;
            }
        }

        emit FindOptimalSwapAmount(bestGuess, newUserRatio, newTargetRatio);
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
    }
}
