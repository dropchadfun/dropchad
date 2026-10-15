//! Token policy. Section 16 S-, S-.
//! A classic mint, or a Token-2022 mint whose only extensions are `metadataPointer` and
//! `tokenMetadata`. No freeze authority, except the three allowlisted mints. Every other extension is
//! refused with `MintExtensionNotAllowed`, before the vault is created. A non mint account fails
//! while it loads, Anchor `AccountOwnedByWrongProgram`, 3007.

mod common;

use std::str::FromStr;

use anchor_lang::prelude::Pubkey;
use common::spl::*;
use common::*;
use dropchad::DropError;

const ACCOUNT_OWNED_BY_WRONG_PROGRAM: u32 = 3007;
use solana_keypair::Keypair;
use solana_signer::Signer;

// -- what is accepted ------------------------------------------------------------------

#[test]
fn a_token_2022_mint_with_no_extensions_passes_s12_3() {
    let mut h = Harness::new();
    let mint = h.create_mint_with(&TOKEN_2022_PROGRAM, None);
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 1, 0);
    expect_ok(h.send_create(&ctx));
    let d = h.drop_state(&ctx);
    assert_eq!(d.asset, mint);
    assert_eq!(d.vault, ata_address(&ctx.drop, &mint, &TOKEN_2022_PROGRAM), "the vault under Token-2022");
}

#[test]
fn the_pump_fun_shape_passes_s12_3() {
    // metadataPointer and tokenMetadata, no authorities.
    let mut h = Harness::new();
    let mint = h.create_pump_mint();
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 2, 0);
    expect_ok(h.send_create(&ctx));
    assert_eq!(h.drop_state(&ctx).asset, mint);
}

#[test]
fn metadata_pointer_alone_passes_s12_3() {
    let mut h = Harness::new();
    let mint = h.create_mint_2022(None, &[ExtensionType::MetadataPointer], false);
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 3, 0);
    expect_ok(h.send_create(&ctx));
}

#[test]
fn mint_with_mint_authority_passes_s12_2() {
    // create_mint keeps the deployer as mint authority. That is allowed.
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 4, 0);
    expect_ok(h.send_create(&ctx));
}

#[test]
fn wrapped_sol_is_just_an_spl_mint_s12_4() {
    // Any classic mint with no freeze authority. Nothing special about a mint that wraps SOL:
    // it is exercised here with a plain mint of 6 decimals as a stand in.
    let mut h = Harness::new();
    let mint = h.create_mint();
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 5, 0);
    expect_ok(h.send_create(&ctx));
    assert_eq!(h.drop_state(&ctx).asset, mint);
}

// -- every other extension is refused ---------------------------------------------------

/// One test per blocked extension. The mint is refused before anything is created.
macro_rules! blocked_extension {
    ($name:ident, $ext:expr) => {
        #[test]
        fn $name() {
            let mut h = Harness::new();
            let mint = h.create_mint_2022(None, &[$ext], false);
            let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 10, 0);
            expect_err(h.send_create(&ctx), DropError::MintExtensionNotAllowed);
            assert!(!h.exists(&ctx.drop), "nothing was created");
            assert!(!h.exists(&ctx.vault.unwrap()), "no vault");
        }
    };
}

blocked_extension!(transfer_fee_fails_s12_3, ExtensionType::TransferFeeConfig);
blocked_extension!(transfer_hook_fails_s12_3, ExtensionType::TransferHook);
blocked_extension!(permanent_delegate_fails_s12_3, ExtensionType::PermanentDelegate);
blocked_extension!(non_transferable_fails_s12_3, ExtensionType::NonTransferable);
blocked_extension!(default_account_state_frozen_fails_s12_3, ExtensionType::DefaultAccountState);
blocked_extension!(confidential_transfer_fails_s12_3, ExtensionType::ConfidentialTransferMint);
blocked_extension!(pausable_fails_s12_3, ExtensionType::Pausable);
blocked_extension!(mint_close_authority_fails_s12_3, ExtensionType::MintCloseAuthority);
blocked_extension!(interest_bearing_fails_s12_3, ExtensionType::InterestBearingConfig);
// Not named in, refused all the same: default deny.
blocked_extension!(group_pointer_fails_default_deny_s12_3, ExtensionType::GroupPointer);
blocked_extension!(scaled_ui_amount_fails_default_deny_s12_3, ExtensionType::ScaledUiAmount);

