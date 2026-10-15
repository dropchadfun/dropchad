// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {BinderRegistry} from "../src/BinderRegistry.sol";
import {DropV2} from "../src/DropV2.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @title HandleVectorTest
/// @notice The EVM handle vectors, pinned to the same numbers as
///         `packages/shared/test/handle.test.ts`.
/// @dev The numbers were computed from the formulas with plain viem primitives. The
///      TypeScript builder, `MerkleHelper` and `DropV2` must all produce them. If this fails, the
///      vector is not the thing to change.
contract HandleVectorTest is Test {
    address internal constant DROP = 0x5FbDB2315678afecb367f032d93F642f64180aa3;
    uint256 internal constant CHAIN_ID = 46_630;
    uint256 internal constant INDEX = 3;
    uint256 internal constant X_ID = 44_196_397;
    uint256 internal constant AMOUNT = 10 ** 15;
    address internal constant RECIPIENT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    bytes32 internal constant TAG = 0xa0b22646bbd12226d8c5181512aeffe56b1a4474b4404bc3a1dc79464d135054;
    bytes32 internal constant LEAF = 0x10c3411e3c93eaa075475a3c2e503721a7910653d7798c3469c17436b105127e;
    bytes32 internal constant DIGEST = 0x53bd9528008510e33df2d5499ec3c5ec2f2b7da1f43897582618eea3ff4edc21;

    /// @dev The tag word, in the helper and in `DropV2`.
    function test_Vector_HandleLeafTag() public {
        assertEq(MerkleHelper.HANDLE_LEAF_TAG, TAG);
        DropV2 impl = new DropV2(address(new BinderRegistry(address(this))));
        assertEq(impl.HANDLE_LEAF_TAG(), TAG);
    }

    /// @dev The handle leaf, from the test helper written from the.
    function test_Vector_HandleLeaf() public pure {
        assertEq(MerkleHelper.handleLeafOf(DROP, CHAIN_ID, INDEX, X_ID, AMOUNT), LEAF);
    }

    /// @dev `DropV2.bindingDigest` at the vector's drop address and chain. The drop code is
    ///      placed at that address with `vm.etch`: the digest reads only `address(this)` and
    ///      `block.chainid`, never storage.
    function test_Vector_BindingDigest() public {
        DropV2 impl = new DropV2(address(new BinderRegistry(address(this))));
        vm.etch(DROP, address(impl).code);
        vm.chainId(CHAIN_ID);
        assertEq(DropV2(payable(DROP)).bindingDigest(INDEX, X_ID, RECIPIENT), DIGEST);
    }
}
