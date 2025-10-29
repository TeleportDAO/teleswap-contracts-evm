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

library CcExchangeToSolanaRouterLib {
    using Address for address;

    // Constants
    uint256 constant MAX_BRIDGE_FEE = 10 ** 18;

    /*
        Events need to be re-defined here because we use them 
        in the CcExchangeRouterLogic contract and libraries can not use interface events.
    */
    event NewWrapAndSwapV2(
        address lockerTargetAddress,
        bytes32 indexed user,
        bytes32[2] inputAndOutputToken,
        uint[2] inputAndOutputAmount,
        uint indexed speed,
        address indexed teleporter,
        bytes32 bitcoinTxId,
        uint appId,
        uint thirdPartyId,
        uint[5] fees,
        uint destinationChainId
    );

    event FailedWrapAndSwapV2(
        address lockerTargetAddress,
        bytes32 indexed recipientAddress,
        bytes32[2] inputAndOutputToken,
        uint[2] inputAndOutputAmount,
        uint indexed speed,
        address indexed teleporter,
        bytes32 bitcoinTxId,
        uint appId,
        uint thirdPartyId,
        uint[5] fees,
        uint destinationChainId
    );

    /// @notice Swap TeleBTC for the output token
    function swapV2(
        ICcExchangeRouter.swapArgumentsV2 memory swapArguments,
        ICcExchangeRouter.SwapV2Data memory _swapV2Data
    ) external returns (bool result, uint256[] memory amounts) {
        // Give allowance to exchange connector for swapping
        ITeleBTC(_swapV2Data.teleBTC).approve(
            swapArguments._exchangeConnector,
            swapArguments._extendedCcExchangeRequest.remainedInputAmount
        );

        /*
            We don't need to calculate the minimum output amount because 
            the minIntermediaryTokenAmount is already set in the request.
        */
        // uint256 outputAmount = swapArguments._ccExchangeRequestV2.outputAmount;
        // uint256 bridgePercentageFee = swapArguments._extendedCcExchangeRequest.bridgePercentageFee;
        // uint256 minAmountOut = (outputAmount * MAX_BRIDGE_FEE) / (MAX_BRIDGE_FEE - bridgePercentageFee);
        
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
            _handleSuccessfulSwap(swapArguments, amounts, _swapV2Data);
        } else {
            _handleFailedSwap(swapArguments, _swapV2Data);
        }

        return (result, amounts);
    }

    /// @notice Handle successful swap logic
    function _handleSuccessfulSwap(
        ICcExchangeRouter.swapArgumentsV2 memory swapArguments,
        uint256[] memory amounts,
        ICcExchangeRouter.SwapV2Data memory _swapV2Data
    ) private {
        // Send tokens to user if on current chain
        if (swapArguments.destRealChainId == block.chainid) {
            address outputToken = swapArguments._path[swapArguments._path.length - 1];
            uint256 outputAmount = amounts[amounts.length - 1];
            address recipient = address(uint160(uint256(swapArguments._ccExchangeRequestV2.recipientAddress)));
            
            if (outputToken != _swapV2Data.wrappedNativeToken) {
                ITeleBTC(outputToken).transfer(recipient, outputAmount);
            } else {
                WETH(_swapV2Data.wrappedNativeToken).withdraw(outputAmount);
                Address.sendValue(payable(recipient), outputAmount);
            }
        }

        // Emit success event
        uint256 bridgeFee = (
            amounts[amounts.length - 1] *
            swapArguments._extendedCcExchangeRequest.bridgePercentageFee
        ) / MAX_BRIDGE_FEE;
        uint256[5] memory fees = [
            swapArguments._ccExchangeRequestV2.fee,
            swapArguments._extendedCcExchangeRequest.lockerFee,
            swapArguments._extendedCcExchangeRequest.protocolFee,
            swapArguments._extendedCcExchangeRequest.thirdPartyFee,
            bridgeFee
        ];

        emit NewWrapAndSwapV2(
            ILockersManager(_swapV2Data.lockers).getLockerTargetAddress(swapArguments._lockerLockingScript),
            swapArguments._ccExchangeRequestV2.recipientAddress,
            [bytes32(uint256(uint160(swapArguments._path[0]))), swapArguments._ccExchangeRequestV2.outputToken],
            [amounts[0], amounts[amounts.length - 1] - bridgeFee],
            swapArguments._ccExchangeRequestV2.speed,
            _swapV2Data.teleporter,
            swapArguments._txId,
            swapArguments._ccExchangeRequestV2.appId,
            swapArguments._extendedCcExchangeRequest.thirdParty,
            fees,
            swapArguments.destRealChainId
        );
    }

    /// @notice Handle failed swap logic
    function _handleFailedSwap(
        ICcExchangeRouter.swapArgumentsV2 memory swapArguments,
        ICcExchangeRouter.SwapV2Data memory _swapV2Data
    ) private {
        uint256[5] memory fees = [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)];
        
        emit FailedWrapAndSwapV2(
            ILockersManager(_swapV2Data.lockers).getLockerTargetAddress(swapArguments._lockerLockingScript),
            swapArguments._ccExchangeRequestV2.recipientAddress,
            [bytes32(uint256(uint160(swapArguments._path[0]))), swapArguments._ccExchangeRequestV2.outputToken],
            [swapArguments._extendedCcExchangeRequest.remainedInputAmount, 0],
            swapArguments._ccExchangeRequestV2.speed,
            _swapV2Data.teleporter,
            swapArguments._txId,
            swapArguments._ccExchangeRequestV2.appId,
            swapArguments._extendedCcExchangeRequest.thirdParty,
            fees,
            swapArguments.destRealChainId
        );
    }
}
