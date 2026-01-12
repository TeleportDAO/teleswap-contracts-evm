// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract YieldFarmingStorageV2 {
    mapping(address => uint[]) public rewardPerDay;
    mapping(address => uint[]) public rewardPerDayUpdateTime;
    address public TST;
    uint public totalClaimedReward;
}
