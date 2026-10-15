// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {V5TestBase} from "./V5TestBase.sol";
import {MockERC20} from "./MockERC20.sol";

import {DropFactoryV5} from "../src/DropFactoryV5.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";

/// @title DropFactoryV5Test
/// @notice What `DropFactoryV5` adds to `DropFactoryV4`.
///         1. The refund address check before the clone, `RefundRecipientRefused`.
///         2. `Ownable2Step`, and `renounceOwnership` always reverts, `RenounceDisabled`.
///         `DropV5Parity.t.sol` runs every V1 to V4 factory suite against it.
contract DropFactoryV5Test is V5TestBase {
    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// @dev Native params with one field broken: the refund address.
    function _nativeParamsWithRefund(address refund) private returns (IDropFactoryV1.CreateParams memory p) {
        p = _validNativeParams();
        p.refundRecipient = refund;
    }

    /// @dev Sends `p` as the relayer, expecting `RefundRecipientRefused`, and checks that
    ///      nothing was created: no code at the predicted address, the salt still unused.
    function _expectRefusedAndNothingMade(IDropFactoryV1.CreateParams memory p) private {
        address predicted = factory.predictDrop(relayer, p.creatorCommitment, p.nonce);
        bytes32 salt = factory.computeSalt(relayer, p.creatorCommitment, p.nonce);

        vm.expectRevert(DropFactoryV5.RefundRecipientRefused.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);

        assertEq(predicted.code.length, 0, "no drop was made");
        assertFalse(factory.saltUsed(salt), "the salt is still free");
    }

    // -----------------------------------------------------------------------
    // the refund address check
    // -----------------------------------------------------------------------

    /// @dev Control: an ordinary refund address still creates the drop.
    function test_V5_CreateDrop_OrdinaryRefundAddress() public {
        DropV1 drop = _createNativeDrop(3);
        assertEq(drop.refundRecipient(), refundRecipient);
    }

    /// @dev The address this very create would deploy the drop at.
    function test_V5_RevertWhen_CreateDrop_RefundIsThePredictedDrop() public {
        IDropFactoryV1.CreateParams memory p = _validNativeParams();
        p.refundRecipient = factory.predictDrop(relayer, p.creatorCommitment, p.nonce);
        _expectRefusedAndNothingMade(p);
    }

    /// @dev The factory itself.
    function test_V5_RevertWhen_CreateDrop_RefundIsTheFactory() public {
        _expectRefusedAndNothingMade(_nativeParamsWithRefund(address(factory)));
    }

    /// @dev The implementation new drops clone.
    function test_V5_RevertWhen_CreateDrop_RefundIsTheImplementation() public {
        _expectRefusedAndNothingMade(_nativeParamsWithRefund(address(implementation)));
    }

    /// @dev The implementation's `BinderRegistry`.
    function test_V5_RevertWhen_CreateDrop_RefundIsTheRegistry() public {
        _expectRefusedAndNothingMade(_nativeParamsWithRefund(address(registry)));
    }

    /// @dev The token of a token drop.
    function test_V5_RevertWhen_CreateDrop_RefundIsTheToken() public {
        MockERC20 token = new MockERC20("Test Coin", "TEST", 18);
        _allowTokenByAddress(address(token));
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        IDropFactoryV1.CreateParams memory p = _validParams(address(token), address(0), 0, r, a);
        p.refundRecipient = address(token);

        nativeFeeNext = ETH_FEE;
        _expectRefusedAndNothingMade(p);
        nativeFeeNext = 0;
    }

    /// @dev On a native drop a token address is an ordinary address: only a token drop's
    ///      own token is refused.
    function test_V5_CreateDrop_NativeDrop_SomeTokenAddressIsFine() public {
        MockERC20 token = new MockERC20("Test Coin", "TEST", 18);
        IDropFactoryV1.CreateParams memory p = _nativeParamsWithRefund(address(token));
        vm.prank(relayer);
        address drop = _sendCreateDrop(p);
        assertEq(DropV3(payable(drop)).refundRecipient(), address(token));
    }

    /// @dev Zero keeps its own error, checked before the list.
    function test_V5_RevertWhen_CreateDrop_RefundIsZero_KeepsItsError() public {
        IDropFactoryV1.CreateParams memory p = _nativeParamsWithRefund(address(0));
        vm.expectRevert(IDropFactoryV1.ZeroRefundRecipient.selector);
        vm.prank(relayer);
        _sendCreateDrop(p);
    }

    /// @dev still comes first: a stranger hears `NotAllowedCreator`, nothing about the list.
    function test_V5_RevertWhen_CreateDrop_StrangerWithRefusedRefund_NotAllowedCreator() public {
        IDropFactoryV1.CreateParams memory p = _nativeParamsWithRefund(address(factory));
        vm.expectRevert(IDropFactoryV1.NotAllowedCreator.selector);
        vm.prank(stranger);
        _sendCreateDrop(p);
    }

    // -----------------------------------------------------------------------
    // Ownable2Step, no renounce
    // -----------------------------------------------------------------------

    /// @dev A transfer only names the next; the old one stays until it is accepted.
    function test_V5_TransferOwnership_IsTwoStep() public {
        address next = makeAddr("next owner");
        vm.prank(owner);
        _v5().transferOwnership(next);

        assertEq(_v5().owner(), owner, "still the old owner");
        assertEq(_v5().pendingOwner(), next, "the next owner waits");
    }

    /// @dev Only the named next owner can accept.
    function test_V5_RevertWhen_AcceptOwnership_NotThePendingOwner() public {
        vm.prank(owner);
        _v5().transferOwnership(makeAddr("next owner"));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        _v5().acceptOwnership();
        assertEq(_v5().owner(), owner);
    }

    /// @dev After the accept the new owner rules and the old one is out.
    function test_V5_AcceptOwnership_MovesOwnership() public {
        address next = makeAddr("next owner");
        vm.prank(owner);
        _v5().transferOwnership(next);
        vm.prank(next);
        _v5().acceptOwnership();

        assertEq(_v5().owner(), next);
        assertEq(_v5().pendingOwner(), address(0));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vm.prank(owner);
        _v5().setPaused(true);

        vm.prank(next);
        _v5().setPaused(true);
        assertTrue(_v5().paused());
    }

    /// @dev The owner cannot renounce.
    function test_V5_RevertWhen_RenounceOwnership_ByOwner() public {
        vm.expectRevert(DropFactoryV5.RenounceDisabled.selector);
        vm.prank(owner);
        _v5().renounceOwnership();
        assertEq(_v5().owner(), owner, "the owner stays");
    }

    /// @dev Always reverts, whoever calls.
    function test_V5_RevertWhen_RenounceOwnership_ByStranger() public {
        vm.expectRevert(DropFactoryV5.RenounceDisabled.selector);
        vm.prank(stranger);
        _v5().renounceOwnership();
    }

    /// @dev A pending transfer does not open a way to renounce either.
    function test_V5_RevertWhen_RenounceOwnership_WhileTransferPending() public {
        address next = makeAddr("next owner");
        vm.prank(owner);
        _v5().transferOwnership(next);

        vm.expectRevert(DropFactoryV5.RenounceDisabled.selector);
        vm.prank(owner);
        _v5().renounceOwnership();
        assertEq(_v5().owner(), owner);
        assertEq(_v5().pendingOwner(), next, "the pending transfer stays");
    }
}
