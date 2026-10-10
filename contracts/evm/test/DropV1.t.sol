// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Vm} from "forge-std/Vm.sol";

import {DropTestBase} from "./DropTestBase.sol";
import {DropV1} from "../src/DropV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";

import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {ReentrantEthReceiver} from "./ReentrantEthReceiver.sol";
import {RejectingEthReceiver} from "./RejectingEthReceiver.sol";

/// @title DropV1Test
/// @notice `initialize`, `activate`, `claim`, `claimBatch` and the views.
/// @dev Each test comment names the rule it must fail on if that rule is removed.
contract DropV1Test is DropTestBase {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// @dev Every field of table 5.1 is written, and it matches what the factory passed.
    function test_Initialize_WritesEveryFieldOfTable51() public {
        vm.prank(owner);
        factory.setDefaultFeeBps(100);

        DropV1 drop = _createNativeDrop(3);
        IDropV1.Config memory c = drop.config();

        assertEq(c.asset, address(0), "1. asset");
        assertEq(c.merkleRoot, root, "2. merkleRoot");
        assertEq(c.manifestHash, MANIFEST_HASH, "3. manifestHash");
        assertEq(c.totalEntitlements, totalEntitlements, "4. totalEntitlements");
        assertEq(c.grossRequired, totalEntitlements + c.feeAmount, "5. grossRequired");
        assertEq(c.feeAmount, (totalEntitlements * 100) / 10_000, "6. feeAmount");
        assertEq(c.feeRecipient, feeRecipient, "7. feeRecipient");
        assertEq(c.refundRecipient, refundRecipient, "8. refundRecipient");
        assertEq(c.fundingDeadline, uint64(block.timestamp) + FUNDING_PERIOD, "9. fundingDeadline");
        assertEq(c.claimPeriod, CLAIM_PERIOD, "10. claimPeriod");
        assertEq(c.implementation, address(implementation), "11. implementation");
        assertEq(c.creatorCommitment, _commitment(0), "12. creatorCommitment");
        assertEq(c.leafCount, 3, "13. leafCount");
    }

    /// @dev `initialized` goes true, `status` is `Created`.
    ///      `Created` is zero, the same as a fresh clone, which is exactly why the flag exists.
    function test_Initialize_SetsStatusCreatedAndInitializedFlag() public {
        DropV1 drop = _createNativeDrop(3);

        assertTrue(drop.initialized(), "I11");
        _assertStatus(drop, IDropV1.Status.Created);
        assertEq(uint8(IDropV1.Status.Created), 0, "Created is the zero value");
    }

    /// @dev Before activation both `claimDeadline` and `activatedAt` are zero.
    function test_Initialize_ClaimDeadlineAndActivatedAtAreZero() public {
        DropV1 drop = _createNativeDrop(3);

        assertEq(drop.claimDeadline(), 0, "");
        assertEq(drop.activatedAt(), 0, "");
    }

    /// @dev `initialize` emits nothing. `DropCreated` from the factory covers it.
    function test_Initialize_EmitsNoEvent() public {
        bytes32 salt = keccak256("standalone clone");
        address clone = Clones.cloneDeterministic(address(implementation), salt);

        vm.recordLogs();
        DropV1(payable(clone)).initialize(_initParams(salt));

        assertEq(vm.getRecordedLogs().length, 0, "initialize must emit nothing");
    }

    /// @dev `AlreadyInitialized` on a second call.
    function test_RevertWhen_Initialize_CalledTwice() public {
        bytes32 salt = keccak256("twice");
        address clone = Clones.cloneDeterministic(address(implementation), salt);

        DropV1(payable(clone)).initialize(_initParams(salt));

        vm.expectRevert(IDropV1.AlreadyInitialized.selector);
        DropV1(payable(clone)).initialize(_initParams(salt));
    }

    /// @dev `OnlyFactory`. The caller did not deploy this clone, so the CREATE2 address
    ///      it recomputes from `(implementation, salt, msg.sender)` is not this address.
    function test_RevertWhen_Initialize_CallerIsNotTheDeployingFactory() public {
        bytes32 salt = keccak256("wrong caller");
        address clone = Clones.cloneDeterministic(address(implementation), salt);

        vm.expectRevert(IDropV1.OnlyFactory.selector);
        vm.prank(stranger);
        DropV1(payable(clone)).initialize(_initParams(salt));
    }

    /// @dev The right caller with the **wrong salt** also fails, because the recomputed
    ///      address does not match either.
    function test_RevertWhen_Initialize_WrongSalt() public {
        bytes32 salt = keccak256("right salt");
        address clone = Clones.cloneDeterministic(address(implementation), salt);

        vm.expectRevert(IDropV1.OnlyFactory.selector);
        DropV1(payable(clone)).initialize(_initParams(keccak256("some other salt")));
    }

    /// @dev The implementation sets `initialized` in its own constructor, so it
    ///      can never be initialized, by anybody, ever.
    function test_RevertWhen_Initialize_OnTheImplementation() public {
        assertTrue(implementation.initialized(), "the implementation ships initialized");

        vm.expectRevert(IDropV1.AlreadyInitialized.selector);
        implementation.initialize(_initParams(bytes32(0)));
    }

    /// @dev The implementation holds no funds and has no.
    function test_Implementation_HoldsNothing() public view {
        assertEq(address(implementation).balance, 0, "");
        assertEq(implementation.totalEntitlements(), 0, "");
        assertEq(uint8(implementation.status()), uint8(IDropV1.Status.Created), "");
    }

    // -----------------------------------------------------------------------
    // activate
    // -----------------------------------------------------------------------

    /// @dev Exactly `grossRequired` is enough.
    function test_Activate_ExactGrossRequired_Succeeds() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        drop.activate();

        _assertStatus(drop, IDropV1.Status.Active);
        assertEq(drop.activatedAt(), uint64(block.timestamp));
    }

    /// @dev `Underfunded`. One wei short is short.
    function test_RevertWhen_Activate_OneWeiShort() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired() - 1);

        vm.expectRevert(IDropV1.Underfunded.selector);
        drop.activate();

        _assertStatus(drop, IDropV1.Status.Created);
    }

    /// @dev The check is `>=`. Extra is extra, it never becomes an entitlement.
    function test_Activate_Overfunded_Succeeds_EntitlementsUnchanged() public {
        DropV1 drop = _createNativeDrop(3);
        uint256 extra = 5 ether;
        _fundNative(drop, drop.grossRequired() + extra);

        drop.activate();

        _assertStatus(drop, IDropV1.Status.Active);
        assertEq(drop.totalEntitlements(), totalEntitlements, "entitlements do not move");
        assertEq(drop.grossRequired(), totalEntitlements, "grossRequired does not move");
        assertEq(address(drop).balance, totalEntitlements + extra, "the extra is just sitting there");
    }

    /// @dev `WrongStatus` when the drop is not `Created`.
    function test_RevertWhen_Activate_WrongStatus() public {
        DropV1 drop = _createNativeDrop(3);
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.activate();
    }

    /// @dev A second `activate` finds `Active` and reverts. All state is written before
    ///      the fee transfer, so a reentering call sees `Active` too.
    function test_RevertWhen_Activate_Twice() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.activate();
    }

    /// @dev `FundingExpired`. A very late activation is not allowed, ever, even
    ///      when the money is sitting right there.
    function test_RevertWhen_Activate_AfterFundingDeadline() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        vm.warp(drop.fundingDeadline() + 1);

        vm.expectRevert(IDropV1.FundingExpired.selector);
        drop.activate();
    }

    /// @dev The fee is taken once, at activation, and goes to `feeRecipient`.
    function test_Activate_PaysFeeToFeeRecipient() public {
        vm.prank(owner);
        factory.setDefaultFeeBps(500);

        DropV1 drop = _createNativeDrop(3);
        uint256 fee = drop.feeAmount();
        assertGt(fee, 0, "the fee path must really be exercised");

        _fundNative(drop, drop.grossRequired());
        drop.activate();

        assertEq(feeRecipient.balance, fee, "");
        assertEq(address(drop).balance, drop.totalEntitlements(), "I3. what is left covers the crowd");
    }

    /// @dev The ERC20 fee path.
    function test_Activate_PaysFeeToFeeRecipient_Erc20() public {
        vm.prank(owner);
        factory.setDefaultFeeBps(500);

        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        uint256 fee = drop.feeAmount();

        _fundErc20(token, drop, drop.grossRequired());
        drop.activate();

        assertEq(token.balanceOf(feeRecipient), fee, "");
        assertEq(token.balanceOf(address(drop)), drop.totalEntitlements(), "I3");
    }

    /// @dev v1 runs at zero fee, so nothing moves at activation.
    function test_Activate_ZeroFee_NoTransfer() public {
        DropV1 drop = _createNativeDrop(3);
        assertEq(drop.feeAmount(), 0, "");

        _fundNative(drop, drop.grossRequired());
        drop.activate();

        assertEq(feeRecipient.balance, 0, "nothing is sent at a zero fee");
        assertEq(address(drop).balance, drop.totalEntitlements());
    }

    /// @dev If the fee transfer fails, the whole activation reverts and the drop stays
    ///      `Created`, so it can still be cancelled after the funding deadline.
    function test_RevertWhen_Activate_FeeTransferFails() public {
        address rejector = address(new RejectingEthReceiver());

        vm.startPrank(owner);
        factory.setFeeRecipient(rejector);
        factory.setDefaultFeeBps(500);
        vm.stopPrank();

        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.activate();

        _assertStatus(drop, IDropV1.Status.Created);

        // It can still be cancelled, so the money is never stuck.
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();
        _assertStatus(drop, IDropV1.Status.Cancelled);
        assertEq(address(drop).balance, 0, "I12");
    }

    /// @dev `claimDeadline` is derived once, from `activatedAt + claimPeriod`.
    function test_Activate_WritesClaimDeadlineOnce() public {
        DropV1 drop = _createNativeDrop(3);
        assertEq(drop.claimDeadline(), 0, "");

        _activateNative(drop);
        uint64 deadline = drop.claimDeadline();
        assertEq(deadline, drop.activatedAt() + CLAIM_PERIOD, "");

        // Nothing after activation can write it again. Every other entry point is tried.
        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.activate();

        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(drop.claimDeadline(), deadline, "I16. claim must not move it");

        vm.warp(deadline + 1);
        drop.refund();
        assertEq(drop.claimDeadline(), deadline, "I16. refund must not move it");
    }

    /// @dev `Activated` carries the derived `claimDeadline`, so the indexer knows the
    ///      claim window without reading storage.
    function test_Activate_EmitsActivated() public {
        vm.prank(owner);
        factory.setDefaultFeeBps(500);

        DropV1 drop = _createNativeDrop(3);
        uint256 gross = drop.grossRequired();
        _fundNative(drop, gross);

        vm.expectEmit(false, false, false, true, address(drop));
        emit IDropV1.Activated(uint64(block.timestamp), gross, uint64(block.timestamp) + CLAIM_PERIOD, drop.feeAmount());
        drop.activate();
    }

    /// @dev native branch. The balance read is `address(this).balance`.
    function test_Activate_Native_ReadsContractBalance() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        assertEq(drop.assetBalance(), address(drop).balance, "native");
        drop.activate();
        _assertStatus(drop, IDropV1.Status.Active);
    }

    /// @dev ERC20 branch. The balance read is `IERC20(asset).balanceOf(address(this))`,
    ///      and the drop native balance is irrelevant to it.
    function test_Activate_Erc20_ReadsTokenBalance() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);

        // Native sitting in the drop must not count towards an ERC20 activation.
        vm.deal(address(drop), 100 ether);

        vm.expectRevert(IDropV1.Underfunded.selector);
        drop.activate();

        _fundErc20(token, drop, drop.grossRequired());
        assertEq(drop.assetBalance(), token.balanceOf(address(drop)), "ERC20");
        drop.activate();
        _assertStatus(drop, IDropV1.Status.Active);
    }

    /// @dev the design is covered in `MaliciousTokens.t.sol`. Activation is permissionless: anybody
    ///      can trigger it, and it cannot change a single parameter.
    function test_Activate_IsPermissionless() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        IDropV1.Config memory before = drop.config();
        vm.prank(stranger);
        drop.activate();

        _assertConfigUnchanged(drop, before);
        _assertStatus(drop, IDropV1.Status.Active);
    }

    // -----------------------------------------------------------------------
    // claim
    // -----------------------------------------------------------------------

    /// @dev The payout goes to the address inside the leaf.
    function test_Claim_PaysTheLeafRecipient() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        drop.claim(1, recipients[1], amounts[1], _proof(1));

        assertEq(recipients[1].balance, amounts[1], "I15");
        assertTrue(drop.isClaimed(1));
        assertEq(drop.totalClaimed(), amounts[1]);
        assertEq(drop.claimedCount(), 1);
    }

    /// @dev Anybody may submit the proof. The money still goes to the leaf
    ///      recipient, never to `msg.sender`.
    function test_Claim_CallerIsNotTheRecipient_StillPaysRecipient() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        uint256 strangerBefore = stranger.balance;

        vm.prank(stranger);
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertEq(recipients[0].balance, amounts[0], "I15. the leaf recipient is paid");
        assertEq(stranger.balance, strangerBefore, "I15. the caller gets nothing");
    }

    /// @dev `AlreadyClaimed`. A bit never goes back to false.
    function test_RevertWhen_Claim_Twice() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        drop.claim(0, recipients[0], amounts[0], _proof(0));

        vm.expectRevert(IDropV1.AlreadyClaimed.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertEq(drop.claimedCount(), 1, "I14");
    }

    /// @dev `BadProof`.
    function test_RevertWhen_Claim_BadProof() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        bytes32[] memory bad = new bytes32[](2);
        bad[0] = keccak256("nonsense");
        bad[1] = keccak256("more nonsense");

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claim(0, recipients[0], amounts[0], bad);
    }

    /// @dev A different amount is a different leaf.
    function test_RevertWhen_Claim_WrongAmount() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claim(0, recipients[0], amounts[0] + 1, _proof(0));
    }

    /// @dev A different recipient is a different leaf, so nobody can redirect a claim.
    function test_RevertWhen_Claim_WrongRecipient() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claim(0, stranger, amounts[0], _proof(0));
    }

    /// @dev A different index is a different leaf, so an index cannot be
    ///      swapped to reuse an unclaimed bit.
    function test_RevertWhen_Claim_WrongIndex() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claim(2, recipients[0], amounts[0], _proof(0));
    }

    /// @dev The drop address is inside the leaf, so a proof from one drop cannot be
    ///      replayed on another drop that shares a recipient set.
    function test_RevertWhen_Claim_ProofFromAnotherDrop() public {
        DropV1 first = _createNativeDrop(3);
        _activateNative(first);

        bytes32[] memory proofFromFirst = _proof(0);
        address recipient = recipients[0];
        uint256 amount = amounts[0];

        // A second drop, same crowd, same amounts, different address.
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        DropV1 second = _createDrop(address(0), address(0), 1, r, a);
        _activateNative(second);

        assertTrue(address(first) != address(second));

        vm.expectRevert(IDropV1.BadProof.selector);
        second.claim(0, recipient, amount, proofFromFirst);
    }

    /// @dev The chain id is inside the leaf, so a proof built for another chain cannot be
    ///      replayed here. This is what stops a Robinhood proof working on BNB Chain.
    function test_RevertWhen_Claim_ProofFromAnotherChainId() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        // The same crowd and the same drop address, but a tree built for chain 56.
        bytes32[] memory otherChainLeaves = new bytes32[](3);
        for (uint256 i = 0; i < 3; i++) {
            otherChainLeaves[i] = MerkleHelper.leafOf(address(drop), 56, i, recipients[i], amounts[i]);
        }
        assertTrue(
            MerkleHelper.rootOf(otherChainLeaves) != drop.merkleRoot(), "a different chain, a different root"
        );

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claim(0, recipients[0], amounts[0], MerkleHelper.proofOf(otherChainLeaves, 0));
    }

    /// @dev `WrongStatus` before activation.
    function test_RevertWhen_Claim_BeforeActivation() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
    }

    /// @dev `WrongStatus` once the drop is `Finalized`.
    function test_RevertWhen_Claim_WhenFinalized() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
    }

    /// @dev `ClaimWindowClosed`.
    function test_RevertWhen_Claim_AfterClaimDeadline() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.claimDeadline() + 1);

        vm.expectRevert(IDropV1.ClaimWindowClosed.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
    }

    /// @dev `OverEntitlement`. Defence in depth: a correct tree can never reach
    ///      it, so the test deliberately builds a **wrong** one, with a `totalEntitlements` that
    ///      understates the sum of the leaves.
    function test_RevertWhen_Claim_OverEntitlement() public {
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3); // 1 + 2 + 3 ether
        IDropFactoryV1.CreateParams memory p = _validParams(address(0), address(0), 0, r, a);

        // The tree really holds 6 ether. Claim only 3 of it.
        p.totalEntitlements = 3 ether;

        vm.prank(relayer);
        DropV1 drop = DropV1(payable(_sendCreateDrop(p)));

        _fundNative(drop, drop.grossRequired());
        drop.activate();

        // index 2 is worth exactly 3 ether, so it fits.
        drop.claim(2, recipients[2], amounts[2], _proof(2));
        assertEq(drop.totalClaimed(), 3 ether);

        // Anything more would break.
        vm.expectRevert(IDropV1.OverEntitlement.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertLe(drop.totalClaimed(), drop.totalEntitlements(), "I1");
    }

    /// @dev **The bit is set before the transfer.** The recipient calls `isClaimed` back
    ///      from inside its own `receive`, and must already see true.
    function test_Claim_SetsBitBeforeTransfer() public {
        ReentrantEthReceiver observer = new ReentrantEthReceiver();

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = address(observer);
        a[0] = 1 ether;

        DropV1 drop = _createNativeDropFor(r, a);
        _activateNative(drop);

        observer.setReentry(address(drop), abi.encodeCall(IDropV1.isClaimed, (0)));

        drop.claim(0, address(observer), 1 ether, _proof(0));

        assertTrue(observer.attempted(), "the observer really ran");
        assertTrue(observer.reentrySucceeded(), "the view call succeeded");
        assertTrue(
            abi.decode(observer.reentryReturnData(), (bool)),
            "the bit must already be set while the transfer is in flight"
        );
    }

    /// @dev `totalClaimed`, `claimedCount` and the bitmap all move together.
    function test_Claim_UpdatesTotalClaimedAndCount() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        uint256 running;
        for (uint256 i = 0; i < 3; i++) {
            drop.claim(i, recipients[i], amounts[i], _proof(i));
            running += amounts[i];

            assertEq(drop.totalClaimed(), running, "I14");
            assertEq(drop.claimedCount(), i + 1, "I14");
            assertTrue(drop.isClaimed(i), "I2");
            assertEq(drop.unclaimed(), totalEntitlements - running, "");
        }

        assertEq(drop.totalClaimed(), totalEntitlements, "I1 at the boundary");
        assertEq(address(drop).balance, 0, "everything was paid out");
    }

    /// @dev One `Claimed` event per paid leaf, with the index, the recipient and
    ///      the amount the indexer needs.
    function test_Claim_EmitsClaimed() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.expectEmit(true, true, false, true, address(drop));
        emit IDropV1.Claimed(1, recipients[1], amounts[1]);
        drop.claim(1, recipients[1], amounts[1], _proof(1));
    }

    /// @dev Native payout through a checked low level call.
    function test_Claim_Native_PaysRecipient() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(recipients[0].balance, amounts[0], "");
    }

    /// @dev ERC20 payout through `SafeERC20.safeTransfer`.
    function test_Claim_Erc20_UsesSafeErc20() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        _activateErc20(token, drop);

        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertEq(token.balanceOf(recipients[0]), amounts[0], "");
        assertEq(token.balanceOf(address(drop)), totalEntitlements - amounts[0], "I3");
    }

    /// @dev The drop never grants an allowance to anybody, in any state.
    function test_Claim_GrantsNoAllowance() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        _activateErc20(token, drop);
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertEq(token.allowance(address(drop), recipients[0]), 0, "I13");
        assertEq(token.allowance(address(drop), address(factory)), 0, "I13");
        assertEq(token.allowance(address(drop), stranger), 0, "I13");
    }

    // -----------------------------------------------------------------------
    // claimBatch
    // -----------------------------------------------------------------------

    /// @dev `MAX_BATCH = 20`.
    function test_ClaimBatch_TwentyItems_Succeeds() public {
        DropV1 drop = _createNativeDrop(20);
        _activateNative(drop);

        drop.claimBatch(_batch(0, 20));

        assertEq(drop.claimedCount(), 20, "I14");
        assertEq(drop.totalClaimed(), totalEntitlements, "I1");
        for (uint256 i = 0; i < 20; i++) {
            assertEq(recipients[i].balance, amounts[i], "every recipient was paid");
        }
    }

    /// @dev `BadBatchSize` at 21.
    function test_RevertWhen_ClaimBatch_TwentyOneItems() public {
        DropV1 drop = _createNativeDrop(21);
        _activateNative(drop);

        IDropV1.ClaimItem[] memory items = _batch(0, 21);

        vm.expectRevert(IDropV1.BadBatchSize.selector);
        drop.claimBatch(items);
    }

    /// @dev `BadBatchSize` at 0.
    function test_RevertWhen_ClaimBatch_ZeroItems() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        IDropV1.ClaimItem[] memory items = new IDropV1.ClaimItem[](0);

        vm.expectRevert(IDropV1.BadBatchSize.selector);
        drop.claimBatch(items);
    }

    /// @dev An already claimed index is skipped **in silence**. No revert, no event.
    ///      This is what keeps a relayer batch alive when somebody claimed a second earlier.
    function test_ClaimBatch_AlreadyClaimedItem_IsSkippedSilently() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        drop.claim(1, recipients[1], amounts[1], _proof(1));

        vm.recordLogs();
        drop.claimBatch(_batch(0, 3));

        // Two `Claimed` events, not three. Index 1 produced nothing at all.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 claimedEvents;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == IDropV1.Claimed.selector) claimedEvents++;
        }
        assertEq(claimedEvents, 2, "the skipped item emits nothing");

        assertEq(drop.claimedCount(), 3, "I14");
        assertEq(drop.totalClaimed(), totalEntitlements, "I1");
        assertEq(recipients[1].balance, amounts[1], "and it was not paid twice");
    }

    /// @dev A bad proof is a data bug on our side, not a race, so it reverts the whole
    ///      batch. Nothing in it is applied.
    function test_RevertWhen_ClaimBatch_InvalidProof_RevertsWholeBatch() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        IDropV1.ClaimItem[] memory items = _batch(0, 3);
        items[2].amount = amounts[2] + 1; // breaks the leaf

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claimBatch(items);

        assertEq(drop.claimedCount(), 0, "nothing in the batch was applied");
        assertEq(recipients[0].balance, 0);
        assertEq(recipients[1].balance, 0);
    }

    /// @dev A mixed batch pays exactly the unclaimed ones.
    function test_ClaimBatch_MixedBatch_PaysOnlyUnclaimed() public {
        DropV1 drop = _createNativeDrop(5);
        _activateNative(drop);

        drop.claim(0, recipients[0], amounts[0], _proof(0));
        drop.claim(3, recipients[3], amounts[3], _proof(3));

        drop.claimBatch(_batch(0, 5));

        assertEq(drop.claimedCount(), 5, "I14");
        assertEq(drop.totalClaimed(), totalEntitlements, "I1");
        for (uint256 i = 0; i < 5; i++) {
            assertEq(recipients[i].balance, amounts[i], "paid exactly once");
        }
    }

    /// @dev A batch where every item is already claimed does nothing and does not revert.
    function test_ClaimBatch_AllAlreadyClaimed_IsANoop() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        drop.claimBatch(_batch(0, 3));
        uint256 claimedBefore = drop.totalClaimed();

        drop.claimBatch(_batch(0, 3));

        assertEq(drop.totalClaimed(), claimedBefore, "");
        assertEq(drop.claimedCount(), 3, "I14");
    }

    /// @dev `WrongStatus`.
    function test_RevertWhen_ClaimBatch_WrongStatus() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        IDropV1.ClaimItem[] memory items = _batch(0, 3);

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.claimBatch(items);
    }

    /// @dev `ClaimWindowClosed`.
    function test_RevertWhen_ClaimBatch_AfterClaimDeadline() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        IDropV1.ClaimItem[] memory items = _batch(0, 3);
        vm.warp(drop.claimDeadline() + 1);

        vm.expectRevert(IDropV1.ClaimWindowClosed.selector);
        drop.claimBatch(items);
    }

    /// @dev One failing native send reverts the whole batch. The relayer retries without
    ///      that recipient. Funds are never lost, only that batch.
    function test_RevertWhen_ClaimBatch_OneNativeSendFails() public {
        address rejector = address(new RejectingEthReceiver());

        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        r[0] = address(uint160(0x2001));
        r[1] = rejector;
        r[2] = address(uint160(0x2003));
        a[0] = 1 ether;
        a[1] = 2 ether;
        a[2] = 3 ether;

        DropV1 drop = _createNativeDropFor(r, a);
        _activateNative(drop);

        IDropV1.ClaimItem[] memory all = _batch(0, 3);
        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.claimBatch(all);

        assertEq(drop.claimedCount(), 0, "the whole batch rolled back");

        // The relayer retries without the bad recipient, and everybody else is paid.
        uint256 rejectorIndex = _indexOf(rejector);
        IDropV1.ClaimItem[] memory good = new IDropV1.ClaimItem[](2);
        uint256 k;
        for (uint256 i = 0; i < 3; i++) {
            if (i == rejectorIndex) continue;
            good[k++] = _item(i);
        }
        drop.claimBatch(good);

        assertEq(drop.claimedCount(), 2, "the retry went through");
    }

    /// @dev The guard covers the whole call, not each item, so a recipient cannot
    ///      reenter `claimBatch` from inside its own payout.
    function test_ClaimBatch_NonReentrantCoversWholeCall() public {
        ReentrantEthReceiver attacker = new ReentrantEthReceiver();

        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = address(attacker);
        r[1] = address(uint160(0x3002));
        a[0] = 1 ether;
        a[1] = 2 ether;

        DropV1 drop = _createNativeDropFor(r, a);
        _activateNative(drop);

        uint256 attackerIndex = _indexOf(address(attacker));
        IDropV1.ClaimItem[] memory items = _batch(0, 2);
        attacker.setReentry(address(drop), abi.encodeCall(IDropV1.claimBatch, (items)));

        drop.claimBatch(items);

        assertTrue(attacker.attempted(), "the attacker really tried");
        assertFalse(attacker.reentrySucceeded(), "the reentry was refused");
        assertEq(drop.claimedCount(), 2, "each index was still claimed exactly once");
        assertEq(address(attacker).balance, a[attackerIndex == 0 ? 0 : 1], "no double payout");
    }

    // -----------------------------------------------------------------------
    // views
    // -----------------------------------------------------------------------

    /// @dev `config` returns every field of table 5.1, so the UI can
    ///      verify the drop before anybody sends money to it.
    function test_Config_ReturnsEveryTable51Field() public {
        DropV1 drop = _createNativeDrop(3);
        IDropV1.Config memory c = drop.config();

        assertEq(c.asset, drop.asset());
        assertEq(c.merkleRoot, drop.merkleRoot());
        assertEq(c.manifestHash, drop.manifestHash());
        assertEq(c.totalEntitlements, drop.totalEntitlements());
        assertEq(c.grossRequired, drop.grossRequired());
        assertEq(c.feeAmount, drop.feeAmount());
        assertEq(c.feeRecipient, drop.feeRecipient());
        assertEq(c.refundRecipient, drop.refundRecipient());
        assertEq(c.fundingDeadline, drop.fundingDeadline());
        assertEq(c.claimPeriod, drop.claimPeriod());
        assertEq(c.leafCount, drop.leafCount());
        assertEq(c.implementation, drop.implementation());
        assertEq(c.creatorCommitment, drop.creatorCommitment());
    }

    /// @dev `unclaimed == totalEntitlements - totalClaimed`.
    function test_Unclaimed_TracksTotalMinusClaimed() public {
        DropV1 drop = _createNativeDrop(3);
        assertEq(drop.unclaimed(), totalEntitlements);

        _activateNative(drop);
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertEq(drop.unclaimed(), totalEntitlements - amounts[0]);
    }

    function test_ClaimDeadline_ZeroBeforeActivation() public {
        DropV1 drop = _createNativeDrop(3);
        assertEq(drop.claimDeadline(), 0, "");

        _activateNative(drop);
        assertGt(drop.claimDeadline(), 0);
    }

    /// @dev `isClaimed` follows the bitmap, one bit per index, across words.
    function test_IsClaimed_FollowsTheBitmap() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        for (uint256 i = 0; i < 3; i++) {
            assertFalse(drop.isClaimed(i));
        }

        drop.claim(1, recipients[1], amounts[1], _proof(1));

        assertFalse(drop.isClaimed(0), "I2. neighbours must not move");
        assertTrue(drop.isClaimed(1));
        assertFalse(drop.isClaimed(2), "I2. neighbours must not move");
        assertFalse(drop.isClaimed(256), "a different word must not move");
    }

    /// @dev `assetBalance` reads the drop asset, never the other one.
    function test_AssetBalance_ReadsTheDropAsset() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);

        vm.deal(address(drop), 7 ether);
        assertEq(drop.assetBalance(), 0, "native in an ERC20 drop is not the drop asset");

        _fundErc20(token, drop, 5 ether);
        assertEq(drop.assetBalance(), 5 ether);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    function _item(uint256 index) internal view returns (IDropV1.ClaimItem memory) {
        return
            IDropV1.ClaimItem({
                index: index, recipient: recipients[index], amount: amounts[index], proof: _proof(index)
            });
    }

    function _batch(uint256 from, uint256 count) internal view returns (IDropV1.ClaimItem[] memory items) {
        items = new IDropV1.ClaimItem[](count);
        for (uint256 i = 0; i < count; i++) {
            items[i] = _item(from + i);
        }
    }

    function _indexOf(address recipient) internal view returns (uint256) {
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == recipient) return i;
        }
        revert("recipient not in the crowd");
    }

    /// @dev Minimal but valid `InitParams` for a standalone clone the test deployed itself.
    function _initParams(bytes32 salt) internal view returns (IDropV1.InitParams memory) {
        return IDropV1.InitParams({
            asset: address(0),
            merkleRoot: keccak256("root"),
            manifestHash: MANIFEST_HASH,
            totalEntitlements: 1 ether,
            grossRequired: 1 ether,
            feeAmount: 0,
            feeRecipient: feeRecipient,
            refundRecipient: refundRecipient,
            fundingDeadline: uint64(block.timestamp) + FUNDING_PERIOD,
            claimPeriod: CLAIM_PERIOD,
            leafCount: 1,
            implementation: address(implementation),
            creatorCommitment: _commitment(0),
            salt: salt
        });
    }
}
