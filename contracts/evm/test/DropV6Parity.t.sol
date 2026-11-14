// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DropFactoryV3Test} from "./DropFactoryV3.t.sol";
import {DropFactoryV4Test} from "./DropFactoryV4.t.sol";
import {DropFactoryV5Test} from "./DropFactoryV5.t.sol";
import {DropV3Test} from "./DropV3.t.sol";
import {DropV5Test} from "./DropV5.t.sol";
import {
    BoundariesTestOnV3,
    DropFactoryV2TestOnV3,
    DropV1LifecycleTestOnV3,
    DropV1TestOnV3,
    DropV2InvariantsTestOnV3,
    DropV2TestOnV3,
    FuzzTestOnV3,
    MaliciousTokensTestOnV3
} from "./DropV3Parity.t.sol";
import {RejectingEthReceiver} from "./RejectingEthReceiver.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {BinderRegistryV2} from "../src/BinderRegistryV2.sol";
import {DropFactoryV6} from "../src/DropFactoryV6.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV6} from "../src/DropV6.sol";
import {IDropV1} from "../src/IDropV1.sol";
import {IDropV5} from "../src/IDropV5.sol";
import {IDropV6} from "../src/IDropV6.sol";

// DropV6, DropFactoryV6 and BinderRegistryV2 parity. Every suite that runs on the V5 pair runs
// again on the V6 trio: `DropV6` is `DropV5` plus the index check, option B,
// the native sweep and sends without return data; `DropFactoryV6` is `DropFactoryV5` plus the
// pause guardian. Every other behaviour must hold unchanged. **Four tests are overridden, on
// purpose,** because they assert what V6 changes: a native refund or cancel to an address that
// rejects ETH no longer reverts, a finished native drop can be swept
// and an index past `leafCount` is `BadIndex` before the proof is read.

function _deployV6(address owner_, address implementation_, address feeRecipient_) returns (address) {
    return address(new DropFactoryV6(owner_, implementation_, feeRecipient_));
}

/// @dev The suites hand in the registry they built. `DropV6` reads any `IBinderRegistry`, so
///      the old one works here; `BinderRegistryV2.t.sol` runs every registry test on the new one.
function _implementationV6(address registry_) returns (address) {
    return address(new DropV6(registry_));
}

function _registryV2(address owner_) returns (BinderRegistry) {
    return BinderRegistry(address(new BinderRegistryV2(owner_)));
}

contract DropV1TestOnV6 is DropV1TestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV6(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV6(o, i, f);
    }
}

contract DropV1LifecycleTestOnV6 is DropV1LifecycleTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV6(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV6(o, i, f);
    }

    /// @dev **Changed on purpose.** On V6 a finished native drop can be swept: ETH
    ///      forced in after the refund leaves to `refundRecipient`.
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

contract BoundariesTestOnV6 is BoundariesTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV6(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV6(o, i, f);
    }
}

contract FuzzTestOnV6 is FuzzTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV6(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV6(o, i, f);
    }

    /// @dev **Changed on purpose.** On V6 an index at or past `leafCount` is
    ///      `BadIndex`, checked before the proof. It still always reverts.
    function testFuzz_ClaimIndex_OutOfTree_AlwaysReverts(uint256 index, uint256 amount) public override {
        DropV1 drop = _createNativeDrop(3);
        _activateNative(drop);

        index = bound(index, 3, type(uint128).max);
        amount = bound(amount, 1, totalEntitlements);

        vm.expectRevert(IDropV6.BadIndex.selector);
        drop.claim(index, recipients[0], amount, _proof(0));
    }
}

contract MaliciousTokensTestOnV6 is MaliciousTokensTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV6(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV6(o, i, f);
    }
}

contract DropV2TestOnV6 is DropV2TestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV6(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV6(o, i, f);
    }
}

contract DropV2InvariantsTestOnV6 is DropV2InvariantsTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV6(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV6(o, i, f);
    }
}

/// @dev The whole `DropFactoryV1Test` and `DropFactoryV2Test` suites on `DropFactoryV6`.
contract DropFactoryV2TestOnV6 is DropFactoryV2TestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV6(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV6(o, i, f);
    }
}

/// @dev The whole `DropFactoryV3Test` suite on the V6 trio.
contract DropFactoryV3TestOnV6 is DropFactoryV3Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV6(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV6(owner, address(implementation), feeRecipient);
    }
}

/// @dev The whole `DropFactoryV4Test` suite, the fee, on the V6 trio.
contract DropFactoryV4TestOnV6 is DropFactoryV4Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV6(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV6(owner, address(implementation), feeRecipient);
    }
}

/// @dev The whole `DropFactoryV5Test` suite, the refund check and `Ownable2Step`, on the V6 trio.
contract DropFactoryV5TestOnV6 is DropFactoryV5Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV6(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV6(owner, address(implementation), feeRecipient);
    }
}

/// @dev The whole `DropV3Test` suite on the V6 trio.
contract DropV3TestOnV6 is DropV3Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV6(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV6(owner, address(implementation), feeRecipient);
    }
}

/// @dev The whole `DropV5Test` suite on the V6 trio: L1 and the refund address check.
contract DropV5TestOnV6 is DropV5Test {
    function _deployImplementation() internal override returns (address) {
        registry = _registryV2(owner);
        return _implementationV6(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV6(owner, address(implementation), feeRecipient);
    }

    /// @dev **Changed on purpose.** On V6 a native refund to an address that rejects
    ///      ETH does not revert: the drop is `Finalized` and the ETH waits for a sweep.
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

    /// @dev **Changed on purpose.** The same for a native cancel.
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
