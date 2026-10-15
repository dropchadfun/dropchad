//! `close_drop`. Invariants. The rent minimum to the rent payer.

mod common;

use common::spl::*;
use common::*;
use dropchad::events::Closed;
use dropchad::state::DropStatus;
use dropchad::{ClaimBitmap, Drop, DropError};
use solana_signer::Signer;

#[test]
fn close_returns_bitmap_rent_to_the_rent_payer_not_the_caller_s6_10_3_i17() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(1);
    let bitmap_rent = h.rent_for(ClaimBitmap::SIZE);
    let relayer_before = h.lamports(&h.relayer.pubkey());
    let caller_before = h.lamports(&h.funder.pubkey());

    let meta = expect_ok(h.close(&ctx)); // sent by the funder
    assert_eq!(h.lamports(&h.relayer.pubkey()) - relayer_before, bitmap_rent, "exactly the bitmap rent");
    assert!(h.lamports(&h.funder.pubkey()) < caller_before, "the caller paid a fee and got nothing");
    assert!(!h.exists(&ctx.bitmap), "bitmap closed");

    let ev: Closed = find_event(&meta.logs).unwrap();
    assert_eq!((ev.drop, ev.rent_payer, ev.leftovers_to_refund_recipient), (ctx.drop, h.relayer.pubkey(), 0));
}

#[test]
fn close_spl_returns_bitmap_and_vault_rent_s6_10_3() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(2);
    let rents = h.rent_for(ClaimBitmap::SIZE) + h.rent_for(TOKEN_ACCOUNT_LEN);
    let relayer_before = h.lamports(&h.relayer.pubkey());
    expect_ok(h.close(&ctx));
    assert_eq!(h.lamports(&h.relayer.pubkey()) - relayer_before, rents);
    assert!(!h.exists(&ctx.bitmap));
    assert!(!h.exists(&ctx.vault.unwrap()), "vault closed");
}

#[test]
fn the_drop_account_stays_with_closed_true_s6_10_5() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(3);
    expect_ok(h.close(&ctx));
    let d = h.drop_state(&ctx);
    assert!(d.closed);
    assert_eq!(d.status, DropStatus::Finalized);
    assert_eq!(d.claimed_count, 3);
    assert_eq!(h.lamports(&ctx.drop), h.rent_for(Drop::SIZE), "I12: exactly its rent");
}

#[test]
fn same_seeds_still_fail_after_close_s3_2_i11() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(4);
    expect_ok(h.close(&ctx));
    let again = h.prepare(&receivers(2, SOL), None, 4, 0);
    assert_eq!(again.drop, ctx.drop);
    expect_fail(h.send_create(&again));
    assert!(h.drop_state(&ctx).closed, "the old record is untouched");
}

#[test]
fn close_sends_late_sol_to_the_refund_recipient_first_s6_10_2() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(5);
    // somebody sends SOL after the refund
    expect_ok(h.fund(&ctx, 123_456));
    let refund_before = h.lamports(&ctx.refund_recipient);
    let relayer_before = h.lamports(&h.relayer.pubkey());
    let meta = expect_ok(h.close(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient) - refund_before, 123_456);
    assert_eq!(h.lamports(&h.relayer.pubkey()) - relayer_before, h.rent_for(ClaimBitmap::SIZE));
    assert_eq!(find_event::<Closed>(&meta.logs).unwrap().leftovers_to_refund_recipient, 123_456);
}

#[test]
fn close_sends_late_tokens_to_the_refund_recipient_first_s6_10_2() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(6);
    let asset = ctx.mint.unwrap();
    let funder = h.funder.insecure_clone();
    let funder_ata = ata_address(&funder.pubkey(), &asset, &TOKEN_PROGRAM);
    expect_ok(h.send(&[token_transfer(&TOKEN_PROGRAM, &funder_ata, &ctx.vault.unwrap(), &funder.pubkey(), 50)], &[&funder]));
    let before = h.holding(&ctx, &ctx.refund_recipient);
    expect_ok(h.close(&ctx));
    assert_eq!(h.holding(&ctx, &ctx.refund_recipient) - before, 50);
    assert!(!h.exists(&ctx.vault.unwrap()));
}

/// SOL from the funder to any account, the way a stranger can top up an account they do not own.
fn send_sol(h: &mut Harness, to: &anchor_lang::prelude::Pubkey, lamports: u64) {
    let funder = h.funder.insecure_clone();
    expect_ok(h.send(&[system_transfer(&funder.pubkey(), to, lamports)], &[&funder]));
}

