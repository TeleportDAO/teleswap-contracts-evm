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

    event AcrossUpdated(address oldAcross, address newAcross);

    event TargetChainConnectorUpdated(
        address oldTargetChainConnector,
        address newTargetChainConnector
    );

    event WrappedNativeTokenUpdated(
        address oldWrappedNativeToken,
        address newWrappedNativeToken
    );

    function setAcross(address _across) external;

    function setTargetChainConnectorProxy(
        address _targetChainConnector
    ) external;

    function setWrappedNativeToken(address _wrappedNativeToken) external;

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

    function swapAndUnwrapRune(
        address _token,
        uint256 _appId,      
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
}
