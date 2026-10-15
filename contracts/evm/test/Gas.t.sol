// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console} from "forge-std/Test.sol";

import {DropTestBase} from "./DropTestBase.sol";
import {DropV1} from "../src/DropV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @title GasTest
/// @notice The gas and scale rows of.
/// @dev Numbers here are **recorded, not asserted**, except where the design sets a real limit:
///      `MAX_LEAVES` and the proof length at 10,000 leaves.
///      `forge snapshot` writes the measurements to `.gas-snapshot`, which is committed, so a
///      regression shows up as a diff in review.
contract GasTest is DropTestBase {
    /// @dev Single `claim`, recorded.
    function test_Gas_SingleClaim() public {
        DropV1 drop = _createNativeDrop(8);
        _activateNative(drop);

        bytes32[] memory proof = _proof(3);
        uint256 before = gasleft();
        drop.claim(3, recipients[3], amounts[3], proof);
        console.log("claim, 8 leaf tree      ", before - gasleft());
    }

    /// @dev `claimBatch` of 20. Must fit well under the block gas limit.
    function test_Gas_ClaimBatchOfTwenty() public {
        DropV1 drop = _createNativeDrop(20);
        _activateNative(drop);

        IDropV1.ClaimItem[] memory items = new IDropV1.ClaimItem[](20);
        for (uint256 i = 0; i < 20; i++) {
            items[i] = IDropV1.ClaimItem(i, recipients[i], amounts[i], _proof(i));
        }

        uint256 before = gasleft();
        drop.claimBatch(items);
        uint256 used = before - gasleft();

        console.log("claimBatch of 20        ", used);
        assertEq(drop.claimedCount(), 20);

        // A generous ceiling. Robinhood Chain is Nitro, where the block gas limit is far above
        // this, but a batch that ever approached a mainnet block would be a design problem.
        assertLt(used, 5_000_000, "a batch of 20 must fit well under a block");
    }

    /// @dev A 10,000 leaf tree gives a proof of at most 14 nodes, and the
    ///      deepest index really needs all 14. That is the whole reason `MAX_LEAVES` is 10,000.
    function test_Gas_TenThousandLeafTree_ProofLengthFourteen() public {
        uint256 n = 10_000;
        bytes32[] memory bigLeaves = new bytes32[](n);
        address drop = makeAddr("bigDrop");

        for (uint256 i = 0; i < n; i++) {
            bigLeaves[i] = MerkleHelper.leafOf(drop, block.chainid, i, address(uint160(0x300000 + i)), 1 ether);
        }

        bytes32 bigRoot = MerkleHelper.rootOf(bigLeaves);

        bytes32[] memory proof = MerkleHelper.proofOf(bigLeaves, 0);
        console.log("proof length at 10000 leaves", proof.length);

        assertEq(proof.length, 14, "depth 14 at 10,000 leaves");
        assertEq(MerkleHelper.processProof(proof, bigLeaves[0]), bigRoot, "the deep proof verifies");

        // The last leaf is promoted at several levels, so its proof is shorter. Never longer.
        bytes32[] memory shortProof = MerkleHelper.proofOf(bigLeaves, n - 1);
        assertLe(shortProof.length, 14, "no proof is longer than the depth");
        assertEq(MerkleHelper.processProof(shortProof, bigLeaves[n - 1]), bigRoot, "");
    }

    /// @dev Creation at exactly `MAX_LEAVES` works.
    ///      `leafCount` is a declared number, so this is the factory bound, not the tree size.
    function test_CreateDrop_AtMaxLeaves_Succeeds() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.leafCount = factory.MAX_LEAVES();

        vm.prank(relayer);
        address created = factory.createDrop(p);

        assertEq(DropV1(payable(created)).leafCount(), factory.MAX_LEAVES(), "");
    }

    /// @dev One leaf more reverts with `BadLeafCount`.
    function test_RevertWhen_CreateDrop_OneAboveMaxLeaves() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.leafCount = factory.MAX_LEAVES() + 1;

        vm.expectRevert(IDropFactoryV1.BadLeafCount.selector);
        vm.prank(relayer);
        factory.createDrop(p);
    }

    /// @dev `createDrop`, recorded. This is the cost the relayer pays per drop.
    function test_Gas_CreateDrop() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();

        vm.prank(relayer);
        uint256 before = gasleft();
        factory.createDrop(p);
        console.log("createDrop, clone + init", before - gasleft());
    }

    /// @dev `activate`, recorded, at a zero fee and at a non zero fee.
    function test_Gas_Activate() public {
        DropV1 zeroFee = _createNativeDrop(8);
        _fundNative(zeroFee, zeroFee.grossRequired());

        uint256 before = gasleft();
        zeroFee.activate();
        console.log("activate, zero fee      ", before - gasleft());

        vm.prank(owner);
        factory.setDefaultFeeBps(250);

        (address[] memory r, uint256[] memory a) = _defaultCrowd(8);
        DropV1 withFee = _createDrop(address(0), address(0), 1, r, a);
        _fundNative(withFee, withFee.grossRequired());

        before = gasleft();
        withFee.activate();
        console.log("activate, with fee      ", before - gasleft());
    }

    /// @dev `refund` and `cancelUnfunded`, recorded.
    function test_Gas_RefundAndCancel() public {
        DropV1 drop = _createNativeDrop(8);
        _activateNative(drop);
        vm.warp(drop.claimDeadline() + 1);

        uint256 before = gasleft();
        drop.refund();
        console.log("refund                  ", before - gasleft());

        (address[] memory r, uint256[] memory a) = _defaultCrowd(8);
        DropV1 other = _createDrop(address(0), address(0), 1, r, a);
        _fundNative(other, 1 ether);
        vm.warp(other.fundingDeadline() + 1);

        before = gasleft();
        other.cancelUnfunded();
        console.log("cancelUnfunded          ", before - gasleft());
    }

    /// @dev A deep proof costs more to verify than a shallow one. Recorded so the
    ///      relayer can budget gas for a big drop.
    function test_Gas_ClaimWithDeepProof() public {
        DropV1 drop = _createNativeDrop(256);
        _activateNative(drop);

        bytes32[] memory proof = _proof(200);
        assertEq(proof.length, 8, "256 leaves is depth 8");

        uint256 before = gasleft();
        drop.claim(200, recipients[200], amounts[200], proof);
        console.log("claim, 256 leaf tree    ", before - gasleft());
    }
}
