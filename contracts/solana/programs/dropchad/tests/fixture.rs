//! The worked example, hard coded.
//! Any change to the frame, the hashing, the pairing or the seeds breaks a test here. The same
//! numbers are pinned in `packages/shared` on the TypeScript side.

mod common;

use anchor_lang::prelude::Pubkey;
use common::tree;
use common::{bitmap_pda, config_pda, drop_pda};
use dropchad::merkle;

fn hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn hex32(s: &str) -> [u8; 32] {
    hex(s).try_into().unwrap()
}

const CHAIN_ID: u64 = 103;
const COMMITMENT: &str = "9c9c4b2787ccf315857d894a848d0d5dd248723d87fe8b14759584b4e56f67d6";
const DROP: &str = "G5wphfR2mffv3dd2yWb5eFioBf1BFGVtAZfbG6CXQbh5";
const DROP_HEX: &str = "e0239d742435ee47a148204da3a775f25ae860ad47e10e68bd8b8a1ceeb769f4";
const BITMAP: &str = "GXTteQJdJkJmQPenaKHEt1WZTttZS2ZwyEWUhGbZ9w98";
const CONFIG: &str = "bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD";

const LEAF0_FRAME: &str = "e0239d742435ee47a148204da3a775f25ae860ad47e10e68bd8b8a1ceeb769f4\
0000000000000000000000000000000000000000000000000000000000000067\
0000000000000000000000000000000000000000000000000000000000000000\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
000000000000000000000000000000000000000000000000000000003b9aca00";
const LEAF0_INNER: &str = "a963d93e54ccf3fe75bf3178baf98bd3786c7480a223e40e64d0f63f45002232";
const LEAF0: &str = "ab4deca79371f377ac4bf9999a071a50364894a81127480a3a02bbe80b8f9624";
const LEAF1: &str = "08ef04e850b1ceef45a3036d9aef89a1baeb98afdb1def697624ce821face04e";
const LEAF2: &str = "2b1baecfb6d086c3e821a1a41643cf7a99892baf7c533547d41879698b639ec8";
const NODE01: &str = "dc19519425da901d003d8666f1b1fe5b2300c023377ca9218b0586c12ba848ce";
const ROOT: &str = "c5154a707e5ff37be7e1eb3a22a0d87a9d28c59f88a4df3d96d7c94672b0e889";

fn recipients() -> [(Pubkey, u64); 3] {
    [
        (Pubkey::new_from_array([0xaa; 32]), 1_000_000_000),
        (Pubkey::new_from_array([0xbb; 32]), 2_000_000_000),
        (Pubkey::new_from_array([0xcc; 32]), 3_000_000_000),
    ]
}

fn drop_key() -> Pubkey {
    Pubkey::new_from_array(hex32(DROP_HEX))
}

// -- step 2, the PDAs -------------------------------------------------------------------------

#[test]
fn fixture_drop_pda_matches_spec() {
    let (drop, bump) = drop_pda(&hex32(COMMITMENT), 0);
    assert_eq!(drop.to_string(), DROP);
    assert_eq!(drop.to_bytes(), hex32(DROP_HEX));
    assert_eq!(bump, 255);
}

#[test]
fn fixture_bitmap_pda_matches_spec() {
    let (bitmap, bump) = bitmap_pda(&drop_key());
    assert_eq!(bitmap.to_string(), BITMAP);
    assert_eq!(bump, 255);
}

#[test]
fn fixture_config_pda_matches_spec() {
    let (config, bump) = config_pda();
    assert_eq!(config.to_string(), CONFIG);
    assert_eq!(bump, 255);
}

#[test]
fn fixture_recipient_base58_matches_spec() {
    let r = recipients();
    assert_eq!(r[0].0.to_string(), "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB");
    assert_eq!(r[1].0.to_string(), "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC");
    assert_eq!(r[2].0.to_string(), "EnTJCS15dqbDTU2XywYSMaScoPv4Py4GzExrtY9DQxoD");
}

