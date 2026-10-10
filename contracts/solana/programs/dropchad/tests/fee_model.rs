//! The fee model of: a SOL drop pays `min(max(bps fee,
//! min_fee_lamports, min_fee_per_receiver_lamports × leaf_count), max_fee_lamports)`, zero is
//! off. The two new `Config` fields of, `set_fee_per_receiver` and `set_max_fee` of 6.11,
//! and the upgrade proof: the new program reads a copy of the live devnet `Config` bytes.

mod common;

use std::str::FromStr;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountSerialize, InstructionData};
use base64::Engine;
use common::*;
use dropchad::events::{DropCreated, FeePerReceiverSet, MaxFeeSet};
use dropchad::{DropError, MAX_MIN_FEE_PER_RECEIVER_LAMPORTS, MAX_SOL_FEE_LAMPORTS};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// the devnet values, the same as mainnet will be: 0.0003 SOL per receiver, cap 0.5 SOL.
const PER_RECEIVER: u64 = 300_000;
const MAX_FEE: u64 = 500_000_000;
/// the flat minimum live on devnet today.
const FLAT_MIN: u64 = 300_000;

/// The live devnet `Config` `bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD`, read only on
/// at slot 508327461 (`getProgramAccounts`, data size 253): 100 bps, not paused,
/// chain 103, binder `DhiQ…owGq`, no guardian, `min_fee_lamports` 300000, the 64 byte tail zero.
const LIVE_CONFIG: &str = "mwyq4B76zILza9FppVIl6dLBTORYJP3Y6qgPO5kINrwe3M9icOALbOaIWz+twvy1skzWYR8YjlqDdlHH28sXJFplY3u3Zt9Q82vRaaVSJenSwUzkWCT92OqoDzuZCDa8HtzPYnDgC2xkAABnAAAAAAAAAP+8uknE4xdQR2pGj0p7GAZevyehCm2c9nEYmXGVSXfofgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOCTBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
const LIVE_CONFIG_ADDRESS: &str = "bQjXn4eUvq6rq7pTQHgjdnb5eJ6nQtLxP4uLQCQvZQD";
const LIVE_RELAYER: &str = "GWuNAEF8WBr94qytoN6pK9VSPPa3g3w5SamK43oJNXzP";
const LIVE_BINDER: &str = "DhiQHDcochXLnLXhwMT3JVDcDe1pVfXjMG7pkPboowGq";
const LIVE_LAMPORTS: u64 = 1_935_480;

/// Byte ranges in the 253 byte `Config`: 8 discriminator, then the fields in order.
const ADMIN: std::ops::Range<usize> = 8..40;
const FEE_WALLET_END: usize = 104;
const MIN_FEE: std::ops::Range<usize> = 181..189;
const PER_RECEIVER_BYTES: std::ops::Range<usize> = 189..197;
const MAX_FEE_BYTES: std::ops::Range<usize> = 197..205;
const RESERVED: std::ops::Range<usize> = 205..253;

// -- helpers ----------------------------------------------------------------------------------

fn set_fee_per_receiver(h: &mut Harness, signer: &Keypair, lamports: u64) -> TxResult {
    h.admin_send(signer, dropchad::instruction::SetFeePerReceiver { lamports }.data())
}

fn set_max_fee(h: &mut Harness, signer: &Keypair, lamports: u64) -> TxResult {
    h.admin_send(signer, dropchad::instruction::SetMaxFee { lamports }.data())
}

fn set_min_fee(h: &mut Harness, signer: &Keypair, lamports: u64) -> TxResult {
    h.admin_send(signer, dropchad::instruction::SetMinFee { lamports }.data())
}

fn config_bytes(h: &Harness) -> Vec<u8> {
    h.svm.get_account(&h.config).expect("config").data
}

