//! `create_drop`.

mod common;

use anchor_lang::prelude::Pubkey;
use common::spl::*;
use common::*;
use dropchad::events::DropCreated;
use dropchad::state::{CreateParams, DropStatus};
use dropchad::{ClaimBitmap, Drop, DropError, MAX_CLAIM_PERIOD, MAX_FEE_BPS, MAX_FUNDING_PERIOD, MAX_LEAVES, MIN_CLAIM_PERIOD, MIN_FUNDING_PERIOD};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn params_with(ctx: &DropCtx, f: impl FnOnce(&mut CreateParams)) -> CreateParams {
    let mut p = ctx.params.clone();
    f(&mut p);
    p
}

// -- happy paths -------------------------------------------------------------------------------

#[test]
fn create_sol_drop_happy_path() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(3, SOL), None, 1, 7);
    let before = h.lamports(&h.relayer.pubkey());
    let meta = expect_ok(h.send_create(&ctx));

    let d = h.drop_state(&ctx);
    assert_eq!(d.asset, Pubkey::default(), "SOL");
    assert_eq!(d.vault, Pubkey::default());
    assert_eq!(d.merkle_root, ctx.params.merkle_root);
    assert_eq!(d.manifest_hash, ctx.params.manifest_hash);
    assert_eq!(d.total_entitlements, ctx.total());
    assert_eq!(d.gross_required, ctx.total(), "zero fee");
    assert_eq!(d.fee_amount, 0);
    assert_eq!(d.fee_wallet, h.fee_wallet.pubkey(), "snapshotted from the config");
    assert_eq!(d.refund_recipient, ctx.refund_recipient);
    assert_eq!(d.created_at, T0);
    assert_eq!(d.funding_deadline, T0 + FUNDING_PERIOD as i64);
    assert_eq!(d.claim_period, CLAIM_PERIOD);
    assert_eq!(d.creator_commitment, ctx.params.creator_commitment);
    assert_eq!(d.nonce, 7);
    assert_eq!(d.leaf_count, 3);
    assert_eq!(d.chain_id, DEVNET_CHAIN_ID, "copied from the config");
    assert_eq!(d.rent_payer, h.relayer.pubkey(), "");
    assert_eq!(d.bump, ctx.bump, "stored bump");
    assert_eq!(d.bitmap_bump, ctx.bitmap_bump);
    assert_eq!(d.activated_at, 0, "");
    assert_eq!(d.claim_deadline, 0, "");
    assert_eq!(d.status, DropStatus::Created);
    assert_eq!(d.total_claimed, 0);
    assert_eq!(d.claimed_count, 0);
    assert!(!d.closed);

    let b = h.bitmap_state(&ctx);
    assert_eq!(b.drop, ctx.drop);
    assert_eq!(b.bump, ctx.bitmap_bump);
    assert!(b.bits.iter().all(|x| *x == 0));

    // the relayer paid exactly the two rents plus the fee, 5.7
    let drop_rent = h.rent_for(Drop::SIZE);
    let bitmap_rent = h.rent_for(ClaimBitmap::SIZE);
    let spent = before - h.lamports(&h.relayer.pubkey());
    assert!(spent >= drop_rent + bitmap_rent, "spent {spent}, rents {}", drop_rent + bitmap_rent);
    assert!(spent < drop_rent + bitmap_rent + 100_000, "only a transaction fee on top");
    assert_eq!(h.spendable(&ctx), 0, "nothing spendable before funding");

    let ev: DropCreated = find_event(&meta.logs).expect("DropCreated");
    assert_eq!(ev.drop, ctx.drop);
    assert_eq!(ev.rent_payer, h.relayer.pubkey());
}

