// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V3TestBase} from "./V3TestBase.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV5} from "../src/DropFactoryV5.sol";
import {DropV5} from "../src/DropV5.sol";

/// @title V5TestBase
/// @notice `V3TestBase` on `DropV5` and `DropFactoryV5`. Every V3 helper,
///         the token drop and its ETH fee, works unchanged: the V5 pair keeps the V3 ABI.
abstract contract V5TestBase is V3TestBase {
    function _deployImplementation() internal virtual override returns (address) {
        registry = new BinderRegistry(owner);
        return address(new DropV5(address(registry)));
    }

    function _deployFactory() internal virtual override returns (address) {
        return address(new DropFactoryV5(owner, address(implementation), feeRecipient));
    }

    function _v5() internal view returns (DropFactoryV5) {
        return DropFactoryV5(address(factory));
    }
}
