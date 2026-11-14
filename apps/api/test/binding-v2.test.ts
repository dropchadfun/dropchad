/**
 * Binding v2 in the api, the EVM side and the database.
 * - a v2 drop is one whose `implementation()` is `implementationV7`, read once and cached
 * - the bind route stores the wallet and signs nothing; the worker signs each send, `validUntil`
 *   the server's time plus 600, and writes `binding_valid_until` before the signature leaves
 * - a new wallet on a failed v2 binding only once the chain's time is past `binding_valid_until`
 *   and the bit is clear; a `null` `binding_valid_until` allows it once the bit is clear
 * - `BindingExpired` or `BindingTooLong` sends the binding back to `bound`, never `failed`
 * - the receiver's list: a v2 `failed` binding is `sending` until the chain's time passes
 *   `binding_valid_until`, then `failed`; never `stuck`
 * - migration `0026`: `binding_valid_until`, and `binder_signature` may be null
 * - the EVM relayer allows the `DropV7` `claimHandle` selector next to the older one
 * V5 and V6 drops keep their own rule: `bind.test.ts` and `claim-handles.test.ts`.
 */
import {
  BINDING_SIGN_AHEAD_SECONDS,
  bindingTypedDataV2,
  dropV2Abi,
  dropV7Abi,
  evmBindingDigestV2,
} from "@dropchad/shared";
import { eq } from "drizzle-orm";
import {
  getAbiItem,
  getAddress,
  recoverTypedDataAddress,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter, type ChainAdapter } from "../src/chain/adapter.js";
