//! Account layouts.

use anchor_lang::prelude::*;

use crate::constants::BITMAP_BYTES;

/// Section 4. Borsh writes an enum as one `u8` tag, so `Created` is `0`, the value of fresh bytes.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DropStatus {
    Created,
    Active,
    Finalized,
    Cancelled,
}

/// 5.1. One per cluster, at `["config"]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    pub admin: Pubkey,
    /// The only key that may sign `create_drop`. One key, not a map.
    pub relayer: Pubkey,
    pub fee_wallet: Pubkey,
    pub default_fee_bps: u16,
    pub paused: bool,
    /// Immutable. The leaf chain id for this cluster.
    pub chain_id: u64,
    pub bump: u8,
    // handle mode. Every field after `bump`, so the 116 bytes above keep their offsets
    // and `migrate_config` can grow a legacy config in place.
    /// The ed25519 binder of. Zero means none: every `claim_handle` fails.
    pub binder: Pubkey,
    /// Set by `revoke_binder`, cleared by `set_binder`.
    pub binder_revoked: bool,
    /// May sign `revoke_binder` and nothing else. Zero means none; the admin can always revoke.
    pub guardian: Pubkey,
    /// The flat minimum fee for new SOL drops.
    pub min_fee_lamports: u64,
    // Cut from the front of the old 64 byte tail, so the live config reads zero in both,
    // which is off, and the account stays 253 bytes.
    /// The minimum fee per receiver for new SOL drops, times `leaf_count`. Zero is off.
    pub min_fee_per_receiver_lamports: u64,
    /// The cap on the fee of new SOL drops. Zero is no cap.
    pub max_fee_lamports: u64,
    /// Zero. Room for the next fields without another layout change.
    pub reserved: [u8; 48],
}

impl Config {
    pub const SIZE: usize = 8 + Self::INIT_SPACE;
}

/// 5.2 to 5.4. One per drop, at `["drop", creator_commitment, nonce_le]`. Never closed.
#[account]
#[derive(InitSpace, Debug)]
pub struct Drop {
    // 5.2, write once in `create_drop`
    /// `Pubkey::default()` means native SOL. Otherwise the one mint.
    pub asset: Pubkey,
    /// The associated token account of `(drop, mint)` for SPL. `Pubkey::default()` for SOL.
    pub vault: Pubkey,
    pub merkle_root: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub total_entitlements: u64,
    pub gross_required: u64,
    pub fee_amount: u64,
    pub fee_wallet: Pubkey,
    pub refund_recipient: Pubkey,
    pub funding_deadline: i64,
    pub claim_period: u32,
    pub creator_commitment: [u8; 32],
    pub nonce: u64,
    pub leaf_count: u32,
    /// Copied from `config.chain_id` so `claim` never needs the config account.
    pub chain_id: u64,
    /// `close_drop` returns rent here and nowhere else.
    pub rent_payer: Pubkey,
    pub created_at: i64,
    pub bump: u8,
    pub bitmap_bump: u8,
    // 5.3, write once in `activate`
    pub activated_at: i64,
    pub claim_deadline: i64,
    // 5.4, mutable accounting
    pub status: DropStatus,
    pub total_claimed: u64,
    pub claimed_count: u32,
    pub closed: bool,
    // 5.2 fields 20 to 22, token drops. Cut from the front of the old 64 byte tail, so a drop
    // written before them reads zero in all three and the account stays 424 bytes.
    /// The fee in SOL, at most `MAX_SOL_FEE_LAMPORTS`. Zero on a SOL drop.
    pub sol_fee_lamports: u64,
    /// `leaf_count` × the rent of one receiver token account. Zero on a SOL drop.
    pub account_budget_lamports: u64,
    /// Paid back to claim callers so far. The one 5.2 field that changes after creation.
    pub account_budget_used: u64,
    /// Zero. Room for the next fields without losing the drops again, the lesson of.
    pub reserved: [u8; 40],
}

impl Drop {
    pub const SIZE: usize = 8 + Self::INIT_SPACE;

    pub fn is_spl(&self) -> bool {
        self.asset != Pubkey::default()
    }
}

/// 5.5. One per drop, at `["bitmap", drop]`. Fixed size for `MAX_LEAVES`.
/// Zero copy: 1,250 bytes must never be copied onto the 4 KB program stack. Read through
/// `AccountLoader`, `load()` / `load_mut()`. `repr(C)`, no padding: 32 + 1 + 1,250 = 1,283 bytes.
#[account(zero_copy)]
#[derive(InitSpace)]
pub struct ClaimBitmap {
    pub drop: Pubkey,
    pub bump: u8,
    pub bits: [u8; BITMAP_BYTES],
}

impl ClaimBitmap {
    pub const SIZE: usize = 8 + Self::INIT_SPACE;

    /// Bit `i` is byte `i / 8`, mask `1 << (i % 8)`. Read off chain the same way, 6.9.
    pub fn is_claimed(&self, index: u32) -> bool {
        let i = index as usize;
        self.bits[i / 8] & (1 << (i % 8)) != 0
    }

    pub fn set_claimed(&mut self, index: u32) {
        let i = index as usize;
        self.bits[i / 8] |= 1 << (i % 8);
    }
}

/// 6.1. The asset is not here: it is the `mint` account when one is passed, SOL when none is.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateParams {
    pub merkle_root: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub total_entitlements: u64,
    pub leaf_count: u32,
    pub refund_recipient: Pubkey,
    pub creator_commitment: [u8; 32],
    pub nonce: u64,
    pub funding_period: u32,
    pub claim_period: u32,
    /// Token drop: the SOL fee, at most `MAX_SOL_FEE_LAMPORTS`. SOL drop: zero.
    pub sol_fee_lamports: u64,
}
