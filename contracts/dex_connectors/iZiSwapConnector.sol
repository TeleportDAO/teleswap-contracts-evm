// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./DexConnectorStorage.sol";
import "@izumifinance/iziswap_periphery/contracts/Swap.sol" as ExternalSwap; // Avoid conflict with Swap event
import "@izumifinance/iziswap_periphery/contracts/Quoter.sol";
import "@izumifinance/iziswap_periphery/contracts/core/interfaces/IiZiSwapFactory.sol";
import "@izumifinance/iziswap_core/contracts/iZiSwapPool.sol" as LiquidityPool;
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract iZiSwapConnector is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    DexConnectorStorage
{
    modifier nonZeroAddress(address _address) {
        require(_address != address(0), "iZiSwapConnector: zero address");
        _;
    }

    using SafeERC20 for IERC20;

    /// @notice This contract is used for interacting with UniswapV3 contract
    /// @param _name Name of the underlying DEX
    /// @param _exchangeRouter Address of the DEX router contract
    function initialize(
        string memory _name,
        address _exchangeRouter,
        address _quoterAddress
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        name = _name;
        exchangeRouter = _exchangeRouter;
        liquidityPoolFactory = ExternalSwap
            .Swap(payable(exchangeRouter))
            .factory();
        quoterAddress = _quoterAddress;
        wrappedNativeToken = ExternalSwap.Swap(payable(exchangeRouter)).WETH9();
    }

    function renounceOwnership() public virtual override onlyOwner {}

    /// @notice Setter for wrapped native token
    /// @dev Get address from exchange router
    function setWrappedNativeToken() external override onlyOwner {
        wrappedNativeToken = ExternalSwap.Swap(payable(exchangeRouter)).WETH9();
    }

    /// @notice Setter for exchange router
    /// @dev Set address of liquidity pool factory from the exchange router
    /// @param _exchangeRouter Address of the new exchange router contract
    function setExchangeRouter(
        address _exchangeRouter
    ) external override nonZeroAddress(_exchangeRouter) onlyOwner {
        exchangeRouter = _exchangeRouter;
        liquidityPoolFactory = ExternalSwap
            .Swap(payable(exchangeRouter))
            .factory();
    }

    /// @notice Setter for liquidity pool factory
    /// @dev Set address from exchange router
    function setLiquidityPoolFactory() external override onlyOwner {
        liquidityPoolFactory = ExternalSwap
            .Swap(payable(exchangeRouter))
            .factory();
    }

    /// @notice Setter for quoter
    function setQuoter(address _quoterAddress) external onlyOwner {
        quoterAddress = _quoterAddress;
    }

    /// @notice Setter for fee tier
    /// @dev We set the fee tier that is used for exchanging tokens
    function setFeeTier(
        address _firstToken,
        address _secondToken,
        uint24 _feeTier
    ) external onlyOwner {
        feeTier[_firstToken][_secondToken] = _feeTier;
        feeTier[_secondToken][_firstToken] = _feeTier;
    }

    function convertedPath(
        address[] memory _path
    ) public view returns (bytes memory packedData) {
        packedData = abi.encodePacked(_path[0]);

        for (uint i = 1; i < _path.length; i++) {
            address firstToken = _path[i - 1];
            address secondToken = _path[i];
            uint24 _feeTier = feeTier[firstToken][secondToken];
            packedData = abi.encodePacked(packedData, _feeTier, secondToken);
        }
    }

    /// @notice Return the needed input amount to get the output amount
    /// @dev Return (false, 0) if DEX cannot give the output amount
    function getExactOutput(
        address[] memory _path,
        uint256 _amountOut
    ) public returns (bool, uint256) {
        if (!isPathValid(_path)) {
            return (false, 0);
        }
        (uint amountIn, ) = Quoter(payable(quoterAddress)).swapDesire(
            uint128(_amountOut), // TODO: Uint 128
            convertedPath(_path)
        );
        return (true, amountIn);
    }

    /// @notice Return the output amount for the given input amount
    /// @dev Return (false, 0) if DEX cannot swap the input amount
    function getExactInput(
        address[] memory _path,
        uint256 _amountIn
    ) public returns (bool, uint256) {
        if (!isPathValid(_path)) {
            return (false, 0);
        }
        (uint amountOut, ) = Quoter(payable(quoterAddress)).swapAmount(
            uint128(_amountIn), // TODO: Uint 128
            convertedPath(_path)
        );
        return (true, amountOut);
    }

    /// @notice Deprecated for v3
    function getInputAmount(
        uint,
        address,
        address
    ) external pure override returns (bool, uint) {
        return (true, 0);
    }

    /// @notice Deprecated for v3
    function getOutputAmount(
        uint,
        address,
        address
    ) external pure override returns (bool, uint) {
        return (true, 0);
    }

    /// @notice Return the swap rate between two tokens
    /// @dev Decimal determines the precision of the swap rate
    function getSqrtPriceX96(
        address[] memory _path
    )
        external
        view
        returns (uint[] memory _sqrtPriceX96, address[] memory _firstToken)
    {
        address liquidityPool;
        uint sqrtPriceX96;

        for (uint i = 0; i < _path.length - 1; i++) {
            liquidityPool = IiZiSwapFactory(liquidityPoolFactory).pool(
                _path[i],
                _path[i + 1],
                feeTier[_path[i]][_path[i + 1]]
            );

            (sqrtPriceX96, , , , , , , ) = LiquidityPool
                .iZiSwapPool(liquidityPool)
                .state();
            _sqrtPriceX96[i] = sqrtPriceX96;

            if (LiquidityPool.iZiSwapPool(liquidityPool).tokenX() == _path[i]) {
                _firstToken[i] = _path[i];
            } else {
                _firstToken[i] = _path[i + 1];
            }
        }
    }

    /// @notice Exchange input token for output token through exchange router
    /// @dev Check exchange conditions before exchanging
    ///      We assume that the input token is not WETH (it is teleBTC)
    /// @param _inputAmount Amount of input token
    /// @param _outputAmount Amount of output token
    /// @param _path List of tokens that are used for exchanging
    /// @param _to Receiver address
    /// @param _deadline Deadline of exchanging tokens
    /// @param _isFixedToken True if the input token amount is fixed
    /// @return _result True if the exchange is successful
    /// @return _amounts Amounts of tokens that are involved in exchanging
    function swap(
        uint256 _inputAmount,
        uint256 _outputAmount,
        address[] memory _path,
        address _to,
        uint256 _deadline,
        bool _isFixedToken
    )
        external
        override
        nonReentrant
        nonZeroAddress(_to)
        returns (bool _result, uint[] memory _amounts)
    {
        uint neededInputAmount;
        (_result, neededInputAmount) = _checkExchangeConditions(
            _inputAmount,
            _outputAmount,
            _path,
            _deadline,
            _isFixedToken
        );

        uint _amount;
        if (_result) {
            _amounts = new uint[](2);
            // Get tokens from user
            IERC20(_path[0]).safeTransferFrom(
                _msgSender(),
                address(this),
                neededInputAmount
            );

            // Give allowance to exchange router
            IERC20(_path[0]).approve(exchangeRouter, neededInputAmount);

            if (_isFixedToken == true) {
                (, _amount) = ExternalSwap
                    .Swap(payable(exchangeRouter))
                    .swapAmount(
                        _buildInputSwap(
                            neededInputAmount,
                            _outputAmount,
                            _path,
                            _to,
                            _deadline
                        )
                    );
                _amounts[0] = neededInputAmount;
                _amounts[1] = _amount;
            }

            if (_isFixedToken == false) {
                (, _amount) = ExternalSwap
                    .Swap(payable(exchangeRouter))
                    .swapDesire(
                        _buildOutputSwap(
                            neededInputAmount,
                            _outputAmount,
                            _path,
                            _to,
                            _deadline
                        )
                    );
                _amounts[0] = _amount;
                _amounts[1] = _outputAmount;
            }
            // emit Swap(_path, _amounts, _to);
        }
    }

    /// @notice Return true if the exchange path is valid
    /// @param _path List of tokens that are used for exchanging
    function isPathValid(
        address[] memory _path
    ) public view override returns (bool _result) {
        address liquidityPool;

        // Checks that path length is greater than one
        if (_path.length < 2) {
            return false;
        }

        for (uint i = 0; i < _path.length - 1; i++) {
            liquidityPool = IiZiSwapFactory(liquidityPoolFactory).pool(
                _path[i],
                _path[i + 1],
                feeTier[_path[i]][_path[i + 1]]
            );
            if (liquidityPool == address(0)) {
                return false;
            }
        }

        return true;
    }

    // Private functions

    function _buildInputSwap(
        uint _amountIn,
        uint _amountOutMin,
        address[] memory _path,
        address _recipient,
        uint _deadline
    ) private view returns (ExternalSwap.Swap.SwapAmountParams memory) {
        return
            ExternalSwap.Swap.SwapAmountParams({
                path: convertedPath(_path),
                recipient: _recipient,
                amount: uint128(_amountIn), // TODO: Uint 128
                minAcquired: _amountOutMin,
                deadline: _deadline
            });
    }

    function _buildOutputSwap(
        uint _amountInMaximum,
        uint _amountOut,
        address[] memory _path,
        address _recipient,
        uint _deadline
    ) private view returns (ExternalSwap.Swap.SwapDesireParams memory) {
        return
            ExternalSwap.Swap.SwapDesireParams({
                path: convertedPath(_path),
                recipient: _recipient,
                desire: uint128(_amountOut), // TODO: Uint 128
                maxPayed: _amountInMaximum,
                deadline: _deadline
            });
    }

    /// @notice Check if exchanging is possible or not
    /// @dev Avoid reverting by exchange router
    /// @return True if exchange conditions are satisfied
    /// @return Needed amount of input token
    function _checkExchangeConditions(
        uint256 _inputAmount,
        uint256 _outputAmount,
        address[] memory _path,
        uint256 _deadline,
        bool _isFixedToken
    ) private returns (bool, uint) {
        // Check deadline has not passed
        if (_deadline < block.timestamp) {
            return (false, 0);
        }

        // Find maximum output amount
        (bool success, uint outputResult) = getExactInput(_path, _inputAmount);

        // Check that exchanging is possible or not
        if (_outputAmount > outputResult) {
            return (false, 0);
        } else {
            if (_isFixedToken == true) {
                return (success, _inputAmount);
            } else {
                return getExactOutput(_path, _outputAmount);
            }
        }
    }
}
