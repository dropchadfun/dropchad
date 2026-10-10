// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Vm} from "forge-std/Vm.sol";

import {V3TestBase} from "./V3TestBase.sol";

import {DropFactoryV4} from "../src/DropFactoryV4.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropFactoryV3} from "../src/IDropFactoryV3.sol";
import {IDropFactoryV4} from "../src/IDropFactoryV4.sol";
import {IDropV1} from "../src/IDropV1.sol";

/// @title DropFactoryV4Test
/// @notice What `DropFactoryV4` adds to `DropFactoryV3`: the fee for native drops,
///         `min(max(total × bps / 10_000, minFeeAmount, minFeePerReceiver × leafCount), maxFeeAmount)`,
///         zero is off, a zero cap is no cap. `DropV4Parity.t.sol`
///         runs every V1, V2 and V3 suite against it.
contract DropFactoryV4Test is V3TestBase {
    /// @dev the Robinhood values: 0.00001 ETH per receiver, cap 0.02 ETH.
    uint256 internal constant PER_RECEIVER = 0.000_01 ether;
    uint256 internal constant MAX_FEE = 0.02 ether;
    /// @dev the flat minimum on `DropFactoryV3` today.
    uint256 internal constant FLAT_MIN = 0.000_01 ether;

    function _deployFactory() internal override returns (address) {
        return address(new DropFactoryV4(owner, address(implementation), feeRecipient));
    }

    function _v4() internal view returns (DropFactoryV4) {
        return DropFactoryV4(address(factory));
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    function _setModel(uint16 bps, uint256 flatMin, uint256 perReceiver, uint256 maxFee) internal {
        vm.startPrank(owner);
        _v4().setDefaultFeeBps(bps);
        _v4().setMinFeeAmount(flatMin);
        _v4().setMinFeePerReceiver(perReceiver);
        _v4().setMaxFeeAmount(maxFee);
        vm.stopPrank();
    }

    /// @dev `n` receivers of `each` wei, sorted by construction.
    function _crowd(uint256 n, uint256 each) internal pure returns (address[] memory r, uint256[] memory a) {
        r = new address[](n);
        a = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            r[i] = address(uint160(0x2001 + i));
            a[i] = each;
        }
    }

    /// @dev A native drop of `n` × `each`, nonce `nonce`. Returns the fee, checked against.
    function _feeOf(uint256 n, uint256 each, uint256 nonce) internal returns (uint256) {
        (address[] memory r, uint256[] memory a) = _crowd(n, each);
        DropV1 drop = _createDrop(address(0), address(0), nonce, r, a);
        assertEq(drop.grossRequired(), n * each + drop.feeAmount(), "I7");
        return drop.feeAmount();
    }

    /// @dev written out, the reference the fuzz test checks the contract against.
    function _expected(uint256 total, uint256 n, uint16 bps, uint256 flatMin, uint256 perReceiver, uint256 maxFee)
        internal
        pure
        returns (uint256 fee)
    {
        fee = total * bps / 10_000;
        if (flatMin > fee) fee = flatMin;
        if (perReceiver * n > fee) fee = perReceiver * n;
        if (maxFee != 0 && fee > maxFee) fee = maxFee;
    }

    // -----------------------------------------------------------------------
    // the constant and the two new fields
    // -----------------------------------------------------------------------

    /// @dev 6.12. The ceiling itself, ten times the planned value, so a change is a visible test change.
    function test_V4F_MaxMinFeePerReceiverValue() public view {
        assertEq(_v4().MAX_MIN_FEE_PER_RECEIVER(), 0.0001 ether);
    }

    function test_V4F_NewFieldsStartAtZero() public view {
        assertEq(_v4().minFeePerReceiver(), 0);
        assertEq(_v4().maxFeeAmount(), 0);
    }

    /// @dev V4 keeps the V3 `createDrop` and the one `DropCreated` of all factories.
    ///      `test_V4F_DropCreatedCarriesTheNewFee` reads the event by the V1 selector.
    function test_V4F_KeepsTheV3Abi() public view {
        assertEq(_v4().createDrop.selector, IDropFactoryV3.createDrop.selector, "createDrop");
    }

    // -----------------------------------------------------------------------
    // setMinFeePerReceiver
    // -----------------------------------------------------------------------

    function test_V4F_SetMinFeePerReceiver_SetsAndEmits() public {
        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV4.MinFeePerReceiverSet(0, PER_RECEIVER);
        vm.prank(owner);
        _v4().setMinFeePerReceiver(PER_RECEIVER);
        assertEq(_v4().minFeePerReceiver(), PER_RECEIVER);

        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV4.MinFeePerReceiverSet(PER_RECEIVER, 0);
        vm.prank(owner);
        _v4().setMinFeePerReceiver(0);
        assertEq(_v4().minFeePerReceiver(), 0, "zero turns it off");
    }

    /// @dev The ceiling is inclusive; one wei above reverts `FeeTooHigh`.
    function test_V4F_SetMinFeePerReceiver_CapIsInclusive() public {
        vm.prank(owner);
        _v4().setMinFeePerReceiver(0.0001 ether);
        assertEq(_v4().minFeePerReceiver(), 0.0001 ether);

        vm.prank(owner);
        vm.expectRevert(IDropFactoryV3.FeeTooHigh.selector);
        _v4().setMinFeePerReceiver(0.0001 ether + 1);

        vm.prank(owner);
        vm.expectRevert(IDropFactoryV3.FeeTooHigh.selector);
        _v4().setMinFeePerReceiver(type(uint256).max);
        assertEq(_v4().minFeePerReceiver(), 0.0001 ether, "unchanged");
    }

    function test_V4F_RevertWhen_SetMinFeePerReceiver_Stranger() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        _v4().setMinFeePerReceiver(PER_RECEIVER);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, relayer));
        _v4().setMinFeePerReceiver(PER_RECEIVER);
    }

    // -----------------------------------------------------------------------
    // setMaxFeeAmount
    // -----------------------------------------------------------------------

    function test_V4F_SetMaxFeeAmount_SetsAndEmits() public {
        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV4.MaxFeeAmountSet(0, MAX_FEE);
        vm.prank(owner);
        _v4().setMaxFeeAmount(MAX_FEE);
        assertEq(_v4().maxFeeAmount(), MAX_FEE);

        vm.expectEmit(false, false, false, true, address(factory));
        emit IDropFactoryV4.MaxFeeAmountSet(MAX_FEE, 0);
        vm.prank(owner);
        _v4().setMaxFeeAmount(0);
        assertEq(_v4().maxFeeAmount(), 0, "zero is no cap");
    }

    /// @dev The ceiling is `MAX_NATIVE_FEE`, inclusive; one wei above reverts
    ///      `FeeTooHigh()`.
    function test_V4F_SetMaxFeeAmount_CapIsInclusive() public {
        vm.prank(owner);
        _v4().setMaxFeeAmount(0.05 ether);
        assertEq(_v4().maxFeeAmount(), 0.05 ether);

        vm.prank(owner);
        vm.expectRevert(IDropFactoryV3.FeeTooHigh.selector);
        _v4().setMaxFeeAmount(0.05 ether + 1);

        vm.prank(owner);
        vm.expectRevert(IDropFactoryV3.FeeTooHigh.selector);
        _v4().setMaxFeeAmount(type(uint256).max);
        assertEq(_v4().maxFeeAmount(), 0.05 ether, "unchanged");
    }

    function test_V4F_RevertWhen_SetMaxFeeAmount_Stranger() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        _v4().setMaxFeeAmount(MAX_FEE);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, relayer));
        _v4().setMaxFeeAmount(MAX_FEE);
    }

    /// @dev Each setter writes only its own value.
    function test_V4F_EachSetterWritesOnlyItsOwnField() public {
        _setModel(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);

        vm.prank(owner);
        _v4().setMinFeePerReceiver(1);
        assertEq(_v4().defaultFeeBps(), 100);
        assertEq(_v4().minFeeAmount(), FLAT_MIN);
        assertEq(_v4().maxFeeAmount(), MAX_FEE);

        vm.prank(owner);
        _v4().setMaxFeeAmount(1);
        assertEq(_v4().defaultFeeBps(), 100);
        assertEq(_v4().minFeeAmount(), FLAT_MIN);
        assertEq(_v4().minFeePerReceiver(), 1);
    }

    // -----------------------------------------------------------------------
    // the fee in createDrop
    // -----------------------------------------------------------------------

    /// @dev 1% of 10 × 0.0001 is 0.00001; the flat minimum 0.00001; 10 × 0.00001 is 0.0001.
    function test_V4F_PerReceiverMinimumWinsOnManySmallReceivers() public {
        _setModel(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
        assertEq(_feeOf(10, 0.0001 ether, 0), 0.0001 ether);
    }

    /// @dev 1% of 3 × 0.1 is 0.003; 3 × 0.00001 is 0.00003.
    function test_V4F_BpsFeeWinsOnABigDrop() public {
        _setModel(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
        assertEq(_feeOf(3, 0.1 ether, 0), 0.003 ether);
    }

    /// @dev 1% of 2 × 0.001 is 0.00002; 2 × 0.00001 is 0.00002; the flat minimum 0.001.
    function test_V4F_FlatMinimumWinsWhenItIsTheBiggest() public {
        _setModel(100, 0.001 ether, PER_RECEIVER, MAX_FEE);
        assertEq(_feeOf(2, 0.001 ether, 0), 0.001 ether);
    }

    /// @dev 1% of 3 × 1 is 0.03, capped at 0.02.
    function test_V4F_CapWinsOverTheBpsFee() public {
        _setModel(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
        assertEq(_feeOf(3, 1 ether, 0), MAX_FEE);
    }

    /// @dev 10 × 0.00001 is 0.0001, capped at 0.00005.
    function test_V4F_CapWinsOverThePerReceiverMinimum() public {
        _setModel(100, FLAT_MIN, PER_RECEIVER, 0.000_05 ether);
        assertEq(_feeOf(10, 0.0001 ether, 0), 0.000_05 ether);
    }

    /// @dev The flat minimum 0.0001, capped at 0.00005: min of max, as written in.
    function test_V4F_CapWinsOverTheFlatMinimum() public {
        _setModel(100, 0.0001 ether, 0, 0.000_05 ether);
        assertEq(_feeOf(1, 0.001 ether, 0), 0.000_05 ether);
    }

    function test_V4F_ZeroCapIsNoCap() public {
        _setModel(100, FLAT_MIN, PER_RECEIVER, 0);
        assertEq(_feeOf(3, 1 ether, 0), 0.03 ether);
    }

    function test_V4F_ZeroPerReceiverMinimumIsOff() public {
        _setModel(100, 0, 0, MAX_FEE);
        assertEq(_feeOf(10, 0.0001 ether, 0), 0.000_01 ether, "only 1 percent left");
    }

    function test_V4F_PerReceiverMinimumAloneAtZeroBps() public {
        _setModel(0, 0, PER_RECEIVER, 0);
        assertEq(_feeOf(7, 1 ether, 0), 7 * PER_RECEIVER);
    }

    function test_V4F_EveryPartZeroIsNoFee() public {
        _setModel(0, 0, 0, 0);
        assertEq(_feeOf(3, 1 ether, 0), 0);
    }

    /// @dev With both new fields zero the fee is exactly the V3 fee, max(1%, flat minimum).
    function test_V4F_BothNewFieldsZeroIsTheV3Fee() public {
        _setModel(100, FLAT_MIN, 0, 0);
        assertEq(_feeOf(3, 0.0001 ether, 0), FLAT_MIN, "the flat minimum");
        assertEq(_feeOf(3, 1 ether, 1), 0.03 ether, "1 percent");
    }

    /// @dev against the reference, every ceiling in range, up to 30 receivers.
    function testFuzz_V4F_FeeIsTheR820Formula(
        uint16 bps,
        uint256 flatMin,
        uint256 perReceiver,
        uint256 maxFee,
        uint8 count,
        uint256 each
    ) public {
        bps = uint16(bound(bps, 0, 500));
        flatMin = bound(flatMin, 0, 0.001 ether);
        perReceiver = bound(perReceiver, 0, 0.0001 ether);
        maxFee = bound(maxFee, 0, 0.05 ether);
        uint256 n = bound(count, 1, 30);
        each = bound(each, 1, 100 ether);
        _setModel(bps, flatMin, perReceiver, maxFee);

        assertEq(_feeOf(n, each, 0), _expected(n * each, n, bps, flatMin, perReceiver, maxFee));
    }

    /// @dev A token drop takes no fee in the token, whatever the four fields say; its ETH
    ///      fee is the `nativeFee` passed, untouched.
    function test_V4F_TokenDropIgnoresTheNewFields() public {
        _setModel(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
        (DropV3 drop,) = _createTokenDrop(10, ETH_FEE);
        assertEq(drop.feeAmount(), 0, "no token fee");
        assertEq(drop.nativeFee(), ETH_FEE, "the ETH fee as passed");
        assertEq(drop.grossRequired(), drop.totalEntitlements(), "I7");
    }

    /// @dev A drop made before keeps its fee; the next drop gets the new one; the
    ///      old drop activates with its own fee.
    function test_V4F_ExistingDropKeepsItsFee() public {
        _setModel(100, FLAT_MIN, 0, 0);
        (address[] memory r, uint256[] memory a) = _crowd(10, 0.0001 ether);
        DropV1 old = _createDrop(address(0), address(0), 0, r, a);
        assertEq(old.feeAmount(), FLAT_MIN);

        vm.startPrank(owner);
        _v4().setMinFeePerReceiver(PER_RECEIVER);
        _v4().setMaxFeeAmount(MAX_FEE);
        vm.stopPrank();
        assertEq(old.feeAmount(), FLAT_MIN, "the old drop is not touched");
        assertEq(_feeOf(10, 0.0001 ether, 1), 0.0001 ether, "the next drop gets the new fee");

        uint256 before = feeRecipient.balance;
        _activateNative(old);
        assertEq(feeRecipient.balance - before, FLAT_MIN, "the old fee at activation");
        _assertStatus(old, IDropV1.Status.Active);
    }

    /// @dev A new model drop pays its fee once, at `activate`.
    function test_V4F_NewModelDropPaysItsFeeAtActivation() public {
        _setModel(100, 0, PER_RECEIVER, MAX_FEE);
        (address[] memory r, uint256[] memory a) = _crowd(5, 0.0001 ether);
        DropV1 drop = _createDrop(address(0), address(0), 0, r, a);
        assertEq(drop.feeAmount(), 5 * PER_RECEIVER);

        uint256 before = feeRecipient.balance;
        _activateNative(drop);
        assertEq(feeRecipient.balance - before, 5 * PER_RECEIVER);
        assertEq(address(drop).balance, 5 * 0.0001 ether, "every receiver's amount stays in the drop");
    }

    /// @dev The fee in `DropCreated` is the new fee.
    function test_V4F_DropCreatedCarriesTheNewFee() public {
        _setModel(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
        (address[] memory r, uint256[] memory a) = _crowd(10, 0.0001 ether);

        vm.recordLogs();
        _createDrop(address(0), address(0), 0, r, a);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bool seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(factory)) continue;
            if (logs[i].topics[0] != IDropFactoryV1.DropCreated.selector) continue;
            (,,, uint256 feeAmount, uint256 grossRequired) =
                abi.decode(logs[i].data, (bytes32, bytes32, uint256, uint256, uint256));
            assertEq(feeAmount, 0.0001 ether, "DropCreated feeAmount");
            assertEq(grossRequired, 0.001 ether + 0.0001 ether, "DropCreated grossRequired");
            seen = true;
        }
        assertTrue(seen, "DropCreated emitted");
    }
}
