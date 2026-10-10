// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DropTestBase} from "./DropTestBase.sol";
import {DropV1} from "../src/DropV1.sol";
import {IDropV1} from "../src/IDropV1.sol";

import {MockERC20} from "./MockERC20.sol";

/// @title DropV1LifecycleTest
/// @notice `cancelUnfunded`, `refund`, `sweep`, `receive` and the state machine edges.
contract DropV1LifecycleTest is DropTestBase {
    // -----------------------------------------------------------------------
    // cancelUnfunded
    // -----------------------------------------------------------------------

    /// @dev A drop nobody funded still ends cleanly in `Cancelled`.
    function test_CancelUnfunded_ZeroBalance() public {
        DropV1 drop = _createNativeDrop(3);
        vm.warp(drop.fundingDeadline() + 1);

        drop.cancelUnfunded();

        _assertStatus(drop, IDropV1.Status.Cancelled);
        assertEq(refundRecipient.balance, 0, "nothing arrived, so nothing goes back");
    }

    /// @dev A partly funded drop returns everything that did arrive.
    function test_CancelUnfunded_PartialBalance() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, 1 ether);

        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        _assertStatus(drop, IDropV1.Status.Cancelled);
        assertEq(refundRecipient.balance, 1 ether, "everything that arrived went back");
        assertEq(address(drop).balance, 0, "I12");
    }

    /// @dev An overfunded drop returns everything, not just `grossRequired`.
    function test_CancelUnfunded_OverfundedBalance() public {
        DropV1 drop = _createNativeDrop(3);
        uint256 sent = drop.grossRequired() + 4 ether;
        _fundNative(drop, sent);

        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        assertEq(refundRecipient.balance, sent, "");
        assertEq(address(drop).balance, 0, "I12");
    }

    /// @dev The ERC20 path.
    function test_CancelUnfunded_Erc20() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        _fundErc20(token, drop, 2 ether);

        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        assertEq(token.balanceOf(refundRecipient), 2 ether);
        assertEq(token.balanceOf(address(drop)), 0, "I12");
    }

    /// @dev `FundingStillOpen`.
    function test_RevertWhen_CancelUnfunded_BeforeFundingDeadline() public {
        DropV1 drop = _createNativeDrop(3);

        vm.expectRevert(IDropV1.FundingStillOpen.selector);
        drop.cancelUnfunded();
    }

    /// @dev `WrongStatus`. There is no path from `Active` to `Cancelled`.
    function test_RevertWhen_CancelUnfunded_WhenActive() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.fundingDeadline() + 1);

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.cancelUnfunded();
    }

    /// @dev `Cancelled` is terminal.
    function test_RevertWhen_CancelUnfunded_Twice() public {
        DropV1 drop = _createNativeDrop(3);
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.cancelUnfunded();
    }

    /// @dev `CancelledUnfunded` carries the refund target and the amount.
    function test_CancelUnfunded_EmitsCancelledUnfunded() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, 3 ether);
        vm.warp(drop.fundingDeadline() + 1);

        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV1.CancelledUnfunded(refundRecipient, 3 ether);
        drop.cancelUnfunded();
    }

    /// @dev After cancelling, the drop asset balance is zero.
    function test_CancelUnfunded_LeavesZeroAssetBalance() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, 3 ether);
        vm.warp(drop.fundingDeadline() + 1);

        drop.cancelUnfunded();

        assertEq(drop.assetBalance(), 0, "I12");
    }

    // -----------------------------------------------------------------------
    // refund
    // -----------------------------------------------------------------------

    /// @dev Everything left goes to `refundRecipient` in one transfer.
    function test_Refund_PaysLeftoversToRefundRecipient() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        drop.claim(0, recipients[0], amounts[0], _proof(0));

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        _assertStatus(drop, IDropV1.Status.Finalized);
        assertEq(refundRecipient.balance, totalEntitlements - amounts[0], "");
        assertEq(address(drop).balance, 0, "I12");
    }

    /// @dev A fully claimed drop refunds zero and still finalizes.
    function test_Refund_ZeroLeftovers() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        for (uint256 i = 0; i < 3; i++) {
            drop.claim(i, recipients[i], amounts[i], _proof(i));
        }

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        _assertStatus(drop, IDropV1.Status.Finalized);
        assertEq(refundRecipient.balance, 0, "nothing was left");
    }

    /// @dev Unclaimed entitlements **plus** any overfunding leave together, in one
    ///      transfer, to one destination.
    function test_Refund_ReturnsUnclaimedPlusOverfunding() public {
        DropV1 drop = _createNativeDrop(3);
        uint256 extra = 9 ether;
        _fundNative(drop, drop.grossRequired() + extra);
        drop.activate();

        drop.claim(2, recipients[2], amounts[2], _proof(2));

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(refundRecipient.balance, totalEntitlements - amounts[2] + extra, "");
        assertEq(address(drop).balance, 0, "I12");
    }

    /// @dev `ClaimWindowOpen`.
    function test_RevertWhen_Refund_BeforeClaimDeadline() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.expectRevert(IDropV1.ClaimWindowOpen.selector);
        drop.refund();
    }

    /// @dev `WrongStatus`. There is no path from `Created` straight to `Finalized`.
    function test_RevertWhen_Refund_WhenCreated() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        vm.warp(block.timestamp + 365 days);

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.refund();
    }

    /// @dev `Finalized` is terminal.
    function test_RevertWhen_Refund_Twice() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.refund();
    }

    /// @dev Both `Refunded` and `Finalized` are emitted, in that order.
    function test_Refund_EmitsRefundedAndFinalized() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        uint256 leftover = totalEntitlements - amounts[0];
        vm.warp(drop.claimDeadline() + 1);

        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV1.Refunded(refundRecipient, leftover);
        vm.expectEmit(false, false, false, true, address(drop));
        emit IDropV1.Finalized(amounts[0], 1, leftover);

        drop.refund();
    }

    /// @dev After refunding, the drop asset balance is zero.
    function test_Refund_LeavesZeroAssetBalance() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        _activateErc20(token, drop);

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(drop.assetBalance(), 0, "I12");
        assertEq(token.balanceOf(refundRecipient), totalEntitlements);
    }

    /// @dev Conservation over the whole life of a drop:
    ///      received == totalClaimed + feePaid + refunded.
    function test_Refund_ConservationHolds() public {
        vm.prank(owner);
        factory.setDefaultFeeBps(300);

        DropV1 drop = _createNativeDrop(4);
        uint256 received = drop.grossRequired() + 2 ether;
        _fundNative(drop, received);
        drop.activate();

        drop.claim(0, recipients[0], amounts[0], _proof(0));
        drop.claim(2, recipients[2], amounts[2], _proof(2));

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        uint256 paidOut = recipients[0].balance + recipients[2].balance;
        assertEq(paidOut, drop.totalClaimed(), "I14");
        assertEq(received, drop.totalClaimed() + drop.feeAmount() + refundRecipient.balance, "I10");
        assertEq(feeRecipient.balance, drop.feeAmount(), "I10. the fee also left the drop");
    }

    // -----------------------------------------------------------------------
    // sweep
    // -----------------------------------------------------------------------

    /// @dev A wrong ERC20 somebody sent by mistake goes to `refundRecipient`.
    function test_Sweep_WrongErc20_GoesToRefundRecipient() public {
        DropV1 drop = _createNativeDrop(3);
        MockERC20 wrong = new MockERC20("Wrong", "WRONG", 18);
        wrong.mint(address(drop), 42 ether);

        _activateNative(drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        drop.sweep(address(wrong));

        assertEq(wrong.balanceOf(refundRecipient), 42 ether, "");
        assertEq(wrong.balanceOf(address(drop)), 0);
    }

    /// @dev Native can be swept, but only when the drop asset is an ERC20.
    function test_Sweep_Native_WhenAssetIsErc20() public virtual {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);

        // A forced send. `receive` refuses native on an ERC20 drop, so it can only arrive this way.
        vm.deal(address(drop), 3 ether);

        _activateErc20(token, drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        uint256 before = refundRecipient.balance;
        drop.sweep(address(0));

        assertEq(refundRecipient.balance - before, 3 ether, "");
        assertEq(address(drop).balance, 0);
    }

    /// @dev `CannotSweepDropAsset`. Sweep can never touch the drop asset.
    ///      That path is `refund()` and only `refund()`.
    function test_RevertWhen_Sweep_DropAsset() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        _activateErc20(token, drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        token.mint(address(drop), 1 ether); // a late arrival

        vm.expectRevert(IDropV1.CannotSweepDropAsset.selector);
        drop.sweep(address(token));
    }

    /// @dev When the drop asset is native, `address(0)` **is** the drop asset,
    ///      so sweeping it is refused by the same rule.
    function test_RevertWhen_Sweep_NativeWhenAssetIsNative() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        vm.deal(address(drop), 1 ether); // forced send after the refund

        vm.expectRevert(IDropV1.CannotSweepDropAsset.selector);
        drop.sweep(address(0));
    }

    /// @dev `NotFinished`. Only from `Finalized` or `Cancelled`.
    function test_RevertWhen_Sweep_BeforeFinished() public {
        DropV1 drop = _createNativeDrop(3);
        MockERC20 wrong = new MockERC20("Wrong", "WRONG", 18);
        wrong.mint(address(drop), 1 ether);

        vm.expectRevert(IDropV1.NotFinished.selector);
        drop.sweep(address(wrong));

        _activateNative(drop);

        vm.expectRevert(IDropV1.NotFinished.selector);
        drop.sweep(address(wrong));
    }

    /// @dev `NothingToSweep` on a zero balance.
    function test_RevertWhen_Sweep_NothingToSweep() public {
        DropV1 drop = _createNativeDrop(3);
        MockERC20 wrong = new MockERC20("Wrong", "WRONG", 18);

        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        vm.expectRevert(IDropV1.NothingToSweep.selector);
        drop.sweep(address(wrong));
    }

    /// @dev Sweeping works from `Cancelled` too, not only from `Finalized`.
    function test_Sweep_AfterCancelled() public {
        DropV1 drop = _createNativeDrop(3);
        MockERC20 wrong = new MockERC20("Wrong", "WRONG", 18);
        wrong.mint(address(drop), 7 ether);

        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        drop.sweep(address(wrong));
        assertEq(wrong.balanceOf(refundRecipient), 7 ether, "");
    }

    /// @dev `Swept` names the token, the destination and the amount.
    function test_Sweep_EmitsSwept() public {
        DropV1 drop = _createNativeDrop(3);
        MockERC20 wrong = new MockERC20("Wrong", "WRONG", 18);
        wrong.mint(address(drop), 5 ether);

        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        vm.expectEmit(true, true, false, true, address(drop));
        emit IDropV1.Swept(address(wrong), refundRecipient, 5 ether);
        drop.sweep(address(wrong));
    }

    /// @dev A wrong token never becomes an entitlement. It changes no number
    ///      in the drop, it only leaves through `sweep`.
    function test_Sweep_WrongTokenNeverBecomesAnEntitlement() public {
        DropV1 drop = _createNativeDrop(3);
        MockERC20 wrong = new MockERC20("Wrong", "WRONG", 18);
        wrong.mint(address(drop), 1000 ether);

        IDropV1.Config memory before = drop.config();
        _activateNative(drop);
        _assertConfigUnchanged(drop, before);

        assertEq(drop.totalEntitlements(), totalEntitlements, "");
        assertEq(drop.unclaimed(), totalEntitlements, "");
    }

    // -----------------------------------------------------------------------
    // receive and fallback
    // -----------------------------------------------------------------------

    /// @dev Native is accepted while the drop is `Created` and the asset is native.
    function test_Receive_NativeAcceptedWhenCreated() public {
        DropV1 drop = _createNativeDrop(3);

        _fundNative(drop, 1 ether);
        assertEq(address(drop).balance, 1 ether, "");
    }

    /// @dev `NotAcceptingNative` once the drop is `Active`.
    function test_RevertWhen_Receive_NativeWhenActive() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok, bytes memory ret) = address(drop).call{value: 1 ether}("");

        assertFalse(ok, "");
        assertEq(bytes4(ret), IDropV1.NotAcceptingNative.selector);
    }

    /// @dev `NotAcceptingNative` in a terminal state too.
    function test_RevertWhen_Receive_NativeWhenCancelled() public {
        DropV1 drop = _createNativeDrop(3);
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(drop).call{value: 1 ether}("");

        assertFalse(ok, "");
    }

    /// @dev `NotAcceptingNative` when the drop asset is an ERC20.
    function test_RevertWhen_Receive_NativeWhenAssetIsErc20() public virtual {
        (DropV1 drop,) = _createErc20Drop(3);

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok, bytes memory ret) = address(drop).call{value: 1 ether}("");

        assertFalse(ok, "");
        assertEq(bytes4(ret), IDropV1.NotAcceptingNative.selector);
    }

    /// @dev There is no `fallback`. A call with unknown calldata reverts.
    function test_RevertWhen_UnknownCalldata_NoFallback() public {
        DropV1 drop = _createNativeDrop(3);

        (bool ok,) = address(drop).call(abi.encodeWithSignature("thisDoesNotExist()"));
        assertFalse(ok, "");

        (bool okWithValue,) = address(drop).call{value: 0}(hex"deadbeef");
        assertFalse(okWithValue, "");
    }

    /// @dev A forced send cannot be blocked by any contract. Value that arrives
    ///      that way is extra balance and leaves through `refund`. It never becomes an entitlement.
    function test_ForcedSend_IsExtraBalance_LeavesThroughRefund() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        // `receive` reverts in `Active`, so this models a selfdestruct or a block reward.
        vm.deal(address(drop), address(drop).balance + 3 ether);

        assertEq(drop.totalEntitlements(), totalEntitlements, "no accounting field moved");
        assertEq(drop.unclaimed(), totalEntitlements, "");

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(refundRecipient.balance, totalEntitlements + 3 ether, "it left through refund");
        assertEq(address(drop).balance, 0, "I12");
    }

    /// @dev The invariant is stated "unless value was force sent afterwards". This is that case.
    function test_ForcedSend_AfterRefund_LeavesTheBalanceNonZero() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(address(drop).balance, 0, "I12 holds right after the refund");

        vm.deal(address(drop), 1 ether);
        assertEq(address(drop).balance, 1 ether, "I12. a later forced send is the stated exception");
    }

    // -----------------------------------------------------------------------
    // state machine
    // -----------------------------------------------------------------------

    /// @dev `activate` wants `<= fundingDeadline`, `cancelUnfunded` wants `>`. Every
    ///      timestamp satisfies exactly one of the two. They can never both be callable.
    function test_StateMachine_ActivateAndCancelAreNeverBothCallable() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());
        uint64 deadline = drop.fundingDeadline();

        // At the deadline: activate works, cancel does not.
        vm.warp(deadline);
        uint256 snap = vm.snapshotState();

        vm.expectRevert(IDropV1.FundingStillOpen.selector);
        drop.cancelUnfunded();
        drop.activate();
        _assertStatus(drop, IDropV1.Status.Active);

        vm.revertToState(snap);

        // One second later: cancel works, activate does not.
        vm.warp(deadline + 1);
        vm.expectRevert(IDropV1.FundingExpired.selector);
        drop.activate();
        drop.cancelUnfunded();
        _assertStatus(drop, IDropV1.Status.Cancelled);
    }

    /// @dev No edge exists that is not in the table of.
    ///      From `Created`, `refund` is impossible. From `Active`, `cancelUnfunded` is impossible.
    function test_StateMachine_OnlyTheFourEdgesExist() public {
        DropV1 drop = _createNativeDrop(3);

        // Created -> Finalized does not exist.
        vm.warp(block.timestamp + 400 days);
        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.refund();

        // Created -> Cancelled does.
        drop.cancelUnfunded();
        _assertStatus(drop, IDropV1.Status.Cancelled);

        // A second drop for the Active side.
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        DropV1 other = _createDrop(address(0), address(0), 1, r, a);
        _activateNative(other);

        // Active -> Cancelled does not exist.
        vm.warp(other.fundingDeadline() + 1);
        vm.expectRevert(IDropV1.WrongStatus.selector);
        other.cancelUnfunded();
    }

    /// @dev From `Finalized` or `Cancelled`, no call changes `status`.
    function test_StateMachine_TerminalStatesAreTerminal() public {
        DropV1 cancelled = _createNativeDrop(3);
        vm.warp(cancelled.fundingDeadline() + 1);
        cancelled.cancelUnfunded();

        vm.expectRevert(IDropV1.WrongStatus.selector);
        cancelled.activate();
        vm.expectRevert(IDropV1.WrongStatus.selector);
        cancelled.refund();
        vm.expectRevert(IDropV1.WrongStatus.selector);
        cancelled.cancelUnfunded();
        vm.expectRevert(IDropV1.WrongStatus.selector);
        cancelled.claim(0, recipients[0], amounts[0], _proof(0));
        _assertStatus(cancelled, IDropV1.Status.Cancelled);

        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        DropV1 finalized = _createDrop(address(0), address(0), 1, r, a);
        _activateNative(finalized);
        vm.warp(finalized.claimDeadline() + 1);
        finalized.refund();

        vm.expectRevert(IDropV1.WrongStatus.selector);
        finalized.activate();
        vm.expectRevert(IDropV1.WrongStatus.selector);
        finalized.refund();
        vm.expectRevert(IDropV1.WrongStatus.selector);
        finalized.cancelUnfunded();
        vm.expectRevert(IDropV1.WrongStatus.selector);
        finalized.claim(0, recipients[0], amounts[0], _proof(0));
        _assertStatus(finalized, IDropV1.Status.Finalized);
    }

    /// @dev If dropchad disappears, every drop can still be run by anybody, forever.
    ///      This whole test is driven by `stranger`, with no dropchad involvement at all.
    function test_StateMachine_AnyoneCanRunADropToTheEnd() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        vm.startPrank(stranger);
        drop.activate();
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        vm.stopPrank();

        _assertStatus(drop, IDropV1.Status.Finalized);
        assertEq(recipients[0].balance, amounts[0], "");
    }
}
