//! `claim` and the leaf rules of section 7.

mod common;

use common::spl::*;
use common::tree::DropTree;
use common::*;
use dropchad::events::Claimed;
use dropchad::state::DropStatus;
use dropchad::{DropError, MAX_PROOF_LEN};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn active_sol(h: &mut Harness, n: usize, tag: u8) -> DropCtx {
    let ctx = h.new_sol_drop(&receivers(n, SOL), tag);
    h.fund_and_activate(&ctx);
    ctx
}

fn active_spl(h: &mut Harness, n: usize, tag: u8) -> DropCtx {
    let ctx = h.new_spl_drop(&receivers(n, 1_000_000), tag);
    h.fund_and_activate(&ctx);
    ctx
}

// -- happy paths -------------------------------------------------------------------------------

#[test]
fn claim_pays_the_leaf_recipient_sol() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 3, 1);
    let recipient = ctx.recipient(1);
    assert_eq!(h.lamports(&recipient), 0);

    let meta = expect_ok(h.claim(&ctx, 1));
    assert_eq!(h.lamports(&recipient), SOL);
    assert!(h.is_claimed(&ctx, 1));
    assert!(!h.is_claimed(&ctx, 0));
    assert!(!h.is_claimed(&ctx, 2));
    let d = h.drop_state(&ctx);
    assert_eq!(d.total_claimed, SOL);
    assert_eq!(d.claimed_count, 1);
    assert_eq!(h.spendable(&ctx), 2 * SOL, "I3");

    let ev: Claimed = find_event(&meta.logs).expect("Claimed");
    assert_eq!((ev.drop, ev.index, ev.recipient, ev.amount), (ctx.drop, 1, recipient, SOL));
    println!("compute units, one SOL claim at depth {}: {}", ctx.tree.tree.depth(), meta.compute_units_consumed);
}

#[test]
fn claim_pays_the_leaf_recipient_spl_and_creates_its_token_account() {
    let mut h = Harness::new();
    let ctx = active_spl(&mut h, 3, 1);
    let recipient = ctx.recipient(0);
    let ata = ata_address(&recipient, &ctx.mint.unwrap(), &TOKEN_PROGRAM);
    assert!(!h.exists(&ata));

    let relayer_before = h.lamports(&h.relayer.pubkey());
    let drop_before = h.lamports(&ctx.drop);
    let meta = expect_ok(h.claim(&ctx, 0));
    assert_eq!(h.token_balance(&ata), 1_000_000);
    assert_eq!(h.token_balance(&ctx.vault.unwrap()), 2_000_000);
    let paid = relayer_before - h.lamports(&h.relayer.pubkey());
    assert!(paid < 100_000, "the drop paid the rent back, the relayer paid only the fee");
    assert_eq!(drop_before - h.lamports(&ctx.drop), h.rent_for(TOKEN_ACCOUNT_LEN), "from the budget");
    println!("compute units, one SPL claim with a fresh token account: {}", meta.compute_units_consumed);
}

#[test]
fn claim_to_an_existing_token_account_creates_nothing() {
    let mut h = Harness::new();
    let ctx = active_spl(&mut h, 2, 2);
    let recipient = ctx.recipient(0);
    let ata = h.create_ata(&recipient, &ctx.mint.unwrap(), &TOKEN_PROGRAM);
    let relayer_before = h.lamports(&h.relayer.pubkey());
    expect_ok(h.claim(&ctx, 0));
    assert_eq!(h.token_balance(&ata), 1_000_000);
    assert!(relayer_before - h.lamports(&h.relayer.pubkey()) < 100_000, "only the fee");
}

#[test]
fn caller_is_not_the_recipient_and_the_recipient_is_still_paid_i15() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 3);
    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let stranger_before = h.lamports(&stranger.pubkey());
    let ix = h.claim_ix(&ctx, &stranger.pubkey(), 0, &ctx.recipient(0), ctx.amount(0), ctx.proof(0));
    expect_ok(h.send(&[ix], &[&stranger]));
    assert_eq!(h.lamports(&ctx.recipient(0)), SOL);
    assert!(h.lamports(&stranger.pubkey()) < stranger_before, "the caller only paid the fee");
}

#[test]
fn every_leaf_claimed_empties_the_entitlements_i1_i14() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 5, 4);
    for i in [4, 0, 2, 1, 3] {
        expect_ok(h.claim(&ctx, i));
    }
    let d = h.drop_state(&ctx);
    assert_eq!(d.total_claimed, 5 * SOL);
    assert_eq!(d.claimed_count, 5);
    assert_eq!(h.claimed_bits(&ctx), 5);
    assert_eq!(h.spendable(&ctx), 0);
}

