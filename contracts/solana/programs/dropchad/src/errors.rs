//! Every error named, in the order the design first names it.
//! Anchor numbers custom errors from 6000 in declaration order. The tests compute the code as
//! `6000 + variant index`, so **never reorder or remove a variant**, only append.

use anchor_lang::prelude::*;

#[error_code]
pub enum DropError {
    #[msg("instruction not implemented yet")]
    NotImplemented,
    // 6.0
    #[msg("signer is not the program upgrade authority")]
    NotUpgradeAuthority,
    #[msg("fee bps above MAX_FEE_BPS")]
    FeeTooHigh,
    #[msg("zero address")]
    ZeroAddress,
    // 6.11
    #[msg("signer is not the admin")]
    NotAdmin,
    // 6.1
    #[msg("signer is not the relayer")]
    NotRelayer,
    #[msg("drop creation is paused")]
    CreationPaused,
    #[msg("total entitlements is zero")]
    ZeroTotal,
    #[msg("leaf count is zero or above MAX_LEAVES")]
    BadLeafCount,
    #[msg("merkle root is zero")]
    ZeroRoot,
    #[msg("manifest hash is zero")]
    ZeroManifest,
    #[msg("refund recipient is the zero key")]
    ZeroRefundRecipient,
    #[msg("creator commitment is zero")]
    ZeroCommitment,
    #[msg("funding period out of bounds")]
    BadFundingPeriod,
    #[msg("claim period out of bounds")]
    BadClaimPeriod,
    /// The token program passed is not the mint's.
    #[msg("token program is not the mint's owner")]
    WrongTokenProgram,
    #[msg("mint has a freeze authority")]
    MintHasFreezeAuthority,
    #[msg("arithmetic overflow")]
    Overflow,
    // 6.2
    #[msg("wrong status for this instruction")]
    WrongStatus,
    #[msg("funding deadline has passed")]
    FundingExpired,
    #[msg("balance below gross required")]
    Underfunded,
    #[msg("fee wallet does not match the drop")]
    WrongFeeWallet,
    #[msg("asset accounts do not match the drop asset")]
    AssetAccountsMismatch,
    // 6.3
    #[msg("claim window is closed")]
    ClaimWindowClosed,
    #[msg("index is at or above leaf count")]
    BadIndex,
    #[msg("leaf already claimed")]
    AlreadyClaimed,
    #[msg("merkle proof does not verify")]
    BadProof,
    #[msg("claim would exceed total entitlements")]
    OverEntitlement,
    // 6.6, 6.7
    #[msg("funding window is still open")]
    FundingStillOpen,
    #[msg("claim window is still open")]
    ClaimWindowOpen,
    #[msg("refund recipient does not match the drop")]
    WrongRefundRecipient,
    // 6.8
    #[msg("sweep can never touch the drop asset")]
    CannotSweepDropAsset,
    #[msg("drop is not finished")]
    NotFinished,
    #[msg("nothing to sweep")]
    NothingToSweep,
    // 6.10
    #[msg("drop is already closed")]
    AlreadyClosed,
    #[msg("rent payer does not match the drop")]
    WrongRentPayer,
    // handle mode
    #[msg("config is not the 116 byte legacy layout")]
    AlreadyMigrated,
    #[msg("signer is neither the admin nor the guardian")]
    NotAdminOrGuardian,
    // claim_handle
    #[msg("x id is zero")]
    BadXId,
    #[msg("no binder is set")]
    NoBinder,
    #[msg("the binder is revoked")]
    BinderIsRevoked,
    #[msg("the binding is missing, malformed or not the binder's")]
    BadBinding,

    // Token drops. At the end, so no existing error number moves.
    #[msg("the mint has a Token-2022 extension that is not allowed")]
    MintExtensionNotAllowed,
    #[msg("sol fee above the cap, or not zero on a SOL drop")]
    SolFeeTooHigh,
}
