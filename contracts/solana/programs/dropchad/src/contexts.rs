//! Account lists for every instruction.
//! Everything declarative lives here: PDA seeds, stored bumps, owner checks, signer checks, the
//! associated token account derivations, `close = rent_payer`. The handlers in `handlers.rs` only
//! see accounts that already passed these checks. Section 16 S- to S- and S-, S-.
//! Token only accounts are `Option`. For a SOL drop they are not passed. The handler enforces
//! the passed set must match `drop.asset`. Every mint, token account and token program is
//! typed with the token interface, so a drop works on the classic program and on Token-2022, and
//! the associated token derivations pin each account to the drop mint's own program.
//! Every account bigger than a few words is `Box`ed and the bitmap is zero copy: a Solana stack
//! frame is 4 KB, and a `Drop` plus three token accounts deserialized in place overflowed it.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{BITMAP_SEED, CONFIG_SEED, DROP_SEED};
use crate::errors::DropError;
use crate::state::{ClaimBitmap, Config, CreateParams, Drop};

/// 6.0. Once per cluster. The signer must be the program's upgrade authority.
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, payer = authority, space = Config::SIZE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ DropError::NotUpgradeAuthority
    )]
    pub program: Program<'info, crate::program::Dropchad>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ DropError::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

/// 6.11. Every admin setter. `has_one = admin` is the signer check against `config.admin`.
/// No `Drop` account appears here.
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ DropError::NotAdmin)]
    pub config: Account<'info, Config>,
}

/// `revoke_binder`: the admin **or** the guardian signs. The handler checks
/// which, so this is not `has_one`.
#[derive(Accounts)]
pub struct RevokeBinder<'info> {
    pub signer: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

/// The one time move of a 116 byte legacy `Config` to the 253 byte layout. The config
/// comes in unchecked because the new program cannot deserialize the old bytes; the seeds
/// constraint pins the address, the handler checks the owner, the discriminator, the length and
/// the stored admin by hand.
#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// Must equal the admin stored in the old bytes. Pays the extra rent.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: the `Config` PDA by seeds., discriminator, length and admin are checked in
    /// `handlers::migrate_config` before anything is written.
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// 6.1. Creates the drop, the bitmap and, for a token drop, the vault, in one instruction.
#[derive(Accounts)]
#[instruction(params: CreateParams)]
pub struct CreateDrop<'info> {
    /// Pays every rent. Recorded as `drop.rent_payer`.
    #[account(mut)]
    pub relayer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = relayer @ DropError::NotRelayer)]
    pub config: Account<'info, Config>,

    /// `init` is the `saltUsed` map.
    #[account(
        init,
        payer = relayer,
        space = Drop::SIZE,
        seeds = [DROP_SEED, params.creator_commitment.as_ref(), &params.nonce.to_le_bytes()],
        bump
    )]
    pub drop: Box<Account<'info, Drop>>,

    #[account(
        init,
        payer = relayer,
        space = ClaimBitmap::SIZE,
        seeds = [BITMAP_SEED, drop.key().as_ref()],
        bump
    )]
    pub bitmap: AccountLoader<'info, ClaimBitmap>,

    /// A mint of either token program. A non mint account fails while it loads with
    /// Anchor's `AccountOwnedByWrongProgram` (3007). The program match, the extensions and the
    /// freeze authority are checked in the handler, before the vault exists.
    pub mint: Option<Box<InterfaceAccount<'info, Mint>>>,

    /// CHECK: created by the handler through the ATA program, after the checks, so a
    /// refused mint never gets a vault. The ATA program refuses any address other than the
    /// associated token account of `(drop, mint, token_program)`.
    #[account(mut)]
    pub vault: Option<UncheckedAccount<'info>>,

    /// The mint's own program, classic or Token-2022. Checked against the mint's owner in
    /// the handler, `WrongTokenProgram`.
    pub token_program: Option<Interface<'info, TokenInterface>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}

/// 6.2. Anyone. The fee goes to `drop.fee_wallet` in lamports, for every drop. No fee
/// token account, nothing of a token goes to us.
#[derive(Accounts)]
pub struct Activate<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [DROP_SEED, drop.creator_commitment.as_ref(), &drop.nonce.to_le_bytes()],
        bump = drop.bump
    )]
    pub drop: Box<Account<'info, Drop>>,

    /// CHECK: compared to the stored key.
    #[account(mut, address = drop.fee_wallet @ DropError::WrongFeeWallet)]
    pub fee_wallet: UncheckedAccount<'info>,

    /// CHECK: compared to `drop.asset` in the handler.
    pub mint: Option<UncheckedAccount<'info>>,

    #[account(
        associated_token::mint = mint,
        associated_token::authority = drop,
        associated_token::token_program = token_program
    )]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    pub token_program: Option<Interface<'info, TokenInterface>>,
}

