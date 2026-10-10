// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @notice Any address can be blocked. A transfer to or from a blocked address reverts.
/// @dev Expected: the blocked recipient claim reverts, every other claim still works.
contract BlacklistERC20 is MockERC20 {
    error Blacklisted(address account);

    mapping(address => bool) public blacklisted;

    constructor() MockERC20("Blacklist", "BLOCK", 18) {}

    function setBlacklisted(address account, bool blocked) external {
        blacklisted[account] = blocked;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        if (blacklisted[from]) revert Blacklisted(from);
        if (blacklisted[to]) revert Blacklisted(to);
        super._transfer(from, to, amount);
    }
}
