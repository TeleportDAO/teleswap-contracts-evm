// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

interface IDexConnector {

    // Events
    
    event Swap(address[] path, uint[] amounts, address receiver);
    
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
        uint256 _neededSwapAmount,
        uint256 _newUserRatio,
        uint256 _newTargetRatio
    );

    // Structs
    
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

    // Read-only functions

    function name() external view returns (string memory);

    function exchangeRouter() external view returns (address);

    function liquidityPoolFactory() external view returns (address);

    function wrappedNativeToken() external view returns (address);

    function getInputAmount(
        uint _outputAmount,
        address _inputToken,
        address _outputToken
    ) external view returns (bool, uint);

    function getOutputAmount(
        uint _inputAmount,
        address _inputToken,
        address _outputToken
    ) external view returns (bool, uint);

    // State-changing functions

    function setExchangeRouter(address _exchangeRouter) external;

    function setLiquidityPoolFactory() external;

    function setWrappedNativeToken() external;

    function swap(
        uint256 _inputAmount,
        uint256 _outputAmount,
        address[] memory _path,
        address _to,
        uint256 _deadline,
        bool _isFixedToken
    ) external returns (bool, uint[] memory);

    function isPathValid(address[] memory _path) external view returns(bool);
}