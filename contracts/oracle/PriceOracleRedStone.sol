// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

interface IRedStone {
    function priceOf(address _token) external view returns (uint256);
}

contract PriceOracleRedStone is Ownable {
    using SafeCast for uint;

    modifier nonZeroAddress(address _address) {
        require(_address != address(0), "PriceOracle: zero address");
        _;
    }

    // Public variables
    mapping(address => address) public ChainlinkPriceProxy;
    // ^^ [tokenAddress] => [priceProxyAddress]
    uint public acceptableDelay;
    address public constant NATIVE_TOKEN = address(1);
    // ^^ ONE_ADDRESS is used for getting price of blockchain native token
    address public oracleNativeToken;
    address public teleBTC;
    address constant WBTC = 0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3;

    /// @notice This contract is used to get relative price of two assets from RedStone
    /// @param _acceptableDelay Maximum acceptable delay for data given from RedStone
    /// @param _oracleNativeToken Native token address
    constructor(uint _acceptableDelay, address _oracleNativeToken) {
        _setAcceptableDelay(_acceptableDelay);
        _setOracleNativeToken(_oracleNativeToken);
    }

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice Sets a USD price proxy for a token
    /// @dev Only owner can call this
    ///      This price proxy gives exchange rate of _token/USD
    ///      Setting price proxy address to zero means that we remove it
    /// @param _token Address of the token
    /// @param _priceProxyAddress The address of the price proxy
    function setPriceProxy(
        address _token,
        address _priceProxyAddress
    ) external nonZeroAddress(_token) onlyOwner {
        ChainlinkPriceProxy[_token] = _priceProxyAddress;
        // emit SetPriceProxy(_token, _priceProxyAddress);
    }

    /// @notice Set acceptable delay for oracle responses
    /// @param _acceptableDelay Maximum acceptable delay (in seconds)
    function setAcceptableDelay(uint _acceptableDelay) external onlyOwner {
        _setAcceptableDelay(_acceptableDelay);
    }

    /// @notice Set wrapped native token address
    function setOracleNativeToken(
        address _oracleNativeToken
    ) external onlyOwner {
        _setOracleNativeToken(_oracleNativeToken);
    }

    /// @notice Set TeleBTC address
    function setTeleBTC(address _teleBTC) external onlyOwner {
        _setTeleBTC(_teleBTC);
    }

    /// @notice Find amount of output token that is equal to the input amount of the input token
    /// @dev The oracle is RedStone
    /// @param _inputAmount Amount of the input token
    /// @param _inputDecimals Input token decimal
    /// @param _outputDecimals Output token decimal
    /// @param _inputToken Address of the input token
    /// @param _outputToken Address of output token
    function equivalentOutputAmount(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) external view returns (uint _outputAmount) {
        bool result;
        (
            result,
            _outputAmount,
            /*timestamp*/

        ) = _equivalentOutputAmountFromOracle(
            _inputAmount,
            _inputDecimals,
            _outputDecimals,
            _inputToken,
            _outputToken
        );
        require(result == true, "PriceOracle: oracle not exist or up to date");
    }

    // Private functions

    /// @notice Internal setter for acceptable delay for oracle responses
    function _setAcceptableDelay(uint _acceptableDelay) private {
        // emit NewAcceptableDelay(acceptableDelay, _acceptableDelay);
        require(_acceptableDelay > 0, "PriceOracle: zero amount");
        acceptableDelay = _acceptableDelay;
    }

    /// @notice Internal setter for oracle native token address
    function _setOracleNativeToken(
        address _oracleNativeToken
    ) private nonZeroAddress(_oracleNativeToken) {
        // emit NewOracleNativeToken(oracleNativeToken, _oracleNativeToken);
        oracleNativeToken = _oracleNativeToken;
    }

    /// @notice Internal setter for TeleBTC address
    function _setTeleBTC(address _teleBTC) private nonZeroAddress(_teleBTC) {
        teleBTC = _teleBTC;
    }

    /// @return _result True if getting amount was successful
    /// @return _outputAmount Amount of the output token
    /// @return _timestamp Timestamp of the result
    function _equivalentOutputAmountFromOracle(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) private view returns (bool, uint _outputAmount, uint _timestamp) {
        uint decimals0;
        uint decimals1;
        uint price0;
        uint price1;

        if (
            ChainlinkPriceProxy[_inputToken] != address(0) &&
            ChainlinkPriceProxy[_outputToken] != address(0)
        ) {
            if (
                _inputToken == NATIVE_TOKEN || _inputToken == oracleNativeToken
            ) {
                // Address 0 is the price of Bitcoin
                price0 = IRedStone(ChainlinkPriceProxy[_inputToken]).priceOf(
                    address(0)
                );
            } else if (_inputToken == teleBTC) {
                // Use WBTC price for TeleBTC
                price0 = IRedStone(ChainlinkPriceProxy[_inputToken]).priceOf(
                    WBTC
                );
            } else {
                price0 = IRedStone(ChainlinkPriceProxy[_inputToken]).priceOf(
                    _inputToken
                );
            }
            require(price0 != 0, "PriceOracle: zero price for input token");
            decimals0 = 18;

            if (
                _outputToken == NATIVE_TOKEN ||
                _outputToken == oracleNativeToken
            ) {
                price1 = IRedStone(ChainlinkPriceProxy[_outputToken]).priceOf(
                    address(0)
                );
            } else if (_outputToken == teleBTC) {
                // Use WBTC price for TeleBTC
                price1 = IRedStone(ChainlinkPriceProxy[_outputToken]).priceOf(
                    WBTC
                );
            } else {
                price1 = IRedStone(ChainlinkPriceProxy[_outputToken]).priceOf(
                    _outputToken
                );
            }
            require(price1 != 0, "PriceOracle: zero price for output token");
            decimals1 = 18;

            // convert the above calculation to the below one to eliminate precision loss
            _outputAmount =
                (uint(price0) * 10 ** (decimals1)) *
                _inputAmount *
                (10 ** (_outputDecimals + 1));
            _outputAmount =
                _outputAmount /
                ((10 ** (_inputDecimals + 1)) *
                    (uint(price1) * 10 ** (decimals0)));

            // TODO: check staleness of prices
            // uint[2] memory _timestamps;

            // if (_abs(block.timestamp.toInt256() - _timestamps[0].toInt256()) > acceptableDelay) {
            //     return (false, _outputAmount, _timestamps[0]);
            // }

            // if (_abs(block.timestamp.toInt256() - _timestamps[1].toInt256()) > acceptableDelay) {
            //     return (false, _outputAmount, _timestamps[1]);
            // }

            // _timestamp = _timestamps[0] > _timestamps[1] ? _timestamps[1] : _timestamps[0];

            return (true, _outputAmount, 0);
        } else {
            return (false, 0, 0);
        }
    }

    /// @notice Return absolute value
    function _abs(int _value) private pure returns (uint) {
        return _value >= 0 ? uint(_value) : uint(-_value);
    }
}
