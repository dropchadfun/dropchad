//! Handle mode config: the new
//! `Config` fields, `set_binder`, `revoke_binder`, `set_guardian`, `set_min_fee`,
//! `migrate_config`, and the minimum fee in `create_drop`. `claim_handle` is `handle_claim.rs`.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use common::spl::SYSTEM_PROGRAM;
use common::*;
use dropchad::events::{BinderRevoked, BinderSet, ConfigMigrated, GuardianSet, MinFeeSet};
use dropchad::{DropError, LEGACY_CONFIG_SIZE, MAX_MIN_FEE_LAMPORTS};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// The planned live minimum, about 25 cents at the SOL price. A test value.
const MIN_FEE: u64 = 2_500_000;

// -- helpers ----------------------------------------------------------------------------------

fn set_binder(h: &mut Harness, signer: &Keypair, binder: Pubkey) -> TxResult {
    h.admin_send(signer, dropchad::instruction::SetBinder { binder }.data())
}

fn set_guardian(h: &mut Harness, signer: &Keypair, guardian: Pubkey) -> TxResult {
    h.admin_send(signer, dropchad::instruction::SetGuardian { guardian }.data())
}

fn set_min_fee(h: &mut Harness, signer: &Keypair, lamports: u64) -> TxResult {
    h.admin_send(signer, dropchad::instruction::SetMinFee { lamports }.data())
}

fn revoke_binder(h: &mut Harness, signer: &Keypair) -> TxResult {
    let ix = Instruction {
        program_id: dropchad::ID,
        accounts: dropchad::accounts::RevokeBinder { signer: signer.pubkey(), config: h.config }.to_account_metas(None),
        data: dropchad::instruction::RevokeBinder {}.data(),
    };
    h.send(&[ix], &[signer])
}

fn migrate_ix(h: &Harness, admin: &Pubkey, config: &Pubkey) -> Instruction {
    Instruction {
        program_id: dropchad::ID,
        accounts: dropchad::accounts::MigrateConfig { admin: *admin, config: *config, system_program: SYSTEM_PROGRAM }
            .to_account_metas(None),
        data: dropchad::instruction::MigrateConfig {}.data(),
    }
}

fn migrate(h: &mut Harness, admin: &Keypair) -> TxResult {
    let config = h.config;
    let ix = migrate_ix(h, &admin.pubkey(), &config);
    h.send(&[ix], &[admin])
}

/// The devnet shape before the upgrade: a `Config` of 116 bytes, written by the old
/// `initialize_config`. Built from a fresh config cut down to its first 116 bytes,
/// which are exactly the old layout: the new fields all come after `bump`. The rent is
/// the 116 byte minimum, as on devnet.
fn legacy_config(h: &mut Harness) -> Vec<u8> {
    let mut account = h.svm.get_account(&h.config).expect("config");
    account.data.truncate(LEGACY_CONFIG_SIZE);
    account.lamports = h.rent_for(LEGACY_CONFIG_SIZE);
    let bytes = account.data.clone();
    h.svm.set_account(h.config, account).expect("set legacy config");
    bytes
}

// -- sizes -----------------------------------------------------------------------------

#[test]
fn config_is_253_bytes_and_drop_is_424_s7_26() {
    assert_eq!(dropchad::Config::SIZE, 253);
    assert_eq!(dropchad::Drop::SIZE, 424);
    assert_eq!(LEGACY_CONFIG_SIZE, 116);
}

#[test]
fn a_new_config_starts_with_every_handle_field_zero_s7_23() {
    let h = Harness::new();
    let c = h.config_state();
    assert_eq!(c.binder, Pubkey::default());
    assert!(!c.binder_revoked);
    assert_eq!(c.guardian, Pubkey::default());
    assert_eq!(c.min_fee_lamports, 0);
    assert_eq!(c.min_fee_per_receiver_lamports, 0);
    assert_eq!(c.max_fee_lamports, 0);
    assert_eq!(c.reserved, [0u8; 48], "64 less the two fields");
    assert_eq!(h.svm.get_account(&h.config).unwrap().data.len(), 253);
}

#[test]
fn a_new_drop_has_a_zero_reserved_tail_s7_24() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 1);
    assert_eq!(h.drop_state(&ctx).reserved, [0u8; 40], "64 less fields 20 to 22, 5.2");
    assert_eq!(h.svm.get_account(&ctx.drop).unwrap().data.len(), 424);
}

// -- set_binder -------------------------------------------------------------------------------