#[test]
fn metadata_plus_one_blocked_extension_fails_s12_3() {
    // The allowed pair does not cover for a third extension.
    let mut h = Harness::new();
    let mint = h.create_mint_2022(None, &[ExtensionType::MetadataPointer, ExtensionType::PermanentDelegate], true);
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 11, 0);
    expect_err(h.send_create(&ctx), DropError::MintExtensionNotAllowed);
}

// -- the freeze rule and its exception ----------------------------------------

#[test]
fn mint_with_freeze_authority_fails_s6_1_10() {
    let mut h = Harness::new();
    let freezer = Keypair::new().pubkey();
    let mint = h.create_mint_with(&TOKEN_PROGRAM, Some(freezer));
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 12, 0);
    expect_err(h.send_create(&ctx), DropError::MintHasFreezeAuthority);
}

#[test]
fn token_2022_mint_with_freeze_authority_fails_s6_1_10() {
    let mut h = Harness::new();
    let freezer = Keypair::new().pubkey();
    let mint = h.create_mint_2022(Some(freezer), &[ExtensionType::MetadataPointer], true);
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 13, 0);
    expect_err(h.send_create(&ctx), DropError::MintHasFreezeAuthority);
}

/// One test per allowlisted mint, at its exact address, with a freeze authority.
macro_rules! freeze_exception {
    ($name:ident, $address:expr) => {
        #[test]
        fn $name() {
            let mut h = Harness::new();
            let freezer = Keypair::new().pubkey();
            let mint = h.create_mint_at(Pubkey::from_str($address).unwrap(), Some(freezer));
            let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 14, 0);
            expect_ok(h.send_create(&ctx));
            assert_eq!(h.drop_state(&ctx).asset, mint);
        }
    };
}

freeze_exception!(usdc_mainnet_passes_with_its_freeze_authority_s12_8, USDC_MAINNET);
freeze_exception!(usdt_mainnet_passes_with_its_freeze_authority_s12_8, USDT_MAINNET);
freeze_exception!(usdc_devnet_passes_with_its_freeze_authority_s12_8, USDC_DEVNET);

#[test]
fn the_exception_is_by_address_only_s12_8() {
    // Same bytes as the USDC devnet mint, at another address: refused.
    let mut h = Harness::new();
    let freezer = Keypair::new().pubkey();
    let mint = h.create_mint_at(Keypair::new().pubkey(), Some(freezer));
    let ctx = h.prepare(&receivers(1, 1_000), Some(mint), 15, 0);
    expect_err(h.send_create(&ctx), DropError::MintHasFreezeAuthority);
}

// -- token program confusion --------------------------------------------------

#[test]
fn a_non_mint_account_as_mint_fails() {
    let mut h = Harness::new();
    let not_a_mint = h.funder.pubkey();
    let ctx = h.prepare(&receivers(1, 1_000), Some(not_a_mint), 20, 0);
    expect_anchor_err(h.send_create(&ctx), ACCOUNT_OWNED_BY_WRONG_PROGRAM);
}

#[test]
fn a_classic_mint_with_the_token_2022_program_fails_s6_1_10() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let mut ctx = h.prepare(&receivers(1, 1_000), Some(mint), 21, 0);
    ctx.token_program = TOKEN_2022_PROGRAM;
    ctx.vault = Some(ata_address(&ctx.drop, &mint, &TOKEN_2022_PROGRAM));
    expect_err(h.send_create(&ctx), DropError::WrongTokenProgram);
}

#[test]
fn a_token_2022_mint_with_the_classic_program_fails_s6_1_10() {
    let mut h = Harness::new();
    let mint = h.create_pump_mint();
    let mut ctx = h.prepare(&receivers(1, 1_000), Some(mint), 22, 0);
    ctx.token_program = TOKEN_PROGRAM;
    ctx.vault = Some(ata_address(&ctx.drop, &mint, &TOKEN_PROGRAM));
    expect_err(h.send_create(&ctx), DropError::WrongTokenProgram);
}

#[test]
fn vault_that_is_not_the_ata_fails_s6_1_10() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let mut ctx = h.prepare(&receivers(1, 1_000), Some(mint), 23, 0);
    // somebody else's token account for the same mint
    let other = h.create_ata(&h.funder.pubkey(), &mint, &TOKEN_PROGRAM);
    ctx.vault = Some(other);
    expect_fail(h.send_create(&ctx));
}

