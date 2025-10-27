// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@teleportdao/btc-evm-bridge/contracts/relay/interfaces/IBitcoinRelay.sol";
import "@teleportdao/btc-evm-bridge/contracts/libraries/BitcoinHelper.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../routers/interfaces/ICcExchangeRouter.sol";
import "./RequestParser.sol";

library CcExchangeRouterLib {
    /// @notice Parses and stores exchange request if it's valid
    function ccExchangeHelper(
        ICcExchangeRouter.TxAndProof memory _txAndProof,
        mapping(bytes32 => ICcExchangeRouter.ccExchangeRequest)
            storage ccExchangeRequests,
        mapping(bytes32 => ICcExchangeRouter.extendedCcExchangeRequest)
            storage extendedCcExchangeRequests,
        address _teleBTC,
        bytes memory _lockerLockingScript,
        address _relay
    ) external returns (bytes32) {
        // Finds tx id
        bytes32 txId = BitcoinHelper.calculateTxId(
            _txAndProof.version,
            _txAndProof.vin,
            _txAndProof.vout,
            _txAndProof.locktime
        );

        // Checks that the request has not been processed before
        require(
            !ccExchangeRequests[txId].isUsed,
            "ExchangeRouterLib: already used"
        );

        // Extracts value and OP_RETURN data from the request
        ICcExchangeRouter.ccExchangeRequest memory request;
        bytes memory arbitraryData;

        (request.inputAmount, arbitraryData) = BitcoinHelper
            .parseValueAndDataHavingLockingScriptSmallPayload(
                _txAndProof.vout,
                _lockerLockingScript
            );

        /*  
            Exchange requests structure:
            1) chainId, 2 byte: max 65535 chains
            2) appId, 1 byte: max 256 apps
            3) recipientAddress, 20 byte: EVM account
            4) networkFee, 3 byte
            5) SPEED, 1 byte: {0,1}
            6) thirdParty, 1 byte: max 256 third parties, default is 0 for no third party
            7) exchangeToken, 20 byte: token address
            8) outputAmount, 14 byte: min expected output amount. Assuming that the token supply
               is less than 10^15 and token decimal is 18 (> (10^18) * (10^18))
            9) bridgeFee, 3 byte: will be multiply by 10^11, 10^18 means 100%, so the minimum 
            amount of fee percentage is 10^-5%
            TOTAL = 65 BYTE
        */
        require(arbitraryData.length == 65, "ExchangeRouterLib: invalid len");
        require(request.inputAmount > 0, "ExchangeRouterLib: zero input");

        extendedCcExchangeRequests[txId].chainId = RequestParser.parseChainId(
            arbitraryData
        );
        extendedCcExchangeRequests[txId].bridgePercentageFee =
            uint(RequestParser.parseArossFeePercentage(arbitraryData)) *
            (10 ** 11);
        extendedCcExchangeRequests[txId].thirdParty = RequestParser
            .parseThirdPartyId(arbitraryData);

        request.appId = RequestParser.parseAppId(arbitraryData);
        address exchangeToken = RequestParser.parseExchangeToken(arbitraryData);
        request.outputAmount = RequestParser.parseExchangeOutputAmount(
            arbitraryData
        );
        request.isFixedToken = true; // Note: we assume input amount is fixed
        request.recipientAddress = RequestParser.parseRecipientAddress(
            arbitraryData
        );

        // Note: default exchange path is: [teleBTC, exchangeToken]
        request.path = new address[](2);
        request.path[0] = _teleBTC;
        request.path[1] = exchangeToken;

        // Finds Teleporter fee
        uint networkFee = RequestParser.parseNetworkFee(arbitraryData);

        require(
            networkFee <= request.inputAmount,
            "ExchangeRouterLib: wrong fee"
        );
        request.fee = networkFee;

        // Note: speed now determines using fillers to speed up filling request (speed = 1) or not
        request.speed = RequestParser.parseSpeed(arbitraryData);

        request.isUsed = true;

        // Saves request
        ccExchangeRequests[txId] = request;

        require(
            _isConfirmed(_txAndProof, _relay, txId),
            "ExchangeRouter: not finalized"
        );

        return txId;
    }

    /// @notice Verifies the signature of _msgHash
    /// @return _signer Address of message signer (if signature is valid)
    function _verifySig(
        bytes memory message,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) public pure returns (address) {
        // Compute the message hash
        bytes32 messageHash = keccak256(message);

        // Prefix the message hash as per the Ethereum signing standard
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );

        // Verify the message using ecrecover
        address signer = ecrecover(ethSignedMessageHash, v, r, s);
        require(signer != address(0), "PolygonConnectorLogic: Invalid sig");

        return signer;
    }

    /// @notice Checks inclusion of the transaction in the specified block
    /// @dev Calls the relay contract to check Merkle inclusion proof
    /// @param _relay Address of Relay contract
    /// @param _txId of the transaction
    /// @return True if the transaction was included in the block
    function _isConfirmed(
        ICcExchangeRouter.TxAndProof memory _txAndProof,
        address _relay,
        bytes32 _txId
    ) internal returns (bool) {
        // Finds fee amount
        uint feeAmount = _getFinalizedBlockHeaderFee(
            _relay,
            _txAndProof.blockNumber
        );
        require(msg.value >= feeAmount, "ExchangeRouterLib: low fee");

        // Calls relay contract
        bytes memory data = Address.functionCallWithValue(
            _relay,
            abi.encodeWithSignature(
                "checkTxProof(bytes32,uint256,bytes,uint256)",
                _txId,
                _txAndProof.blockNumber,
                _txAndProof.intermediateNodes,
                _txAndProof.index
            ),
            feeAmount
        );

        // Sends extra ETH back to msg.sender
        Address.sendValue(payable(msg.sender), msg.value - feeAmount);

        return abi.decode(data, (bool));
    }

    function _getFinalizedBlockHeaderFee(
        address _relay,
        uint _blockNumber
    ) private view returns (uint) {
        return IBitcoinRelay(_relay).getBlockHeaderFee(_blockNumber, 0);
    }

    /// @notice Parses and stores exchange request if it's valid for Solana requests
    function ccExchangeHelperV2(
        ICcExchangeRouter.TxAndProof memory _txAndProof,
        mapping(bytes32 => ICcExchangeRouter.ccExchangeRequestV2)
            storage ccExchangeRequests,
        mapping(bytes32 => ICcExchangeRouter.extendedCcExchangeRequest)
            storage extendedCcExchangeRequests,
        address _teleBTC,
        bytes memory _lockerLockingScript,
        address _relay
    ) external returns (bytes32) {
        // Finds tx id
        bytes32 txId = BitcoinHelper.calculateTxId(
            _txAndProof.version,
            _txAndProof.vin,
            _txAndProof.vout,
            _txAndProof.locktime
        );

        // Checks that the request has not been processed before
        require(
            !ccExchangeRequests[txId].isUsed,
            "ExchangeRouterLib: already used"
        );

        // Extracts value and OP_RETURN data from the request
        ICcExchangeRouter.ccExchangeRequestV2 memory request;
        bytes memory arbitraryData;

        (request.inputAmount, arbitraryData) = BitcoinHelper
            .parseValueAndDataHavingLockingScriptBigPayload(
                _txAndProof.vout,
                _lockerLockingScript
            );

        /*  
            Exchange requests structure:
            1) destChainId, 2 byte: max 65535 chains
            2) appId, 1 byte: max 256 apps
            3) recipientDestAddress, 32 byte: Solana address, or zero padded EVM address
            4) networkFee, 3 byte
            5) speed, 1 byte: {0,1}
            6) thirdPartyID, 1 byte: max 256 third parties, default is 0 for no third party
            7) destTokenID, 8 byte: token ID
            8) minDestTokenAmount, 13 byte: minimum expected destination token amount (output amount)
            9) minIntermediaryTokenAmount, 13 byte: minimum intermediary token amount (slippage guard on Polygon)
            10) bridgePercentageFee, 3 byte: will be multiply by 10^11, 10^18 means 100%, so the minimum 
            amount of fee percentage is 10^-5%
            TOTAL = 77 BYTE
        */
        require(arbitraryData.length == 77, "ExchangeRouterLib: invalid len");
        require(request.inputAmount > 0, "ExchangeRouterLib: zero input");

        extendedCcExchangeRequests[txId].chainId = RequestParser.parseChainId(
            arbitraryData
        );
        extendedCcExchangeRequests[txId].bridgePercentageFee =
            uint(RequestParser.parseBridgeFeePercentage(arbitraryData)) *
            (10 ** 11);
        extendedCcExchangeRequests[txId].thirdParty = RequestParser
            .parseThirdPartyID(arbitraryData);

        request.appId = RequestParser.parseAppId(arbitraryData);
        bytes8 destTokenID = bytes8(RequestParser.parseDestTokenID(arbitraryData));
        request.outputAmount = RequestParser.parseMinDestTokenAmount(
            arbitraryData
        );

        request.minIntermediaryTokenAmount = RequestParser.parseMinIntermediaryTokenAmount(
            arbitraryData
        );
        request.isFixedToken = true; // Note: we assume input amount is fixed
        request.recipientAddress = RequestParser.parseRecipientDestAddress(
            arbitraryData
        );

        // Note: default exchange path is: [teleBTC, exchangeToken]
        request.tokenIDs = new bytes8[](2);
        request.tokenIDs[0] = bytes8(uint64(uint160(_teleBTC)));
        request.tokenIDs[1] = destTokenID;

        // Finds Teleporter fee
        uint networkFee = RequestParser.parseNetworkFeeNew(arbitraryData);

        require(
            networkFee <= request.inputAmount,
            "ExchangeRouterLib: wrong fee"
        );
        request.fee = networkFee;

        // Note: speed now determines using fillers to speed up filling request (speed = 1) or not
        request.speed = RequestParser.parseSpeedNew(arbitraryData);

        request.isUsed = true;

        // Saves request
        ccExchangeRequests[txId] = request;

        require(
            _isConfirmed(_txAndProof, _relay, txId),
            "ExchangeRouter: not finalized"
        );

        return txId;
    }
}
