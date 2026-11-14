// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V5TestBase} from "./V5TestBase.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {BinderRegistryV2} from "../src/BinderRegistryV2.sol";
import {DropFactoryV6} from "../src/DropFactoryV6.sol";
import {DropV6} from "../src/DropV6.sol";

/// @title V6TestBase
/// @notice `V5TestBase` on `DropV6`, `DropFactoryV6` and `BinderRegistryV2`.
///         Every V3 and V5 helper works unchanged: the V6 trio keeps the V5 ABI.
/// @dev `registry` stays typed `BinderRegistry`: `BinderRegistryV2` has the same binder ABI,
///      `IBinderRegistry`, so the cast through `address` calls it unchanged.
abstract contract V6TestBase is V5TestBase {
    function _deployImplementation() internal virtual override returns (address) {
        registry = BinderRegistry(address(new BinderRegistryV2(owner)));
        return address(new DropV6(address(registry)));
    }

    function _deployFactory() internal virtual override returns (address) {
        return address(new DropFactoryV6(owner, address(implementation), feeRecipient));
    }

    function _v6() internal view returns (DropFactoryV6) {
        return DropFactoryV6(address(factory));
    }
}
