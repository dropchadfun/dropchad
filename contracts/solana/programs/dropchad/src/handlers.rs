//! Instruction bodies, `docs/SPEC-SOLANA.md` section 6.
//!
//! Every body follows the same order as its spec block: preconditions in the spec's order, then
//! every state write, then the interactions at the end. The declarative checks, seeds, bumps,
//! owners, signers and token account derivations, already ran in `contexts.rs` before any of
//! this code is reached.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::Discriminator;
use anchor_spl::associated_token::{self, AssociatedToken, Create};
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, ExtensionType, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as MintState;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use anchor_spl::{token, token_2022};

use crate::constants::*;
use crate::contexts::*;
use crate::errors::DropError;
use crate::events::*;
use crate::merkle;
use crate::state::{Config, CreateParams, Drop, DropStatus};

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

fn is_finished(drop: &Drop) -> bool {
    matches!(drop.status, DropStatus::Finalized | DropStatus::Cancelled)
}

/// S6.0. The passed token accounts must match the drop's asset kind, and for a token drop the
/// exact mint and vault. A vault that reached this point already passed the associated token
/// derivation for the passed token program, so the stored vault pins the program too.
fn check_asset_accounts(drop: &Drop, mint: Option<Pubkey>, vault: Option<Pubkey>) -> Result<()> {
    match (drop.is_spl(), mint, vault) {
        (false, None, None) => Ok(()),
        (true, Some(mint), Some(vault)) => {
            require_keys_eq!(mint, drop.asset, DropError::AssetAccountsMismatch);
            require_keys_eq!(vault, drop.vault, DropError::AssetAccountsMismatch);
            Ok(())
        }
        _ => err!(DropError::AssetAccountsMismatch),
    }
}

/// S12.3. A Token-2022 mint may carry `metadataPointer` and `tokenMetadata` and nothing else.
/// Default deny. A classic mint has no extensions.
fn check_mint_extensions(mint: &AccountInfo) -> Result<()> {
    if *mint.owner != anchor_spl::token_2022::ID {
        return Ok(());
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)?;
    for extension in state.get_extension_types()? {
        require!(
            matches!(
                extension,
                ExtensionType::MetadataPointer | ExtensionType::TokenMetadata
            ),
            DropError::MintExtensionNotAllowed
        );
    }
    Ok(())
}

/// S8.19. The size of one receiver token account under `token_program`.
fn token_account_size(token_program: &Pubkey) -> usize {
    if *token_program == anchor_spl::token_2022::ID {
        TOKEN_2022_ACCOUNT_SIZE
    } else {
        TOKEN_ACCOUNT_SIZE
    }
}

/// S8.20. A SOL drop's fee: `min(max(bps fee, min_fee_lamports, min_fee_per_receiver_lamports
/// × leaf_count), max_fee_lamports)`, the products in `u128`, the bps fee rounded down. Zero
/// turns a part off: a zero minimum never wins the max, a zero cap is no cap. With both S8.20
/// fields zero it is the S8.14 fee, `max(min_fee_lamports, bps fee)`.
fn sol_drop_fee(config: &Config, params: &CreateParams) -> Result<u64> {
    let bps_fee = u128::from(params.total_entitlements) * u128::from(config.default_fee_bps)
        / u128::from(BPS_DENOMINATOR);
    let per_receiver =
        u128::from(config.min_fee_per_receiver_lamports) * u128::from(params.leaf_count);
    let mut fee = bps_fee
        .max(u128::from(config.min_fee_lamports))
        .max(per_receiver);
    if config.max_fee_lamports != 0 {
        fee = fee.min(u128::from(config.max_fee_lamports));
    }
    // Cannot fail under the ceilings, `MAX_FEE_BPS` and `MAX_LEAVES`; checked all the same.
    u64::try_from(fee).map_err(|_| error!(DropError::Overflow))
}

/// S3.7. The SOL a drop can spend: lamports above its own rent minimum. Never the rent, I18.
fn spendable_lamports(drop: &AccountInfo) -> Result<u64> {
    let rent = Rent::get()?.minimum_balance(drop.data_len());
    Ok(drop.lamports().saturating_sub(rent))
}

/// S6.10.9, round F2. True when `extra` lamports meant for the refund recipient stay in the drop:
/// the recipient has no account and the runtime would refuse to create it with that little, S5.11.
fn keeps_dust(refund_recipient: &AccountInfo, extra: u64) -> Result<bool> {
    Ok(extra > 0 && refund_recipient.lamports() == 0 && extra < Rent::get()?.minimum_balance(0))
}

/// S6.2.3. The balance of the drop asset: the vault for a token drop, the spendable SOL else.
fn asset_balance(
    drop: &Account<Drop>,
    vault: Option<&InterfaceAccount<TokenAccount>>,
) -> Result<u64> {
    match vault {
        Some(vault) => Ok(vault.amount),
        None => spendable_lamports(&drop.to_account_info()),
    }
}

/// A direct debit of the drop account and credit of `to`, S6.3.10. Never below the drop's rent
/// minimum, I18. A zero amount moves nothing.
fn move_lamports(drop: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    // A correct drop can never trip this, I3 and I3b guarantee the balance. Kept as a hard stop.
    require!(amount <= spendable_lamports(drop)?, DropError::Underfunded);
    {
        let mut from = drop.try_borrow_mut_lamports()?;
        **from = from.checked_sub(amount).ok_or(DropError::Overflow)?;
    }
    {
        let mut to = to.try_borrow_mut_lamports()?;
        **to = to.checked_add(amount).ok_or(DropError::Overflow)?;
    }
    Ok(())
}

