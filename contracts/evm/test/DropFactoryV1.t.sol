// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {Vm} from "forge-std/Vm.sol";

import {DropTestBase} from "./DropTestBase.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropFactoryV1} from "../src/DropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockTokenFactoryAdapter} from "./MockTokenFactoryAdapter.sol";

/// @title DropFactoryV1Test
/// @notice `createDrop`, the creator allowlist, the salt, the adapters and the admin setters.
/// @dev Each test comment names the rule it must fail on if that rule is removed.
contract DropFactoryV1Test is DropTestBase {
    // -----------------------------------------------------------------------
    // createDrop, happy paths
    // -----------------------------------------------------------------------

    /// @dev Native drop, every effect in order.
    function test_CreateDrop_Native_HappyPath() public {
        DropV1 drop = _createNativeDrop(3);

        IDropV1.Config memory c = drop.config();
        assertEq(c.asset, address(0), "native drop asset must be the zero sentinel");
        assertEq(c.merkleRoot, root);
        assertEq(c.manifestHash, MANIFEST_HASH);
        assertEq(c.totalEntitlements, totalEntitlements);
        assertEq(c.leafCount, 3);
        assertEq(c.refundRecipient, refundRecipient);
        assertEq(c.implementation, address(implementation));
        assertEq(c.fundingDeadline, uint64(block.timestamp) + FUNDING_PERIOD);
        assertEq(c.claimPeriod, CLAIM_PERIOD);

        _assertStatus(drop, IDropV1.Status.Created);
        assertTrue(drop.initialized(), "I11. initialized must be true after creation");
    }

    /// @dev ERC20 drop through an allowlisted factory and its adapter.
    function test_CreateDrop_Erc20_HappyPath() public {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);

        assertEq(drop.asset(), address(token), "ERC20 drop asset must be the token");
        _assertStatus(drop, IDropV1.Status.Created);
    }

    /// @dev Deploy and initialize happen in one transaction. A clone is never left
    ///      uninitialized, so nobody else can ever initialize it.
    function test_CreateDrop_DeployAndInitializeInOneTransaction() public {
        DropV1 drop = _createNativeDrop(3);

        assertGt(address(drop).code.length, 0, "the clone must have code");
        assertTrue(drop.initialized(), "the clone must already be initialized");

        // A second initialize from anybody, including the factory, is refused.
        vm.expectRevert(IDropV1.AlreadyInitialized.selector);
        vm.prank(address(factory));
        drop.initialize(_dummyInit(address(drop)));
    }

    /// @dev The address the backend predicted is the address that gets deployed.
    ///      `_createDrop` asserts this on every single drop the suite builds.
    function test_CreateDrop_AddressMatchesPrediction() public {
        bytes32 commitment = _commitment(0);
        address predicted = factory.predictDrop(relayer, commitment, 0);

        DropV1 drop = _createNativeDrop(3);

        assertEq(address(drop), predicted, "");
        assertEq(
            predicted,
            Clones.predictDeterministicAddress(
                address(implementation), factory.computeSalt(relayer, commitment, 0), address(factory)
            ),
            "prediction must be the plain EIP 1167 CREATE2 address"
        );
    }

    /// @dev Every `DropCreated` field equals the input it came from.
    ///      This reads the **raw log** rather than using `vm.expectEmit`, on purpose. It is the
    ///      test that proves the hand written `log4` in `DropFactoryV1._emitDropCreated` matches
    ///      the declared event: `topic0` against the event selector, the three indexed topics,
    ///      and the non-indexed tail decoded straight back into the declared field order.
    ///      If the assembly ever drifts, this fails instead of the indexer silently breaking.
    function test_CreateDrop_EventFieldsMatchInputs() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        bytes32 salt = factory.computeSalt(relayer, p.creatorCommitment, p.nonce);
        uint64 expectedFundingDeadline = uint64(block.timestamp) + p.fundingPeriod;

        vm.recordLogs();
        vm.prank(relayer);
        address created = _sendCreateDrop(p);

        Vm.Log memory entry = _findDropCreated(vm.getRecordedLogs());

        // topics
        assertEq(entry.topics.length, 4, "three indexed fields plus the signature");
        assertEq(entry.topics[0], IDropFactoryV1.DropCreated.selector, "topic0 must be the event selector");
        assertEq(entry.topics[1], bytes32(uint256(uint160(created))), "topic1 is the drop");
        assertEq(entry.topics[2], p.creatorCommitment, "topic2 is the creatorCommitment");
        assertEq(entry.topics[3], bytes32(uint256(uint160(p.asset))), "topic3 is the asset");

        // non-indexed tail, decoded back into the declared order
        assertEq(entry.data.length, 13 * 32, "thirteen static words");
        DropCreatedTail memory t = abi.decode(entry.data, (DropCreatedTail));

        assertEq(t.merkleRoot, p.merkleRoot, "merkleRoot");
        assertEq(t.manifestHash, p.manifestHash, "manifestHash");
        assertEq(t.totalEntitlements, p.totalEntitlements, "totalEntitlements");
        assertEq(t.feeAmount, 0, "feeAmount., v1 runs at zero");
        assertEq(t.grossRequired, p.totalEntitlements, "grossRequired. I7 at a zero fee");
        assertEq(t.feeRecipient, feeRecipient, "feeRecipient");
        assertEq(t.refundRecipient, p.refundRecipient, "refundRecipient");
        assertEq(t.fundingDeadline, expectedFundingDeadline, "fundingDeadline");
        assertEq(t.claimPeriod, p.claimPeriod, "claimPeriod");
        assertEq(t.leafCount, p.leafCount, "leafCount");
        assertEq(t.implementation, address(implementation), "implementation");
        assertEq(t.salt, salt, "salt");

        // `configHash` hashes every initialize argument, salt included.
        assertEq(t.configHash, keccak256(abi.encode(_expectedInit(p, salt))), "configHash");
    }

    /// @dev Events alone are enough to rebuild full drop state, so every field the drop
    ///      actually stored must also be readable from the log.
    function test_CreateDrop_EventMatchesStoredConfig() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();

        vm.recordLogs();
        vm.prank(relayer);
        DropV1 drop = DropV1(payable(_sendCreateDrop(p)));

        DropCreatedTail memory t = abi.decode(_findDropCreated(vm.getRecordedLogs()).data, (DropCreatedTail));
        IDropV1.Config memory c = drop.config();

        assertEq(t.merkleRoot, c.merkleRoot);
        assertEq(t.manifestHash, c.manifestHash);
        assertEq(t.totalEntitlements, c.totalEntitlements);
        assertEq(t.feeAmount, c.feeAmount);
        assertEq(t.grossRequired, c.grossRequired);
        assertEq(t.feeRecipient, c.feeRecipient);
        assertEq(t.refundRecipient, c.refundRecipient);
        assertEq(t.fundingDeadline, c.fundingDeadline);
        assertEq(t.claimPeriod, c.claimPeriod);
        assertEq(t.leafCount, c.leafCount);
        assertEq(t.implementation, c.implementation);
    }

    /// @dev `feeAmount` is computed at creation from the factory `defaultFeeBps`,
    ///      by integer division, which rounds down.
    function test_CreateDrop_FeeAmountSnapshotFromDefaultBps() public {
        vm.prank(owner);
        factory.setDefaultFeeBps(250); // 2.5%

        DropV1 drop = _createNativeDrop(3);

        // 6 ether at 250 bps.
        assertEq(drop.feeAmount(), (totalEntitlements * 250) / 10_000, "");
        assertGt(drop.feeAmount(), 0, "the fee path must really be exercised");
    }

    /// @dev Integer division rounds down, it never rounds up.
    function test_CreateDrop_FeeAmountRoundsDown() public {
        vm.prank(owner);
        factory.setDefaultFeeBps(1); // 0.01%

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = address(uint160(0x1001));
        a[0] = 9999; // 9999 * 1 / 10000 == 0 after rounding down

        DropV1 drop = _createNativeDropFor(r, a);
        assertEq(drop.feeAmount(), 0, "the fee rounds down to zero");
        assertEq(drop.grossRequired(), 9999, "I7 still holds at a zero fee");
    }

    /// @dev `grossRequired == totalEntitlements + feeAmount`.
    function test_CreateDrop_GrossRequiredEqualsTotalPlusFee() public {
        vm.prank(owner);
        factory.setDefaultFeeBps(500);

        DropV1 drop = _createNativeDrop(4);

        assertEq(drop.grossRequired(), drop.totalEntitlements() + drop.feeAmount(), "I7");
    }

    /// @dev Changing `feeRecipient` on the factory later does not touch an existing drop.
    function test_CreateDrop_FeeRecipientIsSnapshotted() public {
        DropV1 drop = _createNativeDrop(3);
        assertEq(drop.feeRecipient(), feeRecipient);

        address other = makeAddr("otherFeeRecipient");
        vm.prank(owner);
        factory.setFeeRecipient(other);

        assertEq(drop.feeRecipient(), feeRecipient, "and I6. an existing drop must not move");
        assertEq(factory.feeRecipient(), other, "the factory itself did change");
    }

    // -----------------------------------------------------------------------
    // createDrop, every revert of
    // -----------------------------------------------------------------------

    /// @dev `NotAllowedCreator`.
    function test_RevertWhen_CreateDrop_CallerNotAllowed() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();

        vm.expectRevert(IDropFactoryV1.NotAllowedCreator.selector);
        vm.prank(stranger);
        _sendCreateDrop(p);
    }

    /// @dev `CreationPaused`.
    function test_RevertWhen_CreateDrop_Paused() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();

        vm.prank(owner);
        factory.setPaused(true);

        vm.expectRevert(IDropFactoryV1.CreationPaused.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `ZeroTotal`.
    function test_RevertWhen_CreateDrop_ZeroTotal() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.totalEntitlements = 0;

        vm.expectRevert(IDropFactoryV1.ZeroTotal.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `BadLeafCount`, zero side.
    function test_RevertWhen_CreateDrop_ZeroLeafCount() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.leafCount = 0;

        vm.expectRevert(IDropFactoryV1.BadLeafCount.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `BadLeafCount`, above `MAX_LEAVES`.
    function test_RevertWhen_CreateDrop_LeafCountAboveMax() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.leafCount = factory.MAX_LEAVES() + 1;

        vm.expectRevert(IDropFactoryV1.BadLeafCount.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `ZeroRoot`.
    function test_RevertWhen_CreateDrop_ZeroRoot() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.merkleRoot = bytes32(0);

        vm.expectRevert(IDropFactoryV1.ZeroRoot.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `ZeroManifest`.
    function test_RevertWhen_CreateDrop_ZeroManifest() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.manifestHash = bytes32(0);

        vm.expectRevert(IDropFactoryV1.ZeroManifest.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `ZeroRefundRecipient`. It is an explicit input, never inferred.
    function test_RevertWhen_CreateDrop_ZeroRefundRecipient() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.refundRecipient = address(0);

        vm.expectRevert(IDropFactoryV1.ZeroRefundRecipient.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `ZeroCommitment`.
    function test_RevertWhen_CreateDrop_ZeroCommitment() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.creatorCommitment = bytes32(0);

        vm.expectRevert(IDropFactoryV1.ZeroCommitment.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `BadFundingPeriod`, one second below `MIN_FUNDING_PERIOD`.
    function test_RevertWhen_CreateDrop_FundingPeriodTooShort() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.fundingPeriod = factory.MIN_FUNDING_PERIOD() - 1;

        vm.expectRevert(IDropFactoryV1.BadFundingPeriod.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `BadFundingPeriod`, one second above `MAX_FUNDING_PERIOD`.
    function test_RevertWhen_CreateDrop_FundingPeriodTooLong() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.fundingPeriod = factory.MAX_FUNDING_PERIOD() + 1;

        vm.expectRevert(IDropFactoryV1.BadFundingPeriod.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev Both bounds are inclusive.
    function test_CreateDrop_FundingPeriodAtBothBounds_Succeeds() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.fundingPeriod = factory.MIN_FUNDING_PERIOD();
        vm.prank(relayer);
        _sendCreateDrop(p);

        IDropFactoryV1.CreateParams memory q = _validNativeParams();
        q.nonce = 1;
        q.creatorCommitment = _commitment(1);
        q.fundingPeriod = factory.MAX_FUNDING_PERIOD();
        vm.prank(relayer);
        _sendCreateDrop(q);
    }

    /// @dev `BadClaimPeriod`, one second below `MIN_CLAIM_PERIOD`.
    function test_RevertWhen_CreateDrop_ClaimPeriodTooShort() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.claimPeriod = factory.MIN_CLAIM_PERIOD() - 1;

        vm.expectRevert(IDropFactoryV1.BadClaimPeriod.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `BadClaimPeriod`, one second above `MAX_CLAIM_PERIOD`.
    function test_RevertWhen_CreateDrop_ClaimPeriodTooLong() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.claimPeriod = factory.MAX_CLAIM_PERIOD() + 1;

        vm.expectRevert(IDropFactoryV1.BadClaimPeriod.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev Both bounds are inclusive.
    function test_CreateDrop_ClaimPeriodAtBothBounds_Succeeds() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.claimPeriod = factory.MIN_CLAIM_PERIOD();
        vm.prank(relayer);
        _sendCreateDrop(p);

        IDropFactoryV1.CreateParams memory q = _validNativeParams();
        q.nonce = 1;
        q.creatorCommitment = _commitment(1);
        q.claimPeriod = factory.MAX_CLAIM_PERIOD();
        vm.prank(relayer);
        _sendCreateDrop(q);
    }

    /// @dev `FactoryNotAllowed`. Default deny.
    function test_RevertWhen_CreateDrop_TokenFactoryNotAllowed() public {
        MockERC20 token = new MockERC20("Token", "TKN", 18);

        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        IDropFactoryV1.CreateParams memory p = _validParams(address(token), makeAddr("unknownLaunchpad"), 0, r, a);

        vm.expectRevert(IDropFactoryV1.FactoryNotAllowed.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `TokenNotFromFactory`. The launchpad is allowlisted, the token is not from it.
    function test_RevertWhen_CreateDrop_TokenNotFromFactory() public {
        MockERC20 allowed = new MockERC20("Allowed", "OK", 18);
        MockERC20 outsider = new MockERC20("Outsider", "NO", 18);
        address tokenFactory = _allowToken(address(allowed));

        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        IDropFactoryV1.CreateParams memory p = _validParams(address(outsider), tokenFactory, 0, r, a);

        vm.expectRevert(IDropFactoryV1.TokenNotFromFactory.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev `SaltUsed`. One drop per salt, forever.
    function test_RevertWhen_CreateDrop_SaltReused() public {
        _createNativeDrop(3);

        // Same creator, same commitment, same nonce, so the same salt.
        IDropFactoryV1.CreateParams memory p = _validNativeParams();

        vm.expectRevert(IDropFactoryV1.SaltUsed.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev A different nonce is a different salt, so it is a different drop.
    function test_CreateDrop_DifferentNonce_DifferentDrop() public {
        DropV1 first = _createNativeDrop(3);

        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        DropV1 second = _createDrop(address(0), address(0), 1, r, a);

        assertTrue(address(first) != address(second), "a new nonce must give a new address");
    }

    // -----------------------------------------------------------------------
    // createDrop access
    // -----------------------------------------------------------------------

    /// @dev An allowlisted caller succeeds.
    function test_CreateDrop_AllowedCreatorSucceeds() public {
        assertTrue(factory.allowedCreator(relayer), "the relayer must be allowlisted in setUp");
        DropV1 drop = _createNativeDrop(3);
        assertGt(address(drop).code.length, 0);
    }

    /// @dev After `setCreatorAllowed(relayer, false)`, new creation reverts.
    function test_RevertWhen_CreateDrop_AfterCreatorRemoved() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();

        vm.prank(owner);
        factory.setCreatorAllowed(relayer, false);

        vm.expectRevert(IDropFactoryV1.NotAllowedCreator.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev **Removing a creator is not a kill switch.** A drop that
    ///      creator already made still activates, claims and refunds normally.
    function test_ExistingDrop_StillWorks_AfterCreatorRemoved() public {
        DropV1 drop = _createNativeDrop(3);
        IDropV1.Config memory before = drop.config();

        vm.prank(owner);
        factory.setCreatorAllowed(relayer, false);

        _assertConfigUnchanged(drop, before);

        // activate
        _activateNative(drop);
        _assertStatus(drop, IDropV1.Status.Active);

        // claim
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(recipients[0].balance, amounts[0], "the crowd still gets paid");

        // refund
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        _assertStatus(drop, IDropV1.Status.Finalized);
    }

    // -----------------------------------------------------------------------
    // the salt binds the caller
    // -----------------------------------------------------------------------

    /// @dev Same commitment and nonce from two senders give two different clone addresses.
    function test_Salt_BindsCaller_TwoSendersTwoAddresses() public view {
        bytes32 commitment = _commitment(0);

        bytes32 saltA = factory.computeSalt(relayer, commitment, 0);
        bytes32 saltB = factory.computeSalt(stranger, commitment, 0);
        assertTrue(saltA != saltB, "a different caller must give a different salt");

        address dropA = factory.predictDrop(relayer, commitment, 0);
        address dropB = factory.predictDrop(stranger, commitment, 0);
        assertTrue(dropA != dropB, "a different caller must give a different address");
    }

    /// @dev run against the real factory rather than the pure fixture.
    ///      A watcher cannot occupy the address we already built a merkle tree for.
    function test_Salt_ReproducesSpecStepNinePair() public {
        bytes32 commitment = _commitment(0);
        address ours = factory.predictDrop(relayer, commitment, 0);

        // The watcher tries the same commitment and nonce from their own address.
        vm.prank(owner);
        factory.setCreatorAllowed(stranger, true);

        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        _setCrowd(r, a);
        _buildTree(factory.predictDrop(stranger, commitment, 0));

        vm.prank(stranger);
        address theirs = _sendCreateDrop(
            IDropFactoryV1.CreateParams({
                asset: address(0),
                merkleRoot: root,
                manifestHash: MANIFEST_HASH,
                totalEntitlements: totalEntitlements,
                leafCount: 3,
                refundRecipient: refundRecipient,
                creatorCommitment: commitment,
                nonce: 0,
                fundingPeriod: FUNDING_PERIOD,
                claimPeriod: CLAIM_PERIOD,
                tokenFactory: address(0)
            })
        );

        assertTrue(theirs != ours, "the watcher landed somewhere else");
        assertEq(address(ours).code.length, 0, "our predicted address is still free");

        // And we can still take it.
        DropV1 drop = _createNativeDrop(3);
        assertEq(address(drop), ours, "we still get the address we predicted");
    }

    // -----------------------------------------------------------------------
    // adapters
    // -----------------------------------------------------------------------

    /// @dev True for a token from the wrapped factory.
    function test_Adapter_IsTokenFromFactory_TrueForOwnToken() public {
        MockTokenFactoryAdapter adapter = new MockTokenFactoryAdapter();
        address token = makeAddr("ponsToken");
        adapter.setToken(token, true, makeAddr("deployer"));

        assertTrue(adapter.isTokenFromFactory(token), "");
    }

    /// @dev Membership is **per factory**. Each launchpad keeps its own record, so a
    ///      token from the other generation is false here.
    function test_Adapter_IsTokenFromFactory_FalseForOtherGeneration() public {
        MockTokenFactoryAdapter genOne = new MockTokenFactoryAdapter();
        MockTokenFactoryAdapter genTwo = new MockTokenFactoryAdapter();

        address tokenOne = makeAddr("v1Token");
        address tokenTwo = makeAddr("v2Token");
        genOne.setToken(tokenOne, true, makeAddr("deployerOne"));
        genTwo.setToken(tokenTwo, true, makeAddr("deployerTwo"));

        assertTrue(genOne.isTokenFromFactory(tokenOne));
        assertFalse(genOne.isTokenFromFactory(tokenTwo), "not from this generation");
        assertTrue(genTwo.isTokenFromFactory(tokenTwo));
        assertFalse(genTwo.isTokenFromFactory(tokenOne), "not from this generation");
    }

    /// @dev Returns the launch deployer, never a fee recipient.
    function test_Adapter_GetTokenDeployer_ReturnsLaunchDeployer() public {
        MockTokenFactoryAdapter adapter = new MockTokenFactoryAdapter();
        address token = makeAddr("ponsToken");
        address deployer = makeAddr("theRealCreator");
        adapter.setToken(token, true, deployer);

        assertEq(adapter.getTokenDeployer(token), deployer, "");
    }

    /// @dev Reverts rather than returning the zero address, so a caller can never confuse
    ///      "not from this launchpad" with "the deployer is zero".
    function test_RevertWhen_Adapter_GetTokenDeployer_TokenNotFromFactory() public {
        MockTokenFactoryAdapter adapter = new MockTokenFactoryAdapter();
        address outsider = makeAddr("outsiderToken");

        vm.expectRevert(abi.encodeWithSelector(MockTokenFactoryAdapter.NotFromThisFactory.selector, outsider));
        adapter.getTokenDeployer(outsider);
    }

    /// @dev Default deny. If the adapter reverts, creation reverts with it.
    function test_RevertWhen_CreateDrop_AdapterReverts() public {
        MockERC20 token = new MockERC20("Token", "TKN", 18);

        MockTokenFactoryAdapter adapter = new MockTokenFactoryAdapter();
        adapter.setRevertOnUnknown(true);
        address tokenFactory = makeAddr("revertingLaunchpad");

        vm.prank(owner);
        factory.setTokenFactoryAllowed(tokenFactory, address(adapter), true);

        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        IDropFactoryV1.CreateParams memory p = _validParams(address(token), tokenFactory, 0, r, a);

        vm.expectRevert(abi.encodeWithSelector(MockTokenFactoryAdapter.NotFromThisFactory.selector, address(token)));
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev Pons V1 and V2 return different structs from the same call,
    ///      so each generation needs its own adapter.
    ///      **Stays skipped on purpose.** `PonsV1Adapter` and `PonsV2Adapter` are a separate
    ///      task, and the Pons addresses are still unverified.
    ///      The generic adapter above covers the design in the meantime.
    function test_PonsAdapters_BothStructShapesDecode() public {
        vm.skip(true);
    }

    // -----------------------------------------------------------------------
    // admin
    // -----------------------------------------------------------------------

    function test_SetPaused_FromOwner() public {
        assertFalse(factory.paused());

        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV1.PausedSet(true);
        vm.prank(owner);
        factory.setPaused(true);

        assertTrue(factory.paused());
    }

    /// @dev `onlyOwner`.
    function test_RevertWhen_SetPaused_FromAnyone() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        factory.setPaused(true);
    }

    /// @dev Pausing blocks new creation only. Every existing drop keeps working, in
    ///      every state, with no dropchad involvement.
    function test_SetPaused_BlocksCreationOnly() public {
        DropV1 drop = _createNativeDrop(3);

        vm.prank(owner);
        factory.setPaused(true);

        // The live drop does not know the factory exists.
        _activateNative(drop);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(recipients[0].balance, amounts[0], "claims still work while paused");

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        _assertStatus(drop, IDropV1.Status.Finalized);
    }

    function test_SetDefaultFeeBps_FromOwner() public {
        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV1.DefaultFeeBpsSet(0, 300);
        vm.prank(owner);
        factory.setDefaultFeeBps(300);

        assertEq(factory.defaultFeeBps(), 300);
    }

    /// @dev v1 ships at zero.
    function test_DefaultFeeBps_StartsAtZero() public view {
        assertEq(factory.defaultFeeBps(), 0, "production runs at zero fee");
    }

    /// @dev `MAX_FEE_BPS = 500`. Even a compromised admin cannot go above it.
    function test_RevertWhen_SetDefaultFeeBps_AboveMaxFeeBps() public {
        assertEq(factory.MAX_FEE_BPS(), 500, "");

        vm.expectRevert(IDropFactoryV1.FeeTooHigh.selector);
        vm.prank(owner);
        factory.setDefaultFeeBps(501);
    }

    /// @dev The cap itself is allowed.
    function test_SetDefaultFeeBps_AtMaxFeeBps_Succeeds() public {
        uint16 cap = factory.MAX_FEE_BPS();

        vm.prank(owner);
        factory.setDefaultFeeBps(cap);

        assertEq(factory.defaultFeeBps(), 500);
    }

    /// @dev `onlyOwner`.
    function test_RevertWhen_SetDefaultFeeBps_FromAnyone() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        factory.setDefaultFeeBps(1);
    }

    function test_SetFeeRecipient_FromOwner() public {
        address next = makeAddr("nextFeeRecipient");

        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV1.FeeRecipientSet(feeRecipient, next);
        vm.prank(owner);
        factory.setFeeRecipient(next);

        assertEq(factory.feeRecipient(), next);
    }

    function test_RevertWhen_SetFeeRecipient_Zero() public {
        vm.expectRevert(IDropFactoryV1.ZeroAddress.selector);
        vm.prank(owner);
        factory.setFeeRecipient(address(0));
    }

    /// @dev `onlyOwner`.
    function test_RevertWhen_SetFeeRecipient_FromAnyone() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        factory.setFeeRecipient(stranger);
    }

    function test_SetTokenFactoryAllowed_FromOwner() public {
        address launchpad = makeAddr("launchpad");
        address adapter = address(new MockTokenFactoryAdapter());

        vm.expectEmit(true, false, false, true, address(factory));
        emit IDropFactoryV1.TokenFactoryAllowed(launchpad, adapter, true);
        vm.prank(owner);
        factory.setTokenFactoryAllowed(launchpad, adapter, true);

        assertTrue(factory.allowedTokenFactory(launchpad));
        assertEq(factory.tokenFactoryAdapter(launchpad), adapter);

        // and removal
        vm.prank(owner);
        factory.setTokenFactoryAllowed(launchpad, address(0), false);
        assertFalse(factory.allowedTokenFactory(launchpad), "removal needs no adapter");
    }

    /// @dev Allowing without an adapter would make the launchpad check call into empty code.
    function test_RevertWhen_SetTokenFactoryAllowed_WithZeroAdapter() public {
        vm.expectRevert(IDropFactoryV1.ZeroAddress.selector);
        vm.prank(owner);
        factory.setTokenFactoryAllowed(makeAddr("launchpad"), address(0), true);
    }

    /// @dev `onlyOwner`.
    function test_RevertWhen_SetTokenFactoryAllowed_FromAnyone() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        factory.setTokenFactoryAllowed(makeAddr("launchpad"), makeAddr("adapter"), true);
    }

    /// @dev This is how the relayer is rotated.
    function test_SetCreatorAllowed_FromOwner() public {
        address newRelayer = makeAddr("newRelayer");

        vm.expectEmit(true, false, false, true, address(factory));
        emit IDropFactoryV1.CreatorAllowed(newRelayer, true);
        vm.prank(owner);
        factory.setCreatorAllowed(newRelayer, true);

        assertTrue(factory.allowedCreator(newRelayer));
    }

    /// @dev `onlyOwner`.
    function test_RevertWhen_SetCreatorAllowed_FromAnyone() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        factory.setCreatorAllowed(stranger, true);
    }

    function test_SetImplementation_FromOwner() public {
        address next = address(new DropV1());

        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV1.ImplementationSet(address(implementation), next);
        vm.prank(owner);
        factory.setImplementation(next);

        assertEq(factory.implementation(), next);
    }

    function test_RevertWhen_SetImplementation_Zero() public {
        vm.expectRevert(IDropFactoryV1.ZeroAddress.selector);
        vm.prank(owner);
        factory.setImplementation(address(0));
    }

    /// @dev `onlyOwner`.
    function test_RevertWhen_SetImplementation_FromAnyone() public {
        address next = address(new DropV1());

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        factory.setImplementation(next);
    }

    /// @dev A new implementation changes nothing about clones that already exist.
    ///      They are minimal proxies with the old address baked into their own bytecode.
    function test_SetImplementation_DoesNotChangeExistingClones() public {
        DropV1 drop = _createNativeDrop(3);
        IDropV1.Config memory before = drop.config();

        address next = address(new DropV1());
        vm.prank(owner);
        factory.setImplementation(next);

        _assertConfigUnchanged(drop, before);
        assertEq(drop.implementation(), address(implementation), "the clone still points at the old one");

        // And it still works end to end.
        _activateNative(drop);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(recipients[0].balance, amounts[0]);
    }

    /// @dev **No admin action changes any state of an already created drop.**
    ///      Every setter is fired here, in one go, against a live drop.
    function test_Admin_NoActionTouchesAnExistingDrop() public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        IDropV1.Config memory before = drop.config();
        uint64 deadlineBefore = drop.claimDeadline();
        uint8 statusBefore = uint8(drop.status());

        vm.startPrank(owner);
        factory.setPaused(true);
        factory.setDefaultFeeBps(factory.MAX_FEE_BPS());
        factory.setFeeRecipient(makeAddr("hostileFeeRecipient"));
        factory.setTokenFactoryAllowed(makeAddr("launchpad"), address(new MockTokenFactoryAdapter()), true);
        factory.setCreatorAllowed(relayer, false);
        factory.setImplementation(address(new DropV1()));
        vm.stopPrank();

        _assertConfigUnchanged(drop, before);
        assertEq(drop.claimDeadline(), deadlineBefore, "I6 and I16");
        assertEq(uint8(drop.status()), statusBefore, "I6 and I9");
        assertEq(address(drop).balance, drop.grossRequired(), "I6. the money did not move");
    }

    // -----------------------------------------------------------------------

    /// @notice The 13 non-indexed fields of `DropCreated`, in declaration order.
    /// @dev Every member is a static type, so the struct is a static tuple and decoding it from
    ///      the log data is exactly the inverse of how the event encodes its tail. Declaring it
    ///      here, from, means the test does not reuse the contract chunking.
    struct DropCreatedTail {
        bytes32 merkleRoot;
        bytes32 manifestHash;
        uint256 totalEntitlements;
        uint256 feeAmount;
        uint256 grossRequired;
        address feeRecipient;
        address refundRecipient;
        uint64 fundingDeadline;
        uint32 claimPeriod;
        uint32 leafCount;
        address implementation;
        bytes32 salt;
        bytes32 configHash;
    }

    function _findDropCreated(Vm.Log[] memory logs) internal view returns (Vm.Log memory) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(factory) && logs[i].topics[0] == IDropFactoryV1.DropCreated.selector) {
                return logs[i];
            }
        }
        revert("DropCreated was not emitted");
    }

    /// @dev What the factory must have passed to `initialize`, rebuilt from the inputs.
    function _expectedInit(IDropFactoryV1.CreateParams memory p, bytes32 salt)
        internal
        view
        returns (IDropV1.InitParams memory)
    {
        uint256 fee = (p.totalEntitlements * factory.defaultFeeBps()) / 10_000;
        return IDropV1.InitParams({
            asset: p.asset,
            merkleRoot: p.merkleRoot,
            manifestHash: p.manifestHash,
            totalEntitlements: p.totalEntitlements,
            grossRequired: p.totalEntitlements + fee,
            feeAmount: fee,
            feeRecipient: factory.feeRecipient(),
            refundRecipient: p.refundRecipient,
            fundingDeadline: uint64(block.timestamp) + p.fundingPeriod,
            claimPeriod: p.claimPeriod,
            leafCount: p.leafCount,
            implementation: factory.implementation(),
            creatorCommitment: p.creatorCommitment,
            salt: salt
        });
    }

    /// @dev Params that are syntactically fine but will never pass the `OnlyFactory` check.
    function _dummyInit(address dropAddress) internal view returns (IDropV1.InitParams memory) {
        dropAddress;
        return IDropV1.InitParams({
            asset: address(0),
            merkleRoot: bytes32(uint256(1)),
            manifestHash: bytes32(uint256(2)),
            totalEntitlements: 1,
            grossRequired: 1,
            feeAmount: 0,
            feeRecipient: feeRecipient,
            refundRecipient: refundRecipient,
            fundingDeadline: uint64(block.timestamp) + 1 days,
            claimPeriod: CLAIM_PERIOD,
            leafCount: 1,
            implementation: address(implementation),
            creatorCommitment: bytes32(uint256(3)),
            salt: bytes32(0)
        });
    }
}
