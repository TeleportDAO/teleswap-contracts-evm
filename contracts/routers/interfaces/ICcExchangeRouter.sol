// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

interface ICcExchangeRouter {

    // Structures

    struct chainIdStruct {
        uint middleChain;
        uint destinationChain;
    }

    /// @notice Structure for recording cross-chain exchange requests
    /// @param appId that user wants to use (which DEX)
    /// @param inputAmount Amount of locked BTC on source chain
    /// @param outputAmount Amount of output token
    /// @param isFixedToken True if amount of input token is fixed
    /// @param recipientAddress Address of exchange recipient
    /// @param fee Amount of fee that is paid to Teleporter (for tx, relayer and teleporter fees)
    /// @param isUsed True if tx has been submitted before
    /// @param path Exchange path from input token to output token
    /// @param deadline for exchanging tokens (not used anymore)
    /// @param speed of the request (normal or instant)
    struct ccExchangeRequest {
        uint appId;
        uint inputAmount;
        uint outputAmount;
        bool isFixedToken;
        address recipientAddress;
        uint fee;
        bool isUsed;
        address[] path;
        uint deadline;
        uint speed;
        uint destinationChain;
    }

    /// @notice Structure for recording cross-chain exchange requests
    /// @param appId that user wants to use (which DEX)
    /// @param inputAmount Amount of locked BTC on source chain
    /// @param outputAmount Amount of output token
    /// @param isFixedToken True if amount of input token is fixed
    /// @param recipientAddress Address of exchange recipient: Solana address, or zero padded EVM address
    /// @param fee Amount of fee that is paid to Teleporter (for tx, relayer and teleporter fees)
    /// @param isUsed True if tx has been submitted before
    /// @param tokenIDs Token IDs of the input and output tokens
    /// @param outputToken Output token on the destination chain (32 bytes)
    /// @param deadline for exchanging tokens (not used anymore)
    /// @param speed of the request (normal or instant)
    struct ccExchangeRequestV2 {
        uint appId;
        uint inputAmount;
        uint outputAmount; // min expected output amount
        uint minIntermediaryTokenAmount;
        bool isFixedToken;
        bytes32 recipientAddress;
        uint networkFee;
        bool isUsed;
        bytes8[2] tokenIDs;
        bytes32 outputToken;
        uint deadline;
        uint speed;
        uint destRealChainId;
    }

    /// @notice Structure for recording cross-chain exchange requests
    /// @param isRequestCompleted True if BTC to ETH exchange is processed successfully
    /// @param remainedInputAmount Amount of obtained TELEBTC on target chain
    /// @param bridgePercentageFee percentage of fee we have to give to across relayers to fill our request
    struct extendedCcExchangeRequest {
        uint destAssignedChainId;
        bool isRequestCompleted;
        uint remainedInputAmount;
        uint bridgePercentageFee;
        uint thirdParty;
        uint protocolFee;
        uint thirdPartyFee;
        uint lockerFee;
    }
    
    /// @notice Structure for passing tx and its inclusion proof
    /// @param version of the transaction containing the user request
    /// @param vin Inputs of the transaction containing the user request
    /// @param vout Outputs of the transaction containing the user request
    /// @param locktime of the transaction containing the user request
    /// @param blockNumber Height of the block containing the user request
    /// @param intermediateNodes Merkle inclusion proof for transaction containing the user request
    /// @param index of transaction containing the user request in the block
    struct TxAndProof {
        bytes4 version;
        bytes vin;
        bytes vout;
        bytes4 locktime;
        uint256 blockNumber;
        bytes intermediateNodes;
        uint index;
    }

    /// @notice Structure for storing filling requests
    /// @param startingTime First attemp to fill the request
    /// @param reqToken Requested exchange token
    /// @param lastUsedIdx Last used filler index
    /// @param remainingAmountOfLastFill Amount of unused tokens of last filler
    /// @param isWithdrawnLastFill True if last used filler has withdrawn unused tokens
    struct FillData {
        uint startingTime;
        address reqToken;
        uint lastUsedIdx;
        uint remainingAmountOfLastFill;
        bool isWithdrawnLastFill;
    }

    /// @notice Structure for storing fillers of a request
    /// @param index of filler between fillers
    /// @param token that filler used to fill
    /// @param amount that filler sent to fill
    struct FillerData {
        uint index;
        address token;
        uint amount;
    }

    /// @notice Structure for storing fillings
    /// @param prefixSum Cumulative sum of fillings
    /// @param currentIndex Next filler index
    struct PrefixFillSum {
        uint[] prefixSum;
        uint currentIndex;
    }

    /// @notice Structure for passing arguments to swap function
    struct swapArguments {
        uint destRealChainId;
        bytes _lockerLockingScript;
        ccExchangeRequest _ccExchangeRequest;
        extendedCcExchangeRequest _extendedCcExchangeRequest;
        bytes32 _txId;
        address[] _path;
        address _exchangeConnector;
    }

