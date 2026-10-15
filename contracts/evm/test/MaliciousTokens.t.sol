// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {DropTestBase} from "./DropTestBase.sol";
import {DropV1} from "../src/DropV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";

import {BlacklistERC20} from "./BlacklistERC20.sol";
import {FalseReturnERC20} from "./FalseReturnERC20.sol";
import {FeeOnTransferERC20} from "./FeeOnTransferERC20.sol";
import {GasBurnerEthReceiver} from "./GasBurnerEthReceiver.sol";
import {MockERC20} from "./MockERC20.sol";
import {NoReturnERC20} from "./NoReturnERC20.sol";
import {RebasingERC20} from "./RebasingERC20.sol";
import {ReentrantERC20} from "./ReentrantERC20.sol";
import {ReentrantEthReceiver} from "./ReentrantEthReceiver.sol";
import {RejectingEthReceiver} from "./RejectingEthReceiver.sol";

/// @title MaliciousTokensTest
/// @notice The badly behaved token and recipient mocks of.
/// @dev One test per row of the 15.5 table. Most rows prove a defence works. One row
///      deliberately **documents a break** that only the launchpad allowlist can stop.
contract MaliciousTokensTest is DropTestBase {
    // -----------------------------------------------------------------------
    // token mocks
    // -----------------------------------------------------------------------

    /// @dev `ReentrantERC20` calls back into `claim` from inside `transfer`.
    ///      The reentry reverts on `nonReentrant`, the bit is already set, no double payout.
    function test_ReentrantErc20_ReentryReverts_NoDoublePayout() public {
        ReentrantERC20 token = new ReentrantERC20();
        DropV1 drop = _createTokenDrop(address(token), 3);

        token.mint(address(drop), drop.grossRequired());
        drop.activate();

        // While paying index 0, the token tries to claim index 1 as well.
        token.setReentry(address(drop), abi.encodeCall(IDropV1.claim, (1, recipients[1], amounts[1], _proof(1))));

        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertTrue(token.attempted(), "the token really tried to reenter");
        assertFalse(token.reentrySucceeded(), "T4. nonReentrant refused it");

        assertEq(token.balanceOf(recipients[0]), amounts[0], "index 0 was paid once");
        assertEq(token.balanceOf(recipients[1]), 0, "index 1 was not paid by the reentry");
        assertTrue(drop.isClaimed(0), "the bit was set before the transfer");
        assertFalse(drop.isClaimed(1), "I2");
        assertEq(drop.claimedCount(), 1, "I14. no double count");
        assertEq(drop.totalClaimed(), amounts[0], "I1");
    }

    /// @dev `FalseReturnERC20` returns false without reverting. `SafeERC20` reverts
    ///      and the whole claim rolls back, bit included.
    function test_RevertWhen_FalseReturnErc20_Claim() public {
        FalseReturnERC20 token = new FalseReturnERC20();
        DropV1 drop = _createTokenDrop(address(token), 3);

        token.mint(address(drop), drop.grossRequired());
        drop.activate();

        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertFalse(drop.isClaimed(0), "the bit rolled back with the revert");
        assertEq(drop.claimedCount(), 0, "I14");
    }

    /// @dev `NoReturnERC20` returns no data at all, like old USDT.
    ///      `SafeERC20` handles it and the claim goes through.
    function test_NoReturnErc20_ClaimSucceeds() public {
        NoReturnERC20 token = new NoReturnERC20();
        DropV1 drop = _createTokenDrop(address(token), 3);

        token.mint(address(drop), drop.grossRequired());
        drop.activate();

        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertEq(token.balanceOf(recipients[0]), amounts[0], "");
        assertTrue(drop.isClaimed(0));
    }

    /// @dev `FeeOnTransferERC20` delivers less than was sent, so the balance is
    ///      short and `activate` reverts with `Underfunded`. **This is the whole enforcement path
    ///      for taxed tokens.** There is no pre check and no probing.
    function test_RevertWhen_FeeOnTransferErc20_Activate_Underfunded() public {
        FeeOnTransferERC20 token = new FeeOnTransferERC20();
        DropV1 drop = _createTokenDrop(address(token), 3);

        // The funder sends exactly `grossRequired`, but 2% is eaten on the way in.
        uint256 gross = drop.grossRequired();
        token.mint(funder, gross);
        vm.prank(funder);
        token.transfer(address(drop), gross);

        assertLt(token.balanceOf(address(drop)), gross, "the tax really bit");

        vm.expectRevert(IDropV1.Underfunded.selector);
        drop.activate();
    }

    /// @dev Nobody tops the drop up, so `cancelUnfunded` returns what did arrive.
    ///      The money is never stuck.
    function test_FeeOnTransferErc20_CancelUnfundedReturnsFunds() public {
        FeeOnTransferERC20 token = new FeeOnTransferERC20();
        DropV1 drop = _createTokenDrop(address(token), 3);

        uint256 gross = drop.grossRequired();
        token.mint(funder, gross);
        vm.prank(funder);
        token.transfer(address(drop), gross);

        uint256 arrived = token.balanceOf(address(drop));

        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        _assertStatus(drop, IDropV1.Status.Cancelled);
        // The refund transfer is taxed too, so the recipient gets 98% of what was in the drop.
        assertGt(token.balanceOf(refundRecipient), 0, "the funds came back");
        assertEq(token.balanceOf(address(drop)), 0, "I12. the drop is empty");
        assertEq(arrived, (gross * 98) / 100, "the mock really takes 2%");
    }

    /// @dev **This test documents a break, it does not prove a defence.**
    ///      A rebasing token shrinks after activation. The drop balance stops covering the
    ///      unclaimed entitlements and the design fails. Nothing inside `DropV1` can prevent that: the
    ///      contract never reads a balance to derive an entitlement, so it cannot even notice.
    ///      The only defence is the launchpad allowlist. Pons is ruled out by source
    ///      review. If a launchpad ever ships a rebasing token, the fix is to remove that
    ///      launchpad from the allowlist for future drops.
    function test_RebasingErc20_DocumentsTheBreak() public {
        RebasingERC20 token = new RebasingERC20();
        DropV1 drop = _createTokenDrop(address(token), 3);

        token.mint(address(drop), drop.grossRequired());
        drop.activate();

        assertGe(token.balanceOf(address(drop)), drop.unclaimed(), "I3 holds before the rebase");

        // Every balance halves.
        token.rebase(token.ONE() / 2);

        assertLt(
            token.balanceOf(address(drop)),
            drop.unclaimed(),
            "I3 is broken by the rebase. The allowlist is the only defence"
        );

        // The early claimers are still paid in full, the last one cannot be.
        drop.claim(2, recipients[2], amounts[2], _proof(2));
        assertEq(token.balanceOf(recipients[2]), amounts[2], "the early claimer got the full amount");

        vm.expectRevert(); // the drop simply runs out of token
        drop.claim(1, recipients[1], amounts[1], _proof(1));
    }

    /// @dev `BlacklistERC20` blocks one recipient. That claim reverts, every other
    ///      claim still works, and the blocked amount leaves through `refund` later.
    function test_BlacklistErc20_OneRecipientBlocked_OthersStillClaim() public {
        BlacklistERC20 token = new BlacklistERC20();
        DropV1 drop = _createTokenDrop(address(token), 3);

        token.mint(address(drop), drop.grossRequired());
        drop.activate();

        token.setBlacklisted(recipients[1], true);

        vm.expectRevert(abi.encodeWithSelector(BlacklistERC20.Blacklisted.selector, recipients[1]));
        drop.claim(1, recipients[1], amounts[1], _proof(1));

        // Everybody else is unaffected.
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        drop.claim(2, recipients[2], amounts[2], _proof(2));

        assertEq(token.balanceOf(recipients[0]), amounts[0]);
        assertEq(token.balanceOf(recipients[2]), amounts[2]);
        assertFalse(drop.isClaimed(1), "the blocked claim left no bit behind");

        // And the blocked share is not stuck in the drop forever.
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        assertEq(token.balanceOf(refundRecipient), amounts[1], "T12. it goes back to the sender");
    }

    // -----------------------------------------------------------------------
    // native recipient mocks
    // -----------------------------------------------------------------------

    /// @dev `ReentrantEthReceiver` calls back into `claim` from `receive`.
    ///      The reentry reverts, there is no double payout.
    function test_ReentrantEthReceiver_ReentryReverts_NoDoublePayout() public {
        ReentrantEthReceiver attacker = new ReentrantEthReceiver();

        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = address(attacker);
        r[1] = address(uint160(0x4002));
        a[0] = 1 ether;
        a[1] = 2 ether;

        DropV1 drop = _createNativeDropFor(r, a);
        _activateNative(drop);

        uint256 idx = _indexOf(address(attacker));
        attacker.setReentry(
            address(drop), abi.encodeCall(IDropV1.claim, (idx, address(attacker), amounts[idx], _proof(idx)))
        );

        drop.claim(idx, address(attacker), amounts[idx], _proof(idx));

        assertTrue(attacker.attempted(), "the attacker really tried");
        assertFalse(attacker.reentrySucceeded(), "T4. nonReentrant refused it");
        assertEq(address(attacker).balance, amounts[idx], "paid exactly once");
        assertEq(drop.claimedCount(), 1, "I14");
        assertEq(drop.totalClaimed(), amounts[idx], "I1");
    }

    /// @dev `RejectingEthReceiver` reverts on receive, so that one claim reverts with
    ///      `NativeTransferFailed` and its bit is rolled back with it.
    function test_RevertWhen_RejectingEthReceiver_Claim() public {
        (DropV1 drop, uint256 idx) = _dropWithRejector();

        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.claim(idx, recipients[idx], amounts[idx], _proof(idx));

        assertFalse(drop.isClaimed(idx), "the bit rolled back");
        assertEq(drop.claimedCount(), 0, "I14");
    }

    /// @dev One failing recipient never blocks anybody else, and the money is not lost:
    ///      it goes back to the sender at the deadline.
    function test_RejectingEthReceiver_OtherClaimsUnaffected() public {
        (DropV1 drop, uint256 idx) = _dropWithRejector();

        for (uint256 i = 0; i < recipients.length; i++) {
            if (i == idx) continue;
            drop.claim(i, recipients[i], amounts[i], _proof(i));
            assertEq(recipients[i].balance, amounts[i], "everybody else is paid");
        }

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        assertEq(refundRecipient.balance, amounts[idx], "T12. the unpayable share goes back");
    }

    /// @dev **This is the test that proves there is no gas cap.**
    ///      `GasBurnerEthReceiver` burns 500k gas inside `receive` and the claim still succeeds.
    ///      A gas cap here would break Safe wallets and every contract recipient.
    function test_GasBurnerEthReceiver_ClaimStillSucceeds() public {
        GasBurnerEthReceiver burner = new GasBurnerEthReceiver();

        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = address(burner);
        r[1] = address(uint160(0x5002));
        a[0] = 1 ether;
        a[1] = 2 ether;

        DropV1 drop = _createNativeDropFor(r, a);
        _activateNative(drop);

        uint256 idx = _indexOf(address(burner));
        drop.claim(idx, address(burner), amounts[idx], _proof(idx));

        assertEq(address(burner).balance, amounts[idx], "no gas cap, so it was paid");
        assertGt(burner.burned(), 0, "the receiver really burned gas");
    }

    /// @dev One failing native send reverts the whole batch. The relayer retries
    ///      without that recipient.
    function test_RevertWhen_ClaimBatch_ContainsRejectingEthReceiver() public {
        (DropV1 drop, uint256 idx) = _dropWithRejector();

        IDropV1.ClaimItem[] memory all = new IDropV1.ClaimItem[](recipients.length);
        for (uint256 i = 0; i < recipients.length; i++) {
            all[i] = IDropV1.ClaimItem(i, recipients[i], amounts[i], _proof(i));
        }

        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.claimBatch(all);

        assertEq(drop.claimedCount(), 0, "the whole batch rolled back");

        // The retry, without the bad one.
        IDropV1.ClaimItem[] memory good = new IDropV1.ClaimItem[](recipients.length - 1);
        uint256 k;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (i == idx) continue;
            good[k++] = IDropV1.ClaimItem(i, recipients[i], amounts[i], _proof(i));
        }
        drop.claimBatch(good);

        assertEq(drop.claimedCount(), recipients.length - 1, "the retry went through");
    }

    // -----------------------------------------------------------------------
    // the rules that hold whatever the token does
    // -----------------------------------------------------------------------

    /// @dev `approve` appears nowhere in `DropV1`, so it can never grant an allowance,
    ///      in any state, to anybody.
    function test_NoAllowanceIsEverGranted() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        _activateErc20(token, drop);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(token.allowance(address(drop), stranger), 0, "I13");
        assertEq(token.allowance(address(drop), address(factory)), 0, "I13");
        assertEq(token.allowance(address(drop), refundRecipient), 0, "I13");
        assertEq(token.allowance(address(drop), recipients[0]), 0, "I13");
    }

    /// @dev One asset per drop. Any other token that arrives is not an entitlement and
    ///      changes no number in the drop. It only leaves through `sweep`.
    function test_WrongTokenNeverBecomesAnEntitlement() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);

        MockERC20 wrong = new MockERC20("Wrong", "WRONG", 18);
        wrong.mint(address(drop), 1_000_000 ether);

        IDropV1.Config memory before = drop.config();
        _activateErc20(token, drop);

        _assertConfigUnchanged(drop, before);
        assertEq(drop.assetBalance(), drop.totalEntitlements(), "only the drop asset counts");
        assertEq(drop.unclaimed(), totalEntitlements, "");
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// @dev Creates a drop over `token`, allowlisting it first through a generic adapter.
    function _createTokenDrop(address token, uint256 n) internal returns (DropV1) {
        address tokenFactory = _allowToken(token);
        (address[] memory r, uint256[] memory a) = _defaultCrowd(n);
        return _createDrop(token, tokenFactory, 0, r, a);
    }

    /// @dev A live native drop with a `RejectingEthReceiver` somewhere in the crowd.
    function _dropWithRejector() internal returns (DropV1 drop, uint256 idx) {
        address rejector = address(new RejectingEthReceiver());

        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        r[0] = address(uint160(0x6001));
        r[1] = rejector;
        r[2] = address(uint160(0x6003));
        a[0] = 1 ether;
        a[1] = 2 ether;
        a[2] = 3 ether;

        drop = _createNativeDropFor(r, a);
        _activateNative(drop);
        idx = _indexOf(rejector);
    }

    function _indexOf(address recipient) internal view returns (uint256) {
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == recipient) return i;
        }
        revert("recipient not in the crowd");
    }
}
