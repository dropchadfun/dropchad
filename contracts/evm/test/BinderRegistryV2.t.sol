// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {BinderRegistryTest} from "./BinderRegistry.t.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {BinderRegistryV2} from "../src/BinderRegistryV2.sol";

/// @title BinderRegistryV2Test
/// @notice `BinderRegistryV2`. Every `BinderRegistryTest` runs
///         here again on the new registry, then what it adds: `Ownable2Step`, and
///         `renounceOwnership` always reverts with `RenounceDisabled`.
contract BinderRegistryV2Test is BinderRegistryTest {
    function _newRegistry(address owner_) internal override returns (BinderRegistry) {
        return BinderRegistry(address(new BinderRegistryV2(owner_)));
    }

    function _v2() internal view returns (BinderRegistryV2) {
        return BinderRegistryV2(address(registry));
    }

    // -----------------------------------------------------------------------
    // the constructor owner
    // -----------------------------------------------------------------------

    /// @dev The timelock is the owner from the constructor: nothing waits to be accepted.
    function test_V2_Constructor_OwnerAtOnce() public view {
        assertEq(_v2().owner(), owner);
        assertEq(_v2().pendingOwner(), address(0));
    }

    // -----------------------------------------------------------------------
    // Ownable2Step
    // -----------------------------------------------------------------------

    /// @dev A transfer only names the next; the old one stays until it is accepted.
    function test_V2_TransferOwnership_IsTwoStep() public {
        address next = makeAddr("next owner");
        vm.prank(owner);
        _v2().transferOwnership(next);

        assertEq(_v2().owner(), owner, "still the old owner");
        assertEq(_v2().pendingOwner(), next, "the next owner waits");
    }

    /// @dev Only the named next owner can accept.
    function test_V2_RevertWhen_AcceptOwnership_NotThePendingOwner() public {
        vm.prank(owner);
        _v2().transferOwnership(makeAddr("next owner"));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        _v2().acceptOwnership();
        assertEq(_v2().owner(), owner);
    }

    /// @dev After the accept the new owner sets the binder and the old one is out.
    function test_V2_AcceptOwnership_MovesOwnership() public {
        address next = makeAddr("next owner");
        vm.prank(owner);
        _v2().transferOwnership(next);
        vm.prank(next);
        _v2().acceptOwnership();

        assertEq(_v2().owner(), next);
        assertEq(_v2().pendingOwner(), address(0));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vm.prank(owner);
        _v2().setBinder(binderA);

        vm.prank(next);
        _v2().setBinder(binderA);
        assertEq(_v2().binder(), binderA);
    }

    // -----------------------------------------------------------------------
    // no renounce
    // -----------------------------------------------------------------------

    /// @dev The owner cannot renounce.
    function test_V2_RevertWhen_RenounceOwnership_ByOwner() public {
        vm.expectRevert(BinderRegistryV2.RenounceDisabled.selector);
        vm.prank(owner);
        _v2().renounceOwnership();
        assertEq(_v2().owner(), owner, "the owner stays");
    }

    /// @dev Always reverts, whoever calls.
    function test_V2_RevertWhen_RenounceOwnership_ByStranger() public {
        vm.expectRevert(BinderRegistryV2.RenounceDisabled.selector);
        vm.prank(stranger);
        _v2().renounceOwnership();
    }

    /// @dev A pending transfer does not open a way to renounce either.
    function test_V2_RevertWhen_RenounceOwnership_WhileTransferPending() public {
        address next = makeAddr("next owner");
        vm.prank(owner);
        _v2().transferOwnership(next);

        vm.expectRevert(BinderRegistryV2.RenounceDisabled.selector);
        vm.prank(owner);
        _v2().renounceOwnership();
        assertEq(_v2().owner(), owner);
        assertEq(_v2().pendingOwner(), next, "the pending transfer stays");
    }

    /// @dev The guardian can revoke, but cannot renounce or take the owner.
    function test_V2_RevertWhen_Guardian_RenouncesOrTakesOwner() public {
        vm.prank(owner);
        _v2().setGuardian(guardianKey);

        vm.expectRevert(BinderRegistryV2.RenounceDisabled.selector);
        vm.prank(guardianKey);
        _v2().renounceOwnership();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardianKey));
        vm.prank(guardianKey);
        _v2().acceptOwnership();
        assertEq(_v2().owner(), owner);
    }
}
