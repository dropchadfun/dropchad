/**
 * The dropchad merkle generator.
 *
 * Everything here follows the design and nothing
 * else. If this code and the design disagree, the design wins. The Foundry fixture in
 * `contracts/evm/test/MerkleVector.t.sol`, the Rust fixture in
 * `contracts/solana/programs/dropchad/tests/fixture.rs` and the tests next to this folder pin
 * every side to the same numbers.
 */
export {
  LEAF_ABI_PARAMETERS,
  LEAF_ENCODED_BYTES,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  encodeLeaf,
  leafHash,
  type EvmLeafInput,
  type LeafFamily,
  type LeafInput,
  type SvmLeafInput,
} from "./leaf.js";

export { base58Decode, base58Encode, hexToPubkey, isPubkey, pubkeyToHex } from "./base58.js";

export {
  buildTree,
  processProof,
  proofFor,
  sortedHashPair,
  verifyProof,
  type MerkleTree,
} from "./tree.js";

export {
  MAX_LEAVES,
  MIN_SOL_LEAF_LAMPORTS,
  buildDropTree,
  normalizeReceivers,
  normalizeSvmReceivers,
  type BuildDropTreeArgs,
  type DropTree,
  type DropTreeEntry,
  type Receiver,
} from "./generator.js";

export {
  canonicalManifestJson,
  keccakManifestHash,
  toManifest,
  type Manifest,
  type ManifestEntry,
} from "./manifest.js";

export {
  HANDLE_LEAF_ABI_PARAMETERS,
  HANDLE_LEAF_ENCODED_BYTES,
  HANDLE_LEAF_TAG,
  MAX_X_ID,
  assertXId,
  buildHandleDropTree,
  canonicalHandleManifestJson,
  encodeHandleLeaf,
  handleLeafHash,
  keccakHandleManifestHash,
  normalizeHandleReceivers,
  toHandleManifest,
  type BuildHandleDropTreeArgs,
  type EvmHandleLeafInput,
  type HandleDropTree,
  type HandleDropTreeEntry,
  type HandleLeafInput,
  type HandleManifest,
  type HandleManifestEntry,
  type HandleReceiver,
  type SvmHandleLeafInput,
} from "./handle.js";
