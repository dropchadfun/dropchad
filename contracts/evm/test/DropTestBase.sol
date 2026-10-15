// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";

import {DropV1} from "../src/DropV1.sol";
import {DropFactoryV1} from "../src/DropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";

import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockTokenFactoryAdapter} from "./MockTokenFactoryAdapter.sol";

/// @title DropTestBase
/// @notice Shared setup for every drop test. Deploys the implementation and a factory, allowlists
///         the relayer, and builds merkle trees bound to the predicted clone address.
/// @dev The tree must be built **before** the drop exists, because leaves bind the drop address,
///      `_createDrop` does the predict, build, create sequence in that
///      order and asserts the predicted address is the one that gets deployed.
abstract contract DropTestBase is Test {
    // -----------------------------------------------------------------------
    // actors
    // -----------------------------------------------------------------------

    /// @dev Stands in for the `TimelockController`.
    address internal owner = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal refundRecipient = makeAddr("refundRecipient");
    address internal stranger = makeAddr("stranger");
    address internal funder = makeAddr("funder");

    // -----------------------------------------------------------------------
    // deployment
    // -----------------------------------------------------------------------

    DropV1 internal implementation;
    DropFactoryV1 internal factory;

    // -----------------------------------------------------------------------
    // the default drop shape
    // -----------------------------------------------------------------------

    uint32 internal constant FUNDING_PERIOD = 7 days;
    uint32 internal constant CLAIM_PERIOD = 30 days;
    bytes32 internal constant MANIFEST_HASH = keccak256("dropchad test manifest");
    uint256 internal constant X_USER_ID = 1_234_567_890;

    /// @dev The current tree. Rebuilt by every `_createDrop`.
    address[] internal recipients;
    uint256[] internal amounts;
    bytes32[] internal leaves;
    bytes32 internal root;
    uint256 internal totalEntitlements;

    function setUp() public virtual {
        // A sane wall clock, so deadlines are far from zero and from the uint64 ceiling.
        vm.warp(1_800_000_000);

        implementation = DropV1(payable(_deployImplementation()));
        factory = DropFactoryV1(_deployFactory());

        vm.prank(owner);
        factory.setCreatorAllowed(relayer, true);
    }

    /// @notice The implementation under test.
    /// @dev The `DropV2Parity` suites override this to run the `DropV1` suites against `DropV2`.
    ///      Its ABI is a superset of V1's, so the `DropV1` typed field calls it unchanged.
    function _deployImplementation() internal virtual returns (address) {
        return address(new DropV1());
    }

    /// @notice The factory under test.
    /// @dev `DropFactoryV2Test` overrides this to run the whole `DropFactoryV1Test` suite against
    ///      `DropFactoryV2`. Its ABI is a superset of V1's, so the `DropFactoryV1` typed
    ///      `factory` field calls it unchanged.
    function _deployFactory() internal virtual returns (address) {
        return address(new DropFactoryV1(owner, address(implementation), feeRecipient));
    }

    // -----------------------------------------------------------------------
    // building a crowd
    // -----------------------------------------------------------------------

    /// @notice `n` distinct EOAs with rising amounts, already in ascending address order.
    /// @dev Addresses are `0x1001`, `0x1002`... so they sort by construction.
    function _defaultCrowd(uint256 n) internal pure returns (address[] memory r, uint256[] memory a) {
        r = new address[](n);
        a = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            r[i] = address(uint160(0x1001 + i));
            a[i] = (i + 1) * 1 ether;
        }
    }

    /// @notice Stores a crowd, sorted by recipient ascending.
    function _setCrowd(address[] memory r, uint256[] memory a) internal {
        require(r.length == a.length, "crowd length mismatch");

        // Insertion sort. Test code, the lists are small.
        for (uint256 i = 1; i < r.length; i++) {
            address rk = r[i];
            uint256 ak = a[i];
            uint256 j = i;
            while (j > 0 && r[j - 1] > rk) {
                r[j] = r[j - 1];
                a[j] = a[j - 1];
                j--;
            }
            r[j] = rk;
            a[j] = ak;
        }

        delete recipients;
        delete amounts;
        totalEntitlements = 0;

        for (uint256 i = 0; i < r.length; i++) {
            // A zero amount leaf must never reach the tree.
            require(a[i] > 0, "zero amount leaf");
            if (i > 0) require(r[i] != r[i - 1], "duplicate recipient");
            recipients.push(r[i]);
            amounts.push(a[i]);
            totalEntitlements += a[i];
        }
    }

    /// @notice Builds the tree for `drop`, on this chain, from the stored crowd.
    function _buildTree(address drop) internal {
        delete leaves;
        for (uint256 i = 0; i < recipients.length; i++) {
            leaves.push(MerkleHelper.leafOf(drop, block.chainid, i, recipients[i], amounts[i]));
        }
        root = MerkleHelper.rootOf(leaves);
    }

    function _proof(uint256 index) internal view returns (bytes32[] memory) {
        return MerkleHelper.proofOf(leaves, index);
    }

    // -----------------------------------------------------------------------
    // creating a drop
    // -----------------------------------------------------------------------

    function _commitment(uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(X_USER_ID, nonce));
    }

    /// @notice Params that pass every check of, with the tree already built
    ///         against the address those params will produce.
    /// @dev Revert tests take these and break exactly one field, so the test really isolates
    ///      the rule it names.
    function _validParams(address asset, address tokenFactory, uint256 nonce, address[] memory r, uint256[] memory a)
        internal
        returns (IDropFactoryV1.CreateParams memory p)
    {
        bytes32 commitment = _commitment(nonce);
        address predicted = factory.predictDrop(relayer, commitment, nonce);

        _setCrowd(r, a);
        _buildTree(predicted);

        p = IDropFactoryV1.CreateParams({
            asset: asset,
            merkleRoot: root,
            manifestHash: MANIFEST_HASH,
            totalEntitlements: totalEntitlements,
            leafCount: uint32(recipients.length),
            refundRecipient: refundRecipient,
            creatorCommitment: commitment,
            nonce: nonce,
            fundingPeriod: FUNDING_PERIOD,
            claimPeriod: CLAIM_PERIOD,
            tokenFactory: tokenFactory
        });
    }

    /// @notice Native params over `n` default recipients, nonce 0.
    function _validNativeParams() internal returns (IDropFactoryV1.CreateParams memory) {
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        return _validParams(address(0), address(0), 0, r, a);
    }

    /// @notice Sends `createDrop` to the factory under test. The caller pranks or expects first.
    /// @dev `DropV3Parity.t.sol` overrides this: `DropFactoryV3` takes its own `CreateParams`,
    ///      It must make exactly one external call, the `createDrop` itself, so a
    ///      `vm.prank` or `vm.expectRevert` before it still lands on that call.
    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal virtual returns (address) {
        return factory.createDrop(p);
    }

    /// @notice The full sequence: predict, build the tree, create, verify the address.
    function _createDrop(address asset, address tokenFactory, uint256 nonce, address[] memory r, uint256[] memory a)
        internal
        returns (DropV1 drop)
    {
        IDropFactoryV1.CreateParams memory p = _validParams(asset, tokenFactory, nonce, r, a);
        address predicted = factory.predictDrop(relayer, p.creatorCommitment, nonce);

        vm.prank(relayer);
        address created = _sendCreateDrop(p);

        // The address we predicted is the address we got.
        assertEq(created, predicted, "predicted address must equal the deployed address");
        drop = DropV1(payable(created));
    }

    /// @notice A native drop over `n` default recipients.
    function _createNativeDrop(uint256 n) internal returns (DropV1 drop) {
        (address[] memory r, uint256[] memory a) = _defaultCrowd(n);
        return _createDrop(address(0), address(0), 0, r, a);
    }

    /// @notice A native drop over a crowd the caller chose.
    function _createNativeDropFor(address[] memory r, uint256[] memory a) internal returns (DropV1 drop) {
        return _createDrop(address(0), address(0), 0, r, a);
    }

    /// @notice An ERC20 drop. Deploys a token, an adapter, and allowlists both.
    function _createErc20Drop(uint256 n) internal returns (DropV1 drop, MockERC20 token) {
        token = new MockERC20("Drop Token", "DROP", 18);
        address tokenFactory = _allowToken(address(token));

        (address[] memory r, uint256[] memory a) = _defaultCrowd(n);
        drop = _createDrop(address(token), tokenFactory, 0, r, a);
    }

    /// @notice Allowlists `token` through a fresh adapter, and returns the launchpad factory address.
    function _allowToken(address token) internal returns (address tokenFactory) {
        MockTokenFactoryAdapter adapter = new MockTokenFactoryAdapter();
        adapter.setToken(token, true, makeAddr("tokenDeployer"));

        tokenFactory = makeAddr(string.concat("tokenFactory:", vm.toString(token)));

        vm.prank(owner);
        factory.setTokenFactoryAllowed(tokenFactory, address(adapter), true);
    }

    // -----------------------------------------------------------------------
    // funding and activating
    // -----------------------------------------------------------------------

    /// @dev A plain transfer, from any wallet, exactly as a real funder would do it.
    function _fundNative(DropV1 drop, uint256 amount) internal {
        vm.deal(funder, funder.balance + amount);
        vm.prank(funder);
        (bool ok,) = address(drop).call{value: amount}("");
        require(ok, "native funding failed");
    }

    function _fundErc20(MockERC20 token, DropV1 drop, uint256 amount) internal {
        token.mint(address(drop), amount);
    }

    function _activateNative(DropV1 drop) internal {
        _fundNative(drop, drop.grossRequired());
        drop.activate();
    }

    function _activateErc20(MockERC20 token, DropV1 drop) internal {
        _fundErc20(token, drop, drop.grossRequired());
        drop.activate();
    }

    // -----------------------------------------------------------------------
    // assertions used in more than one file
    // -----------------------------------------------------------------------

    function _assertStatus(DropV1 drop, IDropV1.Status expected) internal view {
        assertEq(uint8(drop.status()), uint8(expected), "unexpected status");
    }

    /// @dev Every field of table 5.1 still holds its value from `initialize`.
    function _assertConfigUnchanged(DropV1 drop, IDropV1.Config memory before) internal view {
        IDropV1.Config memory now_ = drop.config();
        assertEq(now_.asset, before.asset, "I5. asset changed");
        assertEq(now_.merkleRoot, before.merkleRoot, "I5. merkleRoot changed");
        assertEq(now_.manifestHash, before.manifestHash, "I5. manifestHash changed");
        assertEq(now_.totalEntitlements, before.totalEntitlements, "I5. totalEntitlements changed");
        assertEq(now_.grossRequired, before.grossRequired, "I5. grossRequired changed");
        assertEq(now_.feeAmount, before.feeAmount, "I5. feeAmount changed");
        assertEq(now_.feeRecipient, before.feeRecipient, "I5. feeRecipient changed");
        assertEq(now_.refundRecipient, before.refundRecipient, "I5. refundRecipient changed");
        assertEq(now_.fundingDeadline, before.fundingDeadline, "I5. fundingDeadline changed");
        assertEq(now_.claimPeriod, before.claimPeriod, "I5. claimPeriod changed");
        assertEq(now_.leafCount, before.leafCount, "I5. leafCount changed");
        assertEq(now_.implementation, before.implementation, "I5. implementation changed");
        assertEq(now_.creatorCommitment, before.creatorCommitment, "I5. creatorCommitment changed");
    }
}
