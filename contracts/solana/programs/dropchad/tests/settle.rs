//! `cancel_unfunded` and `refund`, and the state machine of
//! section 4.

mod common;

use common::spl::*;
use anchor_lang::InstructionData;
use common::*;
use dropchad::events::{CancelledUnfunded, Finalized, Refunded};
use dropchad::state::DropStatus;
use dropchad::DropError;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn past_funding_deadline(h: &mut Harness, ctx: &DropCtx) {
    let deadline = h.drop_state(ctx).funding_deadline;
    h.warp_to(deadline + 1);
}

fn past_claim_deadline(h: &mut Harness, ctx: &DropCtx) {
    let deadline = h.drop_state(ctx).claim_deadline;
    h.warp_to(deadline + 1);
}

// -- cancel_unfunded ---------------------------------------------------------------------------

#[test]
fn cancel_with_zero_balance_s6_6_4() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 1);
    past_funding_deadline(&mut h, &ctx);
    let meta = expect_ok(h.cancel(&ctx));
    let d = h.drop_state(&ctx);
    assert_eq!(d.status, DropStatus::Cancelled);
    assert_eq!(h.lamports(&ctx.refund_recipient), 0);
    let ev: CancelledUnfunded = find_event(&meta.logs).unwrap();
    assert_eq!((ev.drop, ev.refund_recipient, ev.amount), (ctx.drop, ctx.refund_recipient, 0));
}

#[test]
fn cancel_with_partial_balance_returns_it_s6_6_4() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 2);
    expect_ok(h.fund(&ctx, SOL));
    past_funding_deadline(&mut h, &ctx);
    let meta = expect_ok(h.cancel(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), SOL);
    assert_eq!(h.spendable(&ctx), 0, "I12");
    assert_eq!(find_event::<CancelledUnfunded>(&meta.logs).unwrap().amount, SOL);
}

#[test]
fn cancel_with_overfunded_balance_returns_everything_s6_6_4() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 3);
    expect_ok(h.fund(&ctx, 5 * SOL));
    past_funding_deadline(&mut h, &ctx);
    expect_ok(h.cancel(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), 5 * SOL);
}

#[test]
fn cancel_spl_returns_the_vault_and_creates_the_refund_token_account() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(2, 1_000_000), 4);
    expect_ok(h.fund(&ctx, 1_500_000));
    past_funding_deadline(&mut h, &ctx);
    let refund_ata = ata_address(&ctx.refund_recipient, &ctx.mint.unwrap(), &TOKEN_PROGRAM);
    assert!(!h.exists(&refund_ata));
    expect_ok(h.cancel(&ctx));
    assert_eq!(h.token_balance(&refund_ata), 1_500_000);
    assert_eq!(h.token_balance(&ctx.vault.unwrap()), 0);
}

#[test]
fn cancel_before_deadline_fails_s6_6_2() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 5);
    expect_err(h.cancel(&ctx), DropError::FundingStillOpen);
}

#[test]
fn cancel_when_active_fails_s6_6_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 6);
    h.fund_and_activate(&ctx);
    past_funding_deadline(&mut h, &ctx);
    expect_err(h.cancel(&ctx), DropError::WrongStatus);
}

#[test]
fn cancel_twice_fails_s4_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 7);
    past_funding_deadline(&mut h, &ctx);
    expect_ok(h.cancel(&ctx));
    expect_err(h.cancel(&ctx), DropError::WrongStatus);
}

#[test]
fn cancel_with_the_wrong_refund_recipient_fails_s6_6_3() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 8);
    expect_ok(h.fund(&ctx, SOL));
    past_funding_deadline(&mut h, &ctx);
    let funder = h.funder.insecure_clone();
    let ix = h.settle_ix(&ctx, &funder.pubkey(), &funder.pubkey(), dropchad::instruction::CancelUnfunded {}.data());
    expect_err(h.send(&[ix], &[&funder]), DropError::WrongRefundRecipient);
}

