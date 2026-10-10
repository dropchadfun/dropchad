/**
 * handle mode is on for a chain only when all three hold (,
 * ):
 * - the chain side is ready, `handleModeReady`: `DropFactoryV2` recorded on the EVM, a migrated
 *   `Config` with a live binder on Solana
 * - our binder key for that family is set, `BINDER_EVM_*` or `BINDER_SOLANA_*`
 * - the binder on chain is our key: a wrong or rotated key would sign bindings the chain refuses
 *
 * The routes that follow from it are `handle-mode-routes.test.ts`.
 */
import { getChain } from "@dropchad/chains";
import { describe, expect, it } from "vitest";

import { buildBinders } from "../src/binder/binders.js";
import { handleModeStatus } from "../src/binder/handle-mode.js";
import { randomSigner } from "../src/chain/svm/keypair.js";
import { createSvmAdapter } from "../src/chain/svm/adapter.js";
import { createSvmRelayer } from "../src/chain/svm/relayer.js";
import { loadConfig } from "../src/config.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { FakeSvm, createFakeSvmRpc, rentFor } from "./fake-svm.js";
import { TEST_ENV } from "./harness.js";
import {
  TEST_BINDER_ENV,
  TEST_EVM_BINDER_ENV,
  TEST_SOL_BINDER_ENV,
  TEST_SOL_BINDER_PUBKEY,
} from "./test-binders.js";

const OTHER_EVM = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const bindersFor = (env: Record<string, string>) =>
  buildBinders(loadConfig({ ...TEST_ENV, ...env }));

function evm(ready = true) {
  const chain = createFakeChain();
  const adapter = { ...evmAdapterFor(chain), handleModeReady: () => Promise.resolve(ready) };
  return { chain, adapter };
}

function solana(binder: Uint8Array | undefined) {
  const signer = randomSigner();
  const svm = new FakeSvm({
    relayer: signer.publicKey,
    ...(binder === undefined ? {} : { binder }),
  });
  const rpc = createFakeSvmRpc(svm);
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: () => Promise.resolve(false),
    budget: { reserve: () => Promise.resolve(), settle: () => Promise.resolve() },
    caps: { maxComputeUnits: 400_000, priorityFeeMicroLamports: 0n },
    rentForCreate: () => Promise.resolve(rentFor(424) + rentFor(1291)),
    commitment: "confirmed",
    sleep: () => Promise.resolve(),
  });
  const chain = getChain("solana-devnet") as Parameters<typeof createSvmAdapter>[0]["chain"];
  return { svm, adapter: createSvmAdapter({ rpc, relayer, chain }) };
}

describe("handleModeStatus on the EVM", () => {
  it("is on with the V2 contracts, our key, and our key as the binder on chain", async () => {
    const { adapter } = evm();
    expect(await handleModeStatus(adapter, bindersFor(TEST_BINDER_ENV))).toEqual({
      on: true,
      reason: "on",
    });
  });

  it("is off before the V2 contracts are recorded", async () => {
    const { adapter } = evm(false);
    expect(await handleModeStatus(adapter, bindersFor(TEST_BINDER_ENV))).toEqual({
      on: false,
      reason: "chain_not_ready",
    });
  });

  it("is off with no binder key, and with the Solana key only", async () => {
    const { adapter } = evm();
    for (const env of [{}, TEST_SOL_BINDER_ENV]) {
      expect(await handleModeStatus(adapter, bindersFor(env))).toEqual({
        on: false,
        reason: "no_binder_key",
      });
    }
  });

  it("is off when the registry binder is revoked", async () => {
    const { chain, adapter } = evm();
    chain.setBinderLive(false);
    expect(await handleModeStatus(adapter, bindersFor(TEST_BINDER_ENV))).toEqual({
      on: false,
      reason: "no_live_binder",
    });
  });

  it("is off when the binder on chain is another address than our key", async () => {
    const { chain, adapter } = evm();
    chain.setBinderAddress(OTHER_EVM);
    expect(await handleModeStatus(adapter, bindersFor(TEST_BINDER_ENV))).toEqual({
      on: false,
      reason: "binder_mismatch",
    });
  });
});

describe("handleModeStatus on Solana", () => {
  it("is on with a migrated Config whose binder is our key", async () => {
    const { adapter } = solana(TEST_SOL_BINDER_PUBKEY);
    expect(await handleModeStatus(adapter, bindersFor(TEST_SOL_BINDER_ENV))).toEqual({
      on: true,
      reason: "on",
    });
  });

  it("is off before migrate_config", async () => {
    const { adapter } = solana(undefined);
    expect(await handleModeStatus(adapter, bindersFor(TEST_SOL_BINDER_ENV))).toEqual({
      on: false,
      reason: "chain_not_ready",
    });
  });

  it("is off with the EVM key only", async () => {
    const { adapter } = solana(TEST_SOL_BINDER_PUBKEY);
    expect(await handleModeStatus(adapter, bindersFor(TEST_EVM_BINDER_ENV))).toEqual({
      on: false,
      reason: "no_binder_key",
    });
  });

  it("is off when Config holds another binder", async () => {
    const { adapter } = solana(new Uint8Array(32).fill(9));
    expect(await handleModeStatus(adapter, bindersFor(TEST_SOL_BINDER_ENV))).toEqual({
      on: false,
      reason: "binder_mismatch",
    });
  });

  it("is off when the binder is revoked", async () => {
    const { svm, adapter } = solana(TEST_SOL_BINDER_PUBKEY);
    svm.setBinderRevoked(true);
    expect((await handleModeStatus(adapter, bindersFor(TEST_SOL_BINDER_ENV))).on).toBe(false);
  });
});
