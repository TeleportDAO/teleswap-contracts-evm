// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <=0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface ITeleBTC is IERC20Upgradeable {

    // Events
    event Mint(address indexed doer, address indexed receiver, uint value);

    event Burn(address indexed doer, address indexed burner, uint value);

    event MinterAdded(address indexed newMinter);

    event MinterRemoved(address indexed minter);

    event BurnerAdded(address indexed newBurner);

    event BurnerRemoved(address indexed burner);

    event NewMintLimit(uint oldMintLimit, uint newMintLimit);

    event NewEpochLength(uint oldEpochLength, uint newEpochLength);

    event Blacklisted(address indexed account);

    event UnBlacklisted(address indexed account);

    event BlackListerAdded(address indexed newBlackLister);

    event BlackListerRemoved(address indexed blackLister);

    // read functions

    function decimals() external view returns (uint8);

    // state-changing functions

    function addMinter(address account) external;

    function removeMinter(address account) external;

    function addBurner(address account) external;

    function removeBurner(address account) external;

    function mint(address receiver, uint amount) external returns(bool);

    function burn(uint256 amount) external returns(bool);

    function ownerBurn(address _user, uint _amount) external returns (bool);

    function setMaxMintLimit(uint _mintLimit) external;

    function setEpochLength(uint _length) external;

    function addBlackLister(address account) external;

    function removeBlackLister(address account) external;

    function blacklist(address _account) external;

    function unBlacklist(address _account) external;
}