    /// @notice Structure for passing arguments to swap function
    struct swapArgumentsV2 {
        uint destRealChainId;
        bytes _lockerLockingScript;
        ccExchangeRequestV2 _ccExchangeRequestV2;
        extendedCcExchangeRequest _extendedCcExchangeRequest;
        bytes32 _txId;
        address[] _path;
        address _exchangeConnector;
    }

    /// @notice Structure for passing data to swapV2 function
    struct SwapV2Data {
        address teleBTC;
        address wrappedNativeToken;
        uint256 currentChainId;
        address lockers;
        address teleporter;
    }

    // Events

    event AcrossUpdated(
        address oldAcross,
        address newAcross
    );

    event BurnRouterUpdated(
        address oldBurnRouter,
        address newBurnRouter
    );

    /// @notice Emits when a new filler fills a request
    /// @param filler Address of filler
    /// @param user Address of user
    /// @param lockerTargetAddress Address of Locker
    /// @param bitcoinTxId The transaction ID of request on Bitcoin 
    /// @param inputAndOutputToken [inputToken, outputToken]
    /// @param userRequestedAmount that user requested
    /// @param finalAmount that user received
    /// @param destinationChainId chain id of destination 
    /// @param bridgePercentageFee percentage of fee we have to give to across relayers to fill our request
    event RequestFilledV2(
        address filler,
        bytes32 user,
        address lockerTargetAddress,
        bytes32 bitcoinTxId,
        address[2] inputAndOutputToken,
        uint fillAmount,
        uint finalAmount,
        uint userRequestedAmount,
        uint destinationChainId,
        uint bridgePercentageFee
    );

    event FillerRefunded(
        address filler,
        bytes32 bitcoinTxId,
        uint amount
    );

    /// @notice Emits when a cc exchange request gets done
    /// @param lockerTargetAddress Address of Locker
    /// @param user Exchange recipient address
    /// @param inputIntermediaryOutputToken [inputToken, outputToken]
    /// @param inputIntermediaryOutputAmount [inputAmount, outputAmount]
    /// @param speed Speed of the request (normal or instant)
    /// @param teleporter Address of teleporter who submitted the request
    /// @param bitcoinTxId The transaction ID of request on Bitcoin 
    /// @param appId Assigned application id to exchange
    /// @param thirdPartyId Id of third party
    /// @param fees [network fee, locker fee, protocol fee, third party fee, bridge fee]
    /// @param destinationChainId chain id of destination 
    event NewWrapAndSwapV2(
        address lockerTargetAddress,
        bytes32 indexed user,
        bytes32[3] inputIntermediaryOutputToken,
        uint[3] inputIntermediaryOutputAmount,
        uint indexed speed,
        address indexed teleporter,
        bytes32 bitcoinTxId,
        uint appId,
        uint thirdPartyId,
        uint[5] fees,
        uint destinationChainId
    );

    /// @notice Emits when a cc exchange request fails
    /// @dev We mint teleBTC and send it to the user
    /// @param lockerTargetAddress Address of Locker
    /// @param recipientAddress Exchange recipient address
    /// @param inputIntermediaryOutputToken [inputToken, outputToken]
    /// @param inputIntermediaryOutputAmount [inputAmount, outputAmount]
    /// @param speed Speed of the request (normal or instant)
    /// @param teleporter Address of teleporter who submitted the request
    /// @param bitcoinTxId The transaction ID of request on Bitcoin 
    /// @param appId Assigned application id to exchange
    /// @param thirdPartyId Id of third party
    /// @param fees [network fee, locker fee, protocol fee, third party fee, bridge fee]   
    /// @param destinationChainId chain id of destination 
    event FailedWrapAndSwapV2(
        address lockerTargetAddress,
        bytes32 indexed recipientAddress,
        bytes32[3] inputIntermediaryOutputToken,
        uint[3] inputIntermediaryOutputAmount,
        uint indexed speed,
        address indexed teleporter,
        bytes32 bitcoinTxId,
        uint appId,
        uint thirdPartyId,
        uint[5] fees,
        uint destinationChainId
    );

    /// @notice Emits when a failed request is refunded
    event RefundProcessed(
        bytes32 indexed txId,
        address indexed refundedBy,
        uint256 failedRequestAmount,
        uint256 refundAmount,   
        bytes userScript,
        uint8 scriptType,
        address lockerTargetAddress,
        uint256 burnRequestCounter
    );

    /// @notice Emits when appId for an exchange connector is set
    /// @param appId Assigned application id to exchange
    /// @param exchangeConnector Address of exchange connector contract
    event SetExchangeConnector(
        uint appId,
        address exchangeConnector
    );

