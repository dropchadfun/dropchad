/**
 * The read side with Solana in it: `GET /api/drops`, `GET /api/drops/:address` for a base58
 * drop, `GET /api/stats?chain=` and `GET /api/boards?chain=`. The Solana half is our rows read
 * back from the fake cluster; the EVM half is the indexer stub. Units are never added together.
 */
import {
  buildDropTree,
  buildHandleDropTree,
  canonicalHandleManifestJson,
  canonicalManifestJson,
  toHandleManifest,
  toManifest,
} from "@dropchad/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { unblindedCommitment } from "../src/chain/predict.js";
import { createSvmReader } from "../src/chain/svm/reader.js";
import type { SvmRpc } from "../src/chain/svm/rpc.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { bitmapPda, dropPda } from "../src/chain/svm/pda.js";
import { pubkeyFromBase58, pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import {
  FakeSvm,
  createFakeSvmRpc,
  encodeBitmapAccount,
  encodeDropAccount,
  rentFor,
  type FakeDrop,
} from "./fake-svm.js";
import { createHarness, type Harness, type IndexerStubOptions } from "./harness.js";

const LEAF = 10_000_000n;
const REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";
const EVM_COMMITMENT = `0x${"ab".repeat(32)}`;

/**
 * Put a finished Solana drop straight into the fake cluster and our table: `Active`, the first
 * `paid` leaves paid, created at `createdAt`. Skips the relayer on purpose; the worker tests cover
 * that path. A multisend by default; `mode: "handle"` builds a handle tree over X ids
 * `1000 + i + nonce * 16`, the version 2 manifest and the `drop_handle_leaves` rows.
 */
async function seedSolanaDrop(
  harness: Harness,
  svm: FakeSvm,
  args: {
    xUserId: string;
    nonce: bigint;
    count: number;
    createdAt: bigint;
    paid: number;
    mode?: "address" | "handle";
    /** `close_drop` ran: `Finalized`, `closed`, no bitmap. */
    closed?: boolean;
    /** The settle job's copy on our row, `drops.claimed_indexes`. Absent is `NULL`. */
    claimedIndexes?: number[] | null;
  },
) {
  const commitment = unblindedCommitment(BigInt(args.xUserId), args.nonce);
  const commitmentBytes = new Uint8Array(Buffer.from(commitment.slice(2), "hex"));
  const pda = dropPda(commitmentBytes, args.nonce);
  const address = pubkeyToBase58(pda.address);
  const receivers = Array.from({ length: args.count }, (_, i) => ({
    recipient: pubkeyToBase58(new Uint8Array(32).fill(0x20 + i + Number(args.nonce) * 16)),
    amount: LEAF,
  }));
  const xIds = Array.from({ length: args.count }, (_, i) =>
    BigInt(1000 + i + Number(args.nonce) * 16),
  );
  const handleTree =
    args.mode === "handle"
      ? buildHandleDropTree({
          family: "svm",
          drop: address,
          chainId: 103,
          receivers: xIds.map((xId) => ({ xId, amount: LEAF })),
        })
      : null;
  const addressTree =
    handleTree === null
      ? buildDropTree({ family: "svm", drop: address, chainId: 103, receivers })
      : null;
  const tree = handleTree ?? (addressTree as NonNullable<typeof addressTree>);
  const manifestJson =
    handleTree !== null
      ? canonicalHandleManifestJson(toHandleManifest(handleTree))
      : canonicalManifestJson(toManifest(addressTree as NonNullable<typeof addressTree>));
  const bitmap = bitmapPda(pda.address);
  const bits = new Uint8Array(1250);
  for (let i = 0; i < args.paid; i += 1) bits[i >> 3] = (bits[i >> 3] as number) | (1 << (i & 7));

  const drop: FakeDrop = {
    asset: new Uint8Array(32),
    vault: new Uint8Array(32),
    merkleRoot: new Uint8Array(Buffer.from(tree.root.slice(2), "hex")),
    manifestHash: new Uint8Array(32).fill(0x11),
    totalEntitlements: tree.totalEntitlements,
    grossRequired: tree.totalEntitlements,
    feeAmount: 0n,
    feeWallet: svm.feeWallet,
    refundRecipient: pubkeyFromBase58(REFUND),
    fundingDeadline: args.createdAt + 604_800n,
    claimPeriod: 2_592_000,
    creatorCommitment: commitmentBytes,
    nonce: args.nonce,
    leafCount: tree.leafCount,
    chainId: 103n,
    rentPayer: svm.relayer,
    createdAt: args.createdAt,
    bump: pda.bump,
    bitmapBump: bitmap.bump,
    activatedAt: args.createdAt + 60n,
    claimDeadline: args.createdAt + 60n + 2_592_000n,
    status: args.closed === true ? 2 : 1,
    totalClaimed: LEAF * BigInt(args.paid),
    claimedCount: args.paid,
    closed: args.closed === true,
  };
  svm.accounts.set(address, {
    lamports: rentFor(424) + LEAF * BigInt(args.count - args.paid),
    owner: pubkeyFromBase58("EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft"),
    data: encodeDropAccount(drop),
  });
  if (args.closed !== true)
    svm.accounts.set(pubkeyToBase58(bitmap.address), {
      lamports: rentFor(1291),
      owner: pubkeyFromBase58("EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft"),
      data: encodeBitmapAccount(pda.address, bitmap.bump, bits),
    });

  await harness.deps.db.insert(drops).values({
    address,
    chainId: 103,
    chainKey: "solana-devnet",
    xUserId: args.xUserId,
    nonce: args.nonce,
    creatorCommitment: commitment,
    salt: null,
    asset: "11111111111111111111111111111111",
    merkleRoot: tree.root,
    manifestHash: `0x${"11".repeat(32)}`,
    manifestJson,
    mode: args.mode ?? "address",
    claimedIndexes: args.claimedIndexes ?? null,
    totalEntitlements: tree.totalEntitlements.toString(),
    feeAmount: "0",
    grossRequired: tree.totalEntitlements.toString(),
    leafCount: tree.leafCount,
    refundRecipient: REFUND,
    fundingDeadline: drop.fundingDeadline,
    claimPeriod: 2_592_000,
    state: args.paid === args.count ? "finished" : "paying",
    paidCount: args.paid,
    createTxHash: `sig${args.nonce.toString()}`,
    createdAt: new Date(Number(args.createdAt) * 1000),
    updatedAt: new Date(Number(args.createdAt) * 1000),
  });
  if (handleTree !== null) {
    await harness.deps.db.insert(dropHandleLeaves).values(
      handleTree.entries.map((entry) => ({
        dropAddress: address,
        leafIndex: entry.index,
        xUserId: entry.xId.toString(),
        amount: entry.amount.toString(),
      })),
    );
  }
  return { address, tree, receivers };
}

async function world(
  indexer: IndexerStubOptions = {},
  /** Wraps the fake cluster's rpc, to count or fail its calls. */
  wrap: (rpc: SvmRpc) => SvmRpc = (rpc) => rpc,
) {
  const relayer = randomSigner().publicKey;
  const svm = new FakeSvm({ relayer });
  const reader = createSvmReader({
    rpc: wrap(createFakeSvmRpc(svm)),
    chainKey: "solana-devnet",
    chainId: 103,
    cacheMs: 0,
  });
  const harness = await createHarness({ indexer, solanaReader: reader });
  await harness.deps.db.insert(profiles).values([
    { xUserId: "1", handle: "sample", displayName: "Sample", profileImageUrl: null },
    { xUserId: "2", handle: "bob", displayName: "Bob", profileImageUrl: null },
  ]);
  return { svm, reader, harness };
}

const NOW = 1_800_000_000n;

/** One of our EVM handle drops: the `drops` row and one `drop_handle_leaves` row per X id. */
async function seedEvmHandleDrop(
  harness: Harness,
  args: {
    address: string;
    xUserId: string;
    creatorCommitment: string;
    xIds: string[];
    total: string;
  },
) {
  await harness.deps.db.insert(drops).values({
    address: args.address,
    chainId: 46630,
    chainKey: "robinhood-testnet",
    xUserId: args.xUserId,
    nonce: 0n,
    creatorCommitment: args.creatorCommitment,
    salt: `0x${"cd".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"ee".repeat(32)}`,
    manifestHash: `0x${"ff".repeat(32)}`,
    manifestJson: "{}",
    mode: "handle",
    totalEntitlements: args.total,
    feeAmount: "0",
    grossRequired: args.total,
    leafCount: args.xIds.length,
    refundRecipient: "0x000000000000000000000000000000000000dddd",
    fundingDeadline: NOW + 1n,
    claimPeriod: 1,
    createTxHash: `0x${args.address.slice(-2).repeat(32)}`,
  });
  await harness.deps.db.insert(dropHandleLeaves).values(
    args.xIds.map((xUserId, leafIndex) => ({
      dropAddress: args.address,
      leafIndex,
      xUserId,
      amount: "1",
    })),
  );
}

describe("GET /api/drops with Solana rows", () => {
  it("merges our EVM and Solana handle drops, newest first, each labelled; multisend left out", async () => {
    const EVM = "0x0000000000000000000000000000000000001532";
    const { svm, harness } = await world({
      // The indexer's own list is never read for the list.
      drops: { drops: [{ address: "0x01532cdb", status: "Active", createdAt: NOW.toString() }] },
      dropsByAddress: {
        [EVM]: {
          address: EVM,
          chainId: 46630,
          status: "Active",
          createdAt: (NOW - 100n).toString(),
        },
      },
    });
    await seedEvmHandleDrop(harness, {
      address: EVM,
      xUserId: "2",
      creatorCommitment: EVM_COMMITMENT,
      xIds: ["9001"],
      total: "1",
    });
    const a = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 3,
      createdAt: NOW - 200n,
      paid: 3,
      mode: "handle",
    });
    const b = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 1n,
      count: 2,
      createdAt: NOW - 50n,
      paid: 1,
      mode: "handle",
    });
    // The newest of all, and a multisend: on no list.
    await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 2n,
      count: 2,
      createdAt: NOW - 10n,
      paid: 2,
    });

    const response = await harness.app.request("/api/drops");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chain: string;
      sources: { solana: { configured: boolean; available: boolean } };
      drops: {
        address: string;
        source: string;
        chainId?: number;
        status?: string;
        claimedCount?: number;
        dropchad: unknown;
      }[];
    };
    expect(body.chain).toBe("all");
    expect(body.sources.solana).toEqual({
      configured: true,
      available: true,
      chainKey: "solana-devnet",
    });
    expect(body.drops.map((d) => [d.address, d.source])).toEqual([
      [b.address, "rpc"],
      [EVM, "indexer"],
      [a.address, "rpc"],
    ]);
    const solana = body.drops[0];
    expect(solana).toMatchObject({
      chainId: 103,
      status: "Active",
      claimedCount: 1,
      finality: "seen",
    });
    expect(solana?.dropchad).toMatchObject({ state: "paying", paidCount: 1, mode: "handle" });
    await harness.close();
  });

  it("the Solana half cuts at the limit after the multisend is left out", async () => {
    const { svm, harness } = await world();
    const older = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 1,
      createdAt: NOW - 300n,
      paid: 1,
      mode: "handle",
    });
    const newer = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 1n,
      count: 1,
      createdAt: NOW - 200n,
      paid: 1,
      mode: "handle",
    });
    for (const nonce of [2n, 3n, 4n]) {
      await seedSolanaDrop(harness, svm, {
        xUserId: "1",
        nonce,
        count: 1,
        createdAt: NOW - 10n,
        paid: 1,
      });
    }
    const body = (await (await harness.app.request("/api/drops?chain=solana&limit=2")).json()) as {
      drops: { address: string }[];
    };
    expect(body.drops.map((d) => d.address)).toEqual([newer.address, older.address]);
    await harness.close();
  });

  it("filters by pill: chain=solana leaves the indexer out, chain=robinhood leaves Solana out", async () => {
    const { svm, harness } = await world({ down: true });
    const a = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 1,
      createdAt: NOW,
      paid: 1,
      mode: "handle",
    });
    await seedEvmHandleDrop(harness, {
      address: "0x0000000000000000000000000000000000001532",
      xUserId: "2",
      creatorCommitment: EVM_COMMITMENT,
      xIds: ["9001"],
      total: "1",
    });

    // The indexer is down, but a Solana only list never asks it.
    const solana = await harness.app.request("/api/drops?chain=solana");
    expect(solana.status).toBe(200);
    expect(
      ((await solana.json()) as { drops: { address: string }[] }).drops.map((d) => d.address),
    ).toEqual([a.address]);

    const evm = await harness.app.request("/api/drops?chain=robinhood");
    expect(evm.status).toBe(503);
    expect(await evm.json()).toEqual({ error: "indexer_unavailable" });

    expect((await harness.app.request("/api/drops?chain=nope")).status).toBe(400);
    await harness.close();
  });
});