/// One payout of the drop asset. SOL is a direct debit and credit, S6.3.10. A token is a
/// `transfer_checked` signed by the drop PDA, S6.3.9, S12.4. A zero amount moves nothing.
fn pay_out<'info>(
    drop: &Account<'info, Drop>,
    mint: Option<&InterfaceAccount<'info, Mint>>,
    vault: Option<&InterfaceAccount<'info, TokenAccount>>,
    token_program: Option<&Interface<'info, TokenInterface>>,
    to_sol: &AccountInfo<'info>,
    to_ata: Option<AccountInfo<'info>>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    if drop.is_spl() {
        let (mint, vault, token_program, to_ata) = match (mint, vault, token_program, to_ata) {
            (Some(m), Some(v), Some(t), Some(a)) => (m, v, t, a),
            _ => return err!(DropError::AssetAccountsMismatch),
        };
        let nonce = drop.nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[
            DROP_SEED,
            drop.creator_commitment.as_ref(),
            &nonce,
            &[drop.bump],
        ];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                token_program.key(),
                TransferChecked {
                    from: vault.to_account_info(),
                    mint: mint.to_account_info(),
                    to: to_ata,
                    authority: drop.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            mint.decimals,
        )
    } else {
        move_lamports(&drop.to_account_info(), to_sol, amount)
    }
}

/// S6.3.13. What a claim pays its caller back: what the caller pays to create the receiver's
/// token account, never more than the budget left. Zero on a SOL drop, and zero when the account
/// already exists, that is when the token program owns it. Otherwise the ATA program takes the
/// rent minimum less the lamports already at the address from the caller, so that is the pay
/// back. The round 4 upgrade, audit round 3 M1: before, one lamport sent first made it zero.
fn leaf_pay_back(
    drop: &Drop,
    recipient_ata: Option<&UncheckedAccount>,
    token_program: Option<&Interface<TokenInterface>>,
) -> Result<u64> {
    if !drop.is_spl() {
        return Ok(0);
    }
    let (ata, token_program) = match (recipient_ata, token_program) {
        (Some(a), Some(t)) => (a, t),
        _ => return err!(DropError::AssetAccountsMismatch),
    };
    if *ata.owner == token_program.key() {
        return Ok(0);
    }
    let rent = Rent::get()?.minimum_balance(token_account_size(&token_program.key()));
    let shortfall = rent.saturating_sub(ata.lamports());
    let left = drop
        .account_budget_lamports
        .saturating_sub(drop.account_budget_used);
    Ok(shortfall.min(left))
}

/// S6.3.9 and S6.3.13, the interactions of one claim. Token drop: the receiver's associated token
/// account is created when missing (the caller pays), the leaf is paid with `transfer_checked`,
/// then the caller gets `pay_back` from the drop account. SOL drop: the lamports, S6.3.10.
#[allow(clippy::too_many_arguments)]
fn pay_leaf<'info>(
    drop: &Account<'info, Drop>,
    caller: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    mint: Option<&InterfaceAccount<'info, Mint>>,
    vault: Option<&InterfaceAccount<'info, TokenAccount>>,
    recipient_ata: Option<&UncheckedAccount<'info>>,
    token_program: Option<&Interface<'info, TokenInterface>>,
    associated_token_program: Option<&Program<'info, AssociatedToken>>,
    system_program: &Program<'info, System>,
    amount: u64,
    pay_back: u64,
) -> Result<()> {
    if !drop.is_spl() {
        return pay_out(drop, None, None, None, recipient, None, amount);
    }
    let (mint_account, ata, token, ata_program) =
        match (mint, recipient_ata, token_program, associated_token_program) {
            (Some(m), Some(a), Some(t), Some(p)) => (m, a, t, p),
            _ => return err!(DropError::AssetAccountsMismatch),
        };
    associated_token::create_idempotent(CpiContext::new(
        ata_program.key(),
        Create {
            payer: caller.clone(),
            associated_token: ata.to_account_info(),
            authority: recipient.clone(),
            mint: mint_account.to_account_info(),
            system_program: system_program.to_account_info(),
            token_program: token.to_account_info(),
        },
    ))?;
    pay_out(
        drop,
        mint,
        vault,
        token_program,
        recipient,
        Some(ata.to_account_info()),
        amount,
    )?;
    move_lamports(&drop.to_account_info(), caller, pay_back)
}

// ---------------------------------------------------------------------------------------------
// 6.0 and 6.11, the config
// ---------------------------------------------------------------------------------------------

pub fn initialize_config(
    ctx: Context<InitializeConfig>,
    chain_id: u64,
    relayer: Pubkey,
    fee_wallet: Pubkey,
    default_fee_bps: u16,
) -> Result<()> {
    // S6.0.3
    require!(default_fee_bps <= MAX_FEE_BPS, DropError::FeeTooHigh);
    require_keys_neq!(relayer, Pubkey::default(), DropError::ZeroAddress);
    require_keys_neq!(fee_wallet, Pubkey::default(), DropError::ZeroAddress);

    // S6.0.4
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.authority.key();
    config.relayer = relayer;
    config.fee_wallet = fee_wallet;
    config.default_fee_bps = default_fee_bps;
    config.paused = false;
    config.chain_id = chain_id;
    config.bump = ctx.bumps.config;
    // S7.23. Handle mode starts off: no binder, no guardian, no minimum fee.
    config.binder = Pubkey::default();
    config.binder_revoked = false;
    config.guardian = Pubkey::default();
    config.min_fee_lamports = 0;
    // S8.20. Off until the admin sets them.
    config.min_fee_per_receiver_lamports = 0;
    config.max_fee_lamports = 0;
    // S6.11.6. Nothing pending.
    config.pending_admin = Pubkey::default();
    config.reserved = [0u8; 16];

    emit!(ConfigInitialized {
        admin: config.admin,
        relayer,
        fee_wallet,
        default_fee_bps,
        chain_id
    });
    Ok(())
}

pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    emit!(PausedSet { paused });
    Ok(())
}

pub fn set_default_fee_bps(ctx: Context<AdminOnly>, bps: u16) -> Result<()> {
    // S6.11.4
    require!(bps <= MAX_FEE_BPS, DropError::FeeTooHigh);
    let config = &mut ctx.accounts.config;
    let old_bps = config.default_fee_bps;
    config.default_fee_bps = bps;
    emit!(DefaultFeeBpsSet {
        old_bps,
        new_bps: bps
    });
    Ok(())
}

pub fn set_fee_wallet(ctx: Context<AdminOnly>, fee_wallet: Pubkey) -> Result<()> {
    require_keys_neq!(fee_wallet, Pubkey::default(), DropError::ZeroAddress);
    let config = &mut ctx.accounts.config;
    let old_wallet = config.fee_wallet;
    config.fee_wallet = fee_wallet;
    emit!(FeeWalletSet {
        old_wallet,
        new_wallet: fee_wallet
    });
    Ok(())
}

