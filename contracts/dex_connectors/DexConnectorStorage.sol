// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IDexConnector.sol";

abstract contract DexConnectorStorage is IDexConnector {
    string public override name;
    address public override wrappedNativeToken;
    address public override exchangeRouter;
    address public override liquidityPoolFactory;
    address public quoterAddress;
    mapping(address => mapping(address => uint24)) public feeTier;

    // Additional storage variables for V3 position management
    address public positionManager;

    uint256 public MAX_ITERS;
    uint256 public TOLERANCE;
    uint256 public constant ONE_HUNDRED_PERCENT = 10000; // 100%
}
