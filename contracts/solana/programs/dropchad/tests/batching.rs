//! Several `claim` instructions in one transaction.

mod common;

use anchor_lang::solana_program::instruction::Instruction;
use common::*;
use dropchad::DropError;
use solana_keypair::Keypair;
use solana_signer::Signer;

const MAX_TX_BYTES: usize = 1232;

fn claims(h: &Harness, ctx: &DropCtx, caller: &solana_keypair::Keypair, indexes: &[usize]) -> Vec<Instruction> {
    indexes
        .iter()
        .map(|&i| h.claim_ix(ctx, &caller.pubkey(), i as u32, &ctx.recipient(i), ctx.amount(i), ctx.proof(i)))
        .collect()
}

#[test]
fn five_sol_claims_at_depth_3_in_one_transaction_s6_4_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(8, SOL), 1);
    h.fund_and_activate(&ctx);
    assert_eq!(ctx.tree.tree.depth(), 3);

    let relayer = h.relayer.insecure_clone();
    let ixs = claims(&h, &ctx, &relayer, &[0, 1, 2, 3, 4]);
    let size = h.tx_size(&ixs, &relayer.pubkey());
    println!("depth 3: five SOL claims {size} bytes");
    assert!(size <= MAX_TX_BYTES, "6.5 says five fit at depth 3, got {size} bytes");

    let meta = expect_ok(h.send(&ixs, &[&relayer]));
    for i in 0..5 {
        assert_eq!(h.lamports(&ctx.recipient(i)), SOL);
        assert!(h.is_claimed(&ctx, i as u32));
    }
    assert!(!h.is_claimed(&ctx, 5));
    assert_eq!(h.drop_state(&ctx).claimed_count, 5);
    println!("compute units, five SOL claims at depth 3 in one tx: {}", meta.compute_units_consumed);
}

#[test]
fn three_spl_claims_at_depth_4_in_one_transaction_s6_5() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(16, 1_000_000), 2);
    h.fund_and_activate(&ctx);
    assert_eq!(ctx.tree.tree.depth(), 4);

    let relayer = h.relayer.insecure_clone();
    let ixs = claims(&h, &ctx, &relayer, &[0, 1, 2]);
    let size = h.tx_size(&ixs, &relayer.pubkey());
    println!("depth 4: three SPL claims {size} bytes");
    assert!(size <= MAX_TX_BYTES, "6.5 says three SPL claims fit at depth 4, got {size} bytes");
    expect_ok(h.send(&ixs, &[&relayer]));
    for i in 0..3 {
        assert_eq!(h.holding(&ctx, &ctx.recipient(i)), 1_000_000);
    }
}

#[test]
fn a_transaction_with_one_already_claimed_index_writes_nothing_s6_4_2_s6_4_3() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(4, SOL), 3);
    h.fund_and_activate(&ctx);
    expect_ok(h.claim(&ctx, 1));

    let relayer = h.relayer.insecure_clone();
    let ixs = claims(&h, &ctx, &relayer, &[0, 1, 2]);
    expect_err(h.send(&ixs, &[&relayer]), DropError::AlreadyClaimed);

    assert!(!h.is_claimed(&ctx, 0), "instruction 0 was rolled back with the transaction");
    assert!(!h.is_claimed(&ctx, 2));
    assert_eq!(h.lamports(&ctx.recipient(0)), 0);
    assert_eq!(h.lamports(&ctx.recipient(2)), 0);
    assert_eq!(h.drop_state(&ctx).claimed_count, 1);

    // the relayer rebuilds without index 1 and everybody else is paid
    let ixs = claims(&h, &ctx, &relayer, &[0, 2, 3]);
    expect_ok(h.send(&ixs, &[&relayer]));
    assert_eq!(h.drop_state(&ctx).claimed_count, 4);
}

#[test]
fn a_transaction_with_one_bad_proof_writes_nothing_s6_4_3() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(3, SOL), 4);
    h.fund_and_activate(&ctx);
    let relayer = h.relayer.insecure_clone();
    let mut ixs = claims(&h, &ctx, &relayer, &[0, 1, 2]);
    ixs[2] = h.claim_ix(&ctx, &relayer.pubkey(), 2, &ctx.recipient(2), SOL + 1, ctx.proof(2));
    expect_err(h.send(&ixs, &[&relayer]), DropError::BadProof);
    assert_eq!(h.drop_state(&ctx).claimed_count, 0);
}

#[test]
fn fit_table_depth_14_one_sol_claim_fits_two_do_not_s6_5() {
    // No drop is needed to measure bytes: a 14 node proof and a pretend context.
    let h = Harness::new();
    let ctx_tmp = h.prepare(&receivers(2, SOL), None, 5, 0);
    let payer = Keypair::new().pubkey();
    let proof = vec![[0x42u8; 32]; 14];
    let one = vec![h.claim_ix(&ctx_tmp, &payer, 0, &Keypair::new().pubkey(), SOL, proof.clone())];
    let two = vec![
        h.claim_ix(&ctx_tmp, &payer, 0, &Keypair::new().pubkey(), SOL, proof.clone()),
        h.claim_ix(&ctx_tmp, &payer, 1, &Keypair::new().pubkey(), SOL, proof),
    ];
    let one_size = h.tx_size(&one, &payer);
    let two_size = h.tx_size(&two, &payer);
    println!("depth 14: one claim {one_size} bytes, two claims {two_size} bytes");
    assert!(one_size <= MAX_TX_BYTES);
    assert!(two_size > MAX_TX_BYTES);
}

#[test]
fn fit_table_depth_1_nine_sol_claims_fit_s6_5() {
    let h = Harness::new();
    let ctx_tmp = h.prepare(&receivers(2, SOL), None, 6, 0);
    let payer = Keypair::new().pubkey();
    let proof = vec![[0x42u8; 32]; 1];
    let nine: Vec<Instruction> = (0..9)
        .map(|i| h.claim_ix(&ctx_tmp, &payer, i, &Keypair::new().pubkey(), SOL, proof.clone()))
        .collect();
    let size = h.tx_size(&nine, &payer);
    println!("depth 1: nine claims {size} bytes");
    assert!(size <= MAX_TX_BYTES);
}