// -- step 4, the frame, byte for byte, on both the test builder and the program ---------------

#[test]
fn fixture_leaf0_frame_test_builder() {
    let r = recipients();
    let frame = tree::frame(&drop_key(), CHAIN_ID, 0, &r[0].0, r[0].1);
    assert_eq!(frame.len(), 160);
    assert_eq!(frame.to_vec(), hex(LEAF0_FRAME));
}

#[test]
fn fixture_leaf0_frame_program() {
    let r = recipients();
    let frame = merkle::encode_frame(&drop_key(), CHAIN_ID, 0, &r[0].0, r[0].1);
    assert_eq!(frame.len(), merkle::FRAME_BYTES);
    assert_eq!(frame.to_vec(), hex(LEAF0_FRAME));
}

#[test]
fn fixture_leaf0_inner_hash() {
    assert_eq!(tree::keccak(&[&hex(LEAF0_FRAME)]), hex32(LEAF0_INNER));
}

// -- step 5, the leaves -----------------------------------------------------------------------

#[test]
fn fixture_leaves_test_builder() {
    let r = recipients();
    let d = drop_key();
    assert_eq!(tree::leaf(&d, CHAIN_ID, 0, &r[0].0, r[0].1), hex32(LEAF0));
    assert_eq!(tree::leaf(&d, CHAIN_ID, 1, &r[1].0, r[1].1), hex32(LEAF1));
    assert_eq!(tree::leaf(&d, CHAIN_ID, 2, &r[2].0, r[2].1), hex32(LEAF2));
}

#[test]
fn fixture_leaves_program() {
    let r = recipients();
    let d = drop_key();
    assert_eq!(merkle::leaf_hash(&d, CHAIN_ID, 0, &r[0].0, r[0].1), hex32(LEAF0));
    assert_eq!(merkle::leaf_hash(&d, CHAIN_ID, 1, &r[1].0, r[1].1), hex32(LEAF1));
    assert_eq!(merkle::leaf_hash(&d, CHAIN_ID, 2, &r[2].0, r[2].1), hex32(LEAF2));
}

// -- step 6, the tree -------------------------------------------------------------------------

#[test]
fn fixture_node01_and_root_test_builder() {
    assert_eq!(tree::pair(&hex32(LEAF0), &hex32(LEAF1)), hex32(NODE01));
    assert_eq!(tree::pair(&hex32(NODE01), &hex32(LEAF2)), hex32(ROOT));
}

#[test]
fn fixture_node01_and_root_program() {
    assert_eq!(merkle::hash_pair(&hex32(LEAF0), &hex32(LEAF1)), hex32(NODE01));
    // commutative
    assert_eq!(merkle::hash_pair(&hex32(LEAF1), &hex32(LEAF0)), hex32(NODE01));
    assert_eq!(merkle::hash_pair(&hex32(NODE01), &hex32(LEAF2)), hex32(ROOT));
}

#[test]
fn fixture_drop_tree_reproduces_root_and_sort_order() {
    // sorted by raw bytes. Give them shuffled, expect aa, bb, cc.
    let r = recipients();
    let shuffled = [r[2], r[0], r[1]];
    let t = tree::DropTree::build(drop_key(), CHAIN_ID, &shuffled);
    assert_eq!(t.receivers[0].key, r[0].0);
    assert_eq!(t.receivers[2].key, r[2].0);
    assert_eq!(t.total, 6_000_000_000);
    assert_eq!(t.leaf_count(), 3);
    assert_eq!(t.root(), hex32(ROOT));
}

// -- step 7, the proofs -----------------------------------------------------------------------

#[test]
fn fixture_proofs_match_spec() {
    let t = tree::DropTree::build(drop_key(), CHAIN_ID, &recipients());
    assert_eq!(t.proof(0), vec![hex32(LEAF1), hex32(LEAF2)]);
    assert_eq!(t.proof(1), vec![hex32(LEAF0), hex32(LEAF2)]);
    assert_eq!(t.proof(2), vec![hex32(NODE01)]);
}

