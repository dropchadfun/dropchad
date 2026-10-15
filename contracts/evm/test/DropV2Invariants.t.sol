// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console} from "forge-std/Test.sol";

import {DropInvariantsTest} from "./DropInvariants.t.sol";
import {DropTestBase} from "./DropTestBase.sol";
import {DropV2Handler} from "./DropV2Handler.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV2} from "../src/DropFactoryV2.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV2} from "../src/DropV2.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";

/// @title DropV2InvariantsTest
/// @notice Invariants, on a `DropV2` drop whose tree mixes
///         address and handle leaves, with the binder live, revoked and rotated at random.
/// @dev Every invariant of `DropInvariantsTest` runs here unchanged, except the three that must
///      see the handle leaves too: one counts bits over every leaf, one checks the bound
///      wallets, one checks that a handle leaf pays only its bound wallet. `DropV2Handler` adds
///      real handle claims, forged ones that must never succeed, revokes and binder rotations.
///      The tree: indexes 0 to 7 are address leaves, 8 to 15 handle leaves. Each X id has one
///      bound wallet, so the design stays exact.
contract DropV2InvariantsTest is DropInvariantsTest {
    uint256 internal constant N_ADDR = 8;
    uint256 internal constant N_HANDLE = 8;

    BinderRegistry internal registry;
    DropV2Handler internal v2Handler;

    function _deployImplementation() internal virtual override returns (address) {
        registry = new BinderRegistry(owner);
        return address(new DropV2(address(registry)));
    }

    function _deployFactory() internal virtual override returns (address) {
        return address(new DropFactoryV2(owner, address(implementation), feeRecipient));
    }

    function setUp() public override {
        DropTestBase.setUp();

        // A non zero fee, so the fee term of the design is really exercised. As in the V1 suite.
        vm.prank(owner);
        factory.setDefaultFeeBps(250);

        token = new MockERC20("Drop Token", "DROP", 18);
        address tokenFactory = _allowToken(address(token));

        DropV2Handler.HandleSetup memory hs = _mixedTree();
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

        v2Handler = new DropV2Handler(
            DropV2Handler.BaseSetup({
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
        handler = v2Handler;

        targetContract(address(handler));
    }

    // -----------------------------------------------------------------------
    // the mixed tree
    // -----------------------------------------------------------------------

    uint256[] internal hXIds;
    uint256[] internal hAmts;
    address[] internal hWallets;

    /// @dev Fills the base crowd with the address leaves and keeps the handle leaves here.
    ///      The leaves themselves are built in `_createMixedDrop`, against the predicted address.
    function _mixedTree() internal returns (DropV2Handler.HandleSetup memory hs) {
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
    ///      wallet, each exactly its amount and only once claimed. The outsiders, which the forged
    ///      claims try to redirect to, and both binder addresses are never paid.
    function invariant_PayoutsOnlyGoToLeafRecipients() public view override {
        for (uint256 i = 0; i < N_ADDR; i++) {
            uint256 balance = token.balanceOf(recipients[i]);
            assertEq(balance, target.isClaimed(i) ? amounts[i] : 0, "I15. address leaf");
        }
        for (uint256 j = 0; j < N_HANDLE; j++) {
            uint256 balance = token.balanceOf(hWallets[j]);
            assertEq(balance, target.isClaimed(N_ADDR + j) ? hAmts[j] : 0, "I15. handle leaf, bound wallet");
            assertEq(balance, v2Handler.ghostHandlePaid(j), "I15. and what the handler saw");
        }
        for (uint256 i = 0; i < handler.outsiderCount(); i++) {
            assertEq(token.balanceOf(handler.outsiderAt(i)), 0, "I15. nobody outside the tree is ever paid");
        }
        assertEq(token.balanceOf(v2Handler.binderA()), 0, "I15. never the binder");
        assertEq(token.balanceOf(v2Handler.binderB()), 0, "I15. never the binder");
    }

    /// @dev No handle claim ever went through while the registry said
    ///      revoked, and no forged handle claim ever went through at all.
    function invariant_NoForgedOrRevokedHandleClaim() public view {
        assertEq(v2Handler.ghostClaimWhileRevoked(), 0, "a handle claim went through while revoked");
        assertEq(v2Handler.ghostForgedSucceeded(), 0, "a forged handle claim went through");
    }

    /// @dev Not an invariant, a report of the handle actions. See `invariant_CallSummary`.
    function invariant_CallSummaryV2() public view {
        console.log("claimHandleOne   ", handler.calls("claimHandleOne"));
        console.log("claimHandleForged", handler.calls("claimHandleForged"));
        console.log("revokeBinder     ", handler.calls("revokeBinder"));
        console.log("setBinderRandom  ", handler.calls("setBinderRandom"));
        console.log("adminPokeV2      ", handler.calls("adminPokeV2"));
        console.log("handle claims ok ", v2Handler.ghostHandleClaims());
    }

    /// @dev The guard on the test itself: a hand driven run through every handle path.
    function test_Handler_ReachesEveryState() public override {
        _assertStatus(target, IDropV1.Status.Created);

        handler.overfund(target.grossRequired());
        handler.activate();
        _assertStatus(target, IDropV1.Status.Active);

        // An address claim, a batch, a handle claim.
        handler.claimOne(0);
        handler.claimBatchRandom(1, 3);
        v2Handler.claimHandleOne(0);
        assertTrue(target.isClaimed(N_ADDR), "the first handle leaf was claimed");

        // Every forged mode fails and pays nobody.
        for (uint256 mode = 0; mode < 4; mode++) {
            v2Handler.claimHandleForged(1, mode);
        }
        assertFalse(target.isClaimed(N_ADDR + 1), "no forged claim went through");

        // Revoked: handle claims stop, address claims keep going.
        v2Handler.revokeBinder(0);
        v2Handler.claimHandleOne(1);
        assertFalse(target.isClaimed(N_ADDR + 1), "no handle claim while revoked");
        handler.claimOne(6);
        assertTrue(target.isClaimed(6), "an address claim works while revoked");

        // A new binder: handle claims resume, signed by the new key.
        v2Handler.setBinderRandom(1);
        v2Handler.claimHandleOne(1);
        assertTrue(target.isClaimed(N_ADDR + 1), "handle claims resume under the new binder");
        assertEq(v2Handler.ghostForgedSucceeded(), 0);
        assertEq(v2Handler.ghostClaimWhileRevoked(), 0);

        assertEq(target.claimedCount(), handler.ghostClaimCount(), "I14");

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
