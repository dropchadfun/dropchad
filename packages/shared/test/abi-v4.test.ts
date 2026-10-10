/**
 * the full `DropFactoryV4` ABI. Generated from
 * the foundry build like every other ABI here (`npm run sync:abi`). V4 is V3 plus the fee:
 * every V3 item is in it unchanged, so the indexer and the relayer decode V4 with the V3 shapes,
 * plus the two views, the two setters and the two events.
 */
import { describe, expect, it } from "vitest";

import { dropFactoryV3Abi, dropFactoryV4Abi } from "../src/index.js";

type AbiItem = { readonly type: string; readonly name?: string };

function item(abi: readonly AbiItem[], type: string, name: string) {
  return abi.find((entry) => entry.type === type && entry.name === name);
}

describe("dropFactoryV4Abi", () => {
  it("is exported from packages/shared", () => {
    expect(Array.isArray(dropFactoryV4Abi)).toBe(true);
  });

  it("carries every DropFactoryV3 item unchanged, DropCreated and createDrop included", () => {
    for (const entry of dropFactoryV3Abi as readonly AbiItem[]) {
      expect(dropFactoryV4Abi, `${entry.type} ${entry.name ?? ""}`).toContainEqual(entry);
    }
    expect(item(dropFactoryV4Abi, "event", "DropCreated")).toEqual(
      item(dropFactoryV3Abi, "event", "DropCreated"),
    );
  });

  it.each(["MinFeePerReceiverSet", "MaxFeeAmountSet"])(
    "has the event %s(uint256 oldAmount, uint256 newAmount)",
    (name) => {
      expect(item(dropFactoryV4Abi, "event", name)).toEqual({
        type: "event",
        name,
        inputs: [
          { name: "oldAmount", type: "uint256", indexed: false, internalType: "uint256" },
          { name: "newAmount", type: "uint256", indexed: false, internalType: "uint256" },
        ],
        anonymous: false,
      });
    },
  );

  it.each(["minFeePerReceiver", "maxFeeAmount", "MAX_MIN_FEE_PER_RECEIVER"])(
    "has the view %s() returning uint256",
    (name) => {
      const fn = item(dropFactoryV4Abi, "function", name) as
        { stateMutability: string; inputs: unknown[]; outputs: { type: string }[] } | undefined;
      expect(fn?.stateMutability).toBe("view");
      expect(fn?.inputs).toEqual([]);
      expect(fn?.outputs.map((o) => o.type)).toEqual(["uint256"]);
    },
  );

  it.each(["setMinFeePerReceiver", "setMaxFeeAmount"])("has the setter %s(uint256)", (name) => {
    const fn = item(dropFactoryV4Abi, "function", name) as
      { stateMutability: string; inputs: { type: string }[] } | undefined;
    expect(fn?.stateMutability).toBe("nonpayable");
    expect(fn?.inputs.map((i) => i.type)).toEqual(["uint256"]);
  });
});