// -- step 8, verifying index 1 ----------------------------------------------------------------

#[test]
fn fixture_verify_index1_program() {
    let proof = [hex32(LEAF0), hex32(LEAF2)];
    assert!(merkle::verify(&hex32(ROOT), &hex32(LEAF1), &proof));
    // and a wrong leaf, a wrong root, a truncated proof all fail
    assert!(!merkle::verify(&hex32(ROOT), &hex32(LEAF0), &proof));
    assert!(!merkle::verify(&hex32(NODE01), &hex32(LEAF1), &proof));
    assert!(!merkle::verify(&hex32(ROOT), &hex32(LEAF1), &proof[..1]));
}

#[test]
fn fixture_verify_index2_promoted_node_program() {
    // leaf2 was promoted, its proof is one node.
    assert!(merkle::verify(&hex32(ROOT), &hex32(LEAF2), &[hex32(NODE01)]));
}

#[test]
fn fixture_single_leaf_is_its_own_root() {
    assert!(merkle::verify(&hex32(LEAF0), &hex32(LEAF0), &[]));
    let t = tree::Tree::build(vec![hex32(LEAF0)]);
    assert_eq!(t.root(), hex32(LEAF0));
    assert!(t.proof(0).is_empty());
}

// -- handle mode vectors -------------------------------------------------------
// The same numbers as `packages/shared/test/handle.test.ts`, computed from the formulas with
// plain viem primitives. The program's `merkle.rs` must produce them.

const H_DROP: &str = "9ArT5gUTfmD81oKeNL66RhcWrK9nuaoxuJV2wH7QT9Ra";
const H_RECIPIENT: &str = "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP";
const H_INDEX: u32 = 3;
const H_X_ID: u64 = 44_196_397;
const H_AMOUNT: u64 = 1_000_000_000;
const HANDLE_LEAF_TAG: &str = "a0b22646bbd12226d8c5181512aeffe56b1a4474b4404bc3a1dc79464d135054";
const BINDING_TAG: &str = "8f3062fe58d32ec73693d0ade6d3544cdfd1ffbbb0abb7661d351fcd5260b923";
const H_LEAF: &str = "15dc56d9819f08879f1f9831cea3108df5788c328ccab56b392fcf5f98d824e3";
const H_BINDING_KECCAK: &str = "08e0ae0376d4df8690797bb38076fde2cfdab166d4a36f83115b65233e233819";

#[test]
fn fixture_handle_tags_s7_21_s7_22() {
    assert_eq!(merkle::handle_leaf_tag(), hex32(HANDLE_LEAF_TAG), "the same word as the EVM HANDLE_LEAF_TAG");
    assert_eq!(merkle::binding_tag(), hex32(BINDING_TAG));
}

#[test]
fn fixture_handle_leaf_s7_21() {
    let drop: Pubkey = H_DROP.parse().unwrap();
    let frame = merkle::encode_handle_frame(&drop, CHAIN_ID, H_INDEX, H_X_ID, H_AMOUNT);
    assert_eq!(frame.len(), 192);
    assert_eq!(&frame[0..32], &hex32(HANDLE_LEAF_TAG)[..]);
    assert_eq!(merkle::handle_leaf_hash(&drop, CHAIN_ID, H_INDEX, H_X_ID, H_AMOUNT), hex32(H_LEAF));
}

#[test]
fn fixture_binding_message_s7_22() {
    let drop: Pubkey = H_DROP.parse().unwrap();
    let recipient: Pubkey = H_RECIPIENT.parse().unwrap();
    let msg = merkle::binding_message(&drop, CHAIN_ID, H_INDEX, H_X_ID, &recipient);
    assert_eq!(msg.len(), 192);
    assert_eq!(&msg[0..32], &hex32(BINDING_TAG)[..]);
    assert_eq!(tree::keccak(&[&msg]), hex32(H_BINDING_KECCAK));
}
