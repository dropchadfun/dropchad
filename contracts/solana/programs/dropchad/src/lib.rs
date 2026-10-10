//! dropchad on Solana. the design is the source of truth; this crate follows it.
//! One program, no clones. A drop is three accounts at program derived addresses: the `Drop`,
//! its `ClaimBitmap`, and for SPL the vault. Funding is a plain transfer, claims are merkle
//! proofs, leftovers go back to the refund recipient after the claim deadline, and the relayer
//! that creates and pays can never take the funds.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod contexts;
pub mod errors;
pub mod events;
pub mod handlers;
pub mod merkle;
pub mod state;

pub use constants::*;
pub use contexts::*;
pub use errors::DropError;
pub use state::*;

declare_id!("EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft");

#[program]
pub mod dropchad {
    use super::*;

    /// 6.0. Once per cluster, signed by the upgrade authority.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        chain_id: u64,
        relayer: Pubkey,
        fee_wallet: Pubkey,
        default_fee_bps: u16,
    ) -> Result<()> {
        handlers::initialize_config(ctx, chain_id, relayer, fee_wallet, default_fee_bps)
    }

    /// 6.11. Blocks new drops only.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        handlers::set_paused(ctx, paused)
    }

    /// 6.11. Fee for new drops, capped at `MAX_FEE_BPS`.
    pub fn set_default_fee_bps(ctx: Context<AdminOnly>, bps: u16) -> Result<()> {
        handlers::set_default_fee_bps(ctx, bps)
    }

    /// 6.11. Fee target for new drops.
    pub fn set_fee_wallet(ctx: Context<AdminOnly>, fee_wallet: Pubkey) -> Result<()> {
        handlers::set_fee_wallet(ctx, fee_wallet)
    }

    /// 6.11. The one key allowed to sign `create_drop`. Rotates the relayer.
    pub fn set_relayer(ctx: Context<AdminOnly>, relayer: Pubkey) -> Result<()> {
        handlers::set_relayer(ctx, relayer)
    }

    /// 6.11. Hands admin to a new key, one step.
    pub fn set_admin(ctx: Context<AdminOnly>, admin: Pubkey) -> Result<()> {
        handlers::set_admin(ctx, admin)
    }

    /// The ed25519 binder. Clears the revoke.
    pub fn set_binder(ctx: Context<AdminOnly>, binder: Pubkey) -> Result<()> {
        handlers::set_binder(ctx, binder)
    }

    /// The admin or the guardian. Stops every handle claim at once.
    pub fn revoke_binder(ctx: Context<RevokeBinder>) -> Result<()> {
        handlers::revoke_binder(ctx)
    }

    /// May revoke and nothing else. Zero means none.
    pub fn set_guardian(ctx: Context<AdminOnly>, guardian: Pubkey) -> Result<()> {
        handlers::set_guardian(ctx, guardian)
    }

    /// The flat minimum fee for new SOL drops, capped at `MAX_MIN_FEE_LAMPORTS`.
    pub fn set_min_fee(ctx: Context<AdminOnly>, lamports: u64) -> Result<()> {
        handlers::set_min_fee(ctx, lamports)
    }

    /// The minimum fee per receiver for new SOL drops, capped at
    /// `MAX_MIN_FEE_PER_RECEIVER_LAMPORTS`. Zero is off.
    pub fn set_fee_per_receiver(ctx: Context<AdminOnly>, lamports: u64) -> Result<()> {
        handlers::set_fee_per_receiver(ctx, lamports)
    }

    /// The cap on the fee of new SOL drops, at most `MAX_SOL_FEE_LAMPORTS`. Zero is no cap.
    pub fn set_max_fee(ctx: Context<AdminOnly>, lamports: u64) -> Result<()> {
        handlers::set_max_fee(ctx, lamports)
    }

    /// Once, on a cluster whose `Config` predates handle mode.
    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        handlers::migrate_config(ctx)
    }

    /// 6.1. Relayer only. Creates the drop, the bitmap and, for SPL, the vault.
    pub fn create_drop(ctx: Context<CreateDrop>, params: CreateParams) -> Result<()> {
        handlers::create_drop(ctx, params)
    }

    /// 6.2. Anyone. Balance must cover `gross_required`. Pays the fee.
    pub fn activate(ctx: Context<Activate>) -> Result<()> {
        handlers::activate(ctx)
    }

    /// 6.3. Anyone. Pays the recipient inside the leaf, never the caller.
    pub fn claim(ctx: Context<Claim>, index: u32, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        handlers::claim(ctx, index, amount, proof)
    }

    /// Anyone. Pays the recipient the binder signed for, after the Ed25519 instruction
    /// directly before this one. The proof fixes who and how much, the binding fixes where.
    pub fn claim_handle(
        ctx: Context<ClaimHandle>,
        index: u32,
        x_id: u64,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        handlers::claim_handle(ctx, index, x_id, amount, proof)
    }

    /// 6.6. Anyone, after the funding deadline, when never activated.
    pub fn cancel_unfunded(ctx: Context<Settle>) -> Result<()> {
        handlers::cancel_unfunded(ctx)
    }

    /// 6.7. Anyone, after the claim deadline. Leftovers to the refund recipient.
    pub fn refund(ctx: Context<Settle>) -> Result<()> {
        handlers::refund(ctx)
    }

    /// 6.8. Anyone, after finish. A wrong mint goes to the refund recipient.
    pub fn sweep(ctx: Context<Sweep>) -> Result<()> {
        handlers::sweep(ctx)
    }

    /// 6.10. Anyone, after finish. Rent back to the rent payer. The drop account stays.
    pub fn close_drop(ctx: Context<CloseDrop>) -> Result<()> {
        handlers::close_drop(ctx)
    }
}
