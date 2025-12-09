// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
// import { IStargate } from "@stargatefinance/stg-evm-v2/src/interfaces/IStargate.sol";
// import { MessagingFee, OFTReceipt, SendParam } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/interfaces/IOFT.sol";
// import { OptionsBuilder } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";
import "./EthConnectorStorage.sol";
import "./interfaces/IEthConnector.sol";
import "../dex_connectors/interfaces/IDexConnector.sol";

contract EthConnectorLogic is
    IEthConnector,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    EthConnectorStorage
{
    error ZeroAddress();
    using SafeERC20 for IERC20;

    modifier nonZeroAddress(address _address) {
        if (_address == address(0)) revert ZeroAddress();
        _;
    }

    function initialize(
        address _across,
        address _wrappedNativeToken,
        uint256 _targetChainId,
        uint256 _currChainId
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        PausableUpgradeable.__Pausable_init();

        _setAcross(_across);
        _setWrappedNativeToken(_wrappedNativeToken);
        targetChainId = _targetChainId;
        currChainId = _currChainId;
        uniqueCounter = 0; // This is a shared counter for all request types
    }

    receive() external payable {}

    /// @notice Setter for Across
    function setAcross(address _across) external override onlyOwner {
        _setAcross(_across);
    }

    /// @notice Setter for Across Admin
    function setAcrossAdmin(
        address _acrossAdmin
    ) external onlyOwner {
        acrossAdmin = _acrossAdmin;
    }

    /// @notice Setter for WrappedNativeToken
    function setWrappedNativeToken(
        address _wrappedNativeToken
    ) external override onlyOwner {
        _setWrappedNativeToken(_wrappedNativeToken);
    }

    /// @notice Withdraw tokens in the emergency case
    /// @dev Only owner can call this
    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external override onlyOwner {
        if (_token == ETH_ADDR) _to.call{value: _amount}("");
        else IERC20(_token).safeTransfer(_to, _amount);
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

    /// @notice Setter for bridge connector mapping
    /// @param _exchangeConnector Address of the exchange connector
    /// @param _targetChainId Target chain ID
    /// @param _targetChainConnectorProxy Address of the target chain connector proxy
    function setBridgeConnectorMapping(
        address _exchangeConnector,
        uint256 _targetChainId,   
        address _targetChainConnectorProxy
    ) external override onlyOwner {
        bridgeConnectorMapping[_exchangeConnector] = BridgeConnectorData({
            targetChainId: _targetChainId,
            targetChainConnectorProxy: _targetChainConnectorProxy
        });
    }

    /// @notice Setter for Exchange Connector
    function setExchangeConnector(
        address _exchangeConnector
    ) external override onlyOwner nonZeroAddress(_exchangeConnector) {
        exchangeConnector = _exchangeConnector;
    }

    /// @notice Setter for Gas Limit
    function setGasLimit(
        uint256 _gasLimit
    ) external override onlyOwner {
        gasLimit = _gasLimit;
    }

    /// @notice Approve token for spender
    function approveToken(
        address _token,
        address _spender,
        uint256 _amount
    ) external onlyOwner {
        IERC20(_token).safeApprove(_spender, _amount);
    }

    /// @notice Request exchanging token for BTC
    /// @dev To find teleBTCAmount, _relayerFeePercentage should be reduced from the inputTokenAmount
    /// @param _token Address of input token (on the current chain)
    /// @param _exchangeConnector Address of exchange connector to be used
    /// @param _amounts [inputTokenAmount, teleBTCAmount]
    /// @param _path of exchanging inputToken to teleBTC (these are Polygon token addresses, so _path[0] != _token)
    /// @param _relayerFeePercentage Fee percentage for relayer
    /// @param _thirdParty Id of third party
    function swapAndUnwrap(
        address _token,
        address _exchangeConnector,
        uint256[] calldata _amounts,
        bool _isInputFixed,
        address[] calldata _path,
        UserAndLockerScript calldata _userAndLockerScript,
        int64 _relayerFeePercentage,
        uint256 _thirdParty
    ) external payable override nonReentrant {
        _checkMessageValue(_token, _amounts[0]);

        bytes memory message = abi.encode(
            "swapAndUnwrap",
            uniqueCounter,
            currChainId,
            tx.origin, // note: We changed from _msgSender() to tx.origin so that we can refund to the original sender in case of failure
            _exchangeConnector,
            _amounts[1],
            _isInputFixed,
            _path,
            _userAndLockerScript,
            _thirdParty
        );

        emit MsgSent(uniqueCounter, message, _token, _amounts[0], _relayerFeePercentage);
        _sendMsgUsingAcross(
            _exchangeConnector,
            _token,
            _amounts[0],
            message,
            _relayerFeePercentage,
            false
        );
    }

    function swapAndUnwrapV2(
        address _token,
        address _exchangeConnector,
        uint256[] calldata _amounts,
        bool _isInputFixed,
        address[] calldata _path,
        UserAndLockerScript calldata _userAndLockerScript,
        int64 _relayerFeePercentage,
        uint256 _thirdParty,
        address _refundAddress
    ) external payable override nonReentrant {
        _checkMessageValue(_token, _amounts[0]);

        bytes memory message = abi.encode(
            "swapAndUnwrap",
            uniqueCounter,
            currChainId,
            _refundAddress,
            _exchangeConnector,
            _amounts[1],
            _isInputFixed,
            _path,
            _userAndLockerScript,
            _thirdParty
        );

        emit MsgSent(uniqueCounter, message, _token, _amounts[0], _relayerFeePercentage);

        // if (_relayerFeePercentage == 0) {
        //     // Here we are using Stargate to send the message
        //     _sendMsgUsingStargate(
        //         _token,
        //         _amounts[0],
        //         message,
        //         _refundAddress
        //     );
        // } else {
            // Here we are using Across to send the message
            _sendMsgUsingAcross(
                _exchangeConnector,
                _token,
                _amounts[0],
                message,
                _relayerFeePercentage,
                false
            );
        // }
    }

    function swapAndUnwrapV3(
        SwapAndUnwrapV3Arguments calldata _arguments,
        address _exchangeConnector,
        bool _isInputFixed,
        UserAndLockerScript calldata _userAndLockerScript,
        uint256 _thirdParty,
        address _refundAddress
    ) external payable nonReentrant {
        _checkMessageValue(
            _arguments._pathFromInputToIntermediaryOnSourceChain[0], // Input token on source chain
            _arguments._amountsFromInputToIntermediaryOnSourceChain[0] // Input token amount on source chain
        );

        address intermediaryToken = _arguments._pathFromInputToIntermediaryOnSourceChain[
            _arguments._pathFromInputToIntermediaryOnSourceChain.length - 1
        ];

        // Swap input token to intermediary token on source chain
        uint256 intermediaryTokenAmount = _swapInputTokenToIntermediaryTokenOnSourceChain(
            _arguments._pathFromInputToIntermediaryOnSourceChain,
            _arguments._amountsFromInputToIntermediaryOnSourceChain
        );

        // bytes memory message = abi.encode(
        //     "swapAndUnwrap",
        //     uniqueCounter,
        //     currChainId,
        //     _refundAddress,
        //     _exchangeConnector,
        //     _amounts[1],
        //     _isInputFixed,
        //     _path,
        //     _userAndLockerScript,
        //     _thirdParty
        // );

        // Send message to intermediary chain to swap intermediary token to TeleBTC
        bytes memory message = abi.encode(
            "swapAndUnwrapV3",
            uniqueCounter,
            currChainId,
            _refundAddress,
            _exchangeConnector,
            _arguments._minOutputAmount,
            _isInputFixed,
            _arguments._pathFromIntermediaryToOutputOnIntermediaryChain,
            _userAndLockerScript,
            _thirdParty
        );

        emit MsgSent(
            uniqueCounter, 
            message, 
            _arguments._pathFromInputToIntermediaryOnSourceChain[0], 
            _arguments._amountsFromInputToIntermediaryOnSourceChain[0], 
            _arguments._bridgePercentageFee
        );

        // if (_relayerFeePercentage == 0) {
        //     // Here we are using Stargate to send the message
        //     _sendMsgUsingStargate(
        //         _token,
        //         _amounts[0],
        //         message,
        //         _refundAddress
        //     );
        // } else {

        // Here we are using Across to send the message
        _sendMsgUsingAcross(
            _exchangeConnector,
            intermediaryToken,
            intermediaryTokenAmount,
            message,
            _arguments._bridgePercentageFee,
            true
        );
        // }
    }

    /// @notice Request exchanging token for RUNE
    function swapAndUnwrapRune(
        address _token,
        uint256 _appId,
        address _exchangeConnector,
        uint256[] calldata _amounts,
        uint256 _internalId,
        address[] calldata _path,
        UserScript calldata _userScript,
        int64 _relayerFeePercentage,
        uint256 _thirdParty
    ) external payable override nonReentrant {
        _checkMessageValue(_token, _amounts[0]);

        bytes memory message = abi.encode(
            "swapAndUnwrapRune",
            uniqueCounter,
            currChainId,
            tx.origin,
            _appId,
            _amounts[1],
            _internalId,
            _path,
            _userScript,
            _thirdParty
        );

        emit MsgSentRune(uniqueCounter, message, _token, _amounts[0], _relayerFeePercentage);
        _sendMsgUsingAcross(
            _exchangeConnector,
            _token,
            _amounts[0],
            message,
            _relayerFeePercentage,
            false
        );
    }

    /// @notice Process requests coming from Ethereum (using Across V3)
    function handleV3AcrossMessage(
        address _tokenSent,
        uint256 _amount,
        address,
        bytes memory _message
    ) external override nonReentrant {
        // To avoid gas limit issues
        require(gasleft() >= gasLimit, "EthConnectorLogic: low gas");

        // Check the msg origin
        require(msg.sender == across, "EthConnectorLogic: not across");

        // Extract purpose, uniqueCounter and chainId
        (
            string memory purpose, 
            uint256 uniqueCounter,
            uint256 chainId
        ) = abi.decode(_message, (string, uint256, uint256));
        
        emit MsgReceived(purpose, uniqueCounter, chainId, _message);

        if (_isEqualString(purpose, "swapBackAndRefund")) {
            _swapBackAndRefund(_amount, _message, _tokenSent);
        } else if (_isEqualString(purpose, "wrapAndSwapV2")) {
            // todo: to be implemented for wrap
            // _wrapAndSwapV2(_amount, _message, _tokenSent);
        }
    }

    /// @notice Checks if two strings are equal
    function _isEqualString(
        string memory _a,
        string memory _b
    ) internal pure returns (bool) {
        return
            keccak256(abi.encodePacked(_a)) == keccak256(abi.encodePacked(_b));
    }

    /// @notice Helper for exchanging token for the source token on the source chain
    function _swapBackAndRefund(
        uint256 _amount,
        bytes memory _message,
        address _tokenSent
    ) internal {
        exchangeForSourceTokenArguments memory arguments = _decodeRefundReq(_message);

        require(
            arguments.pathFromIntermediaryToInputOnSourceChain[0] == _tokenSent,
            "EthConnectorLogic: invalid path"
        );

        require(
            arguments.amountsFromIntermediaryToInputOnSourceChain[0] == _amount,
            "EthConnectorLogic: invalid amount"
        );

        address inputToken = arguments.pathFromIntermediaryToInputOnSourceChain[
            arguments.pathFromIntermediaryToInputOnSourceChain.length - 1
        ];

        // Swap intermediary token to input token on source chain
        uint256 inputTokenAmount = _swapBackIntermediaryTokenToInputTokenOnSourceChain(
            arguments.pathFromIntermediaryToInputOnSourceChain,
            arguments.amountsFromIntermediaryToInputOnSourceChain
        );

        IERC20(inputToken).safeTransfer(
            arguments.refundAddress,
            inputTokenAmount
        );

        emit swappedBackAndRefundedToSourceChain(
            arguments.uniqueCounter,
            arguments.chainId,
            arguments.refundAddress,
            arguments.pathFromIntermediaryToInputOnSourceChain,
            arguments.amountsFromIntermediaryToInputOnSourceChain
        );
    }

    function _decodeRefundReq(
        bytes memory _message
    ) private pure returns (exchangeForSourceTokenArguments memory arguments) {
        (
            , // string "swapBackAndRefund"
            arguments.uniqueCounter,
            arguments.chainId,
            arguments.refundAddress,
            arguments.pathFromIntermediaryToInputOnSourceChain,
            arguments.amountsFromIntermediaryToInputOnSourceChain
        ) = abi.decode(
            _message,
            (
                string,
                uint256,
                uint256,
                address,
                address[],
                uint256[]
            )
        );
    }

    /// @notice Internal function to check ETH value is correct
    function _checkMessageValue(address _token, uint256 _amount) private view {
        if (msg.value == _amount) {
            require(_token == ETH_ADDR || _token == wrappedNativeToken, "EthConnectorLogic: wrong value");
        } else {
            require(msg.value == 0, "EthConnectorLogic: wrong value");
        }
    }

    /// @notice Send tokens and message using Across bridge
    /// @dev _tokensAlreadyInContract If true, tokens are already in contract (e.g., after swap). If false, transfer from user.
    function _sendMsgUsingAcross(
        address _exchangeConnector,
        address _token,
        uint256 _amount,
        bytes memory _message,
        int64 _relayerFeePercentage,
        bool _tokensAlreadyInContract
    ) internal {
        uniqueCounter++;

        address depositor;
        if (msg.value > 0) { // Token is ETH
            _token = wrappedNativeToken;
        } else {
            if (!_tokensAlreadyInContract) {
                IERC20(_token).safeTransferFrom(
                    _msgSender(),
                    address(this),
                    _amount
                );
                depositor = acrossAdmin;
            } else {
                depositor = address(this);
            }
            IERC20(_token).safeApprove(across, _amount);
        }

        // Call across for transferring token and msg
        bytes memory callData = abi.encodeWithSignature(
            "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
            depositor, // depositor
            bridgeConnectorMapping[_exchangeConnector].targetChainConnectorProxy, // recipient
            _token, // inputToken
            bridgeTokenMapping[_token][bridgeConnectorMapping[_exchangeConnector].targetChainId], // outputToken (note: for address(0), fillers will replace this with the destination chain equivalent of the input token)
            _amount, // inputAmount
            _amount * (1e18 - uint256(uint64(_relayerFeePercentage))) / 1e18, // outputAmount
            bridgeConnectorMapping[_exchangeConnector].targetChainId, // destinationChainId
            address(0), // exclusiveRelayer (none for now)
            uint32(block.timestamp), // quoteTimestamp
            uint32(block.timestamp + 4 hours), // fillDeadline (4 hours from now)
            0, // exclusivityDeadline
            _message // message
        );

        // Append integrator identifier
        bytes memory finalCallData = abi.encodePacked(callData, hex"1dc0de0083"); // delimiter (1dc0de) + integratorID (0x0083)

        Address.functionCallWithValue(
            across,
            finalCallData,
            msg.value
        );
    }

    function _swapInputTokenToIntermediaryTokenOnSourceChain(
        address[] calldata _pathFromInputToIntermediaryOnSourceChain,
        uint256[] calldata _amountsFromInputToIntermediaryOnSourceChain
    ) internal returns (uint256 _intermediaryTokenAmount) {
        address inputToken = _pathFromInputToIntermediaryOnSourceChain[0];
        // Transfer tokens from user to contract
        IERC20(inputToken).safeTransferFrom(
            _msgSender(),
            address(this),
            _amountsFromInputToIntermediaryOnSourceChain[0]
        );

        // Approve exchange connector to spend intermediary tokens
        IERC20(inputToken).safeApprove(exchangeConnector, _amountsFromInputToIntermediaryOnSourceChain[0]);
        
        (bool success, uint256[] memory amounts) = IDexConnector(exchangeConnector).swap(
            _amountsFromInputToIntermediaryOnSourceChain[0], // Input token amount on source chain
            _amountsFromInputToIntermediaryOnSourceChain[1], // Intermediary token amount on source chain
            _pathFromInputToIntermediaryOnSourceChain,
            address(this),
            block.timestamp,
            true
        );

        if (success) {
            _intermediaryTokenAmount = amounts[amounts.length - 1];
        } else {
            revert("EthConnectorLogic: swap failed");
        }
    }

    function _swapBackIntermediaryTokenToInputTokenOnSourceChain(
        address[] memory _pathFromIntermediaryToInputOnSourceChain,
        uint256[] memory _amountsFromIntermediaryToInputOnSourceChain
    ) internal returns (uint256 _inputTokenAmount) {
        address intermediaryToken = _pathFromIntermediaryToInputOnSourceChain[0];
        // Transfer tokens from user to contract
        IERC20(intermediaryToken).safeTransferFrom(
            _msgSender(),
            address(this),
            _amountsFromIntermediaryToInputOnSourceChain[0]
        );
        
        // Approve exchange connector to spend intermediary tokens
        IERC20(intermediaryToken).safeApprove(exchangeConnector, _amountsFromIntermediaryToInputOnSourceChain[0]);
        
        (bool success, uint256[] memory amounts) = IDexConnector(exchangeConnector).swap(
            _amountsFromIntermediaryToInputOnSourceChain[0], // Input token amount on source chain
            _amountsFromIntermediaryToInputOnSourceChain[1], // Intermediary token amount on source chain
            _pathFromIntermediaryToInputOnSourceChain,
            address(this),
            block.timestamp,
            true
        );

        if (success) {
            _inputTokenAmount = amounts[amounts.length - 1];
        } else {
            revert("EthConnectorLogic: swap failed");
        }
    }

    // function _sendMsgUsingStargate(
    //     address _token,
    //     uint256 _amount,
    //     bytes memory _message,
    //     address _refundAddress
    // ) internal {

    //     bytes memory extraOptions = _message.length > 0
    //         ? OptionsBuilder.newOptions().addExecutorLzComposeOption(0, 200_000, 0) // compose gas limit
    //         : bytes("");
 
    //     sendParam = SendParam({
    //         dstEid: _dstEid,
    //         to: _addressToBytes32(targetChainConnectorProxy), // composer address
    //         amountLD: _amount,
    //         minAmountLD: _amount,
    //         extraOptions: extraOptions,
    //         composeMsg: _message,
    //         oftCmd: ""
    //     });
 
    //     IStargate stargateContract = IStargate(stargate);
 
    //     (, , OFTReceipt memory receipt) = stargateContract.quoteOFT(sendParam);
    //     // Min received amount on the destination chain
    //     sendParam.minAmountLD = receipt.amountReceivedLD;
 
    //     messagingFee = stargateContract.quoteSend(
    //         sendParam, 
    //         false // pay fee with lz token
    //     );
    //     // Native fee to send the message
    //     valueToSend = messagingFee.nativeFee;
 
    //     if (stargateContract.token() == address(0x0)) {
    //         valueToSend += sendParam.amountLD;
    //     }

    //     stargateContract.sendToken{ value: valueToSend }(sendParam, messagingFee, _refundAddress);
    // }

    function _setAcross(address _across) private nonZeroAddress(_across) {
        emit AcrossUpdated(across, _across);
        across = _across;
    }

    function _setWrappedNativeToken(
        address _wrappedNativeToken
    ) private nonZeroAddress(_wrappedNativeToken) {
        emit WrappedNativeTokenUpdated(wrappedNativeToken, _wrappedNativeToken);

        wrappedNativeToken = _wrappedNativeToken;
    }

    function _addressToBytes32(address _addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }
}
