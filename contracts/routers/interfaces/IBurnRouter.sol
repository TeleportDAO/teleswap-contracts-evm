// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@teleportdao/btc-evm-bridge/contracts/types/ScriptTypesEnum.sol";

interface IBurnRouter {
    // Structures

    /// @notice Structure for recording cc burn requests
    /// @param amount of tokens that user wants to burn
    /// @param burntAmount that user will receive (after reducing fees from amount)
    /// @param sender Address of user who requests burning
    /// @param userScript Script hash of the user on Bitcoin
    /// @param deadline of locker for executing the request
    /// @param isTransferred True if the request has been processed
    /// @param scriptType The script type of the user
    /// @param requestIdOfLocker The index of the request for a specific locker
    struct burnRequest {
        uint amount;
        uint burntAmount;
        address sender;
        bytes userScript;
        uint deadline;
        bool isTransferred;
        ScriptTypes scriptType;
        uint requestIdOfLocker;
    }

    // Events

    /// @notice Emits when a burn request gets submitted
    /// @param userScript Script of user on Bitcoin
    /// @param scriptType Script type of the user (for bitcoin address)
    /// @param lockerTargetAddress Address of Locker
    /// @param userTargetAddress Address of the user on EVM
    /// @param requestIdOfLocker Index of request between Locker's burn requests
    /// @param deadline of Locker for executing the request (in terms of Bitcoin blocks)
    /// @param thirdPartyId Id of third party
    /// @param inputToken inputToken address
    /// @param amounts [inputAmount, teleBTCAmount, burntAmount]
    /// @param fees [network fee, locker fee, protocol fee, third party fee]
    event NewUnwrap(
        bytes userScript,
        ScriptTypes scriptType,
        address lockerTargetAddress,
        address indexed userTargetAddress,
        uint requestIdOfLocker,
        uint indexed deadline,
        uint thirdPartyId,
        address inputToken,
        uint[3] amounts,
        uint[4] fees
    );

    /// @notice Emits when a burn proof is provided
    /// @param lockerTargetAddress Address of Locker
    /// @param requestIdOfLocker Index of paid request of among Locker's requests
    /// @param bitcoinTxId The hash of tx that paid a burn request
    /// @param bitcoinTxOutputIndex The output index in tx
    event PaidUnwrap(
        address indexed lockerTargetAddress,
        uint requestIdOfLocker,
        bytes32 bitcoinTxId,
        uint bitcoinTxOutputIndex
    );

    /// @notice  Emits when a locker gets slashed for withdrawing BTC without proper reason
    /// @param _lockerTargetAddress	Locker's address on the target chain
    /// @param _blockNumber	Block number of the malicious tx
    /// @param txId	Transaction ID of the malicious tx
    /// @param amount Slashed amount
    event LockerDispute(
        address _lockerTargetAddress,
        bytes lockerLockingScript,
        uint _blockNumber,
        bytes32 txId,
        uint amount
    );

    event BurnDispute(
        address indexed userTargetAddress,
        address indexed _lockerTargetAddress,
        bytes lockerLockingScript,
        uint requestIdOfLocker
    );

    /// @notice Emits when relay address is updated
    event NewRelay(address oldRelay, address newRelay);

    /// @notice Emits when treasury address is updated
    event NewTreasury(address oldTreasury, address newTreasury);

    /// @notice Emits when lockers address is updated
    event NewLockers(address oldLockers, address newLockers);

    /// @notice Emits when TeleBTC address is updated
    event NewTeleBTC(address oldTeleBTC, address newTeleBTC);

    /// @notice Emits when transfer deadline is updated
    event NewTransferDeadline(
        uint oldTransferDeadline,
        uint newTransferDeadline
    );

    /// @notice Emits when percentage fee is updated
    event NewProtocolPercentageFee(
        uint oldProtocolPercentageFee,
        uint newProtocolPercentageFee
    );

    /// @notice Emits when slasher percentage fee is updated
    event NewSlasherPercentageFee(
        uint oldSlasherPercentageFee,
        uint newSlasherPercentageFee
    );

