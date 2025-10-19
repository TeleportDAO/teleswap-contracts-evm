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

    // Events
    event NewWrapAndSwapToSolana(
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

    event FailedWrapAndSwapToSolana(
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


    /// @notice Handle failed swap to solana logic
    function handleFailedSwap(
        mapping(bytes32 => ICcExchangeRouter.ccExchangeToSolanaRequest) storage _ccExchangeToSolanaRequests,
        mapping(bytes32 => ICcExchangeRouter.extendedCcExchangeRequest) storage _extendedCcExchangeRequests,
        bytes32 _txId
    ) external {
        // If swap failed, keep TeleBTC in the contract for retry
        uint256 fees = _extendedCcExchangeRequests[_txId].thirdPartyFee +
                   _extendedCcExchangeRequests[_txId].protocolFee +
                   _ccExchangeToSolanaRequests[_txId].fee +
                   _extendedCcExchangeRequests[_txId].lockerFee;

        // We don't take fees (except the locker fee) in the case of failed wrapAndSwap
        _extendedCcExchangeRequests[_txId].remainedInputAmount += fees;
    }

    /// @notice Swap TeleBTC for the output token
    function swapToSolana(
        ICcExchangeRouter.swapToSolanaArguments memory swapArguments,
        mapping(bytes8 => mapping(uint => bytes32)) storage _bridgeTokenTickerMapping,
        ICcExchangeRouter.SwapToSolanaDate memory _swapToSolanaDate
    ) external returns (bool result, uint256[] memory amounts) {
        // Give allowance to exchange connector for swapping
        ITeleBTC(_swapToSolanaDate.teleBTC).approve(
            swapArguments._exchangeConnector,
            swapArguments._extendedCcExchangeRequest.remainedInputAmount
        );

        // Check if the provided path is valid
        require(
            swapArguments._path[0] == bytes32(uint256(uint160(_swapToSolanaDate.teleBTC))) &&
                swapArguments._path[swapArguments._path.length - 1] == _bridgeTokenTickerMapping[swapArguments._ccExchangeToSolanaRequest.path[
                swapArguments._ccExchangeToSolanaRequest.path.length - 1
            ]][_swapToSolanaDate.currentChainId],
            "CcExchangeRouter: invalid path"
        );

        // Swap teleBTC for the output token
        // Swapped token is sent to the contract
        address[] memory _path = new address[](2);
        _path[0] = address(uint160(uint256(swapArguments._path[0])));
        _path[1] = address(uint160(uint256(swapArguments._path[swapArguments._path.length - 1])));
        
        uint256 outputAmount = swapArguments._ccExchangeToSolanaRequest.outputAmount;
        uint256 bridgePercentageFee = swapArguments._extendedCcExchangeRequest.bridgePercentageFee;
        uint256 minAmountOut = (outputAmount * MAX_BRIDGE_FEE) / (MAX_BRIDGE_FEE - bridgePercentageFee);
        
        (result, amounts) = IDexConnector(swapArguments._exchangeConnector)
            .swap(
                swapArguments._extendedCcExchangeRequest.remainedInputAmount,
                minAmountOut,
                _path,
                address(this),
                block.timestamp,
                true
            );

        if (result) {
            _handleSuccessfulSwap(swapArguments, amounts, _swapToSolanaDate);
        } else {
            _handleFailedSwap(swapArguments, _swapToSolanaDate);
        }

        return (result, amounts);
    }

    /// @notice Handle successful swap logic
    function _handleSuccessfulSwap(
        ICcExchangeRouter.swapToSolanaArguments memory swapArguments,
        uint256[] memory amounts,
        ICcExchangeRouter.SwapToSolanaDate memory _swapToSolanaDate
    ) private {
        // Send tokens to user if on current chain
        if (swapArguments.destinationChainId == block.chainid) {
            address outputToken = address(uint160(uint256(swapArguments._path[swapArguments._path.length - 1])));
            uint256 outputAmount = amounts[amounts.length - 1];
            address recipient = address(uint160(uint256(swapArguments._ccExchangeToSolanaRequest.recipientAddress)));
            
            if (outputToken != _swapToSolanaDate.wrappedNativeToken) {
                ITeleBTC(outputToken).transfer(recipient, outputAmount);
            } else {
                WETH(_swapToSolanaDate.wrappedNativeToken).withdraw(outputAmount);
                Address.sendValue(payable(recipient), outputAmount);
            }
        }

        // Emit success event
        uint256 bridgeFee = (amounts[amounts.length - 1] * swapArguments._extendedCcExchangeRequest.bridgePercentageFee) / MAX_BRIDGE_FEE;
        uint256[5] memory fees = [
            swapArguments._ccExchangeToSolanaRequest.fee,
            swapArguments._extendedCcExchangeRequest.lockerFee,
            swapArguments._extendedCcExchangeRequest.protocolFee,
            swapArguments._extendedCcExchangeRequest.thirdPartyFee,
            bridgeFee
        ];

        emit NewWrapAndSwapToSolana(
            ILockersManager(_swapToSolanaDate.lockers).getLockerTargetAddress(swapArguments._lockerLockingScript),
            swapArguments._ccExchangeToSolanaRequest.recipientAddress,
            [bytes32(uint256(uint160(_swapToSolanaDate.teleBTC))), swapArguments._path[swapArguments._path.length - 1]],
            [amounts[0], amounts[amounts.length - 1] - bridgeFee],
            swapArguments._ccExchangeToSolanaRequest.speed,
            _swapToSolanaDate.teleporter,
            swapArguments._txId,
            swapArguments._ccExchangeToSolanaRequest.appId,
            swapArguments._extendedCcExchangeRequest.thirdParty,
            fees,
            swapArguments.destinationChainId
        );
    }

    /// @notice Handle failed swap logic
    function _handleFailedSwap(
        ICcExchangeRouter.swapToSolanaArguments memory swapArguments,
        ICcExchangeRouter.SwapToSolanaDate memory _swapToSolanaDate
    ) private {
        uint256[5] memory fees = [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)];
        
        emit FailedWrapAndSwapToSolana(
            ILockersManager(_swapToSolanaDate.lockers).getLockerTargetAddress(swapArguments._lockerLockingScript),
            swapArguments._ccExchangeToSolanaRequest.recipientAddress,
            [bytes32(uint256(uint160(_swapToSolanaDate.teleBTC))), swapArguments._path[swapArguments._path.length - 1]],
            [swapArguments._extendedCcExchangeRequest.remainedInputAmount, 0],
            swapArguments._ccExchangeToSolanaRequest.speed,
            _swapToSolanaDate.teleporter,
            swapArguments._txId,
            swapArguments._ccExchangeToSolanaRequest.appId,
            swapArguments._extendedCcExchangeRequest.thirdParty,
            fees,
            swapArguments.destinationChainId
        );
    }
}
