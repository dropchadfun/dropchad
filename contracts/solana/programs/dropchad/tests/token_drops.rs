//! Token drops: the fee in SOL, the
//! account budget, the SOL side back to the sender, the
//! three new `Drop` fields (5.2 fields 20 to 22), and one whole Token-2022 life.

mod common;

use common::spl::*;
use common::*;
use dropchad::state::DropStatus;
use dropchad::{Drop, DropError};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// the hard cap, from the text.
const ONE_SOL_CAP: u64 = 1_000_000_000;
const FEE: u64 = 50_000_000; // 0.05 SOL

fn rent_classic(h: &Harness) -> u64 {
    h.rent_for(TOKEN_ACCOUNT_LEN)
}

fn rent_2022(h: &Harness) -> u64 {
    h.rent_for(TOKEN_2022_ACCOUNT_LEN)
}

/// A classic token drop of `n` receivers with the SOL fee `FEE`, funded on both sides, active.
fn active_token_drop(h: &mut Harness, n: usize, tag: u8) -> DropCtx {
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(n, 1_000_000), mint, tag, FEE);
    h.fund_and_activate(&ctx);
    ctx
}

// -- the constants, 6.12 ----------------------------------------------------------------------

#[test]
fn the_constants_match_the_spec_6_12() {
    assert_eq!(dropchad::MAX_SOL_FEE_LAMPORTS, ONE_SOL_CAP);
    assert_eq!(dropchad::TOKEN_ACCOUNT_SIZE, TOKEN_ACCOUNT_LEN);
    assert_eq!(dropchad::TOKEN_2022_ACCOUNT_SIZE, TOKEN_2022_ACCOUNT_LEN);
}

// -- the layout, 5.2 fields 20 to 22 ----------------------------------------------------------

#[test]
fn the_new_fields_sit_where_the_old_tail_began_5_2() {
    // A drop written before the upgrade has zeros from byte 360 on, so it reads zero in all
    // three fields. Pinned by writing each offset and reading the field back.
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 1);
    assert_eq!(Drop::SIZE, 424, "the account does not grow");
    let mut account = h.svm.get_account(&ctx.drop).unwrap();
    assert_eq!(&account.data[360..424], &[0u8; 64][..], "a SOL drop: all zero");
    account.data[360..368].copy_from_slice(&1u64.to_le_bytes());
    account.data[368..376].copy_from_slice(&2u64.to_le_bytes());
    account.data[376..384].copy_from_slice(&3u64.to_le_bytes());
    h.svm.set_account(ctx.drop, account).unwrap();
    let d = h.drop_state(&ctx);
    assert_eq!((d.sol_fee_lamports, d.account_budget_lamports, d.account_budget_used), (1, 2, 3));
    assert_eq!(d.reserved, [0u8; 40]);
}

#[test]
fn a_drop_from_before_the_upgrade_still_works_5_2() {
    // A SOL drop whose spare bytes are all zero runs its whole life, as the 424 byte devnet
    // drop will after the upgrade.
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 2);
    h.patch_drop(&ctx, |d| {
        d.sol_fee_lamports = 0;
        d.account_budget_lamports = 0;
        d.account_budget_used = 0;
    });
    h.fund_and_activate(&ctx);
    expect_ok(h.claim(&ctx, 0));
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&ctx));
    expect_ok(h.close(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), SOL);
}

// -- create_drop and the effects -----------------------------------------------------

#[test]
fn sol_fee_above_the_cap_fails_s6_1_14() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let mut ctx = h.prepare(&receivers(1, 1_000), Some(mint), 10, 0);
    ctx.params.sol_fee_lamports = ONE_SOL_CAP + 1;
    expect_err(h.send_create(&ctx), DropError::SolFeeTooHigh);
    assert!(!h.exists(&ctx.drop));
}

#[test]
fn sol_fee_at_the_cap_passes_s6_1_14() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(1, 1_000), mint, 11, ONE_SOL_CAP);
    assert_eq!(h.drop_state(&ctx).sol_fee_lamports, ONE_SOL_CAP);
}

#[test]
fn zero_sol_fee_on_a_token_drop_passes_s6_1_14() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(1, 1_000), mint, 12, 0);
    assert_eq!(h.drop_state(&ctx).sol_fee_lamports, 0);
}

