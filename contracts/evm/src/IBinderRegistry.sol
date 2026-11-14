// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IBinderRegistry
/// @notice The one place the handle mode binder lives. `docs/SPEC.md` R7.22, R7.23 and R7.39.
/// @dev `DropV2` holds this contract's address as an `immutable` and reads it on every
///      `claimHandle`. That read is the one read only exception to R13.7. Nothing here reads or
///      writes a drop.
interface IBinderRegistry {
    // -----------------------------------------------------------------------
    // events, SPEC 11.2
    // -----------------------------------------------------------------------

    event BinderSet(address oldBinder, address newBinder);
    event BinderRevoked(address indexed by);
    event GuardianSet(address oldGuardian, address newGuardian);

    // -----------------------------------------------------------------------
    // errors. SPEC names the rules, not these two names, as in R6.11.6.
    // -----------------------------------------------------------------------

    /// @dev `setBinder(address(0))`. R7.39.
    error ZeroAddress();
    /// @dev `revoke` from anybody but the owner or the guardian. R7.39.
    error NotOwnerOrGuardian();

    // -----------------------------------------------------------------------
    // views
    // -----------------------------------------------------------------------

    /// @notice The current binder. Zero means none, and every `claimHandle` fails. R7.39.
    function binder() external view returns (address);

    /// @notice True after `revoke`, until the next `setBinder`. R7.23.
    function revoked() external view returns (bool);

    /// @notice May call `revoke` and nothing else. Zero means none. R7.39.
    function guardian() external view returns (address);

    /// @notice `binder` and `revoked` in one call, for `claimHandle`. Both sit in one slot.
    function binderState() external view returns (address binder_, bool revoked_);

    // -----------------------------------------------------------------------
    // admin, SPEC 13.1 item 8
    // -----------------------------------------------------------------------

    /// @notice Owner only. Sets the binder and clears `revoked`. Zero reverts `ZeroAddress`.
    function setBinder(address newBinder) external;

    /// @notice Owner or guardian. Sets `revoked`, instantly. R7.23.
    function revoke() external;

    /// @notice Owner only. Zero means none; the owner can always revoke.
    function setGuardian(address newGuardian) external;
}