    /// @notice Emit when relay contract updated
    event NewRelay(
        address oldRelay, 
        address newRelay
    );

    /// @notice Emit when lockers contract updated
    event NewLockers(
        address oldLockers, 
        address newLockers
    );

    /// @notice Emit when telebtc contract updated
    event NewTeleBTC(
        address oldTeleBTC, 
        address newTeleBTC
    );

    /// @notice Emit when protocol fee updated
    event NewProtocolPercentageFee(
        uint oldProtocolPercentageFee, 
        uint newProtocolPercentageFee
    );

    /// @notice Emit when treasury address updated
    event NewTreasury(
        address oldTreasury, 
        address newTreasury
    );

    /// @notice Emit when third party address updated
	event NewThirdPartyAddress(
		uint thirdPartyId,
		address oldThirdPartyAddress, 
		address newThirdPartyAddress
	);

	/// @notice Emit when third party fee updated
	event NewThirdPartyFee(
		uint thirdPartyId,
		uint oldThirdPartyFee, 
		uint newThirdPartyFee
	);

    /// @notice Emit when new chain id mapping added
    event NewChainIdMapping(
        uint destinationChain,
        uint mappedChainId
    );

    /// @notice Emits when wrapped native token addr updated
    event NewWrappedNativeToken(
        address oldWrappedNativeToken,
        address newWrappedNativeToken
    );

    // Read-only functions
    
    function isRequestUsed(bytes32 _txId) external view returns (bool);

    // Read-only functions
    
    function startingBlockNumber() external view returns (uint);

    function protocolPercentageFee() external view returns (uint);
    
    function chainId() external view returns (uint);

    function relay() external view returns (address);

    function lockers() external view returns (address);

    function teleBTC() external view returns (address);

    function exchangeConnector(uint _appId) external view returns (address);

    function treasury() external view returns (address);

    function isTokenSupported(uint _chainId, address _exchangeToken) external view returns (bool);

    function isChainSupported(uint _chainId) external view returns (bool);

    function across() external view returns (address);

    function burnRouter() external view returns (address);

    // State-changing functions

    function setStartingBlockNumber(uint _startingBlockNumber) external;

    function setRelay(address _relay) external;

    function setTeleporter(address _teleporter, bool _isTeleporter) external;
    
    function setLockers(address _lockers) external;

    function setTeleBTC(address _teleBTC) external;

    function setExchangeConnector(uint _appId, address _exchangeConnector) external;

	function setTreasury(address _treasury) external;

	function setProtocolPercentageFee(uint _protocolPercentageFee) external;

    function setLockerPercentageFee(uint _lockerPercentageFee) external;

    function setAcross(address _across) external;

    function setBurnRouter(address _burnRouter) external;

    function setThirdPartyAddress(uint _thirdPartyId, address _thirdPartyAddress) external;

	function setThirdPartyFee(uint _thirdPartyId, uint _thirdPartyFee) external;

    function setWrappedNativeToken(address _wrappedNativeToken) external;

    function setChainIdMapping(uint _destinationChain, uint _mappedId) external;

    function setRewardDistributor(address _rewardDistributor) external;

    function setBridgeTokenMapping(
        address _sourceToken,
        uint256 _destinationChainId,
        address _destinationToken
    ) external;

    function setInputTokenDecimalsOnDestinationChain(
        address _inputToken,
        uint256 _decimalsOnDestinationChain
    ) external; 

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
    ) external payable;

    function refundByOwnerOrAdmin(
        bytes32 _txId,
        uint8 _scriptType,
        bytes memory _userScript,
        bytes calldata _lockerLockingScript
    ) external;

    function setBridgeTokenIDMapping(
        bytes8 _tokenID,
        uint256 _destRealChainId,
        bytes32 _destinationToken
    ) external;

    function setIntermediaryTokenMapping(
        bytes8 _destinationTokenID,
        address _intermediaryToken
    ) external;

    function wrapAndSwapV2(
        TxAndProof memory _txAndProof,
        bytes calldata _lockerLockingScript,
        address[] memory _path
    ) external payable returns(bool);

    // Dynamic fee events

    event DynamicLockerFeeSet(
        uint indexed chainId,
        bytes32 indexed token,
        uint[] thirdPartyIds,
        uint[] tierIndexes,
        uint[] fees
    );

    event FeeTierBoundariesSet(uint[] boundaries);

    // Dynamic fee functions

    function setDynamicLockerFee(
        uint _destChainId,
        bytes32 _destToken,
        uint[] calldata _thirdPartyIds,
        uint[] calldata _tierIndexes,
        uint[] calldata _fees
    ) external;

    function setFeeTierBoundaries(uint[] calldata _boundaries) external;

    function getEffectiveLockerFee(
        uint _destChainId,
        bytes32 _destToken,
        uint _thirdPartyId,
        uint _amount
    ) external view returns (uint);
}