/// 6.3. Anyone. The proof fixes the recipient.
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [DROP_SEED, drop.creator_commitment.as_ref(), &drop.nonce.to_le_bytes()],
        bump = drop.bump
    )]
    pub drop: Box<Account<'info, Drop>>,

    #[account(
        mut,
        seeds = [BITMAP_SEED, drop.key().as_ref()],
        bump = drop.bitmap_bump,
        has_one = drop
    )]
    pub bitmap: AccountLoader<'info, ClaimBitmap>,

    /// CHECK: unchecked on purpose. Not a signer, any key, bound by the leaf.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// Compared to `drop.asset` in the handler. Read for `transfer_checked`.
    pub mint: Option<Box<InterfaceAccount<'info, Mint>>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = drop,
        associated_token::token_program = token_program
    )]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// CHECK: the recipient's associated token account. The handler creates it with the ATA
    /// program's idempotent create when missing, so it knows whether this claim made it.
    /// The ATA program refuses any other address, and an existing account of another owner or
    /// mint; `transfer_checked` refuses another mint again.
    #[account(mut)]
    pub recipient_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Option<Interface<'info, TokenInterface>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}

/// `claim_handle`: the `Claim` accounts plus the config, read for the live binder, and
/// the instructions sysvar, read for the Ed25519 instruction directly before this one.
#[derive(Accounts)]
pub struct ClaimHandle<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [DROP_SEED, drop.creator_commitment.as_ref(), &drop.nonce.to_le_bytes()],
        bump = drop.bump
    )]
    pub drop: Box<Account<'info, Drop>>,

    #[account(
        mut,
        seeds = [BITMAP_SEED, drop.key().as_ref()],
        bump = drop.bitmap_bump,
        has_one = drop
    )]
    pub bitmap: AccountLoader<'info, ClaimBitmap>,

    /// CHECK: unchecked on purpose. Not a signer, any key, bound by the binder's signature.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// Compared to `drop.asset` in the handler. Read for `transfer_checked`.
    pub mint: Option<Box<InterfaceAccount<'info, Mint>>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = drop,
        associated_token::token_program = token_program
    )]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// CHECK: as in `Claim`, created by the handler when missing.
    #[account(mut)]
    pub recipient_ata: Option<UncheckedAccount<'info>>,

    pub token_program: Option<Interface<'info, TokenInterface>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,

    /// CHECK: the instructions sysvar, pinned by address. Read in `handlers::check_binding`.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// 6.6 and 6.7. `cancel_unfunded` and `refund` share one account list.
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [DROP_SEED, drop.creator_commitment.as_ref(), &drop.nonce.to_le_bytes()],
        bump = drop.bump
    )]
    pub drop: Box<Account<'info, Drop>>,

    /// CHECK: compared to the stored key.
    #[account(mut, address = drop.refund_recipient @ DropError::WrongRefundRecipient)]
    pub refund_recipient: UncheckedAccount<'info>,

    /// Compared to `drop.asset` in the handler. Read for `transfer_checked`.
    pub mint: Option<Box<InterfaceAccount<'info, Mint>>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = drop,
        associated_token::token_program = token_program
    )]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = refund_recipient,
        associated_token::token_program = token_program
    )]
    pub refund_ata: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    pub token_program: Option<Interface<'info, TokenInterface>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}

/// 6.8. A wrong mint that landed under the drop PDA goes to the refund recipient.
#[derive(Accounts)]
pub struct Sweep<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [DROP_SEED, drop.creator_commitment.as_ref(), &drop.nonce.to_le_bytes()],
        bump = drop.bump
    )]
    pub drop: Box<Account<'info, Drop>>,

    /// CHECK: compared to the stored key.
    #[account(mut, address = drop.refund_recipient @ DropError::WrongRefundRecipient)]
    pub refund_recipient: UncheckedAccount<'info>,

    /// Any mint of either program. A Token-2022 mint must pass the extension
    /// check in the handler. The handler refuses `drop.asset`.
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = drop,
        associated_token::token_program = token_program
    )]
    pub stray_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = refund_recipient,
        associated_token::token_program = token_program
    )]
    pub refund_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The stray mint's own program.
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// 6.10. Closes the bitmap and the vault to `rent_payer`. The drop stays.
#[derive(Accounts)]
pub struct CloseDrop<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [DROP_SEED, drop.creator_commitment.as_ref(), &drop.nonce.to_le_bytes()],
        bump = drop.bump
    )]
    pub drop: Box<Account<'info, Drop>>,

    #[account(
        mut,
        seeds = [BITMAP_SEED, drop.key().as_ref()],
        bump = drop.bitmap_bump,
        has_one = drop,
        close = rent_payer
    )]
    pub bitmap: AccountLoader<'info, ClaimBitmap>,

    /// CHECK: compared to the stored key. The caller never receives anything.
    #[account(mut, address = drop.rent_payer @ DropError::WrongRentPayer)]
    pub rent_payer: UncheckedAccount<'info>,

    /// CHECK: compared to the stored key. Leftovers go here first.
    #[account(mut, address = drop.refund_recipient @ DropError::WrongRefundRecipient)]
    pub refund_recipient: UncheckedAccount<'info>,

    /// Compared to `drop.asset` in the handler. Read for `transfer_checked`.
    pub mint: Option<Box<InterfaceAccount<'info, Mint>>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = drop,
        associated_token::token_program = token_program
    )]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = refund_recipient,
        associated_token::token_program = token_program
    )]
    pub refund_ata: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    pub token_program: Option<Interface<'info, TokenInterface>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}
