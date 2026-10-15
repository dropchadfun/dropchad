// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DropTestBase} from "./DropTestBase.sol";
import {DropV1} from "../src/DropV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @title FuzzTest
/// @notice The fuzz rows of.
/// @dev 1000 runs on the default profile, 10000 on `ci`. See `foundry.toml`.
///      Two tests build very large trees in Solidity, so they carry an inline run count. The
///      shape they cover is the point, not the number of repetitions.
contract FuzzTest is DropTestBase {
    /// @dev A random claim order over a random tree never breaks the accounting.
    function testFuzz_ClaimOrder_RandomOverRandomTree(uint256 seed) public {
        uint256 n = bound(seed, 1, 24);

        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            r[i] = address(uint160(uint256(keccak256(abi.encode(seed, "r", i)))));
            a[i] = bound(uint256(keccak256(abi.encode(seed, "a", i))), 1, 100 ether);
        }
        vm.assume(_allDistinct(r));

        DropV1 drop = _createNativeDropFor(r, a);
        _activateNative(drop);

        // Claim every index, in an order the seed decides.
        uint256[] memory order = _shuffle(n, seed);
        uint256 running;

        for (uint256 k = 0; k < n; k++) {
            uint256 i = order[k];

            assertFalse(drop.isClaimed(i), "I2. not claimed yet");
            drop.claim(i, recipients[i], amounts[i], _proof(i));
            running += amounts[i];

            assertTrue(drop.isClaimed(i), "I2. claimed now");
            assertEq(drop.totalClaimed(), running, "I14");
            assertEq(drop.claimedCount(), k + 1, "I14");
            assertLe(drop.totalClaimed(), drop.totalEntitlements(), "I1");
            assertGe(address(drop).balance, drop.unclaimed(), "I3");
        }

        assertEq(drop.totalClaimed(), totalEntitlements, "I1 at the boundary");
        assertEq(address(drop).balance, 0);
    }

    /// @dev Random amounts and crowd sizes, right up to `MAX_LEAVES`. The tree always
    ///      sums to `totalEntitlements` and `leafCount` always matches.
    /// forge-config: default.fuzz.runs = 20
    /// forge-config: ci.fuzz.runs = 60
    function testFuzz_AmountsAndRecipientCounts(uint256 seed, uint16 leafCount) public {
        uint256 n = bound(leafCount, 1, 5000);

        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        uint256 expectedTotal;
        for (uint256 i = 0; i < n; i++) {
            r[i] = address(uint160(0x100000 + i));
            a[i] = bound(uint256(keccak256(abi.encode(seed, i))), 1, 1e21);
            expectedTotal += a[i];
        }

        DropV1 drop = _createNativeDropFor(r, a);

        assertEq(drop.totalEntitlements(), expectedTotal, "I8. the tree sums to totalEntitlements");
        assertEq(drop.leafCount(), n, "I8. leafCount equals the number of leaves");
        assertEq(drop.grossRequired(), expectedTotal, "I7 at a zero fee");

        // One claim proves the tree really verifies at this size.
        _activateNative(drop);
        uint256 pick = bound(seed, 0, n - 1);
        drop.claim(pick, recipients[pick], amounts[pick], _proof(pick));

        assertLe(drop.totalClaimed(), drop.totalEntitlements(), "I1");
    }

    /// @dev Any amount of overfunding changes no entitlement, and every wei of it
    ///      comes back through `refund`.
    function testFuzz_Overfunding(uint256 extra) public {
        extra = bound(extra, 0, 1_000_000 ether);

        DropV1 drop = _createNativeDrop(4);
        uint256 received = drop.grossRequired() + extra;
        _fundNative(drop, received);
        drop.activate();

        assertEq(drop.totalEntitlements(), totalEntitlements, "");
        assertEq(drop.grossRequired(), totalEntitlements, "");

        drop.claim(1, recipients[1], amounts[1], _proof(1));
        assertGe(address(drop).balance, drop.unclaimed(), "I3");

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(received, drop.totalClaimed() + drop.feeAmount() + refundRecipient.balance, "I10");
        assertEq(address(drop).balance, 0, "I12");
    }

    /// @dev Every timestamp lands on exactly one side of each deadline. There is
    ///      no gap where both are callable and no gap where neither is.
    function testFuzz_TimestampsAroundDeadlines(uint64 offset) public {
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, drop.grossRequired());

        uint64 fundingDeadline = drop.fundingDeadline();
        uint256 t = bound(uint256(offset), fundingDeadline - 1000, fundingDeadline + 1000);
        vm.warp(t);

        if (t <= fundingDeadline) {
            // activate works, cancel does not.
            vm.expectRevert(IDropV1.FundingStillOpen.selector);
            drop.cancelUnfunded();
            drop.activate();
        } else {
            // cancel works, activate does not.
            vm.expectRevert(IDropV1.FundingExpired.selector);
            drop.activate();
            drop.cancelUnfunded();
            return;
        }

        uint64 claimDeadline = drop.claimDeadline();
        uint256 t2 = bound(uint256(keccak256(abi.encode(offset))), claimDeadline - 1000, claimDeadline + 1000);
        vm.warp(t2);

        if (t2 <= claimDeadline) {
            // claims work, refund does not.
            vm.expectRevert(IDropV1.ClaimWindowOpen.selector);
            drop.refund();
            drop.claim(0, recipients[0], amounts[0], _proof(0));
        } else {
            // refund works, claims do not.
            vm.expectRevert(IDropV1.ClaimWindowClosed.selector);
            drop.claim(0, recipients[0], amounts[0], _proof(0));
            drop.refund();
        }
    }

    /// @dev Any `defaultFeeBps` from 0 to `MAX_FEE_BPS` keeps
    ///      `grossRequired == totalEntitlements + feeAmount`, and conservation still holds.
    function testFuzz_DefaultFeeBps(uint16 bps) public {
        bps = uint16(bound(bps, 0, factory.MAX_FEE_BPS()));

        vm.prank(owner);
        factory.setDefaultFeeBps(bps);

        DropV1 drop = _createNativeDrop(4);

        assertEq(drop.feeAmount(), (totalEntitlements * bps) / 10_000, "rounded down");
        assertEq(drop.grossRequired(), drop.totalEntitlements() + drop.feeAmount(), "I7");

        uint256 received = drop.grossRequired();
        _fundNative(drop, received);
        drop.activate();

        assertEq(feeRecipient.balance, drop.feeAmount(), "the fee left once");
        assertGe(address(drop).balance, drop.unclaimed(), "I3");

        drop.claim(0, recipients[0], amounts[0], _proof(0));
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(received, drop.totalClaimed() + drop.feeAmount() + refundRecipient.balance, "I10");
    }

    /// @dev An index that is not in the tree can never produce a valid proof, whatever
    ///      proof is offered with it.
    function testFuzz_ClaimIndex_OutOfTree_AlwaysReverts(uint256 index, uint256 amount) public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        index = bound(index, 3, type(uint128).max);
        amount = bound(amount, 1, totalEntitlements);

        vm.expectRevert(IDropV1.BadProof.selector);
        drop.claim(index, recipients[0], amount, _proof(0));
    }

    /// @dev A caller cannot swap in their own address on somebody else leaf.
    function testFuzz_Claim_CannotRedirectToAnotherAddress(address thief) public {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.assume(thief != recipients[0]);

        vm.expectRevert(IDropV1.BadProof.selector);
        vm.prank(thief);
        drop.claim(0, thief, amounts[0], _proof(0));
    }

    /// @dev The bitmap packs 256 bits to a word. Claiming one index must never flip a bit
    ///      in another word, or a neighbour in the same word.
    /// forge-config: default.fuzz.runs = 30
    /// forge-config: ci.fuzz.runs = 100
    function testFuzz_Bitmap_NoIndexCollisionAcrossWords(uint256 first, uint256 second) public {
        uint256 n = 300; // spans word 0 and word 1

        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            r[i] = address(uint160(0x200000 + i));
            a[i] = 1 ether;
        }

        DropV1 drop = _createNativeDropFor(r, a);
        _activateNative(drop);

        first = bound(first, 0, n - 1);
        second = bound(second, 0, n - 1);
        vm.assume(first != second);

        drop.claim(first, recipients[first], amounts[first], _proof(first));

        assertTrue(drop.isClaimed(first), "I2");
        assertFalse(drop.isClaimed(second), "I2. no collision across words");
        assertEq(drop.claimedCount(), 1, "I14");

        drop.claim(second, recipients[second], amounts[second], _proof(second));

        assertTrue(drop.isClaimed(first), "I2. a bit never goes back to false");
        assertTrue(drop.isClaimed(second), "I2");
        assertEq(drop.claimedCount(), 2, "I14");
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    function _allDistinct(address[] memory r) internal pure returns (bool) {
        for (uint256 i = 0; i < r.length; i++) {
            if (r[i] == address(0)) return false;
            for (uint256 j = i + 1; j < r.length; j++) {
                if (r[i] == r[j]) return false;
            }
        }
        return true;
    }

    /// @dev A seeded permutation of `0..n-1`. Fisher Yates.
    function _shuffle(uint256 n, uint256 seed) internal pure returns (uint256[] memory order) {
        order = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            order[i] = i;
        }
        for (uint256 i = n; i > 1; i--) {
            uint256 j = uint256(keccak256(abi.encode(seed, "shuffle", i))) % i;
            (order[i - 1], order[j]) = (order[j], order[i - 1]);
        }
    }
}
