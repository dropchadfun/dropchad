// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {DropV1} from "../src/DropV1.sol";
import {DropFactoryV1} from "../src/DropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";

import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockTokenFactoryAdapter} from "./MockTokenFactoryAdapter.sol";

/// @title DropHandler
/// @notice Drives one drop through random calls, in random order, from random actors.
/// @dev Every action is wrapped in `try`, so a revert is simply a call that did not
///      happen. The ghost variables are only updated when a call really succeeded, which is what
///      lets `DropInvariants.t.sol` assert conservation, without trusting the contract.
///      The drop here is an **ERC20** drop. That keeps, no allowance, meaningful and lets
///      read a token balance. The native paths are covered by the unit and fuzz suites.
contract DropHandler is CommonBase, StdCheats, StdUtils {
    DropFactoryV1 public immutable factory;
    DropV1 public immutable drop;
    MockERC20 public immutable token;
    MockERC20 public immutable wrongToken;

    address public immutable owner;
    address public immutable refundRecipient;
    address public immutable feeRecipient;

    address[] public recipients;
    uint256[] public amounts;
    bytes32[] public leaves;

    /// @notice Addresses that are not in the tree. the design says none of them may ever be paid.
    address[] public outsiders;

    // --- ghosts -------------------------------------------------

    /// @notice Every unit of the drop asset this handler ever sent in.
    uint256 public ghostReceived;
    /// @notice The fee that really left, at activation.
    uint256 public ghostFeePaid;
    /// @notice What `refund` or `cancelUnfunded` really sent to `refundRecipient`.
    uint256 public ghostRefunded;
    /// @notice How many claims really went through. Cross-checked against `claimedCount`.
    uint256 public ghostClaimCount;
    /// @notice The sum of those claims. Cross-checked against `totalClaimed`.
    uint256 public ghostClaimedSum;
    /// @notice Highest `status` value ever seen. the design says it never goes down.
    uint8 public ghostMaxStatus;
    /// @notice `claimDeadline` the first time it became non zero. the design says it never changes after.
    uint64 public ghostFirstClaimDeadline;
    /// @notice Asset that arrived **after** the drop was already `Finalized` or `Cancelled`.
    /// @dev An ERC20 transfer in cannot be blocked by the receiving contract, exactly like a
    ///      native forced send. This is the "unless value was force sent afterwards" clause of.
    uint256 public ghostReceivedAfterFinish;
    /// @notice A second `initialize` that went through. the design says it stays zero.
    /// @dev A counter, not a `revert`: `fail_on_revert` is false, so a revert here would be silent.
    uint256 public ghostReinitialized;

    /// @notice Call counters, printed by the invariant summary so a silent no-op run is visible.
    mapping(bytes32 => uint256) public calls;

    constructor(
        DropFactoryV1 factory_,
        DropV1 drop_,
        MockERC20 token_,
        address owner_,
        address refundRecipient_,
        address feeRecipient_,
        address[] memory recipients_,
        uint256[] memory amounts_,
        bytes32[] memory leaves_
    ) {
        factory = factory_;
        drop = drop_;
        token = token_;
        owner = owner_;
        refundRecipient = refundRecipient_;
        feeRecipient = feeRecipient_;

        recipients = recipients_;
        amounts = amounts_;
        leaves = leaves_;

        wrongToken = new MockERC20("Wrong", "WRONG", 18);

        for (uint256 i = 0; i < 5; i++) {
            outsiders.push(address(uint160(uint256(keccak256(abi.encode("outsider", i))))));
        }
    }

    // -----------------------------------------------------------------------
    // actions
    // -----------------------------------------------------------------------

    /// @dev Funding is a plain transfer from any wallet.
    function fund(uint256 amount) public countCall("fund") {
        amount = bound(amount, 0, drop.grossRequired());
        if (amount == 0) return;
        _send(amount);
    }

    /// @dev Overfunding on purpose. Extra must never become an entitlement.
    function overfund(uint256 amount) public countCall("overfund") {
        amount = bound(amount, 1, 100 ether);
        _send(amount);
    }

    /// @dev Somebody sends the wrong token to the address.
    function sendWrongToken(uint256 amount) public countCall("sendWrongToken") {
        amount = bound(amount, 1, 100 ether);
        wrongToken.mint(address(drop), amount);
    }

    function activate() public countCall("activate") {
        uint256 fee = drop.feeAmount();
        try drop.activate() {
            ghostFeePaid += fee;
            _recordDeadline();
        } catch {}
        _recordStatus();
    }

    function claimOne(uint256 seed) public countCall("claimOne") {
        uint256 i = bound(seed, 0, recipients.length - 1);
        uint256 amount = amounts[i];

        try drop.claim(i, recipients[i], amount, MerkleHelper.proofOf(leaves, i)) {
            ghostClaimCount += 1;
            ghostClaimedSum += amount;
        } catch {}
        _recordStatus();
    }

    function claimBatchRandom(uint256 seed, uint256 count) public countCall("claimBatchRandom") {
        uint256 n = bound(count, 1, recipients.length < 20 ? recipients.length : 20);
        uint256 start = bound(seed, 0, recipients.length - n);

        IDropV1.ClaimItem[] memory items = new IDropV1.ClaimItem[](n);
        uint256 expectedNew;
        uint256 expectedSum;

        for (uint256 k = 0; k < n; k++) {
            uint256 i = start + k;
            items[k] = IDropV1.ClaimItem(i, recipients[i], amounts[i], MerkleHelper.proofOf(leaves, i));

            // Already claimed items are skipped in silence, so they add nothing.
            if (!drop.isClaimed(i)) {
                expectedNew += 1;
                expectedSum += amounts[i];
            }
        }

        try drop.claimBatch(items) {
            ghostClaimCount += expectedNew;
            ghostClaimedSum += expectedSum;
        } catch {}
        _recordStatus();
    }

    function cancelUnfunded() public countCall("cancelUnfunded") {
        uint256 before = token.balanceOf(refundRecipient);
        try drop.cancelUnfunded() {
            ghostRefunded += token.balanceOf(refundRecipient) - before;
        } catch {}
        _recordStatus();
    }

    function refund() public countCall("refund") {
        uint256 before = token.balanceOf(refundRecipient);
        try drop.refund() {
            ghostRefunded += token.balanceOf(refundRecipient) - before;
        } catch {}
        _recordStatus();
    }

    /// @dev Sweeping the drop asset must always fail, so it can never disturb.
    function sweepWrong() public countCall("sweepWrong") {
        try drop.sweep(address(wrongToken)) {} catch {}
    }

    function sweepDropAsset() public countCall("sweepDropAsset") {
        try drop.sweep(address(token)) {} catch {}
    }

    function sweepNative() public countCall("sweepNative") {
        try drop.sweep(address(0)) {} catch {}
    }

    /// @dev Time is the only thing that opens and closes the two windows.
    function warpForward(uint256 delta) public countCall("warpForward") {
        delta = bound(delta, 1 hours, 20 days);
        vm.warp(block.timestamp + delta);
    }

    /// @dev Every admin lever, fired at random against a live drop. None of them may move
    ///      a single field of the drop.
    function adminPoke(uint256 seed) public countCall("adminPoke") {
        uint256 which = bound(seed, 0, 5);

        vm.startPrank(owner);
        if (which == 0) {
            try factory.setPaused(seed % 2 == 0) {} catch {}
        } else if (which == 1) {
            try factory.setDefaultFeeBps(uint16(bound(seed, 0, factory.MAX_FEE_BPS()))) {} catch {}
        } else if (which == 2) {
            try factory.setFeeRecipient(address(uint160(bound(seed, 1, type(uint160).max)))) {} catch {}
        } else if (which == 3) {
            try factory.setCreatorAllowed(address(uint160(bound(seed, 1, type(uint160).max))), seed % 2 == 0) {}
                catch {}
        } else if (which == 4) {
            try factory.setImplementation(address(new DropV1())) {} catch {}
        } else {
            try factory.setTokenFactoryAllowed(
                address(uint160(bound(seed, 1, type(uint160).max))), address(new MockTokenFactoryAdapter()), true
            ) {}
                catch {}
        }
        vm.stopPrank();
    }

    /// @dev `initialize` must never succeed again, from anybody, at any time.
    function tryReinitialize(uint256 seed) public countCall("tryReinitialize") {
        address caller = address(uint160(bound(seed, 1, type(uint160).max)));

        IDropV1.InitParams memory p = IDropV1.InitParams({
            asset: address(wrongToken),
            merkleRoot: keccak256("hostile"),
            manifestHash: keccak256("hostile"),
            totalEntitlements: 1,
            grossRequired: 1,
            feeAmount: 0,
            feeRecipient: caller,
            refundRecipient: caller,
            fundingDeadline: type(uint64).max,
            claimPeriod: 1 days,
            leafCount: 1,
            implementation: factory.implementation(),
            creatorCommitment: keccak256("hostile"),
            salt: keccak256(abi.encode(seed))
        });

        vm.prank(caller);
        try drop.initialize(p) {
            ghostReinitialized += 1;
        } catch {}
    }

    // -----------------------------------------------------------------------
    // views for the invariant contract
    // -----------------------------------------------------------------------

    function recipientCount() external view returns (uint256) {
        return recipients.length;
    }

    function recipientAt(uint256 i) external view returns (address, uint256) {
        return (recipients[i], amounts[i]);
    }

    function outsiderCount() external view returns (uint256) {
        return outsiders.length;
    }

    function outsiderAt(uint256 i) external view returns (address) {
        return outsiders[i];
    }

    // -----------------------------------------------------------------------
    // internals
    // -----------------------------------------------------------------------

    /// @dev A plain transfer in, from a wallet the drop knows nothing about.
    function _send(uint256 amount) internal {
        token.mint(address(this), amount);
        token.transfer(address(drop), amount);

        ghostReceived += amount;
        if (_isFinished()) ghostReceivedAfterFinish += amount;
    }

    function _isFinished() internal view returns (bool) {
        IDropV1.Status s = drop.status();
        return s == IDropV1.Status.Finalized || s == IDropV1.Status.Cancelled;
    }

    function _recordStatus() internal {
        uint8 s = uint8(drop.status());
        if (s > ghostMaxStatus) ghostMaxStatus = s;
    }

    function _recordDeadline() internal {
        if (ghostFirstClaimDeadline == 0) ghostFirstClaimDeadline = drop.claimDeadline();
    }

    modifier countCall(bytes32 name) {
        calls[name] += 1;
        _;
    }
}
