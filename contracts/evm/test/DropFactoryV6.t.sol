// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {V6TestBase} from "./V6TestBase.sol";

import {DropFactoryV6} from "../src/DropFactoryV6.sol";
import {DropV1} from "../src/DropV1.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";

/// @title DropFactoryV6Test
/// @notice What `DropFactoryV6` adds to `DropFactoryV5`. item P.
///         A pause only guardian: it can pause at once, never unpause. Unpause stays with the
///         the timelock. `DropV6Parity.t.sol` runs every V1 to V5 factory suite against it.
contract DropFactoryV6Test is V6TestBase {
    address internal guardianKey = makeAddr("guardian ledger");

    function _setGuardian(address g) internal {
        vm.prank(owner);
        _v6().setPauseGuardian(g);
    }

    // -----------------------------------------------------------------------
    // setPauseGuardian item P.1
    // -----------------------------------------------------------------------

    /// @dev P.1. No guardian at the start.
    function test_V6_PauseGuardian_StartsZero() public view {
        assertEq(_v6().pauseGuardian(), address(0));
        assertFalse(_v6().paused());
    }

    /// @dev P.1. The owner sets it and the event names old and new; zero clears it.
    function test_V6_SetPauseGuardian_SetsClearsAndEmits() public {
        vm.expectEmit(false, false, false, true, address(factory));
        emit DropFactoryV6.PauseGuardianSet(address(0), guardianKey);
        _setGuardian(guardianKey);
        assertEq(_v6().pauseGuardian(), guardianKey);

        vm.expectEmit(false, false, false, true, address(factory));
        emit DropFactoryV6.PauseGuardianSet(guardianKey, address(0));
        _setGuardian(address(0));
        assertEq(_v6().pauseGuardian(), address(0));
    }

    /// @dev P.1. Only the owner names the guardian; the guardian cannot name itself again.
    function test_V6_RevertWhen_SetPauseGuardian_NotOwner() public {
        _setGuardian(guardianKey);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        _v6().setPauseGuardian(stranger);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardianKey));
        vm.prank(guardianKey);
        _v6().setPauseGuardian(stranger);
    }

    // -----------------------------------------------------------------------
    // pause item P.2
    // -----------------------------------------------------------------------

    /// @dev P.2. The guardian pauses at once, no timelock.
    function test_V6_Pause_ByGuardian() public {
        _setGuardian(guardianKey);

        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV1.PausedSet(true);
        vm.prank(guardianKey);
        _v6().pause();
        assertTrue(_v6().paused());
    }

    /// @dev P.2. The owner can use `pause` too.
    function test_V6_Pause_ByOwner() public {
        vm.prank(owner);
        _v6().pause();
        assertTrue(_v6().paused());
    }

    /// @dev P.2. Anyone else is `NotOwnerOrGuardian`, with or without a guardian set.
    function test_V6_RevertWhen_Pause_Stranger() public {
        vm.expectRevert(DropFactoryV6.NotOwnerOrGuardian.selector);
        vm.prank(stranger);
        _v6().pause();

        _setGuardian(guardianKey);
        vm.expectRevert(DropFactoryV6.NotOwnerOrGuardian.selector);
        vm.prank(stranger);
        _v6().pause();
        assertFalse(_v6().paused());
    }

    /// @dev P.1 and P.2. A replaced guardian has no power left.
    function test_V6_RevertWhen_Pause_ReplacedGuardian() public {
        _setGuardian(guardianKey);
        _setGuardian(makeAddr("new guardian"));

        vm.expectRevert(DropFactoryV6.NotOwnerOrGuardian.selector);
        vm.prank(guardianKey);
        _v6().pause();
    }

    /// @dev P.2. A second pause changes nothing and emits again.
    function test_V6_Pause_Twice() public {
        _setGuardian(guardianKey);
        vm.prank(guardianKey);
        _v6().pause();

        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV1.PausedSet(true);
        vm.prank(guardianKey);
        _v6().pause();
        assertTrue(_v6().paused());
    }

    // -----------------------------------------------------------------------
    // unpause stays with the owner item P.3
    // -----------------------------------------------------------------------

    /// @dev P.3. The guardian can never unpause, and cannot use `setPaused` at all.
    function test_V6_RevertWhen_Guardian_Unpauses() public {
        _setGuardian(guardianKey);
        vm.prank(guardianKey);
        _v6().pause();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardianKey));
        vm.prank(guardianKey);
        _v6().setPaused(false);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardianKey));
        vm.prank(guardianKey);
        _v6().setPaused(true);
        assertTrue(_v6().paused(), "still paused");
    }

    /// @dev P.3. The owner unpauses, and new drops are made again.
    function test_V6_Owner_UnpausesAfterGuardianPause() public {
        _setGuardian(guardianKey);
        vm.prank(guardianKey);
        _v6().pause();

        vm.prank(owner);
        _v6().setPaused(false);
        assertFalse(_v6().paused());

        DropV1 drop = _createNativeDrop(3);
        _assertStatus(drop, IDropV1.Status.Created);
    }

    /// @dev P.3. The guardian has no other power: every other setter refuses it.
    function test_V6_RevertWhen_Guardian_UsesAnyOtherSetter() public {
        _setGuardian(guardianKey);
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardianKey);
        vm.startPrank(guardianKey);

        vm.expectRevert(unauthorized);
        _v6().setDefaultFeeBps(1);
        vm.expectRevert(unauthorized);
        _v6().setFeeRecipient(guardianKey);
        vm.expectRevert(unauthorized);
        _v6().setCreatorAllowed(guardianKey, true);
        vm.expectRevert(unauthorized);
        _v6().setImplementation(guardianKey);
        vm.expectRevert(unauthorized);
        _v6().setTokenAllowed(guardianKey, true);
        vm.expectRevert(unauthorized);
        _v6().setMinFeePerReceiver(0);
        vm.expectRevert(unauthorized);
        _v6().setMaxFeeAmount(0);
        vm.expectRevert(unauthorized);
        _v6().transferOwnership(guardianKey);

        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // what a pause stops
    // -----------------------------------------------------------------------

    /// @dev P.2. After a guardian pause `createDrop` is `CreationPaused`.
    function test_V6_RevertWhen_CreateDrop_AfterGuardianPause() public {
        _setGuardian(guardianKey);
        vm.prank(guardianKey);
        _v6().pause();

        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        vm.expectRevert(IDropFactoryV1.CreationPaused.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev P.3. A drop made before the pause still claims and refunds.
    function test_V6_GuardianPause_ExistingDropKeepsWorking() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        _setGuardian(guardianKey);
        vm.prank(guardianKey);
        _v6().pause();

        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(recipients[0].balance, amounts[0]);

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        _assertStatus(drop, IDropV1.Status.Finalized);
    }

    // -----------------------------------------------------------------------
    // fuzz
    // -----------------------------------------------------------------------

    /// @dev P. Any caller that is neither owner nor guardian changes nothing at all.
    function testFuzz_V6_NobodyElsePausesOrNamesAGuardian(address caller, address arg) public {
        _setGuardian(guardianKey);
        vm.assume(caller != owner && caller != guardianKey);

        vm.startPrank(caller);
        vm.expectRevert();
        _v6().pause();
        vm.expectRevert();
        _v6().setPauseGuardian(arg);
        vm.expectRevert();
        _v6().setPaused(true);
        vm.stopPrank();

        assertFalse(_v6().paused());
        assertEq(_v6().pauseGuardian(), guardianKey);
    }
}
