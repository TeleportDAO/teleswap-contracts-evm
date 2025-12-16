// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../routers/interfaces/ICcExchangeRouter.sol";
import "../dex_connectors/interfaces/IDexConnector.sol";
import "../erc20/interfaces/ITeleBTC.sol";
import "../erc20/WETH.sol";
import "../lockersManager/interfaces/ILockersManager.sol";
import "../routers/CcExchangeRouterLib.sol";

library CcExchangeRouterLibExtension {
    using Address for address;

    // Constants
    uint256 constant MAX_BRIDGE_FEE = 10 ** 18;

    /*
        Events need to be re-defined here because we use them 
        in the CcExchangeRouterLogic contract and libraries can not use interface events.
    */
    event NewWrapAndSwapUniversal(
        address lockerTargetAddress,
        bytes32 indexed user,
        bytes32[3] inputIntermediaryOutputToken,
        uint[3] inputIntermediaryOutputAmount,
        uint indexed speed,
        address indexed teleporter,
        bytes32 bitcoinTxId,
        uint256[3] protocolIds, // [destinationChainId, appId, thirdPartyId]
        uint[5] fees,
        bytes32[] pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain
    );

    event FailedWrapAndSwapUniversal(
        address lockerTargetAddress,
        bytes32 indexed recipientAddress,
        bytes32[3] inputIntermediaryOutputToken,
        uint[3] inputIntermediaryOutputAmount,
        uint indexed speed,
        address indexed teleporter,
        bytes32 bitcoinTxId,
        uint256[3] protocolIds, // [destinationChainId, appId, thirdPartyId]
        uint[5] fees,
        bytes32[] pathFromIntermediaryToDestTokenOnDestChain,
        uint256[] amountsFromIntermediaryToDestTokenOnDestChain
    );

    /// @notice Swap TeleBTC for the output token
    function swapUniversal(
        ICcExchangeRouter.swapArgumentsUniversal memory swapArguments,
        ICcExchangeRouter.SwapUniversalData memory _swapUniversalData
    ) external returns (bool result, uint256[] memory amounts) {
        // Give allowance to exchange connector for swapping
        ITeleBTC(_swapUniversalData.teleBTC).approve(
            swapArguments._exchangeConnector,
            swapArguments._extendedCcExchangeRequest.remainedInputAmount
        );

        /*
            We don't need to calculate the minimum output amount because 
            the minIntermediaryTokenAmount is already set in the request.
            
            uint256 outputAmount = swapArguments._ccExchangeRequestV2.outputAmount;
            uint256 bridgePercentageFee = swapArguments._extendedCcExchangeRequest.bridgePercentageFee;
            uint256 minAmountOut = (outputAmount * MAX_BRIDGE_FEE) / (MAX_BRIDGE_FEE - bridgePercentageFee);
        */
        
        (result, amounts) = IDexConnector(swapArguments._exchangeConnector)
            .swap(
                swapArguments._extendedCcExchangeRequest.remainedInputAmount,
                swapArguments._ccExchangeRequestV2.minIntermediaryTokenAmount,
                swapArguments._path,
                address(this),
                block.timestamp,
                true
            );

        if (result) {
            _handleSuccessfulSwap(swapArguments, amounts, _swapUniversalData);
        } else {
            _handleFailedSwap(swapArguments, _swapUniversalData);
        }

        return (result, amounts);
    }

    /// @notice Handle successful swap logic
    function _handleSuccessfulSwap(
        ICcExchangeRouter.swapArgumentsUniversal memory swapArguments,
        uint256[] memory amounts,
        ICcExchangeRouter.SwapUniversalData memory _swapUniversalData
    ) private {
        // Send tokens to user if on current chain
        if (swapArguments.destRealChainId == _swapUniversalData.currentChainId) {
            address outputToken = swapArguments._path[swapArguments._path.length - 1];
            uint256 outputAmount = amounts[amounts.length - 1];
            address recipient = address(uint160(uint256(swapArguments._ccExchangeRequestV2.recipientAddress)));
            
            if (outputToken != _swapUniversalData.wrappedNativeToken) {
                ITeleBTC(outputToken).transfer(recipient, outputAmount);
            } else {
                WETH(_swapUniversalData.wrappedNativeToken).withdraw(outputAmount);
                Address.sendValue(payable(recipient), outputAmount);
            }
        }

        // Emit success event
        uint256 bridgeFee = (
            amounts[amounts.length - 1] *
            swapArguments._extendedCcExchangeRequest.bridgePercentageFee
        ) / MAX_BRIDGE_FEE;
        uint256[5] memory fees = [
            swapArguments._ccExchangeRequestV2.networkFee,
            swapArguments._extendedCcExchangeRequest.lockerFee,
            swapArguments._extendedCcExchangeRequest.protocolFee,
            swapArguments._extendedCcExchangeRequest.thirdPartyFee,
            bridgeFee
        ];

        emit NewWrapAndSwapUniversal(
            ILockersManager(_swapUniversalData.lockers).getLockerTargetAddress(swapArguments._lockerLockingScript),
            swapArguments._ccExchangeRequestV2.recipientAddress,
            [
                bytes32(uint256(uint160(swapArguments._path[0]))), // Input token
                bytes32(uint256(uint160(swapArguments._path[swapArguments._path.length - 1]))), // Intermediary token
                swapArguments._ccExchangeRequestV2.outputToken // Output token
            ],
            [
                amounts[0], // Input amount
                amounts[amounts.length - 1], // Intermediary amount
                amounts[amounts.length - 1] - bridgeFee // Output amount
            ],
            swapArguments._ccExchangeRequestV2.speed,
            _swapUniversalData.teleporter,
            swapArguments._txId,
            [
                swapArguments.destRealChainId,
                swapArguments._ccExchangeRequestV2.appId,
                swapArguments._extendedCcExchangeRequest.thirdParty
            ],
            fees,
            swapArguments._pathFromIntermediaryToDestTokenOnDestChain,
            swapArguments._amountsFromIntermediaryToDestTokenOnDestChain
        );
    }

    /// @notice Handle failed swap logic
    function _handleFailedSwap(
        ICcExchangeRouter.swapArgumentsUniversal memory swapArguments,
        ICcExchangeRouter.SwapUniversalData memory _swapUniversalData
    ) private {
        uint256[5] memory fees = [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)];
        
        emit FailedWrapAndSwapUniversal(
            ILockersManager(_swapUniversalData.lockers).getLockerTargetAddress(swapArguments._lockerLockingScript),
            swapArguments._ccExchangeRequestV2.recipientAddress,
            [
                bytes32(uint256(uint160(swapArguments._path[0]))), // Input token
                bytes32(uint256(uint160(swapArguments._path[swapArguments._path.length - 1]))), // Intermediary token
                swapArguments._ccExchangeRequestV2.outputToken // Output token
            ],
            [
                swapArguments._extendedCcExchangeRequest.remainedInputAmount, // Input amount
                0, // Intermediary amount
                0 // Output amount
            ],
            swapArguments._ccExchangeRequestV2.speed,
            _swapUniversalData.teleporter,
            swapArguments._txId,
            [
                swapArguments.destRealChainId,
                swapArguments._ccExchangeRequestV2.appId,
                swapArguments._extendedCcExchangeRequest.thirdParty
            ],
            fees,
            swapArguments._pathFromIntermediaryToDestTokenOnDestChain,
            swapArguments._amountsFromIntermediaryToDestTokenOnDestChain
        );
    }
}
