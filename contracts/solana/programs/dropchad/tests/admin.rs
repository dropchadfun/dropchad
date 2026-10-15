//! Admin instructions. Admin moves in two steps,
//! `propose_admin` and `accept_admin`; `set_admin` is gone.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use common::*;
use dropchad::events::{AdminProposed, AdminSet, DefaultFeeBpsSet, FeeWalletSet, PausedSet, RelayerSet};
use dropchad::{DropError, MAX_FEE_BPS};
use solana_keypair::Keypair;
use solana_signer::Signer;

// -- the two step handover -----------------------------------------------------------

fn propose_admin(h: &mut Harness, signer: &Keypair, pending_admin: Pubkey) -> TxResult {
    h.admin_send(signer, dropchad::instruction::ProposeAdmin { pending_admin }.data())
}

fn accept_admin_ix(h: &Harness, pending_admin: &Pubkey) -> Instruction {
    Instruction {
        program_id: dropchad::ID,
        accounts: dropchad::accounts::AcceptAdmin { pending_admin: *pending_admin, config: h.config }.to_account_metas(None),
        data: dropchad::instruction::AcceptAdmin {}.data(),
    }
}

/// `signer` signs and pays.
fn accept_admin(h: &mut Harness, signer: &Keypair) -> TxResult {
    let ix = accept_admin_ix(h, &signer.pubkey());
    h.send(&[ix], &[signer])
}

/// A new key with SOL for its fees.
fn funded_key(h: &mut Harness) -> Keypair {
    let key = Keypair::new();
    h.svm.airdrop(&key.pubkey(), SOL).unwrap();
    key
}

// -- each setter works from admin -------------------------------------------------------------

#[test]
fn set_paused_from_admin() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let meta = expect_ok(h.set_paused(&admin, true));
    assert!(h.config_state().paused);
    assert!(find_event::<PausedSet>(&meta.logs).unwrap().paused);
    expect_ok(h.set_paused(&admin, false));
    assert!(!h.config_state().paused);
}

#[test]
fn set_default_fee_bps_from_admin() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let meta = expect_ok(h.set_default_fee_bps(&admin, 100));
    assert_eq!(h.config_state().default_fee_bps, 100);
    let ev = find_event::<DefaultFeeBpsSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_bps, ev.new_bps), (0, 100));
}

#[test]
fn set_default_fee_bps_at_cap_works_s6_11_4() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_ok(h.set_default_fee_bps(&admin, MAX_FEE_BPS));
    assert_eq!(h.config_state().default_fee_bps, MAX_FEE_BPS);
}

#[test]
fn set_default_fee_bps_over_cap_fails_s6_11_4() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_err(h.set_default_fee_bps(&admin, MAX_FEE_BPS + 1), DropError::FeeTooHigh);
    assert_eq!(h.config_state().default_fee_bps, 0);
}

#[test]
fn set_fee_wallet_from_admin() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let new = Keypair::new().pubkey();
    let old = h.fee_wallet.pubkey();
    let meta = expect_ok(h.set_fee_wallet(&admin, new));
    assert_eq!(h.config_state().fee_wallet, new);
    let ev = find_event::<FeeWalletSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_wallet, ev.new_wallet), (old, new));
}

#[test]
fn set_fee_wallet_zero_fails() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_err(h.set_fee_wallet(&admin, Pubkey::default()), DropError::ZeroAddress);
}

#[test]
fn set_relayer_from_admin() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let new = Keypair::new().pubkey();
    let old = h.relayer.pubkey();
    let meta = expect_ok(h.set_relayer(&admin, new));
    assert_eq!(h.config_state().relayer, new);
    let ev = find_event::<RelayerSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_relayer, ev.new_relayer), (old, new));
}

#[test]
fn set_relayer_zero_fails() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_err(h.set_relayer(&admin, Pubkey::default()), DropError::ZeroAddress);
}

