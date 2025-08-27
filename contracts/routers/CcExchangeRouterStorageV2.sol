// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/ICcExchangeRouter.sol";

abstract contract CcExchangeRouterStorageV2 is ICcExchangeRouter {
    // Constants
    uint constant MAX_BRIDGE_FEE = 10 ** 18;
    address constant NATIVE_TOKEN = address(1);

    // Removed variables
    uint one;
    mapping(bytes32 => mapping(address => FillerData)) two;
    mapping(bytes32 => mapping(address => PrefixFillSum)) three;
    mapping(bytes32 => FillData) four;

    // New variables (Ethereum support)

    mapping(uint => mapping(address => bool)) public override isTokenSupported;
    // ^ Mapping to store supported exchange tokens
    mapping(uint => bool) public override isChainSupported;
    // ^ Mapping to store supported chainIds
    mapping(bytes32 => extendedCcExchangeRequest)
        public extendedCcExchangeRequests;

    address public override across;
    address public wrappedNativeToken;
    address public override burnRouter;

    mapping(uint => chainIdStruct) public chainIdMapping;

    // New variables (third party)

    // Other applications can integrate with TeleSwap.
    // ID will be assigned to them
    // They will receive a third party fee for each transaction that is sent by them
    // This fee will be send to their third party address

    mapping(uint => uint) public thirdPartyFee;
    mapping(uint => address) public thirdPartyAddress;

    // New variables (filler)
    mapping(bytes32 => mapping(address => mapping(address => mapping(uint => mapping(uint => mapping(uint => address))))))
        public fillerAddress;
    // ^ [txId][recipient][token][amount][chainId][bridgePercentageFee] to filler address
    uint constant REGULAR_SLIPPAGE = 1500; // Not used

    address public acrossAdmin;

    uint public lockerPercentageFee;

    address public rewardDistributor;

    mapping(address => mapping(uint => address)) public bridgeTokenMapping;

    mapping(bytes32 => uint) public finalAmount;
    // ^ txId to final amount

    mapping(address => bool) public isTeleporter;
}
