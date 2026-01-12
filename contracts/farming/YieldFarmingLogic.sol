// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IYieldFarmingLogic.sol";
import "./Pausable.sol";
import "./YieldFarmingStorage.sol";
import "./YieldFarmingStorageV2.sol";

contract YieldFarmingLogic is
    YieldFarmingStorage,
    Pausable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    IYieldFarmingLogic,
    YieldFarmingStorageV2
{
    using SafeERC20 for IERC20;

    modifier IsSupported(address _token) {
        require(isLpTokenSupported[_token], "YieldFarming: not supported");
        _;
    }

    function initialize() public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        Pausable.__Pausable_init();
    }

    /// @notice Return farmed TST amount during a period for all stakers
    function totalRewardInPeriod(
        address _token,
        uint _start,
        uint _end
    ) public view override returns (uint) {
        uint index = rewardPerDay[_token].length - 1;
        uint res = 0;
        while (_start < rewardPerDayUpdateTime[_token][index]) {
            if (_end <= rewardPerDayUpdateTime[_token][index]) {
                index--;
            } else {
                res +=
                    ((_end - rewardPerDayUpdateTime[_token][index]) *
                        rewardPerDay[_token][index]) /
                    1 days;
                _end = rewardPerDayUpdateTime[_token][index];
                index--;
            }
        }

        res += ((_end - _start) * rewardPerDay[_token][index]) / 1 days;
        return res;
    }

    /// @notice Return farmed TST amount from the start of farming
    function totalRewardFromStart(
        address _token
    ) external view override returns (uint) {
        return
            totalRewardInPeriod(
                _token,
                rewardPerDayUpdateTime[_token][0],
                block.timestamp
            );
    }

    function getAvailableTst() external view override returns (uint) {
        return IERC20(TST).balanceOf(address(this));
    }

    /// @notice Return number of staked LP token of a user
    function balanceOf(
        address _token,
        address _account
    ) public view override returns (uint) {
        return _stakedBalance[_token][_account];
    }

    /// @notice Return farmed TST of an account
    function getRewardOfUser(
        address _token,
        address _account
    ) public view override returns (uint) {
        uint coefficient = (_overallCoefficient[_token] -
            _lastCoefficient[_token][_account]) +
            (
                stakedTotalSupply[_token] != 0
                    ? (totalRewardInPeriod(
                        _token,
                        _lastUpdateTime[_token],
                        _getEndInterestPeriod(_token)
                    ) * (10 ** 28)) / stakedTotalSupply[_token]
                    : 0
            );

        return
            _rewardBalance[_token][_account] +
            (coefficient * _stakedBalance[_token][_account]) /
            (10 ** 28);
    }

    /// @notice Set the deadline for unstaking LP tokens after the
    function setUnlockRequestDeadline(
        address _token,
        uint _unlockRequestDeadline
    ) public override onlyOwner {
        emit NewUnlockRequestDeadline(
            _token,
            unlockRequestDeadline[_token],
            _unlockRequestDeadline
        );
        unlockRequestDeadline[_token] = _unlockRequestDeadline;
    }

    /// @notice Set the min staking time
    function setLockTime(
        address _token,
        uint _lockTime
    ) public override onlyOwner {
        emit NewLockTime(_token, lockTime[_token], _lockTime);
        lockTime[_token] = _lockTime;
    }

    /// @notice Pause depositing for a LP token
    function pause(address token) external onlyOwner {
        _pause(token);
    }

    /// @notice Unpause depositing of a LP token
    function unpause(address token) external onlyOwner {
        _unpause(token);
    }

    /// @notice Start farming for a LP token
    function addLpToken(
        uint _perDayInterest,
        address _token,
        uint _lockTime,
        uint _unlockRequestDeadline
    ) public override onlyOwner {
        isLpTokenSupported[_token] = true;
        rewardPerDay[_token].push(_perDayInterest);
        rewardPerDayUpdateTime[_token].push(block.timestamp);
        lockTime[_token] = _lockTime;
        unlockRequestDeadline[_token] = _unlockRequestDeadline;
    }

    function setLpToken(
        uint _perDayInterest,
        address _token,
        uint _startTime
    ) public onlyOwner {
        rewardPerDay[_token].push(_perDayInterest);
        rewardPerDayUpdateTime[_token].push(_startTime);
    }

    function setTST(address _TST) external onlyOwner {
        TST = _TST;
    }

    /// @notice Update the reward per day for a LP token
    /// @dev This value could be only updated few times since the contract
    ///      may run out of gas for calculating the interest
    function updateRewardPerDay(
        address _token,
        uint _newRewardPerDay
    ) external override onlyOwner {
        // TODO: how many times can we update the reward per day?
        uint oldRewardPerDay = currentRewardPerDay(_token);
        rewardPerDay[_token].push(_newRewardPerDay);
        rewardPerDayUpdateTime[_token].push(block.timestamp);
        emit RewardUpdated(
            _token,
            oldRewardPerDay,
            _newRewardPerDay,
            block.timestamp
        );
    }

    function currentRewardPerDay(
        address _token
    ) public view override returns (uint) {
        return rewardPerDay[_token][rewardPerDay[_token].length - 1];
    }

    /// @notice Stake LP token to farm TST
    /// @dev Farming should exist for that token and not paused
    function stakeLpToken(
        address _token,
        uint _amount
    ) public override whenNotPaused(_token) IsSupported(_token) nonReentrant {
        IERC20(_token).safeTransferFrom(_msgSender(), address(this), _amount);
        // Note: first we should find the interest amount, then increase balance and supply
        //       (since the user may already staked LP tokens)
        _relaxBalance(_token, _msgSender());
        _stakedBalance[_token][_msgSender()] += _amount;
        stakedTotalSupply[_token] += _amount;
        emit LpTokenStaked(_msgSender(), _token, _amount);
    }

    /// @notice Unstake LP token if there is no min wait time
    function instantUnstakeLpToken(
        address _token,
        uint _amount
    ) public override whenNotPaused(_token) IsSupported(_token) nonReentrant {
        require(
            lockTime[_token] == 0,
            "YieldFarming: minimum wait time is not zero"
        );
        require(
            _stakedBalance[_token][_msgSender()] >= _amount,
            "YieldFarming: low balance"
        );
        _relaxBalance(_token, _msgSender());
        _stakedBalance[_token][_msgSender()] -= _amount;
        stakedTotalSupply[_token] -= _amount;
        IERC20(_token).safeTransfer(_msgSender(), _amount);
        emit LpTokenUnstaked(_msgSender(), _token, _amount, bytes32(0));
    }

    /// @notice Claim the farmed TST
    /// @dev Reward amount should be multiplied by 10^18
    function claimReward(
        address _token
    ) external override whenNotPaused(_token) IsSupported(_token) nonReentrant {
        // Find the latest reward amount
        _relaxBalance(_token, _msgSender());
        uint totalReward = _rewardBalance[_token][_msgSender()];
        _rewardBalance[_token][_msgSender()] = 0;
        totalClaimedReward += totalReward;
        IERC20(TST).safeTransfer(_msgSender(), totalReward * (10 ** 18));
        emit RewardClaimed(_msgSender(), _token, totalReward);
    }

    /// @notice Request to unstake LP tokens
    /// @dev Should be used if min wait time is non-zero
    function requestToUnstakeLpToken(
        address _token,
        uint _amount
    ) public whenNotPaused(_token) IsSupported(_token) returns (bytes32) {
        uint blockTime = block.timestamp;
        bytes32 tag = keccak256(
            abi.encodePacked(_msgSender(), _token, _amount, blockTime)
        );
        require(
            unlockRequestState[tag] == 0,
            "YieldFarming: already submitted"
        );
        unlockRequestState[tag] = 1;

        emit UnstakeLpTokenRequest(
            _msgSender(),
            _token,
            _stakedBalance[_token][_msgSender()],
            _amount,
            blockTime,
            tag
        );
        return tag;
    }

    /// @notice Unstake LP token after the wait time is passed
    function unstakeLpToken(
        address _token,
        uint _amount,
        uint _time,
        bytes32 _tag
    ) public whenNotPaused(_token) IsSupported(_token) nonReentrant {
        require(
            _tag ==
                keccak256(
                    abi.encodePacked(_msgSender(), _token, _amount, _time)
                ),
            "YieldFarming: wrong tag"
        );
        require(
            block.timestamp - _time >= 1 days * lockTime[_token],
            "YieldFarming: still locked"
        );
        require(
            block.timestamp - _time <=
                1 days * (lockTime[_token] + unlockRequestDeadline[_token]),
            "YieldFarming: req expired"
        );
        require(
            unlockRequestState[_tag] == 1,
            "YieldFarming: already unstaked"
        );
        require(
            _stakedBalance[_token][_msgSender()] >= _amount,
            "YieldFarming: low balance"
        );

        _relaxBalance(_token, _msgSender());
        _stakedBalance[_token][_msgSender()] -= _amount;
        stakedTotalSupply[_token] -= _amount;
        IERC20(_token).safeTransfer(_msgSender(), _amount);
        unlockRequestState[_tag] = 2;
        emit LpTokenUnstaked(_msgSender(), _token, _amount, _tag);
    }

    /// @notice Return LP token to staker
    function sendBackToken(address _token, address _account) public onlyOwner {
        _relaxBalance(_token, _account);
        uint amount = _stakedBalance[_token][_account];
        _stakedBalance[_token][_account] = 0;
        stakedTotalSupply[_token] -= amount;
        IERC20(_token).safeTransfer(_account, amount);
    }

    /// @notice Stop farming for a liquidity pool
    function stop(address _token) public onlyOwner {
        _isStopped[_token] = true;
        _stopTime[_token] = block.timestamp;
    }

    /// @notice Update the rewarded TST of an account
    /// @dev We only update reward amount when a user stake or unstake her tokens
    function _relaxBalance(address _token, address _account) private {
        if (stakedTotalSupply[_token] != 0) {
            _overallCoefficient[_token] +=
                (totalRewardInPeriod(
                    _token,
                    _lastUpdateTime[_token],
                    _getEndInterestPeriod(_token)
                ) * (10 ** 28)) /
                stakedTotalSupply[_token];
        }

        _rewardBalance[_token][_account] +=
            ((_overallCoefficient[_token] -
                _lastCoefficient[_token][_account]) *
                _stakedBalance[_token][_account]) /
            (10 ** 28);
        _lastUpdateTime[_token] = block.timestamp;
        _lastCoefficient[_token][_account] = _overallCoefficient[_token];
    }

    /// @notice Return the end time of interest-paying
    /// @dev Returns current time if farming is not stopped
    function _getEndInterestPeriod(address _token) private view returns (uint) {
        if (_isStopped[_token]) return _stopTime[_token];
        return block.timestamp;
    }
}
