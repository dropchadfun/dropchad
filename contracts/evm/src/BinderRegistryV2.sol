// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IBinderRegistry} from "./IBinderRegistry.sol";

/// @title BinderRegistryV2
/// @notice Holds the current handle mode binder, a revoked flag and a revoke only guardian.
///         `BinderRegistry` with two step ownership and no renounce, for Robinhood mainnet.
///
/// @dev Implements `docs/SPEC.md` R7.22, R7.23, R7.39, R7.74 and R13.13, and `SECURITY.md` 3
///      "Binder".
///
///      **This file is `BinderRegistry.sol` copied line for line, with these changes and
///      nothing else:** `Ownable2Step` in place of `Ownable`, and `renounceOwnership` always
///      reverts with `RenounceDisabled` (R13.13, audit round 3 L-01 and I-03). The testnet
///      `BinderRegistry` is left as deployed.
///
///      - The binder is read **live** by every `DropV2` on every `claimHandle`, never frozen per
///        drop, so one `revoke` stops handle claims on every drop at once. Address leaves are
///        never affected: `claim` and `claimBatch` do not read this contract.
///      - The owner is the same timelock as the factory, R13.8, set in the constructor, so no
///        handover is needed, R7.74.
///      - The guardian can revoke and do nothing else, R7.23. On mainnet the same Ledger key as
///        the pause guardian of `DropFactoryV6`; both powers only stop things, R7.74.
///      - There is no function that takes a drop address. R13.1.
contract BinderRegistryV2 is IBinderRegistry, Ownable2Step {
    // `binder` and `revoked` share one slot, so `binderState` is one SLOAD.

    /// @inheritdoc IBinderRegistry
    address public binder;
    /// @inheritdoc IBinderRegistry
    bool public revoked;
    /// @inheritdoc IBinderRegistry
    address public guardian;

    /// @dev R13.13. `renounceOwnership` is turned off for good.
    error RenounceDisabled();

    /// @param owner_ the timelock. The binder starts at zero and is set with `setBinder`, SPEC
    ///        13.1 item 8.
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

    /// @notice Always reverts. R13.13: the registry can never be left without an owner.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
