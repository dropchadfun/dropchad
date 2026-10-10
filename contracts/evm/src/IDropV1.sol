// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IDropV1
/// @notice One dropchad drop. One asset, many recipients, merkle claims.
/// @dev Every name in this file comes from `docs/SPEC.md` v1.2. That file wins.
interface IDropV1 {
    // ---------------------------------------------------------------------
    // state machine, SPEC 4.1
    // ---------------------------------------------------------------------

    /// @dev `Created` is 0, which is also the value of a fresh clone.
    ///      That is why `initialized` exists as a separate flag. SPEC I11.
    enum Status {
        Created,
        Active,
        Finalized,
        Cancelled
    }

    // ---------------------------------------------------------------------
    // structs
    // ---------------------------------------------------------------------

    /// @notice Everything `initialize` writes, plus the salt used to prove the caller. SPEC 5.1 and R6.2.1.
    /// @dev `salt` is a call argument only. It is never stored and it is not in SPEC table 5.1.
    struct InitParams {
        address asset;
        bytes32 merkleRoot;
        bytes32 manifestHash;
        uint256 totalEntitlements;
        uint256 grossRequired;
        uint256 feeAmount;
        address feeRecipient;
        address refundRecipient;
        uint64 fundingDeadline;
        uint32 claimPeriod;
        uint32 leafCount;
        address implementation;
        bytes32 creatorCommitment;
        bytes32 salt;
    }

    /// @notice One entry of a batched claim. SPEC 6.5.
    struct ClaimItem {
        uint256 index;
        address recipient;
        uint256 amount;
        bytes32[] proof;
    }

    /// @notice Every write-once field of SPEC table 5.1, for the UI to verify before funding. SPEC 6.10.
    struct Config {
        address asset;
        bytes32 merkleRoot;
        bytes32 manifestHash;
        uint256 totalEntitlements;
        uint256 grossRequired;
        uint256 feeAmount;
        address feeRecipient;
        address refundRecipient;
        uint64 fundingDeadline;
        uint32 claimPeriod;
        uint32 leafCount;
        address implementation;
        bytes32 creatorCommitment;
    }

    // ---------------------------------------------------------------------
    // events, SPEC 11.1
    // ---------------------------------------------------------------------

    event Activated(uint64 activatedAt, uint256 balance, uint64 claimDeadline, uint256 feePaid);
    event Claimed(uint256 indexed index, address indexed recipient, uint256 amount);
    event Refunded(address indexed refundRecipient, uint256 amount);
    event CancelledUnfunded(address indexed refundRecipient, uint256 amount);
    event Finalized(uint256 totalClaimed, uint32 claimedCount, uint256 refunded);
    event Swept(address indexed token, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // errors, SPEC section 6
    // ---------------------------------------------------------------------

    /// @dev R6.2.1. The caller did not deploy this clone.
    error OnlyFactory();
    /// @dev R6.2.2 and R6.2.4.
    error AlreadyInitialized();
    /// @dev R6.3.1, R6.4.1, R6.5.2, R6.6.1, R6.7.1.
    error WrongStatus();
    /// @dev R6.3.2.
    error FundingExpired();
    /// @dev R6.3.3.
    error Underfunded();
    /// @dev R6.4.2 and R6.5.3.
    error ClaimWindowClosed();
    /// @dev R6.4.3.
    error AlreadyClaimed();
    /// @dev R6.4.4 and R6.5.5.
    error BadProof();
    /// @dev R6.4.5.
    error OverEntitlement();
    /// @dev R6.5.1.
    error BadBatchSize();
    /// @dev R6.6.2.
    error FundingStillOpen();
    /// @dev R6.7.2.
    error ClaimWindowOpen();
    /// @dev R6.8.1 and R6.8.5.
    error CannotSweepDropAsset();
    /// @dev R6.8.2.
    error NotFinished();
    /// @dev R6.8.3.
    error NothingToSweep();
    /// @dev R6.9.1.
    error NotAcceptingNative();
    /// @dev R6.4.8 and R8.10. A native `call` returned false.
    error NativeTransferFailed();

    // ---------------------------------------------------------------------
    // functions
    // ---------------------------------------------------------------------

    function initialize(InitParams calldata p) external;

    function activate() external;

    function claim(uint256 index, address recipient, uint256 amount, bytes32[] calldata proof) external;

    function claimBatch(ClaimItem[] calldata items) external;

    function cancelUnfunded() external;

    function refund() external;

    function sweep(address token) external;

    // views, SPEC 6.10

    function isClaimed(uint256 index) external view returns (bool);

    function status() external view returns (Status);

    function config() external view returns (Config memory);

    function unclaimed() external view returns (uint256);

    function assetBalance() external view returns (uint256);

    function claimDeadline() external view returns (uint64);
}
