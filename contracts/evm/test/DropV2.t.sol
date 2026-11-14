// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

import {DropTestBase} from "./DropTestBase.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {ReentrantEthReceiver} from "./ReentrantEthReceiver.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV2} from "../src/DropFactoryV2.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV2} from "../src/DropV2.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropV2} from "../src/IDropV2.sol";

/// @title DropV2Test
/// @notice `claimHandle`, the binding and the live binder.
/// @dev Each test comment names the rule it must fail on if that rule is removed.
///      Handle trees are built here from `MerkleHelper.handleLeafOf`, which is written from the
///      frame, not from `DropV2`.
contract DropV2Test is DropTestBase {
    BinderRegistry internal registry;

    address internal binder;
    uint256 internal binderKey;
    address internal otherSigner;
    uint256 internal otherKey;

    address internal alice = makeAddr("alice wallet");
    address internal bob = makeAddr("bob wallet");

    /// @dev The current handle tree. Rebuilt by every `_createHandleDrop`.
    uint256[] internal xIds;
    uint256[] internal hAmounts;
    bytes32[] internal hLeaves;

    uint256 internal constant X_ALICE = 44_196_397; // an X id shape, a 64 bit snowflake fits too
    uint256 internal constant X_BOB = 1_600_000_000_000_000_000;

    function _deployImplementation() internal virtual override returns (address) {
        registry = new BinderRegistry(owner);
        return address(new DropV2(address(registry)));
    }

    function _deployFactory() internal virtual override returns (address) {
        return address(new DropFactoryV2(owner, address(implementation), feeRecipient));
    }

    function setUp() public override {
        super.setUp();
        (binder, binderKey) = makeAddrAndKey("binder");
        (otherSigner, otherKey) = makeAddrAndKey("not the binder");

        vm.prank(owner);
        registry.setBinder(binder);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// @dev A handle drop over `ids`, sorted ascending by the caller. Predict, build,
    ///      create, in the order.
    function _createHandleDrop(
        address asset,
        address tokenFactory,
        uint256 nonce,
        uint256[] memory ids,
        uint256[] memory a
    ) internal returns (DropV2 drop) {
        bytes32 commitment = _commitment(nonce);
        address predicted = factory.predictDrop(relayer, commitment, nonce);

        delete xIds;
        delete hAmounts;
        delete hLeaves;
        uint256 total;
        for (uint256 i = 0; i < ids.length; i++) {
            if (i > 0) require(ids[i] > ids[i - 1], "ids must be ascending");
            xIds.push(ids[i]);
            hAmounts.push(a[i]);
            hLeaves.push(MerkleHelper.handleLeafOf(predicted, block.chainid, i, ids[i], a[i]));
            total += a[i];
        }

        IDropFactoryV1.CreateParams memory p = IDropFactoryV1.CreateParams({
            asset: asset,
            merkleRoot: MerkleHelper.rootOf(hLeaves),
            manifestHash: MANIFEST_HASH,
            totalEntitlements: total,
            leafCount: uint32(ids.length),
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
        drop = DropV2(payable(created));
    }

    /// @dev Two handle leaves, alice 1 ether and bob 2 ether, native, activated.
    function _activeHandleDrop() internal returns (DropV2 drop) {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory a = new uint256[](2);
        ids[0] = X_ALICE;
        ids[1] = X_BOB;
        a[0] = 1 ether;
        a[1] = 2 ether;
        drop = _createHandleDrop(address(0), address(0), 0, ids, a);
        _activateNative(DropV1(payable(address(drop))));
    }

    function _hProof(uint256 index) internal view returns (bytes32[] memory) {
        return MerkleHelper.proofOf(hLeaves, index);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _binding(DropV2 drop, uint256 index, uint256 xId, address recipient) internal view returns (bytes memory) {
        return _sign(binderKey, drop.bindingDigest(index, xId, recipient));
    }

    /// @dev Claims leaf `index` of the current handle tree to `recipient`, sent by the relayer.
    function _claimHandle(DropV2 drop, uint256 index, address recipient) internal {
        bytes memory sig = _binding(drop, index, xIds[index], recipient);
        vm.prank(relayer);
        drop.claimHandle(index, xIds[index], hAmounts[index], recipient, _hProof(index), sig);
    }

    // -----------------------------------------------------------------------
    // constructor and views
    // -----------------------------------------------------------------------

    /// @dev The registry is fixed in the implementation and shared by every clone.
    function test_V2_RegistryIsImmutableAndShared() public {
        DropV2 drop = _activeHandleDrop();
        assertEq(address(DropV2(payable(address(implementation))).BINDER_REGISTRY()), address(registry));
        assertEq(address(drop.BINDER_REGISTRY()), address(registry), "the clone reads the same registry");
    }

    /// @dev A zero registry would make every handle claim revert forever. Refused at deploy.
    function test_V2_Constructor_RevertsOnZeroRegistry() public {
        vm.expectRevert(IDropV2.ZeroRegistry.selector);
        new DropV2(address(0));
    }

    /// @dev still holds on V2: the implementation cannot be initialized.
    function test_V2_ImplementationIsInitialized() public {
        IDropV1.InitParams memory p; // the flag is checked first, so any params will do
        vm.expectRevert(IDropV1.AlreadyInitialized.selector);
        DropV2(payable(address(implementation))).initialize(p);
    }

    /// @dev The tag constant is the string, byte for byte.
    function test_V2_HandleLeafTag() public view {
        assertEq(DropV2(payable(address(implementation))).HANDLE_LEAF_TAG(), keccak256("dropchad:handle-leaf:v1"));
    }

    /// @dev The digest is plain EIP 712, rebuilt here by hand from the text: domain
    ///      `name "dropchad"`, `version "1"`, this chain, this drop; type
    ///      `Binding(uint256 index,uint256 xId,address recipient)`. The api signs the same bytes.
    function test_V2_BindingDigestIsEip712() public {
        DropV2 drop = _activeHandleDrop();
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("dropchad")),
                keccak256(bytes("1")),
                block.chainid,
                address(drop)
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(keccak256("Binding(uint256 index,uint256 xId,address recipient)"), 1, X_BOB, bob));
        bytes32 expected = keccak256(abi.encodePacked(hex"1901", domain, structHash));
        assertEq(drop.bindingDigest(1, X_BOB, bob), expected);
    }

    // -----------------------------------------------------------------------
    // claimHandle, happy path
    // -----------------------------------------------------------------------

    /// @dev Paid to the bound address, bit set, counters moved, `HandleClaimed`
    ///      emitted and `Claimed` not.
    function test_V2_ClaimHandle_HappyPath() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(0);

        vm.recordLogs();
        vm.prank(relayer);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, sig);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(alice.balance, 1 ether, "paid to the bound address");
        assertEq(relayer.balance, 0, "never to the caller");
        assertTrue(drop.isClaimed(0));
        assertEq(drop.claimedCount(), 1);
        assertEq(drop.totalClaimed(), 1 ether);

        uint256 handleClaimed;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(drop)) continue;
            assertTrue(logs[i].topics[0] != IDropV1.Claimed.selector, "no Claimed from claimHandle");
            if (logs[i].topics[0] == IDropV2.HandleClaimed.selector) {
                handleClaimed++;
                assertEq(logs[i].topics[1], bytes32(uint256(0)), "index");
                assertEq(logs[i].topics[2], bytes32(X_ALICE), "xId");
                assertEq(logs[i].topics[3], bytes32(uint256(uint160(alice))), "recipient");
                assertEq(abi.decode(logs[i].data, (uint256)), 1 ether, "amount");
            }
        }
        assertEq(handleClaimed, 1, "exactly one HandleClaimed");
    }

    /// @dev Anybody may send the claim; a stranger with a valid binding still pays alice.
    function test_V2_ClaimHandle_AnyCallerPaysTheBoundAddress() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(0);

        vm.prank(stranger);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, sig);
        assertEq(alice.balance, 1 ether);
        assertEq(stranger.balance, 0);
    }

    /// @dev with an ERC20 asset. The payout goes through `SafeERC20` like `claim`.
    function test_V2_ClaimHandle_Erc20() public {
        MockERC20 token = new MockERC20("Drop Token", "DROP", 18);
        address tokenFactory = _allowToken(address(token));
        uint256[] memory ids = new uint256[](1);
        uint256[] memory a = new uint256[](1);
        ids[0] = X_ALICE;
        a[0] = 5 ether;
        DropV2 drop = _createHandleDrop(address(token), tokenFactory, 0, ids, a);
        _activateErc20(token, DropV1(payable(address(drop))));

        _claimHandle(drop, 0, alice);
        assertEq(token.balanceOf(alice), 5 ether);
    }

    // -----------------------------------------------------------------------
    // the binder
    // -----------------------------------------------------------------------

    /// @dev Revoked: every handle claim stops.
    function test_V2_ClaimHandle_RevertsWhenRevoked() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(0);

        vm.prank(owner);
        registry.revoke();

        vm.expectRevert(IDropV2.BinderIsRevoked.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, sig);
    }

    /// @dev No binder set: every handle claim fails.
    function test_V2_ClaimHandle_RevertsWithNoBinder() public {
        // `setBinder` refuses zero, so a registry with no binder is its deployed state. Slot 1
        // holds `binder` and `revoked`, after `Ownable`'s owner in slot 0.
        vm.store(address(registry), bytes32(uint256(1)), bytes32(0));
        assertEq(registry.binder(), address(0));

        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.NoBinder.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, sig);
    }

    /// @dev Read live: after a rotation, the old key's binding fails on an existing drop
    ///      and the new key's binding works. Nothing was frozen into the drop.
    function test_V2_ClaimHandle_BinderIsReadLive() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory oldSig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(0);

        vm.prank(owner);
        registry.setBinder(otherSigner);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, oldSig);

        bytes memory newSig = _sign(otherKey, drop.bindingDigest(0, X_ALICE, alice));
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, newSig);
        assertEq(alice.balance, 1 ether);
    }

    /// @dev the leak playbook step 5: a new `setBinder` after a revoke resumes claims.
    function test_V2_ClaimHandle_ResumesAfterNewBinder() public {
        DropV2 drop = _activeHandleDrop();
        vm.startPrank(owner);
        registry.revoke();
        registry.setBinder(binder);
        vm.stopPrank();

        _claimHandle(drop, 0, alice);
        assertEq(alice.balance, 1 ether);
    }

    /// @dev While revoked, address leaves keep working: `claim` never reads the registry.
    function test_V2_AddressClaimsIgnoreTheRegistry() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.prank(owner);
        registry.revoke();

        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(recipients[0].balance, amounts[0], "an address leaf pays while the binder is revoked");
    }

    // -----------------------------------------------------------------------
    // the binding
    // -----------------------------------------------------------------------

    /// @dev A signature by anybody but the binder is refused.
    function test_V2_ClaimHandle_RevertsOnWrongSigner() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _sign(otherKey, drop.bindingDigest(0, X_ALICE, alice));
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, sig);
    }

    /// @dev The binding fixes where. A binding for alice cannot pay bob.
    function test_V2_ClaimHandle_RevertsOnSwappedRecipient() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, bob, proof, sig);
    }

    /// @dev A binding is for one leaf. Leaf 0's binding cannot claim leaf 1.
    function test_V2_ClaimHandle_RevertsOnBindingForAnotherLeaf() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(1);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(1, X_BOB, 2 ether, alice, proof, sig);
    }

    /// @dev The domain holds the drop: a binding from drop A is refused on drop B
    ///      for the same index, X id and recipient.
    function test_V2_ClaimHandle_RevertsOnBindingFromAnotherDrop() public {
        DropV2 a = _activeHandleDrop();
        bytes memory sigForA = _binding(a, 0, X_ALICE, alice);

        uint256[] memory ids = new uint256[](2);
        uint256[] memory amts = new uint256[](2);
        ids[0] = X_ALICE;
        ids[1] = X_BOB;
        amts[0] = 1 ether;
        amts[1] = 2 ether;
        DropV2 b = _createHandleDrop(address(0), address(0), 1, ids, amts);
        _activateNative(DropV1(payable(address(b))));
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadBinding.selector);
        b.claimHandle(0, X_ALICE, 1 ether, alice, proof, sigForA);
    }

    /// @dev The domain holds the chain id: the same drop on another chain is another digest.
    function test_V2_BindingDigestChangesWithChain() public {
        DropV2 drop = _activeHandleDrop();
        bytes32 here = drop.bindingDigest(0, X_ALICE, alice);
        vm.chainId(block.chainid + 1);
        assertTrue(drop.bindingDigest(0, X_ALICE, alice) != here);
    }

    /// @dev OpenZeppelin refuses the high `s` twin of a valid signature, and any length but 65.
    ///      A binding has exactly one valid encoding.
    function test_V2_ClaimHandle_RevertsOnMalleableOrShortSignature() public {
        DropV2 drop = _activeHandleDrop();
        bytes32 digest = drop.bindingDigest(0, X_ALICE, alice);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(binderKey, digest);
        bytes32[] memory proof = _hProof(0);

        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory highS = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, highS);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, abi.encodePacked(r, s));
    }

    // -----------------------------------------------------------------------
    // the leaf
    // -----------------------------------------------------------------------

    /// @dev `xId` zero is refused before the leaf is looked at.
    function test_V2_ClaimHandle_RevertsOnZeroXId() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, 0, alice);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadXId.selector);
        drop.claimHandle(0, 0, 1 ether, alice, proof, sig);
    }

    /// @dev `2^64` is refused, `2^64 - 1` is the largest X id a leaf may hold.
    function test_V2_ClaimHandle_XIdBounds() public {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory a = new uint256[](1);
        ids[0] = type(uint64).max;
        a[0] = 1 ether;
        DropV2 drop = _createHandleDrop(address(0), address(0), 0, ids, a);
        _activateNative(DropV1(payable(address(drop))));

        uint256 tooBig = uint256(type(uint64).max) + 1;
        bytes memory bad = _binding(drop, 0, tooBig, alice);
        bytes32[] memory proof = _hProof(0);
        vm.expectRevert(IDropV2.BadXId.selector);
        drop.claimHandle(0, tooBig, 1 ether, alice, proof, bad);

        _claimHandle(drop, 0, alice);
        assertEq(alice.balance, 1 ether, "2^64 - 1 is a valid X id");
    }

    /// @dev A zero recipient would burn the payout.
    function test_V2_ClaimHandle_RevertsOnZeroRecipient() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, address(0));
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.ZeroRecipient.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, address(0), proof, sig);
    }

    /// @dev The proof fixes how much: a valid binding with an inflated amount fails.
    function test_V2_ClaimHandle_RevertsOnWrongAmount() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claimHandle(0, X_ALICE, 2 ether, alice, proof, sig);
    }

    /// @dev The proof fixes who: a valid binding for an X id not in the tree fails.
    function test_V2_ClaimHandle_RevertsOnXIdNotInTree() public {
        DropV2 drop = _activeHandleDrop();
        uint256 outsider = 999;
        bytes memory sig = _binding(drop, 0, outsider, alice);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claimHandle(0, outsider, 1 ether, alice, proof, sig);
    }

    /// @dev Claimed once, never again, and never to a new address.
    function test_V2_ClaimHandle_RevertsWhenAlreadyClaimed() public {
        DropV2 drop = _activeHandleDrop();
        _claimHandle(drop, 0, alice);

        bytes memory rebind = _binding(drop, 0, X_ALICE, bob);
        bytes32[] memory proof = _hProof(0);
        vm.expectRevert(IDropV1.AlreadyClaimed.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, bob, proof, rebind);
        assertEq(bob.balance, 0);
    }

    /// @dev A handle leaf given to `claim` fails the proof, whatever address is
    ///      put in the X id's place.
    function test_V2_HandleLeafFailsInClaim() public {
        DropV2 drop = _activeHandleDrop();
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claim(0, address(uint160(X_ALICE)), 1 ether, proof);
    }

    /// @dev A handle leaf given to `claimBatch` reverts the batch.
    function test_V2_HandleLeafFailsInClaimBatch() public {
        DropV2 drop = _activeHandleDrop();
        IDropV1.ClaimItem[] memory items = new IDropV1.ClaimItem[](1);
        items[0] =
            IDropV1.ClaimItem({index: 0, recipient: address(uint160(X_ALICE)), amount: 1 ether, proof: _hProof(0)});

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claimBatch(items);
    }

    /// @dev An address leaf given to `claimHandle` fails the proof, even with a
    ///      valid binding and the address's number in the X id's place.
    function test_V2_AddressLeafFailsInClaimHandle() public {
        (address[] memory r, uint256[] memory a) = _defaultCrowd(2);
        r[0] = address(uint160(X_ALICE)); // small enough to pass the xId range check
        DropV1 asV1 = _createNativeDropFor(r, a);
        _activateNative(asV1);
        DropV2 drop = DropV2(payable(address(asV1)));

        uint256 idx = recipients[0] == address(uint160(X_ALICE)) ? 0 : 1;
        uint256 asXId = uint256(uint160(recipients[idx]));
        bytes memory sig = _binding(drop, idx, asXId, alice);
        bytes32[] memory proof = _proof(idx);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claimHandle(idx, asXId, amounts[idx], alice, proof, sig);
    }

    // -----------------------------------------------------------------------
    // status and window, as `claim`
    // -----------------------------------------------------------------------

    /// @dev Not before activation.
    function test_V2_ClaimHandle_RevertsBeforeActivation() public {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory a = new uint256[](1);
        ids[0] = X_ALICE;
        a[0] = 1 ether;
        DropV2 drop = _createHandleDrop(address(0), address(0), 0, ids, a);
        bytes memory sig = _binding(drop, 0, X_ALICE, alice);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, proof, sig);
    }

    /// @dev Exactly at the deadline it works, one second later it does not.
    function test_V2_ClaimHandle_ClaimWindow() public {
        DropV2 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 1, X_BOB, bob);
        bytes32[] memory proof = _hProof(1);

        vm.warp(drop.claimDeadline());
        _claimHandle(drop, 0, alice);

        vm.warp(uint256(drop.claimDeadline()) + 1);
        vm.expectRevert(IDropV1.ClaimWindowClosed.selector);
        drop.claimHandle(1, X_BOB, 2 ether, bob, proof, sig);
    }

    // -----------------------------------------------------------------------
    // reentrancy
    // -----------------------------------------------------------------------

    /// @dev A recipient that reenters `claimHandle` for its own leaf from
    ///      `receive` is stopped by the guard and paid once.
    function test_V2_ClaimHandle_ReentrancyPaysOnce() public {
        DropV2 drop = _activeHandleDrop();
        ReentrantEthReceiver evil = new ReentrantEthReceiver();
        bytes memory sig = _binding(drop, 0, X_ALICE, address(evil));
        bytes32[] memory proof = _hProof(0);
        evil.setReentry(
            address(drop), abi.encodeCall(IDropV2.claimHandle, (0, X_ALICE, 1 ether, address(evil), proof, sig))
        );

        drop.claimHandle(0, X_ALICE, 1 ether, address(evil), proof, sig);

        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded(), "the reentry must fail");
        assertEq(evil.received(), 1 ether, "paid exactly once");
    }

    // -----------------------------------------------------------------------
    // conservation
    // -----------------------------------------------------------------------

    /// @dev the core invariant: claims plus refund equal what was funded minus the fee,
    ///      for a tree that mixes address and handle leaves, whatever gets claimed.
    function testFuzz_V2_MixedTreeConserves(uint8 nAddr, uint8 nHandle, uint256 claimMask) public {
        nAddr = uint8(bound(nAddr, 1, 6));
        nHandle = uint8(bound(nHandle, 1, 6));
        uint256 n = uint256(nAddr) + nHandle;

        uint256 nonce = 7;
        bytes32 commitment = _commitment(nonce);
        address predicted = factory.predictDrop(relayer, commitment, nonce);

        bytes32[] memory all = new bytes32[](n);
        uint256[] memory amt = new uint256[](n);
        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            amt[i] = (i + 1) * 0.1 ether;
            total += amt[i];
            all[i] = i < nAddr
                ? MerkleHelper.leafOf(predicted, block.chainid, i, address(uint160(0x3001 + i)), amt[i])
                : MerkleHelper.handleLeafOf(predicted, block.chainid, i, 5000 + i, amt[i]);
        }

        IDropFactoryV1.CreateParams memory p = IDropFactoryV1.CreateParams({
            asset: address(0),
            merkleRoot: MerkleHelper.rootOf(all),
            manifestHash: MANIFEST_HASH,
            totalEntitlements: total,
            leafCount: uint32(n),
            refundRecipient: refundRecipient,
            creatorCommitment: commitment,
            nonce: nonce,
            fundingPeriod: FUNDING_PERIOD,
            claimPeriod: CLAIM_PERIOD,
            tokenFactory: address(0)
        });
        vm.prank(relayer);
        DropV2 drop = DropV2(payable(_sendCreateDrop(p)));
        _activateNative(DropV1(payable(address(drop))));

        uint256 paid;
        for (uint256 i = 0; i < n; i++) {
            if ((claimMask >> i) & 1 == 0) continue;
            bytes32[] memory proof = MerkleHelper.proofOf(all, i);
            if (i < nAddr) {
                drop.claim(i, address(uint160(0x3001 + i)), amt[i], proof);
            } else {
                address to = address(uint160(0x4001 + i));
                bytes memory sig = _binding(drop, i, 5000 + i, to);
                drop.claimHandle(i, 5000 + i, amt[i], to, proof, sig);
            }
            paid += amt[i];
        }
        assertEq(drop.totalClaimed(), paid);

        vm.warp(uint256(drop.claimDeadline()) + 1);
        uint256 before = refundRecipient.balance;
        drop.refund();
        assertEq(paid + (refundRecipient.balance - before), total, "claims plus refund equal total");
        assertEq(address(drop).balance, 0);
    }
}