#[test]
fn a_sol_fee_on_a_sol_drop_fails_s6_1_14() {
    let mut h = Harness::new();
    let mut ctx = h.prepare(&receivers(1, SOL), None, 13, 0);
    ctx.params.sol_fee_lamports = 1;
    expect_err(h.send_create(&ctx), DropError::SolFeeTooHigh);
}

#[test]
fn a_sol_drop_has_zero_in_the_new_fields_s6_1_effects_4() {
    let mut h = Harness::with_fee(100);
    let ctx = h.new_sol_drop(&receivers(3, SOL), 14);
    let d = h.drop_state(&ctx);
    assert_eq!((d.sol_fee_lamports, d.account_budget_lamports, d.account_budget_used), (0, 0, 0));
    assert_eq!(d.fee_amount, 3 * SOL / 100, "a SOL drop keeps its bps fee");
}

#[test]
fn a_token_drop_stores_its_fee_and_no_token_fee_s8_11_s8_15() {
    let mut h = Harness::with_fee(100);
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(3, 1_000_000), mint, 15, FEE);
    let d = h.drop_state(&ctx);
    assert_eq!(d.sol_fee_lamports, FEE);
    assert_eq!(d.fee_amount, 0);
    assert_eq!(d.gross_required, d.total_entitlements);
    assert_eq!(d.account_budget_used, 0);
}

#[test]
fn the_budget_is_leaf_count_times_a_classic_account_s8_19() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(7, 1_000), mint, 16, 0);
    assert_eq!(h.drop_state(&ctx).account_budget_lamports, 7 * rent_classic(&h));
}

#[test]
fn the_budget_is_leaf_count_times_a_token_2022_account_s8_19() {
    let mut h = Harness::new();
    let mint = h.create_pump_mint();
    let ctx = h.new_token_drop(&receivers(7, 1_000), mint, 17, 0);
    assert_eq!(h.drop_state(&ctx).account_budget_lamports, 7 * rent_2022(&h));
}

// -- activate --------------------------------------------------------------

#[test]
fn activate_sends_the_sol_fee_and_no_token_s6_2_4() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(3, 1_000_000), mint, 20, FEE);
    let budget = h.drop_state(&ctx).account_budget_lamports;
    expect_ok(h.fund(&ctx, 3_000_000));
    expect_ok(h.fund_lamports(&ctx, FEE + budget));

    let fee_before = h.lamports(&h.fee_wallet.pubkey());
    expect_ok(h.activate(&ctx));
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()) - fee_before, FEE, "exactly the SOL fee");
    assert_eq!(h.token_balance(&ctx.vault.unwrap()), 3_000_000, "every token stays for the crowd");
    assert!(!h.exists(&ata_address(&h.fee_wallet.pubkey(), &mint, &TOKEN_PROGRAM)));
    assert_eq!(h.spendable(&ctx), budget, "the budget stays in the drop, I3b");
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Active);
}

#[test]
fn activate_one_lamport_short_of_the_sol_side_fails_s6_2_3() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(3, 1_000_000), mint, 21, FEE);
    let sol_side = h.sol_side(&ctx);
    expect_ok(h.fund(&ctx, 3_000_000));
    expect_ok(h.fund_lamports(&ctx, sol_side - 1));
    expect_err(h.activate(&ctx), DropError::Underfunded);
}

#[test]
fn activate_one_unit_short_of_the_tokens_fails_s6_2_3() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(3, 1_000_000), mint, 22, FEE);
    let sol_side = h.sol_side(&ctx);
    expect_ok(h.fund(&ctx, 3_000_000 - 1));
    expect_ok(h.fund_lamports(&ctx, sol_side));
    expect_err(h.activate(&ctx), DropError::Underfunded);
}

#[test]
fn activate_with_tokens_but_no_sol_fails_s6_2_3() {
    // The budget alone is not zero, so a sender who sends only the tokens cannot activate.
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(2, 1_000_000), mint, 23, 0);
    expect_ok(h.fund(&ctx, 2_000_000));
    expect_err(h.activate(&ctx), DropError::Underfunded);
}

// -- claim ---------------------------------------------------------------------------

