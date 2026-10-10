/**
 * The Ponder config.
 *
 * Everything here is read from `@dropchad/chains`. No address, no chain id and no start block is
 * written in this file: `packages/chains/src/chains.json` is the one place that knows them, and
 * is what that copies from.
 *
 * Two rules from the design are enforced by this config alone:
 *
 * - **, only our factories.** `DropFactoryV1`, and `DropFactoryV2`, `DropFactoryV3` and
 *   `DropFactoryV4` once the registry has them, are each pinned to the one address in the registry. An event from any other address is never
 *   fetched, so it can never be stored.
 * - **only clones the factory reports as its own.** `DropV1`, `DropV2`, `DropV3` and `DropV4` use Ponder's factory
 *   pattern: the set of addresses is exactly the `drop` parameter of `DropCreated` logs emitted
 *   **by that factory**. A stranger's contract emitting a lookalike event is not in the set.
 *
 * V2 is in only when all four V2 fields are in the registry, `factoriesFor`.
 * Ponder refuses a handler for a contract name it was not given (`build/config.js`, 0.17.10), so
 * the V2 handlers are registered only when `V2` exists too, `src/index.ts`. The same for V3, once
 * all three V3 fields are recorded on top of V2. And for V4,
 * once all three V4 fields are recorded on top of V3: `DropV4` is the clones
 * of `DropFactoryV4`, the same `DropV3` code, so it takes the `DropV3` ABI.
 *
 * The start block is the **L2** deploy block. Nothing exists before it, so
 * no archive RPC is needed.
 */
import { rpcUrlFor } from "@dropchad/chains";
import {
  dropFactoryV1Abi,
  dropFactoryV2Abi,
  dropFactoryV3Abi,
  dropFactoryV4Abi,
  dropV1Abi,
  dropV2Abi,
  dropV3Abi,
} from "@dropchad/shared";
import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";

import { readIndexerEnv } from "./src/env.js";
import { factoriesFor } from "./src/factories.js";
import { indexedChain } from "./src/local-chain.js";

/** The optional lines of `.env.local`. Empty means not set, `src/env.ts`. */
const env = readIndexerEnv();

/**
 * Blocks behind the head before a row is called `final`.
 *
 * **Default 64, and that number is a placeholder.** decides the real value. Robinhood Chain is
 * an Arbitrum Orbit L2: soft finality comes from the sequencer, hard finality only when the batch
 * is posted to Ethereum L1, and those are very different waits. 64 L2 blocks is roughly 16
 * seconds here, which is nowhere near L1 finality. Until the design closes, `final` on this chain means
 * "past the reorg window the sequencer can produce", not "posted to L1".
 *
 * When the registry gets a `finalityDepth` for the chain, that wins over this default.
 */
export const CONFIRMATION_DEPTH = env.confirmationDepth;

/**
 * How often the promotion job runs, in blocks. Arbitrum blocks are fast, so running it every
 * block would mean thousands of no-op updates during the backfill for no gain.
 */
export const FINALITY_CHECK_INTERVAL = env.finalityCheckInterval;

/** The registry entry, or the anvil check's local chain file, `src/local-chain.ts`. */
const chain = indexedChain(env);

/**
 * Which chain is indexed: the `DROPCHAD_CHAIN` registry entry, or `anvil` from the local chain
 * file. One chain today, and the code does not assume that stays true.
 */
export const CHAIN_KEY = chain.key;

/**
 * The factories and the implementation each may clone, checksummed, `src/factories.ts`. A typo in
 * the registry fails here, not at runtime.
 */
export const FACTORIES = factoriesFor(chain);
const V1 = FACTORIES[0] as (typeof FACTORIES)[number];
const V2 = FACTORIES.find((entry) => entry.name === "DropFactoryV2");
/** True once the registry has `DropFactoryV2`: the V2 contracts and handlers are in. */
export const HAS_V2 = V2 !== undefined;
const V3 = FACTORIES.find((entry) => entry.name === "DropFactoryV3");
/** True once the registry has `DropFactoryV3`: the V3 contracts and handlers are in. */
export const HAS_V3 = V3 !== undefined;
const V4 = FACTORIES.find((entry) => entry.name === "DropFactoryV4");
/** True once the registry has `DropFactoryV4`: the V4 contracts and handlers are in. */
export const HAS_V4 = V4 !== undefined;
export const FACTORY_ADDRESS = V1.factory;
export const START_BLOCK = V1.startBlock;
export const CHAIN_ID = chain.chainId;
/**
 * Resolved once here so the code lookup and Ponder itself use the same endpoint.
 *
 * **One url, the primary, on purpose.** Ponder spreads its calls over every url it is given, and
 * it fetches every block of the chain, about 500,000 a day on Robinhood testnet (5.8 blocks a
 * second). A keyed fallback in that list would burn its quota again, as the
 * Alchemy key did. So the fallback env var is for the api only
 * and the primary here is the public endpoint.
 */