#[test]
fn create_spl_drop_happy_path() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.prepare(&receivers(3, 1_000_000), Some(mint), 1, 0);
    let before = h.lamports(&h.relayer.pubkey());
    expect_ok(h.send_create(&ctx));

    let d = h.drop_state(&ctx);
    assert_eq!(d.asset, mint);
    assert_eq!(d.vault, ctx.vault.unwrap());
    assert_eq!(d.vault, ata_address(&ctx.drop, &mint, &TOKEN_PROGRAM), "");
    assert!(h.exists(&d.vault), "vault created in the same instruction");
    assert_eq!(h.token_balance(&d.vault), 0);

    let rents = h.rent_for(Drop::SIZE) + h.rent_for(ClaimBitmap::SIZE) + h.rent_for(TOKEN_ACCOUNT_LEN);
    let spent = before - h.lamports(&h.relayer.pubkey());
    assert!(spent >= rents && spent < rents + 100_000, "spent {spent}, rents {rents}");
}

#[test]
fn account_sizes_match_spec_5_6() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 1);
    assert_eq!(h.svm.get_account(&ctx.drop).unwrap().data.len(), 424);
    assert_eq!(h.svm.get_account(&ctx.bitmap).unwrap().data.len(), 1291);
    assert_eq!(Drop::SIZE, 424); // 360 plus the 64 byte reserved tail
    assert_eq!(ClaimBitmap::SIZE, 1291);
}

#[test]
fn drop_created_event_fields_match_inputs_s11_1() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(2, SOL), None, 9, 3);
    let meta = expect_ok(h.send_create(&ctx));
    let ev: DropCreated = find_event(&meta.logs).expect("DropCreated");
    assert_eq!(ev.creator_commitment, ctx.params.creator_commitment);
    assert_eq!(ev.asset, Pubkey::default());
    assert_eq!(ev.vault, Pubkey::default());
    assert_eq!(ev.merkle_root, ctx.params.merkle_root);
    assert_eq!(ev.manifest_hash, ctx.params.manifest_hash);
    assert_eq!(ev.total_entitlements, ctx.total());
    assert_eq!(ev.fee_amount, 0);
    assert_eq!(ev.gross_required, ctx.total());
    assert_eq!(ev.fee_wallet, h.fee_wallet.pubkey());
    assert_eq!(ev.refund_recipient, ctx.refund_recipient);
    assert_eq!(ev.funding_deadline, T0 + FUNDING_PERIOD as i64);
    assert_eq!(ev.claim_period, CLAIM_PERIOD);
    assert_eq!(ev.leaf_count, 2);
    assert_eq!(ev.chain_id, DEVNET_CHAIN_ID);
    assert_eq!(ev.nonce, 3);
    assert_eq!(ev.created_at, T0);
}

#[test]
fn address_matches_off_chain_prediction_s3_1() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(2, SOL), None, 2, 42);
    let (predicted, _) = drop_pda(&commitment(2), 42);
    assert_eq!(ctx.drop, predicted);
    expect_ok(h.send_create(&ctx));
    assert!(h.account::<Drop>(&predicted).is_some());
}

#[test]
fn same_commitment_different_nonce_is_a_different_drop() {
    let mut h = Harness::new();
    let a = h.prepare(&receivers(1, SOL), None, 3, 0);
    let b = h.prepare(&receivers(1, SOL), None, 3, 1);
    assert_ne!(a.drop, b.drop);
    expect_ok(h.send_create(&a));
    expect_ok(h.send_create(&b));
}

// --, PDA reuse ---------------------------------------------------------------------------

#[test]
fn same_seeds_twice_fails_s3_2() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 4, 0);
    expect_ok(h.send_create(&ctx));
    let again = h.prepare(&receivers(5, SOL), None, 4, 0);
    assert_eq!(again.drop, ctx.drop);
    expect_fail(h.send_create(&again));
    assert_eq!(h.drop_state(&ctx).leaf_count, 1, "the first drop is untouched");
}

// --, signer ----------------------------------------------------------------------------