#[test]
fn propose_then_accept_hands_over_and_old_admin_loses_access_s6_11_6() {
    let mut h = Harness::new();
    let old = h.deployer.insecure_clone();
    let new = funded_key(&mut h);

    let meta = expect_ok(propose_admin(&mut h, &old, new.pubkey()));
    let ev = find_event::<AdminProposed>(&meta.logs).unwrap();
    assert_eq!((ev.admin, ev.pending_admin), (old.pubkey(), new.pubkey()));
    let c = h.config_state();
    assert_eq!((c.admin, c.pending_admin), (old.pubkey(), new.pubkey()), "nothing moves yet");
    // the old admin keeps every right until the accept
    expect_ok(h.set_paused(&old, true));
    expect_err(h.set_paused(&new, false), DropError::NotAdmin);

    let meta = expect_ok(accept_admin(&mut h, &new));
    let ev = find_event::<AdminSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_admin, ev.new_admin), (old.pubkey(), new.pubkey()));
    let c = h.config_state();
    assert_eq!((c.admin, c.pending_admin), (new.pubkey(), Pubkey::default()), "pending cleared");

    expect_err(h.set_paused(&old, false), DropError::NotAdmin);
    expect_ok(h.set_paused(&new, false));
}

#[test]
fn accept_by_any_other_key_fails_s6_11_6() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let new = funded_key(&mut h);
    expect_ok(propose_admin(&mut h, &admin, new.pubkey()));

    let stranger = h.funder.insecure_clone();
    expect_err(accept_admin(&mut h, &stranger), DropError::NotPendingAdmin);
    expect_err(accept_admin(&mut h, &admin), DropError::NotPendingAdmin);
    let c = h.config_state();
    assert_eq!((c.admin, c.pending_admin), (admin.pubkey(), new.pubkey()));
}

#[test]
fn accept_with_nothing_pending_fails_s6_11_6() {
    let mut h = Harness::new();
    assert_eq!(h.config_state().pending_admin, Pubkey::default());
    let stranger = h.funder.insecure_clone();
    expect_err(accept_admin(&mut h, &stranger), DropError::NotPendingAdmin);
    let admin = h.deployer.insecure_clone();
    expect_err(accept_admin(&mut h, &admin), DropError::NotPendingAdmin);
}

#[test]
fn propose_zero_cancels_s6_11_6() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let new = funded_key(&mut h);
    expect_ok(propose_admin(&mut h, &admin, new.pubkey()));

    let meta = expect_ok(propose_admin(&mut h, &admin, Pubkey::default()));
    let ev = find_event::<AdminProposed>(&meta.logs).unwrap();
    assert_eq!((ev.admin, ev.pending_admin), (admin.pubkey(), Pubkey::default()));
    assert_eq!(h.config_state().pending_admin, Pubkey::default());
    expect_err(accept_admin(&mut h, &new), DropError::NotPendingAdmin);
    assert_eq!(h.config_state().admin, admin.pubkey());
}

#[test]
fn a_second_propose_replaces_the_first_s6_11_6() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let first = funded_key(&mut h);
    let second = funded_key(&mut h);
    expect_ok(propose_admin(&mut h, &admin, first.pubkey()));
    expect_ok(propose_admin(&mut h, &admin, second.pubkey()));

    expect_err(accept_admin(&mut h, &first), DropError::NotPendingAdmin);
    expect_ok(accept_admin(&mut h, &second));
    assert_eq!(h.config_state().admin, second.pubkey());
}

#[test]
fn accept_without_a_signature_fails_s6_11_6() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let new = Keypair::new();
    expect_ok(propose_admin(&mut h, &admin, new.pubkey()));
    let funder = h.funder.insecure_clone();
    let mut ix = accept_admin_ix(&h, &new.pubkey());
    ix.accounts[0].is_signer = false;
    expect_fail(h.send(&[ix], &[&funder]));
    assert_eq!(h.config_state().admin, admin.pubkey());
}

// -- each setter fails from anyone else --------------------------------------------------------

#[test]
fn every_setter_fails_from_a_non_admin() {
    let mut h = Harness::new();
    let stranger = h.funder.insecure_clone();
    expect_err(h.set_paused(&stranger, true), DropError::NotAdmin);
    expect_err(h.set_default_fee_bps(&stranger, 1), DropError::NotAdmin);
    expect_err(h.set_fee_wallet(&stranger, stranger.pubkey()), DropError::NotAdmin);
    expect_err(h.set_relayer(&stranger, stranger.pubkey()), DropError::NotAdmin);
    expect_err(propose_admin(&mut h, &stranger, stranger.pubkey()), DropError::NotAdmin);
    // the relayer is not admin either
    let relayer = h.relayer.insecure_clone();
    expect_err(h.set_paused(&relayer, true), DropError::NotAdmin);
}

