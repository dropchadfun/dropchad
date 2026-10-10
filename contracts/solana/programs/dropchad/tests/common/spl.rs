//! Raw System and SPL Token instructions for the tests, built by hand from the published byte
//! layouts so the test crate does not depend on the token crates' instruction builders and their
//! solana crate versions. Program ids as raw bytes, decoded once from their base58 form.

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
pub use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::spl_token_2022::state::Mint as Mint2022;

pub const SYSTEM_PROGRAM: Pubkey = Pubkey::new_from_array([0u8; 32]);

/// `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
pub const TOKEN_PROGRAM: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

/// `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
pub const TOKEN_2022_PROGRAM: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77,
    131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
]);

/// `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
pub const ATA_PROGRAM: Pubkey = Pubkey::new_from_array([
    140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218,
    255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
]);

/// `BPFLoaderUpgradeab1e11111111111111111111111`
pub const BPF_LOADER_UPGRADEABLE: Pubkey = Pubkey::new_from_array([
    2, 168, 246, 145, 78, 136, 161, 176, 226, 16, 21, 62, 247, 99, 174, 43, 0, 194, 185, 61, 22,
    193, 36, 210, 192, 83, 122, 16, 4, 128, 0, 0,
]);

/// Both token programs use 82 bytes for a mint with no extensions.
pub const MINT_LEN: usize = 82;
/// A token account is 165 bytes. `amount` is the u64 at offset 64.
pub const TOKEN_ACCOUNT_LEN: usize = 165;
/// A Token-2022 associated token account: 165, the account type byte, and `immutableOwner`'s
/// 4 byte header with no value.
pub const TOKEN_2022_ACCOUNT_LEN: usize = 170;
/// Every test mint has 6 decimals.
pub const MINT_DECIMALS: u8 = 6;

/// The freeze exception mints, from the text, not from the program's constant.
pub const USDC_MAINNET: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
pub const USDT_MAINNET: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
pub const USDC_DEVNET: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/// The 82 byte base of a mint, the same on both token programs: `COption<Pubkey>` is a 4 byte
/// tag and 32 bytes.
pub fn mint_base(mint_authority: &Pubkey, supply: u64, freeze_authority: Option<&Pubkey>) -> Vec<u8> {
    let mut data = Vec::with_capacity(MINT_LEN);
    data.extend_from_slice(&1u32.to_le_bytes());
    data.extend_from_slice(mint_authority.as_ref());
    data.extend_from_slice(&supply.to_le_bytes());
    data.push(MINT_DECIMALS);
    data.push(1); // is_initialized
    match freeze_authority {
        Some(key) => {
            data.extend_from_slice(&1u32.to_le_bytes());
            data.extend_from_slice(key.as_ref());
        }
        None => data.extend_from_slice(&[0u8; 36]),
    }
    assert_eq!(data.len(), MINT_LEN);
    data
}

/// A Token-2022 mint with `extensions`, as raw account bytes: the base, zero padding to 165, the
/// account type byte (1, mint), then one TLV entry per extension (u16 type, u16 length, value).
/// Value lengths come from the token crate itself, so no size is typed by hand. Values are zero,
/// except `DefaultAccountState` (2, frozen) and `MetadataPointer` (points at the mint).
/// `metadata` adds a `TokenMetadata` entry, name `chad`, symbol `CHAD`, the pump.fun shape.
pub fn mint_2022_data(
    mint: &Pubkey,
    mint_authority: &Pubkey,
    freeze_authority: Option<&Pubkey>,
    extensions: &[ExtensionType],
    metadata: bool,
) -> Vec<u8> {
    let mut data = mint_base(mint_authority, 0, freeze_authority);
    if extensions.is_empty() && !metadata {
        return data;
    }
    data.resize(TOKEN_ACCOUNT_LEN, 0);
    data.push(1); // AccountType::Mint
    for ext in extensions {
        let len = ExtensionType::try_calculate_account_len::<Mint2022>(&[*ext]).expect("extension size")
            - TOKEN_ACCOUNT_LEN
            - 1
            - 4;
        let mut value = vec![0u8; len];
        match ext {
            ExtensionType::DefaultAccountState => value[0] = 2,
            ExtensionType::MetadataPointer => value[32..64].copy_from_slice(mint.as_ref()),
            _ => {}
        }
        data.extend_from_slice(&u16::from(*ext).to_le_bytes());
        data.extend_from_slice(&(len as u16).to_le_bytes());
        data.extend_from_slice(&value);
    }
    if metadata {
        // Borsh: update_authority (32, zero is none), mint (32), name, symbol, uri, then an
        // empty additional_metadata list.
        let mut value = vec![0u8; 32];
        value.extend_from_slice(mint.as_ref());
        for s in ["chad", "CHAD", ""] {
            value.extend_from_slice(&(s.len() as u32).to_le_bytes());
            value.extend_from_slice(s.as_bytes());
        }
        value.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&u16::from(ExtensionType::TokenMetadata).to_le_bytes());
        data.extend_from_slice(&(value.len() as u16).to_le_bytes());
        data.extend_from_slice(&value);
    }
    data
}