/// 1 percent, the flat minimum, the per receiver minimum and the cap: the devnet set.
fn new_model(bps: u16, flat_min: u64, per_receiver: u64, max_fee: u64) -> Harness {
    let mut h = Harness::with_fee(bps);
    let admin = h.deployer.insecure_clone();
    expect_ok(set_min_fee(&mut h, &admin, flat_min));
    expect_ok(set_fee_per_receiver(&mut h, &admin, per_receiver));
    expect_ok(set_max_fee(&mut h, &admin, max_fee));
    h
}

/// Create a SOL drop and return its `fee_amount`, checked against `gross_required` and the event.
fn fee_of(h: &mut Harness, receivers: &[(Pubkey, u64)], tag: u8) -> u64 {
    let ctx = h.prepare(receivers, None, tag, 0);
    let meta = expect_ok(h.send_create(&ctx));
    let d = h.drop_state(&ctx);
    assert_eq!(d.gross_required, ctx.total() + d.fee_amount);
    assert_eq!(find_event::<DropCreated>(&meta.logs).unwrap().fee_amount, d.fee_amount);
    d.fee_amount
}

/// Put the live bytes into the harness `Config` account, same address. With `ours`, the admin,
/// relayer and fee wallet (bytes 8 to 104) become the harness keys, since the live keys are not
/// in the test; every byte after them stays live.
fn load_live_config(h: &mut Harness, ours: bool) -> Vec<u8> {
    let live = base64::engine::general_purpose::STANDARD.decode(LIVE_CONFIG).unwrap();
    assert_eq!(live.len(), 253);
    let mut account = h.svm.get_account(&h.config).expect("config");
    account.data = live.clone();
    if ours {
        account.data[ADMIN].copy_from_slice(h.deployer.pubkey().as_ref());
        account.data[40..72].copy_from_slice(h.relayer.pubkey().as_ref());
        account.data[72..FEE_WALLET_END].copy_from_slice(h.fee_wallet.pubkey().as_ref());
    }
    account.lamports = LIVE_LAMPORTS.max(h.rent_for(253));
    let data = account.data.clone();
    h.svm.set_account(h.config, account).expect("set live config");
    data
}

// -- the two new Config fields ---------------------------------------------------------

#[test]
fn config_stays_253_bytes_with_the_two_new_fields_zero_s7_23() {
    let h = Harness::new();
    assert_eq!(dropchad::Config::SIZE, 253, "no migration");
    let c = h.config_state();
    assert_eq!(c.min_fee_per_receiver_lamports, 0);
    assert_eq!(c.max_fee_lamports, 0);
    assert_eq!(c.reserved, [0u8; 48]);
    assert_eq!(config_bytes(&h).len(), 253);
}

#[test]
fn the_new_fields_sit_in_the_old_reserved_bytes_s7_23() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let before = config_bytes(&h);
    expect_ok(set_fee_per_receiver(&mut h, &admin, PER_RECEIVER));
    expect_ok(set_max_fee(&mut h, &admin, MAX_FEE));
    let after = config_bytes(&h);
    assert_eq!(&after[..PER_RECEIVER_BYTES.start], &before[..PER_RECEIVER_BYTES.start], "every older field keeps its offset");
    assert_eq!(after[PER_RECEIVER_BYTES], PER_RECEIVER.to_le_bytes());
    assert_eq!(after[MAX_FEE_BYTES], MAX_FEE.to_le_bytes());
    assert_eq!(&after[RESERVED], &[0u8; 48][..], "the rest of the tail stays zero");
}

// -- set_fee_per_receiver, 6.11 ---------------------------------------------------------------

#[test]
fn the_per_receiver_ceiling_is_0_003_sol_6_12() {
    assert_eq!(MAX_MIN_FEE_PER_RECEIVER_LAMPORTS, 3_000_000);
}