#[test]
fn set_binder_from_admin_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let binder = Keypair::new().pubkey();
    let meta = expect_ok(set_binder(&mut h, &admin, binder));
    assert_eq!(h.config_state().binder, binder);
    let ev = find_event::<BinderSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_binder, ev.new_binder), (Pubkey::default(), binder));
}

#[test]
fn set_binder_zero_fails_s6_11() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_err(set_binder(&mut h, &admin, Pubkey::default()), DropError::ZeroAddress);
}

#[test]
fn set_binder_from_a_stranger_fails_s6_11() {
    let mut h = Harness::new();
    let stranger = h.funder.insecure_clone();
    expect_err(set_binder(&mut h, &stranger, Keypair::new().pubkey()), DropError::NotAdmin);
}

#[test]
fn set_binder_from_the_guardian_fails_r7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let guardian = h.funder.insecure_clone();
    expect_ok(set_guardian(&mut h, &admin, guardian.pubkey()));
    expect_err(set_binder(&mut h, &guardian, Keypair::new().pubkey()), DropError::NotAdmin);
}

#[test]
fn set_binder_clears_revoked_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_ok(set_binder(&mut h, &admin, Keypair::new().pubkey()));
    expect_ok(revoke_binder(&mut h, &admin));
    assert!(h.config_state().binder_revoked);

    let next = Keypair::new().pubkey();
    expect_ok(set_binder(&mut h, &admin, next));
    let c = h.config_state();
    assert_eq!(c.binder, next);
    assert!(!c.binder_revoked, "a new binder resumes handle claims, the leak playbook step 5");
}

// -- revoke_binder ----------------------------------------------------------------------------

#[test]
fn revoke_binder_from_admin_keeps_the_address_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let binder = Keypair::new().pubkey();
    expect_ok(set_binder(&mut h, &admin, binder));

    let meta = expect_ok(revoke_binder(&mut h, &admin));
    let c = h.config_state();
    assert!(c.binder_revoked);
    assert_eq!(c.binder, binder, "only the flag moves");
    assert_eq!(find_event::<BinderRevoked>(&meta.logs).unwrap().by, admin.pubkey());
}

#[test]
fn revoke_binder_from_the_guardian_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let guardian = h.funder.insecure_clone();
    expect_ok(set_binder(&mut h, &admin, Keypair::new().pubkey()));
    expect_ok(set_guardian(&mut h, &admin, guardian.pubkey()));

    let meta = expect_ok(revoke_binder(&mut h, &guardian));
    assert!(h.config_state().binder_revoked);
    assert_eq!(find_event::<BinderRevoked>(&meta.logs).unwrap().by, guardian.pubkey());
}

#[test]
fn revoke_binder_from_a_stranger_fails_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let stranger = h.relayer.insecure_clone();
    expect_ok(set_binder(&mut h, &admin, Keypair::new().pubkey()));

    // No guardian set: a zero guardian must not let anybody through.
    expect_err(revoke_binder(&mut h, &stranger), DropError::NotAdminOrGuardian);

    let guardian = h.funder.pubkey();
    expect_ok(set_guardian(&mut h, &admin, guardian));
    expect_err(revoke_binder(&mut h, &stranger), DropError::NotAdminOrGuardian);
    assert!(!h.config_state().binder_revoked);
}

#[test]
fn revoke_binder_from_a_replaced_guardian_fails_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let old_guardian = h.funder.insecure_clone();
    expect_ok(set_guardian(&mut h, &admin, old_guardian.pubkey()));
    expect_ok(set_guardian(&mut h, &admin, Pubkey::default()));
    expect_err(revoke_binder(&mut h, &old_guardian), DropError::NotAdminOrGuardian);
}

#[test]
fn revoke_binder_twice_is_fine_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_ok(revoke_binder(&mut h, &admin));
    expect_ok(revoke_binder(&mut h, &admin));
    assert!(h.config_state().binder_revoked);
}

// -- set_guardian -----------------------------------------------------------------------------

#[test]
fn set_guardian_set_and_clear_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let guardian = Keypair::new().pubkey();

    let meta = expect_ok(set_guardian(&mut h, &admin, guardian));
    assert_eq!(h.config_state().guardian, guardian);
    let ev = find_event::<GuardianSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_guardian, ev.new_guardian), (Pubkey::default(), guardian));

    expect_ok(set_guardian(&mut h, &admin, Pubkey::default()));
    assert_eq!(h.config_state().guardian, Pubkey::default(), "zero means none");
}

