//! `claim_handle`: the handle leaf, the
//! binding checked through the Ed25519 program and the instructions sysvar, the live binder.
//! The Ed25519 instruction is built by hand here, in the one strict layout the program accepts:
//! one signature, every instruction index `u16::MAX` ("this instruction"), the key at 16, the
//! signature at 48, the 192 byte message at 112. The LiteSVM `precompiles` feature makes the
//! runtime really verify the signature, so a bad one fails before the program runs.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use common::spl::*;
use common::tree::{keccak, Tree};
use common::*;
use dropchad::events::{Claimed, HandleClaimed};
use dropchad::DropError;
use solana_keypair::Keypair;
use solana_signer::Signer;

// -- constants --------------------------------------------------------------------------------

fn ed25519_program() -> Pubkey {
    "Ed25519SigVerify111111111111111111111111111".parse().unwrap()
}

fn instructions_sysvar() -> Pubkey {
    "Sysvar1nstructions1111111111111111111111111".parse().unwrap()
}

/// the same constant as the EVM `HANDLE_LEAF_TAG`.
fn handle_leaf_tag() -> [u8; 32] {
    keccak(&[b"dropchad:handle-leaf:v1"])
}

/// Not the leaf tag, so a binding message can never be a leaf preimage.
fn binding_tag() -> [u8; 32] {
    keccak(&[b"dropchad:binding:v1"])
}

// -- the handle tree, written from the, not from the program ------------------------

fn word_u64(v: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..32].copy_from_slice(&v.to_be_bytes());
    w
}

fn handle_frame(drop: &Pubkey, chain_id: u64, index: u32, x_id: u64, amount: u64) -> [u8; 192] {
    let mut out = [0u8; 192];
    out[0..32].copy_from_slice(&handle_leaf_tag());
    out[32..64].copy_from_slice(drop.as_ref());
    out[64..96].copy_from_slice(&word_u64(chain_id));
    out[96..128].copy_from_slice(&word_u64(u64::from(index)));
    out[128..160].copy_from_slice(&word_u64(x_id));
    out[160..192].copy_from_slice(&word_u64(amount));
    out
}

fn handle_leaf(drop: &Pubkey, chain_id: u64, index: u32, x_id: u64, amount: u64) -> [u8; 32] {
    let inner = keccak(&[&handle_frame(drop, chain_id, index, x_id, amount)]);
    keccak(&[&inner])
}

/// 192 bytes, signed raw.
fn binding_message(drop: &Pubkey, chain_id: u64, index: u32, x_id: u64, recipient: &Pubkey) -> [u8; 192] {
    let mut out = [0u8; 192];
    out[0..32].copy_from_slice(&binding_tag());
    out[32..64].copy_from_slice(drop.as_ref());
    out[64..96].copy_from_slice(&word_u64(chain_id));
    out[96..128].copy_from_slice(&word_u64(u64::from(index)));
    out[128..160].copy_from_slice(&word_u64(x_id));
    out[160..192].copy_from_slice(recipient.as_ref());
    out
}

// -- the Ed25519 instruction --------------------------------------------------------------------

/// One entry of the offsets table: signature offset, signature instruction index, public key
/// offset, public key instruction index, message offset, message size, message instruction index.
type Offsets = [u16; 7];

/// Any layout, for the tests that must be refused. `blobs` are appended after the header in order.
fn ed25519_ix_raw(offsets: &[Offsets], blobs: &[&[u8]]) -> Instruction {
    let mut data = vec![offsets.len() as u8, 0u8];
    for o in offsets {
        for v in o {
            data.extend_from_slice(&v.to_le_bytes());
        }
    }
    for b in blobs {
        data.extend_from_slice(b);
    }
    Instruction { program_id: ed25519_program(), accounts: vec![], data }
}

/// The one strict layout: key at 16, signature at 48, message at 112, all indexes `u16::MAX`.
fn ed25519_ix(key: &Pubkey, sig: &[u8], msg: &[u8]) -> Instruction {
    let m = u16::MAX;
    ed25519_ix_raw(&[[48, m, 16, m, 112, msg.len() as u16, m]], &[key.as_ref(), sig, msg])
}