pub fn set_relayer(ctx: Context<AdminOnly>, relayer: Pubkey) -> Result<()> {
    require_keys_neq!(relayer, Pubkey::default(), DropError::ZeroAddress);
    let config = &mut ctx.accounts.config;
    let old_relayer = config.relayer;
    config.relayer = relayer;
    emit!(RelayerSet {
        old_relayer,
        new_relayer: relayer
    });
    Ok(())
}

/// S6.11.6, step one. Nothing moves yet; a second call replaces the key, zero cancels.
pub fn propose_admin(ctx: Context<AdminOnly>, pending_admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.pending_admin = pending_admin;
    emit!(AdminProposed {
        admin: config.admin,
        pending_admin
    });
    Ok(())
}

/// S6.11.6, step two. The `has_one` already proved the signer is the pending key.
pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_admin = config.admin;
    config.admin = config.pending_admin;
    config.pending_admin = Pubkey::default();
    emit!(AdminSet {
        old_admin,
        new_admin: config.admin
    });
    Ok(())
}

/// S7.23. Sets the binder and clears the revoke, so handle claims resume.
pub fn set_binder(ctx: Context<AdminOnly>, binder: Pubkey) -> Result<()> {
    require_keys_neq!(binder, Pubkey::default(), DropError::ZeroAddress);
    let config = &mut ctx.accounts.config;
    let old_binder = config.binder;
    config.binder = binder;
    config.binder_revoked = false;
    emit!(BinderSet {
        old_binder,
        new_binder: binder
    });
    Ok(())
}

/// R7.23. The admin or the guardian. Instant; every `claim_handle` stops, address claims do not.
pub fn revoke_binder(ctx: Context<RevokeBinder>) -> Result<()> {
    let by = ctx.accounts.signer.key();
    let config = &mut ctx.accounts.config;
    let is_admin = by == config.admin;
    // A zero guardian can never match a signer, so "no guardian" lets nobody extra through.
    let is_guardian = config.guardian != Pubkey::default() && by == config.guardian;
    require!(is_admin || is_guardian, DropError::NotAdminOrGuardian);
    config.binder_revoked = true;
    emit!(BinderRevoked { by });
    Ok(())
}

/// S6.11.9. The admin or the guardian. Sets `paused` only, never clears it; unpause is
/// `set_paused(false)`, admin only.
pub fn guardian_pause(ctx: Context<GuardianPause>) -> Result<()> {
    let by = ctx.accounts.signer.key();
    let config = &mut ctx.accounts.config;
    let is_admin = by == config.admin;
    // A zero guardian can never match a signer, so "no guardian" lets nobody extra through.
    let is_guardian = config.guardian != Pubkey::default() && by == config.guardian;
    require!(is_admin || is_guardian, DropError::NotAdminOrGuardian);
    config.paused = true;
    emit!(GuardianPaused { by });
    Ok(())
}

/// S7.23. Zero means none.
pub fn set_guardian(ctx: Context<AdminOnly>, guardian: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_guardian = config.guardian;
    config.guardian = guardian;
    emit!(GuardianSet {
        old_guardian,
        new_guardian: guardian
    });
    Ok(())
}

/// S8.14. New SOL drops only, capped at `MAX_MIN_FEE_LAMPORTS`.
pub fn set_min_fee(ctx: Context<AdminOnly>, lamports: u64) -> Result<()> {
    require!(lamports <= MAX_MIN_FEE_LAMPORTS, DropError::FeeTooHigh);
    let config = &mut ctx.accounts.config;
    let old_lamports = config.min_fee_lamports;
    config.min_fee_lamports = lamports;
    emit!(MinFeeSet {
        old_lamports,
        new_lamports: lamports
    });
    Ok(())
}

/// S8.20. New SOL drops only, capped at `MAX_MIN_FEE_PER_RECEIVER_LAMPORTS`. Zero is off.
pub fn set_fee_per_receiver(ctx: Context<AdminOnly>, lamports: u64) -> Result<()> {
    require!(
        lamports <= MAX_MIN_FEE_PER_RECEIVER_LAMPORTS,
        DropError::FeeTooHigh
    );
    let config = &mut ctx.accounts.config;
    let old_lamports = config.min_fee_per_receiver_lamports;
    config.min_fee_per_receiver_lamports = lamports;
    emit!(FeePerReceiverSet {
        old_lamports,
        new_lamports: lamports
    });
    Ok(())
}

/// S8.20. New SOL drops only, capped at `MAX_SOL_FEE_LAMPORTS`. Zero is no cap.
pub fn set_max_fee(ctx: Context<AdminOnly>, lamports: u64) -> Result<()> {
    require!(lamports <= MAX_SOL_FEE_LAMPORTS, DropError::FeeTooHigh);
    let config = &mut ctx.accounts.config;
    let old_lamports = config.max_fee_lamports;
    config.max_fee_lamports = lamports;
    emit!(MaxFeeSet {
        old_lamports,
        new_lamports: lamports
    });
    Ok(())
}

/// S7.27. Grows the 116 byte legacy `Config` to the 253 byte layout, once. The old bytes keep
/// their offsets, the new ones are zero, the rent is topped up by the admin.
pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
    let info = ctx.accounts.config.to_account_info();

    // The address is the seeds constraint. The rest by hand, before any write.
    require_keys_eq!(
        *info.owner,
        crate::ID,
        anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram
    );
    let old_len = {
        let data = info.try_borrow_data()?;
        require!(
            data.len() >= 8 && data[..8] == Config::DISCRIMINATOR[..],
            anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch
        );
        require!(data.len() == LEGACY_CONFIG_SIZE, DropError::AlreadyMigrated);
        // `admin` is the first field, bytes 8 to 40.
        require!(
            data[8..40] == ctx.accounts.admin.key().to_bytes()[..],
            DropError::NotAdmin
        );
        data.len()
    };

    // Top the rent up to the new minimum, from the admin.
    let new_len = Config::SIZE;
    let needed = Rent::get()?.minimum_balance(new_len);
    let have = info.lamports();
    if needed > have {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: info.clone(),
                },
            ),
            needed - have,
        )?;
    }

    // `resize` zero extends, solana-account-info 3.1.1. The zeros are written again by hand so
    // the rule does not rest on a library detail.
    info.resize(new_len)?;
    {
        let mut data = info.try_borrow_mut_data()?;
        data[old_len..].fill(0);
    }

    emit!(ConfigMigrated {
        old_len: old_len as u32,
        new_len: new_len as u32
    });
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// 6.1 create_drop
// ---------------------------------------------------------------------------------------------