#[test]
fn a_claim_that_creates_the_account_pays_the_caller_back_s6_3_13() {
    let mut h = Harness::new();
    let ctx = active_token_drop(&mut h, 3, 30);
    let relayer_before = h.lamports(&h.relayer.pubkey());
    let drop_before = h.lamports(&ctx.drop);
    expect_ok(h.claim(&ctx, 0));
    let rent = rent_classic(&h);
    assert_eq!(drop_before - h.lamports(&ctx.drop), rent);
    assert_eq!(h.drop_state(&ctx).account_budget_used, rent);
    assert!(relayer_before - h.lamports(&h.relayer.pubkey()) < 100_000, "the relayer paid only the fee");
    assert_eq!(h.holding(&ctx, &ctx.recipient(0)), 1_000_000);
}

#[test]
fn a_claim_to_an_existing_account_pays_nothing_back_s6_3_13() {
    let mut h = Harness::new();
    let ctx = active_token_drop(&mut h, 3, 31);
    h.create_ata(&ctx.recipient(1), &ctx.mint.unwrap(), &TOKEN_PROGRAM);
    let drop_before = h.lamports(&ctx.drop);
    expect_ok(h.claim(&ctx, 1));
    assert_eq!(h.lamports(&ctx.drop), drop_before);
    assert_eq!(h.drop_state(&ctx).account_budget_used, 0);
}

#[test]
fn the_pay_back_never_passes_the_budget_left_s6_3_13() {
    // Only half an account's rent left in the budget: the caller gets that half and no more.
    let mut h = Harness::new();
    let ctx = active_token_drop(&mut h, 3, 32);
    let rent = rent_classic(&h);
    h.patch_drop(&ctx, |d| d.account_budget_used = d.account_budget_lamports - rent / 2);
    let drop_before = h.lamports(&ctx.drop);
    expect_ok(h.claim(&ctx, 0));
    let d = h.drop_state(&ctx);
    assert_eq!(d.account_budget_used, d.account_budget_lamports, "never above the budget");
    assert_eq!(drop_before - h.lamports(&ctx.drop), rent / 2);
}

#[test]
fn a_claim_with_the_budget_spent_still_pays_the_receiver_s6_3_13() {
    let mut h = Harness::new();
    let ctx = active_token_drop(&mut h, 3, 33);
    h.patch_drop(&ctx, |d| d.account_budget_used = d.account_budget_lamports);
    let drop_before = h.lamports(&ctx.drop);
    expect_ok(h.claim(&ctx, 0));
    assert_eq!(h.lamports(&ctx.drop), drop_before, "nothing left to pay back");
    assert_eq!(h.holding(&ctx, &ctx.recipient(0)), 1_000_000);
}

#[test]
fn a_sol_drop_claim_never_touches_the_budget_s6_3_13() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 34);
    h.fund_and_activate(&ctx);
    expect_ok(h.claim(&ctx, 0));
    assert_eq!(h.drop_state(&ctx).account_budget_used, 0);
}

// -- the SOL side back to the sender -----------------------------------------

#[test]
fn cancel_unfunded_returns_the_fee_and_the_budget_s6_8_5() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(3, 1_000_000), mint, 40, FEE);
    let sol_side = h.sol_side(&ctx);
    assert_eq!(sol_side, FEE + 3 * rent_classic(&h), "the fee and three accounts of budget");
    expect_ok(h.fund(&ctx, 3_000_000));
    expect_ok(h.fund_lamports(&ctx, sol_side));
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline + 1);

    let fee_before = h.lamports(&h.fee_wallet.pubkey());
    expect_ok(h.cancel(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), sol_side, "the fee too: never activated");
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()), fee_before, "no fee without activation");
    assert_eq!(h.holding(&ctx, &ctx.refund_recipient), 3_000_000);
    assert_eq!(h.spendable(&ctx), 0);
}

#[test]
fn refund_returns_the_budget_left_s6_8_5() {
    let mut h = Harness::new();
    let ctx = active_token_drop(&mut h, 3, 41);
    expect_ok(h.claim(&ctx, 0)); // one new account, one rent out of the budget
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient), 2 * rent_classic(&h));
    assert_eq!(h.holding(&ctx, &ctx.refund_recipient), 2_000_000);
    assert_eq!(h.spendable(&ctx), 0, "I12");
}

#[test]
fn close_drop_sends_late_lamports_to_the_sender_s6_10_2() {
    let mut h = Harness::new();
    let ctx = active_token_drop(&mut h, 2, 42);
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&ctx));
    let refunded = h.lamports(&ctx.refund_recipient);

    expect_ok(h.fund_lamports(&ctx, 1_234_567));
    expect_ok(h.close(&ctx));
    assert_eq!(h.lamports(&ctx.refund_recipient) - refunded, 1_234_567);
    assert_eq!(h.lamports(&ctx.drop), h.rent_for(Drop::SIZE), "I12: exactly its rent");
}