fn sign(signer: &Keypair, msg: &[u8]) -> Vec<u8> {
    signer.sign_message(msg).as_ref().to_vec()
}

// -- a handle drop under test -------------------------------------------------------------------

struct HandleDrop {
    ctx: DropCtx,
    x_ids: Vec<u64>,
    amounts: Vec<u64>,
    tree: Tree,
}

impl HandleDrop {
    fn proof(&self, index: usize) -> Vec<[u8; 32]> {
        self.tree.proof(index)
    }
}

struct H {
    h: Harness,
    binder: Keypair,
}

impl H {
    fn new() -> H {
        let mut h = Harness::new();
        let binder = Keypair::new();
        let admin = h.deployer.insecure_clone();
        expect_ok(h.admin_send(&admin, dropchad::instruction::SetBinder { binder: binder.pubkey() }.data()));
        H { h, binder }
    }

    /// A handle drop over `(x_id, amount)` pairs, ascending by `x_id`.
    fn create(&mut self, leaves: &[(u64, u64)], mint: Option<Pubkey>, tag: u8) -> HandleDrop {
        let mut ctx = self.h.prepare(&receivers(1, 1), mint, tag, 0);
        let x_ids: Vec<u64> = leaves.iter().map(|l| l.0).collect();
        let amounts: Vec<u64> = leaves.iter().map(|l| l.1).collect();
        let hashes: Vec<[u8; 32]> = leaves
            .iter()
            .enumerate()
            .map(|(i, (x, a))| handle_leaf(&ctx.drop, DEVNET_CHAIN_ID, i as u32, *x, *a))
            .collect();
        let tree = Tree::build(hashes);
        ctx.params.merkle_root = tree.root();
        ctx.params.total_entitlements = amounts.iter().sum();
        ctx.params.leaf_count = leaves.len() as u32;
        if let Some(m) = mint {
            self.h.fund_funder(&m, ctx.params.total_entitlements * 2);
        }
        expect_ok(self.h.send_create(&ctx));
        HandleDrop { ctx, x_ids, amounts, tree }
    }

    fn active_sol(&mut self, leaves: &[(u64, u64)], tag: u8) -> HandleDrop {
        let d = self.create(leaves, None, tag);
        self.h.fund_and_activate(&d.ctx);
        d
    }

    fn claim_handle_ix(&self, d: &HandleDrop, caller: &Pubkey, index: u32, x_id: u64, amount: u64, recipient: &Pubkey, proof: Vec<[u8; 32]>) -> Instruction {
        let ctx = &d.ctx;
        Instruction {
            program_id: dropchad::ID,
            accounts: dropchad::accounts::ClaimHandle {
                caller: *caller,
                config: self.h.config,
                drop: ctx.drop,
                bitmap: ctx.bitmap,
                recipient: *recipient,
                mint: ctx.mint,
                vault: ctx.vault,
                recipient_ata: ctx.mint.map(|m| ata_address(recipient, &m, &ctx.token_program)),
                token_program: ctx.mint.map(|_| ctx.token_program),
                associated_token_program: ctx.mint.map(|_| ATA_PROGRAM),
                instructions: instructions_sysvar(),
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: dropchad::instruction::ClaimHandle { index, x_id, amount, proof }.data(),
        }
    }

    /// The honest pair of instructions for leaf `index`, bound to `recipient`, signed by `signer`.
    fn honest_ixs(&self, d: &HandleDrop, index: usize, recipient: &Pubkey, signer: &Keypair) -> Vec<Instruction> {
        let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, index as u32, d.x_ids[index], recipient);
        vec![
            ed25519_ix(&signer.pubkey(), &sign(signer, &msg), &msg),
            self.claim_handle_ix(d, &self.h.relayer.pubkey(), index as u32, d.x_ids[index], d.amounts[index], recipient, d.proof(index)),
        ]
    }

    fn send_as_relayer(&mut self, ixs: &[Instruction]) -> TxResult {
        let relayer = self.h.relayer.insecure_clone();
        self.h.send(ixs, &[&relayer])
    }

    fn claim(&mut self, d: &HandleDrop, index: usize, recipient: &Pubkey) -> TxResult {
        let binder = self.binder.insecure_clone();
        let ixs = self.honest_ixs(d, index, recipient, &binder);
        self.send_as_relayer(&ixs)
    }
}

