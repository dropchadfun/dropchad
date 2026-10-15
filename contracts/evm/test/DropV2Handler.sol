// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV1} from "../src/DropFactoryV1.sol";
import {DropFactoryV2} from "../src/DropFactoryV2.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV2} from "../src/DropV2.sol";

import {DropHandler} from "./DropHandler.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";

/// @title DropV2Handler
/// @notice `DropHandler` plus handle mode: real handle claims, forged ones, revokes and binder
///         rotations, fired in random order at a `DropV2` drop with a mixed tree.
/// @dev Every `DropHandler` action is inherited; the address
///      actions only ever pick the address leaves, because `recipients` holds only those and
///      their indexes come first in the tree. Handle claims add to the same ghosts as address
///      claims, so conservation, covers both kinds with no second bookkeeping.
///      Two things are counted in ghosts that must stay zero, because they are not a state the
///      drop keeps. A `revert` here would not do: `fail_on_revert` is false in `foundry.toml`,
///      so a revert inside a handler action is just a call that did not happen.
///      - `ghostClaimWhileRevoked`, a handle claim that succeeded while revoked
///      - `ghostForgedSucceeded`, a forged handle claim that succeeded at all
contract DropV2Handler is DropHandler {
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

    /// @dev The handle leaves: the X ids, their amounts, the one wallet each is bound to, and
    ///      the tree index of the first one. Plus the registry and the two binder keys.
    struct HandleSetup {
        BinderRegistry registry;
        uint256 keyA;
        uint256 keyB;
        uint256[] xIds;
        uint256[] amounts;
        address[] wallets;
        uint256 firstIndex;
    }

    BinderRegistry public immutable registry;
    DropV2 public immutable dropV2;

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

    /// @notice What each bound wallet was really paid, by handle leaf.
    mapping(uint256 => uint256) public ghostHandlePaid;
    /// @notice Handle claims that went through while the registry said revoked. Must stay 0.
    uint256 public ghostClaimWhileRevoked;
    /// @notice Forged handle claims that went through. Must stay 0.
    uint256 public ghostForgedSucceeded;
    /// @notice Real handle claims that went through, so a run can show it did some.
    uint256 public ghostHandleClaims;

    constructor(BaseSetup memory b, HandleSetup memory h)
        DropHandler(
            b.factory, b.drop, b.token, b.owner, b.refundRecipient, b.feeRecipient, b.recipients, b.amounts, b.leaves
        )
    {
        registry = h.registry;
        dropV2 = DropV2(payable(address(b.drop)));
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

    /// @dev A real handle claim: the leaf's own X id, amount and bound wallet, signed by the key
    ///      the handler last set as binder. It fails while revoked, and after a claim.
    function claimHandleOne(uint256 seed) public countCall("claimHandleOne") {
        uint256 j = bound(seed, 0, xIds.length - 1);
        uint256 index = firstIndex + j;
        uint256 amount = handleAmounts[j];
        bytes memory sig = _sign(currentKey, dropV2.bindingDigest(index, xIds[j], wallets[j]));
        bool revokedBefore = registry.revoked();

        try dropV2.claimHandle(index, xIds[j], amount, wallets[j], _handleProof(j), sig) {
            if (revokedBefore) ghostClaimWhileRevoked += 1;
            ghostHandleClaims += 1;
            ghostClaimCount += 1;
            ghostClaimedSum += amount;
            ghostHandlePaid[j] += amount;
        } catch {}
        _recordStatus();
    }

    /// @dev Four attacks. None may ever succeed, whatever the state:
    ///      0 signed by a key the registry never named
    ///      1 a valid binding, the recipient swapped to an outsider
    ///      2 a valid binding, the amount inflated
    ///      3 a binding and a claim naming another leaf's X id at this index
    function claimHandleForged(uint256 seed, uint256 mode) public countCall("claimHandleForged") {
        uint256 j = bound(seed, 0, xIds.length - 1);
        uint256 index = firstIndex + j;
        mode = bound(mode, 0, 3);

        uint256 xId = xIds[j];
        uint256 amount = handleAmounts[j];
        address to = wallets[j];
        bytes memory sig;

        if (mode == 0) {
            sig = _sign(attackerKey, dropV2.bindingDigest(index, xId, to));
        } else if (mode == 1) {
            sig = _sign(currentKey, dropV2.bindingDigest(index, xId, to));
            to = outsiders[seed % outsiders.length];
        } else if (mode == 2) {
            sig = _sign(currentKey, dropV2.bindingDigest(index, xId, to));
            amount += 1;
        } else {
            xId = xIds[(j + 1) % xIds.length];
            sig = _sign(currentKey, dropV2.bindingDigest(index, xId, to));
        }

        try dropV2.claimHandle(index, xId, amount, to, _handleProof(j), sig) {
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
    // views and internals
    // -----------------------------------------------------------------------

    function handleCount() external view returns (uint256) {
        return xIds.length;
    }

    function _handleProof(uint256 j) internal view returns (bytes32[] memory) {
        return MerkleHelper.proofOf(leaves, firstIndex + j);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
