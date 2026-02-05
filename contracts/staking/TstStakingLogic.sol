// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "./TstStakingStorage.sol";

contract TstStakingLogic is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ERC20Upgradeable,
    TstStakingStorage
{
    using SafeERC20 for IERC20;

    /// @notice Staking contract for TST. Stakers earn rewards from Locker fees.
    ///         By staking TST, user receives veTST which can be used for governance voting.
    ///         veTST is not transferable.
    function initialize(address _TST) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        PausableUpgradeable.__Pausable_init();
        ERC20Upgradeable.__ERC20_init(
            "Vote Escrowed Teleport System Token",
            "veTST"
        );
        setTst(_TST);
    }

    /// @return Returns TST staked amount, end time, claimed reward, unclaimed reward
    function getStakingPosition(
        address _locker,
        address _user
    ) external view override returns (uint, uint, uint, uint) {
        return (
            stakingPosition[_locker][_user].stakedAmount,
            stakingPosition[_locker][_user].unstakingTime,
            stakingPosition[_locker][_user].claimedReward,
            getUnclaimedReward(_locker, _user)
        );
    }

    /// @notice Calculate total reward earned by user, and subtract already claimed reward
    /// @return Returns unclaimed reward amount
    function getUnclaimedReward(
        address _locker,
        address _user
    ) public view override returns (uint) {
        // Calculate total reward earned by user, and subtract already claimed reward
        uint totalReward = ((stakingPosition[_locker][_user].stakedAmount *
            (stakingInfo[_locker].currentRewardPerToken -
                stakingPosition[_locker][_user].initRewardPerToken)) /
            PERCISION);

        if (totalReward > stakingPosition[_locker][_user].claimedReward) {
            return totalReward - stakingPosition[_locker][_user].claimedReward;
        } else {
            return 0;
        }
    }

    /// @notice Setter for TST
    function setTst(address _TST) public override onlyOwner {
        TST = _TST;
    }

    /// @notice Registers a new Locker for staking.
    ///         Users who delegate TST to the Locker will earn percentage of Locker fees.
    /// @param _locker Address of the Locker
    /// @param _stakingPercentage Percentage of Locker fees to be distributed to stakers
    /// @param _rewardToken Address of the reward token
    /// @param _stakingPeriod Users can unstake after before this period
    function registerLocker(
        address _locker,
        uint _stakingPercentage,
        address _rewardToken,
        uint _stakingPeriod
    ) external override onlyOwner {
        require(
            _stakingPercentage <= MAX_STAKING_PERCENTAGE,
            "TstStaking: invalid staking percentage"
        );
        require(
            stakingInfo[_locker].stakingPercentage == 0,
            "TstStaking: locker already registered"
        );
        stakingInfo[_locker].stakingPercentage = _stakingPercentage;
        stakingInfo[_locker].rewardToken = _rewardToken;
        stakingInfo[_locker].stakingPeriod = _stakingPeriod;

        emit LockerRegisteredForStaking(
            _locker,
            _stakingPercentage,
            _rewardToken,
            _stakingPeriod
        );
    }

    /// @notice Updates staking percentage and staking period for a registered Locker
    function updateRegisteredLocker(
        address _locker,
        uint _stakingPercentage,
        uint _stakingPeriod
    ) external override onlyOwner {
        stakingInfo[_locker].stakingPercentage = _stakingPercentage;
        stakingInfo[_locker].stakingPeriod = _stakingPeriod;
        emit LockerRegisteredForStaking(
            _locker,
            _stakingPercentage,
            stakingInfo[_locker].rewardToken,
            _stakingPeriod
        );
    }

    /// @notice Adds a controller
    /// @dev Controller can only stake on behalf of other users (not claim or unstake)
    function addController(address _controller) external onlyOwner {
        isController[_controller] = true;
    }

    /// @notice Removes a controller
    function removeController(address _controller) external onlyOwner {
        isController[_controller] = false;
    }

    /// @notice Allows owner to pause all staking operations
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Allows owner to unpause all staking operations
    function unpause() external onlyOwner {
        _unpause();
    }

    function onOFTReceived(
        uint16, // _srcChainId
        bytes memory, // _srcAddress
        uint64, // _nonce
        bytes32, // _from
        uint _amount,
        bytes memory _payload // This is our payload (not LZ payload)
    ) public override {
        address _locker = toAddress(_payload, 0);
        address _user = toAddress(_payload, 20);
        stake(_locker, _amount, _user);
    }

    /// @notice Stakes TST to earn rewards
    /// @dev Controller can stake on behalf of other users
    /// @dev This mints veToken to the user
    /// @dev Users can stake extra TST to their existing position
    /// @param _locker Address of the Locker
    /// @param _amount Amount of TST to stake
    /// @param _user Address of the user
    function stake(
        address _locker,
        uint _amount,
        address _user
    ) public override whenNotPaused nonReentrant {
        // If user has no staked amount, delete their staking position
        if (stakingPosition[_locker][_user].stakedAmount == 0) {
            delete stakingPosition[_locker][_user];
        }

        require(
            stakingInfo[_locker].stakingPercentage > 0,
            "TstStaking: locker not registered"
        );

        // If msg.sender is not the user, then it must be a controller
        if (_user != msg.sender) {
            if (stakingPosition[_locker][_user].controller != address(0)) {
                // If user has already staked, then controller must be the same
                require(
                    stakingPosition[_locker][_user].controller == msg.sender,
                    "TstStaking: not controller"
                );
            } else {
                require(isController[msg.sender], "TstStaking: not controller");
            }
        }

        // Transfer TST from msg.sender
        IERC20(TST).safeTransferFrom(msg.sender, address(this), _amount);

        // Update staking info
        stakingInfo[_locker].totalStakedAmount += _amount;

        // Update staking position

        // Users can unstake after staking period
        stakingPosition[_locker][_user].unstakingTime =
            block.timestamp +
            stakingInfo[_locker].stakingPeriod;

        // To calculate user reward, we multiply number of staked tokens with
        // the difference of current reward per token and initial reward per token.
        // This means that user will earn reward for the tokens staked after the last reward update
        // Below formula allow users to stake extra TST to their existing position
        stakingPosition[_locker][_user].initRewardPerToken =
            ((stakingPosition[_locker][_user].stakedAmount *
                stakingPosition[_locker][_user].initRewardPerToken) +
                (stakingInfo[_locker].currentRewardPerToken * _amount)) /
            (stakingPosition[_locker][_user].stakedAmount + _amount);

        stakingPosition[_locker][_user].stakedAmount += _amount;

        // Mint veToken
        _mint(_user, _amount);

        emit TstStaked(
            msg.sender,
            _locker,
            stakingInfo[_locker].rewardToken,
            _amount,
            _user,
            stakingPosition[_locker][_user].unstakingTime,
            stakingPosition[_locker][_user].stakedAmount
        );
    }

    /// @notice Claims unclaimed reward
    /// @dev Only the user can claim their own reward
    function claimReward(
        address _locker,
        address _user
    ) public override whenNotPaused nonReentrant {
        if (_user != msg.sender) {
            require(
                stakingPosition[_locker][_user].controller == msg.sender,
                "TstStaking: not controller"
            );
        }
        require(
            stakingInfo[_locker].stakingPercentage > 0,
            "TstStaking: locker not registered"
        );
        _claimReward(_locker, _user, _user);
    }

    function claimRewardByOwner(
        address _locker,
        address _user
    ) external onlyOwner nonReentrant {
        _claimReward(_locker, _user, owner());
    }

    /// @notice Unstakes TST. Users cannot unstake partial amount.
    /// @dev Only the user can unstake (not controller)
    /// @dev This burns veToken from the user
    /// @dev User can unstake only after staking period is over
    /// @dev All unclaimed reward will be sent to user
    function unstake(
        address _locker,
        address _user
    ) external override whenNotPaused nonReentrant {
        uint _stakedAmount = stakingPosition[_locker][_user].stakedAmount;

        // Only user can unstake
        if (_user != msg.sender) {
            require(
                stakingPosition[_locker][_user].controller == msg.sender,
                "TstStaking: not controller"
            );
        }
        /*Check:
            1. Locker is registered
            2. User has enough staked amount
            3. Staking period is over
        */
        require(
            stakingInfo[_locker].stakingPercentage > 0,
            "TstStaking: locker not registered"
        );
        require(
            block.timestamp >= stakingPosition[_locker][_user].unstakingTime,
            "TstStaking: staking period not over"
        );

        // Send any unclaimed reward
        _claimReward(_locker, _user, _user);

        // Burn veToken
        _burn(_user, _stakedAmount);

        // Update staking info
        stakingInfo[_locker].totalStakedAmount -= _stakedAmount;

        // Delete staking position
        delete stakingPosition[_locker][_user];

        IERC20(TST).safeTransfer(_user, _stakedAmount);

        emit TstUnstaked(
            msg.sender,
            _locker,
            _stakedAmount,
            _user
        );
    }

    function unstakeByOwner(
        address _locker,
        address _user
    ) external onlyOwner nonReentrant {
        uint _stakedAmount = stakingPosition[_locker][_user].stakedAmount;

        /*Check:
            1. Locker is registered
            2. User has enough staked amount
            3. Staking period is over
        */
        require(
            stakingInfo[_locker].stakingPercentage > 0,
            "TstStaking: locker not registered"
        );

        // Send any unclaimed reward
        _claimReward(_locker, _user, _user);

        // Burn veToken
        _burn(_user, _stakedAmount);

        // Update staking info
        stakingInfo[_locker].totalStakedAmount -= _stakedAmount;

        // Delete staking position
        delete stakingPosition[_locker][_user];

        IERC20(TST).safeTransfer(_user, _stakedAmount);

        emit TstUnstaked(
            msg.sender,
            _locker,
            _stakedAmount,
            _user
        );
    }

    /// @notice Deposits reward token for a Locker.
    ///         This reward will be distributed to stakers and Locker
    function depositReward(
        address _locker,
        uint _amount
    ) external override nonReentrant {
        if (stakingInfo[_locker].stakingPercentage == 0) {
            // If staking not enabled, send tokens to locker
            IERC20(stakingInfo[_locker].rewardToken).safeTransferFrom(
                msg.sender,
                _locker,
                _amount
            );
            emit RewardDeposited(msg.sender, _locker, address(0), _amount, 0);
        } else if (stakingInfo[_locker].totalStakedAmount == 0) {
            // If no stakers, send all rewards to locker
            IERC20(stakingInfo[_locker].rewardToken).safeTransferFrom(
                msg.sender,
                _locker,
                _amount
            );
            emit RewardDeposited(msg.sender, _locker, stakingInfo[_locker].rewardToken, _amount, 0);
        } else {
            // Get reward token from sender
            IERC20(stakingInfo[_locker].rewardToken).safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );

            uint rewardAmount = (_amount *
                stakingInfo[_locker].stakingPercentage) /
                MAX_STAKING_PERCENTAGE;

            // Send rest of it to Locker
            IERC20(stakingInfo[_locker].rewardToken).safeTransfer(
                _locker,
                _amount - rewardAmount
            );

            // Update staking info
            stakingInfo[_locker].totalReward += rewardAmount;
            stakingInfo[_locker].currentRewardPerToken +=
                (PERCISION * rewardAmount) /
                stakingInfo[_locker].totalStakedAmount;

            emit RewardDeposited(
                msg.sender,
                _locker,
                stakingInfo[_locker].rewardToken,
                _amount,
                rewardAmount
            );
        }
    }

    function _claimReward(address _locker, address _user, address _receiver) private {
        // Get unclaimed reward
        uint reward = getUnclaimedReward(_locker, _user);

        if (reward > 0) {
            stakingPosition[_locker][_user].claimedReward += reward;
            stakingInfo[_locker].totalClaimedReward += reward;
            // Send reward token to user (not controller)
            IERC20(stakingInfo[_locker].rewardToken).safeTransfer(
                _receiver,
                reward
            );

            emit RewardClaimed(
                msg.sender,
                _locker,
                stakingInfo[_locker].rewardToken,
                _receiver,
                reward
            );
        }
    }

    /// @notice veToken is not transferable
    function _transfer(address, address, uint256) internal pure override {
        require(false, "TstStaking: transfers not allowed");
    }

    function toAddress(
        bytes memory _bytes,
        uint _start
    ) internal pure returns (address) {
        require(_bytes.length >= _start + 20, "toAddress_outOfBounds");
        address tempAddress;

        assembly {
            tempAddress := div(
                mload(add(add(_bytes, 0x20), _start)),
                0x1000000000000000000000000
            )
        }

        return tempAddress;
    }
}
