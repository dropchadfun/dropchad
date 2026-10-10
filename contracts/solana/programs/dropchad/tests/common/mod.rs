//! The test harness. LiteSVM in process, the built program loaded from `target/deploy`, the
//! clock under test control.
//! Run `anchor build` first: `include_bytes!` needs the `.so` at compile time.

#![allow(dead_code)]

pub mod spl;
pub mod tree;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator, InstructionData, ToAccountMetas};
use base64::Engine;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

use dropchad::state::{ClaimBitmap, Config, CreateParams, Drop};
use dropchad::DropError;
use spl::*;
use tree::DropTree;

pub const PROGRAM_BYTES: &[u8] = include_bytes!("../../../../target/deploy/dropchad.so");

pub const SOL: u64 = 1_000_000_000;
pub const DEVNET_CHAIN_ID: u64 = 103;
/// A fixed start time so every deadline in the tests is a known number.
pub const T0: i64 = 1_760_000_000;
/// The 7 day and 30 day production defaults.
pub const FUNDING_PERIOD: u32 = 7 * 86_400;
pub const CLAIM_PERIOD: u32 = 30 * 86_400;
/// Rent exemption for a data-less account. The smallest SOL leaf the backend allows.
pub const MIN_SOL_LEAF: u64 = 890_880;

pub type TxResult = core::result::Result<TransactionMetadata, FailedTransactionMetadata>;

pub struct Harness {
    pub svm: LiteSVM,
    /// Upgrade authority and admin.
    pub deployer: Keypair,
    pub relayer: Keypair,
    pub fee_wallet: Keypair,
    /// Sends the funding transfers. Also the "anyone" caller in permissionless tests.
    pub funder: Keypair,
    pub config: Pubkey,
    pub config_bump: u8,
}

// ---------------------------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------------------------

pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[dropchad::CONFIG_SEED], &dropchad::ID)
}

pub fn drop_pda(commitment: &[u8; 32], nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[dropchad::DROP_SEED, commitment, &nonce.to_le_bytes()],
        &dropchad::ID,
    )
}

pub fn bitmap_pda(drop: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[dropchad::BITMAP_SEED, drop.as_ref()], &dropchad::ID)
}

pub fn program_data_pda() -> Pubkey {
    Pubkey::find_program_address(&[dropchad::ID.as_ref()], &BPF_LOADER_UPGRADEABLE).0
}

/// A distinct commitment per test. Real ones are keccak hashes; any 32 non zero bytes will do.
pub fn commitment(tag: u8) -> [u8; 32] {
    let mut c = [tag; 32];
    c[0] = c[0].wrapping_add(1);
    c
}

pub fn receivers(n: usize, amount: u64) -> Vec<(Pubkey, u64)> {
    (0..n).map(|_| (Keypair::new().pubkey(), amount)).collect()
}

// ---------------------------------------------------------------------------------------------
// Assertions on transaction results
// ---------------------------------------------------------------------------------------------

pub fn expect_ok(res: TxResult) -> TransactionMetadata {
    match res {
        Ok(meta) => meta,
        Err(failed) => panic!("expected success, got {:?}\nlogs:\n{}", failed.err, failed.meta.logs.join("\n")),
    }
}

pub fn expect_fail(res: TxResult) -> FailedTransactionMetadata {
    match res {
        Ok(meta) => panic!("expected failure, tx succeeded\nlogs:\n{}", meta.logs.join("\n")),
        Err(failed) => failed,
    }
}

/// Anchor custom errors are `6000 + variant index`, `errors.rs`.
pub fn error_code(err: DropError) -> u32 {
    6000 + err as u32
}

pub fn expect_err(res: TxResult, err: DropError) {
    let failed = expect_fail(res);
    let wanted = format!("Custom({})", error_code(err));
    let got = format!("{:?}", failed.err);
    assert!(
        got.contains(&wanted),
        "expected {err:?} ({wanted}), got {got}\nlogs:\n{}",
        failed.meta.logs.join("\n")
    );
}

