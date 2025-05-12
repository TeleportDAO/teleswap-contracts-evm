// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IRuneRouter.sol";

abstract contract RuneRouterStorage is IRuneRouter {
    // Constants
    uint constant MAX_PROTOCOL_FEE = 10000;

    // Public variables
    uint public override startingBlockNumber;
    uint public override chainId;
    uint public override protocolPercentageFee; // In range of [0, 10000]
    uint public lockerPercentageFee; // In range of [0, 10000]
    uint public runeUnwrapCounter;
    address public override relay;
    address public override treasury;
    address public override locker;
    mapping(uint => address) public supportedRunes; // Mapping from tokenId to tokenAddress
    mapping(address => string) public runeIds; // Mapping from wrapped rune address to runeId
    mapping(address => uint) public internalIds; // Mapping wrapped rune address to internalId
    mapping(bytes32 => runeWrapRequest) public runeWrapRequests;
    mapping(uint => address) public override exchangeConnector;
    // ^ Mapping from app id to exchange connector address
    runeUnwrapRequest[] public runeUnwrapRequests;
    bytes public override lockerLockingScript;
    ScriptTypes public override lockerScriptType;
    address public override teleporter;
    mapping(uint => thirdParty) public thirdParties; // Mapping from thirdPartyId to thirdParty (address, fee)
    uint public unwrapFee;
    address public wrappedNativeToken;
    address public rewardDistributor;

    // New var
    mapping(address => address) public virtualLocker;
    // ^^ [wrappedRune address] => [virtualLockerAddress]
    // This mapping introduced bcz of reward distribution contract
    // In this contract each locker address can be used for one reward token
    
    address public across;

    address public acrossAdmin;
}
