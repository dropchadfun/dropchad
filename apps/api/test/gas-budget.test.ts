/**
 * The daily gas budget, against a real database.
 *
 * The point of these tests is the ordering: the charge lands **before** the send, so a burst
 * cannot outrun the accounting, and the correction lands after the receipt.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDbGasBudget, utcDay } from "../src/chain/gas-budget.js";
import { GasBudgetExceededError } from "../src/chain/relayer.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { relayerSpend } from "../src/db/schema.js";

const CHAIN_ID = 46630;
const LIMIT = 1_000_000n;

let handle: DatabaseHandle;
let clock = new Date("2026-09-11T10:00:00.000Z");

function budget(limit = LIMIT) {
  return createDbGasBudget({
    db: handle.db,
    chainId: CHAIN_ID,
    dailyLimitWei: limit,
    now: () => clock,
  });
}

async function spentOn(day: string): Promise<bigint> {
  const rows = await handle.db
    .select({ weiSpent: relayerSpend.weiSpent })
    .from(relayerSpend)
    .where(and(eq(relayerSpend.day, day), eq(relayerSpend.chainId, CHAIN_ID)))
    .limit(1);
  return BigInt(rows[0]?.weiSpent ?? "0");
}

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  clock = new Date("2026-09-11T10:00:00.000Z");
});

afterEach(async () => {
  await handle.close();
});

describe("utcDay", () => {
  it("is the UTC calendar day, so the boundary never moves with a server", () => {
    expect(utcDay(new Date("2026-09-11T23:59:59.999Z"))).toBe("2026-09-11");
    expect(utcDay(new Date("2026-09-12T00:00:00.000Z"))).toBe("2026-09-12");
  });
});

describe("reserving", () => {
  it("charges the worst case cost straight away", async () => {
    await budget().reserve(400_000n);
    expect(await spentOn("2026-09-11")).toBe(400_000n);
  });

  it("adds up across sends", async () => {
    const gas = budget();
    await gas.reserve(400_000n);
    await gas.reserve(300_000n);
    expect(await spentOn("2026-09-11")).toBe(700_000n);
  });

  it("refuses the send that would cross the limit, and charges nothing for it", async () => {
    const gas = budget();
    await gas.reserve(900_000n);
    await expect(gas.reserve(200_000n)).rejects.toThrow(GasBudgetExceededError);
    expect(await spentOn("2026-09-11")).toBe(900_000n);
  });

  it("allows a send that lands exactly on the limit", async () => {
    const gas = budget();
    await gas.reserve(LIMIT);
    expect(await spentOn("2026-09-11")).toBe(LIMIT);
  });

  it("starts a fresh allowance on the next UTC day", async () => {
    const gas = budget();
    await gas.reserve(LIMIT);
    clock = new Date("2026-09-12T00:00:01.000Z");
    await gas.reserve(500_000n);
    expect(await spentOn("2026-09-11")).toBe(LIMIT);
    expect(await spentOn("2026-09-12")).toBe(500_000n);
  });

  it("survives a restart, because the day lives in the database and not in memory", async () => {
    await budget().reserve(900_000n);
    // A brand new budget object, as if the process had been restarted.
    await expect(budget().reserve(200_000n)).rejects.toThrow(GasBudgetExceededError);
  });
});

describe("settling", () => {
  it("gives back the difference between the reservation and the real cost", async () => {
    const gas = budget();
    await gas.reserve(400_000n);
    await gas.settle(400_000n, 90_000n);
    expect(await spentOn("2026-09-11")).toBe(90_000n);
  });

  it("gives the whole reservation back when the send never happened", async () => {
    const gas = budget();
    await gas.reserve(400_000n);
    await gas.settle(400_000n, 0n);
    expect(await spentOn("2026-09-11")).toBe(0n);
  });

  it("never takes a day negative when a settle crosses midnight", async () => {
    const gas = budget();
    await gas.reserve(400_000n);
    clock = new Date("2026-09-12T00:00:01.000Z");
    await gas.settle(400_000n, 90_000n);
    expect(await spentOn("2026-09-12")).toBe(0n);
  });
});
