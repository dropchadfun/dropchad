/**
 * The `DropFactoryV6` and `DropV6` events in the indexer.
 * every `DropFactoryV5` handler serves `DropFactoryV6`, plus `PauseGuardianSet` as an admin event;
 * every `DropV5` handler serves `DropV6`, `NativeReturnFailed` and the `Swept` that clears the
 * waiting ETH included. On a `DropV6` native drop the `native_waiting` row is the whole refund.
 * Only when the registry has V6 (`HAS_V6`), and the V1 handlers only when it has V1 (`HAS_V1`):
 * Ponder refuses a handler for a contract it was not given, and a V6 only chain has no V1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as adminRows from "../src/admin-rows.js";
import { nativeWaitingRow, sweepsWaitingEth } from "../src/native-waiting.js";

const TX = `0x${"ab".repeat(32)}` as const;
const BLOCK_HASH = `0x${"cd".repeat(32)}` as const;
const DROP = "0x00000000000000000000000000000000000000D6" as const;
const FACTORY = "0x00000000000000000000000000000000000000F6" as const;
const REFUSER = "0x00000000000000000000000000000000000000aa" as const;
const OLD_GUARDIAN = "0x0000000000000000000000000000000000000000" as const;
const NEW_GUARDIAN = "0x00000000000000000000000000000000000000Ce" as const;

describe("a DropV6 native drop whose refund address refused the ETH", () => {
  it("one native_waiting row with the whole refund, not swept yet", () => {
    const row = nativeWaitingRow({
      args: { to: REFUSER, amount: 50_000_000_000_000_000n },
      log: { address: DROP, logIndex: 3 },
      block: { number: 140_000_100n, hash: BLOCK_HASH, timestamp: 1_793_000_000n },
      transaction: { hash: TX },
    });
    expect(row).toMatchObject({
      drop: DROP,
      to: REFUSER,
      amount: 50_000_000_000_000_000n,
      swept: false,
      sweptTransactionHash: null,
    });
  });

  it("only a sweep of address(0) clears it", () => {
    expect(sweepsWaitingEth({ token: "0x0000000000000000000000000000000000000000" })).toBe(true);
    expect(sweepsWaitingEth({ token: "0x00000000000000000000000000000000000007e5" })).toBe(false);
  });
});

describe("pauseGuardianSetRow, the admin_events row of PauseGuardianSet", () => {
  it("kind PauseGuardianSet, the old and the new guardian, no subject", () => {
    const pauseGuardianSetRow = (
      adminRows as unknown as Record<string, ((event: unknown) => unknown) | undefined>
    )["pauseGuardianSetRow"];
    expect(typeof pauseGuardianSetRow).toBe("function");
    const row = pauseGuardianSetRow?.({
      args: { oldGuardian: OLD_GUARDIAN, newGuardian: NEW_GUARDIAN },
      log: { address: FACTORY, logIndex: 4 },
      block: { number: 140_000_200n, hash: BLOCK_HASH, timestamp: 1_793_000_100n },
      transaction: { hash: TX },
    });
    expect(row).toEqual({
      id: `${TX}-4`,
      factory: FACTORY,
      kind: "PauseGuardianSet",
      subject: null,
      previousValue: OLD_GUARDIAN,
      newValue: NEW_GUARDIAN,
      blockNumber: 140_000_200n,
      blockHash: BLOCK_HASH,
      transactionHash: TX,
      logIndex: 4,
      timestamp: 1_793_000_100n,
    });
  });
});

describe("the V6 registrations in src/index.ts", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const registrations = [...source.matchAll(/ponder\.on\("([A-Za-z0-9]+):(\w+)", (\w+)\)/g)].map(
    ([, contract = "", eventName = "", handler = ""]) => ({ contract, eventName, handler }),
  );
  const of = (contract: string) =>
    registrations
      .filter((r) => r.contract === contract)
      .map((r) => `${r.eventName} ${r.handler}`)
      .sort();
  const inside = (flag: string) => {
    const block = new RegExp(`if \\(${flag}\\) \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? "";
    return [...block.matchAll(/ponder\.on\("([A-Za-z0-9]+):/g)].map((m) => m[1]);
  };

  it("every DropFactoryV5 handler serves DropFactoryV6, plus PauseGuardianSet", () => {
    expect(of("DropFactoryV5").length).toBeGreaterThan(0);
    expect(of("DropFactoryV6")).toEqual(
      [...of("DropFactoryV5"), "PauseGuardianSet onPauseGuardianSet"].sort(),
    );
  });

  it("every DropV5 handler serves DropV6, NativeReturnFailed and onSweptV5 included", () => {
    expect(of("DropV6")).toEqual(of("DropV5"));
    expect(of("DropV6")).toContain("NativeReturnFailed onNativeReturnFailed");
    expect(of("DropV6")).toContain("Swept onSweptV5");
  });

  it("PauseGuardianSet only on DropFactoryV6 and DropFactoryV7, the same factory code", () => {
    const set = registrations.filter((r) => r.eventName === "PauseGuardianSet");
    expect(set.map((r) => r.contract)).toEqual(["DropFactoryV6", "DropFactoryV7"]);
  });

  it("the V6 registrations sit inside if (HAS_V6)", () => {
    const v6 = registrations.filter((r) => r.contract.endsWith("V6"));
    expect(v6.length).toBeGreaterThan(0);
    expect(inside("HAS_V6").length).toBe(v6.length);
    expect(new Set(inside("HAS_V6"))).toEqual(new Set(["DropFactoryV6", "DropV6"]));
  });

  it("the V1 registrations sit inside if (HAS_V1): a V6 only chain has no V1", () => {
    const v1 = registrations.filter((r) => r.contract.endsWith("V1"));
    expect(v1.length).toBeGreaterThan(0);
    expect(inside("HAS_V1").length).toBe(v1.length);
    expect(new Set(inside("HAS_V1"))).toEqual(new Set(["DropFactoryV1", "DropV1"]));
  });
});

describe("the V6 contracts in ponder.config.ts", () => {
  const config = readFileSync(join(import.meta.dirname, "..", "ponder.config.ts"), "utf8");

  it("DropV6 decodes with dropV6Abi, the clones of the V6 factory", () => {
    const block = /DropV6: \{([\s\S]*?)\n {8}\},/.exec(config)?.[1] ?? "";
    expect(block).toMatch(/abi: dropV6Abi/);
    expect(block).toMatch(/address: V6\.factory/);
  });

  it("DropFactoryV6 decodes with dropFactoryV6Abi, pinned to the V6 factory", () => {
    const block = /DropFactoryV6: \{([\s\S]*?)\n {8}\},/.exec(config)?.[1] ?? "";
    expect(block).toMatch(/abi: dropFactoryV6Abi/);
    expect(block).toMatch(/address: V6\.factory/);
  });

  it("V1 is no longer taken as the first factory: it is looked up by name like the others", () => {
    expect(config).not.toMatch(/FACTORIES\[0\]/);
    const block = /DropFactoryV1: \{([\s\S]*?)\n {8}\},/.exec(config)?.[1] ?? "";
    expect(block).toMatch(/address: V1\.factory/);
  });
});
