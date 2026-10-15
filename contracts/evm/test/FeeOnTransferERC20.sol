// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @notice Takes 2% of every transfer and burns it. The receiver gets less than was sent.
/// @dev Expected: `activate` reverts with `Underfunded`,
///      then `cancelUnfunded` returns whatever did arrive.
contract FeeOnTransferERC20 is MockERC20 {
    uint256 public constant FEE_BPS = 200;

    constructor() MockERC20("Fee On Transfer", "FEE", 18) {}

    function _transfer(address from, address to, uint256 amount) internal override {
        uint256 fee = (amount * FEE_BPS) / 10_000;
        uint256 net = amount - fee;

        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += net;
        }
        totalSupply -= fee;

        emit Transfer(from, to, net);
        emit Transfer(from, address(0), fee);
    }
}