const X_ALICE: u64 = 44_196_397;
const X_BOB: u64 = 1_600_000_000_000_000_000;

fn two_leaves() -> Vec<(u64, u64)> {
    vec![(X_ALICE, SOL), (X_BOB, 2 * SOL)]
}

// -- happy path -------------------------------------------------------------------------------

#[test]
fn claim_handle_pays_the_bound_wallet_s7_25() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let relayer_before = t.h.lamports(&t.h.relayer.pubkey());

    let meta = expect_ok(t.claim(&d, 0, &wallet));

    assert_eq!(t.h.lamports(&wallet), SOL, "paid to the bound wallet");
    assert!(t.h.lamports(&t.h.relayer.pubkey()) < relayer_before, "the caller paid a fee and got nothing");
    assert!(t.h.is_claimed(&d.ctx, 0));
    let drop = t.h.drop_state(&d.ctx);
    assert_eq!((drop.claimed_count, drop.total_claimed), (1, SOL));

    let ev = find_event::<HandleClaimed>(&meta.logs).expect("HandleClaimed");
    assert_eq!((ev.drop, ev.index, ev.x_id, ev.recipient, ev.amount), (d.ctx.drop, 0, X_ALICE, wallet, SOL));
    assert!(find_event::<Claimed>(&meta.logs).is_none(), "HandleClaimed, never Claimed");
}

#[test]
fn claim_handle_spl_s7_25() {
    let mut t = H::new();
    let mint = t.h.create_mint();
    let d = t.create(&[(X_ALICE, 5_000_000)], Some(mint), 1);
    t.h.fund_and_activate(&d.ctx);
    let wallet = Keypair::new().pubkey();

    expect_ok(t.claim(&d, 0, &wallet));
    assert_eq!(t.h.holding(&d.ctx, &wallet), 5_000_000);
}

#[test]
fn claim_handle_pays_the_caller_back_for_a_new_token_account_s6_3_13() {
    let mut t = H::new();
    let mint = t.h.create_pump_mint();
    let d = t.create(&[(X_ALICE, 5_000_000)], Some(mint), 1);
    t.h.fund_and_activate(&d.ctx);
    let wallet = Keypair::new().pubkey();

    let relayer_before = t.h.lamports(&t.h.relayer.pubkey());
    let drop_before = t.h.lamports(&d.ctx.drop);
    expect_ok(t.claim(&d, 0, &wallet));
    assert_eq!(t.h.holding(&d.ctx, &wallet), 5_000_000);
    let rent = t.h.rent_for(TOKEN_2022_ACCOUNT_LEN);
    assert_eq!(drop_before - t.h.lamports(&d.ctx.drop), rent, "from the budget");
    assert_eq!(t.h.drop_state(&d.ctx).account_budget_used, rent);
    assert!(relayer_before - t.h.lamports(&t.h.relayer.pubkey()) < 100_000, "the relayer paid only the fee");
}

#[test]
fn claim_handle_from_any_caller_s7_25() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let funder = t.h.funder.insecure_clone();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &wallet);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg), &msg),
        t.claim_handle_ix(&d, &funder.pubkey(), 0, X_ALICE, SOL, &wallet, d.proof(0)),
    ];
    expect_ok(t.h.send(&ixs, &[&funder]));
    assert_eq!(t.h.lamports(&wallet), SOL);
}

#[test]
fn two_handle_claims_in_one_transaction_s7_26() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let (a, b) = (Keypair::new().pubkey(), Keypair::new().pubkey());
    let binder = t.binder.insecure_clone();
    let mut ixs = t.honest_ixs(&d, 0, &a, &binder);
    ixs.extend(t.honest_ixs(&d, 1, &b, &binder));
    expect_ok(t.send_as_relayer(&ixs));
    assert_eq!((t.h.lamports(&a), t.h.lamports(&b)), (SOL, 2 * SOL));
}

// -- the binder, read live --------------------------------------------------------------------

