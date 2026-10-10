// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IBinderRegistry} from "./IBinderRegistry.sol";
import {IDropV1} from "./IDropV1.sol";

/// @title IDropV2
/// @notice `IDropV1` plus X handle leaves. `docs/SPEC.md` 7.5, R7.17 to R7.41.
/// @dev Every V1 function, event and error keeps its signature.
interface IDropV2 is IDropV1 {
    // ---------------------------------------------------------------------
    // events, SPEC 11.1
    // ---------------------------------------------------------------------

    /// @notice R7.41. Emitted by `claimHandle` instead of `Claimed`.
    event HandleClaimed(uint256 indexed index, uint256 indexed xId, address indexed recipient, uint256 amount);

    // ---------------------------------------------------------------------
    // errors. SPEC names the rules, not these names, as in R6.11.6.
    // ---------------------------------------------------------------------

    /// @dev R7.34. `xId` is zero or does not fit 64 bits.
    error BadXId();
    /// @dev `claimHandle` with `recipient == address(0)`.
    error ZeroRecipient();
    /// @dev R7.39. The registry has no binder.
    error NoBinder();
    /// @dev R7.23. The binder is revoked; every handle claim stops, address leaves keep working.
    error BinderIsRevoked();
    /// @dev R7.36 and R7.37. The signature is malformed or not the current binder's.
    error BadBinding();
    /// @dev The constructor was given a zero registry.
    error ZeroRegistry();

    // ---------------------------------------------------------------------
    // functions
    // ---------------------------------------------------------------------

    /// @notice R7.37. Claims a handle leaf: the proof fixes who and how much, the binder's
    ///         signature fixes where. Permissionless; the relayer sends it.
    function claimHandle(
        uint256 index,
        uint256 xId,
        uint256 amount,
        address recipient,
        bytes32[] calldata proof,
        bytes calldata signature
    ) external;

    /// @notice R7.36. The EIP 712 digest the binder signs for one leaf of this drop.
    function bindingDigest(uint256 index, uint256 xId, address recipient) external view returns (bytes32);

    /// @notice R7.22. The registry every clone of this implementation reads the binder from.
    function BINDER_REGISTRY() external view returns (IBinderRegistry);
}
