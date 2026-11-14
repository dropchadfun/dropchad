//! `cancel_unfunded` and `refund`, and the state machine of
//! section 4.

mod common;

use anchor_lang::InstructionData;
use common::spl::*;
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
    assert_eq!(
        (ev.drop, ev.refund_recipient, ev.amount),
        (ctx.drop, ctx.refund_recipient, 0)
    );
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
    assert_eq!(
        find_event::<CancelledUnfunded>(&meta.logs).unwrap().amount,
        SOL
    );
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
    let ix = h.settle_ix(
        &ctx,
        &funder.pubkey(),
        &funder.pubkey(),
        dropchad::instruction::CancelUnfunded {}.data(),
    );
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
    let ix = h.settle_ix(
        &ctx,
        &stranger.pubkey(),
        &ctx.refund_recipient,
        dropchad::instruction::CancelUnfunded {}.data(),
    );
    expect_ok(h.send(&[ix], &[&stranger]));
    assert_eq!(
        h.lamports(&ctx.refund_recipient),
        SOL,
        "the money went to the refund recipient, not the caller"
    );
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
    assert_eq!(
        (r.drop, r.refund_recipient, r.amount),
        (ctx.drop, ctx.refund_recipient, 3 * SOL)
    );
    let f: Finalized = find_event(&meta.logs).unwrap();
    assert_eq!(
        (f.total_claimed, f.claimed_count, f.refunded),
        (SOL, 1, 3 * SOL)
    );
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
    let ix = h.settle_ix(
        &ctx,
        &funder.pubkey(),
        &funder.pubkey(),
        dropchad::instruction::Refund {}.data(),
    );
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

// -- a refund recipient with no account ------------------------------------

/// SOL from the funder to any account.
fn send_sol(h: &mut Harness, to: &anchor_lang::prelude::Pubkey, lamports: u64) {
    let funder = h.funder.insecure_clone();
    expect_ok(h.send(
        &[system_transfer(&funder.pubkey(), to, lamports)],
        &[&funder],
    ));
}

fn drop_rent(h: &Harness) -> u64 {
    h.rent_for(dropchad::Drop::SIZE)
}

#[test]
fn refund_keeps_dust_in_the_drop_when_the_refund_recipient_has_no_account_s6_10_9() {
    // a fully claimed drop, dust sent to it before the refund
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(3, SOL), 40);
    h.fund_and_activate(&ctx);
    for i in 0..3 {
        expect_ok(h.claim(&ctx, i));
    }
    expect_ok(h.fund_lamports(&ctx, 1_000));
    past_claim_deadline(&mut h, &ctx);
    assert_eq!(h.lamports(&ctx.refund_recipient), 0, "no account");

    let meta = expect_ok(h.refund(&ctx));
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Finalized);
    assert_eq!(h.lamports(&ctx.refund_recipient), 0, "nothing sent");
    assert_eq!(
        h.lamports(&ctx.drop),
        drop_rent(&h) + 1_000,
        "the dust stays in the drop"
    );
    assert_eq!(
        find_event::<Refunded>(&meta.logs).unwrap().amount,
        0,
        "what really went out"
    );
    assert_eq!(find_event::<Finalized>(&meta.logs).unwrap().refunded, 0);

    // close meets the dust as leftovers and keeps it again
    expect_ok(h.close(&ctx));
    assert_eq!(h.lamports(&ctx.drop), drop_rent(&h) + 1_000);
    assert_eq!(h.lamports(&ctx.refund_recipient), 0);

    // once the recipient has an account, sweep_sol sends it
    let rent0 = h.rent_for(0);
    send_sol(&mut h, &ctx.refund_recipient, rent0);
    expect_ok(h.sweep_sol(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), rent0 + 1_000);
    assert_eq!(h.lamports(&ctx.drop), drop_rent(&h));
}

#[test]
fn refund_pays_dust_at_the_rent_minimum_to_a_refund_recipient_with_no_account_s6_10_9() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(3, SOL), 41);
    h.fund_and_activate(&ctx);
    for i in 0..3 {
        expect_ok(h.claim(&ctx, i));
    }
    let rent0 = h.rent_for(0);
    expect_ok(h.fund_lamports(&ctx, rent0));
    past_claim_deadline(&mut h, &ctx);

    let meta = expect_ok(h.refund(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), rent0);
    assert_eq!(h.lamports(&ctx.drop), drop_rent(&h));
    assert_eq!(find_event::<Refunded>(&meta.logs).unwrap().amount, rent0);
}