#[test]
fn set_fee_per_receiver_from_admin_s8_20() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let meta = expect_ok(set_fee_per_receiver(&mut h, &admin, PER_RECEIVER));
    assert_eq!(h.config_state().min_fee_per_receiver_lamports, PER_RECEIVER);
    let ev = find_event::<FeePerReceiverSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_lamports, ev.new_lamports), (0, PER_RECEIVER));

    let meta = expect_ok(set_fee_per_receiver(&mut h, &admin, 0));
    assert_eq!(h.config_state().min_fee_per_receiver_lamports, 0, "zero turns it off");
    let ev = find_event::<FeePerReceiverSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_lamports, ev.new_lamports), (PER_RECEIVER, 0));
}

#[test]
fn set_fee_per_receiver_cap_is_inclusive_s8_20() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_ok(set_fee_per_receiver(&mut h, &admin, MAX_MIN_FEE_PER_RECEIVER_LAMPORTS));
    assert_eq!(h.config_state().min_fee_per_receiver_lamports, MAX_MIN_FEE_PER_RECEIVER_LAMPORTS);
    expect_err(
        set_fee_per_receiver(&mut h, &admin, MAX_MIN_FEE_PER_RECEIVER_LAMPORTS + 1),
        DropError::FeeTooHigh,
    );
    expect_err(set_fee_per_receiver(&mut h, &admin, u64::MAX), DropError::FeeTooHigh);
    assert_eq!(h.config_state().min_fee_per_receiver_lamports, MAX_MIN_FEE_PER_RECEIVER_LAMPORTS);
}

#[test]
fn set_fee_per_receiver_from_a_stranger_fails_s6_11() {
    let mut h = Harness::new();
    let stranger = h.funder.insecure_clone();
    expect_err(set_fee_per_receiver(&mut h, &stranger, PER_RECEIVER), DropError::NotAdmin);
    let relayer = h.relayer.insecure_clone();
    expect_err(set_fee_per_receiver(&mut h, &relayer, PER_RECEIVER), DropError::NotAdmin);
    assert_eq!(h.config_state().min_fee_per_receiver_lamports, 0);
}

// -- set_max_fee, 6.11 ------------------------------------------------------------------------

#[test]
fn set_max_fee_from_admin_s8_20() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let meta = expect_ok(set_max_fee(&mut h, &admin, MAX_FEE));
    assert_eq!(h.config_state().max_fee_lamports, MAX_FEE);
    let ev = find_event::<MaxFeeSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_lamports, ev.new_lamports), (0, MAX_FEE));

    let meta = expect_ok(set_max_fee(&mut h, &admin, 0));
    assert_eq!(h.config_state().max_fee_lamports, 0, "zero is no cap");
    let ev = find_event::<MaxFeeSet>(&meta.logs).unwrap();
    assert_eq!((ev.old_lamports, ev.new_lamports), (MAX_FEE, 0));
}

#[test]
fn set_max_fee_cap_is_inclusive_s8_20() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    expect_ok(set_max_fee(&mut h, &admin, MAX_SOL_FEE_LAMPORTS));
    assert_eq!(h.config_state().max_fee_lamports, MAX_SOL_FEE_LAMPORTS);
    expect_err(set_max_fee(&mut h, &admin, MAX_SOL_FEE_LAMPORTS + 1), DropError::FeeTooHigh);
    expect_err(set_max_fee(&mut h, &admin, u64::MAX), DropError::FeeTooHigh);
    assert_eq!(h.config_state().max_fee_lamports, MAX_SOL_FEE_LAMPORTS);
}

#[test]
fn set_max_fee_from_a_stranger_fails_s6_11() {
    let mut h = Harness::new();
    let stranger = h.funder.insecure_clone();
    expect_err(set_max_fee(&mut h, &stranger, MAX_FEE), DropError::NotAdmin);
    let relayer = h.relayer.insecure_clone();
    expect_err(set_max_fee(&mut h, &relayer, MAX_FEE), DropError::NotAdmin);
    assert_eq!(h.config_state().max_fee_lamports, 0);
}

