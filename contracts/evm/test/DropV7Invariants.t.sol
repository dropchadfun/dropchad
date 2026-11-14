// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console} from "forge-std/Test.sol";

import {DropInvariantsTest} from "./DropInvariants.t.sol";
import {DropTestBase} from "./DropTestBase.sol";
import {DropV7Handler} from "./DropV7Handler.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {V3Params} from "./V3TestBase.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {BinderRegistryV2} from "../src/BinderRegistryV2.sol";
import {DropFactoryV7} from "../src/DropFactoryV7.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV7} from "../src/DropV7.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropFactoryV3} from "../src/IDropFactoryV3.sol";
import {IDropV1} from "../src/IDropV1.sol";

/// @title DropV7InvariantsTest
/// @notice Invariants, on a `DropV7` drop whose tree mixes
///         address and handle leaves, with binding v2, the binder live, revoked and
///         rotated at random, and the drop asset sweep.
/// @dev `DropV2InvariantsTest` on binding v2. Every invariant of `DropInvariantsTest` runs here
///      unchanged, except the three that must see the handle leaves too, as in the V2 suite.
///      `DropV7Handler` adds handle claims inside and outside the time window, a kept signature
///      sent again later, forged claims, revokes, binder rotations, and counts every drop asset
///      sweep as refunded, so the invariants hold as written.
///      The tree: indexes 0 to 7 are address leaves, 8 to 15 handle leaves. Each X id has one
///      bound wallet, so that invariant stays exact.
contract DropV7InvariantsTest is DropInvariantsTest {
    uint256 internal constant N_ADDR = 8;
    uint256 internal constant N_HANDLE = 8;

    BinderRegistry internal registry;
    DropV7Handler internal v7Handler;

    function _deployImplementation() internal virtual override returns (address) {
        registry = BinderRegistry(address(new BinderRegistryV2(owner)));
        return address(new DropV7(address(registry)));
    }

    function _deployFactory() internal virtual override returns (address) {
        return address(new DropFactoryV7(owner, address(implementation), feeRecipient));
    }

    /// @dev `DropFactoryV7` takes the V3 `CreateParams`, with no ETH fee here.
    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal virtual override returns (address) {
        return IDropFactoryV3(address(factory)).createDrop(V3Params.from(p, 0));
    }

    function setUp() public override {
        DropTestBase.setUp();

        vm.prank(owner);
        factory.setDefaultFeeBps(250);

        token = new MockERC20("Drop Token", "DROP", 18);
        address tokenFactory = _allowToken(address(token));

        DropV7Handler.HandleSetup memory hs = _mixedTree();
        target = _createMixedDrop(address(token), tokenFactory);
        initialConfig = target.config();

        (address binderA, uint256 keyA) = makeAddrAndKey("binder A");
        (, uint256 keyB) = makeAddrAndKey("binder B");
        address guardianKey = makeAddr("guardian");
        vm.startPrank(owner);
        registry.setBinder(binderA);
        registry.setGuardian(guardianKey);
        vm.stopPrank();

        hs.registry = registry;
        hs.keyA = keyA;
        hs.keyB = keyB;

        v7Handler = new DropV7Handler(
            DropV7Handler.BaseSetup({
                factory: factory,
                drop: target,
                token: token,
                owner: owner,
                refundRecipient: refundRecipient,
                feeRecipient: feeRecipient,
                recipients: recipients,
                amounts: amounts,
                leaves: leaves
            }),
            hs
        );
        handler = v7Handler;

        targetContract(address(handler));
    }

    // -----------------------------------------------------------------------
    // the mixed tree
    // -----------------------------------------------------------------------

    uint256[] internal hXIds;
    uint256[] internal hAmts;
    address[] internal hWallets;

    function _mixedTree() internal returns (DropV7Handler.HandleSetup memory hs) {
        (address[] memory r, uint256[] memory a) = _defaultCrowd(N_ADDR);
        _setCrowd(r, a);

        for (uint256 j = 0; j < N_HANDLE; j++) {
            hXIds.push(9_000_000 + j);
            hAmts.push((j + 1) * 0.5 ether);
            hWallets.push(makeAddr(string.concat("handle wallet ", vm.toString(j))));
        }
        hs.xIds = hXIds;
        hs.amounts = hAmts;
        hs.wallets = hWallets;
        hs.firstIndex = N_ADDR;
    }

    function _createMixedDrop(address asset, address tokenFactory) internal returns (DropV1) {
        uint256 nonce = 0;
        bytes32 commitment = _commitment(nonce);
        address predicted = factory.predictDrop(relayer, commitment, nonce);

        delete leaves;
        for (uint256 i = 0; i < N_ADDR; i++) {
            leaves.push(MerkleHelper.leafOf(predicted, block.chainid, i, recipients[i], amounts[i]));
        }
        for (uint256 j = 0; j < N_HANDLE; j++) {
            leaves.push(MerkleHelper.handleLeafOf(predicted, block.chainid, N_ADDR + j, hXIds[j], hAmts[j]));
            totalEntitlements += hAmts[j];
        }
        root = MerkleHelper.rootOf(leaves);

        IDropFactoryV1.CreateParams memory p = IDropFactoryV1.CreateParams({
            asset: asset,
            merkleRoot: root,
            manifestHash: MANIFEST_HASH,
            totalEntitlements: totalEntitlements,
            leafCount: uint32(N_ADDR + N_HANDLE),
            refundRecipient: refundRecipient,
            creatorCommitment: commitment,
            nonce: nonce,
            fundingPeriod: FUNDING_PERIOD,
            claimPeriod: CLAIM_PERIOD,
            tokenFactory: tokenFactory
        });
        vm.prank(relayer);
        address created = _sendCreateDrop(p);
        assertEq(created, predicted, "");
        return DropV1(payable(created));
    }

    // -----------------------------------------------------------------------
    // the three invariants that must see the handle leaves
    // -----------------------------------------------------------------------

    /// @dev over every leaf of the mixed tree.
    function invariant_BitmapMatchesClaimedCount() public view override {
        uint256 setBits;
        for (uint256 i = 0; i < N_ADDR + N_HANDLE; i++) {
            if (target.isClaimed(i)) setBits++;
        }

        assertEq(target.claimedCount(), setBits, "I14. claimedCount must equal the set bits");
        assertEq(target.claimedCount(), handler.ghostClaimCount(), "I14. and the claims that happened");
        assertEq(target.totalClaimed(), handler.ghostClaimedSum(), "I14. and their sum");
    }

    /// @dev the bound wallets included.
    function invariant_NoAllowanceEverGranted() public view override {
        assertEq(token.allowance(address(target), address(factory)), 0, "I13");
        assertEq(token.allowance(address(target), address(handler)), 0, "I13");
        assertEq(token.allowance(address(target), refundRecipient), 0, "I13");
        assertEq(token.allowance(address(target), feeRecipient), 0, "I13");
        for (uint256 i = 0; i < N_ADDR; i++) {
            assertEq(token.allowance(address(target), recipients[i]), 0, "I13");
        }
        for (uint256 j = 0; j < N_HANDLE; j++) {
            assertEq(token.allowance(address(target), hWallets[j]), 0, "I13");
        }
    }

    /// @dev An address leaf pays its recipient, a handle leaf pays its bound
    ///      wallet, each exactly its amount and only once claimed. Outsiders and both binders are
    ///      never paid.
    function invariant_PayoutsOnlyGoToLeafRecipients() public view override {
        for (uint256 i = 0; i < N_ADDR; i++) {
            uint256 balance = token.balanceOf(recipients[i]);
            assertEq(balance, target.isClaimed(i) ? amounts[i] : 0, "I15. address leaf");
        }
        for (uint256 j = 0; j < N_HANDLE; j++) {
            uint256 balance = token.balanceOf(hWallets[j]);
            assertEq(balance, target.isClaimed(N_ADDR + j) ? hAmts[j] : 0, "I15. handle leaf, bound wallet");
            assertEq(balance, v7Handler.ghostHandlePaid(j), "I15. and what the handler saw");
        }
        for (uint256 i = 0; i < handler.outsiderCount(); i++) {
            assertEq(token.balanceOf(handler.outsiderAt(i)), 0, "I15. nobody outside the tree is ever paid");
        }
        assertEq(token.balanceOf(v7Handler.binderA()), 0, "I15. never the binder");
        assertEq(token.balanceOf(v7Handler.binderB()), 0, "I15. never the binder");
    }

    // -----------------------------------------------------------------------
    // binding v2 and the sweep
    // -----------------------------------------------------------------------

    /// @dev No handle claim went through while revoked, and no
    ///      forged one at all.
    function invariant_NoForgedOrRevokedHandleClaim() public view {
        assertEq(v7Handler.ghostClaimWhileRevoked(), 0, "a handle claim went through while revoked");
        assertEq(v7Handler.ghostForgedSucceeded(), 0, "a forged handle claim went through");
    }

    /// @dev No claim outside `[now, now + MAX_BINDING_LIFETIME]`, and no kept
    ///      signature after its `validUntil`, ever paid.
    function invariant_NoClaimOutsideTheWindow() public view {
        assertEq(v7Handler.ghostOutsideWindowSucceeded(), 0, "a claim outside the window paid");
        assertEq(v7Handler.ghostLateSucceeded(), 0, "a kept signature paid after validUntil");
    }

    /// @dev The drop asset is swept only once finished, only to `refundRecipient`, and
    ///      only what arrived after the drop finished.
    function invariant_AssetSweepOnlyWhenFinishedToRefund() public view {
        assertEq(v7Handler.ghostAssetSweptBeforeFinish(), 0, "swept before the drop finished");
        assertEq(v7Handler.ghostAssetSweptElsewhere(), 0, "swept somewhere else");
        assertEq(v7Handler.ghostAssetSweptMoreThanLate(), 0, "swept more than arrived late");
    }

    /// @dev Not an invariant, a report of the V7 actions. See `invariant_CallSummary`.
    function invariant_CallSummaryV7() public view {
        console.log("claimHandleOne          ", handler.calls("claimHandleOne"));
        console.log("claimHandleOutsideWindow", handler.calls("claimHandleOutsideWindow"));
        console.log("keepSignature           ", handler.calls("keepSignature"));
        console.log("replayKept              ", handler.calls("replayKept"));
        console.log("claimHandleForged       ", handler.calls("claimHandleForged"));
        console.log("revokeBinder            ", handler.calls("revokeBinder"));
        console.log("setBinderRandom         ", handler.calls("setBinderRandom"));
        console.log("handle claims ok        ", v7Handler.ghostHandleClaims());
        console.log("drop asset sweeps ok    ", v7Handler.ghostAssetSweeps());
    }

    /// @dev The guard on the test itself: a hand driven run through every V7 path.
    function test_Handler_ReachesEveryState() public override {
        _assertStatus(target, IDropV1.Status.Created);

        // Before the end the drop asset cannot be swept.
        v7Handler.sweepDropAsset();
        assertEq(v7Handler.ghostAssetSweeps(), 0, "no asset sweep while Created");

        handler.overfund(target.grossRequired());
        handler.activate();
        _assertStatus(target, IDropV1.Status.Active);
        v7Handler.sweepDropAsset();
        assertEq(v7Handler.ghostAssetSweeps(), 0, "no asset sweep while Active");

        // An address claim, a batch, a handle claim inside the window.
        handler.claimOne(0);
        handler.claimBatchRandom(1, 3);
        v7Handler.claimHandleOne(0, 600);
        assertTrue(target.isClaimed(N_ADDR), "the first handle leaf was claimed");

        // Outside the window, both ways, and every forged mode: nothing pays.
        v7Handler.claimHandleOutsideWindow(1, 0, 5);
        v7Handler.claimHandleOutsideWindow(1, 1, 5);
        for (uint256 mode = 0; mode < 5; mode++) {
            v7Handler.claimHandleForged(1, mode);
        }
        assertFalse(target.isClaimed(N_ADDR + 1), "nothing outside the window or forged went through");

        // A kept signature, sent again after its time: refused.
        v7Handler.keepSignature(1, 0);
        handler.warpForward(1 hours);
        v7Handler.replayKept();
        assertFalse(target.isClaimed(N_ADDR + 1), "a late kept signature never pays");

        // A kept signature inside its time pays.
        v7Handler.keepSignature(1, 3600);
        v7Handler.replayKept();
        assertTrue(target.isClaimed(N_ADDR + 1), "a kept signature in time pays");

        // Revoked: handle claims stop, address claims keep going.
        v7Handler.revokeBinder(0);
        v7Handler.claimHandleOne(2, 600);
        assertFalse(target.isClaimed(N_ADDR + 2), "no handle claim while revoked");
        handler.claimOne(6);
        assertTrue(target.isClaimed(6), "an address claim works while revoked");

        // A new binder: handle claims resume.
        v7Handler.setBinderRandom(1);
        v7Handler.claimHandleOne(2, 600);
        assertTrue(target.isClaimed(N_ADDR + 2), "handle claims resume under the new binder");

        assertEq(v7Handler.ghostForgedSucceeded(), 0);
        assertEq(v7Handler.ghostClaimWhileRevoked(), 0);
        assertEq(v7Handler.ghostOutsideWindowSucceeded(), 0);
        assertEq(v7Handler.ghostLateSucceeded(), 0);
        assertEq(target.claimedCount(), handler.ghostClaimCount(), "I14");

        handler.warpForward(20 days);
        handler.warpForward(20 days);
        handler.refund();
        _assertStatus(target, IDropV1.Status.Finalized);
        assertEq(token.balanceOf(address(target)), 0, "I12");

        // A late drop token is swept to the refund address, and still hold.
        handler.fund(2 ether);
        v7Handler.sweepDropAsset();
        assertEq(v7Handler.ghostAssetSweeps(), 1, "the late drop token was swept");
        assertEq(token.balanceOf(address(target)), 0, "I12 after the sweep");
        assertEq(v7Handler.ghostAssetSweptElsewhere(), 0);

        assertEq(
            handler.ghostReceived(),
            target.totalClaimed() + handler.ghostFeePaid() + handler.ghostRefunded() + token.balanceOf(address(target)),
            "I10"
        );
    }
}
