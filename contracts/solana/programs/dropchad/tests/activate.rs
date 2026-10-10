//! `activate` and the fee rules of section 8.

mod common;

use common::spl::*;
use common::*;
use dropchad::events::Activated;
use dropchad::state::DropStatus;
use dropchad::DropError;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn activate_with_exact_gross_required_sol_s6_2_3() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(3, SOL), 1);
    expect_ok(h.fund(&ctx, 3 * SOL));
    assert_eq!(h.spendable(&ctx), 3 * SOL);

    h.warp_to(T0 + 100);
    let meta = expect_ok(h.activate(&ctx));
    let d = h.drop_state(&ctx);
    assert_eq!(d.status, DropStatus::Active);
    assert_eq!(d.activated_at, T0 + 100);
    assert_eq!(d.claim_deadline, T0 + 100 + CLAIM_PERIOD as i64, "");

    let ev: Activated = find_event(&meta.logs).expect("Activated");
    assert_eq!(ev.drop, ctx.drop);
    assert_eq!(ev.activated_at, T0 + 100);
    assert_eq!(ev.balance, 3 * SOL);
    assert_eq!(ev.claim_deadline, d.claim_deadline);
    assert_eq!(ev.fee_paid, 0);
}

#[test]
fn activate_with_exact_gross_required_spl() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(3, 1_000_000), 1);
    expect_ok(h.fund(&ctx, 3_000_000));
    h.fund_sol_side(&ctx);
    expect_ok(h.activate(&ctx));
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Active);
}

#[test]
fn activate_one_lamport_short_fails_s6_2_3() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(3, SOL), 2);
    expect_ok(h.fund(&ctx, 3 * SOL - 1));
    expect_err(h.activate(&ctx), DropError::Underfunded);
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Created);
    // top up one lamport, now it works
    expect_ok(h.fund(&ctx, 1));
    expect_ok(h.activate(&ctx));
}

#[test]
fn activate_one_unit_short_fails_spl_s6_2_3() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(3, 1_000_000), 2);
    expect_ok(h.fund(&ctx, 2_999_999));
    h.fund_sol_side(&ctx);
    expect_err(h.activate(&ctx), DropError::Underfunded);
}

#[test]
fn activate_unfunded_fails_s6_2_3() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(3, SOL), 3);
    expect_err(h.activate(&ctx), DropError::Underfunded);
}

#[test]
fn activate_overfunded_works_and_changes_no_entitlement_s6_2_5() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(3, SOL), 4);
    expect_ok(h.fund(&ctx, 5 * SOL));
    let meta = expect_ok(h.activate(&ctx));
    let d = h.drop_state(&ctx);
    assert_eq!(d.total_entitlements, 3 * SOL);
    assert_eq!(d.gross_required, 3 * SOL);
    assert_eq!(h.spendable(&ctx), 5 * SOL, "the extra stays until refund");
    assert_eq!(find_event::<Activated>(&meta.logs).unwrap().balance, 5 * SOL);
}

#[test]
fn activate_twice_fails_s6_2_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 5);
    h.fund_and_activate(&ctx);
    expect_err(h.activate(&ctx), DropError::WrongStatus);
}

#[test]
fn activate_a_cancelled_drop_fails_s6_2_1() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 6);
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.cancel(&ctx));
    expect_ok(h.fund(&ctx, SOL));
    expect_err(h.activate(&ctx), DropError::WrongStatus);
}

#[test]
fn activate_after_funding_deadline_fails_s6_2_2() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 7);
    expect_ok(h.fund(&ctx, SOL));
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline + 1);
    expect_err(h.activate(&ctx), DropError::FundingExpired);
}

#[test]
fn activate_is_permissionless_s2_5() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 8);
    expect_ok(h.fund(&ctx, SOL));
    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let ix = h.activate_ix(&ctx, &stranger.pubkey(), &h.fee_wallet.pubkey());
    expect_ok(h.send(&[ix], &[&stranger]));
}

#[test]
fn activate_with_the_wrong_fee_wallet_fails_s6_2_4() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 9);
    expect_ok(h.fund(&ctx, SOL));
    let funder = h.funder.insecure_clone();
    let ix = h.activate_ix(&ctx, &funder.pubkey(), &funder.pubkey());
    expect_err(h.send(&[ix], &[&funder]), DropError::WrongFeeWallet);
}

