/**
 * The binder per drop: a drop reads its own
 * registry, never the factory. A `DropV6` reads `BinderRegistryV2`, an older drop the
 * `BinderRegistry`.
 * - with no drop, the registry of the picked factory: handle mode for new drops
 * - with a drop, `BINDER_REGISTRY()` on that drop, one read kept in memory, and it must be one of
 *   the chain's registries; anything else is an error and nothing is read from it
 * - handle mode for a drop with a registry we do not know is off, `chain_not_ready`
 * - a V6 only chain has handle mode ready: `BinderRegistryV2` is its registry
 * No chain has V6 recorded yet, so the V6 addresses here are made up.
 */
import { getChain, type Chain } from "@dropchad/chains";
import type { Address, PublicClient } from "viem";
import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { buildBinders } from "../src/binder/binders.js";
import { handleModeStatus } from "../src/binder/handle-mode.js";
import { createEvmAdapter } from "../src/chain/evm/adapter.js";
import { createChainGateway, UnknownBinderRegistryError } from "../src/chain/gateway.js";
import type { Relayer } from "../src/chain/relayer.js";
import { loadConfig } from "../src/config.js";
import { TEST_ENV } from "./harness.js";
import { TEST_BINDER_ENV, TEST_EVM_BINDER_ADDRESS } from "./test-binders.js";

const F6 = getAddress("0x00000000000000000000000000000000000000f6");
const DROP_V6 = getAddress("0x00000000000000000000000000000000000000d6");
const REGISTRY_V2 = getAddress("0x00000000000000000000000000000000000000b2");
const REGISTRY = getAddress("0x9d11E77ad44b812c286c9579C8Ca1FC58e536735");
const STRANGER = getAddress("0x00000000000000000000000000000000000000ee");
/** Three drops: one on V5 (old registry), one on V6, one whose registry we do not know. */
const OLD_DROP = getAddress("0x0000000000000000000000000000000000d50001");
const NEW_DROP = getAddress("0x0000000000000000000000000000000000d60001");
const ODD_DROP = getAddress("0x0000000000000000000000000000000000dd0001");
const OLD_BINDER = getAddress("0x00000000000000000000000000000000000b1d05");

const bindersFor = (env: Record<string, string>) =>
  buildBinders(loadConfig({ ...TEST_ENV, ...env }));

function world(options: { registries?: readonly Address[] } = {}) {
  const reads: string[] = [];
  const registryOf: Record<string, Address> = {
    [OLD_DROP]: REGISTRY,
    [NEW_DROP]: REGISTRY_V2,
    [ODD_DROP]: STRANGER,
  };
  const stateOf: Record<string, readonly [Address, boolean]> = {
    [REGISTRY]: [OLD_BINDER, false],
    [REGISTRY_V2]: [getAddress(TEST_EVM_BINDER_ADDRESS), false],
    [STRANGER]: [getAddress(TEST_EVM_BINDER_ADDRESS), false],
  };
  const publicClient = {
    readContract: (args: { address: Address; functionName: string }) => {
      reads.push(`${args.address}.${args.functionName}`);
      if (args.functionName === "BINDER_REGISTRY") {
        const registry = registryOf[args.address];
        return registry === undefined
          ? Promise.reject(new Error("execution reverted"))
          : Promise.resolve(registry);
      }
      if (args.functionName === "binderState") {
        return Promise.resolve(stateOf[args.address] ?? [zeroAddress, false]);
      }
      return Promise.reject(new Error(`unexpected read ${args.functionName}`));
    },
  } as unknown as PublicClient;
  const gateway = createChainGateway({
    publicClient,
    relayer: { address: getAddress("0x000000000000000000000000000000000000be11") } as Relayer,
    chainId: 46_630,
    version: 6,
    factory: F6,
    implementation: DROP_V6,
    binderRegistry: REGISTRY_V2,
    binderRegistries: options.registries ?? [REGISTRY, REGISTRY_V2],
  });
  const testnet = getChain("robinhood-testnet");
  const chain: Chain = {
    ...testnet,
    contracts: {
      ...testnet.contracts,
      factoryV6: F6,
      implementationV6: DROP_V6,
      binderRegistryV2: REGISTRY_V2,
      deployBlockV6: 140_000_000,
    },
  };
  return { gateway, reads, adapter: createEvmAdapter({ gateway, chain }) };
}

