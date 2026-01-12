// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IWBRC20 is IERC20Upgradeable {

    // Events
    
    event Mint(address indexed doer, address indexed receiver, uint value);

    event Burn(address indexed doer, address indexed burner, uint value);

    event MinterAdded(address indexed newMinter);

    event MinterRemoved(address indexed minter);

    event BurnerAdded(address indexed newBurner);

    event BurnerRemoved(address indexed burner);

    // Read-only functions

    function decimals() external view returns (uint8);

    // State-changing functions

    function addMinter(address account) external;

    function removeMinter(address account) external;

    function addBurner(address account) external;

    function removeBurner(address account) external;

    function mint(address receiver, uint amount) external returns(bool);

    function burn(uint256 amount) external returns(bool);
}