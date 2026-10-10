// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Vm} from "forge-std/Vm.sol";

import {DropFactoryV1Test} from "./DropFactoryV1.t.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropFactoryV2} from "../src/DropFactoryV2.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropFactoryV2} from "../src/IDropFactoryV2.sol";
import {MockERC20} from "./MockERC20.sol";

/// @title DropFactoryV2Test
/// @notice The whole `DropFactoryV1Test` suite, run against `DropFactoryV2`, plus the flat
///         minimum fee.
/// @dev `DropFactoryV2` is `DropFactoryV1` copied with four changes. Inheriting the V1
///      suite and swapping the factory through `_deployFactory` proves every V1 rule still holds
///      on the copy, the raw `DropCreated` log included. With `minFeeAmount` at its zero start,
///      every V1 expectation is exactly right for V2. The tests below add what V2 adds.
///      The implementation under the clones is still `DropV1` here; `DropV2` comes later, and the
///      factory does not care which implementation it clones.
contract DropFactoryV2Test is DropFactoryV1Test {
    /// @dev 0.0001 ETH, about 25 cents at the price. A test value only; the
    ///      live value is set by the admin at deploy.
    uint256 internal constant MIN_FEE = 0.0001 ether;

    function _deployFactory() internal virtual override returns (address) {
        return address(new DropFactoryV2(owner, address(implementation), feeRecipient));
    }

    function _v2() internal view returns (DropFactoryV2) {
        return DropFactoryV2(address(factory));
    }

    function _setMinFee(uint256 amount) internal {
        vm.prank(owner);
        _v2().setMinFeeAmount(amount);
    }

    function _setBps(uint16 bps) internal {
        vm.prank(owner);
        factory.setDefaultFeeBps(bps);
    }

    /// @dev Three receivers of `each` wei, a native drop.
    function _tinyNativeDrop(uint256 each, uint256 nonce) internal returns (DropV1) {
        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            r[i] = address(uint160(0x2001 + i));
            a[i] = each;
        }
        return _createDrop(address(0), address(0), nonce, r, a);
    }

    // -----------------------------------------------------------------------
    // the field and the setter
    // -----------------------------------------------------------------------

    /// @dev Starts at zero, so a fresh V2 charges exactly what V1 charges.
    function test_V2_MinFeeStartsAtZero() public view {
        assertEq(_v2().minFeeAmount(), 0);
    }

    /// @dev The owner sets it and the event carries old and new.
    function test_V2_SetMinFeeAmount_SetsAndEmits() public {
        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV2.MinFeeAmountSet(0, MIN_FEE);
        _setMinFee(MIN_FEE);
        assertEq(_v2().minFeeAmount(), MIN_FEE);

        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV2.MinFeeAmountSet(MIN_FEE, 0);
        _setMinFee(0);
        assertEq(_v2().minFeeAmount(), 0);
    }

    /// @dev The cap is inclusive, one wei above it is refused.
    function test_V2_SetMinFeeAmount_Cap() public {
        uint256 cap = _v2().MAX_MIN_FEE_AMOUNT();
        _setMinFee(cap);
        assertEq(_v2().minFeeAmount(), cap);

        vm.prank(owner);
        vm.expectRevert(IDropFactoryV1.FeeTooHigh.selector);
        _v2().setMinFeeAmount(cap + 1);
    }

    /// @dev 6.12. The ceiling value itself, so a change to it is a visible test change.
    function test_V2_MaxMinFeeAmountValue() public view {
        assertEq(_v2().MAX_MIN_FEE_AMOUNT(), 0.001 ether);
    }

    /// @dev Owner only.
    function test_V2_SetMinFeeAmount_RevertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        _v2().setMinFeeAmount(MIN_FEE);
    }

    // -----------------------------------------------------------------------
    // the fee rule
    // -----------------------------------------------------------------------

    /// @dev A normal drop: 1 percent is bigger than the minimum, so 1 percent is charged.
    function test_V2_Fee_BpsWinsOnANormalDrop() public {
        _setBps(100);
        _setMinFee(MIN_FEE);

        DropV1 drop = _createNativeDrop(3); // 6 ether, 1 percent is 0.06 ether
        IDropV1.Config memory c = drop.config();
        assertEq(c.feeAmount, 0.06 ether, "1 percent, not the minimum");
        assertEq(c.grossRequired, 6 ether + 0.06 ether, "I7");
    }

    /// @dev A tiny drop: the minimum is bigger than 1 percent, so the minimum is charged.
    ///      Never both.
    function test_V2_Fee_MinimumWinsOnATinyDrop() public {
        _setBps(100);
        _setMinFee(MIN_FEE);

        DropV1 drop = _tinyNativeDrop(0.001 ether, 0); // 0.003 ether, 1 percent is 0.00003
        IDropV1.Config memory c = drop.config();
        assertEq(c.feeAmount, MIN_FEE, "the minimum, not 1 percent, and not the two added");
        assertEq(c.grossRequired, 0.003 ether + MIN_FEE, "I7");
    }

    /// @dev With the bps at zero the minimum still applies to a native drop.
    function test_V2_Fee_MinimumAppliesAtZeroBps() public {
        _setMinFee(MIN_FEE);

        DropV1 drop = _createNativeDrop(3);
        assertEq(drop.config().feeAmount, MIN_FEE);
    }

    /// @dev Native drops only: a token drop keeps the plain bps, never a wei minimum.
    function test_V2_Fee_MinimumNeverAppliesToATokenDrop() public virtual {
        _setBps(100);
        _setMinFee(MIN_FEE);

        (DropV1 drop,) = _createErc20Drop(3); // 6 tokens, 1 percent is 0.06 tokens
        assertEq(drop.config().feeAmount, 0.06 ether, "plain bps in token units");

        _setBps(0);
        MockERC20 token = new MockERC20("Second", "TWO", 18);
        address tokenFactory = _allowToken(address(token));
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        DropV1 zeroFee = _createDrop(address(token), tokenFactory, 1, r, a);
        assertEq(zeroFee.config().feeAmount, 0, "a token drop at zero bps pays zero, whatever the minimum");
    }

    /// @dev New drops only: raising the minimum never touches a drop that exists.
    function test_V2_Fee_ExistingDropKeepsItsFee() public {
        _setBps(100);
        DropV1 drop = _tinyNativeDrop(0.001 ether, 0);
        uint256 before = drop.config().feeAmount;
        assertEq(before, 0.000_03 ether);

        _setMinFee(MIN_FEE);
        assertEq(drop.config().feeAmount, before, "an existing drop's fee never moves");

        DropV1 later = _tinyNativeDrop(0.001 ether, 1);
        assertEq(later.config().feeAmount, MIN_FEE, "the next drop gets the minimum");
    }

    /// @dev The event carries the fee the drop really charges, the minimum
    ///      included. This is the reason `DropFactoryV2` exists.
    function test_V2_Fee_EventCarriesTheMinimum() public {
        _setBps(100);
        _setMinFee(MIN_FEE);

        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            r[i] = address(uint160(0x2001 + i));
            a[i] = 0.001 ether;
        }
        IDropFactoryV1.CreateParams memory p = _validParams(address(0), address(0), 0, r, a);

        vm.recordLogs();
        vm.prank(relayer);
        address created = _sendCreateDrop(p);

        Vm.Log memory entry = _findDropCreated(vm.getRecordedLogs());
        DropCreatedTail memory t = abi.decode(entry.data, (DropCreatedTail));
        assertEq(t.feeAmount, MIN_FEE, "event feeAmount");
        assertEq(t.grossRequired, 0.003 ether + MIN_FEE, "event grossRequired");

        IDropV1.Config memory c = DropV1(payable(created)).config();
        assertEq(t.feeAmount, c.feeAmount, "event and storage agree");
        assertEq(t.grossRequired, c.grossRequired, "event and storage agree");
    }

    /// @dev end to end. Activation pays exactly the minimum to the fee recipient,
    ///      and every receiver is still paid in full.
    function test_V2_Fee_MinimumPaidAtActivation() public {
        _setBps(100);
        _setMinFee(MIN_FEE);
        DropV1 drop = _tinyNativeDrop(0.001 ether, 0);

        uint256 feeBefore = feeRecipient.balance;
        _activateNative(drop);
        assertEq(feeRecipient.balance - feeBefore, MIN_FEE, "the fee recipient got the minimum");

        for (uint256 i = 0; i < 3; i++) {
            drop.claim(i, recipients[i], amounts[i], _proof(i));
            assertEq(recipients[i].balance, 0.001 ether, "every receiver paid in full");
        }
    }

    // -----------------------------------------------------------------------
    // fuzz
    // -----------------------------------------------------------------------

    /// @dev For any total, bps and minimum: a native fee is
    ///      `max(minimum, total * bps / 10_000)`, a token fee is the plain bps.
    function testFuzz_V2_FeeIsTheBiggerOfTheTwo(uint96 each, uint16 bps, uint256 minFee) public {
        each = uint96(bound(each, 1, 1_000_000 ether));
        bps = uint16(bound(bps, 0, factory.MAX_FEE_BPS()));
        minFee = bound(minFee, 0, _v2().MAX_MIN_FEE_AMOUNT());
        _setBps(bps);
        _setMinFee(minFee);

        uint256 total = uint256(each) * 3;
        uint256 byBps = (total * bps) / 10_000;
        uint256 expected = byBps > minFee ? byBps : minFee;

        DropV1 drop = _tinyNativeDrop(each, 0);
        IDropV1.Config memory c = drop.config();
        assertEq(c.feeAmount, expected, "native: the bigger of the two");
        assertEq(c.grossRequired, total + expected, "I7");
    }
}
