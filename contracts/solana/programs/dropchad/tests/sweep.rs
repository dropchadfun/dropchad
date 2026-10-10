//! `sweep`.

mod common;

use common::spl::*;
use common::*;
use dropchad::events::Swept;
use dropchad::DropError;
use solana_signer::Signer;

/// A wrong mint sent to the drop PDA's token account for that mint.
fn stray(h: &mut Harness, ctx: &DropCtx, amount: u64) -> anchor_lang::prelude::Pubkey {
    let wrong = h.create_mint();
    let ata = h.create_ata(&ctx.drop, &wrong, &TOKEN_PROGRAM);
    h.mint_to(&TOKEN_PROGRAM, &wrong, &ata, amount);
    wrong
}

#[test]
fn sweep_wrong_mint_to_the_refund_recipient_after_finalized_s6_8() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(1);
    let wrong = stray(&mut h, &ctx, 777);
    let meta = expect_ok(h.sweep(&ctx, &wrong));
    let refund_ata = ata_address(&ctx.refund_recipient, &wrong, &TOKEN_PROGRAM);
    assert_eq!(h.token_balance(&refund_ata), 777);
    assert_eq!(h.token_balance(&ata_address(&ctx.drop, &wrong, &TOKEN_PROGRAM)), 0);
    let ev: Swept = find_event(&meta.logs).unwrap();
    assert_eq!((ev.drop, ev.mint, ev.to, ev.amount), (ctx.drop, wrong, ctx.refund_recipient, 777));
}

#[test]
fn sweep_wrong_mint_after_cancelled_s6_8_2() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 2);
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.cancel(&ctx));
    let wrong = stray(&mut h, &ctx, 5);
    expect_ok(h.sweep(&ctx, &wrong));
    assert_eq!(h.token_balance(&ata_address(&ctx.refund_recipient, &wrong, &TOKEN_PROGRAM)), 5);
}

#[test]
fn sweep_wrong_mint_from_an_spl_drop_s6_8() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(3);
    let wrong = stray(&mut h, &ctx, 42);
    expect_ok(h.sweep(&ctx, &wrong));
    assert_eq!(h.token_balance(&ata_address(&ctx.refund_recipient, &wrong, &TOKEN_PROGRAM)), 42);
}

#[test]
fn sweeping_the_drop_asset_fails_s6_8_1() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(4);
    let asset = ctx.mint.unwrap();
    // put some of the asset back into the vault after finalization
    let funder_ata = ata_address(&h.funder.pubkey(), &asset, &TOKEN_PROGRAM);
    let funder = h.funder.insecure_clone();
    expect_ok(h.send(&[token_transfer(&TOKEN_PROGRAM, &funder_ata, &ctx.vault.unwrap(), &funder.pubkey(), 10)], &[&funder]));
    expect_err(h.sweep(&ctx, &asset), DropError::CannotSweepDropAsset);
}

#[test]
fn sweep_before_finish_fails_s6_8_2() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 5);
    let wrong = stray(&mut h, &ctx, 1);
    expect_err(h.sweep(&ctx, &wrong), DropError::NotFinished);
    h.fund_and_activate(&ctx);
    expect_err(h.sweep(&ctx, &wrong), DropError::NotFinished);
}

#[test]
fn sweep_of_an_empty_account_fails_s6_8_3() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(6);
    let wrong = h.create_mint();
    h.create_ata(&ctx.drop, &wrong, &TOKEN_PROGRAM);
    expect_err(h.sweep(&ctx, &wrong), DropError::NothingToSweep);
}

#[test]
fn sweep_with_the_wrong_refund_recipient_fails() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(7);
    let wrong = stray(&mut h, &ctx, 1);
    let funder = h.funder.insecure_clone();
    let ix = h.sweep_ix(&ctx, &funder.pubkey(), &funder.pubkey(), &wrong);
    expect_err(h.send(&[ix], &[&funder]), DropError::WrongRefundRecipient);
}

#[test]
fn sweep_leaves_the_stray_account_open_s6_8_7() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(8);
    let wrong = stray(&mut h, &ctx, 9);
    expect_ok(h.sweep(&ctx, &wrong));
    assert!(h.exists(&ata_address(&ctx.drop, &wrong, &TOKEN_PROGRAM)));
}
