// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IPriceOracle.sol";
import "../dex_connectors/interfaces/IDexConnector.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";


contract PriceOracle is IPriceOracle, Ownable {

    using SafeCast for uint;

    modifier nonZeroAddress(address _address) {
        require(_address != address(0), "PriceOracle: zero address");
        _;
    }

    // Public variables
    mapping (address => address) public override ChainlinkPriceProxy; // Given two token addresses returns related Chainlink price proxy
    mapping(address => address) public override exchangeConnector; // Mapping from exchange router to exchange connector
    address[] public override exchangeRoutersList; // List of available exchange routers
    uint public override acceptableDelay;
    address public constant NATIVE_TOKEN = address(1); // ONE_ADDRESS is used for getting price of blockchain native token 
    address public override oracleNativeToken;

    /// @notice                         This contract is used to get relative price of two assets from Chainlink and available exchanges 
    /// @param _acceptableDelay         Maximum acceptable delay for data given from Chainlink
    /// @param _oracleNativeToken       The address of the chainlink oracle for the native token
    constructor(uint _acceptableDelay,address _oracleNativeToken) {
        _setAcceptableDelay(_acceptableDelay);
        _setOracleNativeToken(_oracleNativeToken);
    }

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice                 Getter for the length of exchange router list
    function getExchangeRoutersListLength() public view override returns (uint) {
        return exchangeRoutersList.length;
    }

    /// @notice                         Finds amount of output token that has same value as the input amount of the input token
    /// @dev                            First we try to get the output amount from Chain Link
    ///                                 Only if the price is not available or out-of-date we will 
    ///                                 reach to exchange routers
    /// @param _inputAmount             Amount of the input token
    /// @param _inputDecimals           Number of input token decimals
    /// @param _outputDecimals          Number of output token decimals
    /// @param _inputToken              Address of the input token
    /// @param _outputToken             Address of output token
    /// @return                         Amount of the output token
    function equivalentOutputAmountByAverage(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) external view nonZeroAddress(_inputToken) nonZeroAddress(_outputToken) override returns (uint) {
        // Gets output amount from oracle
        (bool result, uint outputAmount, uint timestamp) = _equivalentOutputAmountFromOracle(
            _inputAmount,
            _inputDecimals,
            _outputDecimals,
            _inputToken,
            _outputToken
        );

        // Checks timestamp of the oracle result
        if (result == true && _abs(timestamp.toInt256() - block.timestamp.toInt256()) <= acceptableDelay) {
            return outputAmount;
        } else {
            uint _totalAmount;
            uint _totalNumber;

            // If Chainlink price is available but out-of-date, we still use it
            if (result == true) {
                _totalAmount = outputAmount;
                _totalNumber = 1;
            }

            // Gets output amounts from exchange routers
            // note: we assume that the decimal of exchange returned result is _outputDecimals.
            for (uint i = 0; i < getExchangeRoutersListLength(); i++) {
                (result, outputAmount) = _equivalentOutputAmountFromExchange(
                    exchangeRoutersList[i],
                    _inputAmount,
                    _inputToken,
                    _outputToken
                );

                if (result == true) {
                    _totalNumber = _totalNumber + 1;
                    _totalAmount = _totalAmount + outputAmount;
                }
            }

            require(_totalNumber > 0, "PriceOracle: no price feed is available");

            // Returns average of results from different sources
            return _totalAmount/_totalNumber;
        }
    }

    /// @notice                         Finds amount of output token that has equal value
    ///                                 as the input amount of the input token
    /// @dev                            The oracle is ChainLink
    /// @param _inputAmount             Amount of the input token
    /// @param _inputDecimals           Number of input token decimals
    /// @param _outputDecimals          Number of output token decimals
    /// @param _inputToken              Address of the input token
    /// @param _outputToken             Address of output token
    /// @return _outputAmount           Amount of the output token
    function equivalentOutputAmount(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) external view nonZeroAddress(_inputToken) nonZeroAddress(_outputToken) override returns (uint _outputAmount) {
        bool result;
        (result, _outputAmount, /*timestamp*/) = _equivalentOutputAmountFromOracle(
            _inputAmount,
            _inputDecimals,
            _outputDecimals,
            _inputToken,
            _outputToken
        );
        require(result == true, "PriceOracle: oracle not exist or up to date");
    }

    /// @notice                         Finds amount of output token that has equal value
    ///                                 as the input amount of the input token
    /// @dev                            The oracle is ChainLink
    /// @param _inputAmount             Amount of the input token
    /// @param _inputDecimals           Number of input token decimals
    /// @param _outputDecimals          Number of output token decimals
    /// @param _inputToken              Address of the input token
    /// @param _outputToken             Address of output token
    /// @return _outputAmount           Amount of the output token
    function equivalentOutputAmountFromOracle(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) external view nonZeroAddress(_inputToken) nonZeroAddress(_outputToken) override returns (uint _outputAmount) {
        bool result;
        (result, _outputAmount, /*timestamp*/) = _equivalentOutputAmountFromOracle(
            _inputAmount,
            _inputDecimals,
            _outputDecimals,
            _inputToken,
            _outputToken
        );
        require(result == true, "PriceOracle: oracle not exist or up to date");
    }

    /// @notice                         Finds amount of output token that has same value 
    ///                                 as the input amount of the input token
    /// @dev                            Input amount should have the same decimal as input token
    ///                                 Output amount has the same decimal as output token
    /// @param _exchangeRouter          Address of the exchange router we are reading the price from
    /// @param _inputAmount             Amount of the input token
    /// @param _inputToken              Address of the input token
    /// @param _outputToken             Address of output token
    /// @return                         Amount of the output token
    function equivalentOutputAmountFromExchange(
        address _exchangeRouter,
        uint _inputAmount,
        address _inputToken,
        address _outputToken
    ) external view nonZeroAddress(_inputToken) nonZeroAddress(_outputToken) override returns (uint) {
        (bool result, uint outputAmount) = _equivalentOutputAmountFromExchange(
            _exchangeRouter,
            _inputAmount,
            _inputToken,
            _outputToken
        );
        require(result == true, "PriceOracle: Pair does not exist on exchange");
        return outputAmount;
    }

    /// @notice                    Adds an exchange connector
    /// @dev                       Only owner can call this
    /// @param _exchangeRouter     Exchange router contract address
    /// @param _exchangeConnector  New exchange connector contract address
    function addExchangeConnector(
        address _exchangeRouter, 
        address _exchangeConnector
    ) external nonZeroAddress(_exchangeRouter) nonZeroAddress(_exchangeConnector) override onlyOwner {
        require(exchangeConnector[_exchangeRouter] == address(0), "PriceOracle: exchange router already exists");
        exchangeRoutersList.push(_exchangeRouter);
        exchangeConnector[_exchangeRouter] = _exchangeConnector;
        emit ExchangeConnectorAdded(_exchangeRouter, _exchangeConnector);
    }

    /// @notice                       Removes an exchange connector
    /// @dev                          Only owner can call this
    /// @param _exchangeRouterIndex   The exchange router index in the list
    function removeExchangeConnector(uint _exchangeRouterIndex) external override onlyOwner {
        require(_exchangeRouterIndex < exchangeRoutersList.length, "PriceOracle: Index is out of bound");
        address exchangeRouterAddress = exchangeRoutersList[_exchangeRouterIndex];
        _removeElementFromExchangeRoutersList(_exchangeRouterIndex);
        exchangeConnector[exchangeRouterAddress] = address(0);
        emit ExchangeConnectorRemoved(exchangeRouterAddress);
    }

    /// @notice                     Sets a USD price proxy for a token
    /// @dev                        Only owner can call this
    ///                             This price proxy gives exchange rate of _token/USD
    ///                             Setting price proxy address to zero means that we remove it
    /// @param _token               Address of the token
    /// @param _priceProxyAddress   The address of the proxy price
    function setPriceProxy(
        address _token, 
        address _priceProxyAddress
    ) external nonZeroAddress(_token) override onlyOwner {
        ChainlinkPriceProxy[_token] = _priceProxyAddress;
        emit SetPriceProxy(_token, _priceProxyAddress);
    }

    /// @notice                     Sets acceptable delay for oracle responses
    /// @dev                        If oracle data has not been updated for a while, 
    ///                             we will get data from exchange routers
    /// @param _acceptableDelay     Maximum acceptable delay (in seconds)
    function setAcceptableDelay(uint _acceptableDelay) external override onlyOwner {
        _setAcceptableDelay(_acceptableDelay);
    }

    /// @notice                     Sets oracle native token address
    function setOracleNativeToken(address _oracleNativeToken) external override onlyOwner {
       _setOracleNativeToken(_oracleNativeToken);
    }

    /// @notice                     Internal setter for acceptable delay for oracle responses
    /// @dev                        If oracle data has not been updated for a while, 
    ///                             we will get data from exchange routers
    /// @param _acceptableDelay     Maximum acceptable delay (in seconds)
    function _setAcceptableDelay(uint _acceptableDelay) private {
        emit NewAcceptableDelay(acceptableDelay, _acceptableDelay);
        require(
            _acceptableDelay > 0,
            "PriceOracle: zero amount"
        );
        acceptableDelay = _acceptableDelay;
    }

    /// @notice                     Internal setter for oracle native token address
    function _setOracleNativeToken(address _oracleNativeToken) private nonZeroAddress(_oracleNativeToken) {
        emit NewOracleNativeToken(oracleNativeToken, _oracleNativeToken);
        oracleNativeToken = _oracleNativeToken;
    }

    /// @notice                         Finds amount of output token that has same value 
    ///                                 as the input amount of the input token
    /// @param _exchangeRouter          Address of the exchange we are reading the price from
    /// @param _inputAmount             Amount of the input token
    /// @param _inputToken              Address of the input token
    /// @param _outputToken             Address of output token
    /// @return _result                 True if getting amount was successful
    /// @return _outputAmount           Amount of the output token
    function _equivalentOutputAmountFromExchange(
        address _exchangeRouter,
        uint _inputAmount,
        address _inputToken,
        address _outputToken
    ) private view returns (bool _result, uint _outputAmount) {
        if (_inputToken == NATIVE_TOKEN) {
            // note: different exchanges may use different wrapped native token versions
            address wrappedNativeToken = IDexConnector(exchangeConnector[_exchangeRouter]).wrappedNativeToken();

            (_result, _outputAmount) = IDexConnector(exchangeConnector[_exchangeRouter]).getOutputAmount(
                _inputAmount,
                wrappedNativeToken,
                _outputToken
            );
        } else if (_outputToken == NATIVE_TOKEN) {
            // note: different exchanges may use different wrapped native token versions
            address wrappedNativeToken = IDexConnector(exchangeConnector[_exchangeRouter]).wrappedNativeToken();

            (_result, _outputAmount) = IDexConnector(exchangeConnector[_exchangeRouter]).getOutputAmount(
                _inputAmount,
                _inputToken,
                wrappedNativeToken
            );
        } else {
            (_result, _outputAmount) = IDexConnector(exchangeConnector[_exchangeRouter]).getOutputAmount(
                _inputAmount,
                _inputToken,
                _outputToken
            );
        }

    }

    /// @notice                         Finds amount of output token that is equal as the input amount of the input token
    /// @dev                            The oracle is ChainLink
    /// @param _inputAmount             Amount of the input token
    /// @param _inputDecimals           Number of input token decimals
    /// @param _outputDecimals          Number of output token decimals
    /// @param _inputToken              Address of the input token
    /// @param _outputToken             Address of output token
    /// @return _result                 True if getting amount was successful
    /// @return _outputAmount           Amount of the output token
    /// @return _timestamp              Timestamp of the result
    function _equivalentOutputAmountFromOracle(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) private view returns (bool, uint _outputAmount, uint _timestamp) {
        uint decimals0;
        uint decimals1;
        int price0;
        int price1;

        if (_inputToken == NATIVE_TOKEN) {
            _inputToken = oracleNativeToken;
        }

        if (_outputToken == NATIVE_TOKEN) {
            _outputToken = oracleNativeToken;
        }

        if (ChainlinkPriceProxy[_inputToken] != address(0) && ChainlinkPriceProxy[_outputToken] != address(0)) {
            uint[2] memory _timestamps;

            // Gets price of _inputToken/USD
            (
            /*uint80 roundID*/,
            price0,
            /*uint startedAt*/,
            _timestamps[0],
            /*uint80 answeredInRound*/
            ) = AggregatorV3Interface(ChainlinkPriceProxy[_inputToken]).latestRoundData();

            require(price0 != 0, "PriceOracle: zero price for input token");

            // Gets number of decimals
            decimals0 = AggregatorV3Interface(ChainlinkPriceProxy[_inputToken]).decimals();


            // Gets price of _outputToken/USD
            (
            /*uint80 roundID*/,
            price1,
            /*uint startedAt*/,
            _timestamps[1],
            /*uint80 answeredInRound*/
            ) = AggregatorV3Interface(ChainlinkPriceProxy[_outputToken]).latestRoundData();

            require(price1 != 0, "PriceOracle: zero price for output token");

            // Gets number of decimals
            decimals1 = AggregatorV3Interface(ChainlinkPriceProxy[_outputToken]).decimals();

            // uint price = (uint(price0) * 10**(decimals1)) / (uint(price1) * 10**(decimals0));

            // // note: to make inside of power parentheses greater than zero, we add them with one
            // _outputAmount = price*_inputAmount*(10**(_outputDecimals + 1))/(10**(_inputDecimals + 1));

            // convert the above calculation to the below one to eliminate precision loss
            _outputAmount = (uint(price0) * 10**(decimals1))*_inputAmount*(10**(_outputDecimals + 1));
            _outputAmount = _outputAmount/((10**(_inputDecimals + 1))*(uint(price1) * 10**(decimals0)));

            if (_abs(block.timestamp.toInt256() - _timestamps[0].toInt256()) > acceptableDelay) {
                return (false, _outputAmount, _timestamps[0]);
            }

            if (_abs(block.timestamp.toInt256() - _timestamps[1].toInt256()) > acceptableDelay) {
                return (false, _outputAmount, _timestamps[1]);
            }

            _timestamp = _timestamps[0] > _timestamps[1] ? _timestamps[1] : _timestamps[0];

            return (true, _outputAmount, _timestamp);
            
        } else {
            return (false, 0, 0);
        }
    }

    /// @notice             Removes an element of excahngeRouterList
    /// @dev                Deletes and shifts the array
    /// @param _index       Index of the element that will be deleted
    function _removeElementFromExchangeRoutersList(uint _index) private {
        exchangeRoutersList[_index] = exchangeRoutersList[exchangeRoutersList.length - 1];
        exchangeRoutersList.pop();
    }

    /// @notice             Returns absolute value
    function _abs(int _value) private pure returns (uint) {
        return _value >= 0 ? uint(_value) : uint(-_value);
    }

}