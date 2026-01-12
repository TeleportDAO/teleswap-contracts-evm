// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IBrc20Router.sol";

abstract contract Brc20RouterStorage is IBrc20Router {

    // Constants
    uint constant MAX_PROTOCOL_FEE = 10000;

    // Public variables
    uint public override startingBlockNumber;
    uint public override chainId;
    uint public override protocolPercentageFee; // In range of [0, 10000]
    uint public lockerPercentageFee; // In range of [0, 10000]
    uint public unwrapCounter;
    address public override relay;
    address public override treasury;
    address public override locker;
    mapping(uint => address) public supportedBrc20s; // Mapping from tokenId to tokenAddress
    mapping(string => uint) public tokenIds; // Mapping from tick to tokenId
    mapping(uint => uint) public unwrapFees; // Mapping from tokenId to unwrapFee
    mapping(bytes32 => brc20WrapRequest) public brc20WrapRequests;
    mapping(uint => address) public override exchangeConnector; 
    // ^ Mapping from app id to exchange connector address
    brc20UnwrapRequest[] public brc20UnwrapRequests;
    bytes public override lockerLockingScript;
    ScriptTypes public override lockerScriptType;
    address public override teleporter;

    // New variables
    mapping(uint => thirdParty) public thirdParties; // Mapping from thirdPartyId to thirdParty (address, fee)
    uint public unwrapFee; // This fee (which is in native token) covers cost of sending BRC-20 tokens to the user
    address public wrappedNativeToken;
}
