// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IYieldFarmingLogic {
    // Events
    event UnstakeLpTokenRequest(
        address account,
        address token,
        uint currentBalance,
        uint amount,
        uint time,
        bytes32 tag
    );

    event LpTokenStaked(address account, address token, uint amount);

    event LpTokenUnstaked(
        address account,
        address token,
        uint amount,
        bytes32 tag
    );

    event NewLockTime(address token, uint oldMinWaitTime, uint newMinWaitTime);

    event NewUnlockRequestDeadline(
        address token,
        uint oldUnlockRequestDeadline,
        uint newUnlockRequestDeadline
    );

    event RewardUpdated(
        address token,
        uint oldRewardPerDay,
        uint newRewardPerDay,
        uint updateTime
    );

    event RewardClaimed(address account, address token, uint amount);

    // Getters

    function currentRewardPerDay(address _token) external view returns (uint);

    function totalRewardInPeriod(
        address token,
        uint start,
        uint end
    ) external view returns (uint);

    function totalRewardFromStart(address _token) external view returns (uint);

    function balanceOf(
        address token,
        address account
    ) external view returns (uint);

    function getRewardOfUser(
        address token,
        address account
    ) external view returns (uint);

    function getAvailableTst() external view returns (uint);

    // Setters

    function setUnlockRequestDeadline(
        address token,
        uint _unlockRequestDeadline
    ) external;

    function setLockTime(address token, uint _minWaitTime) external;

    function setTST(address _TST) external;

    function updateRewardPerDay(address _token, uint _newRewardPerDay) external;

    function pause(address token) external;

    function unpause(address token) external;

    function addLpToken(
        uint _perDayInterest,
        address _token,
        uint _minWaitTime,
        uint _unlockRequestDeadline
    ) external;

    function stakeLpToken(address _token, uint _amount) external;

    function instantUnstakeLpToken(address token, uint amount) external;

    function claimReward(address _token) external;

    function requestToUnstakeLpToken(
        address token,
        uint amount
    ) external returns (bytes32);

    function unstakeLpToken(
        address token,
        uint amount,
        uint time,
        bytes32 tag
    ) external;
}
