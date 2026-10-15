//! Property tests. A whole program call per case is slow in
//! an SVM, so the case counts are small. Every case ends with the invariant check of 15.4.

mod common;

use common::spl::*;
use common::tree::verify;
use common::*;
use dropchad::state::DropStatus;
use dropchad::{ClaimBitmap, Drop, MAX_FEE_BPS};
use proptest::prelude::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// 15.4. as far as a snapshot can see them.
fn check_invariants(h: &Harness, ctx: &DropCtx) {
    let d = h.drop_state(ctx);
    assert!(d.total_claimed <= d.total_entitlements, "I1");
    assert_eq!(d.gross_required, d.total_entitlements + d.fee_amount, "I7");
    assert!(d.account_budget_used <= d.account_budget_lamports, "");
    if d.status == DropStatus::Active {
        assert!(h.balance(ctx) >= d.total_entitlements - d.total_claimed, "I3");
        if ctx.is_spl() {
            assert!(
                h.lamports(&ctx.drop) >= h.rent_for(Drop::SIZE) + d.account_budget_lamports - d.account_budget_used,
                "I3b"
            );
        }
    }
    if h.exists(&ctx.bitmap) {
        assert_eq!(h.claimed_bits(ctx), d.claimed_count, "I14");
    }
    assert!(h.lamports(&ctx.drop) >= h.rent_for(Drop::SIZE), "I18");
    assert_eq!(d.rent_payer, h.relayer.pubkey(), "I17");
}