#[test]
fn the_new_fields_never_change_but_the_used_one_i5() {
    let mut h = Harness::new();
    let ctx = active_token_drop(&mut h, 3, 43);
    let d0 = h.drop_state(&ctx);
    expect_ok(h.claim(&ctx, 0));
    let deadline = d0.claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&ctx));
    expect_ok(h.close(&ctx));
    let d1 = h.drop_state(&ctx);
    assert_eq!((d1.sol_fee_lamports, d1.account_budget_lamports), (d0.sol_fee_lamports, d0.account_budget_lamports));
    assert_eq!(d1.account_budget_used, rent_classic(&h));
}

// -- one whole Token-2022 life ----------------------------------------------------------------

#[test]
fn a_token_2022_drop_runs_its_whole_life_s12_3_s12_4() {
    let mut h = Harness::with_fee(100);
    let mint = h.create_pump_mint();
    let ctx = h.new_token_drop(&receivers(3, 1_000_000), mint, 50, FEE);
    assert_eq!(ctx.token_program, TOKEN_2022_PROGRAM);
    let d = h.drop_state(&ctx);
    assert_eq!(d.vault, ata_address(&ctx.drop, &mint, &TOKEN_2022_PROGRAM));
    assert_eq!(d.account_budget_lamports, 3 * rent_2022(&h));

    let fee_before = h.lamports(&h.fee_wallet.pubkey());
    h.fund_and_activate(&ctx);
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()) - fee_before, FEE);

    expect_ok(h.claim(&ctx, 0));
    expect_ok(h.claim(&ctx, 2));
    assert_eq!(h.holding(&ctx, &ctx.recipient(0)), 1_000_000);
    assert_eq!(h.holding(&ctx, &ctx.recipient(2)), 1_000_000);
    assert_eq!(h.drop_state(&ctx).account_budget_used, 2 * rent_2022(&h));

    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&ctx));
    assert_eq!(h.holding(&ctx, &ctx.refund_recipient), 1_000_000, "the unclaimed leaf");
    assert_eq!(h.lamports(&ctx.refund_recipient), rent_2022(&h), "the budget left");

    let relayer_before = h.lamports(&h.relayer.pubkey());
    expect_ok(h.close(&ctx));
    assert!(!h.exists(&ctx.vault.unwrap()), "the vault is closed");
    assert!(h.lamports(&h.relayer.pubkey()) > relayer_before, "its rent to the rent payer");
    assert!(h.drop_state(&ctx).closed);
}

#[test]
fn a_token_2022_claim_is_a_checked_transfer_of_the_right_mint_s12_4() {
    // The receiver's account is a Token-2022 account of the drop's mint.
    let mut h = Harness::new();
    let mint = h.create_pump_mint();
    let ctx = h.new_token_drop(&receivers(1, 7_000), mint, 51, 0);
    h.fund_and_activate(&ctx);
    expect_ok(h.claim(&ctx, 0));
    let ata = ata_address(&ctx.recipient(0), &mint, &TOKEN_2022_PROGRAM);
    let account = h.svm.get_account(&ata).unwrap();
    assert_eq!(account.owner, TOKEN_2022_PROGRAM);
    assert_eq!(account.data.len(), TOKEN_2022_ACCOUNT_LEN);
    assert_eq!(token_amount(&account.data), 7_000);
}

#[test]
fn a_stranger_cannot_take_the_budget_s6_3_13() {
    // A caller who is not the relayer claims for a receiver who already has an account: no
    // pay back to anyone, the budget is untouched.
    let mut h = Harness::new();
    let ctx = active_token_drop(&mut h, 2, 52);
    h.create_ata(&ctx.recipient(0), &ctx.mint.unwrap(), &TOKEN_PROGRAM);
    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let ix = h.claim_ix(&ctx, &stranger.pubkey(), 0, &ctx.recipient(0), ctx.amount(0), ctx.proof(0));
    let before = h.lamports(&stranger.pubkey());
    expect_ok(h.send(&[ix], &[&stranger]));
    assert!(h.lamports(&stranger.pubkey()) < before, "the stranger only paid the fee");
    assert_eq!(h.drop_state(&ctx).account_budget_used, 0);
}
