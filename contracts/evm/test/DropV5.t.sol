// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {Vm} from "forge-std/Vm.sol";

import {V5TestBase} from "./V5TestBase.sol";
import {MockERC20} from "./MockERC20.sol";
import {RejectingEthReceiver} from "./RejectingEthReceiver.sol";
import {SwitchableEthReceiver} from "./SwitchableEthReceiver.sol";

import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropV3} from "../src/IDropV3.sol";
import {IDropV5} from "../src/IDropV5.sol";

/// @title DropV5Test
/// @notice What `DropV5` changes in `DropV3`.
///         1. The ETH back of a token drop never blocks its tokens.
///         2. `initialize` refuses a refund address the drop can never pay.
///         `DropV5Parity.t.sol` runs every V1, V2 and V3 suite against it.
contract DropV5Test is V5TestBase {
    // -----------------------------------------------------------------------
    // the ETH back, cancelUnfunded
    // -----------------------------------------------------------------------

    /// @dev The refund address rejects ETH: the tokens still go back, the ETH waits.
    function test_V5_CancelUnfunded_RefundRejectsEth_TokensBackEthWaits() public {
        RejectingEthReceiver rejector = new RejectingEthReceiver();
        refundRecipient = address(rejector);
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), 1 ether);
        _fundEth(address(drop), ETH_FEE);
        vm.warp(drop.fundingDeadline() + 1);

        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV5.NativeReturnFailed(address(rejector), ETH_FEE);
        drop.cancelUnfunded();

        _assertStatus(DropV1(payable(address(drop))), IDropV1.Status.Cancelled);
        assertEq(token.balanceOf(address(rejector)), 1 ether, "the tokens went back");
        assertEq(token.balanceOf(address(drop)), 0, "no token left");
        assertEq(address(drop).balance, ETH_FEE, "the ETH waits in the drop");
    }

    /// @dev A failed ETH send is never also reported as returned.
    function test_V5_CancelUnfunded_RefundRejectsEth_NoNativeReturned() public {
        refundRecipient = address(new RejectingEthReceiver());
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), 1 ether);
        _fundEth(address(drop), ETH_FEE);
        vm.warp(drop.fundingDeadline() + 1);

        vm.recordLogs();
        drop.cancelUnfunded();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 failed;
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != IDropV3.NativeReturned.selector, "not returned");
            if (logs[i].topics[0] == IDropV5.NativeReturnFailed.selector) failed++;
        }
        assertEq(failed, 1, "one NativeReturnFailed");
    }

    /// @dev Only tokens, no ETH: nothing to try, no event, as on V3.
    function test_V5_CancelUnfunded_RefundRejectsEth_NoEthNoEvent() public {
        refundRecipient = address(new RejectingEthReceiver());
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), 1 ether);
        vm.warp(drop.fundingDeadline() + 1);

        vm.recordLogs();
        drop.cancelUnfunded();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != IDropV5.NativeReturnFailed.selector, "no ETH, no event");
        }
        assertEq(token.balanceOf(refundRecipient), 1 ether);
    }

    // -----------------------------------------------------------------------
    // the ETH back, refund
    // -----------------------------------------------------------------------

    /// @dev After the claim window: the unclaimed tokens go back, the extra ETH waits.
    function test_V5_Refund_RefundRejectsEth_TokensBackEthWaits() public {
        RejectingEthReceiver rejector = new RejectingEthReceiver();
        refundRecipient = address(rejector);
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), drop.grossRequired());
        _fundEth(address(drop), ETH_FEE + 0.5 ether);
        drop.activate();
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        vm.warp(drop.claimDeadline() + 1);
        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV5.NativeReturnFailed(address(rejector), 0.5 ether);
        drop.refund();

        _assertStatus(DropV1(payable(address(drop))), IDropV1.Status.Finalized);
        assertEq(token.balanceOf(address(rejector)), drop.totalEntitlements() - amounts[0], "the rest back");
        assertEq(token.balanceOf(address(drop)), 0, "I12");
        assertEq(address(drop).balance, 0.5 ether, "the extra ETH waits");
    }

    /// @dev Nothing is lost: ETH in = fee + waiting; tokens in = claimed + back.
    function test_V5_Refund_RefundRejectsEth_Conservation() public {
        RejectingEthReceiver rejector = new RejectingEthReceiver();
        refundRecipient = address(rejector);
        (DropV3 drop, MockERC20 token) = _createTokenDrop(4, ETH_FEE);
        uint256 tokensIn = drop.grossRequired() + 2 ether;
        uint256 ethIn = ETH_FEE + 0.3 ether;
        token.mint(address(drop), tokensIn);
        _fundEth(address(drop), ethIn);
        uint256 feeBefore = feeRecipient.balance;
        drop.activate();
        drop.claim(1, recipients[1], amounts[1], _proof(1));

        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(amounts[1] + token.balanceOf(address(rejector)), tokensIn, "tokens");
        assertEq(feeRecipient.balance - feeBefore + address(drop).balance, ethIn, "ETH");
    }

    // -----------------------------------------------------------------------
    // the waiting ETH leaves through sweep
    // -----------------------------------------------------------------------

    /// @dev Once the refund address takes ETH again, anyone sweeps it there.
    function test_V5_Sweep_WaitingEthOnceTheAddressTakesIt() public {
        SwitchableEthReceiver wallet = new SwitchableEthReceiver();
        refundRecipient = address(wallet);
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), 1 ether);
        _fundEth(address(drop), ETH_FEE);
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();
        assertEq(address(drop).balance, ETH_FEE, "waiting");

        wallet.setAccepting(true);
        vm.expectEmit(true, true, false, true, address(drop));
        emit IDropV1.Swept(address(0), address(wallet), ETH_FEE);
        vm.prank(stranger);
        drop.sweep(address(0));

        assertEq(address(wallet).balance, ETH_FEE, "the ETH reached the refund address");
        assertEq(address(drop).balance, 0);
    }

    /// @dev While the address still rejects ETH, a sweep reverts and the ETH stays.
    function test_V5_RevertWhen_Sweep_AddressStillRejectsEth() public {
        refundRecipient = address(new SwitchableEthReceiver());
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), 1 ether);
        _fundEth(address(drop), ETH_FEE);
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.sweep(address(0));
        assertEq(address(drop).balance, ETH_FEE, "still waiting");
    }

    // -----------------------------------------------------------------------
    // native drops are unchanged
    // -----------------------------------------------------------------------

    /// @dev On a native drop the ETH is the drop asset: a failed send still reverts.
    function test_V5_RevertWhen_NativeRefund_RefundRejectsEth() public {
        refundRecipient = address(new RejectingEthReceiver());
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        vm.warp(drop.claimDeadline() + 1);
        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.refund();
        _assertStatus(drop, IDropV1.Status.Active);
    }

    /// @dev The same for a native cancel.
    function test_V5_RevertWhen_NativeCancel_RefundRejectsEth() public {
        refundRecipient = address(new RejectingEthReceiver());
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, 1 ether);

        vm.warp(drop.fundingDeadline() + 1);
        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.cancelUnfunded();
        _assertStatus(drop, IDropV1.Status.Created);
    }

    // -----------------------------------------------------------------------
    // initialize refuses a refund address the drop can never pay
    // This test contract stands in for the factory: it clones the implementation itself and
    // calls `initialize`, so it runs once and only the refund check is under test.
    // -----------------------------------------------------------------------

    bytes32 private constant SALT = keccak256("dropchad v5 init test");

    function _clone() private returns (address) {
        return Clones.cloneDeterministic(address(implementation), SALT);
    }

    function _init(address asset_, address refund) private view returns (IDropV1.InitParams memory) {
        return IDropV1.InitParams({
            asset: asset_,
            merkleRoot: keccak256("root"),
            manifestHash: MANIFEST_HASH,
            totalEntitlements: 1 ether,
            grossRequired: 1 ether,
            feeAmount: 0,
            feeRecipient: feeRecipient,
            refundRecipient: refund,
            fundingDeadline: uint64(block.timestamp) + FUNDING_PERIOD,
            claimPeriod: CLAIM_PERIOD,
            leafCount: 1,
            implementation: address(implementation),
            creatorCommitment: _commitment(0),
            salt: SALT
        });
    }

    /// @dev Control: an ordinary refund address initializes as before.
    function test_V5_Initialize_OrdinaryRefundAddress() public {
        address clone = _clone();
        IDropV3(clone).initialize(_init(address(0), refundRecipient), 0);
        assertEq(DropV3(payable(clone)).refundRecipient(), refundRecipient);
    }

    /// @dev Zero first, with its own error.
    function test_V5_RevertWhen_Initialize_RefundIsZero() public {
        address clone = _clone();
        vm.expectRevert(IDropV5.ZeroRefundRecipient.selector);
        IDropV3(clone).initialize(_init(address(0), address(0)), 0);
    }

    /// @dev The clone itself.
    function test_V5_RevertWhen_Initialize_RefundIsTheDrop() public {
        address clone = _clone();
        vm.expectRevert(IDropV5.RefundRecipientRefused.selector);
        IDropV3(clone).initialize(_init(address(0), clone), 0);
    }

    /// @dev The caller of `initialize`, the factory.
    function test_V5_RevertWhen_Initialize_RefundIsTheFactory() public {
        address clone = _clone();
        vm.expectRevert(IDropV5.RefundRecipientRefused.selector);
        IDropV3(clone).initialize(_init(address(0), address(this)), 0);
    }

    /// @dev The implementation.
    function test_V5_RevertWhen_Initialize_RefundIsTheImplementation() public {
        address clone = _clone();
        vm.expectRevert(IDropV5.RefundRecipientRefused.selector);
        IDropV3(clone).initialize(_init(address(0), address(implementation)), 0);
    }

    /// @dev The `BinderRegistry`.
    function test_V5_RevertWhen_Initialize_RefundIsTheRegistry() public {
        address clone = _clone();
        vm.expectRevert(IDropV5.RefundRecipientRefused.selector);
        IDropV3(clone).initialize(_init(address(0), address(registry)), 0);
    }

    /// @dev The token of a token drop.
    function test_V5_RevertWhen_Initialize_RefundIsTheToken() public {
        MockERC20 token = new MockERC20("Test Coin", "TEST", 18);
        address clone = _clone();
        vm.expectRevert(IDropV5.RefundRecipientRefused.selector);
        IDropV3(clone).initialize(_init(address(token), address(token)), ETH_FEE);
    }

    /// @dev A refused address leaves the clone uninitialized, so nothing half made stays.
    function test_V5_Initialize_RefusedLeavesNoState() public {
        address clone = _clone();
        vm.expectRevert(IDropV5.RefundRecipientRefused.selector);
        IDropV3(clone).initialize(_init(address(0), clone), 0);
        assertFalse(DropV3(payable(clone)).initialized(), "still uninitialized");
    }

    /// @dev still comes first: the implementation itself answers `AlreadyInitialized`.
    function test_V5_RevertWhen_InitializeImplementation_RefundRefusedNotReached() public {
        vm.expectRevert(IDropV1.AlreadyInitialized.selector);
        IDropV3(address(implementation)).initialize(_init(address(0), address(implementation)), 0);
    }
}
