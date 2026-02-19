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
    mapping(bytes32 => mapping(
        address => mapping(
            address => mapping(
                uint => mapping(
                    uint => mapping(
                        uint => address
                    )
                )
            )
        )
    )) public fillerAddress;
    // ^ [txId][recipient][token][amount][chainId][bridgePercentageFee] to filler address
    uint constant REGULAR_SLIPPAGE = 1500; // Not used

    address public acrossAdmin;

    uint public lockerPercentageFee;

    address public rewardDistributor;

    mapping(address => mapping(uint => address)) public bridgeTokenMapping;

    mapping(bytes32 => uint) public finalAmount;
    // ^ txId to final amount

    mapping(address => bool) public isTeleporter;

    mapping(bytes8 => mapping(uint => bytes32)) public bridgeTokenIDMapping; // Token ID => Chain ID => Token address
    mapping(bytes32 => ccExchangeRequestV2) internal ccExchangeRequestsV2; // txId => ccExchangeRequestV2
    mapping(bytes8 => address) public _deprecatedIntermediaryTokenMapping; // deprecated - do not use

    mapping(bytes32 => mapping(
        bytes32 => mapping(
            address => mapping(
                uint => mapping(
                    uint => mapping(
                        uint => address
                    )
                )
            )
        )
    )) public fillerAddressV2;
    // ^ [txId][recipient][token][amount][chainId][bridgePercentageFee] to filler address
    mapping(address => uint256) public inputTokenDecimalsOnDestinationChain; // input token's address on the current chain => decimals on the destination chain (added for USDT and USDC which have different decimals on the BNB chain)

    address public newLogicContract; // Address of the extension logic contract for fallback delegation

    // --- New variables for universal router (feature branch) ---
    mapping(uint256 => bytes32) public destConnectorProxyMapping; // destination real chain id => destination chain connector proxy address

    mapping(bytes8 => mapping(uint256 => bytes32)) public intermediaryTokenMapping; // output token ID => chain ID => intermediary token address on this chain ID

    /// @dev Dynamic locker fee for wrap direction
    /// destChainId => destToken => thirdPartyId => tierIndex => fee percentage
    /// destToken is bytes32 — resolved via bridgeTokenIDMapping[tokenIDs[1]][destRealChainId]
    /// Fee of 0 means "not set, use default lockerPercentageFee"
    mapping(uint => mapping(bytes32 => mapping(uint => mapping(uint => uint)))) public dynamicLockerFee;

    /// @dev Sorted upper bounds for amount tiers (exclusive). Empty = single tier.
    uint[] public feeTierBoundaries;
}
