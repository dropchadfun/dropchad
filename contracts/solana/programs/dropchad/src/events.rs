//! Events. Every drop event carries `drop`, because one
//! program emits for every drop and a program log has no "emitting address".

use anchor_lang::prelude::*;

#[event]
pub struct DropCreated {
    pub drop: Pubkey,
    pub creator_commitment: [u8; 32],
    pub asset: Pubkey,
    pub vault: Pubkey,
    pub merkle_root: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub total_entitlements: u64,
    pub fee_amount: u64,
    pub gross_required: u64,
    pub fee_wallet: Pubkey,
    pub refund_recipient: Pubkey,
    pub funding_deadline: i64,
    pub claim_period: u32,
    pub leaf_count: u32,
    pub chain_id: u64,
    pub nonce: u64,
    pub rent_payer: Pubkey,
    pub created_at: i64,
}

#[event]
pub struct Activated {
    pub drop: Pubkey,
    pub activated_at: i64,
    pub balance: u64,
    pub claim_deadline: i64,
    pub fee_paid: u64,
}

#[event]
pub struct Claimed {
    pub drop: Pubkey,
    pub index: u32,
    pub recipient: Pubkey,
    pub amount: u64,
}

/// Emitted by `claim_handle` instead of `Claimed`.
#[event]
pub struct HandleClaimed {
    pub drop: Pubkey,
    pub index: u32,
    pub x_id: u64,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Refunded {
    pub drop: Pubkey,
    pub refund_recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CancelledUnfunded {
    pub drop: Pubkey,
    pub refund_recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Finalized {
    pub drop: Pubkey,
    pub total_claimed: u64,
    pub claimed_count: u32,
    pub refunded: u64,
}

#[event]
pub struct Swept {
    pub drop: Pubkey,
    pub mint: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Closed {
    pub drop: Pubkey,
    pub rent_payer: Pubkey,
    pub leftovers_to_refund_recipient: u64,
}

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub relayer: Pubkey,
    pub fee_wallet: Pubkey,
    pub default_fee_bps: u16,
    pub chain_id: u64,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
}

#[event]
pub struct DefaultFeeBpsSet {
    pub old_bps: u16,
    pub new_bps: u16,
}

#[event]
pub struct FeeWalletSet {
    pub old_wallet: Pubkey,
    pub new_wallet: Pubkey,
}

#[event]
pub struct RelayerSet {
    pub old_relayer: Pubkey,
    pub new_relayer: Pubkey,
}

#[event]
pub struct AdminSet {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

// handle mode config events, 11.2.

#[event]
pub struct BinderSet {
    pub old_binder: Pubkey,
    pub new_binder: Pubkey,
}

#[event]
pub struct BinderRevoked {
    pub by: Pubkey,
}

#[event]
pub struct GuardianSet {
    pub old_guardian: Pubkey,
    pub new_guardian: Pubkey,
}

#[event]
pub struct MinFeeSet {
    pub old_lamports: u64,
    pub new_lamports: u64,
}

// the fee model config events, 11.2.

#[event]
pub struct FeePerReceiverSet {
    pub old_lamports: u64,
    pub new_lamports: u64,
}

#[event]
pub struct MaxFeeSet {
    pub old_lamports: u64,
    pub new_lamports: u64,
}

#[event]
pub struct ConfigMigrated {
    pub old_len: u32,
    pub new_len: u32,
}
