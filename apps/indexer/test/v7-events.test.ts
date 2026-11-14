/**
 * The `DropFactoryV7` and `DropV7` events in the indexer: every
 * `DropFactoryV6` handler serves `DropFactoryV7` and every `DropV6` handler serves `DropV7`; the
 * events are the same, so no new handler and no new table. Only when the registry has V7
 * (`HAS_V7`): Ponder refuses a handler for a contract it was not given.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("the V7 registrations in src/index.ts", () => {
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

  it("every DropFactoryV6 handler serves DropFactoryV7, PauseGuardianSet included", () => {
    expect(of("DropFactoryV6").length).toBeGreaterThan(0);
    expect(of("DropFactoryV7")).toEqual(of("DropFactoryV6"));
    expect(of("DropFactoryV7")).toContain("PauseGuardianSet onPauseGuardianSet");
  });

  it("every DropV6 handler serves DropV7, NativeReturnFailed and HandleClaimed included", () => {
    expect(of("DropV7")).toEqual(of("DropV6"));
    expect(of("DropV7")).toContain("NativeReturnFailed onNativeReturnFailed");
    expect(of("DropV7")).toContain("HandleClaimed onHandleClaimed");
    expect(of("DropV7")).toContain("Swept onSweptV5");
  });

  it("the V7 registrations sit inside if (HAS_V7)", () => {
    const v7 = registrations.filter((r) => r.contract.endsWith("V7"));
    expect(v7.length).toBeGreaterThan(0);
    expect(inside("HAS_V7").length).toBe(v7.length);
    expect(new Set(inside("HAS_V7"))).toEqual(new Set(["DropFactoryV7", "DropV7"]));
  });
});

describe("the V7 contracts in ponder.config.ts", () => {
  const config = readFileSync(join(import.meta.dirname, "..", "ponder.config.ts"), "utf8");

  it("DropV7 decodes with dropV7Abi, the clones of the V7 factory", () => {
    const block = /DropV7: \{([\s\S]*?)\n {8}\},/.exec(config)?.[1] ?? "";
    expect(block).toMatch(/abi: dropV7Abi/);
    expect(block).toMatch(/address: V7\.factory/);
  });

  it("DropFactoryV7 decodes with dropFactoryV7Abi, pinned to the V7 factory", () => {
    const block = /DropFactoryV7: \{([\s\S]*?)\n {8}\},/.exec(config)?.[1] ?? "";
    expect(block).toMatch(/abi: dropFactoryV7Abi/);
    expect(block).toMatch(/address: V7\.factory/);
  });
});
