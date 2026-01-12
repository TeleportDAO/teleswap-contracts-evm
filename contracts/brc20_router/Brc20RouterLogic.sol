// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./Brc20RouterStorage.sol";
import "./Brc20RouterLib.sol";
import "../erc20/interfaces/IWBRC20.sol";
import "../erc20/interfaces/IWETH.sol";
import "../dex_connectors/interfaces/IDexConnector.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract Brc20RouterLogic is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    Brc20RouterStorage
{
    modifier nonZeroAddress(address _address) {
        require(_address != address(0), "Brc20RouterLogic: zero address");
        _;
    }

    /// @notice Initialize the contract
    /// @param _startingBlockNumber Requests included in a block older than _startingBlockNumber cannot be processed
    /// @param _protocolPercentageFee       Percentage amount of protocol fee (min: %0.01)
    /// @param _chainId                     Id of the underlying chain
    /// @param _relay Bitcoin bridge address which validates Bitcoin tx
    /// @param _locker TODO
    /// @param _treasury Address of treasury that collects protocol fees
    function initialize(
        uint _startingBlockNumber,
        uint _protocolPercentageFee,
        uint _chainId,
        address _relay,
        address _locker,
        bytes memory _lockerLockingScript,
        ScriptTypes _lockerScriptType,
        address _teleporter,
        address _treasury,
        address _wrappedNativeToken
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        chainId = _chainId;
        setStartingBlockNumber(_startingBlockNumber);
        setProtocolPercentageFee(_protocolPercentageFee);
        setRelay(_relay);
        setLocker(_locker);
        setLockerLockingScript(_lockerLockingScript, _lockerScriptType);
        setTeleporter(_teleporter);
        setTreasury(_treasury);
        setWrappedNativeToken(_wrappedNativeToken);
    }

    receive() external payable {}

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice Check if the wrap request has been processed before
    /// @param _txId of the request on Bitcoin
    function isWrapRequestProcessed(
        bytes32 _txId
    ) external view override returns (bool) {
        return brc20WrapRequests[_txId].isUsed ? true : false;
    }

    // TODO: add functions for rune as well

    /// @notice Check if the unwrap request has been processed before
    function isUnwrapRequestProcessed(
        uint _reqIdx
    ) external view override returns (bool) {
        return brc20UnwrapRequests[_reqIdx].isProcessed ? true : false;
    }

    /// @notice Setter for locker locking script
    function setLockerLockingScript(
        bytes memory _lockerLockingScript,
        ScriptTypes _lockerScriptType
    ) public override onlyOwner {
        lockerLockingScript = _lockerLockingScript;
        lockerScriptType = _lockerScriptType;
    }

    /// @notice Setter for starting block number
    function setStartingBlockNumber(
        uint _startingBlockNumber
    ) public override onlyOwner {
        require(
            _startingBlockNumber > startingBlockNumber,
            "Brc20RouterLogic: low number"
        );
        startingBlockNumber = _startingBlockNumber;
    }

    /// @notice Setter for protocol percentage fee
    function setProtocolPercentageFee(
        uint _protocolPercentageFee
    ) public override onlyOwner {
        require(
            MAX_PROTOCOL_FEE >= _protocolPercentageFee,
            "Brc20RouterLogic: out of range"
        );
        emit NewProtocolPercentageFee(
            protocolPercentageFee,
            _protocolPercentageFee
        );
        protocolPercentageFee = _protocolPercentageFee;
    }

    /// @notice Setter for Bitcoin relay
    function setRelay(
        address _relay
    ) public override nonZeroAddress(_relay) onlyOwner {
        emit NewRelay(relay, _relay);
        relay = _relay;
    }

    /// @notice Setter for locker
    function setLocker(
        address _locker
    ) public override nonZeroAddress(_locker) onlyOwner {
        emit NewLocker(locker, _locker);
        locker = _locker;
    }

    /// @notice Setter for teleporter
    function setTeleporter(
        address _teleporter
    ) public override nonZeroAddress(_teleporter) onlyOwner {
        emit NewTeleporter(teleporter, _teleporter);
        teleporter = _teleporter;
    }

    /// @notice Setter for treasury
    function setTreasury(
        address _treasury
    ) public override nonZeroAddress(_treasury) onlyOwner {
        emit NewTreasury(treasury, _treasury);
        treasury = _treasury;
    }

    /// @notice Set exchange connector for appId
    /// @dev If address(0) is set for an appId, that appId is inactive
    function setExchangeConnector(
        uint _appId,
        address _exchangeConnector
    ) external override onlyOwner {
        emit SetExchangeConnector(_appId, _exchangeConnector);
        exchangeConnector[_appId] = _exchangeConnector;
    }

    /// @notice Setter for third party address and fee
    function setThirdParty(
        uint _thirdPartyId,
        address _thirdPartyAddress,
        uint _thirdPartyFee
    ) external override onlyOwner {
        emit ThirdPartyInfoUpdated(
            _thirdPartyId,
            thirdParties[_thirdPartyId].thirdPartyAddress,
            thirdParties[_thirdPartyId].thirdPartyFee,
            _thirdPartyAddress,
            _thirdPartyFee
        );

        thirdParty memory _thirdParty;
        _thirdParty.thirdPartyAddress = _thirdPartyAddress;
        _thirdParty.thirdPartyFee = _thirdPartyFee;
        thirdParties[_thirdPartyId] = _thirdParty;
    }

    /// @notice Setter for chainId
    function setChainId(uint _chainId) public override onlyOwner {
        chainId = _chainId;
    }

    /// @notice Setter for wrapped native token
    function setWrappedNativeToken(
        address _wrappedNativeToken
    ) public override nonZeroAddress(_wrappedNativeToken) onlyOwner {
        wrappedNativeToken = _wrappedNativeToken;
    }

    /// @notice Deploy wrapped BRC20 token contract
    /// @dev We assign tokenId to a supported BRC20
    function addBrc20(
        string memory _name,
        uint8 _decimal,
        uint _tokenId
    ) external override onlyOwner {
        // Cannot assign BRC20 to a used tokenId
        require(
            supportedBrc20s[_tokenId] == address(0),
            "Brc20RouterLogic: used id"
        );

        // Deploy logic contract
        address wbrc20Logic = Brc20RouterLib.addBrc20Helper();

        bytes memory nullData;
        WBRC20Proxy _wbrc20Proxy = new WBRC20Proxy(
            wbrc20Logic,
            owner(),
            nullData
        ); // We set current owner as the proxy admin

        address wbrc20Proxy = address(_wbrc20Proxy);

        // Initialize proxy (logic owner is this contract)
        WBRC20Logic(wbrc20Proxy).initialize(_name, _name, _decimal); // We use the same name & symbol

        // Add this contract as minter and burner
        WBRC20Logic(wbrc20Proxy).addMinter(address(this));
        WBRC20Logic(wbrc20Proxy).addBurner(address(this));

        supportedBrc20s[_tokenId] = wbrc20Proxy;
        tokenIds[_name] = _tokenId;

        emit NewBrc20(_name, _decimal, _tokenId, wbrc20Proxy, wbrc20Logic);
    }

    /// @notice Remove support of a wrapped BRC20 token
    function removeBrc20(uint _tokenId) external override onlyOwner {
        require(
            supportedBrc20s[_tokenId] != address(0),
            "Brc20RouterLogic: no token"
        );
        emit Brc20Removed(_tokenId, supportedBrc20s[_tokenId]);
        tokenIds[WBRC20Logic(supportedBrc20s[_tokenId]).name()] = 0;
        supportedBrc20s[_tokenId] = address(0);
    }

    /// @notice Setter for unwrap fee
    /// @dev This fee is taken for unwrap requests to cover the Bitcoin network fee
    function setUnwrapFee(uint _newFee) external override onlyOwner {
        emit UnwrapFeeUpdated(unwrapFee, _newFee);
        unwrapFee = _newFee;
    }

    /// @notice Process wrap BRC20 request
    /// @dev Locker submits wrap requests to this function for:
    ///      1) Checking tx inclusion
    ///      2) Extracting wrap request info from the OP_RETURN output
    ///      3) Exchanging wrapped BRC20 (if request is wrap & exchange) using the path
    ///         provided by the locker
    /// @param _version of Bitcoin tx
    /// @param _vin Tx inputs
    /// @param _vout Tx outputs
    /// @param _locktime Tx locktime
    /// @param _blockNumber that includes the tx
    /// @param _intermediateNodes Merkle proof for tx
    /// @param _index of tx in the block
    function wrapBrc20(
        bytes4 _version,
        bytes memory _vin,
        bytes calldata _vout,
        bytes4 _locktime,
        uint256 _blockNumber,
        bytes calldata _intermediateNodes,
        uint _index,
        address[] memory _path
    ) external payable override nonReentrant {
        require(_msgSender() == teleporter, "Brc20RouterLogic: not teleporter");

        // Find txId and check its inclusion
        bytes32 txId = Brc20RouterLib.checkTx(
            startingBlockNumber,
            relay,
            _version,
            _vin,
            _vout,
            _locktime,
            _blockNumber,
            _intermediateNodes,
            _index
        );

        // Extract information from the request & find fees and remaining amount
        (
            uint remainingAmount,
            fees memory fee,
            address _thirdPartyAddress,
            address wrappedBrc20
        ) = Brc20RouterLib.wrapHelper(
                chainId,
                _vout,
                txId,
                brc20WrapRequests,
                supportedBrc20s,
                thirdParties,
                protocolPercentageFee,
                lockerPercentageFee
            );

        // Mint wrapped tokens
        IWBRC20(wrappedBrc20).mint(
            address(this),
            fee.protocolFee +
                fee.lockerFee +
                fee.thirdPartyFee +
                remainingAmount
        );

        // Send protocol, locker and third party fee
        IWBRC20(wrappedBrc20).transfer(treasury, fee.protocolFee);
        IWBRC20(wrappedBrc20).transfer(locker, fee.lockerFee);

        if (_thirdPartyAddress != address(0)) {
            IWBRC20(wrappedBrc20).transfer(
                _thirdPartyAddress,
                fee.thirdPartyFee
            );
        }

        brc20WrapRequest memory request = brc20WrapRequests[txId];

        if (request.appId == 0) {
            // This is a wrap request
            // Transfer wrapped tokens to user
            IWBRC20(wrappedBrc20).transfer(
                request.recipientAddress,
                remainingAmount
            );

            emit NewWrap(
                request.recipientAddress,
                remainingAmount,
                wrappedBrc20,
                fee,
                _thirdPartyAddress,
                txId
            );
        } else {
            // This is wrap & exchange request
            // Check exchange path provided by locker
            require(
                _path[0] == request.inputToken &&
                    _path[_path.length - 1] == request.outputToken,
                "BurnRouterLogic: wrong path"
            );

            (bool result, uint[] memory amounts) = _swap(
                request.appId,
                request.recipientAddress,
                remainingAmount,
                request.outputAmount,
                _path
            );

            if (result) {
                emit NewWrapAndSwap(
                    request.recipientAddress,
                    remainingAmount,
                    wrappedBrc20,
                    amounts[amounts.length - 1],
                    request.outputToken,
                    fee,
                    _thirdPartyAddress,
                    txId
                );
            } else {
                emit FailedWrapAndSwap(
                    request.recipientAddress,
                    remainingAmount,
                    wrappedBrc20,
                    request.outputAmount,
                    request.outputToken,
                    fee,
                    _thirdPartyAddress,
                    txId
                );

                // Transfer wrapped tokens to user
                IWBRC20(wrappedBrc20).transfer(
                    request.recipientAddress,
                    remainingAmount
                );
            }
        }
    }

    /// @notice Process user unwrap request
    /// @dev For unwrap requests (not swap & unwrap), pass _appId,
    ///      _inputAmount and _path ZERO
    /// @param _amount of WBRC20 that user wants to burn
    /// @param _userScript User script hash
    /// @param _scriptType User script type
    function unwrapBrc20(
        uint _thirdPartyId,
        uint _tokenId,
        uint _amount,
        bytes memory _userScript,
        ScriptTypes _scriptType,
        uint _appId,
        uint _inputAmount,
        address[] memory _path
    ) external payable override nonReentrant {
        address token = supportedBrc20s[_tokenId];
        require(token != address(0), "Brc20RouterLogic: not supported");

        if (msg.value > unwrapFee) {
            // Input token is native token
            require(
                msg.value == _inputAmount + unwrapFee,
                "Brc20RouterLogic: wrong value"
            );

            require(
                wrappedNativeToken == _path[0],
                "Brc20RouterLogic: invalid path"
            );

            // Mint wrapped native token
            IWETH(wrappedNativeToken).deposit{value: _inputAmount}();
        } else {
            // Input token != native token
            require(msg.value == unwrapFee, "Brc20RouterLogic: wrong fee");
        }

        if (_path.length != 0) {
            // This is a swap and unwrap request
            if (msg.value == unwrapFee) {
                // Transfer user's tokens to contract
                // Input token is not native token
                IWBRC20(_path[0]).transferFrom(
                    msg.sender,
                    address(this),
                    _inputAmount
                );
            }

            (bool result, uint[] memory amounts) = _swap(
                _appId,
                address(this),
                _inputAmount,
                _amount,
                _path
            );
            require(result, "Brc20RouterLogic: swap failed");
            _amount = amounts[amounts.length - 1]; // WBRC20 amount that would be burnt
        } else {
            // This is a unwrap request
            // Transfer user's tokens to contract
            require(
                IWBRC20(token).transferFrom(
                    _msgSender(),
                    address(this),
                    _amount
                ),
                "Brc20RouterLogic: transfer failed"
            );
        }

        (
            fees memory fee,
            address thirdPartyAddress,
            uint remainingAmount
        ) = _unwrapBrc20(
                _thirdPartyId,
                token,
                _amount,
                _userScript,
                _scriptType
            );

        if (_path.length == 0) {
            emit NewUnwrap(
                _msgSender(),
                _userScript,
                _scriptType,
                token,
                _amount,
                remainingAmount,
                fee,
                unwrapFee,
                thirdPartyAddress,
                brc20UnwrapRequests.length - 1
            );
        } else {
            emit NewUnwrapAndSwap(
                _msgSender(),
                _userScript,
                _scriptType,
                _inputAmount,
                _path[0],
                _amount,
                remainingAmount,
                token,
                fee,
                unwrapFee,
                thirdPartyAddress,
                brc20UnwrapRequests.length - 1
            );
        }
    }

    /// @notice Check proof of unwraping
    function unwrapProof(
        bytes4 _version,
        bytes memory _vin,
        bytes memory _vout,
        bytes4 _locktime,
        uint256 _blockNumber,
        bytes memory _intermediateNodes,
        uint _index,
        uint[] memory _reqIndexes
    ) external payable override nonReentrant {
        require(_msgSender() == locker, "Brc20RouterLogic: not locker");

        bytes32 txId = Brc20RouterLib.checkTx(
            startingBlockNumber,
            relay,
            _version,
            _vin,
            _vout,
            _locktime,
            _blockNumber,
            _intermediateNodes,
            _index
        );

        for (uint i = 0; i < _reqIndexes.length; i++) {
            require(
                !brc20UnwrapRequests[_reqIndexes[i]].isProcessed,
                "Brc20RouterLogic: already processed"
            );
            brc20UnwrapRequests[_reqIndexes[i]].isProcessed = true;
            emit UnwrapProcessed(
                brc20UnwrapRequests[_reqIndexes[i]].sender,
                brc20UnwrapRequests[_reqIndexes[i]].burntAmount,
                brc20UnwrapRequests[_reqIndexes[i]].userScript,
                brc20UnwrapRequests[_reqIndexes[i]].scriptType,
                _reqIndexes[i],
                txId
            );
        }
    }

    // Swap tokens using an exchange connector
    function _swap(
        uint _appId,
        address _recipientAddress,
        uint _inputAmount,
        uint _outputAmount,
        address[] memory _path
    ) private returns (bool _result, uint[] memory _amounts) {
        address _exchangeConnector = exchangeConnector[_appId];
        require(
            _exchangeConnector != address(0),
            "BurnRouterLogic: invalid appId"
        );

        IWBRC20(_path[0]).approve(_exchangeConnector, _inputAmount);

        if (IDexConnector(_exchangeConnector).isPathValid(_path)) {
            (_result, _amounts) = IDexConnector(_exchangeConnector).swap(
                _inputAmount,
                _outputAmount,
                _path,
                _recipientAddress,
                block.timestamp,
                true // Input amount is fixed
            );
        } else {
            _result = false;
        }
    }

    /// @notice Burns wrapped BRC20 and record the request
    function _unwrapBrc20(
        uint _thirdPartyId,
        address _token,
        uint _amount,
        bytes memory _userScript,
        ScriptTypes _scriptType
    )
        private
        returns (
            fees memory _fee,
            address _thirdPartyAddress,
            uint _remainingAmount
        )
    {
        // Save unwrap request and get fee and burnt amounts
        (_fee, _thirdPartyAddress, _remainingAmount) = Brc20RouterLib
            .unwrapHelper(
                _msgSender(),
                protocolPercentageFee,
                lockerPercentageFee,
                brc20UnwrapRequests,
                thirdParties,
                _thirdPartyId,
                _amount,
                _userScript,
                _scriptType
            );

        unwrapCounter++;

        // Send protocol, locker and third party fee
        // TODO: comment token fees and get only native token as fee
        IWBRC20(_token).transfer(treasury, _fee.protocolFee);

        IWBRC20(_token).transfer(locker, _fee.lockerFee);
        Address.sendValue(payable(locker), unwrapFee);

        if (_thirdPartyAddress != address(0)) {
            IWBRC20(_token).transfer(_thirdPartyAddress, _fee.thirdPartyFee);
        }

        // Burn remained amount
        IWBRC20(_token).burn(_remainingAmount);
    }
}
