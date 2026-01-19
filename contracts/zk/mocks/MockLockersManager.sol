// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MockLockersManager
 * @notice Mock contract for testing PrivateTransferClaim
 */
contract MockLockersManager {
    event Mint(bytes lockerScript, address receiver, uint256 amount);

    mapping(address => uint256) public balances;
    uint256 public totalMinted;

    /**
     * @notice Mock mint function
     */
    function mint(
        bytes calldata _lockerScript,
        address _receiver,
        uint256 _amount
    ) external returns (bool) {
        balances[_receiver] += _amount;
        totalMinted += _amount;

        emit Mint(_lockerScript, _receiver, _amount);
        return true;
    }

    /**
     * @notice Get balance of an address
     */
    function balanceOf(address _account) external view returns (uint256) {
        return balances[_account];
    }
}
