// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

import {V7TestBase} from "./V7TestBase.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {ReentrantEthReceiver} from "./ReentrantEthReceiver.sol";

import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {DropV7} from "../src/DropV7.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropV2} from "../src/IDropV2.sol";
import {IDropV7} from "../src/IDropV7.sol";

/// @title DropV7Test
/// @notice What `DropV7` changes in `DropV6`.
///         1. Binding v2: `claimHandle` takes `validUntil`, refused after it (`BindingExpired`)
///            and more than `MAX_BINDING_LIFETIME` ahead (`BindingTooLong`).
///         2. `bindingDigest(index, xId, recipient, validUntil)`, the v2 EIP 712 digest.
///         3: `sweep` takes the drop asset once the drop is finished.
///         The `DropV2` handle suite calls the old `claimHandle`, so its cases are written here
///         again on binding v2. `DropV7Parity.t.sol` runs every other suite against `DropV7`.
contract DropV7Test is V7TestBase {
    address internal binder;
    uint256 internal binderKey;
    address internal otherSigner;
    uint256 internal otherKey;

    address internal alice = makeAddr("alice wallet");
    address internal bob = makeAddr("bob wallet");

    uint256 internal constant X_ALICE = 44_196_397;
    uint256 internal constant X_BOB = 1_600_000_000_000_000_000;
    uint256 internal constant LIFETIME = 3600;
    /// @dev The api signs 600 seconds ahead.2.
    uint64 internal constant AHEAD = 600;

    /// @dev The current handle tree. Rebuilt by every `_createHandleDrop`.
    uint256[] internal xIds;
    uint256[] internal hAmounts;
    bytes32[] internal hLeaves;

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

    /// @dev A handle drop over `ids`, ascending. Predict, build, create.
    function _createHandleDrop(address asset, uint256 nonce, uint256[] memory ids, uint256[] memory a, uint256 fee)
        internal
        returns (DropV7 drop)
    {
        bytes32 commitment = _commitment(nonce);
        address predicted = factory.predictDrop(relayer, commitment, nonce);

        delete xIds;
        delete hAmounts;
        delete hLeaves;
        uint256 total;
        for (uint256 i = 0; i < ids.length; i++) {
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
            tokenFactory: address(0)
        });
        nativeFeeNext = fee;
        vm.prank(relayer);
        address created = _sendCreateDrop(p);
        nativeFeeNext = 0;
        assertEq(created, predicted, "");
        drop = DropV7(payable(created));
    }

    function _twoIds() internal pure returns (uint256[] memory ids, uint256[] memory a) {
        ids = new uint256[](2);
        a = new uint256[](2);
        ids[0] = X_ALICE;
        ids[1] = X_BOB;
        a[0] = 1 ether;
        a[1] = 2 ether;
    }

    /// @dev Two handle leaves, alice 1 ether and bob 2 ether, native, activated.
    function _activeHandleDrop() internal returns (DropV7 drop) {
        (uint256[] memory ids, uint256[] memory a) = _twoIds();
        drop = _createHandleDrop(address(0), 0, ids, a, 0);
        _activateNative(DropV1(payable(address(drop))));
    }

    function _hProof(uint256 index) internal view returns (bytes32[] memory) {
        return MerkleHelper.proofOf(hLeaves, index);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _until() internal view returns (uint64) {
        return uint64(block.timestamp) + AHEAD;
    }

    function _binding(DropV7 drop, uint256 index, uint256 xId, address to, uint64 validUntil)
        internal
        view
        returns (bytes memory)
    {
        return _sign(binderKey, drop.bindingDigest(index, xId, to, validUntil));
    }

    /// @dev built by hand from the text, never from the contract.
    function _domain(address drop) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("dropchad")),
                keccak256(bytes("1")),
                block.chainid,
                drop
            )
        );
    }

    function _v2Digest(address drop, uint256 index, uint256 xId, address to, uint64 validUntil)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Binding(uint256 index,uint256 xId,address recipient,uint64 validUntil)"),
                index,
                xId,
                to,
                validUntil
            )
        );
        return keccak256(abi.encodePacked(hex"1901", _domain(drop), structHash));
    }

    function _v1Digest(address drop, uint256 index, uint256 xId, address to) internal view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(keccak256("Binding(uint256 index,uint256 xId,address recipient)"), index, xId, to));
        return keccak256(abi.encodePacked(hex"1901", _domain(drop), structHash));
    }

    /// @dev Claims leaf `index` to `to` with a binding valid until `validUntil`, sent by the relayer.
    function _claimHandle(DropV7 drop, uint256 index, address to, uint64 validUntil) internal {
        bytes memory sig = _binding(drop, index, xIds[index], to, validUntil);
        bytes32[] memory proof = _hProof(index);
        vm.prank(relayer);
        drop.claimHandle(index, xIds[index], hAmounts[index], to, validUntil, proof, sig);
    }

    // -----------------------------------------------------------------------
    // views.2 and 1.3
    // -----------------------------------------------------------------------

    /// @dev One hour.
    function test_V7_MaxBindingLifetime_IsOneHour() public view {
        assertEq(DropV7(payable(address(implementation))).MAX_BINDING_LIFETIME(), LIFETIME);
    }

    /// @dev The v2 digest, rebuilt by hand from the text.
    function test_V7_BindingDigestIsEip712V2() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        assertEq(drop.bindingDigest(1, X_BOB, bob, until), _v2Digest(address(drop), 1, X_BOB, bob, until));
    }

    /// @dev `validUntil` is signed: another time is another digest.
    function test_V7_BindingDigestChangesWithValidUntil() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        assertTrue(drop.bindingDigest(0, X_ALICE, alice, until) != drop.bindingDigest(0, X_ALICE, alice, until + 1));
    }

    /// @dev A v2 digest is never the v1 digest of the same leaf and address.
    function test_V7_BindingDigestIsNotV1() public {
        DropV7 drop = _activeHandleDrop();
        assertTrue(drop.bindingDigest(0, X_ALICE, alice, _until()) != _v1Digest(address(drop), 0, X_ALICE, alice));
    }

    /// @dev The domain holds the chain id.
    function test_V7_BindingDigestChangesWithChain() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes32 here = drop.bindingDigest(0, X_ALICE, alice, until);
        vm.chainId(block.chainid + 1);
        assertTrue(drop.bindingDigest(0, X_ALICE, alice, until) != here);
    }

    /// @dev The six argument `claimHandle` of `IDropV2` is gone: its selector
    ///      reaches no function, and there is no fallback.
    function test_V7_RevertWhen_OldClaimHandleSelector() public {
        DropV7 drop = _activeHandleDrop();
        bytes memory sig = _sign(binderKey, _v1Digest(address(drop), 0, X_ALICE, alice));
        (bool ok,) =
            address(drop).call(abi.encodeCall(IDropV2.claimHandle, (0, X_ALICE, 1 ether, alice, _hProof(0), sig)));
        assertFalse(ok);
        assertFalse(drop.isClaimed(0));
        assertEq(alice.balance, 0);
    }

    // -----------------------------------------------------------------------
    // claimHandle, the happy path
    // -----------------------------------------------------------------------

    /// @dev Paid to the bound address, bit set, counters moved,
    ///      `HandleClaimed` and no `Claimed`.
    function test_V7_ClaimHandle_HappyPath() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.recordLogs();
        vm.prank(relayer);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(alice.balance, 1 ether, "paid to the bound address");
        assertEq(relayer.balance, 0, "never to the caller");
        assertTrue(drop.isClaimed(0));
        assertEq(drop.claimedCount(), 1);
        assertEq(drop.totalClaimed(), 1 ether);

        uint256 handleClaimed;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(drop)) continue;
            assertTrue(logs[i].topics[0] != IDropV1.Claimed.selector, "no Claimed");
            if (logs[i].topics[0] == IDropV7.HandleClaimed.selector) {
                handleClaimed++;
                assertEq(logs[i].topics[1], bytes32(uint256(0)), "index");
                assertEq(logs[i].topics[2], bytes32(X_ALICE), "xId");
                assertEq(logs[i].topics[3], bytes32(uint256(uint160(alice))), "recipient");
                assertEq(abi.decode(logs[i].data, (uint256)), 1 ether, "amount");
            }
        }
        assertEq(handleClaimed, 1, "exactly one HandleClaimed");
    }

    /// @dev Anybody may send it; a stranger with a valid binding still pays alice.
    function test_V7_ClaimHandle_AnyCallerPaysTheBoundAddress() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.prank(stranger);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
        assertEq(alice.balance, 1 ether);
        assertEq(stranger.balance, 0);
    }

    /// @dev on a token drop: the bound wallet gets the tokens.
    function test_V7_ClaimHandle_TokenDrop() public {
        MockERC20 token = new MockERC20("Test Coin", "TEST", 18);
        _allowTokenByAddress(address(token));
        (uint256[] memory ids, uint256[] memory a) = _twoIds();
        DropV7 drop = _createHandleDrop(address(token), 0, ids, a, ETH_FEE);
        _activateTokenDrop(DropV3(payable(address(drop))), token);

        _claimHandle(drop, 1, bob, _until());
        assertEq(token.balanceOf(bob), 2 ether, "the bound wallet got the tokens");
        assertEq(bob.balance, 0, "and no ETH");
    }

    // -----------------------------------------------------------------------
    // the time limit.1
    // -----------------------------------------------------------------------

    /// @dev At `block.timestamp == validUntil` the claim still works.
    function test_V7_ClaimHandle_AtValidUntilStillPays() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.warp(until);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
        assertEq(alice.balance, 1 ether);
    }

    /// @dev One second after `validUntil` it is `BindingExpired`.
    function test_V7_RevertWhen_ClaimHandle_OneSecondAfterValidUntil() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.warp(uint256(until) + 1);
        vm.expectRevert(IDropV7.BindingExpired.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
        assertFalse(drop.isClaimed(0));
        assertEq(alice.balance, 0);
    }

    /// @dev Exactly `MAX_BINDING_LIFETIME` ahead is allowed.
    function test_V7_ClaimHandle_AtMaxLifetimePays() public {
        DropV7 drop = _activeHandleDrop();
        _claimHandle(drop, 0, alice, uint64(block.timestamp + LIFETIME));
        assertEq(alice.balance, 1 ether);
    }

    /// @dev One second more than `MAX_BINDING_LIFETIME` ahead is `BindingTooLong`,
    ///      even with a valid signature.
    function test_V7_RevertWhen_ClaimHandle_PastMaxLifetime() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = uint64(block.timestamp + LIFETIME + 1);
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV7.BindingTooLong.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
        assertFalse(drop.isClaimed(0));
    }

    /// @dev A far future binding stays refused until it is within the hour.
    function test_V7_RevertWhen_ClaimHandle_MaxUint64ValidUntil() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = type(uint64).max;
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV7.BindingTooLong.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
    }

    /// @dev `validUntil` is under the signature: a later time with the same signature is
    ///      `BadBinding`, so nobody can stretch a binding.
    function test_V7_RevertWhen_ClaimHandle_ValidUntilChanged() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until + 1, proof, sig);
    }

    /// @dev A v1 binding never verifies on a `DropV7`.
    function test_V7_RevertWhen_ClaimHandle_V1Signature() public {
        DropV7 drop = _activeHandleDrop();
        bytes memory sig = _sign(binderKey, _v1Digest(address(drop), 0, X_ALICE, alice));
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, _until(), proof, sig);
        assertFalse(drop.isClaimed(0));
    }

    /// @dev The order: the time comes before the binder: expired while revoked
    ///      is `BindingExpired`.
    function test_V7_RevertWhen_ClaimHandle_ExpiredBeforeBinderCheck() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);
        vm.prank(owner);
        registry.revoke();

        vm.warp(uint256(until) + 1);
        vm.expectRevert(IDropV7.BindingExpired.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
    }

    /// @dev The order: too long comes before the signature check: a garbage
    ///      signature far ahead is `BindingTooLong`.
    function test_V7_RevertWhen_ClaimHandle_TooLongBeforeSignature() public {
        DropV7 drop = _activeHandleDrop();
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV7.BindingTooLong.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, uint64(block.timestamp + LIFETIME + 1), proof, "");
    }

    /// @dev The order: `AlreadyClaimed` comes before the time.
    function test_V7_RevertWhen_ClaimHandle_AlreadyClaimedBeforeExpiry() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        _claimHandle(drop, 0, alice, until);
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.warp(uint256(until) + 1);
        vm.expectRevert(IDropV1.AlreadyClaimed.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
    }

    /// @dev The order: `BadIndex` comes before the time.
    function test_V7_RevertWhen_ClaimHandle_BadIndexBeforeExpiry() public {
        DropV7 drop = _activeHandleDrop();
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV7.BadIndex.selector);
        drop.claimHandle(5, X_ALICE, 1 ether, alice, 0, proof, "");
    }

    /// @dev For every `validUntil` the claim pays exactly inside
    ///      `[now, now + MAX_BINDING_LIFETIME]`, and names the right error outside it.
    function testFuzz_V7_ClaimHandle_ValidUntilWindow(uint64 until) public {
        DropV7 drop = _activeHandleDrop();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        if (until < block.timestamp) {
            vm.expectRevert(IDropV7.BindingExpired.selector);
        } else if (until > block.timestamp + LIFETIME) {
            vm.expectRevert(IDropV7.BindingTooLong.selector);
        }
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);

        bool inside = until >= block.timestamp && until <= block.timestamp + LIFETIME;
        assertEq(drop.isClaimed(0), inside);
        assertEq(alice.balance, inside ? 1 ether : 0);
    }

    // -----------------------------------------------------------------------
    // the binding and the binder
    // -----------------------------------------------------------------------

    /// @dev A signature by anybody but the binder is refused.
    function test_V7_RevertWhen_ClaimHandle_WrongSigner() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _sign(otherKey, drop.bindingDigest(0, X_ALICE, alice, until));
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
    }

    /// @dev A binding for alice cannot pay bob.
    function test_V7_RevertWhen_ClaimHandle_SwappedRecipient() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, bob, until, proof, sig);
    }

    /// @dev Leaf 0's binding cannot claim leaf 1.
    function test_V7_RevertWhen_ClaimHandle_BindingForAnotherLeaf() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(1);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(1, X_BOB, 2 ether, alice, until, proof, sig);
    }

    /// @dev A binding from drop A is refused on drop B.
    function test_V7_RevertWhen_ClaimHandle_BindingFromAnotherDrop() public {
        DropV7 a = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sigForA = _binding(a, 0, X_ALICE, alice, until);

        (uint256[] memory ids, uint256[] memory amts) = _twoIds();
        DropV7 b = _createHandleDrop(address(0), 1, ids, amts, 0);
        _activateNative(DropV1(payable(address(b))));
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadBinding.selector);
        b.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sigForA);
    }

    /// @dev The high `s` twin and a 64 byte signature are refused.
    function test_V7_RevertWhen_ClaimHandle_MalleableOrShortSignature() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(binderKey, drop.bindingDigest(0, X_ALICE, alice, until));
        bytes32[] memory proof = _hProof(0);

        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory highS = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, highS);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, abi.encodePacked(r, s));
    }

    /// @dev Revoked: every handle claim stops.
    function test_V7_RevertWhen_ClaimHandle_Revoked() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);
        vm.prank(owner);
        registry.revoke();

        vm.expectRevert(IDropV2.BinderIsRevoked.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
    }

    /// @dev The binder is read live: a new binder makes the old binder's binding fail.
    function test_V7_ClaimHandle_BinderIsReadLive() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);
        vm.prank(owner);
        registry.setBinder(otherSigner);

        vm.expectRevert(IDropV2.BadBinding.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
    }

    // -----------------------------------------------------------------------
    // the leaf and the state
    // -----------------------------------------------------------------------

    /// @dev `xId` zero is refused first.
    function test_V7_RevertWhen_ClaimHandle_ZeroXId() public {
        DropV7 drop = _activeHandleDrop();
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.BadXId.selector);
        drop.claimHandle(0, 0, 1 ether, alice, _until(), proof, "");
    }

    /// @dev A zero recipient would burn the payout.
    function test_V7_RevertWhen_ClaimHandle_ZeroRecipient() public {
        DropV7 drop = _activeHandleDrop();
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV2.ZeroRecipient.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, address(0), _until(), proof, "");
    }

    /// @dev The amount is in the leaf: a bigger amount fails the proof.
    function test_V7_RevertWhen_ClaimHandle_WrongAmount() public {
        DropV7 drop = _activeHandleDrop();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claimHandle(0, X_ALICE, 2 ether, alice, until, proof, sig);
    }

    /// @dev An address leaf given to `claimHandle` fails the proof.
    function test_V7_RevertWhen_ClaimHandle_AddressLeaf() public {
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        DropV1 plain = _createDrop(address(0), address(0), 9, r, a);
        _activateNative(plain);
        DropV7 drop = DropV7(payable(address(plain)));
        uint256 xId = 1; // any valid X id: the handle frame never equals an address leaf
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, xId, recipients[0], until);
        bytes32[] memory proof = _proof(0);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claimHandle(0, xId, amounts[0], recipients[0], until, proof, sig);
        assertFalse(drop.isClaimed(0));
    }

    /// @dev A handle leaf given to `claim` fails the proof.
    function test_V7_RevertWhen_Claim_HandleLeaf() public {
        DropV7 drop = _activeHandleDrop();
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claim(0, alice, 1 ether, proof);
    }

    /// @dev Before activation a handle claim is `WrongStatus`.
    function test_V7_RevertWhen_ClaimHandle_BeforeActivation() public {
        (uint256[] memory ids, uint256[] memory a) = _twoIds();
        DropV7 drop = _createHandleDrop(address(0), 0, ids, a, 0);
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV1.WrongStatus.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
    }

    /// @dev After the claim deadline a fresh binding is still `ClaimWindowClosed`.
    function test_V7_RevertWhen_ClaimHandle_AfterClaimDeadline() public {
        DropV7 drop = _activeHandleDrop();
        vm.warp(uint256(drop.claimDeadline()) + 1);
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, alice, until);
        bytes32[] memory proof = _hProof(0);

        vm.expectRevert(IDropV1.ClaimWindowClosed.selector);
        drop.claimHandle(0, X_ALICE, 1 ether, alice, until, proof, sig);
    }

    /// @dev A recipient that reenters `claimHandle` is stopped and paid once.
    function test_V7_ClaimHandle_ReentrancyPaysOnce() public {
        DropV7 drop = _activeHandleDrop();
        ReentrantEthReceiver evil = new ReentrantEthReceiver();
        uint64 until = _until();
        bytes memory sig = _binding(drop, 0, X_ALICE, address(evil), until);
        bytes32[] memory proof = _hProof(0);
        evil.setReentry(
            address(drop), abi.encodeCall(IDropV7.claimHandle, (0, X_ALICE, 1 ether, address(evil), until, proof, sig))
        );

        drop.claimHandle(0, X_ALICE, 1 ether, address(evil), until, proof, sig);

        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded(), "the reentry must fail");
        assertEq(evil.received(), 1 ether, "paid exactly once");
    }

    // -----------------------------------------------------------------------
    // sweep of the drop asset
    // -----------------------------------------------------------------------

    /// @dev A late drop token on a `Finalized` token drop goes to `refundRecipient`.
    function test_V7_Sweep_TokenDropAsset_AfterRefund() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        _activateTokenDrop(drop, token);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        uint256 before = token.balanceOf(refundRecipient);

        token.mint(address(drop), 1 ether); // a late arrival
        vm.expectEmit(true, true, false, true, address(drop));
        emit IDropV1.Swept(address(token), refundRecipient, 1 ether);
        vm.prank(stranger);
        drop.sweep(address(token));

        assertEq(token.balanceOf(refundRecipient) - before, 1 ether, "to the refund address");
        assertEq(token.balanceOf(address(drop)), 0);
        assertEq(token.balanceOf(stranger), 0, "never to the caller");
    }

    /// @dev The same on a `Cancelled` token drop.
    function test_V7_Sweep_TokenDropAsset_AfterCancel() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        token.mint(address(drop), 1 ether);
        drop.sweep(address(token));
        assertEq(token.balanceOf(refundRecipient), 1 ether);
        assertEq(token.balanceOf(address(drop)), 0);
    }

    /// @dev While the drop is live, claims own the token: `NotFinished`.
    function test_V7_RevertWhen_Sweep_TokenDropAsset_WhileActive() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        _activateTokenDrop(drop, token);

        vm.expectRevert(IDropV1.NotFinished.selector);
        drop.sweep(address(token));
    }

    /// @dev The same while it waits for money.
    function test_V7_RevertWhen_Sweep_TokenDropAsset_WhileCreated() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), 1 ether);

        vm.expectRevert(IDropV1.NotFinished.selector);
        drop.sweep(address(token));
    }

    /// @dev A finished token drop with no token left is `NothingToSweep`.
    function test_V7_RevertWhen_Sweep_TokenDropAsset_NothingLeft() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        _activateTokenDrop(drop, token);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        vm.expectRevert(IDropV1.NothingToSweep.selector);
        drop.sweep(address(token));
    }

    /// @dev The sweep after the refund takes only what arrived late: the claims before
    ///      the deadline and the refund stand as they were.
    function test_V7_Sweep_TokenDropAsset_ClaimsAndRefundUnchanged() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        _activateTokenDrop(drop, token);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        uint256 refunded = token.balanceOf(refundRecipient);
        assertEq(refunded, amounts[1] + amounts[2], "the refund took the unclaimed part");

        token.mint(address(drop), 3 ether);
        drop.sweep(address(token));
        assertEq(token.balanceOf(refundRecipient), refunded + 3 ether);
        assertEq(token.balanceOf(recipients[0]), amounts[0], "the claim is untouched");
        assertEq(drop.totalClaimed(), amounts[0]);
    }

    /// @dev On a native drop: `sweep(address(0))` once finished.
    function test_V7_Sweep_NativeDropAsset_AfterRefund() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        uint256 before = refundRecipient.balance;

        vm.deal(address(drop), 1 ether);
        drop.sweep(address(0));
        assertEq(refundRecipient.balance - before, 1 ether);
    }
}
