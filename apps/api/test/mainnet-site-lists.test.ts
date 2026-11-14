/**
 * No testnet rows on a mainnet site: the profile drops list, and so
 * its tab count, and `GET /api/me/multisends` leave out the rows of every testnet chain, as the
 * profile totals and the received list already do. A testnet only api lists every row as before.
 * The drop page by address still loads.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { drops, profiles } from "../src/db/schema.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

let harness: Harness;
afterEach(async () => {
  await harness?.close();
});

/** A mainnet site: `SOLANA_CHAIN_KEY` names a mainnet chain. */
const MAINNET_SITE = { env: { SOLANA_CHAIN_KEY: "solana" } };

// The harness X stub signs in as this account, `createXStub`.
const ME = { xUserId: "1234567890", handle: "dropchadfun" };

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);

/** One row per chain: the mainnet chain and the two testnets. */
const CHAINS = [
  { chainKey: "solana", chainId: 101, n: 1 },
  { chainKey: "solana-devnet", chainId: 103, n: 2 },
  { chainKey: "robinhood-testnet", chainId: 46630, n: 3 },
] as const;

const address = (chainKey: string, mode: "address" | "handle", n: number) =>
  chainKey === "robinhood-testnet"
    ? `0x${(mode === "handle" ? 0x700 + n : 0x800 + n).toString(16).padStart(40, "0")}`
    : `${mode === "handle" ? "H" : "M"}${String(n)}${"1".repeat(41)}`;

function row(chain: (typeof CHAINS)[number], mode: "address" | "handle") {
  const evm = chain.chainKey === "robinhood-testnet";
  return {
    address: address(chain.chainKey, mode, chain.n),
    mode,
    chainId: chain.chainId,
    chainKey: chain.chainKey,
    xUserId: ME.xUserId,
    nonce: BigInt(chain.n + (mode === "handle" ? 0 : 10)),
    creatorCommitment: `0x${String(chain.n).padStart(64, mode === "handle" ? "a" : "b")}`,
    salt: `0x${"22".repeat(32)}`,
    asset: evm ? "0x0000000000000000000000000000000000000000" : "11111111111111111111111111111111",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "10000000",
    feeAmount: "0",
    grossRequired: "10000000",
    leafCount: 1,
    refundRecipient: evm
      ? "0x000000000000000000000000000000000000dEaD"
      : "11111111111111111111111111111111",
    fundingDeadline: 1_900_000_000n,
    claimPeriod: 259_200,
    state: "active",
    paidCount: 0,
    createTxHash: `0x${"55".repeat(32)}`,
    createdAt: new Date(T0 + chain.n * 60_000),
  };
}

async function seed(h: Harness) {
  await h.deps.db.insert(profiles).values({
    xUserId: ME.xUserId,
    handle: ME.handle,
    displayName: "dropchad",
    profileImageUrl: null,
  });
  await h.deps.db
    .insert(drops)
    .values([...CHAINS.map((c) => row(c, "handle")), ...CHAINS.map((c) => row(c, "address"))]);
}

const chainsOf = (items: readonly { chainKey?: string; chainId?: number }[]) =>
  items
    .map((item) => item.chainKey ?? CHAINS.find((c) => c.chainId === item.chainId)?.chainKey)
    .sort();

async function profileDrops(h: Harness) {
  const response = await h.app.request(`/api/users/${ME.handle}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { drops: { chainKey?: string; chainId?: number }[] };
  return body.drops;
}

async function myMultisends(h: Harness) {
  const { jar } = await login(h);
  const response = await h.app.request("/api/me/multisends", {
    headers: { cookie: cookieHeader(jar) },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { multisends: { chainKey: string }[] }).multisends;
}

describe("the profile drops list", () => {
  it("a mainnet site: only the mainnet chain's drops, so the tab count is 1", async () => {
    harness = await createHarness(MAINNET_SITE);
    await seed(harness);
    const list = await profileDrops(harness);
    expect(chainsOf(list)).toEqual(["solana"]);
    expect(list).toHaveLength(1);
  });

  it("a testnet only api: every chain, as before", async () => {
    harness = await createHarness();
    await seed(harness);
    expect(chainsOf(await profileDrops(harness))).toEqual(
      ["robinhood-testnet", "solana", "solana-devnet"].sort(),
    );
  });

  it("the received list is built from the same filtered rows as the totals", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "src", "routes", "users.ts"), "utf8");
    expect(src).toMatch(/const rows = await loadBoardRows\(source, everyChain, null\);/);
    expect(src).toMatch(/loadReceived\(\s*\{ \.\.\.source, config \},\s*rows,/);
  });
});

describe("GET /api/me/multisends", () => {
  it("a mainnet site: only the mainnet chain's multisends", async () => {
    harness = await createHarness(MAINNET_SITE);
    await seed(harness);
    expect(chainsOf(await myMultisends(harness))).toEqual(["solana"]);
  });

  it("a testnet only api: every chain, as before", async () => {
    harness = await createHarness();
    await seed(harness);
    expect(chainsOf(await myMultisends(harness))).toEqual(
      ["robinhood-testnet", "solana", "solana-devnet"].sort(),
    );
  });
});

describe("not changed", () => {
  it("a mainnet site: the testnet drop's page by address still answers", async () => {
    harness = await createHarness(MAINNET_SITE);
    await seed(harness);
    const devnet = address("solana-devnet", "handle", 2);
    const response = await harness.app.request(`/api/drops/${devnet}`);
    expect(response.status).not.toBe(404);
  });
});
