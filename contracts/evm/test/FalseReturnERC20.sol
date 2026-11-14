// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @notice `transfer` moves nothing and returns false, without reverting.
/// @dev Expected: `SafeERC20` reverts, the claim rolls back.
contract FalseReturnERC20 is MockERC20 {
    constructor() MockERC20("False Return", "FALSE", 18) {}

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }
}