#[test]
fn claim_handle_fails_when_revoked_r7_23() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let admin = t.h.deployer.insecure_clone();
    let ix = Instruction {
        program_id: dropchad::ID,
        accounts: dropchad::accounts::RevokeBinder { signer: admin.pubkey(), config: t.h.config }.to_account_metas(None),
        data: dropchad::instruction::RevokeBinder {}.data(),
    };
    expect_ok(t.h.send(&[ix], &[&admin]));
    expect_err(t.claim(&d, 0, &Keypair::new().pubkey()), DropError::BinderIsRevoked);
}

#[test]
fn address_claims_work_while_revoked_r7_23() {
    let mut t = H::new();
    let ctx = t.h.new_sol_drop(&receivers(2, SOL), 9);
    t.h.fund_and_activate(&ctx);
    let admin = t.h.deployer.insecure_clone();
    let ix = Instruction {
        program_id: dropchad::ID,
        accounts: dropchad::accounts::RevokeBinder { signer: admin.pubkey(), config: t.h.config }.to_account_metas(None),
        data: dropchad::instruction::RevokeBinder {}.data(),
    };
    expect_ok(t.h.send(&[ix], &[&admin]));
    expect_ok(t.h.claim(&ctx, 0));
}

#[test]
fn claim_handle_fails_with_no_binder_s7_23() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    // `set_binder` refuses zero, so clear the field the way a fresh config has it.
    let mut account = t.h.svm.get_account(&t.h.config).unwrap();
    account.data[116..148].fill(0);
    t.h.svm.set_account(t.h.config, account).unwrap();
    assert_eq!(t.h.config_state().binder, Pubkey::default());
    expect_err(t.claim(&d, 0, &Keypair::new().pubkey()), DropError::NoBinder);
}

#[test]
fn the_binder_is_read_live_r7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let old = t.binder.insecure_clone();
    let new = Keypair::new();
    let admin = t.h.deployer.insecure_clone();
    expect_ok(t.h.admin_send(&admin, dropchad::instruction::SetBinder { binder: new.pubkey() }.data()));

    let wallet = Keypair::new().pubkey();
    let old_ixs = t.honest_ixs(&d, 0, &wallet, &old);
    expect_err(t.send_as_relayer(&old_ixs), DropError::BadBinding);

    let new_ixs = t.honest_ixs(&d, 0, &wallet, &new);
    expect_ok(t.send_as_relayer(&new_ixs));
}

// -- the binding -----------------------------------------------------------------------

#[test]
fn a_key_that_is_not_the_binder_fails_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let stranger = Keypair::new();
    let ixs = t.honest_ixs(&d, 0, &Keypair::new().pubkey(), &stranger);
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn a_binding_for_another_recipient_fails_r7_19() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let (bound, thief) = (Keypair::new().pubkey(), Keypair::new().pubkey());
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &bound);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg), &msg),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &thief, d.proof(0)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
    assert_eq!(t.h.lamports(&thief), 0);
}

#[test]
fn a_binding_for_another_index_fails_r7_20() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &wallet);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg), &msg),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 1, X_BOB, 2 * SOL, &wallet, d.proof(1)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn a_binding_from_another_drop_fails_r7_20() {
    let mut t = H::new();
    let a = t.active_sol(&two_leaves(), 1);
    let b = t.active_sol(&two_leaves(), 2);
    let wallet = Keypair::new().pubkey();
    let msg_for_a = binding_message(&a.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &wallet);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg_for_a), &msg_for_a),
        t.claim_handle_ix(&b, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &wallet, b.proof(0)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn a_binding_for_another_chain_fails_r7_20() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, 101, 0, X_ALICE, &wallet);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg), &msg),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &wallet, d.proof(0)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn a_bad_signature_is_refused_by_the_runtime_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &wallet);
    let mut sig = sign(&t.binder, &msg);
    sig[0] ^= 1;
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sig, &msg),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &wallet, d.proof(0)),
    ];
    expect_fail(t.send_as_relayer(&ixs));
    assert!(!t.h.is_claimed(&d.ctx, 0));
}

#[test]
fn no_ed25519_instruction_fails_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let ix = t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &wallet, d.proof(0));
    expect_err(t.send_as_relayer(&[ix]), DropError::BadBinding);
}

