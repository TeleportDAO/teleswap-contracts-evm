// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IBurnRouter.sol";

abstract contract BurnRouterStorageV2 is IBurnRouter {
    mapping(uint => uint) public thirdPartyFee;
    mapping(uint => address) public thirdPartyAddress;
    address public wrappedNativeToken;
    uint constant public DUST_SATOSHI_AMOUNT = 1000;
    uint public lockerPercentageFee;
    address public rewardDistributor;

    /// @dev Dynamic locker fee for unwrap direction
    /// sourceChainId => sourceToken => thirdPartyId => tierIndex => fee percentage
    /// sourceToken is bytes32 — the token representation on the source chain,
    /// resolved via bridgeTokenMappingUniversal[_tokenSent][chainId] in PolyConnector.
    /// Fee of 0 means "not set, use default lockerPercentageFee"
    mapping(uint => mapping(bytes32 => mapping(uint => mapping(uint => uint)))) public dynamicLockerFee;

    /// @dev Sorted upper bounds for amount tiers (exclusive). Empty = single tier.
    uint[] public feeTierBoundaries;
}