describe("GET /api/drops/:address for a Solana drop", () => {
  it("answers from the cluster, source rpc, with the claims the bitmap says are paid", async () => {
    const { svm, harness } = await world();
    const { address, receivers } = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 3,
      createdAt: NOW,
      paid: 2,
    });

    const response = await harness.app.request(`/api/drops/${address}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chain: {
        source: string;
        available: boolean;
        indexed: boolean;
        data: { drop: Record<string, unknown>; claims: { index: number; recipient: string }[] };
      };
      ours: { data: { chainKey: string } };
    };
    expect(body.chain.source).toBe("rpc");
    expect(body.chain.available).toBe(true);
    expect(body.chain.indexed).toBe(true);
    expect(body.chain.data.drop).toMatchObject({
      address,
      chainId: 103,
      chainKey: "solana-devnet",
      status: "Active",
      leafCount: 3,
      claimedCount: 2,
      verified: true,
      finality: "seen",
    });
    // Leaves 0 and 1 are set in the bitmap; their recipients come from our manifest, sorted order.
    const sorted = [...receivers].map((r) => r.recipient).sort();
    expect(body.chain.data.claims.map((c) => c.index)).toEqual([0, 1]);
    expect(body.chain.data.claims.every((c) => sorted.includes(c.recipient))).toBe(true);
    expect(body.ours.data.chainKey).toBe("solana-devnet");
    await harness.close();
  });

  it("is a plain 404 for a base58 address we never created", async () => {
    const { harness } = await world();
    const response = await harness.app.request(
      `/api/drops/${pubkeyToBase58(new Uint8Array(32).fill(7))}`,
    );
    expect(response.status).toBe(404);
    await harness.close();
  });

  it("says the cluster is unavailable instead of failing when the read side is missing", async () => {
    const harness = await createHarness();
    await harness.deps.db
      .insert(profiles)
      .values({ xUserId: "1", handle: "e", displayName: "E", profileImageUrl: null });
    const svm = new FakeSvm({ relayer: randomSigner().publicKey });
    const { address } = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 1,
      createdAt: NOW,
      paid: 0,
    });
    const response = await harness.app.request(`/api/drops/${address}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chain: { source: string; available: boolean };
      ours: { known: boolean };
    };
    expect(body.chain).toMatchObject({
      source: "rpc",
      available: false,
      indexed: false,
      data: null,
    });
    expect(body.ours.known).toBe(true);
    await harness.close();
  });
});