#[test]
fn cancel_is_permissionless_s2_5() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 9);
    expect_ok(h.fund(&ctx, SOL));
    past_funding_deadline(&mut h, &ctx);
    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let ix = h.settle_ix(&ctx, &stranger.pubkey(), &ctx.refund_recipient, dropchad::instruction::CancelUnfunded {}.data());
    expect_ok(h.send(&[ix], &[&stranger]));
    assert_eq!(h.lamports(&ctx.refund_recipient), SOL, "the money went to the refund recipient, not the caller");
}

// -- refund ------------------------------------------------------------------------------------

#[test]
fn refund_pays_leftovers_and_finalizes_s6_7_4() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(3, SOL), 20);
    expect_ok(h.fund(&ctx, 4 * SOL)); // one extra
    expect_ok(h.activate(&ctx));
    expect_ok(h.claim(&ctx, 0));
    past_claim_deadline(&mut h, &ctx);

    let meta = expect_ok(h.refund(&ctx));
    let d = h.drop_state(&ctx);
    assert_eq!(d.status, DropStatus::Finalized);
    // 4 funded, 1 claimed: 2 unclaimed + 1 extra go back
    assert_eq!(h.lamports(&ctx.refund_recipient), 3 * SOL);
    assert_eq!(h.spendable(&ctx), 0, "I12");
    let r: Refunded = find_event(&meta.logs).unwrap();
    assert_eq!((r.drop, r.refund_recipient, r.amount), (ctx.drop, ctx.refund_recipient, 3 * SOL));
    let f: Finalized = find_event(&meta.logs).unwrap();
    assert_eq!((f.total_claimed, f.claimed_count, f.refunded), (SOL, 1, 3 * SOL));
}

#[test]
fn refund_with_zero_leftovers_works_s6_7_4() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 21);
    h.fund_and_activate(&ctx);
    expect_ok(h.claim(&ctx, 0));
    expect_ok(h.claim(&ctx, 1));
    past_claim_deadline(&mut h, &ctx);
    let meta = expect_ok(h.refund(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), 0);
    assert_eq!(find_event::<Refunded>(&meta.logs).unwrap().amount, 0);
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Finalized);
}

#[test]
fn refund_spl_pays_leftovers() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(2, 1_000_000), 22);
    h.fund_and_activate(&ctx);
    expect_ok(h.claim(&ctx, 1));
    past_claim_deadline(&mut h, &ctx);
    expect_ok(h.refund(&ctx));
    assert_eq!(h.holding(&ctx, &ctx.refund_recipient), 1_000_000);
    assert_eq!(h.token_balance(&ctx.vault.unwrap()), 0);
}

#[test]
fn refund_before_deadline_fails_s6_7_2() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 23);
    h.fund_and_activate(&ctx);
    expect_err(h.refund(&ctx), DropError::ClaimWindowOpen);
}

#[test]
fn refund_when_created_fails_s6_7_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 24);
    expect_ok(h.fund(&ctx, 2 * SOL));
    h.warp_to(T0 + 400 * 86_400);
    expect_err(h.refund(&ctx), DropError::WrongStatus);
}

#[test]
fn refund_twice_fails_s4_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 25);
    h.fund_and_activate(&ctx);
    past_claim_deadline(&mut h, &ctx);
    expect_ok(h.refund(&ctx));
    expect_err(h.refund(&ctx), DropError::WrongStatus);
}

#[test]
fn refund_with_the_wrong_refund_recipient_fails_s6_7_3() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 26);
    h.fund_and_activate(&ctx);
    past_claim_deadline(&mut h, &ctx);
    let funder = h.funder.insecure_clone();
    let ix = h.settle_ix(&ctx, &funder.pubkey(), &funder.pubkey(), dropchad::instruction::Refund {}.data());
    expect_err(h.send(&[ix], &[&funder]), DropError::WrongRefundRecipient);
}

#[test]
fn refund_of_a_cancelled_drop_fails_s4_2() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 27);
    past_funding_deadline(&mut h, &ctx);
    expect_ok(h.cancel(&ctx));
    h.warp_to(T0 + 400 * 86_400);
    expect_err(h.refund(&ctx), DropError::WrongStatus);
}

// -- conservation, -------------------------------------------------------------------------

