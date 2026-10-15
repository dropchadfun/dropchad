// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IDropFactoryV3} from "./IDropFactoryV3.sol";
import {IDropV1} from "./IDropV1.sol";
import {IDropV3} from "./IDropV3.sol";
import {ITokenFactoryAdapter} from "./ITokenFactoryAdapter.sol";

/// @title DropFactoryV3
/// @notice `DropFactoryV2` plus the ETH fee of a token drop and the exact address token
///         allowlist. Deploys `DropV3` clones.
///
/// @dev Implements `docs/SPEC.md` v1.48, R7.51 and R7.53. That file is the source of truth.
///
///      **This file is `DropFactoryV2.sol` copied line for line, with these changes and nothing
///      else:** `CreateParams` gains `nativeFee`; a token drop takes no fee in the token and
///      carries its ETH fee, capped by `MAX_NATIVE_FEE`, a native drop must carry none; the
///      clone is initialized with that fee and `NativeFeeSet` follows `DropCreated` on a token
///      drop; the `allowedToken` field and its setter `setTokenAllowed`, checked before the
///      launchpad path in R6.1.10. A native drop is created exactly as `DropFactoryV2` creates
///      it. `DropFactoryV2.sol` is left byte for byte as deployed. `DropV3Parity.t.sol` runs the
///      whole `DropFactoryV1Test` and `DropFactoryV2Test` suites against this contract.
///
///      **Admin can only affect future drops.** SPEC 13.1 and 13.2:
///      - R13.1 no function here takes a drop address as an argument
///      - R13.2 pausing does not pause any existing drop
///      - R13.3 there is no admin claim, refund, sweep or emergency withdrawal
///      - R13.4 `setImplementation` changes nothing about clones that already exist
///
///      The owner is a `TimelockController`, which is owned by a 2 of 3 Safe. R13.8, R13.9.
contract DropFactoryV3 is IDropFactoryV3, Ownable {
    // -----------------------------------------------------------------------
    // constants, SPEC 6.12
    //
    // Hard constants, not admin settings. Changing one is a new deployment, never a transaction.
    // -----------------------------------------------------------------------

    /// @dev R6.1.8
    uint32 public constant MIN_FUNDING_PERIOD = 1 hours;
    /// @dev R6.1.8
    uint32 public constant MAX_FUNDING_PERIOD = 30 days;
    /// @dev R6.1.9
    uint32 public constant MIN_CLAIM_PERIOD = 1 days;
    /// @dev R6.1.9
    uint32 public constant MAX_CLAIM_PERIOD = 180 days;
    /// @dev R6.1.3
    uint32 public constant MAX_LEAVES = 10_000;
    /// @notice A ceiling on a compromised admin, not a target. v1 runs at zero. R8.9, R6.12.4.
    uint16 public constant MAX_FEE_BPS = 500;
    /// @notice A ceiling on a compromised admin for `minFeeAmount`, in wei. R8.14, R7.40, 6.12.
    uint256 public constant MAX_MIN_FEE_AMOUNT = 0.001 ether;
    /// @notice A ceiling on the ETH fee of a token drop, in wei. R7.51, 6.12. Owner 2026-10-04.
    uint256 public constant MAX_NATIVE_FEE = 0.05 ether;
    /// @dev R8.2. Basis points denominator.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    // -----------------------------------------------------------------------
    // storage, SPEC 5.5
    // -----------------------------------------------------------------------

    /// @notice Implementation used for **new** clones.
    address public implementation;
    /// @notice Blocks **new** drop creation only. R6.11.2.
    bool public paused;
    /// @notice Fee for **new** drops. Zero for v1, R8.4.
    uint16 public defaultFeeBps;
    /// @notice Fee target snapshotted into **new** drops. R8.7.
    address public feeRecipient;
    /// @notice Flat minimum fee in wei for **new native** drops. Starts at zero. R8.14, R7.40.
    uint256 public minFeeAmount;

    /// @notice Launchpad factory to its adapter contract. SPEC 12.2.
    mapping(address => address) public tokenFactoryAdapter;
    /// @notice The token allowlist. The real defence, R12.15.
    mapping(address => bool) public allowedTokenFactory;
    /// @notice The exact address token allowlist. R7.51; what may go on it, R7.53 and R12.25.
    mapping(address => bool) public allowedToken;
    /// @notice Who may call `createDrop`. The relayer, and nobody else in v1. R6.1.0, Q3.
    mapping(address => bool) public allowedCreator;
    /// @notice One drop per salt, forever. R3.4.
    mapping(bytes32 => bool) public saltUsed;

    // -----------------------------------------------------------------------
    // constructor
    // -----------------------------------------------------------------------

    /// @param owner_ the timelock. R13.8.
    /// @param implementation_ the `DropV3` implementation new clones point at. R7.51.
    /// @param feeRecipient_ where the fee goes for new drops. Unused while `defaultFeeBps` is zero.
    /// @dev `defaultFeeBps` deliberately starts at zero. R8.4.
    constructor(address owner_, address implementation_, address feeRecipient_) Ownable(owner_) {
        if (implementation_ == address(0)) revert ZeroAddress();
        if (feeRecipient_ == address(0)) revert ZeroAddress();

        implementation = implementation_;
        feeRecipient = feeRecipient_;

        emit ImplementationSet(address(0), implementation_);
        emit FeeRecipientSet(address(0), feeRecipient_);
    }

    // -----------------------------------------------------------------------
    // createDrop, SPEC 6.1
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropFactoryV3
    /// @dev Deploy and initialize happen in one transaction, so a clone can never exist in an
    ///      uninitialized state that somebody else could initialize. R3.2.
    function createDrop(CreateParams calldata p) external returns (address drop) {
        IDropV1.InitParams memory init;

        // The braces are load bearing, not style. `DropCreated` carries 16 fields, and with
        // `via_ir` off the emit only fits inside the stack limit if the locals used to build
        // `init` are already out of scope by then. See the note on `_emitDropCreated`.
        {
            _checkCreateParams(p);

            // Effect 1. R6.1 and R3.5. `msg.sender` is in the salt, so a different caller derives
            // a different address and the address we predicted cannot be occupied by anybody else.
            bytes32 salt = computeSalt(msg.sender, p.creatorCommitment, p.nonce);

            // R6.1.11 and R3.4.
            if (saltUsed[salt]) revert SaltUsed();
            // Effect 2.
            saltUsed[salt] = true;

            // Effects 3 and 4. R8.2, integer division rounds down. R8.3 and I7.
            // R7.51 and R8.15. A token drop never pays a percent of the token: its fee is the
            // ETH `nativeFee`, so its `feeAmount` is zero whatever `defaultFeeBps` says.
            uint256 fee = 0;
            if (p.asset == address(0)) {
                fee = (p.totalEntitlements * defaultFeeBps) / BPS_DENOMINATOR;
                // R8.14 and R7.40. Whichever is bigger, never both.
                if (fee < minFeeAmount) fee = minFeeAmount;
            }

            init = IDropV1.InitParams({
                asset: p.asset,
                merkleRoot: p.merkleRoot,
                manifestHash: p.manifestHash,
                totalEntitlements: p.totalEntitlements,
                grossRequired: p.totalEntitlements + fee,
                feeAmount: fee,
                feeRecipient: feeRecipient,
                refundRecipient: p.refundRecipient,
                // R9.9 and R6.1.8. `fundingPeriod` is capped at 30 days and a unix timestamp
                // fits `uint64` until year 584942417355, so neither cast can truncate.
                // forge-lint: disable-next-line(unsafe-typecast)
                fundingDeadline: uint64(block.timestamp) + uint64(p.fundingPeriod),
                claimPeriod: p.claimPeriod,
                leafCount: p.leafCount,
                implementation: implementation,
                creatorCommitment: p.creatorCommitment,
                salt: salt
            });
        }

        // Effects 6 and 7, in the same transaction. R3.2.
        drop = Clones.cloneDeterministic(init.implementation, init.salt);
        // R7.52. Field 14, the ETH fee; zero on a native drop, R6.1.10 below.
        IDropV3(drop).initialize(init, p.nativeFee);

        // Effects 5 and 8.
        _emitDropCreated(drop, init);
        // R7.51. On a token drop, its ETH fee, right after `DropCreated`.
        if (p.asset != address(0)) emit NativeFeeSet(drop, p.nativeFee);
    }

    /// @notice The CREATE2 salt for one creator, commitment and nonce.
    /// @dev SPEC 6.1 effect 1. The backend calls this before it builds the merkle tree.
    function computeSalt(address creator, bytes32 creatorCommitment, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), creator, creatorCommitment, nonce));
    }

    /// @notice The clone address `createDrop` would produce for those inputs.
    /// @dev SPEC 3.2 step 1. Leaves bind this address, so the backend needs it before the tree.
    ///      R3.1. The UI must still check `code.length > 0` before it shows the address to anybody.
    function predictDrop(address creator, bytes32 creatorCommitment, uint256 nonce) external view returns (address) {
        return Clones.predictDeterministicAddress(
            implementation, computeSalt(creator, creatorCommitment, nonce), address(this)
        );
    }

    // -----------------------------------------------------------------------
    // admin, SPEC 6.11. Owner is the timelock.
    // -----------------------------------------------------------------------

    /// @inheritdoc IDropFactoryV3
    /// @dev R6.11.2. This blocks new creation only. Every existing drop keeps working.
    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    /// @inheritdoc IDropFactoryV3
    /// @dev R6.11.4 and R8.9. Capped by `MAX_FEE_BPS`, so even a compromised admin cannot set a
    ///      large fee on future drops. Existing drops are untouched either way, R8.7.
    function setDefaultFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();

        uint16 old = defaultFeeBps;
        defaultFeeBps = bps;
        emit DefaultFeeBpsSet(old, bps);
    }

    /// @inheritdoc IDropFactoryV3
    /// @dev R7.40. New drops only: a drop's fee is fixed at creation, R8.1 and R8.7.
    function setMinFeeAmount(uint256 amount) external onlyOwner {
        if (amount > MAX_MIN_FEE_AMOUNT) revert FeeTooHigh();

        uint256 old = minFeeAmount;
        minFeeAmount = amount;
        emit MinFeeAmountSet(old, amount);
    }

    /// @inheritdoc IDropFactoryV3
    /// @dev R6.11.5.
    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();

        address old = feeRecipient;
        feeRecipient = recipient;
        emit FeeRecipientSet(old, recipient);
    }

    /// @inheritdoc IDropFactoryV3
    /// @dev R6.11.5. An adapter is required when allowing, not when removing.
    ///      R12.18. No launchpad is added without reading its token source first.
    function setTokenFactoryAllowed(address tokenFactory, address adapter, bool allowed) external onlyOwner {
        if (allowed && adapter == address(0)) revert ZeroAddress();

        allowedTokenFactory[tokenFactory] = allowed;
        tokenFactoryAdapter[tokenFactory] = adapter;
        emit TokenFactoryAllowed(tokenFactory, adapter, allowed);
    }

    /// @inheritdoc IDropFactoryV3
    /// @dev R7.51 and R6.11.1. New drops only. R7.53 and R12.25: no token is added without its
    ///      verified source read and written in `docs/RESEARCH.md`, and never a proxy except
    ///      USDC and USDT by exact address.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (allowed && token == address(0)) revert ZeroAddress();

        allowedToken[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    /// @inheritdoc IDropFactoryV3
    /// @dev R6.11.3 and R2.4. This is how a leaked relayer key is rotated. It is **not** a kill
    ///      switch: every drop that creator already made keeps working exactly as before.
    function setCreatorAllowed(address creator, bool allowed) external onlyOwner {
        allowedCreator[creator] = allowed;
        emit CreatorAllowed(creator, allowed);
    }

    /// @inheritdoc IDropFactoryV3
    /// @dev R13.4 and R6.11.5. Only for **new** clones. Existing clones are minimal proxies with
    ///      their implementation baked into their own bytecode. Nothing here can reach them.
    function setImplementation(address impl) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();

        address old = implementation;
        implementation = impl;
        emit ImplementationSet(old, impl);
    }

    // -----------------------------------------------------------------------
    // internals
    // -----------------------------------------------------------------------

    /// @dev Every precondition of R6.1.0 to R6.1.10, in the order the spec lists them, then the
    ///      ETH fee of R7.51.
    function _checkCreateParams(CreateParams calldata p) internal view {
        if (!allowedCreator[msg.sender]) revert NotAllowedCreator(); // R6.1.0
        if (paused) revert CreationPaused(); // R6.1.1
        if (p.totalEntitlements == 0) revert ZeroTotal(); // R6.1.2
        if (p.leafCount == 0 || p.leafCount > MAX_LEAVES) revert BadLeafCount(); // R6.1.3
        if (p.merkleRoot == bytes32(0)) revert ZeroRoot(); // R6.1.4
        if (p.manifestHash == bytes32(0)) revert ZeroManifest(); // R6.1.5
        if (p.refundRecipient == address(0)) revert ZeroRefundRecipient(); // R6.1.6
        if (p.creatorCommitment == bytes32(0)) revert ZeroCommitment(); // R6.1.7

        // R6.1.8
        if (p.fundingPeriod < MIN_FUNDING_PERIOD || p.fundingPeriod > MAX_FUNDING_PERIOD) {
            revert BadFundingPeriod();
        }
        // R6.1.9
        if (p.claimPeriod < MIN_CLAIM_PERIOD || p.claimPeriod > MAX_CLAIM_PERIOD) {
            revert BadClaimPeriod();
        }

        // R6.1.10 and R7.51. Native is always allowed. An ERC20 is allowed by its exact address,
        // else it must come from an allowlisted launchpad, confirmed by that launchpad adapter.
        // Default deny, R12.3.
        if (p.asset != address(0) && !allowedToken[p.asset]) {
            if (!allowedTokenFactory[p.tokenFactory]) revert FactoryNotAllowed();
            if (!ITokenFactoryAdapter(tokenFactoryAdapter[p.tokenFactory]).isTokenFromFactory(p.asset)) {
                revert TokenNotFromFactory();
            }
        }

        // R7.51. The ETH fee: none on a native drop, at most `MAX_NATIVE_FEE` on a token drop.
        if (p.asset == address(0)) {
            if (p.nativeFee != 0) revert NativeFeeOnNativeDrop();
        } else if (p.nativeFee > MAX_NATIVE_FEE) {
            revert NativeFeeTooHigh();
        }
    }

    /// @dev R11.1, R6.1.13 and R7.51. Emits `DropCreated`, the same signature as V1 and V2.
    ///
    ///      **Why this is written with `log4` and not `emit`.**
    ///      `DropCreated` carries 16 fields, and the field list is fixed by SPEC 11.1 because the
    ///      indexer is written against it, R11.4. With `via_ir` off, a plain `emit` of 16 values
    ///      does not fit in the EVM stack: solc fails with "Stack too deep" on field 15. `via_ir`
    ///      stays off by decision, see `foundry.toml` and `docs/RESEARCH.md` Part 5.
    ///
    ///      So the log is written by hand. Two things make that safe to read:
    ///
    ///      1. `topic0` is `DropCreated.selector`, taken from the event declaration itself. It is
    ///         never a hand typed signature string, so it cannot drift from the declaration.
    ///      2. The non-indexed tail is `abi.encode` of the 13 remaining fields, in declaration
    ///         order. Every one of them is a static type, so encoding them in four chunks and
    ///         concatenating is byte for byte identical to encoding them in one call.
    ///
    ///      `test_CreateDrop_EventFieldsMatchInputs` reads the raw log back and checks `topic0`
    ///      against the event selector, the three indexed topics, and the tail decoded into the
    ///      declared field order. A mistake here fails the suite rather than silently breaking
    ///      the indexer.
    ///
    ///      `configHash` hashes every `initialize` argument, including `salt`. It is emitted only.
    ///      It is never stored, and it is never part of the salt: the merkle root depends on the
    ///      drop address and the address depends on the salt, so that would be circular.
    function _emitDropCreated(address drop, IDropV1.InitParams memory init) private {
        bytes memory data = bytes.concat(
            abi.encode(init.merkleRoot, init.manifestHash, init.totalEntitlements),
            abi.encode(init.feeAmount, init.grossRequired, init.feeRecipient),
            abi.encode(init.refundRecipient, init.fundingDeadline, init.claimPeriod),
            abi.encode(init.leafCount, init.implementation, init.salt),
            abi.encode(keccak256(abi.encode(init)))
        );

        bytes32 topic0 = DropCreated.selector;
        bytes32 topic1 = bytes32(uint256(uint160(drop)));
        bytes32 topic2 = init.creatorCommitment;
        bytes32 topic3 = bytes32(uint256(uint160(init.asset)));

        assembly ("memory-safe") {
            log4(add(data, 0x20), mload(data), topic0, topic1, topic2, topic3)
        }
    }
}
