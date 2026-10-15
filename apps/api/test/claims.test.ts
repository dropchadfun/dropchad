/**
 * `GET /api/claims`, the receiver's list.
 *
 * - signed in only; the handle drops with a leaf for **this** X id, newest first
 * - never a multisend, never another receiver's leaf, never the blind, never another X id
 * - one state per item, in this order of truth: `paid` (our binding says so), `ended` (the
 *   window closed or the drop was cancelled, not paid), `not_funded` (still `Created`),
 *   `paused` (handle mode off on that chain), `sending` (bound or submitted), `failed` (a new
 *   address allowed), `claimable`
 * - `freshLoginSecondsLeft`: how long a bind is still allowed
 */
import { getAddress, type Address } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { dropPda, bitmapPda } from "../src/chain/svm/pda.js";
import { pubkeyFromBase58, pubkeyToBase58 } from "../src/chain/svm/pubkey.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { getChain } from "@dropchad/chains";
import { dropHandleLeaves, drops, handleBindings, profiles } from "../src/db/schema.js";
import type { SvmRpc } from "../src/chain/svm/rpc.js";
import { createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";
import {
  FakeSvm,
  createFakeSvmRpc,
  encodeBitmapAccount,
  encodeDropAccount,
  rentFor,
  type FakeDrop,
} from "./fake-svm.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV, TEST_SOL_BINDER_PUBKEY } from "./test-binders.js";

/** The receiver, signed in. Every drop here was made by `SENDER`. */
const ME = { id: "44196397", username: "alice", name: "alice" };
const OTHER_RECEIVER = "783214";
const SENDER = "1600000000000000000";

const LOGIN_AT = new Date("2026-09-30T12:00:00.000Z");
const NOW_SECONDS = BigInt(Math.floor(LOGIN_AT.getTime() / 1000));
const OPEN = NOW_SECONDS + 86_400n * 10n; // the claim window closes in ten days
const CLOSED = NOW_SECONDS - 60n;

const evm = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const CLAIMABLE = evm(0xc001);
const SENDING = evm(0xc002);
const SUBMITTED = evm(0xc003);
const PAID = evm(0xc004);
const FAILED = evm(0xc005);
const ENDED = evm(0xc006);
const NOT_FUNDED = evm(0xc007);
const CANCELLED = evm(0xc008);
const PAID_AFTER_END = evm(0xc009);
const NOT_MINE = evm(0xc00a);
const MULTISEND = evm(0xc00b);
const WALLET = "0x1111111111111111111111111111111111110001";

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** A ready V2 chain: `DropFactoryV2` recorded and our binder live, so handle mode is on. */
function readyEvm(chain: FakeChain): ChainAdapter {
  return { ...evmAdapterFor(chain), handleModeReady: () => Promise.resolve(true) };
}

async function world(
  options: {
    adapters?: ChainAdapter[];
    chain?: FakeChain;
    env?: Record<string, string>;
    loginAt?: Date;
  } = {},
): Promise<{ h: Harness; cookie: string; chain: FakeChain }> {
  const chain = options.chain ?? createFakeChain();
  const adapters = options.adapters ?? [readyEvm(chain)];
  const h = await createHarness({
    writeSides: adaptersFrom(adapters, adapters[0]?.chainKey ?? "robinhood-testnet"),
    env: options.env ?? { ...TEST_BINDER_ENV },
    user: ME,
  });
  harness = h;
  h.setNow(options.loginAt ?? LOGIN_AT);
  await h.deps.db.insert(profiles).values({
    xUserId: SENDER,
    handle: "sender",
    displayName: "the sender",
    profileImageUrl: "https://pbs.twimg.com/profile_images/sender.png",
  });
  const { jar } = await login(h);
  h.setNow(LOGIN_AT);
  return { h, cookie: cookieHeader(jar), chain };
}

let order = 0;
async function handleDrop(
  h: Harness,
  args: {
    address: string;
    chainKey?: string;
    chainId?: number;
    mode?: "handle" | "address";
    leafFor?: string;
    amount?: string;
    title?: string | null;
  },
): Promise<void> {
  order += 1;
  const address = args.address;
  await h.deps.db.insert(drops).values({
    address: args.chainKey === "solana-devnet" ? address : address.toLowerCase(),
    chainId: args.chainId ?? 46630,
    chainKey: args.chainKey ?? "robinhood-testnet",
    xUserId: SENDER,
    nonce: BigInt(order),
    creatorCommitment: `0x${order.toString(16).padStart(64, "0")}`,
    commitmentBlind: `0x${"b1".repeat(32)}`,
    salt: null,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"11".repeat(32)}`,
    manifestHash: `0x${"22".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "30000000000000000",
    feeAmount: "0",
    grossRequired: "30000000000000000",
    leafCount: 3,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    title: args.title ?? null,
    mode: args.mode ?? "handle",
    state: "active",
    createTxHash: "0x01",
    // Newest first in the answer: each seeded drop is a minute newer than the one before.
    createdAt: new Date(LOGIN_AT.getTime() - 3_600_000 + order * 60_000),
  });
  if ((args.mode ?? "handle") === "handle") {
    await h.deps.db.insert(dropHandleLeaves).values(
      [
        {
          dropAddress: address.toLowerCase(),
          leafIndex: 0,
          xUserId: args.leafFor ?? ME.id,
          amount: args.amount ?? "10000000000000000",
        },
        {
          dropAddress: address.toLowerCase(),
          leafIndex: 1,
          xUserId: OTHER_RECEIVER,
          amount: "20000000000000000",
        },
      ].map((l) => (args.chainKey === "solana-devnet" ? { ...l, dropAddress: address } : l)),
    );
  }
}

async function binding(
  h: Harness,
  address: string,
  state: "bound" | "submitted" | "paid" | "failed",
  extra: { claimTxHash?: string; lastError?: string } = {},
): Promise<void> {
  await h.deps.db.insert(handleBindings).values({
    dropAddress: address.toLowerCase(),
    leafIndex: 0,
    xUserId: ME.id,
    recipient: WALLET,
    binderSignature: `0x${"ab".repeat(65)}`,
    state,
    claimTxHash: extra.claimTxHash ?? null,
    lastError: extra.lastError ?? null,
  });
}

function onChain(chain: FakeChain, address: string, status: number, deadline: bigint): void {
  chain.setStatus(address as Address, status);
  chain.setClaimDeadline(address as Address, deadline);
}

interface Claim {
  drop: string;
  chainKey: string;
  chainId: number;
  title: string | null;
  sender: { handle: string; displayName: string; profileImageUrl: string | null } | null;
  amount: string;
  symbol: string;
  decimals: number;
  index: number;
  claimDeadline: string | null;
  state: string;
  recipient: string | null;
  claimTxHash: string | null;
}

async function claims(
  h: Harness,
  cookie: string,
): Promise<{ text: string; body: { claims: Claim[]; freshLoginSecondsLeft: number } }> {
  const response = await h.app.request("/api/claims", { headers: { cookie } });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return { text, body: JSON.parse(text) as { claims: Claim[]; freshLoginSecondsLeft: number } };
}

const stateOf = (list: Claim[], address: string) =>
  list.find((c) => c.drop.toLowerCase() === address.toLowerCase())?.state;

describe("GET /api/claims, who may ask", () => {
  it("is 401 signed out", async () => {
    const h = await createHarness();
    harness = h;
    const response = await h.app.request("/api/claims");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});

describe("GET /api/claims, what is listed", () => {
  it("only my leaves on handle drops: never a multisend, never a drop without my leaf", async () => {
    const { h, cookie, chain } = await world();
    await handleDrop(h, { address: CLAIMABLE });
    await handleDrop(h, { address: NOT_MINE, leafFor: "999" });
    await handleDrop(h, { address: MULTISEND, mode: "address" });
    for (const a of [CLAIMABLE, NOT_MINE, MULTISEND]) onChain(chain, a, 1, OPEN);

    const { body } = await claims(h, cookie);
    expect(body.claims.map((c) => c.drop.toLowerCase())).toEqual([CLAIMABLE.toLowerCase()]);
  });

  it("an item carries the drop, the sender, my amount and index, never another receiver", async () => {
    const { h, cookie, chain } = await world();
    await handleDrop(h, { address: CLAIMABLE, amount: "10000000000000000", title: "gm chads" });
    onChain(chain, CLAIMABLE, 1, OPEN);

    const { body, text } = await claims(h, cookie);
    expect(body.claims[0]).toMatchObject({
      chainKey: "robinhood-testnet",
      chainId: 46630,
      title: "gm chads",
      sender: {
        handle: "sender",
        displayName: "the sender",
        profileImageUrl: "https://pbs.twimg.com/profile_images/sender.png",
      },
      amount: "10000000000000000",
      symbol: "ETH",
      decimals: 18,
      index: 0,
      claimDeadline: OPEN.toString(),
      state: "claimable",
      recipient: null,
      claimTxHash: null,
    });
    // The other receiver's leaf, X id and amount, and the commitment blind, are never in it.
    expect(text).not.toContain(OTHER_RECEIVER);
    expect(text).not.toContain("20000000000000000");
    expect(text).not.toContain("b1".repeat(32));
  });

  it("lists newest first", async () => {
    const { h, cookie, chain } = await world();
    await handleDrop(h, { address: CLAIMABLE });
    await handleDrop(h, { address: FAILED });
    await handleDrop(h, { address: PAID });
    for (const a of [CLAIMABLE, FAILED, PAID]) onChain(chain, a, 1, OPEN);
    await binding(h, FAILED, "failed");
    await binding(h, PAID, "paid", { claimTxHash: "0xfeed" });

    const { body } = await claims(h, cookie);
    expect(body.claims.map((c) => c.drop.toLowerCase())).toEqual(
      [PAID, FAILED, CLAIMABLE].map((a) => a.toLowerCase()),
    );
  });

  it("is an empty list, not an error, when nothing was dropped on me", async () => {
    const { h, cookie } = await world();
    const { body } = await claims(h, cookie);
    expect(body.claims).toEqual([]);
  });
});

describe("GET /api/claims, the state of each item", () => {
  it("claimable, sending, paid, failed, ended, not funded", async () => {
    const { h, cookie, chain } = await world();
    for (const address of [
      CLAIMABLE,
      SENDING,
      SUBMITTED,
      PAID,
      FAILED,
      ENDED,
      NOT_FUNDED,
      CANCELLED,
      PAID_AFTER_END,
    ]) {
      await handleDrop(h, { address });
    }
    onChain(chain, CLAIMABLE, 1, OPEN);
    onChain(chain, SENDING, 1, OPEN);
    onChain(chain, SUBMITTED, 1, OPEN);
    onChain(chain, PAID, 1, OPEN);
    onChain(chain, FAILED, 1, OPEN);
    onChain(chain, ENDED, 1, CLOSED);
    onChain(chain, NOT_FUNDED, 0, 0n);
    onChain(chain, CANCELLED, 3, 0n);
    onChain(chain, PAID_AFTER_END, 1, CLOSED);
    await binding(h, SENDING, "bound");
    await binding(h, SUBMITTED, "submitted");
    await binding(h, PAID, "paid", { claimTxHash: "0xfeed" });
    await binding(h, FAILED, "failed", { lastError: "execution reverted: something raw" });
    await binding(h, PAID_AFTER_END, "paid", { claimTxHash: "0xbeef" });

    const { body, text } = await claims(h, cookie);
    const list = body.claims;
    expect(stateOf(list, CLAIMABLE)).toBe("claimable");
    expect(stateOf(list, SENDING)).toBe("sending");
    expect(stateOf(list, SUBMITTED)).toBe("sending");
    expect(stateOf(list, PAID)).toBe("paid");
    expect(stateOf(list, FAILED)).toBe("failed");
    expect(stateOf(list, ENDED)).toBe("ended");
    expect(stateOf(list, NOT_FUNDED)).toBe("not_funded");
    expect(stateOf(list, CANCELLED)).toBe("ended");
    // Paid is paid, whatever the window did afterwards.
    expect(stateOf(list, PAID_AFTER_END)).toBe("paid");

    const paid = list.find((c) => c.drop.toLowerCase() === PAID.toLowerCase());
    expect(paid).toMatchObject({ recipient: WALLET, claimTxHash: "0xfeed" });
    const sending = list.find((c) => c.drop.toLowerCase() === SENDING.toLowerCase());
    expect(sending?.recipient).toBe(WALLET);
    // The raw error stays in our table and the log, never in an answer.
    expect(text).not.toContain("something raw");
  });

  it("paused when handle mode is off on the drop's chain: our binder not live", async () => {
    const chain = createFakeChain();
    chain.setBinderLive(false);
    const { h, cookie } = await world({ chain });
    await handleDrop(h, { address: CLAIMABLE });
    await handleDrop(h, { address: SENDING });
    await handleDrop(h, { address: PAID });
    await handleDrop(h, { address: ENDED });
    for (const a of [CLAIMABLE, SENDING, PAID]) onChain(chain, a, 1, OPEN);
    onChain(chain, ENDED, 1, CLOSED);
    await binding(h, SENDING, "bound");
    await binding(h, PAID, "paid", { claimTxHash: "0xfeed" });

    const list = (await claims(h, cookie)).body.claims;
    expect(stateOf(list, CLAIMABLE)).toBe("paused");
    expect(stateOf(list, SENDING)).toBe("paused");
    // Paid and ended are facts, a pause does not change them.
    expect(stateOf(list, PAID)).toBe("paid");
    expect(stateOf(list, ENDED)).toBe("ended");
  });

  it("paused when there is no binder key for the chain", async () => {
    const chain = createFakeChain();
    const { h, cookie } = await world({ chain, env: {} });
    await handleDrop(h, { address: CLAIMABLE });
    onChain(chain, CLAIMABLE, 1, OPEN);
    expect(stateOf((await claims(h, cookie)).body.claims, CLAIMABLE)).toBe("paused");
  });

  it("a chain that cannot be read: 200, its drops left out and named unavailable", async () => {
    const chain = createFakeChain();
    const broken: ChainAdapter = {
      ...readyEvm(chain),
      readDrop: () => Promise.reject(new Error("rpc down")),
    };
    const { h, cookie } = await world({ chain, adapters: [broken] });
    await handleDrop(h, { address: CLAIMABLE });
    const response = await h.app.request("/api/claims", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      claims: [],
      unavailable: ["robinhood-testnet"],
    });
  });

  it("every chain read: unavailable is empty", async () => {
    const { h, cookie } = await world();
    await handleDrop(h, { address: CLAIMABLE });
    const response = await h.app.request("/api/claims", { headers: { cookie } });
    expect(await response.json()).toMatchObject({ unavailable: [] });
  });

  it("nothing dropped on me: unavailable is empty too", async () => {
    const { h, cookie } = await world();
    const response = await h.app.request("/api/claims", { headers: { cookie } });
    expect(await response.json()).toMatchObject({ claims: [], unavailable: [] });
  });
});

describe("GET /api/claims, the fresh login", () => {
  it("says how long a bind is still allowed after the X login, 10 minutes", async () => {
    // Logged in four minutes before `LOGIN_AT`: six minutes left.
    const { h, cookie } = await world({ loginAt: new Date(LOGIN_AT.getTime() - 240_000) });
    expect((await claims(h, cookie)).body.freshLoginSecondsLeft).toBe(360);
  });

  it("is zero once the ten minutes are over, never negative", async () => {
    const { h, cookie } = await world({ loginAt: new Date(LOGIN_AT.getTime() - 3_600_000) });
    expect((await claims(h, cookie)).body.freshLoginSecondsLeft).toBe(0);
  });
});

describe("GET /api/claims on Solana", () => {
  const LEAF = 10_000_000n;

  async function solanaWorld(
    migrated: boolean,
    options: { drops?: number; wrap?: (rpc: SvmRpc) => SvmRpc } = {},
  ) {
    const signer = randomSigner();
    const svm = new FakeSvm({
      relayer: signer.publicKey,
      defaultFeeBps: 100,
      ...(migrated ? { binder: TEST_SOL_BINDER_PUBKEY } : {}),
    });
    const rpc = (options.wrap ?? ((r: SvmRpc) => r))(createFakeSvmRpc(svm));
    const relayer = createSvmRelayer({
      rpc,
      signer,
      isKnownDrop: () => Promise.resolve(true),
      budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
      caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
      rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
      sleep: () => Promise.resolve(),
    });
    const adapter = createSvmAdapter({
      rpc,
      relayer,
      chain: getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"],
    });
    const evmChain = createFakeChain();
    const { h, cookie } = await world({ chain: evmChain, adapters: [readyEvm(evmChain), adapter] });
    const addresses: string[] = [];
    for (let n = 1; n <= (options.drops ?? 1); n++) {
      addresses.push(await seedSolanaDrop(h, svm, BigInt(n)));
    }
    return { h, cookie, address: addresses[0] as string, addresses, evmChain };
  }

  async function seedSolanaDrop(h: Harness, svm: FakeSvm, nonce: bigint): Promise<string> {
    const commitment = new Uint8Array(32).fill(0x5a);
    const pda = dropPda(commitment, nonce);
    const bitmap = bitmapPda(pda.address);
    const address = pubkeyToBase58(pda.address);
    const drop: FakeDrop = {
      asset: new Uint8Array(32),
      vault: new Uint8Array(32),
      merkleRoot: new Uint8Array(32).fill(0x11),
      manifestHash: new Uint8Array(32).fill(0x22),
      totalEntitlements: LEAF * 2n,
      grossRequired: LEAF * 2n,
      feeAmount: 0n,
      feeWallet: svm.feeWallet,
      refundRecipient: pubkeyFromBase58("HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH"),
      fundingDeadline: NOW_SECONDS + 604_800n,
      claimPeriod: 2_592_000,
      creatorCommitment: commitment,
      nonce,
      leafCount: 2,
      chainId: 103n,
      rentPayer: svm.relayer,
      createdAt: NOW_SECONDS - 600n,
      bump: pda.bump,
      bitmapBump: bitmap.bump,
      activatedAt: NOW_SECONDS - 300n,
      claimDeadline: OPEN,
      status: 1,
      totalClaimed: 0n,
      claimedCount: 0,
      closed: false,
    };
    svm.accounts.set(address, {
      lamports: rentFor(424) + LEAF * 2n,
      owner: pubkeyFromBase58("EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft"),
      data: encodeDropAccount(drop),
    });
    svm.accounts.set(pubkeyToBase58(bitmap.address), {
      lamports: rentFor(1291),
      owner: pubkeyFromBase58("EQatKw7fYigPCJXTc5pYsQQCDJn5XNdqg7AtZJX8n5Ft"),
      data: encodeBitmapAccount(pda.address, bitmap.bump, new Uint8Array(1250)),
    });
    await handleDrop(h, {
      address,
      chainKey: "solana-devnet",
      chainId: 103,
      amount: LEAF.toString(),
    });
    return address;
  }

  /** Records every rpc call with its first argument; `fail` makes the named methods throw. */
  function recording(fail: ReadonlySet<string> = new Set()) {
    const calls: { method: string; keys: string[] }[] = [];
    const wrap = (rpc: SvmRpc): SvmRpc =>
      new Proxy(rpc, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof key !== "string" || typeof value !== "function") return value;
          return (...args: unknown[]) => {
            const first = args[0];
            const keys = Array.isArray(first)
              ? first.map((k) => pubkeyToBase58(k as Uint8Array))
              : first instanceof Uint8Array
                ? [pubkeyToBase58(first)]
                : [];
            calls.push({ method: key, keys });
            if (fail.has(key)) return Promise.reject(new Error(`${key}: http 429`));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    return { calls, wrap };
  }

  it("reads 5 Solana drops in one batched call, never one call per drop", async () => {
    const rec = recording();
    const { h, cookie, addresses } = await solanaWorld(true, { drops: 5, wrap: rec.wrap });
    rec.calls.length = 0;
    const list = (await claims(h, cookie)).body.claims;
    expect(list).toHaveLength(5);
    const touching = rec.calls.filter((call) => call.keys.some((k) => addresses.includes(k)));
    expect(touching).toHaveLength(1);
    expect(touching[0]?.method).toBe("getMultipleAccounts");
    expect([...(touching[0]?.keys ?? [])].sort()).toEqual([...addresses].sort());
  });

  it("handle mode is read once per chain, never once per drop", async () => {
    const rec = recording();
    const { h, cookie } = await solanaWorld(true, { drops: 5, wrap: rec.wrap });
    rec.calls.length = 0;
    const list = (await claims(h, cookie)).body.claims;
    expect(list.map((c) => c.state)).toEqual(Array(5).fill("claimable"));
    // The Config account twice (ready, then the live binder) for the chain, not ten times.
    expect(rec.calls.filter((call) => call.method === "getAccountInfo")).toHaveLength(2);
  });

  it("Solana down: the EVM drops still listed, Solana named unavailable", async () => {
    const rec = recording(new Set(["getAccountInfo", "getMultipleAccounts"]));
    const { h, cookie } = await solanaWorld(true, { drops: 2, wrap: rec.wrap });
    await handleDrop(h, { address: CLAIMABLE });
    const response = await h.app.request("/api/claims", { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      claims: { drop: string }[];
      unavailable: string[];
    };
    expect(body.claims.map((c) => c.drop)).toEqual([CLAIMABLE]);
    expect(body.unavailable).toEqual(["solana-devnet"]);
  });

  it("a Solana handle drop is listed in SOL, claimable with a migrated Config and our binder", async () => {
    const { h, cookie, address } = await solanaWorld(true);
    const list = (await claims(h, cookie)).body.claims;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      drop: address,
      chainKey: "solana-devnet",
      symbol: "SOL",
      decimals: 9,
      amount: LEAF.toString(),
      state: "claimable",
      claimDeadline: OPEN.toString(),
    });
  });

  it("paused on an unmigrated Config: no binder on chain", async () => {
    const { h, cookie, address } = await solanaWorld(false);
    expect(stateOf((await claims(h, cookie)).body.claims, address)).toBe("paused");
  });
});
