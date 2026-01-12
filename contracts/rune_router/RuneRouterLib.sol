// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./RuneRouterStorage.sol";
import "../erc20/WRuneProxy.sol";
import "../erc20/WRuneLogic.sol";
import "@teleportdao/btc-evm-bridge/contracts/relay/interfaces/IBitcoinRelay.sol";
import "@teleportdao/btc-evm-bridge/contracts/libraries/BitcoinHelper.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/// @notice Helper library for Brc20Router
library RuneRouterLib {
    function addRuneHelper() external returns (address) {
        // Deploy upgradable contract
        WRuneLogic _wRuneLogic = new WRuneLogic();
        return address(_wRuneLogic);
    }

    /// @notice Check tx inclusion proof
    function checkTx(
        uint _startingBlockNumber,
        address _relay,
        bytes4 _version,
        bytes memory _vin,
        bytes calldata _vout,
        bytes4 _locktime,
        uint256 _blockNumber,
        bytes calldata _intermediateNodes,
        uint _index
    ) external returns (bytes32 _txId) {
        // Basic checks
        require(
            _blockNumber >= _startingBlockNumber,
            "RuneRouterLib: old proof"
        );
        require(_locktime == bytes4(0), "RuneRouterLib: non-zero locktime");

        // Find txId on Bitcoin
        _txId = BitcoinHelper.calculateTxId(_version, _vin, _vout, _locktime);

        // Check tx inclusion on Bitcoin
        require(
            _isConfirmed(
                _relay,
                _txId,
                _blockNumber,
                _intermediateNodes,
                _index
            ),
            "RuneRouterLib: not finalized"
        );
    }

    /// @notice Extract request info and store it
    function wrapHelper(
        bytes memory _vout,
        bytes32 _txId,
        mapping(bytes32 => RuneRouterStorage.runeWrapRequest)
            storage _runeWrapRequests,
        mapping(uint256 => address) storage _supportedRunes,
        mapping(uint256 => RuneRouterStorage.thirdParty) storage _thirdParties,
        uint256 _protocolPercentageFee,
        uint256 _lockerPercentageFee
    )
        external
        returns (
            uint256 _remainingAmount,
            RuneRouterStorage.fees memory _fee,
            address _thirdPartyAddress,
            address _wrappedRune
        )
    {
        require(
            !_runeWrapRequests[_txId].isUsed,
            "RuneRouterLib: already used"
        );

        // Extract OP_RETURN output
        RuneRouterStorage.runeWrapRequest memory request;

        (
            ,
            // Value
            bytes memory requestData // OP_RETURN data
        ) = BitcoinHelper.parseValueAndDataHavingLockingScriptSmallPayload(
                _vout,
                "0x" // since we only interested in OP_RETURN data, we don't need to pass locking script
            );

        // If small payload returned empty, try big payload
        if (requestData.length == 0) {
            (
                ,
                // Value
                requestData // OP_RETURN data
            ) = BitcoinHelper.parseValueAndDataHavingLockingScriptBigPayload(
                _vout,
                "0x"
            );
        }

        // 41 for wrap, 78 for new wrapAndSwap
        require(
            requestData.length == 41 || requestData.length == 78,
            "RuneRouterLib: invalid len"
        );

        /* 
            OP_RETURN data is as follow:
            1) chainId, 2 byte: max 65535 chains
            2) appId, 1 byte: max 256 apps
            3) tokenId, 4 byte: max 4294967296 tokens
            4) inputAmount, 13 byte: max 10^30 (= 1T * 10^18)
            5) recipientAddress, 20 byte: EVM account
            6) thirdPartyId, 1 byte: max 256 third party
            TOTAL = 41 BYTE (WRAP)
            7) outputToken, 20 byte: token address
            8) outputAmount, 13 byte: max 10^30 (= 1T * 10^18)
            TOTAL = 74 BYTE (OLD WRAP & SWAP)
            9) speed, 1 byte: 0 for normal, 1 for fast
            10) bridgeFee, 3 byte: will be multiply by 10^11, 10^18 means 100%, so the minimum 
            amount of fee percentage is 10^-5%
            TOTAL = 78 BYTE (NEW WRAP & SWAP)
        */
        request.isUsed = true;
        request.chainId = _parseChainId(requestData);
        request.appId = _parseAppId(requestData);
        request.tokenId = _parseTokenId(requestData);
        request.inputAmount = _parseInputAmount(requestData);
        request.recipientAddress = _parseRecipientAddress(requestData);
        request.thirdPartyId = _parseThirdPartyId(requestData);

        // Find third party address
        _thirdPartyAddress = _thirdParties[request.thirdPartyId]
            .thirdPartyAddress;

        // Check app id for wrap and wrapAndSwap
        if (requestData.length == 41) {
            // wrap request
            require(request.appId == 0, "RuneRouterLib: wrong app id");
        } else {
            // wrapAndSwap request
            require(request.appId != 0, "RuneRouterLib: wrong app id");
            request.outputToken = _parseOutputToken(requestData);
            request.outputAmount = _parseOutputAmount(requestData);
            request.speed = _parseSpeed(requestData);
            request.bridgeFee = uint(_parseBridgeFee(requestData)) * (10 ** 11);
        }

        // Input amount must be greater than 0
        require(request.inputAmount > 0, "RuneRouterLib: zero input");

        // Token id must be supported
        _wrappedRune = _supportedRunes[request.tokenId];
        require(_wrappedRune != address(0), "RuneRouterLib: not supported");
        request.inputToken = _wrappedRune;

        // Calculate fees
        uint inputAmount = request.inputAmount;
        _fee.protocolFee = (inputAmount * _protocolPercentageFee) / 10000;
        _fee.lockerFee = (inputAmount * _lockerPercentageFee) / 10000;
        _fee.thirdPartyFee =
            (inputAmount * _thirdParties[request.thirdPartyId].thirdPartyFee) /
            10000;
        _remainingAmount =
            inputAmount -
            _fee.protocolFee -
            _fee.lockerFee -
            _fee.thirdPartyFee;

        // Save the total fee
        request.fee = _fee.protocolFee + _fee.lockerFee + _fee.thirdPartyFee;

        // Save the request
        _runeWrapRequests[_txId] = request;
    }

    /// @notice Save unwrap request after checking user script validity and
    ///         return fees and bunrt amount
    function unwrapHelper(
        address _user,
        uint _protocolPercentageFee,
        uint _lockerPercentageFee,
        RuneRouterStorage.runeUnwrapRequest[] storage _runeUnwrapRequests,
        mapping(uint => RuneRouterStorage.thirdParty) storage _thirdParties,
        uint _thirdPartyId,
        uint _amount,
        bytes memory _userScript,
        ScriptTypes _scriptType
    )
        external
        returns (
            RuneRouterStorage.fees memory _fee,
            address _thirdPartyAddress,
            uint _remainingAmount
        )
    {
        _thirdPartyAddress = _thirdParties[_thirdPartyId].thirdPartyAddress;

        // Find locker and protocol fee
        _fee.protocolFee = (_amount * _protocolPercentageFee) / 10000;
        _fee.lockerFee = (_amount * _lockerPercentageFee) / 10000;
        _fee.thirdPartyFee =
            (_amount * _thirdParties[_thirdPartyId].thirdPartyFee) /
            10000;

        _remainingAmount =
            _amount -
            _fee.protocolFee -
            _fee.lockerFee -
            _fee.thirdPartyFee;
        require(_remainingAmount > 0, "RuneRouterLib: low amount");

        // Check validity of user script
        if (
            _scriptType == ScriptTypes.P2PK ||
            _scriptType == ScriptTypes.P2WSH ||
            _scriptType == ScriptTypes.P2TR
        ) {
            require(_userScript.length == 32, "RuneRouterLib: invalid script");
        } else {
            require(_userScript.length == 20, "RuneRouterLib: invalid script");
        }

        // Save unwrap request
        RuneRouterStorage.runeUnwrapRequest memory request;
        request.isProcessed = false;
        request.amount = _amount;
        request.burntAmount = _remainingAmount;
        request.sender = _user;
        request.userScript = _userScript;
        request.scriptType = _scriptType;
        _runeUnwrapRequests.push(request);
    }

    /// @notice Return chain id of the request
    /// @param _requestData Data written in Bitcoin tx
    function _parseChainId(
        bytes memory _requestData
    ) internal pure returns (uint16 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 0, 1);
        assembly {
            _parsedValue := mload(add(slicedBytes, 2))
        }
    }

    /// @notice Return app id of the request
    /// @dev Determines the app that request belongs to (e.g. wrap app id is 0)
    function _parseAppId(
        bytes memory _requestData
    ) internal pure returns (uint8 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 2, 2);
        assembly {
            _parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Return token id of the request
    function _parseTokenId(
        bytes memory _requestData
    ) internal pure returns (uint32 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 3, 6);
        assembly {
            _parsedValue := mload(add(slicedBytes, 4))
        }
    }

    /// @notice Return input amount
    function _parseInputAmount(
        bytes memory _requestData
    ) internal pure returns (uint104 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 7, 19);
        assembly {
            _parsedValue := mload(add(slicedBytes, 13))
        }
    }

    /// @notice Return recipient address
    function _parseRecipientAddress(
        bytes memory _requestData
    ) internal pure returns (address _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 20, 39);
        assembly {
            _parsedValue := mload(add(slicedBytes, 20))
        }
    }

    /// @notice Return recipient address
    function _parseThirdPartyId(
        bytes memory _requestData
    ) internal pure returns (uint8 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 40, 40);
        assembly {
            _parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Return address of exchange token
    function _parseOutputToken(
        bytes memory _requestData
    ) internal pure returns (address _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 41, 60);
        assembly {
            _parsedValue := mload(add(slicedBytes, 20))
        }
    }

    /// @notice Return min expected output amount
    function _parseOutputAmount(
        bytes memory _requestData
    ) internal pure returns (uint104 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 61, 73);
        assembly {
            _parsedValue := mload(add(slicedBytes, 13))
        }
    }

    /// @notice Return speed
    function _parseSpeed(
        bytes memory _requestData
    ) internal pure returns (bool _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 74, 74);
        assembly {
            _parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Return bridge fee
    function _parseBridgeFee(
        bytes memory _requestData
    ) internal pure returns (uint24 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 75, 77);
        assembly {
            _parsedValue := mload(add(slicedBytes, 3))
        }
    }

    /// @notice Returns the sliced bytes
    /// @param _data Slicing data
    /// @param _start index of slicing
    /// @param _end index of slicing
    function _sliceBytes(
        bytes memory _data,
        uint _start,
        uint _end
    ) internal pure returns (bytes memory _result) {
        bytes1 temp;
        for (uint i = _start; i < _end + 1; i++) {
            temp = _data[i];
            _result = abi.encodePacked(_result, temp);
        }
    }

    /// @notice Check if tx has been finalized on Bitcoin
    /// @dev Locker needs to pay for the relay fee
    function _isConfirmed(
        address _relay,
        bytes32 _txId,
        uint256 _blockNumber,
        bytes memory _intermediateNodes,
        uint _index
    ) private returns (bool) {
        // Get fee amount
        uint feeAmount = IBitcoinRelay(_relay).getBlockHeaderFee(
            _blockNumber,
            0
        );
        require(msg.value >= feeAmount, "RuneRouterLib: low fee");

        // Query relay (send all msg.value to it)
        bytes memory data = Address.functionCallWithValue(
            _relay,
            abi.encodeWithSignature(
                "checkTxProof(bytes32,uint256,bytes,uint256)",
                _txId,
                _blockNumber,
                _intermediateNodes,
                _index
            ),
            feeAmount
        );

        // Send extra ETH back to user
        Address.sendValue(payable(msg.sender), msg.value - feeAmount);

        return abi.decode(data, (bool));
    }
}
