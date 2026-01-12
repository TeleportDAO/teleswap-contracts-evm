// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface ITstStaking {
    // Structs

    struct StakingPosition {
        uint stakedAmount;
        uint unstakedAmount;
        uint unstakingTime;
        uint claimedReward;
        uint initRewardPerToken;
        address controller;
    }

    struct StakingInfo {
        uint stakingPercentage;
        address rewardToken;
        uint totalStakedAmount;
        uint totalReward;
        uint totalClaimedReward;
        uint currentRewardPerToken;
        uint stakingPeriod;
    }

    // Events

    event LockerRegisteredForStaking(
        address indexed locker,
        uint stakingPercentage,
        address indexed rewardToken,
        uint stakingPeriod
    );

    event TstStaked(
        address caller,
        address indexed locker,
        address indexed rewardToken,
        uint amount,
        address indexed user,
        uint unstakingTime,
        uint totalStakedAmount
    );

    event RewardClaimed(
        address caller,
        address indexed locker,
        address indexed rewardToken,
        address indexed user,
        uint amount
    );

    event RewardDeposited(
        address sender,
        address indexed locker,
        address indexed rewardToken,
        uint totalAmount,
        uint rewardAmount
    );

    event TstUnstaked(
        address caller,
        address indexed locker,
        uint amount,
        address indexed user
    );

    // View-only Functions

    function getStakingPosition(
        address _locker,
        address _user
    ) external view returns (uint, uint, uint, uint);

    function getUnclaimedReward(
        address _locker,
        address _user
    ) external view returns (uint);

    function TST() external view returns (address);

    function isController(address) external view returns (bool);

    // State-changing functions

    function setTst(address _TST) external;

    function addController(address _controller) external;

    function removeController(address _controller) external;

    function registerLocker(
        address _locker,
        uint _stakingPercentage,
        address _rewardToken,
        uint _stakingPeriod
    ) external;

    function updateRegisteredLocker(
        address _locker,
        uint _stakingPercentage,
        uint _stakingPeriod
    ) external;

    function stake(address _locker, uint _amount, address _user) external;

    function claimReward(address _locker, address _user) external;

    function unstake(address _locker, address _user) external;

    function depositReward(address _locker, uint _amount) external;

    function onOFTReceived(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        uint64 _nonce,
        bytes32 _from,
        uint _amount,
        bytes calldata _payload
    ) external;
}
