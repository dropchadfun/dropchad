// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IDropFactoryV1
/// @notice Deploys and initializes `DropV1` clones, holds the token and creator allowlists.
/// @dev Every name in this file comes from `docs/SPEC.md` v1.2. That file wins.
interface IDropFactoryV1 {
    // ---------------------------------------------------------------------
    // structs
    // ---------------------------------------------------------------------

    /// @notice Inputs to `createDrop`. SPEC 6.1.
    struct CreateParams {
        address asset;
        bytes32 merkleRoot;
        bytes32 manifestHash;
        uint256 totalEntitlements;
        uint32 leafCount;
        address refundRecipient;
        bytes32 creatorCommitment;
        uint256 nonce;
        uint32 fundingPeriod;
        uint32 claimPeriod;
        address tokenFactory; // ignored when asset == address(0)
    }

    // ---------------------------------------------------------------------
    // events, SPEC 11.1 and 11.2
    // ---------------------------------------------------------------------

    /// @dev Carries every field the indexer needs to rebuild the drop config. R11.1.
    event DropCreated(
        address indexed drop,
        bytes32 indexed creatorCommitment,
        address indexed asset,
        bytes32 merkleRoot,
        bytes32 manifestHash,
        uint256 totalEntitlements,
        uint256 feeAmount,
        uint256 grossRequired,
        address feeRecipient,
        address refundRecipient,
        uint64 fundingDeadline,
        uint32 claimPeriod,
        uint32 leafCount,
        address implementation,
        bytes32 salt,
        bytes32 configHash
    );

    event PausedSet(bool paused);
    event DefaultFeeBpsSet(uint16 oldBps, uint16 newBps);
    event FeeRecipientSet(address oldRecipient, address newRecipient);
    event TokenFactoryAllowed(address indexed tokenFactory, address adapter, bool allowed);
    event CreatorAllowed(address indexed creator, bool allowed);
    event ImplementationSet(address oldImpl, address newImpl);

    // ---------------------------------------------------------------------
    // errors, SPEC 6.1
    // ---------------------------------------------------------------------

    /// @dev R6.1.0.
    error NotAllowedCreator();
    /// @dev R6.1.1.
    error CreationPaused();
    /// @dev R6.1.2.
    error ZeroTotal();
    /// @dev R6.1.3.
    error BadLeafCount();
    /// @dev R6.1.4.
    error ZeroRoot();
    /// @dev R6.1.5.
    error ZeroManifest();
    /// @dev R6.1.6.
    error ZeroRefundRecipient();
    /// @dev R6.1.7.
    error ZeroCommitment();
    /// @dev R6.1.8.
    error BadFundingPeriod();
    /// @dev R6.1.9.
    error BadClaimPeriod();
    /// @dev R6.1.10.
    error FactoryNotAllowed();
    /// @dev R6.1.10.
    error TokenNotFromFactory();
    /// @dev R6.1.11 and R3.4.
    error SaltUsed();

    // errors for the admin setters. SPEC names the rules, not these two names.
    /// @dev R8.9. `defaultFeeBps` above `MAX_FEE_BPS`.
    error FeeTooHigh();
    /// @dev Defensive. A setter was given the zero address where zero is meaningless.
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // functions
    // ---------------------------------------------------------------------

    function createDrop(CreateParams calldata p) external returns (address drop);

    // admin, SPEC 6.11. Owner is the timelock.

    function setPaused(bool paused) external;

    function setDefaultFeeBps(uint16 bps) external;

    function setFeeRecipient(address recipient) external;

    function setTokenFactoryAllowed(address tokenFactory, address adapter, bool allowed) external;

    function setCreatorAllowed(address creator, bool allowed) external;

    function setImplementation(address impl) external;

    // views

    function implementation() external view returns (address);

    function paused() external view returns (bool);

    function defaultFeeBps() external view returns (uint16);

    function feeRecipient() external view returns (address);

    function tokenFactoryAdapter(address tokenFactory) external view returns (address);

    function allowedTokenFactory(address tokenFactory) external view returns (bool);

    function allowedCreator(address creator) external view returns (bool);

    function saltUsed(bytes32 salt) external view returns (bool);

    function computeSalt(address creator, bytes32 creatorCommitment, uint256 nonce) external view returns (bytes32);

    function predictDrop(address creator, bytes32 creatorCommitment, uint256 nonce) external view returns (address);
}