/// S6.1.6, the round 2 upgrade. The drop's own accounts and the programs can never take a
/// refund. The System program is the default key, refused before this as `ZeroRefundRecipient`.
fn is_refused_refund_recipient(ctx: &Context<CreateDrop>, key: &Pubkey) -> bool {
    let accounts = &ctx.accounts;
    let refused = [
        accounts.drop.key(),
        accounts.bitmap.key(),
        accounts.config.key(),
        crate::ID,
        token::ID,
        token_2022::ID,
        associated_token::ID,
    ];
    refused.contains(key)
        || accounts
            .mint
            .as_ref()
            .is_some_and(|mint| mint.key() == *key)
        || accounts
            .vault
            .as_ref()
            .is_some_and(|vault| vault.key() == *key)
}

pub fn create_drop(ctx: Context<CreateDrop>, params: CreateParams) -> Result<()> {
    let config = &ctx.accounts.config;

    // S6.1.0 is the has_one on config and the Signer type. S6.1.1 to S6.1.9 in order.
    require!(!config.paused, DropError::CreationPaused);
    require!(params.total_entitlements > 0, DropError::ZeroTotal);
    require!(
        params.leaf_count > 0 && params.leaf_count <= MAX_LEAVES,
        DropError::BadLeafCount
    );
    require!(params.merkle_root != [0u8; 32], DropError::ZeroRoot);
    require!(params.manifest_hash != [0u8; 32], DropError::ZeroManifest);
    require_keys_neq!(
        params.refund_recipient,
        Pubkey::default(),
        DropError::ZeroRefundRecipient
    );
    require!(
        !is_refused_refund_recipient(&ctx, &params.refund_recipient),
        DropError::RefundRecipientRefused
    );
    require!(
        params.creator_commitment != [0u8; 32],
        DropError::ZeroCommitment
    );
    require!(
        (MIN_FUNDING_PERIOD..=MAX_FUNDING_PERIOD).contains(&params.funding_period),
        DropError::BadFundingPeriod
    );
    require!(
        (MIN_CLAIM_PERIOD..=MAX_CLAIM_PERIOD).contains(&params.claim_period),
        DropError::BadClaimPeriod
    );

    // S6.1.10. The mint loaded as an account of either token program. Here, before the vault
    // exists: the program is the mint's owner, the extensions are allowed, no freeze authority
    // unless S12.8. The vault address is checked by the ATA program when it is created below.
    let token = match (
        &ctx.accounts.mint,
        &ctx.accounts.vault,
        &ctx.accounts.token_program,
        &ctx.accounts.associated_token_program,
    ) {
        (None, None, _, _) => None,
        (Some(mint), Some(vault), Some(token_program), Some(ata_program)) => {
            let mint_info = mint.to_account_info();
            require_keys_eq!(
                *mint_info.owner,
                token_program.key(),
                DropError::WrongTokenProgram
            );
            check_mint_extensions(&mint_info)?;
            require!(
                mint.freeze_authority.is_none() || FREEZE_EXCEPTION_MINTS.contains(&mint.key()),
                DropError::MintHasFreezeAuthority
            );
            Some((mint, vault, token_program, ata_program))
        }
        _ => return err!(DropError::AssetAccountsMismatch),
    };

    // S6.1.14. Up to the cap on a token drop, zero on a SOL drop.
    let sol_fee_cap = if token.is_some() {
        MAX_SOL_FEE_LAMPORTS
    } else {
        0
    };
    require!(
        params.sol_fee_lamports <= sol_fee_cap,
        DropError::SolFeeTooHigh
    );

    // Effects 1 to 4
    let (asset, vault, fee_amount, account_budget_lamports) = match &token {
        None => {
            // S8.20, and S8.14 while the two new fields are zero.
            (
                Pubkey::default(),
                Pubkey::default(),
                sol_drop_fee(config, &params)?,
                0,
            )
        }
        Some((mint, vault, token_program, _)) => {
            // S8.11, no fee in the token. S8.19, the budget the program works out itself.
            let rent = Rent::get()?.minimum_balance(token_account_size(&token_program.key()));
            let budget = u64::from(params.leaf_count)
                .checked_mul(rent)
                .ok_or(DropError::Overflow)?;
            (mint.key(), vault.key(), 0, budget)
        }
    };
    let gross_required = params
        .total_entitlements
        .checked_add(fee_amount)
        .ok_or(DropError::Overflow)?;
    let created_at = now()?;
    let funding_deadline = created_at
        .checked_add(i64::from(params.funding_period))
        .ok_or(DropError::Overflow)?;

    // Effect 5, every field of 5.2
    let drop = &mut ctx.accounts.drop;
    drop.asset = asset;
    drop.vault = vault;
    drop.merkle_root = params.merkle_root;
    drop.manifest_hash = params.manifest_hash;
    drop.total_entitlements = params.total_entitlements;
    drop.gross_required = gross_required;
    drop.fee_amount = fee_amount;
    drop.fee_wallet = config.fee_wallet;
    drop.refund_recipient = params.refund_recipient;
    drop.funding_deadline = funding_deadline;
    drop.claim_period = params.claim_period;
    drop.creator_commitment = params.creator_commitment;
    drop.nonce = params.nonce;
    drop.leaf_count = params.leaf_count;
    drop.chain_id = config.chain_id;
    drop.rent_payer = ctx.accounts.relayer.key(); // S6.1.13
    drop.created_at = created_at;
    drop.bump = ctx.bumps.drop;
    drop.bitmap_bump = ctx.bumps.bitmap;
    drop.activated_at = 0;
    drop.claim_deadline = 0;
    drop.status = DropStatus::Created;
    drop.total_claimed = 0;
    drop.claimed_count = 0;
    drop.closed = false;
    drop.sol_fee_lamports = params.sol_fee_lamports;
    drop.account_budget_lamports = account_budget_lamports;
    drop.account_budget_used = 0;

    // Effect 6. `load_init` is the one call allowed on a freshly created zero copy account.
    // Scoped so the loader's borrow ends before the event reads the drop again.
    {
        let mut bitmap = ctx.accounts.bitmap.load_init()?;
        bitmap.drop = drop.key();
        bitmap.bump = ctx.bumps.bitmap;
        bitmap.bits = [0u8; BITMAP_BYTES];
    }

    // Effect 7
    emit!(DropCreated {
        drop: drop.key(),
        creator_commitment: drop.creator_commitment,
        asset,
        vault,
        merkle_root: drop.merkle_root,
        manifest_hash: drop.manifest_hash,
        total_entitlements: drop.total_entitlements,
        fee_amount,
        gross_required,
        fee_wallet: drop.fee_wallet,
        refund_recipient: drop.refund_recipient,
        funding_deadline,
        claim_period: drop.claim_period,
        leaf_count: drop.leaf_count,
        chain_id: drop.chain_id,
        nonce: drop.nonce,
        rent_payer: drop.rent_payer,
        created_at,
    });

    // The vault, S3.3. The relayer pays its rent, S6.1.13. Idempotent from the round 4 upgrade
    // (audit round 3 L3): a vault somebody created first is accepted, S6.1.10. Only the ATA
    // program can create an account at that address, and it checks the owner and the mint.
    if let Some((mint, vault, token_program, ata_program)) = token {
        associated_token::create_idempotent(CpiContext::new(
            ata_program.key(),
            Create {
                payer: ctx.accounts.relayer.to_account_info(),
                associated_token: vault.to_account_info(),
                authority: ctx.accounts.drop.to_account_info(),
                mint: mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: token_program.to_account_info(),
            },
        ))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// 6.2 activate
// ---------------------------------------------------------------------------------------------

pub fn activate(ctx: Context<Activate>) -> Result<()> {
    let drop = &ctx.accounts.drop;
    check_asset_accounts(
        drop,
        ctx.accounts.mint.as_ref().map(|m| m.key()),
        ctx.accounts.vault.as_ref().map(|v| v.key()),
    )?;

    // S6.2.1 to S6.2.3
    require!(drop.status == DropStatus::Created, DropError::WrongStatus);
    let now = now()?;
    require!(now <= drop.funding_deadline, DropError::FundingExpired);
    let balance = asset_balance(drop, ctx.accounts.vault.as_deref())?;
    require!(balance >= drop.gross_required, DropError::Underfunded);
    // A token drop also holds its SOL side: the fee and the account budget.
    let fee = if drop.is_spl() {
        let sol_side = drop
            .sol_fee_lamports
            .checked_add(drop.account_budget_lamports)
            .ok_or(DropError::Overflow)?;
        require!(
            spendable_lamports(&drop.to_account_info())? >= sol_side,
            DropError::Underfunded
        );
        drop.sol_fee_lamports
    } else {
        drop.fee_amount
    };
    // S6.2.4 is the address constraint on fee_wallet.

    // Effects 1 to 4
    let drop = &mut ctx.accounts.drop;
    drop.activated_at = now;
    drop.claim_deadline = now
        .checked_add(i64::from(drop.claim_period))
        .ok_or(DropError::Overflow)?;
    drop.status = DropStatus::Active;
    emit!(Activated {
        drop: drop.key(),
        activated_at: now,
        balance,
        claim_deadline: drop.claim_deadline,
        fee_paid: fee,
    });

    // Effect 5, then the fee in lamports, for both kinds of drop. S6.2.7: every write above
    // happened first. Nothing of a token moves here, S8.11.
    move_lamports(
        &ctx.accounts.drop.to_account_info(),
        &ctx.accounts.fee_wallet.to_account_info(),
        fee,
    )
}

// ---------------------------------------------------------------------------------------------
// 6.3 claim
// ---------------------------------------------------------------------------------------------

pub fn claim(ctx: Context<Claim>, index: u32, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    let drop = &ctx.accounts.drop;
    check_asset_accounts(
        drop,
        ctx.accounts.mint.as_ref().map(|m| m.key()),
        ctx.accounts.vault.as_ref().map(|v| v.key()),
    )?;

    // S6.3.1 to S6.3.7, in order
    require!(drop.status == DropStatus::Active, DropError::WrongStatus);
    require!(now()? <= drop.claim_deadline, DropError::ClaimWindowClosed);
    require!(index < drop.leaf_count, DropError::BadIndex);
    require!(
        !ctx.accounts.bitmap.load()?.is_claimed(index),
        DropError::AlreadyClaimed
    );
    require!(proof.len() <= MAX_PROOF_LEN, DropError::BadProof);
    let leaf = merkle::leaf_hash(
        &drop.key(),
        drop.chain_id,
        index,
        &ctx.accounts.recipient.key(),
        amount,
    );
    require!(
        merkle::verify(&drop.merkle_root, &leaf, &proof),
        DropError::BadProof
    );
    let total_claimed = drop
        .total_claimed
        .checked_add(amount)
        .ok_or(DropError::Overflow)?;
    require!(
        total_claimed <= drop.total_entitlements,
        DropError::OverEntitlement
    );
    let pay_back = leaf_pay_back(
        drop,
        ctx.accounts.recipient_ata.as_ref(),
        ctx.accounts.token_program.as_ref(),
    )?;

    // Effects 1 to 4. The bit first, S6.3.8.
    ctx.accounts.bitmap.load_mut()?.set_claimed(index);
    let drop = &mut ctx.accounts.drop;
    drop.total_claimed = total_claimed;
    drop.claimed_count = drop
        .claimed_count
        .checked_add(1)
        .ok_or(DropError::Overflow)?;
    drop.account_budget_used = drop
        .account_budget_used
        .checked_add(pay_back)
        .ok_or(DropError::Overflow)?;
    emit!(Claimed {
        drop: drop.key(),
        index,
        recipient: ctx.accounts.recipient.key(),
        amount,
    });

    // Effects 5 and 6
    pay_leaf(
        &ctx.accounts.drop,
        &ctx.accounts.caller.to_account_info(),
        &ctx.accounts.recipient.to_account_info(),
        ctx.accounts.mint.as_deref(),
        ctx.accounts.vault.as_deref(),
        ctx.accounts.recipient_ata.as_ref(),
        ctx.accounts.token_program.as_ref(),
        ctx.accounts.associated_token_program.as_ref(),
        &ctx.accounts.system_program,
        amount,
        pay_back,
    )
}

// ---------------------------------------------------------------------------------------------
// S7.25 claim_handle
// ---------------------------------------------------------------------------------------------

/// S7.22. The strict Ed25519 layout, and the only one accepted: one signature, every
/// instruction index `u16::MAX` ("this instruction"), the key at 16, the signature at 48, the
/// message at 112. The same layout `solana-ed25519-program` 3.0.0 builds, checked in its source.
const ED25519_HEADER: [u8; 2] = [1, 0];
const ED25519_KEY_AT: usize = 16;
const ED25519_SIG_AT: usize = 48;
const ED25519_MSG_AT: usize = 112;
const ED25519_DATA_LEN: usize = ED25519_MSG_AT + merkle::BINDING_MESSAGE_BYTES;
const ED25519_OFFSETS: [u16; 7] = [
    ED25519_SIG_AT as u16,
    u16::MAX,
    ED25519_KEY_AT as u16,
    u16::MAX,
    ED25519_MSG_AT as u16,
    merkle::BINDING_MESSAGE_BYTES as u16,
    u16::MAX,
];

/// S7.22. The instruction directly before this one must be the Ed25519 program, in the strict
/// layout, with `binder` as the key and the binding v2 message of this leaf and `recipient`. The
/// runtime already verified the signature before this program ran; this proves which key signed
/// what. Returns the `valid_until` the binder signed, read from the verified message.
///
/// Every instruction index must be `u16::MAX`. Offsets that point into another instruction are
/// the classic way this pattern is broken: the runtime would verify bytes this check never sees.
fn check_binding(
    instructions: &AccountInfo,
    binder: &Pubkey,
    drop: &Account<Drop>,
    index: u32,
    x_id: u64,
    recipient: &Pubkey,
) -> Result<i64> {
    use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

    let current = usize::from(load_current_index_checked(instructions)?);
    require!(current > 0, DropError::BadBinding);
    let ed = load_instruction_at_checked(current - 1, instructions)?;
    require!(
        ed.program_id == solana_sdk_ids::ed25519_program::ID,
        DropError::BadBinding
    );

    let d = &ed.data;
    require!(d.len() == ED25519_DATA_LEN, DropError::BadBinding);
    require!(d[0..2] == ED25519_HEADER, DropError::BadBinding);
    for (i, want) in ED25519_OFFSETS.iter().enumerate() {
        let at = 2 + 2 * i;
        require!(
            u16::from_le_bytes([d[at], d[at + 1]]) == *want,
            DropError::BadBinding
        );
    }
    require!(
        d[ED25519_KEY_AT..ED25519_SIG_AT] == binder.to_bytes()[..],
        DropError::BadBinding
    );

    // S7.22. `valid_until` is the last 8 bytes of the signed message. The whole message, tag
    // and words included, must equal what the program builds with it.
    let mut until = [0u8; 8];
    until.copy_from_slice(&d[ED25519_MSG_AT + merkle::BINDING_VALID_UNTIL_AT..ED25519_DATA_LEN]);
    let valid_until = i64::from_be_bytes(until);
    let expected = merkle::binding_message(
        &drop.key(),
        drop.chain_id,
        index,
        x_id,
        recipient,
        valid_until,
    );
    require!(
        d[ED25519_MSG_AT..ED25519_DATA_LEN] == expected[..],
        DropError::BadBinding
    );
    Ok(valid_until)
}

pub fn claim_handle(
    ctx: Context<ClaimHandle>,
    index: u32,
    x_id: u64,
    amount: u64,
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    let drop = &ctx.accounts.drop;
    check_asset_accounts(
        drop,
        ctx.accounts.mint.as_ref().map(|m| m.key()),
        ctx.accounts.vault.as_ref().map(|v| v.key()),
    )?;

    // S6.3.1 and S6.3.2, as `claim`
    require!(drop.status == DropStatus::Active, DropError::WrongStatus);
    require!(now()? <= drop.claim_deadline, DropError::ClaimWindowClosed);

    // S7.25, in order: x_id range, index, bit, binder, binding, leaf and proof.
    // `x_id` is a `u64`, so `< 2^64` holds by type; zero is the one value to refuse, R7.34.
    require!(x_id != 0, DropError::BadXId);
    require!(index < drop.leaf_count, DropError::BadIndex);
    require!(
        !ctx.accounts.bitmap.load()?.is_claimed(index),
        DropError::AlreadyClaimed
    );

    // R7.22. Read live from the config on every call, never copied into the drop.
    let config = &ctx.accounts.config;
    require_keys_neq!(config.binder, Pubkey::default(), DropError::NoBinder);
    require!(!config.binder_revoked, DropError::BinderIsRevoked);

    let recipient = ctx.accounts.recipient.key();
    let valid_until = check_binding(
        &ctx.accounts.instructions.to_account_info(),
        &config.binder,
        drop,
        index,
        x_id,
        &recipient,
    )?;

    // S7.25, binding v2. At `now == valid_until` the binding still holds.
    let clock = now()?;
    require!(clock <= valid_until, DropError::BindingExpired);
    let latest = clock
        .checked_add(MAX_BINDING_LIFETIME)
        .ok_or(DropError::Overflow)?;
    require!(valid_until <= latest, DropError::BindingTooLong);

    require!(proof.len() <= MAX_PROOF_LEN, DropError::BadProof);
    let leaf = merkle::handle_leaf_hash(&drop.key(), drop.chain_id, index, x_id, amount);
    require!(
        merkle::verify(&drop.merkle_root, &leaf, &proof),
        DropError::BadProof
    );
    let total_claimed = drop
        .total_claimed
        .checked_add(amount)
        .ok_or(DropError::Overflow)?;
    require!(
        total_claimed <= drop.total_entitlements,
        DropError::OverEntitlement
    );
    let pay_back = leaf_pay_back(
        drop,
        ctx.accounts.recipient_ata.as_ref(),
        ctx.accounts.token_program.as_ref(),
    )?;

    // The bit first, S6.3.8 and R7.21.
    ctx.accounts.bitmap.load_mut()?.set_claimed(index);
    let drop = &mut ctx.accounts.drop;
    drop.total_claimed = total_claimed;
    drop.claimed_count = drop
        .claimed_count
        .checked_add(1)
        .ok_or(DropError::Overflow)?;
    drop.account_budget_used = drop
        .account_budget_used
        .checked_add(pay_back)
        .ok_or(DropError::Overflow)?;
    // R7.41. `HandleClaimed`, never `Claimed`: one event per payout.
    emit!(HandleClaimed {
        drop: drop.key(),
        index,
        x_id,
        recipient,
        amount
    });

    // The payout and the pay back, as `claim`, S6.3.13.
    pay_leaf(
        &ctx.accounts.drop,
        &ctx.accounts.caller.to_account_info(),
        &ctx.accounts.recipient.to_account_info(),
        ctx.accounts.mint.as_deref(),
        ctx.accounts.vault.as_deref(),
        ctx.accounts.recipient_ata.as_ref(),
        ctx.accounts.token_program.as_ref(),
        ctx.accounts.associated_token_program.as_ref(),
        &ctx.accounts.system_program,
        amount,
        pay_back,
    )
}

// ---------------------------------------------------------------------------------------------
// 6.6 cancel_unfunded and 6.7 refund
// ---------------------------------------------------------------------------------------------

/// S6.8.5. The lamports of a token drop above its rent minimum. Zero on a SOL drop, whose
/// lamports are the drop asset itself.
fn sol_side_left(drop: &Account<Drop>) -> Result<u64> {
    if drop.is_spl() {
        spendable_lamports(&drop.to_account_info())
    } else {
        Ok(0)
    }
}

/// What `cancel_unfunded` and `refund` send: the asset balance and a token drop's SOL side. The
/// lamports among them stay in the drop in the S6.10.9 case, so the events say what really goes
/// out; a token drop's tokens always go.
fn settle_amounts(ctx: &Context<Settle>) -> Result<(u64, u64)> {
    let drop = &ctx.accounts.drop;
    let balance = asset_balance(drop, ctx.accounts.vault.as_deref())?;
    let sol_side = sol_side_left(drop)?;
    let lamports_out = if drop.is_spl() { sol_side } else { balance };
    if keeps_dust(
        &ctx.accounts.refund_recipient.to_account_info(),
        lamports_out,
    )? {
        let balance = if drop.is_spl() { balance } else { 0 };
        return Ok((balance, 0));
    }
    Ok((balance, sol_side))
}

/// The interactions of `cancel_unfunded` and `refund`: the asset, then a token drop's SOL side,
/// both to the refund recipient. One destination, everything left, S6.7.4.
fn settle_pay_out(ctx: &Context<Settle>, balance: u64, sol_side: u64) -> Result<()> {
    let accounts = &ctx.accounts;
    let refund_recipient = accounts.refund_recipient.to_account_info();
    pay_out(
        &accounts.drop,
        accounts.mint.as_deref(),
        accounts.vault.as_deref(),
        accounts.token_program.as_ref(),
        &refund_recipient,
        accounts.refund_ata.as_ref().map(|a| a.to_account_info()),
        balance,
    )?;
    move_lamports(
        &accounts.drop.to_account_info(),
        &refund_recipient,
        sol_side,
    )
}

pub fn cancel_unfunded(ctx: Context<Settle>) -> Result<()> {
    let drop = &ctx.accounts.drop;
    check_asset_accounts(
        drop,
        ctx.accounts.mint.as_ref().map(|m| m.key()),
        ctx.accounts.vault.as_ref().map(|v| v.key()),
    )?;

    // S6.6.1, S6.6.2. S6.6.3 is the address constraint.
    require!(drop.status == DropStatus::Created, DropError::WrongStatus);
    require!(now()? > drop.funding_deadline, DropError::FundingStillOpen);

    // Effects. A token drop also sends back its SOL side: the fee and the budget, S6.8.5.
    let (balance, sol_side) = settle_amounts(&ctx)?;
    let drop = &mut ctx.accounts.drop;
    drop.status = DropStatus::Cancelled;
    emit!(CancelledUnfunded {
        drop: drop.key(),
        refund_recipient: drop.refund_recipient,
        amount: balance,
    });

    settle_pay_out(&ctx, balance, sol_side)
}

pub fn refund(ctx: Context<Settle>) -> Result<()> {
    let drop = &ctx.accounts.drop;
    check_asset_accounts(
        drop,
        ctx.accounts.mint.as_ref().map(|m| m.key()),
        ctx.accounts.vault.as_ref().map(|v| v.key()),
    )?;

    // S6.7.1, S6.7.2. S6.7.3 is the address constraint.
    require!(drop.status == DropStatus::Active, DropError::WrongStatus);
    require!(now()? > drop.claim_deadline, DropError::ClaimWindowOpen);

    // Effects. A token drop also sends back the budget left, S6.8.5.
    let (balance, sol_side) = settle_amounts(&ctx)?;
    let drop = &mut ctx.accounts.drop;
    drop.status = DropStatus::Finalized;
    emit!(Refunded {
        drop: drop.key(),
        refund_recipient: drop.refund_recipient,
        amount: balance,
    });
    emit!(Finalized {
        drop: drop.key(),
        total_claimed: drop.total_claimed,
        claimed_count: drop.claimed_count,
        refunded: balance,
    });

    settle_pay_out(&ctx, balance, sol_side)
}

// ---------------------------------------------------------------------------------------------
// 6.8 sweep
// ---------------------------------------------------------------------------------------------

pub fn sweep(ctx: Context<Sweep>) -> Result<()> {
    let drop = &ctx.accounts.drop;

    // S6.8.1 to S6.8.4. The stray mint's program is pinned by the associated token derivations.
    // After close the drop asset is swept like any stray mint, S6.10.7.
    require!(
        ctx.accounts.mint.key() != drop.asset || drop.closed,
        DropError::CannotSweepDropAsset
    );
    require!(is_finished(drop), DropError::NotFinished);
    let amount = ctx.accounts.stray_ata.amount;
    require!(amount > 0, DropError::NothingToSweep);
    check_mint_extensions(&ctx.accounts.mint.to_account_info())?;

    emit!(Swept {
        drop: drop.key(),
        mint: ctx.accounts.mint.key(),
        to: drop.refund_recipient,
        amount,
    });

    // S6.8.7. A transfer and nothing more.
    let nonce = drop.nonce.to_le_bytes();
    let seeds: &[&[u8]] = &[
        DROP_SEED,
        drop.creator_commitment.as_ref(),
        &nonce,
        &[drop.bump],
    ];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.stray_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.refund_ata.to_account_info(),
                authority: drop.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )
}

// ---------------------------------------------------------------------------------------------
// 6.10 close_drop
// ---------------------------------------------------------------------------------------------

pub fn close_drop(ctx: Context<CloseDrop>) -> Result<()> {
    let drop = &ctx.accounts.drop;
    check_asset_accounts(
        drop,
        ctx.accounts.mint.as_ref().map(|m| m.key()),
        ctx.accounts.vault.as_ref().map(|v| v.key()),
    )?;

    // S6.10.1. S6.10.3 and S6.10.4 are the address constraints.
    require!(is_finished(drop), DropError::NotFinished);
    require!(!drop.closed, DropError::AlreadyClosed);

    // S6.10.2, leftovers first: the asset. The lamports go last, S6.10.6.
    let leftovers = asset_balance(drop, ctx.accounts.vault.as_deref())?;

    // S6.10.3. The vault's rent minimum for the rent payer, its extra for the refund recipient.
    let vault_lamports = ctx
        .accounts
        .vault
        .as_deref()
        .map(|v| v.to_account_info().lamports())
        .unwrap_or(0);
    let vault_rent = match ctx.accounts.vault.as_deref() {
        Some(vault) => {
            vault_lamports.min(Rent::get()?.minimum_balance(vault.to_account_info().data_len()))
        }
        None => 0,
    };

    // S6.10.9. Every lamport the refund recipient would get: a SOL drop's leftovers, or a token
    // drop's SOL side plus the vault's extra, and the bitmap's extra. Under the rent minimum and
    // with no account there, they stay in the drop.
    let bitmap_extra = spendable_lamports(&ctx.accounts.bitmap.to_account_info())?;
    let drop_extra = if drop.is_spl() {
        spendable_lamports(&drop.to_account_info())?
            .checked_add(vault_lamports - vault_rent)
            .ok_or(DropError::Overflow)?
    } else {
        leftovers
    };
    let lamports_out = drop_extra
        .checked_add(bitmap_extra)
        .ok_or(DropError::Overflow)?;
    let keep = keeps_dust(
        &ctx.accounts.refund_recipient.to_account_info(),
        lamports_out,
    )?;
    let leftovers = if keep && !drop.is_spl() { 0 } else { leftovers };

    // S6.10.6, effects in order: closed = true, emit, leftovers moved, vault closed to the drop,
    // then the lamports by hand. The bitmap is closed by its `close = rent_payer` constraint when
    // the instruction returns, with only its rent minimum left in it.
    let drop = &mut ctx.accounts.drop;
    drop.closed = true;
    emit!(Closed {
        drop: drop.key(),
        rent_payer: drop.rent_payer,
        leftovers_to_refund_recipient: leftovers,
    });

    let drop = &ctx.accounts.drop;
    let refund_recipient = ctx.accounts.refund_recipient.to_account_info();
    pay_out(
        drop,
        ctx.accounts.mint.as_deref(),
        ctx.accounts.vault.as_deref(),
        ctx.accounts.token_program.as_ref(),
        &refund_recipient,
        ctx.accounts
            .refund_ata
            .as_ref()
            .map(|a| a.to_account_info()),
        leftovers,
    )?;

    if let (Some(vault), Some(token_program)) = (
        ctx.accounts.vault.as_deref(),
        ctx.accounts.token_program.as_ref(),
    ) {
        let vault_info = vault.to_account_info();
        // S6.10.2. Closed to the drop, never to the caller; the lamports are split below.
        let nonce = drop.nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[
            DROP_SEED,
            drop.creator_commitment.as_ref(),
            &nonce,
            &[drop.bump],
        ];
        token_interface::close_account(CpiContext::new_with_signer(
            token_program.key(),
            CloseAccount {
                account: vault_info,
                destination: drop.to_account_info(),
                authority: drop.to_account_info(),
            },
            &[seeds],
        ))?;
    }

    // The lamports last: a direct lamport move must come after every CPI of the instruction, the
    // runtime refuses a CPI once the caller has moved lamports itself. S6.10.3: the vault's rent
    // minimum to the rent payer; every drop lamport above the drop's rent to the refund recipient,
    // a token drop's SOL side and the vault's extra; the bitmap's extra to the refund recipient.
    // In the S6.10.9 case the drop keeps its extra and the bitmap's extra goes to the drop.
    let drop_info = drop.to_account_info();
    move_lamports(
        &drop_info,
        &ctx.accounts.rent_payer.to_account_info(),
        vault_rent,
    )?;
    let bitmap_info = ctx.accounts.bitmap.to_account_info();
    if keep {
        return move_lamports(&bitmap_info, &drop_info, spendable_lamports(&bitmap_info)?);
    }
    move_lamports(
        &drop_info,
        &refund_recipient,
        spendable_lamports(&drop_info)?,
    )?;
    move_lamports(
        &bitmap_info,
        &refund_recipient,
        spendable_lamports(&bitmap_info)?,
    )
}

// ---------------------------------------------------------------------------------------------
// 6.13 sweep_sol
// ---------------------------------------------------------------------------------------------

pub fn sweep_sol(ctx: Context<SweepSol>) -> Result<()> {
    let drop = &ctx.accounts.drop;

    // S6.13.1. S6.13.2 is the address constraint.
    require!(drop.closed, DropError::NotClosed);
    // S6.13.3. The drop keeps its rent minimum, I18.
    let drop_info = drop.to_account_info();
    let amount = spendable_lamports(&drop_info)?;
    require!(amount > 0, DropError::NothingToSweep);

    // S6.13.4
    emit!(SolSwept {
        drop: drop.key(),
        to: drop.refund_recipient,
        amount
    });
    move_lamports(
        &drop_info,
        &ctx.accounts.refund_recipient.to_account_info(),
        amount,
    )
}
