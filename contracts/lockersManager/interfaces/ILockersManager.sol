// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@teleportdao/btc-evm-bridge/contracts/types/ScriptTypesEnum.sol";

interface ILockersManager {
    /// @notice Structure for registering lockers
    /// @param lockerLockingScript Locker redeem script
    /// @param lockerRescueType Locker script type in case of getting BTCs back
    /// @param lockerRescueScript Locker script in case of getting BTCs back
    /// @param TSTLockedAmount Amount of TST locked by Locker
    /// @param collateralTokenLockedAmount Amount of collateral token locked by Locker
    /// @param netMinted Total minted - total burnt
    /// @param slashingTeleBTCAmount Total amount of teleBTC a locker must be slashed
    /// @param reservedCollateralTokenForSlash Total collateral token reserved for slashing locker
    /// @param isLocker True if it's a Locker
    /// @param isCandidate True if it's a candidate
    /// @param isScriptHash NOT USED
    struct locker {
        bytes lockerLockingScript;
        ScriptTypes lockerRescueType;
        bytes lockerRescueScript;
        uint256 TSTLockedAmount;
        uint256 collateralTokenLockedAmount;
        uint256 netMinted;
        uint256 slashingTeleBTCAmount;
        uint256 reservedCollateralTokenForSlash;
        bool isLocker;
        bool isCandidate;
        bool isScriptHash;
    }

    struct lockersLibConstants {
        uint256 OneHundredPercent;
        uint256 HealthFactor;
        uint256 UpperHealthFactor;
        uint256 MaxLockerFee;
        uint256 NativeTokenDecimal;
        address NativeToken;
    }

    struct lockersLibParam {
        address TeleportSystemToken;
        address teleBTC;
        address burnRouter;
        address exchangeConnector;
        address priceOracle;
        uint256 minRequiredTSTLockedAmount;
        uint256 minRequiredTNTLockedAmount;
        uint256 lockerPercentageFee;
        uint256 collateralRatio;
        uint256 liquidationRatio;
        uint256 priceWithDiscountRatio;
        uint256 inactivationDelay;
    }

    struct becomeLockerArguments {
        ILockersManager.lockersLibConstants libConstants;
        ILockersManager.lockersLibParam libParams;
        address theLockerTargetAddress;
        address collateralToken;
        uint256 collateralDecimal;
        uint256 _lockedTSTAmount;
        uint256 _lockedCollateralTokenAmount;
        bytes _candidateLockingScript;
        ScriptTypes _lockerRescueType;
        bytes _lockerRescueScript;
    }

    // Events

    event RequestAddLocker(
        address indexed lockerTargetAddress,
        bytes lockerLockingScript,
        uint TSTLockedAmount,
        address indexed collateralToken,
        uint collateralTokenLockedAmount
    );

    event RevokeAddLockerRequest(
        address indexed lockerTargetAddress,
        bytes lockerLockingScript,
        uint TSTLockedAmount,
        address indexed collateralToken,
        uint collateralTokenLockedAmount
    );

    event RequestInactivateLocker(
        address indexed lockerTargetAddress,
        uint256 indexed inactivationTimestamp,
        bytes lockerLockingScript,
        uint TSTLockedAmount,
        address collateralToken,
        uint collateralTokenLockedAmount,
        uint netMinted
    );

    event ActivateLocker(
        address indexed lockerTargetAddress,
        bytes lockerLockingScript,
        uint TSTLockedAmount,
        address collateralToken,
        uint collateralTokenLockedAmount,
        uint netMinted
    );

    event LockerAdded(
        address indexed lockerTargetAddress,
        bytes lockerLockingScript,
        uint TSTLockedAmount,
        address indexed collateralToken,
        uint collateralTokenLockedAmount,
        uint reliabilityFactor,
        uint addingTime
    );

    event LockerRemoved(
        address indexed lockerTargetAddress,
        bytes lockerLockingScript,
        uint TSTUnlockedAmount,
        address indexed collateralToken,
        uint collateralTokenUnlockedAmount
    );

    event LockerSlashed(
        address indexed lockerTargetAddress,
        address collateralToken,
        uint rewardAmount,
        address indexed rewardRecipient,
        uint256 amount,
        address indexed recipient,
        uint256 slashedCollateralAmount,
        uint256 slashTime,
        bool isForCCBurn
    );

    event LockerLiquidated(
        address indexed lockerTargetAddress,
        address indexed liquidatorAddress,
        address collateralToken,
        uint collateralAmount,
        uint teleBTCAmount,
        uint liquidateTime
    );

    event LockerSlashedCollateralSold(
        address indexed lockerTargetAddress,
        address indexed buyerAddress,
        address indexed collateralToken,
        uint slashingAmount,
        uint teleBTCAmount,
        uint slashingTime
    );

    event CollateralAdded(
        address indexed lockerTargetAddress,
        address indexed collateralToken,
        uint addedCollateral,
        uint totalCollateral,
        uint addingTime
    );

    event CollateralRemoved(
        address indexed lockerTargetAddress,
        address indexed collateralToken,
        uint removedCollateral,
        uint totalCollateral,
        uint removingTime
    );

    event MintByLocker(
        address indexed lockerTargetAddress,
        address indexed receiver,
        uint256 mintedAmount,
        uint256 lockerFee,
        uint256 mintingTime
    );

    event BurnByLocker(
        address indexed lockerTargetAddress,
        uint256 burntAmount,
        uint256 lockerFee,
        uint256 burningTime
    );

    event NewCollateralToken(address token, uint decimal);

