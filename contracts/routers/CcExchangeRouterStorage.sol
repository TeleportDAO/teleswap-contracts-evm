// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/ICcExchangeRouter.sol";

abstract contract CcExchangeRouterStorage is ICcExchangeRouter {

    // Constants
    uint constant MAX_PERCENTAGE_FEE = 10000; // 10000 means 100%

    // Public variables
    uint public override startingBlockNumber;
    uint public override chainId;
    uint public override protocolPercentageFee; // A number between 0 to 10000
    address public override relay;
    address public specialTeleporter; // unused
    address public override lockers;
    address public override teleBTC;
    address public override treasury;
    mapping(uint => address) public override exchangeConnector; 
    // ^ Mapping from app id to exchange connector address 

    // Private variables
    mapping(bytes32 => ccExchangeRequest) internal ccExchangeRequests;
    mapping(bytes32 => ccExchangeToSolanaRequest) internal ccExchangeToSolanaRequests;
}
