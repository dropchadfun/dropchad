/**
 * the EVM refund.
 * - the EVM adapter can refund now; it can cancel too, never close
 * - `settle` on the EVM waits for the claim deadline, then sends one `refund` and never a second
 * -: a drop with nothing left is not refunded on the EVM, where a zero
 *   refund buys nothing; Solana still refunds it, because that is what lets `close_drop` run
 * - an expired handle drop and an address drop with a failed leaf both get their money back
 */
import { getAddress } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { singleAdapter } from "../src/chain/adapter.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropHandleLeaves, dropJobs, drops, profiles } from "../src/db/schema.js";
import { createDropEventBus } from "../src/worker/events.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import { FAKE_CHAIN_ID, createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";

const DROP = getAddress("0x00000000000000000000000000000000000d0000");
const AMOUNT = 100_000_000_000_000n;
/** 2026-09-11T10:00:00Z, the worker's clock, in seconds. */
const NOW = 1_789_120_800n;
const PAST = NOW - 60n;
const FUTURE = NOW + 86_400n;

let handle: DatabaseHandle;
let chain: FakeChain;
let worker: Worker;

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  chain = createFakeChain();
  worker = createWorker({
    db: handle.db,
    chains: singleAdapter(evmAdapterFor(chain)),
    events: createDropEventBus(),
    now: () => new Date(Number(NOW) * 1000),
    pollMs: 5_000,
  });
  return () => handle.close();
});

async function seed(args: {
  mode: "address" | "handle";
  state: string;
  job: "settle" | "claim_handles";
  failedIndexes?: number[];
}): Promise<void> {
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
  await handle.db.insert(drops).values({
    address: DROP.toLowerCase(),
    chainId: FAKE_CHAIN_ID,
    chainKey: "robinhood-testnet",
    xUserId: "1",
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: JSON.stringify({
      version: 2,
      mode: args.mode,
      entries: [{ index: 0, xId: "44196397", amount: AMOUNT.toString(), proof: [] }],
    }),
    totalEntitlements: AMOUNT.toString(),
    feeAmount: "0",
    grossRequired: AMOUNT.toString(),
    leafCount: 1,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_700_000_000n,
    claimPeriod: 2_592_000,
    mode: args.mode,
    state: args.state,
    failedIndexes: args.failedIndexes ?? [],
    createTxHash: `0x${"55".repeat(32)}`,
  });
  if (args.mode === "handle") {
    await handle.db.insert(dropHandleLeaves).values({
      dropAddress: DROP.toLowerCase(),
      leafIndex: 0,
      xUserId: "44196397",
      amount: AMOUNT.toString(),
    });
  }
  await handle.db.insert(dropJobs).values({
    dropAddress: DROP.toLowerCase(),
    kind: args.job,
    state: "ready",
    runAfter: new Date(Number(NOW) * 1000),
  });
  chain.setStatus(DROP, 1);
}

const job = async (kind: string) =>
  (await handle.db.select().from(dropJobs)).find((j) => j.kind === kind);

describe("the EVM adapter can refund", () => {
  it("reports refund and cancel, never close", () => {
    expect(evmAdapterFor(chain).capabilities).toEqual({
      refund: true,
      cancelUnfunded: true,
      close: false,
      handleClaims: true,
    });
  });
});

describe("settle on the EVM", () => {
  it("waits for the claim deadline and sends nothing before it", async () => {
    await seed({ mode: "address", state: "finished", job: "settle", failedIndexes: [0] });
    chain.setClaimDeadline(DROP, FUTURE);
    chain.setBalance(DROP, AMOUNT);
    await worker.tick();
    expect(chain.refunds).toHaveLength(0);
    expect((await job("settle"))?.runAfter.getTime()).toBe(Number(FUTURE + 1n) * 1000);
  });

  it("after the deadline sends one refund, then finds the drop Finalized and stops", async () => {
    await seed({ mode: "address", state: "finished", job: "settle", failedIndexes: [0] });
    chain.setClaimDeadline(DROP, PAST);
    chain.setBalance(DROP, AMOUNT);
    await worker.drain();
    expect(chain.refunds).toEqual([DROP]);
    expect(await chain.getBalance(DROP)).toBe(0n);
    expect(chain.refundedTo(DROP)).toBe(getAddress("0x000000000000000000000000000000000000dEaD"));
    expect((await job("settle"))?.state).toBe("done");
    const [row] = await handle.db.select().from(drops);
    expect(row?.settleTxHash).toMatch(/^0x/);
  });

  it("nothing left means no refund on the EVM, and the job ends", async () => {
    await seed({ mode: "address", state: "finished", job: "settle" });
    chain.setClaimDeadline(DROP, PAST);
    chain.setBalance(DROP, 0n);
    await worker.drain();
    expect(chain.refunds).toHaveLength(0);
    expect((await job("settle"))?.state).toBe("done");
  });

  it("an expired handle drop gets its unclaimed money back by itself", async () => {
    await seed({ mode: "handle", state: "active", job: "claim_handles" });
    chain.setClaimDeadline(DROP, PAST);
    chain.setBalance(DROP, AMOUNT);
    await worker.drain();
    const [row] = await handle.db.select().from(drops);
    expect(row?.state).toBe("claims_expired");
    expect(chain.refunds).toEqual([DROP]);
  });
});
