// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

import {V3TestBase} from "./V3TestBase.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {RejectingEthReceiver} from "./RejectingEthReceiver.sol";

import {DropFactoryV2} from "../src/DropFactoryV2.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropV3} from "../src/IDropV3.sol";
import {TestCoin} from "../src/TestCoin.sol";

/// @title DropV3Test
/// @notice What `DropV3` adds to `DropV2`: the ETH fee of a token drop. and
///         15.8. `DropV3Parity.t.sol` runs every V1 and V2 suite against it.
contract DropV3Test is V3TestBase {
    // -----------------------------------------------------------------------
    // the field
    // -----------------------------------------------------------------------

    /// @dev field 14. A token drop keeps its ETH fee; its token fee is zero.
    function test_V3_TokenDrop_StoresNativeFee() public {
        (DropV3 drop,) = _createTokenDrop(3, ETH_FEE);
        assertEq(drop.nativeFee(), ETH_FEE, "field 14");
        assertEq(drop.feeAmount(), 0, "never a percent of the token");
        assertEq(drop.grossRequired(), drop.totalEntitlements(), "I7 with a zero token fee");
    }

    /// @dev Zero on a native drop.
    function test_V3_NativeDrop_NativeFeeIsZero() public {
        DropV1 drop = _createNativeDrop(3);
        assertEq(DropV3(payable(address(drop))).nativeFee(), 0);
    }

    // -----------------------------------------------------------------------
    // receive
    // -----------------------------------------------------------------------

    /// @dev A token drop takes ETH while it waits for money.
    function test_V3_Receive_TokenDropTakesEthWhileCreated() public {
        (DropV3 drop,) = _createTokenDrop(3, ETH_FEE);
        _fundEth(address(drop), ETH_FEE);
        assertEq(address(drop).balance, ETH_FEE);
    }

    /// @dev Not once it is live.
    function test_V3_RevertWhen_Receive_TokenDropActive() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        _activateTokenDrop(drop, token);

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok, bytes memory ret) = address(drop).call{value: 1 ether}("");
        assertFalse(ok, "");
        assertEq(bytes4(ret), IDropV1.NotAcceptingNative.selector);
    }

    /// @dev Not after a cancel.
    function test_V3_RevertWhen_Receive_TokenDropCancelled() public {
        (DropV3 drop,) = _createTokenDrop(3, ETH_FEE);
        vm.warp(drop.fundingDeadline() + 1);
        drop.cancelUnfunded();

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(drop).call{value: 1 ether}("");
        assertFalse(ok, "");
    }

    // -----------------------------------------------------------------------
    // activate
    // -----------------------------------------------------------------------

    /// @dev The tokens alone are not enough.
    function test_V3_RevertWhen_Activate_OnlyTokens() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), drop.grossRequired());

        vm.expectRevert(IDropV1.Underfunded.selector);
        drop.activate();
    }

    /// @dev The ETH alone is not enough.
    function test_V3_RevertWhen_Activate_OnlyEth() public {
        (DropV3 drop,) = _createTokenDrop(3, ETH_FEE);
        _fundEth(address(drop), ETH_FEE);

        vm.expectRevert(IDropV1.Underfunded.selector);
        drop.activate();
    }

    /// @dev One wei of ETH short is short.
    function test_V3_RevertWhen_Activate_EthOneWeiShort() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), drop.grossRequired());
        _fundEth(address(drop), ETH_FEE - 1);

        vm.expectRevert(IDropV1.Underfunded.selector);
        drop.activate();
    }

    /// @dev Both parts: live, the ETH fee at the fee recipient, no token to it.
    function test_V3_Activate_TokensAndEth_PaysTheEthFee() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), drop.grossRequired());
        _fundEth(address(drop), ETH_FEE);
        uint256 before = feeRecipient.balance;

        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV3.NativeFeePaid(feeRecipient, ETH_FEE);
        drop.activate();

        _assertStatus(DropV1(payable(address(drop))), IDropV1.Status.Active);
        assertEq(feeRecipient.balance - before, ETH_FEE, "the ETH fee");
        assertEq(token.balanceOf(feeRecipient), 0, "never a token fee");
        assertEq(address(drop).balance, 0, "nothing left over");
        assertEq(token.balanceOf(address(drop)), drop.totalEntitlements(), "every token stays for the people");
    }

    /// @dev ETH above the fee stays in the drop and is never an entitlement.
    function test_V3_Activate_ExtraEthStays() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), drop.grossRequired());
        _fundEth(address(drop), ETH_FEE + 0.5 ether);
        drop.activate();

        assertEq(address(drop).balance, 0.5 ether, "the extra stays");
        assertEq(drop.unclaimed(), drop.totalEntitlements(), "the extra changes no number");
    }

    /// @dev A token drop with a zero ETH fee goes live on the tokens alone, and emits no
    ///      `NativeFeePaid`.
    function test_V3_Activate_ZeroNativeFee_NoEthNeeded() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, 0);
        token.mint(address(drop), drop.grossRequired());

        vm.recordLogs();
        drop.activate();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != IDropV3.NativeFeePaid.selector, "no ETH fee event");
        }
        _assertStatus(DropV1(payable(address(drop))), IDropV1.Status.Active);
    }

    /// @dev A fee recipient that refuses ETH reverts the whole activation.
    function test_V3_RevertWhen_Activate_FeeRecipientRejectsEth() public {
        RejectingEthReceiver rejector = new RejectingEthReceiver();
        vm.prank(owner);
        factory.setFeeRecipient(address(rejector));

        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), drop.grossRequired());
        _fundEth(address(drop), ETH_FEE);

        vm.expectRevert(IDropV1.NativeTransferFailed.selector);
        drop.activate();
        _assertStatus(DropV1(payable(address(drop))), IDropV1.Status.Created);
    }

    // -----------------------------------------------------------------------
    // the money back
    // -----------------------------------------------------------------------

    /// @dev A cancel returns the tokens and all the ETH.
    function test_V3_CancelUnfunded_ReturnsTokensAndEth() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), 1 ether);
        _fundEth(address(drop), ETH_FEE);
        vm.warp(drop.fundingDeadline() + 1);

        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV3.NativeReturned(refundRecipient, ETH_FEE);
        drop.cancelUnfunded();

        assertEq(token.balanceOf(refundRecipient), 1 ether, "the tokens back");
        assertEq(refundRecipient.balance, ETH_FEE, "the ETH back");
        assertEq(address(drop).balance, 0);
    }

    /// @dev No ETH, no `NativeReturned`.
    function test_V3_CancelUnfunded_NoEth_NoEvent() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), 1 ether);
        vm.warp(drop.fundingDeadline() + 1);

        vm.recordLogs();
        drop.cancelUnfunded();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != IDropV3.NativeReturned.selector, "no ETH, no event");
        }
    }

    /// @dev A refund returns the unclaimed tokens and the extra ETH.
    function test_V3_Refund_ReturnsTokensAndExtraEth() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        token.mint(address(drop), drop.grossRequired());
        _fundEth(address(drop), ETH_FEE + 0.5 ether);
        drop.activate();
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        vm.warp(drop.claimDeadline() + 1);
        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV3.NativeReturned(refundRecipient, 0.5 ether);
        drop.refund();

        assertEq(token.balanceOf(recipients[0]), amounts[0], "the claim was paid");
        assertEq(token.balanceOf(refundRecipient), drop.totalEntitlements() - amounts[0], "the rest back");
        assertEq(refundRecipient.balance, 0.5 ether, "the extra ETH back");
        assertEq(address(drop).balance, 0);
        assertEq(token.balanceOf(address(drop)), 0, "I12");
    }

    /// @dev ETH forced in after the end still leaves through `sweep`.
    function test_V3_Sweep_EthAfterTheEnd() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, ETH_FEE);
        _activateTokenDrop(drop, token);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        vm.deal(address(drop), 1 ether); // a forced send
        drop.sweep(address(0));
        assertEq(refundRecipient.balance, 1 ether);
    }

    /// @dev for both parts. Tokens in = claimed + back; ETH in = fee + back.
    function test_V3_Conservation_TokensAndEth() public {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(4, ETH_FEE);
        uint256 tokensIn = drop.grossRequired() + 2 ether;
        uint256 ethIn = ETH_FEE + 0.3 ether;
        token.mint(address(drop), tokensIn);
        _fundEth(address(drop), ethIn);
        uint256 feeBefore = feeRecipient.balance;
        drop.activate();

        drop.claim(1, recipients[1], amounts[1], _proof(1));
        drop.claim(3, recipients[3], amounts[3], _proof(3));
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();

        assertEq(tokensIn, drop.totalClaimed() + token.balanceOf(refundRecipient), "I10, tokens");
        assertEq(ethIn, (feeRecipient.balance - feeBefore) + refundRecipient.balance, "I10, ETH");
    }

    // -----------------------------------------------------------------------
    // handle claims of a token drop
    // -----------------------------------------------------------------------

    /// @dev on a token drop: the bound wallet gets the tokens, the ETH fee went to us.
    function test_V3_TokenDrop_HandleClaimPaysTokens() public {
        (address binder, uint256 binderKey) = makeAddrAndKey("binder");
        vm.prank(owner);
        registry.setBinder(binder);

        MockERC20 token = new MockERC20("Test Coin", "TEST", 18);
        _allowTokenByAddress(address(token));
        uint256 xId = 44_196_397;
        uint256 amount = 5 ether;
        DropV3 drop = _oneHandleLeafTokenDrop(address(token), xId, amount, ETH_FEE);
        _activateTokenDrop(drop, token);

        address wallet = makeAddr("alice wallet");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(binderKey, drop.bindingDigest(0, xId, wallet));
        vm.prank(relayer);
        drop.claimHandle(0, xId, amount, wallet, new bytes32[](0), abi.encodePacked(r, s, v));

        assertEq(token.balanceOf(wallet), amount, "the bound wallet got the tokens");
        assertEq(wallet.balance, 0, "and no ETH");
    }

    /// @dev Our own `TEST` coin as the drop asset, end to end.
    function test_V3_TestCoin_EndToEnd() public {
        vm.prank(funder);
        TestCoin coin = new TestCoin();
        _allowTokenByAddress(address(coin));

        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        nativeFeeNext = ETH_FEE;
        DropV3 drop = DropV3(payable(address(_createDrop(address(coin), address(0), 0, r, a))));
        nativeFeeNext = 0;

        uint256 needed = drop.grossRequired(); // read first: a view call would use up the prank
        vm.prank(funder);
        assertTrue(coin.transfer(address(drop), needed));
        _fundEth(address(drop), ETH_FEE);
        drop.activate();

        for (uint256 i = 0; i < 3; i++) {
            drop.claim(i, recipients[i], amounts[i], _proof(i));
            assertEq(coin.balanceOf(recipients[i]), amounts[i], "paid in full, no tax");
        }
    }

    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// @dev The implementation refuses both `initialize` signatures.
    function test_V3_RevertWhen_InitializeImplementation_BothSignatures() public {
        IDropV1.InitParams memory p;
        DropV3 impl = DropV3(payable(address(implementation)));

        vm.expectRevert(IDropV1.AlreadyInitialized.selector);
        impl.initialize(p);
        vm.expectRevert(IDropV1.AlreadyInitialized.selector);
        impl.initialize(p, ETH_FEE);
    }

    /// @dev A live clone cannot be initialized again, with the fee or without.
    function test_V3_RevertWhen_InitializeTwice() public {
        (DropV3 drop,) = _createTokenDrop(3, ETH_FEE);
        IDropV1.InitParams memory p;

        vm.prank(stranger);
        vm.expectRevert(IDropV1.AlreadyInitialized.selector);
        drop.initialize(p, 1 ether);
        assertEq(drop.nativeFee(), ETH_FEE, "I5. field 14 never moves");
    }

    /// @dev The V1 `initialize(InitParams)` is kept and means a zero ETH fee: a
    ///      `DropFactoryV2` cloning `DropV3` makes a working drop.
    function test_V3_InitializeV1Signature_MeansZeroNativeFee() public {
        DropFactoryV2 v2 = new DropFactoryV2(owner, address(implementation), feeRecipient);
        vm.prank(owner);
        v2.setCreatorAllowed(relayer, true);

        (address[] memory r, uint256[] memory a) = _defaultCrowd(2);
        bytes32 commitment = _commitment(7);
        address predicted = v2.predictDrop(relayer, commitment, 7);
        _setCrowd(r, a);
        _buildTree(predicted);
        IDropFactoryV1.CreateParams memory p = IDropFactoryV1.CreateParams({
            asset: address(0),
            merkleRoot: root,
            manifestHash: MANIFEST_HASH,
            totalEntitlements: totalEntitlements,
            leafCount: uint32(recipients.length),
            refundRecipient: refundRecipient,
            creatorCommitment: commitment,
            nonce: 7,
            fundingPeriod: FUNDING_PERIOD,
            claimPeriod: CLAIM_PERIOD,
            tokenFactory: address(0)
        });
        vm.prank(relayer);
        DropV3 drop = DropV3(payable(v2.createDrop(p)));

        assertEq(drop.nativeFee(), 0);
        _activateNative(DropV1(payable(address(drop))));
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(recipients[0].balance, amounts[0]);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    function _oneHandleLeafTokenDrop(address token, uint256 xId, uint256 amount, uint256 fee) private returns (DropV3) {
        bytes32 commitment = _commitment(3);
        address predicted = factory.predictDrop(relayer, commitment, 3);
        bytes32[] memory hl = new bytes32[](1);
        hl[0] = MerkleHelper.handleLeafOf(predicted, block.chainid, 0, xId, amount);

        IDropFactoryV1.CreateParams memory p = IDropFactoryV1.CreateParams({
            asset: token,
            merkleRoot: MerkleHelper.rootOf(hl),
            manifestHash: MANIFEST_HASH,
            totalEntitlements: amount,
            leafCount: 1,
            refundRecipient: refundRecipient,
            creatorCommitment: commitment,
            nonce: 3,
            fundingPeriod: FUNDING_PERIOD,
            claimPeriod: CLAIM_PERIOD,
            tokenFactory: address(0)
        });
        nativeFeeNext = fee;
        vm.prank(relayer);
        address created = _sendCreateDrop(p);
        nativeFeeNext = 0;
        assertEq(created, predicted, "");
        return DropV3(payable(created));
    }
}
