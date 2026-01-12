// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.7.0) (security/Pausable.sol)

pragma solidity >=0.8.0 <0.9.0;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotPaused` and `whenPaused`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 */
abstract contract Pausable is Initializable {
    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account, address token);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account, address token);

    mapping (address => bool) private _paused;

      /**
     * @dev Initializes the contract in unpaused state.
     */
    function __Pausable_init() internal onlyInitializing {}

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused(address token) {
        _requireNotPaused(token);
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused(address token) {
        _requirePaused(token);
        _;
    }

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused(address token) public view virtual returns (bool) {
        return _paused[token];
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused(address token) internal view virtual {
        require(!paused(token), "Pausable: paused");
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused(address token) internal view virtual {
        require(paused(token), "Pausable: not paused");
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause(address token) internal virtual whenNotPaused(token) {
        _paused[token] = true;
        emit Paused(msg.sender, token);
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function _unpause(address token) internal virtual whenPaused(token) {
        _paused[token] = false;
        emit Unpaused(msg.sender, token);
    }
}