    event MinterAdded(address indexed account);

    event MinterRemoved(address indexed account);

    event BurnerAdded(address indexed account);

    event BurnerRemoved(address indexed account);

    event NewLockerPercentageFee(
        uint256 oldLockerPercentageFee,
        uint256 newLockerPercentageFee
    );

    event NewReliabilityFactor(
        address lockerTargetAddress,
        uint oldReliabilityFactor,
        uint newReliabilityFactor
    );

    event NewPriceWithDiscountRatio(
        uint256 oldPriceWithDiscountRatio,
        uint256 newPriceWithDiscountRatio
    );

    event NewMinRequiredTSTLockedAmount(
        uint256 oldMinRequiredTSTLockedAmount,
        uint256 newMinRequiredTSTLockedAmount
    );

    event NewMinRequiredTNTLockedAmount(
        uint256 oldMinRequiredTNTLockedAmount,
        uint256 newMinRequiredTNTLockedAmount
    );

    event NewPriceOracle(address oldPriceOracle, address newPriceOracle);

    event NewBurnRouter(address oldBurnRouter, address newBurnRouter);

    event NewTST(address oldTST, address newTST);

    event NewTeleBTC(address oldTeleBTC, address newTeleBTC);

    event NewCollateralRatio(
        uint256 oldCollateralRatio,
        uint256 newCollateralRatio
    );

    event NewLiquidationRatio(
        uint256 oldLiquidationRatio,
        uint256 newLiquidationRatio
    );

    // Read-only functions

    function TeleportSystemToken() external view returns (address);

    function teleBTC() external view returns (address);

    function burnRouter() external view returns (address);

    function exchangeConnector() external view returns (address);

    function priceOracle() external view returns (address);

    function minRequiredTSTLockedAmount() external view returns (uint256);

    function minRequiredTNTLockedAmount() external view returns (uint256);

    function lockerPercentageFee() external view returns (uint256);

    function collateralRatio() external view returns (uint256);

    function liquidationRatio() external view returns (uint256);

    function priceWithDiscountRatio() external view returns (uint256);

    function totalNumberOfCandidates() external view returns (uint256);

    function totalNumberOfLockers() external view returns (uint256);

    function getLockerTargetAddress(
        bytes calldata _lockerLockingScript
    ) external view returns (address);

    function isLocker(
        bytes calldata _lockerLockingScript
    ) external view returns (bool);

    function isLockerActive(
        address _lockerTargetAddress
    ) external view returns (bool);

    function getLockerHealthFactor(
        address _lockerTargetAddress
    ) external view returns (uint256);

    function minters(address) external view returns (bool);

    function burners(address) external view returns (bool);

    // State-changing functions

    function pauseLocker() external;

    function unPauseLocker() external;

    function addCollateralToken(address _token, uint _decimal) external;

    function addMinter(address _account) external;

    function removeMinter(address _account) external;

    function addBurner(address _account) external;

    function removeBurner(address _account) external;

    function mint(
        bytes calldata _lockerLockingScript,
        address _receiver,
        uint256 _amount
    ) external returns (uint256);

    function burn(
        bytes calldata _lockerLockingScript,
        uint256 _amount
    ) external returns (uint256);

    function setTST(address _TST) external;

    function setLockerPercentageFee(uint256 _lockerPercentageFee) external;

    function setPriceWithDiscountRatio(
        uint256 _priceWithDiscountRatio
    ) external;

    function setMinRequiredTSTLockedAmount(
        uint256 _minRequiredTSTLockedAmount
    ) external;

    function setPriceOracle(address _priceOracle) external;

    function setBurnRouter(address _burnRouter) external;

    function setTeleBTC(address _teleBTC) external;

    function setLockerReliabilityFactor(
        address _lockerTargetAddress,
        uint _reliabilityFactor
    ) external;

    function setCollateralRatio(uint _collateralRatio) external;

    function setLiquidationRatio(uint256 _liquidationRatio) external;

    function liquidateLocker(
        address _lockerTargetAddress,
        uint256 _btcAmount
    ) external returns (bool);

    function addCollateral(
        address _lockerTargetAddress,
        uint256 _addingCollateralTokenAmount
    ) external payable returns (bool);

    function removeCollateral(
        uint256 _removingCollateralTokenAmount
    ) external payable returns (bool);

    function requestToBecomeLocker(
        bytes calldata _lockerLockingScript,
        address _collateralToken,
        uint _lockedTSTAmount,
        uint _lockedCollateralTokenAmount,
        ScriptTypes _lockerRescueType,
        bytes calldata _lockerRescueScript
    ) external payable returns (bool);

    function revokeRequest() external returns (bool);

    function addLocker(
        address _lockerTargetAddress,
        uint256 _lockerReliabilityFactor
    ) external returns (bool);

    function requestInactivation() external returns (bool);

    function requestActivation() external returns (bool);

    function selfRemoveLocker() external returns (bool);

    function slashIdleLocker(
        address _lockerTargetAddress,
        uint256 _rewardAmount,
        address _slasher,
        uint256 _amount,
        address _recipient
    ) external returns (bool);

    function slashThiefLocker(
        address _lockerTargetAddress,
        uint256 _rewardAmount,
        address _slasher,
        uint256 _amount
    ) external returns (bool);

    function buySlashedCollateralOfLocker(
        address _lockerTargetAddress,
        uint256 _collateralAmount
    ) external returns (bool);

    function getLockerCapacity(
        address _lockerTargetAddress
    ) external returns (uint256 theLockerCapacity);
}
