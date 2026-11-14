// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V6TestBase} from "./V6TestBase.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {BinderRegistryV2} from "../src/BinderRegistryV2.sol";
import {DropFactoryV7} from "../src/DropFactoryV7.sol";
import {DropV7} from "../src/DropV7.sol";

/// @title V7TestBase
/// @notice `V6TestBase` on `DropV7`, `DropFactoryV7` and `BinderRegistryV2`.
///         Every V3, V5 and V6 helper works unchanged except the handle claim, which
///         takes binding v2.
abstract contract V7TestBase is V6TestBase {
    function _deployImplementation() internal virtual override returns (address) {
        registry = BinderRegistry(address(new BinderRegistryV2(owner)));
        return address(new DropV7(address(registry)));
    }

    function _deployFactory() internal virtual override returns (address) {
        return address(new DropFactoryV7(owner, address(implementation), feeRecipient));
    }

    function _v7() internal view returns (DropFactoryV7) {
        return DropFactoryV7(address(factory));
    }
}