describe("the gateway's binder read, per drop", () => {
  it("no drop: the registry of the picked factory, BinderRegistryV2 once V6", async () => {
    const { gateway, reads } = world();
    expect(await gateway.liveBinder()).toBe(getAddress(TEST_EVM_BINDER_ADDRESS));
    expect(reads).toEqual([`${REGISTRY_V2}.binderState`]);
  });

  it("a V5 drop: BINDER_REGISTRY() on the drop, then the old BinderRegistry", async () => {
    const { gateway, reads } = world();
    expect(await gateway.liveBinder(OLD_DROP)).toBe(OLD_BINDER);
    expect(reads).toEqual([`${OLD_DROP}.BINDER_REGISTRY`, `${REGISTRY}.binderState`]);
  });

  it("a V6 drop: BinderRegistryV2", async () => {
    const { gateway, reads } = world();
    expect(await gateway.binderLive(NEW_DROP)).toBe(true);
    expect(reads).toEqual([`${NEW_DROP}.BINDER_REGISTRY`, `${REGISTRY_V2}.binderState`]);
  });

  it("the drop's registry is read once and kept: it never changes", async () => {
    const { gateway, reads } = world();
    await gateway.liveBinder(NEW_DROP);
    await gateway.binderLive(NEW_DROP);
    await gateway.liveBinder(NEW_DROP);
    expect(reads.filter((read) => read.endsWith(".BINDER_REGISTRY"))).toEqual([
      `${NEW_DROP}.BINDER_REGISTRY`,
    ]);
  });

  it("a registry that is not one of the chain's: an error, and it is never read", async () => {
    const { gateway, reads } = world();
    await expect(gateway.liveBinder(ODD_DROP)).rejects.toBeInstanceOf(UnknownBinderRegistryError);
    await expect(gateway.binderLive(ODD_DROP)).rejects.toBeInstanceOf(UnknownBinderRegistryError);
    expect(reads).not.toContain(`${STRANGER}.binderState`);
  });

  it("on a V6 only chain the old BinderRegistry is not one of them", async () => {
    const { gateway } = world({ registries: [REGISTRY_V2] });
    await expect(gateway.liveBinder(OLD_DROP)).rejects.toBeInstanceOf(UnknownBinderRegistryError);
  });
});

describe("the adapter and handle mode, per drop", () => {
  it("the adapter passes the drop to the gateway", async () => {
    const { adapter, reads } = world();
    expect(await adapter.liveBinder(OLD_DROP)).toBe(OLD_BINDER);
    expect(reads).toContain(`${OLD_DROP}.BINDER_REGISTRY`);
  });

  it("handle mode for a V6 drop: on, our key is the binder of BinderRegistryV2", async () => {
    const { adapter } = world();
    expect(await handleModeStatus(adapter, bindersFor(TEST_BINDER_ENV), NEW_DROP)).toEqual({
      on: true,
      reason: "on",
    });
  });

  it("handle mode for a V5 drop reads the old registry: another binder is a mismatch", async () => {
    const { adapter } = world();
    expect(await handleModeStatus(adapter, bindersFor(TEST_BINDER_ENV), OLD_DROP)).toEqual({
      on: false,
      reason: "binder_mismatch",
    });
  });

  it("handle mode for a drop with a registry we do not know: off, chain_not_ready", async () => {
    const { adapter } = world();
    expect(await handleModeStatus(adapter, bindersFor(TEST_BINDER_ENV), ODD_DROP)).toEqual({
      on: false,
      reason: "chain_not_ready",
    });
  });

  it("a V6 only chain: handle mode is ready, with no V2 to V5 fields", async () => {
    const mainnet = getChain("robinhood");
    const { gateway } = world({ registries: [REGISTRY_V2] });
    const adapter = createEvmAdapter({
      gateway,
      chain: {
        ...mainnet,
        contracts: {
          ...mainnet.contracts,
          factoryV6: F6,
          implementationV6: DROP_V6,
          binderRegistryV2: REGISTRY_V2,
          deployBlockV6: 140_000_000,
        },
      },
    });
    expect(await adapter.handleModeReady()).toBe(true);
  });

  it("a V7 only chain, the robinhood mainnet record: handle mode is ready", async () => {
    const mainnet = getChain("robinhood");
    expect(mainnet.contracts.factoryV7).not.toBeNull();
    expect(mainnet.contracts.factoryV6).toBeNull();
    expect(mainnet.contracts.factoryV2).toBeNull();
    const { gateway } = world({ registries: [REGISTRY_V2] });
    const adapter = createEvmAdapter({ gateway, chain: mainnet });
    expect(await adapter.handleModeReady()).toBe(true);
  });
});
