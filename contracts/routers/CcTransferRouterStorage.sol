// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/ICcTransferRouter.sol";

abstract contract CcTransferRouterStorage is ICcTransferRouter {

    // Constants
    uint constant MAX_PERCENTAGE_FEE = 10000;

    // Public variables
    uint public override startingBlockNumber;
    uint public override chainId;
    uint public override appId;
    uint public override protocolPercentageFee; // A number between 0 to 10000
    address public override relay;
    address public override lockers;
    address public override teleBTC;
    address public override specialTeleporter;
    address public override treasury;
    mapping(bytes32 => ccTransferRequest) public ccTransferRequests; // TxId to ccTransferRequest structure
}