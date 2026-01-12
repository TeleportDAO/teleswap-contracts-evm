// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;
import "./interfaces/ITstStaking.sol";

abstract contract TstStakingStorage is ITstStaking {
    uint public constant MAX_STAKING_PERCENTAGE = 10000;
    uint public constant PERCISION = 1e27;
    // ^^ This is used to avoid percision loss (since rewardPerToken is a fraction)
    mapping(address => mapping(address => StakingPosition))
        public stakingPosition;
    // ^^ [locker][user] => staking position
    mapping(address => StakingInfo) public stakingInfo;
    // ^^ [locker] => staking info
    address public override TST;
    mapping(address => bool) public override isController;
}
