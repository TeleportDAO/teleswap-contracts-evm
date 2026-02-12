// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./LockersManagerStorage.sol";
import "./LockersManagerStorage2.sol";
import "../erc20/interfaces/ITeleBTC.sol";
import "../routers/interfaces/IBurnRouter.sol";
import "./LockersManagerLib.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract LockersManagerLogic is
    LockersManagerStorage,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    LockersManagerStorage2
{
    error ZeroAddress();
    error ZeroValue();
    error NotBurner();
    error NotMinter();
    error NotLocker();
    error TransferFailed();
    error LockerActive();
    error LockerNotActive();
    error InvalidValue();
    error AlreadyHasRole();
    error NotRequested();
    error BurnFailed();
    error InsufficientFunds();

    using LockersManagerLib for *;
    using SafeERC20 for IERC20;

    function initialize(
        address _teleBTC,
        address _priceOracle,
        address _burnRouter,
        uint256 _minRequiredTSTLockedAmount,
        uint256 _collateralRatio,
        uint256 _liquidationRatio,
        uint256 _lockerPercentageFee,
        uint256 _priceWithDiscountRatio
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        PausableUpgradeable.__Pausable_init();

        setTeleBTC(_teleBTC);
        setBurnRouter(_burnRouter);
        setPriceOracle(_priceOracle);
        setMinRequiredTSTLockedAmount(_minRequiredTSTLockedAmount);
        setCollateralRatio(_collateralRatio);
        setLiquidationRatio(_liquidationRatio);
        setLockerPercentageFee(_lockerPercentageFee);
        setPriceWithDiscountRatio(_priceWithDiscountRatio);

        libConstants.OneHundredPercent = ONE_HUNDRED_PERCENT;
        libConstants.HealthFactor = HEALTH_FACTOR;
        libConstants.UpperHealthFactor = UPPER_HEALTH_FACTOR;
        libConstants.MaxLockerFee = MAX_LOCKER_FEE;
        libConstants.NativeTokenDecimal = NATIVE_TOKEN_DECIMAL;
        libConstants.NativeToken = NATIVE_TOKEN;
    }

    // *************** Modifiers ***************

    modifier nonZeroAddress(address _address) {
        if (_address == address(0)) revert ZeroAddress();
        _;
    }

    modifier nonZeroValue(uint256 _value) {
        if (_value == 0) revert ZeroValue();
        _;
    }

    modifier onlyMinter() {
        if (!minters[_msgSender()]) revert NotMinter();
        _;
    }

    modifier onlyBurner() {
        if (!burners[_msgSender()]) revert NotBurner();
        _;
    }

    // *************** Internal functions ***************

    function _transferCollateral(address _token, address _to, uint256 _amount) internal {
        if (_token == NATIVE_TOKEN) {
            Address.sendValue(payable(_to), _amount);
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }
    }

    // *************** External functions ***************

    /// @notice Whitelist new collateral token with decimal
    /// @dev Set decimal to 0 to remove token from whitelist
    function addCollateralToken(
        address _token,
        uint _decimal
    ) external override nonZeroAddress(_token) onlyOwner {
        collateralDecimal[_token] = _decimal;
        emit NewCollateralToken(_token, _decimal);
    }

    /// @notice Give an account access to mint
    function addMinter(
        address _account
    ) external override nonZeroAddress(_account) onlyOwner {
        if (minters[_account]) revert AlreadyHasRole();

        minters[_account] = true;
        emit MinterAdded(_account);
    }

    /// @notice Remove an account's access to mint
    function removeMinter(address _account) external override onlyOwner {
        if (!minters[_account]) revert NotMinter();

        minters[_account] = false;
        emit MinterRemoved(_account);
    }

    /// @notice Give an account access to burn
    function addBurner(
        address _account
    ) public override nonZeroAddress(_account) onlyOwner {
        if (burners[_account]) revert AlreadyHasRole();

        burners[_account] = true;
        emit BurnerAdded(_account);
    }

    /// @notice Remove an account's access to burn
    function removeBurner(address _account) public override onlyOwner {
        // if (!isBurner(_account))
        //     revert NotBurner();
        burners[_account] = false;
        emit BurnerRemoved(_account);
    }

    /// @notice Pause the contract
    /// @dev Only functions with whenPaused modifier can be called
    function pauseLocker() external override onlyOwner {
        _pause();
    }

    /// @notice Un-pause the contract
    /// @dev Only functions with whenNotPaused modifier can be called
    function unPauseLocker() external override onlyOwner {
        _unpause();
    }

    /// @notice Return true if _lockerLockingScript is Locker
    function isLocker(
        bytes calldata _lockerLockingScript
    ) external view override returns (bool) {
        return
            lockersMapping[getLockerTargetAddress[_lockerLockingScript]]
                .isLocker;
    }

    /// @notice Update TST contract address
    function setTST(address _TST) public override onlyOwner {
        emit NewTST(TeleportSystemToken, _TST);
        TeleportSystemToken = _TST;
        libParams.TeleportSystemToken = TeleportSystemToken;
    }

    /// @notice Update locker percentage fee
    /// @dev This fee is taken by Locker for every minting or burning
    function setLockerPercentageFee(
        uint256 _lockerPercentageFee
    ) public override onlyOwner {
        if (_lockerPercentageFee > MAX_LOCKER_FEE) revert InvalidValue();
        emit NewLockerPercentageFee(lockerPercentageFee, _lockerPercentageFee);
        lockerPercentageFee = _lockerPercentageFee;
        libParams.lockerPercentageFee = lockerPercentageFee;
    }

    /// @notice Update price with discount ratio
    /// @dev This ratio gives discount to users who participate in Locker liquidation
    function setPriceWithDiscountRatio(
        uint256 _priceWithDiscountRatio
    ) public override onlyOwner {
        if (_priceWithDiscountRatio > ONE_HUNDRED_PERCENT)
            revert InvalidValue();
        emit NewPriceWithDiscountRatio(
            priceWithDiscountRatio,
            _priceWithDiscountRatio
        );

        priceWithDiscountRatio = _priceWithDiscountRatio;
        libParams.priceWithDiscountRatio = priceWithDiscountRatio;
    }

    /// @notice Update the required TST bond to become Locker
    function setMinRequiredTSTLockedAmount(
        uint256 _minRequiredTSTLockedAmount
    ) public override onlyOwner {
        emit NewMinRequiredTSTLockedAmount(
            minRequiredTSTLockedAmount,
            _minRequiredTSTLockedAmount
        );
        minRequiredTSTLockedAmount = _minRequiredTSTLockedAmount;
        libParams.minRequiredTSTLockedAmount = minRequiredTSTLockedAmount;
    }

    /// @notice Update the price oracle
    /// @dev This oracle is used to get the price of token in BTC
    function setPriceOracle(
        address _priceOracle
    ) public override nonZeroAddress(_priceOracle) onlyOwner {
        emit NewPriceOracle(priceOracle, _priceOracle);
        priceOracle = _priceOracle;
        libParams.priceOracle = priceOracle;
    }

    /// @notice Update burn router address
    function setBurnRouter(
        address _burnRouter
    ) public override nonZeroAddress(_burnRouter) onlyOwner {
        emit NewBurnRouter(burnRouter, _burnRouter);
        removeBurner(burnRouter);
        burnRouter = _burnRouter;
        libParams.burnRouter = burnRouter;
        addBurner(burnRouter);
    }

    /// @notice Update wrapped BTC address
    function setTeleBTC(
        address _teleBTC
    ) public override nonZeroAddress(_teleBTC) onlyOwner {
        emit NewTeleBTC(teleBTC, _teleBTC);
        teleBTC = _teleBTC;
        libParams.teleBTC = teleBTC;
    }

    /// @notice Update locker reliability factor
    /// @dev This ratio is used as a helper to calculate the maximum mintable TeleBTC by a Locker
    function setLockerReliabilityFactor(
        address lockerTargetAddress,
        uint reliabilityFactor
    ) public override nonZeroValue(reliabilityFactor) onlyOwner {
        emit NewReliabilityFactor(
            lockerTargetAddress,
            lockerReliabilityFactor[lockerTargetAddress],
            reliabilityFactor
        );
        lockerReliabilityFactor[lockerTargetAddress] = reliabilityFactor;
    }

    /// @notice Update locker reliability factor
    /// @dev This ratio is used as a helper to calculate the maximum mintable TeleBTC by a Locker
    function setLockerCollateralToken(
        address lockerTargetAddress,
        address collateralToken
    ) public onlyOwner {
        lockerCollateralToken[lockerTargetAddress] = collateralToken;
    }

    /// @notice Update collateral ratio
    /// @dev This ratio is used to calculate the maximum mintable TeleBTC by a Locker
    function setCollateralRatio(
        uint256 _collateralRatio
    ) public override onlyOwner {
        if (_collateralRatio <= liquidationRatio) revert InvalidValue();
        emit NewCollateralRatio(collateralRatio, _collateralRatio);
        collateralRatio = _collateralRatio;
        libParams.collateralRatio = collateralRatio;
    }

    /// @notice Update liquidation ratio
    function setLiquidationRatio(
        uint256 _liquidationRatio
    ) public override onlyOwner {
        if (collateralRatio <= _liquidationRatio) revert InvalidValue();
        emit NewLiquidationRatio(liquidationRatio, _liquidationRatio);
        liquidationRatio = _liquidationRatio;
        libParams.liquidationRatio = liquidationRatio;
    }

    /// @notice Submit request to become Locker
    /// @dev This request may be approved by the owner
    /// @param _candidateLockingScript Locking script of the Locker. Users can use this script to lock BTC.
    /// @param _lockedTSTAmount TST bond amount
    /// @param _lockedCollateralTokenAmount target collateral token bond amount
    /// @param _lockerScriptType Type of Locker's script (e.g. P2SH)
    /// @param _lockerRescueScript Rescue script of Locker. In the case of liqudation, BTC is sent to this script.
    /// @return True if candidate added successfully
    function requestToBecomeLocker(
        bytes calldata _candidateLockingScript,
        address _collateralToken,
        uint256 _lockedTSTAmount,
        uint256 _lockedCollateralTokenAmount,
        ScriptTypes _lockerScriptType,
        bytes calldata _lockerRescueScript
    )
        external
        payable
        override
        nonZeroAddress(_collateralToken)
        nonReentrant
        returns (bool)
    {
        LockersManagerLib.requestToBecomeLocker(
            lockersMapping,
            becomeLockerArguments(
                libConstants,
                libParams,
                getLockerTargetAddress[_candidateLockingScript],
                _collateralToken,
                collateralDecimal[_collateralToken],
                _lockedTSTAmount,
                _lockedCollateralTokenAmount,
                _candidateLockingScript,
                _lockerScriptType,
                _lockerRescueScript
            )
        );

        lockerCollateralToken[_msgSender()] = _collateralToken;

        if (_collateralToken != NATIVE_TOKEN) {
            IERC20(_collateralToken).safeTransferFrom(
                _msgSender(),
                address(this),
                _lockedCollateralTokenAmount
            );
        }

        if (libParams.TeleportSystemToken != address(0)) {
            IERC20(libParams.TeleportSystemToken).safeTransferFrom(
                _msgSender(),
                address(this),
                _lockedTSTAmount
            );
        }

        totalNumberOfCandidates = totalNumberOfCandidates + 1;

        emit RequestAddLocker(
            _msgSender(),
            _candidateLockingScript,
            _lockedTSTAmount,
            _collateralToken,
            _lockedCollateralTokenAmount
        );

        return true;
    }

    /// @notice Revoke request to become Locker
    /// @dev Send back TST and collateral to the candidate
    /// @return True if the candidate is removed successfully
    function revokeRequest() external override nonReentrant returns (bool) {
        if (!lockersMapping[_msgSender()].isCandidate) revert NotRequested();

        // Loads locker's information
        locker memory lockerRequest = lockersMapping[_msgSender()];

        // Removes candidate from lockersMapping
        delete lockersMapping[_msgSender()];

        totalNumberOfCandidates = totalNumberOfCandidates - 1;

        // Sends back TST and collateral
        if (libParams.TeleportSystemToken != address(0)) {
            IERC20(TeleportSystemToken).safeTransfer(
                _msgSender(),
                lockerRequest.TSTLockedAmount
            );
        }

        _transferCollateral(
            lockerCollateralToken[_msgSender()],
            _msgSender(),
            lockerRequest.collateralTokenLockedAmount
        );

        emit RevokeAddLockerRequest(
            _msgSender(),
            lockerRequest.lockerLockingScript,
            lockerRequest.TSTLockedAmount,
            lockerCollateralToken[_msgSender()],
            lockerRequest.collateralTokenLockedAmount
        );

        delete lockerCollateralToken[_msgSender()];

        return true;
    }

    /// @notice Approve the candidate request to become Locker
    /// @dev Only owner can call this. The isCandidate is also set to false.
    /// @param _lockerTargetAddress Locker's target chain address
    /// @return True if the candidate is added successfully
    function addLocker(
        address _lockerTargetAddress,
        uint256 _lockerReliabilityFactor
    )
        external
        override
        nonZeroAddress(_lockerTargetAddress)
        nonZeroValue(_lockerReliabilityFactor)
        nonReentrant
        onlyOwner
        returns (bool)
    {
        if (!lockersMapping[_lockerTargetAddress].isCandidate)
            revert NotRequested();

        // Updates locker's status
        lockersMapping[_lockerTargetAddress].isCandidate = false;
        lockersMapping[_lockerTargetAddress].isLocker = true;

        // Updates number of candidates and lockers
        totalNumberOfCandidates = totalNumberOfCandidates - 1;
        totalNumberOfLockers = totalNumberOfLockers + 1;

        getLockerTargetAddress[
            lockersMapping[_lockerTargetAddress].lockerLockingScript
        ] = _lockerTargetAddress;

        lockerReliabilityFactor[
            _lockerTargetAddress
        ] = _lockerReliabilityFactor;

        emit LockerAdded(
            _lockerTargetAddress,
            lockersMapping[_lockerTargetAddress].lockerLockingScript,
            lockersMapping[_lockerTargetAddress].TSTLockedAmount,
            lockerCollateralToken[_lockerTargetAddress],
            lockersMapping[_lockerTargetAddress].collateralTokenLockedAmount,
            _lockerReliabilityFactor,
            block.timestamp
        );
        return true;
    }

    /// @notice Request to inactivate Locker
    /// @dev This would inactivate Locker after INACTIVATION_DELAY. The impact of inactivation is:
    ///      1. No one can mint TeleBTC by the Locker
    ///      2. Locker can be removed
    ///      3. Locker can withdraw unused collateral
    /// @return True if deactivated successfully
    function requestInactivation()
        external
        override
        nonReentrant
        returns (bool)
    {
        if (!lockersMapping[_msgSender()].isLocker) revert NotLocker();

        require(
            lockerInactivationTimestamp[_msgSender()] == 0,
            "Lockers: already requested"
        );

        lockerInactivationTimestamp[_msgSender()] =
            block.timestamp +
            INACTIVATION_DELAY;

        emit RequestInactivateLocker(
            _msgSender(),
            lockerInactivationTimestamp[_msgSender()],
            lockersMapping[_msgSender()].lockerLockingScript,
            lockersMapping[_msgSender()].TSTLockedAmount,
            lockerCollateralToken[_msgSender()],
            lockersMapping[_msgSender()].collateralTokenLockedAmount,
            lockersMapping[_msgSender()].netMinted
        );

        return true;
    }

    /// @notice Activate Locker
    /// @dev Users can only mint TeleBTC by active locker
    ///      Note: lockerInactivationTimestamp = 0 means that the Locker is active
    /// @return True if activated successfully
    function requestActivation() external override nonReentrant returns (bool) {
        if (!lockersMapping[_msgSender()].isLocker) revert NotLocker();

        lockerInactivationTimestamp[_msgSender()] = 0;

        emit ActivateLocker(
            _msgSender(),
            lockersMapping[_msgSender()].lockerLockingScript,
            lockersMapping[_msgSender()].TSTLockedAmount,
            lockerCollateralToken[_msgSender()],
            lockersMapping[_msgSender()].collateralTokenLockedAmount,
            lockersMapping[_msgSender()].netMinted
        );

        return true;
    }

    /// @notice Removes Locker from system and send back Locker TST and collateral.
    /// @dev Only Locker can call this. The conditions for successful remove is:
    ///      1. Locker has been inactivated
    ///      2. Locker sends net minted TeleBTC to the contract
    ///      3. Locker is not being slashed
    /// @return True if locker is removed successfully
    function selfRemoveLocker() external override nonReentrant returns (bool) {
        locker memory _removingLocker = lockersMapping[_msgSender()];

        if (!_removingLocker.isLocker) revert NotLocker();

        if (isLockerActive(_msgSender())) revert LockerActive();

        // Locker needs to make its netMinted 0 before leaving the system
        ITeleBTC(teleBTC).transferFrom(
            _msgSender(),
            address(this),
            _removingLocker.netMinted
        );
        ITeleBTC(teleBTC).burn(_removingLocker.netMinted);

        if (_removingLocker.slashingTeleBTCAmount != 0) revert InvalidValue();

        // Remove locker from lockersMapping

        delete getLockerTargetAddress[
            lockersMapping[_msgSender()].lockerLockingScript
        ];
        delete lockersMapping[_msgSender()];
        totalNumberOfLockers = totalNumberOfLockers - 1;

        // Sends back TST and collateral
        if (libParams.TeleportSystemToken != address(0)) {
            IERC20(TeleportSystemToken).safeTransfer(
                _msgSender(),
                _removingLocker.TSTLockedAmount
            );
        }

        _transferCollateral(
            lockerCollateralToken[_msgSender()],
            _msgSender(),
            _removingLocker.collateralTokenLockedAmount +
                _removingLocker.reservedCollateralTokenForSlash
        );

        emit LockerRemoved(
            _msgSender(),
            _removingLocker.lockerLockingScript,
            _removingLocker.TSTLockedAmount,
            lockerCollateralToken[_msgSender()],
            _removingLocker.collateralTokenLockedAmount
        );
        return true;
    }

    /// @notice Slash Locker for unprocessed unwrap request
    /// @dev Only burn router can call this. Locker is slashed since he doesn't provide burn proof
    ///      before the request deadline. User who made the burn request will receive the slashed bond.
    /// @param _lockerTargetAddress Locker's target chain address
    /// @param _rewardAmount Amount of TeleBTC that slasher receives
    /// @param _slasher Address of slasher who receives reward
    /// @param _amount Amount of TeleBTC that is slashed from Locker
    /// @param _recipient Address of user who receives the slashed collateral
    /// @return True if the locker is slashed successfully
    function slashIdleLocker(
        address _lockerTargetAddress,
        uint256 _rewardAmount,
        address _slasher,
        uint256 _amount,
        address _recipient
    ) external override nonReentrant whenNotPaused returns (bool) {
        (
            uint256 equivalentCollateralToken,
            uint256 rewardAmountInCollateralToken
        ) = LockersManagerLib.slashIdleLocker(
                lockersMapping[_lockerTargetAddress],
                lockerCollateralToken[_lockerTargetAddress],
                collateralDecimal[lockerCollateralToken[_lockerTargetAddress]],
                libParams,
                _rewardAmount,
                _amount
            );

        _transferCollateral(
            lockerCollateralToken[_lockerTargetAddress],
            _recipient,
            equivalentCollateralToken - rewardAmountInCollateralToken
        );
        _transferCollateral(
            lockerCollateralToken[_lockerTargetAddress],
            _slasher,
            rewardAmountInCollateralToken
        );

        emit LockerSlashed(
            _lockerTargetAddress,
            lockerCollateralToken[_lockerTargetAddress],
            rewardAmountInCollateralToken,
            _slasher,
            _amount,
            _recipient,
            equivalentCollateralToken,
            block.timestamp,
            true
        );

        return true;
    }

    /// @notice Slash Locker for stealing users BTC
    /// @dev Only burn router can call. Locker is slashed because he moved BTC from
    ///      Locker's Bitcoin address without any corresponding burn req.
    ///      The slashed bond will be sold with discount.
    /// @param _lockerTargetAddress Locker's target chain address
    /// @param _rewardAmount Value of slashed reward (in TeleBTC)
    /// @param _slasher Address of slasher who receives reward
    /// @param _amount Value of slashed collateral (in TeleBTC)
    /// @return True if the locker is slashed successfully
    function slashThiefLocker(
        address _lockerTargetAddress,
        uint256 _rewardAmount,
        address _slasher,
        uint256 _amount
    ) external override nonReentrant whenNotPaused returns (bool) {
        address collateralToken = lockerCollateralToken[_lockerTargetAddress];
        (
            uint256 rewardInCollateralToken,
            uint256 neededCollateralTokenForSlash
        ) = LockersManagerLib.slashThiefLocker(
                lockersMapping[_lockerTargetAddress],
                lockerReliabilityFactor[_lockerTargetAddress],
                libConstants,
                libParams,
                collateralToken,
                collateralDecimal[collateralToken],
                _rewardAmount,
                _amount
            );

        _transferCollateral(
            lockerCollateralToken[_lockerTargetAddress],
            _slasher,
            rewardInCollateralToken
        );

        emit LockerSlashed(
            _lockerTargetAddress,
            lockerCollateralToken[_lockerTargetAddress],
            rewardInCollateralToken,
            _slasher,
            _amount,
            address(this),
            neededCollateralTokenForSlash + rewardInCollateralToken,
            block.timestamp,
            false
        );

        return true;
    }

    /// @notice Liquidate Locker with unhealthy collateral
    /// @dev Anyone can liquidate Locker with health factor under
    ///      100% by providing a sufficient amount of TeleBTC.
    /// @param _lockerTargetAddress Locker's target chain address
    /// @param _collateralAmount Amount of collateral that someone wants to buy with discount
    /// @return True if liquidation was successful
    function liquidateLocker(
        address _lockerTargetAddress,
        uint256 _collateralAmount
    )
        external
        override
        nonZeroValue(_collateralAmount)
        nonReentrant
        whenNotPaused
        onlyOwner
        returns (bool)
    {
        uint256 neededTeleBTC = LockersManagerLib.liquidateLocker(
            lockersMapping[_lockerTargetAddress],
            libConstants,
            libParams,
            lockerCollateralToken[_lockerTargetAddress],
            collateralDecimal[lockerCollateralToken[_lockerTargetAddress]],
            _collateralAmount,
            lockerReliabilityFactor[_lockerTargetAddress]
        );

        locker memory theLiquidatingLocker = lockersMapping[
            _lockerTargetAddress
        ];

        // Update locked collateral of locker
        lockersMapping[_lockerTargetAddress].collateralTokenLockedAmount =
            lockersMapping[_lockerTargetAddress].collateralTokenLockedAmount -
            _collateralAmount;

        // transfer teleBTC from user
        IERC20(teleBTC).safeTransferFrom(
            msg.sender,
            address(this),
            neededTeleBTC
        );

        // Burns TeleBTC for locker rescue script
        IERC20(teleBTC).approve(burnRouter, neededTeleBTC);
        IBurnRouter(burnRouter).unwrap(
            neededTeleBTC,
            theLiquidatingLocker.lockerRescueScript,
            theLiquidatingLocker.lockerScriptType,
            theLiquidatingLocker.lockerLockingScript,
            0
        );

        _transferCollateral(
            lockerCollateralToken[_lockerTargetAddress],
            _msgSender(),
            _collateralAmount
        );

        emit LockerLiquidated(
            _lockerTargetAddress,
            _msgSender(),
            lockerCollateralToken[_lockerTargetAddress],
            _collateralAmount,
            neededTeleBTC,
            block.timestamp
        );

        return true;
    }

    /// @notice Sell slashed collateral of a Locker
    /// @dev Users buy the slashed collateral using TeleBTC with discount
    ///      The paid TeleBTC will be burnt to keep the system safe
    ///      If all the needed TeleBTC is collected and burnt,
    ///      the rest of slashed collateral is sent back to locker
    /// @param _lockerTargetAddress Locker's target chain address
    /// @param _collateralAmount Amount of collateral that someone intends to buy with discount
    /// @return True if buying was successful
    function buySlashedCollateralOfLocker(
        address _lockerTargetAddress,
        uint256 _collateralAmount
    )
        external
        override
        nonZeroValue(_collateralAmount)
        nonReentrant
        whenNotPaused
        returns (bool)
    {
        uint256 neededTeleBTC = LockersManagerLib.buySlashedCollateralOfLocker(
            lockersMapping[_lockerTargetAddress],
            _collateralAmount
        );

        // Burns user's TeleBTC
        if (
            !ITeleBTC(teleBTC).transferFrom(
                _msgSender(),
                address(this),
                neededTeleBTC
            )
        ) revert TransferFailed();

        ITeleBTC(teleBTC).burn(neededTeleBTC);

        // Sends bought collateral to user
        _transferCollateral(
            lockerCollateralToken[_lockerTargetAddress],
            _msgSender(),
            _collateralAmount
        );

        emit LockerSlashedCollateralSold(
            _lockerTargetAddress,
            _msgSender(),
            lockerCollateralToken[_lockerTargetAddress],
            _collateralAmount,
            neededTeleBTC,
            block.timestamp
        );

        return true;
    }

    /// @notice Increase collateral of the locker
    /// @notice No need to pass _addingCollateralTokenAmount if collateral token is native token
    /// @param _lockerTargetAddress Locker's target chain address
    /// @param _addingCollateralTokenAmount Amount of added collateral
    /// @return True if collateral is added successfully
    function addCollateral(
        address _lockerTargetAddress,
        uint256 _addingCollateralTokenAmount
    ) external payable override nonReentrant returns (bool) {
        LockersManagerLib.addCollateralHelper(
            libConstants,
            lockersMapping[_lockerTargetAddress],
            _addingCollateralTokenAmount,
            lockerCollateralToken[_lockerTargetAddress]
        );

        if (lockerCollateralToken[_lockerTargetAddress] != NATIVE_TOKEN) {
            IERC20(lockerCollateralToken[_lockerTargetAddress])
                .safeTransferFrom(
                    _msgSender(),
                    address(this),
                    _addingCollateralTokenAmount
                );
        }

        emit CollateralAdded(
            _lockerTargetAddress,
            lockerCollateralToken[_msgSender()],
            _addingCollateralTokenAmount,
            lockersMapping[_lockerTargetAddress].collateralTokenLockedAmount,
            block.timestamp
        );

        return true;
    }

    /// @notice Decreases collateral of the locker
    /// @param _removingCollateralTokenAmount Amount of removed collateral
    /// @return True if collateral is removed successfully
    function removeCollateralByOwner(
        address _lockerTargetAddress,
        uint256 _removingCollateralTokenAmount
    )
        external
        payable
        onlyOwner
        nonZeroValue(_removingCollateralTokenAmount)
        nonReentrant
        returns (bool)
    {
        LockersManagerLib.removeFromCollateral(
            lockersMapping[_lockerTargetAddress],
            libConstants,
            libParams,
            lockerReliabilityFactor[_lockerTargetAddress],
            lockerCollateralToken[_lockerTargetAddress],
            collateralDecimal[lockerCollateralToken[_lockerTargetAddress]],
            _removingCollateralTokenAmount
        );


        _transferCollateral(
            lockerCollateralToken[_lockerTargetAddress],
            _msgSender(),
            _removingCollateralTokenAmount
        );

        emit CollateralRemoved(
            _lockerTargetAddress,
            lockerCollateralToken[_lockerTargetAddress],
            _removingCollateralTokenAmount,
            lockersMapping[_lockerTargetAddress].collateralTokenLockedAmount,
            block.timestamp
        );

        return true;
    }

    /// @notice Decreases collateral of the locker
    /// @param _removingCollateralTokenAmount Amount of removed collateral
    /// @return True if collateral is removed successfully
    function removeCollateral(
        uint256 _removingCollateralTokenAmount
    )
        external
        payable
        override
        nonZeroValue(_removingCollateralTokenAmount)
        nonReentrant
        returns (bool)
    {
        LockersManagerLib.removeFromCollateral(
            lockersMapping[_msgSender()],
            libConstants,
            libParams,
            lockerReliabilityFactor[_msgSender()],
            lockerCollateralToken[_msgSender()],
            collateralDecimal[lockerCollateralToken[_msgSender()]],
            _removingCollateralTokenAmount
        );

        if (isLockerActive(_msgSender())) revert LockerActive();

        _transferCollateral(
            lockerCollateralToken[_msgSender()],
            _msgSender(),
            _removingCollateralTokenAmount
        );

        emit CollateralRemoved(
            _msgSender(),
            lockerCollateralToken[_msgSender()],
            _removingCollateralTokenAmount,
            lockersMapping[_msgSender()].collateralTokenLockedAmount,
            block.timestamp
        );

        return true;
    }

    /// @notice Mint teleBTC for an account
    /// @dev Mint teleBTC for an account and the locker fee as well
    /// @param _lockerLockingScript Locking script of a locker
    /// @param _receiver Address of the receiver of the minted teleBTCs
    /// @param _amount Amount of the teleBTC which is minted, including the locker's fee
    /// @return uint The amount of teleBTC minted for the receiver
    function mint(
        bytes calldata _lockerLockingScript,
        address _receiver,
        uint256 _amount
    )
        external
        override
        nonZeroAddress(_receiver)
        nonReentrant
        whenNotPaused
        onlyMinter
        returns (uint256)
    {
        address _lockerTargetAddress = getLockerTargetAddress[
            _lockerLockingScript
        ];

        if (!isLockerActive(_lockerTargetAddress)) revert LockerNotActive();

        LockersManagerLib.mintHelper(
            lockersMapping[_lockerTargetAddress],
            libConstants,
            libParams,
            _lockerTargetAddress,
            lockerCollateralToken[_lockerTargetAddress],
            collateralDecimal[lockerCollateralToken[_lockerTargetAddress]],
            lockerReliabilityFactor[_lockerTargetAddress],
            _amount
        );

        // Mint teleBTC
        ITeleBTC(teleBTC).mint(address(this), _amount);

        // Send teleBTC to receiver
        ITeleBTC(teleBTC).transfer(_receiver, _amount);

        emit MintByLocker(
            _lockerTargetAddress,
            _receiver,
            _amount,
            0,
            block.timestamp
        );

        return _amount;
    }

    function getLockerCapacity(
        address _lockerTargetAddress
    ) external view override returns (uint256 theLockerCapacity) {
        return
            LockersManagerLib.getLockerCapacity(
                lockersMapping[_lockerTargetAddress],
                libConstants,
                libParams,
                _lockerTargetAddress,
                lockerCollateralToken[_lockerTargetAddress],
                collateralDecimal[lockerCollateralToken[_lockerTargetAddress]],
                lockerReliabilityFactor[_lockerTargetAddress]
            );
    }

    /// @notice Burn teleBTC of an account
    /// @dev Burn teleBTC and also get the locker's fee
    /// @param _lockerLockingScript Locking script of a locker
    /// @param _amount Amount of the teleBTC which is minted, including the locker's fee
    /// @return uint The amount of burnt teleBTC
    function burn(
        bytes calldata _lockerLockingScript,
        uint256 _amount
    )
        external
        override
        nonReentrant
        whenNotPaused
        onlyBurner
        returns (uint256)
    {
        address _lockerTargetAddress = getLockerTargetAddress[
            _lockerLockingScript
        ];

        // Transfers teleBTC from user

        if (
            !ITeleBTC(teleBTC).transferFrom(
                _msgSender(),
                address(this),
                _amount
            )
        ) revert TransferFailed();

        uint256 netMinted = lockersMapping[_lockerTargetAddress].netMinted;

        if (netMinted < _amount) revert InsufficientFunds();

        lockersMapping[_lockerTargetAddress].netMinted =
            netMinted -
            _amount;

        // Burns TeleBTC
        if (!ITeleBTC(teleBTC).burn(_amount)) revert BurnFailed();

        emit BurnByLocker(
            _lockerTargetAddress,
            _amount,
            0,
            block.timestamp
        );

        return _amount;
    }

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice Emergency withdraw tokens from contract
    function emergencyWithdraw(
        address _token,
        uint256 _amount
    ) external onlyOwner nonReentrant {
        _transferCollateral(_token, owner(), _amount);
    }

    /// @notice Return the Locker status
    /// @dev We check a locker status in below cases:
    ///      1. Minting TeleBTC
    ///      2. Removing locker's collateral
    ///      3. Removing locker
    /// @param _lockerTargetAddress Address of locker on the target chain
    /// @return True if the locker is active
    function isLockerActive(
        address _lockerTargetAddress
    ) public view override returns (bool) {
        if (lockerInactivationTimestamp[_lockerTargetAddress] == 0) {
            return true;
        } else if (
            lockerInactivationTimestamp[_lockerTargetAddress] > block.timestamp
        ) {
            return true;
        } else {
            return false;
        }
    }

    /// @notice Return the health factor of locker
    function getLockerHealthFactor(
        address _lockerTargetAddress
    ) public view override returns (uint256) {
        return
            LockersManagerLib.calculateHealthFactor(
                lockersMapping[_lockerTargetAddress],
                libConstants,
                libParams,
                lockerCollateralToken[_lockerTargetAddress],
                collateralDecimal[lockerCollateralToken[_lockerTargetAddress]],
                lockerReliabilityFactor[_lockerTargetAddress]
            );
    }

    function priceOfOneUnitOfCollateralInBTC(
        address _collateralToken,
        uint _collateralDecimal
    ) external view returns (uint256) {
        return
            LockersManagerLib.priceOfOneUnitOfCollateralInBTC(
                _collateralToken,
                _collateralDecimal,
                libParams
            );
    }
}

    // /// @notice Remove Locker from system and send back Locker TST and collateral.
    // /// @dev Owner need to pay net minted TeleBTC to the contract
    // function removeLockerByOwner(
    //     address _lockerTargetAddress
    // ) external onlyOwner nonReentrant returns (bool) {
    //     locker memory _removingLocker = lockersMapping[_lockerTargetAddress];

    //     require(_removingLocker.isLocker, "Lockers: no locker");

    //     if (_removingLocker.netMinted > 0) {
    //         ITeleBTC(teleBTC).transferFrom(
    //             _msgSender(),
    //             address(this),
    //             _removingLocker.netMinted
    //         );
    //         ITeleBTC(teleBTC).burn(_removingLocker.netMinted);
    //     }

    //     require(
    //         _removingLocker.slashingTeleBTCAmount == 0,
    //         "Lockers: 0 slashing TBTC"
    //     );

    //     // Remove locker from lockersMapping

    //     delete getLockerTargetAddress[
    //         lockersMapping[_lockerTargetAddress].lockerLockingScript
    //     ];
    //     delete lockersMapping[_lockerTargetAddress];
    //     totalNumberOfLockers = totalNumberOfLockers - 1;

    //     // Sends back TST and collateral
    //     IERC20(TeleportSystemToken).safeTransfer(
    //         owner(),
    //         _removingLocker.TSTLockedAmount
    //     );
    //     Address.sendValue(
    //         payable(owner()),
    //         _removingLocker.collateralTokenLockedAmount
    //     );

    //     emit LockerRemoved(
    //         _lockerTargetAddress,
    //         _removingLocker.lockerLockingScript,
    //         _removingLocker.TSTLockedAmount,
    //         lockerCollateralToken[_lockerTargetAddress],
    //         _removingLocker.collateralTokenLockedAmount
    //     );
    //     return true;
    // }