describe("GET /api/stats with Solana", () => {
  it("reports per chain totals and never adds lamports to wei", async () => {
    // the EVM half is the handle drops on the board rows, never the indexer's /stats.
    // X ids 1000 and 5000 claimed on the EVM; 1000 is paid on Solana too. People are counted per
    // chain: 2 on the EVM plus 3 on Solana is 5 on the all view.
    const evmAddress = "0x0000000000000000000000000000000000000055";
    const { svm, harness } = await world({
      stats: {
        droppedTotalWei: "999000000000000000",
        dropCount: 99,
        uniqueReceivers: 99,
        claimCount: 99,
        finality: "final",
      },
      boardDrops: [
        {
          address: evmAddress,
          creatorCommitment: EVM_COMMITMENT,
          createdAt: NOW.toString(),
          claimedFinalWei: "500000000000000",
          claimedCountFinal: 2,
          recipients: [
            "0x000000000000000000000000000000000000a001",
            "0x000000000000000000000000000000000000a002",
          ],
          claimedIndexes: [0, 1],
        },
      ],
    });
    await seedEvmHandleDrop(harness, {
      address: evmAddress,
      xUserId: "2",
      creatorCommitment: EVM_COMMITMENT,
      xIds: ["1000", "5000"],
      total: "500000000000000",
    });
    await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 3,
      createdAt: NOW,
      paid: 3,
      mode: "handle",
    });
    await seedSolanaDrop(harness, svm, {
      xUserId: "2",
      nonce: 0n,
      count: 2,
      createdAt: NOW,
      paid: 1,
      mode: "handle",
    });

    const all = (await (await harness.app.request("/api/stats")).json()) as Record<string, unknown>;
    expect(all).toMatchObject({
      chain: "all",
      finality: "final",
      droppedTotalWei: "500000000000000",
      dropCount: 3,
      // X ids 1000, 1001, 1002 on Solana (both drops start at 1000), 1000 and 5000 on the EVM.
      uniqueReceivers: 5,
      claimCount: 6,
    });
    // The coin line under the tile: both coins moved, no token drops yet, so no token item.
    expect(all["dropped"]).toEqual([
      { kind: "coin", symbol: "ETH", decimals: 18, amount: "500000000000000" },
      { kind: "coin", symbol: "SOL", decimals: 9, amount: (LEAF * 4n).toString() },
    ]);
    expect(all["totals"]).toEqual([
      expect.objectContaining({
        chainKey: "robinhood-testnet",
        symbol: "ETH",
        decimals: 18,
        droppedTotal: "500000000000000",
        dropCount: 1,
        uniqueReceivers: 2,
        claimCount: 2,
      }),
      expect.objectContaining({
        chainKey: "solana-devnet",
        symbol: "SOL",
        decimals: 9,
        droppedTotal: (LEAF * 4n).toString(),
        dropCount: 2,
        uniqueReceivers: 3,
        claimCount: 4,
        available: true,
      }),
    ]);

    const solana = (await (await harness.app.request("/api/stats?chain=solana")).json()) as Record<
      string,
      unknown
    >;
    expect(solana).toMatchObject({
      chain: "solana",
      droppedTotalWei: "0",
      dropCount: 2,
      uniqueReceivers: 3,
    });
    expect((solana["totals"] as unknown[]).length).toBe(1);

    const evm = (await (await harness.app.request("/api/stats?chain=robinhood")).json()) as Record<
      string,
      unknown
    >;
    expect(evm).toMatchObject({
      chain: "robinhood",
      droppedTotalWei: "500000000000000",
      dropCount: 1,
    });
    await harness.close();
  });

  it("still answers a Solana only request when the indexer is down", async () => {
    const { svm, harness } = await world({ down: true });
    await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 1,
      createdAt: NOW,
      paid: 1,
      mode: "handle",
    });
    expect((await harness.app.request("/api/stats")).status).toBe(503);
    const solana = await harness.app.request("/api/stats?chain=solana");
    expect(solana.status).toBe(200);
    expect(await solana.json()).toMatchObject({ dropCount: 1, claimCount: 1 });
    await harness.close();
  });
});

