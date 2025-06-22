// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "../erc20/interfaces/IWETH.sol";
import "../lockersManager/interfaces/ILockersManager.sol";
import "../dex_connectors/interfaces/IDexConnector.sol";
import "./BurnRouterLib.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "./BurnRouterStorageV2.sol";

contract BurnRouterLogic is
    BurnRouterStorage,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    BurnRouterStorageV2
{
    error ZeroAddress();

    modifier nonZeroAddress(address _address) {
        if (_address == address(0)) revert ZeroAddress();
        _;
    }

    modifier onlyOracle(address _networkFeeOracle) {
        require(
            _networkFeeOracle == bitcoinFeeOracle,
            "BurnRouterLogic: not oracle"
        );
        _;
    }

    /// @notice Handles cross-chain burn requests
    /// @param _startingBlockNumber Requests that are included in a block older
    ///                             than _startingBlockNumber cannot be executed
    /// @param _relay Address of relay contract
    /// @param _lockers Address of lockers contract
    /// @param _treasury Address of the treasury of the protocol
    /// @param _teleBTC Address of teleBTC contract
    /// @param _transferDeadline of sending BTC to user (aster submitting a burn request)
    /// @param _protocolPercentageFee Percentage of tokens that user pays to protocol for burning
    /// @param _slasherPercentageReward Percentage of tokens that slasher receives after slashing a locker
    /// @param _networkFee Fee of submitting a transaction on Network
    function initialize(
        uint256 _startingBlockNumber,
        address _relay,
        address _lockers,
        address _treasury,
        address _teleBTC,
        uint256 _transferDeadline,
        uint256 _protocolPercentageFee,
        uint256 _lockerPercentageFee,
        uint256 _slasherPercentageReward,
        uint256 _networkFee,
        address _wrappedNativeToken
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        setStartingBlockNumber(_startingBlockNumber);
        setRelay(_relay);
        setLockers(_lockers);
        setTreasury(_treasury);
        setTeleBTC(_teleBTC);
        setTransferDeadline(_transferDeadline);
        setProtocolPercentageFee(_protocolPercentageFee);
        setLockerPercentageFee(_lockerPercentageFee);
        setSlasherPercentageReward(_slasherPercentageReward);
        setNetworkFeeOracle(owner());
        setNetworkFee(_networkFee);
        setWrappedNativeToken(_wrappedNativeToken);
    }

    receive() external payable {}

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice Returns true is request has been processed
    /// @param _lockerTargetAddress Locker address on the target chain
    /// @param _index the request for the locker
    function isTransferred(
        address _lockerTargetAddress,
        uint256 _index
    ) external view override returns (bool) {
        return burnRequests[_lockerTargetAddress][_index].isTransferred;
    }

    /// @notice Setter for starting block number
    function setStartingBlockNumber(
        uint256 _startingBlockNumber
    ) public override onlyOwner {
        require(
            _startingBlockNumber > startingBlockNumber,
            "BurnRouterLogic: low startingBlockNumber"
        );
        startingBlockNumber = _startingBlockNumber;
    }

    /// @notice Updates relay contract address
    /// @dev Only owner can call this
    /// @param _relay The new relay contract address
    function setRelay(
        address _relay
    ) public override onlyOwner nonZeroAddress(_relay) {
        emit NewRelay(relay, _relay);
        relay = _relay;
    }

    /// @notice Updates lockers contract address
    /// @dev Only owner can call this
    /// @param _lockers The new lockers contract address
    function setLockers(
        address _lockers
    ) public override onlyOwner nonZeroAddress(_lockers) {
        emit NewLockers(lockers, _lockers);
        lockers = _lockers;
    }

    /// @notice Updates teleBTC contract address
    /// @dev Only owner can call this
    /// @param _teleBTC The new teleBTC contract address
    function setTeleBTC(
        address _teleBTC
    ) public override onlyOwner nonZeroAddress(_teleBTC) {
        emit NewTeleBTC(teleBTC, _teleBTC);
        teleBTC = _teleBTC;
    }

    /// @notice Updates protocol treasury address
    /// @dev Only owner can call this
    /// @param _treasury The new treasury address
    function setTreasury(
        address _treasury
    ) public override onlyOwner nonZeroAddress(_treasury) {
        emit NewTreasury(treasury, _treasury);
        treasury = _treasury;
    }

    /// @notice Updates deadline of executing burn requests
    /// @dev Only owner can call this
    ///      Deadline should be greater than relay finalization parameter
    /// @param _transferDeadline The new transfer deadline
    function setTransferDeadline(uint256 _transferDeadline) public override {
        uint256 _finalizationParameter = BurnRouterLib.finalizationParameter(
            relay
        );
        require(
            _msgSender() == owner() ||
                transferDeadline < _finalizationParameter,
            "BurnRouterLogic: no permit"
        );
        // Gives lockers enough time to pay cc burn requests
        require(
            _transferDeadline > _finalizationParameter,
            "BurnRouterLogic: low deadline"
        );
        emit NewTransferDeadline(transferDeadline, _transferDeadline);
        transferDeadline = _transferDeadline;
    }

    /// @notice Updates protocol percentage fee for burning tokens
    /// @dev Only owner can call this
    /// @param _protocolPercentageFee The new protocol percentage fee
    function setProtocolPercentageFee(
        uint256 _protocolPercentageFee
    ) public override onlyOwner {
        require(
            MAX_PERCENTAGE_FEE >= _protocolPercentageFee,
            "BurnRouterLogic: invalid fee"
        );
        emit NewProtocolPercentageFee(
            protocolPercentageFee,
            _protocolPercentageFee
        );
        protocolPercentageFee = _protocolPercentageFee;
    }

    function setLockerPercentageFee(
        uint256 _lockerPercentageFee
    ) public override onlyOwner {
        require(
            MAX_PERCENTAGE_FEE >= _lockerPercentageFee,
            "BurnRouterLogic: invalid fee"
        );
        lockerPercentageFee = _lockerPercentageFee;
    }

    /// @notice Updates slasher percentage reward for disputing lockers
    /// @dev Only owner can call this
    /// @param _slasherPercentageReward The new slasher percentage reward
    function setSlasherPercentageReward(
        uint256 _slasherPercentageReward
    ) public override onlyOwner {
        require(
            MAX_PERCENTAGE_FEE >= _slasherPercentageReward,
            "BurnRouterLogic: invalid reward"
        );
        emit NewSlasherPercentageFee(
            slasherPercentageReward,
            _slasherPercentageReward
        );
        slasherPercentageReward = _slasherPercentageReward;
    }

    /// @notice Updates Bitcoin oracle
    /// @dev Only owner can call this
    /// @param _networkFeeOracle Address of oracle who can update burn fee
    function setNetworkFeeOracle(
        address _networkFeeOracle
    ) public override onlyOwner {
        emit NewNetworkFeeOracle(bitcoinFeeOracle, _networkFeeOracle);
        bitcoinFeeOracle = _networkFeeOracle;
    }

    /// @notice Updates Bitcoin transaction fee
    /// @dev Only owner can call this
    /// @param _networkFee The new Bitcoin transaction fee
    function setNetworkFee(
        uint256 _networkFee
    ) public override onlyOracle(msg.sender) {
        emit NewNetworkFee(bitcoinFee, _networkFee);
        bitcoinFee = _networkFee;
    }

    /// @notice                             Setter for third party address
    /// @dev                                Only owner can call this
    /// @param _thirdPartyAddress           third party address
    function setThirdPartyAddress(
        uint256 _thirdPartyId,
        address _thirdPartyAddress
    ) public override onlyOwner {
        emit NewThirdPartyAddress(
            _thirdPartyId,
            thirdPartyAddress[_thirdPartyId],
            _thirdPartyAddress
        );
        thirdPartyAddress[_thirdPartyId] = _thirdPartyAddress;
    }

    /// @notice                             Setter for third party fee
    /// @dev                                Only owner can call this
    /// @param _thirdPartyFee               third party fee
    function setThirdPartyFee(
        uint256 _thirdPartyId,
        uint256 _thirdPartyFee
    ) public override onlyOwner {
        emit NewThirdPartyFee(
            _thirdPartyId,
            thirdPartyFee[_thirdPartyId],
            _thirdPartyFee
        );
        thirdPartyFee[_thirdPartyId] = _thirdPartyFee;
    }

    /// @notice Change the wrapped native token address
    function setWrappedNativeToken(
        address _wrappedNativeToken
    ) public override onlyOwner {
        emit NewWrappedNativeToken(wrappedNativeToken, _wrappedNativeToken);
        wrappedNativeToken = _wrappedNativeToken;
    }

    /// @notice Setter for reward distributor
    /// @dev This contract distributes locker fee between locker and stakers
    function setRewardDistributor(
        address _rewardDistributor
    ) external override onlyOwner {
        rewardDistributor = _rewardDistributor;
    }

    /// @notice Records users burn request
    /// @dev After submitting the burn request, Locker has a limited time
    ///      to send BTC and provide burn proof
    /// @param _amount of teleBTC that user wants to burn
    /// @param _userScript User script hash
    /// @param _scriptType User script type
    /// @param _lockerLockingScript	of locker that should execute the burn request
    /// @param thirdParty Third party id
    /// @return burntAmount Amount of BTC that user receives
    function unwrap(
        uint256 _amount,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        bytes calldata _lockerLockingScript,
        uint256 thirdParty
    ) external override nonReentrant returns (uint256 burntAmount) {
        // Transfers user's teleBTC to contract
        require(
            IWETH(teleBTC).transferFrom(_msgSender(), address(this), _amount),
            "BurnRouterLogic: transferFrom failed"
        );

        burntAmount = _unwrap(
            teleBTC,
            _amount,
            0,
            _amount,
            _userScript,
            _scriptType,
            _lockerLockingScript,
            thirdParty
        );
    }

    /// @notice Exchanges input token for teleBTC then burns it
    /// @dev After exchanging, rest of the process is similar to ccBurn
    /// @param _exchangeConnector Address of exchange connectBurnRouterLogicor to be used
    /// @param _amounts [inputTokenAmount, teleBTCAmount]
    /// @param _isFixedToken True if input token amount is fixed
    /// @param _path of exchanging inputToken to teleBTC
    /// @param _deadline of exchanging
    /// @param thirdParty Third party id
    /// @return Amount of BTC that user receives
    function swapAndUnwrap(
        address _exchangeConnector,
        uint256[] calldata _amounts,
        bool _isFixedToken,
        address[] calldata _path,
        uint256 _deadline,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        bytes calldata _lockerLockingScript,
        uint256 thirdParty
    ) external payable override nonReentrant returns (uint256) {
        uint256 _exchangedTeleBTC = _exchange(
            _exchangeConnector,
            _amounts,
            _isFixedToken,
            _path,
            _deadline
        );

        return
            _swapAndUnwrap(
                _amounts[0],
                _path[0],
                _amounts[1],
                _exchangedTeleBTC,
                _userScript,
                _scriptType,
                _lockerLockingScript,
                thirdParty
            );
    }

    /// @notice Checks the correctness of burn proof (which is a Bitcoin tx)
    /// @dev Makes isTransferred flag true for the paid requests
    /// @param _version Version of the Bitcoin tx
    /// @param _vin Inputs of the Bitcoin tx
    /// @param _vout Outputs of the Bitcoin tx
    /// @param _locktime Lock time of the Bitcoin tx
    /// @param _blockNumber Height of the block containing the Bitcoin tx
    /// @param _intermediateNodes Merkle inclusion proof for the Bitcoin tx
    /// @param _index Index of the Bitcoin tx the block
    /// @param _lockerLockingScript Locker's locking script that this burn request belongs to
    /// @param _burnReqIndexes Indexes of requests that locker wants to provide proof for them
    /// @param _voutIndexes Indexes of outputs that were used to pay burn requests.
    ///                     _voutIndexes[i] belongs to _burnReqIndexes[i]
    function burnProof(
        bytes4 _version,
        bytes memory _vin,
        bytes memory _vout,
        bytes4 _locktime,
        uint256 _blockNumber,
        bytes memory _intermediateNodes,
        uint256 _index,
        bytes memory _lockerLockingScript,
        uint256[] memory _burnReqIndexes,
        uint256[] memory _voutIndexes
    ) external payable override nonReentrant returns (bool) {
        // Get the Locker target address
        address _lockerTargetAddress = ILockersManager(lockers)
            .getLockerTargetAddress(_lockerLockingScript);

        // It's more safe to only allow the Locker to call this function
        require(
            _msgSender() == _lockerTargetAddress ||
                _msgSender() == bitcoinFeeOracle,
            "BurnRouterLogic: not locker"
        );

        BurnRouterLib.burnProofHelper(
            _blockNumber,
            startingBlockNumber,
            _locktime,
            lockers,
            _lockerLockingScript,
            _burnReqIndexes.length,
            _voutIndexes.length
        );

        // Checks inclusion of transaction
        bytes32 txId = BitcoinHelper.calculateTxId(
            _version,
            _vin,
            _vout,
            _locktime
        );
        require(
            BurnRouterLib.isConfirmed(
                relay,
                txId,
                _blockNumber,
                _intermediateNodes,
                _index
            ),
            "BurnRouterLogic: not finalized"
        );

        // Mark the burn requests that are paid by this transaction
        uint256 paidOutputCounter = _checkPaidBurnRequests(
            txId,
            _blockNumber,
            _lockerTargetAddress,
            _vout,
            _burnReqIndexes,
            _voutIndexes
        );

        // Mark the Bitcoin tx as used for burn proof so Locker cannot use it again
        require(
            BurnRouterLib.updateIsUsedAsBurnProof(
                isUsedAsBurnProof,
                paidOutputCounter,
                _vout,
                _lockerLockingScript,
                txId
            ),
            "BurnRouterLogic: invalid burn proof"
        );

        return true;
    }

    /// @notice Slashes a locker if did not pay a cc burn request before its deadline
    /// @param _lockerLockingScript Locker's locking script that the unpaid request belongs to
    /// @param _indices Indices of requests that their deadline has passed
    function disputeBurn(
        bytes calldata _lockerLockingScript,
        uint256[] memory _indices
    ) external override nonReentrant onlyOwner {
        // Checks if the locking script is valid
        require(
            ILockersManager(lockers).isLocker(_lockerLockingScript),
            "BurnRouterLogic: not locker"
        );

        // Get the target address of the locker from its locking script
        address _lockerTargetAddress = ILockersManager(lockers)
            .getLockerTargetAddress(_lockerLockingScript);

        // Goes through provided indexes of burn requests to see if locker should be slashed
        for (uint256 i = 0; i < _indices.length; i++) {
            BurnRouterLib.disputeBurnHelper(
                burnRequests,
                _lockerTargetAddress,
                _indices[i],
                transferDeadline,
                BurnRouterLib.lastSubmittedHeight(relay),
                startingBlockNumber
            );

            // Slashes locker and sends the slashed amount to the user
            ILockersManager(lockers).slashIdleLocker(
                _lockerTargetAddress,
                (burnRequests[_lockerTargetAddress][_indices[i]].amount *
                    slasherPercentageReward) / MAX_PERCENTAGE_FEE, // Slasher reward
                _msgSender(), // Slasher address
                burnRequests[_lockerTargetAddress][_indices[i]].amount,
                burnRequests[_lockerTargetAddress][_indices[i]].sender // User address
            );

            emit BurnDispute(
                burnRequests[_lockerTargetAddress][_indices[i]].sender,
                _lockerTargetAddress,
                _lockerLockingScript,
                burnRequests[_lockerTargetAddress][_indices[i]]
                    .requestIdOfLocker
            );
        }
    }

    /// @notice Slashes a locker if they issue a tx that doesn't match any burn request
    /// @dev Input tx is a malicious tx which shows that locker spent BTC
    ///      Output tx is the tx that was spent by locker in input tx
    ///      Output tx shows money goes to locker
    ///      Input tx shows locker steals the funds
    /// @param _lockerLockingScript Suspicious locker's locking script
    /// @param _versions Versions of input and output tx
    /// @param _inputVin Inputs of the malicious transaction
    /// @param _inputVout Outputs of the malicious transaction
    /// @param _outputVin Inputs of the spent transaction
    /// @param _outputVout Outputs of the spent transaction
    /// @param _locktimes Locktimes of input and output tx
    /// @param _inputIntermediateNodes Merkle inclusion proof for the malicious transaction
    /// @param _indexesAndBlockNumbers Indices of malicious input in input tx,
    ///                                input tx in block and block number of input tx
    function disputeLocker(
        bytes memory _lockerLockingScript,
        bytes4[] memory _versions, // [inputTxVersion, outputTxVersion]
        bytes memory _inputVin,
        bytes memory _inputVout,
        bytes memory _outputVin,
        bytes memory _outputVout,
        bytes4[] memory _locktimes, // [inputTxLocktime, outputTxLocktime]
        bytes memory _inputIntermediateNodes,
        uint256[] memory _indexesAndBlockNumbers // [inputIndex, inputTxIndex, inputTxBlockNumber]
    ) external payable override nonReentrant onlyOwner {
        // Finds input tx id and checks its inclusion
        bytes32 _inputTxId = BitcoinHelper.calculateTxId(
            _versions[0],
            _inputVin,
            _inputVout,
            _locktimes[0]
        );

        BurnRouterLib.disputeAndSlashLockerHelper(
            lockers,
            _lockerLockingScript,
            _versions,
            [_inputVin, _outputVin, _outputVout],
            isUsedAsBurnProof,
            transferDeadline,
            relay,
            startingBlockNumber,
            _inputTxId,
            _locktimes,
            _inputIntermediateNodes,
            _indexesAndBlockNumbers
        );

        // Slashes locker
        _slashLockerForDispute(
            _inputVout,
            _lockerLockingScript,
            _inputTxId,
            _indexesAndBlockNumbers[2] // Block number
        );
    }

    /// @notice Burns the exchanged teleBTC
    function _swapAndUnwrap(
        uint256 _inputAmount,
        address _inputToken,
        uint256 _requestedMinOutputAmount,
        uint256 _exchangedTeleBTC,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        bytes calldata _lockerLockingScript,
        uint256 thirdParty
    ) private returns (uint256) {
        uint256 burntAmount = _unwrap(
            _inputToken,
            _inputAmount,
            _requestedMinOutputAmount,
            _exchangedTeleBTC,
            _userScript,
            _scriptType,
            _lockerLockingScript,
            thirdParty
        );

        return burntAmount;
    }

    /// @notice Burns teleBTC and records the burn request
    /// @return remainingAmount Amount of BTC that user receives
    function _unwrap(
        address _inputToken,
        uint256 _inputAmount,
        uint256 _requestedMinOutputAmount,
        uint256 _amount,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        bytes calldata _lockerLockingScript,
        uint256 thirdParty
    ) private returns (uint256 remainingAmount) {
        // Checks validity of user script
        BurnRouterLib.checkScriptTypeAndLocker(
            _userScript,
            _scriptType,
            lockers,
            _lockerLockingScript
        );
        
        // Get fees and remaining amount
        uint256[4] memory fees;
        (fees, remainingAmount) = _getFees(
            _amount, 
            _requestedMinOutputAmount, 
            _lockerLockingScript, 
            thirdParty
        );

        // Burns remaining TeleBTC
        IWETH(teleBTC).approve(lockers, remainingAmount);
        ILockersManager(lockers).burn(_lockerLockingScript, remainingAmount);

        // Get locker target address
        address _lockerTargetAddress = ILockersManager(lockers)
            .getLockerTargetAddress(_lockerLockingScript);

        _saveBurnRequest(
            _amount,
            remainingAmount,
            _userScript,
            _scriptType,
            BurnRouterLib.lastSubmittedHeight(relay),
            _lockerTargetAddress
        );

        uint256[3] memory amounts = [_inputAmount, _amount, remainingAmount];
        // To avoid stack too deep error, we define inputToken here
        address inputToken = _inputToken;

        emit NewUnwrap(
            _userScript,
            _scriptType,
            _lockerTargetAddress,
            _msgSender(),
            burnRequests[_lockerTargetAddress][
                burnRequests[_lockerTargetAddress].length - 1
            ].requestIdOfLocker, // index of request
            burnRequests[_lockerTargetAddress][
                burnRequests[_lockerTargetAddress].length - 1
            ].deadline,
            thirdParty,
            inputToken,
            amounts,
            fees
        );
    }

    /// @notice Exchanges input token for teleBTC
    /// @dev Reverts if exchange fails
    /// @return Amount of exchanged teleBTC
    function _exchange(
        address _exchangeConnector,
        uint256[] calldata _amounts,
        bool _isFixedToken,
        address[] calldata _path,
        uint256 _deadline
    ) private returns (uint256) {
        require(
            _path[_path.length - 1] == teleBTC,
            "BurnRouterLogic: invalid path"
        );
        require(_amounts.length == 2, "BurnRouterLogic: wrong amounts");

        if (msg.value != 0) {
            require(
                msg.value == _amounts[0],
                "BurnRouterLogic: invalid amount"
            );
            require(
                wrappedNativeToken == _path[0],
                "BurnRouterLogic: invalid path"
            );
            // Mint wrapped native token
            IWETH(wrappedNativeToken).deposit{value: msg.value}();
        } else {
            // Transfer user input token to contract
            IWETH(_path[0]).transferFrom(
                _msgSender(),
                address(this),
                _amounts[0]
            );
        }

        // Give approval to exchange connector
        IWETH(_path[0]).approve(_exchangeConnector, _amounts[0]);
        (bool result, uint256[] memory amounts) = IDexConnector(
            _exchangeConnector
        ).swap(
                _amounts[0],
                _amounts[1],
                _path,
                address(this),
                _deadline,
                _isFixedToken
            );
        require(result, "BurnRouterLogic: exchange failed");
        return amounts[amounts.length - 1]; // Amount of exchanged teleBTC
    }

    /// @notice Slashes the malicious locker
    /// @param _inputVout Inputs of the malicious transaction
    /// @param _lockerLockingScript Malicious locker's locking script
    /// @param _inputTxId Tx id of the malicious transaction
    /// @param _inputBlockNumber Block number of the malicious transaction
    function _slashLockerForDispute(
        bytes memory _inputVout,
        bytes memory _lockerLockingScript,
        bytes32 _inputTxId,
        uint256 _inputBlockNumber
    ) private {
        // Get the necessary data for slashing
        (
            address _lockerTargetAddress,
            uint256 slasherReward,
            uint256 totalValue
        ) = BurnRouterLib.prepareSlashLockerForDispute(
            lockers,
            _inputVout,
            _lockerLockingScript,
            slasherPercentageReward,
            MAX_PERCENTAGE_FEE
        );

        // Perform the slash operation
        ILockersManager(lockers).slashThiefLocker(
            _lockerTargetAddress,
            slasherReward,
            _msgSender(), // Slasher address
            totalValue
        );

        // Calculate total value slashed (including slasher reward)
        uint256 totalValueSlashed = totalValue + slasherReward;

        // Emits the event
        emit LockerDispute(
            _lockerTargetAddress,
            _lockerLockingScript,
            _inputBlockNumber,
            _inputTxId,
            totalValueSlashed
        );
    }

    /// @notice Checks the burn requests that get paid by this transaction
    /// @param _txId Transaction ID of the payment
    /// @param _paidBlockNumber Block number in which locker paid the burn request
    /// @param _lockerTargetAddress Address of the locker on the target chain
    /// @param _vout Outputs of a transaction
    /// @param _burnReqIndexes Indexes of requests that locker provides proof for them
    /// @param _voutIndexes Indexes of outputs that were used to pay burn requests
    /// @return paidOutputCounter Number of executed burn requests
    function _checkPaidBurnRequests(
        bytes32 _txId,
        uint256 _paidBlockNumber,
        address _lockerTargetAddress,
        bytes memory _vout,
        uint256[] memory _burnReqIndexes,
        uint256[] memory _voutIndexes
    ) private returns (uint256 paidOutputCounter) {
        paidOutputCounter = BurnRouterLib.checkPaidBurnRequests(
            burnRequests,
            _paidBlockNumber,
            _lockerTargetAddress,
            _vout,
            _burnReqIndexes,
            _voutIndexes
        );
        
        // Emit events for paid requests
        for (uint256 i = 0; i < _burnReqIndexes.length; i++) {
            uint256 _burnReqIndex = _burnReqIndexes[i];
            // Only emit for requests that were successfully processed
            if (burnRequests[_lockerTargetAddress][_burnReqIndex].isTransferred) {
                emit PaidUnwrap(
                    _lockerTargetAddress,
                    burnRequests[_lockerTargetAddress][_burnReqIndex].requestIdOfLocker,
                    _txId,
                    _voutIndexes[i]
                );
            }
        }
    }

    /// @notice Records burn request of user
    /// @param _amount Amount of wrapped token that user wants to burn
    /// @param _burntAmount Amount of wrapped token that actually gets burnt after deducting fees from the original value (_amount)
    /// @param _userScript User's Bitcoin script type
    /// @param _scriptType Script type
    /// @param _lastSubmittedHeight Last block header height submitted on the relay contract
    /// @param _lockerTargetAddress Locker's target chain address that the request belongs to
    function _saveBurnRequest(
        uint256 _amount,
        uint256 _burntAmount,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        uint256 _lastSubmittedHeight,
        address _lockerTargetAddress
    ) private {
        BurnRouterLib.saveBurnRequest(
            burnRequests,
            burnRequestCounter,
            _amount,
            _burntAmount,
            _userScript,
            _scriptType,
            _lastSubmittedHeight,
            _lockerTargetAddress,
            transferDeadline,
            _msgSender()
        );
    }

    /// @notice Checks inclusion of the transaction in the specified block
    /// @dev Calls the relay contract to check Merkle inclusion proof
    /// @param _amount The amount to be burnt
    /// @return fees [bitcoinFee, lockerFee, protocolFee, thirdPartyFee]
    /// @return remainingAmount amount after reducing fees
    function _getFees(
        uint256 _amount,
        uint256 _requestedMinOutputAmount,
        bytes memory _lockerLockingScript,
        uint256 _thirdParty
    )
        private
        returns (
            uint256[4] memory fees,
            uint256 remainingAmount
        )
    {
        // Find protocol and third-party fee
        uint256 _protocolFee = (_amount * protocolPercentageFee) / MAX_PERCENTAGE_FEE;
        uint256 _thirdPartyFee =
            (_amount * thirdPartyFee[_thirdParty]) /
            MAX_PERCENTAGE_FEE;
        uint256 _lockerFee = (_amount * lockerPercentageFee) / MAX_PERCENTAGE_FEE;

        remainingAmount = _amount - _protocolFee - _thirdPartyFee - _lockerFee - bitcoinFee;

        // Note: to avoid dust amount, we require remainingAmount to be greater than DUST_SATOSHI_AMOUNT
        require(remainingAmount >= DUST_SATOSHI_AMOUNT, "BurnRouterLogic: lower than dust");

        // User requested minimum amount
        require(remainingAmount >= _requestedMinOutputAmount, "BurnRouterLogic: lower than requested");

        // Send protocol fee
        if (_protocolFee > 0) {
            require(
                IWETH(teleBTC).transfer(treasury, _protocolFee),
                "BurnRouterLogic: fee transfer failed"
            );
        }

        // Send third party fee
        if (_thirdPartyFee > 0) {
            require(
                IWETH(teleBTC).transfer(
                    thirdPartyAddress[_thirdParty],
                    _thirdPartyFee
                ),
                "BurnRouterLogic: third party fee transfer failed"
            );
        }

        if (bitcoinFee > 0) {
            // This compensates locker for the network fee
            address _lockerTargetAddress = ILockersManager(lockers)
                .getLockerTargetAddress(_lockerLockingScript);
            require(
                IWETH(teleBTC).transfer(_lockerTargetAddress, bitcoinFee),
                "BurnRouterLogic: network fee transfer failed"
            );
        }

        if (_lockerFee > 0) {
            _sendLockerFee(
                ILockersManager(lockers).getLockerTargetAddress(_lockerLockingScript),
                _lockerFee,
                _thirdParty
            );
        }

        fees = [bitcoinFee, _lockerFee, _protocolFee, _thirdPartyFee];
    }

    function _sendLockerFee(address _locker, uint _lockerFee, uint _thirdParty) internal {
        if (_lockerFee > 0) {
            if (rewardDistributor == address(0) || _thirdParty != 0) {
                // Send reward directly to locker
                IWETH(teleBTC).transfer(_locker, _lockerFee);
            } else {
                // Call reward distributor to distribute reward
                IWETH(teleBTC).approve(rewardDistributor, _lockerFee);
                Address.functionCall(
                    rewardDistributor,
                    abi.encodeWithSignature(
                        "depositReward(address,uint256)",
                        _locker,
                        _lockerFee
                    )
                );
            }
        }
    }
}
