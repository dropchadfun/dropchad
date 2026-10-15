// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ITokenFactoryAdapter
/// @notice One adapter per launchpad **generation**. SPEC 12.2.
/// @dev An adapter must be stateless and read only. No storage, no owner, no funds. R12.4.
interface ITokenFactoryAdapter {
    /// @notice True if `token` was created by the launchpad this adapter wraps.
    /// @dev Membership is per factory. A token from another generation returns false. R12.6.
    function isTokenFromFactory(address token) external view returns (bool);

    /// @notice The original creator wallet recorded at launch. Never a fee recipient. R12.5.
    /// @dev Reverts if the token is not from this launchpad, so a caller can never confuse
    ///      "not from this launchpad" with "deployer is the zero address". R12.7.
    function getTokenDeployer(address token) external view returns (address);
}
