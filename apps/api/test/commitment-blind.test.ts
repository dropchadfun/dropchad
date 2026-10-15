/**
 * the commitment carries a
 * secret blind.
 *
 * `creatorCommitment = keccak256(abi.encode(xUserId, nonce, blind))`, `blind` 32 random bytes the
 * api makes per drop. The nonce is public on both chains, so without the blind a guessed X id is
 * one hash away. The blind is stored in `drops.commitment_blind` and **never served, never
 * logged**. The chain treats the commitment as opaque bytes, so nothing on chain changed.
 *
 * - creation, both chains: the stored commitment is the one sent to the chain, it is the blinded
 *   form with the stored blind, never the unblinded one; every drop gets its own blind
 * - no route answers with the blind
 * - the boards match the stored commitment to the chain's, so a blinded drop counts exactly as
 *   before, and an old unblinded drop still counts
 */
import { getChain } from "@dropchad/chains";
import { hexToBytes, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { adaptersFrom } from "../src/chain/adapter.js";
import { creatorCommitment, unblindedCommitment } from "../src/chain/predict.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { dropPda } from "../src/chain/svm/pda.js";
import { pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { dropHandleLeaves, drops, profiles } from "../src/db/schema.js";
import type { BoardDrop } from "../src/indexer/client.js";
import { createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

/** The stubbed X user in `harness.ts`. */
const X_USER_ID = 1234567890n;
const BLIND_HEX = /^0x[0-9a-f]{64}$/;

const EVM_A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const EVM_B = "0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB";
const EVM_REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
const SOL_A = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
const SOL_B = "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC";
const SOL_REFUND = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";

let harness: Harness | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await harness?.close();
  harness = undefined;
});

async function world(): Promise<{
  harness: Harness;
  evm: FakeChain;
  headers: Record<string, string>;
}> {
  const evm = createFakeChain();
  const signer = randomSigner();
  // Devnet runs at 100 bps; at zero no fee covers the relayer.
  const svm = new FakeSvm({ relayer: signer.publicKey, defaultFeeBps: 100 });
  const rpc = createFakeSvmRpc(svm);
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: () => Promise.resolve(false),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    sleep: () => Promise.resolve(),
  });
  const svmAdapter = createSvmAdapter({
    rpc,
    relayer,
    chain: getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"],
  });
  const evmAdapter = evmAdapterFor(evm);
  const h = await createHarness({
    writeSides: adaptersFrom([evmAdapter, svmAdapter], evmAdapter.chainKey),
  });
  harness = h;
  const { jar } = await login(h);
  return {
    harness: h,
    evm,
    headers: {
      cookie: cookieHeader(jar),
      [CSRF_HEADER]: jar["dc_csrf"] ?? "",
      "content-type": "application/json",
    },
  };
}

const evmBody = JSON.stringify({
  mode: "address",
  receivers: [
    { address: EVM_A, amount: "100000000000000" },
    { address: EVM_B, amount: "100000000000000" },
  ],
  refundRecipient: EVM_REFUND,
});

const solBody = JSON.stringify({
  mode: "address",
  chain: "solana-devnet",
  receivers: [
    { address: SOL_A, amount: "10000000" },
    { address: SOL_B, amount: "10000000" },
  ],
  refundRecipient: SOL_REFUND,
});

async function create(
  h: Harness,
  headers: Record<string, string>,
  body: string,
): Promise<{ address: string; text: string }> {
  const response = await h.app.request("/api/drops", { method: "POST", headers, body });
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return { address: (JSON.parse(text) as { drop: { address: string } }).drop.address, text };
}

async function rowOf(h: Harness, address: string) {
  const rows = await h.deps.db.select().from(drops);
  const row = rows.find((r) => r.address.toLowerCase() === address.toLowerCase());
  if (row === undefined) throw new Error(`no row for ${address}`);
  return row;
}