#[test]
fn refund_spl_keeps_sol_dust_and_still_sends_the_tokens_s6_10_9() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(3, 1_000_000), 42);
    h.fund_and_activate(&ctx);
    for i in 0..3 {
        expect_ok(h.claim(&ctx, i));
    }
    let asset = ctx.mint.unwrap();
    let funder = h.funder.insecure_clone();
    let funder_ata = ata_address(&funder.pubkey(), &asset, &TOKEN_PROGRAM);
    expect_ok(h.send(
        &[token_transfer(
            &TOKEN_PROGRAM,
            &funder_ata,
            &ctx.vault.unwrap(),
            &funder.pubkey(),
            50,
        )],
        &[&funder],
    ));
    expect_ok(h.fund_lamports(&ctx, 1_000));
    past_claim_deadline(&mut h, &ctx);
    let extra = h.lamports(&ctx.drop) - drop_rent(&h);
    assert!(extra > 0 && extra < h.rent_for(0), "the SOL side is dust");
    assert_eq!(h.lamports(&ctx.refund_recipient), 0, "no account");

    let meta = expect_ok(h.refund(&ctx));
    assert_eq!(
        h.holding(&ctx, &ctx.refund_recipient),
        50,
        "the tokens still go out"
    );
    assert_eq!(
        find_event::<Refunded>(&meta.logs).unwrap().amount,
        50,
        "the asset, tokens"
    );
    assert_eq!(h.lamports(&ctx.refund_recipient), 0, "no lamports");
    assert_eq!(
        h.lamports(&ctx.drop),
        drop_rent(&h) + extra,
        "the SOL dust stays in the drop"
    );
}

#[test]
fn cancel_keeps_a_small_balance_in_the_drop_when_the_refund_recipient_has_no_account_s6_10_9() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 43);
    expect_ok(h.fund(&ctx, 1_000));
    past_funding_deadline(&mut h, &ctx);

    let meta = expect_ok(h.cancel(&ctx));
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Cancelled);
    assert_eq!(h.lamports(&ctx.refund_recipient), 0, "nothing sent");
    assert_eq!(
        h.lamports(&ctx.drop),
        drop_rent(&h) + 1_000,
        "the balance stays in the drop"
    );
    assert_eq!(
        find_event::<CancelledUnfunded>(&meta.logs).unwrap().amount,
        0,
        "what really went out"
    );

    expect_ok(h.close(&ctx));
    assert_eq!(
        h.lamports(&ctx.drop),
        drop_rent(&h) + 1_000,
        "close keeps it again"
    );
}

#[test]
fn cancel_pays_a_balance_at_the_rent_minimum_to_a_refund_recipient_with_no_account_s6_10_9() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 44);
    let rent0 = h.rent_for(0);
    expect_ok(h.fund(&ctx, rent0));
    past_funding_deadline(&mut h, &ctx);

    expect_ok(h.cancel(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), rent0);
    assert_eq!(h.lamports(&ctx.drop), drop_rent(&h));
}

#[test]
fn cancel_spl_keeps_sol_dust_and_still_sends_the_tokens_s6_10_9() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(2, 1_000_000), 45);
    expect_ok(h.fund(&ctx, 500_000)); // tokens, short of the total
    expect_ok(h.fund_lamports(&ctx, 1_000));
    past_funding_deadline(&mut h, &ctx);
    let extra = h.lamports(&ctx.drop) - drop_rent(&h);
    assert!(extra > 0 && extra < h.rent_for(0), "the SOL side is dust");

    let meta = expect_ok(h.cancel(&ctx));
    assert_eq!(
        h.holding(&ctx, &ctx.refund_recipient),
        500_000,
        "the tokens still go out"
    );
    assert_eq!(
        find_event::<CancelledUnfunded>(&meta.logs).unwrap().amount,
        500_000
    );
    assert_eq!(h.lamports(&ctx.refund_recipient), 0, "no lamports");
    assert_eq!(
        h.lamports(&ctx.drop),
        drop_rent(&h) + extra,
        "the SOL dust stays in the drop"
    );
}