describe("GET /api/boards with Solana", () => {
  const evmDrop = {
    address: "0x0000000000000000000000000000000000000001",
    creatorCommitment: EVM_COMMITMENT,
    createdAt: NOW.toString(),
    claimedFinalWei: "2000000000000000",
    claimedCountFinal: 1,
    recipients: ["0x000000000000000000000000000000000000aaaa"],
    claimedIndexes: [0],
  };

  async function boardWorld() {
    const { svm, harness } = await world({ boardDrops: [evmDrop] });
    // Bob's EVM handle drop: 2 ETH-ish to one X id. The commitment must be one of ours to count.
    await seedEvmHandleDrop(harness, {
      address: evmDrop.address,
      xUserId: "2",
      creatorCommitment: EVM_COMMITMENT,
      xIds: ["7000"],
      total: "2000000000000000",
    });
    // Sample's Solana handle drop: 3 people fed.
    await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 3,
      createdAt: NOW,
      paid: 3,
      mode: "handle",
    });
    harness.setNow(new Date(Number(NOW) * 1000 + 1000));
    return harness;
  }

  it("ranks one chain by wallets fed, totals in its own unit", async () => {
    const harness = await boardWorld();
    const sol = (await (
      await harness.app.request("/api/boards?range=all&chain=solana")
    ).json()) as {
      rankedBy: string;
      chain: string;
      rows: {
        profile: { handle: string };
        totalWei: string;
        byChain: { chainKey: string; total: string }[];
      }[];
    };
    expect(sol.chain).toBe("solana");
    // `most fed` is the default board, on one chain too.
    expect(sol.rankedBy).toBe("uniqueReceivers");
    expect(sol.rows.map((r) => r.profile.handle)).toEqual(["sample"]);
    expect(sol.rows[0]?.totalWei).toBe((LEAF * 3n).toString());
    expect(sol.rows[0]?.byChain).toEqual([
      {
        chainKey: "solana-devnet",
        total: (LEAF * 3n).toString(),
        biggestDrop: (LEAF * 3n).toString(),
        dropCount: 1,
        uniqueReceivers: 3,
        claimCount: 3,
        usd: 0,
      },
    ]);

    // The default chain is still the api's own pill, robinhood; the ranking is wallets fed.
    const evm = (await (await harness.app.request("/api/boards?range=all")).json()) as {
      chain: string;
      rows: { profile: { handle: string }; totalWei: string }[];
    };
    expect(evm.chain).toBe("robinhood");
    expect(evm.rows.map((r) => [r.profile.handle, r.totalWei])).toEqual([
      ["bob", "2000000000000000"],
    ]);
    await harness.close();
  });

  it("ranks every chain together by wallets fed, keeping each coin apart", async () => {
    const harness = await boardWorld();
    const all = (await (await harness.app.request("/api/boards?range=all&chain=all")).json()) as {
      rankedBy: string;
      rows: {
        rank: number;
        profile: { handle: string };
        totalWei: string;
        uniqueReceivers: number;
        byChain: { chainKey: string }[];
      }[];
    };
    expect(all.rankedBy).toBe("uniqueReceivers");
    expect(all.rows.map((r) => [r.rank, r.profile.handle, r.uniqueReceivers])).toEqual([
      [1, "sample", 3],
      [2, "bob", 1],
    ]);
    // `totalWei` is still wei: Sample has none, Bob has his. The SOL lives in `byChain`.
    expect(all.rows[0]?.totalWei).toBe("0");
    expect(all.rows[0]?.byChain.map((c) => c.chainKey)).toEqual(["solana-devnet"]);
    expect(all.rows[1]?.totalWei).toBe("2000000000000000");
    await harness.close();
  });

  it("carries per chain totals on the profile page", async () => {
    const harness = await boardWorld();
    const body = (await (await harness.app.request("/api/users/sample")).json()) as {
      totals: {
        totalWei: string;
        uniqueReceivers: number;
        byChain: { chainKey: string; total: string }[];
        dropped: unknown[];
      };
    };
    expect(body.totals.totalWei).toBe("0");
    expect(body.totals.uniqueReceivers).toBe(3);
    expect(body.totals.byChain).toEqual([
      expect.objectContaining({ chainKey: "solana-devnet", total: (LEAF * 3n).toString() }),
    ]);
    // The same coin line as the front page: only SOL moved for this chad, so ETH is not listed.
    expect(body.totals.dropped).toEqual([
      { kind: "coin", symbol: "SOL", decimals: 9, amount: (LEAF * 3n).toString() },
    ]);
    await harness.close();
  });

  it("counts people per chain: the all view adds up each chain", async () => {
    // Bob pays X ids 1000 and 5000 on the EVM and 1000 again on Solana.: once
    // inside one chain, each chain's count added up on the all view, so 2 plus 1 is 3.
    const evmAddress = "0x0000000000000000000000000000000000000056";
    const { svm, harness } = await world({
      boardDrops: [
        {
          address: evmAddress,
          creatorCommitment: EVM_COMMITMENT,
          createdAt: NOW.toString(),
          claimedFinalWei: "500000000000000",
          claimedCountFinal: 2,
          recipients: [
            "0x000000000000000000000000000000000000a001",
            "0x000000000000000000000000000000000000a002",
          ],
          claimedIndexes: [0, 1],
        },
      ],
    });
    await seedEvmHandleDrop(harness, {
      address: evmAddress,
      xUserId: "2",
      creatorCommitment: EVM_COMMITMENT,
      xIds: ["1000", "5000"],
      total: "500000000000000",
    });
    await seedSolanaDrop(harness, svm, {
      xUserId: "2",
      nonce: 0n,
      count: 1,
      createdAt: NOW,
      paid: 1,
      mode: "handle",
    });
    harness.setNow(new Date(Number(NOW) * 1000 + 1000));

    const people = async (chain: string) => {
      const body = (await (
        await harness.app.request(`/api/boards?range=all&chain=${chain}`)
      ).json()) as {
        rows: { profile: { handle: string }; uniqueReceivers: number; claimCount: number }[];
      };
      return body.rows.map((r) => [r.profile.handle, r.uniqueReceivers, r.claimCount]);
    };
    // People, then payouts: every final claim is one payout, per chain.
    expect(await people("all")).toEqual([["bob", 3, 3]]);
    expect(await people("robinhood")).toEqual([["bob", 2, 2]]);
    expect(await people("solana")).toEqual([["bob", 1, 1]]);

    const user = (await (await harness.app.request("/api/users/bob")).json()) as {
      totals: {
        uniqueReceivers: number;
        claimCount: number;
        byChain: { chainKey: string; uniqueReceivers: number; claimCount: number }[];
      };
    };
    expect(user.totals.uniqueReceivers).toBe(3);
    expect(user.totals.claimCount).toBe(3);
    expect(
      user.totals.byChain.map((c) => [c.chainKey, c.uniqueReceivers, c.claimCount]).sort(),
    ).toEqual([
      ["robinhood-testnet", 2, 2],
      ["solana-devnet", 1, 1],
    ]);
    await harness.close();
  });

  it("a funded Solana drop nobody claimed puts the chad on no board, claimed not funded", async () => {
    const { svm, harness } = await world({ boardDrops: [] });
    // Five leaves funded and active, zero bits set in the bitmap. -09-15.
    await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 5,
      createdAt: NOW,
      paid: 0,
      mode: "handle",
    });
    harness.setNow(new Date(Number(NOW) * 1000 + 1000));
    for (const type of ["fed", "dropper", "project"]) {
      const body = (await (
        await harness.app.request(`/api/boards?range=all&chain=all&board=${type}`)
      ).json()) as { rows: { profile: { handle: string } }[] };
      expect(body.rows, type).toEqual([]);
    }
    const user = (await (await harness.app.request("/api/users/sample")).json()) as {
      totals: { dropCount: number; uniqueReceivers: number; usd: number };
    };
    expect(user.totals).toMatchObject({ dropCount: 0, uniqueReceivers: 0, usd: 0 });
    await harness.close();
  });

  it("a Solana multisend counts nowhere: no board, no profile total, no tile", async () => {
    const { svm, harness } = await world({ boardDrops: [] });
    // Three wallets paid in full. a multisend is worth nothing on a board.
    await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 3,
      createdAt: NOW,
      paid: 3,
    });
    harness.setNow(new Date(Number(NOW) * 1000 + 1000));
    for (const type of ["fed", "dropper", "project"]) {
      const body = (await (
        await harness.app.request(`/api/boards?range=all&chain=solana&board=${type}`)
      ).json()) as { rows: unknown[] };
      expect(body.rows, type).toEqual([]);
    }
    const user = (await (await harness.app.request("/api/users/sample")).json()) as {
      totals: { dropCount: number; uniqueReceivers: number };
      drops: unknown[];
    };
    expect(user.totals).toMatchObject({ dropCount: 0, uniqueReceivers: 0 });
    expect(user.drops).toEqual([]);
    const stats = (await (await harness.app.request("/api/stats?chain=solana")).json()) as Record<
      string,
      unknown
    >;
    expect(stats).toMatchObject({ dropCount: 0, uniqueReceivers: 0, claimCount: 0 });
    await harness.close();
  });

  it("a Solana handle drop counts the X ids behind the paid bits", async () => {
    const { svm, harness } = await world({ boardDrops: [] });
    // Five leaves, two paid: X ids 1000 and 1001.
    await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 5,
      createdAt: NOW,
      paid: 2,
      mode: "handle",
    });
    harness.setNow(new Date(Number(NOW) * 1000 + 1000));
    const body = (await (
      await harness.app.request("/api/boards?range=all&chain=solana")
    ).json()) as {
      rows: { profile: { handle: string }; uniqueReceivers: number; totalWei: string }[];
    };
    expect(body.rows.map((r) => [r.profile.handle, r.uniqueReceivers, r.totalWei])).toEqual([
      ["sample", 2, (LEAF * 2n).toString()],
    ]);
    await harness.close();
  });

  it("a frozen price belongs to one drop address, never to every drop sharing its commitment", async () => {
    // A commitment is `keccak(xUserId, nonce)`, the same 32 bytes on both chains. Sample's
    // Solana drop at nonce 0 and an EVM drop at nonce 0 share one. Only the Solana drop was
    // priced, at 100 usd per SOL. The EVM drop must stay at zero, not take the SOL price.
    const shared = unblindedCommitment(1n, 0n);
    const evm = {
      address: "0x0000000000000000000000000000000000000077",
      creatorCommitment: shared,
      createdAt: NOW.toString(),
      claimedFinalWei: "300000000000000",
      claimedCountFinal: 3,
      recipients: [
        "0x000000000000000000000000000000000000a001",
        "0x000000000000000000000000000000000000a002",
        "0x000000000000000000000000000000000000a003",
      ],
      claimedIndexes: [0, 1, 2],
    };
    const { svm, harness } = await world({ boardDrops: [evm] });
    await seedEvmHandleDrop(harness, {
      address: evm.address,
      xUserId: "1",
      creatorCommitment: shared,
      xIds: ["8001", "8002", "8003"],
      total: "300000000000000",
    });
    const sol = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 3,
      createdAt: NOW,
      paid: 3,
      mode: "handle",
    });
    await harness.deps.db
      .update(drops)
      .set({ priceUsd: "100", pricedAt: new Date(Number(NOW) * 1000) })
      .where(eq(drops.address, sol.address));
    harness.setNow(new Date(Number(NOW) * 1000 + 1000));

    const body = (await (
      await harness.app.request("/api/boards?range=all&chain=all&board=dropper")
    ).json()) as { rows: { usd: number; byChain: { chainKey: string; usd: number }[] }[] };
    // 3 leaves of 0.01 SOL at 100 = 3.00 usd. The 0.0003 ETH is unpriced: zero, not 0.03.
    expect(body.rows[0]?.byChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chainKey: "solana-devnet", usd: 3 }),
        expect.objectContaining({ chainKey: "robinhood-testnet", usd: 0 }),
      ]),
    );
    expect(body.rows[0]?.usd).toBe(3);
    await harness.close();
  });
});

