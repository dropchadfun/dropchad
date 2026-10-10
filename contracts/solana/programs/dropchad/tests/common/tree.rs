//! An independent tree builder for the tests.
//! Deliberately not the program's `merkle` module: the tests must not verify the program with the
//! program. keccak comes from the `sha3` crate here and from the syscall there, and the fixture in
//! `tests/fixture.rs` pins both to the design's numbers.

use anchor_lang::prelude::Pubkey;
use sha3::{Digest, Keccak256};

pub fn keccak(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Keccak256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

/// Five 32 byte words.
pub fn frame(drop: &Pubkey, chain_id: u64, index: u32, recipient: &Pubkey, amount: u64) -> [u8; 160] {
    let mut out = [0u8; 160];
    out[0..32].copy_from_slice(drop.as_ref());
    out[56..64].copy_from_slice(&chain_id.to_be_bytes());
    out[92..96].copy_from_slice(&index.to_be_bytes());
    out[96..128].copy_from_slice(recipient.as_ref());
    out[152..160].copy_from_slice(&amount.to_be_bytes());
    out
}

/// Double keccak.
pub fn leaf(drop: &Pubkey, chain_id: u64, index: u32, recipient: &Pubkey, amount: u64) -> [u8; 32] {
    let inner = keccak(&[&frame(drop, chain_id, index, recipient, amount)]);
    keccak(&[&inner])
}

/// Sorted pair.
pub fn pair(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    if a <= b {
        keccak(&[a, b])
    } else {
        keccak(&[b, a])
    }
}

/// Bottom layer first, last layer is `[root]`.: an odd node is promoted unchanged.
pub struct Tree {
    pub layers: Vec<Vec<[u8; 32]>>,
}

impl Tree {
    pub fn build(leaves: Vec<[u8; 32]>) -> Tree {
        assert!(!leaves.is_empty(), "a tree needs at least one leaf");
        let mut layers = vec![leaves];
        loop {
            let current = layers.last().unwrap();
            if current.len() <= 1 {
                break;
            }
            let mut next = Vec::with_capacity(current.len().div_ceil(2));
            for chunk in current.chunks(2) {
                next.push(if chunk.len() == 2 { pair(&chunk[0], &chunk[1]) } else { chunk[0] });
            }
            layers.push(next);
        }
        Tree { layers }
    }

    pub fn root(&self) -> [u8; 32] {
        self.layers.last().unwrap()[0]
    }

    /// The sibling at every level, bottom up. A promoted node pushes nothing.
    pub fn proof(&self, index: usize) -> Vec<[u8; 32]> {
        let mut proof = Vec::new();
        let mut pos = index;
        for level in 0..self.layers.len() - 1 {
            let layer = &self.layers[level];
            let sibling = if pos % 2 == 0 { pos + 1 } else { pos - 1 };
            if let Some(node) = layer.get(sibling) {
                proof.push(*node);
            }
            pos /= 2;
        }
        proof
    }

    pub fn depth(&self) -> usize {
        self.layers.len() - 1
    }
}

#[derive(Clone, Debug)]
pub struct Receiver {
    pub key: Pubkey,
    pub amount: u64,
}

/// A whole drop tree: sorted receivers, root, proofs. 7.3.
pub struct DropTree {
    pub drop: Pubkey,
    pub chain_id: u64,
    pub receivers: Vec<Receiver>,
    pub leaves: Vec<[u8; 32]>,
    pub tree: Tree,
    pub total: u64,
}

impl DropTree {
    /// dedupe by raw bytes sort by raw bytes drop zeros sum.
    pub fn build(drop: Pubkey, chain_id: u64, receivers: &[(Pubkey, u64)]) -> DropTree {
        let mut merged: std::collections::BTreeMap<[u8; 32], u64> = Default::default();
        for (key, amount) in receivers {
            *merged.entry(key.to_bytes()).or_insert(0) += amount;
        }
        let receivers: Vec<Receiver> = merged
            .into_iter()
            .filter(|(_, amount)| *amount > 0)
            .map(|(bytes, amount)| Receiver { key: Pubkey::new_from_array(bytes), amount })
            .collect();
        let leaves: Vec<[u8; 32]> = receivers
            .iter()
            .enumerate()
            .map(|(i, r)| leaf(&drop, chain_id, i as u32, &r.key, r.amount))
            .collect();
        let total = receivers.iter().map(|r| r.amount).sum();
        let tree = Tree::build(leaves.clone());
        DropTree { drop, chain_id, receivers, leaves, tree, total }
    }

    pub fn root(&self) -> [u8; 32] {
        self.tree.root()
    }

    pub fn proof(&self, index: usize) -> Vec<[u8; 32]> {
        self.tree.proof(index)
    }

    pub fn leaf_count(&self) -> u32 {
        self.receivers.len() as u32
    }
}

/// The off chain fold, for the fixture and the property tests.
pub fn verify(root: &[u8; 32], leaf: &[u8; 32], proof: &[[u8; 32]]) -> bool {
    let mut node = *leaf;
    for p in proof {
        node = pair(&node, p);
    }
    node == *root
}
