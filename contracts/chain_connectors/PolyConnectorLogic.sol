// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@teleportdao/btc-evm-bridge/contracts/types/ScriptTypesEnum.sol";
import "../routers/interfaces/IBurnRouter.sol";
import "../routers/interfaces/AcrossMessageHandler.sol";
import "../routers/BurnRouterStorage.sol";
import "../lockersManager/interfaces/ILockersManager.sol";
import "./PolyConnectorStorage.sol";
import "./interfaces/IPolyConnector.sol";
import "../rune_router/interfaces/IRuneRouter.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract PolyConnectorLogic is
    IPolyConnector,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    AcrossMessageHandler,
    PolyConnectorStorage
{
    error ZeroAddress();

    modifier nonZeroAddress(address _address) {
        if (_address == address(0)) revert ZeroAddress();
        _;
    }

    function initialize(
        address _lockersProxy,
        address _burnRouterProxy,
        address _across,
        address _runeRouterProxy
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        PausableUpgradeable.__Pausable_init();

        lockersProxy = _lockersProxy;
        burnRouterProxy = _burnRouterProxy;
        across = _across;
        runeRouterProxy = _runeRouterProxy;
    }

    /// @notice Setter for LockersProxy
    function setLockersProxy(
        address _lockersProxy
    ) external override onlyOwner nonZeroAddress(_lockersProxy) {
        lockersProxy = _lockersProxy;
    }

    /// @notice Setter for BurnRouterProxy
    function setBurnRouterProxy(
        address _burnRouterProxy
    ) external override onlyOwner nonZeroAddress(_burnRouterProxy) {
        burnRouterProxy = _burnRouterProxy;
    }

    /// @notice Setter for runeRouterProxy
    function setRuneRouterProxy(
        address _runeRouterProxy
    ) external override onlyOwner nonZeroAddress(_runeRouterProxy) {
        runeRouterProxy = _runeRouterProxy;
    }

    /// @notice Setter for AcrossV3
    function setAcross(
        address _across
    ) external override onlyOwner nonZeroAddress(_across) {
        across = _across;
    }

    /// @notice Setter for Across Admin
    function setAcrossAdmin(
        address _acrossAdmin
    ) external onlyOwner {
        acrossAdmin = _acrossAdmin;
    }

    /// @notice Setter for Gas Limit
    function setGasLimit(
        uint256 _gasLimit
    ) external onlyOwner {
        gasLimit = _gasLimit;
    }

    /// @notice Setter for token decimals on destination chain
    /// @dev Used for handling decimal differences (e.g., USDT: 18 on BSC, 6 on other chains)
    /// @param _token Address of the token on the current chain
    /// @param _decimals Decimals of the token on destination chains (e.g., 6 for USDT on non-BSC chains)
    function setTokenDecimalsOnDestinationChain(
        address _token,
        uint256 _decimals
    ) external onlyOwner {
        tokenDecimalsOnDestinationChain[_token] = _decimals;
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

    /// @notice Setter for bridge token mapping universal
    /// @param _sourceToken Address of the token on the current chain
    /// @param _destinationChainId The ID of the destination chain
    /// @param _destinationToken Address of the token on the target chain (bytes32)
    function setBridgeTokenMappingUniversal(
        address _sourceToken,
        uint256 _destinationChainId,
        bytes32 _destinationToken
    ) external override onlyOwner {
        bridgeTokenMappingUniversal[_sourceToken][_destinationChainId] = _destinationToken;
    }

    /// @notice Setter for bridge connector mapping
    /// @param _destinationChainId The ID of the destination chain
    /// @param _bridgeConnector Address of the bridge connector
    function setBridgeConnectorMapping(
        uint256 _destinationChainId,
        bytes32 _bridgeConnector
    ) external override onlyOwner {
        bridgeConnectorMapping[_destinationChainId] = _bridgeConnector;
    }

    /// @notice Setter for chainId
    /// @param _chainId The new current chain ID to set.
    function setCurrChainId(uint256 _chainId) external override onlyOwner {
        chainId = _chainId;
    }


    /// @notice Process requests coming from Ethereum (using Across V3)
    function handleV3AcrossMessage(
        address _tokenSent,
        uint256 _amount,
        address,
        bytes memory _message
    ) external override nonReentrant {
        // To avoid gas limit issues
        require(gasleft() >= gasLimit, "PolygonConnectorLogic: low gas");

        // Check the msg origin
        require(msg.sender == across, "PolygonConnectorLogic: not across");

        // Extract purpose, uniqueCounter and chainId
        (
            string memory purpose, 
            uint256 uniqueCounter,
            uint256 chainId
        ) = _extractPurposeAndUniqueCounterAndChainId(_message);
        
        emit MsgReceived(purpose, uniqueCounter, chainId, _message);

        // Check for duplicate fill from Across
        if (processedRequests[chainId][uniqueCounter]) {
            // Duplicate request - send tokens to acrossAdmin for manual handling
            IERC20(_tokenSent).transfer(acrossAdmin, _amount);
            return;
        }
        processedRequests[chainId][uniqueCounter] = true;

        if (_isEqualString(purpose, "swapAndUnwrap")) {
            _swapAndUnwrap(_amount, _message, _tokenSent);
        } else if (_isEqualString(purpose, "swapAndUnwrapRune")) {
            _swapAndUnwrapRune(_amount, _message, _tokenSent);
        } else if (_isEqualString(purpose, "swapAndUnwrapSolana") || _isEqualString(purpose, "swapAndUnwrapUniversal") || _isEqualString(purpose, "swapBackAndRefundBTC")) {
            // swapAndUnwrapSolana: Received swap and unwrap request from Solana chain
            // swapAndUnwrapUniversal: Received swap and unwrap request from any other chain
            // swapBackAndRefundBTC: When a swap and unwrap request fails, admin will send a cross chain message to swap back and refund the user with BTC
            _swapAndUnwrapUniversal(purpose, _amount, _message, _tokenSent);
        }
    }

    /// @notice Send back tokens to the source chain
    /// @dev This function is used for both failed BTC and Rune requests
    /// @param _message The signed message
    /// @param _v Signature v
    /// @param _r Signature r
    /// @param _s Signature s
    function withdrawFundsToSourceChain(
        bytes memory _message,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external override nonReentrant {
        // Find user address after verifying the signature
        address user = _verifySig(_message, _r, _s, _v);

        (
            uint256 _chainId,
            uint256 _uniqueCounter,
            address _token,
            int64 _relayerFeePercentage
        ) = abi.decode(_message, (uint256, uint256, address, int64));

        uint256 _amount = newFailedReqs[user][_chainId][_uniqueCounter][_token];
        // Update witholded amount
        delete newFailedReqs[user][_chainId][_uniqueCounter][_token];

        require(_amount > 0, "PolygonConnectorLogic: already withdrawn");

        // Send token back to the user
        _sendTokenUsingAcross(
            user,
            _chainId,
            _token,
            _amount,
            _relayerFeePercentage
        );

        emit WithdrawnFundsToSourceChain(
            _uniqueCounter,
            _chainId,
            _token,
            _amount,
            _relayerFeePercentage,
            user
        );
    }

    /// @notice Withdraws tokens in the emergency case
    /// @dev Only owner can call this
    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external override onlyOwner {
        if (_token == ETH_ADDR) _to.call{value: _amount}("");
        else IERC20(_token).transfer(_to, _amount);
    }

    /// @notice Send back tokens to the source chain by owner
    /// @dev Owner can only set the relayer fee percentage
    function withdrawFundsToSourceChainByOwnerOrAdmin(
        address _user,
        uint256 _chainId,
        uint256 _uniqueCounter,
        address _token,
        int64 _relayerFeePercentage
    ) external override nonReentrant {
        require(
            msg.sender == acrossAdmin || msg.sender == owner(),
            "PolygonConnectorLogic: not authorized"
        );

        uint256 _amount = newFailedReqs[_user][_chainId][_uniqueCounter][
            _token
        ];
        // Update witholded amount
        delete newFailedReqs[_user][_chainId][_uniqueCounter][_token];

        require(_amount > 0, "PolygonConnectorLogic: already withdrawn");

        // Send token back to the user
        _sendTokenUsingAcross(
            _user,
            _chainId,
            _token,
            _amount,
            _relayerFeePercentage
        );

        emit WithdrawnFundsToSourceChain(
            _uniqueCounter,
            _chainId,
            _token,
            _amount,
            _relayerFeePercentage,
            _user
        );
    }

    /// @notice Send back tokens to the source chain by owner (after a failed swap and unwrap)
    /// @param _chainId The original request's chainId
    /// @dev Owner can set the bridge percentage fee, path and amounts of the source chain swap
    function withdrawFundsToSourceChainByAdminUniversal(
        bytes32 _refundAddress,
        uint256 _chainId,
        uint256 _uniqueCounter,
        address _token,
        int64 _bridgePercentageFee,
        bytes32[] calldata _pathFromIntermediaryToInputOnSourceChain,
        uint256[] calldata _amountsFromIntermediaryToInputOnSourceChain
    ) external nonReentrant {
        require(
            msg.sender == acrossAdmin || msg.sender == owner(),
            "PolygonConnectorLogic: not authorized"
        );

        SwapAndUnwrapUniversalData memory data = failedSwapAndUnwrapReqs[_refundAddress][_chainId][_uniqueCounter][
            _token
        ];
        // Update withheld amount
        delete failedSwapAndUnwrapReqs[_refundAddress][_chainId][_uniqueCounter][_token];

        require(data.intermediaryTokenAmount > 0, "PolygonConnectorLogic: already withdrawn");


        if (_pathFromIntermediaryToInputOnSourceChain.length == 0) {
            // Send token back to the user
            _sendTokenUsingAcrossV2(
                _refundAddress,
                _chainId,
                _token,
                data.intermediaryTokenAmount,
                _bridgePercentageFee
            );
        } else {
            require(data.pathFromInputToIntermediaryOnSourceChain[data.pathFromInputToIntermediaryOnSourceChain.length - 1] == _pathFromIntermediaryToInputOnSourceChain[0], "PolygonConnectorLogic: invalid intermediary token");

            require(data.pathFromInputToIntermediaryOnSourceChain[0] == _pathFromIntermediaryToInputOnSourceChain[_pathFromIntermediaryToInputOnSourceChain.length - 1], "PolygonConnectorLogic: invalid input token");

            bytes memory message;
            if (_chainId == 34268394551451) { // Solana
                // Send message to source chain to swap intermediary token to the input token
                message = abi.encode(
                    "swapBackAndRefund",
                    _uniqueCounter,
                    _chainId,
                    _refundAddress,
                    _pathFromIntermediaryToInputOnSourceChain,
                    _amountsFromIntermediaryToInputOnSourceChain
                );
            } else {
                // For other chains, we convert the bytes32 values to addresses to reduce message size
                address[] memory pathFromIntermediaryToInputOnSourceChain = new address[](_pathFromIntermediaryToInputOnSourceChain.length);
                for (uint256 i = 0; i < _pathFromIntermediaryToInputOnSourceChain.length; i++) {
                    pathFromIntermediaryToInputOnSourceChain[i] = address(uint160(uint256(_pathFromIntermediaryToInputOnSourceChain[i])));
                }
                message = abi.encode(
                    "swapBackAndRefund",
                    _uniqueCounter,
                    _chainId,
                    address(uint160(uint256(_refundAddress))),
                    pathFromIntermediaryToInputOnSourceChain,
                    _amountsFromIntermediaryToInputOnSourceChain
                );
            }

            // Send tokens back to the user
            _sendMessageUsingAcrossUniversal(
                _chainId,
                _token,
                data.intermediaryTokenAmount,
                _bridgePercentageFee,
                message
            );
        }

        emit WithdrewFundsToSourceChainUniversal(
            _uniqueCounter,
            _chainId,
            _token,
            data.intermediaryTokenAmount,
            _bridgePercentageFee,
            _refundAddress,
            _pathFromIntermediaryToInputOnSourceChain,
            _amountsFromIntermediaryToInputOnSourceChain
        );
    }

    /// @notice Called by admin to swap failed refund request to teleBTC and refund BTC to user
    function swapBackAndRefundBTCByAdmin(
        bytes32 _bitcoinTxId,
        address _token, // intermediary token on this chain (polygon)
        bytes32 _refundAddress, // the user address in which swapped tokens were supposed to be sent to
        address _exchangeConnector,
        uint256 _minOutputAmount,
        UserAndLockerScript calldata _userAndLockerScript,
        address[] calldata _path,
        uint256[] calldata _amounts
    ) external override nonReentrant {
        require(msg.sender == acrossAdmin || msg.sender == owner(), "PolygonConnectorLogic: not authorized");

        uint256 _amount = failedWrapAndSwapRefundReqs[_refundAddress][chainId][_bitcoinTxId][
            _token
        ];
        require(_amount == _amounts[0], "PolygonConnectorLogic: invalid amount");
        require(IERC20(_token).balanceOf(address(this)) >= _amount, "PolygonConnectorLogic: insufficient balance");

        // Update withheld amount
        delete failedWrapAndSwapRefundReqs[_refundAddress][chainId][_bitcoinTxId][_token];

        require(_amount > 0, "PolygonConnectorLogic: already withdrawn");

        SwapAndUnwrapUniversalPaths memory paths = SwapAndUnwrapUniversalPaths({
            _pathFromInputToIntermediaryOnSourceChain: new address[](0),
            _pathFromIntermediaryToOutputOnIntermediaryChain: _path
        });
        // Swap intermediary token to TeleBTC
        bytes memory message = abi.encode(
            "swapBackAndRefundBTC",
            uint256(_bitcoinTxId),
            chainId,
            _refundAddress,
            _exchangeConnector,
            _minOutputAmount,
            true, // isInputFixed
            paths,
            _userAndLockerScript,
            0 // _thirdParty
        );   
        _swapAndUnwrapUniversal("swapBackAndRefundBTC", _amount, message, _token);

    }

    receive() external payable {}

    /// @notice Helper for exchanging token for BTC
    function _swapAndUnwrap(
        uint256 _amount,
        bytes memory _message,
        address _tokenSent
    ) internal {
        exchangeForBtcArguments memory arguments = _decodeReq(_message);
        require(
            arguments.path[0] == _tokenSent,
            "PolygonConnectorLogic: invalid path"
        );

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = _amount;
        amounts[1] = arguments.outputAmount;

        // Resolve source token for dynamic fee lookup
        bytes32 sourceToken = bridgeTokenMappingUniversal[_tokenSent][arguments.chainId];

        IERC20(_tokenSent).approve(burnRouterProxy, _amount);

        try
            IBurnRouter(burnRouterProxy).swapAndUnwrapWithDynamicFee(
                arguments.exchangeConnector,
                amounts,
                arguments.isInputFixed,
                arguments.path,
                block.timestamp,
                arguments.scripts.userScript,
                arguments.scripts.scriptType,
                arguments.scripts.lockerLockingScript,
                arguments.thirdParty,
                arguments.chainId,
                sourceToken
            )
        {
            address lockerTargetAddress = ILockersManager(lockersProxy)
                .getLockerTargetAddress(arguments.scripts.lockerLockingScript);

            emit NewSwapAndUnwrap(
                arguments.uniqueCounter,
                arguments.chainId,
                arguments.exchangeConnector,
                _tokenSent,
                _amount,
                arguments.user,
                arguments.scripts.userScript,
                arguments.scripts.scriptType,
                lockerTargetAddress,
                BurnRouterStorage(burnRouterProxy).burnRequestCounter(
                    lockerTargetAddress
                ) - 1,
                arguments.path,
                arguments.thirdParty
            );
        } catch {
            // Remove spending allowance
            IERC20(_tokenSent).approve(burnRouterProxy, 0);

            // Save token amount so user can withdraw it in future
            newFailedReqs[arguments.user][arguments.chainId][
                arguments.uniqueCounter
            ][_tokenSent] = _amount;

            emit FailedSwapAndUnwrap(
                arguments.uniqueCounter,
                arguments.chainId,
                arguments.exchangeConnector,
                _tokenSent,
                _amount,
                arguments.user,
                arguments.scripts.userScript,
                arguments.scripts.scriptType,
                arguments.path,
                arguments.thirdParty
            );
        }
    }

    /// @notice Helper for exchanging token for BTC
    /// @param purpose The purpose of the swap and unwrap (swapAndUnwrapUniversal, swapBackAndRefundBTC, swapAndUnwrapSolana)
    /// @param _amount The amount of the token sent to swap and unwrap
    /// @param _message The message containing the swap and unwrap arguments
    /// @param _tokenSent The token sent (intermediary token) to swap and unwrap
    function _swapAndUnwrapUniversal(
        string memory purpose,
        uint256 _amount,
        bytes memory _message,
        address _tokenSent
    ) internal {
        exchangeForBtcArgumentsUniversal memory arguments;
        if (_isEqualString(purpose, "swapAndUnwrapUniversal") || _isEqualString(purpose, "swapBackAndRefundBTC")) {
            arguments = _decodeReqUniversal(_message);
        } else if (_isEqualString(purpose, "swapAndUnwrapSolana")) {
            arguments = _decodeReqSolana(_message);
        }
        require(
            arguments.paths._pathFromIntermediaryToOutputOnIntermediaryChain[0] == _tokenSent,
            "PolygonConnectorLogic: invalid path"
        );

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = _amount;
        amounts[1] = arguments.outputAmount;

        // Resolve source token for dynamic fee lookup
        bytes32 sourceToken = bridgeTokenMappingUniversal[_tokenSent][arguments.chainId];

        IERC20(_tokenSent).approve(burnRouterProxy, _amount);

        try
            IBurnRouter(burnRouterProxy).swapAndUnwrapWithDynamicFee(
                arguments.exchangeConnector,
                amounts,
                arguments.isInputFixed,
                arguments.paths._pathFromIntermediaryToOutputOnIntermediaryChain,
                block.timestamp,
                arguments.scripts.userScript,
                arguments.scripts.scriptType,
                arguments.scripts.lockerLockingScript,
                arguments.thirdParty,
                arguments.chainId,
                sourceToken
            )
        {
            address lockerTargetAddress = ILockersManager(lockersProxy)
                .getLockerTargetAddress(arguments.scripts.lockerLockingScript);

            // If uniqueCounter is a bitcoin txId, this is a refund (after a failed universal wrap and swap)
            emit NewSwapAndUnwrapUniversal(
                arguments.uniqueCounter,
                arguments.chainId,
                arguments.exchangeConnector,
                _tokenSent,
                _amount,
                arguments.refundAddress,
                arguments.scripts.userScript,
                arguments.scripts.scriptType,
                lockerTargetAddress,
                BurnRouterStorage(burnRouterProxy).burnRequestCounter(
                    lockerTargetAddress
                ) - 1,
                arguments.paths._pathFromIntermediaryToOutputOnIntermediaryChain,
                arguments.thirdParty
            );
        } catch {
            // console.log("swapAndUnwrap failed! Reason length:", reason.length);
            // if (reason.length > 0) {
            //     console.log("swapAndUnwrap failed! Reason:", string(reason));
            // }
            // Remove spending allowance
            IERC20(_tokenSent).approve(burnRouterProxy, 0);

            // Save token amount so user can withdraw it in future
            if (_isEqualString(purpose, "swapBackAndRefundBTC")) {
                failedWrapAndSwapRefundReqs[arguments.refundAddress][arguments.chainId][
                    bytes32(arguments.uniqueCounter)
                ][_tokenSent] = _amount;
            } else {
                bytes32[] memory pathFromInputToIntermediaryOnSourceChain = new bytes32[](arguments.paths._pathFromInputToIntermediaryOnSourceChain.length);
                for (uint256 i = 0; i < arguments.paths._pathFromInputToIntermediaryOnSourceChain.length; i++) {
                    pathFromInputToIntermediaryOnSourceChain[i] = bytes32(uint256(uint160(arguments.paths._pathFromInputToIntermediaryOnSourceChain[i])));
                }
                SwapAndUnwrapUniversalData memory data = SwapAndUnwrapUniversalData(
                    pathFromInputToIntermediaryOnSourceChain,
                    _amount
                );
                failedSwapAndUnwrapReqs[arguments.refundAddress][arguments.chainId][
                    arguments.uniqueCounter
                ][_tokenSent] = data;
            }

            emit FailedSwapAndUnwrapUniversal(
                arguments.uniqueCounter,
                arguments.chainId,
                arguments.exchangeConnector,
                _tokenSent,
                _amount,
                arguments.refundAddress,
                arguments.scripts.userScript,
                arguments.scripts.scriptType,
                arguments.paths._pathFromIntermediaryToOutputOnIntermediaryChain,
                arguments.thirdParty
            );
        }
    }

    /// @notice Helper for exchanging token for RUNE
    function _swapAndUnwrapRune(
        uint256 _amount,
        bytes memory _message,
        address _tokenSent
    ) internal {
        exchangeForRuneArguments memory arguments = _decodeReqRune(_message);
        require(
            arguments.path[0] == _tokenSent,
            "PolygonConnectorLogic: invalid path"
        );

        IERC20(_tokenSent).approve(runeRouterProxy, _amount);

        try
            IRuneRouter(runeRouterProxy).unwrapRune{value: 0}(
                arguments.thirdPartyId,
                arguments.internalId,
                arguments.outputAmount,
                arguments.userScript.userScript,
                arguments.userScript.scriptType,
                arguments.appId,
                _amount,
                arguments.path
            )
        {
            emit NewSwapAndUnwrapRune(
                arguments.uniqueCounter,
                arguments.chainId,
                arguments.user,
                arguments.thirdPartyId,
                arguments.internalId,
                arguments.appId,
                arguments.outputAmount,
                _amount,
                arguments.path,
                arguments.userScript.userScript,
                arguments.userScript.scriptType,
                IRuneRouter(runeRouterProxy).totalRuneUnwrapRequests() - 1
            );
        } catch {
            // Remove spending allowance
            IERC20(_tokenSent).approve(runeRouterProxy, 0);

            // Save token amount so user can withdraw it in future
            newFailedReqs[arguments.user][arguments.chainId][
                arguments.uniqueCounter
            ][_tokenSent] = _amount;

            emit FailedSwapAndUnwrapRune(
                arguments.uniqueCounter,
                arguments.chainId,
                arguments.user,
                arguments.thirdPartyId,
                arguments.internalId,
                arguments.appId,
                arguments.outputAmount,
                _amount,
                arguments.path,
                arguments.userScript.userScript,
                arguments.userScript.scriptType
            );
        }
    }

    function _decodeReq(
        bytes memory _message
    ) private pure returns (exchangeForBtcArguments memory arguments) {
        (
            ,
            // purpose
            arguments.uniqueCounter,
            arguments.chainId,
            arguments.user,
            arguments.exchangeConnector,
            arguments.outputAmount,
            arguments.isInputFixed,
            arguments.path,
            arguments.scripts
        ) = abi.decode(
            _message,
            (
                string,
                uint256,
                uint256,
                address,
                address,
                uint256,
                bool,
                address[],
                UserAndLockerScript
            )
        );

        (, , , , , , , , , arguments.thirdParty) = abi.decode(
            _message,
            (
                string,
                uint256,
                uint256,
                address,
                address,
                uint256,
                bool,
                address[],
                UserAndLockerScript,
                uint256
            )
        );
    }

    /// @notice Decodes a Solana-style raw byte message into its arguments struct
    function _decodeReqSolana(
        bytes memory _message
    ) private pure returns (exchangeForBtcArgumentsUniversal memory arguments) {
        uint256 offset = 0;
        
        // Skip "swapAndUnwrapSolana" string (19 bytes raw UTF-8, not ABI-encoded)
        offset += 19;
        
        // Read uint64 uniqueCounter (8 bytes, little-endian)
        arguments.uniqueCounter = _readUint64LE(_message, offset);
        offset += 8;
        
        // Read uint8 chainId (8 bytes, little-endian)
        arguments.chainId = _readUint64LE(_message, offset);
        offset += 8;
        
        // Read bytes32 refundAddress (32 bytes)
        arguments.refundAddress = _readBytes32(_message, offset);
        offset += 32;
        
        // Read bytes32 exchangeConnector (32 bytes), convert last 20 bytes to address
        bytes32 exchangeConnectorBytes = _readBytes32(_message, offset);
        arguments.exchangeConnector = address(uint160(uint256(exchangeConnectorBytes)));
        offset += 32;
        
        // Read bytes32 outputAmount (32 bytes, big-endian for uint256)
        arguments.outputAmount = uint256(_readBytes32(_message, offset));
        offset += 32;
        
        // Read uint8 isInputFixed (1 byte)
        arguments.isInputFixed = _message[offset] != 0;
        offset += 1;
        
        // Read uint32 pathLength (4 bytes, little-endian)
        uint32 pathLength = _readUint32LE(_message, offset);
        offset += 4;
        
        // Read path array (pathLength * 32 bytes, each zero-padded EVM address)
        arguments.paths._pathFromIntermediaryToOutputOnIntermediaryChain = new address[](pathLength);
        for (uint256 i = 0; i < pathLength; i++) {
            bytes32 pathItemBytes = _readBytes32(_message, offset);
            // Extract last 20 bytes for EVM address
            arguments.paths._pathFromIntermediaryToOutputOnIntermediaryChain[i] = address(uint160(uint256(pathItemBytes)));
            offset += 32;
        }
        
        // Read UserAndLockerScript struct (serialized as length-prefixed bytes)
        // Format: userScript length (4 bytes) + userScript bytes + scriptType (1 byte) + lockerLockingScript length (4 bytes) + lockerLockingScript bytes
        uint32 userScriptLength = _readUint32LE(_message, offset);
        offset += 4;
        bytes memory userScript = new bytes(userScriptLength);
        for (uint256 i = 0; i < userScriptLength; i++) {
            userScript[i] = _message[offset + i];
        }
        offset += userScriptLength;
        
        // Read scriptType (1 byte enum)
        ScriptTypes scriptType = ScriptTypes(uint8(_message[offset]));
        offset += 1;
        
        // Read lockerLockingScript length (4 bytes)
        uint32 lockerScriptLength = _readUint32LE(_message, offset);
        offset += 4;
        bytes memory lockerLockingScript = new bytes(lockerScriptLength);
        for (uint256 i = 0; i < lockerScriptLength; i++) {
            lockerLockingScript[i] = _message[offset + i];
        }
        offset += lockerScriptLength;
        
        arguments.scripts.userScript = userScript;
        arguments.scripts.scriptType = scriptType;
        arguments.scripts.lockerLockingScript = lockerLockingScript;
        
        // Read uint8 thirdParty (1 byte)
        arguments.thirdParty = uint256(uint8(_message[offset]));
    }

    function _decodeReqUniversal(
        bytes memory _message
    ) private pure returns (exchangeForBtcArgumentsUniversal memory arguments) {
        (
            , // string "swapAndUnwrapUniversal"
            arguments.uniqueCounter,
            arguments.chainId,
            arguments.refundAddress,
            arguments.exchangeConnector,
            arguments.outputAmount,
            arguments.isInputFixed,
            arguments.paths,
            ,
            // arguments.scripts,
            // arguments.thirdParty
        ) = abi.decode(
            _message,
            (
                string,
                uint256,
                uint256,
                bytes32,
                address,
                uint256,
                bool,
                SwapAndUnwrapUniversalPaths,
                UserAndLockerScript,
                uint256
            )
        );

        // to handle stack too deep
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            arguments.scripts,
            arguments.thirdParty
        ) = abi.decode(
            _message,
            (
                string,
                uint256,
                uint256,
                bytes32,
                address,
                uint256,
                bool,
                SwapAndUnwrapUniversalPaths,
                UserAndLockerScript,
                uint256
            )
        );
    }

    function _decodeReqRune(
        bytes memory _message
    ) private pure returns (exchangeForRuneArguments memory arguments) {
        (
            ,
            // purpose,
            arguments.uniqueCounter,
            arguments.chainId,
            arguments.user,
            arguments.appId,
            arguments.outputAmount,
            arguments.internalId, // arguments.path, // arguments.userScript,
            // arguments.thirdPartyId
            ,
            ,

        ) = abi.decode(
            _message,
            (
                string,
                uint256,
                uint256,
                address,
                uint256,
                uint256,
                uint256,
                address[],
                UserScript,
                uint256
            )
        );

        // to handle stack too deep

        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            arguments.path,
            arguments.userScript,
            arguments.thirdPartyId
        ) = abi.decode(
            _message,
            (
                string,
                uint256,
                uint256,
                address,
                uint256,
                uint256,
                uint256,
                address[],
                UserScript,
                uint256
            )
        );
    }

    /// @notice Sends tokens to Ethereum using Across
    /// @dev This will be used for withdrawing funds
    function _sendTokenUsingAcross(
        address _user,
        uint256 _chainId,
        address _token,
        uint256 _amount,
        int64 _relayerFeePercentage
    ) internal {
        IERC20(_token).approve(across, _amount);

        // Convert amount to destination chain decimals
        uint256 convertedAmount = _convertTokenDecimals(_token, _amount, _chainId);
        uint256 outputAmount = convertedAmount * (1e18 - uint256(uint64(_relayerFeePercentage))) / 1e18;

        bytes memory callData = abi.encodeWithSignature(
            "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
            acrossAdmin, // depositor
            _user, // recipient
            _token, // inputToken
            bridgeTokenMapping[_token][_chainId], // outputToken (note: for address(0), fillers will replace this with the destination chain equivalent of the input token)
            _amount, // inputAmount
            outputAmount, // outputAmount (converted to destination chain decimals)
            _chainId, // destinationChainId
            address(0), // exclusiveRelayer (none for now)
            uint32(block.timestamp), // quoteTimestamp
            uint32(block.timestamp + 4 hours), // fillDeadline (4 hours from now)
            0, // exclusivityDeadline
            bytes("") // message (empty bytes)
        );

        // Append integrator identifier
        bytes memory finalCallData = abi.encodePacked(callData, hex"1dc0de0083"); // delimiter (1dc0de) + integratorID (0x0083)

        Address.functionCall(
            across,
            finalCallData
        );
    }

    /// @notice Sends tokens to Ethereum using Across
    /// @dev This will be used for withdrawing funds
    function _sendTokenUsingAcrossV2(
        bytes32 _refundAddress,
        uint256 _chainId,
        address _token,
        uint256 _amount,
        int64 _bridgePercentageFee
    ) internal {
        IERC20(_token).approve(across, _amount);
        bytes memory callData;

        // Convert amount to destination chain decimals
        uint256 convertedAmount = _convertTokenDecimals(_token, _amount, _chainId);
        uint256 outputAmount = convertedAmount * (1e18 - uint256(uint64(_bridgePercentageFee))) / 1e18;

        if (_chainId == 101) { // Solana
            callData = abi.encodeWithSignature(
                "deposit(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,bytes32,uint32,uint32,uint32,bytes)",
                bytes32(uint256(uint160(acrossAdmin))),
                _refundAddress,
                bytes32(uint256(uint160(_token))),
                0x0000000000000000000000000000000000000000000000000000000000000000, // TODO: Replace with the output token
                _amount,
                outputAmount, // outputAmount (converted to destination chain decimals)
                34268394551451, // Across Solana chainId
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
                address(uint160(uint256(_refundAddress))), // recipient (use only last 20 bytes)
                _token, // inputToken
                bridgeTokenMapping[_token][_chainId], // outputToken (note: for address(0), fillers will replace this with the destination chain equivalent of the input token)
                _amount, // inputAmount
                outputAmount, // outputAmount (converted to destination chain decimals)
                _chainId,
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

    /// @notice Sends tokens to Other chains (EVM and SVM) using Across
    /// @dev This will be used for swapping and withdrawing funds
    function _sendMessageUsingAcrossUniversal(
        uint256 _chainId,
        address _token,
        uint256 _amount,
        int64 _bridgePercentageFee,
        bytes memory _message
    ) internal {
        IERC20(_token).approve(across, _amount);
        bytes memory callData = abi.encodeWithSignature(
            "deposit(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,bytes32,uint32,uint32,uint32,bytes)",
            acrossAdmin, // depositor
            bridgeConnectorMapping[_chainId], // recipient
            bytes32(uint256(uint160(_token))), // inputToken
            bridgeTokenMappingUniversal[_token][_chainId], // output token (note: for address(0), fillers will replace this with the destination chain equivalent of the input token)
            _amount, // inputAmount
            _amount * (1e18 - uint256(uint64(_bridgePercentageFee))) / 1e18, // outputAmount
            _chainId, // destinationChainId
            address(0), // exclusiveRelayer (none for now)
            uint32(block.timestamp), // quoteTimestamp
            uint32(block.timestamp + 4 hours), // fillDeadline (4 hours from now)
            0, // exclusivityDeadline
            _message // message
        );

        bytes memory finalCallData = abi.encodePacked(callData, hex"1dc0de0083");
        Address.functionCall(across, finalCallData);
    }

    function _verifySig(
        bytes memory message,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) internal pure returns (address) {
        // Compute the message hash
        bytes32 messageHash = keccak256(message);

        // Prefix the message hash as per the Ethereum signing standard
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );

        // Verify the message using ecrecover
        address signer = ecrecover(ethSignedMessageHash, v, r, s);
        require(signer != address(0), "PolygonConnectorLogic: Invalid sig");

        return signer;
    }

    /// @notice Checks if two strings are equal
    function _isEqualString(
        string memory _a,
        string memory _b
    ) internal pure returns (bool) {
        return
            keccak256(abi.encodePacked(_a)) == keccak256(abi.encodePacked(_b));
    }

    /// @notice Extracts purpose string and checks if message is Solana format
    /// @return _purpose The purpose string extracted from the message
    function _extractPurposeAndUniqueCounterAndChainId(
        bytes memory _message
    ) private pure returns (
        string memory _purpose, 
        uint256 _uniqueCounter,
        uint256 _chainId
    ) {
        // Check if it's a Solana raw byte message by looking for known purpose strings
        // Need at least 35 bytes: 19 (purpose) + 8 (uniqueCounter) + 8 (chainId)
        if (_message.length >= 35) {
            bytes19 first19Bytes;
            bytes memory purposeBytes = abi.encodePacked("swapAndUnwrapSolana");
            bytes19 expectedPurpose;
            assembly {
                first19Bytes := mload(add(_message, 32))
                expectedPurpose := mload(add(purposeBytes, 32))
            }
            
            // Check for "swapAndUnwrapSolana" (19 bytes)
            if (first19Bytes == expectedPurpose) { // Request is for Solana
                _uniqueCounter = _readUint64LE(_message, 19); // 8 bytes for uniqueCounter
                _chainId = _readUint64LE(_message, 27); // 8 bytes for chainId

                return (
                    "swapAndUnwrapSolana", 
                    _uniqueCounter, 
                    _chainId
                );
            }
        }
        
        // Otherwise, treat as ABI-encoded EVM message
        (
            _purpose, 
            _uniqueCounter, 
            _chainId
        ) = abi.decode(_message, (string, uint256, uint256));
    }

    // Helper function to read uint64 little-endian
    function _readUint64LE(bytes memory _data, uint256 _offset) private pure returns (uint256) {
        uint256 result = 0;
        for (uint256 i = 0; i < 8; i++) {
            result |= uint256(uint8(_data[_offset + i])) << (i * 8);
        }
        return result;
    }
    
    // Helper function to read uint32 little-endian
    function _readUint32LE(bytes memory _data, uint256 _offset) private pure returns (uint32) {
        uint32 result = 0;
        for (uint256 i = 0; i < 4; i++) {
            result |= uint32(uint8(_data[_offset + i])) << uint32(i * 8);
        }
        return result;
    }
    
    // Helper function to read bytes32
    function _readBytes32(bytes memory _data, uint256 _offset) private pure returns (bytes32) {
        bytes32 result;
        assembly {
            result := mload(add(_data, add(32, _offset)))
        }
        return result;
    }

    /// @notice Converts token amount between chains with different decimals
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
        uint256 destDecimals = tokenDecimalsOnDestinationChain[_token];
        // Only convert if both chainId and destDecimals are properly configured
        if (chainId != 0 && destDecimals != 0) {
            if (_destinationChainId != chainId) {
                if (chainId == 56) { // Current chain is BSC (18 decimals -> 6 decimals)
                    convertedAmount = _amount / 10 ** (18 - destDecimals);
                } else if (_destinationChainId == 56) { // Destination chain is BSC (6 decimals -> 18 decimals)
                    convertedAmount = _amount * 10 ** (18 - destDecimals);
                }
            }
        }
        return convertedAmount;
    }
}