#[test]
fn each_setter_writes_only_its_own_field_s6_11() {
    let mut h = new_model(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
    let admin = h.deployer.insecure_clone();
    let before = config_bytes(&h);

    expect_ok(set_fee_per_receiver(&mut h, &admin, 1));
    let after = config_bytes(&h);
    for (i, (a, b)) in before.iter().zip(after.iter()).enumerate() {
        if !PER_RECEIVER_BYTES.contains(&i) {
            assert_eq!(a, b, "byte {i} changed by set_fee_per_receiver");
        }
    }

    let before = after;
    expect_ok(set_max_fee(&mut h, &admin, 1));
    let after = config_bytes(&h);
    for (i, (a, b)) in before.iter().zip(after.iter()).enumerate() {
        if !MAX_FEE_BYTES.contains(&i) {
            assert_eq!(a, b, "byte {i} changed by set_max_fee");
        }
    }
}

// -- the fee in create_drop ------------------------------------------------------------

#[test]
fn the_per_receiver_minimum_wins_on_many_small_receivers_s8_20() {
    let mut h = new_model(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
    // 1 percent of 10 × 890,880 is 89,088; the flat minimum 300,000; 10 × 300,000 is 3,000,000.
    assert_eq!(fee_of(&mut h, &receivers(10, MIN_SOL_LEAF), 1), 3_000_000);
}

#[test]
fn the_bps_fee_wins_on_a_big_drop_s8_20() {
    let mut h = new_model(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
    // 1 percent of 3 SOL is 30,000,000; 3 × 300,000 is 900,000.
    assert_eq!(fee_of(&mut h, &receivers(3, SOL), 1), 30_000_000);
}

#[test]
fn the_flat_minimum_wins_when_it_is_the_biggest_s8_20() {
    let mut h = new_model(100, 2_500_000, PER_RECEIVER, MAX_FEE);
    // 1 percent 17,817; 2 × 300,000 is 600,000; the flat minimum 2,500,000.
    assert_eq!(fee_of(&mut h, &receivers(2, MIN_SOL_LEAF), 1), 2_500_000);
}

#[test]
fn the_cap_wins_over_the_bps_fee_s8_20() {
    let mut h = new_model(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
    // 1 percent of 300 SOL is 3 SOL, capped at 0.5 SOL.
    assert_eq!(fee_of(&mut h, &receivers(3, 100 * SOL), 1), MAX_FEE);
}

#[test]
fn the_cap_wins_over_the_per_receiver_minimum_s8_20() {
    let mut h = new_model(100, FLAT_MIN, PER_RECEIVER, 1_000_000);
    // 10 × 300,000 is 3,000,000, capped at 1,000,000.
    assert_eq!(fee_of(&mut h, &receivers(10, MIN_SOL_LEAF), 1), 1_000_000);
}

#[test]
fn the_cap_wins_over_the_flat_minimum_s8_20() {
    let mut h = new_model(100, FLAT_MIN, 0, 100_000);
    // The flat minimum 300,000, capped at 100,000: min of max, as written in.
    assert_eq!(fee_of(&mut h, &receivers(1, MIN_SOL_LEAF), 1), 100_000);
}

#[test]
fn a_zero_cap_is_no_cap_s8_20() {
    let mut h = new_model(100, FLAT_MIN, PER_RECEIVER, 0);
    assert_eq!(fee_of(&mut h, &receivers(3, 100 * SOL), 1), 3 * SOL);
}

#[test]
fn a_zero_per_receiver_minimum_is_off_s8_20() {
    let mut h = new_model(100, 0, 0, MAX_FEE);
    assert_eq!(fee_of(&mut h, &receivers(10, MIN_SOL_LEAF), 1), 89_088, "only 1 percent left");
}

#[test]
fn the_per_receiver_minimum_alone_at_zero_bps_s8_20() {
    let mut h = new_model(0, 0, PER_RECEIVER, 0);
    assert_eq!(fee_of(&mut h, &receivers(7, SOL), 1), 7 * PER_RECEIVER);
}

#[test]
fn every_part_zero_is_no_fee_s8_20() {
    let mut h = new_model(0, 0, 0, 0);
    assert_eq!(fee_of(&mut h, &receivers(3, SOL), 1), 0);
}

#[test]
fn every_ceiling_at_once_is_capped_at_1_sol_s8_20() {
    // 5 percent, 0.025 SOL flat, 400 × 0.003 SOL is 1.2 SOL, capped at 1 SOL.
    let mut h = new_model(500, dropchad::MAX_MIN_FEE_LAMPORTS, MAX_MIN_FEE_PER_RECEIVER_LAMPORTS, MAX_SOL_FEE_LAMPORTS);
    assert_eq!(fee_of(&mut h, &receivers(400, MIN_SOL_LEAF), 1), MAX_SOL_FEE_LAMPORTS);
}

#[test]
fn with_both_new_fields_zero_the_fee_is_today_s_fee_s8_14() {
    let mut h = new_model(100, FLAT_MIN, 0, 0);
    assert_eq!(fee_of(&mut h, &receivers(3, MIN_SOL_LEAF), 1), FLAT_MIN, "max(1 percent, flat minimum)");
    assert_eq!(fee_of(&mut h, &receivers(3, SOL), 2), 30_000_000);
}

#[test]
fn a_token_drop_ignores_the_new_fields_s8_15() {
    let mut h = new_model(100, FLAT_MIN, PER_RECEIVER, MAX_FEE);
    let mint = h.create_mint();
    let ctx = h.new_token_drop(&receivers(10, 1_000_000), mint, 1, 1_234_567);
    let d = h.drop_state(&ctx);
    assert_eq!(d.fee_amount, 0, "the fee of a token drop is sol_fee_lamports");
    assert_eq!(d.sol_fee_lamports, 1_234_567, "as the relayer passed it, no per receiver minimum");
    assert_eq!(d.gross_required, 10_000_000);
}

#[test]
fn an_existing_drop_keeps_its_fee_s8_20() {
    let mut h = Harness::with_fee(100);
    let admin = h.deployer.insecure_clone();
    expect_ok(set_min_fee(&mut h, &admin, FLAT_MIN));
    let old = h.new_sol_drop(&receivers(10, MIN_SOL_LEAF), 1);
    assert_eq!(h.drop_state(&old).fee_amount, FLAT_MIN);

    expect_ok(set_fee_per_receiver(&mut h, &admin, PER_RECEIVER));
    expect_ok(set_max_fee(&mut h, &admin, MAX_FEE));
    assert_eq!(h.drop_state(&old).fee_amount, FLAT_MIN, "the old drop is not touched");
    assert_eq!(fee_of(&mut h, &receivers(10, MIN_SOL_LEAF), 2), 3_000_000, "the next drop gets the new fee");

    // The old drop still activates with its old fee and pays every receiver.
    let before = h.lamports(&h.fee_wallet.pubkey());
    h.fund_and_activate(&old);
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()) - before, FLAT_MIN);
    for i in 0..10 {
        expect_ok(h.claim(&old, i));
        assert_eq!(h.lamports(&old.recipient(i)), MIN_SOL_LEAF);
    }
}

#[test]
fn a_new_model_drop_pays_its_fee_at_activation_s8_20() {
    let mut h = new_model(100, 0, PER_RECEIVER, MAX_FEE);
    let ctx = h.new_sol_drop(&receivers(5, MIN_SOL_LEAF), 1);
    assert_eq!(h.drop_state(&ctx).fee_amount, 5 * PER_RECEIVER);

    let before = h.lamports(&h.fee_wallet.pubkey());
    h.fund_and_activate(&ctx);
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()) - before, 5 * PER_RECEIVER);
    for i in 0..5 {
        expect_ok(h.claim(&ctx, i));
        assert_eq!(h.lamports(&ctx.recipient(i)), MIN_SOL_LEAF, "every receiver paid in full");
    }
}