#[test]
fn vault_for_another_mint_fails_s6_1_10() {
    let mut h = Harness::new();
    let mint = h.create_mint();
    let other_mint = h.create_mint();
    let mut ctx = h.prepare(&receivers(1, 1_000), Some(mint), 24, 0);
    ctx.vault = Some(ata_address(&ctx.drop, &other_mint, &TOKEN_PROGRAM));
    expect_fail(h.send_create(&ctx));
}

#[test]
fn token_2022_account_as_recipient_ata_on_a_classic_drop_fails_s12_4() {
    // A classic drop; a claim passing a Token-2022 account in the recipient_ata slot.
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(2, 1_000_000), 25);
    h.fund_and_activate(&ctx);

    let mint2022 = h.create_mint_with(&TOKEN_2022_PROGRAM, None);
    let recipient = ctx.recipient(0);
    let ata2022 = h.create_ata(&recipient, &mint2022, &TOKEN_2022_PROGRAM);

    let relayer = h.relayer.insecure_clone();
    let mut ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &recipient, ctx.amount(0), ctx.proof(0));
    // account order: caller, drop, bitmap, recipient, mint, vault, recipient_ata, ...
    ix.accounts[6].pubkey = ata2022;
    expect_fail(h.send(&[ix], &[&relayer]));
    assert!(!h.is_claimed(&ctx, 0));
}

#[test]
fn token_2022_account_as_vault_in_a_classic_claim_fails_s12_4() {
    let mut h = Harness::new();
    let ctx = h.new_spl_drop(&receivers(2, 1_000_000), 26);
    h.fund_and_activate(&ctx);
    let mint2022 = h.create_mint_with(&TOKEN_2022_PROGRAM, None);
    let fake_vault = h.create_ata(&ctx.drop, &mint2022, &TOKEN_2022_PROGRAM);

    let relayer = h.relayer.insecure_clone();
    let mut ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), ctx.amount(0), ctx.proof(0));
    ix.accounts[5].pubkey = fake_vault;
    expect_fail(h.send(&[ix], &[&relayer]));
    assert!(!h.is_claimed(&ctx, 0));
}

#[test]
fn the_classic_program_in_a_token_2022_claim_fails_s12_4() {
    let mut h = Harness::new();
    let mint = h.create_pump_mint();
    let ctx = h.new_token_drop(&receivers(2, 1_000_000), mint, 27, 0);
    h.fund_and_activate(&ctx);

    let relayer = h.relayer.insecure_clone();
    let mut ix = h.claim_ix(&ctx, &relayer.pubkey(), 0, &ctx.recipient(0), ctx.amount(0), ctx.proof(0));
    // account order: caller, drop, bitmap, recipient, mint, vault, recipient_ata, token_program, ...
    ix.accounts[6].pubkey = ata_address(&ctx.recipient(0), &mint, &TOKEN_PROGRAM);
    ix.accounts[7].pubkey = TOKEN_PROGRAM;
    expect_fail(h.send(&[ix], &[&relayer]));
    assert!(!h.is_claimed(&ctx, 0));
}

// -- sweep of a Token-2022 stray ------------------------------------------------------

#[test]
fn sweep_of_a_token_2022_stray_balance_works_s6_8_4() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(30);
    let mint2022 = h.create_mint_with(&TOKEN_2022_PROGRAM, None);
    let stray = h.create_ata(&ctx.drop, &mint2022, &TOKEN_2022_PROGRAM);
    h.mint_to(&TOKEN_2022_PROGRAM, &mint2022, &stray, 5);
    expect_ok(h.sweep(&ctx, &mint2022));
    assert_eq!(h.token_balance(&stray), 0);
    assert_eq!(h.token_balance(&ata_address(&ctx.refund_recipient, &mint2022, &TOKEN_2022_PROGRAM)), 5);
}

#[test]
fn sweep_of_a_blocked_token_2022_stray_fails_and_it_stays_s6_8_4() {
    let mut h = Harness::new();
    let ctx = h.finished_spl_drop(31);
    let mint2022 = h.create_mint_2022(None, &[ExtensionType::PermanentDelegate], false);
    let stray = h.create_ata(&ctx.drop, &mint2022, &TOKEN_2022_PROGRAM);
    h.mint_to(&TOKEN_2022_PROGRAM, &mint2022, &stray, 5);
    expect_err(h.sweep(&ctx, &mint2022), DropError::MintExtensionNotAllowed);
    assert_eq!(h.token_balance(&stray), 5, "stuck where it is");
}
