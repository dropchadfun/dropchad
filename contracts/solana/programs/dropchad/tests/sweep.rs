//! `sweep`, and `sweep_sol`: what arrives after close goes back.

mod common;

use common::spl::*;
use common::*;
use dropchad::events::{SolSwept, Swept};
use dropchad::Drop;
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

// -- after close ---------------------------------------------------------

/// Re-create the closed vault, which the ATA program lets anyone do, and send the drop asset to it.
fn late_asset(h: &mut Harness, ctx: &DropCtx, amount: u64) -> anchor_lang::prelude::Pubkey {
    let asset = ctx.mint.unwrap();
    let vault = h.create_ata(&ctx.drop, &asset, &TOKEN_PROGRAM);
    assert_eq!(vault, ctx.vault.unwrap(), "the same address as the old vault");
    let funder = h.funder.insecure_clone();
    let funder_ata = ata_address(&funder.pubkey(), &asset, &TOKEN_PROGRAM);
    expect_ok(h.send(&[token_transfer(&TOKEN_PROGRAM, &funder_ata, &vault, &funder.pubkey(), amount)], &[&funder]));
    asset
}

#[test]
fn sweep_the_drop_asset_after_close_s6_8_1_s6_10_7() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(20);
    expect_ok(h.close(&ctx));
    let asset = late_asset(&mut h, &ctx, 25);
    let before = h.holding(&ctx, &ctx.refund_recipient);

    let meta = expect_ok(h.sweep(&ctx, &asset));
    assert_eq!(h.holding(&ctx, &ctx.refund_recipient) - before, 25);
    assert_eq!(h.token_balance(&ctx.vault.unwrap()), 0);
    let ev: Swept = find_event(&meta.logs).unwrap();
    assert_eq!((ev.drop, ev.mint, ev.to, ev.amount), (ctx.drop, asset, ctx.refund_recipient, 25));
}

#[test]
fn sweep_the_drop_asset_after_refund_but_before_close_still_fails_s6_8_6() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(21);
    let asset = ctx.mint.unwrap();
    let funder = h.funder.insecure_clone();
    let funder_ata = ata_address(&funder.pubkey(), &asset, &TOKEN_PROGRAM);
    expect_ok(h.send(&[token_transfer(&TOKEN_PROGRAM, &funder_ata, &ctx.vault.unwrap(), &funder.pubkey(), 3)], &[&funder]));
    expect_err(h.sweep(&ctx, &asset), DropError::CannotSweepDropAsset);
}

// -- sweep_sol, 6.13 ------------------------------------------------------------------------------

#[test]
fn sweep_sol_after_close_on_a_sol_drop_s6_13() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(30);
    expect_ok(h.close(&ctx));
    expect_ok(h.fund(&ctx, 2 * SOL)); // somebody pays a closed drop
    let refund_before = h.lamports(&ctx.refund_recipient);
    let caller_before = h.lamports(&h.funder.pubkey());

    let meta = expect_ok(h.sweep_sol(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient) - refund_before, 2 * SOL);
    assert_eq!(h.lamports(&ctx.drop), h.rent_for(Drop::SIZE), "I18: the rent minimum stays");
    assert!(h.lamports(&h.funder.pubkey()) < caller_before, "the caller gets nothing");
    assert!(h.drop_state(&ctx).closed, "nothing else changes");
    let ev: SolSwept = find_event(&meta.logs).unwrap();
    assert_eq!((ev.drop, ev.to, ev.amount), (ctx.drop, ctx.refund_recipient, 2 * SOL));
}

#[test]
fn sweep_sol_after_close_on_a_token_drop_s6_13_5() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(31);
    expect_ok(h.close(&ctx));
    expect_ok(h.fund_lamports(&ctx, SOL));
    let refund_before = h.lamports(&ctx.refund_recipient);
    expect_ok(h.sweep_sol(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient) - refund_before, SOL);
    assert_eq!(h.lamports(&ctx.drop), h.rent_for(Drop::SIZE));
}

#[test]
fn sweep_sol_before_close_fails_s6_13_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 32);
    expect_err(h.sweep_sol(&ctx), DropError::NotClosed);
    h.fund_and_activate(&ctx);
    expect_err(h.sweep_sol(&ctx), DropError::NotClosed);

    let ctx = h.finished_sol_drop(33);
    expect_ok(h.fund(&ctx, SOL));
    expect_err(h.sweep_sol(&ctx), DropError::NotClosed);
}

#[test]
fn sweep_sol_with_nothing_above_rent_fails_s6_13_3() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(34);
    expect_ok(h.close(&ctx));
    expect_err(h.sweep_sol(&ctx), DropError::NothingToSweep);
}

#[test]
fn sweep_sol_twice_takes_nothing_the_second_time_s6_13_3() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(35);
    expect_ok(h.close(&ctx));
    expect_ok(h.fund(&ctx, SOL));
    expect_ok(h.sweep_sol(&ctx));
    expect_err(h.sweep_sol(&ctx), DropError::NothingToSweep);
}

#[test]
fn sweep_sol_with_the_wrong_refund_recipient_fails_s6_13_2() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(36);
    expect_ok(h.close(&ctx));
    expect_ok(h.fund(&ctx, SOL));
    let funder = h.funder.insecure_clone();
    let ix = h.sweep_sol_ix(&ctx, &funder.pubkey(), &funder.pubkey());
    expect_err(h.send(&[ix], &[&funder]), DropError::WrongRefundRecipient);
}
