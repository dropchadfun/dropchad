// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Calls back into a target contract from inside `receive`, once.
/// @dev Expected: the reentry reverts on `nonReentrant`, no double payout.
///      The result is swallowed and recorded, never bubbled, for the same reason as `ReentrantERC20`.
contract ReentrantEthReceiver {
    address public target;
    bytes public reentryCalldata;

    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryReturnData;

    uint256 public received;

    function setReentry(address target_, bytes calldata data) external {
        target = target_;
        reentryCalldata = data;
        attempted = false;
        reentrySucceeded = false;
        delete reentryReturnData;
    }

    receive() external payable {
        received += msg.value;

        if (target != address(0) && !attempted) {
            attempted = true;
            (bool ok, bytes memory ret) = target.call(reentryCalldata);
            reentrySucceeded = ok;
            reentryReturnData = ret;
        }
    }
}
