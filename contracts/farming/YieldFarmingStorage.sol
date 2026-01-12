// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract YieldFarmingStorage {
    mapping(address => uint) public lockTime;
    mapping(address => uint) public unlockRequestDeadline;
    mapping(bytes32 => uint8) public unlockRequestState;

    mapping(address => uint) internal _interestPerDay; // Deprecated
    mapping(address => uint) internal _overallCoefficient;
    mapping(address => uint) internal _lastUpdateTime; // Last time overallCoefficient was updated
    mapping(address => uint) public stakedTotalSupply;
    mapping(address => bool) public isLpTokenSupported;
    mapping(address => bool) internal _isStopped;
    mapping(address => uint) internal _stopTime;
    mapping(address => mapping(address => uint256)) internal _lastCoefficient;
    mapping(address => mapping(address => uint256)) internal _stakedBalance;
    mapping(address => mapping(address => uint256)) internal _rewardBalance;
    // NOTE: DON'T ADD ANY VARIABLES HERE, ADD THEM TO YieldFarmingStorageV2
}
