// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV1} from "../src/DropFactoryV1.sol";
import {DropFactoryV2} from "../src/DropFactoryV2.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV7} from "../src/DropV7.sol";

import {DropHandler} from "./DropHandler.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";

/// @title DropV7Handler
/// @notice `DropV2Handler` on binding v2: real handle claims inside the time window, claims
///         outside it, a signature kept and tried again later, forged claims, revokes and binder
///         rotations, fired in random order at a `DropV7` drop with a mixed tree. Plus the drop
///         asset sweep of, counted.
/// @dev Every `DropHandler` action is inherited. Handle claims add to the same ghosts as address
///      claims, so the invariants cover both kinds. A swept drop asset goes to `refundRecipient`, so it is
///      counted as refunded, and it was a late arrival, so it leaves `ghostReceivedAfterFinish`:
///      hold as written.
///      Ghosts that must stay zero, because they are not a state the drop keeps (a `revert` here
///      would not do: `fail_on_revert` is false in `foundry.toml`):
///      - `ghostClaimWhileRevoked`, a handle claim that went through while revoked
///      - `ghostForgedSucceeded`, a forged handle claim that went through
///      - `ghostOutsideWindowSucceeded`, a claim with `validUntil` outside
///        `[now, now + MAX_BINDING_LIFETIME]` that went through.1
///      - `ghostLateSucceeded`, a kept signature that paid after its `validUntil`
///      - `ghostAssetSweptBeforeFinish`, a drop asset sweep before `Finalized` or `Cancelled`,
///      - `ghostAssetSweptElsewhere`, a drop asset sweep whose amount did not reach
///        `refundRecipient`
///      - `ghostAssetSweptMoreThanLate`, a drop asset sweep that took more than arrived after
///        the drop finished
contract DropV7Handler is DropHandler {
    /// @dev `DropHandler`'s constructor arguments, packed so this constructor fits the stack.
    struct BaseSetup {
        DropFactoryV1 factory;
        DropV1 drop;
        MockERC20 token;
        address owner;
        address refundRecipient;
        address feeRecipient;
        address[] recipients;
        uint256[] amounts;
        bytes32[] leaves;
    }

    /// @dev The handle leaves: the X ids, their amounts, the one wallet each is bound to, and the
    ///      tree index of the first one. Plus the registry and the two binder keys.
    struct HandleSetup {
        BinderRegistry registry;
        uint256 keyA;
        uint256 keyB;
        uint256[] xIds;
        uint256[] amounts;
        address[] wallets;
        uint256 firstIndex;
    }

    uint256 internal constant LIFETIME = 3600;

    BinderRegistry public immutable registry;
    DropV7 public immutable dropV7;

    uint256 internal immutable keyA;
    uint256 internal immutable keyB;
    address public immutable binderA;
    address public immutable binderB;
    /// @dev Signs nothing the registry ever names.
    uint256 internal immutable attackerKey;

    uint256[] public xIds;
    uint256[] public handleAmounts;
    address[] public wallets;
    uint256 public immutable firstIndex;

    /// @notice The key of the binder the handler last set. Claims are signed with it.
    uint256 internal currentKey;

    /// @dev One signature kept for later, as a send that failed and could be sent again.
    bool internal hasKept;
    uint256 internal keptJ;
    uint64 internal keptUntil;
    bytes internal keptSig;

    /// @notice What each bound wallet was really paid, by handle leaf.
    mapping(uint256 => uint256) public ghostHandlePaid;
    uint256 public ghostClaimWhileRevoked;
    uint256 public ghostForgedSucceeded;
    uint256 public ghostOutsideWindowSucceeded;
    uint256 public ghostLateSucceeded;
    uint256 public ghostAssetSweptBeforeFinish;
    uint256 public ghostAssetSweptElsewhere;
    uint256 public ghostAssetSweptMoreThanLate;
    /// @notice Real handle claims and drop asset sweeps that went through, so a run shows some.
    uint256 public ghostHandleClaims;
    uint256 public ghostAssetSweeps;

    constructor(BaseSetup memory b, HandleSetup memory h)
        DropHandler(
            b.factory, b.drop, b.token, b.owner, b.refundRecipient, b.feeRecipient, b.recipients, b.amounts, b.leaves
        )
    {
        registry = h.registry;
        dropV7 = DropV7(payable(address(b.drop)));
        keyA = h.keyA;
        keyB = h.keyB;
        binderA = vm.addr(h.keyA);
        binderB = vm.addr(h.keyB);
        attackerKey = uint256(keccak256("handle mode attacker"));
        xIds = h.xIds;
        handleAmounts = h.amounts;
        wallets = h.wallets;
        firstIndex = h.firstIndex;
        currentKey = h.keyA;
    }

    // -----------------------------------------------------------------------
    // handle actions
    // -----------------------------------------------------------------------

    /// @dev A real handle claim inside the window: the leaf's own X id, amount and bound wallet,
    ///      `validUntil` between now and now plus `MAX_BINDING_LIFETIME`, signed by the key the
    ///      handler last set. It fails while revoked, and after a claim.
    function claimHandleOne(uint256 seed, uint256 ahead) public countCall("claimHandleOne") {
        uint256 j = bound(seed, 0, xIds.length - 1);
        uint64 until = uint64(block.timestamp + bound(ahead, 0, LIFETIME));
        bytes memory sig = _sign(currentKey, dropV7.bindingDigest(firstIndex + j, xIds[j], wallets[j], until));
        _tryRealClaim(j, until, sig);
    }

    /// @dev A claim with a good signature and `validUntil` outside the window: in the past, or
    ///      more than `MAX_BINDING_LIFETIME` ahead. It must never succeed.
    function claimHandleOutsideWindow(uint256 seed, uint256 mode, uint256 delta)
        public
        countCall("claimHandleOutsideWindow")
    {
        uint256 j = bound(seed, 0, xIds.length - 1);
        uint256 index = firstIndex + j;
        uint64 until;
        if (mode % 2 == 0) {
            until = uint64(block.timestamp - bound(delta, 1, block.timestamp));
        } else {
            until = uint64(block.timestamp + LIFETIME + bound(delta, 1, 1e12));
        }
        bytes memory sig = _sign(currentKey, dropV7.bindingDigest(index, xIds[j], wallets[j], until));

        try dropV7.claimHandle(index, xIds[j], handleAmounts[j], wallets[j], until, _handleProof(j), sig) {
            ghostOutsideWindowSucceeded += 1;
        } catch {}
    }

    /// @dev Signs a binding and keeps it, as the api does before a send.
    function keepSignature(uint256 seed, uint256 ahead) public countCall("keepSignature") {
        keptJ = bound(seed, 0, xIds.length - 1);
        keptUntil = uint64(block.timestamp + bound(ahead, 0, LIFETIME));
        keptSig = _sign(currentKey, dropV7.bindingDigest(firstIndex + keptJ, xIds[keptJ], wallets[keptJ], keptUntil));
        hasKept = true;
    }

    /// @dev Sends the kept signature again, maybe after `warpForward`. After its `validUntil` it
    ///      must never pay.
    function replayKept() public countCall("replayKept") {
        if (!hasKept) return;
        bool late = block.timestamp > keptUntil;
        bool ok = _tryRealClaim(keptJ, keptUntil, keptSig);
        if (ok && late) ghostLateSucceeded += 1;
    }

    /// @dev Five attacks. None may ever succeed, whatever the state:
    ///      0 signed by a key the registry never named
    ///      1 a valid binding, the recipient swapped to an outsider
    ///      2 a valid binding, the amount inflated
    ///      3 a binding and a claim naming another leaf's X id at this index
    ///      4 a valid binding, sent with a later `validUntil` than the one signed
    function claimHandleForged(uint256 seed, uint256 mode) public countCall("claimHandleForged") {
        uint256 j = bound(seed, 0, xIds.length - 1);
        uint256 index = firstIndex + j;
        mode = bound(mode, 0, 4);

        uint256 xId = xIds[j];
        uint256 amount = handleAmounts[j];
        address to = wallets[j];
        uint64 until = uint64(block.timestamp + 600);
        uint64 sent = until;
        bytes memory sig;

        if (mode == 0) {
            sig = _sign(attackerKey, dropV7.bindingDigest(index, xId, to, until));
        } else if (mode == 1) {
            sig = _sign(currentKey, dropV7.bindingDigest(index, xId, to, until));
            to = outsiders[seed % outsiders.length];
        } else if (mode == 2) {
            sig = _sign(currentKey, dropV7.bindingDigest(index, xId, to, until));
            amount += 1;
        } else if (mode == 3) {
            xId = xIds[(j + 1) % xIds.length];
            sig = _sign(currentKey, dropV7.bindingDigest(index, xId, to, until));
        } else {
            sig = _sign(currentKey, dropV7.bindingDigest(index, xId, to, until));
            sent = until + 1;
        }

        try dropV7.claimHandle(index, xId, amount, to, sent, _handleProof(j), sig) {
            ghostForgedSucceeded += 1;
        } catch {}
    }

    /// @dev The owner or the guardian revokes. Instant, every handle claim stops.
    function revokeBinder(uint256 seed) public countCall("revokeBinder") {
        address g = registry.guardian();
        address caller = seed % 2 == 0 || g == address(0) ? owner : g;
        vm.prank(caller);
        registry.revoke();
    }

    /// @dev A new binder, one of the two known keys; it clears `revoked`.
    function setBinderRandom(uint256 seed) public countCall("setBinderRandom") {
        currentKey = seed % 2 == 0 ? keyA : keyB;
        vm.prank(owner);
        registry.setBinder(vm.addr(currentKey));
    }

    /// @dev for the new levers: the minimum fee and the guardian, fired at the live drop.
    function adminPokeV2(uint256 seed) public countCall("adminPokeV2") {
        DropFactoryV2 f = DropFactoryV2(address(factory));
        vm.startPrank(owner);
        if (seed % 2 == 0) {
            try f.setMinFeeAmount(bound(seed, 0, f.MAX_MIN_FEE_AMOUNT())) {} catch {}
        } else {
            address g = seed % 3 == 0 ? address(0) : address(uint160(bound(seed, 1, type(uint160).max)));
            try registry.setGuardian(g) {} catch {}
        }
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // the drop asset sweep
    // -----------------------------------------------------------------------

    /// @dev Only once finished, only to `refundRecipient`. What it takes arrived late.
    function sweepDropAsset() public override countCall("sweepDropAsset") {
        bool finished = _isFinished();
        uint256 bal = token.balanceOf(address(drop));
        uint256 before = token.balanceOf(refundRecipient);
        try drop.sweep(address(token)) {
            ghostAssetSweeps += 1;
            if (!finished) ghostAssetSweptBeforeFinish += 1;
            uint256 got = token.balanceOf(refundRecipient) - before;
            if (got != bal) ghostAssetSweptElsewhere += 1;
            ghostRefunded += got;
            if (got > ghostReceivedAfterFinish) ghostAssetSweptMoreThanLate += 1;
            else ghostReceivedAfterFinish -= got;
        } catch {}
    }

    // -----------------------------------------------------------------------
    // views and internals
    // -----------------------------------------------------------------------

    function handleCount() external view returns (uint256) {
        return xIds.length;
    }

    /// @dev One real claim of handle leaf `j`, with its ghosts. Returns whether it went through.
    function _tryRealClaim(uint256 j, uint64 until, bytes memory sig) internal returns (bool ok) {
        uint256 amount = handleAmounts[j];
        bool revokedBefore = registry.revoked();
        try dropV7.claimHandle(firstIndex + j, xIds[j], amount, wallets[j], until, _handleProof(j), sig) {
            ok = true;
            if (revokedBefore) ghostClaimWhileRevoked += 1;
            ghostHandleClaims += 1;
            ghostClaimCount += 1;
            ghostClaimedSum += amount;
            ghostHandlePaid[j] += amount;
        } catch {}
        _recordStatus();
    }

    function _handleProof(uint256 j) internal view returns (bytes32[] memory) {
        return MerkleHelper.proofOf(leaves, firstIndex + j);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