/// Anchor framework errors, for the constraint failures the design does not name.
/// 2006 ConstraintSeeds, 2001 ConstraintHasOne, 2012 ConstraintAddress, 3007 AccountOwnedByWrongProgram,
/// 3002 AccountDiscriminatorMismatch, 2009 ConstraintAssociated.
pub fn expect_anchor_err(res: TxResult, code: u32) {
    let failed = expect_fail(res);
    let wanted = format!("Custom({code})");
    let got = format!("{:?}", failed.err);
    assert!(got.contains(&wanted), "expected anchor error {code}, got {got}\nlogs:\n{}", failed.meta.logs.join("\n"));
}

/// Decode the first `T` event out of the logs, or `None`.
pub fn find_event<T: Discriminator + AnchorDeserialize>(logs: &[String]) -> Option<T> {
    for line in logs {
        if let Some(b64) = line.strip_prefix("Program data: ") {
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
            if bytes.len() >= 8 && bytes[..8] == T::DISCRIMINATOR[..] {
                return T::try_from_slice(&bytes[8..]).ok();
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------
// A drop under test
// ---------------------------------------------------------------------------------------------

pub struct DropCtx {
    pub drop: Pubkey,
    pub bump: u8,
    pub bitmap: Pubkey,
    pub bitmap_bump: u8,
    pub mint: Option<Pubkey>,
    pub vault: Option<Pubkey>,
    /// The mint's own token program, classic or Token-2022. Classic for a SOL drop, unused.
    pub token_program: Pubkey,
    pub refund_recipient: Pubkey,
    pub params: CreateParams,
    pub tree: DropTree,
}

impl DropCtx {
    pub fn is_spl(&self) -> bool {
        self.mint.is_some()
    }

    pub fn total(&self) -> u64 {
        self.tree.total
    }

    pub fn recipient(&self, index: usize) -> Pubkey {
        self.tree.receivers[index].key
    }

    pub fn amount(&self, index: usize) -> u64 {
        self.tree.receivers[index].amount
    }

    pub fn proof(&self, index: usize) -> Vec<[u8; 32]> {
        self.tree.proof(index)
    }
}

// ---------------------------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------------------------

impl Harness {
    /// Program loaded, upgrade authority patched to `deployer`, wallets funded, clock at `T0`.
    /// The config is **not** initialised.
    pub fn bare() -> Harness {
        let mut svm = LiteSVM::new();
        svm.add_program(dropchad::ID, PROGRAM_BYTES);

        let deployer = Keypair::new();
        let relayer = Keypair::new();
        let fee_wallet = Keypair::new();
        let funder = Keypair::new();

        // needs a real upgrade authority. LiteSVM loads the program under the upgradeable
        // loader with no authority, so the ProgramData header is patched: after the 4 byte enum
        // tag and the 8 byte slot, an Option<Pubkey> as 1 tag byte plus 32 bytes.
        let program_account = svm.get_account(&dropchad::ID).expect("program account");
        assert_eq!(
            program_account.owner, BPF_LOADER_UPGRADEABLE,
            "litesvm loaded the program under another loader; the harness expects the upgradeable loader"
        );
        let pd_key = program_data_pda();
        let mut pd = svm.get_account(&pd_key).expect("program data account");
        pd.data[12] = 1;
        pd.data[13..45].copy_from_slice(deployer.pubkey().as_ref());
        svm.set_account(pd_key, pd).expect("set program data");

        for (key, amount) in [
            (deployer.pubkey(), 100 * SOL),
            (relayer.pubkey(), 100 * SOL),
            (fee_wallet.pubkey(), SOL),
            (funder.pubkey(), 10_000 * SOL),
        ] {
            svm.airdrop(&key, amount).expect("airdrop");
        }

        let (config, config_bump) = config_pda();
        let mut h = Harness { svm, deployer, relayer, fee_wallet, funder, config, config_bump };
        h.warp_to(T0);
        h
    }

    /// `bare()` plus `initialize_config(103, relayer, fee_wallet, 0)`.
    pub fn new() -> Harness {
        let mut h = Harness::bare();
        expect_ok(h.init_config(DEVNET_CHAIN_ID, 0));
        h
    }

    /// `bare()` plus a config with a fee.
    pub fn with_fee(bps: u16) -> Harness {
        let mut h = Harness::bare();
        expect_ok(h.init_config(DEVNET_CHAIN_ID, bps));
        h
    }

    // -- transactions ---------------------------------------------------------------------------

    /// One transaction, `signers[0]` pays. The blockhash is rotated first so an identical
    /// instruction sent twice is two different transactions.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).expect("sign");
        self.svm.send_transaction(tx)
    }

    /// Serialized size of a one signer legacy transaction, for the 6.5 fit table.
    pub fn tx_size(&self, ixs: &[Instruction], payer: &Pubkey) -> usize {
        let msg = Message::new_with_blockhash(ixs, Some(payer), &self.svm.latest_blockhash());
        1 + 64 + VersionedMessage::Legacy(msg).serialize().len()
    }

    // -- clock ----------------------------------------------------------------------------------

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn warp_to(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    // -- reads ----------------------------------------------------------------------------------

    pub fn account<T: AccountDeserialize>(&self, key: &Pubkey) -> Option<T> {
        let account = self.svm.get_account(key)?;
        T::try_deserialize(&mut &account.data[..]).ok()
    }

    pub fn exists(&self, key: &Pubkey) -> bool {
        self.svm.get_account(key).map(|a| a.lamports > 0).unwrap_or(false)
    }

    pub fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
    }

    pub fn rent_for(&self, data_len: usize) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(data_len)
    }

    pub fn config_state(&self) -> Config {
        self.account::<Config>(&self.config).expect("config")
    }

    pub fn drop_state(&self, ctx: &DropCtx) -> Drop {
        self.account::<Drop>(&ctx.drop).expect("drop")
    }

    pub fn bitmap_state(&self, ctx: &DropCtx) -> ClaimBitmap {
        self.account::<ClaimBitmap>(&ctx.bitmap).expect("bitmap")
    }

    pub fn is_claimed(&self, ctx: &DropCtx, index: u32) -> bool {
        self.bitmap_state(ctx).is_claimed(index)
    }

    pub fn claimed_bits(&self, ctx: &DropCtx) -> u32 {
        self.bitmap_state(ctx).bits.iter().map(|b| b.count_ones()).sum()
    }

    pub fn token_balance(&self, account: &Pubkey) -> u64 {
        self.svm.get_account(account).map(|a| token_amount(&a.data)).unwrap_or(0)
    }

    /// The SOL a drop can spend: lamports above its own rent minimum.
    pub fn spendable(&self, ctx: &DropCtx) -> u64 {
        let account = self.svm.get_account(&ctx.drop).expect("drop");
        account.lamports - self.rent_for(account.data.len())
    }

    /// The balance `activate` looks at.
    pub fn balance(&self, ctx: &DropCtx) -> u64 {
        match ctx.vault {
            Some(vault) => self.token_balance(&vault),
            None => self.spendable(ctx),
        }
    }

    /// What a recipient holds of the drop asset.
    pub fn holding(&self, ctx: &DropCtx, owner: &Pubkey) -> u64 {
        match ctx.mint {
            Some(mint) => self.token_balance(&ata_address(owner, &mint, &ctx.token_program)),
            None => self.lamports(owner),
        }
    }

    // -- config and admin -----------------------------------------------------------------------

    pub fn init_config_ix(&self, authority: &Pubkey, chain_id: u64, relayer: Pubkey, fee_wallet: Pubkey, bps: u16) -> Instruction {
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::InitializeConfig {
                authority: *authority,
                config: self.config,
                program: dropchad::ID,
                program_data: program_data_pda(),
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: dropchad::instruction::InitializeConfig { chain_id, relayer, fee_wallet, default_fee_bps: bps }.data(),
        }
    }

    pub fn init_config(&mut self, chain_id: u64, bps: u16) -> TxResult {
        let ix = self.init_config_ix(&self.deployer.pubkey(), chain_id, self.relayer.pubkey(), self.fee_wallet.pubkey(), bps);
        let deployer = self.deployer.insecure_clone();
        self.send(&[ix], &[&deployer])
    }

    pub fn admin_ix(&self, admin: &Pubkey, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::AdminOnly { admin: *admin, config: self.config }.to_account_metas(None),
            data,
        }
    }

    pub fn admin_send(&mut self, signer: &Keypair, data: Vec<u8>) -> TxResult {
        let ix = self.admin_ix(&signer.pubkey(), data);
        self.send(&[ix], &[signer])
    }

    pub fn set_paused(&mut self, signer: &Keypair, paused: bool) -> TxResult {
        self.admin_send(signer, dropchad::instruction::SetPaused { paused }.data())
    }

    pub fn set_default_fee_bps(&mut self, signer: &Keypair, bps: u16) -> TxResult {
        self.admin_send(signer, dropchad::instruction::SetDefaultFeeBps { bps }.data())
    }

    pub fn set_fee_wallet(&mut self, signer: &Keypair, fee_wallet: Pubkey) -> TxResult {
        self.admin_send(signer, dropchad::instruction::SetFeeWallet { fee_wallet }.data())
    }

    pub fn set_relayer(&mut self, signer: &Keypair, relayer: Pubkey) -> TxResult {
        self.admin_send(signer, dropchad::instruction::SetRelayer { relayer }.data())
    }

    pub fn set_admin(&mut self, signer: &Keypair, admin: Pubkey) -> TxResult {
        self.admin_send(signer, dropchad::instruction::SetAdmin { admin }.data())
    }

    // -- mints ----------------------------------------------------------------------------------

    /// A mint under `token_program`. The deployer is the mint authority.
    pub fn create_mint_with(&mut self, token_program: &Pubkey, freeze_authority: Option<Pubkey>) -> Pubkey {
        let mint = Keypair::new();
        let lamports = self.rent_for(MINT_LEN);
        let deployer = self.deployer.insecure_clone();
        let ixs = [
            system_create_account(&deployer.pubkey(), &mint.pubkey(), lamports, MINT_LEN as u64, token_program),
            initialize_mint2(token_program, &mint.pubkey(), 6, &deployer.pubkey(), freeze_authority.as_ref()),
        ];
        expect_ok(self.send(&ixs, &[&deployer, &mint]));
        mint.pubkey()
    }

    /// A classic mint with no freeze authority.
    pub fn create_mint(&mut self) -> Pubkey {
        self.create_mint_with(&TOKEN_PROGRAM, None)
    }

    /// Write a mint's raw bytes at `address`, rent exempt, owned by `token_program`. The deployer
    /// is the mint authority. Used for Token-2022 extensions and for the allowlisted mints, whose
    /// addresses nobody can sign for in a test.
    pub fn put_mint(&mut self, address: Pubkey, token_program: &Pubkey, data: Vec<u8>) -> Pubkey {
        let mut account = self.svm.get_account(&self.deployer.pubkey()).expect("template");
        account.lamports = self.rent_for(data.len());
        account.data = data;
        account.owner = *token_program;
        account.executable = false;
        self.svm.set_account(address, account).expect("set mint");
        address
    }

    /// A classic mint at an exact address.
    pub fn create_mint_at(&mut self, address: Pubkey, freeze_authority: Option<Pubkey>) -> Pubkey {
        let data = mint_base(&self.deployer.pubkey(), 0, freeze_authority.as_ref());
        self.put_mint(address, &TOKEN_PROGRAM, data)
    }

    /// A Token-2022 mint with `extensions`, and `TokenMetadata` when `metadata`.
    pub fn create_mint_2022(&mut self, freeze_authority: Option<Pubkey>, extensions: &[ExtensionType], metadata: bool) -> Pubkey {
        let mint = Keypair::new().pubkey();
        let data = mint_2022_data(&mint, &self.deployer.pubkey(), freeze_authority.as_ref(), extensions, metadata);
        self.put_mint(mint, &TOKEN_2022_PROGRAM, data)
    }

    /// The pump.fun shape: `metadataPointer` and `tokenMetadata`.
    pub fn create_pump_mint(&mut self) -> Pubkey {
        self.create_mint_2022(None, &[ExtensionType::MetadataPointer], true)
    }

    /// The program that owns `mint`: Token-2022 when it says so, else classic.
    pub fn token_program_of(&self, mint: &Pubkey) -> Pubkey {
        match self.svm.get_account(mint) {
            Some(a) if a.owner == TOKEN_2022_PROGRAM => TOKEN_2022_PROGRAM,
            _ => TOKEN_PROGRAM,
        }
    }

    pub fn create_ata(&mut self, owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
        let deployer = self.deployer.insecure_clone();
        expect_ok(self.send(&[create_ata(&deployer.pubkey(), owner, mint, token_program)], &[&deployer]));
        ata_address(owner, mint, token_program)
    }

    /// A plain token account for `owner`, at a fresh keypair address. Not an associated account,
    /// so it can never satisfy an `associated_token` constraint.
    pub fn create_plain_token_account(&mut self, mint: &Pubkey, owner: &Pubkey) -> Pubkey {
        let account = Keypair::new();
        let lamports = self.rent_for(TOKEN_ACCOUNT_LEN);
        let deployer = self.deployer.insecure_clone();
        let ixs = [
            system_create_account(&deployer.pubkey(), &account.pubkey(), lamports, TOKEN_ACCOUNT_LEN as u64, &TOKEN_PROGRAM),
            initialize_account3(&TOKEN_PROGRAM, &account.pubkey(), mint, owner),
        ];
        expect_ok(self.send(&ixs, &[&deployer, &account]));
        account.pubkey()
    }

    pub fn mint_to(&mut self, token_program: &Pubkey, mint: &Pubkey, destination: &Pubkey, amount: u64) {
        let deployer = self.deployer.insecure_clone();
        expect_ok(self.send(&[mint_to(token_program, mint, destination, &deployer.pubkey(), amount)], &[&deployer]));
    }

    /// The funder's token account for `mint`, created and filled with `amount`.
    pub fn fund_funder(&mut self, mint: &Pubkey, amount: u64) -> Pubkey {
        let funder = self.funder.pubkey();
        let program = self.token_program_of(mint);
        let ata = self.create_ata(&funder, mint, &program);
        self.mint_to(&program, mint, &ata, amount);
        ata
    }

    // -- drops ----------------------------------------------------------------------------------

    /// Predict the PDAs and build the tree. Nothing is sent.
    pub fn prepare(&self, receivers: &[(Pubkey, u64)], mint: Option<Pubkey>, tag: u8, nonce: u64) -> DropCtx {
        let commitment = commitment(tag);
        let (drop, bump) = drop_pda(&commitment, nonce);
        let (bitmap, bitmap_bump) = bitmap_pda(&drop);
        let tree = DropTree::build(drop, DEVNET_CHAIN_ID, receivers);
        let refund_recipient = Keypair::new().pubkey();
        let params = CreateParams {
            merkle_root: tree.root(),
            manifest_hash: [0x11; 32],
            total_entitlements: tree.total,
            leaf_count: tree.leaf_count(),
            refund_recipient,
            creator_commitment: commitment,
            nonce,
            funding_period: FUNDING_PERIOD,
            claim_period: CLAIM_PERIOD,
            sol_fee_lamports: 0,
        };
        let token_program = mint.map(|m| self.token_program_of(&m)).unwrap_or(TOKEN_PROGRAM);
        let vault = mint.map(|m| ata_address(&drop, &m, &token_program));
        DropCtx { drop, bump, bitmap, bitmap_bump, mint, vault, token_program, refund_recipient, params, tree }
    }

    pub fn create_drop_ix(&self, ctx: &DropCtx, relayer: &Pubkey, params: &CreateParams) -> Instruction {
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::CreateDrop {
                relayer: *relayer,
                config: self.config,
                drop: ctx.drop,
                bitmap: ctx.bitmap,
                mint: ctx.mint,
                vault: ctx.vault,
                token_program: ctx.mint.map(|_| ctx.token_program),
                associated_token_program: ctx.mint.map(|_| ATA_PROGRAM),
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: dropchad::instruction::CreateDrop { params: params.clone() }.data(),
        }
    }

    pub fn send_create(&mut self, ctx: &DropCtx) -> TxResult {
        let relayer = self.relayer.insecure_clone();
        let ix = self.create_drop_ix(ctx, &relayer.pubkey(), &ctx.params);
        self.send(&[ix], &[&relayer])
    }

    /// `create_drop` with different params than the tree was built with, for the revert tests.
    pub fn send_create_with(&mut self, ctx: &DropCtx, params: CreateParams) -> TxResult {
        let relayer = self.relayer.insecure_clone();
        let ix = self.create_drop_ix(ctx, &relayer.pubkey(), &params);
        self.send(&[ix], &[&relayer])
    }

    /// A SOL drop, created. `tag` picks the commitment.
    pub fn new_sol_drop(&mut self, receivers: &[(Pubkey, u64)], tag: u8) -> DropCtx {
        let ctx = self.prepare(receivers, None, tag, 0);
        expect_ok(self.send_create(&ctx));
        ctx
    }

    /// An SPL drop on a fresh classic mint, created. The funder holds `2 × total` of it.
    pub fn new_spl_drop(&mut self, receivers: &[(Pubkey, u64)], tag: u8) -> DropCtx {
        let mint = self.create_mint();
        self.new_token_drop(receivers, mint, tag, 0)
    }

    /// A token drop on `mint`, either token program, with `sol_fee` lamports of fee, created.
    /// The funder holds `2 × total` of it.
    pub fn new_token_drop(&mut self, receivers: &[(Pubkey, u64)], mint: Pubkey, tag: u8, sol_fee: u64) -> DropCtx {
        let mut ctx = self.prepare(receivers, Some(mint), tag, 0);
        ctx.params.sol_fee_lamports = sol_fee;
        self.fund_funder(&mint, ctx.total() * 2);
        expect_ok(self.send_create(&ctx));
        ctx
    }

    /// A plain transfer of the asset from the funder to the drop address, 3.3.
    pub fn fund(&mut self, ctx: &DropCtx, amount: u64) -> TxResult {
        let funder = self.funder.insecure_clone();
        let ix = match (ctx.mint, ctx.vault) {
            (Some(mint), Some(vault)) => {
                let source = ata_address(&funder.pubkey(), &mint, &ctx.token_program);
                token_transfer_checked(&ctx.token_program, &source, &mint, &vault, &funder.pubkey(), amount)
            }
            _ => system_transfer(&funder.pubkey(), &ctx.drop, amount),
        };
        self.send(&[ix], &[&funder])
    }

    /// Lamports from the funder to the drop account. A token drop's SOL side.
    pub fn fund_lamports(&mut self, ctx: &DropCtx, amount: u64) -> TxResult {
        let funder = self.funder.insecure_clone();
        self.send(&[system_transfer(&funder.pubkey(), &ctx.drop, amount)], &[&funder])
    }

    /// What a token drop needs in lamports above its rent: the SOL fee and the account budget.
    pub fn sol_side(&self, ctx: &DropCtx) -> u64 {
        let d = self.drop_state(ctx);
        d.sol_fee_lamports + d.account_budget_lamports
    }

    /// A token drop's exact SOL side, when it has one.
    pub fn fund_sol_side(&mut self, ctx: &DropCtx) {
        let sol_side = self.sol_side(ctx);
        if ctx.is_spl() && sol_side > 0 {
            expect_ok(self.fund_lamports(ctx, sol_side));
        }
    }

    /// Fund exactly `gross_required`, and for a token drop exactly its SOL side, then activate.
    /// The common happy path.
    pub fn fund_and_activate(&mut self, ctx: &DropCtx) {
        let gross = self.drop_state(ctx).gross_required;
        expect_ok(self.fund(ctx, gross));
        self.fund_sol_side(ctx);
        expect_ok(self.activate(ctx));
    }

    /// Rewrite a drop account in place, for the layout and budget edge tests. Test only: on a
    /// cluster nobody but the program can write it.
    pub fn patch_drop(&mut self, ctx: &DropCtx, f: impl FnOnce(&mut Drop)) {
        let mut account = self.svm.get_account(&ctx.drop).expect("drop");
        let mut d = Drop::try_deserialize(&mut &account.data[..]).expect("decode");
        f(&mut d);
        let mut data = Vec::with_capacity(account.data.len());
        d.try_serialize(&mut data).expect("encode");
        account.data[..data.len()].copy_from_slice(&data);
        self.svm.set_account(ctx.drop, account).expect("set drop");
    }

    pub fn activate_ix(&self, ctx: &DropCtx, caller: &Pubkey, fee_wallet: &Pubkey) -> Instruction {
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::Activate {
                caller: *caller,
                drop: ctx.drop,
                fee_wallet: *fee_wallet,
                mint: ctx.mint,
                vault: ctx.vault,
                token_program: ctx.mint.map(|_| ctx.token_program),
            }
            .to_account_metas(None),
            data: dropchad::instruction::Activate {}.data(),
        }
    }

    pub fn activate(&mut self, ctx: &DropCtx) -> TxResult {
        let funder = self.funder.insecure_clone();
        let ix = self.activate_ix(ctx, &funder.pubkey(), &self.fee_wallet.pubkey());
        self.send(&[ix], &[&funder])
    }

    pub fn claim_ix(&self, ctx: &DropCtx, caller: &Pubkey, index: u32, recipient: &Pubkey, amount: u64, proof: Vec<[u8; 32]>) -> Instruction {
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::Claim {
                caller: *caller,
                drop: ctx.drop,
                bitmap: ctx.bitmap,
                recipient: *recipient,
                mint: ctx.mint,
                vault: ctx.vault,
                recipient_ata: ctx.mint.map(|m| ata_address(recipient, &m, &ctx.token_program)),
                token_program: ctx.mint.map(|_| ctx.token_program),
                associated_token_program: ctx.mint.map(|_| ATA_PROGRAM),
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: dropchad::instruction::Claim { index, amount, proof }.data(),
        }
    }

    /// The honest claim for leaf `index`, sent by the relayer.
    pub fn claim(&mut self, ctx: &DropCtx, index: usize) -> TxResult {
        let relayer = self.relayer.insecure_clone();
        let ix = self.claim_ix(ctx, &relayer.pubkey(), index as u32, &ctx.recipient(index), ctx.amount(index), ctx.proof(index));
        self.send(&[ix], &[&relayer])
    }

    pub fn settle_ix(&self, ctx: &DropCtx, caller: &Pubkey, refund_recipient: &Pubkey, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::Settle {
                caller: *caller,
                drop: ctx.drop,
                refund_recipient: *refund_recipient,
                mint: ctx.mint,
                vault: ctx.vault,
                refund_ata: ctx.mint.map(|m| ata_address(refund_recipient, &m, &ctx.token_program)),
                token_program: ctx.mint.map(|_| ctx.token_program),
                associated_token_program: ctx.mint.map(|_| ATA_PROGRAM),
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data,
        }
    }

    pub fn cancel(&mut self, ctx: &DropCtx) -> TxResult {
        let funder = self.funder.insecure_clone();
        let ix = self.settle_ix(ctx, &funder.pubkey(), &ctx.refund_recipient, dropchad::instruction::CancelUnfunded {}.data());
        self.send(&[ix], &[&funder])
    }

    pub fn refund(&mut self, ctx: &DropCtx) -> TxResult {
        let funder = self.funder.insecure_clone();
        let ix = self.settle_ix(ctx, &funder.pubkey(), &ctx.refund_recipient, dropchad::instruction::Refund {}.data());
        self.send(&[ix], &[&funder])
    }

    /// The stray mint's own program.
    pub fn sweep_ix(&self, ctx: &DropCtx, caller: &Pubkey, refund_recipient: &Pubkey, mint: &Pubkey) -> Instruction {
        let program = self.token_program_of(mint);
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::Sweep {
                caller: *caller,
                drop: ctx.drop,
                refund_recipient: *refund_recipient,
                mint: *mint,
                stray_ata: ata_address(&ctx.drop, mint, &program),
                refund_ata: ata_address(refund_recipient, mint, &program),
                token_program: program,
                associated_token_program: ATA_PROGRAM,
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: dropchad::instruction::Sweep {}.data(),
        }
    }

    pub fn sweep(&mut self, ctx: &DropCtx, mint: &Pubkey) -> TxResult {
        let funder = self.funder.insecure_clone();
        let ix = self.sweep_ix(ctx, &funder.pubkey(), &ctx.refund_recipient, mint);
        self.send(&[ix], &[&funder])
    }

    pub fn close_ix(&self, ctx: &DropCtx, caller: &Pubkey, rent_payer: &Pubkey, refund_recipient: &Pubkey) -> Instruction {
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::CloseDrop {
                caller: *caller,
                drop: ctx.drop,
                bitmap: ctx.bitmap,
                rent_payer: *rent_payer,
                refund_recipient: *refund_recipient,
                mint: ctx.mint,
                vault: ctx.vault,
                refund_ata: ctx.mint.map(|m| ata_address(refund_recipient, &m, &ctx.token_program)),
                token_program: ctx.mint.map(|_| ctx.token_program),
                associated_token_program: ctx.mint.map(|_| ATA_PROGRAM),
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: dropchad::instruction::CloseDrop {}.data(),
        }
    }

    /// Close, sent by the funder so the rent payer's balance change is exactly the rent.
    pub fn close(&mut self, ctx: &DropCtx) -> TxResult {
        let funder = self.funder.insecure_clone();
        let ix = self.close_ix(ctx, &funder.pubkey(), &self.relayer.pubkey(), &ctx.refund_recipient);
        self.send(&[ix], &[&funder])
    }

    // -- whole lifecycles -----------------------------------------------------------------------

    /// Created, funded, activated, every leaf claimed, refunded after the deadline.
    pub fn finished_sol_drop(&mut self, tag: u8) -> DropCtx {
        let ctx = self.new_sol_drop(&receivers(3, SOL), tag);
        self.fund_and_activate(&ctx);
        for i in 0..3 {
            expect_ok(self.claim(&ctx, i));
        }
        let deadline = self.drop_state(&ctx).claim_deadline;
        self.warp_to(deadline + 1);
        expect_ok(self.refund(&ctx));
        ctx
    }

    pub fn finished_spl_drop(&mut self, tag: u8) -> DropCtx {
        let ctx = self.new_spl_drop(&receivers(3, 1_000_000), tag);
        self.fund_and_activate(&ctx);
        for i in 0..3 {
            expect_ok(self.claim(&ctx, i));
        }
        let deadline = self.drop_state(&ctx).claim_deadline;
        self.warp_to(deadline + 1);
        expect_ok(self.refund(&ctx));
        ctx
    }
}
