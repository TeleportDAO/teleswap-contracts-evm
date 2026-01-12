// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./CcExchangeRouterStorage.sol";
import "./CcExchangeRouterStorageV2.sol";
import "./interfaces/IBurnRouter.sol";
import "../dex_connectors/interfaces/IDexConnector.sol";
import "../erc20/interfaces/ITeleBTC.sol";
import "../erc20/WETH.sol";
import "../lockersManager/interfaces/ILockersManager.sol";
import "./CcExchangeRouterLib.sol";
import "./CcExchangeRouterLibExtension.sol";
import "../routers/BurnRouterStorage.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

contract CcExchangeRouterLogic is
    CcExchangeRouterStorage,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    CcExchangeRouterStorageV2
{
    using BytesLib for bytes;

    error ZeroAddress();

    modifier nonZeroAddress(address _address) {
        if (_address == address(0)) revert ZeroAddress();
        _;
    }

    // Contract is payable
    receive() external payable {}

    /// @notice Initialize CcExchangeRouter
    /// @param _startingBlockNumber Transactions that are included in blocks older
    ///                             than _startingBlockNumber cannot be processed
    /// @param _protocolPercentageFee Protocol percentage fee (min: %0.01).
    ///                               This fee goes to treasury from each wrapAndSwap request
    /// @param _chainId Chain Id of the current chain
    /// @param _relay Address of BitcoinRelay which checks Bitcoin transactions inclusion
    /// @param _lockers LockersManager contract address
    /// @param _teleBTC TeleBTC token
    /// @param _treasury Treasury collects protocol fees
    function initialize(
        uint256 _startingBlockNumber,
        uint256 _protocolPercentageFee,
        uint256 _lockerPercentageFee,
        uint256 _chainId,
        address _lockers,
        address _relay,
        address _teleBTC,
        address _treasury,
        address _across,
        address _burnRouter
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        chainId = _chainId;
        _setStartingBlockNumber(_startingBlockNumber);
        _setProtocolPercentageFee(_protocolPercentageFee);
        _setLockerPercentageFee(_lockerPercentageFee);
        _setRelay(_relay);
        _setLockers(_lockers);
        _setTeleBTC(_teleBTC);
        _setTreasury(_treasury);
        _setAcross(_across);
        _setBurnRouter(_burnRouter);
    }

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice Setter for starting block number
    function setStartingBlockNumber(
        uint256 _startingBlockNumber
    ) external override onlyOwner {
        _setStartingBlockNumber(_startingBlockNumber);
    }

    /// @notice Update Relay address
    function setRelay(address _relay) external override onlyOwner {
        _setRelay(_relay);
    }

    /// @notice Update LockersManager address
    function setLockers(address _lockers) external override onlyOwner {
        _setLockers(_lockers);
    }

    /// @notice Assign an exchange connector to an app id
    /// @dev Users determine which DEX to use by determining the app id.
    function setExchangeConnector(
        uint256 _appId,
        address _exchangeConnector
    ) external override onlyOwner {
        exchangeConnector[_appId] = _exchangeConnector;
        emit SetExchangeConnector(_appId, _exchangeConnector);
    }

    /// @notice Update TeleBTC address
    function setTeleBTC(address _teleBTC) external override onlyOwner {
        _setTeleBTC(_teleBTC);
    }

    /// @notice Setter for protocol percentage fee
    function setProtocolPercentageFee(
        uint256 _protocolPercentageFee
    ) external override onlyOwner {
        _setProtocolPercentageFee(_protocolPercentageFee);
    }

    /// @notice Setter for locker percentage fee
    function setLockerPercentageFee(
        uint256 _lockerPercentageFee
    ) external override onlyOwner {
        _setLockerPercentageFee(_lockerPercentageFee);
    }

    /// @notice Setter for treasury
    function setTreasury(address _treasury) external override onlyOwner {
        _setTreasury(_treasury);
    }

    /// @notice Setter for across
    /// @dev Across is used to send exchanged tokens to other chains
    function setAcross(address _across) external override onlyOwner {
        _setAcross(_across);
    }

    /// @notice Setter for BurnRouter
    function setBurnRouter(address _burnRouter) external override onlyOwner {
        _setBurnRouter(_burnRouter);
    }

    /// @notice Setter for third party
    /// @dev Each third party has an id and an address.
    ///      Users determine the third party by determining the id in the request.
    ///      Third party fee is sent to the third party address.
    function setThirdPartyAddress(
        uint256 _thirdPartyId,
        address _thirdPartyAddress
    ) external override onlyOwner {
        _setThirdPartyAddress(_thirdPartyId, _thirdPartyAddress);
    }

    /// @notice Setter for third party fee
    /// @dev Third party fee is a percentage of the input amount.
    ///      Third parties can set their own fees.
    function setThirdPartyFee(
        uint256 _thirdPartyId,
        uint256 _thirdPartyFee
    ) external override onlyOwner {
        _setThirdPartyFee(_thirdPartyId, _thirdPartyFee);
    }

    /// @notice Setter for wrapped native token
    function setWrappedNativeToken(
        address _wrappedNativeToken
    ) external override onlyOwner {
        _setWrappedNativeToken(_wrappedNativeToken);
    }

    /// @notice Setter for chain id mapping
    /// @dev After processing a request, the exchanged token is sent to the destination chain.
    function setChainIdMapping(
        uint256 _destinationChain,
        uint256 _mappedId
    ) external override onlyOwner {
        _setChainIdMapping(_destinationChain, _mappedId);
    }

    /// @notice Setter for Across Admin
    function setAcrossAdmin(address _acrossAdmin) external onlyOwner {
        acrossAdmin = _acrossAdmin;
    }

    /// @notice Setter for reward distributor
    /// @dev This contract distributes locker fee between locker and stakers
    function setRewardDistributor(
        address _rewardDistributor
    ) external override onlyOwner {
        rewardDistributor = _rewardDistributor;
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

    /// @notice Setter for teleporter
    function setTeleporter(
        address _teleporter, 
        bool _isTeleporter
    ) external override onlyOwner {
        isTeleporter[_teleporter] = _isTeleporter;
    }

    /// @notice Setter for bridge token ID mapping
    /// @param _tokenID Token ID (8 bytes)
    /// @param _destinationChainId Chain ID of the destination chain
    /// @param _destinationToken Address of the token on the target chain (32 bytes)
    function setBridgeTokenIDMapping(
        bytes8 _tokenID,
        uint256 _destinationChainId,
        bytes32 _destinationToken
    ) external override onlyOwner {
        _setBridgeTokenIDMapping(_tokenID, _destinationChainId, _destinationToken);
    }

    /// @notice Setter for intermediary token mapping
    /// @param _destinationTokenID Destination token ID (8 bytes)
    /// @param _intermediaryToken Intermediary token address on the current chain
    function setIntermediaryTokenMapping(
        bytes8 _destinationTokenID, 
        address _intermediaryToken
    ) external override onlyOwner {
        _setIntermediaryTokenMapping(_destinationTokenID, _intermediaryToken);
    }

    /// @notice Setter for output token decimals
    function setInputTokenDecimalsOnDestinationChain(
        address _inputToken,
        uint256 _decimalsOnDestinationChain
    ) external override onlyOwner {
        _setInputTokenDecimalsOnDestinationChain(_inputToken, _decimalsOnDestinationChain);
    }

    /// @notice Check if a request has been processed
    /// @dev It prevents re-submitting a processed request
    /// @param _txId The transaction ID of request on Bitcoin
    /// @return True if the cc exchange request has been already executed
    function isRequestUsed(
        bytes32 _txId
    ) external view override returns (bool) {
        return ccExchangeRequestsV2[_txId].isUsed;
    }

    /// @notice Return the destination chain
    function getRealChainId(uint256 _assignedChainId) public view returns (uint256) {
        return chainIdMapping[_assignedChainId].destinationChain;
    }

    /// @notice Process a wrapAndSwap to Solana request after checking its inclusion on Bitcoin
    /// @dev Steps to process a request:
    ///      1. Check transaction inclusion on Bitcoin
    ///      2. Extract the request info
    ///      3. Mint TeleBTC and send fees to protocol, Locker, and third party
    ///      4. Exchange TeleBTC for the output token
    ///      5.1 Send the output token to the user
    ///      5.2 Send TeleBTC to user if exchange fails and the request belongs to the current chain
    ///      5.3 Keep TeleBTC if exchange fails and the request doesn't belong to the current chain
    /// @param _txAndProof Transaction and inclusion proof data
    /// @param _lockerLockingScript Script hash of Locker that user has sent BTC to it
    /// @param _path (Optional) Exchange path from teleBTC to the intermediary token
    function wrapAndSwapV2(
        TxAndProof memory _txAndProof,
        bytes calldata _lockerLockingScript,
        address[] memory _path
    ) external payable virtual override nonReentrant returns (bool) {
        // Basic checks
        require(
            isTeleporter[_msgSender()],
            "ExchangeRouter: invalid sender"
        ); // Only Teleporter can submit requests
        
        require(
            _txAndProof.blockNumber >= startingBlockNumber,
            "ExchangeRouter: old request"
        );

        // Check that the given script hash is Locker
        require(
            ILockersManager(lockers).isLocker(_lockerLockingScript),
            "ExchangeRouter: not locker"
        );

        // Extract request info and check if tx has been finalized on Bitcoin
        bytes32 txId = CcExchangeRouterLib.ccExchangeHelperV2(
            _txAndProof,
            ccExchangeRequestsV2,
            extendedCcExchangeRequests,
            teleBTC,
            _lockerLockingScript,
            relay
        );

        // Check if the provided path is valid
        require(
            teleBTC == _path[0] &&
            intermediaryTokenMapping[ccExchangeRequestsV2[txId].tokenIDs[1]] == _path[_path.length - 1],
            "ExchangeRouter: invalid path"
        );


        // Find destination chain Id (the final chain that user gets its token on it)
        uint256 destRealChainId = getRealChainId(
            extendedCcExchangeRequests[txId].destAssignedChainId
        );

        require(
            destRealChainId != 0,
            "ExchangeRouter: invalid chain id"
        );

        // Saving the output token on the destination chain for the request
        ccExchangeRequestsV2[txId].outputToken = 
            bridgeTokenIDMapping[ccExchangeRequestsV2[txId].tokenIDs[1]][destRealChainId];

        address _exchangeConnector = exchangeConnector[ccExchangeRequestsV2[txId].appId];
        require(
            _exchangeConnector != address(0),
            "ExchangeRouter: invalid appId"
        );

        _mintAndCalculateFees(_lockerLockingScript, txId);

        ccExchangeRequestV2 memory request = ccExchangeRequestsV2[txId];
        if (request.speed == 1) { // Handle fast request
            /* 
                If there was a filler who filled the request with the same parameters,
                we will send the TeleBTC to the filler
            */
            address filler =
                fillerAddressV2[txId][request.recipientAddress]
                    [intermediaryTokenMapping[ccExchangeRequestsV2[txId].tokenIDs[1]]]
                    [request.outputAmount]
                    [destRealChainId]
                    [extendedCcExchangeRequests[txId].bridgePercentageFee];

            if (filler != address(0)) { // Request has been filled
                // Send TeleBTC to filler who filled the request
                _sendTeleBtcToFillerV2(
                    filler,
                    txId,
                    _lockerLockingScript,
                    destRealChainId
                );
                return true;
            } // Otherwise, request has not been filled so treat it as a normal request
        }

        _wrapAndSwapV2(
            _exchangeConnector,
            _lockerLockingScript,
            txId,
            _path,
            extendedCcExchangeRequests[txId].bridgePercentageFee,
            destRealChainId
        );

        return true;
    }

    /// @notice Filler fills an upcoming exchange request
    /// @param _txId Bitcoin request that filler wants to fill
    /// @param _intermediaryToken Address of exchange token in the request
    /// @param _fillAmount Amount that filler uses to fill the request (this is not necessarily the amount that user receives)
    /// @param _userRequestedAmount Amount that user requested
    /// @param _destRealChainId Destination chain id
    /// @param _bridgePercentageFee Bridge percentage fee
    function fillTxV2(
        bytes32 _txId,
        bytes32 _recipient,
        address _intermediaryToken,
        bytes32 _outputToken,
        uint _fillAmount,
        uint _userRequestedAmount,
        uint _destRealChainId,
        uint _bridgePercentageFee,
        bytes memory _lockerLockingScript
    ) external payable override nonReentrant {
        // Checks that the request has not been processed before normally
        require(
            !ccExchangeRequestsV2[_txId].isUsed,
            "ExchangeRouter: already processed"
        );

        require(
            _intermediaryToken == intermediaryTokenMapping[bytes8(uint64(uint256(_outputToken)))],
            "ExchangeRouter: invalid intermediary token"
        );

        // Convert the fill amount to the destination chain's decimals
        uint256 fillAmount = _convertTokenDecimals(_intermediaryToken, _fillAmount, _destRealChainId);

        // Calculate the final amount that user will receive
        uint _finalAmount = fillAmount * (MAX_BRIDGE_FEE - _bridgePercentageFee) / MAX_BRIDGE_FEE;

        // Check that the final amount is greater than or equal to the user requested amount
        require(_finalAmount >= _userRequestedAmount, "ExchangeRouter: insufficient fill amount");

        /* 
            If another filler has filled the request with the same parameters,
            the request will be rejected
        */
        require(
            fillerAddressV2[_txId]
                [_recipient]
                [_intermediaryToken]
                [_userRequestedAmount]
                [_destRealChainId]
                [_bridgePercentageFee] == address(0),
            "ExchangeRouter: already filled"
        );

        // Record the filler address
        fillerAddressV2[_txId]
            [_recipient]
            [_intermediaryToken]
            [_userRequestedAmount]
            [_destRealChainId]
            [_bridgePercentageFee] = _msgSender();

        // Record the final amount that user will receive
        finalAmount[_txId] = _finalAmount;

        if (_destRealChainId == chainId) { // Requests that belongs to the current chain
            if (_intermediaryToken == wrappedNativeToken) {
                // Transfer the token from the filler to the contract
                require(
                    IERC20(_intermediaryToken).transferFrom(
                        _msgSender(),
                        address(this),
                        _fillAmount
                    ),
                    "ExchangeRouter: no allowance"
                );
                
                // Unwrap the wrapped native token
                WETH(wrappedNativeToken).withdraw(_fillAmount);

                // Send native token to the user
                Address.sendValue(
                    payable(
                        address(uint160(uint256(_recipient)))
                    ),
                    _fillAmount
                );
            } else {
                // Transfer the token from the filler to the recipient
                require(
                    IERC20(_intermediaryToken).transferFrom(
                        _msgSender(),
                        address(uint160(uint256(_recipient))),
                        _fillAmount
                    ),
                    "ExchangeRouter: no allowance"
                );
            }
        } else { // Requests that belongs to the other chain
            // Transfer the token from the filler to the contract
            require(
                IERC20(_intermediaryToken).transferFrom(
                    _msgSender(),
                    address(this),
                    _fillAmount
                ),
                "ExchangeRouter: no allowance"
            );
            _sendTokenToOtherChainV2(
                _destRealChainId,
                _intermediaryToken,
                _outputToken,
                _fillAmount,
                _recipient,
                _bridgePercentageFee
            );
        }

        emit RequestFilledV2(
            _msgSender(),
            _recipient,
            ILockersManager(lockers).getLockerTargetAddress(_lockerLockingScript),
            _txId,
            [teleBTC, _intermediaryToken],
            _fillAmount,
            _finalAmount,
            _userRequestedAmount,
            _destRealChainId,
            _bridgePercentageFee
        );
    }

    function refundByOwnerOrAdmin(
        bytes32 _txId,
        uint8 _scriptType,
        bytes memory _userScript,
        bytes calldata _lockerLockingScript
    ) external override nonReentrant {
        // TODO: Make it trustless. Store the outpoint of the failed tx,
        //      so we can find the script type and user script in the future having the tx
        require(
            msg.sender == acrossAdmin || msg.sender == owner(),
            "ExchangeRouter: not authorized"
        );

        // Check that the request has not been completed
        require(
            extendedCcExchangeRequests[_txId].isRequestCompleted == false,
            "ExchangeRouter: already processed"
        );
        extendedCcExchangeRequests[_txId].isRequestCompleted = true;

        uint256 failedRequestAmount = extendedCcExchangeRequests[_txId]
            .remainedInputAmount;

        // Burns teleBTC for user
        ITeleBTC(teleBTC).approve(burnRouter, failedRequestAmount);

        address lockerTargetAddress = ILockersManager(lockers)
            .getLockerTargetAddress(_lockerLockingScript);

        uint256 refundAmount = IBurnRouter(burnRouter).unwrap(
            failedRequestAmount,
            _userScript,
            ScriptTypes(_scriptType),
            _lockerLockingScript,
            0
        );

        emit RefundProcessed(
            _txId,
            msg.sender,
            failedRequestAmount,
            refundAmount,
            _userScript,
            _scriptType,
            lockerTargetAddress,
            BurnRouterStorage(burnRouter).burnRequestCounter(
                lockerTargetAddress
            ) - 1
        );
    }

    /// @notice Emergency withdraw tokens from contract
    function emergencyWithdraw(
        address _token,
        uint256 _amount
    ) external onlyOwner nonReentrant {
        if (_token == NATIVE_TOKEN) {
            Address.sendValue(payable(owner()), _amount);
        } else {
            IERC20(_token).transfer(owner(), _amount);
        }
    }

    function _sendTeleBtcToFillerV2(
        address _filler,
        bytes32 _txId,
        bytes memory _lockerLockingScript,
        uint256 _destinationChainId
    ) private {
        // Send fees to the teleporter, treasury, third party, and locker
        _sendFees(_txId, _lockerLockingScript);

        // Mark the request as completed
        extendedCcExchangeRequests[_txId].isRequestCompleted = true;

        extendedCcExchangeRequest storage extendedRequest = extendedCcExchangeRequests[_txId];

        // Send TeleBTC to filler first
        ITeleBTC(teleBTC).transfer(_filler, extendedRequest.remainedInputAmount);

        emit FillerRefunded(_filler, _txId, extendedRequest.remainedInputAmount);

        ccExchangeRequestV2 storage request = ccExchangeRequestsV2[_txId];

        uint256 outputAmount = finalAmount[_txId];

        bytes32[3] memory tokens;
        tokens[0] = bytes32(uint256(uint160(teleBTC)));
        tokens[1] = bytes32(uint256(uint160(intermediaryTokenMapping[request.tokenIDs[1]])));
        tokens[2] = request.outputToken;

        uint256[3] memory amounts;
        amounts[0] = extendedRequest.remainedInputAmount;
        amounts[1] = request.minIntermediaryTokenAmount;
        amounts[2] = outputAmount;

        uint256[5] memory fees;
        fees[0] = request.networkFee;
        fees[1] = extendedRequest.lockerFee;
        fees[2] = extendedRequest.protocolFee;
        fees[3] = extendedRequest.thirdPartyFee;
        fees[4] = outputAmount * extendedRequest.bridgePercentageFee / (1e18 - extendedRequest.bridgePercentageFee);

        _emitNewWrapAndSwapV2(
            ILockersManager(lockers).getLockerTargetAddress(_lockerLockingScript),
            request.recipientAddress,
            _msgSender(),
            _txId,
            request.appId,
            extendedRequest.thirdParty,
            _destinationChainId,
            tokens,
            amounts,
            fees
        );
    }

    function _emitNewWrapAndSwapV2(
        address _lockerAddress,
        bytes32 _recipientAddress,
        address _teleporter,
        bytes32 _txId,
        uint256 _appId,
        uint256 _thirdParty,
        uint256 _destinationChainId,
        bytes32[3] memory _tokens,
        uint256[3] memory _amounts,
        uint256[5] memory _fees
    ) private {
        emit NewWrapAndSwapV2(
            _lockerAddress,
            _recipientAddress,
            _tokens,
            _amounts,
            1,
            _teleporter,
            _txId,
            _appId,
            _thirdParty,
            _fees,
            _destinationChainId
        );
    }

    /// @notice Send tokens to Solana using Across
    function _sendTokenToOtherChainV2(
        uint256 _destRealChainId,
        address _intermediaryToken,
        bytes32 _outputToken,
        uint256 _amount,
        bytes32 _user,
        uint256 _bridgePercentageFee
    ) private {
        IERC20(_intermediaryToken).approve(across, _amount);
        bytes memory callData;

        // Convert amount to destination chain decimals
        uint256 inputAmount = _convertTokenDecimals(_intermediaryToken, _amount, _destRealChainId);

        uint256 outputAmount = inputAmount * (1e18 - _bridgePercentageFee) / 1e18;

        if (_destRealChainId == 34268394551451) { // Solana
            callData = abi.encodeWithSignature(
                "deposit(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,bytes32,uint32,uint32,uint32,bytes)",
                bytes32(uint256(uint160(acrossAdmin))),
                _user,
                bytes32(uint256(uint160(_intermediaryToken))),
                _outputToken,
                _amount,
                outputAmount,
                _destRealChainId,
                bytes32(0),
                uint32(block.timestamp),
                uint32(block.timestamp + 4 hours),
                0,
                bytes("")
            );
        } else { // Other chains
            callData = abi.encodeWithSignature(
                "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
                acrossAdmin, // depositor
                address(uint160(uint256(_user))), // recipient (use only last 20 bytes)
                _intermediaryToken, // inputToken
                address(uint160(uint256(_outputToken))), // outputToken (note: for address(0), fillers will replace this with the destination chain equivalent of the input token)
                _amount, // inputAmount
                outputAmount, // outputAmount
                _destRealChainId,
                address(0), // exclusiveRelayer (none for now)
                uint32(block.timestamp), // quoteTimestamp
                uint32(block.timestamp + 4 hours), // fillDeadline (4 hours from now)
                0, // exclusivityDeadline
                bytes("") // message (empty bytes)
            );
        }

        bytes memory finalCallData = abi.encodePacked(callData, hex"1dc0de0083");
        Address.functionCall(across, finalCallData);
    }

    function _wrapAndSwapV2(
        address _exchangeConnector,
        bytes memory _lockerLockingScript,
        bytes32 _txId,
        address[] memory _path,
        uint256 _bridgePercentageFee,
        uint256 _destRealChainId
    ) private {
        (bool result, uint256[] memory amounts) = _swapV2(
            ICcExchangeRouter.swapArgumentsV2(
                _destRealChainId,
                _lockerLockingScript,
                ccExchangeRequestsV2[_txId],
                extendedCcExchangeRequests[_txId],
                _txId,
                _path,
                _exchangeConnector
            )
        );

        if (result) {
            /* 
                Note: If the destination chain is the current chain, 
                tokens have already been sent to the user
            */

            // If swap was successful, user will get tokens on destination chain
            extendedCcExchangeRequests[_txId].isRequestCompleted = true;

            // Send fees to the teleporter, treasury, third party, and locker
            _sendFees(_txId, _lockerLockingScript);
            
            if (_destRealChainId != chainId) {
                _sendTokenToOtherChainV2(
                    _destRealChainId,
                    _path[_path.length - 1],
                    ccExchangeRequestsV2[_txId].outputToken,
                    amounts[amounts.length - 1],
                    ccExchangeRequestsV2[_txId].recipientAddress,
                    _bridgePercentageFee
                );
            }
        } else {
            // If swap failed, keep TeleBTC in the contract for retry
            uint fees = extendedCcExchangeRequests[_txId].thirdPartyFee +
                       extendedCcExchangeRequests[_txId].protocolFee +
                       ccExchangeRequestsV2[_txId].networkFee +
                       extendedCcExchangeRequests[_txId].lockerFee;

            // We don't take fees in the case of failed wrapAndSwap
            extendedCcExchangeRequests[_txId].remainedInputAmount += fees;
        }
    }

    /// @notice Swap TeleBTC for the output token
    function _swapV2(
        ICcExchangeRouter.swapArgumentsV2 memory swapArguments
    ) private returns (bool result, uint256[] memory amounts) {
        (result, amounts) = CcExchangeRouterLibExtension.swapV2(
            swapArguments,
            ICcExchangeRouter.SwapV2Data(
                teleBTC,
                wrappedNativeToken,
                chainId,
                lockers,
                _msgSender()
            )
        );
    }

    /// @notice Mints teleBTC by calling lockers contract
    /// @param _lockerLockingScript Locker's locking script
    /// @param _txId The transaction ID of the request
    function _mintAndCalculateFees(
        bytes memory _lockerLockingScript,
        bytes32 _txId
    ) private {
        uint256 inputAmount = 0;
        uint256 networkFee = 0;

        inputAmount = ccExchangeRequestsV2[_txId].inputAmount;
        networkFee = ccExchangeRequestsV2[_txId].networkFee;

        // Mints teleBTC for cc exchange router
        ILockersManager(lockers).mint(
            _lockerLockingScript,
            address(this),
            inputAmount
        );

        // Calculates fees
        extendedCcExchangeRequests[_txId].protocolFee =
            (inputAmount * protocolPercentageFee) /
            MAX_PERCENTAGE_FEE;
        
        extendedCcExchangeRequests[_txId].thirdPartyFee =
            (inputAmount *
                thirdPartyFee[extendedCcExchangeRequests[_txId].thirdParty]) /
            MAX_PERCENTAGE_FEE;
        extendedCcExchangeRequests[_txId].lockerFee =
            (inputAmount * lockerPercentageFee) /
            MAX_PERCENTAGE_FEE;

        extendedCcExchangeRequests[_txId].remainedInputAmount =
            inputAmount -
            (
                extendedCcExchangeRequests[_txId].lockerFee +
                extendedCcExchangeRequests[_txId].protocolFee +
                networkFee +
                extendedCcExchangeRequests[_txId].thirdPartyFee
            );
    }

    /// @notice Transfers all associated fees for a successful swap
    /// @param _txId The transaction ID of the request
    function _sendFees(bytes32 _txId, bytes memory _lockerLockingScript) private {
        /* 
        Send fees:
            1. Teleporter fee (network fee)
            2. Protocol fee
            3. Third party fee
            4. Locker fee
        */
        // Transfer network fee to teleporter        
        if (ccExchangeRequestsV2[_txId].networkFee > 0) {
            ITeleBTC(teleBTC).transfer(
                _msgSender(),
                ccExchangeRequestsV2[_txId].networkFee
            );
        }
        
        // Transfer protocol fee to treasury
        if (extendedCcExchangeRequests[_txId].protocolFee > 0) {
            ITeleBTC(teleBTC).transfer(
                treasury,
                extendedCcExchangeRequests[_txId].protocolFee
            );
        }
        
        // Transfer third party fee
        if (extendedCcExchangeRequests[_txId].thirdPartyFee > 0) {
            ITeleBTC(teleBTC).transfer(
                thirdPartyAddress[
                    extendedCcExchangeRequests[_txId].thirdParty
                ],
                extendedCcExchangeRequests[_txId].thirdPartyFee
            );
        }

        // Transfer locker fee to locker
        if (extendedCcExchangeRequests[_txId].lockerFee > 0) {
            _sendLockerFee(
                ILockersManager(lockers).getLockerTargetAddress(
                    _lockerLockingScript
                ),
                extendedCcExchangeRequests[_txId].lockerFee,
                extendedCcExchangeRequests[_txId].thirdParty
            );
        }
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

    /// @notice Internal setter for relay contract address
    function _setRelay(address _relay) private nonZeroAddress(_relay) {
        emit NewRelay(relay, _relay);
        relay = _relay;
    }

    /// @notice Internal setter for lockers contract address
    function _setLockers(address _lockers) private nonZeroAddress(_lockers) {
        emit NewLockers(lockers, _lockers);
        lockers = _lockers;
    }

    /// @notice Internal setter for teleBTC contract address
    function _setTeleBTC(address _teleBTC) private nonZeroAddress(_teleBTC) {
        emit NewTeleBTC(teleBTC, _teleBTC);
        teleBTC = _teleBTC;
    }

    /// @notice Internal setter for protocol percentage fee
    function _setProtocolPercentageFee(uint256 _protocolPercentageFee) private {
        require(
            MAX_PERCENTAGE_FEE >= _protocolPercentageFee,
            "CCExchangeRouter: fee is out of range"
        );
        emit NewProtocolPercentageFee(
            protocolPercentageFee,
            _protocolPercentageFee
        );
        protocolPercentageFee = _protocolPercentageFee;
    }

    function _setLockerPercentageFee(uint256 _lockerPercentageFee) private {
        require(
            MAX_PERCENTAGE_FEE >= _lockerPercentageFee,
            "CCExchangeRouter: fee is out of range"
        );
        lockerPercentageFee = _lockerPercentageFee;
    }

    /// @notice Internal setter for starting block number
    function _setStartingBlockNumber(uint256 _startingBlockNumber) private {
        require(
            _startingBlockNumber > startingBlockNumber,
            "CCExchangeRouter: low startingBlockNumber"
        );
        startingBlockNumber = _startingBlockNumber;
    }

    /// @notice Internal setter for treasury
    function _setTreasury(address _treasury) private nonZeroAddress(_treasury) {
        emit NewTreasury(treasury, _treasury);
        treasury = _treasury;
    }

    /// @notice Internal setter for across
    function _setAcross(address _across) private {
        emit AcrossUpdated(across, _across);
        across = _across;
    }

    /// @notice Internal setter for burnRouter
    function _setBurnRouter(
        address _burnRouter
    ) private nonZeroAddress(_burnRouter) {
        emit BurnRouterUpdated(burnRouter, _burnRouter);
        burnRouter = _burnRouter;
    }

    /// @notice Internal setter for third party address
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

    /// @notice Internal setter for third party fee
    function _setThirdPartyFee(
        uint256 _thirdPartyId,
        uint256 _thirdPartyFee
    ) private {
        emit NewThirdPartyFee(
            _thirdPartyId,
            thirdPartyFee[_thirdPartyId],
            _thirdPartyFee
        );
        thirdPartyFee[_thirdPartyId] = _thirdPartyFee;
    }

    /// @notice Internal setter for wrappedNativeToken
    function _setWrappedNativeToken(address _wrappedNativeToken) private {
        emit NewWrappedNativeToken(wrappedNativeToken, _wrappedNativeToken);
        wrappedNativeToken = _wrappedNativeToken;
    }

    /// @notice Internal setter for chain id mapping
    function _setChainIdMapping(
        uint256 _destinationChain,
        uint256 _mappedId
    ) private {
        emit NewChainIdMapping(_destinationChain, _mappedId);
        chainIdMapping[_mappedId] = chainIdStruct(chainId, _destinationChain);
    }

    /// @notice Internal setter for bridge token ID mapping
    /// @param _tokenID Token ID (8 bytes)
    /// @param _destinationChainId Chain ID of the destination chain
    /// @param _destinationToken Address of the token on the target chain (32 bytes)
    function _setBridgeTokenIDMapping(
        bytes8 _tokenID,
        uint256 _destinationChainId,
        bytes32 _destinationToken
    ) private {
        bridgeTokenIDMapping[_tokenID][_destinationChainId] = _destinationToken;
    }

    /// @notice Internal setter for intermediary token mapping
    /// @param _destinationTokenID Destination token ID (8 bytes)
    /// @param _intermediaryToken Intermediary token address on the current chain
    function _setIntermediaryTokenMapping(
        bytes8 _destinationTokenID, 
        address _intermediaryToken
    ) private {
        intermediaryTokenMapping[_destinationTokenID] = _intermediaryToken;
    }

    /// @notice Internal setter for output token decimals
    function _setInputTokenDecimalsOnDestinationChain(
        address _inputToken,
        uint256 _decimalsOnDestinationChain
    ) private {
        inputTokenDecimalsOnDestinationChain[_inputToken] = _decimalsOnDestinationChain;
    }

    /// @notice Internal function to convert token decimals between chains
    /// @dev Handles USDT/USDC decimal differences between BSC (18) and other chains (6)
    /// @param _token Address of the token on the current chain
    /// @param _amount Amount to convert
    /// @param _destinationChainId Destination chain ID
    /// @return convertedAmount The amount converted to destination chain decimals
    function _convertTokenDecimals(
        address _token,
        uint256 _amount,
        uint256 _destinationChainId
    ) private view returns (uint256 convertedAmount) {
        convertedAmount = _amount;
        if (inputTokenDecimalsOnDestinationChain[_token] != 0) {
            if (_destinationChainId != chainId) {
                if (chainId == 56) { // BSC chain
                    convertedAmount =
                        _amount /
                        10 ** (18 - inputTokenDecimalsOnDestinationChain[_token]);
                } else if (_destinationChainId == 56) { // BSC chain
                    convertedAmount =
                        _amount *
                        10 ** (18 - inputTokenDecimalsOnDestinationChain[_token]);
                }
            }
        }
        return convertedAmount;
    }
}