/**
 * `close_drop` deletes the bitmap; the `Drop` account stays with
 * `claimed_count`. Once the bitmap is gone the reader uses the copy the settle job put
 * on our row, `drops.claimed_indexes`, and only when its length equals `claimed_count`: a wrong
 * number is worse than none.
 */
describe("closed Solana drops", () => {
  async function closedWorld(claimedIndexes: number[] | null) {
    const { svm, harness } = await world({ boardDrops: [] });
    const drop = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 3,
      createdAt: NOW,
      paid: 3,
      mode: "handle",
      closed: true,
      claimedIndexes,
    });
    harness.setNow(new Date(Number(NOW) * 1000 + 1000));
    return { svm, harness, drop };
  }

  it("a closed handle drop with its copy still counts: all time board, profile, tiles", async () => {
    const { harness } = await closedWorld([0, 1, 2]);
    const board = (await (
      await harness.app.request("/api/boards?range=all&chain=solana")
    ).json()) as {
      rows: { profile: { handle: string }; uniqueReceivers: number; totalWei: string }[];
    };
    expect(board.rows.map((r) => [r.profile.handle, r.uniqueReceivers, r.totalWei])).toEqual([
      ["sample", 3, (LEAF * 3n).toString()],
    ]);
    const user = (await (await harness.app.request("/api/users/sample")).json()) as {
      totals: { dropCount: number; uniqueReceivers: number };
    };
    expect(user.totals).toMatchObject({ dropCount: 1, uniqueReceivers: 3 });
    const stats = (await (await harness.app.request("/api/stats?chain=solana")).json()) as Record<
      string,
      unknown
    >;
    expect(stats).toMatchObject({ dropCount: 1, uniqueReceivers: 3, claimCount: 3 });
    await harness.close();
  });

  it("a closed drop without a copy counts zero", async () => {
    const { harness } = await closedWorld(null);
    const board = (await (
      await harness.app.request("/api/boards?range=all&chain=solana")
    ).json()) as { rows: unknown[] };
    expect(board.rows).toEqual([]);
    await harness.close();
  });

  it("a copy whose length is not claimed_count counts zero", async () => {
    const { harness } = await closedWorld([0, 1]);
    const board = (await (
      await harness.app.request("/api/boards?range=all&chain=solana")
    ).json()) as { rows: unknown[] };
    expect(board.rows).toEqual([]);
    await harness.close();
  });

  it("the drop page of a closed multisend still lists who got paid", async () => {
    const { svm, harness } = await world();
    const { address, receivers } = await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce: 0n,
      count: 3,
      createdAt: NOW,
      paid: 2,
      closed: true,
      claimedIndexes: [0, 1],
    });
    const body = (await (await harness.app.request(`/api/drops/${address}`)).json()) as {
      chain: { data: { claims: { index: number; recipient: string }[] } };
    };
    const sorted = receivers.map((r) => r.recipient);
    expect(body.chain.data.claims.map((c) => c.index)).toEqual([0, 1]);
    expect(body.chain.data.claims.every((c) => sorted.includes(c.recipient))).toBe(true);
    await harness.close();
  });
});

