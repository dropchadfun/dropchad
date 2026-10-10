// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";

import {DropTestBase} from "./DropTestBase.sol";
import {DropHandler} from "./DropHandler.sol";
import {DropV1} from "../src/DropV1.sol";
import {IDropV1} from "../src/IDropV1.sol";

import {MockERC20} from "./MockERC20.sol";

/// @title DropInvariantsTest
/// @notice The invariants.
/// @dev `DropHandler` calls random functions in random order with random actors, and
///      keeps ghost totals of what really moved. The assertions below never trust a number the
///      contract reports on its own where a ghost can check it.
///      **Every invariant the design is covered here or by a named unit test:**
///      | id  | where |
///      |-----|-------|
///      | | `invariant_TotalClaimedNeverExceedsEntitlements` |
///      | | `invariant_BitmapMatchesClaimedCount`, `test_RevertWhen_Claim_Twice` |
///      | | `invariant_BalanceCoversUnclaimed` |
///      | | `invariant_Conservation` |
///      | | `invariant_ImmutableFieldsNeverChange` |
///      | | `invariant_AdminCannotTouchAnExistingDrop` |
///      | | `invariant_GrossRequiredHolds` |
///      | | `test_Vector_TotalsMatchTheTree`, `testFuzz_AmountsAndRecipientCounts` |
///      | | `invariant_StatusOnlyMovesForward` |
///      | | `invariant_Conservation` |
///      | | `invariant_InitializeSucceedsExactlyOnce` |
///      | | `invariant_TerminalStatesLeaveZeroAssetBalance` |
///      | | `invariant_NoAllowanceEverGranted` |
///      | | `invariant_BitmapMatchesClaimedCount` |
///      | | `invariant_PayoutsOnlyGoToLeafRecipients` |
///      | | `invariant_ClaimDeadlineWrittenAtMostOnce` |
contract DropInvariantsTest is DropTestBase {
    DropHandler internal handler;
    DropV1 internal target;
    MockERC20 internal token;

    IDropV1.Config internal initialConfig;

    function setUp() public virtual override {
        super.setUp();

        // A non zero fee, so the fee term of the design is really exercised.
        vm.prank(owner);
        factory.setDefaultFeeBps(250);

        (target, token) = _createErc20Drop(12);
        initialConfig = target.config();

        handler =
            new DropHandler(factory, target, token, owner, refundRecipient, feeRecipient, recipients, amounts, leaves);

        targetContract(address(handler));
    }

    /// @dev `totalClaimed <= totalEntitlements` at all times.
    function invariant_TotalClaimedNeverExceedsEntitlements() public view {
        assertLe(target.totalClaimed(), target.totalEntitlements(), "I1");
    }

    /// @dev `claimedCount` equals the number of set bits, equals the number of claims
    ///      the handler actually saw succeed, and `totalClaimed` equals the sum of them.
    function invariant_BitmapMatchesClaimedCount() public view virtual {
        uint256 setBits;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (target.isClaimed(i)) setBits++;
        }

        assertEq(target.claimedCount(), setBits, "I14. claimedCount must equal the set bits");
        assertEq(target.claimedCount(), handler.ghostClaimCount(), "I14. and the claims that happened");
        assertEq(target.totalClaimed(), handler.ghostClaimedSum(), "I14. and their sum");
    }

    /// @dev While `Active`, the balance always covers what is still unclaimed.
    function invariant_BalanceCoversUnclaimed() public view {
        if (target.status() != IDropV1.Status.Active) return;
        assertGe(token.balanceOf(address(target)), target.unclaimed(), "I3");
    }

    /// @dev Every field of table 5.1 still holds the value `initialize` wrote.
    function invariant_ImmutableFieldsNeverChange() public view {
        _assertConfigUnchanged(target, initialConfig);
    }

    /// @dev `claimDeadline` is written at most once, and only by `activate`.
    function invariant_ClaimDeadlineWrittenAtMostOnce() public view {
        uint64 current = target.claimDeadline();

        if (target.activatedAt() == 0) {
            assertEq(current, 0, "zero before activation");
        } else {
            assertEq(current, target.activatedAt() + target.claimPeriod(), "");
            assertEq(current, handler.ghostFirstClaimDeadline(), "I16. it never moved after the first write");
        }
    }

    /// @dev Conservation over the whole life of the drop:
    ///      everything received is either still in the drop, paid to the crowd, paid as the fee,
    ///      or refunded. **There is no sixth path out.**
    function invariant_Conservation() public view {
        uint256 accountedFor =
            target.totalClaimed() + handler.ghostFeePaid() + handler.ghostRefunded() + token.balanceOf(address(target));

        assertEq(handler.ghostReceived(), accountedFor, "I10 and I4");
    }

    /// @dev `status` only follows the edges of, and never goes backwards.
    ///      `Finalized` is 2 and `Cancelled` is 3, and both are terminal, so once the handler has
    ///      seen a terminal value the current value must be that same one.
    function invariant_StatusOnlyMovesForward() public view {
        uint8 current = uint8(target.status());
        uint8 seen = handler.ghostMaxStatus();

        assertGe(current, seen, "I9. status never goes backwards");

        if (seen >= uint8(IDropV1.Status.Finalized)) {
            assertEq(current, seen, "I9. a terminal state is terminal");
        }
    }

    /// @dev The drop never grants an allowance, to anybody, in any state.
    function invariant_NoAllowanceEverGranted() public view virtual {
        assertEq(token.allowance(address(target), address(factory)), 0, "I13");
        assertEq(token.allowance(address(target), address(handler)), 0, "I13");
        assertEq(token.allowance(address(target), refundRecipient), 0, "I13");
        assertEq(token.allowance(address(target), feeRecipient), 0, "I13");

        for (uint256 i = 0; i < recipients.length; i++) {
            assertEq(token.allowance(address(target), recipients[i]), 0, "I13");
        }
    }

    /// @dev `grossRequired == totalEntitlements + feeAmount`, always.
    function invariant_GrossRequiredHolds() public view {
        assertEq(target.grossRequired(), target.totalEntitlements() + target.feeAmount(), "I7");
    }

    /// @dev No admin action changes any state of an already created drop.
    ///      The handler fires every factory setter at random while the drop is live.
    function invariant_AdminCannotTouchAnExistingDrop() public view {
        _assertConfigUnchanged(target, initialConfig);
        assertEq(target.implementation(), initialConfig.implementation, "");
        assertEq(target.feeRecipient(), initialConfig.feeRecipient, "");
        assertEq(target.feeAmount(), initialConfig.feeAmount, "");
    }

    /// @dev `initialize` succeeded exactly once, and can never succeed again.
    ///      The handler counts every second call that went through in a ghost, held at zero here.
    ///      A `revert` in the handler would not do: `fail_on_revert` is false in `foundry.toml`,
    ///      so a revert inside a handler action is just a call that did not happen.
    function invariant_InitializeSucceedsExactlyOnce() public view {
        assertTrue(target.initialized(), "I11");
        assertTrue(implementation.initialized(), "I11. never on the implementation");
        assertEq(handler.ghostReinitialized(), 0, "I11. initialize succeeded twice");
    }

    /// @dev After `refund` or `cancelUnfunded`, the drop asset balance is zero, **unless
    ///      value was force sent afterwards**. A plain ERC20 transfer into a finished drop cannot
    ///      be blocked by the drop, exactly like a native forced send, so the handler counts what
    ///      arrived late and the balance must equal exactly that. Nothing else may be left.
    function invariant_TerminalStatesLeaveZeroAssetBalance() public view {
        IDropV1.Status s = target.status();
        if (s != IDropV1.Status.Finalized && s != IDropV1.Status.Cancelled) return;

        assertEq(token.balanceOf(address(target)), handler.ghostReceivedAfterFinish(), "I12");
    }

    /// @dev A payout destination is always the `recipient` inside a verified leaf, and it is
    ///      never paid more than its own leaf amount. Addresses that are not in the tree are
    ///      never paid at all.
    function invariant_PayoutsOnlyGoToLeafRecipients() public view virtual {
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 balance = token.balanceOf(recipients[i]);
            if (target.isClaimed(i)) {
                assertEq(balance, amounts[i], "I15. paid exactly the leaf amount");
            } else {
                assertEq(balance, 0, "I15. not claimed, so not paid");
            }
        }

        for (uint256 i = 0; i < handler.outsiderCount(); i++) {
            assertEq(token.balanceOf(handler.outsiderAt(i)), 0, "I15. nobody outside the tree is ever paid");
        }
    }

    /// @dev Not an invariant, a report. Foundry checks every `invariant_` function after **each**
    ///      call in a sequence, so an assertion about how much has happened so far would fail on
    ///      call one. The guard against a vacuous run is `test_Handler_ReachesEveryState` below.
    function invariant_CallSummary() public view {
        console.log("fund             ", handler.calls("fund"));
        console.log("overfund         ", handler.calls("overfund"));
        console.log("activate         ", handler.calls("activate"));
        console.log("claimOne         ", handler.calls("claimOne"));
        console.log("claimBatchRandom ", handler.calls("claimBatchRandom"));
        console.log("cancelUnfunded   ", handler.calls("cancelUnfunded"));
        console.log("refund           ", handler.calls("refund"));
        console.log("warpForward      ", handler.calls("warpForward"));
        console.log("adminPoke        ", handler.calls("adminPoke"));
    }

    /// @dev The guard on the test itself. It drives the handler by hand through the whole
    ///      lifecycle, so we know the random runs above are exercising real state and not
    ///      passing because every call reverted.
    function test_Handler_ReachesEveryState() public virtual {
        _assertStatus(target, IDropV1.Status.Created);

        // Fund past `grossRequired` and activate.
        handler.overfund(target.grossRequired());
        handler.overfund(10 ether);
        handler.activate();
        _assertStatus(target, IDropV1.Status.Active);
        assertEq(handler.ghostFeePaid(), target.feeAmount(), "the fee really left");

        // Claim one on its own and a batch after it.
        handler.claimOne(0);
        handler.claimBatchRandom(0, 5);
        assertGt(target.claimedCount(), 1, "claims really happened");
        assertEq(target.claimedCount(), handler.ghostClaimCount(), "I14");

        // Close the window and refund.
        handler.warpForward(20 days);
        handler.warpForward(20 days);
        handler.refund();
        _assertStatus(target, IDropV1.Status.Finalized);

        assertEq(
            handler.ghostReceived(),
            target.totalClaimed() + handler.ghostFeePaid() + handler.ghostRefunded() + token.balanceOf(address(target)),
            "I10"
        );
        assertEq(token.balanceOf(address(target)), 0, "I12");
    }
}
