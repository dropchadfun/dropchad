//! Account substitution, S-, S-, S-, S-, S-.
//! Every test swaps one account for a wrong one and asserts the transaction fails and nothing
//! moved. Where Anchor names the failure, the code is asserted; otherwise only the failure.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::AccountSerialize;
use common::spl::*;
use common::*;
use dropchad::{ClaimBitmap, Drop, DropError};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Anchor error codes used below.
const CONSTRAINT_SEEDS: u32 = 2006;
const ACCOUNT_OWNED_BY_WRONG_PROGRAM: u32 = 3007;

fn two_active_sol_drops(h: &mut Harness) -> (DropCtx, DropCtx) {
    let a = h.new_sol_drop(&receivers(2, SOL), 1);
    let b = h.new_sol_drop(&receivers(2, SOL), 2);
    h.fund_and_activate(&a);
    h.fund_and_activate(&b);
    (a, b)
}

// -- S-, the bitmap ---------------------------------------------------------------------------

#[test]
fn claim_with_another_drops_bitmap_fails() {
    let mut h = Harness::new();
    let (a, b) = two_active_sol_drops(&mut h);
    let relayer = h.relayer.insecure_clone();
    let mut ix = h.claim_ix(&a, &relayer.pubkey(), 0, &a.recipient(0), SOL, a.proof(0));
    ix.accounts[2].pubkey = b.bitmap;
    expect_anchor_err(h.send(&[ix], &[&relayer]), CONSTRAINT_SEEDS);
    assert!(!h.is_claimed(&a, 0));
    assert!(!h.is_claimed(&b, 0));
}

#[test]
fn claim_with_a_random_account_as_bitmap_fails() {
    let mut h = Harness::new();
    let (a, _) = two_active_sol_drops(&mut h);
    let relayer = h.relayer.insecure_clone();
    let mut ix = h.claim_ix(&a, &relayer.pubkey(), 0, &a.recipient(0), SOL, a.proof(0));
    ix.accounts[2].pubkey = h.funder.pubkey();
    expect_fail(h.send(&[ix], &[&relayer]));
    assert!(!h.is_claimed(&a, 0));
}

#[test]
fn close_with_another_drops_bitmap_fails() {
    let mut h = Harness::new();
    let a = h.finished_sol_drop(3);
    let b = h.finished_sol_drop(4);
    let funder = h.funder.insecure_clone();
    let mut ix = h.close_ix(&a, &funder.pubkey(), &h.relayer.pubkey(), &a.refund_recipient);
    ix.accounts[2].pubkey = b.bitmap;
    expect_anchor_err(h.send(&[ix], &[&funder]), CONSTRAINT_SEEDS);
    assert!(h.exists(&a.bitmap));
    assert!(h.exists(&b.bitmap));
}

// -- S-, the vault --------------------------------------------------------------------------

#[test]
fn activate_with_another_drops_vault_fails() {
    let mut h = Harness::new();
    let a = h.new_spl_drop(&receivers(1, 1_000), 5);
    let b = h.new_spl_drop(&receivers(1, 1_000), 6);
    expect_ok(h.fund(&b, 1_000)); // b is funded, a is not
    let funder = h.funder.insecure_clone();
    let mut ix = h.activate_ix(&a, &funder.pubkey(), &h.fee_wallet.pubkey());
    // account order: caller, drop, fee_wallet, mint, vault, ...
    ix.accounts[3].pubkey = b.mint.unwrap();
    ix.accounts[4].pubkey = b.vault.unwrap();
    expect_fail(h.send(&[ix], &[&funder]));
    assert_eq!(h.drop_state(&a).status, dropchad::DropStatus::Created);
}

#[test]
fn claim_with_a_vault_for_another_mint_fails() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(2, 1_000), 7);
    h.fund_and_activate(&ctx);
    let other = h.create_mint();
    let other_vault = h.create_ata(&ctx.drop, &other, &TOKEN_PROGRAM);
    h.mint_to(&TOKEN_PROGRAM, &other, &other_vault, 1_000);
    let relayer = h.relayer.insecure_clone();
    let mut ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), 1_000, ctx.proof(0));
    // vault only, mint stays the real one: the ATA derivation fails
    ix.accounts[5].pubkey = other_vault;
    expect_fail(h.send(&[ix], &[&relayer]));
    assert!(!h.is_claimed(&ctx, 0));
}