#[test]
fn an_ed25519_instruction_not_directly_before_fails_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let relayer = t.h.relayer.pubkey();
    let mut ixs = t.honest_ixs(&d, 0, &wallet, &t.binder.insecure_clone());
    ixs.insert(1, system_transfer(&relayer, &relayer, 0));
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn an_ed25519_instruction_after_claim_handle_fails_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let mut ixs = t.honest_ixs(&d, 0, &wallet, &t.binder.insecure_clone());
    ixs.swap(0, 1);
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn two_signatures_in_the_ed25519_instruction_fail_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &wallet);
    let sig = sign(&t.binder, &msg);
    let m = u16::MAX;
    // header 2 + 2 × 14 = 30: key at 30, signature at 62, message at 126, then used twice.
    let ed = ed25519_ix_raw(
        &[[62, m, 30, m, 126, 192, m], [62, m, 30, m, 126, 192, m]],
        &[t.binder.pubkey().as_ref(), &sig, &msg],
    );
    let ixs = [ed, t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &wallet, d.proof(0))];
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn offsets_naming_another_instruction_fail_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &wallet);
    let sig = sign(&t.binder, &msg);
    // Index 0 is the Ed25519 instruction itself, so the runtime verifies the same bytes. The
    // program must still refuse: only `u16::MAX` is accepted, never a numbered instruction.
    let ed = ed25519_ix_raw(&[[48, 0, 16, 0, 112, 192, 0]], &[t.binder.pubkey().as_ref(), &sig, &msg]);
    let ixs = [ed, t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &wallet, d.proof(0))];
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn a_non_standard_layout_fails_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &wallet);
    let sig = sign(&t.binder, &msg);
    let m = u16::MAX;
    // The same three blobs in another order: message at 16, key at 208, signature at 240.
    let ed = ed25519_ix_raw(&[[240, m, 208, m, 16, 192, m]], &[&msg, t.binder.pubkey().as_ref(), &sig]);
    let ixs = [ed, t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &wallet, d.proof(0))];
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

#[test]
fn a_leaf_hash_is_never_accepted_as_a_binding_s7_22() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    // The binder signs the 192 byte handle frame instead of the binding message.
    let frame = handle_frame(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, SOL);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &frame), &frame),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, SOL, &wallet, d.proof(0)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadBinding);
}

// -- the leaf --------------------------------------------------------------------------

#[test]
fn x_id_zero_fails_s7_21() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, 0, &wallet);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg), &msg),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, 0, SOL, &wallet, d.proof(0)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadXId);
}

#[test]
fn the_largest_x_id_works_s7_21() {
    let mut t = H::new();
    let d = t.active_sol(&[(u64::MAX, SOL)], 1);
    let wallet = Keypair::new().pubkey();
    expect_ok(t.claim(&d, 0, &wallet));
    assert_eq!(t.h.lamports(&wallet), SOL);
}

#[test]
fn an_index_at_leaf_count_fails_s5_8() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 2, X_ALICE, &wallet);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg), &msg),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 2, X_ALICE, SOL, &wallet, d.proof(0)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadIndex);
}

#[test]
fn claimed_once_never_rebound_r7_21() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let (first, second) = (Keypair::new().pubkey(), Keypair::new().pubkey());
    expect_ok(t.claim(&d, 0, &first));
    expect_err(t.claim(&d, 0, &second), DropError::AlreadyClaimed);
    assert_eq!(t.h.lamports(&second), 0);
}

#[test]
fn a_wrong_amount_fails_the_proof_s7_25() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, X_ALICE, &wallet);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg), &msg),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, X_ALICE, 2 * SOL, &wallet, d.proof(0)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadProof);
}

#[test]
fn an_x_id_not_in_the_tree_fails_the_proof_s7_25() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let wallet = Keypair::new().pubkey();
    let outsider = 999;
    let msg = binding_message(&d.ctx.drop, DEVNET_CHAIN_ID, 0, outsider, &wallet);
    let ixs = [
        ed25519_ix(&t.binder.pubkey(), &sign(&t.binder, &msg), &msg),
        t.claim_handle_ix(&d, &t.h.relayer.pubkey(), 0, outsider, SOL, &wallet, d.proof(0)),
    ];
    expect_err(t.send_as_relayer(&ixs), DropError::BadProof);
}