/// Token `TransferChecked`, tag 12. Same layout on Token and Token 2022.
pub fn token_transfer_checked(
    token_program: &Pubkey,
    source: &Pubkey,
    mint: &Pubkey,
    destination: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(MINT_DECIMALS);
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(*owner, true),
        ],
        data,
    }
}

/// System `Transfer`, tag 2.
pub fn system_transfer(from: &Pubkey, to: &Pubkey, lamports: u64) -> Instruction {
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&lamports.to_le_bytes());
    Instruction {
        program_id: SYSTEM_PROGRAM,
        accounts: vec![AccountMeta::new(*from, true), AccountMeta::new(*to, false)],
        data,
    }
}

/// System `CreateAccount`, tag 0.
pub fn system_create_account(
    payer: &Pubkey,
    new: &Pubkey,
    lamports: u64,
    space: u64,
    owner: &Pubkey,
) -> Instruction {
    let mut data = 0u32.to_le_bytes().to_vec();
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&space.to_le_bytes());
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: SYSTEM_PROGRAM,
        accounts: vec![AccountMeta::new(*payer, true), AccountMeta::new(*new, true)],
        data,
    }
}

/// Token `InitializeMint2`, tag 20. Same layout on Token and Token 2022.
pub fn initialize_mint2(
    token_program: &Pubkey,
    mint: &Pubkey,
    decimals: u8,
    mint_authority: &Pubkey,
    freeze_authority: Option<&Pubkey>,
) -> Instruction {
    let mut data = vec![20u8, decimals];
    data.extend_from_slice(mint_authority.as_ref());
    match freeze_authority {
        Some(key) => {
            data.push(1);
            data.extend_from_slice(key.as_ref());
        }
        None => data.push(0),
    }
    Instruction {
        program_id: *token_program,
        accounts: vec![AccountMeta::new(*mint, false)],
        data,
    }
}

/// Token `InitializeAccount3`, tag 18. A plain token account, not an associated one: the owner
/// is whatever key is given, and the address is any keypair.
pub fn initialize_account3(
    token_program: &Pubkey,
    account: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Instruction {
    let mut data = vec![18u8];
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: *token_program,
        accounts: vec![AccountMeta::new(*account, false), AccountMeta::new_readonly(*mint, false)],
        data,
    }
}

/// Token `MintTo`, tag 7.
pub fn mint_to(
    token_program: &Pubkey,
    mint: &Pubkey,
    destination: &Pubkey,
    authority: &Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = vec![7u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

/// Token `Transfer`, tag 3.
pub fn token_transfer(
    token_program: &Pubkey,
    source: &Pubkey,
    destination: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(*owner, true),
        ],
        data,
    }
}

/// The associated token account address for under `token_program`.
pub fn ata_address(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), token_program.as_ref(), mint.as_ref()],
        &ATA_PROGRAM,
    )
    .0
}

/// Associated token `Create`, tag 0.
pub fn create_ata(
    payer: &Pubkey,
    owner: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
) -> Instruction {
    let ata = ata_address(owner, mint, token_program);
    Instruction {
        program_id: ATA_PROGRAM,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(ata, false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(*token_program, false),
        ],
        data: vec![0u8],
    }
}

/// `amount` out of a raw token account.
pub fn token_amount(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}
