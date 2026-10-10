/**
 * the worker for Robinhood token drops and the auto cancel.
 * - funding: an EVM token drop is funded only when it holds the token `>= grossRequired` **and**
 *   ETH `>= nativeFee`, read from the drop and the chain; one part alone is not funded
 * - auto cancel: past the funding time (the deadline read from the drop) a drop that still holds
 *   any of its token or any ETH gets `cancelUnfunded` from our relayer; an empty one gets nothing.
 *   Every EVM drop, a native one too
 * - refund: after the claim time when the drop holds any of its token or any ETH
 * - the adapter: the real `fundingDeadline`, `fundingStatus`, `holdsAnything`, `cancelUnfunded`
 * - the relayer: `cancelUnfunded` is the seventh call, only to a drop we created
 *
 * A fake chain plays `DropFactoryV3` (version 3). V3 itself stays off in `packages/chains`.
 */
import { dropV1Abi, dropV3Abi } from "@dropchad/shared";
import {
  getAbiItem,
  getAddress,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { singleAdapter } from "../src/chain/adapter.js";
import {
  ALLOWED_SELECTORS,
  GasBudgetExceededError,
  RelayerRefusedError,
  createRelayer,
  type GasBudget,
  type RelayerTransport,
} from "../src/chain/relayer.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropJobs, drops, profiles } from "../src/db/schema.js";
import { createDropEventBus, type DropEvent } from "../src/worker/events.js";
import { createWorker, type Worker } from "../src/worker/worker.js";
import { FAKE_CHAIN_ID, createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";

const DROP = getAddress("0x00000000000000000000000000000000000d0000");
const TEST = getAddress("0x7e57000000000000000000000000000000007e57");
const REFUND = getAddress("0x000000000000000000000000000000000000dEaD");
const TOKENS = 1_000n * 10n ** 18n;
const FEE = 2_000_000_000_000_000n;
/** 2026-09-11T10:00:00Z, the worker's clock, in seconds. */
const NOW = 1_789_120_800n;
const PAST = NOW - 60n;
const FUTURE = NOW + 86_400n;

let handle: DatabaseHandle;
let chain: FakeChain;
let worker: Worker;
let seen: DropEvent[];

beforeEach(async () => {
  handle = await openAndMigrate("memory://");
  chain = createFakeChain({ version: 3 });
  seen = [];
  const events = createDropEventBus();
  events.subscribe(DROP, (event) => seen.push(event));
  worker = createWorker({
    db: handle.db,
    chains: singleAdapter(evmAdapterFor(chain)),
    events,
    now: () => new Date(Number(NOW) * 1000),
    pollMs: 5_000,
  });
  return () => handle.close();
});

/** A row as the api writes it: the `0018` columns reused, the ETH fee in wei. */
async function seed(args: {
  token: boolean;
  state: string;
  job: "watch_funding" | "settle";
  status: number;
  fundingDeadline: bigint;
}): Promise<void> {
  await handle.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
  await handle.db.insert(drops).values({
    address: DROP.toLowerCase(),
    chainId: FAKE_CHAIN_ID,
    chainKey: "robinhood-testnet",
    xUserId: "1",
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: args.token ? TEST.toLowerCase() : zeroAddress,
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: JSON.stringify({
      version: 2,
      mode: "handle",
      entries: [{ index: 0, xId: "44196397", amount: TOKENS.toString(), proof: [] }],
    }),
    totalEntitlements: TOKENS.toString(),
    feeAmount: "0",
    grossRequired: TOKENS.toString(),
    leafCount: 1,
    refundRecipient: REFUND,
    // The row's copy. The worker's `settle` reads the drop's own.
    fundingDeadline: args.fundingDeadline,
    claimPeriod: 2_592_000,
    mode: "handle",
    state: args.state,
    failedIndexes: [],
    createTxHash: `0x${"55".repeat(32)}`,
    ...(args.token
      ? {
          tokenProgram: "erc20",
          tokenDecimals: 18,
          tokenName: "Test Coin",
          tokenSymbol: "TEST",
          vault: DROP.toLowerCase(),
          solFeeLamports: FEE.toString(),
          accountBudgetLamports: "0",
        }
      : {}),
  });
  await handle.db.insert(dropJobs).values({
    dropAddress: DROP.toLowerCase(),
    kind: args.job,
    state: "ready",
    runAfter: new Date(Number(NOW) * 1000),
  });
  chain.setStatus(DROP, args.status);
  chain.setDropFields(DROP, {
    asset: args.token ? TEST : zeroAddress,
    grossRequired: TOKENS,
    nativeFee: args.token ? FEE : 0n,
    fundingDeadline: args.fundingDeadline,
  });
}

const job = async (kind: string) =>
  (await handle.db.select().from(dropJobs)).find((j) => j.kind === kind);
const row = async () => (await handle.db.select().from(drops))[0];

describe("funding of an EVM token drop", () => {
  it("only the tokens is not funded: it stays waiting and nothing is activated", async () => {
    await seed({
      token: true,
      state: "created",
      job: "watch_funding",
      status: 0,
      fundingDeadline: FUTURE,
    });
    chain.setTokenBalance(TEST, DROP, TOKENS);
    await worker.tick();
    expect((await row())?.state).toBe("created");
    expect(chain.activations).toHaveLength(0);
    expect((await job("watch_funding"))?.state).toBe("ready");
  });

  it("only the ETH fee is not funded either", async () => {
    await seed({
      token: true,
      state: "created",
      job: "watch_funding",
      status: 0,
      fundingDeadline: FUTURE,
    });
    chain.setBalance(DROP, FEE);
    await worker.tick();
    expect((await row())?.state).toBe("created");
    expect(chain.activations).toHaveLength(0);
  });

  it("the tokens and the ETH fee: funded, then activated, funding_seen carries tokenAmount", async () => {
    await seed({
      token: true,
      state: "created",
      job: "watch_funding",
      status: 0,
      fundingDeadline: FUTURE,
    });
    chain.setTokenBalance(TEST, DROP, TOKENS);
    chain.setBalance(DROP, FEE);
    await worker.tick();
    expect((await row())?.state).toBe("funded");
    expect(seen.find((e) => e.type === "funding_seen")).toEqual({
      type: "funding_seen",
      drop: DROP,
      balanceWei: FEE.toString(),
      tokenAmount: TOKENS.toString(),
    });
    await worker.tick();
    expect(chain.activations).toEqual([DROP]);
  });

  it("one wei of ETH short of the fee is not funded", async () => {
    await seed({
      token: true,
      state: "created",
      job: "watch_funding",
      status: 0,
      fundingDeadline: FUTURE,
    });
    chain.setTokenBalance(TEST, DROP, TOKENS);
    chain.setBalance(DROP, FEE - 1n);
    await worker.tick();
    expect((await row())?.state).toBe("created");
  });
});

describe("auto cancel past the funding time", () => {
  it("a token drop holding only tokens: one cancelUnfunded, everything back to the refund address", async () => {
    await seed({
      token: true,
      state: "created",
      job: "watch_funding",
      status: 0,
      fundingDeadline: PAST,
    });
    chain.setTokenBalance(TEST, DROP, TOKENS / 2n);
    await worker.drain();
    expect((await row())?.state).toBe("funding_expired");
    expect(chain.cancels).toEqual([DROP]);
    expect(chain.refundedTo(DROP)).toBe(REFUND);
    expect(await chain.tokenBalance(TEST, DROP)).toBe(0n);
    expect((await row())?.settleTxHash).toMatch(/^0x/);
    expect((await job("settle"))?.state).toBe("done");
  });

  it("a token drop holding only ETH is cancelled too", async () => {
    await seed({
      token: true,
      state: "created",
      job: "watch_funding",
      status: 0,
      fundingDeadline: PAST,
    });
    chain.setBalance(DROP, FEE);
    await worker.drain();
    expect(chain.cancels).toEqual([DROP]);
    expect(await chain.getBalance(DROP)).toBe(0n);
  });

  it("an empty drop gets nothing sent, and the job ends", async () => {
    await seed({
      token: true,
      state: "created",
      job: "watch_funding",
      status: 0,
      fundingDeadline: PAST,
    });
    await worker.drain();
    expect((await row())?.state).toBe("funding_expired");
    expect(chain.cancels).toHaveLength(0);
    expect((await job("settle"))?.state).toBe("done");
  });

  it("an ETH drop past its funding time, holding less than grossRequired, is cancelled too", async () => {
    await seed({
      token: false,
      state: "created",
      job: "watch_funding",
      status: 0,
      fundingDeadline: PAST,
    });
    chain.setBalance(DROP, TOKENS / 2n);
    await worker.drain();
    expect(chain.cancels).toEqual([DROP]);
    expect(await chain.getBalance(DROP)).toBe(0n);
  });

  it("settle reads the deadline from the drop, not the row: still open on chain, nothing sent", async () => {
    await seed({
      token: true,
      state: "funding_expired",
      job: "settle",
      status: 0,
      fundingDeadline: PAST,
    });
    chain.setDropFields(DROP, { fundingDeadline: FUTURE });
    chain.setTokenBalance(TEST, DROP, TOKENS);
    await worker.tick();
    expect(chain.cancels).toHaveLength(0);
    expect((await job("settle"))?.runAfter.getTime()).toBe(Number(FUTURE + 1n) * 1000);
  });

  it("a drop somebody else cancelled first: nothing sent, the job ends", async () => {
    await seed({
      token: true,
      state: "funding_expired",
      job: "settle",
      status: 3,
      fundingDeadline: PAST,
    });
    await worker.drain();
    expect(chain.cancels).toHaveLength(0);
    expect((await job("settle"))?.state).toBe("done");
  });
});

describe("refund of an EVM token drop", () => {
  it("only tokens left and no ETH: refund is still sent", async () => {
    await seed({
      token: true,
      state: "claims_expired",
      job: "settle",
      status: 1,
      fundingDeadline: PAST,
    });
    chain.setClaimDeadline(DROP, PAST);
    chain.setTokenBalance(TEST, DROP, TOKENS / 4n);
    await worker.drain();
    expect(chain.refunds).toEqual([DROP]);
    expect(await chain.tokenBalance(TEST, DROP)).toBe(0n);
  });

  it("only ETH left: refund is sent", async () => {
    await seed({
      token: true,
      state: "claims_expired",
      job: "settle",
      status: 1,
      fundingDeadline: PAST,
    });
    chain.setClaimDeadline(DROP, PAST);
    chain.setBalance(DROP, 1n);
    await worker.drain();
    expect(chain.refunds).toEqual([DROP]);
  });

  it("nothing left: no refund, as before", async () => {
    await seed({ token: true, state: "finished", job: "settle", status: 1, fundingDeadline: PAST });
    chain.setClaimDeadline(DROP, PAST);
    await worker.drain();
    expect(chain.refunds).toHaveLength(0);
    expect((await job("settle"))?.state).toBe("done");
  });
});

describe("the EVM adapter", () => {
  it("can cancel and refund, not close", () => {
    expect(evmAdapterFor(chain).capabilities).toEqual({
      refund: true,
      cancelUnfunded: true,
      close: false,
      handleClaims: true,
    });
  });

  it("readDrop carries the drop's own fundingDeadline, never 0", async () => {
    chain.setDropFields(DROP, { fundingDeadline: FUTURE });
    expect((await evmAdapterFor(chain).readDrop(DROP)).fundingDeadline).toBe(FUTURE);
  });

  it("fundingStatus of a token drop reads the token and the ETH from the chain", async () => {
    chain.setDropFields(DROP, { asset: TEST, grossRequired: TOKENS, nativeFee: FEE });
    chain.setTokenBalance(TEST, DROP, TOKENS);
    chain.setBalance(DROP, FEE);
    const adapter = evmAdapterFor(chain);
    expect(await adapter.fundingStatus?.(DROP)).toEqual({
      funded: true,
      lamports: FEE,
      tokenAmount: TOKENS,
    });
    chain.setTokenBalance(TEST, DROP, TOKENS - 1n);
    expect((await adapter.fundingStatus?.(DROP))?.funded).toBe(false);
  });

  it("fundingStatus of a native drop is the ETH against grossRequired, no token", async () => {
    chain.setDropFields(DROP, { grossRequired: TOKENS });
    chain.setBalance(DROP, TOKENS);
    expect(await evmAdapterFor(chain).fundingStatus?.(DROP)).toEqual({
      funded: true,
      lamports: TOKENS,
      tokenAmount: null,
    });
  });

  it("holdsAnything: ETH or any of its token above zero", async () => {
    const adapter = evmAdapterFor(chain);
    chain.setDropFields(DROP, { asset: TEST });
    expect(await adapter.holdsAnything?.(DROP)).toBe(false);
    chain.setTokenBalance(TEST, DROP, 1n);
    expect(await adapter.holdsAnything?.(DROP)).toBe(true);
    chain.setTokenBalance(TEST, DROP, 0n);
    chain.setBalance(DROP, 1n);
    expect(await adapter.holdsAnything?.(DROP)).toBe(true);
  });

  it("cancelUnfunded goes through the gateway", async () => {
    chain.setBalance(DROP, 1n);
    const result = await evmAdapterFor(chain).cancelUnfunded(DROP);
    expect(result.txId).toMatch(/^0x/);
    expect(chain.cancels).toEqual([DROP]);
  });
});

// ---------------------------------------------------------------------------------------------
// The relayer, the seventh call
// ---------------------------------------------------------------------------------------------

const RELAYER = getAddress("0x000000000000000000000000000000000000be11");
const FACTORY = getAddress("0x00000000000000000000000000000000000fac70");

function transport(): RelayerTransport & { sent: { to: Address; data: Hex; value: bigint }[] } {
  const sent: { to: Address; data: Hex; value: bigint }[] = [];
  return {
    address: RELAYER,
    sent,
    pendingNonce: () => Promise.resolve(0),
    estimateGas: () => Promise.resolve(60_000n),
    maxFeePerGas: () => Promise.resolve(1_000_000_000n),
    send(tx) {
      sent.push({ to: tx.to, data: tx.data, value: tx.value });
      return Promise.resolve<Hex>(`0x${String(sent.length).padStart(64, "0")}`);
    },
    waitForReceipt: (hash) =>
      Promise.resolve({
        status: "success",
        transactionHash: hash,
        blockNumber: 1n,
        gasUsed: 50_000n,
        effectiveGasPrice: 1_000_000n,
        logs: [],
      }),
  };
}

function relayerWith(t: RelayerTransport, budget?: GasBudget) {
  return createRelayer({
    transport: t,
    factory: FACTORY,
    factoryVersion: 3,
    isKnownDrop: (address) => Promise.resolve(address.toLowerCase() === DROP.toLowerCase()),
    gasBudget: budget ?? { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    gasCaps: { createDrop: 2_000_000n, claimBatch: 3_000_000n, claimHandle: 300_000n },
  });
}

describe("cancelUnfunded, the seventh relayer call", () => {
  it("its selector is computed from the ABI, the same on DropV1 and DropV3", () => {
    expect(ALLOWED_SELECTORS.cancelUnfunded).toBe(
      toFunctionSelector(getAbiItem({ abi: dropV1Abi, name: "cancelUnfunded" })),
    );
    expect(ALLOWED_SELECTORS.cancelUnfunded).toBe(
      toFunctionSelector(getAbiItem({ abi: dropV3Abi, name: "cancelUnfunded" })),
    );
  });

  it("goes to a drop we created, with value zero and no arguments", async () => {
    const t = transport();
    await relayerWith(t).cancelUnfunded(DROP);
    expect(t.sent).toEqual([{ to: DROP, data: ALLOWED_SELECTORS.cancelUnfunded, value: 0n }]);
  });

  it("refuses a drop this api did not create, before anything is signed", async () => {
    const t = transport();
    await expect(relayerWith(t).cancelUnfunded(REFUND)).rejects.toThrow(RelayerRefusedError);
    expect(t.sent).toHaveLength(0);
  });

  it("is paid inside the daily gas budget: over it, nothing is sent", async () => {
    const t = transport();
    const budget: GasBudget = {
      reserve: (wei) => Promise.reject(new GasBudgetExceededError(wei, 0n)),
      settle: () => Promise.resolve(),
    };
    await expect(relayerWith(t, budget).cancelUnfunded(DROP)).rejects.toThrow(
      GasBudgetExceededError,
    );
    expect(t.sent).toHaveLength(0);
  });
});
