// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BoundariesTest} from "./Boundaries.t.sol";
import {DropFactoryV2Test} from "./DropFactoryV2.t.sol";
import {DropV1LifecycleTest} from "./DropV1Lifecycle.t.sol";
import {DropV1Test} from "./DropV1.t.sol";
import {DropV2InvariantsTest} from "./DropV2Invariants.t.sol";
import {DropV2Test} from "./DropV2.t.sol";
import {FuzzTest} from "./Fuzz.t.sol";
import {MaliciousTokensTest} from "./MaliciousTokens.t.sol";
import {MockERC20} from "./MockERC20.sol";
import {V3Params} from "./V3TestBase.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV3} from "../src/DropFactoryV3.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV3} from "../src/DropV3.sol";
import {IDropFactoryV1} from "../src/IDropFactoryV1.sol";
import {IDropFactoryV3} from "../src/IDropFactoryV3.sol";

/// @title DropV3 parity
/// @notice Every `DropV1` and `DropV2` suite, the factory suites and the V2 invariants, run
///         against `DropV3` on `DropFactoryV3`, the pair that ships next.
/// @dev `DropV3` is `DropV2` plus the ETH fee of a token drop; `DropFactoryV3` is
///      `DropFactoryV2` plus that fee and the exact address allowlist. The shared suites
///      build V1 `CreateParams`; `_sendCreateDrop` hands them to V3 with a zero ETH fee, which is
///      exactly a V2 drop. **Two tests are overridden, on purpose,** because they assert what V3
///      changes: a token drop now takes ETH while it waits, and a token drop never pays a
///      percent of the token. Everything else must hold unchanged.
abstract contract OnV3 {
    function _v3Implementation(address registryOwner) internal returns (address) {
        return address(new DropV3(address(new BinderRegistry(registryOwner))));
    }

    /// @dev `virtual` so `DropV4Parity.t.sol` runs every suite here on `DropFactoryV4`.
    function _v3Factory(address owner_, address implementation_, address feeRecipient_)
        internal
        virtual
        returns (address)
    {
        return address(new DropFactoryV3(owner_, implementation_, feeRecipient_));
    }

    /// @dev One external call, the `createDrop` itself, as `_sendCreateDrop` requires.
    function _v3Send(address factory_, IDropFactoryV1.CreateParams memory p) internal returns (address) {
        return IDropFactoryV3(factory_).createDrop(V3Params.from(p, 0));
    }
}

contract DropV1TestOnV3 is DropV1Test, OnV3 {
    function _deployImplementation() internal override returns (address) {
        return _v3Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v3Factory(owner, address(implementation), feeRecipient);
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal override returns (address) {
        return _v3Send(address(factory), p);
    }
}

contract DropV1LifecycleTestOnV3 is DropV1LifecycleTest, OnV3 {
    function _deployImplementation() internal override returns (address) {
        return _v3Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v3Factory(owner, address(implementation), feeRecipient);
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal override returns (address) {
        return _v3Send(address(factory), p);
    }

    /// @dev **Changed on purpose.** On V3 a token drop takes ETH while it is `Created`:
    ///      that is its fee. `DropV3.t.sol` tests the rest of the new `receive`.
    function test_RevertWhen_Receive_NativeWhenAssetIsErc20() public override {
        (DropV1 drop,) = _createErc20Drop(3);

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(drop).call{value: 1 ether}("");

        assertTrue(ok, "a waiting token drop takes ETH");
        assertEq(address(drop).balance, 1 ether);
    }

    /// @dev **Changed on purpose.** On V3 `refund` of a token drop already sends the ETH
    ///      back, so there is nothing left to sweep. ETH forced in after the end still leaves
    ///      through `sweep`.
    function test_Sweep_Native_WhenAssetIsErc20() public override {
        (DropV1 drop, MockERC20 token) = _createErc20Drop(3);
        vm.deal(address(drop), 3 ether);

        _activateErc20(token, drop);
        vm.warp(drop.claimDeadline() + 1);
        uint256 before = refundRecipient.balance;
        drop.refund();
        assertEq(refundRecipient.balance - before, 3 ether, "refund returned the ETH");

        vm.deal(address(drop), 1 ether); // forced in after the end
        drop.sweep(address(0));
        assertEq(refundRecipient.balance - before, 4 ether, "");
        assertEq(address(drop).balance, 0);
    }
}

contract BoundariesTestOnV3 is BoundariesTest, OnV3 {
    function _deployImplementation() internal override returns (address) {
        return _v3Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v3Factory(owner, address(implementation), feeRecipient);
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal override returns (address) {
        return _v3Send(address(factory), p);
    }
}

contract FuzzTestOnV3 is FuzzTest, OnV3 {
    function _deployImplementation() internal override returns (address) {
        return _v3Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v3Factory(owner, address(implementation), feeRecipient);
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal override returns (address) {
        return _v3Send(address(factory), p);
    }
}

contract MaliciousTokensTestOnV3 is MaliciousTokensTest, OnV3 {
    function _deployImplementation() internal override returns (address) {
        return _v3Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v3Factory(owner, address(implementation), feeRecipient);
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal override returns (address) {
        return _v3Send(address(factory), p);
    }
}

contract DropV2TestOnV3 is DropV2Test, OnV3 {
    /// @dev `DropV2Test` keeps the registry to set its binder, so it is built here, not in `OnV3`.
    function _deployImplementation() internal override returns (address) {
        registry = new BinderRegistry(owner);
        return address(new DropV3(address(registry)));
    }

    function _deployFactory() internal override returns (address) {
        return _v3Factory(owner, address(implementation), feeRecipient);
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal override returns (address) {
        return _v3Send(address(factory), p);
    }
}

contract DropV2InvariantsTestOnV3 is DropV2InvariantsTest, OnV3 {
    function _deployImplementation() internal override returns (address) {
        registry = new BinderRegistry(owner);
        return address(new DropV3(address(registry)));
    }

    function _deployFactory() internal override returns (address) {
        return _v3Factory(owner, address(implementation), feeRecipient);
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal override returns (address) {
        return _v3Send(address(factory), p);
    }
}

/// @dev The whole `DropFactoryV1Test` and `DropFactoryV2Test` suites on `DropFactoryV3`.
contract DropFactoryV2TestOnV3 is DropFactoryV2Test, OnV3 {
    /// @dev `DropFactoryV3` initializes its clones with the ETH fee, so it clones `DropV3`.
    function _deployImplementation() internal override returns (address) {
        return _v3Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v3Factory(owner, address(implementation), feeRecipient);
    }

    function _sendCreateDrop(IDropFactoryV1.CreateParams memory p) internal override returns (address) {
        return _v3Send(address(factory), p);
    }

    /// @dev **Changed on purpose.** On V3 a token drop pays no percent of the
    ///      token at any bps; its fee is ETH. V2 charged the plain bps in token units here.
    function test_V2_Fee_MinimumNeverAppliesToATokenDrop() public override {
        _setBps(100);
        _setMinFee(MIN_FEE);

        (DropV1 drop,) = _createErc20Drop(3);
        assertEq(drop.config().feeAmount, 0, "never a percent of the token");

        MockERC20 token = new MockERC20("Second", "TWO", 18);
        address tokenFactory = _allowToken(address(token));
        (address[] memory r, uint256[] memory a) = _defaultCrowd(3);
        DropV1 second = _createDrop(address(token), tokenFactory, 1, r, a);
        assertEq(second.config().feeAmount, 0, "zero at any bps and any minimum");
    }
}
