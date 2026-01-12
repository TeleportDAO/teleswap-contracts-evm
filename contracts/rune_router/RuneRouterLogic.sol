// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./RuneRouterStorage.sol";
import "./RuneRouterLib.sol";
import "../erc20/interfaces/IRune.sol";
import "../dex_connectors/interfaces/IDexConnector.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@across-protocol/contracts-v2/contracts/interfaces/SpokePoolInterface.sol";

contract RuneRouterLogic is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    RuneRouterStorage
{
    /// @notice Initialize the contract
    /// @param _startingBlockNumber Requests included in a block older than _startingBlockNumber cannot be processed
    /// @param _protocolPercentageFee Percentage amount of protocol fee (min: %0.01)
    /// @param _chainId Id of the underlying chain
    /// @param _relay Bitcoin bridge address which validates Bitcoin tx
    /// @param _treasury Address of treasury that collects protocol fees
    function initialize(
        uint _startingBlockNumber,
        uint _protocolPercentageFee,
        uint _lockerPercentageFee,
        uint _chainId,
        address _relay,
        address _locker,
        bytes memory _lockerLockingScript,
        ScriptTypes _lockerScriptType,
        address _teleporter,
        address _treasury,
        address _wrappedNativeToken
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        chainId = _chainId;
        setStartingBlockNumber(_startingBlockNumber);
        setProtocolPercentageFee(_protocolPercentageFee);
        setLockerPercentageFee(_lockerPercentageFee);
        setRelay(_relay);
        setLocker(_locker);
        setLockerLockingScript(_lockerLockingScript, _lockerScriptType);
        setTeleporter(_teleporter);
        setTreasury(_treasury);
        setWrappedNativeToken(_wrappedNativeToken);
    }

    receive() external payable {}

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice Check if the wrap request has been processed before
    /// @param _txId of the request on Bitcoin
    function isWrapRequestProcessed(
        bytes32 _txId
    ) external view override returns (bool) {
        return runeWrapRequests[_txId].isUsed ? true : false;
    }

    /// @notice Check if the unwrap request has been processed before
    function isUnwrapRequestProcessed(
        uint _reqIdx
    ) external view override returns (bool) {
        return runeUnwrapRequests[_reqIdx].isProcessed ? true : false;
    }

    function totalRuneUnwrapRequests() external view override returns (uint) {
        return runeUnwrapRequests.length;
    }

    /// @notice Setter for reward distributor
    /// @dev This contract distributes locker fee between locker and stakers
    function setRewardDistributor(
        address _rewardDistributor
    ) external override onlyOwner {
        rewardDistributor = _rewardDistributor;
    }

    /// @notice Setter for locker locking script
    function setLockerLockingScript(
        bytes memory _lockerLockingScript,
        ScriptTypes _lockerScriptType
    ) public override onlyOwner {
        lockerLockingScript = _lockerLockingScript;
        lockerScriptType = _lockerScriptType;
    }

    /// @notice Setter for starting block number
    function setStartingBlockNumber(
        uint _startingBlockNumber
    ) public override onlyOwner {
        require(
            _startingBlockNumber > startingBlockNumber,
            "Router: low number"
        );
        startingBlockNumber = _startingBlockNumber;
    }

    /// @notice Setter for protocol percentage fee
    function setProtocolPercentageFee(
        uint _protocolPercentageFee
    ) public override onlyOwner {
        require(
            MAX_PROTOCOL_FEE >= _protocolPercentageFee,
            "Router: out of range"
        );
        emit NewProtocolPercentageFee(
            protocolPercentageFee,
            _protocolPercentageFee
        );
        protocolPercentageFee = _protocolPercentageFee;
    }

    /// @notice Setter for locker percentage fee
    function setLockerPercentageFee(
        uint _lockerPercentageFee
    ) public override onlyOwner {
        require(
            MAX_PROTOCOL_FEE >= _lockerPercentageFee,
            "Router: out of range"
        );
        emit NewLockerPercentageFee(lockerPercentageFee, _lockerPercentageFee);
        lockerPercentageFee = _lockerPercentageFee;
    }

    /// @notice Setter for Bitcoin relay
    function setRelay(address _relay) public override onlyOwner {
        relay = _relay;
    }

    /// @notice Setter for locker
    function setLocker(address _locker) public override onlyOwner {
        emit NewLocker(locker, _locker);
        locker = _locker;
    }

    /// @notice Setter for teleporter
    function setTeleporter(address _teleporter) public override onlyOwner {
        emit NewTeleporter(teleporter, _teleporter);
        teleporter = _teleporter;
    }

    /// @notice Setter for treasury
    function setTreasury(address _treasury) public override onlyOwner {
        treasury = _treasury;
    }

    /// @notice Set exchange connector for appId
    /// @dev If address(0) is set for an appId, that appId is inactive
    function setExchangeConnector(
        uint _appId,
        address _exchangeConnector
    ) external override onlyOwner {
        exchangeConnector[_appId] = _exchangeConnector;
    }

    /// @notice Setter for third party address and fee
    function setThirdParty(
        uint _thirdPartyId,
        address _thirdPartyAddress,
        uint _thirdPartyFee
    ) external override onlyOwner {
        emit ThirdPartyInfoUpdated(
            _thirdPartyId,
            thirdParties[_thirdPartyId].thirdPartyAddress,
            thirdParties[_thirdPartyId].thirdPartyFee,
            _thirdPartyAddress,
            _thirdPartyFee
        );

        thirdParty memory _thirdParty;
        _thirdParty.thirdPartyAddress = _thirdPartyAddress;
        _thirdParty.thirdPartyFee = _thirdPartyFee;
        thirdParties[_thirdPartyId] = _thirdParty;
    }

    /// @notice Setter for chainId
    function setChainId(uint _chainId) public override onlyOwner {
        chainId = _chainId;
    }

    /// @notice Setter for wrapped native token
    function setWrappedNativeToken(
        address _wrappedNativeToken
    ) public override onlyOwner {
        wrappedNativeToken = _wrappedNativeToken;
    }

    /// @notice Virtual locker is introduced bcz of reward distribution contract
    function setVirtualLocker(
        address _wrappedRune,
        address _virtualLocker
    ) external override onlyOwner {
        virtualLocker[_wrappedRune] = _virtualLocker;
    }

    /// @notice Setter for across contract
    function setAcross(address _across) external override onlyOwner {
        across = _across;
    }

    /// @notice Setter for Across Admin
    function setAcrossAdmin(address _acrossAdmin) external onlyOwner {
        acrossAdmin = _acrossAdmin;
    }

    /// @notice Setter for bridge token mapping
    /// @param _sourceToken Address of the token on the current chain
    /// @param _destinationToken Address of the token on the target chain
    function setBridgeTokenMapping(
        address _sourceToken,
        uint256 _destinationChainId,
        address _destinationToken
    ) external override onlyOwner {
        bridgeTokenMapping[_sourceToken][_destinationChainId] = _destinationToken;
    }

    /// @notice Deploy wrapped Rune token contract
    /// @dev We assign tokenId to a supported Rune
    /// @param _runeId Real rune id
    /// @param _internalId Internal id
    function addRune(
        string memory _name,
        string memory _symbol,
        string memory _runeId,
        uint8 _decimal,
        uint _internalId
    ) external override onlyOwner {
        // Cannot assign to a used tokenId
        require(supportedRunes[_internalId] == address(0), "Router: used id");

        // Deploy logic contract
        address wRuneLogic = RuneRouterLib.addRuneHelper();

        bytes memory nullData;
        WRuneProxy _wRuneProxy = new WRuneProxy(wRuneLogic, owner(), nullData);
        // ^^ We set current owner as the proxy admin

        address wRuneProxy = address(_wRuneProxy);

        // Initialize proxy (logic owner is this contract)
        WRuneLogic(wRuneProxy).initialize(_name, _symbol, _decimal);

        // Add this contract as minter and burner
        WRuneLogic(wRuneProxy).addMinter(address(this));
        WRuneLogic(wRuneProxy).addBurner(address(this));

        supportedRunes[_internalId] = wRuneProxy;
        internalIds[wRuneProxy] = _internalId;
        runeIds[wRuneProxy] = _runeId;

        emit NewRune(
            _name,
            _symbol,
            _runeId,
            _decimal,
            _internalId,
            wRuneProxy,
            wRuneLogic
        );
    }

    /// @notice Remove support of a wrapped RUNE token
    function removeRune(uint256 _internalId) external override onlyOwner {
        address wrappedRune = supportedRunes[_internalId];
        require(wrappedRune != address(0), "Router: no token");
        emit RuneRemoved(_internalId, wrappedRune);
        delete runeIds[wrappedRune];
        delete internalIds[wrappedRune];
        delete supportedRunes[_internalId];
    }

    /// @notice Internal function to handle wrap and swap operations
    /// @dev Called when processing a wrap request that includes a swap
    function _wrapAndSwap(WrapAndSwapParams memory params) internal {
        // Check exchange path provided by teleporter
        require(
            params.path[0] == params.request.inputToken &&
                params.path[params.path.length - 1] ==
                params.request.outputToken,
            "Router: wrong path"
        );

        // Swapped tokens are sent to the contract
        (bool result, uint256 outputAmount) = _swap(
            params.request.appId,
            address(this),
            params.remainingAmount,
            params.request.outputAmount,
            params.path
        );

        if (result) {
            // Swap successful
            runeWrapRequests[params.txId].isRequestCompleted = true;
            emit NewRuneWrapAndSwapV2(
                params.request.recipientAddress,
                params.remainingAmount,
                params.wrappedRune,
                outputAmount,
                params.request.outputToken,
                params.fee,
                runeWrapRequests[params.txId].thirdPartyId,
                params.txId,
                params.request.speed,
                params.request.chainId,
                params.request.bridgeFee
            );
            // Distribute fees only if the swap is successful
            _distributeFees(
                params.fee,
                params.wrappedRune,
                params.thirdPartyAddress
            );

            if (params.request.chainId == chainId) {
                // Destination chain == the current chain
                // Transfer exchanged tokens directly to user
                IRune(params.request.outputToken).transfer(
                    params.request.recipientAddress,
                    outputAmount
                );
            } else {
                // Destination chain != the current chain
                // Transfer exchanged tokens to user on the destination chain using Across
                _sendTokenToOtherChain(
                    params.request.chainId,
                    params.request.outputToken,
                    outputAmount,
                    params.request.recipientAddress,
                    params.request.bridgeFee
                );
            }
        } else {
            // Swap failed
            // Note: In the case of swap failure, the contract keeps the wrapped rune tokens
            emit FailedRuneWrapAndSwap(
                params.request.recipientAddress,
                params.request.inputAmount,
                params.wrappedRune,
                params.request.outputAmount,
                params.request.outputToken,
                fees(0, 0, 0), // zero fee
                runeWrapRequests[params.txId].thirdPartyId,
                params.txId,
                params.request.speed,
                params.request.chainId
            );
        }
    }

    /// @notice Process wrap Rune request
    /// @dev Locker submits wrap requests to this function for:
    ///      1) Checking tx inclusion
    ///      2) Extracting wrap request info from the OP_RETURN output
    ///      3) Exchanging wrapped Rune (if request is wrap & exchange) using the path
    ///         provided by the locker
    /// @param _version of Bitcoin tx
    /// @param _vin Tx inputs
    /// @param _vout Tx outputs
    /// @param _locktime Tx locktime
    /// @param _blockNumber that includes the tx
    /// @param _intermediateNodes Merkle proof for tx
    /// @param _index of tx in the block
    function wrapRune(
        bytes4 _version,
        bytes memory _vin,
        bytes calldata _vout,
        bytes4 _locktime,
        uint256 _blockNumber,
        bytes calldata _intermediateNodes,
        uint _index,
        address[] memory _path
    ) external payable override nonReentrant {
        // Only teleporter can call this function
        require(_msgSender() == teleporter, "Router: not teleporter");

        // Find txId and check tx inclusion on Bitcoin
        bytes32 txId = RuneRouterLib.checkTx(
            startingBlockNumber,
            relay,
            _version,
            _vin,
            _vout,
            _locktime,
            _blockNumber,
            _intermediateNodes,
            _index
        );

        // Extract information from the request & find fees and remaining amount
        (
            uint remainingAmount,
            fees memory fee,
            address _thirdPartyAddress,
            address wrappedRune
        ) = RuneRouterLib.wrapHelper(
                _vout,
                txId,
                runeWrapRequests,
                supportedRunes,
                thirdParties,
                protocolPercentageFee,
                lockerPercentageFee
            );

        runeWrapRequest memory request = runeWrapRequests[txId];

        // Mint total amount of wrapped tokens
        IRune(wrappedRune).mint(address(this), request.inputAmount);

        if (request.appId == 0) {
            // This is a wrap request (which cannot fail)
            // Distribute fees
            _distributeFees(fee, wrappedRune, _thirdPartyAddress);

            // Mark request as completed
            runeWrapRequests[txId].isRequestCompleted = true;

            // Transfer wrapped tokens to user
            IRune(wrappedRune).transfer(
                request.recipientAddress,
                remainingAmount
            );

            emit NewRuneWrap(
                request.recipientAddress,
                remainingAmount,
                wrappedRune,
                fee,
                _thirdPartyAddress,
                txId
            );
        } else {
            _wrapAndSwap(
                WrapAndSwapParams({
                    request: request,
                    txId: txId,
                    remainingAmount: remainingAmount,
                    wrappedRune: wrappedRune,
                    fee: fee,
                    thirdPartyAddress: _thirdPartyAddress,
                    path: _path
                })
            );
        }
    }

    /// @notice Process unwrap request
    /// @dev For unwrap requests (not swap & unwrap), pass _appId,
    ///      _inputAmount and _path ZERO
    /// @param _amount of WRune that user wants to burn
    /// @param _userScript User script hash
    /// @param _scriptType User script type
    function unwrapRune(
        uint _thirdPartyId,
        uint _internalId,
        uint _amount,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        uint _appId,
        uint _inputAmount,
        address[] memory _path
    ) public payable override nonReentrant returns (uint256 _remainingAmount) {
        address token = supportedRunes[_internalId];
        require(token != address(0), "Router: not supported");

        if (_path.length != 0) {
            // This is a swap and unwrap request
            // Check if the last token in the path is the same as the token
            require(_path[_path.length - 1] == token, "Router: wrong path");

            if (msg.value > 0) {
                // Input token is native token
                require(
                    msg.value == _inputAmount && wrappedNativeToken == _path[0],
                    "Router: wrong value or token"
                );

                // Mint wrapped native token
                IRune(wrappedNativeToken).deposit{value: _inputAmount}();
            } else {
                // Input token is not native token
                // Transfer user's tokens to contract
                IRune(_path[0]).transferFrom(
                    _msgSender(),
                    address(this),
                    _inputAmount
                );
            }

            bool result;
            // We update _amount to the burnt amount
            (result, _amount) = _swap(
                _appId,
                address(this),
                _inputAmount,
                _amount,
                _path
            );
            require(result, "Router: swap failed");
        } else {
            // This is a unwrap request
            // Transfer user's tokens to contract
            require(
                IRune(token).transferFrom(_msgSender(), address(this), _amount),
                "Router: transfer failed"
            );
        }

        fees memory fee;
        address thirdPartyAddress;

        (fee, thirdPartyAddress, _remainingAmount) = _unwrapRune(
            _thirdPartyId,
            token,
            _amount,
            _userScript,
            _scriptType
        );

        if (_path.length == 0) {
            emit NewRuneUnwrap(
                _msgSender(),
                _userScript,
                _scriptType,
                token,
                _amount,
                _remainingAmount,
                fee,
                0,
                thirdPartyAddress,
                runeUnwrapRequests.length - 1
            );
        } else {
            emit NewRuneSwapAndUnwrap(
                _msgSender(),
                _userScript,
                _scriptType,
                _inputAmount,
                _path[0],
                _amount,
                _remainingAmount,
                token,
                fee,
                0,
                thirdPartyAddress,
                runeUnwrapRequests.length - 1
            );
        }
    }

    /// @notice Check proof of unwraping Runes
    /// @dev Only locker can call this function to validate Bitcoin transaction
    /// @param _version Bitcoin transaction version
    /// @param _vin Bitcoin transaction input
    /// @param _vout Bitcoin transaction output
    /// @param _locktime Bitcoin transaction locktime
    /// @param _blockNumber Block number of the Bitcoin transaction
    /// @param _intermediateNodes Merkle proof nodes
    /// @param _index Index of the transaction in the block
    /// @param _reqIndexes Array of processed unwrap request indexes with proofs
    function unwrapProofRune(
        bytes4 _version,
        bytes memory _vin,
        bytes memory _vout,
        bytes4 _locktime,
        uint256 _blockNumber,
        bytes memory _intermediateNodes,
        uint _index,
        uint[] memory _reqIndexes
    ) external payable override nonReentrant {
        require(_msgSender() == locker, "Router: not locker");

        bytes32 txId = RuneRouterLib.checkTx(
            startingBlockNumber,
            relay,
            _version,
            _vin,
            _vout,
            _locktime,
            _blockNumber,
            _intermediateNodes,
            _index
        );

        for (uint i = 0; i < _reqIndexes.length; i++) {
            require(
                !runeUnwrapRequests[_reqIndexes[i]].isProcessed,
                "Router: already processed"
            );
            runeUnwrapRequests[_reqIndexes[i]].isProcessed = true;
            emit UnwrapRuneProcessed(
                runeUnwrapRequests[_reqIndexes[i]].sender,
                runeUnwrapRequests[_reqIndexes[i]].burntAmount,
                runeUnwrapRequests[_reqIndexes[i]].userScript,
                runeUnwrapRequests[_reqIndexes[i]].scriptType,
                _reqIndexes[i],
                txId
            );
        }
    }

    function refundByOwnerOrAdmin(
        bytes32 _txId,
        uint8 _scriptType,
        bytes memory _userScript
    ) external override nonReentrant {
        require(
            msg.sender == acrossAdmin || msg.sender == owner(),
            "ExchangeRouter: not authorized"
        );

        require(
            !runeWrapRequests[_txId].isRequestCompleted,
            "RuneRouterLogic: already processed"
        );

        uint256 failedRequestAmount = runeWrapRequests[_txId].inputAmount;

        // Approve for unwrap (the contract approves to itself
        IRune(runeWrapRequests[_txId].inputToken).approve(
            address(this),
            failedRequestAmount
        );

        // Unwrap wrapped Rune
        uint256 refundAmount = unwrapRune(
            0,
            internalIds[runeWrapRequests[_txId].inputToken],
            failedRequestAmount,
            _userScript,
            ScriptTypes(_scriptType),
            0, // This is a unwrap request
            0,
            new address[](0)
        );

        emit RefundProcessed(
            _txId,
            msg.sender,
            failedRequestAmount,
            refundAmount,
            _userScript,
            _scriptType,
            runeUnwrapRequests.length - 1
        );
    }

    /// @notice Burns wrapped Rune and record the request
    function _unwrapRune(
        uint _thirdPartyId,
        address _token,
        uint _amount,
        bytes memory _userScript,
        ScriptTypes _scriptType
    )
        private
        returns (
            fees memory _fee,
            address _thirdPartyAddress,
            uint _remainingAmount
        )
    {
        // Save unwrap request and get fee and burnt amounts
        (_fee, _thirdPartyAddress, _remainingAmount) = RuneRouterLib
            .unwrapHelper(
                _msgSender(),
                protocolPercentageFee,
                lockerPercentageFee,
                runeUnwrapRequests,
                thirdParties,
                _thirdPartyId,
                _amount,
                _userScript,
                _scriptType
            );
        runeUnwrapCounter++;

        // Distribute fees
        _distributeFees(_fee, _token, _thirdPartyAddress);

        // Burn remained amount
        IRune(_token).burn(_remainingAmount);
    }

    /// @notice Distributes protocol, locker, and third-party fees.
    /// @param _fees The fee structure containing protocolFee, lockerFee, and thirdPartyFee.
    /// @param _wrappedRune The address of the wrapped Rune token.
    /// @param _thirdPartyAddress The address of the third party to receive fees, if applicable.
    function _distributeFees(
        fees memory _fees,
        address _wrappedRune,
        address _thirdPartyAddress
    ) private {
        // Send protocol fee to the treasury
        IRune(_wrappedRune).transfer(treasury, _fees.protocolFee);

        // Send locker fee using the existing internal function
        _sendLockerFee(_fees.lockerFee, _wrappedRune);

        // If a third-party address is provided, transfer the third-party fee
        if (_thirdPartyAddress != address(0)) {
            IRune(_wrappedRune).transfer(
                _thirdPartyAddress,
                _fees.thirdPartyFee
            );
        }
    }

    /// @notice Send locker fee by calling reward distributor
    function _sendLockerFee(uint _lockerFee, address _wrappedRune) internal {
        if (_lockerFee > 0) {
            if (rewardDistributor == address(0)) {
                // Send reward directly to locker
                IRune(_wrappedRune).transfer(locker, _lockerFee);
            } else {
                // Call reward distributor to distribute reward
                IRune(_wrappedRune).approve(rewardDistributor, _lockerFee);
                Address.functionCall(
                    rewardDistributor,
                    abi.encodeWithSignature(
                        "depositReward(address,uint256)",
                        virtualLocker[_wrappedRune],
                        _lockerFee
                    )
                );
            }
        }
    }

    // Swap tokens using an exchange connector
    function _swap(
        uint _appId,
        address _recipientAddress,
        uint _inputAmount,
        uint _outputAmount,
        address[] memory _path
    ) private returns (bool _result, uint256 _finalOutputAmount) {
        address _exchangeConnector = exchangeConnector[_appId];
        require(_exchangeConnector != address(0), "Router: invalid appId");

        IRune(_path[0]).approve(_exchangeConnector, _inputAmount);

        uint256[] memory _amounts;
        (_result, _amounts) = IDexConnector(_exchangeConnector).swap(
            _inputAmount,
            (_outputAmount * 90) / 100, // TODO: Remove this
            _path,
            _recipientAddress,
            block.timestamp,
            true // Input amount is fixed
        );

        if (_result) {
            // If swap is successful
            _finalOutputAmount = _amounts[_amounts.length - 1];
        }
        // If swap is not successful, return 0
    }

    /// @notice Send tokens to the destination using Across
    function _sendTokenToOtherChain(
        uint256 _chainId,
        address _token,
        uint256 _amount,
        address _user,
        uint256 _acrossRelayerFee
    ) private {
        IRune(_token).approve(across, _amount);

        bytes memory callData = abi.encodeWithSignature(
            "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
            acrossAdmin, // depositor
            _user, // recipient
            _token, // inputToken
            bridgeTokenMapping[_token][_chainId], // outputToken (note: for address(0), fillers will replace this with the destination chain equivalent of the input token)
            _amount, // inputAmount
            _amount * (1e18 - _acrossRelayerFee) / 1e18, // outputAmount
            _chainId, // destinationChainId
            address(0), // exclusiveRelayer (none for now)
            uint32(block.timestamp), // quoteTimestamp
            uint32(block.timestamp + 4 hours), // fillDeadline (4 hours from now)
            0, // exclusivityDeadline
            "0x" // message (null data)
        );

        // Append integrator identifier
        bytes memory finalCallData = abi.encodePacked(callData, hex"1dc0de0083"); // delimiter (1dc0de) + integratorID (0x0083)

        Address.functionCall(
            across,
            finalCallData
        );
    }
}
