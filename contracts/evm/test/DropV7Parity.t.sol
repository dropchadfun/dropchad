// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DropFactoryV3Test} from "./DropFactoryV3.t.sol";
import {DropFactoryV4Test} from "./DropFactoryV4.t.sol";
import {DropFactoryV5Test} from "./DropFactoryV5.t.sol";
import {DropFactoryV6Test} from "./DropFactoryV6.t.sol";
import {DropV3Test} from "./DropV3.t.sol";
import {DropV5Test} from "./DropV5.t.sol";
import {DropV6Test} from "./DropV6.t.sol";
import {
    BoundariesTestOnV3,
    DropFactoryV2TestOnV3,
    DropV1LifecycleTestOnV3,
    DropV1TestOnV3,
    FuzzTestOnV3,
    MaliciousTokensTestOnV3
} from "./DropV3Parity.t.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {MockERC20} from "./MockERC20.sol";
import {RejectingEthReceiver} from "./RejectingEthReceiver.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {BinderRegistryV2} from "../src/BinderRegistryV2.sol";
import {DropFactoryV7} from "../src/DropFactoryV7.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {DropV7} from "../src/DropV7.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropV5} from "../src/IDropV5.sol";
import {IDropV7} from "../src/IDropV7.sol";

// DropV7 and DropFactoryV7 parity. Every V1 to V6 suite that does not call the old
// `claimHandle` runs again on the V7 pair: everything but binding v2 and
// behaves as `DropV6`. A test that pins a changed rule is overridden here, marked
// **Changed on purpose**. Not here: `DropV2Test` and `DropV2InvariantsTest`. Both call the six
// argument `claimHandle`, which `DropV7` does not have; their cases run on binding v2 in
// `DropV7.t.sol`.

function _deployV7(address owner_, address implementation_, address feeRecipient_) returns (address) {
    return address(new DropFactoryV7(owner_, implementation_, feeRecipient_));
}

function _implementationV7(address registry_) returns (address) {
    return address(new DropV7(registry_));
}

function _registryV2(address owner_) returns (BinderRegistry) {
    return BinderRegistry(address(new BinderRegistryV2(owner_)));
}

contract DropV1TestOnV7 is DropV1TestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV7(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV7(o, i, f);
    }
}

contract DropV1LifecycleTestOnV7 is DropV1LifecycleTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV7(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV7(o, i, f);
    }

    /// @dev **Changed on purpose.** A late drop token on a finished drop is swept to
    ///      `refundRecipient`.
    function test_RevertWhen_Sweep_DropAsset() public override {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        _activateErc20(token, drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        uint256 before = token.balanceOf(refundRecipient);

        token.mint(address(drop), 1 ether); // a late arrival
        drop.sweep(address(token));
        assertEq(token.balanceOf(refundRecipient) - before, 1 ether, "");
    }

    /// @dev **Changed on purpose**, as on `DropV6`.
    function test_RevertWhen_Sweep_NativeWhenAssetIsNative() public override {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        uint256 before = refundRecipient.balance;

        vm.deal(address(drop), 1 ether); // forced send after the refund
        drop.sweep(address(0));
        assertEq(refundRecipient.balance - before, 1 ether, "");
    }
}

contract BoundariesTestOnV7 is BoundariesTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV7(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV7(o, i, f);
    }
}

contract FuzzTestOnV7 is FuzzTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV7(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV7(o, i, f);
    }

    /// @dev **Changed on purpose**, as on `DropV6`.
    function testFuzz_ClaimIndex_OutOfTree_AlwaysReverts(uint256 index, uint256 amount) public override {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        index = bound(index, 3, type(uint128).max);
        amount = bound(amount, 1, totalEntitlements);

        vm.expectRevert(IDropV7.BadIndex.selector);
        drop.claim(index, recipients[0], amount, _proof(0));
    }
}

contract MaliciousTokensTestOnV7 is MaliciousTokensTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV7(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV7(o, i, f);
    }
}

/// @dev The whole `DropFactoryV1Test` and `DropFactoryV2Test` suites on `DropFactoryV7`.
contract DropFactoryV2TestOnV7 is DropFactoryV2TestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV7(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV7(o, i, f);
    }
}

contract DropFactoryV3TestOnV7 is DropFactoryV3Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV7(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV7(owner, address(implementation), feeRecipient);
    }
}

contract DropFactoryV4TestOnV7 is DropFactoryV4Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV7(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV7(owner, address(implementation), feeRecipient);
    }
}

contract DropFactoryV5TestOnV7 is DropFactoryV5Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV7(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV7(owner, address(implementation), feeRecipient);
    }
}

/// @dev The pause guardian suite of `DropFactoryV6` on the V7 pair.
contract DropFactoryV6TestOnV7 is DropFactoryV6Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV7(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV7(owner, address(implementation), feeRecipient);
    }
}