#[test]
fn a_handle_leaf_fails_in_claim_r7_33() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let relayer = t.h.relayer.insecure_clone();
    let as_key = Pubkey::new_from_array(word_u64(X_ALICE));
    let ix = t.h.claim_ix(&d.ctx, &relayer.pubkey(), 0, &as_key, SOL, d.proof(0));
    expect_err(t.h.send(&[ix], &[&relayer]), DropError::BadProof);
}

#[test]
fn an_address_leaf_fails_in_claim_handle_r7_33() {
    let mut t = H::new();
    // An address drop whose first recipient's key, read as a word, ends in a small number.
    let mut key = [0u8; 32];
    key[24..32].copy_from_slice(&X_ALICE.to_be_bytes());
    let ctx = t.h.new_sol_drop(&[(Pubkey::new_from_array(key), SOL)], 9);
    t.h.fund_and_activate(&ctx);
    let d = HandleDrop { x_ids: vec![X_ALICE], amounts: vec![SOL], tree: Tree::build(ctx.tree.leaves.clone()), ctx };

    let wallet = Keypair::new().pubkey();
    expect_err(t.claim(&d, 0, &wallet), DropError::BadProof);
}

// -- status and window, as claim --------------------------------------------------------------

#[test]
fn claim_handle_before_activation_fails_s6_3() {
    let mut t = H::new();
    let d = t.create(&two_leaves(), None, 1);
    expect_err(t.claim(&d, 0, &Keypair::new().pubkey()), DropError::WrongStatus);
}

#[test]
fn claim_handle_window_edge_s9_2() {
    let mut t = H::new();
    let d = t.active_sol(&two_leaves(), 1);
    let deadline = t.h.drop_state(&d.ctx).claim_deadline;
    t.h.warp_to(deadline);
    expect_ok(t.claim(&d, 0, &Keypair::new().pubkey()));
    t.h.warp_to(deadline + 1);
    expect_err(t.claim(&d, 1, &Keypair::new().pubkey()), DropError::ClaimWindowClosed);
}

// -- conservation over a mixed tree ----------------------------------------------------

#[test]
fn a_handle_drop_conserves_s10() {
    let mut t = H::new();
    let leaves: Vec<(u64, u64)> = (0..6).map(|i| (1_000 + i, (i + 1) * SOL)).collect();
    let d = t.active_sol(&leaves, 1);
    let mut paid = 0;
    for i in [0usize, 2, 5] {
        let w = Keypair::new().pubkey();
        expect_ok(t.claim(&d, i, &w));
        paid += d.amounts[i];
    }
    let deadline = t.h.drop_state(&d.ctx).claim_deadline;
    t.h.warp_to(deadline + 1);
    let before = t.h.lamports(&d.ctx.refund_recipient);
    expect_ok(t.h.refund(&d.ctx));
    let refunded = t.h.lamports(&d.ctx.refund_recipient) - before;
    assert_eq!(paid + refunded, d.ctx.params.total_entitlements, "claims plus refund equal the total");
}

// -- the fit: measured, not guessed ----------------------------------------------------

#[test]
fn handle_claim_fit_at_depth_9_s7_26() {
    let mut t = H::new();
    let leaves: Vec<(u64, u64)> = (0..512).map(|i| (10_000 + i, MIN_SOL_LEAF)).collect();
    let d = t.active_sol(&leaves, 1);
    assert_eq!(d.tree.depth(), 9);
    let binder = t.binder.insecure_clone();
    let relayer = t.h.relayer.pubkey();

    let mut sizes = Vec::new();
    for n in 1..=3usize {
        let mut ixs = Vec::new();
        for i in 0..n {
            ixs.extend(t.honest_ixs(&d, i, &Keypair::new().pubkey(), &binder));
        }
        sizes.push(t.h.tx_size(&ixs, &relayer));
    }
    println!("fit, depth 9, legacy transaction bytes for 1, 2, 3 handle claims: {sizes:?} (limit 1232)");
    assert!(sizes[0] <= 1232, "one handle claim must fit");

    // And one really lands.
    expect_ok(t.claim(&d, 0, &Keypair::new().pubkey()));
}
