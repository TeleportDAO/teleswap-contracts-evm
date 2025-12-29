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
    ) public newFailedUniversalSwapAndUnwrapReqs;
    // ^ Mapping from [refundAddress][chainId][reqId][token] to amount

    mapping(
        bytes32 => mapping(
            uint256 => mapping(
                bytes32 => mapping(
                    address => uint256
                )
            )
        )
    ) public newFailedRefundBTCReqs;
    // ^ Mapping from [refundAddress][chainId][bitcoinTxId][token] to amount
    uint256 public currChainId;
    mapping(address => mapping(uint256 => bytes32)) public bridgeTokenMappingUniversal; // ^ Mapping from [source token][destination chain id] to destination token
    mapping(uint256 => address) public bridgeConnectorMapping; // ^ Mapping from [destination chain id] to bridge connector address
}
