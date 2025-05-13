// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/ICcTransferRouter.sol";

abstract contract CcTransferRouterStorageV2 {

    // Third party
    mapping(uint => uint) public thirdPartyFee;
    mapping(uint => address) public thirdPartyAddress;

    mapping(bytes32 => uint) public thirdParty;

    uint public lockerPercentageFee;
    address public rewardDistributor;
}