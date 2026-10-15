//! Hard constants. Changing one is a new deployment, never a transaction.

use anchor_lang::prelude::Pubkey;

/// Seed prefixes, 3.2. Distinct strings, and every seed after the prefix has a fixed length.
pub const CONFIG_SEED: &[u8] = b"config";
pub const DROP_SEED: &[u8] = b"drop";
pub const BITMAP_SEED: &[u8] = b"bitmap";

/// 1 hour to 30 days, in seconds.
pub const MIN_FUNDING_PERIOD: u32 = 3_600;
pub const MAX_FUNDING_PERIOD: u32 = 2_592_000;

/// 1 day to 180 days, in seconds.
pub const MIN_CLAIM_PERIOD: u32 = 86_400;
pub const MAX_CLAIM_PERIOD: u32 = 15_552_000;

/// A 10,000 leaf tree gives a proof of at most 14 nodes.
pub const MAX_LEAVES: u32 = 10_000;

/// `ceil(log2(MAX_LEAVES))`.
pub const MAX_PROOF_LEN: usize = 14;

/// 5%. A ceiling on a compromised admin, not a target. v1 runs at zero.
pub const MAX_FEE_BPS: u16 = 500;

/// A ceiling on a compromised admin for `min_fee_lamports`: 0.025 SOL, about
/// 2.43 usd at the price, the size of the EVM cap.
pub const MAX_MIN_FEE_LAMPORTS: u64 = 25_000_000;

/// 1 SOL: a bug or a wild price never charges a wild fee.
pub const MAX_SOL_FEE_LAMPORTS: u64 = 1_000_000_000;

/// A ceiling on a compromised admin for `min_fee_per_receiver_lamports`:
/// 0.003 SOL, ten times the planned value. The cap of `set_max_fee` is
/// `MAX_SOL_FEE_LAMPORTS`.
pub const MAX_MIN_FEE_PER_RECEIVER_LAMPORTS: u64 = 3_000_000;

/// Receiver token account sizes the account budget is worked out from: a classic account,
/// and a Token-2022 account with `immutableOwner`.
pub const TOKEN_ACCOUNT_SIZE: usize = 165;
pub const TOKEN_2022_ACCOUNT_SIZE: usize = 170;

/// The only mints accepted with a freeze authority. Adding one is a
/// program upgrade. Bytes decoded from the base58 in the comments; the tests check them against
/// the text.
pub const FREEZE_EXCEPTION_MINTS: [Pubkey; 3] = [
    // USDC mainnet, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
    Pubkey::new_from_array([
        198, 250, 122, 243, 190, 219, 173, 58, 61, 101, 243, 106, 171, 201, 116, 49, 177, 187, 228,
        194, 210, 246, 224, 228, 124, 166, 2, 3, 69, 47, 93, 97,
    ]),
    // USDT mainnet, Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
    Pubkey::new_from_array([
        206, 1, 14, 96, 175, 237, 178, 39, 23, 189, 99, 25, 47, 84, 20, 90, 63, 150, 90, 51, 187,
        130, 210, 199, 2, 158, 178, 206, 30, 32, 130, 100,
    ]),
    // USDC devnet, 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
    Pubkey::new_from_array([
        59, 68, 44, 179, 145, 33, 87, 241, 58, 147, 61, 1, 52, 40, 45, 3, 43, 95, 254, 205, 1, 162,
        219, 241, 183, 121, 6, 8, 223, 0, 46, 167,
    ]),
];

/// The `Config` size before handle mode, the only size `migrate_config` accepts.
pub const LEGACY_CONFIG_SIZE: usize = 116;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// One bit per leaf, sized for `MAX_LEAVES`, fixed.
pub const BITMAP_BYTES: usize = 1_250;

/// The Solana token list convention, not a standard. Written into the config at init.
pub const SOLANA_MAINNET_CHAIN_ID: u64 = 101;
pub const SOLANA_DEVNET_CHAIN_ID: u64 = 103;
