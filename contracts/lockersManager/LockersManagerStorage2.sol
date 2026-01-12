// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/ILockersManager.sol";

abstract contract LockersManagerStorage2 is ILockersManager {
    mapping(address => uint) public collateralDecimal;
    mapping(address => address) public lockerCollateralToken;

    // A Locker with smaller reliability factor is more reliable
    mapping(address => uint) public lockerReliabilityFactor;

    address public rewardDistributor;
}
