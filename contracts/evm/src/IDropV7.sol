// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IBinderRegistry} from "./IBinderRegistry.sol";
import {IDropV1} from "./IDropV1.sol";

/// @title IDropV7
/// @notice Every `IDropV6` function, event and error, except the six argument `claimHandle` and
///         the three argument `bindingDigest`, which binding v2 replaces. `docs/SPEC.md` R7.85.
/// @dev Not `is IDropV6`: that would bring back the old `claimHandle` and `bindingDigest`. The
///      `IDropV2`, `IDropV3`, `IDropV5` and `IDropV6` items are declared here again with the same
///      signatures, so every selector is unchanged.
interface IDropV7 is IDropV1 {
    // ---------------------------------------------------------------------
    // events, SPEC 11.1
    // ---------------------------------------------------------------------

    /// @notice R7.41. Emitted by `claimHandle` instead of `Claimed`.
    event HandleClaimed(uint256 indexed index, uint256 indexed xId, address indexed recipient, uint256 amount);

    /// @notice R7.52. The ETH fee of a token drop, paid at `activate`.
    event NativeFeePaid(address indexed to, uint256 amount);

    /// @notice R7.52. ETH sent back to `refundRecipient` by `refund` or `cancelUnfunded`.
    event NativeReturned(address indexed to, uint256 amount);

    /// @notice R7.66 and R7.74 item 2. The ETH could not be sent back; it waits for a sweep.
    event NativeReturnFailed(address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // errors
    // ---------------------------------------------------------------------

    /// @dev R7.34. `xId` is zero or does not fit 64 bits.
    error BadXId();
    /// @dev `claimHandle` with `recipient == address(0)`.
    error ZeroRecipient();
    /// @dev R7.39. The registry has no binder.
    error NoBinder();
    /// @dev R7.23. The binder is revoked.
    error BinderIsRevoked();
    /// @dev R7.36 and R7.85. The signature is malformed or not the current binder's.
    error BadBinding();
    /// @dev R7.42. The constructor got a zero registry.
    error ZeroRegistry();
    /// @dev R7.66. A zero refund address.
    error ZeroRefundRecipient();
    /// @dev R7.66. A refund address on the refused list.
    error RefundRecipientRefused();
    /// @dev R7.74 item 1. `index >= leafCount`.
    error BadIndex();
    /// @dev R7.85 item 1.1. `block.timestamp > validUntil`.
    error BindingExpired();
    /// @dev R7.85 item 1.1. `validUntil > block.timestamp + MAX_BINDING_LIFETIME`.
    error BindingTooLong();

    // ---------------------------------------------------------------------
    // functions
    // ---------------------------------------------------------------------

    /// @notice R7.52. `initialize` with the ETH fee of a token drop. Factory only.
    function initialize(InitParams calldata p, uint256 nativeFee_) external;

    /// @notice R7.85 item 1.1. Pays a handle leaf to the address the binder signed, until
    ///         `validUntil`.
    function claimHandle(
        uint256 index,
        uint256 xId,
        uint256 amount,
        address recipient,
        uint64 validUntil,
        bytes32[] calldata proof,
        bytes calldata signature
    ) external;

    /// @notice R7.85 item 1.2. The binding v2 EIP 712 digest for this drop, R7.36.
    function bindingDigest(uint256 index, uint256 xId, address recipient, uint64 validUntil)
        external
        view
        returns (bytes32);

    /// @notice R7.85 item 1.3. The longest a binding may reach ahead of `block.timestamp`.
    function MAX_BINDING_LIFETIME() external view returns (uint256);

    /// @notice R7.22. The registry the binder is read from, live, on every handle claim.
    function BINDER_REGISTRY() external view returns (IBinderRegistry);

    /// @notice R7.52. The ETH fee of a token drop. Zero on a native drop.
    function nativeFee() external view returns (uint256);
}
