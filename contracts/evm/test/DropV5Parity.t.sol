// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DropFactoryV3Test} from "./DropFactoryV3.t.sol";
import {DropFactoryV4Test} from "./DropFactoryV4.t.sol";
import {DropV3Test} from "./DropV3.t.sol";
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

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropFactoryV5} from "../src/DropFactoryV5.sol";
import {DropV5} from "../src/DropV5.sol";

// DropV5 and DropFactoryV5 parity. Every suite that runs on the V3 pair and on `DropFactoryV4`
// runs again on the V5 pair: `DropV5` is `DropV3` plus the safe ETH return and the refund
// check, `DropFactoryV5` is `DropFactoryV4` plus the refund check and `Ownable2Step`. Every other
// behaviour must hold unchanged. Each contract inherits its suite and swaps the implementation
// and the factory; the tests `DropV3Parity.t.sol` overrides on purpose stay overridden.

function _deployV5(address owner_, address implementation_, address feeRecipient_) returns (address) {
    return address(new DropFactoryV5(owner_, implementation_, feeRecipient_));
}

function _implementationV5(address registry_) returns (address) {
    return address(new DropV5(registry_));
}

contract DropV1TestOnV5 is DropV1TestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV5(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV5(o, i, f);
    }
}

contract DropV1LifecycleTestOnV5 is DropV1LifecycleTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV5(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV5(o, i, f);
    }
}

contract BoundariesTestOnV5 is BoundariesTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV5(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV5(o, i, f);
    }
}

contract FuzzTestOnV5 is FuzzTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV5(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV5(o, i, f);
    }
}

contract MaliciousTokensTestOnV5 is MaliciousTokensTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV5(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV5(o, i, f);
    }
}

contract DropV2TestOnV5 is DropV2TestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV5(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV5(o, i, f);
    }
}

contract DropV2InvariantsTestOnV5 is DropV2InvariantsTestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV5(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV5(o, i, f);
    }
}

/// @dev The whole `DropFactoryV1Test` and `DropFactoryV2Test` suites on `DropFactoryV5`.
contract DropFactoryV2TestOnV5 is DropFactoryV2TestOnV3 {
    function _v3ImplementationFor(address r) internal override returns (address) {
        return _implementationV5(r);
    }

    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV5(o, i, f);
    }
}

/// @dev The whole `DropFactoryV3Test` suite on the V5 pair.
contract DropFactoryV3TestOnV5 is DropFactoryV3Test {
    function _deployImplementation() internal override returns (address) {
        registry = new BinderRegistry(owner);
        return _implementationV5(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV5(owner, address(implementation), feeRecipient);
    }
}

/// @dev The whole `DropFactoryV4Test` suite, the fee, on the V5 pair.
contract DropFactoryV4TestOnV5 is DropFactoryV4Test {
    function _deployImplementation() internal override returns (address) {
        registry = new BinderRegistry(owner);
        return _implementationV5(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV5(owner, address(implementation), feeRecipient);
    }
}

/// @dev The whole `DropV3Test` suite on the V5 pair: the ETH fee of a token drop, and the money
///      back when the refund address takes ETH.
contract DropV3TestOnV5 is DropV3Test {
    function _deployImplementation() internal override returns (address) {
        registry = new BinderRegistry(owner);
        return _implementationV5(address(registry));
    }

    function _deployFactory() internal override returns (address) {
        return _deployV5(owner, address(implementation), feeRecipient);
    }
}