#[test]
fn conservation_over_a_whole_life_i10() {
    let mut h = Harness::with_fee(250); // 2.5%
    let ctx = h.new_sol_drop(&receivers(4, SOL), 28);
    let d = h.drop_state(&ctx);
    let funded = d.gross_required + 123_456; // some extra
    expect_ok(h.fund(&ctx, funded));
    let fee_before = h.lamports(&h.fee_wallet.pubkey());
    expect_ok(h.activate(&ctx));
    expect_ok(h.claim(&ctx, 0));
    expect_ok(h.claim(&ctx, 2));
    past_claim_deadline(&mut h, &ctx);
    expect_ok(h.refund(&ctx));

    let fee_paid = h.lamports(&h.fee_wallet.pubkey()) - fee_before;
    let claimed = h.lamports(&ctx.recipient(0)) + h.lamports(&ctx.recipient(2));
    let refunded = h.lamports(&ctx.refund_recipient);
    assert_eq!(funded, claimed + fee_paid + refunded);
    assert_eq!(fee_paid, d.fee_amount);
    assert_eq!(h.drop_state(&ctx).total_claimed, claimed);
}

#[test]
fn immutable_fields_never_change_i5() {
    let mut h = Harness::with_fee(100);
    let ctx = h.new_sol_drop(&receivers(3, SOL), 29);
    /// Every field of table 5.2. Rust implements PartialEq on tuples only up to 12 fields.
    #[derive(Debug, PartialEq)]
    struct Frozen {
        asset: anchor_lang::prelude::Pubkey,
        vault: anchor_lang::prelude::Pubkey,
        merkle_root: [u8; 32],
        manifest_hash: [u8; 32],
        total_entitlements: u64,
        gross_required: u64,
        fee_amount: u64,
        fee_wallet: anchor_lang::prelude::Pubkey,
        refund_recipient: anchor_lang::prelude::Pubkey,
        funding_deadline: i64,
        claim_period: u32,
        creator_commitment: [u8; 32],
        nonce: u64,
        leaf_count: u32,
        chain_id: u64,
        rent_payer: anchor_lang::prelude::Pubkey,
        created_at: i64,
        bump: u8,
        bitmap_bump: u8,
        sol_fee_lamports: u64,
        account_budget_lamports: u64,
    }
    // Field 22, `account_budget_used`, is the one 5.2 field that changes.
    let snap = |d: &dropchad::Drop| Frozen {
        asset: d.asset,
        vault: d.vault,
        merkle_root: d.merkle_root,
        manifest_hash: d.manifest_hash,
        total_entitlements: d.total_entitlements,
        gross_required: d.gross_required,
        fee_amount: d.fee_amount,
        fee_wallet: d.fee_wallet,
        refund_recipient: d.refund_recipient,
        funding_deadline: d.funding_deadline,
        claim_period: d.claim_period,
        creator_commitment: d.creator_commitment,
        nonce: d.nonce,
        leaf_count: d.leaf_count,
        chain_id: d.chain_id,
        rent_payer: d.rent_payer,
        created_at: d.created_at,
        bump: d.bump,
        bitmap_bump: d.bitmap_bump,
        sol_fee_lamports: d.sol_fee_lamports,
        account_budget_lamports: d.account_budget_lamports,
    };
    let before = snap(&h.drop_state(&ctx));
    h.fund_and_activate(&ctx);
    assert_eq!(snap(&h.drop_state(&ctx)), before);
    expect_ok(h.claim(&ctx, 1));
    assert_eq!(snap(&h.drop_state(&ctx)), before);
    past_claim_deadline(&mut h, &ctx);
    expect_ok(h.refund(&ctx));
    assert_eq!(snap(&h.drop_state(&ctx)), before);
    expect_ok(h.close(&ctx));
    assert_eq!(snap(&h.drop_state(&ctx)), before);
}

#[test]
fn claim_deadline_is_written_once_i16() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 30);
    h.fund_and_activate(&ctx);
    let deadline = h.drop_state(&ctx).claim_deadline;
    assert!(deadline > 0);
    expect_ok(h.claim(&ctx, 0));
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&ctx));
    expect_ok(h.close(&ctx));
    assert_eq!(h.drop_state(&ctx).claim_deadline, deadline);
}
