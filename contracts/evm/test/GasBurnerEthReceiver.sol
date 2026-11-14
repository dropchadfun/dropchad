// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Burns a lot of gas inside `receive`, the way a Safe or a heavy contract wallet does.
/// @dev This is the mock that proves: the drop puts **no gas cap** on a native
///      send, so a claim to a heavy contract recipient still succeeds.
contract GasBurnerEthReceiver {
    uint256 public burned;
    uint256 public received;

    /// @notice Roughly how much gas to burn per receive. 500_000 by default.
    uint256 public gasToBurn = 500_000;

    function setGasToBurn(uint256 amount) external {
        gasToBurn = amount;
    }

    receive() external payable {
        received += msg.value;

        uint256 start = gasleft();
        uint256 i;
        // Each iteration writes a fresh storage slot, which is the most expensive thing available.
        while (start - gasleft() < gasToBurn) {
            unchecked {
                ++i;
            }
            burned = i;
        }
    }
}