#[test]
fn non_relayer_signer_fails_s6_1_0() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 5, 0);
    let stranger = h.funder.insecure_clone();
    let ix = h.create_drop_ix(&ctx, &stranger.pubkey(), &ctx.params);
    expect_err(h.send(&[ix], &[&stranger]), DropError::NotRelayer);
}

#[test]
fn relayer_key_without_signature_fails_s6_1_0() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 5, 0);
    let funder = h.funder.insecure_clone();
    let mut ix = h.create_drop_ix(&ctx, &h.relayer.pubkey(), &ctx.params);
    ix.accounts[0].is_signer = false;
    // the funder pays and signs, the relayer key is present but does not sign
    expect_fail(h.send(&[ix], &[&funder]));
}

// --, parameter checks -------------------------------------------------------

#[test]
fn paused_fails_s6_1_1() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_ok(h.set_paused(&admin, true));
    let ctx = h.prepare(&receivers(1, SOL), None, 6, 0);
    expect_err(h.send_create(&ctx), DropError::CreationPaused);
}

#[test]
fn zero_total_fails_s6_1_2() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 7, 0);
    let p = params_with(&ctx, |p| p.total_entitlements = 0);
    expect_err(h.send_create_with(&ctx, p), DropError::ZeroTotal);
}

#[test]
fn zero_leaf_count_fails_s6_1_3() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 8, 0);
    let p = params_with(&ctx, |p| p.leaf_count = 0);
    expect_err(h.send_create_with(&ctx, p), DropError::BadLeafCount);
}

#[test]
fn max_leaves_works_and_one_more_fails_s6_1_3() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 9, 0);
    let p = params_with(&ctx, |p| p.leaf_count = MAX_LEAVES);
    expect_ok(h.send_create_with(&ctx, p));
    assert_eq!(h.drop_state(&ctx).leaf_count, 10_000);

    let ctx2 = h.prepare(&receivers(1, SOL), None, 10, 0);
    let p = params_with(&ctx2, |p| p.leaf_count = MAX_LEAVES + 1);
    expect_err(h.send_create_with(&ctx2, p), DropError::BadLeafCount);
}

#[test]
fn zero_root_fails_s6_1_4() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 11, 0);
    let p = params_with(&ctx, |p| p.merkle_root = [0; 32]);
    expect_err(h.send_create_with(&ctx, p), DropError::ZeroRoot);
}

#[test]
fn zero_manifest_fails_s6_1_5() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 12, 0);
    let p = params_with(&ctx, |p| p.manifest_hash = [0; 32]);
    expect_err(h.send_create_with(&ctx, p), DropError::ZeroManifest);
}

#[test]
fn zero_refund_recipient_fails_s6_1_6() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 13, 0);
    let p = params_with(&ctx, |p| p.refund_recipient = Pubkey::default());
    expect_err(h.send_create_with(&ctx, p), DropError::ZeroRefundRecipient);
}

#[test]
fn zero_commitment_fails_s6_1_7() {
    let mut h = Harness::new();
    // the PDA must be derived from the zero commitment too, or the seeds check fires first
    let (drop, bump) = drop_pda(&[0; 32], 0);
    let (bitmap, bitmap_bump) = bitmap_pda(&drop);
    let base = h.prepare(&receivers(1, SOL), None, 14, 0);
    let ctx = DropCtx { drop, bump, bitmap, bitmap_bump, mint: None, vault: None, token_program: TOKEN_PROGRAM, refund_recipient: base.refund_recipient, params: base.params.clone(), tree: base.tree };
    let p = params_with(&ctx, |p| p.creator_commitment = [0; 32]);
    expect_err(h.send_create_with(&ctx, p), DropError::ZeroCommitment);
}