contract DropV3TestOnV7 is DropV3Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV7(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV7(owner, address(implementation), feeRecipient);
    }

    /// @dev **Changed on purpose.** The same token handle claim on binding v2.
    function test_V3_TokenDrop_HandleClaimPaysTokens() public override {
        (address binder, uint256 binderKey) = makeAddrAndKey("binder");
        vm.prank(owner);
        registry.setBinder(binder);

        MockERC20 token = new MockERC20("Test Coin", "TEST", 18);
        _allowTokenByAddress(address(token));
        uint256 xId = 44_196_397;
        DropV7 drop = _oneHandleLeafTokenDropV7(address(token), xId, 5 ether);
        _activateTokenDrop(DropV3(payable(address(drop))), token);

        address wallet = makeAddr("alice wallet");
        uint64 until = uint64(block.timestamp) + 600;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(binderKey, drop.bindingDigest(0, xId, wallet, until));
        vm.prank(relayer);
        drop.claimHandle(0, xId, 5 ether, wallet, until, new bytes32[](0), abi.encodePacked(r, s, v));

        assertEq(token.balanceOf(wallet), 5 ether, "the bound wallet got the tokens");
        assertEq(wallet.balance, 0, "and no ETH");
    }

    function _oneHandleLeafTokenDropV7(address token, uint256 xId, uint256 amount) private returns (DropV7) {
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
        nativeFeeNext = ETH_FEE;
        vm.prank(relayer);
        address created = _sendCreateDrop(p);
        nativeFeeNext = 0;
        assertEq(created, predicted, "");
        return DropV7(payable(created));
    }
}

contract DropV5TestOnV7 is DropV5Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV7(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV7(owner, address(implementation), feeRecipient);
    }

    /// @dev **Changed on purpose**, as on `DropV6`.
    function test_V5_RevertWhen_NativeRefund_RefundRejectsEth() public override {
        refundRecipient = address(new RejectingEthReceiver());
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);
        uint256 bal = address(drop).balance;

        vm.warp(drop.claimDeadline() + 1);
        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV5.NativeReturnFailed(refundRecipient, bal);
        drop.refund();
        _assertStatus(drop, IDropV1.Status.Finalized);
        assertEq(address(drop).balance, bal, "the ETH waits");
    }

    /// @dev **Changed on purpose**, as on `DropV6`.
    function test_V5_RevertWhen_NativeCancel_RefundRejectsEth() public override {
        refundRecipient = address(new RejectingEthReceiver());
        DropV1 drop = _createNativeDrop(3);
        _fundNative(drop, 1 ether);

        vm.warp(drop.fundingDeadline() + 1);
        vm.expectEmit(true, false, false, true, address(drop));
        emit IDropV5.NativeReturnFailed(refundRecipient, 1 ether);
        drop.cancelUnfunded();
        _assertStatus(drop, IDropV1.Status.Cancelled);
        assertEq(address(drop).balance, 1 ether, "the ETH waits");
    }
}

/// @dev The whole `DropV6Test` suite on the V7 pair.
contract DropV6TestOnV7 is DropV6Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV7(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV7(owner, address(implementation), feeRecipient);
    }

    function _bindV2(address drop, uint256 index, uint256 xId, address to, uint64 until)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(binderKey, DropV7(payable(drop)).bindingDigest(index, xId, to, until));
        return abi.encodePacked(r, s, v);
    }

    /// @dev **Changed on purpose.**  on binding v2.
    function test_V6_RevertWhen_ClaimHandle_IndexAtLeafCount() public override {
        (DropV3 d, uint256[] memory ids, bytes32[] memory hl) = _badTreeHandleDrop();
        DropV7 drop = DropV7(payable(address(d)));
        address to = makeAddr("handle wallet");
        uint64 until = uint64(block.timestamp) + 600;

        bytes memory sig = _bindV2(address(drop), 2, ids[2], to, until);
        vm.expectRevert(IDropV7.BadIndex.selector);
        drop.claimHandle(2, ids[2], 1 ether, to, until, MerkleHelper.proofOf(hl, 2), sig);
        assertEq(to.balance, 0);
    }

    /// @dev **Changed on purpose.** The control on binding v2.
    function test_V6_ClaimHandle_IndexBelowLeafCountStillPays() public override {
        (DropV3 d, uint256[] memory ids, bytes32[] memory hl) = _badTreeHandleDrop();
        DropV7 drop = DropV7(payable(address(d)));
        address to = makeAddr("handle wallet");
        uint64 until = uint64(block.timestamp) + 600;

        bytes memory sig = _bindV2(address(drop), 1, ids[1], to, until);
        drop.claimHandle(1, ids[1], 1 ether, to, until, MerkleHelper.proofOf(hl, 1), sig);
        assertEq(to.balance, 1 ether);
    }

    /// @dev **Changed on purpose.** `BadXId` still comes before `BadIndex`.
    function test_V6_RevertWhen_ClaimHandle_ZeroXIdBeforeBadIndex() public override {
        (DropV3 d,, bytes32[] memory hl) = _badTreeHandleDrop();
        DropV7 drop = DropV7(payable(address(d)));
        address to = makeAddr("handle wallet");

        vm.expectRevert(IDropV7.BadXId.selector);
        drop.claimHandle(5, 0, 1 ether, to, uint64(block.timestamp), MerkleHelper.proofOf(hl, 2), "");
    }

    /// @dev **Changed on purpose.** A token drop's own token is swept once finished.
    function test_V6_RevertWhen_Sweep_TokenDropAsset() public override {
        (DropV3 drop, MockERC20 token) = _createTokenDrop(3, 0);
        _activateTokenDrop(drop, token);
        vm.warp(drop.claimDeadline() + 1);
        drop.refund();
        uint256 before = token.balanceOf(refundRecipient);
        token.mint(address(drop), 1 ether);

        drop.sweep(address(token));
        assertEq(token.balanceOf(refundRecipient) - before, 1 ether, "");
    }
}
