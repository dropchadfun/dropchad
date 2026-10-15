// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Test} from "forge-std/Test.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {IBinderRegistry} from "../src/IBinderRegistry.sol";

/// @title BinderRegistryTest
/// @notice The binder, the revoke and the guardian.
/// @dev Each test comment names the rule it must fail on if that rule is removed.
contract BinderRegistryTest is Test {
    BinderRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal binderA = makeAddr("binderA");
    address internal binderB = makeAddr("binderB");
    address internal guardianKey = makeAddr("guardian");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        registry = new BinderRegistry(owner);
    }

    // -----------------------------------------------------------------------
    // constructor
    // -----------------------------------------------------------------------

    /// @dev Everything starts at zero: no binder means every `claimHandle` fails.
    function test_Constructor_StartsEmpty() public view {
        assertEq(registry.owner(), owner);
        assertEq(registry.binder(), address(0));
        assertFalse(registry.revoked());
        assertEq(registry.guardian(), address(0));

        (address b, bool r) = registry.binderState();
        assertEq(b, address(0));
        assertFalse(r);
    }

    /// @dev OpenZeppelin `Ownable` refuses a zero. A registry nobody can set is useless.
    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new BinderRegistry(address(0));
    }

    // -----------------------------------------------------------------------
    // setBinder
    // -----------------------------------------------------------------------

    /// @dev Sets the binder and emits old and new.
    function test_SetBinder_SetsAndEmits() public {
        vm.expectEmit(false, false, false, true, address(registry));
        emit IBinderRegistry.BinderSet(address(0), binderA);
        vm.prank(owner);
        registry.setBinder(binderA);
        assertEq(registry.binder(), binderA);

        vm.expectEmit(false, false, false, true, address(registry));
        emit IBinderRegistry.BinderSet(binderA, binderB);
        vm.prank(owner);
        registry.setBinder(binderB);
        assertEq(registry.binder(), binderB);
    }

    /// @dev A zero binder would read as "none"; setting it is refused, revoke is the stop.
    function test_SetBinder_RevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(IBinderRegistry.ZeroAddress.selector);
        registry.setBinder(address(0));
    }

    /// @dev Owner only.
    function test_SetBinder_RevertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.setBinder(binderA);
    }

    /// @dev The guardian can revoke and nothing else, so it cannot set a binder.
    function test_SetBinder_RevertsForGuardian() public {
        vm.prank(owner);
        registry.setGuardian(guardianKey);

        vm.prank(guardianKey);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardianKey));
        registry.setBinder(binderA);
    }

    /// @dev the leak playbook step 5: a new binder clears `revoked`, claims resume.
    function test_SetBinder_ClearsRevoked() public {
        vm.startPrank(owner);
        registry.setBinder(binderA);
        registry.revoke();
        assertTrue(registry.revoked());

        registry.setBinder(binderB);
        vm.stopPrank();

        (address b, bool r) = registry.binderState();
        assertEq(b, binderB);
        assertFalse(r, "setBinder must clear revoked");
    }

    // -----------------------------------------------------------------------
    // revoke
    // -----------------------------------------------------------------------

    /// @dev The owner revokes, instantly, and the event names who did it.
    function test_Revoke_ByOwner() public {
        vm.prank(owner);
        registry.setBinder(binderA);

        vm.expectEmit(true, false, false, true, address(registry));
        emit IBinderRegistry.BinderRevoked(owner);
        vm.prank(owner);
        registry.revoke();

        (address b, bool r) = registry.binderState();
        assertEq(b, binderA, "revoke keeps the binder address, only the flag moves");
        assertTrue(r);
    }

    /// @dev The guardian revokes without the owner.
    function test_Revoke_ByGuardian() public {
        vm.startPrank(owner);
        registry.setBinder(binderA);
        registry.setGuardian(guardianKey);
        vm.stopPrank();

        vm.expectEmit(true, false, false, true, address(registry));
        emit IBinderRegistry.BinderRevoked(guardianKey);
        vm.prank(guardianKey);
        registry.revoke();

        assertTrue(registry.revoked());
    }

    /// @dev Nobody else can revoke, with or without a guardian set.
    function test_Revoke_RevertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(IBinderRegistry.NotOwnerOrGuardian.selector);
        registry.revoke();

        vm.prank(owner);
        registry.setGuardian(guardianKey);

        vm.prank(stranger);
        vm.expectRevert(IBinderRegistry.NotOwnerOrGuardian.selector);
        registry.revoke();
    }

    /// @dev A second revoke changes nothing. The playbook says revoke first, and a double
    ///      revoke from two people at once must not fail either of them.
    function test_Revoke_Twice() public {
        vm.prank(owner);
        registry.revoke();
        vm.prank(owner);
        registry.revoke();
        assertTrue(registry.revoked());
    }

    /// @dev An old guardian loses the power the moment it is replaced.
    function test_Revoke_RevertsForReplacedGuardian() public {
        vm.startPrank(owner);
        registry.setGuardian(guardianKey);
        registry.setGuardian(address(0));
        vm.stopPrank();

        vm.prank(guardianKey);
        vm.expectRevert(IBinderRegistry.NotOwnerOrGuardian.selector);
        registry.revoke();
    }

    // -----------------------------------------------------------------------
    // setGuardian
    // -----------------------------------------------------------------------

    /// @dev Set, replace, clear. Zero means none and is allowed.
    function test_SetGuardian_SetsClearsAndEmits() public {
        vm.expectEmit(false, false, false, true, address(registry));
        emit IBinderRegistry.GuardianSet(address(0), guardianKey);
        vm.prank(owner);
        registry.setGuardian(guardianKey);
        assertEq(registry.guardian(), guardianKey);

        vm.expectEmit(false, false, false, true, address(registry));
        emit IBinderRegistry.GuardianSet(guardianKey, address(0));
        vm.prank(owner);
        registry.setGuardian(address(0));
        assertEq(registry.guardian(), address(0));
    }

    /// @dev Owner only.
    function test_SetGuardian_RevertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.setGuardian(stranger);
    }

    /// @dev The guardian cannot name a new guardian, or hand itself more power.
    function test_SetGuardian_RevertsForGuardian() public {
        vm.prank(owner);
        registry.setGuardian(guardianKey);

        vm.prank(guardianKey);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardianKey));
        registry.setGuardian(stranger);

        vm.prank(guardianKey);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardianKey));
        registry.transferOwnership(guardianKey);
    }

    // -----------------------------------------------------------------------
    // fuzz
    // -----------------------------------------------------------------------

    /// @dev Any caller that is neither owner nor guardian changes nothing at all.
    function testFuzz_NobodyElseChangesState(address caller, address arg) public {
        vm.startPrank(owner);
        registry.setBinder(binderA);
        registry.setGuardian(guardianKey);
        vm.stopPrank();
        vm.assume(caller != owner && caller != guardianKey);

        vm.startPrank(caller);
        vm.expectRevert();
        registry.setBinder(arg);
        vm.expectRevert();
        registry.setGuardian(arg);
        vm.expectRevert();
        registry.revoke();
        vm.stopPrank();

        (address b, bool r) = registry.binderState();
        assertEq(b, binderA);
        assertFalse(r);
        assertEq(registry.guardian(), guardianKey);
    }
}