#[test]
fn funding_period_bounds_s6_1_8() {
    let mut h = Harness::new();
    for (tag, period, ok) in [
        (20u8, MIN_FUNDING_PERIOD - 1, false),
        (21, MIN_FUNDING_PERIOD, true),
        (22, MAX_FUNDING_PERIOD, true),
        (23, MAX_FUNDING_PERIOD + 1, false),
        (24, 0, false),
    ] {
        let ctx = h.prepare(&receivers(1, SOL), None, tag, 0);
        let p = params_with(&ctx, |p| p.funding_period = period);
        let res = h.send_create_with(&ctx, p);
        if ok {
            expect_ok(res);
            assert_eq!(h.drop_state(&ctx).funding_deadline, T0 + period as i64);
        } else {
            expect_err(res, DropError::BadFundingPeriod);
        }
    }
}

#[test]
fn claim_period_bounds_s6_1_9() {
    let mut h = Harness::new();
    for (tag, period, ok) in [
        (30u8, MIN_CLAIM_PERIOD - 1, false),
        (31, MIN_CLAIM_PERIOD, true),
        (32, MAX_CLAIM_PERIOD, true),
        (33, MAX_CLAIM_PERIOD + 1, false),
    ] {
        let ctx = h.prepare(&receivers(1, SOL), None, tag, 0);
        let p = params_with(&ctx, |p| p.claim_period = period);
        let res = h.send_create_with(&ctx, p);
        if ok {
            expect_ok(res);
            assert_eq!(h.drop_state(&ctx).claim_period, period);
        } else {
            expect_err(res, DropError::BadClaimPeriod);
        }
    }
}

// -- the fee at creation, 8 -------------------------------------------------------------------

#[test]
fn fee_amount_computed_from_config_bps_and_rounds_down_s8_2() {
    let mut h = Harness::with_fee(150); // 1.5%
    let ctx = h.new_sol_drop(&[(Keypair::new().pubkey(), 1_000_000_001)], 40);
    let d = h.drop_state(&ctx);
    // 1_000_000_001 × 150 / 10_000 = 15_000_000.015 → 15_000_000
    assert_eq!(d.fee_amount, 15_000_000);
    assert_eq!(d.gross_required, 1_000_000_001 + 15_000_000, "I7");
}

#[test]
fn fee_at_max_bps_does_not_overflow_on_a_huge_total_s6_1_effects() {
    let mut h = Harness::with_fee(MAX_FEE_BPS);
    let total = u64::MAX / 2;
    let ctx = h.prepare(&[(Keypair::new().pubkey(), 1)], None, 41, 0);
    let p = params_with(&ctx, |p| p.total_entitlements = total);
    expect_ok(h.send_create_with(&ctx, p));
    let d = h.drop_state(&ctx);
    assert_eq!(d.fee_amount, ((total as u128) * 500 / 10_000) as u64);
    assert_eq!(d.gross_required, total + d.fee_amount);
}

#[test]
fn gross_required_overflow_fails_s6_1_effects_2() {
    let mut h = Harness::with_fee(MAX_FEE_BPS);
    let ctx = h.prepare(&[(Keypair::new().pubkey(), 1)], None, 42, 0);
    let p = params_with(&ctx, |p| p.total_entitlements = u64::MAX);
    expect_err(h.send_create_with(&ctx, p), DropError::Overflow);
}

#[test]
fn fee_recipient_is_snapshotted_at_creation_s8_7() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 43);
    let admin = h.deployer.insecure_clone();
    expect_ok(h.set_fee_wallet(&admin, Keypair::new().pubkey()));
    assert_eq!(h.drop_state(&ctx).fee_wallet, h.fee_wallet.pubkey(), "unchanged");
}

// --, the asset check. The full set is in malicious_mints.rs --------------------------

#[test]
fn spl_drop_with_no_mint_but_a_vault_fails_s6_0() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let full = h.prepare(&receivers(1, 1_000), Some(mint), 44, 0);
    let ctx = DropCtx { mint: None, ..full };
    // vault is Some, mint is None
    expect_fail(h.send_create(&ctx));
}
