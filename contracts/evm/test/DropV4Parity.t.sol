// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DropFactoryV3Test} from "./DropFactoryV3.t.sol";
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

import {DropFactoryV4} from "../src/DropFactoryV4.sol";

// DropFactoryV4 parity. Every suite that runs on `DropFactoryV3` runs again on `DropFactoryV4`,
// with the same `DropV3` implementation: V4 is V3 plus the fee, and
// with `minFeePerReceiver` and `maxFeeAmount` at zero it must behave exactly like V3.
// Each contract inherits its V3 suite and swaps only the factory. The two tests
// `DropV3Parity.t.sol` overrides on purpose stay overridden the same way here.

function _deployV4(address owner_, address implementation_, address feeRecipient_) returns (address) {
    return address(new DropFactoryV4(owner_, implementation_, feeRecipient_));
}

contract DropV1TestOnV4 is DropV1TestOnV3 {
    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV4(o, i, f);
    }
}

contract DropV1LifecycleTestOnV4 is DropV1LifecycleTestOnV3 {
    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV4(o, i, f);
    }
}

contract BoundariesTestOnV4 is BoundariesTestOnV3 {
    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV4(o, i, f);
    }
}

contract FuzzTestOnV4 is FuzzTestOnV3 {
    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV4(o, i, f);
    }
}

contract MaliciousTokensTestOnV4 is MaliciousTokensTestOnV3 {
    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV4(o, i, f);
    }
}

contract DropV2TestOnV4 is DropV2TestOnV3 {
    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV4(o, i, f);
    }
}

contract DropV2InvariantsTestOnV4 is DropV2InvariantsTestOnV3 {
    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV4(o, i, f);
    }
}

/// @dev The whole `DropFactoryV1Test` and `DropFactoryV2Test` suites on `DropFactoryV4`.
contract DropFactoryV2TestOnV4 is DropFactoryV2TestOnV3 {
    function _v3Factory(address o, address i, address f) internal override returns (address) {
        return _deployV4(o, i, f);
    }
}

/// @dev The whole `DropFactoryV3Test` suite on `DropFactoryV4`: the ETH fee of a token drop, the
///      exact address allowlist, the events.
contract DropFactoryV3TestOnV4 is DropFactoryV3Test {
    function _deployFactory() internal override returns (address) {
        return _deployV4(owner, address(implementation), feeRecipient);
    }
}

/// @dev The whole `DropV3Test` suite with its drops made by `DropFactoryV4`.
contract DropV3TestOnV4 is DropV3Test {
    function _deployFactory() internal override returns (address) {
        return _deployV4(owner, address(implementation), feeRecipient);
    }
}