// -- the upgrade on a copy of the live devnet Config -----------------------------------

#[test]
fn the_live_config_is_this_programs_config_pda_s8_20() {
    let h = Harness::new();
    assert_eq!(h.config, Pubkey::from_str(LIVE_CONFIG_ADDRESS).unwrap());
}

#[test]
fn the_live_config_bytes_read_right_after_the_upgrade_s8_20() {
    let mut h = Harness::new();
    let live = load_live_config(&mut h, false);

    let c = h.config_state();
    assert_eq!(c.admin.to_bytes()[..], live[ADMIN]);
    assert_eq!(c.relayer, Pubkey::from_str(LIVE_RELAYER).unwrap());
    assert_eq!(c.default_fee_bps, 100);
    assert!(!c.paused);
    assert_eq!(c.chain_id, DEVNET_CHAIN_ID);
    assert_eq!(c.bump, h.config_bump);
    assert_eq!(c.binder, Pubkey::from_str(LIVE_BINDER).unwrap());
    assert!(!c.binder_revoked);
    assert_eq!(c.guardian, Pubkey::default());
    assert_eq!(c.min_fee_lamports, FLAT_MIN);
    assert_eq!(c.min_fee_per_receiver_lamports, 0, "off until set_fee_per_receiver");
    assert_eq!(c.max_fee_lamports, 0, "no cap until set_max_fee");
    assert_eq!(c.reserved, [0u8; 48]);

    // Written back, the new layout gives exactly the live bytes: nothing is read differently.
    let mut again = Vec::new();
    c.try_serialize(&mut again).unwrap();
    assert_eq!(again, live);
}

