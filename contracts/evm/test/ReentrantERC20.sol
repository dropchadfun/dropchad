// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @notice Calls back into a target contract from inside `transfer`, once.
/// @dev Expected: the reentry reverts on `nonReentrant`, the claim bit is already set,
///      and there is no double payout.
///      The reentry result is **swallowed and recorded**, never bubbled. If it were bubbled the
///      outer claim would revert too and the test could not tell the two failures apart.
contract ReentrantERC20 is MockERC20 {
    address public target;
    bytes public reentryCalldata;

    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryReturnData;

    constructor() MockERC20("Reentrant", "REENT", 18) {}

    /// @param target_ the contract to call back into. Zero disables the callback.
    /// @param data the calldata to send. Usually an encoded `claim(...)`.
    function setReentry(address target_, bytes calldata data) external {
        target = target_;
        reentryCalldata = data;
        attempted = false;
        reentrySucceeded = false;
        delete reentryReturnData;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        super._transfer(from, to, amount);

        if (target != address(0) && !attempted) {
            attempted = true;
            (bool ok, bytes memory ret) = target.call(reentryCalldata);
            reentrySucceeded = ok;
            reentryReturnData = ret;
        }
    }
}