#[test]
fn refund_with_a_recipient_ata_that_is_not_the_ata_fails() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(1, 1_000), 8);
    h.fund_and_activate(&ctx);
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    // a plain token account for a stranger, right mint, not the refund recipient's associated one
    let thief_ata = h.create_plain_token_account(&ctx.mint.unwrap(), &Keypair::new().pubkey());
    let funder = h.funder.insecure_clone();
    let mut ix = h.settle_ix(&ctx, &funder.pubkey(), &ctx.refund_recipient, anchor_lang::InstructionData::data(&dropchad::instruction::Refund {}));
    // account order: caller, drop, refund_recipient, mint, vault, refund_ata, ...
    ix.accounts[5].pubkey = thief_ata;
    expect_fail(h.send(&[ix], &[&funder]));
    assert_eq!(h.token_balance(&ctx.vault.unwrap()), 1_000);
}

// -- S-, the config ---------------------------------------------------------------------------

#[test]
fn create_drop_with_a_config_at_another_address_fails() {
    let mut h = Harness::new();
    let ctx = h.prepare(&receivers(1, SOL), None, 9, 0);
    let relayer = h.relayer.insecure_clone();

    // a perfect copy of the config account, at a different address
    let real = h.svm.get_account(&h.config).unwrap();
    let fake = Keypair::new().pubkey();
    h.svm.set_account(fake, real).unwrap();

    let mut ix = h.create_drop_ix(&ctx, &relayer.pubkey(), &ctx.params);
    ix.accounts[1].pubkey = fake;
    expect_anchor_err(h.send(&[ix], &[&relayer]), CONSTRAINT_SEEDS);
    assert!(!h.exists(&ctx.drop));
}

#[test]
fn admin_call_with_a_forged_config_fails() {
    let mut h = Harness::new();
    let stranger = h.funder.insecure_clone();
    // a config that says the stranger is admin, at a different address
    let mut config = h.config_state();
    config.admin = stranger.pubkey();
    let mut data = Vec::new();
    config.try_serialize(&mut data).unwrap();
    let mut account = h.svm.get_account(&h.config).unwrap();
    account.data = data;
    let fake = Keypair::new().pubkey();
    h.svm.set_account(fake, account).unwrap();

    let mut ix = h.admin_ix(&stranger.pubkey(), anchor_lang::InstructionData::data(&dropchad::instruction::SetPaused { paused: true }));
    ix.accounts[1].pubkey = fake;
    expect_anchor_err(h.send(&[ix], &[&stranger]), CONSTRAINT_SEEDS);
    assert!(!h.config_state().paused);
}

// -- owner checks --------------------------------------------------------------------------

#[test]
fn drop_account_owned_by_another_program_fails() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 10);
    h.fund_and_activate(&ctx);
    // same bytes, owned by the System program, at the real PDA address
    let mut account = h.svm.get_account(&ctx.drop).unwrap();
    account.owner = SYSTEM_PROGRAM;
    h.svm.set_account(ctx.drop, account).unwrap();
    expect_anchor_err(h.claim(&ctx, 0), ACCOUNT_OWNED_BY_WRONG_PROGRAM);
}

#[test]
fn fake_drop_with_the_right_layout_at_a_random_address_fails() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 11);
    h.fund_and_activate(&ctx);
    let real = h.svm.get_account(&ctx.drop).unwrap();
    let fake = Keypair::new().pubkey();
    h.svm.set_account(fake, real).unwrap();
    let relayer = h.relayer.insecure_clone();
    let mut ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), SOL, ctx.proof(0));
    ix.accounts[1].pubkey = fake;
    expect_anchor_err(h.send(&[ix], &[&relayer]), CONSTRAINT_SEEDS);
}

#[test]
fn bitmap_with_a_wrong_discriminator_fails() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 12);
    h.fund_and_activate(&ctx);
    let mut account = h.svm.get_account(&ctx.bitmap).unwrap();
    account.data[0] ^= 0xff;
    h.svm.set_account(ctx.bitmap, account).unwrap();
    expect_fail(h.claim(&ctx, 0));
}

// -- S-, signers ------------------------------------------------------------------------------

#[test]
fn claim_without_a_caller_signature_fails() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 13);
    h.fund_and_activate(&ctx);
    let relayer = h.relayer.insecure_clone();
    let funder = h.funder.insecure_clone();
    let mut ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), SOL, ctx.proof(0));
    ix.accounts[0].is_signer = false;
    expect_fail(h.send(&[ix], &[&funder]));
}

