// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./CcTransferRouterStorage.sol";
import "./CcTransferRouterStorageV2.sol";
import "./RequestParser.sol";
import "../lockersManager/interfaces/ILockersManager.sol";
import "../erc20/interfaces/ITeleBTC.sol";
import "@teleportdao/btc-evm-bridge/contracts/libraries/BitcoinHelper.sol";
import "@teleportdao/btc-evm-bridge/contracts/relay/interfaces/IBitcoinRelay.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract CcTransferRouterLogic is
    CcTransferRouterStorage,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    CcTransferRouterStorageV2
{
    error ZeroAddress();

    modifier nonZeroAddress(address _address) {
        if (_address == address(0)) revert ZeroAddress();
        _;
    }

    /// @notice Gives default params to initiate cc transfer router
    /// @param _startingBlockNumber Requests that are included in a block older than _startingBlockNumber cannot be executed
    /// @param _protocolPercentageFee Percentage amount of protocol fee (min: %0.01)
    /// @param _chainId Id of the underlying chain
    /// @param _appId Id of ccTransfer dApp
    /// @param _relay The Relay address to validate data from source chain
    /// @param _lockers Lockers' contract address
    /// @param _teleBTC TeleportDAO BTC ERC20 token address
    /// @param _treasury Address of treasury that collects protocol fees
    function initialize(
        uint256 _startingBlockNumber,
        uint256 _protocolPercentageFee,
        uint256 _lockerPercentageFee,
        uint256 _chainId,
        uint256 _appId,
        address _relay,
        address _lockers,
        address _teleBTC,
        address _treasury
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        chainId = _chainId;
        appId = _appId;
        _setStartingBlockNumber(_startingBlockNumber);
        _setProtocolPercentageFee(_protocolPercentageFee);
        _setLockerPercentageFee(_lockerPercentageFee);
        _setRelay(_relay);
        _setLockers(_lockers);
        _setTeleBTC(_teleBTC);
        _setTreasury(_treasury);
    }

    function renounceOwnership() public virtual override onlyOwner {}

    ///@notice Setter for starting block number
    function setStartingBlockNumber(uint256 _startingBlockNumber)
        external
        override
        onlyOwner
    {
        _setStartingBlockNumber(_startingBlockNumber);
    }

    /// @notice Setter for protocol percentage fee
    /// @dev Only owner can call this
    /// @param _protocolPercentageFee Percentage amount of protocol fee
    function setProtocolPercentageFee(uint256 _protocolPercentageFee)
        external
        override
        onlyOwner
    {
        _setProtocolPercentageFee(_protocolPercentageFee);
    }

    /// @notice Setter for locker percentage fee
    /// @dev Only owner can call this
    /// @param _lockerPercentageFee Percentage amount of locker fee
    function setLockerPercentageFee(uint256 _lockerPercentageFee)
        external
        override
        onlyOwner 
    {
        _setLockerPercentageFee(_lockerPercentageFee);
    }

    /// @notice Setter for relay
    /// @dev Only owner can call this
    /// @param _relay Address of the relay contract
    function setRelay(address _relay)
        external
        override
        onlyOwner
    {
        _setRelay(_relay);
    }

    /// @notice Setter for lockers
    /// @dev Only owner can call this
    /// @param _lockers Address of the lockers contract
    function setLockers(address _lockers)
        external
        override
        onlyOwner
    {
        _setLockers(_lockers);
    }

    /// @notice Setter for teleBTC
    /// @dev Only owner can call this
    /// @param _teleBTC TeleportDAO BTC ERC20 token address
    function setTeleBTC(address _teleBTC)
        external
        override
        onlyOwner
    {
        _setTeleBTC(_teleBTC);
    }

    /// @notice Setter for treasury
    /// @dev Only owner can call this
    /// @param _treasury Treasury address
    function setTreasury(address _treasury)
        external
        override
        onlyOwner
    {
        _setTreasury(_treasury);
    }

    /// @notice Setter for third party address
    /// @dev Only owner can call this
    /// @param _thirdPartyAddress third party address
    function setThirdPartyAddress(
        uint256 _thirdPartyId,
        address _thirdPartyAddress
    ) external override onlyOwner {
        _setThirdPartyAddress(_thirdPartyId, _thirdPartyAddress);
    }

    /// @notice Setter for third party fee
    /// @dev Only owner can call this
    /// @param _thirdPartyFee third party fee
    function setThirdPartyFee(uint256 _thirdPartyId, uint256 _thirdPartyFee)
        external
        override
        onlyOwner
    {
        _setThirdPartyFee(_thirdPartyId, _thirdPartyFee);
    }

    /// @notice Setter for reward distributor
    /// @dev This contract distributes locker fee between locker and stakers
    function setRewardDistributor(
        address _rewardDistributor
    ) external override onlyOwner {
        rewardDistributor = _rewardDistributor;
    }

    /// @notice Setter for teleporter
    function setTeleporter(
        address _teleporter, 
        bool _isTeleporter
    ) external override onlyOwner {
        isTeleporter[_teleporter] = _isTeleporter;
    }

    ///@notice Internal setter for protocol percentage fee
    ///@param _protocolPercentageFee Percentage amount of protocol fee
    function _setProtocolPercentageFee(uint256 _protocolPercentageFee) private {
        require(
            MAX_PERCENTAGE_FEE >= _protocolPercentageFee,
            "CCTransferRouter: protocol fee is out of range"
        );
        emit NewProtocolPercentageFee(
            protocolPercentageFee,
            _protocolPercentageFee
        );
        protocolPercentageFee = _protocolPercentageFee;
    }

    ///@notice Internal setter for locker percentage fee
    ///@param _lockerPercentageFee Percentage amount of locker fee
    function _setLockerPercentageFee(uint256 _lockerPercentageFee) private {
        require(
            MAX_PERCENTAGE_FEE >= _lockerPercentageFee,
            "CCTransferRouter: locker fee is out of range"
        );
        lockerPercentageFee = _lockerPercentageFee;
    }
    
    ///@notice Internal setter for starting block number
    function _setStartingBlockNumber(uint256 _startingBlockNumber) private {
        require(
            _startingBlockNumber > startingBlockNumber,
            "CCTransferRouter: low startingBlockNumber"
        );
        startingBlockNumber = _startingBlockNumber;
    }

    ///@notice Internal setter for relay
    ///@param _relay Address of the relay contract
    function _setRelay(address _relay) private nonZeroAddress(_relay) {
        emit NewRelay(relay, _relay);
        relay = _relay;
    }

    ///@notice Internal setter for relay
    ///@param _lockers Address of the lockers contract
    function _setLockers(address _lockers) private nonZeroAddress(_lockers) {
        emit NewLockers(lockers, _lockers);
        lockers = _lockers;
    }

    ///@notice Internal setter for teleBTC
    ///@param _teleBTC TeleportDAO BTC ERC20 token address
    function _setTeleBTC(address _teleBTC) private nonZeroAddress(_teleBTC) {
        emit NewTeleBTC(teleBTC, _teleBTC);
        teleBTC = _teleBTC;
    }

    ///@notice Internal setter for treasury
    ///@param _treasury Treasury address
    function _setTreasury(address _treasury) private nonZeroAddress(_treasury) {
        emit NewTreasury(treasury, _treasury);
        treasury = _treasury;
    }

    ///@notice Internal setter for third party address
    ///@param _thirdPartyAddress third party address
    function _setThirdPartyAddress(
        uint256 _thirdPartyId,
        address _thirdPartyAddress
    ) private {
        emit NewThirdPartyAddress(
            _thirdPartyId,
            thirdPartyAddress[_thirdPartyId],
            _thirdPartyAddress
        );
        thirdPartyAddress[_thirdPartyId] = _thirdPartyAddress;
    }

    ///@notice Internal setter for third party fee
    ///@param _thirdPartyFee third party fee
    function _setThirdPartyFee(uint256 _thirdPartyId, uint256 _thirdPartyFee)
        private
    {
        emit NewThirdPartyFee(
            _thirdPartyId,
            thirdPartyFee[_thirdPartyId],
            _thirdPartyFee
        );
        thirdPartyFee[_thirdPartyId] = _thirdPartyFee;
    }

    ///@notice Check if the request has been executed before
    ///@dev This is to avoid re-submitting a used request
    ///@param _txId The txId of request on the source chain
    ///@return True if the request has been executed
    function isRequestUsed(bytes32 _txId)
        external
        view
        override
        returns (bool)
    {
        return ccTransferRequests[_txId].isUsed ? true : false;
    }

    /// @notice Executes the cross chain transfer request
    /// @dev Validates the transfer request, then,
    /// if speed is 1, the request is instant
    /// which pays back the loan,
    /// if the speed is 0, it is a normal transfer
    /// @param _txAndProof Transaction and merkle proof data
    /// @param _lockerLockingScript Locking script of locker that user has sent BTC to it
    /// @return True if the transfer is successful
    function wrap(
        TxAndProof memory _txAndProof,
        bytes calldata _lockerLockingScript
    ) external payable override nonReentrant returns (bool) {
        require(
            isTeleporter[_msgSender()],
            "CCTransferRouter: invalid sender"
        );
        require(
            _txAndProof.blockNumber >= startingBlockNumber,
            "CCTransferRouter: request is too old"
        );

        // Finds txId on the source chain
        bytes32 txId = BitcoinHelper.calculateTxId(
            _txAndProof.version,
            _txAndProof.vin,
            _txAndProof.vout,
            _txAndProof.locktime
        );

        require(
            !ccTransferRequests[txId].isUsed,
            "CCTransferRouter: request has been used before"
        );

        require(
            _txAndProof.locktime == bytes4(0),
            "CCTransferRouter: lock time is non -zero"
        );

        // Extracts information from the request
        _saveCCTransferRequest(_lockerLockingScript, _txAndProof.vout, txId);

        // Checks if tx has been confirmed on source chain
        require(
            _isConfirmed(
                txId,
                _txAndProof.blockNumber,
                _txAndProof.intermediateNodes,
                _txAndProof.index
            ),
            "CCTransferRouter: transaction has not been finalized yet"
        );

        // Normal cc transfer request
        (
            uint256 receivedAmount,
            uint256 _protocolFee,
            uint256 _networkFee,
            uint256 _thirdPartyFee,
            uint256 _lockerFee
        ) = _sendTeleBTC(_lockerLockingScript, txId);

        emit NewWrap(
            txId,
            _lockerLockingScript,
            ILockersManager(lockers).getLockerTargetAddress(
                _lockerLockingScript
            ),
            ccTransferRequests[txId].recipientAddress,
            _msgSender(),
            [ccTransferRequests[txId].inputAmount, receivedAmount],
            [_networkFee, _lockerFee, _protocolFee, _thirdPartyFee],
            thirdParty[txId],
            chainId
        );
        return true;
    }

    /// @notice Sends minted teleBTC to the user
    /// @param _lockerLockingScript Locker's locking script
    /// @param _txId The transaction ID of the request
    /// @return _remainedAmount Amount of teleBTC that user receives after reducing fees
    function _sendTeleBTC(bytes memory _lockerLockingScript, bytes32 _txId)
        private
        returns (
            uint256 _remainedAmount,
            uint256 _protocolFee,
            uint256 _networkFee,
            uint256 _thirdPartyFee,
            uint256 _lockerFee
        )
    {
        // Gets remained amount after reducing fees
        (
            _remainedAmount,
            _protocolFee,
            _networkFee,
            _thirdPartyFee,
            _lockerFee
        ) = _mintAndReduceFees(_lockerLockingScript, _txId);

        // Transfers rest of tokens to recipient
        ITeleBTC(teleBTC).transfer(
            ccTransferRequests[_txId].recipientAddress,
            _remainedAmount
        );
    }

    ///@notice Parses and saves the request
    ///@dev Checks that user has sent BTC to a valid locker
    ///@param _lockerLockingScript Locker's locking script
    ///@param _vout The outputs of the tx
    ///@param _txId The txID of the request
    function _saveCCTransferRequest(
        bytes memory _lockerLockingScript,
        bytes memory _vout,
        bytes32 _txId
    ) private {
        /*  
            transfer requests structure:
            1) chainId, 2 byte: max 65535 chains
            2) appId, 1 byte: max 256 apps
            3) recipientAddress, 20 or 32 byte: EVM account or Solana account
            4) networkFee, 3 byte
            5) SPEED, 1 byte: {0,1}
            6) thirdParty, 1 byte: max 256 third parties, default is 0 for no third party
            
            TOTAL = 28 BYTE or 40 BYTE
        */

        require(
            ILockersManager(lockers).isLocker(_lockerLockingScript),
            "CCTransferRouter: no locker with the given locking script exists"
        );

        // Extracts value and opreturn data from request
        ccTransferRequest memory request; // Defines it to save gas
        bytes memory arbitraryData;

        (request.inputAmount, arbitraryData) = BitcoinHelper
            .parseValueAndDataHavingLockingScriptSmallPayload(
                _vout,
                _lockerLockingScript
            );

        require(
            arbitraryData.length == 28 || 
            arbitraryData.length == 40, 
            "CCTransferRouter: invalid len"
        );

        // Checks that input amount is not zero
        require(
            request.inputAmount > 0,
            "CCTransferRouter: input amount is zero"
        );

        // Checks chain id and app id (extracted in order: 1) chainId, 2) appId)
        require(
            RequestParser.parseChainId(arbitraryData) == chainId,
            "CCTransferRouter: chain id is not correct"
        );
        require(
            RequestParser.parseAppId(arbitraryData) == appId,
            "CCTransferRouter: app id is not correct"
        );

        if (arbitraryData.length == 28) {
            // Extract in order: 3) recipientAddress, 4) networkFee, 5) speed, 6) thirdParty
            request.recipientAddress = RequestParser.parseRecipientAddress(
                arbitraryData
            );
            request.fee = RequestParser.parseNetworkFee(arbitraryData);
            request.speed = RequestParser.parseSpeed(arbitraryData);
            thirdParty[_txId] = RequestParser.parseThirdPartyId(arbitraryData);
        } else if (arbitraryData.length == 40) {
            // Extract in order: 3) recipientAddress, 4) networkFee, 5) speed, 6) thirdParty
            // Convert bytes32 to address (extracts lower 20 bytes from left-padded 32-byte field)
            request.recipientAddress = address(
                uint160(uint256(RequestParser.parseRecipientDestAddress(arbitraryData)))
            );
            request.fee = RequestParser.parseNetworkFeeNew(arbitraryData);
            request.speed = RequestParser.parseSpeedNew(arbitraryData);
            thirdParty[_txId] = RequestParser.parseThirdPartyID(arbitraryData);
        }

        require(
            request.fee <= request.inputAmount,
            "CCTransferRouter: wrong fee"
        );

        require(request.speed == 0, "CCTransferRouter: speed is out of range");

        // Marks the request as used
        request.isUsed = true;

        // Saves the request data
        ccTransferRequests[_txId] = request;
    }


    /// @notice Checks if tx has been finalized on source chain
    /// @dev Pays relay fee using included ETH in the transaction
    /// @param _txId The request tx
    /// @param _blockNumber The block number of the tx
    /// @param _intermediateNodes Merkle proof for tx
    /// @param _index Index of tx in the block
    /// @return True if the tx is finalized on the source chain
    function _isConfirmed(
        bytes32 _txId,
        uint256 _blockNumber,
        bytes memory _intermediateNodes,
        uint256 _index
    ) private returns (bool) {
        // Calculates fee amount
        uint256 feeAmount = IBitcoinRelay(relay).getBlockHeaderFee(
            _blockNumber,
            0
        ); // Index 0 is for finalized blocks
        require(
            msg.value >= feeAmount,
            "CCTransferRouter: paid fee is not sufficient"
        );

        // Calls relay contract (transfers all msg.value to it)
        bytes memory data = Address.functionCallWithValue(
            relay,
            abi.encodeWithSignature(
                "checkTxProof(bytes32,uint256,bytes,uint256)",
                _txId,
                _blockNumber,
                _intermediateNodes,
                _index
            ),
            feeAmount
        );

        // Sends extra ETH back to _msgSender()
        Address.sendValue(payable(_msgSender()), msg.value - feeAmount);

        return abi.decode(data, (bool));
    }

    /// @notice                       Mints teleBTC by calling lockers contract
    /// @param _lockerLockingScript   Locker's locking script
    /// @param _txId                  The transaction ID of the request
    /// @return _remainedAmount       Amount of teleBTC that user receives after reducing all fees (protocol, locker, teleporter)
    function _mintAndReduceFees(
        bytes memory _lockerLockingScript,
        bytes32 _txId
    )
        private
        returns (
            uint256 _remainedAmount,
            uint256 _protocolFee,
            uint256 _networkFee,
            uint256 _thirdPartyFee,
            uint256 _lockerFee
        )
    {
        // Mints TeleBTC for cc transfer router
        ILockersManager(lockers).mint(
            _lockerLockingScript,
            address(this),
            ccTransferRequests[_txId].inputAmount
        );

        // Calculates fees (protocol, network, third party, locker)
        _protocolFee = (ccTransferRequests[_txId].inputAmount * protocolPercentageFee) / MAX_PERCENTAGE_FEE;
        _networkFee = ccTransferRequests[_txId].fee;
        _thirdPartyFee = (ccTransferRequests[_txId].inputAmount * thirdPartyFee[thirdParty[_txId]]) / MAX_PERCENTAGE_FEE;
        _lockerFee = (ccTransferRequests[_txId].inputAmount * lockerPercentageFee) / MAX_PERCENTAGE_FEE;

        // Pays Teleporter fee
        if (_networkFee > 0) {
            ITeleBTC(teleBTC).transfer(_msgSender(), _networkFee);
        }

        // Pays protocol fee
        if (_protocolFee > 0) {
            ITeleBTC(teleBTC).transfer(treasury, _protocolFee);
        }

        // Pays third party fee
        if (_thirdPartyFee > 0) {
            ITeleBTC(teleBTC).transfer(
                thirdPartyAddress[thirdParty[_txId]],
                _thirdPartyFee
            );
        }

        // Pays locker fee
        if (_lockerFee > 0) {
            _sendLockerFee(
                ILockersManager(lockers).getLockerTargetAddress(
                    _lockerLockingScript
                ),
                _lockerFee,
                thirdParty[_txId]
            );
        }

        _remainedAmount =
            ccTransferRequests[_txId].inputAmount -
            _protocolFee -
            _networkFee -
            _thirdPartyFee -
            _lockerFee;
    }

    function _sendLockerFee(address _locker, uint _lockerFee, uint _thirdParty) internal {
        if (_lockerFee > 0) {
            if (rewardDistributor == address(0) || _thirdParty != 0) {
                // Send reward directly to locker
                ITeleBTC(teleBTC).transfer(_locker, _lockerFee);
            } else {
                // Call reward distributor to distribute reward
                ITeleBTC(teleBTC).approve(rewardDistributor, _lockerFee);
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

    receive() external payable {}
}
