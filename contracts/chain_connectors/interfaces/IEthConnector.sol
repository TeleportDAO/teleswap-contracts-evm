// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@teleportdao/btc-evm-bridge/contracts/types/ScriptTypesEnum.sol";

interface IEthConnector {
    // Structs

    struct UserScript {
        bytes userScript;
        ScriptTypes scriptType;
    }

    struct UserAndLockerScript {
        bytes userScript;
        ScriptTypes scriptType;
        bytes lockerLockingScript;
    }

    struct BridgeConnectorData {
        uint256 targetChainId;
        address targetChainConnectorProxy;
    }

    struct SwapAndUnwrapUniversalPaths {
        address[] _pathFromInputToIntermediaryOnSourceChain;
        address[] _pathFromIntermediaryToOutputOnIntermediaryChain;
    }

    /// @notice Arguments for universal swap and unwrap function
    /// @param _pathFromInputToIntermediaryOnSourceChain Path from input token to intermediary token on the current chain
    /// @param _amountsFromInputToIntermediaryOnSourceChain Amounts of input token and intermediary token on the current chain
    /// @param _pathFromIntermediaryToOutputOnIntermediaryChain Path from intermediary token to output token on intermediary chain
    /// @param _minOutputAmount Minimum output amount of output token on the intermediary chain
    /// @param _bridgePercentageFee Bridge percentage fee
    struct SwapAndUnwrapUniversalArguments {
        address[] _pathFromInputToIntermediaryOnSourceChain;
        uint256[2] _amountsFromInputToIntermediaryOnSourceChain;
        address[] _pathFromIntermediaryToOutputOnIntermediaryChain;
        uint256 _minOutputAmount;
        int64 _bridgePercentageFee;
    }

    struct exchangeForSourceTokenArguments {
        uint256 uniqueCounter;
        uint256 chainId;
        address refundAddress;
        address exchangeConnector;
        address[] pathFromIntermediaryToInputOnSourceChain;
        uint256[] amountsFromIntermediaryToInputOnSourceChain;
    }

    struct wrapAndSwapForDestTokenArguments {
        bytes32 bitcoinTxId;
        bytes32 scriptHash; // hash of userAndLockerScript
        uint256 intermediaryChainId;
        uint256 destinationChainId;
        address targetAddress;
        uint256 destTokenAmount;
        address[] pathFromIntermediaryToDestTokenOnDestChain;
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain;
    }

    struct SwapBackAndRefundBTCArguments {
        address targetAddress;
        address destToken;
        address tokenSent;
        bytes32 bitcoinTxId;
        address exchangeConnector;
        uint256 minOutputAmount;
        UserAndLockerScript userAndLockerScript;
        address[] path;
        uint256[] amounts;
        int64 bridgePercentageFee;
        uint256 intermediaryChainId;
    }

    // Events

    event MsgSent(
        uint256 uniqueCounter,
        bytes data,
        address sourceChainInputToken,
        uint256 amount,
        int64 relayerFeePercentage
    );

    event MsgSentRune(
        uint256 uniqueCounter,
        bytes data,
        address sourceChainInputToken,
        uint256 amount,
        int64 relayerFeePercentage
    );

    event SwappedBackAndRefundedBTCUniversal(
        uint256 uniqueCounter,
        uint256 chainId,
        address token,
        uint256 amount,
        int64 bridgePercentageFee,
        address refundAddress,
        address[] pathFromIntermediaryToInputOnSourceChain,
        uint256[] amountsFromIntermediaryToInputOnSourceChain
    );

    event AcrossUpdated(address oldAcross, address newAcross);

    event TargetChainConnectorUpdated(
        address oldTargetChainConnector,
        address newTargetChainConnector
    );

    event WrappedNativeTokenUpdated(
        address oldWrappedNativeToken,
        address newWrappedNativeToken
    );

    event MsgReceived(
        string functionName,
        uint256 uniqueCounter,
        uint256 chainId,
        bytes data
    );

    event SwappedBackAndRefundedToSourceChain(
        uint256 uniqueCounter,
        uint256 chainId,
        address refundAddress,
        uint256 inputTokenAmount,
        address[] pathFromIntermediaryToInputOnSourceChain,
        uint256[] amountsFromIntermediaryToInputOnSourceChain
    );

    event FailedSwapBackAndRefundToSourceChain(
        uint256 uniqueCounter,
        uint256 chainId,
        address refundAddress,
        address inputToken,
        address tokenSent,
        uint256 tokenSentAmount
    );

    event WrappedAndSwappedToDestChain(
        bytes32 bitcoinTxId,
        uint256 destinationChainId, // current chain id
        uint256 intermediaryChainId,
        address targetAddress,
        uint256 destTokenAmount,
        address[] pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain
    );

    event FailedWrapAndSwapToDestChain(
        bytes32 bitcoinTxId,
        uint256 destinationChainId, // current chain id
        uint256 intermediaryChainId,
        address targetAddress,
        uint256 destTokenAmount,
        address[] pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain
    );

    event RefundedFailedSwapAndUnwrapUniversal(
        uint256 uniqueCounter,
        address refundAddress,
        address inputToken,
        uint256 inputTokenAmount,
        address[] pathFromIntermediaryToInputOnSourceChain,
        uint256[] amountsFromIntermediaryToInputOnSourceChain
    );

    function setAcross(address _across) external;

    function setWrappedNativeToken(address _wrappedNativeToken) external;

    function setBridgeTokenMapping(
        address _sourceToken,
        uint256 _destinationChainId,
        address _destinationToken
    ) external;

    function setBridgeConnectorMapping(
        address _exchangeConnector,
        uint256 _targetChainId,
        address _targetChainConnectorProxy
    ) external;

function setOutputTokenDecimalsOnDestinationChain(
        address _outputToken,
        uint256 _destinationChainId,
        uint256 _decimalsOnDestinationChain
    ) external;

    function setExchangeConnector(address _exchangeConnector) external;

    function swapAndUnwrap(
        address _token,
        address _exchangeConnector,
        uint256[] calldata _amounts,
        bool _isInputFixed,
        address[] calldata _path,
        UserAndLockerScript calldata _scripts,
        int64 _relayerFeePercentage,
        uint256 _thirdParty
    ) external payable;

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
    ) external payable;

    function swapAndUnwrapUniversal(
        SwapAndUnwrapUniversalArguments calldata _arguments,
        address _exchangeConnector,
        bool _isInputFixed,
        UserAndLockerScript calldata _userAndLockerScript,
        uint256 _thirdParty,
        address _refundAddress
    ) external payable;

    function swapAndUnwrapRune(
        address _token,
        uint256 _appId,      
        address _exchangeConnector,
        uint256[] calldata _amounts,
        uint256 _tokenId,
        address[] calldata _path,
        UserScript calldata _userScript,
        int64 _relayerFeePercentage,
        uint256 _thirdParty
    ) external payable;

    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external;

    function handleV3AcrossMessage(
        address _tokenSent,
        uint256 _amount,
        address,
        bytes memory _message
    ) external;

    function swapBackAndRefundBTCByAdmin(
        SwapBackAndRefundBTCArguments calldata _args
    ) external;

    function refundFailedSwapAndUnwrapUniversal(
        uint256 _uniqueCounter,
        address _refundAddress,
        address _inputToken,
        address[] calldata _pathFromIntermediaryToInputOnSourceChain,
        uint256[] calldata _amountsFromIntermediaryToInputOnSourceChain
    ) external;

    function setGasLimit(
        uint256 _gasLimit
    ) external;
}
