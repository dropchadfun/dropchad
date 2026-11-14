// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V7TestBase} from "./V7TestBase.sol";

import {DropFactoryV6} from "../src/DropFactoryV6.sol";
import {DropV1} from "../src/DropV1.sol";
import {DropV7} from "../src/DropV7.sol";

/// @title DropFactoryV7Test
/// @notice `DropFactoryV7` is `DropFactoryV6` with only its name and its implementation changed.
///         `DropV7Parity.t.sol` runs every V1 to V6 factory suite
///         against it.
contract DropFactoryV7Test is V7TestBase {
    /// @dev Same constructor arguments, same runtime code, byte for byte: nothing
    ///      but the name changed. `cbor_metadata = false`, so no metadata hash differs.
    function test_V7Factory_RuntimeCodeEqualsV6() public {
        address v6 = address(new DropFactoryV6(owner, address(implementation), feeRecipient));
        assertGt(address(factory).code.length, 0);
        assertEq(keccak256(address(factory).code), keccak256(v6.code), "the V7 factory keeps the V6 factory code");
    }

    /// @dev Its implementation is a `DropV7`, and a new clone runs `DropV7` code.
    function test_V7Factory_ClonesDropV7() public {
        assertEq(_v7().implementation(), address(implementation));
        DropV1 drop = _createNativeDrop(3);
        assertEq(DropV7(payable(address(drop))).MAX_BINDING_LIFETIME(), 3600);
    }

    /// @dev The implementation reads `BinderRegistryV2`, the registry given to the factory.
    function test_V7Factory_ImplementationReadsTheRegistry() public view {
        assertEq(address(DropV7(payable(address(implementation))).BINDER_REGISTRY()), address(registry));
    }
}
