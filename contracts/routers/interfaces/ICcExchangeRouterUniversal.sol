// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./ICcExchangeRouter.sol";

interface ICcExchangeRouterUniversal {

    // Universal-specific structures

    /// @notice Structure for passing arguments to _processFillUniversal function (called from fillTxUniversal function)
    struct FillUniversalArgs {
        bytes32 txId;
        bytes32 recipient;
        address intermediaryToken;
        bytes32 outputToken;
        uint256 fillAmount;
        uint256 finalAmount;
        uint256 userRequestedAmount;
        uint256 destRealChainId;
        uint256 bridgePercentageFee;
        bytes lockerLockingScript;
        bytes32[] pathFromIntermediaryToDestTokenOnDestChain;
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain;
    }

    /// @notice Structure for passing arguments to swap function
    struct swapArgumentsUniversal {
        uint destRealChainId;
        bytes _lockerLockingScript;
        ICcExchangeRouter.ccExchangeRequestV2 _ccExchangeRequestV2;
        ICcExchangeRouter.extendedCcExchangeRequest _extendedCcExchangeRequest;
        bytes32 _txId;
        address[] _path;
        address _exchangeConnector;
        bytes32[] _pathFromIntermediaryToDestTokenOnDestChain;
        uint256[] _amountsFromIntermediaryToDestTokenOnDestChain;
    }

    /// @notice Structure for passing data to _swapUniversal function (called from _wrapAndSwapUniversal function)
    struct SwapUniversalData {
        address teleBTC;
        address wrappedNativeToken;
        uint256 currentChainId;
        address lockers;
        address teleporter;
    }

    /// @notice Structure for passing arguments to _sendTokenToOtherChainUniversal function
    struct SendTokenToOtherChainArguments {
        bytes32 _txId;
        uint256 _destRealChainId;
        address _intermediaryToken;
        bytes32 _outputToken;
        uint256 _amount;
        bytes32 _user;
        uint256 _bridgePercentageFee;
    }

    /// @notice Structure for passing arguments to _sendTeleBtcToFillerUniversal function
    struct SendTeleBtcToFillerUniversalArgs {
        address filler;
        bytes32 txId;
        bytes lockerLockingScript;
        uint256 destinationChainId;
        bytes32[] pathFromIntermediaryToDestTokenOnDestChain;
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain;
    }

    // Universal-specific events

    /// @notice Emits when a new filler fills a request
    /// @param filler Address of filler
    /// @param user Address of user
    /// @param lockerTargetAddress Address of Locker
    /// @param bitcoinTxId The transaction ID of request on Bitcoin
    /// @param inputAndOutputToken [inputToken, outputToken]
    /// @param amountArgs [fillAmount, finalAmount, userRequestedAmount, destinationChainId, bridgePercentageFee]
    /// @param pathFromIntermediaryToDestTokenOnDestChain Path from intermediary token to destination token on destination chain
    /// @param amountsFromIntermediaryToDestTokenOnDestChain Amounts from intermediary token to destination token on destination chain
    event RequestFilledUniversal(
        address filler,
        bytes32 user,
        address lockerTargetAddress,
        bytes32 bitcoinTxId,
        address[2] inputAndOutputToken,
        uint256[5] amountArgs,
        bytes32[] pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain
    );

    /// @notice Emits when a cc exchange request gets done
    /// @param lockerTargetAddress Address of Locker
    /// @param user Exchange recipient address
    /// @param inputIntermediaryOutputToken [inputToken, outputToken]
    /// @param inputIntermediaryOutputAmount [inputAmount, outputAmount]
    /// @param speed Speed of the request (normal or instant)
    /// @param teleporter Address of teleporter who submitted the request
    /// @param bitcoinTxId The transaction ID of request on Bitcoin
    /// @param protocolIds [destinationChainId, appId, thirdPartyId]
    /// @param fees [network fee, locker fee, protocol fee, third party fee, bridge fee]
    /// @param pathFromIntermediaryToDestTokenOnDestChain Path from intermediary token to destination token on destination chain
    /// @param amountsFromIntermediaryToDestTokenOnDestChain Amounts from intermediary token to destination token on destination chain
    event NewWrapAndSwapUniversal(
        address lockerTargetAddress,
        bytes32 indexed user,
        bytes32[3] inputIntermediaryOutputToken,
        uint[3] inputIntermediaryOutputAmount,
        uint indexed speed,
        address indexed teleporter,
        bytes32 bitcoinTxId,
        uint256[3] protocolIds,
        uint[5] fees,
        bytes32[] pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain
    );

    /// @notice Emits when a cc exchange request fails
    /// @param lockerTargetAddress Address of Locker
    /// @param recipientAddress Exchange recipient address
    /// @param inputIntermediaryOutputToken [inputToken, outputToken]
    /// @param inputIntermediaryOutputAmount [inputAmount, outputAmount]
    /// @param speed Speed of the request (normal or instant)
    /// @param teleporter Address of teleporter who submitted the request
    /// @param bitcoinTxId The transaction ID of request on Bitcoin
    /// @param protocolIds [destinationChainId, appId, thirdPartyId]
    /// @param fees [network fee, locker fee, protocol fee, third party fee, bridge fee]
    /// @param pathFromIntermediaryToDestTokenOnDestChain Path from intermediary token to destination token on destination chain
    /// @param amountsFromIntermediaryToDestTokenOnDestChain Amounts from intermediary token to destination token on destination chain
    event FailedWrapAndSwapUniversal(
        address lockerTargetAddress,
        bytes32 indexed recipientAddress,
        bytes32[3] inputIntermediaryOutputToken,
        uint[3] inputIntermediaryOutputAmount,
        uint indexed speed,
        address indexed teleporter,
        bytes32 bitcoinTxId,
        uint256[3] protocolIds,
        uint[5] fees,
        bytes32[] pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain
    );

    // Universal-specific functions

    function setDestConnectorProxyMapping(uint256 _destRealChainId, bytes32 _destConnectorProxy) external;

    function setIntermediaryTokenMapping(
        bytes8 _outputTokenID,
        uint256 _chainId,
        bytes32 _intermediaryToken
    ) external;

    function fillTxUniversal(
        bytes32 _txId,
        bytes32 _recipient,
        address _intermediaryToken,
        bytes32 _outputToken,
        uint _fillAmount,
        uint _userRequestedAmount,
        uint _destRealChainId,
        uint _bridgePercentageFee,
        bytes memory _lockerLockingScript,
        bytes32[] memory _pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] memory _amountsFromIntermediaryToDestTokenOnDestChain
    ) external payable;

    function wrapAndSwapUniversal(
        ICcExchangeRouter.TxAndProof memory _txAndProof,
        bytes calldata _lockerLockingScript,
        address[] memory _pathFromTeleBtcToIntermediary,
        bytes32[] memory _pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] memory _amountsFromIntermediaryToDestTokenOnDestChain
    ) external payable returns(bool);
}
