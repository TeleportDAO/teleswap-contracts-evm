// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LpToken is ERC20 {
    constructor (
        string memory name_,
        string memory symbol_,
        uint initialMintedAmount
    ) ERC20(name_, symbol_) {
        _mint(_msgSender(), initialMintedAmount);
    }
}