export const RPC_URL = rpcUrlFor(chain);

/**
 * `DropFactoryV2` and its clones, or nothing. Typed as always present so the V2 handler names
 * type check; at runtime the spread of `undefined` adds nothing, and `src/index.ts` registers the
 * V2 handlers only when `HAS_V2`.
 */
const v2Contracts =
  V2 === undefined
    ? undefined
    : {
        DropFactoryV2: {
          abi: dropFactoryV2Abi,
          chain: "dropchad" as const,
          address: V2.factory,
          startBlock: V2.startBlock,
        },
        DropV2: {
          abi: dropV2Abi,
          chain: "dropchad" as const,
          address: factory({
            address: V2.factory,
            event: getAbiItem({ abi: dropFactoryV2Abi, name: "DropCreated" }),
            parameter: "drop",
          }),
          startBlock: V2.startBlock,
        },
      };

/** `DropFactoryV3` and its clones, or nothing, as for V2. `src/index.ts` checks `HAS_V3`. */
const v3Contracts =
  V3 === undefined
    ? undefined
    : {
        DropFactoryV3: {
          abi: dropFactoryV3Abi,
          chain: "dropchad" as const,
          address: V3.factory,
          startBlock: V3.startBlock,
        },
        DropV3: {
          abi: dropV3Abi,
          chain: "dropchad" as const,
          address: factory({
            address: V3.factory,
            event: getAbiItem({ abi: dropFactoryV3Abi, name: "DropCreated" }),
            parameter: "drop",
          }),
          startBlock: V3.startBlock,
        },
      };

/**
 * `DropFactoryV4` and its clones, or nothing, as for V3. The clones run the same `DropV3` code,
 * so `DropV4` takes `dropV3Abi`; only the factory differs. `src/index.ts` checks `HAS_V4`.
 */
const v4Contracts =
  V4 === undefined
    ? undefined
    : {
        DropFactoryV4: {
          abi: dropFactoryV4Abi,
          chain: "dropchad" as const,
          address: V4.factory,
          startBlock: V4.startBlock,
        },
        DropV4: {
          abi: dropV3Abi,
          chain: "dropchad" as const,
          address: factory({
            address: V4.factory,
            event: getAbiItem({ abi: dropFactoryV4Abi, name: "DropCreated" }),
            parameter: "drop",
          }),
          startBlock: V4.startBlock,
        },
      };

export default createConfig({
  chains: {
    dropchad: {
      id: chain.chainId,
      // The registry holds the env var NAME. `rpcUrlFor` is the one place it becomes a value.
      rpc: RPC_URL,
    },
  },
  contracts: {
    DropFactoryV1: {
      abi: dropFactoryV1Abi,
      chain: "dropchad",
      address: FACTORY_ADDRESS,
      startBlock: START_BLOCK,
    },
    DropV1: {
      abi: dropV1Abi,
      chain: "dropchad",
      address: factory({
        address: FACTORY_ADDRESS,
        event: getAbiItem({ abi: dropFactoryV1Abi, name: "DropCreated" }),
        parameter: "drop",
      }),
      startBlock: START_BLOCK,
    },
    ...(v2Contracts as NonNullable<typeof v2Contracts>),
    ...(v3Contracts as NonNullable<typeof v3Contracts>),
    ...(v4Contracts as NonNullable<typeof v4Contracts>),
  },
  blocks: {
    // Drives the seen -> final promotion. It indexes nothing itself.
    // Starts at the head, not at START_BLOCK. From the deploy block it would fetch one block per
    // interval over the whole history, about 48,000 calls on a fresh backfill (9.6M blocks by
    // ). Each run promotes every row at or below its cutoff, so the first run at the
    // head catches up everything the backfill wrote; rows read `seen` only until then.
    Finality: {
      chain: "dropchad",
      startBlock: "latest",
      interval: FINALITY_CHECK_INTERVAL,
    },
  },
});