#[test]
fn set_guardian_from_a_stranger_fails_s6_11() {
    let mut h = Harness::new();
    let stranger = h.funder.insecure_clone();
    expect_err(set_guardian(&mut h, &stranger, stranger.pubkey()), DropError::NotAdmin);
}

#[test]
fn set_guardian_from_the_guardian_fails_r7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let guardian = h.funder.insecure_clone();
    expect_ok(set_guardian(&mut h, &admin, guardian.pubkey()));
    expect_err(set_guardian(&mut h, &guardian, Keypair::new().pubkey()), DropError::NotAdmin);
}

// -- set_min_fee ------------------------------------------------------------------------------

#[test]
fn set_min_fee_from_admin_s8_14() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let meta = expect_ok(set_min_fee(&mut h, &admin, MIN_FEE));
    assert_eq!(h.config_state().min_fee_lamports, MIN_FEE);
    let ev = find_event::<MinFeeSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_lamports, ev.new_lamports), (0, MIN_FEE));
}

#[test]
fn set_min_fee_cap_is_inclusive_s8_14() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    assert_eq!(MAX_MIN_FEE_LAMPORTS, 25_000_000, "6.12, decided 2026-09-28");
    expect_ok(set_min_fee(&mut h, &admin, MAX_MIN_FEE_LAMPORTS));
    assert_eq!(h.config_state().min_fee_lamports, MAX_MIN_FEE_LAMPORTS);
    expect_err(set_min_fee(&mut h, &admin, MAX_MIN_FEE_LAMPORTS + 1), DropError::FeeTooHigh);
    assert_eq!(h.config_state().min_fee_lamports, MAX_MIN_FEE_LAMPORTS);
}

#[test]
fn set_min_fee_from_a_stranger_fails_s6_11() {
    let mut h = Harness::new();
    let stranger = h.funder.insecure_clone();
    expect_err(set_min_fee(&mut h, &stranger, MIN_FEE), DropError::NotAdmin);
}

// -- the fee in create_drop ------------------------------------------------------------

#[test]
fn a_tiny_sol_drop_pays_the_minimum_s8_14() {
    let mut h = Harness::with_fee(100);
    let admin = h.deployer.insecure_clone();
    expect_ok(set_min_fee(&mut h, &admin, MIN_FEE));

    let ctx = h.new_sol_drop(&receivers(3, MIN_SOL_LEAF), 1); // 1 percent is 26,726 lamports
    let d = h.drop_state(&ctx);
    assert_eq!(d.fee_amount, MIN_FEE, "the minimum, not 1 percent, never both");
    assert_eq!(d.gross_required, ctx.total() + MIN_FEE);
}

#[test]
fn a_normal_sol_drop_pays_the_bps_s8_14() {
    let mut h = Harness::with_fee(100);
    let admin = h.deployer.insecure_clone();
    expect_ok(set_min_fee(&mut h, &admin, MIN_FEE));

    let ctx = h.new_sol_drop(&receivers(3, SOL), 1); // 1 percent is 30,000,000 lamports
    assert_eq!(h.drop_state(&ctx).fee_amount, 30_000_000);
}

#[test]
fn the_minimum_applies_at_zero_bps_s8_14() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_ok(set_min_fee(&mut h, &admin, MIN_FEE));
    let ctx = h.new_sol_drop(&receivers(2, SOL), 1);
    assert_eq!(h.drop_state(&ctx).fee_amount, MIN_FEE);
}

#[test]
fn a_token_drop_gets_neither_the_bps_nor_the_minimum_s8_11() {
    let mut h = Harness::with_fee(100);
    let admin = h.deployer.insecure_clone();
    expect_ok(set_min_fee(&mut h, &admin, MIN_FEE));

    let ctx = h.new_spl_drop(&receivers(3, 1_000_000), 1);
    let d = h.drop_state(&ctx);
    assert_eq!(d.fee_amount, 0, "the fee of a token drop is sol_fee_lamports");
    assert_eq!(d.gross_required, 3_000_000);
}

#[test]
fn an_existing_drop_keeps_its_fee_s8_7() {
    let mut h = Harness::with_fee(100);
    let admin = h.deployer.insecure_clone();
    let ctx = h.new_sol_drop(&receivers(3, MIN_SOL_LEAF), 1);
    let before = h.drop_state(&ctx).fee_amount;

    expect_ok(set_min_fee(&mut h, &admin, MIN_FEE));
    assert_eq!(h.drop_state(&ctx).fee_amount, before);

    let later = h.prepare(&receivers(3, MIN_SOL_LEAF), None, 2, 0);
    expect_ok(h.send_create(&later));
    assert_eq!(h.drop_state(&later).fee_amount, MIN_FEE, "the next drop gets the minimum");
}

