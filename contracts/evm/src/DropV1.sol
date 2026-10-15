// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IDropV1} from "./IDropV1.sol";

/// @title DropV1
/// @notice One dropchad drop. One asset, many recipients, merkle claims, refund after the deadline.
///
/// @dev Implements `docs/SPEC.md` v1.2. That file is the source of truth. Every rule number in a
///      comment below points at it.
///
///      Deployed once per chain as an implementation, then used through EIP 1167 minimal clones.
///      The implementation itself is never used directly and holds no funds, R3.7.
///
///      **This contract has no owner, no admin, no roles, and no reference to the factory after
///      `initialize` returns.** R13.7. There is no pause, no upgrade, no emergency withdrawal,
///      no `delegatecall`, and no `selfdestruct`. R13.2, R13.3, R13.5, R13.6.
contract DropV1 is IDropV1, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Largest `claimBatch` accepted. SPEC 6.12 and R6.5.1.
    uint256 public constant MAX_BATCH = 20;

    // -----------------------------------------------------------------------
    // storage
    //
    // Slot packing follows SPEC 5.4, which is **non-normative**. The values and the behaviour
    // above it are normative. Fields 1 to 13 are the write-once table 5.1, I5.
    // -----------------------------------------------------------------------

    /// @notice slot 0. `address(0)` means native ETH.
    address public asset;
    /// @dev slot 0. Read through `status()`.
    Status internal _status;
    /// @notice slot 0. Set in `initialize`, never cleared. I11.
    bool public initialized;

    bytes32 public merkleRoot;
    bytes32 public manifestHash;
    bytes32 public creatorCommitment;
    uint256 public totalEntitlements;
    uint256 public grossRequired;
    uint256 public feeAmount;

    address public feeRecipient;
    uint64 public fundingDeadline;
    uint32 public claimPeriod;

    address public refundRecipient;
    /// @dev Read through `claimDeadline()`. Zero until `activate`, R5.4.
    uint64 internal _claimDeadline;
    uint32 public leafCount;

    address public implementation;
    uint64 public activatedAt;
    uint32 public claimedCount;

    uint256 public totalClaimed;

    /// @dev Word index to 256 claim bits. One bit per merkle index. T2.
    mapping(uint256 => uint256) internal _claimedBitmap;

    // -----------------------------------------------------------------------
    // constructor
    // -----------------------------------------------------------------------

    /// @dev R6.2.4. The implementation marks itself initialized, so `initialize` on the
    ///      implementation always reverts with `AlreadyInitialized()`. I11.
    constructor() {
        initialized = true;
    }

    // -----------------------------------------------------------------------
    // initialize, SPEC 6.2
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropV1
    /// @dev The `initialized` check comes **first**, on purpose. R6.2.4 requires that a call to
    ///      the implementation reverts with `AlreadyInitialized()`, and the implementation would
    ///      fail the `OnlyFactory()` check too. Checking the flag first is the only order that
    ///      gives R6.2.4 the error it names.
    function initialize(InitParams calldata p) external {
        // R6.2.2
        if (initialized) revert AlreadyInitialized();

        // R6.2.1. Only the contract that actually deployed this clone, with this implementation
        // and this salt, can produce this address. Nothing about the factory is stored, so R13.7 holds.
        if (Clones.predictDeterministicAddress(p.implementation, p.salt, msg.sender) != address(this)) {
            revert OnlyFactory();
        }

        // R6.2.3. `_status` stays `Created`, which is zero.
        initialized = true;

        asset = p.asset;
        merkleRoot = p.merkleRoot;
        manifestHash = p.manifestHash;
        creatorCommitment = p.creatorCommitment;
        totalEntitlements = p.totalEntitlements;
        grossRequired = p.grossRequired;
        feeAmount = p.feeAmount;
        feeRecipient = p.feeRecipient;
        fundingDeadline = p.fundingDeadline;
        claimPeriod = p.claimPeriod;
        refundRecipient = p.refundRecipient;
        leafCount = p.leafCount;
        implementation = p.implementation;

        // R6.2.5. No event. `DropCreated` from the factory covers it.
    }

    // -----------------------------------------------------------------------
    // activate, SPEC 6.3
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropV1
    /// @dev Permissionless. It only reads a balance, it cannot change a parameter.
    function activate() external nonReentrant {
        if (_status != Status.Created) revert WrongStatus(); // R6.3.1
        if (block.timestamp > fundingDeadline) revert FundingExpired(); // R6.3.2, R9.1

        uint256 bal = _assetBalance();
        // R6.3.3 and R6.3.4. The check is `>=`, not `==`. Extra never becomes an entitlement.
        if (bal < grossRequired) revert Underfunded();

        // R9.9. `uint64` holds a unix timestamp until year 584942417355. The cast cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp);
        // R5.3, R9.9 and I16. Derived exactly once, and no function can write it again.
        uint64 deadline = nowTs + uint64(claimPeriod);

        activatedAt = nowTs;
        _claimDeadline = deadline;
        _status = Status.Active;

        uint256 fee = feeAmount;
        emit Activated(nowTs, bal, deadline, fee);

        // R6.3.6 and R8.5. All state is written first, so reentering finds `Active` and reverts.
        // R8.10. If this fails the whole activation reverts and the drop stays `Created`.
        if (fee > 0) _payOut(feeRecipient, fee);
    }

    // -----------------------------------------------------------------------
    // claim, SPEC 6.4
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropV1
    /// @dev Permissionless. The proof fixes the destination, so the caller cannot redirect
    ///      anything. I15.
    function claim(uint256 index, address recipient, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        if (_status != Status.Active) revert WrongStatus(); // R6.4.1
        if (block.timestamp > _claimDeadline) revert ClaimWindowClosed(); // R6.4.2, R9.3

        _claim(index, recipient, amount, proof);
    }

    /// @inheritdoc IDropV1
    /// @dev R6.5.8. The guard covers the whole call, not each item.
    function claimBatch(ClaimItem[] calldata items) external nonReentrant {
        uint256 n = items.length;
        if (n == 0 || n > MAX_BATCH) revert BadBatchSize(); // R6.5.1

        if (_status != Status.Active) revert WrongStatus(); // R6.5.2
        if (block.timestamp > _claimDeadline) revert ClaimWindowClosed(); // R6.5.3

        for (uint256 i = 0; i < n; i++) {
            ClaimItem calldata item = items[i];

            // R6.5.4. An index somebody already claimed is skipped in silence. No revert, no
            // event. This keeps a relayer batch alive when a recipient claimed a second earlier.
            if (isClaimed(item.index)) continue;

            // R6.5.5 and R6.5.6. A bad proof is our data bug, not a race, so it reverts the
            // whole batch through `_claim`.
            _claim(item.index, item.recipient, item.amount, item.proof);
        }
    }

    /// @dev The effects of R6.4, in the exact order of SPEC 6.4. Checks, effects, interactions.
    function _claim(uint256 index, address recipient, uint256 amount, bytes32[] calldata proof) internal {
        if (isClaimed(index)) revert AlreadyClaimed(); // R6.4.3

        // R6.4.4. The leaf binds this drop, this chain, this index, this recipient, this amount.
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, _leaf(index, recipient, amount))) {
            revert BadProof();
        }

        uint256 newTotal = totalClaimed + amount;
        // R6.4.5. Defence in depth. A correct tree can never hit this. I1.
        if (newTotal > totalEntitlements) revert OverEntitlement();

        // R6.4.6. The bit is set **before** the transfer. Always.
        _setClaimed(index);
        totalClaimed = newTotal;
        claimedCount += 1;

        emit Claimed(index, recipient, amount);

        // R6.4.7 and R6.4.8.
        _payOut(recipient, amount);
    }

    // -----------------------------------------------------------------------
    // cancelUnfunded, SPEC 6.6
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropV1
    function cancelUnfunded() external nonReentrant {
        if (_status != Status.Created) revert WrongStatus(); // R6.6.1
        // R6.6.2 and R9.1. Exactly at the deadline this reverts and `activate` still works.
        if (block.timestamp <= fundingDeadline) revert FundingStillOpen();

        _status = Status.Cancelled;

        // R6.6.3 and R6.6.4. Works at zero, works above `grossRequired`. Everything goes back.
        uint256 bal = _assetBalance();
        address to = refundRecipient;

        emit CancelledUnfunded(to, bal);

        if (bal > 0) _payOut(to, bal);
    }

    // -----------------------------------------------------------------------
    // refund, SPEC 6.7
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropV1
    function refund() external nonReentrant {
        if (_status != Status.Active) revert WrongStatus(); // R6.7.1
        // R6.7.2 and R9.3. Exactly at the deadline this reverts and claims still work.
        if (block.timestamp <= _claimDeadline) revert ClaimWindowOpen();

        _status = Status.Finalized;

        // R6.7.3. Unclaimed entitlements plus any overfunding. One transfer, one destination.
        uint256 bal = _assetBalance();
        address to = refundRecipient;

        emit Refunded(to, bal);
        emit Finalized(totalClaimed, claimedCount, bal);

        if (bal > 0) _payOut(to, bal);
    }

    // -----------------------------------------------------------------------
    // sweep, SPEC 6.8
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropV1
    /// @dev R6.8.5. Sweep can never touch the drop asset. That path is `refund()` and only
    ///      `refund()`. This is what keeps I4 short.
    function sweep(address token) external nonReentrant {
        // R6.8.1. Also covers R6.8.4: when the drop asset is native, `token == address(0)`
        // equals `asset` and is refused here.
        if (token == asset) revert CannotSweepDropAsset();

        Status s = _status;
        // R6.8.2
        if (s != Status.Finalized && s != Status.Cancelled) revert NotFinished();

        uint256 bal = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        if (bal == 0) revert NothingToSweep(); // R6.8.3

        address to = refundRecipient;
        emit Swept(token, to, bal);

        if (token == address(0)) {
            // `to` is `refundRecipient`, frozen in `initialize` and never writable again. I5, I15.
            // forge-lint: disable-next-line(arbitrary-send-eth)
            (bool ok,) = to.call{value: bal}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, bal);
        }
    }

    // -----------------------------------------------------------------------
    // receive, SPEC 6.9
    // -----------------------------------------------------------------------

    /// @dev R6.9.1. Native is accepted only while this is a native drop waiting for money.
    ///      R6.9.2. A forced send through `selfdestruct` or a block reward cannot be blocked by
    ///      any contract. Value that arrives that way is extra balance and leaves through
    ///      `refund()` or `sweep()`. It never becomes an entitlement.
    ///      R6.9.3. There is no `fallback()`. A call with unknown calldata reverts.
    receive() external payable {
        if (asset != address(0) || _status != Status.Created) revert NotAcceptingNative();
    }

    // -----------------------------------------------------------------------
    // views, SPEC 6.10
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropV1
    function isClaimed(uint256 index) public view returns (bool) {
        return _claimedBitmap[index >> 8] & (uint256(1) << (index & 0xff)) != 0;
    }

    /// @inheritdoc IDropV1
    function status() external view returns (Status) {
        return _status;
    }

    /// @inheritdoc IDropV1
    /// @dev R5.4. Zero before activation. Nothing may read it as meaningful while `Created`.
    function claimDeadline() external view returns (uint64) {
        return _claimDeadline;
    }

    /// @inheritdoc IDropV1
    /// @dev Every field of table 5.1, so the UI can verify the drop before anybody funds it. R3.1.
    function config() external view returns (Config memory) {
        return Config({
            asset: asset,
            merkleRoot: merkleRoot,
            manifestHash: manifestHash,
            totalEntitlements: totalEntitlements,
            grossRequired: grossRequired,
            feeAmount: feeAmount,
            feeRecipient: feeRecipient,
            refundRecipient: refundRecipient,
            fundingDeadline: fundingDeadline,
            claimPeriod: claimPeriod,
            leafCount: leafCount,
            implementation: implementation,
            creatorCommitment: creatorCommitment
        });
    }

    /// @inheritdoc IDropV1
    function unclaimed() external view returns (uint256) {
        return totalEntitlements - totalClaimed;
    }

    /// @inheritdoc IDropV1
    function assetBalance() external view returns (uint256) {
        return _assetBalance();
    }

    // -----------------------------------------------------------------------
    // internals
    // -----------------------------------------------------------------------

    /// @dev SPEC 7.1. `address(this)` is R7.3, `block.chainid` is R7.4, `index` is R7.5.
    function _leaf(uint256 index, address recipient, uint256 amount) internal view returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(address(this), block.chainid, index, recipient, amount))));
    }

    /// @dev T2. One bit per merkle index, packed 256 to a word.
    function _setClaimed(uint256 index) internal {
        _claimedBitmap[index >> 8] |= uint256(1) << (index & 0xff);
    }

    /// @dev R6.9.2. The only places that read a real balance are `activate`, `refund`,
    ///      `cancelUnfunded` and `sweep`. No accounting field is ever derived from a balance.
    function _assetBalance() internal view returns (uint256) {
        address a = asset;
        return a == address(0) ? address(this).balance : IERC20(a).balanceOf(address(this));
    }

    /// @dev The only value-out path other than `sweep`. I4.
    ///      R6.4.7. ERC20 always through `SafeERC20`, never a bare `transfer`.
    ///      R6.4.8. Native through a checked low level call with **no artificial gas cap**.
    ///      A gas cap would break Safe wallets and every contract recipient. Safety comes from
    ///      checks-effects-interactions, `nonReentrant`, and the bit being set first.
    ///      I13. `approve` appears nowhere in this contract.
    function _payOut(address to, uint256 amount) internal {
        address a = asset;
        if (a == address(0)) {
            // `to` is always a leaf recipient, `feeRecipient` or `refundRecipient`. Every one of
            // them is fixed by data frozen at creation, never by `msg.sender`. I15.
            // forge-lint: disable-next-line(arbitrary-send-eth)
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(a).safeTransfer(to, amount);
        }
    }
}
