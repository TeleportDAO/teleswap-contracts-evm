// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./Brc20RouterStorage.sol";
import "../erc20/WBRC20Proxy.sol";
import "../erc20/WBRC20Logic.sol";
import "@teleportdao/btc-evm-bridge/contracts/relay/interfaces/IBitcoinRelay.sol";
import "@teleportdao/btc-evm-bridge/contracts/libraries/BitcoinHelper.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/// @notice Helper library for Brc20Router
library Brc20RouterLib {

    function addBrc20Helper() external returns (address) {
        // Deploy upgradable contract
        WBRC20Logic _wbrc20Logic = new WBRC20Logic();
        return address(_wbrc20Logic);
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
        require(_blockNumber >= _startingBlockNumber, "Brc20RouterLib: old proof");
        require(_locktime == bytes4(0), "Brc20RouterLib: non-zero locktime");

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
            "Brc20RouterLib: not finalized"
        );
    }

    /// @notice Extract request info and store it
    function wrapHelper(
        uint _chainId,
        bytes memory _vout,
        bytes32 _txId,
        mapping(bytes32 => Brc20RouterStorage.brc20WrapRequest) storage _brc20WrapRequests,
        mapping(uint => address) storage _supportedBrc20s,
        mapping(uint => Brc20RouterStorage.thirdParty) storage _thirdParties,
        uint _protocolPercentageFee,
        uint _lockerPercentageFee
    ) external returns (
        uint _remainingAmount,
        Brc20RouterStorage.fees memory _fee,
        address _thirdPartyAddress,
        address _wrappedBrc20
    ) {
        require(
            !_brc20WrapRequests[_txId].isUsed,
            "Brc20RouterLib: already used"
        );

        // Extract OP_RETURN output
        Brc20RouterStorage.brc20WrapRequest memory request;       
        (
            , // Value
            bytes memory requestData
        ) = BitcoinHelper.parseValueAndDataHavingLockingScriptSmallPayload(
            _vout,
            "0x"
        );

        // 39 for wrap, 72 for wrap & exchange
        require(
            requestData.length == 39 || requestData.length == 72, 
            "Brc20RouterLib: invalid len"
        );

        /* 
            OP_RETURN data is as follow:
            1) chainId, 2 byte: max 65535 chains
            2) appId, 1 byte: max 256 apps
            3) tokenId, 2 byte: max 65535 tokens
            4) inputAmount, 13 byte: max 10^30 (= 1T * 10^18)
            5) recipientAddress, 20 byte: EVM account
            6) thirdPartyId, 1 byte: max 256 third party
            TOTAL = 39 BYTE (WRAP)
            7) outputToken, 20 byte: token address
            8) outputAmount, 13 byte: max 10^30 (= 1T * 10^18)
            TOTAL = 72 BYTE (WRAP & EXCHANGE)
        */
        request.isUsed = true;
        request.chainId = _parseChainId(requestData);
        request.appId = _parseAppId(requestData);
        request.tokenId = _parseTokenId(requestData);
        request.inputAmount = _parseInputAmount(requestData);
        request.recipientAddress = _parseRecipientAddress(requestData);
        request.thirdPartyId = _parseThirdPartyId(requestData);

        _thirdPartyAddress = _thirdParties[request.thirdPartyId].thirdPartyAddress;

        if (requestData.length == 39) {
            require(request.appId == 0, "Brc20RouterLib: wrong app id");
        } else {
            require(request.appId != 0, "Brc20RouterLib: wrong app id");
            request.outputToken = _parseOutputToken(requestData);
            request.outputAmount = _parseOutputAmount(requestData);
        }

        // Some checks:
        require(request.inputAmount > 0, "Brc20RouterLib: zero input");
        require(request.chainId == _chainId, "Brc20RouterLib: wrong chain");

        _wrappedBrc20 = _supportedBrc20s[request.tokenId];
        require(
            _wrappedBrc20 != address(0),
            "Brc20RouterLib: not supported"
        );
        request.inputToken = _wrappedBrc20;

        uint inputAmount = request.inputAmount;
        _fee.protocolFee = inputAmount * _protocolPercentageFee / 10000;
        _fee. lockerFee = inputAmount * _lockerPercentageFee / 10000;
        _fee.thirdPartyFee = inputAmount * _thirdParties[request.thirdPartyId].thirdPartyFee / 10000;
        _remainingAmount = inputAmount - _fee.protocolFee - _fee.lockerFee - _fee.thirdPartyFee;

        request.fee = _fee.protocolFee + _fee.lockerFee + _fee.thirdPartyFee;

        // Save the request
        _brc20WrapRequests[_txId] = request;
    }

    /// @notice Save unwrap request after checking user script validity and 
    ///         return fees and bunrt amount
    function unwrapHelper(
        address _user,
        uint _protocolPercentageFee,
        uint _lockerPercentageFee,
        Brc20RouterStorage.brc20UnwrapRequest[] storage _brc20UnwrapRequests,
        mapping(uint => Brc20RouterStorage.thirdParty) storage _thirdParties,
        uint _thirdPartyId,
        uint _amount,
        bytes memory _userScript, 
        ScriptTypes _scriptType
    ) external returns (
        Brc20RouterStorage.fees memory _fee,
        address _thirdPartyAddress,
        uint _remainingAmount
    ) {
        _thirdPartyAddress = _thirdParties[_thirdPartyId].thirdPartyAddress;

        // Find locker and protocol fee
        _fee.protocolFee = _amount * _protocolPercentageFee / 10000;
        _fee.lockerFee = _amount * _lockerPercentageFee / 10000;
        _fee.thirdPartyFee = _amount * _thirdParties[_thirdPartyId].thirdPartyFee / 10000;

        _remainingAmount = _amount - _fee.protocolFee - _fee.lockerFee - _fee.thirdPartyFee;
        require(
            _remainingAmount > 0, 
            "Brc20RouterLib: low amount"
        );

        // Check validity of user script
        if (_scriptType == ScriptTypes.P2PK || _scriptType == ScriptTypes.P2WSH || _scriptType == ScriptTypes.P2TR) {
            require(_userScript.length == 32, "Brc20RouterLib: invalid script");
        } else {
            require(_userScript.length == 20, "Brc20RouterLib: invalid script");
        }

        // Save unwrap request
        Brc20RouterStorage.brc20UnwrapRequest memory request;
        request.isProcessed = false;
        request.amount = _amount;
        request.burntAmount = _remainingAmount;
        request.sender = _user;
        request.userScript = _userScript;
        request.scriptType = _scriptType;
        _brc20UnwrapRequests.push(request);
    }

    /// @notice Return chain id of the request
    /// @param _requestData Data written in Bitcoin tx
    function _parseChainId(bytes memory _requestData) internal pure returns (uint16 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 0, 1);
        assembly {
            _parsedValue := mload(add(slicedBytes, 2))
        }
    }

    /// @notice Return app id of the request
    /// @dev Determines the app that request belongs to (e.g. wrap app id is 0)
    function _parseAppId(bytes memory _requestData) internal pure returns (uint8 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 2, 2);
        assembly {
            _parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Return token id of the request
    function _parseTokenId(bytes memory _requestData) internal pure returns (uint16 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 3, 4);
        assembly {
            _parsedValue := mload(add(slicedBytes, 2))
        }
    }

    /// @notice Return input amount
    function _parseInputAmount(bytes memory _requestData) internal pure returns (uint104 _parsedValue){
        bytes memory slicedBytes = _sliceBytes(_requestData, 5, 17);
        assembly {
            _parsedValue := mload(add(slicedBytes, 13))
        }
    }

    /// @notice Return recipient address
    function _parseRecipientAddress(bytes memory _requestData) internal pure returns (address _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 18, 37);
        assembly {
            _parsedValue := mload(add(slicedBytes, 20))
        }
    }

    /// @notice Return recipient address
    function _parseThirdPartyId(bytes memory _requestData) internal pure returns (uint8 _parsedValue) {
        bytes memory slicedBytes = _sliceBytes(_requestData, 38, 38);
        assembly {
            _parsedValue := mload(add(slicedBytes, 1))
        }
    }

    /// @notice Return address of exchange token
    function _parseOutputToken(bytes memory _requestData) internal pure returns (address _parsedValue){
        bytes memory slicedBytes = _sliceBytes(_requestData, 39, 58);
        assembly {
            _parsedValue := mload(add(slicedBytes, 20))
        }
    }

    /// @notice Return min expected output amount
    function _parseOutputAmount(bytes memory _requestData) internal pure returns (uint104 _parsedValue){
        bytes memory slicedBytes = _sliceBytes(_requestData, 59, 71);
        assembly {
            _parsedValue := mload(add(slicedBytes, 13))
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
        uint feeAmount = IBitcoinRelay(_relay).getBlockHeaderFee(_blockNumber, 0);
        require(msg.value >= feeAmount, "Brc20RouterLib: low fee");

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