// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ITokenFactoryAdapter} from "../src/ITokenFactoryAdapter.sol";

/// @notice An `ITokenFactoryAdapter` over a configurable set of tokens.
/// @dev Stands in for `PonsV1Adapter` and `PonsV2Adapter`, which are a
///      separate task and are blocked on, the unverified Pons addresses.
///      Two independent instances model: membership is **per factory**, so a token
///      allowed on one instance returns false on the other.
contract MockTokenFactoryAdapter is ITokenFactoryAdapter {
    /// @dev `getTokenDeployer` must revert, never return the zero address.
    error NotFromThisFactory(address token);

    mapping(address => bool) internal _allowed;
    mapping(address => address) internal _deployer;

    /// @notice Set to true to model, an adapter that reverts instead of returning false.
    bool public revertOnUnknown;

    function setToken(address token, bool allowed, address deployer) external {
        _allowed[token] = allowed;
        _deployer[token] = deployer;
    }

    function setRevertOnUnknown(bool value) external {
        revertOnUnknown = value;
    }

    function isTokenFromFactory(address token) external view returns (bool) {
        if (!_allowed[token] && revertOnUnknown) revert NotFromThisFactory(token);
        return _allowed[token];
    }

    function getTokenDeployer(address token) external view returns (address) {
        if (!_allowed[token]) revert NotFromThisFactory(token);
        return _deployer[token];
    }
}
