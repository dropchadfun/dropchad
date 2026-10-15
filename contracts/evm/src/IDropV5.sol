// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDropV3} from "./IDropV3.sol";

/// @title IDropV5
/// @notice `IDropV3` plus audit L1 and the refund address check. `docs/SPEC.md` R7.66.
/// @dev Every V1, V2 and V3 function, event and error keeps its signature.
interface IDropV5 is IDropV3 {
    // ---------------------------------------------------------------------
    // events, SPEC 11.1 and R7.66
    // ---------------------------------------------------------------------

    /// @notice R7.66. `cancelUnfunded` or `refund` on a token drop could not send the ETH back:
    ///         the refund address rejected it. The ETH waits in the drop for `sweep(address(0))`.
    event NativeReturnFailed(address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // errors, R7.66
    // ---------------------------------------------------------------------

    /// @dev R7.66 and R6.1.6. `initialize` with a zero refund address.
    error ZeroRefundRecipient();
    /// @dev R7.66. The refund address is the drop, the factory, the implementation, the registry,
    ///      or the token of a token drop: the drop could never pay it.
    error RefundRecipientRefused();
}
