// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDropV2} from "./IDropV2.sol";

/// @title IDropV3
/// @notice `IDropV2` plus the ETH fee of a token drop. `docs/SPEC.md` R7.52.
/// @dev Every V1 and V2 function, event and error keeps its signature.
interface IDropV3 is IDropV2 {
    // ---------------------------------------------------------------------
    // events, SPEC R7.52
    // ---------------------------------------------------------------------

    /// @notice R7.52. `activate` on a token drop sends `nativeFee` in ETH to the fee recipient.
    event NativeFeePaid(address indexed to, uint256 amount);
    /// @notice R7.52. `cancelUnfunded` or `refund` on a token drop sends the ETH back too.
    event NativeReturned(address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // functions
    // ---------------------------------------------------------------------

    /// @notice R7.52. `initialize` plus field 14 of SPEC 5.1, the ETH fee of a token drop in wei.
    ///         `DropFactoryV3` calls this one. The V1 `initialize(InitParams)` is kept and means
    ///         a `nativeFee` of zero.
    function initialize(InitParams calldata p, uint256 nativeFee_) external;

    /// @notice R7.52. The ETH fee in wei a token drop needs before it can go live. Zero on a
    ///         native drop.
    function nativeFee() external view returns (uint256);
}
