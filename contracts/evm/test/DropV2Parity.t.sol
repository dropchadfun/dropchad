// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BoundariesTest} from "./Boundaries.t.sol";
import {DropV1LifecycleTest} from "./DropV1Lifecycle.t.sol";
import {DropV1Test} from "./DropV1.t.sol";
import {FuzzTest} from "./Fuzz.t.sol";
import {MaliciousTokensTest} from "./MaliciousTokens.t.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV2} from "../src/DropFactoryV2.sol";
import {DropV2} from "../src/DropV2.sol";

/// @title DropV2 parity
/// @notice Every `DropV1` suite, run against `DropV2` on `DropFactoryV2`, the pair that ships.
/// @dev `DropV2` is `DropV1` copied with handle mode added. These five
///      contracts prove every V1 rule still holds on the copy: claims, batches, boundaries, fuzz,
///      and the malicious tokens and recipients of. The registry has no binder here,
///      which is right: address leaves never read it. `DropV2.t.sol` tests what V2 adds.
abstract contract OnV2 {
    function _v2Implementation(address registryOwner) internal returns (address) {
        return address(new DropV2(address(new BinderRegistry(registryOwner))));
    }

    function _v2Factory(address owner_, address implementation_, address feeRecipient_) internal returns (address) {
        return address(new DropFactoryV2(owner_, implementation_, feeRecipient_));
    }
}

contract DropV1TestOnV2 is DropV1Test, OnV2 {
    function _deployImplementation() internal override returns (address) {
        return _v2Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v2Factory(owner, address(implementation), feeRecipient);
    }
}

contract DropV1LifecycleTestOnV2 is DropV1LifecycleTest, OnV2 {
    function _deployImplementation() internal override returns (address) {
        return _v2Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v2Factory(owner, address(implementation), feeRecipient);
    }
}

contract BoundariesTestOnV2 is BoundariesTest, OnV2 {
    function _deployImplementation() internal override returns (address) {
        return _v2Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v2Factory(owner, address(implementation), feeRecipient);
    }
}

contract FuzzTestOnV2 is FuzzTest, OnV2 {
    function _deployImplementation() internal override returns (address) {
        return _v2Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v2Factory(owner, address(implementation), feeRecipient);
    }
}

contract MaliciousTokensTestOnV2 is MaliciousTokensTest, OnV2 {
    function _deployImplementation() internal override returns (address) {
        return _v2Implementation(owner);
    }

    function _deployFactory() internal override returns (address) {
        return _v2Factory(owner, address(implementation), feeRecipient);
    }
}