#[test]
fn setter_without_a_signature_fails() {
    let mut h = Harness::new();
    let funder = h.funder.insecure_clone();
    let mut ix = h.admin_ix(&h.deployer.pubkey(), dropchad::instruction::SetPaused { paused: true }.data());
    ix.accounts[0].is_signer = false;
    expect_fail(h.send(&[ix], &[&funder]));
    assert!(!h.config_state().paused);
}

// -- paused blocks creation only -----------------------------------------------------

#[test]
fn paused_blocks_creation_only_s6_11_2() {
    let mut h = Harness::new();
    let live = h.new_sol_drop(&receivers(2, SOL), 1);
    h.fund_and_activate(&live);

    let admin = h.deployer.insecure_clone();
    expect_ok(h.set_paused(&admin, true));

    let blocked = h.prepare(&receivers(2, SOL), None, 2, 0);
    expect_err(h.send_create(&blocked), DropError::CreationPaused);

    // the live drop keeps working
    expect_ok(h.claim(&live, 0));
    expect_ok(h.claim(&live, 1));
    let deadline = h.drop_state(&live).claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&live));
    expect_ok(h.close(&live));
}

// -- no admin instruction touches an existing drop --------------------------------

#[test]
fn no_admin_instruction_changes_an_existing_drop_i6() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 3);
    h.fund_and_activate(&ctx);
    let before = h.svm.get_account(&ctx.drop).unwrap();
    let before_bitmap = h.svm.get_account(&ctx.bitmap).unwrap();

    let admin = h.deployer.insecure_clone();
    expect_ok(h.set_paused(&admin, true));
    expect_ok(h.set_default_fee_bps(&admin, MAX_FEE_BPS));
    expect_ok(h.set_fee_wallet(&admin, Keypair::new().pubkey()));
    expect_ok(h.set_relayer(&admin, Keypair::new().pubkey()));
    let new = funded_key(&mut h);
    expect_ok(propose_admin(&mut h, &admin, new.pubkey()));
    expect_ok(accept_admin(&mut h, &new));

    assert_eq!(h.svm.get_account(&ctx.drop).unwrap(), before);
    assert_eq!(h.svm.get_account(&ctx.bitmap).unwrap(), before_bitmap);
}

#[test]
fn admin_instruction_account_list_has_no_drop_slot_s6_11_1() {
    // The AdminOnly account list is exactly two accounts: admin and config.
    let metas = dropchad::accounts::AdminOnly { admin: Pubkey::default(), config: Pubkey::default() }.to_account_metas(None);
    assert_eq!(metas.len(), 2);
    // `accept_admin` too: the pending key and config.
    let metas = dropchad::accounts::AcceptAdmin { pending_admin: Pubkey::default(), config: Pubkey::default() }.to_account_metas(None);
    assert_eq!(metas.len(), 2);
}

// -- relayer rotation ----------------------------------------------------------------

#[test]
fn rotated_relayer_cannot_create_but_its_drops_keep_working_s6_11_3() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 4);

    let admin = h.deployer.insecure_clone();
    let new_relayer = Keypair::new();
    h.svm.airdrop(&new_relayer.pubkey(), 10 * SOL).unwrap();
    expect_ok(h.set_relayer(&admin, new_relayer.pubkey()));

    // the old key cannot create
    let blocked = h.prepare(&receivers(2, SOL), None, 5, 0);
    expect_err(h.send_create(&blocked), DropError::NotRelayer);

    // the new key can
    let allowed = h.prepare(&receivers(2, SOL), None, 6, 0);
    let ix = h.create_drop_ix(&allowed, &new_relayer.pubkey(), &allowed.params);
    expect_ok(h.send(&[ix], &[&new_relayer]));

    // and the old key's drop activates, claims, refunds and closes normally
    h.fund_and_activate(&ctx);
    expect_ok(h.claim(&ctx, 0));
    expect_ok(h.claim(&ctx, 1));
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&ctx));
    expect_ok(h.close(&ctx));
    // rent went to the old relayer, the recorded rent payer
    assert_eq!(h.drop_state(&ctx).rent_payer, h.relayer.pubkey());
}

#[test]
fn config_decodes_with_account_deserialize() {
    let h = Harness::new();
    let account = h.svm.get_account(&h.config).unwrap();
    let config = dropchad::Config::try_deserialize(&mut &account.data[..]).unwrap();
    assert_eq!(config.relayer, h.relayer.pubkey());
}
