// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title MerkleHelper
/// @notice Builds dropchad merkle trees in Solidity, with the exact rules of.
/// @dev This library is the **only** place in the test suite that knows how a tree is shaped.
///      If it ever drifts from the design, `MerkleVector.t.sol` fails on the hard coded section 7.4 vector.
///      Rules implemented here:
///      - the leaf pre-image is `abi.encode` of five words, 160 bytes. Never `abi.encodePacked`
///      - double hash. A leaf is `keccak256` of 32 bytes, an internal node of 64 bytes
///      - a parent is `keccak256(a ++ b)` with the two children sorted ascending
///      - an odd node at any level is promoted unchanged. Never paired with itself, never with zero
library MerkleHelper {
    /// @notice The first word of every handle leaf frame.
    bytes32 internal constant HANDLE_LEAF_TAG = keccak256("dropchad:handle-leaf:v1");

    /// @notice The leaf for one X id.: six words, 192 bytes, the tag first, then the
    ///         same double hash as. Written from the, not copied from `DropV2`.
    function handleLeafOf(address drop, uint256 chainId, uint256 index, uint256 xId, uint256 amount)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(HANDLE_LEAF_TAG, drop, chainId, index, xId, amount))));
    }

    /// @notice The leaf for one recipient.
    function leafOf(address drop, uint256 chainId, uint256 index, address recipient, uint256 amount)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(drop, chainId, index, recipient, amount))));
    }

    /// @notice A parent node from two children, sorted ascending.
    function pairOf(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @notice Every leaf of a drop, in index order. Index `i` is the leaf at position `i`.
    /// @dev The caller supplies recipients already deduplicated and sorted.
    function leaves(address drop, uint256 chainId, address[] memory recipients, uint256[] memory amounts)
        internal
        pure
        returns (bytes32[] memory out)
    {
        require(recipients.length == amounts.length, "MerkleHelper: length mismatch");
        out = new bytes32[](recipients.length);
        for (uint256 i = 0; i < recipients.length; i++) {
            out[i] = leafOf(drop, chainId, i, recipients[i], amounts[i]);
        }
    }

    /// @notice The root of a tree over `nodes`.
    function rootOf(bytes32[] memory nodes) internal pure returns (bytes32) {
        require(nodes.length > 0, "MerkleHelper: empty tree");
        bytes32[] memory level = nodes;
        while (level.length > 1) {
            level = nextLevel(level);
        }
        return level[0];
    }

    /// @notice The proof for `index` against the tree over `nodes`.
    /// @dev A promoted odd node contributes nothing to the proof at that level, which is the
    ///      whole point of. It is why the index 2 proof of the section 7.4 vector has length 1.
    function proofOf(bytes32[] memory nodes, uint256 index) internal pure returns (bytes32[] memory proof) {
        require(index < nodes.length, "MerkleHelper: index out of range");

        bytes32[] memory scratch = new bytes32[](256);
        uint256 len;

        bytes32[] memory level = nodes;
        uint256 i = index;

        while (level.length > 1) {
            if (i % 2 == 1) {
                scratch[len++] = level[i - 1];
            } else if (i + 1 < level.length) {
                scratch[len++] = level[i + 1];
            }
            // else: `i` is the last node of an odd level. It is promoted, it has no sibling.
            i /= 2;
            level = nextLevel(level);
        }

        proof = new bytes32[](len);
        for (uint256 j = 0; j < len; j++) {
            proof[j] = scratch[j];
        }
    }

    /// @notice One level up. Pairs are sorted, a trailing odd node is promoted unchanged.
    function nextLevel(bytes32[] memory level) internal pure returns (bytes32[] memory up) {
        uint256 n = level.length;
        uint256 m = (n + 1) / 2;
        up = new bytes32[](m);

        uint256 pairs = n / 2;
        for (uint256 i = 0; i < pairs; i++) {
            up[i] = pairOf(level[2 * i], level[2 * i + 1]);
        }
        if (n % 2 == 1) {
            up[m - 1] = level[n - 1];
        }
    }

    /// @notice Walks a proof up from a leaf, the same way `MerkleProof.processProofCalldata` does.
    /// @dev Used to assert the helper and the on chain verifier agree.
    function processProof(bytes32[] memory proof, bytes32 leaf) internal pure returns (bytes32 computed) {
        computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computed = pairOf(computed, proof[i]);
        }
    }
}
