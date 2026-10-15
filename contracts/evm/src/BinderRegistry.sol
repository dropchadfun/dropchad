// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IBinderRegistry} from "./IBinderRegistry.sol";

/// @title BinderRegistry
/// @notice Holds the current handle mode binder, a revoked flag and a revoke only guardian.
///
/// @dev Implements `docs/SPEC.md` R7.22, R7.23 and R7.39, and `SECURITY.md` 3 "Binder".
///
///      - The binder is read **live** by every `DropV2` on every `claimHandle`, never frozen per
///        drop, so one `revoke` stops handle claims on every drop at once. Address leaves are
///        never affected: `claim` and `claimBatch` do not read this contract.
///      - The owner is the same timelock as the factory, R13.8. On testnet it is the dev EOA,
///        SPEC 14.
///      - The guardian can revoke and do nothing else. It is zero on testnet, R7.23.
///      - There is no function that takes a drop address. R13.1.
contract BinderRegistry is IBinderRegistry, Ownable {
    // `binder` and `revoked` share one slot, so `binderState` is one SLOAD.

    /// @inheritdoc IBinderRegistry
    address public binder;
    /// @inheritdoc IBinderRegistry
    bool public revoked;
    /// @inheritdoc IBinderRegistry
    address public guardian;

    /// @param owner_ the timelock on mainnet, the dev EOA on testnet. The binder starts at zero
    ///        and is set by the deploy script with `setBinder`, SPEC 13.1 item 8.
    constructor(address owner_) Ownable(owner_) {}

    /// @inheritdoc IBinderRegistry
    function binderState() external view returns (address binder_, bool revoked_) {
        return (binder, revoked);
    }

    /// @inheritdoc IBinderRegistry
    /// @dev Setting a binder is also how handle claims resume after a revoke, step 5 of the
    ///      leak playbook, `SECURITY.md` 3.
    function setBinder(address newBinder) external onlyOwner {
        if (newBinder == address(0)) revert ZeroAddress();

        address old = binder;
        binder = newBinder;
        revoked = false;
        emit BinderSet(old, newBinder);
    }

    /// @inheritdoc IBinderRegistry
    /// @dev Step 2 of the leak playbook. A second revoke changes nothing and emits again.
    function revoke() external {
        if (msg.sender != owner() && msg.sender != guardian) revert NotOwnerOrGuardian();

        revoked = true;
        emit BinderRevoked(msg.sender);
    }

    /// @inheritdoc IBinderRegistry
    // Zero is allowed on purpose: it means no guardian, R7.39. The owner can always revoke.
    // forge-lint: disable-next-line(missing-zero-check)
    function setGuardian(address newGuardian) external onlyOwner {
        address old = guardian;
        guardian = newGuardian;
        emit GuardianSet(old, newGuardian);
    }
}