#[test]
fn a_tiny_sol_drop_pays_the_minimum_at_activation_s8_5() {
    let mut h = Harness::with_fee(100);
    let admin = h.deployer.insecure_clone();
    expect_ok(set_min_fee(&mut h, &admin, MIN_FEE));
    let ctx = h.new_sol_drop(&receivers(3, MIN_SOL_LEAF), 1);

    let before = h.lamports(&h.fee_wallet.pubkey());
    h.fund_and_activate(&ctx);
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()) - before, MIN_FEE);
    for i in 0..3 {
        expect_ok(h.claim(&ctx, i));
        assert_eq!(h.lamports(&ctx.recipient(i)), MIN_SOL_LEAF, "every receiver paid in full");
    }
}

// -- migrate_config --------------------------------------------------------------------

#[test]
fn migrate_config_grows_a_legacy_config_s7_27() {
    let mut h = Harness::with_fee(100);
    let admin = h.deployer.insecure_clone();
    let before = legacy_config(&mut h);
    assert_eq!(h.svm.get_account(&h.config).unwrap().data.len(), 116);

    let meta = expect_ok(migrate(&mut h, &admin));

    let account = h.svm.get_account(&h.config).unwrap();
    assert_eq!(account.data.len(), 253);
    assert_eq!(&account.data[..116], &before[..], "every old byte kept, at its old offset");
    assert_eq!(&account.data[116..], &[0u8; 137][..], "every new byte zero");
    assert!(account.lamports >= h.rent_for(253), "rent exempt at the new size");

    let c = h.config_state();
    assert_eq!(c.admin, admin.pubkey());
    assert_eq!(c.relayer, h.relayer.pubkey());
    assert_eq!(c.fee_wallet, h.fee_wallet.pubkey());
    assert_eq!(c.default_fee_bps, 100);
    assert!(!c.paused);
    assert_eq!(c.chain_id, DEVNET_CHAIN_ID);
    assert_eq!(c.bump, h.config_bump);
    assert_eq!(c.binder, Pubkey::default(), "no binder until set_binder");
    assert_eq!(c.min_fee_lamports, 0, "the plain bps until set_min_fee");

    let ev = find_event::<ConfigMigrated>(&meta.logs).unwrap();
    assert_eq!((ev.old_len, ev.new_len), (116, 253));
}

#[test]
fn migrate_config_runs_once_s7_27() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    legacy_config(&mut h);
    expect_ok(migrate(&mut h, &admin));
    expect_err(migrate(&mut h, &admin), DropError::AlreadyMigrated);
}

#[test]
fn migrate_config_on_a_new_config_fails_s7_27() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_err(migrate(&mut h, &admin), DropError::AlreadyMigrated);
}

#[test]
fn migrate_config_from_a_stranger_fails_s7_27() {
    let mut h = Harness::new();
    let stranger = h.funder.insecure_clone();
    legacy_config(&mut h);
    expect_err(migrate(&mut h, &stranger), DropError::NotAdmin);
    assert_eq!(h.svm.get_account(&h.config).unwrap().data.len(), 116, "nothing changed");
}

#[test]
fn migrate_config_refuses_any_other_account_s7_27() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    legacy_config(&mut h);
    let ctx = h.prepare(&receivers(1, SOL), None, 1, 0);
    let ix = migrate_ix(&h, &admin.pubkey(), &ctx.drop);
    expect_anchor_err(h.send(&[ix], &[&admin]), 2006); // ConstraintSeeds
}

#[test]
fn the_program_needs_the_migration_then_works_s7_27() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    legacy_config(&mut h);

    // Before: the upgraded program cannot load a 116 byte config, so creation fails.
    let early = h.prepare(&receivers(2, SOL), None, 1, 0);
    expect_fail(h.send_create(&early));

    expect_ok(migrate(&mut h, &admin));

    // After: everything reads the migrated config.
    let ctx = h.new_sol_drop(&receivers(2, SOL), 2);
    h.fund_and_activate(&ctx);
    expect_ok(h.claim(&ctx, 0));
    expect_ok(set_binder(&mut h, &admin, Keypair::new().pubkey()));
}
