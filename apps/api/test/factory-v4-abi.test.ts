/**
 * the gateway reads `minFeePerReceiver` and
 * `maxFeeAmount` with the full `DropFactoryV4` ABI from `packages/shared`, generated from the
 * foundry build, not a hand written copy. Version 3 and older still answer zero without a call,
 * `native-fee.test.ts`.
 */
import { dropFactoryV4Abi } from "@dropchad/shared";
import type { Address, PublicClient } from "viem";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { createChainGateway } from "../src/chain/gateway.js";
import type { Relayer } from "../src/chain/relayer.js";
import { FAKE_CHAIN_ID, FAKE_RELAYER } from "./fake-chain.js";

const FACTORY = getAddress("0x00000000000000000000000000000000000f4c74");

describe("the V4 fee views use the shared DropFactoryV4 ABI", () => {
  it.each(["minFeePerReceiver", "maxFeeAmount"] as const)("%s", async (name) => {
    const seen: { address: Address; abi: unknown; functionName: string }[] = [];
    const publicClient = {
      readContract(args: { address: Address; abi: unknown; functionName: string }) {
        seen.push(args);
        return Promise.resolve(7n);
      },
    } as unknown as PublicClient;
    const gateway = createChainGateway({
      publicClient,
      relayer: { address: FAKE_RELAYER } as Relayer,
      chainId: FAKE_CHAIN_ID,
      version: 4,
      factory: FACTORY,
      implementation: getAddress("0x00000000000000000000000000000000000d7093"),
    });

    expect(await gateway[name]()).toBe(7n);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.address).toBe(FACTORY);
    expect(seen[0]?.functionName).toBe(name);
    expect(dropFactoryV4Abi).toBeDefined();
    expect(seen[0]?.abi).toBe(dropFactoryV4Abi);
  });
});
