// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@teleportdao/btc-evm-bridge/contracts/relay/interfaces/IBitcoinRelay.sol";
import "@teleportdao/btc-evm-bridge/contracts/libraries/BitcoinHelper.sol";
import "../lockersManager/interfaces/ILockersManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../routers/BurnRouterStorage.sol";
import "../erc20/interfaces/IWETH.sol";
import "../dex_connectors/interfaces/IDexConnector.sol";

library BurnRouterLib {
    /// @notice Checks if all outputs of the transaction used to pay a cc burn request
    /// @dev  One output might return the remaining value to the locker
    /// @param _paidOutputCounter  Number of the tx outputs that pay a cc burn request
    /// @param _vout Outputs of a transaction
    /// @param _lockerLockingScript Locking script of locker
    /// @param _txId Transaction id
    function updateIsUsedAsBurnProof(
        mapping(bytes32 => bool) storage _isUsedAsBurnProof,
        uint256 _paidOutputCounter,
        bytes memory _vout,
        bytes memory _lockerLockingScript,
        bytes32 _txId
    ) external returns (bool) {
        uint256 parsedAmount = BitcoinHelper.parseValueHavingLockingScript(
            _vout,
            _lockerLockingScript
        );
        uint256 numberOfOutputs = BitcoinHelper.numberOfOutputs(_vout);

        if (
            (parsedAmount == 0 && _paidOutputCounter == numberOfOutputs) ||
            (parsedAmount != 0 && _paidOutputCounter + 1 == numberOfOutputs)
        ) {
            /* 
                Two cases are accepted:
                1. All outputs pay cc burn requests
                2. One output sends the remaining value to locker and rest pay cc burn requests
            */
            _isUsedAsBurnProof[_txId] = true;
            return true;
        }
        return false;
    }

    function disputeBurnHelper(
        mapping(address => BurnRouterStorage.burnRequest[])
            storage burnRequests,
        address _lockerTargetAddress,
        uint256 _index,
        uint256 _transferDeadline,
        uint256 _lastSubmittedHeight,
        uint256 _startingBlockNumber
    ) external {
        // Checks that locker has not provided burn proof
        require(
            !burnRequests[_lockerTargetAddress][_index].isTransferred,
            "BurnRouterLogic: already paid"
        );

        // Checks that payback deadline has passed
        require(
            burnRequests[_lockerTargetAddress][_index].deadline <
                _lastSubmittedHeight,
            "BurnRouterLogic: deadline not passed"
        );

        require(
            burnRequests[_lockerTargetAddress][_index].deadline >
                _startingBlockNumber + _transferDeadline,
            "BurnRouterLogic: old request"
        );

        // Sets "isTransferred = true" to prevent slashing the locker again
        burnRequests[_lockerTargetAddress][_index].isTransferred = true;
    }

    function disputeAndSlashLockerHelper(
        address lockers,
        bytes memory _lockerLockingScript,
        bytes4[] memory _versions, // [inputTxVersion, outputTxVersion]
        bytes[3] memory _inputOutputVinVout, // [_inputVin, _outputVin, _outputVout]
        mapping(bytes32 => bool) storage _isUsedAsBurnProof,
        uint256 _transferDeadline,
        address _relay,
        uint256 _startingBlockNumber,
        bytes32 _inputTxId,
        bytes4[] memory _locktimes, // [inputTxLocktime, outputTxLocktime]
        bytes memory _inputIntermediateNodes,
        uint256[] memory _indexesAndBlockNumbers // [inputIndex, inputTxIndex, inputTxBlockNumber]
    ) external {
        // Checks if the locking script is valid
        require(
            ILockersManager(lockers).isLocker(_lockerLockingScript),
            "BurnRouterLogic: not locker"
        );

        // Checks input array sizes
        require(
            _versions.length == 2 &&
                _locktimes.length == 2 &&
                _indexesAndBlockNumbers.length == 3,
            "BurnRouterLogic: wrong inputs"
        );

        require(
            _indexesAndBlockNumbers[2] >= _startingBlockNumber,
            "BurnRouterLogic: old request"
        );

        require(
            isConfirmed(
                _relay,
                _inputTxId,
                _indexesAndBlockNumbers[2], // Block number
                _inputIntermediateNodes,
                _indexesAndBlockNumbers[1] // Index of input tx in the block
            ),
            "BurnRouterLogic: not finalized"
        );

        /*
            Checks that input tx has not been provided as a burn proof
            note: if a locker executes a cc burn request but doesn't provide burn proof before deadline,
            we consider the transaction as a malicious tx
        */
        require(
            !_isUsedAsBurnProof[_inputTxId],
            "BurnRouterLogic: already used"
        );

        // prevents multiple slashing of locker
        _isUsedAsBurnProof[_inputTxId] = true;

        // Checks that deadline for using the tx as burn proof has passed
        require(
            lastSubmittedHeight(_relay) >
                _transferDeadline + _indexesAndBlockNumbers[2],
            "BurnRouterLogic: deadline not passed"
        );

        // Extracts outpoint id and index from input tx
        (bytes32 _outpointId, uint256 _outpointIndex) = BitcoinHelper
            .extractOutpoint(
                _inputOutputVinVout[0],
                _indexesAndBlockNumbers[0] // Index of malicious input in input tx
            );

        // Checks that "outpoint tx id == output tx id"
        require(
            _outpointId ==
                BitcoinHelper.calculateTxId(
                    _versions[1],
                    _inputOutputVinVout[1],
                    _inputOutputVinVout[2],
                    _locktimes[1]
                ),
            "BurnRouterLogic: wrong output tx"
        );

        // Checks that _outpointIndex of _outpointId belongs to locker locking script
        require(
            keccak256(
                BitcoinHelper.getLockingScript(
                    _inputOutputVinVout[2],
                    _outpointIndex
                )
            ) == keccak256(_lockerLockingScript),
            "BurnRouterLogic: not for locker"
        );
    }

    function burnProofHelper(
        uint256 _blockNumber,
        uint256 startingBlockNumber,
        bytes4 _locktime,
        address lockers,
        bytes memory _lockerLockingScript,
        uint256 _burnReqIndexesLength,
        uint256 _voutIndexesLength
    ) external view {
        require(
            _blockNumber >= startingBlockNumber,
            "BurnRouterLogic: old request"
        );
        // Checks that locker's tx doesn't have any locktime
        require(_locktime == bytes4(0), "BurnRouterLogic: non-zero lock time");

        // Checks if the locking script is valid
        require(
            ILockersManager(lockers).isLocker(_lockerLockingScript),
            "BurnRouterLogic: not locker"
        );

        require(
            _burnReqIndexesLength == _voutIndexesLength,
            "BurnRouterLogic: wrong indexes"
        );
    }

    /// @notice Checks inclusion of the transaction in the specified block
    /// @dev Calls the relay contract to check Merkle inclusion proof
    /// @param _relay Address of Relay contract
    /// @param _txId of the transaction
    /// @param _blockNumber Height of the block containing the transaction
    /// @param _intermediateNodes Merkle inclusion proof for the transaction
    /// @param _index Index of transaction in the block
    /// @return True if the transaction was included in the block
    function isConfirmed(
        address _relay,
        bytes32 _txId,
        uint256 _blockNumber,
        bytes memory _intermediateNodes,
        uint256 _index
    ) public returns (bool) {
        // Finds fee amount
        uint256 feeAmount = getFinalizedBlockHeaderFee(_relay, _blockNumber);
        require(msg.value >= feeAmount, "BitcoinRelay: low fee");

        // Calls relay contract
        bytes memory data = Address.functionCallWithValue(
            _relay,
            abi.encodeWithSignature(
                "checkTxProof(bytes32,uint256,bytes,uint256)",
                _txId,
                _blockNumber,
                _intermediateNodes,
                _index
            ),
            feeAmount
        );

        // Sends extra ETH back to msg.sender
        Address.sendValue(payable(msg.sender), msg.value - feeAmount);

        return abi.decode(data, (bool));
    }

    /// @notice Checks the user hash script to be valid (based on its type)
    function checkScriptTypeAndLocker(
        bytes memory _userScript,
        ScriptTypes _scriptType,
        address lockers,
        bytes calldata _lockerLockingScript
    ) external view {
        if (
            _scriptType == ScriptTypes.P2PK ||
            _scriptType == ScriptTypes.P2WSH ||
            _scriptType == ScriptTypes.P2TR
        ) {
            require(
                _userScript.length == 32,
                "BurnRouterLogic: invalid script"
            );
        } else {
            require(
                _userScript.length == 20,
                "BurnRouterLogic: invalid script"
            );
        }

        // Checks if the given locking script is locker
        require(
            ILockersManager(lockers).isLocker(_lockerLockingScript),
            "BurnRouterLogic: not locker"
        );
    }

    function lastSubmittedHeight(address _relay) public view returns (uint256) {
        return IBitcoinRelay(_relay).lastSubmittedHeight();
    }

    function finalizationParameter(
        address _relay
    ) external view returns (uint256) {
        return IBitcoinRelay(_relay).finalizationParameter();
    }

    function getFinalizedBlockHeaderFee(
        address _relay,
        uint256 _blockNumber
    ) public view returns (uint256) {
        return IBitcoinRelay(_relay).getBlockHeaderFee(_blockNumber, 0);
    }

    /// @notice Records burn request of user
    /// @param _burnRequests Array of burn requests for the locker
    /// @param _burnRequestCounter Counter of burn requests for the locker
    /// @param _amount Amount of wrapped token that user wants to burn
    /// @param _burntAmount Amount of wrapped token that actually gets burnt after deducting fees from the original value (_amount)
    /// @param _userScript User's Bitcoin script type
    /// @param _scriptType User's Bitcoin script type
    /// @param _lastSubmittedHeight Last block header height submitted on the relay contract
    /// @param _lockerTargetAddress Locker's target chain address that the request belongs to
    /// @param _transferDeadline Deadline for the transfer
    /// @param _sender Address of the sender
    /// @return requestId The ID of the created burn request
    function saveBurnRequest(
        mapping(address => BurnRouterStorage.burnRequest[]) storage _burnRequests,
        mapping(address => uint256) storage _burnRequestCounter,
        uint256 _amount,
        uint256 _burntAmount,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        uint256 _lastSubmittedHeight,
        address _lockerTargetAddress,
        uint256 _transferDeadline,
        address _sender
    ) external returns (uint256 requestId) {
        BurnRouterStorage.burnRequest memory request;
        request.amount = _amount;
        request.burntAmount = _burntAmount;
        request.sender = _sender;
        request.userScript = _userScript;
        request.scriptType = _scriptType;
        request.deadline = _lastSubmittedHeight + _transferDeadline;
        request.isTransferred = false;
        request.requestIdOfLocker = _burnRequestCounter[_lockerTargetAddress];
        
        requestId = _burnRequestCounter[_lockerTargetAddress];
        _burnRequestCounter[_lockerTargetAddress] = _burnRequestCounter[_lockerTargetAddress] + 1;
        _burnRequests[_lockerTargetAddress].push(request);
        
        return requestId;
    }

    /// @notice Checks the burn requests that get paid by this transaction
    /// @param _burnRequests Array of burn requests for the locker
    /// @param _paidBlockNumber Block number in which locker paid the burn request
    /// @param _lockerTargetAddress Address of the locker on the target chain
    /// @param _vout Outputs of a transaction
    /// @param _burnReqIndexes Indexes of requests that locker provides proof for them
    /// @param _voutIndexes Indexes of outputs that were used to pay burn requests
    /// @return paidOutputCounter Number of executed burn requests
    function checkPaidBurnRequests(
        mapping(address => BurnRouterStorage.burnRequest[]) storage _burnRequests,
        uint256 _paidBlockNumber,
        address _lockerTargetAddress,
        bytes memory _vout,
        uint256[] memory _burnReqIndexes,
        uint256[] memory _voutIndexes
    ) external returns (uint256 paidOutputCounter) {
        uint256 parsedAmount;
        /*
            Below variable is for checking that every output in vout (except one)
            is related to a cc burn request so that we can
            set "isUsedAsBurnProof = true" for the whole txId
        */
        paidOutputCounter = 0;
        uint256 tempVoutIndex;

        for (uint256 i = 0; i < _burnReqIndexes.length; i++) {
            // prevent from sending repeated vout indexes
            if (i == 0) {
                tempVoutIndex = _voutIndexes[i];
            } else {
                // get vout indexes in increasing order to get sure there is no duplicate
                require(
                    _voutIndexes[i] > tempVoutIndex,
                    "BurnRouterLogic: un-sorted vout indexes"
                );

                tempVoutIndex = _voutIndexes[i];
            }

            uint256 _burnReqIndex = _burnReqIndexes[i];
            // Checks that the request has not been paid and its deadline has not passed
            if (
                !_burnRequests[_lockerTargetAddress][_burnReqIndex].isTransferred &&
                _burnRequests[_lockerTargetAddress][_burnReqIndex].deadline >= _paidBlockNumber
            ) {
                parsedAmount = BitcoinHelper.parseValueFromSpecificOutputHavingScript(
                    _vout,
                    _voutIndexes[i],
                    _burnRequests[_lockerTargetAddress][_burnReqIndex].userScript,
                    _burnRequests[_lockerTargetAddress][_burnReqIndex].scriptType
                );
                
                // Checks that locker has sent required teleBTC amount
                if (
                    _burnRequests[_lockerTargetAddress][_burnReqIndex].burntAmount == parsedAmount
                ) {
                    _burnRequests[_lockerTargetAddress][_burnReqIndex].isTransferred = true;
                    paidOutputCounter = paidOutputCounter + 1;
                }
            }
        }
    }

    /// @notice Exchanges input token for teleBTC
    /// @dev Moved from BurnRouterLogic to reduce contract size
    function exchange(
        address _teleBTC,
        address _wrappedNativeToken,
        address _exchangeConnector,
        uint256[] memory _amounts,
        bool _isFixedToken,
        address[] memory _path,
        uint256 _deadline
    ) external returns (uint256) {
        require(
            _path[_path.length - 1] == _teleBTC,
            "BurnRouterLogic: invalid path"
        );
        require(_amounts.length == 2, "BurnRouterLogic: wrong amounts");

        if (msg.value != 0) {
            require(
                msg.value == _amounts[0],
                "BurnRouterLogic: invalid amount"
            );
            require(
                _wrappedNativeToken == _path[0],
                "BurnRouterLogic: invalid path"
            );
            // Mint wrapped native token
            IWETH(_wrappedNativeToken).deposit{value: msg.value}();
        } else {
            // Transfer user input token to contract
            IWETH(_path[0]).transferFrom(
                msg.sender,
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

    /// @notice Prepares data for slashing the malicious locker
    /// @param lockers Address of lockers contract
    /// @param _inputVout Inputs of the malicious transaction
    /// @param _lockerLockingScript Malicious locker's locking script
    /// @param _slasherPercentageReward Percentage of reward for slasher
    /// @param _MAX_PERCENTAGE_FEE Maximum percentage fee
    /// @return _lockerTargetAddress Address of the locker to slash
    /// @return slasherReward Reward amount for the slasher
    /// @return totalValue Total value to slash
    function prepareSlashLockerForDispute(
        address lockers,
        bytes memory _inputVout,
        bytes memory _lockerLockingScript,
        uint256 _slasherPercentageReward,
        uint256 _MAX_PERCENTAGE_FEE
    ) external view returns (
        address _lockerTargetAddress,
        uint256 slasherReward,
        uint256 totalValue
    ) {
        // Finds total value of malicious transaction
        totalValue = BitcoinHelper.parseOutputsTotalValue(_inputVout);

        // Gets the target address of the locker from its Bitcoin address
        _lockerTargetAddress = ILockersManager(lockers)
            .getLockerTargetAddress(_lockerLockingScript);

        slasherReward = (totalValue * _slasherPercentageReward) / _MAX_PERCENTAGE_FEE;
        
        return (_lockerTargetAddress, slasherReward, totalValue);
    }
}
