// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

interface IPriceOracle {

    /// @notice                     Emits when new exchange router is added
    /// @param exchangeRouter       Address of new exchange router
    /// @param exchangeConnector    Address of exchange connector
    event ExchangeConnectorAdded(address indexed exchangeRouter, address indexed exchangeConnector);

    /// @notice                     Emits when an exchange router is removed
    /// @param exchangeRouter       Address of removed exchange router
    event ExchangeConnectorRemoved(address indexed exchangeRouter);

    /// @notice                     Emits when a price proxy is set
    /// @param _token               Address of the token
    /// @param _priceProxyAddress   Address of price proxy contract
    event SetPriceProxy(address indexed _token, address indexed _priceProxyAddress);

    /// @notice                     Emits when changes made to acceptable delay
	event NewAcceptableDelay(uint oldAcceptableDelay, uint newAcceptableDelay);

    /// @notice                     Emits when changes made to oracle native token
	event NewOracleNativeToken(address indexed oldOracleNativeToken, address indexed newOracleNativeToken);

    // Read-only functions
    
    /// @notice                     Gives USD price proxy address for a token
    /// @param _token          Address of the token
    /// @return                     Address of price proxy contract
    function ChainlinkPriceProxy(address _token) external view returns (address);

    /// @notice                     Gives exchange connector address for an exchange router
    /// @param _exchangeRouter      Address of exchange router
    /// @return                     Address of exchange connector
    function exchangeConnector(address _exchangeRouter) external view returns (address);

    /// @notice                     Gives address of an exchange router from exchange routers list
    /// @param _index               Index of exchange router
    /// @return                     Address of exchange router
    function exchangeRoutersList(uint _index) external view returns (address);

    function getExchangeRoutersListLength() external view returns (uint);

    function acceptableDelay() external view returns (uint);

    function oracleNativeToken() external view returns (address);

    function equivalentOutputAmountByAverage(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) external view returns (uint);

    function equivalentOutputAmount(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) external view returns (uint);

    function equivalentOutputAmountFromOracle(
        uint _inputAmount,
        uint _inputDecimals,
        uint _outputDecimals,
        address _inputToken,
        address _outputToken
    ) external view returns (uint);

    function equivalentOutputAmountFromExchange(
        address _exchangeRouter,
        uint _inputAmount,
        address _inputToken,
        address _outputToken
    ) external view returns (uint);
    
    // State-changing functions
    
    function addExchangeConnector(address _exchangeRouter, address _exchangeConnector) external;

    function removeExchangeConnector(uint _exchangeRouterIndex) external;

    function setPriceProxy(address _token, address _priceProxyAddress) external;

    function setAcceptableDelay(uint _acceptableDelay) external;

    function setOracleNativeToken(address _oracleNativeToken) external;
}