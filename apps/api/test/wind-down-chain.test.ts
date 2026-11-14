/**
 * The chain wind down script: the open jobs of one testnet chain
 * set to `failed` with the reason `wound down `, a dry run first that writes nothing,
 * refused for a mainnet chain, an unknown key and while something holds the api port.
 */
import { createServer } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dropJobs, drops, profiles } from "../src/db/schema.js";
import {
  WindDownError,
  apiPortBusy,
  checkWindDownChain,
  windDownChain,
  windDownCounts,
} from "../src/ops/wind-down.js";
import { createHarness, type Harness } from "./harness.js";

let h: Harness;
const NOW = new Date("2026-11-14T10:00:00Z");

async function seedDrop(address: string, chainKey: string, chainId: number, state: string) {
  await h.handle.db.insert(drops).values({
    address,
    chainId,
    chainKey,
    xUserId: "1",
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "1",
    feeAmount: "0",
    grossRequired: "1",
    leafCount: 1,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    mode: "address",
    state,
    createTxHash: `0x${"55".repeat(32)}`,
  });
}

async function seedJob(address: string, kind: string, state: string) {
  await h.handle.db.insert(dropJobs).values({ dropAddress: address, kind, state, runAfter: NOW });
}

async function jobRows() {
  return (await h.handle.db.select().from(dropJobs)).map((row) => ({
    drop: row.dropAddress,
    kind: row.kind,
    state: row.state,
    lastError: row.lastError,
  }));
}

beforeEach(async () => {
  h = await createHarness();
  await h.handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
  await seedDrop("devnet-a", "solana-devnet", 103, "active");
  await seedDrop("devnet-b", "solana-devnet", 103, "funded");
  await seedDrop("devnet-c", "solana-devnet", 103, "finished");
  await seedDrop("0xrobin", "robinhood-testnet", 46630, "active");
  await seedJob("devnet-a", "pay", "ready");
  await seedJob("devnet-b", "activate", "running");
  await seedJob("devnet-c", "settle", "done");
  await seedJob("devnet-a", "watch_funding", "failed");
  await seedJob("0xrobin", "pay", "ready");
});

afterEach(async () => {
  await h.close();
});

describe("the chain check", () => {
  it("takes a testnet chain", () => {
    expect(checkWindDownChain("solana-devnet").key).toBe("solana-devnet");
  });

  it("refuses a mainnet chain and an unknown key", () => {
    expect(() => checkWindDownChain("solana")).toThrow(WindDownError);
    expect(() => checkWindDownChain("solana")).toThrow(/not a testnet chain/);
    expect(() => checkWindDownChain("nochain")).toThrow(/not in the registry/);
  });
});

describe("the dry run", () => {
  it("counts the drops by state and the open jobs by kind, and writes nothing", async () => {
    const before = await jobRows();
    const counts = await windDownCounts(h.handle.db, "solana-devnet");
    expect(counts).toEqual({
      chain: "solana-devnet",
      drops: { active: 1, finished: 1, funded: 1 },
      openJobs: { activate: 1, pay: 1 },
    });
    expect(await jobRows()).toEqual(before);
  });
});

describe("the real run", () => {
  it("sets only that chain's open jobs to failed, with the reason", async () => {
    const result = await windDownChain(h.handle.db, "solana-devnet", NOW);
    expect(result.closed).toBe(2);
    const rows = await jobRows();
    const byKey = (drop: string, kind: string) =>
      rows.find((row) => row.drop === drop && row.kind === kind);
    expect(byKey("devnet-a", "pay")).toMatchObject({
      state: "failed",
      lastError: "wound down",
    });
    expect(byKey("devnet-b", "activate")).toMatchObject({
      state: "failed",
      lastError: "wound down",
    });
    // A done or already failed job and the other chain are untouched.
    expect(byKey("devnet-c", "settle")).toMatchObject({ state: "done", lastError: null });
    expect(byKey("devnet-a", "watch_funding")).toMatchObject({ state: "failed", lastError: null });
    expect(byKey("0xrobin", "pay")).toMatchObject({ state: "ready", lastError: null });
    // No drop row changes.
    const states = (await h.handle.db.select().from(drops)).map((row) => [row.address, row.state]);
    expect(states.sort()).toEqual([
      ["0xrobin", "active"],
      ["devnet-a", "active"],
      ["devnet-b", "funded"],
      ["devnet-c", "finished"],
    ]);
    expect((await windDownCounts(h.handle.db, "solana-devnet")).openJobs).toEqual({});
  });
});

describe("the api port", () => {
  it("is busy while something listens on it, free after", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    expect(await apiPortBusy(port)).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await apiPortBusy(port)).toBe(false);
  });
});