    /// @notice Emits when network fee is updated
    event NewNetworkFee(uint oldNetworkFee, uint newNetworkFee);

    /// @notice Emits when network fee oracle is updated
    event NewNetworkFeeOracle(
        address oldNetworkFeeOracle,
        address newNetworkFeeOracle
    );

    /// @notice Emits when changes made to third party address
    event NewThirdPartyAddress(
        uint thirdPartyId,
        address oldThirdPartyAddress,
        address newThirdPartyAddress
    );

    /// @notice Emits when changes made to third party fee
    event NewThirdPartyFee(
        uint thirdPartyId,
        uint oldThirdPartyFee,
        uint newThirdPartyFee
    );

	event NewWrappedNativeToken(
        address oldWrappedNativeToken,
        address newWrappedNativeToken
    );

    // Read-only functions

    function isTransferred(
        address _lockerTargetAddress,
        uint _index
    ) external view returns (bool);

    function startingBlockNumber() external view returns (uint);

    function relay() external view returns (address);

    function lockers() external view returns (address);

    function teleBTC() external view returns (address);

    function treasury() external view returns (address);

    function transferDeadline() external view returns (uint);

    function protocolPercentageFee() external view returns (uint);

    function slasherPercentageReward() external view returns (uint);

    function bitcoinFee() external view returns (uint); // Bitcoin transaction fee

    function isUsedAsBurnProof(bytes32 _txId) external view returns (bool);

    function bitcoinFeeOracle() external view returns (address);

    // State-changing functions

    function setStartingBlockNumber(uint _startingBlockNumber) external;

    function setRelay(address _relay) external;

    function setLockers(address _lockers) external;

    function setTeleBTC(address _teleBTC) external;

    function setTreasury(address _treasury) external;

    function setTransferDeadline(uint _transferDeadline) external;

    function setProtocolPercentageFee(uint _protocolPercentageFee) external;

    function setLockerPercentageFee(uint _lockerPercentageFee) external;

    function setSlasherPercentageReward(uint _slasherPercentageReward) external;

    function setNetworkFee(uint _networkFee) external;

    function setNetworkFeeOracle(address _networkFeeOracle) external;

    function setThirdPartyAddress(
        uint _thirdPartyId,
        address _thirdPartyAddress
    ) external;

    function setThirdPartyFee(uint _thirdPartyId, uint _thirdPartyFee) external;

    function setWrappedNativeToken(address _wrappedNativeToken) external;

    function unwrap(
        uint _amount,
        bytes calldata _userScript,
        ScriptTypes _scriptType,
        bytes calldata _lockerLockingScript,
        uint thirdParty
    ) external returns (uint);

    function swapAndUnwrap(
        address _exchangeConnector,
        uint[] calldata _amounts,
        bool _isFixedToken,
        address[] calldata _path,
        uint256 _deadline,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        bytes calldata _lockerLockingScript,
        uint thirdParty
    ) external payable returns (uint);

    function burnProof(
        bytes4 _version,
        bytes memory _vin,
        bytes memory _vout,
        bytes4 _locktime,
        uint256 _blockNumber,
        bytes memory _intermediateNodes,
        uint _index,
        bytes memory _lockerLockingScript,
        uint[] memory _burnReqIndexes,
        uint[] memory _voutIndexes
    ) external payable returns (bool);

    function disputeBurn(
        bytes calldata _lockerLockingScript,
        uint[] memory _indices
    ) external;

    function disputeLocker(
        bytes memory _lockerLockingScript,
        bytes4[] memory _versions, // [inputTxVersion, outputTxVersion]
        bytes memory _inputVin,
        bytes memory _inputVout,
        bytes memory _outputVin,
        bytes memory _outputVout,
        bytes4[] memory _locktimes, // [inputTxLocktime, outputTxLocktime]
        bytes memory _inputIntermediateNodes,
        uint[] memory _indexesAndBlockNumbers
        // ^ [inputIndex, inputTxIndex, outputTxIndex, inputTxBlockNumber, outputTxBlockNumber]
    ) external payable;
}