#[test]
fn close_sends_extra_sol_in_the_bitmap_to_the_refund_recipient_s6_10_3_l3() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(20);
    send_sol(&mut h, &ctx.bitmap, SOL);
    let refund_before = h.lamports(&ctx.refund_recipient);
    let relayer_before = h.lamports(&h.relayer.pubkey());

    let meta = expect_ok(h.close(&ctx));
    assert_eq!(h.lamports(&h.relayer.pubkey()) - relayer_before, h.rent_for(ClaimBitmap::SIZE), "the rent minimum only");
    assert_eq!(h.lamports(&ctx.refund_recipient) - refund_before, SOL, "the extra");
    assert!(!h.exists(&ctx.bitmap));
    assert_eq!(h.lamports(&ctx.drop), h.rent_for(Drop::SIZE), "I12");
    // the event keeps counting the asset leftovers only, 11.1
    assert_eq!(find_event::<Closed>(&meta.logs).unwrap().leftovers_to_refund_recipient, 0);
}

#[test]
fn close_spl_sends_extra_sol_in_the_vault_and_bitmap_to_the_refund_recipient_s6_10_3_l3() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(21);
    let vault = ctx.vault.unwrap();
    send_sol(&mut h, &vault, 2 * SOL);
    send_sol(&mut h, &ctx.bitmap, SOL);
    let rents = h.rent_for(ClaimBitmap::SIZE) + h.rent_for(TOKEN_ACCOUNT_LEN);
    let refund_before = h.lamports(&ctx.refund_recipient);
    let relayer_before = h.lamports(&h.relayer.pubkey());

    expect_ok(h.close(&ctx));
    assert_eq!(h.lamports(&h.relayer.pubkey()) - relayer_before, rents, "the two rent minimums only");
    assert_eq!(h.lamports(&ctx.refund_recipient) - refund_before, 3 * SOL, "both extras");
    assert!(!h.exists(&vault));
    assert!(!h.exists(&ctx.bitmap));
    assert_eq!(h.lamports(&ctx.drop), h.rent_for(Drop::SIZE), "I12: the vault's lamports did not stay on the drop");
}

#[test]
fn close_spl_with_extra_sol_on_the_drop_and_the_vault_s6_10_6() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(22);
    let vault = ctx.vault.unwrap();
    expect_ok(h.fund_lamports(&ctx, SOL)); // the drop's own SOL side, after the refund
    send_sol(&mut h, &vault, SOL);
    let refund_before = h.lamports(&ctx.refund_recipient);
    let relayer_before = h.lamports(&h.relayer.pubkey());

    expect_ok(h.close(&ctx));
    let rents = h.rent_for(ClaimBitmap::SIZE) + h.rent_for(TOKEN_ACCOUNT_LEN);
    assert_eq!(h.lamports(&h.relayer.pubkey()) - relayer_before, rents);
    assert_eq!(h.lamports(&ctx.refund_recipient) - refund_before, 2 * SOL);
    assert_eq!(h.lamports(&ctx.drop), h.rent_for(Drop::SIZE));
}

#[test]
fn close_after_cancel_works_s6_10_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 7);
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.cancel(&ctx));
    expect_ok(h.close(&ctx));
    assert!(h.drop_state(&ctx).closed);
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Cancelled);
}

#[test]
fn close_before_finish_fails_s6_10_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 8);
    expect_err(h.close(&ctx), DropError::NotFinished);
    h.fund_and_activate(&ctx);
    expect_err(h.close(&ctx), DropError::NotFinished);
    assert!(h.exists(&ctx.bitmap));
}

#[test]
fn close_twice_fails_s6_10_1() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(9);
    expect_ok(h.close(&ctx));
    // the bitmap is gone, so the second call cannot even load it
    expect_fail(h.close(&ctx));
}

#[test]
fn close_with_the_wrong_rent_payer_fails_s6_10_3() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(10);
    let funder = h.funder.insecure_clone();
    let ix = h.close_ix(&ctx, &funder.pubkey(), &funder.pubkey(), &ctx.refund_recipient);
    expect_err(h.send(&[ix], &[&funder]), DropError::WrongRentPayer);
    assert!(h.exists(&ctx.bitmap));
}

#[test]
fn close_with_the_wrong_refund_recipient_fails_s6_10_4() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(11);
    let funder = h.funder.insecure_clone();
    let ix = h.close_ix(&ctx, &funder.pubkey(), &h.relayer.pubkey(), &funder.pubkey());
    expect_err(h.send(&[ix], &[&funder]), DropError::WrongRefundRecipient);
}

#[test]
fn close_spl_without_token_accounts_fails_s6_0() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(12);
    let pretend = DropCtx { mint: None, vault: None, ..ctx };
    expect_err(h.close(&pretend), DropError::AssetAccountsMismatch);
}

#[test]
fn nothing_can_move_out_of_a_closed_drop_i4() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(13);
    expect_ok(h.close(&ctx));
    expect_err(h.refund(&ctx), DropError::WrongStatus);
    expect_err(h.cancel(&ctx), DropError::WrongStatus);
    expect_err(h.activate(&ctx), DropError::WrongStatus);
    expect_fail(h.claim(&ctx, 0));
}
