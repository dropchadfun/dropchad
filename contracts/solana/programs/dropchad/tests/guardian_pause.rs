//! `guardian_pause`. The admin or a non zero guardian
//! sets `paused` to true and nothing else. Unpause stays `set_paused(false)`, admin only.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use common::*;
use dropchad::events::GuardianPaused;
use dropchad::DropError;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// The `Config` size since handle mode.
const CONFIG_SIZE: usize = 253;

// -- helpers ----------------------------------------------------------------------------------

fn set_guardian(h: &mut Harness, signer: &Keypair, guardian: Pubkey) -> TxResult {
    h.admin_send(
        signer,
        dropchad::instruction::SetGuardian { guardian }.data(),
    )
}

fn guardian_pause(h: &mut Harness, signer: &Keypair) -> TxResult {
    let ix = Instruction {
        program_id: dropchad::ID,
        accounts: dropchad::accounts::GuardianPause {
            signer: signer.pubkey(),
            config: h.config,
        }
        .to_account_metas(None),
        data: dropchad::instruction::GuardianPause {}.data(),
    };
    h.send(&[ix], &[signer])
}

/// A harness with `h.funder` set as the guardian.
fn with_guardian() -> (Harness, Keypair, Keypair) {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let guardian = h.funder.insecure_clone();
    expect_ok(set_guardian(&mut h, &admin, guardian.pubkey()));
    (h, admin, guardian)
}

// -- who may sign  -------------------------------------------------------

#[test]
fn guardian_pause_from_the_admin_s6_11_9() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();

    let meta = expect_ok(guardian_pause(&mut h, &admin));
    assert!(h.config_state().paused);
    assert_eq!(
        find_event::<GuardianPaused>(&meta.logs).unwrap().by,
        admin.pubkey()
    );
}

#[test]
fn guardian_pause_from_the_guardian_s6_11_9() {
    let (mut h, _admin, guardian) = with_guardian();

    let meta = expect_ok(guardian_pause(&mut h, &guardian));
    assert!(h.config_state().paused);
    assert_eq!(
        find_event::<GuardianPaused>(&meta.logs).unwrap().by,
        guardian.pubkey()
    );
}

#[test]
fn guardian_pause_from_a_stranger_fails_s6_11_9() {
    let (mut h, _admin, _guardian) = with_guardian();
    let stranger = h.relayer.insecure_clone();

    expect_err(
        guardian_pause(&mut h, &stranger),
        DropError::NotAdminOrGuardian,
    );
    assert!(!h.config_state().paused);
}

#[test]
fn guardian_pause_with_no_guardian_lets_only_the_admin_through_s6_11_9() {
    let mut h = Harness::new();
    assert_eq!(h.config_state().guardian, Pubkey::default());

    for key in [h.relayer.insecure_clone(), h.funder.insecure_clone()] {
        expect_err(guardian_pause(&mut h, &key), DropError::NotAdminOrGuardian);
    }
    assert!(!h.config_state().paused);

    let admin = h.deployer.insecure_clone();
    expect_ok(guardian_pause(&mut h, &admin));
    assert!(h.config_state().paused);
}

#[test]
fn guardian_pause_from_a_replaced_guardian_fails_s6_11_9() {
    let (mut h, admin, old_guardian) = with_guardian();
    expect_ok(set_guardian(&mut h, &admin, Pubkey::default()));

    expect_err(
        guardian_pause(&mut h, &old_guardian),
        DropError::NotAdminOrGuardian,
    );
    assert!(!h.config_state().paused);
}

#[test]
fn guardian_pause_twice_is_fine_and_emits_again_s6_11_9() {
    let (mut h, _admin, guardian) = with_guardian();

    expect_ok(guardian_pause(&mut h, &guardian));
    let meta = expect_ok(guardian_pause(&mut h, &guardian));
    assert!(h.config_state().paused);
    assert_eq!(
        find_event::<GuardianPaused>(&meta.logs).unwrap().by,
        guardian.pubkey()
    );
}

// -- pause only, unpause stays admin only  --------------------------------------

#[test]
fn the_guardian_cannot_unpause_s6_11_9() {
    let (mut h, admin, guardian) = with_guardian();
    expect_ok(guardian_pause(&mut h, &guardian));

    expect_err(h.set_paused(&guardian, false), DropError::NotAdmin);
    assert!(h.config_state().paused);

    expect_ok(h.set_paused(&admin, false));
    assert!(!h.config_state().paused);
}

// -- creation only  ----------------------------------------------------

#[test]
fn guardian_pause_blocks_creation_only_s6_11_9() {
    let (mut h, _admin, guardian) = with_guardian();
    let live = h.new_sol_drop(&receivers(2, SOL), 1);
    let created = h.new_sol_drop(&receivers(1, SOL), 2);
    h.fund_and_activate(&live);

    expect_ok(guardian_pause(&mut h, &guardian));

    let blocked = h.prepare(&receivers(2, SOL), None, 3, 0);
    expect_err(h.send_create(&blocked), DropError::CreationPaused);

    // A drop created before the pause still activates.
    h.fund_and_activate(&created);
    expect_ok(h.claim(&created, 0));

    // A live drop still claims, refunds and closes.
    expect_ok(h.claim(&live, 0));
    let deadline = h.drop_state(&live).claim_deadline;
    h.warp_to(deadline + 1);
    expect_ok(h.refund(&live));
    expect_ok(h.close(&live));
}

#[test]
fn guardian_pause_moves_only_the_paused_byte_s6_11_9() {
    let (mut h, _admin, guardian) = with_guardian();
    let before = h.svm.get_account(&h.config).unwrap();
    assert_eq!(before.data.len(), CONFIG_SIZE);

    expect_ok(guardian_pause(&mut h, &guardian));

    let after = h.svm.get_account(&h.config).unwrap();
    assert_eq!(after.data.len(), CONFIG_SIZE, "the size stays");
    assert_eq!(after.lamports, before.lamports);
    assert_eq!(after.owner, before.owner);
    let changed: Vec<usize> = (0..CONFIG_SIZE)
        .filter(|&i| before.data[i] != after.data[i])
        .collect();
    assert_eq!(changed.len(), 1, "one byte moves: {changed:?}");
    assert!(h.config_state().paused);
}