#[test]
fn the_live_config_charges_today_s_fee_until_the_admin_acts_s8_20() {
    let mut h = Harness::new();
    let admin = h.deployer.insecure_clone();
    let live = load_live_config(&mut h, true);

    // Right after the upgrade: max(1 percent, 0.0003 SOL), exactly as today.
    assert_eq!(fee_of(&mut h, &receivers(10, MIN_SOL_LEAF), 1), FLAT_MIN);
    assert_eq!(fee_of(&mut h, &receivers(3, SOL), 2), 30_000_000);
    let today = h.new_sol_drop(&receivers(3, MIN_SOL_LEAF), 3);
    assert_eq!(config_bytes(&h), live, "creating drops writes nothing in the config");

    // The steps: per receiver, cap, flat minimum to 0.
    expect_ok(set_fee_per_receiver(&mut h, &admin, PER_RECEIVER));
    expect_ok(set_max_fee(&mut h, &admin, MAX_FEE));
    expect_ok(set_min_fee(&mut h, &admin, 0));
    let after = config_bytes(&h);
    for (i, (a, b)) in live.iter().zip(after.iter()).enumerate() {
        if !(MIN_FEE.contains(&i) || PER_RECEIVER_BYTES.contains(&i) || MAX_FEE_BYTES.contains(&i)) {
            assert_eq!(a, b, "byte {i} of the live config changed");
        }
    }

    assert_eq!(fee_of(&mut h, &receivers(10, MIN_SOL_LEAF), 4), 3_000_000);
    assert_eq!(fee_of(&mut h, &receivers(1, MIN_SOL_LEAF), 5), PER_RECEIVER);
    assert_eq!(fee_of(&mut h, &receivers(3, 100 * SOL), 6), MAX_FEE);

    // The drop made before the setters keeps its fee and settles as before.
    assert_eq!(h.drop_state(&today).fee_amount, FLAT_MIN);
    let before = h.lamports(&h.fee_wallet.pubkey());
    h.fund_and_activate(&today);
    assert_eq!(h.lamports(&h.fee_wallet.pubkey()) - before, FLAT_MIN);
    for i in 0..3 {
        expect_ok(h.claim(&today, i));
    }
}
