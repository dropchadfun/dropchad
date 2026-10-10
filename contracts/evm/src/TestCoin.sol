// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestCoin
/// @notice Our own plain `TEST` coin for the Robinhood testnet token drop test. `docs/SPEC.md`
///         R7.53 and `docs/RESEARCH.md` Part 8.
/// @dev OpenZeppelin `ERC20` and nothing else: 18 decimals, the whole supply minted once to the
///      deployer in the constructor. No owner, no mint, no burn, no pause, no blocklist, no tax,
///      no proxy. Nobody can change it after it is deployed. Testnet only, never mainnet.
contract TestCoin is ERC20 {
    /// @notice One billion TEST, all of it minted once, to the deployer.
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("Test Coin", "TEST") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}
