// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Balances are shares times a multiplier. `rebase` moves every balance at once.
/// @dev Expected: the test **documents the break**. A shrinking balance breaks
///      and the only defence is the launchpad allowlist. Nothing inside the drop can stop it.
contract RebasingERC20 is IERC20 {
    string public constant name = "Rebasing";
    string public constant symbol = "REBASE";
    uint8 public constant decimals = 18;

    /// @notice The multiplier for 1.0, no rebase.
    uint256 public constant ONE = 1e18;

    /// @notice Scales every balance. Starts at `ONE`.
    uint256 public multiplier = ONE;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function totalSupply() external view returns (uint256) {
        return (totalShares * multiplier) / ONE;
    }

    function balanceOf(address account) public view returns (uint256) {
        return (sharesOf[account] * multiplier) / ONE;
    }

    function mint(address to, uint256 amount) external {
        uint256 shares = (amount * ONE) / multiplier;
        totalShares += shares;
        sharesOf[to] += shares;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Below `ONE` shrinks every balance, above `ONE` grows it.
    function rebase(uint256 newMultiplier) external {
        multiplier = newMultiplier;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 shares = (amount * ONE) / multiplier;
        sharesOf[from] -= shares;
        unchecked {
            sharesOf[to] += shares;
        }
        emit Transfer(from, to, amount);
    }
}
