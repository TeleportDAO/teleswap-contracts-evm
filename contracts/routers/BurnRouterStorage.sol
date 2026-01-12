// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IBurnRouter.sol";

abstract contract BurnRouterStorage is IBurnRouter {

    // Constants
    uint constant MAX_PERCENTAGE_FEE = 10000; // 10000 means 100%
    uint constant UNUSED_VARIABLE = 0; // Unused variable

    // Public variables
    address public override relay;
    address public override lockers;
    address public override teleBTC;
    address public override treasury;
    address public override bitcoinFeeOracle;
    uint public override startingBlockNumber;
    uint public override transferDeadline;
    uint public override protocolPercentageFee; // Min amount is %0.01
    uint public override slasherPercentageReward; // Min amount is %1
    uint public override bitcoinFee; // Fee of submitting a tx on Bitcoin
    
    mapping(address => burnRequest[]) public burnRequests; 
    // ^ Mapping from locker target address to assigned burn requests
    mapping(address => uint) public burnRequestCounter;
    mapping(bytes32 => bool) public override isUsedAsBurnProof; 
    // ^ Mapping that shows a txId has been submitted to pay a burn request

}