/** Counts every rpc call by method; `fail` makes the named method throw like a 429 would. */
function counting(fail: ReadonlySet<string> = new Set()) {
  const calls = new Map<string, number>();
  const wrap = (rpc: SvmRpc): SvmRpc =>
    new Proxy(rpc, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof key !== "string" || typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.set(key, (calls.get(key) ?? 0) + 1);
          if (fail.has(key)) return Promise.reject(new Error(`${key}: http 429`));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  return { calls, wrap, total: () => [...calls.values()].reduce((a, b) => a + b, 0) };
}

async function fiveSolanaDrops(harness: Harness, svm: FakeSvm) {
  for (let nonce = 0n; nonce < 5n; nonce++) {
    await seedSolanaDrop(harness, svm, {
      xUserId: "1",
      nonce,
      count: 2,
      createdAt: NOW,
      paid: 1,
      mode: "handle",
    });
  }
  harness.setNow(new Date(Number(NOW) * 1000 + 1000));
}

describe("the cluster read in batches", () => {
  it("stats reads 5 drops and their bitmaps in 2 calls, never one call per drop", async () => {
    const count = counting();
    const { svm, harness } = await world({}, count.wrap);
    await fiveSolanaDrops(harness, svm);
    count.calls.clear();
    const res = await harness.app.request("/api/stats?chain=solana");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dropCount: 5, claimCount: 5 });
    expect(count.calls.get("getAccountInfo") ?? 0).toBe(0);
    expect(count.calls.get("getMultipleAccounts")).toBe(2);
    expect(count.total()).toBe(2);
    await harness.close();
  });

  it("a board is 2 calls too", async () => {
    const count = counting();
    const { svm, harness } = await world({}, count.wrap);
    await fiveSolanaDrops(harness, svm);
    count.calls.clear();
    const res = await harness.app.request("/api/boards?range=all&board=fed&chain=solana");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: unknown[] }).rows).toHaveLength(1);
    expect(count.calls.get("getAccountInfo") ?? 0).toBe(0);
    expect(count.total()).toBe(2);
    await harness.close();
  });
});

