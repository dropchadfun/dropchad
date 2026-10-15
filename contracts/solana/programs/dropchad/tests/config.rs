//! `initialize_config`.

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use dropchad::events::ConfigInitialized;
use dropchad::{DropError, MAX_FEE_BPS};
use solana_signer::Signer;

#[test]
fn init_config_happy_path_s6_0_4() {
    let mut h = Harness::bare();
    let meta = expect_ok(h.init_config(DEVNET_CHAIN_ID, 0));

    let config = h.config_state();
    assert_eq!(config.admin, h.deployer.pubkey(), "admin is the signer");
    assert_eq!(config.relayer, h.relayer.pubkey());
    assert_eq!(config.fee_wallet, h.fee_wallet.pubkey());
    assert_eq!(config.default_fee_bps, 0);
    assert!(!config.paused);
    assert_eq!(config.chain_id, DEVNET_CHAIN_ID);
    assert_eq!(config.bump, h.config_bump);

    let event: ConfigInitialized = find_event(&meta.logs).expect("ConfigInitialized event");
    assert_eq!(event.admin, h.deployer.pubkey());
    assert_eq!(event.relayer, h.relayer.pubkey());
    assert_eq!(event.chain_id, DEVNET_CHAIN_ID);
}

#[test]
fn init_config_at_the_canonical_pda_with_spec_size() {
    let h = Harness::new();
    let account = h.svm.get_account(&h.config).expect("config");
    assert_eq!(account.owner, dropchad::ID);
    assert_eq!(account.data.len(), dropchad::Config::SIZE, "253 bytes since handle mode");
    assert_eq!(account.data.len(), 253);
}

#[test]
fn init_config_second_call_fails_s6_0_2() {
    let mut h = Harness::new();
    expect_fail(h.init_config(DEVNET_CHAIN_ID, 0));
    // and nothing changed
    assert_eq!(h.config_state().chain_id, DEVNET_CHAIN_ID);
}

#[test]
fn init_config_non_upgrade_authority_fails_s6_0_1() {
    let mut h = Harness::bare();
    let relayer = h.relayer.insecure_clone();
    let ix = h.init_config_ix(&relayer.pubkey(), DEVNET_CHAIN_ID, relayer.pubkey(), relayer.pubkey(), 0);
    expect_err(h.send(&[ix], &[&relayer]), DropError::NotUpgradeAuthority);
    assert!(h.account::<dropchad::Config>(&h.config).is_none(), "no config was created");
}

#[test]
fn init_config_with_a_wrong_program_data_account_fails_s6_0_1() {
    let mut h = Harness::bare();
    let deployer = h.deployer.insecure_clone();
    let mut ix = h.init_config_ix(&deployer.pubkey(), DEVNET_CHAIN_ID, h.relayer.pubkey(), h.fee_wallet.pubkey(), 0);
    // account 3 is program_data; point it at some other account
    ix.accounts[3].pubkey = h.funder.pubkey();
    expect_fail(h.send(&[ix], &[&deployer]));
}

#[test]
fn init_config_fee_over_cap_fails_s6_0_3() {
    let mut h = Harness::bare();
    expect_err(h.init_config(DEVNET_CHAIN_ID, MAX_FEE_BPS + 1), DropError::FeeTooHigh);
}

#[test]
fn init_config_fee_at_cap_works_s6_0_3() {
    let mut h = Harness::bare();
    expect_ok(h.init_config(DEVNET_CHAIN_ID, MAX_FEE_BPS));
    assert_eq!(h.config_state().default_fee_bps, MAX_FEE_BPS);
}

#[test]
fn init_config_zero_relayer_fails_s6_0_3() {
    let mut h = Harness::bare();
    let deployer = h.deployer.insecure_clone();
    let ix = h.init_config_ix(&deployer.pubkey(), DEVNET_CHAIN_ID, Pubkey::default(), h.fee_wallet.pubkey(), 0);
    expect_err(h.send(&[ix], &[&deployer]), DropError::ZeroAddress);
}

#[test]
fn init_config_zero_fee_wallet_fails_s6_0_3() {
    let mut h = Harness::bare();
    let deployer = h.deployer.insecure_clone();
    let ix = h.init_config_ix(&deployer.pubkey(), DEVNET_CHAIN_ID, h.relayer.pubkey(), Pubkey::default(), 0);
    expect_err(h.send(&[ix], &[&deployer]), DropError::ZeroAddress);
}

#[test]
fn init_config_stores_mainnet_chain_id_too_s7_6() {
    let mut h = Harness::bare();
    expect_ok(h.init_config(dropchad::SOLANA_MAINNET_CHAIN_ID, 0));
    assert_eq!(h.config_state().chain_id, 101);
}
