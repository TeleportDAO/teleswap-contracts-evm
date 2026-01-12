// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/ILockersManager.sol";

abstract contract LockersManagerStorage is ILockersManager {
    // Constants
    uint256 public constant ONE_HUNDRED_PERCENT = 10000;
    uint256 public constant HEALTH_FACTOR = 10000;
    uint256 public constant UPPER_HEALTH_FACTOR = 12500;
    uint256 public constant MAX_LOCKER_FEE = 10000;
    uint256 public constant INACTIVATION_DELAY = 345600; // 4 days (it should be greater than MAX_FINALIZATION_PARAMETER)
    uint256 public constant NATIVE_TOKEN_DECIMAL = 18;
    address public constant NATIVE_TOKEN = address(1);

    // Public variables
    address public override TeleportSystemToken;
    address public override teleBTC;
    address public override burnRouter;
    address public override exchangeConnector;
    address public override priceOracle;

    uint256 public override minRequiredTSTLockedAmount;
    uint256 public override minRequiredTNTLockedAmount;
    uint256 public override lockerPercentageFee;
    uint256 public override collateralRatio;
    uint256 public override liquidationRatio;
    uint256 public override priceWithDiscountRatio;
    uint256 public override totalNumberOfCandidates;
    uint256 public override totalNumberOfLockers;

    mapping(address => locker) public lockersMapping; // locker's target address -> locker structure
    mapping(address => uint256) public lockerInactivationTimestamp;
    mapping(address => bool) public lockerLeavingAcceptance;
    mapping(bytes => address) public override getLockerTargetAddress; // locker's locking script -> locker's target address
    mapping(address => bool) public override minters;
    mapping(address => bool) public override burners;

    lockersLibConstants public libConstants;
    lockersLibParam public libParams;
}
