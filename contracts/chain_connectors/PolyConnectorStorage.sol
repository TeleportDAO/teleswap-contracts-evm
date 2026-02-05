// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IPolyConnector.sol";

abstract contract PolyConnectorStorage is IPolyConnector {
    struct Bid {
        uint256 amount;
        address token;
    }

    struct UserScriptData {
        bytes userScript;
        ScriptTypes scriptType;
    }

    address public constant ETH_ADDR =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    address public override lockersProxy;
    address public override burnRouterProxy;
    address public override across;
    mapping(address => mapping(uint256 => mapping(address => uint256)))
        public
        override failedReqs;
    // ^ Mapping from [user][chainId][token] to amount
    mapping(address => mapping(uint256 => mapping(uint256 => mapping(address => uint256))))
        public
        override newFailedReqs;
    // ^ Mapping from [user][chainId][reqId][token] to amount

    // New variables for RUNE
    address public override runeRouterProxy;

    address public acrossAdmin;

    uint256 public gasLimit;
    mapping(address => mapping(uint => address)) public bridgeTokenMapping;

    mapping(
        bytes32 => mapping(
            uint256 => mapping(
                uint256 => mapping(
                    address => uint256
                )
            )
        )
    ) public newFailedReqsV2;
    // ^ Mapping from [refundAddress][chainId][reqId][token] to amount

    // Chain ID of the current chain (used for decimal conversion)
    uint256 public chainId;

    // Mapping from token address to its decimals on destination chains
    // Used for handling decimal differences (e.g., USDT: 18 on BSC, 6 on other chains)
    mapping(address => uint256) public tokenDecimalsOnDestinationChain;

    // Mapping to track processed requests to prevent double-fill from Across
    // chainId => uniqueCounter => processed
    mapping(uint256 => mapping(uint256 => bool)) public processedRequests;
}
