/**
 * Both write sides, built from one config, into one `ChainAdapters`.
 *
 * The EVM side is `buildWriteSide` as it always was, wrapped in `createEvmAdapter`. The Solana
 * side is `buildSolanaWriteSide`. Either may be off — no key — and the api runs with whatever it
 * has. With neither, the api is read only, exactly as before.
 *
 * The default chain is the EVM one when it exists, so every caller that names no chain keeps
 * getting Robinhood testnet. That is what keeps the 206 existing tests and the existing frontend
 * call untouched.
 */
import { getChain } from "@dropchad/chains";

import type { Config } from "../config.js";
import type { Database } from "../db/client.js";
import { adaptersFrom, type ChainAdapter, type ChainAdapters } from "./adapter.js";
import { createEvmAdapter } from "./evm/adapter.js";
import { buildSolanaWriteSide, type SolanaWriteSideResult } from "./svm/write-side.js";
import { buildWriteSide } from "./write-side.js";

export interface BuiltWriteSides {
  /** `undefined` when no key at all is configured: the read only api. */
  readonly adapters: ChainAdapters | undefined;
  /** One line per chain for the boot log. Addresses are public; no value from a secret is here. */
  readonly lines: readonly string[];
  readonly solana: SolanaWriteSideResult;
}

export async function buildWriteSides(config: Config, db: Database): Promise<BuiltWriteSides> {
  const adapters: ChainAdapter[] = [];
  const lines: string[] = [];

  const evm = buildWriteSide(config, db);
  if (evm === null) {
    lines.push("no RELAYER_PRIVATE_KEY, the EVM write side is off");
  } else {
    adapters.push(
      createEvmAdapter({
        gateway: evm.writeSide.chain,
        chain: getChain(evm.chain.key),
        gas: {
          createDrop: BigInt(config.EVM_GAS_CREATE_DROP),
          activate: BigInt(config.EVM_GAS_ACTIVATE),
          claimBatchBase: BigInt(config.EVM_GAS_CLAIM_BATCH_BASE),
          perAddressClaim: BigInt(config.EVM_GAS_PER_ADDRESS_CLAIM),
          perHandleClaim: BigInt(config.EVM_GAS_PER_HANDLE_CLAIM),
          tokenCreateDrop: BigInt(config.EVM_GAS_TOKEN_CREATE_DROP),
          tokenActivate: BigInt(config.EVM_GAS_TOKEN_ACTIVATE),
          perTokenHandleClaim: BigInt(config.EVM_GAS_PER_TOKEN_HANDLE_CLAIM),
        },
      }),
    );
    // The address is public. The key is never printed, not even a prefix of it.
    lines.push(`relayer ${evm.relayerAddress} on ${evm.chain.name} (${String(evm.chain.chainId)})`);
  }

  const solana = await buildSolanaWriteSide(config, db);
  switch (solana.kind) {
    case "off":
      lines.push(solana.reason);
      break;
    case "config_missing":
      lines.push(`solana write side OFF: ${solana.hint}`);
      break;
    case "on":
      adapters.push(solana.adapter);
      lines.push(
        `solana relayer ${solana.relayerAddress} on ${solana.chain.name} (${String(solana.chain.chainId)}), ` +
          `config ${solana.configCheck.configAddress}` +
          (solana.configCheck.config.paused ? ", creation PAUSED" : ""),
      );
      break;
  }

  if (adapters.length === 0) return { adapters: undefined, lines, solana };
  const defaultKey = evm === null ? (adapters[0] as ChainAdapter).chainKey : evm.chain.key;
  return { adapters: adaptersFrom(adapters, defaultKey), lines, solana };
}
