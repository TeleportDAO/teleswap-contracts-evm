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

    /// @notice Setter for TargetChainConnectorProxy
    function setTargetChainConnectorProxy(
        address _targetChainConnectorProxy
    ) external override onlyOwner {
        _setTargetChainConnectorProxy(_targetChainConnectorProxy);
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
        _validateTransfer(_token, _amounts[0]);

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
            _token,
            _amounts[0],
            message,
            _relayerFeePercentage
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
        _validateTransfer(_token, _amounts[0]);

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
                _token,
                _amounts[0],
                message,
                _relayerFeePercentage
            );
        // }
    }

    /// @notice Request exchanging token for RUNE
    function swapAndUnwrapRune(
        address _token,
        uint256 _appId,
        uint256[] calldata _amounts,
        uint256 _internalId,
        address[] calldata _path,
        UserScript calldata _userScript,
        int64 _relayerFeePercentage,
        uint256 _thirdParty
    ) external payable override nonReentrant {
        _validateTransfer(_token, _amounts[0]);

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
            _token,
            _amounts[0],
            message,
            _relayerFeePercentage
        );
    }

    /// @notice Internal function to validate ETH/token transfer
    function _validateTransfer(address _token, uint256 _amount) private view {
        if (msg.value == _amount) {
            require(_token == ETH_ADDR || _token == wrappedNativeToken, "EthConnectorLogic: wrong value");
        } else {
            require(msg.value == 0, "EthConnectorLogic: wrong value");
        }
    }

    /// @notice Send tokens and message using Across bridge
    function _sendMsgUsingAcross(
        address _token,
        uint256 _amount,
        bytes memory _message,
        int64 _relayerFeePercentage
    ) internal {
        uniqueCounter++;

        if (msg.value > 0) { // Token is ETH
            _token = wrappedNativeToken;
        } else {
            // Transfer tokens from user to contract
            IERC20(_token).safeTransferFrom(
                _msgSender(),
                address(this),
                _amount
            );
            IERC20(_token).safeApprove(across, _amount);
        }

        // Call across for transferring token and msg
        bytes memory callData = abi.encodeWithSignature(
            "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
            acrossAdmin, // depositor
            targetChainConnectorProxy, // recipient
            _token, // inputToken
            bridgeTokenMapping[_token][targetChainId], // outputToken (note: for address(0), fillers will replace this with the destination chain equivalent of the input token)
            _amount, // inputAmount
            _amount * (1e18 - uint256(uint64(_relayerFeePercentage))) / 1e18, // outputAmount
            targetChainId, // destinationChainId
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

    function _setTargetChainConnectorProxy(
        address _targetChainConnectorProxy
    ) private nonZeroAddress(_targetChainConnectorProxy) {
        emit TargetChainConnectorUpdated(
            targetChainConnectorProxy,
            _targetChainConnectorProxy
        );

        targetChainConnectorProxy = _targetChainConnectorProxy;
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