import { CLAIM_HANDLE_SELECTORS } from "../src/chain/relayer.js";
import { buildBinders, type Binders } from "../src/binder/binders.js";
import { loadConfig } from "../src/config.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { dropHandleLeaves, dropJobs, drops, handleBindings, profiles } from "../src/db/schema.js";
import { claimState } from "../src/routes/claims.js";
import { createDropEventBus } from "../src/worker/events.js";
import { createWorker } from "../src/worker/worker.js";
import { FAKE_CHAIN_ID, createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";
import { TEST_ENV, cookieHeader, createHarness, login, type Harness } from "./harness.js";

const BINDER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BINDER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const RELAYER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const BINDER_ENV = {
  ...TEST_ENV,
  BINDER_EVM_PRIVATE_KEY: BINDER_KEY,
  BINDER_EVM_ADDRESS: BINDER,
  RELAYER_PRIVATE_KEY: RELAYER_KEY,
};

const DROP = getAddress("0x00000000000000000000000000000000000d0b07");
const RECEIVER = { id: "44196397", username: "alice", name: "alice" };
const SENDER = "1600000000000000000";
const WALLET = getAddress("0x1111111111111111111111111111111111110001");
const OTHER = getAddress("0x2222222222222222222222222222222222220002");
const AMOUNT = 10_000_000_000_000n;

/**
 * The fake chain as a `DropV7` drop: binding v2, a chain clock the test moves, and the
 * time checks of `claimHandle` (`BindingExpired`, `BindingTooLong`).
 */
function v2Adapter(chain: FakeChain, clock: { seconds: bigint }): ChainAdapter {
  const base = evmAdapterFor(chain);
  return {
    ...base,
    handleModeReady: () => Promise.resolve(true),
    bindingVersionOf: () => Promise.resolve(2),
    chainTime: () => Promise.resolve(clock.seconds),
    bindingDigestV2: (drop, index, xId, recipient, validUntil) =>
      Promise.resolve(
        evmBindingDigestV2({
          drop: drop as Address,
          chainId: FAKE_CHAIN_ID,
          index,
          xId,
          recipient: recipient as Address,
          validUntil,
        }),
      ),
    claimHandle: (drop, item) => {
      const until = item.validUntil;
      if (until === undefined) return Promise.reject(new Error("execution reverted"));
      if (clock.seconds > until) {
        return Promise.reject(new Error("execution reverted: BindingExpired()"));
      }
      if (until > clock.seconds + 3600n) {
        return Promise.reject(new Error("execution reverted: BindingTooLong()"));
      }
      return base.claimHandle(drop, item);
    },
  };
}

// -- the worker -------------------------------------------------------------------------------

describe("the worker on a v2 drop", () => {
  let handle: DatabaseHandle;
  let chain: FakeChain;
  let now: Date;
  let chainClock: { seconds: bigint };
  let binders: Binders;

  const nowSeconds = () => BigInt(Math.floor(now.getTime() / 1000));

  beforeEach(async () => {
    handle = await openAndMigrate("memory://");
    chain = createFakeChain();
    now = new Date("2026-10-25T10:00:00.000Z");
    chainClock = { seconds: nowSeconds() };
    binders = buildBinders(loadConfig(BINDER_ENV));
    await seed(handle);
    chain.setStatus(DROP, 1);
    chain.setClaimDeadline(DROP, 1_900_000_000n);
    return () => handle.close();
  });

  const worker = () =>
    createWorker({
      db: handle.db,
      chains: singleAdapter(v2Adapter(chain, chainClock)),
      events: createDropEventBus(),
      now: () => now,
      pollMs: 5_000,
      binders,
    });

  const row = async () => (await handle.db.select().from(handleBindings))[0];

  it("signs at the send, validUntil now plus 600, and writes binding_valid_until first", async () => {
    await bindV2(handle, WALLET, "bound");
    await worker().tick();

    expect(chain.handleClaims).toHaveLength(1);
    const item = chain.handleClaims[0]?.item;
    const until = nowSeconds() + BigInt(BINDING_SIGN_AHEAD_SECONDS);
    expect(item?.validUntil).toBe(until);
    const signer = await recoverTypedDataAddress({
      ...bindingTypedDataV2({
        drop: DROP,
        chainId: FAKE_CHAIN_ID,
        index: 0,
        xId: BigInt(RECEIVER.id),
        recipient: WALLET,
        validUntil: until,
      }),
      signature: item?.signature as Hex,
    });
    expect(signer).toBe(BINDER);

    const b = await row();
    expect(b?.state).toBe("paid");
    expect(b?.bindingValidUntil).toBe(until);
    expect(b?.binderSignature).toBe(item?.signature);
    expect(b?.bindingSignatureSentAt).toEqual(now);
  });

  it("BindingExpired sends the binding back to bound, never failed.8", async () => {
    await bindV2(handle, WALLET, "bound");
    chainClock.seconds = nowSeconds() + 601n; // the chain runs ahead of the server
    await worker().tick();
    const b = await row();
    expect(b?.state).toBe("bound");
    expect(b?.lastError).toContain("BindingExpired");
  });

  it("BindingTooLong sends the binding back to bound too", async () => {
    await bindV2(handle, WALLET, "bound");
    chainClock.seconds = nowSeconds() - 3001n; // the server runs far ahead of the chain
    await worker().tick();
    expect((await row())?.state).toBe("bound");
  });

  it("a pending claim sent again carries a new signature with a later validUntil", async () => {
    await bindV2(handle, WALLET, "bound");
    chain.failHandleClaim(0, "Timed out while waiting for transaction 0xabc to be confirmed.");
    await worker().tick();
    const first = await row();
    expect(first?.state).toBe("pending");

    chain.clearHandleFailure(0);
    now = new Date(now.getTime() + 120_000);
    chainClock.seconds = nowSeconds();
    await worker().tick();
    const second = await row();
    expect(second?.state).toBe("paid");
    expect(chain.handleClaims[0]?.item.validUntil).toBe(nowSeconds() + 600n);
    expect(second?.bindingValidUntil).toBe(nowSeconds() + 600n);
    expect(second?.binderSignature).not.toBe(first?.binderSignature);
  });

  it("binding_valid_until only grows", async () => {
    await bindV2(handle, WALLET, "bound", nowSeconds() + 5_000n);
    await worker().tick();
    expect((await row())?.bindingValidUntil).toBe(nowSeconds() + 5_000n);
  });
});

// -- the binder ---------------------------------------------------------------------------------

describe("the EVM binder signs binding v2", () => {
  it("signV2 signs the v2 typed data with the same key", async () => {
    const binders = buildBinders(loadConfig(BINDER_ENV));
    const args = {
      drop: DROP,
      chainId: FAKE_CHAIN_ID,
      index: 0,
      xId: BigInt(RECEIVER.id),
      recipient: WALLET,
      validUntil: 1_800_000_000n,
    };
    const signature = await binders.evm?.signV2(args);
    const expected = await privateKeyToAccount(BINDER_KEY).signTypedData(bindingTypedDataV2(args));
    expect(signature).toBe(expected);
  });
});

// -- the bind route ---------------------------------------------------------------------------

describe("the bind route on a v2 drop.1 and 5.4", () => {
  let harness: Harness | undefined;
  let chain: FakeChain;
  let chainClock: { seconds: bigint };

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  async function signedIn(): Promise<{ h: Harness; headers: Record<string, string> }> {
    chain = createFakeChain();
    chain.setStatus(DROP, 1);
    chain.setClaimDeadline(DROP, 1_900_000_000n);
    chainClock = { seconds: 1_790_000_000n };
    const h = await createHarness({
      writeSides: singleAdapter(v2Adapter(chain, chainClock)),
      env: BINDER_ENV,
      user: RECEIVER,
    });
    harness = h;
    await seedRoute(h);
    const { jar } = await login(h);
    return {
      h,
      headers: {
        cookie: cookieHeader(jar),
        [CSRF_HEADER]: jar["dc_csrf"] ?? "",
        "content-type": "application/json",
      },
    };
  }

  const bind = (h: Harness, headers: Record<string, string>, recipient: string) =>
    h.app.request(`/api/drops/${DROP.toLowerCase()}/bind`, {
      method: "POST",
      headers,
      body: JSON.stringify({ recipient }),
    });
  const rowOf = async (h: Harness) => (await h.deps.db.select().from(handleBindings))[0];

  it("stores the wallet and signs nothing", async () => {
    const { h, headers } = await signedIn();
    const res = await bind(h, headers, WALLET);
    expect(res.status).toBe(201);
    expect(JSON.stringify(await res.json())).not.toMatch(/signature/i);
    const b = await rowOf(h);
    expect(b?.recipient.toLowerCase()).toBe(WALLET.toLowerCase());
    expect(b?.binderSignature ?? null).toBeNull();
    expect(b?.bindingValidUntil ?? null).toBeNull();
    expect(b?.state).toBe("bound");
  });

  it("a new wallet is refused while the chain's time is not past binding_valid_until", async () => {
    const { h, headers } = await signedIn();
    await failedV2(h, chainClock.seconds + 10n);
    const res = await bind(h, headers, OTHER);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_bound" });
    chainClock.seconds += 10n; // equal is not past
    expect((await bind(h, headers, OTHER)).status).toBe(409);
  });

  it("a new wallet is allowed once the chain's time is past it and the bit is clear", async () => {
    const { h, headers } = await signedIn();
    await failedV2(h, chainClock.seconds - 1n);
    const res = await bind(h, headers, OTHER);
    expect(res.status).toBe(201);
    const b = await rowOf(h);
    expect(b?.recipient.toLowerCase()).toBe(OTHER.toLowerCase());
    expect(b?.state).toBe("bound");
    expect(b?.binderSignature ?? null).toBeNull();
  });

  it("never once the bit is set", async () => {
    const { h, headers } = await signedIn();
    await failedV2(h, chainClock.seconds - 1n);
    chain.setClaimed(DROP, 0n);
    expect((await bind(h, headers, OTHER)).status).toBe(409);
  });

  it("a null binding_valid_until allows a new wallet once the bit is clear, even after a v1 send", async () => {
    const { h, headers } = await signedIn();
    await failedV2(h, null);
    const res = await bind(h, headers, OTHER);
    expect(res.status).toBe(201);
    expect((await rowOf(h))?.recipient.toLowerCase()).toBe(OTHER.toLowerCase());
  });

  it("the same wallet is a retry, before the time too", async () => {
    const { h, headers } = await signedIn();
    await failedV2(h, chainClock.seconds + 100n);
    const res = await bind(h, headers, WALLET);
    expect(res.status).toBe(201);
    expect((await rowOf(h))?.state).toBe("bound");
  });

  it("a pending binding is never rebound", async () => {
    const { h, headers } = await signedIn();
    await failedV2(h, chainClock.seconds - 1n, "pending");
    expect((await bind(h, headers, OTHER)).status).toBe(409);
  });
});

// -- the receiver's list ----------------------------------------------------------------------

describe("the receiver's list for a v2 binding", () => {
  const base = {
    signatureSent: true,
    status: 1,
    claimDeadline: 1_900_000_000n,
    nowSeconds: 1_790_000_000n,
    handleModeOn: true,
    bindingVersion: 2 as const,
  };

  it("failed is retry until the chain's time is past binding_valid_until, then failed", () => {
    expect(
      claimState({
        ...base,
        binding: "failed",
        validUntil: 1_790_000_100n,
        chainTime: 1_790_000_000n,
      }),
    ).toBe("retry");
    expect(
      claimState({
        ...base,
        binding: "failed",
        validUntil: 1_790_000_100n,
        chainTime: 1_790_000_100n,
      }),
    ).toBe("retry");
    expect(
      claimState({
        ...base,
        binding: "failed",
        validUntil: 1_790_000_100n,
        chainTime: 1_790_000_101n,
      }),
    ).toBe("failed");
  });

  it("never sending while failed: no chain time read yet is retry", () => {
    expect(claimState({ ...base, binding: "failed", validUntil: 1_790_000_100n })).toBe("retry");
  });

  it("never stuck, and a null binding_valid_until is failed at once", () => {
    expect(
      claimState({ ...base, binding: "failed", validUntil: null, chainTime: 1_790_000_000n }),
    ).toBe("failed");
  });

  it("a v1 binding keeps stuck", () => {
    expect(
      claimState({
        ...base,
        bindingVersion: 1,
        binding: "failed",
        validUntil: null,
        chainTime: 1_790_000_000n,
      }),
    ).toBe("stuck");
  });
});

// -- migration 0026 ---------------------------------------------------------------------------

describe("migration 0026.7", () => {
  it("binding_valid_until is a bigint, binder_signature may be null", async () => {
    const handle = await openAndMigrate("memory://");
    try {
      await seed(handle);
      await handle.db.insert(handleBindings).values({
        dropAddress: DROP.toLowerCase(),
        leafIndex: 0,
        xUserId: RECEIVER.id,
        recipient: WALLET,
        binderSignature: null,
        bindingValidUntil: 1_800_000_000n,
        state: "bound",
      });
      const b = (
        await handle.db
          .select()
          .from(handleBindings)
          .where(eq(handleBindings.dropAddress, DROP.toLowerCase()))
      )[0];
      expect(b?.binderSignature).toBeNull();
      expect(b?.bindingValidUntil).toBe(1_800_000_000n);
    } finally {
      await handle.close();
    }
  });
});

// -- the EVM relayer --------------------------------------------------------------------------

describe("the EVM relayer selectors.9", () => {
  it("claimHandle may be the DropV2 one or the DropV7 one, nothing else", () => {
    const v2 = toFunctionSelector(getAbiItem({ abi: dropV2Abi, name: "claimHandle" }));
    const v7 = toFunctionSelector(getAbiItem({ abi: dropV7Abi, name: "claimHandle" }));
    expect(v2).not.toBe(v7);
    expect([...CLAIM_HANDLE_SELECTORS].sort()).toEqual([v2, v7].sort());
  });
});

// -- seeds ------------------------------------------------------------------------------------

async function seed(handle: DatabaseHandle): Promise<void> {
  await seedRows(handle.db);
  await handle.db.insert(dropJobs).values({
    dropAddress: DROP.toLowerCase(),
    kind: "claim_handles",
    state: "ready",
    runAfter: new Date("2026-10-25T09:00:00.000Z"),
  });
}

async function seedRoute(h: Harness): Promise<void> {
  await seedRows(h.deps.db);
}

async function seedRows(db: DatabaseHandle["db"]): Promise<void> {
  const at = new Date("2026-10-25T09:00:00.000Z");
  await db
    .insert(profiles)
    .values({
      xUserId: SENDER,
      handle: "sender",
      displayName: "sender",
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing();
  await db.insert(drops).values({
    address: DROP.toLowerCase(),
    chainId: FAKE_CHAIN_ID,
    chainKey: "robinhood-testnet",
    xUserId: SENDER,
    nonce: 0n,
    creatorCommitment: `0x${"33".repeat(32)}`,
    salt: `0x${"44".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"11".repeat(32)}`,
    manifestHash: `0x${"22".repeat(32)}`,
    manifestJson: JSON.stringify({
      version: 2,
      mode: "handle",
      drop: DROP,
      chainId: FAKE_CHAIN_ID,
      root: `0x${"11".repeat(32)}`,
      totalEntitlements: AMOUNT.toString(),
      leafCount: 1,
      entries: [{ index: 0, xId: RECEIVER.id, amount: AMOUNT.toString(), proof: [] }],
    }),
    totalEntitlements: AMOUNT.toString(),
    feeAmount: "0",
    grossRequired: AMOUNT.toString(),
    leafCount: 1,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    mode: "handle",
    state: "active",
    createTxHash: "0x01",
    createdAt: at,
    updatedAt: at,
  });
  await db.insert(dropHandleLeaves).values({
    dropAddress: DROP.toLowerCase(),
    leafIndex: 0,
    xUserId: RECEIVER.id,
    amount: AMOUNT.toString(),
  });
}

/** A v2 binding as the bind route leaves it: the wallet, no signature yet. */
async function bindV2(
  handle: DatabaseHandle,
  wallet: Address,
  state: "bound",
  validUntil: bigint | null = null,
): Promise<void> {
  await handle.db.insert(handleBindings).values({
    dropAddress: DROP.toLowerCase(),
    leafIndex: 0,
    xUserId: RECEIVER.id,
    recipient: wallet,
    binderSignature: null,
    bindingValidUntil: validUntil,
    state,
  });
}

/** A v2 binding whose send failed, the signature sent, valid until `validUntil`. */
async function failedV2(
  h: Harness,
  validUntil: bigint | null,
  state: "failed" | "pending" = "failed",
): Promise<void> {
  await h.deps.db.insert(handleBindings).values({
    dropAddress: DROP.toLowerCase(),
    leafIndex: 0,
    xUserId: RECEIVER.id,
    recipient: WALLET,
    binderSignature: `0x${"ab".repeat(65)}`,
    bindingSignatureSentAt: new Date("2026-10-25T09:30:00.000Z"),
    bindingValidUntil: validUntil,
    state,
  });
}