#[test]
fn claim_to_a_program_owned_account_works_s6_3_10() {
    // The recipient is any account. Here: the config PDA, owned by our program.
    let mut h = Harness::new();
    let config = h.config;
    let ctx = h.new_sol_drop(&[(config, SOL), (Keypair::new().pubkey(), SOL)], 5);
    h.fund_and_activate(&ctx);
    let index = ctx.tree.receivers.iter().position(|r| r.key == config).unwrap();
    let before = h.lamports(&config);
    expect_ok(h.claim(&ctx, index));
    assert_eq!(h.lamports(&config) - before, SOL);
}

// -- failures, in the order of 6.3 ------------------------------------------------------------

#[test]
fn claim_before_activation_fails_s6_3_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 10);
    expect_ok(h.fund(&ctx, 2 * SOL));
    expect_err(h.claim(&ctx, 0), DropError::WrongStatus);
}

#[test]
fn claim_after_refund_fails_s6_3_1() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 11);
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&ctx));
    expect_err(h.claim(&ctx, 0), DropError::WrongStatus);
}

#[test]
fn claim_after_claim_deadline_fails_s6_3_2() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 12);
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    expect_err(h.claim(&ctx, 0), DropError::ClaimWindowClosed);
}

#[test]
fn claim_index_at_leaf_count_fails_s6_3_3() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 13);
    let relayer = h.relayer.insecure_clone();
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 2, &ctx.recipient(0), SOL, ctx.proof(0));
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadIndex);
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 9_999, &ctx.recipient(0), SOL, ctx.proof(0));
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadIndex);
}

#[test]
fn double_claim_fails_s6_3_4() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 14);
    expect_ok(h.claim(&ctx, 0));
    expect_err(h.claim(&ctx, 0), DropError::AlreadyClaimed);
    assert_eq!(h.lamports(&ctx.recipient(0)), SOL, "paid once");
    assert_eq!(h.drop_state(&ctx).claimed_count, 1);
}

#[test]
fn bad_proof_fails_s6_3_5() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 3, 15);
    let relayer = h.relayer.insecure_clone();
    let mut proof = ctx.proof(0);
    proof[0][0] ^= 1;
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), SOL, proof);
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadProof);
    assert!(!h.is_claimed(&ctx, 0));
}

#[test]
fn empty_proof_on_a_multi_leaf_tree_fails_s6_3_5() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 3, 16);
    let relayer = h.relayer.insecure_clone();
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), SOL, vec![]);
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadProof);
}

#[test]
fn wrong_amount_fails_s6_3_5() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 17);
    let relayer = h.relayer.insecure_clone();
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), SOL + 1, ctx.proof(0));
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadProof);
}

#[test]
fn wrong_recipient_fails_s6_3_5() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 18);
    let relayer = h.relayer.insecure_clone();
    let thief = relayer.pubkey();
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &thief, SOL, ctx.proof(0));
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadProof);
}

#[test]
fn wrong_index_for_the_leaf_fails_s6_3_5() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 3, 19);
    let relayer = h.relayer.insecure_clone();
    // leaf 0's recipient and proof, claimed as index 1
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 1, &ctx.recipient(0), SOL, ctx.proof(0));
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadProof);
}

#[test]
fn proof_from_another_drop_fails_s7_3() {
    let mut h = Harness::new();
    let shared = receivers(2, SOL);
    let a = h.new_sol_drop(&shared, 20);
    let b = h.new_sol_drop(&shared, 21);
    h.fund_and_activate(&a);
    h.fund_and_activate(&b);
    let relayer = h.relayer.insecure_clone();
    // same recipient set, same index, same amount: a's proof on b
    let ix = h.claim_ix(&b, &relayer.pubkey(), 0, &a.recipient(0), SOL, a.proof(0));
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadProof);
}

#[test]
fn proof_built_with_the_other_chain_id_fails_s7_4() {
    let mut h = Harness::new();
    let recv = receivers(2, SOL);
    let ctx = h.new_sol_drop(&recv, 22);
    h.fund_and_activate(&ctx);
    // a tree for the same drop address on mainnet, chain id 101
    let mainnet = DropTree::build(ctx.drop, dropchad::SOLANA_MAINNET_CHAIN_ID, &recv);
    assert_ne!(mainnet.root(), ctx.tree.root());
    let relayer = h.relayer.insecure_clone();
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &mainnet.receivers[0].key, SOL, mainnet.proof(0));
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadProof);
}