fn shuffled(n: usize, seed: u64) -> Vec<usize> {
    // a small deterministic shuffle, no rand dependency
    let mut order: Vec<usize> = (0..n).collect();
    let mut x = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    for i in (1..n).rev() {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        let j = (x % (i as u64 + 1)) as usize;
        order.swap(i, j);
    }
    order
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 6, ..ProptestConfig::default() })]

    /// Random claim order over a random tree of 1 to 64 leaves.
    #[test]
    fn random_claim_order(n in 1usize..=64, seed in any::<u64>()) {
        let mut h = Harness::new();
        let ctx = h.new_sol_drop(&receivers(n, MIN_SOL_LEAF * 2), 1);
        h.fund_and_activate(&ctx);
        let order = shuffled(n, seed);
        for (step, &i) in order.iter().enumerate() {
            expect_ok(h.claim(&ctx, i));
            prop_assert!(h.is_claimed(&ctx, i as u32), "I2");
            prop_assert_eq!(h.drop_state(&ctx).claimed_count as usize, step + 1);
            check_invariants(&h, &ctx);
        }
        // a second pass fails everywhere
        for &i in &order {
            expect_fail(h.claim(&ctx, i));
        }
        prop_assert_eq!(h.drop_state(&ctx).total_claimed, ctx.total());
        prop_assert_eq!(h.spendable(&ctx), 0);
    }

    /// Random amounts: correct off chain, and no overflow on chain.
    #[test]
    fn random_amounts(amounts in prop::collection::vec(MIN_SOL_LEAF..=(5 * SOL), 1..=12)) {
        let mut h = Harness::new();
        let recv: Vec<_> = amounts.iter().map(|a| (Keypair::new().pubkey(), *a)).collect();
        let ctx = h.new_sol_drop(&recv, 2);
        prop_assert_eq!(ctx.total(), amounts.iter().sum::<u64>(), "I8");
        prop_assert_eq!(ctx.tree.leaf_count() as usize, amounts.len(), "I8");
        h.fund_and_activate(&ctx);
        for i in 0..amounts.len() {
            expect_ok(h.claim(&ctx, i));
            prop_assert_eq!(h.lamports(&ctx.recipient(i)), ctx.amount(i));
        }
        check_invariants(&h, &ctx);
        prop_assert_eq!(h.drop_state(&ctx).total_claimed, ctx.total());
    }

    /// Random overfunding: holds while active and over the life.
    #[test]
    fn random_overfunding(extra in 0u64..=(3 * SOL), claimed in 0usize..=4) {
        let mut h = Harness::new();
        let ctx = h.new_sol_drop(&receivers(4, SOL), 3);
        let funded = ctx.total() + extra;
        expect_ok(h.fund(&ctx, funded));
        expect_ok(h.activate(&ctx));
        for i in 0..claimed {
            expect_ok(h.claim(&ctx, i));
            check_invariants(&h, &ctx);
        }
        prop_assert_eq!(h.spendable(&ctx), funded - claimed as u64 * SOL, "I3 with the extra on top");
        let deadline = h.drop_state(&ctx).claim_deadline;
        h.warp_to(deadline + 1);
        expect_ok(h.refund(&ctx));
        let refunded = h.lamports(&ctx.refund_recipient);
        prop_assert_eq!(funded, claimed as u64 * SOL + refunded, "I10");
        prop_assert_eq!(h.spendable(&ctx), 0, "I12");
        check_invariants(&h, &ctx);
    }

    /// A token drop in random claim order, some receivers with a token account already and some
    /// without, a random SOL fee. after every claim; the SOL side adds up at the end: the fee
    /// to us, the rent of each new account back to the caller, the rest back to the sender.
    #[test]
    fn random_token_claims(n in 1usize..=16, seed in any::<u64>(), has_account in any::<u16>(), fee in 0u64..=1_000_000_000) {
        let mut h = Harness::with_fee(100);
        let mint = h.create_mint();
        let ctx = h.new_token_drop(&receivers(n, 1_000), mint, 5, fee);
        let mut fresh = 0u64;
        for i in 0..n {
            if has_account & (1 << i) != 0 {
                h.create_ata(&ctx.recipient(i), &mint, &TOKEN_PROGRAM);
            } else {
                fresh += 1;
            }
        }
        let fee_before = h.lamports(&h.fee_wallet.pubkey());
        h.fund_and_activate(&ctx);
        prop_assert_eq!(h.lamports(&h.fee_wallet.pubkey()) - fee_before, fee, "");
        for &i in &shuffled(n, seed) {
            expect_ok(h.claim(&ctx, i));
            check_invariants(&h, &ctx);
        }
        let d = h.drop_state(&ctx);
        let rent = h.rent_for(TOKEN_ACCOUNT_LEN);
        prop_assert_eq!(d.account_budget_lamports, n as u64 * rent, "");
        prop_assert_eq!(d.account_budget_used, fresh * rent, "");
        h.warp_to(d.claim_deadline + 1);
        expect_ok(h.refund(&ctx));
        prop_assert_eq!(h.lamports(&ctx.refund_recipient), (n as u64 - fresh) * rent, "");
        prop_assert_eq!(h.spendable(&ctx), 0, "I12");
        check_invariants(&h, &ctx);
    }

    /// Random fee bps from 0 to the cap.
    #[test]
    fn random_fee_bps(bps in 0u16..=MAX_FEE_BPS, total in (10 * MIN_SOL_LEAF)..=(20 * SOL)) {
        let mut h = Harness::with_fee(bps);
        let ctx = h.new_sol_drop(&[(Keypair::new().pubkey(), total)], 4);
        let d = h.drop_state(&ctx);
        prop_assert_eq!(d.fee_amount, ((total as u128) * bps as u128 / 10_000) as u64);
        prop_assert_eq!(d.gross_required, total + d.fee_amount, "I7");
        expect_ok(h.fund(&ctx, d.gross_required));
        let fee_before = h.lamports(&h.fee_wallet.pubkey());
        expect_ok(h.activate(&ctx));
        let fee_paid = h.lamports(&h.fee_wallet.pubkey()) - fee_before;
        prop_assert_eq!(fee_paid, d.fee_amount);
        expect_ok(h.claim(&ctx, 0));
        let deadline = h.drop_state(&ctx).claim_deadline;
        h.warp_to(deadline + 1);
        expect_ok(h.refund(&ctx));
        let refunded = h.lamports(&ctx.refund_recipient);
        prop_assert_eq!(d.gross_required, total + fee_paid + refunded, "I10");
        check_invariants(&h, &ctx);
    }

    /// The program's fold agrees with the test builder on random trees.
    #[test]
    fn merkle_fold_agrees_with_the_builder(n in 1usize..=200, seed in any::<u64>()) {
        let drop = Keypair::new().pubkey();
        let recv: Vec<_> = (0..n).map(|i| (Keypair::new().pubkey(), seed % 1000 + i as u64 + 1)).collect();
        let t = common::tree::DropTree::build(drop, DEVNET_CHAIN_ID, &recv);
        for i in 0..n {
            let leaf = t.leaves[i];
            let proof = t.proof(i);
            prop_assert!(proof.len() <= dropchad::MAX_PROOF_LEN);
            prop_assert!(verify(&t.root(), &leaf, &proof));
            let r = &t.receivers[i];
            prop_assert_eq!(dropchad::merkle::leaf_hash(&drop, DEVNET_CHAIN_ID, i as u32, &r.key, r.amount), leaf);
            prop_assert!(dropchad::merkle::verify(&t.root(), &leaf, &proof));
            // and the neighbour's proof does not fit this leaf
            if n > 1 {
                let other = t.proof((i + 1) % n);
                prop_assert!(!dropchad::merkle::verify(&t.root(), &leaf, &other) || other == proof);
            }
        }
    }
}

#[test]
fn bitmap_helpers_agree_with_the_spec_layout_s5_5() {
    let mut b = ClaimBitmap { drop: Default::default(), bump: 0, bits: [0; dropchad::BITMAP_BYTES] };
    b.set_claimed(0);
    b.set_claimed(9);
    b.set_claimed(9_999);
    assert_eq!(b.bits[0], 0b0000_0001);
    assert_eq!(b.bits[1], 0b0000_0010);
    assert_eq!(b.bits[1249], 0b1000_0000);
    assert!(b.is_claimed(0) && b.is_claimed(9) && b.is_claimed(9_999));
    assert!(!b.is_claimed(1) && !b.is_claimed(8) && !b.is_claimed(9_998));
}
