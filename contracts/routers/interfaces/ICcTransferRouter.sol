// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

interface ICcTransferRouter {

	// Structures

	/// @notice                    Structure for recording cross-chain transfer requests
	/// @param inputAmount         Amount of locked BTC on source chain
	/// @param recipientAddress    Address of transfer recipient
	/// @param fee                 Amount of fee that is paid to Teleporter (tx, relayer and teleporter fees)
	/// @param speed               Speed of the request (normal or instant)
	/// @param isUsed              Whether the tx is used or not
	struct ccTransferRequest {
		uint inputAmount;
		address recipientAddress;
		uint fee;
		uint256 speed;
		bool isUsed;
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

	// Events

	/// @notice                    	Emits when a cc transfer request gets done
	/// @param bitcoinTxId                	The transaction ID of request on Bitcoin 
	/// @param lockerLockingScript  Locking script of the locker on bitcoin network
	/// @param lockerTargetAddress  Address of the locker on EVM based target chain
	/// @param user                	Address of teleBTC recipient
	/// @param teleporter          	Address of teleporter who submitted the request
	/// @param amounts             	[inputAmount, teleBTCAmount]
	/// @param fees                	[network fee, locker fee, protocol fee, third party fee]
	/// @param thirdPartyId        	Id of third party
	/// @param destinationChainId  	Id of the destination chain
	event NewWrap(
		bytes32 bitcoinTxId,
		bytes indexed lockerLockingScript,
		address lockerTargetAddress,
		address indexed user,
		address teleporter,
		uint[2] amounts,
		uint[4] fees,
		uint thirdPartyId,
		uint destinationChainId
	);

	/// @notice                     Emits when changes made to relay address
    event NewRelay (
        address oldRelay, 
        address newRelay
    );

    /// @notice                     Emits when changes made to InstantRouter address
    event NewInstantRouter (
        address oldInstantRouter, 
        address newInstantRouter
    );

    /// @notice                     Emits when changes made to Lockers address
    event NewLockers (
        address oldLockers, 
        address newLockers
    );

    /// @notice                     Emits when changes made to TeleBTC address
    event NewTeleBTC (
        address oldTeleBTC, 
        address newTeleBTC
    );

    /// @notice                     Emits when changes made to protocol percentage fee
    event NewProtocolPercentageFee (
        uint oldProtocolPercentageFee, 
        uint newProtocolPercentageFee
    );

    /// @notice                     Emits when changes made to Treasury address
    event NewTreasury (
        address oldTreasury, 
        address newTreasury
    );

	/// @notice                     Emits when changes made to third party address
	event NewThirdPartyAddress(
		uint thirdPartyId,
		address oldThirdPartyAddress, 
		address newThirdPartyAddress
	);

	/// @notice                     Emits when changes made to third party fee
	event NewThirdPartyFee(
		uint thirdPartyId,
		uint oldThirdPartyFee, 
		uint newThirdPartyFee
	);



	// Read-only functions

	function isRequestUsed(bytes32 _txId) external view returns (bool);
	
	function startingBlockNumber() external view returns (uint);
	
	function protocolPercentageFee() external view returns (uint);
	
	function chainId() external view returns (uint);

	function appId() external view returns (uint);

	function relay() external view returns (address);

	function instantRouter() external view returns (address);

	function lockers() external view returns (address);

	function teleBTC() external view returns (address);

	function treasury() external view returns (address);

	// State-changing functions

	function setStartingBlockNumber(uint _startingBlockNumber) external;

	function setRelay(address _relay) external;

	function setInstantRouter(address _instantRouter) external;

	function setLockers(address _lockers) external;

	function setTeleBTC(address _teleBTC) external;

	function setTreasury(address _treasury) external;

	function setProtocolPercentageFee(uint _protocolPercentageFee) external;

	function setLockerPercentageFee(uint256 _lockerPercentageFee) external;

	function setThirdPartyAddress(uint _thirdPartyId, address _thirdPartyAddress) external;

	function setThirdPartyFee(uint _thirdPartyId, uint _thirdPartyFee) external;

	function wrap(
		TxAndProof memory _txAndProof,
		bytes calldata _lockerLockingScript
	) external payable returns (bool);
}