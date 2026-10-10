// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TestCoin} from "../src/TestCoin.sol";

/// @title TestCoinTest
/// @notice Our own plain `TEST` coin for the Robinhood testnet: OpenZeppelin
///         ERC20, 18 decimals, the whole supply minted once to the deployer, no, no mint,
///         no pause, not a proxy, no tax.
contract TestCoinTest is Test {
    TestCoin internal coin;
    address internal deployer = makeAddr("deployer");

    function setUp() public {
        vm.prank(deployer);
        coin = new TestCoin();
    }

    function test_TestCoin_NameTickerDecimals() public view {
        assertEq(coin.name(), "Test Coin");
        assertEq(coin.symbol(), "TEST");
        assertEq(coin.decimals(), 18);
    }

    /// @dev One billion TEST, all to the deployer, once.
    function test_TestCoin_WholeSupplyToTheDeployer() public view {
        assertEq(coin.INITIAL_SUPPLY(), 1_000_000_000 ether);
        assertEq(coin.totalSupply(), coin.INITIAL_SUPPLY());
        assertEq(coin.balanceOf(deployer), coin.INITIAL_SUPPLY());
    }

    /// @dev Nothing anybody can call to change it: no, no mint, no burn, no pause.
    function test_TestCoin_NoOwnerNoMintNoPause() public {
        string[6] memory calls = [
            "owner()", "mint(address,uint256)", "burn(uint256)", "pause()", "upgradeTo(address)", "renounceOwnership()"
        ];
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok,) = address(coin).call(abi.encodeWithSignature(calls[i], address(this), 1));
            assertFalse(ok, calls[i]);
        }
    }

    /// @dev Not a proxy: the three EIP-1967 slots are empty.
    function test_TestCoin_IsNotAProxy() public view {
        bytes32[3] memory slots = [
            bytes32(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc),
            bytes32(0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50),
            bytes32(0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103)
        ];
        for (uint256 i = 0; i < 3; i++) {
            assertEq(vm.load(address(coin), slots[i]), bytes32(0));
        }
    }

    /// @dev No tax: what is sent is what arrives.
    function test_TestCoin_PlainTransfer() public {
        address to = makeAddr("to");
        vm.prank(deployer);
        assertTrue(coin.transfer(to, 123 ether));
        assertEq(coin.balanceOf(to), 123 ether);
        assertEq(coin.totalSupply(), coin.INITIAL_SUPPLY(), "nothing burned");
    }
}
