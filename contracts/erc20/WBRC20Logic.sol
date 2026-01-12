// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "./interfaces/IWBRC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract WBRC20Logic is IWBRC20, ERC20Upgradeable, 
    OwnableUpgradeable, ReentrancyGuardUpgradeable {
 
    modifier onlyMinter() {
        require(isMinter(_msgSender()), "WBRC20Logic: not minter");
        _;
    }

    modifier onlyBurner() {
        require(isBurner(_msgSender()), "WBRC20Logic: not burner");
        _;
    }

    modifier nonZeroValue(uint _value) {
        require(_value > 0, "WBRC20Logic: zero value");
        _;
    }

    // Public variables
    uint8 public decimal;
    mapping(address => bool) public minters;
    mapping(address => bool) public burners;

    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimal
    ) public initializer {
        ERC20Upgradeable.__ERC20_init(
            _name,
            _symbol
        );
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
        decimal = _decimal;
    }

    function renounceOwnership() public virtual override onlyOwner {}

    function decimals() public view virtual override(ERC20Upgradeable, IWBRC20) returns (uint8) {
        return decimal;
    }

    /// @notice Return true if account is minter 
    function isMinter(address account) internal view returns (bool) {
        require(account != address(0), "WBRC20Logic: zero address");
        return minters[account];
    }

    /// @notice Return true if account is burner 
    function isBurner(address account) internal view returns (bool) {
        require(account != address(0), "WBRC20Logic: zero address");
        return burners[account];
    }

    /// @notice Add a minter
    function addMinter(address account) external override onlyOwner {
        require(!isMinter(account), "WBRC20Logic: already minter");
        minters[account] = true;
        emit MinterAdded(account);
    }

    /// @notice Remover a minter
    function removeMinter(address account) external override onlyOwner {
        require(isMinter(account), "WBRC20Logic: not minter");
        minters[account] = false;
        emit MinterRemoved(account);
    }

    /// @notice Add a burner
    function addBurner(address account) external override onlyOwner {
        require(!isBurner(account), "WBRC20Logic: already burner");
        burners[account] = true;
        emit BurnerAdded(account);
    }

    /// @notice Remover a burner
    function removeBurner(address account) external override onlyOwner {
        require(isBurner(account), "WBRC20Logic: not burner");
        burners[account] = false;
        emit BurnerRemoved(account);
    }

    /// @notice Burn tokens of msg.sender
    /// @dev Only burners can call this
    /// @param _amount of burnt tokens
    function burn(uint _amount) external nonReentrant onlyBurner override returns (bool) {
        _burn(_msgSender(), _amount);
        emit Burn(_msgSender(), _msgSender(), _amount);
        return true;
    }

    /// @notice Mint tokens for _receiver
    /// @dev Only minters can call this
    /// @param _receiver Address of token receiver
    /// @param _amount of minted tokens
    function mint(address _receiver, uint _amount) external nonReentrant onlyMinter override returns (bool) {
        _mint(_receiver, _amount);
        emit Mint(_msgSender(), _receiver, _amount);
        return true;
    }
}
