// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IBurnRouter.sol";

abstract contract BurnRouterStorageV2 is IBurnRouter {
    mapping(uint => uint) public thirdPartyFee;
    mapping(uint => address) public thirdPartyAddress;
    address public wrappedNativeToken;
    uint constant public DUST_SATOSHI_AMOUNT = 1000;
}