describe("a Solana read that fails never makes a 500", () => {
  it("the board answers 200, available false, the note, no rows", async () => {
    const { svm, harness } = await world({}, counting(new Set(["getMultipleAccounts"])).wrap);
    await fiveSolanaDrops(harness, svm);
    for (const chain of ["all", "solana"]) {
      const res = await harness.app.request(`/api/boards?range=week&board=fed&chain=${chain}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        available: false,
        note: "the board cannot load right now. try again in a minute",
        rows: [],
      });
    }
    await harness.close();
  });

  it("stats keeps the EVM numbers and marks Solana unavailable, as before", async () => {
    const { svm, harness } = await world({}, counting(new Set(["getMultipleAccounts"])).wrap);
    await fiveSolanaDrops(harness, svm);
    const res = await harness.app.request("/api/stats?chain=all");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usd: number | null;
      totals: { chainKey: string; available: boolean; usd: number | null }[];
    };
    expect(body.usd).toBeNull();
    expect(body.totals.find((t) => t.chainKey === "solana-devnet")).toMatchObject({
      available: false,
      usd: null,
    });
    await harness.close();
  });
});

describe("the drops list in one batch", () => {
  it("reads 5 Solana drops in 1 call, never one call per drop", async () => {
    const count = counting();
    const { svm, harness } = await world({}, count.wrap);
    await fiveSolanaDrops(harness, svm);
    count.calls.clear();
    const res = await harness.app.request("/api/drops?chain=solana");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { drops: unknown[] }).drops).toHaveLength(5);
    expect(count.calls.get("getAccountInfo") ?? 0).toBe(0);
    expect(count.calls.get("getMultipleAccounts")).toBe(1);
    expect(count.total()).toBe(1);
    await harness.close();
  });

  it("when Solana fails the list keeps the EVM rows and says Solana is unavailable", async () => {
    const { svm, harness } = await world({}, counting(new Set(["getMultipleAccounts"])).wrap);
    await fiveSolanaDrops(harness, svm);
    const res = await harness.app.request("/api/drops?chain=all");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      drops: [],
      sources: { solana: { configured: true, available: false } },
    });
    await harness.close();
  });
});

describe("the profile when Solana fails", () => {
  it("answers 200 with the profile and its wall, totals available false, never a 500", async () => {
    const { svm, harness } = await world({}, counting(new Set(["getMultipleAccounts"])).wrap);
    await fiveSolanaDrops(harness, svm);
    const res = await harness.app.request("/api/users/sample");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profile: { handle: string };
      totals: unknown;
      drops: unknown[];
    };
    expect(body.profile.handle).toBe("sample");
    expect(body.totals).toEqual({ available: false, finality: "final" });
    expect(body.drops).toHaveLength(5);
    await harness.close();
  });
});
