// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@teleportdao/btc-evm-bridge/contracts/types/ScriptTypesEnum.sol";

interface IPolyConnector {
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

    struct exchangeForBtcArguments {
        uint256 uniqueCounter;
        uint256 chainId;
        address user;
        address exchangeConnector;
        uint256 outputAmount;
        bool isInputFixed;
        address[] path;
        UserAndLockerScript scripts;
        uint256 thirdParty;
    }

    struct exchangeForRuneArguments {
        uint256 uniqueCounter;
        uint256 chainId;
        address user;
        uint256 thirdPartyId;
        uint256 internalId;
        uint256 appId;
        uint256 outputAmount;
        address[] path;
        UserScript userScript;
    }

    // Events

    event MsgReceived(
        string functionName,
        uint256 uniqueCounter,
        uint256 chainId,
        bytes data
    );

    event NewSwapAndUnwrap(
        uint256 uniqueCounter,
        uint256 chainId,
        address exchangeConnector,
        address inputToken,
        uint256 inputAmount,
        address indexed userTargetAddress,
        bytes userScript,
        ScriptTypes scriptType,
        address lockerTargetAddress,
        uint256 requestIdOfLocker,
        address[] path,
        uint256 thirdPartyId
    );

    event FailedSwapAndUnwrap(
        uint256 uniqueCounter,
        uint256 chainId,
        address exchangeConnector,
        address inputToken,
        uint256 inputAmount,
        address indexed userTargetAddress,
        bytes userScript,
        ScriptTypes scriptType,
        address[] path,
        uint256 thirdPartyId
    );

    event RetriedSwapAndUnwrap(
        uint256 uniqueCounter,
        uint256 chainId,
        address exchangeConnector,
        address inputToken,
        uint256 inputAmount,
        address indexed userTargetAddress,
        bytes userScript,
        ScriptTypes scriptType,
        address lockerTargetAddress,
        uint256 requestIdOfLocker,
        address[] path,
        uint256 thirdPartyId
    );

    event WithdrawnFundsToSourceChain(
        uint256 uniqueCounter,
        uint256 chainId,
        address token,
        uint256 amount,
        int64 relayerFeePercentage,
        address user
    );

    event NewSwapAndUnwrapRune(
        uint256 uniqueCounter,
        uint256 chainId,
        address indexed userTargetAddress,
        uint256 thirdPartyId,
        uint256 internalId,
        uint256 appId,
        uint256 amount,
        uint256 inputAmount,
        address[] path,
        bytes userScript,
        ScriptTypes scriptType,
        uint256 requestIdOfLocker
    );

    event FailedSwapAndUnwrapRune(
        uint256 uniqueCounter,
        uint256 chainId,
        address indexed userTargetAddress,
        uint256 thirdPartyId,
        uint256 internalId,
        uint256 appId,
        uint256 amount,
        uint256 inputAmount,
        address[] path,
        bytes userScript,
        ScriptTypes scriptType
    );

    event RetriedSwapAndUnwrapRune(
        uint256 uniqueCounter,
        uint256 chainId,
        address indexed userTargetAddress,
        uint256 thirdPartyId,
        uint256 internalId,
        uint256 appId,
        uint256 amount,
        uint256 inputAmount,
        address[] path,
        bytes userScript,
        ScriptTypes scriptType,
        uint256 requestIdOfLocker
    );

    event AcrossUpdated(address oldAcross, address newAcross);

    event EthConnectorUpdated(address oldEthConnector, address newEthConnector);

    event BurnRouterUpdated(address oldBurnRouter, address newBurnRouter);

    event LockersProxyUpdated(address oldLockersProxy, address newLockersProxy);

    // Read-only functions

    function lockersProxy() external view returns (address);

    function burnRouterProxy() external view returns (address);

    function across() external view returns (address);

    function failedReqs(address, uint256, address) external returns (uint256);

    function runeRouterProxy() external view returns (address);

    function newFailedReqs(
        address,
        uint256,
        uint256,
        address
    ) external returns (uint256);

    // State-changing functions

    function setAcross(address _across) external;

    function setBurnRouterProxy(address _burnRouterProxy) external;

    function setRuneRouterProxy(address _runeRouterProxy) external;

    function setLockersProxy(address _lockersProxy) external;

    function setBridgeTokenMapping(
        address _sourceToken,
        uint256 _destinationChainId,
        address _destinationToken
    ) external;

    function withdrawFundsToSourceChain(
        bytes memory _message,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external;

    function retrySwapAndUnwrap(
        bytes memory _message,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external;

    function retrySwapAndUnwrapRune(
        bytes memory _message,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external;

    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external;

    function withdrawFundsToSourceChainByOwnerOrAdmin(
        address _user,
        uint256 _chainId,
        uint256 _uniqueCounter,
        address _token,
        int64 _relayerFeePercentage
    ) external;
}
