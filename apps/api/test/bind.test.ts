/**
 * the bind.
 * - no wallet connect and no wallet signature: the X login is the only proof
 * - the login must be from the last 10 minutes
 * - the pasted address must be in the chain's format: EVM checksummed when mixed case and not
 *   zero; Solana a public key on the ed25519 curve, never the default key
 * - the binder signs for that address, one binding per X id per drop
 * - the binder key is its own key, never the relayer's, and never in a log line or a response
 */
import { ed25519 } from "@noble/curves/ed25519";
import { base58Encode, evmBindingDigest, svmBindingMessage } from "@dropchad/shared";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter, adaptersFrom, type ChainAdapter } from "../src/chain/adapter.js";
import { configPda } from "../src/chain/svm/pda.js";
import { buildBinders, BinderConfigError } from "../src/binder/binders.js";
import { parseRecipient } from "../src/binder/recipient.js";
import { loadConfig, redactedConfig } from "../src/config.js";
import { dropHandleLeaves, dropJobs, drops, handleBindings, profiles } from "../src/db/schema.js";
import {
  FAKE_CHAIN_ID,
  createFakeChain,
  evmAdapterFor,
  evmAdapterV1OnlyFor,
  type FakeChain,
} from "./fake-chain.js";
import { TEST_ENV, cookieHeader, createHarness, login, type Harness } from "./harness.js";

import { bindingTypedData } from "@dropchad/shared";

// A public test key, anvil account 1. It has never held value and never will.
const EVM_BINDER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const EVM_BINDER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
// Anvil account 2, standing in for the relayer.
const EVM_RELAYER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const EVM_RELAYER_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const SOL_SEED = new Uint8Array(32).fill(7);
const SOL_BINDER_PUB = ed25519.getPublicKey(SOL_SEED);
const SOL_BINDER_SECRET = JSON.stringify([...SOL_SEED, ...SOL_BINDER_PUB]);
const SOL_BINDER_ADDRESS = base58Encode(SOL_BINDER_PUB);

const BINDER_ENV = {
  BINDER_EVM_PRIVATE_KEY: EVM_BINDER_KEY,
  BINDER_EVM_ADDRESS: EVM_BINDER_ADDRESS,
  BINDER_SOLANA_SECRET: SOL_BINDER_SECRET,
  BINDER_SOLANA_ADDRESS: SOL_BINDER_ADDRESS,
};

/** The receiver, logged in. The drop was made by someone else, `SENDER`. */
const RECEIVER = { id: "44196397", username: "alice", name: "alice" };
const SENDER = "1600000000000000000";
const DROP = "0x00000000000000000000000000000000000d0b01";
const WALLET = "0x1111111111111111111111111111111111110001";
const SOL_DROP = "9ArT5gUTfmD81oKeNL66RhcWrK9nuaoxuJV2wH7QT9Ra";
const SOL_WALLET = base58Encode(ed25519.getPublicKey(new Uint8Array(32).fill(9)));

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  vi.restoreAllMocks();
});

