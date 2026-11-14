// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V6TestBase} from "./V6TestBase.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {RejectingEthReceiver} from "./RejectingEthReceiver.sol";
import {ReturnBombEthReceiver} from "./ReturnBombEthReceiver.sol";
import {SwitchableEthReceiver} from "./SwitchableEthReceiver.sol";

import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropV2} from "../src/IDropV2.sol";
import {IDropV3} from "../src/IDropV3.sol";
import {IDropV5} from "../src/IDropV5.sol";
import {IDropV6} from "../src/IDropV6.sol";

/// @title DropV6Test
/// @notice What `DropV6` changes in `DropV5`.
///         1. L-05: `index >= leafCount` is `BadIndex`, in `claim`, `claimBatch` and `claimHandle`.
///         2. Option B: a native refund or cancel that cannot send does not revert; the ETH
///            waits in the drop for `sweep(address(0))`.
///         3: `sweep(address(0))` on a native drop once it is finished.
///         4. I-02: a native send copies no return data.
///         `DropV6Parity.t.sol` runs every V1, V2, V3 and V5 suite against it.
contract DropV6Test is V6TestBase {
    address internal binder;
    uint256 internal binderKey;

    function setUp() public override {
        super.setUp();
        (binder, binderKey) = makeAddrAndKey("binder");
        vm.prank(owner);
        registry.setBinder(binder);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// @dev A bad tree: three address leaves, but `leafCount` says two. Index 2 is in the tree
    ///      and outside the count. Native, activated.
    function _badTreeNativeDrop() internal returns (DropV1 drop) {
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        IDropFactoryV1.CreateParams memory p = _validParams(address(0), address(0), 0, r, a);
        p.leafCount = 2;
        vm.prank(relayer);
        drop = DropV1(payable(_sendCreateDrop(p)));
        _activateNative(drop);
    }

    /// @dev The same bad tree with handle leaves. Returns the leaves for the proofs.
    function _badTreeHandleDrop() internal returns (DropV3 drop, uint256[] memory ids, bytes32[] memory hl) {
        uint256 nonce = 7;
        address predicted = factory.predictDrop(relayer, _commitment(nonce), nonce);
        ids = new uint256[](3);
        hl = new bytes32[](3);
        for (uint256 i = 0; i < 3; i++) {
            ids[i] = 1000 + i;
            hl[i] = MerkleHelper.handleLeafOf(predicted, block.chainid, i, ids[i], 1 ether);
        }
        IDropFactoryV1.CreateParams memory p = IDropFactoryV1.CreateParams({
            asset: address(0),
            merkleRoot: MerkleHelper.rootOf(hl),
            manifestHash: MANIFEST_HASH,
            totalEntitlements: 3 ether,
            leafCount: 2,
            refundRecipient: refundRecipient,
            creatorCommitment: _commitment(nonce),
            nonce: nonce,
            fundingPeriod: FUNDING_PERIOD,
            claimPeriod: CLAIM_PERIOD,
            tokenFactory: address(0)
        });
        vm.prank(relayer);
        drop = DropV3(payable(_sendCreateDrop(p)));
        _activateNative(DropV1(payable(address(drop))));
    }

    function _bind(DropV3 drop, uint256 index, uint256 xId, address to) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(binderKey, drop.bindingDigest(index, xId, to));
        return abi.encodePacked(r, s, v);
    }

    // -----------------------------------------------------------------------
    // L-05, the index
    // -----------------------------------------------------------------------

    /// @dev A leaf at `index >= leafCount` is refused, even with a valid proof.
    function test_V6_RevertWhen_Claim_IndexAtLeafCount() public {
        DropV1 drop = _badTreeNativeDrop();

        vm.expectRevert(IDropV6.BadIndex.selector);
        drop.claim(2, recipients[2], amounts[2], _proof(2));
        assertFalse(drop.isClaimed(2));
        assertEq(drop.totalClaimed(), 0);
    }

    /// @dev Control: the leaves inside the count still pay on the same bad tree.
    function test_V6_Claim_IndexBelowLeafCountStillPays() public {
        DropV1 drop = _badTreeNativeDrop();

        drop.claim(1, recipients[1], amounts[1], _proof(1));
        assertTrue(drop.isClaimed(1));
        assertEq(recipients[1].balance, amounts[1]);
    }

    /// @dev One bad index in a batch reverts the whole batch.
    function test_V6_RevertWhen_ClaimBatch_OneIndexAtLeafCount() public {
        DropV1 drop = _badTreeNativeDrop();

        IDropV1.ClaimItem[] memory items = new IDropV1.ClaimItem[](2);
        items[0] = IDropV1.ClaimItem(0, recipients[0], amounts[0], _proof(0));
        items[1] = IDropV1.ClaimItem(2, recipients[2], amounts[2], _proof(2));

        vm.expectRevert(IDropV6.BadIndex.selector);
        drop.claimBatch(items);
        assertEq(drop.claimedCount(), 0, "the whole batch rolled back");
    }

    /// @dev The same in `claimHandle`, with a valid binding.
    function test_V6_RevertWhen_ClaimHandle_IndexAtLeafCount() public virtual {
        (DropV3 drop, uint256[] memory ids, bytes32[] memory hl) = _badTreeHandleDrop();
        address to = makeAddr("handle wallet");

        bytes memory sig = _bind(drop, 2, ids[2], to);
        vm.expectRevert(IDropV6.BadIndex.selector);
        drop.claimHandle(2, ids[2], 1 ether, to, MerkleHelper.proofOf(hl, 2), sig);
        assertEq(to.balance, 0);
    }

    /// @dev Control: a handle leaf inside the count pays on the same bad tree.
    function test_V6_ClaimHandle_IndexBelowLeafCountStillPays() public virtual {
        (DropV3 drop, uint256[] memory ids, bytes32[] memory hl) = _badTreeHandleDrop();
        address to = makeAddr("handle wallet");

        drop.claimHandle(1, ids[1], 1 ether, to, MerkleHelper.proofOf(hl, 1), _bind(drop, 1, ids[1], to));
        assertEq(to.balance, 1 ether);
    }

    /// @dev In `claimHandle` the index check comes after `BadXId`.
    function test_V6_RevertWhen_ClaimHandle_ZeroXIdBeforeBadIndex() public virtual {
        (DropV3 drop,, bytes32[] memory hl) = _badTreeHandleDrop();
        address to = makeAddr("handle wallet");

        vm.expectRevert(IDropV2.BadXId.selector);
        drop.claimHandle(5, 0, 1 ether, to, MerkleHelper.proofOf(hl, 2), "");
    }

    // -----------------------------------------------------------------------
    // option B, a native refund that fails
    // -----------------------------------------------------------------------

    /// @dev The refund address rejects ETH: `refund` does not revert, the drop is
    ///      `Finalized`, `Refunded` carries what was owed, and the ETH waits.
    function test_V6_NativeRefund_RefundRejectsEth_FinalizedEthWaits() public {
        refundRecipient = address(new RejectingEthReceiver());
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        uint256 left = address(drop).balance;
        vm.warp(drop.claimDeadline() + 1);

        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV1.Refunded(refundRecipient, left);
        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV5.NativeReturnFailed(refundRecipient, left);
        drop.refund();

        _assertStatus(drop, IDropV1.Status.Finalized);
        assertEq(address(drop).balance, left, "the ETH waits in the drop");
    }

    /// @dev A refund that works says so with `NativeReturned`, on a native drop too.
    function test_V6_NativeRefund_EmitsNativeReturned() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        uint256 left = address(drop).balance;
        vm.warp(drop.claimDeadline() + 1);

        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV3.NativeReturned(refundRecipient, left);
        drop.refund();

        assertEq(refundRecipient.balance, left);
        assertEq(address(drop).balance, 0);
    }

    /// @dev The same for a native cancel: `Cancelled`, the ETH waits.
    function test_V6_NativeCancel_RefundRejectsEth_CancelledEthWaits() public {
        refundRecipient = address(new RejectingEthReceiver());
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, 1 ether);
        vm.warp(drop.fundingDeadline() + 1);

        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV1.CancelledUnfunded(refundRecipient, 1 ether);
        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV5.NativeReturnFailed(refundRecipient, 1 ether);
        drop.cancelUnfunded();

        _assertStatus(drop, IDropV1.Status.Cancelled);
        assertEq(address(drop).balance, 1 ether);
    }

    /// @dev The waiting ETH leaves by `sweep(address(0))` once the address takes ETH,
    ///      called by anyone, to the same `refundRecipient`.
    function test_V6_NativeRefund_WaitingEthLeavesBySweep() public {
        SwitchableEthReceiver wallet = new SwitchableEthReceiver();
        refundRecipient = address(wallet);
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        uint256 left = address(drop).balance;
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.sweep(address(0));
        assertEq(address(drop).balance, left, "still waiting while it rejects");

        wallet.setAccepting(true);
        vm.expectEmit(true, true, false, true, address(drop));
        emit IDropV1.Swept(address(0), address(wallet), left);
        vm.prank(stranger);
        drop.sweep(address(0));

        assertEq(address(wallet).balance, left);
        assertEq(address(drop).balance, 0);
    }

    /// @dev The same after a cancel.
    function test_V6_NativeCancel_WaitingEthLeavesBySweep() public {
        SwitchableEthReceiver wallet = new SwitchableEthReceiver();
        refundRecipient = address(wallet);
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, 1 ether);
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        wallet.setAccepting(true);
        drop.sweep(address(0));
        assertEq(address(wallet).balance, 1 ether);
        assertEq(address(drop).balance, 0);
    }

    // -----------------------------------------------------------------------
    // sweep(address(0)) on a native drop
    // -----------------------------------------------------------------------

    /// @dev ETH forced in after a refund that worked leaves by `sweep`. On `DropV5`
    ///      it had no way out.
    function test_V6_Sweep_Native_ForcedInAfterRefund() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        uint256 before = refundRecipient.balance;

        vm.deal(address(drop), 1 ether); // forced in after the end
        drop.sweep(address(0));
        assertEq(refundRecipient.balance - before, 1 ether);
        assertEq(address(drop).balance, 0);
    }

    /// @dev While the drop is live the native sweep is `NotFinished`, not
    ///      `CannotSweepDropAsset`: claims still own that ETH.
    function test_V6_RevertWhen_Sweep_Native_WhileActive() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.expectRevert(IDropV1.NotFinished.selector);
        drop.sweep(address(0));
    }

    /// @dev The same while it waits for money.
    function test_V6_RevertWhen_Sweep_Native_WhileCreated() public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, 1 ether);

        vm.expectRevert(IDropV1.NotFinished.selector);
        drop.sweep(address(0));
    }

    /// @dev A finished native drop with nothing left is `NothingToSweep`.
    function test_V6_RevertWhen_Sweep_Native_NothingLeft() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        vm.expectRevert(IDropV1.NothingToSweep.selector);
        drop.sweep(address(0));
    }

    /// @dev last sentence. A token drop's own token is still never swept.
    function test_V6_RevertWhen_Sweep_TokenDropAsset() public virtual {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, 0);
        _activateTokenDrop(drop, token);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        token.mint(address(drop), 1 ether);

        vm.expectRevert(IDropV1.CannotSweepDropAsset.selector);
        drop.sweep(address(token));
    }

    // -----------------------------------------------------------------------
    // I-02, sends without return data
    // -----------------------------------------------------------------------

    /// @dev A recipient that answers with 64 KB of return data costs the claim
    ///      no more than one that answers with none: the drop never copies it.
    function test_V6_Claim_ReturnDataIsNotCopied() public {
        uint256 size = 64 * 1024;
        address bomb = address(new ReturnBombEthReceiver(size, true));
        address quiet = address(new ReturnBombEthReceiver(size, false));

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        a[0] = 1 ether;

        r[0] = bomb;
        DropV1 dropBomb = _createDrop(address(0), address(0), 1, r, a);
        bytes32[] memory proofBomb = _proof(0);
        _activateNative(dropBomb);

        r[0] = quiet;
        DropV1 dropQuiet = _createDrop(address(0), address(0), 2, r, a);
        bytes32[] memory proofQuiet = _proof(0);
        _activateNative(dropQuiet);

        // `lastCallGas` measures the claim call itself, not the test code around it.
        dropBomb.claim(0, bomb, 1 ether, proofBomb);
        uint256 usedBomb = vm.lastCallGas().gasTotalUsed;

        dropQuiet.claim(0, quiet, 1 ether, proofQuiet);
        uint256 usedQuiet = vm.lastCallGas().gasTotalUsed;

        assertEq(bomb.balance, 1 ether);
        assertEq(quiet.balance, 1 ether);
        assertLe(usedBomb, usedQuiet + 1000, "I-02. the return data was copied");
    }
}
