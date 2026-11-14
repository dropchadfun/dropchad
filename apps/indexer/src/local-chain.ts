/**
 * Which chain the indexer follows.
 *
 * Normally the registry entry named by `DROPCHAD_CHAIN`, `packages/chains`. For the anvil check
 * the entry comes from a local file named by `INDEXER_LOCAL_CHAIN` instead, so no test chain ever
 * sits in the real registry. `src/env.ts` refuses the line in
 * production.
 *
 * The file is the registry's own shape, `{ "version": 1, "chains": [ one entry ] }`, checked by
 * the registry's own parser, so every registry rule holds here too. It must be anvil, chain id
 * 31337: a local file can never point the indexer at a real chain. It may hold the V1 set, or the
 * V6 set alone.
 */
import { readFileSync } from "node:fs";

import { ChainRegistryError, getChain, parseRegistry } from "@dropchad/chains";

import type { IndexerEnv } from "./env.js";
import { isIndexable, type IndexedChain } from "./factories.js";

export const ANVIL_CHAIN_ID = 31337;

/** One anvil chain out of the text of a local chain file. Throws with a sentence otherwise. */
export function localChainFrom(text: string): IndexedChain {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("INDEXER_LOCAL_CHAIN: the file is not JSON.");
  }
  const { chains } = parseRegistry(raw);
  if (chains.length !== 1) {
    throw new Error(
      `INDEXER_LOCAL_CHAIN: the file must hold one chain, it holds ${String(chains.length)}.`,
    );
  }
  const chain = chains[0] as (typeof chains)[number];
  if (chain.family !== "evm" || chain.chainId !== ANVIL_CHAIN_ID) {
    throw new Error(
      `INDEXER_LOCAL_CHAIN: only anvil, an evm chain with chain id ${String(ANVIL_CHAIN_ID)}. ` +
        `The file says ${chain.family} ${String(chain.chainId)}.`,
    );
  }
  if (!isIndexable(chain)) {
    throw new Error(
      "INDEXER_LOCAL_CHAIN: the chain needs status active, and the V1 set (factory, " +
        "implementation, deploy block) or the V6 set.",
    );
  }
  return chain;
}

/** The registry entry with this key, if the indexer can follow it: the V1 set or the V6 set. */
function registryChain(key: string): IndexedChain {
  const chain = getChain(key);
  if (!isIndexable(chain)) {
    throw new ChainRegistryError(
      `chain "${key}" has no deployed V1 factory or V6 set yet, or is not active. ` + "",
    );
  }
  return chain;
}

/** The chain to index: the local file when one is set, else the registry entry. */
export function indexedChain(
  env: Pick<IndexerEnv, "chainKey" | "localChainFile">,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): IndexedChain {
  if (env.localChainFile === undefined) return registryChain(env.chainKey);
  return localChainFrom(readFile(env.localChainFile));
}