async function seedHandleDrop(
  h: Harness,
  args: { address: string; chainKey: string; chainId: number; mode?: "handle" | "address" },
): Promise<void> {
  const now = new Date("2026-09-09T00:00:00.000Z");
  await h.deps.db
    .insert(profiles)
    .values({
      xUserId: SENDER,
      handle: "sender",
      displayName: "sender",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await h.deps.db.insert(drops).values({
    address: args.address,
    chainId: args.chainId,
    chainKey: args.chainKey,
    xUserId: SENDER,
    nonce: 0n,
    creatorCommitment: `0x${"33".repeat(32)}`,
    salt: `0x${"44".repeat(32)}`,
    asset: "native",
    merkleRoot: `0x${"11".repeat(32)}`,
    manifestHash: `0x${"22".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "10000000000000",
    feeAmount: "0",
    grossRequired: "10000000000000",
    leafCount: 1,
    refundRecipient: "refund",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    mode: args.mode ?? "handle",
    state: "active",
    createTxHash: "0x01",
    lastTxHash: "0x01",
    createdAt: now,
    updatedAt: now,
  });
  await h.deps.db.insert(dropHandleLeaves).values({
    dropAddress: args.address,
    leafIndex: 0,
    xUserId: RECEIVER.id,
    amount: "10000000000000",
  });
}

/**
 * A ready V2 chain, the only place a real bind can happen: `DropFactoryV2` recorded and our
 * binder live, so handle mode is on. a bind needs that.
 */
function readyEvm(chain: FakeChain): ChainAdapter {
  return { ...evmAdapterFor(chain), handleModeReady: () => Promise.resolve(true) };
}

function activeEvm(): { chain: FakeChain; adapter: ChainAdapter } {
  const chain = createFakeChain();
  chain.setStatus(DROP, 1);
  chain.setClaimDeadline(DROP, 1_800_000_000n);
  return { chain, adapter: readyEvm(chain) };
}

async function signedIn(
  adapters: Parameters<typeof createHarness>[0] extends infer O
    ? O extends { writeSides?: infer W }
      ? W
      : never
    : never,
  env: Record<string, string> = BINDER_ENV,
): Promise<{ h: Harness; headers: Record<string, string> }> {
  const h = await createHarness({ writeSides: adapters, env, user: RECEIVER });
  harness = h;
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

const bind = (h: Harness, headers: Record<string, string>, drop: string, recipient: string) =>
  h.app.request(`/api/drops/${drop}/bind`, {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient }),
  });

describe("the pasted address", () => {
  it("EVM: lowercase and a valid checksum pass, a bad checksum, zero and junk do not", () => {
    expect(parseRecipient("evm", WALLET)).toBe("0x1111111111111111111111111111111111110001");
    expect(parseRecipient("evm", EVM_BINDER_ADDRESS)).toBe(EVM_BINDER_ADDRESS);
    expect(parseRecipient("evm", EVM_BINDER_ADDRESS.toLowerCase())).toBe(EVM_BINDER_ADDRESS);
    const badChecksum = "0x70997970c51812dc3A010C7d01b50e0d17dc79C8";
    expect(() => parseRecipient("evm", badChecksum)).toThrow();
    expect(() => parseRecipient("evm", "0x0000000000000000000000000000000000000000")).toThrow();
    expect(() => parseRecipient("evm", "0x1234")).toThrow();
    expect(() => parseRecipient("evm", SOL_WALLET)).toThrow();
  });

  it("Solana: a wallet key passes; a program address, the default key and junk do not", () => {
    expect(parseRecipient("svm", SOL_WALLET)).toBe(SOL_WALLET);
    // The Config PDA is off the curve by construction, like every program address.
    expect(() => parseRecipient("svm", base58Encode(configPda().address))).toThrow(/curve/);
    expect(() => parseRecipient("svm", "11111111111111111111111111111111")).toThrow();
    expect(() => parseRecipient("svm", "not-base58-0OIl")).toThrow();
    expect(() => parseRecipient("svm", WALLET)).toThrow();
  });
});

describe("the binder keys", () => {
  it("none configured: no binders, and the config summary never shows a key", () => {
    const config = loadConfig({ ...TEST_ENV });
    expect(buildBinders(config)).toEqual({});
    const summary = JSON.stringify(redactedConfig(loadConfig({ ...TEST_ENV, ...BINDER_ENV })));
    expect(summary).not.toContain(EVM_BINDER_KEY.slice(2));
    expect(summary).not.toContain(SOL_BINDER_SECRET);
    expect(summary).toContain('"BINDER_EVM_PRIVATE_KEY":"<set>"');
  });

  it("refuses a key that does not derive to its stated address", () => {
    const config = loadConfig({
      ...TEST_ENV,
      ...BINDER_ENV,
      BINDER_EVM_ADDRESS: EVM_RELAYER_ADDRESS,
    });
    expect(() => buildBinders(config)).toThrow(BinderConfigError);
  });

  it("refuses the relayer key as the binder key: two keys, two powers", () => {
    const config = loadConfig({
      ...TEST_ENV,
      RELAYER_PRIVATE_KEY: EVM_RELAYER_KEY,
      BINDER_EVM_PRIVATE_KEY: EVM_RELAYER_KEY,
      BINDER_EVM_ADDRESS: EVM_RELAYER_ADDRESS,
    });
    expect(() => buildBinders(config)).toThrow(/relayer/);
  });

  it("EVM: the signature recovers to the binder over the typed data", async () => {
    const binders = buildBinders(loadConfig({ ...TEST_ENV, ...BINDER_ENV }));
    const args = {
      drop: DROP as Address,
      chainId: FAKE_CHAIN_ID,
      index: 0,
      xId: 44196397n,
      recipient: WALLET as Address,
    };
    const signature = await binders.evm?.sign(args);
    expect(
      await recoverTypedDataAddress({ ...bindingTypedData(args), signature: signature as Hex }),
    ).toBe(EVM_BINDER_ADDRESS);
  });

  it("Solana: the signature verifies over the message with the binder key", () => {
    const binders = buildBinders(loadConfig({ ...TEST_ENV, ...BINDER_ENV }));
    const args = { drop: SOL_DROP, chainId: 103, index: 0, xId: 44196397n, recipient: SOL_WALLET };
    const signature = binders.svm?.sign(args) ?? new Uint8Array();
    expect(ed25519.verify(signature, svmBindingMessage(args), SOL_BINDER_PUB)).toBe(true);
    expect(binders.svm?.publicKey).toBe(SOL_BINDER_ADDRESS);
  });
});

describe("POST /api/drops/:address/bind", () => {
  it("binds the pasted address, stores the row, and the signature is the binder's", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });

    const res = await bind(h, headers, DROP, WALLET);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      binding: { drop: string; index: number; xId: string; recipient: string; signature: Hex };
    };
    expect(body.binding).toMatchObject({ index: 0, xId: RECEIVER.id, recipient: WALLET });
    const digest = evmBindingDigest({
      drop: DROP,
      chainId: FAKE_CHAIN_ID,
      index: 0,
      xId: BigInt(RECEIVER.id),
      recipient: WALLET,
    });
    expect(digest).toMatch(/^0x/);
    expect(
      await recoverTypedDataAddress({
        ...bindingTypedData({
          drop: DROP,
          chainId: FAKE_CHAIN_ID,
          index: 0,
          xId: BigInt(RECEIVER.id),
          recipient: WALLET,
        }),
        signature: body.binding.signature,
      }),
    ).toBe(EVM_BINDER_ADDRESS);

    const rows = await h.deps.db.select().from(handleBindings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dropAddress: DROP,
      leafIndex: 0,
      xUserId: RECEIVER.id,
      recipient: WALLET,
      state: "bound",
    });
  });

  it("one binding per X id per drop: a second address is refused, the first stays", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    expect((await bind(h, headers, DROP, WALLET)).status).toBe(201);
    const again = await bind(h, headers, DROP, EVM_BINDER_ADDRESS);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "already_bound", recipient: WALLET });
    const rows = await h.deps.db.select().from(handleBindings);
    expect(rows.map((r) => r.recipient)).toEqual([WALLET]);
  });

  it("needs an X login from the last 10 minutes", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    h.setNow(new Date("2026-09-09T00:10:01.000Z"));
    const res = await bind(h, headers, DROP, WALLET);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("fresh_login_required");
    expect(await h.deps.db.select().from(handleBindings)).toHaveLength(0);
  });

  it("refuses a bad address before anything is signed", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    const res = await bind(h, headers, DROP, "0x0000000000000000000000000000000000000000");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_address");
  });

  it("404 no_leaf on an address drop, an unknown drop, or a drop without this X id", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, {
      address: DROP,
      chainKey: adapter.chainKey,
      chainId: FAKE_CHAIN_ID,
      mode: "address",
    });
    const onAddressDrop = await bind(h, headers, DROP, WALLET);
    expect(onAddressDrop.status).toBe(404);
    expect(((await onAddressDrop.json()) as { error: string }).error).toBe("no_leaf");
    const unknown = await bind(h, headers, "0x00000000000000000000000000000000000d0bff", WALLET);
    expect(unknown.status).toBe(404);
  });

  it("409 not_claimable when the drop is not active on chain or its claim window is over", async () => {
    const { chain, adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    chain.setStatus(DROP, 0);
    const created = await bind(h, headers, DROP, WALLET);
    expect(created.status).toBe(409);
    expect(((await created.json()) as { error: string }).error).toBe("not_claimable");

    chain.setStatus(DROP, 1);
    chain.setClaimDeadline(DROP, 1_000_000_000n);
    const expired = await bind(h, headers, DROP, WALLET);
    expect(expired.status).toBe(409);
    expect(await h.deps.db.select().from(handleBindings)).toHaveLength(0);
  });

  it("503 binder_not_configured without the binder key for that chain", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter), {});
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    const res = await bind(h, headers, DROP, WALLET);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("binder_not_configured");
  });

  it("refuses to sign when the drop's own bindingDigest disagrees with ours", async () => {
    const chain = createFakeChain({ tamperBindingDigest: true });
    chain.setStatus(DROP, 1);
    chain.setClaimDeadline(DROP, 1_800_000_000n);
    const adapter = readyEvm(chain);
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    const res = await bind(h, headers, DROP, WALLET);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("chain_disagreed");
    expect(await h.deps.db.select().from(handleBindings)).toHaveLength(0);
  });

  it("Solana: binds a wallet key, refuses a program address", async () => {
    const svm = solanaStub();
    const { h, headers } = await signedIn(adaptersFrom([svm], svm.chainKey));
    await seedHandleDrop(h, { address: SOL_DROP, chainKey: svm.chainKey, chainId: 103 });

    const pda = await bind(h, headers, SOL_DROP, base58Encode(configPda().address));
    expect(pda.status).toBe(400);

    const res = await bind(h, headers, SOL_DROP, SOL_WALLET);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { binding: { signature: string } };
    const message = svmBindingMessage({
      drop: SOL_DROP,
      chainId: 103,
      index: 0,
      xId: BigInt(RECEIVER.id),
      recipient: SOL_WALLET,
    });
    const signature = Buffer.from(body.binding.signature.slice(2), "hex");
    expect(ed25519.verify(signature, message, SOL_BINDER_PUB)).toBe(true);
  });

  it("never puts a binder key in a response or a log line", async () => {
    const lines: string[] = [];
    for (const level of ["log", "warn", "error", "info"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    const texts = [
      await (await bind(h, headers, DROP, WALLET)).text(),
      await (await bind(h, headers, DROP, WALLET)).text(),
      await (await bind(h, headers, DROP, "junk")).text(),
    ];
    for (const text of [...texts, ...lines]) {
      expect(text).not.toContain(EVM_BINDER_KEY.slice(2));
      expect(text).not.toContain(SOL_BINDER_SECRET);
    }
  });
});

describe("rebind after a failed claim", () => {
  async function failedBinding(h: Harness): Promise<void> {
    await h.deps.db
      .update(handleBindings)
      .set({ state: "failed", lastError: "execution reverted: NativeTransferFailed()" });
  }

  it("a failed claim with the bit clear may bind a new address, and the row starts over", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    expect((await bind(h, headers, DROP, WALLET)).status).toBe(201);
    await failedBinding(h);

    const again = await bind(h, headers, DROP, EVM_BINDER_ADDRESS);
    expect(again.status).toBe(201);
    const rows = await h.deps.db.select().from(handleBindings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient: EVM_BINDER_ADDRESS,
      state: "bound",
      lastError: null,
      claimTxHash: null,
    });
  });

  it("a failed claim whose bit is set on chain is not rebound: the leaf is paid", async () => {
    const { chain, adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    expect((await bind(h, headers, DROP, WALLET)).status).toBe(201);
    await failedBinding(h);
    chain.setClaimed(DROP, 0n);

    const again = await bind(h, headers, DROP, EVM_BINDER_ADDRESS);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "already_bound", recipient: WALLET });
  });

  it("a bound or paid binding is still final", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    expect((await bind(h, headers, DROP, WALLET)).status).toBe(201);
    await h.deps.db.update(handleBindings).set({ state: "paid" });
    expect((await bind(h, headers, DROP, EVM_BINDER_ADDRESS)).status).toBe(409);
  });
});

describe("a bind wakes the claim job", () => {
  it("moves a waiting claim_handles job to now, so the claim goes out on the next poll", async () => {
    const { adapter } = activeEvm();
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    const later = new Date("2026-10-09T00:00:00.000Z");
    await h.deps.db.insert(dropJobs).values({
      dropAddress: DROP,
      kind: "claim_handles",
      state: "ready",
      runAfter: later,
    });
    expect((await bind(h, headers, DROP, WALLET)).status).toBe(201);
    const [job] = await h.deps.db.select().from(dropJobs);
    expect(job?.runAfter.getTime()).toBe(new Date("2026-09-09T00:00:00.000Z").getTime());
  });
});

/** The Solana side of the route needs only the chain facts and `readDrop`. */
function solanaStub(): ChainAdapter {
  // Solana has no `bindingDigest` view, so the stub drops it.
  const { bindingDigest, ...base } = evmAdapterFor(createFakeChain());
  void bindingDigest;
  return {
    ...base,
    family: "svm",
    chainKey: "solana-devnet",
    chainId: 103,
    chainName: "Solana Devnet",
    nativeSymbol: "SOL",
    decimals: 9,
    readDrop: () =>
      Promise.resolve({
        status: 1,
        claimDeadline: 1_800_000_000n,
        fundingDeadline: 0n,
        totalClaimed: 0n,
        claimedCount: 0,
        closed: false,
      }),
    // A migrated `Config` whose binder is our test key: handle mode on.
    handleModeReady: () => Promise.resolve(true),
    liveBinder: () => Promise.resolve(SOL_BINDER_ADDRESS),
  };
}

/**
 * a bind is refused while handle mode is off on
 * the drop's chain. A binding signed then would only wait, so nothing is
 * signed and nothing is written.
 */
describe("a bind while handle mode is off", () => {
  async function refused(adapter: ChainAdapter, drop: string, chainId: number, recipient: string) {
    const { h, headers } = await signedIn(adaptersFrom([adapter], adapter.chainKey));
    await seedHandleDrop(h, { address: drop, chainKey: adapter.chainKey, chainId });
    const res = await bind(h, headers, drop, recipient);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "handle_mode_not_ready" });
    expect(await h.deps.db.select().from(handleBindings)).toHaveLength(0);
    expect(await h.deps.db.select().from(dropJobs)).toHaveLength(0);
  }

  it("EVM without DropFactoryV2 recorded: 503 handle_mode_not_ready, nothing signed", async () => {
    const chain = createFakeChain();
    chain.setStatus(DROP, 1);
    chain.setClaimDeadline(DROP, 1_800_000_000n);
    await refused(evmAdapterV1OnlyFor(chain), DROP, FAKE_CHAIN_ID, WALLET);
  });

  it("EVM with our binder revoked on chain: 503, nothing signed", async () => {
    const { chain, adapter } = activeEvm();
    chain.setBinderLive(false);
    await refused(adapter, DROP, FAKE_CHAIN_ID, WALLET);
  });

  it("EVM with another binder on chain: 503, nothing signed", async () => {
    const { chain, adapter } = activeEvm();
    chain.setBinderAddress("0x000000000000000000000000000000000000bEEF");
    await refused(adapter, DROP, FAKE_CHAIN_ID, WALLET);
  });

  it("Solana with no binder in Config: 503, nothing signed", async () => {
    const off: ChainAdapter = { ...solanaStub(), liveBinder: () => Promise.resolve(null) };
    await refused(off, SOL_DROP, 103, SOL_WALLET);
  });

  it("the reason is never in the answer, only that handle mode is off", async () => {
    const { chain, adapter } = activeEvm();
    chain.setBinderLive(false);
    const { h, headers } = await signedIn(singleAdapter(adapter));
    await seedHandleDrop(h, { address: DROP, chainKey: adapter.chainKey, chainId: FAKE_CHAIN_ID });
    const text = await (await bind(h, headers, DROP, WALLET)).text();
    for (const reason of [
      "no_binder_key",
      "chain_not_ready",
      "no_live_binder",
      "binder_mismatch",
    ]) {
      expect(text).not.toContain(reason);
    }
  });
});
