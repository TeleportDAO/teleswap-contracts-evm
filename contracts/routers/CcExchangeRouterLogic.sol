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
import "./CcExchangeToSolanaRouterLib.sol";
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

    /// @notice Check if a request has been processed
    /// @dev It prevents re-submitting a processed request
    /// @param _txId The transaction ID of request on Bitcoin
    /// @return True if the cc exchange request has been already executed
    function isRequestUsed(
        bytes32 _txId
    ) external view override returns (bool) {
        return ccExchangeRequests[_txId].isUsed ? true : false;
    }

    /// @notice Return the destination chain
    function getDestChainId(uint256 chainId) public view returns (uint256) {
        return chainIdMapping[chainId].destinationChain;
    }

    /// @notice Process a wrapAndSwap request after checking its inclusion on Bitcoin
    /// @dev Steps to process a request:
    ///      1. Check transaction inclusion on Bitcoin
    ///      2. Extract the request info
    ///      3. Mint TeleBTC and send fees to protocol, Locker, and third party
    ///      4. Exchange TeleBTC for the output token
    ///      5.1 Send the output token to the user
    ///      5.2 Send TeleBTC to user if exchange fails and the request belongs to the current chain
    ///      5.3 Keep TeleBTC if exchange fails and the request doesn't blong to the current chain
    /// @param _txAndProof Transaction and inclusion proof data
    /// @param _lockerLockingScript Script hash of Locker that user has sent BTC to it
    /// @param _path (Optional) Exchange path from teleBTC to the output token.
    function wrapAndSwap(
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
        
        require(
            _txAndProof.locktime == bytes4(0),
            "ExchangeRouter: non-zero locktime"
        );

        // Check that the given script hash is Locker
        require(
            ILockersManager(lockers).isLocker(_lockerLockingScript),
            "ExchangeRouter: not locker"
        );

        // Extract request info and check if tx has been finalized on Bitcoin
        bytes32 txId = CcExchangeRouterLib.ccExchangeHelper(
            _txAndProof,
            ccExchangeRequests,
            extendedCcExchangeRequests,
            teleBTC,
            _lockerLockingScript,
            relay
        );

        // Find destination chain Id (the final chain that user gets its token on it)
        uint256 destinationChainId = getDestChainId(
            extendedCcExchangeRequests[txId].chainId
        );

        require(
            destinationChainId != 0,
            "ExchangeRouter: invalid chain id"
        );

        ccExchangeRequest memory request = ccExchangeRequests[txId];

        address _exchangeConnector = exchangeConnector[request.appId];
        require(
            _exchangeConnector != address(0),
            "ExchangeRouter: invalid appId"
        );

        // Find remained amount after reducing fees
        _mintAndCalculateFees(_lockerLockingScript, txId);

        if (request.speed == 1) { // Handle fast request
            /* 
                If there was a filler who filled the request with the same parameters,
                we will send the TeleBTC to the filler
            */
            address filler = fillerAddress[txId][request.recipientAddress][
                request.path[request.path.length - 1]
            ][request.outputAmount][destinationChainId][extendedCcExchangeRequests[txId].bridgePercentageFee];

            if (filler != address(0)) { // Request has been filled
                // Send TeleBTC to filler who filled the request
                _sendTeleBtcToFiller(
                    filler,
                    txId,
                    _lockerLockingScript,
                    destinationChainId
                );
                return true;
            } else { // Request has not been filled
                // Treat it as a normal request
                ccExchangeRequests[txId].speed = 0;
            }
        }

        _wrapAndSwap(
            _exchangeConnector,
            _lockerLockingScript,
            txId,
            _path,
            extendedCcExchangeRequests[txId].bridgePercentageFee,
            destinationChainId
        );

        return true;
    }

    /// @notice Filler fills an upcoming exchange request
    /// @param _txId Bitcoin request that filler wants to fill
    /// @param _token Address of exchange token in the request
    /// @param _fillAmount Amount that filler uses to fill the request (this is not necessarily the amount that user receives)
    /// @param _userRequestedAmount Amount that user requested
    /// @param _destinationChainId Destination chain id
    /// @param _bridgePercentageFee Bridge percentage fee
    function fillTx(
        bytes32 _txId,
        address _recipient,
        address _token,
        uint _fillAmount,
        uint _userRequestedAmount,
        uint _destinationChainId,
        uint _bridgePercentageFee,
        bytes memory _lockerLockingScript
    ) external payable nonReentrant override {
        // Checks that the request has not been processed before normally
        require(
            !ccExchangeRequests[_txId].isUsed,
            "ExchangeRouter: already processed"
        );

        // Calculate the final amount that user will receive
        uint _finalAmount = _fillAmount * (MAX_BRIDGE_FEE - _bridgePercentageFee) / MAX_BRIDGE_FEE;

        // Check that the final amount is greater than or equal to the user requested amount
        require(_finalAmount >= _userRequestedAmount, "ExchangeRouter: insufficient fill amount");

        /* 
            If another filler has filled the request with the same parameters,
            the request will be rejected
        */
        require(
            fillerAddress[_txId][_recipient][_token][_userRequestedAmount][
                _destinationChainId
            ][_bridgePercentageFee] == address(0),
            "ExchangeRouter: already filled"
        );

        // Record the filler address
        fillerAddress[_txId]
            [_recipient]
            [_token]
            [_userRequestedAmount]
            [_destinationChainId]
            [_bridgePercentageFee] = _msgSender();

        // Record the fill amount
        finalAmount[_txId] = _finalAmount;

        if (_destinationChainId == chainId) { // Requests that belongs to the current chain
            if (_token == wrappedNativeToken) {
                // Transfer the token from the filler to the contract
                require(
                    IERC20(_token).transferFrom(
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
                        _recipient
                    ),
                    _fillAmount
                );
            } else {
                // Transfer the token from the filler to the recipient
                require(
                    IERC20(_token).transferFrom(
                        _msgSender(),
                        _recipient,
                        _fillAmount
                    ),
                    "ExchangeRouter: no allowance"
                );
            }
        } else { // Requests that belongs to the other chain
            // Transfer the token from the filler to the contract
            require(
                IERC20(_token).transferFrom(
                    _msgSender(),
                    address(this),
                    _fillAmount
                ),
                "ExchangeRouter: no allowance"
            );
            _sendTokenToOtherChain(
                _destinationChainId,
                _token,
                _fillAmount,
                _recipient,
                _bridgePercentageFee
            );
        }

        emit RequestFilled(
            _msgSender(),
            _recipient,
            ILockersManager(lockers).getLockerTargetAddress(_lockerLockingScript),
            _txId,
            [teleBTC, _token],
            _fillAmount,
            _finalAmount,
            _userRequestedAmount,
            _destinationChainId,
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

    function _sendTeleBtcToFiller(
        address _filler,
        bytes32 _txId,
        bytes memory _lockerLockingScript,
        uint256 _destinationChainId
    ) private {
        // Send fees to the teleporter, treasury, third party, and locker
        _sendFees(_txId, _lockerLockingScript);

        ccExchangeRequest memory request = ccExchangeRequests[_txId];
        extendedCcExchangeRequest
            memory extendedRequest = extendedCcExchangeRequests[_txId];

        // Mark the request as completed
        extendedCcExchangeRequests[_txId].isRequestCompleted = true;

        // Send TeleBTC to filler
        ITeleBTC(teleBTC).transfer(
            _filler,
            extendedRequest.remainedInputAmount
        );

        uint256[5] memory fees = [
            request.fee,
            extendedRequest.lockerFee,
            extendedRequest.protocolFee,
            extendedRequest.thirdPartyFee,
            extendedRequest.bridgePercentageFee
        ];

        emit NewWrapAndSwap(
            ILockersManager(lockers).getLockerTargetAddress(
                _lockerLockingScript
            ),
            request.recipientAddress,
            [teleBTC, request.path[request.path.length - 1]],
            [extendedRequest.remainedInputAmount, finalAmount[_txId]],
            1,
            _msgSender(),
            _txId,
            request.appId,
            extendedRequest.thirdParty,
            fees,
            _destinationChainId
        );

        emit FillerRefunded(
            _filler,
            _txId,
            extendedRequest.remainedInputAmount
        );
    }

    /// @notice Send tokens to the destination using Across
    function _sendTokenToOtherChain(
        uint256 _chainId,
        address _token,
        uint256 _amount,
        address _user,
        uint256 _bridgePercentageFee
    ) private {
        IERC20(_token).approve(across, _amount);
        bytes memory callData = abi.encodeWithSignature(
            "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
            acrossAdmin, // depositor
            _user, // recipient
            _token, // inputToken
            bridgeTokenMapping[_token][getDestChainId(_chainId)], // outputToken (note: for address(0), fillers will replace this with the destination chain equivalent of the input token)
            _amount, // inputAmount
            _amount * (1e18 - _bridgePercentageFee) / 1e18, // outputAmount
            getDestChainId(_chainId), // destinationChainId
            address(0), // exclusiveRelayer (none for now)
            uint32(block.timestamp), // quoteTimestamp
            uint32(block.timestamp + 4 hours), // fillDeadline (4 hours from now)
            0, // exclusivityDeadline
            bytes("") // message (empty bytes)
        );

        // Append integrator identifier
        // delimiter (1dc0de) + integratorID (0x0083)
        bytes memory finalCallData = abi.encodePacked(callData, hex"1dc0de0083");

        Address.functionCall(
            across,
            finalCallData
        );
    }

    function _wrapAndSwap(
        address _exchangeConnector,
        bytes memory _lockerLockingScript,
        bytes32 _txId,
        address[] memory _path,
        uint256 _bridgePercentageFee,
        uint256 _chainId
    ) private {
        (bool result, uint256[] memory amounts) = _swap(
            ICcExchangeRouter.swapArguments(
                _chainId,
                _lockerLockingScript,
                ccExchangeRequests[_txId],
                extendedCcExchangeRequests[_txId],
                _txId,
                _path,
                _exchangeConnector
            )
        );

        if (result) {
            // If swap was successfull, user will get tokens on destination chain
            extendedCcExchangeRequests[_txId].isRequestCompleted = true;

            // Send fees to the teleporter, treasury, third party, and locker
            _sendFees(_txId, _lockerLockingScript);

            if (_chainId != chainId) {
                // If the destination chain is not the current chain
                _sendTokenToOtherChain(
                    extendedCcExchangeRequests[_txId].chainId,
                    _path[_path.length - 1],
                    amounts[amounts.length - 1],
                    ccExchangeRequests[_txId].recipientAddress,
                    _bridgePercentageFee
                );
            }
        } else {
            // If swap failed, keep TeleBTC in the contract for retry
            uint fees = extendedCcExchangeRequests[_txId].thirdPartyFee +
                       extendedCcExchangeRequests[_txId].protocolFee +
                       ccExchangeRequests[_txId].fee +
                       extendedCcExchangeRequests[_txId].lockerFee;

            // We don't take fees (except the locker fee) in the case of failed wrapAndSwap
            extendedCcExchangeRequests[_txId].remainedInputAmount += fees;
        }
    }

    /// @notice Swap TeleBTC for the output token
    function _swap(
        ICcExchangeRouter.swapArguments memory swapArguments
    ) private returns (bool result, uint256[] memory amounts) {
        // Give allowance to exchange connector for swapping
        ITeleBTC(teleBTC).approve(
            swapArguments._exchangeConnector,
            swapArguments._extendedCcExchangeRequest.remainedInputAmount
        );

        // Check if the provided path is valid
        require(
            swapArguments._path[0] == teleBTC &&
                swapArguments._path[swapArguments._path.length - 1] ==
                swapArguments._ccExchangeRequest.path[
                    swapArguments._ccExchangeRequest.path.length - 1
                ],
            "CcExchangeRouter: invalid path"
        );

        // Swap teleBTC for the output token
        // Swapped token is sent to the contract
        (result, amounts) = IDexConnector(swapArguments._exchangeConnector)
            .swap(
                swapArguments._extendedCcExchangeRequest.remainedInputAmount,
                (swapArguments._ccExchangeRequest.outputAmount *
                    MAX_BRIDGE_FEE) /
                        (MAX_BRIDGE_FEE -
                            swapArguments._extendedCcExchangeRequest.bridgePercentageFee),
                swapArguments._path,
                address(this),
                block.timestamp,
                true
            );

        if (result) {
            // Successfull swap
            if (swapArguments.destinationChainId == chainId) {
                // Send swapped token to the user for current chain requests
                address _outputToken = swapArguments._path[
                    swapArguments._path.length - 1
                ];
                uint256 _outputAmount = amounts[amounts.length - 1];
                if (_outputToken != wrappedNativeToken) {
                    // Send swapped token to the user
                    ITeleBTC(_outputToken).transfer(
                        swapArguments._ccExchangeRequest.recipientAddress,
                        _outputAmount
                    );
                } else {
                    // Unwrap the wrapped native token
                    WETH(wrappedNativeToken).withdraw(_outputAmount);
                    // Send native token to the user
                    Address.sendValue(
                        payable(
                            swapArguments._ccExchangeRequest.recipientAddress
                        ),
                        _outputAmount
                    );
                }
            }

            uint256 bridgeFee = (amounts[amounts.length - 1] *
                swapArguments._extendedCcExchangeRequest.bridgePercentageFee) /
                MAX_BRIDGE_FEE;

            uint256[5] memory fees = [
                swapArguments._ccExchangeRequest.fee,
                swapArguments._extendedCcExchangeRequest.lockerFee,
                swapArguments._extendedCcExchangeRequest.protocolFee,
                swapArguments._extendedCcExchangeRequest.thirdPartyFee,
                bridgeFee
            ];

            emit NewWrapAndSwap(
                ILockersManager(lockers).getLockerTargetAddress(
                    swapArguments._lockerLockingScript
                ),
                swapArguments._ccExchangeRequest.recipientAddress,
                [teleBTC, swapArguments._path[swapArguments._path.length - 1]], // [input token, output token]
                [amounts[0], amounts[amounts.length - 1] - bridgeFee], // [input amount, output amount]
                swapArguments._ccExchangeRequest.speed,
                _msgSender(), // Teleporter address
                swapArguments._txId,
                swapArguments._ccExchangeRequest.appId,
                swapArguments._extendedCcExchangeRequest.thirdParty,
                fees,
                swapArguments.destinationChainId
            );
        } else {
            // Failed swap
            uint256[5] memory fees = [
                uint256(0),
                uint256(0),
                uint256(0),
                uint256(0),
                uint256(0)
            ];
            emit FailedWrapAndSwap(
                ILockersManager(lockers).getLockerTargetAddress(
                    swapArguments._lockerLockingScript
                ),
                swapArguments._ccExchangeRequest.recipientAddress,
                [teleBTC, swapArguments._path[swapArguments._path.length - 1]], // [input token, output token]
                [
                    swapArguments
                        ._extendedCcExchangeRequest
                        .remainedInputAmount,
                    0
                ], // [input amount, output amount]
                swapArguments._ccExchangeRequest.speed,
                _msgSender(), // Teleporter address
                swapArguments._txId,
                swapArguments._ccExchangeRequest.appId,
                swapArguments._extendedCcExchangeRequest.thirdParty,
                fees,
                swapArguments.destinationChainId
            );
        }
    }

    /// @notice Mints teleBTC by calling lockers contract
    /// @param _lockerLockingScript Locker's locking script
    /// @param _txId The transaction ID of the request
    function _mintAndCalculateFees(
        bytes memory _lockerLockingScript,
        bytes32 _txId
    ) private {
        uint256 destinationChainId = getDestChainId(
            extendedCcExchangeRequests[_txId].chainId
        );
        uint256 inputAmount = 0;
        uint256 networkFee = 0;
        if (destinationChainId == 101) {
            inputAmount = ccExchangeToSolanaRequests[_txId].inputAmount;
            networkFee = ccExchangeToSolanaRequests[_txId].fee;
        } else {
            inputAmount = ccExchangeRequests[_txId].inputAmount;
            networkFee = ccExchangeRequests[_txId].fee;
        }
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
        uint256 networkFee = 0;
        if (ccExchangeRequests[_txId].fee > 0) {
            networkFee = ccExchangeRequests[_txId].fee;
        } else if (ccExchangeToSolanaRequests[_txId].fee > 0) {
            networkFee = ccExchangeToSolanaRequests[_txId].fee;
        }
        
        if (networkFee > 0) {
            ITeleBTC(teleBTC).transfer(
                _msgSender(),
                networkFee
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

    /// @notice Setter for bridge token ticker mapping
    /// @param _tokenTicker Ticker symbol of the token (8 bytes)
    /// @param _destinationChainId Chain ID of the destination chain
    /// @param _destinationToken Address of the token on the target chain (32 bytes)
    function setBridgeTokenTickerMapping(
        bytes8 _tokenTicker,
        uint256 _destinationChainId,
        bytes32 _destinationToken
    ) external override onlyOwner {
        bridgeTokenTickerMapping[_tokenTicker][_destinationChainId] = _destinationToken;
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
    /// @param _tokenTickers (Optional) Exchange path token tickers from teleBTC to the output token
    function wrapAndSwapToSolana(
        TxAndProof memory _txAndProof,
        bytes calldata _lockerLockingScript,
        bytes8[] memory _tokenTickers
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
        
        require(
            _txAndProof.locktime == bytes4(0),
            "ExchangeRouter: non-zero locktime"
        );

        // Check that the given script hash is Locker
        require(
            ILockersManager(lockers).isLocker(_lockerLockingScript),
            "ExchangeRouter: not locker"
        );

        // Extract request info and check if tx has been finalized on Bitcoin
        bytes32 txId = CcExchangeRouterLib.ccExchangeToSolanaHelper(
            _txAndProof,
            ccExchangeToSolanaRequests,
            extendedCcExchangeRequests,
            _lockerLockingScript,
            relay
        );

        // Find destination chain Id (the final chain that user gets its token on it)
        uint256 destinationChainId = getDestChainId(
            extendedCcExchangeRequests[txId].chainId
        );

        require(
            destinationChainId != 0,
            "ExchangeRouter: invalid chain id"
        );

        ccExchangeToSolanaRequest memory request = ccExchangeToSolanaRequests[txId];

        address _exchangeConnector = exchangeConnector[request.appId];
        require(
            _exchangeConnector != address(0),
            "ExchangeRouter: invalid appId"
        );

        _mintAndCalculateFees(_lockerLockingScript, txId);

        // todo: fast request is not supported for Solana requests
        // if (request.speed == 1) { // Handle fast request
        //     /* 
        //         If there was a filler who filled the request with the same parameters,
        //         we will send the TeleBTC to the filler
        //     */
        //     address filler = fillerAddress[txId][request.recipientAddress][
        //         request.path[request.path.length - 1]
        //     ][request.outputAmount][destinationChainId][extendedCcExchangeRequests[txId].bridgePercentageFee];

        //     if (filler != address(0)) { // Request has been filled
        //         // Send TeleBTC to filler who filled the request
        //         _sendTeleBtcToFiller(
        //             filler,
        //             txId,
        //             _lockerLockingScript,
        //             destinationChainId
        //         );
        //         return true;
        //     } else { // Request has not been filled
        //         // Treat it as a normal request
        //         ccExchangeRequests[txId].speed = 0;
        //     }
        // }

        _wrapAndSwapToSolana(
            _exchangeConnector,
            _lockerLockingScript,
            txId,
            _tokenTickers,
            extendedCcExchangeRequests[txId].bridgePercentageFee,
            destinationChainId
        );

        return true;
    }

    /// @notice Send tokens to Solana using Across
    function _sendTokenToSolana(
        uint256 _chainId,
        address _token,
        bytes8[] memory _tokenTickers,
        uint256 _amount,
        bytes32 _user,
        uint256 _bridgePercentageFee
    ) private {
        IERC20(_token).approve(across, _amount);
        bytes memory callData = abi.encodeWithSignature(
            "deposit(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,bytes32,uint32,uint32,uint32,bytes)",
            bytes32(uint256(uint160(acrossAdmin))),
            _user,
            bytes32(uint256(uint160(_token))),
            bridgeTokenTickerMapping[_tokenTickers[_tokenTickers.length - 1]][chainIdMapping[_chainId].destinationChain],
            _amount,
            _amount * (1e18 - _bridgePercentageFee) / 1e18,
            chainIdMapping[_chainId].destinationChain,
            bytes32(0),
            uint32(block.timestamp),
            uint32(block.timestamp + 4 hours),
            0,
            bytes("")
        );

        bytes memory finalCallData = abi.encodePacked(callData, hex"1dc0de0083");
        Address.functionCall(across, finalCallData);
    }

    function _wrapAndSwapToSolana(
        address _exchangeConnector,
        bytes memory _lockerLockingScript,
        bytes32 _txId,
        bytes8[] memory _tokenTickers,
        uint256 _bridgePercentageFee,
        uint256 _chainId
    ) private {
        bytes32[] memory path = new bytes32[](2);
        path[0] = bridgeTokenTickerMapping[_tokenTickers[0]][chainId];
        path[1] = bridgeTokenTickerMapping[_tokenTickers[_tokenTickers.length - 1]][chainId];
        (bool result, uint256[] memory amounts) = _swapToSolana(
            ICcExchangeRouter.swapToSolanaArguments(
                _chainId,
                _lockerLockingScript,
                ccExchangeToSolanaRequests[_txId],
                extendedCcExchangeRequests[_txId],
                _txId,
                path,
                _exchangeConnector
            )
        );

        if (result) {
            // If swap was successful, user will get tokens on destination chain
            extendedCcExchangeRequests[_txId].isRequestCompleted = true;

            // Send fees to the teleporter, treasury, third party, and locker
            _sendFees(_txId, _lockerLockingScript);

            
            if (_chainId == 101) { // if the destination chain is Solana (101)
                _sendTokenToSolana(
                    extendedCcExchangeRequests[_txId].chainId,
                    address(uint160(uint256(path[path.length - 1]))),
                    _tokenTickers,
                    amounts[amounts.length - 1],
                    ccExchangeToSolanaRequests[_txId].recipientAddress,
                    _bridgePercentageFee
                );
            }
        } else {
            // If swap failed, keep TeleBTC in the contract for retry
            uint fees = extendedCcExchangeRequests[_txId].thirdPartyFee +
                       extendedCcExchangeRequests[_txId].protocolFee +
                       ccExchangeToSolanaRequests[_txId].fee +
                       extendedCcExchangeRequests[_txId].lockerFee;

            // We don't take fees (except the locker fee) in the case of failed wrapAndSwap
            extendedCcExchangeRequests[_txId].remainedInputAmount += fees;
        }
    }

    /// @notice Swap TeleBTC for the output token
    function _swapToSolana(
        ICcExchangeRouter.swapToSolanaArguments memory swapArguments
    ) private returns (bool result, uint256[] memory amounts) {
        (result, amounts) = CcExchangeToSolanaRouterLib.swapToSolana(
            swapArguments,
            bridgeTokenTickerMapping,
            ICcExchangeRouter.SwapToSolanaData(
                teleBTC,
                wrappedNativeToken,
                chainId,
                lockers,
                _msgSender()
            )
        );
    }
}
