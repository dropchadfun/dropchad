//! The four deadline boundaries, both sides of each.
//! Same six names as.

mod common;

use common::*;
use dropchad::state::DropStatus;
use dropchad::DropError;

#[test]
fn test_activate_at_funding_deadline_succeeds() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 1);
    expect_ok(h.fund(&ctx, SOL));
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline);
    expect_ok(h.activate(&ctx));
    assert_eq!(h.drop_state(&ctx).activated_at, deadline);
}

#[test]
fn test_cancel_at_funding_deadline_reverts() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 2);
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline);
    expect_err(h.cancel(&ctx), DropError::FundingStillOpen);
}

#[test]
fn test_activate_one_second_after_deadline_reverts() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 3);
    expect_ok(h.fund(&ctx, SOL));
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline + 1);
    expect_err(h.activate(&ctx), DropError::FundingExpired);
    // and cancel works at that same second: exactly one of the two
    expect_ok(h.cancel(&ctx));
    assert_eq!(h.drop_state(&ctx).status, DropStatus::Cancelled);
}

#[test]
fn test_claim_at_claim_deadline_succeeds() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 4);
    h.fund_and_activate(&ctx);
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline);
    expect_ok(h.claim(&ctx, 0));
}

#[test]
fn test_refund_at_claim_deadline_reverts() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 5);
    h.fund_and_activate(&ctx);
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline);
    expect_err(h.refund(&ctx), DropError::ClaimWindowOpen);
}

#[test]
fn test_claim_one_second_after_deadline_reverts() {
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(2, SOL), 6);
    h.fund_and_activate(&ctx);
    let deadline = h.drop_state(&ctx).claim_deadline;
    h.warp_to(deadline + 1);
    expect_err(h.claim(&ctx, 0), DropError::ClaimWindowClosed);
    // and refund works at that same second
    expect_ok(h.refund(&ctx));
}

#[test]
fn deadlines_are_derived_from_the_clock_not_from_slots_s9_8() {
    // Same wall clock, a different slot: nothing changes.
    let mut h = Harness::new();
    let ctx = h.new_sol_drop(&receivers(1, SOL), 7);
    expect_ok(h.fund(&ctx, SOL));
    let deadline = h.drop_state(&ctx).funding_deadline;
    h.warp_to(deadline);
    h.svm.warp_to_slot(1_000_000);
    h.warp_to(deadline);
    expect_ok(h.activate(&ctx));
}
