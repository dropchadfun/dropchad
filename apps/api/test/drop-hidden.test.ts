/**
 * A handle drop that never went live is hidden. Never live is our state
 * `funding_expired`, or `created` past its funding deadline; without a row of ours, the indexer's
 * `Cancelled`, or `Created` past its deadline. It is on no list; its page, share card and live
 * stream are `404`. Only its page opens when its cancel returned coins. Multisends unchanged.
 */
import { afterEach, describe, expect, it } from "vitest";

import { countHandleDrops } from "../src/boards/load.js";
import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { eventDiscriminator } from "../src/chain/svm/accounts.js";
import {
  DEFAULT_PUBKEY_BASE58,
  pubkeyFromBase58,
  pubkeyToBase58,
  type Pubkey,
} from "../src/chain/svm/pubkey.js";
import { createSvmReader } from "../src/chain/svm/reader.js";
import type { SvmRpc, TransactionMeta } from "../src/chain/svm/rpc.js";
import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV } from "./test-binders.js";

let harness: Harness;

afterEach(async () => {
  await harness?.close();
});

const NOW = new Date("2026-11-01T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);
const PAST = BigInt(SECONDS - 60);
const LATER = BigInt(SECONDS + 3_600);

/** The receiver, signed in for the claim list. */
const ME = { id: "44196397", username: "bob", name: "bob" };

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

interface Case {
  readonly n: number;
  readonly state: string;
  readonly fundingDeadline: bigint;
  readonly mode?: "address" | "handle";
  readonly settleTxHash?: string;
  /** The indexer's side; absent means the indexer has not seen it. */
  readonly chain?: { status: string; refunded: string };
}

/** The EVM drops, each its own case. */
const LIVE: Case = {
  n: 1,
  state: "active",
  fundingDeadline: PAST,
  chain: { status: "Active", refunded: "0" },
};
const EMPTY: Case = {
  n: 2,
  state: "funding_expired",
  fundingDeadline: PAST,
  chain: { status: "Created", refunded: "0" },
};
const PART_FUNDED: Case = {
  n: 3,
  state: "funding_expired",
  fundingDeadline: PAST,
  settleTxHash: `0x${"aa".repeat(32)}`,
  chain: { status: "Cancelled", refunded: "4000000000000000" },
};
const WAITING_PAST: Case = {
  n: 4,
  state: "created",
  fundingDeadline: PAST,
  chain: { status: "Created", refunded: "0" },
};
const WAITING: Case = {
  n: 5,
  state: "created",
  fundingDeadline: LATER,
  chain: { status: "Created", refunded: "0" },
};
const FUNDED_PAST: Case = {
  n: 6,
  state: "funded",
  fundingDeadline: PAST,
  chain: { status: "Created", refunded: "0" },
};
const CLAIMS_ENDED: Case = {
  n: 7,
  state: "claims_expired",
  fundingDeadline: PAST,
  chain: { status: "Active", refunded: "0" },
};
const MULTISEND: Case = {
  n: 8,
  state: "funding_expired",
  fundingDeadline: PAST,
  mode: "address",
  chain: { status: "Created", refunded: "0" },
};
const CANCELLED_BY_OTHERS: Case = {
  n: 9,
  state: "funding_expired",
  fundingDeadline: PAST,
  chain: { status: "Cancelled", refunded: "1000" },
};
const CASES = [
  LIVE,
  EMPTY,
  PART_FUNDED,
  WAITING_PAST,
  WAITING,
  FUNDED_PAST,
  CLAIMS_ENDED,
  MULTISEND,
  CANCELLED_BY_OTHERS,
];
const SHOWN = [LIVE, WAITING, FUNDED_PAST, CLAIMS_ENDED];
const HIDDEN = [EMPTY, PART_FUNDED, WAITING_PAST, CANCELLED_BY_OTHERS];

/** Drops only the indexer knows, never made through our api. */
const CHAIN_ONLY = {
  emptyCancelled: { n: 20, status: "Cancelled", refunded: "0", fundingDeadline: PAST },
  createdPast: { n: 21, status: "Created", refunded: "0", fundingDeadline: PAST },
  coinsBack: { n: 22, status: "Cancelled", refunded: "1000", fundingDeadline: PAST },
  active: { n: 23, status: "Active", refunded: "0", fundingDeadline: PAST },
} as const;

const indexed = (
  n: number,
  side: { status: string; refunded: string },
  fundingDeadline: bigint,
) => ({
  address: addr(0x1000 + n),
  chainId: 46630,
  status: side.status,
  refunded: side.refunded,
  fundingDeadline: fundingDeadline.toString(),
  activatedAt: side.status === "Active" ? String(SECONDS - 3_000) : null,
  totalEntitlements: "10000000000000000",
  leafCount: 3,
  claimedCount: 0,
  createdAt: String(SECONDS - n * 60),
  finality: "final",
  statusFinality: "final",
  verified: true,
});

const evmRow = (c: Case) => ({
  address: addr(0x1000 + c.n),
  mode: c.mode ?? "handle",
  chainId: 46630,
  chainKey: "robinhood-testnet",
  xUserId: "1",
  nonce: BigInt(c.n),
  creatorCommitment: `0x${(0x1000 + c.n).toString(16).padStart(64, "0")}`,
  salt: `0x${"22".repeat(32)}`,
  asset: "0x0000000000000000000000000000000000000000",
  merkleRoot: `0x${"33".repeat(32)}`,
  manifestHash: `0x${"44".repeat(32)}`,
  manifestJson: "{}",
  totalEntitlements: "10000000000000000",
  feeAmount: "0",
  grossRequired: "10000000000000000",
  leafCount: 3,
  refundRecipient: "0x000000000000000000000000000000000000dEaD",
  fundingDeadline: c.fundingDeadline,
  claimPeriod: 259_200,
  state: c.state,
  settleTxHash: c.settleTxHash ?? null,
  createTxHash: `0x${"55".repeat(32)}`,
  createdAt: new Date(NOW.getTime() - c.n * 60_000),
});

async function world(): Promise<void> {
  const byAddress: Record<string, unknown> = {};
  for (const c of CASES) {
    if (c.chain !== undefined)
      byAddress[addr(0x1000 + c.n)] = indexed(c.n, c.chain, c.fundingDeadline);
  }
  for (const c of Object.values(CHAIN_ONLY)) {
    byAddress[addr(0x1000 + c.n)] = indexed(c.n, c, c.fundingDeadline);
  }
  // A ready chain, so the claim list reads its drops instead of leaving the chain out.
  const evm: ChainAdapter = {
    ...evmAdapterFor(createFakeChain()),
    handleModeReady: () => Promise.resolve(true),
  };
  harness = await createHarness({
    indexer: { dropsByAddress: byAddress },
    writeSides: adaptersFrom([evm], evm.chainKey),
    env: { ...TEST_BINDER_ENV },
    user: ME,
  });
  harness.setNow(NOW);
  await harness.deps.db.insert(profiles).values([
    { xUserId: "1", handle: "alice", displayName: "Alice", profileImageUrl: null },
    { xUserId: ME.id, handle: ME.username, displayName: ME.name, profileImageUrl: null },
  ]);
  await harness.deps.db.insert(drops).values(CASES.map(evmRow));
  await harness.deps.db.insert(dropHandleLeaves).values(
    CASES.filter((c) => (c.mode ?? "handle") === "handle").map((c) => ({
      dropAddress: addr(0x1000 + c.n),
      leafIndex: 0,
      xUserId: ME.id,
      amount: "10000000000000000",
    })),
  );
}

const numbersOf = (addresses: readonly string[]) =>
  addresses.map((a) => Number.parseInt(a.slice(-4), 16) - 0x1000).sort((a, b) => a - b);
const numbers = (cases: readonly Case[]) => cases.map((c) => c.n).sort((a, b) => a - b);

async function status(path: string, cookie?: string): Promise<number> {
  const response = await harness.app.request(
    path,
    cookie === undefined ? {} : { headers: { cookie } },
  );
  await response.body?.cancel();
  return response.status;
}

describe("hidden from every list", () => {
  it("GET /api/drops, the latest and live tabs: never live drops are left out", async () => {
    await world();
    const response = await harness.app.request("/api/drops?chain=all");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { drops: { address: string }[] };
    expect(numbersOf(body.drops.map((d) => d.address))).toEqual(numbers(SHOWN));
  });

  it("GET /api/drops?page=: left out of the page and of the total", async () => {
    await world();
    const response = await harness.app.request("/api/drops?page=1&chain=all");
    const body = (await response.json()) as { total: number; drops: { address: string }[] };
    expect(body.total).toBe(SHOWN.length);
    expect(numbersOf(body.drops.map((d) => d.address))).toEqual(numbers(SHOWN));
  });

  it("the profile drops leave them out", async () => {
    await world();
    const response = await harness.app.request("/api/users/alice");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { drops: { address: string }[] };
    expect(numbersOf(body.drops.map((d) => d.address))).toEqual(numbers(SHOWN));
  });

  it("the claim list leaves them out", async () => {
    await world();
    const { jar } = await login(harness);
    harness.setNow(NOW);
    const response = await harness.app.request("/api/claims", {
      headers: { cookie: cookieHeader(jar) },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      claims: { drop: string }[];
      unavailable: string[];
    };
    expect(body.unavailable).toEqual([]);
    const listed = body.claims.map((c) => c.drop.toLowerCase());
    for (const c of HIDDEN) expect(listed, String(c.n)).not.toContain(addr(0x1000 + c.n));
    for (const c of SHOWN) expect(listed, String(c.n)).toContain(addr(0x1000 + c.n));
  });

  it("the boards never count a funding_expired row, even with claimed leaves", async () => {
    await world();
    const counted = await countHandleDrops(
      harness.deps.db,
      [LIVE, PART_FUNDED].map((c) => ({
        address: addr(0x1000 + c.n),
        creatorCommitment: `0x${(0x1000 + c.n).toString(16).padStart(64, "0")}`,
        createdAt: String(SECONDS - c.n * 60),
        claimedFinalWei: "10000000000000000",
        claimedCountFinal: 1,
        recipients: ["0x1111111111111111111111111111111111110001"],
        claimedIndexes: [0],
      })),
      "robinhood-testnet",
    );
    expect(numbersOf(counted.map((d) => d.address))).toEqual([LIVE.n]);
  });
});

describe("the drop page, GET /api/drops/:address", () => {
  it("a drop with no coins at all is not found", async () => {
    await world();
    for (const c of [EMPTY, WAITING_PAST]) {
      const response = await harness.app.request(`/api/drops/${addr(0x1000 + c.n)}`);
      expect(response.status, String(c.n)).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("a cancelled drop whose coins went back still opens", async () => {
    await world();
    for (const c of [PART_FUNDED, CANCELLED_BY_OTHERS]) {
      expect(await status(`/api/drops/${addr(0x1000 + c.n)}`), String(c.n)).toBe(200);
    }
  });

  it("drops that went live, wait for money or wait for the hourly check still open", async () => {
    await world();
    for (const c of [...SHOWN, MULTISEND]) {
      expect(await status(`/api/drops/${addr(0x1000 + c.n)}`), String(c.n)).toBe(200);
    }
  });

  it("without a row of ours: Cancelled with nothing back or Created past its deadline is not found", async () => {
    await world();
    expect(await status(`/api/drops/${addr(0x1000 + CHAIN_ONLY.emptyCancelled.n)}`)).toBe(404);
    expect(await status(`/api/drops/${addr(0x1000 + CHAIN_ONLY.createdPast.n)}`)).toBe(404);
    expect(await status(`/api/drops/${addr(0x1000 + CHAIN_ONLY.coinsBack.n)}`)).toBe(200);
    expect(await status(`/api/drops/${addr(0x1000 + CHAIN_ONLY.active.n)}`)).toBe(200);
  });
});

describe("the share card and the live stream", () => {
  it("are not found for every never live drop, coins back or not", async () => {
    await world();
    for (const c of HIDDEN) {
      for (const door of ["share", "live"]) {
        const response = await harness.app.request(`/api/drops/${addr(0x1000 + c.n)}/${door}`);
        expect(response.status, `${String(c.n)} ${door}`).toBe(404);
        expect(await response.json()).toEqual({ error: "not_found" });
      }
    }
  });

  it("the manifest stays, and a live drop's share card still asks for a login", async () => {
    await world();
    expect(await status(`/api/drops/${addr(0x1000 + PART_FUNDED.n)}/manifest`)).toBe(200);
    expect(await status(`/api/drops/${addr(0x1000 + LIVE.n)}/share`)).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Solana: the coins back come from our own cancel transaction
// ---------------------------------------------------------------------------

const key = (n: number): Pubkey => {
  const bytes = new Uint8Array(32);
  bytes.fill(n);
  return bytes;
};
const REFUND = key(9);

/** `Program data:` of a `CancelledUnfunded` for this drop. */
function cancelledLog(drop: Pubkey, amount: bigint): string {
  const bytes = new Uint8Array(8 + 32 + 32 + 8);
  bytes.set(eventDiscriminator("CancelledUnfunded"), 0);
  bytes.set(drop, 8);
  bytes.set(REFUND, 40);
  new DataView(bytes.buffer).setBigUint64(72, amount, true);
  return `Program data: ${Buffer.from(bytes).toString("base64")}`;
}

function meta(logs: string[], refundLamports: [bigint, bigint]): TransactionMeta {
  return {
    slot: 1,
    blockTime: SECONDS,
    fee: 5_000n,
    err: null,
    logMessages: logs,
    computeUnitsConsumed: null,
    preBalances: [1_000_000_000n, refundLamports[0]],
    postBalances: [999_995_000n, refundLamports[1]],
    accountKeys: [key(7), REFUND],
  };
}

interface SvmCase {
  readonly n: number;
  readonly settleTxHash: string | null;
  readonly tx?: TransactionMeta | "throws";
}

const S_TOKENS_BACK: SvmCase = {
  n: 31,
  settleTxHash: "sig31",
  tx: meta([cancelledLog(key(31), 5_000n)], [0n, 0n]),
};
const S_EMPTY: SvmCase = {
  n: 32,
  settleTxHash: "sig32",
  tx: meta([cancelledLog(key(32), 0n)], [100n, 100n]),
};
const S_SOL_SIDE_BACK: SvmCase = {
  n: 33,
  settleTxHash: "sig33",
  tx: meta([cancelledLog(key(33), 0n)], [100n, 2_000_100n]),
};
const S_NO_CANCEL: SvmCase = { n: 34, settleTxHash: null };
const S_OTHER_DROP: SvmCase = {
  n: 35,
  settleTxHash: "sig35",
  tx: meta([cancelledLog(key(99), 5_000n)], [0n, 0n]),
};
const S_READ_FAILS: SvmCase = { n: 36, settleTxHash: "sig36", tx: "throws" };
const SVM_CASES = [
  S_TOKENS_BACK,
  S_EMPTY,
  S_SOL_SIDE_BACK,
  S_NO_CANCEL,
  S_OTHER_DROP,
  S_READ_FAILS,
];

function fakeRpc(): SvmRpc {
  const txs = new Map(
    SVM_CASES.filter((c) => c.settleTxHash !== null).map((c) => [c.settleTxHash, c.tx] as const),
  );
  const no = (): never => {
    throw new Error("not in this test");
  };
  return {
    getAccountInfo: () => Promise.resolve(null),
    getMultipleAccounts: (pubkeys) => Promise.resolve(pubkeys.map(() => null)),
    getBalance: no,
    getMinimumBalanceForRentExemption: no,
    getLatestBlockhash: no,
    getBlockHeight: no,
    simulateTransaction: no,
    sendTransaction: no,
    getSignatureStatuses: no,
    getTransaction: (signature) => {
      const tx = txs.get(signature);
      if (tx === "throws") return Promise.reject(new Error("rpc down"));
      return Promise.resolve(tx ?? null);
    },
  };
}

async function solanaWorld(): Promise<void> {
  harness = await createHarness({
    solanaReader: createSvmReader({
      rpc: fakeRpc(),
      chainKey: "solana-devnet",
      chainId: 103,
      cacheMs: 0,
    }),
  });
  harness.setNow(NOW);
  await harness.deps.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "alice", displayName: "Alice", profileImageUrl: null });
  await harness.deps.db.insert(drops).values(
    SVM_CASES.map((c) => ({
      address: pubkeyToBase58(key(c.n)),
      mode: "handle" as const,
      chainId: 103,
      chainKey: "solana-devnet",
      xUserId: "1",
      nonce: BigInt(c.n),
      creatorCommitment: `0x${c.n.toString(16).padStart(64, "0")}`,
      salt: null,
      asset: DEFAULT_PUBKEY_BASE58,
      merkleRoot: `0x${"33".repeat(32)}`,
      manifestHash: `0x${"44".repeat(32)}`,
      manifestJson: "{}",
      totalEntitlements: "10000000",
      feeAmount: "0",
      grossRequired: "10000000",
      leafCount: 3,
      refundRecipient: pubkeyToBase58(REFUND),
      fundingDeadline: PAST,
      claimPeriod: 259_200,
      state: "funding_expired",
      settleTxHash: c.settleTxHash,
      createTxHash: "sig0",
      createdAt: new Date(NOW.getTime() - c.n * 60_000),
    })),
  );
}

describe("Solana, coins back from our cancel transaction", () => {
  it("opens when the cancel sent the asset back or the refund recipient got lamports", async () => {
    await solanaWorld();
    for (const c of [S_TOKENS_BACK, S_SOL_SIDE_BACK]) {
      const address = pubkeyToBase58(key(c.n));
      expect(pubkeyFromBase58(address)).toEqual(key(c.n));
      expect(await status(`/api/drops/${address}`), String(c.n)).toBe(200);
    }
  });

  it("is not found with nothing back, no cancel of ours, or an event for another drop", async () => {
    await solanaWorld();
    for (const c of [S_EMPTY, S_NO_CANCEL, S_OTHER_DROP]) {
      expect(await status(`/api/drops/${pubkeyToBase58(key(c.n))}`), String(c.n)).toBe(404);
    }
  });

  it("a cancel transaction that cannot be read is 503 solana_unavailable", async () => {
    await solanaWorld();
    const response = await harness.app.request(`/api/drops/${pubkeyToBase58(key(S_READ_FAILS.n))}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "solana_unavailable" });
  });
});
