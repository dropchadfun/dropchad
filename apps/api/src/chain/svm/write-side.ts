/**
 * Assembling the Solana write side: registry entry, RPC, signer, config gate, relayer, adapter.
 *
 * The one place the Solana secret is parsed. It comes in as `config.SOLANA_RELAYER_SECRET`, goes
 * into `signerFromSecret`, and only a `Signer` comes out — an object that can sign and name its
 * public key, and nothing else.
 *
 * What it refuses to do:
 * - start without an RPC url, and it names the exact variable
 * - start when `SOLANA_RELAYER_ADDRESS` is set and the secret derives to another key
 * - start when the on chain `Config` names another relayer or another chain id
 *
 * What it does **not** refuse: a missing `Config`. That is the state of a freshly deployed
 * program, and the api says so and runs without the Solana write side until the
 * init script has run.
 */
import { getChain, type Chain } from "@dropchad/chains";
import { eq } from "drizzle-orm";

import type { Config } from "../../config.js";
import type { Database } from "../../db/client.js";
import { drops, relayerTxs } from "../../db/schema.js";
import type { ChainAdapter } from "../adapter.js";
import { createDbGasBudget } from "../gas-budget.js";
import { WriteSideConfigError } from "../write-side.js";
import { BITMAP_ACCOUNT_BYTES, DROP_ACCOUNT_BYTES_HANDLE } from "./accounts.js";
import { createSvmAdapter } from "./adapter.js";
import { checkSolanaConfig, type SolanaConfigCheck } from "./config-gate.js";
import { signerFromSecret } from "./keypair.js";
import { pubkeyToBase58 } from "./pubkey.js";
import { createSvmRelayer, type SvmRelayerRecorder } from "./relayer.js";
import { createSvmRpc, type SvmRpc } from "./rpc.js";

export type ProgramChain = Chain & {
  readonly family: "svm";
  readonly chainId: number;
  readonly contracts: { readonly program: string; readonly deploySlot: number };
};

/**
 * The svm chain with a deployed program, whatever its product `status`.
 *
 * `isProgramDeployed` in `packages/chains` also wants `status: "active"`, which is the web pill's
 * question. The api's question is only "is there a program to talk to": the backend has to work
 * against devnet before the pill is flipped in Part 4.
 */
export function getProgramChain(key: string): ProgramChain {
  const chain = getChain(key);
  if (
    chain.family !== "svm" ||
    chain.chainId === null ||
    chain.contracts.program === null ||
    chain.contracts.deploySlot === null
  ) {
    throw new WriteSideConfigError(`chain "${key}" is not an svm chain with a deployed program.`);
  }
  return chain as ProgramChain;
}

/** Every Solana relayer transaction goes into `relayer_txs`. Signature, kind, target. Never a key. */
export function createSvmDbRecorder(db: Database, chain: ProgramChain): SvmRelayerRecorder {
  return {
    async onSent(tx) {
      console.log(`solana relayer ${tx.kind} sent`, {
        signature: tx.signature,
        drop: tx.dropAddress,
      });
      await db.insert(relayerTxs).values({
        txHash: tx.signature,
        kind: tx.kind,
        chainId: chain.chainId,
        chainKey: chain.key,
        dropAddress: tx.dropAddress,
        toAddress: chain.contracts.program,
        nonce: null,
        lastValidBlockHeight: BigInt(tx.lastValidBlockHeight),
        // Compute units stand in for gas on this chain. Same columns, said in the schema.
        gasLimit: String(tx.computeUnitLimit),
        status: "sent",
      });
    },
    async onConfirmed({ signature, result }) {
      await db
        .update(relayerTxs)
        .set({
          gasUsed: result.computeUnits === null ? null : String(result.computeUnits),
          effectiveGasPrice: null,
          costWei: result.relayerSpent.toString(),
          status: "success",
        })
        .where(eq(relayerTxs.txHash, signature));
    },
    async onFailed({ signature }) {
      await db
        .update(relayerTxs)
        .set({ status: "reverted" })
        .where(eq(relayerTxs.txHash, signature));
    },
  };
}