#[test]
fn activate_sol_drop_with_token_accounts_fails_s6_0() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 10);
    expect_ok(h.fund(&ctx, SOL));
    let mint = h.create_mint();
    let pretend = DropCtx { mint: Some(mint), vault: Some(ata_address(&ctx.drop, &mint, &TOKEN_PROGRAM)), ..ctx };
    expect_fail(h.activate(&pretend));
}

#[test]
fn activate_spl_drop_without_token_accounts_fails_s6_0() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(1, 1_000), 11);
    expect_ok(h.fund(&ctx, 1_000));
    let pretend = DropCtx { mint: None, vault: None, ..ctx };
    expect_err(h.activate(&pretend), DropError::AssetAccountsMismatch);
}

#[test]
fn activate_spl_drop_with_another_mint_fails_s6_0() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(1, 1_000), 12);
    expect_ok(h.fund(&ctx, 1_000));
    let other = h.create_mint();
    let other_vault = h.create_ata(&ctx.drop, &other, &TOKEN_PROGRAM);
    h.mint_to(&TOKEN_PROGRAM, &other, &other_vault, 1_000);
    let pretend = DropCtx { mint: Some(other), vault: Some(other_vault), ..ctx };
    expect_err(h.activate(&pretend), DropError::AssetAccountsMismatch);
}

// -- the fee, section 8 -----------------------------------------------------------------------

#[test]
fn fee_paid_to_fee_wallet_sol_s8_5() {
    let mut h = Harness::with_fee(100); // 1%
    let ctx = h.new_sol_drop(&receivers(2, SOL), 20);
    let d = h.drop_state(&ctx);
    assert_eq!(d.fee_amount, 2 * SOL / 100);
    let gross = d.gross_required;
    expect_ok(h.fund(&ctx, gross));

    let before = h.lamports(&h.fee_wallet.pubkey());
    let meta = expect_ok(h.activate(&ctx));
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()) - before, d.fee_amount);
    assert_eq!(h.spendable(&ctx), 2 * SOL, "I3 after the fee left");
    assert_eq!(find_event::<Activated>(&meta.logs).unwrap().fee_paid, d.fee_amount);
}

#[test]
fn a_token_drop_pays_no_token_fee_s8_11() {
    // 1 percent in the config, and still nothing of the token goes to us.
    let mut h = Harness::with_fee(100);
    let ctx = h.new_spl_drop(&receivers(2, 1_000_000), 21);
    let d = h.drop_state(&ctx);
    assert_eq!(d.fee_amount, 0, "");
    assert_eq!(d.gross_required, 2_000_000);
    h.fund_and_activate(&ctx);

    let fee_ata = ata_address(&h.fee_wallet.pubkey(), &ctx.mint.unwrap(), &TOKEN_PROGRAM);
    assert!(!h.exists(&fee_ata), "no fee token account");
    assert_eq!(h.token_balance(&ctx.vault.unwrap()), 2_000_000);
}

#[test]
fn fee_underfunded_by_the_fee_amount_fails_s8_3() {
    let mut h = Harness::with_fee(100);
    let ctx = h.new_sol_drop(&receivers(2, SOL), 22);
    expect_ok(h.fund(&ctx, 2 * SOL)); // entitlements only, not the fee
    expect_err(h.activate(&ctx), DropError::Underfunded);
}

#[test]
fn zero_fee_path_moves_nothing_s8_4() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 23);
    expect_ok(h.fund(&ctx, SOL));
    let before = h.lamports(&h.fee_wallet.pubkey());
    expect_ok(h.activate(&ctx));
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()), before);
}

#[test]
fn fee_bps_change_after_creation_does_not_touch_the_drop_s8_7() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 24);
    let admin = h.deployer.insecure_clone();
    expect_ok(h.set_default_fee_bps(&admin, 500));
    expect_ok(h.fund(&ctx, SOL));
    expect_ok(h.activate(&ctx));
    assert_eq!(h.drop_state(&ctx).fee_amount, 0);
}
