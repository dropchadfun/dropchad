// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Refuses ETH until it is switched on. A refund address that rejects ETH at the end of
///         a drop and takes it again later.
contract SwitchableEthReceiver {
    error NotTakingEthNow();

    bool public accepting;

    function setAccepting(bool value) external {
        accepting = value;
    }

    receive() external payable {
        if (!accepting) revert NotTakingEthNow();
    }
}
