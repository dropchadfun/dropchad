// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IDropFactoryV3
/// @notice The factory for Robinhood token drops. `docs/SPEC.md` R7.51.
/// @dev `IDropFactoryV2` with a new `CreateParams` (a last field, `nativeFee`), the exact address
///      token allowlist, and two new errors and two new events. It does not inherit
///      `IDropFactoryV1`, because `createDrop` takes the new struct. Every other function, event
///      and error is kept with the same signature, so `DropCreated` and every admin event decode
///      with one ABI for all three factories, R7.51.
interface IDropFactoryV3 {
    // ---------------------------------------------------------------------
    // structs
    // ---------------------------------------------------------------------

    /// @notice SPEC 6.1 plus R7.51: `nativeFee`, the ETH fee of a token drop in wei.
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
        address tokenFactory; // ignored when asset == address(0) or the token is allowed by address
        uint256 nativeFee; // zero on a native drop, R7.51
    }

    // ---------------------------------------------------------------------
    // events, SPEC 11.1, 11.2 and R7.51
    // ---------------------------------------------------------------------

    /// @notice The same signature as `IDropFactoryV1.DropCreated`, R7.51.
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

    /// @notice R7.51. Right after `DropCreated`, on a token drop only.
    event NativeFeeSet(address indexed drop, uint256 nativeFee);

    event PausedSet(bool paused);
    event DefaultFeeBpsSet(uint16 oldBps, uint16 newBps);
    event FeeRecipientSet(address oldRecipient, address newRecipient);
    event TokenFactoryAllowed(address indexed tokenFactory, address adapter, bool allowed);
    event CreatorAllowed(address indexed creator, bool allowed);
    event ImplementationSet(address oldImpl, address newImpl);
    event MinFeeAmountSet(uint256 oldAmount, uint256 newAmount);
    /// @notice R7.51. The exact address token allowlist.
    event TokenAllowed(address indexed token, bool allowed);

    // ---------------------------------------------------------------------
    // errors, SPEC 6.1 and R7.51
    // ---------------------------------------------------------------------

    error NotAllowedCreator();
    error CreationPaused();
    error ZeroTotal();
    error BadLeafCount();
    error ZeroRoot();
    error ZeroManifest();
    error ZeroRefundRecipient();
    error ZeroCommitment();
    error BadFundingPeriod();
    error BadClaimPeriod();
    error FactoryNotAllowed();
    error TokenNotFromFactory();
    error SaltUsed();
    /// @dev R7.51. `nativeFee` above `MAX_NATIVE_FEE` on a token drop.
    error NativeFeeTooHigh();
    /// @dev R7.51. A native drop must carry a `nativeFee` of zero.
    error NativeFeeOnNativeDrop();

    // errors for the admin setters. SPEC names the rules, not these two names.
    error FeeTooHigh();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // functions
    // ---------------------------------------------------------------------

    function createDrop(CreateParams calldata p) external returns (address drop);

    // admin, SPEC 6.11 and R7.51. Owner is the timelock.

    function setPaused(bool paused) external;

    function setDefaultFeeBps(uint16 bps) external;

    function setMinFeeAmount(uint256 amount) external;

    function setFeeRecipient(address recipient) external;

    function setTokenFactoryAllowed(address tokenFactory, address adapter, bool allowed) external;

    /// @notice Owner only. R7.51 and R7.53. `ZeroAddress()` when allowing zero.
    function setTokenAllowed(address token, bool allowed) external;

    function setCreatorAllowed(address creator, bool allowed) external;

    function setImplementation(address impl) external;

    // views

    function implementation() external view returns (address);

    function paused() external view returns (bool);

    function defaultFeeBps() external view returns (uint16);

    function minFeeAmount() external view returns (uint256);

    function feeRecipient() external view returns (address);

    function tokenFactoryAdapter(address tokenFactory) external view returns (address);

    function allowedTokenFactory(address tokenFactory) external view returns (bool);

    function allowedToken(address token) external view returns (bool);

    function allowedCreator(address creator) external view returns (bool);

    function saltUsed(bytes32 salt) external view returns (bool);

    function computeSalt(address creator, bytes32 creatorCommitment, uint256 nonce) external view returns (bytes32);

    function predictDrop(address creator, bytes32 creatorCommitment, uint256 nonce) external view returns (address);
}
