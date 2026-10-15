// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Reverts on any native transfer in.
/// @dev Expected: that one claim reverts with `NativeTransferFailed`,
///      the bit is rolled back with it, and every other claim is unaffected.
contract RejectingEthReceiver {
    error IDoNotWantYourMoney();

    receive() external payable {
        revert IDoNotWantYourMoney();
    }
}
