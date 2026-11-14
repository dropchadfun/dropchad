//! The leaf and the proof fold, `docs/SPEC-SOLANA.md` section 7. Pure functions, no accounts.
//!
//! keccak is the `sol_keccak256` syscall on chain, S7.7. Off chain, in the tests, the same
//! function runs a plain keccak implementation, so the fixture test in `tests/fixture.rs` pins
//! these bytes on both sides.

use anchor_lang::prelude::*;
use solana_keccak_hasher::hashv;

/// S7.1. Five 32 byte words, exactly 160 bytes. Public keys fill their word, integers are
/// unsigned big endian 256 bit words, which is what `abi.encode` produces on the EVM side.
pub const FRAME_BYTES: usize = 160;

/// The 160 byte frame. Exported so the fixture can pin the bytes, not only the hash.
pub fn encode_frame(
    drop: &Pubkey,
    chain_id: u64,
    index: u32,
    recipient: &Pubkey,
    amount: u64,
) -> [u8; FRAME_BYTES] {
    let mut out = [0u8; FRAME_BYTES];
    out[0..32].copy_from_slice(drop.as_ref());
    out[56..64].copy_from_slice(&chain_id.to_be_bytes());
    out[92..96].copy_from_slice(&index.to_be_bytes());
    out[96..128].copy_from_slice(recipient.as_ref());
    out[152..160].copy_from_slice(&amount.to_be_bytes());
    out
}

/// S7.2. `keccak256(keccak256(frame))`.
pub fn leaf_hash(
    drop: &Pubkey,
    chain_id: u64,
    index: u32,
    recipient: &Pubkey,
    amount: u64,
) -> [u8; 32] {
    let frame = encode_frame(drop, chain_id, index, recipient, amount);
    let inner = hashv(&[&frame]).to_bytes();
    hashv(&[&inner]).to_bytes()
}

/// S7.8. `keccak256(a ++ b)` with the pair sorted ascending as 32 byte big endian values.
pub fn hash_pair(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    if a <= b {
        hashv(&[a, b]).to_bytes()
    } else {
        hashv(&[b, a]).to_bytes()
    }
}

/// S7.10. Start at the leaf, fold every proof node with `hash_pair`, compare with the root.
pub fn verify(root: &[u8; 32], leaf: &[u8; 32], proof: &[[u8; 32]]) -> bool {
    let mut node = *leaf;
    for sibling in proof {
        node = hash_pair(&node, sibling);
    }
    node == *root
}

// ---------------------------------------------------------------------------------------------
// Handle mode, S7.21 and S7.22
// ---------------------------------------------------------------------------------------------

/// S7.21. Six 32 byte words, 192 bytes, the tag first.
pub const HANDLE_FRAME_BYTES: usize = 192;
/// S7.22, binding v2. The binding message, six words and `valid_until`, 200 bytes, signed raw.
pub const BINDING_MESSAGE_BYTES: usize = 200;
/// S7.22. Where `valid_until` starts, after the six words.
pub const BINDING_VALID_UNTIL_AT: usize = 192;

/// `keccak256("dropchad:handle-leaf:v1")`, the same word as the EVM `HANDLE_LEAF_TAG`, R7.32.
pub fn handle_leaf_tag() -> [u8; 32] {
    hashv(&[b"dropchad:handle-leaf:v1"]).to_bytes()
}

/// `keccak256("dropchad:binding:v2")`, binding v2. Not the leaf tag, so a binding is never a
/// leaf preimage.
pub fn binding_tag() -> [u8; 32] {
    hashv(&[b"dropchad:binding:v2"]).to_bytes()
}

/// A `u64` as a big endian 256 bit word, what `abi.encode` produces on the EVM side.
fn word(v: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..32].copy_from_slice(&v.to_be_bytes());
    w
}

/// S7.21. `tag ++ drop ++ chain_id ++ index ++ x_id ++ amount`.
pub fn encode_handle_frame(
    drop: &Pubkey,
    chain_id: u64,
    index: u32,
    x_id: u64,
    amount: u64,
) -> [u8; HANDLE_FRAME_BYTES] {
    let mut out = [0u8; HANDLE_FRAME_BYTES];
    out[0..32].copy_from_slice(&handle_leaf_tag());
    out[32..64].copy_from_slice(drop.as_ref());
    out[64..96].copy_from_slice(&word(chain_id));
    out[96..128].copy_from_slice(&word(u64::from(index)));
    out[128..160].copy_from_slice(&word(x_id));
    out[160..192].copy_from_slice(&word(amount));
    out
}

/// S7.21. `keccak256(keccak256(frame))`, the same double hash as S7.2.
pub fn handle_leaf_hash(
    drop: &Pubkey,
    chain_id: u64,
    index: u32,
    x_id: u64,
    amount: u64,
) -> [u8; 32] {
    let frame = encode_handle_frame(drop, chain_id, index, x_id, amount);
    let inner = hashv(&[&frame]).to_bytes();
    hashv(&[&inner]).to_bytes()
}

/// S7.22, binding v2. `tag ++ drop ++ chain_id ++ index ++ x_id ++ recipient ++ valid_until`,
/// `valid_until` as 8 bytes, i64 big endian. Built by the program itself and compared byte for
/// byte with the message the Ed25519 instruction verified.
pub fn binding_message(
    drop: &Pubkey,
    chain_id: u64,
    index: u32,
    x_id: u64,
    recipient: &Pubkey,
    valid_until: i64,
) -> [u8; BINDING_MESSAGE_BYTES] {
    let mut out = [0u8; BINDING_MESSAGE_BYTES];
    out[0..32].copy_from_slice(&binding_tag());
    out[32..64].copy_from_slice(drop.as_ref());
    out[64..96].copy_from_slice(&word(chain_id));
    out[96..128].copy_from_slice(&word(u64::from(index)));
    out[128..160].copy_from_slice(&word(x_id));
    out[160..192].copy_from_slice(recipient.as_ref());
    out[BINDING_VALID_UNTIL_AT..BINDING_MESSAGE_BYTES].copy_from_slice(&valid_until.to_be_bytes());
    out
}