#[test]
fn proof_longer_than_max_fails_s6_3_7() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 23);
    let relayer = h.relayer.insecure_clone();
    let mut proof = ctx.proof(0);
    while proof.len() <= MAX_PROOF_LEN {
        proof.push([7; 32]);
    }
    let ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), SOL, proof);
    expect_err(h.send(&[ix], &[&relayer]), DropError::BadProof);
}

#[test]
fn over_entitlement_is_unreachable_with_a_correct_tree_s6_3_6() {
    // Defence in depth: with a correct tree every claim fits. Claim everything, then the sum
    // equals the total exactly and nothing more can be claimed.
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 4, 24);
    for i in 0..4 {
        expect_ok(h.claim(&ctx, i));
    }
    assert_eq!(h.drop_state(&ctx).total_claimed, h.drop_state(&ctx).total_entitlements);
}

#[test]
fn over_entitlement_check_bites_when_the_total_is_wrong_s6_3_6() {
    // A drop whose declared total is smaller than the leaves. Only the relayer can do this,
    // and if it does, the drop refuses the claim that would overspend.
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(2, SOL), None, 25, 0);
    let mut p = ctx.params.clone();
    p.total_entitlements = SOL + 1; // leaves sum to 2 SOL
    expect_ok(h.send_create_with(&ctx, p));
    expect_ok(h.fund(&ctx, 2 * SOL));
    expect_ok(h.activate(&ctx));
    expect_ok(h.claim(&ctx, 0));
    expect_err(h.claim(&ctx, 1), DropError::OverEntitlement);
}

// --, the asset accounts -----------------------------------------------------------------

#[test]
fn spl_claim_without_token_accounts_fails_s6_0() {
    let mut h = Harness::new();
    let ctx = active_spl(&mut h, 2, 30);
    let pretend = DropCtx { mint: None, vault: None, ..ctx };
    expect_err(h.claim(&pretend, 0), DropError::AssetAccountsMismatch);
}

#[test]
fn sol_claim_with_token_accounts_fails_s6_0() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 31);
    let mint = h.create_mint();
    let vault = h.create_ata(&ctx.drop, &mint, &TOKEN_PROGRAM);
    let pretend = DropCtx { mint: Some(mint), vault: Some(vault), ..ctx };
    expect_err(h.claim(&pretend, 0), DropError::AssetAccountsMismatch);
}

// --, rent on a fresh recipient --------------------------------------------------------

/// The runtime rule, not the program's: `Uninitialized -> RentPaying` is a forbidden transition
/// and the transaction fails with `InsufficientFundsForRent`. LiteSVM 0.10 copies that rule from
/// Agave (`utils/rent.rs`) but its caller, `check_accounts_rent` in `lib.rs`, only applies it to
/// accounts with data, so a fresh wallet is never checked here. Proven on a real cluster instead.
#[test]
#[ignore = "LiteSVM 0.10 skips the rent check for data-less accounts; run against a validator"]
fn sol_claim_below_rent_minimum_to_a_fresh_key_fails_and_writes_nothing_s5_11() {
    let mut h = Harness::new();
    let small = MIN_SOL_LEAF - 1;
    let ctx = h.new_sol_drop(&[(Keypair::new().pubkey(), small), (Keypair::new().pubkey(), SOL)], 32);
    h.fund_and_activate(&ctx);
    let index = ctx.tree.receivers.iter().position(|r| r.amount == small).unwrap();
    expect_fail(h.claim(&ctx, index));
    assert!(!h.is_claimed(&ctx, index as u32), "the bit was not set");
    assert_eq!(h.drop_state(&ctx).claimed_count, 0);
}

#[test]
fn sol_claim_at_rent_minimum_to_a_fresh_key_works_s5_11() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&[(Keypair::new().pubkey(), MIN_SOL_LEAF), (Keypair::new().pubkey(), SOL)], 33);
    h.fund_and_activate(&ctx);
    let index = ctx.tree.receivers.iter().position(|r| r.amount == MIN_SOL_LEAF).unwrap();
    expect_ok(h.claim(&ctx, index));
    assert_eq!(h.lamports(&ctx.recipient(index)), MIN_SOL_LEAF);
}

#[test]
fn drop_never_goes_below_its_rent_minimum_i18() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 3, 34);
    let rent = h.rent_for(dropchad::Drop::SIZE);
    for i in 0..3 {
        expect_ok(h.claim(&ctx, i));
        assert!(h.lamports(&ctx.drop) >= rent);
    }
    assert_eq!(h.lamports(&ctx.drop), rent);
}

#[test]
fn status_stays_active_through_claims_s4_6() {
    let mut h = Harness::new();
    let ctx = active_sol(&mut h, 2, 35);
    expect_ok(h.claim(&ctx, 0));
    expect_ok(h.claim(&ctx, 1));
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Active);
}
