/**
 * The `DropFactoryV5` and `DropV5` events in the indexer.
 * every V4 factory handler serves `DropFactoryV5`, every V3 drop handler serves `DropV5`, and the
 * indexer **stores `NativeReturnFailed`**: one `native_waiting` row per drop, marked swept by a
 * later `Swept` of `address(0)` on that drop. So a drop with ETH waiting for a sweep can be found.
 * Only when the registry has V5 (`HAS_V5`): Ponder refuses a handler for a contract it was not
 * given.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { nativeWaitingRow, sweepsWaitingEth } from "../src/native-waiting.js";

const TX = `0x${"ab".repeat(32)}` as const;
const BLOCK_HASH = `0x${"cd".repeat(32)}` as const;
const DROP = "0x00000000000000000000000000000000000000D5" as const;
const WALLET = "0x00000000000000000000000000000000000000aa" as const;

describe("nativeWaitingRow, the native_waiting row of NativeReturnFailed", () => {
  it("one row per drop, not swept yet", () => {
    const row = nativeWaitingRow({
      args: { to: WALLET, amount: 2_000_000_000_000_000n },
      log: { address: DROP, logIndex: 9 },
      block: { number: 134_700_000n, hash: BLOCK_HASH, timestamp: 1_792_000_000n },
      transaction: { hash: TX },
    });
    expect(row).toEqual({
      drop: DROP,
      to: WALLET,
      amount: 2_000_000_000_000_000n,
      swept: false,
      sweptTransactionHash: null,
      blockNumber: 134_700_000n,
      blockHash: BLOCK_HASH,
      transactionHash: TX,
      logIndex: 9,
      timestamp: 1_792_000_000n,
    });
  });
});

describe("sweepsWaitingEth, which Swept clears the waiting ETH", () => {
  it("a sweep of address(0), the native coin, does", () => {
    expect(sweepsWaitingEth({ token: "0x0000000000000000000000000000000000000000" })).toBe(true);
  });

  it("a sweep of a stray token does not", () => {
    expect(sweepsWaitingEth({ token: "0x00000000000000000000000000000000000007e5" })).toBe(false);
  });
});

describe("the native_waiting table in ponder.schema.ts", () => {
  const schema = readFileSync(join(import.meta.dirname, "..", "ponder.schema.ts"), "utf8");

  it("exists as nativeWaiting, keyed by the drop", () => {
    expect(schema).toMatch(/export const nativeWaiting = onchainTable\(\s*"native_waiting"/);
    const body = /"native_waiting",([\s\S]*?)\n\);/.exec(schema)?.[1] ?? "";
    expect(body).toMatch(/drop: t\.hex\(\)\.primaryKey\(\)/);
    for (const column of [
      "to",
      "amount",
      "swept",
      "sweptTransactionHash",
      "blockNumber",
      "blockHash",
      "transactionHash",
      "logIndex",
      "timestamp",
      "finality",
    ]) {
      expect(body, column).toMatch(new RegExp(`\\b${column}: t\\.`));
    }
  });
});

describe("the V5 registrations in src/index.ts", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const registrations = [...source.matchAll(/ponder\.on\("([A-Za-z0-9]+):(\w+)", (\w+)\)/g)].map(
    ([, contract = "", eventName = "", handler = ""]) => ({ contract, eventName, handler }),
  );
  const of = (contract: string) =>
    registrations
      .filter((r) => r.contract === contract)
      .map((r) => `${r.eventName} ${r.handler}`)
      .sort();

  it("every DropFactoryV4 handler serves DropFactoryV5, nothing more", () => {
    expect(of("DropFactoryV5")).toEqual(of("DropFactoryV4"));
    expect(of("DropFactoryV5").length).toBeGreaterThan(0);
  });

  it("every DropV3 handler serves DropV5; Swept also clears the waiting ETH; plus NativeReturnFailed", () => {
    const v3 = of("DropV3").map((r) => (r === "Swept onSwept" ? "Swept onSweptV5" : r));
    expect(of("DropV5")).toEqual([...v3, "NativeReturnFailed onNativeReturnFailed"].sort());
  });

  it("NativeReturnFailed only on DropV5", () => {
    const failed = registrations.filter((r) => r.eventName === "NativeReturnFailed");
    expect(failed.map((r) => r.contract)).toEqual(["DropV5"]);
  });

  it("the V5 registrations sit inside if (HAS_V5)", () => {
    const block = /if \(HAS_V5\) \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
    const inside = [...block.matchAll(/ponder\.on\("([A-Za-z0-9]+):/g)].map((m) => m[1]);
    const v5 = registrations.filter((r) => r.contract.endsWith("V5"));
    expect(inside.length).toBe(v5.length);
    expect(new Set(inside)).toEqual(new Set(["DropFactoryV5", "DropV5"]));
  });
});

describe("the V5 contracts in ponder.config.ts", () => {
  const config = readFileSync(join(import.meta.dirname, "..", "ponder.config.ts"), "utf8");

  it("DropV5 decodes with dropV5Abi, so NativeReturnFailed is known", () => {
    const block = /DropV5: \{([\s\S]*?)\n {8}\},/.exec(config)?.[1] ?? "";
    expect(block).toMatch(/abi: dropV5Abi/);
    expect(block).toMatch(/address: V5\.factory/);
  });

  it("DropFactoryV5 decodes with dropFactoryV5Abi, pinned to the V5 factory", () => {
    const block = /DropFactoryV5: \{([\s\S]*?)\n {8}\},/.exec(config)?.[1] ?? "";
    expect(block).toMatch(/abi: dropFactoryV5Abi/);
    expect(block).toMatch(/address: V5\.factory/);
  });
});