describe("creation blinds the commitment, both chains", () => {
  it("EVM: the stored blind makes the stored commitment, and that is what the chain got", async () => {
    const { harness: h, evm, headers } = await world();
    const { address } = await create(h, headers, evmBody);
    const row = await rowOf(h, address);

    expect(row.commitmentBlind).toMatch(BLIND_HEX);
    expect(row.creatorCommitment).toBe(
      creatorCommitment(X_USER_ID, row.nonce, row.commitmentBlind as Hex),
    );
    expect(row.creatorCommitment).not.toBe(unblindedCommitment(X_USER_ID, row.nonce));
    expect(evm.creates[0]?.creatorCommitment).toBe(row.creatorCommitment);
  });

  it("Solana: the drop PDA is derived from the blinded commitment", async () => {
    const { harness: h, headers } = await world();
    const { address } = await create(h, headers, solBody);
    const row = await rowOf(h, address);

    expect(row.commitmentBlind).toMatch(BLIND_HEX);
    const commitment = creatorCommitment(X_USER_ID, row.nonce, row.commitmentBlind as Hex);
    expect(row.creatorCommitment).toBe(commitment);
    expect(row.creatorCommitment).not.toBe(unblindedCommitment(X_USER_ID, row.nonce));
    expect(pubkeyToBase58(dropPda(hexToBytes(commitment), row.nonce).address)).toBe(address);
  });

  it("every drop gets its own blind, on either chain", async () => {
    const { harness: h, headers } = await world();
    const addresses = [
      (await create(h, headers, evmBody)).address,
      (await create(h, headers, evmBody)).address,
      (await create(h, headers, solBody)).address,
    ];
    const blinds = await Promise.all(
      addresses.map(async (a) => (await rowOf(h, a)).commitmentBlind),
    );
    expect(new Set(blinds).size).toBe(3);
  });

  it("the blind never reaches a log line", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    const { harness: h, headers } = await world();
    const { address } = await create(h, headers, evmBody);
    const blind = (await rowOf(h, address)).commitmentBlind as string;
    expect(lines.join("\n")).not.toContain(blind.slice(2));
  });
});

describe("no route answers with the blind", () => {
  it("the create answer, the detail, the manifest, the live snapshot, the list and the profile", async () => {
    const { harness: h, headers } = await world();
    const created = await create(h, headers, evmBody);
    const blind = ((await rowOf(h, created.address)).commitmentBlind as string).slice(2);

    const texts = [created.text];
    for (const path of [
      `/api/drops/${created.address}`,
      `/api/drops/${created.address}/manifest`,
      "/api/drops?chain=solana",
      "/api/users/dropchadfun",
      "/api/me",
    ]) {
      const response = await h.app.request(path, { headers: { cookie: headers["cookie"] ?? "" } });
      texts.push(await response.text());
    }
    const live = await h.app.request(`/api/drops/${created.address}/live`);
    const reader = (live.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    await reader.cancel();
    texts.push(new TextDecoder().decode(first.value));

    for (const text of texts) expect(text.toLowerCase()).not.toContain(blind);
  });
});

describe("the boards match the stored commitment, blinded or not", () => {
  const NOW = new Date("2026-09-29T12:00:00.000Z");
  const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  const BLINDED = addr(0x901);
  const OLD = addr(0x902);
  const BLIND = `0x${"b1".repeat(32)}` as const;

  const row = (address: string, nonce: bigint, commitment: string, blind: string | null) => ({
    address,
    mode: "handle" as const,
    chainId: 46630,
    chainKey: "robinhood-testnet",
    xUserId: "42",
    nonce,
    creatorCommitment: commitment,
    commitmentBlind: blind,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "20000000000000000",
    feeAmount: "0",
    grossRequired: "20000000000000000",
    leafCount: 2,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    state: "active",
    paidCount: 2,
    createTxHash: `0x${"55".repeat(32)}`,
    priceUsd: "3000",
    pricedAt: NOW,
    createdAt: new Date(NOW.getTime() - 3_600_000),
  });

  it("a blinded handle drop and an old unblinded one both count, two drops, four people", async () => {
    const blinded = creatorCommitment(42n, 1n, BLIND);
    const old = unblindedCommitment(42n, 0n);
    const board: BoardDrop[] = [
      {
        address: BLINDED,
        creatorCommitment: blinded,
        createdAt: String(Math.floor(NOW.getTime() / 1000) - 3600),
        claimedFinalWei: "20000000000000000",
        claimedCountFinal: 2,
        recipients: [addr(0xa1), addr(0xa2)],
        claimedIndexes: [0, 1],
      },
      {
        address: OLD,
        creatorCommitment: old,
        createdAt: String(Math.floor(NOW.getTime() / 1000) - 3600),
        claimedFinalWei: "20000000000000000",
        claimedCountFinal: 2,
        recipients: [addr(0xb1), addr(0xb2)],
        claimedIndexes: [0, 1],
      },
    ];
    const h = await createHarness({ indexer: { boardDrops: board } });
    harness = h;
    h.setNow(NOW);
    await h.deps.db
      .insert(profiles)
      .values({ xUserId: "42", handle: "blinder", displayName: "Blinder", profileImageUrl: null });
    await h.deps.db
      .insert(drops)
      .values([row(BLINDED, 1n, blinded, BLIND), row(OLD, 0n, old, null)]);
    await h.deps.db.insert(dropHandleLeaves).values(
      [BLINDED, OLD].flatMap((dropAddress, d) =>
        [0, 1].map((leafIndex) => ({
          dropAddress,
          leafIndex,
          xUserId: String(9000 + d * 10 + leafIndex),
          amount: "10000000000000000",
        })),
      ),
    );

    const response = await h.app.request("/api/boards?range=all");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: { profile: { handle: string }; dropCount: number; uniqueReceivers: number }[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      profile: { handle: "blinder" },
      dropCount: 2,
      uniqueReceivers: 4,
    });
  });
});