export type SolanaWriteSideResult =
  | { readonly kind: "off"; readonly reason: string }
  | {
      readonly kind: "config_missing";
      readonly chain: ProgramChain;
      readonly rpc: SvmRpc;
      readonly hint: string;
    }
  | {
      readonly kind: "on";
      readonly chain: ProgramChain;
      readonly rpc: SvmRpc;
      readonly adapter: ChainAdapter;
      readonly relayerAddress: string;
      readonly configCheck: Extract<SolanaConfigCheck, { kind: "ok" }>;
    };

/**
 * The rent `create_drop` pays for the drop and the bitmap: a 424 byte drop since handle
 * mode. Read from the cluster, never hard coded.
 */
export async function createDropRent(rpc: SvmRpc): Promise<bigint> {
  const [drop, bitmap] = await Promise.all([
    rpc.getMinimumBalanceForRentExemption(DROP_ACCOUNT_BYTES_HANDLE),
    rpc.getMinimumBalanceForRentExemption(BITMAP_ACCOUNT_BYTES),
  ]);
  return drop + bitmap;
}

/**
 * Build the Solana write side, or explain exactly why it is off.
 *
 * `off` is not an error, it is how the test suite and a read only deployment run.
 * `config_missing` is not an error either, it is the state before the init script.
 */
export async function buildSolanaWriteSide(
  config: Config,
  db: Database,
  fetchImpl?: typeof fetch,
): Promise<SolanaWriteSideResult> {
  if (config.SOLANA_RELAYER_SECRET === undefined) {
    return { kind: "off", reason: "no SOLANA_RELAYER_SECRET, the Solana write side is off" };
  }

  const chain = getProgramChain(config.SOLANA_CHAIN_KEY);
  if (config.solanaRpcUrl === null) {
    throw new WriteSideConfigError(
      `the Solana relayer needs an RPC url for chain "${chain.key}": set ${String(chain.rpcEnv)} in apps/api/.env`,
    );
  }

  const signer = signerFromSecret(config.SOLANA_RELAYER_SECRET);
  const derived = pubkeyToBase58(signer.publicKey);
  if (config.SOLANA_RELAYER_ADDRESS !== undefined && config.SOLANA_RELAYER_ADDRESS !== derived) {
    throw new WriteSideConfigError(
      `SOLANA_RELAYER_SECRET belongs to ${derived}, but SOLANA_RELAYER_ADDRESS says ` +
        `${config.SOLANA_RELAYER_ADDRESS}. Refusing to start rather than sending drops from the wrong wallet.`,
    );
  }

  const rpc = createSvmRpc({ url: config.solanaRpcUrl, ...(fetchImpl ? { fetchImpl } : {}) });

  const check = await checkSolanaConfig(rpc, {
    relayer: signer.publicKey,
    chainId: BigInt(chain.chainId),
    chainKey: chain.key,
  });
  if (check.kind === "missing") return { kind: "config_missing", chain, rpc, hint: check.hint };

  let rent: bigint | null = null;
  const relayer = createSvmRelayer({
    rpc,
    signer,
    isKnownDrop: async (address) => {
      const rows = await db
        .select({ address: drops.address })
        .from(drops)
        .where(eq(drops.address, address))
        .limit(1);
      return rows.length === 1;
    },
    budget: createDbGasBudget({
      db,
      chainId: chain.chainId,
      dailyLimitWei: config.solanaRelayerDailyBudgetLamports,
      now: () => new Date(),
      unit: "lamports",
    }),
    caps: {
      maxComputeUnits: config.SOLANA_MAX_COMPUTE_UNITS,
      priorityFeeMicroLamports: config.solanaPriorityFeeMicroLamports,
    },
    // The drop and the bitmap. Read once from the cluster, never hard coded.
    rentForCreate: async () => {
      rent ??= await createDropRent(rpc);
      return rent;
    },
    recorder: createSvmDbRecorder(db, chain),
  });

  return {
    kind: "on",
    chain,
    rpc,
    relayerAddress: derived,
    adapter: createSvmAdapter({
      rpc,
      relayer,
      chain,
      feeModel: {
        priorityFeeMicroLamports: config.solanaPriorityFeeMicroLamports,
        maxComputeUnits: config.SOLANA_MAX_COMPUTE_UNITS,
      },
    }),
    configCheck: check,
  };
}
