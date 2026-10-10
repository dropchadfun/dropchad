// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {MerkleHelper} from "./MerkleHelper.sol";

/// @title MerkleVectorTest
/// @notice The worked example of, hard coded, byte for byte.
/// @dev **Nothing in this file may be recomputed from the code under test.**
///      Every expected value below is a literal copied from the design. If encoding, hashing,
///      pairing, the salt shape or the clone init code ever change, this file fails immediately
///      and tells us the change was not a refactor.
///      Every literal was independently reproduced with `cast keccak` before it was written here.
contract MerkleVectorTest is Test {
    // --- inputs ---------------------------------------------------

    uint256 internal constant CHAIN_ID = 4663;
    address internal constant FACTORY = 0x00000000000000000000000000000000000fAc70;
    address internal constant IMPLEMENTATION = 0x000000000000000000000000000000000000C10e;
    address internal constant RELAYER = 0x000000000000000000000000000000000000BE11;
    uint256 internal constant X_USER_ID = 1_234_567_890;
    uint256 internal constant NONCE = 0;

    address internal constant RECIPIENT_0 = 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa;
    address internal constant RECIPIENT_1 = 0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB;
    address internal constant RECIPIENT_2 = 0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC;

    uint256 internal constant AMOUNT_0 = 1_000_000_000_000_000_000;
    uint256 internal constant AMOUNT_1 = 2_000_000_000_000_000_000;
    uint256 internal constant AMOUNT_2 = 3_000_000_000_000_000_000;

    uint256 internal constant TOTAL_ENTITLEMENTS = 6_000_000_000_000_000_000;
    uint32 internal constant LEAF_COUNT = 3;

    // --- expected values -----------------------------

    bytes32 internal constant EXPECTED_COMMITMENT = 0x9c9c4b2787ccf315857d894a848d0d5dd248723d87fe8b14759584b4e56f67d6;
    bytes32 internal constant EXPECTED_SALT = 0x719fb97b012605f1f6361ee78dc7fed012c573d9264b76424931af8d2a176bb7;
    bytes32 internal constant EXPECTED_INIT_CODE_HASH =
        0xdb105e72fda747c16ff7591b3892d5109ccdcdf0cd7984dc02ae0df7d81d19c1;
    address internal constant EXPECTED_DROP = 0xEd1522DeCB0421e76F3d8de2384D4EE401d8Cb4a;

    bytes32 internal constant EXPECTED_LEAF_0 = 0x7e111c7ad70166fcbc9bd92d5aa8b8f6bd0fe6c99e15908d6ce402a1e92dd693;
    bytes32 internal constant EXPECTED_LEAF_1 = 0xcf727fc1e4b6087d1e2ce41dffbedb501aade8ee979bcde832db1b93b57e2df8;
    bytes32 internal constant EXPECTED_LEAF_2 = 0xe8964472f1604d2bb6de853a0b8a69430ebcde367bdbad43f7d784bdd552e985;

    bytes32 internal constant EXPECTED_INNER_0 = 0x59b55d4e90e24583dccae1796ff438af566c70edf3bbcca7322e9fdb85e0dafc;

    bytes32 internal constant EXPECTED_NODE_01 = 0x24cc9adc3827d7adea8b5974f30ba1c03313f3edaa14a01fc0a6bc3d3daa5190;
    bytes32 internal constant EXPECTED_ROOT = 0x79a36291f9964ea735e4174dcd8b57e0fbdbc710add1e839693269cfee1a82a7;

    // step 9. Same commitment, same nonce, a different `msg.sender`.
    address internal constant OTHER_SENDER = 0x000000000000000000000000000000000000dEaD;
    bytes32 internal constant EXPECTED_SALT_OTHER = 0xc17ed891234b383d284981e06ca95643e3f82254eb1287ebbeb0754470a68cce;
    address internal constant EXPECTED_DROP_OTHER = 0x2Bf904C023e111DFc8ff1c17C0b98292f1eB7FAD;

    // -----------------------------------------------------------------------
    // step 1. commitment and salt
    // -----------------------------------------------------------------------

    function test_Vector_CreatorCommitment() public pure {
        bytes32 commitment = keccak256(abi.encode(X_USER_ID, NONCE));
        assertEq(commitment, EXPECTED_COMMITMENT, "creatorCommitment drifted from");
    }

    /// @dev  The salt binds chainId, factory, msg.sender, commitment, nonce.
    function test_Vector_Salt() public pure {
        bytes32 salt = keccak256(abi.encode(CHAIN_ID, FACTORY, RELAYER, EXPECTED_COMMITMENT, NONCE));
        assertEq(salt, EXPECTED_SALT, "salt drifted from");
    }

    // -----------------------------------------------------------------------
    // step 2. the clone address
    // -----------------------------------------------------------------------

    /// @dev The EIP 1167 init code with the implementation spliced in the middle.
    function test_Vector_CloneInitCodeHash() public pure {
        bytes memory initCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
        assertEq(initCode.length, 55, "EIP 1167 init code must be 55 bytes");
        assertEq(keccak256(initCode), EXPECTED_INIT_CODE_HASH, "clone init code hash drifted from");
    }

    /// @dev This is also the check that OpenZeppelin `Clones` still produces
    ///      the minimal proxy shape the design assumed.
    function test_Vector_DropAddress() public pure {
        address drop = Clones.predictDeterministicAddress(IMPLEMENTATION, EXPECTED_SALT, FACTORY);
        assertEq(drop, EXPECTED_DROP, "predicted drop address drifted from");
    }

    // -----------------------------------------------------------------------
    // steps 4 and 5. the leaves
    // -----------------------------------------------------------------------

    /// @dev The 160 byte pre-image and the inner hash, spelled out.
    function test_Vector_Leaf0_ByteForByte() public pure {
        bytes memory encoded = abi.encode(EXPECTED_DROP, CHAIN_ID, uint256(0), RECIPIENT_0, AMOUNT_0);

        // Five 32 byte words. `abi.encodePacked` would be 92 bytes and is forbidden.
        assertEq(encoded.length, 160, "leaf pre-image must be 160 bytes");

        bytes32 inner = keccak256(encoded);
        assertEq(inner, EXPECTED_INNER_0, "leaf inner hash drifted from");

        // The double hash.
        assertEq(keccak256(bytes.concat(inner)), EXPECTED_LEAF_0, "leaf0 drifted from");
    }

    /// @dev All three leaves, through the helper the whole suite uses.
    function test_Vector_AllThreeLeaves() public pure {
        assertEq(
            MerkleHelper.leafOf(EXPECTED_DROP, CHAIN_ID, 0, RECIPIENT_0, AMOUNT_0), EXPECTED_LEAF_0, "leaf0 drifted"
        );
        assertEq(
            MerkleHelper.leafOf(EXPECTED_DROP, CHAIN_ID, 1, RECIPIENT_1, AMOUNT_1), EXPECTED_LEAF_1, "leaf1 drifted"
        );
        assertEq(
            MerkleHelper.leafOf(EXPECTED_DROP, CHAIN_ID, 2, RECIPIENT_2, AMOUNT_2), EXPECTED_LEAF_2, "leaf2 drifted"
        );
    }

    // -----------------------------------------------------------------------
    // step 6. the tree
    // -----------------------------------------------------------------------

    /// @dev Three leaves: leaf0 pairs with leaf1, leaf2 is promoted.
    function test_Vector_TreeAndRoot() public pure {
        bytes32[] memory nodes = _specLeaves();

        assertEq(MerkleHelper.pairOf(EXPECTED_LEAF_0, EXPECTED_LEAF_1), EXPECTED_NODE_01, "node01 drifted");

        bytes32[] memory level1 = MerkleHelper.nextLevel(nodes);
        assertEq(level1.length, 2, "level 1 must hold node01 and the promoted leaf2");
        assertEq(level1[0], EXPECTED_NODE_01, "level1[0] must be node01");
        assertEq(level1[1], EXPECTED_LEAF_2, "the odd node is promoted unchanged, not paired with itself");

        assertEq(MerkleHelper.rootOf(nodes), EXPECTED_ROOT, "root drifted from");
    }

    /// @dev the design is commutative hashing, so the order the two children are passed in cannot matter.
    function test_Vector_PairingIsCommutative() public pure {
        assertEq(
            MerkleHelper.pairOf(EXPECTED_LEAF_1, EXPECTED_LEAF_0),
            MerkleHelper.pairOf(EXPECTED_LEAF_0, EXPECTED_LEAF_1),
            "pairing must sort its two children"
        );
    }

    // -----------------------------------------------------------------------
    // steps 7 and 8. proofs
    // -----------------------------------------------------------------------

    /// @dev The three proofs, exactly as written in the design.
    function test_Vector_Proofs() public pure {
        bytes32[] memory nodes = _specLeaves();

        bytes32[] memory p0 = MerkleHelper.proofOf(nodes, 0);
        assertEq(p0.length, 2, "proof 0 length");
        assertEq(p0[0], EXPECTED_LEAF_1, "proof 0 step 0");
        assertEq(p0[1], EXPECTED_LEAF_2, "proof 0 step 1");

        bytes32[] memory p1 = MerkleHelper.proofOf(nodes, 1);
        assertEq(p1.length, 2, "proof 1 length");
        assertEq(p1[0], EXPECTED_LEAF_0, "proof 1 step 0");
        assertEq(p1[1], EXPECTED_LEAF_2, "proof 1 step 1");

        // leaf2 was promoted, so its proof is one node, not two.
        bytes32[] memory p2 = MerkleHelper.proofOf(nodes, 2);
        assertEq(p2.length, 1, "proof 2 length. a promoted node has no sibling at its own level");
        assertEq(p2[0], EXPECTED_NODE_01, "proof 2 step 0");
    }

    /// @dev walked one step at a time.
    function test_Vector_VerifyIndex1_StepByStep() public pure {
        bytes32 step1 = MerkleHelper.pairOf(EXPECTED_LEAF_1, EXPECTED_LEAF_0);
        assertEq(step1, EXPECTED_NODE_01, "step 1 of step 8");

        bytes32 step2 = MerkleHelper.pairOf(step1, EXPECTED_LEAF_2);
        assertEq(step2, EXPECTED_ROOT, "step 2 of step 8");
    }

    /// @dev The on chain verifier must accept the same proofs the helper builds.
    function test_Vector_OpenZeppelinVerifierAgrees() public pure {
        bytes32[] memory nodes = _specLeaves();

        for (uint256 i = 0; i < 3; i++) {
            bytes32[] memory proof = MerkleHelper.proofOf(nodes, i);
            assertTrue(
                MerkleProof.verify(proof, EXPECTED_ROOT, nodes[i]), "OpenZeppelin MerkleProof rejected a valid proof"
            );
        }
    }

    /// @dev A leaf is a hash of 32 bytes, an internal node a hash of 64 bytes, so an
    ///      internal node can never be passed off as a leaf.
    function test_Vector_InternalNodeIsNotAValidLeaf() public pure {
        bytes32[] memory nodes = _specLeaves();
        bytes32[] memory emptyProof = new bytes32[](1);
        emptyProof[0] = EXPECTED_LEAF_2;

        assertFalse(
            MerkleProof.verify(emptyProof, EXPECTED_ROOT, EXPECTED_INNER_0),
            "an inner pre-image must never verify as a leaf"
        );
        nodes; // silence the unused warning without changing the shape of the test
    }

    // -----------------------------------------------------------------------
    // step 9. the salt really does bind the caller
    // -----------------------------------------------------------------------

    /// @dev Same commitment, same nonce, different sender.
    ///      Two different salts, two different addresses. Our predicted address cannot be occupied.
    function test_Vector_SaltBindsTheCaller() public pure {
        bytes32 saltOther = keccak256(abi.encode(CHAIN_ID, FACTORY, OTHER_SENDER, EXPECTED_COMMITMENT, NONCE));
        assertEq(saltOther, EXPECTED_SALT_OTHER, "the other salt drifted from step 9");
        assertTrue(saltOther != EXPECTED_SALT, "a different sender must give a different salt");

        address dropOther = Clones.predictDeterministicAddress(IMPLEMENTATION, saltOther, FACTORY);
        assertEq(dropOther, EXPECTED_DROP_OTHER, "the other drop address drifted from step 9");
        assertTrue(dropOther != EXPECTED_DROP, "a different sender must give a different drop address");
    }

    // -----------------------------------------------------------------------
    // the numbers around the tree
    // -----------------------------------------------------------------------

    /// @dev The leaf amounts sum to `totalEntitlements`, and `leafCount` matches.
    function test_Vector_TotalsMatchTheTree() public pure {
        assertEq(AMOUNT_0 + AMOUNT_1 + AMOUNT_2, TOTAL_ENTITLEMENTS, "sum of leaf amounts must equal totalEntitlements");
        assertEq(_specLeaves().length, LEAF_COUNT, "leafCount must equal the number of leaves");
    }

    /// @dev The drop address and the chain id are both inside the leaf, so a proof
    ///      cannot be replayed on another drop or on another chain.
    function test_Vector_LeafBindsDropAndChain() public pure {
        bytes32 here = MerkleHelper.leafOf(EXPECTED_DROP, CHAIN_ID, 0, RECIPIENT_0, AMOUNT_0);

        bytes32 otherDrop = MerkleHelper.leafOf(EXPECTED_DROP_OTHER, CHAIN_ID, 0, RECIPIENT_0, AMOUNT_0);
        assertTrue(here != otherDrop, "the drop address must change the leaf");

        bytes32 otherChain = MerkleHelper.leafOf(EXPECTED_DROP, 56, 0, RECIPIENT_0, AMOUNT_0);
        assertTrue(here != otherChain, "the chain id must change the leaf");

        bytes32 otherIndex = MerkleHelper.leafOf(EXPECTED_DROP, CHAIN_ID, 1, RECIPIENT_0, AMOUNT_0);
        assertTrue(here != otherIndex, "the index must change the leaf");
    }

    // -----------------------------------------------------------------------

    function _specLeaves() internal pure returns (bytes32[] memory nodes) {
        nodes = new bytes32[](3);
        nodes[0] = EXPECTED_LEAF_0;
        nodes[1] = EXPECTED_LEAF_1;
        nodes[2] = EXPECTED_LEAF_2;
    }
}
