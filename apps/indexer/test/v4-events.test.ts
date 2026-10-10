/**
 * the `DropFactoryV4` events in the indexer.,
 * every admin action is public, so `MinFeePerReceiverSet` and `MaxFeeAmountSet`
 * are stored in `admin_events` like `MinFeeAmountSet`. Every V3 handler serves V4 too, and only
 * when the registry has V4 (`HAS_V4`): Ponder refuses a handler for a contract it was not given.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { amountSetRow } from "../src/admin-rows.js";

const TX = `0x${"ab".repeat(32)}` as const;
const BLOCK_HASH = `0x${"cd".repeat(32)}` as const;
const FACTORY = "0x00000000000000000000000000000000000000F4" as const;

function event(oldAmount: bigint, newAmount: bigint) {
  return {
    args: { oldAmount, newAmount },
    log: { address: FACTORY, logIndex: 7 },
    block: { number: 150_000_123n, hash: BLOCK_HASH, timestamp: 1_791_000_000n },
    transaction: { hash: TX },
  };
}

describe("amountSetRow, the admin_events row of the two V4 fee events", () => {
  it.each(["MinFeePerReceiverSet", "MaxFeeAmountSet"] as const)("%s", (kind) => {
    expect(amountSetRow(kind, event(0n, 10n ** 13n))).toEqual({
      id: `${TX}-7`,
      factory: FACTORY,
      kind,
      subject: null,
      previousValue: "0",
      newValue: "10000000000000",
      blockNumber: 150_000_123n,
      blockHash: BLOCK_HASH,
      transactionHash: TX,
      logIndex: 7,
      timestamp: 1_791_000_000n,
    });
  });

  it("keeps wei exact above 2^53", () => {
    const row = amountSetRow("MaxFeeAmountSet", event(2n * 10n ** 16n, 5n * 10n ** 16n));
    expect(row.previousValue).toBe("20000000000000000");
    expect(row.newValue).toBe("50000000000000000");
  });
});

describe("the V4 registrations in src/index.ts", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const registrations = [...source.matchAll(/ponder\.on\("([A-Za-z0-9]+):(\w+)", (\w+)\)/g)].map(
    ([, contract = "", eventName = "", handler = ""]) => ({ contract, eventName, handler }),
  );
  const of = (contract: string) =>
    registrations
      .filter((r) => r.contract === contract)
      .map((r) => `${r.eventName} ${r.handler}`)
      .sort();

  it("every DropFactoryV3 handler serves DropFactoryV4, plus the two new events", () => {
    expect(of("DropFactoryV4")).toEqual(
      [
        ...of("DropFactoryV3"),
        "MinFeePerReceiverSet onMinFeePerReceiverSet",
        "MaxFeeAmountSet onMaxFeeAmountSet",
      ].sort(),
    );
  });

  it("every DropV3 handler serves DropV4, the clones of the same DropV3", () => {
    expect(of("DropV4")).toEqual(of("DropV3"));
    expect(of("DropV4").length).toBeGreaterThan(0);
  });

  it("the two new events only on DropFactoryV4", () => {
    const fee = registrations.filter(
      (r) => r.eventName === "MinFeePerReceiverSet" || r.eventName === "MaxFeeAmountSet",
    );
    expect(fee.map((r) => r.contract)).toEqual(["DropFactoryV4", "DropFactoryV4"]);
  });

  it("the V4 registrations sit inside if (HAS_V4)", () => {
    const block = /if \(HAS_V4\) \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
    const inside = [...block.matchAll(/ponder\.on\("([A-Za-z0-9]+):/g)].map((m) => m[1]);
    const v4 = registrations.filter((r) => r.contract.endsWith("V4"));
    expect(inside.length).toBe(v4.length);
    expect(new Set(inside)).toEqual(new Set(["DropFactoryV4", "DropV4"]));
  });
});