// -- S-, seed collisions: the three prefixes never meet ---------------------------------------

#[test]
fn seed_prefixes_are_distinct_and_fixed_length_s3_5() {
    let commitment = commitment(14);
    let (drop, _) = drop_pda(&commitment, 0);
    let (bitmap, _) = bitmap_pda(&drop);
    let (config, _) = config_pda();
    assert_ne!(drop, bitmap);
    assert_ne!(drop, config);
    assert_ne!(bitmap, config);
    // the nonce is 8 fixed bytes: nonce 1 and nonce 256 are different drops, not a prefix game
    assert_ne!(drop_pda(&commitment, 1).0, drop_pda(&commitment, 256).0);
    // a commitment that happens to start with the bitmap prefix is still a drop
    let mut sneaky = [0u8; 32];
    sneaky[..6].copy_from_slice(b"bitmap");
    assert_ne!(drop_pda(&sneaky, 0).0, bitmap);
}

// -- S-, non canonical bump ------------------------------------------------------------------

#[test]
fn drop_at_a_non_canonical_bump_is_refused_s3_6() {
    // Find a second bump that produces a valid off-curve address and try to use it.
    let mut h = Harness::new();
    let commitment = commitment(15);
    let (canonical, canonical_bump) = drop_pda(&commitment, 0);
    let mut other = None;
    for bump in (0..canonical_bump).rev() {
        if let Ok(key) = Pubkey::create_program_address(
            &[dropchad::DROP_SEED, &commitment, &0u64.to_le_bytes(), &[bump]],
            &dropchad::ID,
        ) {
            other = Some(key);
            break;
        }
    }
    let other = other.expect("a second valid bump exists for nearly every seed");
    assert_ne!(other, canonical);

    let mut ctx = h.prepare(&receivers(1, SOL), None, 15, 0);
    ctx.drop = other;
    ctx.bitmap = bitmap_pda(&other).0;
    expect_anchor_err(h.send_create(&ctx), CONSTRAINT_SEEDS);
    assert!(!h.exists(&other));
}

// -- S-, rent to the caller ------------------------------------------------------------------

#[test]
fn close_never_pays_the_caller_s6_10_3() {
    let mut h = Harness::new();
    let ctx = h.finished_sol_drop(16);
    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let before = h.lamports(&stranger.pubkey());
    let ix = h.close_ix(&ctx, &stranger.pubkey(), &stranger.pubkey(), &ctx.refund_recipient);
    expect_err(h.send(&[ix], &[&stranger]), DropError::WrongRentPayer);
    assert!(h.lamports(&stranger.pubkey()) <= before);
}

// -- S-, init_if_needed on a token account that exists but is wrong ------------------------

#[test]
fn claim_with_an_existing_wrong_token_account_in_the_recipient_slot_fails() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(2, 1_000), 17);
    h.fund_and_activate(&ctx);
    let mint = ctx.mint.unwrap();
    // the funder's own token account for the mint, already existing
    let funder_ata = ata_address(&h.funder.pubkey(), &mint, &TOKEN_PROGRAM);
    let relayer = h.relayer.insecure_clone();
    let mut ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), 1_000, ctx.proof(0));
    ix.accounts[6].pubkey = funder_ata;
    expect_fail(h.send(&[ix], &[&relayer]));
    assert_eq!(h.token_balance(&funder_ata), 2_000, "nothing arrived");
    assert!(!h.is_claimed(&ctx, 0));
}

#[test]
fn state_types_round_trip_through_account_serialize() {
    // Sanity for the forgery helpers above: what we serialize is what the program reads.
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 18);
    let d = h.drop_state(&ctx);
    let mut bytes = Vec::new();
    d.try_serialize(&mut bytes).unwrap();
    assert_eq!(bytes, h.svm.get_account(&ctx.drop).unwrap().data);
    assert_eq!(bytes.len(), Drop::SIZE);
    // the bitmap is zero copy: no borsh round trip, the account is the bytes
    let b = h.bitmap_state(&ctx);
    assert_eq!(b.drop, ctx.drop);
    assert_eq!(h.svm.get_account(&ctx.bitmap).unwrap().data.len(), ClaimBitmap::SIZE);
}
