// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IEthConnector.sol";

abstract contract EthConnectorStorage is IEthConnector {
    
    uint constant public ONE_HUNDRED_PERCENT = 10000;
    address constant public ETH_ADDR = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // ^ Native token representative

    address public across; // Across bridge
    address public targetChainConnectorProxy;
    address public exchangeConnector;
    uint public targetChainId;
    address public wrappedNativeToken;
    uint public uniqueCounter;
    uint256 public currChainId;
    uint256 public unwrapFee;
    address public acrossAdmin;
    mapping(address => mapping(uint => address)) public bridgeTokenMapping;
    address public stargate;
    mapping(address => BridgeConnectorData) public bridgeConnectorMapping; // exchangeConnector => BridgeConnectorData
mapping(address => mapping(uint256 => uint256)) public outputTokenDecimalsOnDestinationChain; // output token's address on the destination chain => destination chain ID => decimals on the destination chain (added for USDT and USDC which have different decimals on the BNB chain)
    uint256 public gasLimit;
    mapping(address => mapping(address => mapping(uint256 => mapping(address => uint256)))) public newFailedSwapBackAndRefundReqs; // [refundAddress][inputToken][uniqueCounter][intermediaryToken] => intermediaryTokenAmount
    mapping(address => mapping(uint256 => mapping(bytes32 => mapping(address => uint256)))) public newFailedWrapAndSwapReqs; // [targetAddress][intermediaryChainId][bitcoinTxId][intermediaryToken] => intermediaryTokenAmount
}