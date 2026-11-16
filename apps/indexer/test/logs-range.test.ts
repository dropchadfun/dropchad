/**
 * The eth_getLogs block range. The public Robinhood testnet RPC refuses a range over 100,000
 * blocks; Ponder's own guess sent 100,001 and the indexer crashed about every 20 minutes on the
 * server. Ponder 0.17.10 takes `ethGetLogsBlockRange` on the chain entry.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findChain } from "@dropchad/chains";
import { describe, expect, it } from "vitest";

import { ethGetLogsBlockRangeFor } from "../src/logs-range.js";

/** Measured on the public Robinhood mainnet RPC. */
const MAINNET_LIMIT_WITH_ADDRESS = 10_000_000;
const MAINNET_LIMIT_WITHOUT_ADDRESS = 30_000;

describe("ethGetLogsBlockRangeFor", () => {
  it("is 50,000 on Robinhood testnet, half the RPC's limit of 100,000", () => {
    const range = ethGetLogsBlockRangeFor("robinhood-testnet");
    expect(range).toBe(50_000);
    expect(range).toBeLessThanOrEqual(100_000 / 2);
  });

  it("is 15,000 on Robinhood mainnet", () => {
    expect(ethGetLogsBlockRangeFor("robinhood")).toBe(15_000);
  });

  it("is at most half of the 30,000 limit without an address on mainnet", () => {
    // From 1,000 child drops Ponder asks by topic alone, so the smaller limit rules.
    const range = ethGetLogsBlockRangeFor("robinhood") ?? Infinity;
    expect(range).toBeLessThanOrEqual(MAINNET_LIMIT_WITHOUT_ADDRESS / 2);
    expect(range).toBeLessThan(MAINNET_LIMIT_WITH_ADDRESS);
  });

  it("names only real EVM chains of the registry", () => {
    for (const key of ["robinhood", "robinhood-testnet"]) {
      expect(findChain(key)?.family, key).toBe("evm");
    }
  });

  it("is undefined on any other chain, so Ponder finds the range itself", () => {
    expect(ethGetLogsBlockRangeFor("anvil")).toBeUndefined();
    expect(ethGetLogsBlockRangeFor("")).toBeUndefined();
    expect(ethGetLogsBlockRangeFor("solana")).toBeUndefined();
    expect(ethGetLogsBlockRangeFor("solana-devnet")).toBeUndefined();
  });
});

describe("the chain entry in ponder.config.ts", () => {
  const config = readFileSync(join(import.meta.dirname, "..", "ponder.config.ts"), "utf8");

  it("passes the range for the indexed chain", () => {
    expect(config).toMatch(/const LOGS_RANGE = ethGetLogsBlockRangeFor\(chain\.key\);/);
    const block = /dropchad: \{([\s\S]*?)\n {4}\},/.exec(config)?.[1] ?? "";
    expect(block).toMatch(/ethGetLogsBlockRange: LOGS_RANGE/);
  });
});
