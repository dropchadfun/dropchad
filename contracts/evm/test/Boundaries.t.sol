// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DropTestBase} from "./DropTestBase.sol";
import {DropV1} from "../src/DropV1.sol";
import {IDropV1} from "../src/IDropV1.sol";

/// @title BoundariesTest
/// @notice The deadline boundaries of.
/// @dev Every timestamp belongs to exactly one side. There is no gap and no
///      overlap, so each boundary is asserted from both directions.
contract BoundariesTest is DropTestBase {
    // -----------------------------------------------------------------------
    // fundingDeadline. `activate` is `<=`, `cancelUnfunded` is `>`.
    // -----------------------------------------------------------------------

    /// @dev At exactly `fundingDeadline`, `activate` is allowed.
    function test_Activate_AtFundingDeadline_Succeeds() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        vm.warp(drop.fundingDeadline());
        drop.activate();

        _assertStatus(drop, IDropV1.Status.Active);
    }

    /// @dev At exactly `fundingDeadline`, `cancelUnfunded` is rejected.
    function test_Cancel_AtFundingDeadline_Reverts() public {
        DropV1 drop = _createNativeDrop(3);

        vm.warp(drop.fundingDeadline());

        vm.expectRevert(IDropV1.FundingStillOpen.selector);
        drop.cancelUnfunded();
    }

    /// @dev One second past the deadline, `activate` is rejected.
    function test_Activate_OneSecondAfterDeadline_Reverts() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        vm.warp(drop.fundingDeadline() + 1);

        vm.expectRevert(IDropV1.FundingExpired.selector);
        drop.activate();
    }

    /// @dev One second past the deadline, `cancelUnfunded` works.
    function test_Cancel_OneSecondAfterFundingDeadline_Succeeds() public {
        DropV1 drop = _createNativeDrop(3);

        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        _assertStatus(drop, IDropV1.Status.Cancelled);
    }

    // -----------------------------------------------------------------------
    // claimDeadline. `claim` is `<=`, `refund` is `>`.
    // -----------------------------------------------------------------------

    /// @dev At exactly `claimDeadline`, claims still work.
    function test_Claim_AtClaimDeadline_Succeeds() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.claimDeadline());
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertEq(recipients[0].balance, amounts[0], "");
    }

    /// @dev At exactly `claimDeadline`, `refund` is rejected.
    function test_Refund_AtClaimDeadline_Reverts() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.claimDeadline());

        vm.expectRevert(IDropV1.ClaimWindowOpen.selector);
        drop.refund();
    }

    /// @dev One second past the deadline, claims are rejected.
    function test_Claim_OneSecondAfterDeadline_Reverts() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.claimDeadline() + 1);

        vm.expectRevert(IDropV1.ClaimWindowClosed.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
    }

    /// @dev One second past the deadline, `refund` works.
    function test_Refund_OneSecondAfterClaimDeadline_Succeeds() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        _assertStatus(drop, IDropV1.Status.Finalized);
    }

    // -----------------------------------------------------------------------
    // claimBatch uses the same comparison as claim.
    // -----------------------------------------------------------------------

    function test_ClaimBatch_AtClaimDeadline_Succeeds() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        IDropV1.ClaimItem[] memory items = _batch(3);
        vm.warp(drop.claimDeadline());
        drop.claimBatch(items);

        assertEq(drop.claimedCount(), 3, "");
    }

    function test_ClaimBatch_OneSecondAfterDeadline_Reverts() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        IDropV1.ClaimItem[] memory items = _batch(3);
        vm.warp(drop.claimDeadline() + 1);

        vm.expectRevert(IDropV1.ClaimWindowClosed.selector);
        drop.claimBatch(items);
    }

    // -----------------------------------------------------------------------
    // the derived deadline itself
    // -----------------------------------------------------------------------

    /// @dev Activating exactly at the funding deadline still gives a full
    ///      `claimPeriod`, because `claimDeadline` is derived from `activatedAt`, not from
    ///      creation time.
    function test_ClaimDeadline_IsDerivedFromActivationNotCreation() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        uint64 fundingDeadline = drop.fundingDeadline();
        vm.warp(fundingDeadline);
        drop.activate();

        assertEq(drop.activatedAt(), fundingDeadline, "activated at the last possible second");
        assertEq(drop.claimDeadline(), fundingDeadline + CLAIM_PERIOD, "a full claim period");
    }

    function _batch(uint256 count) internal view returns (IDropV1.ClaimItem[] memory items) {
        items = new IDropV1.ClaimItem[](count);
        for (uint256 i = 0; i < count; i++) {
            items[i] = IDropV1.ClaimItem({index: i, recipient: recipients[i], amount: amounts[i], proof: _proof(i)});
        }
    }
}
