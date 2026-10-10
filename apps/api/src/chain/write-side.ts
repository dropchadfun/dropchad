/**
 * Assembling the write side: chain registry entry, viem clients, relayer, gateway.
 *
 * One place, so `src/index.ts` stays a wiring file and a test can build the same object over
 * anvil. It is the only caller of `createViemRelayerTransport`, which is the only place the
 * private key exists at all.
 *
 * Everything it refuses to do is as important as what it does:
 * - it will not start without an RPC url, and it names the exact variable to set
 * - it will not start when `RELAYER_ADDRESS` is set and the key derives to a different address
 * - it never returns, prints or stores the key
 */
import {
  getDeployedChain,
  hasFeeModelContracts,
  hasHandleContracts,
  hasTokenDropContracts,
  type DeployedChain,
} from "@dropchad/chains";
import { eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Config } from "../config.js";
import type { Database } from "../db/client.js";
import { drops, relayerTxs } from "../db/schema.js";
import { createReadClient, createViemRelayerTransport } from "./client.js";
import { createDbGasBudget } from "./gas-budget.js";
import { createChainGateway, type ChainGateway } from "./gateway.js";
import { createRelayer, type RelayerRecorder } from "./relayer.js";

/**
 * Writes every relayer transaction to the database.
 *
 * The hash, the kind, the destination and the gas. **Never a key**, and there is no field here
 * that could hold one.
 */
export function createDbRecorder(db: Database, chainId: number, chainKey: string): RelayerRecorder {
  return {
    async onSent(tx) {
      // The tx hash is the audit trail and it is public. The key is not here and never will be.
      console.log(`relayer ${tx.kind} sent`, { hash: tx.hash, to: tx.to, nonce: tx.nonce });
      await db.insert(relayerTxs).values({
        txHash: tx.hash,
        kind: tx.kind,
        chainId,
        chainKey,
        dropAddress: tx.dropAddress === null ? null : tx.dropAddress.toLowerCase(),
        toAddress: tx.to.toLowerCase(),
        nonce: BigInt(tx.nonce),
        gasLimit: tx.gasLimit.toString(),
        status: "sent",
      });
    },

    async onReceipt(tx) {
      await db
        .update(relayerTxs)
        .set({
          gasUsed: tx.receipt.gasUsed.toString(),
          effectiveGasPrice: tx.receipt.effectiveGasPrice.toString(),
          costWei: tx.costWei.toString(),
          status: tx.receipt.status === "success" ? "success" : "reverted",
        })
        .where(eq(relayerTxs.txHash, tx.hash));
    },
  };
}

/** The factory and clone implementation new drops are created on. */
export interface EvmFactory {
  readonly version: 1 | 2 | 3 | 4;
  readonly factory: Address;
  readonly implementation: Address;
  /** Only with V2, V3 and V4; the worker reads the live binder from it. */
  readonly binderRegistry?: Address;
}

/**
 * `DropFactoryV2` and `DropV2` once the whole V2 set is recorded, else `DropFactoryV1` and
 * `DropV1`.: V2 creates **every** new drop, both modes, and V1 is paused, so there is never
 * a choice per drop. The relayer's one factory, the gateway and the CREATE2 prediction all take
 * this pick, so they can never disagree. False on every chain.
 */
export function evmFactoryFor(chain: DeployedChain): EvmFactory {
  // once V4 is recorded it creates every new drop, with the fee, and V3
  // is paused. The clones are the same `DropV3`. Null on every chain.
  if (hasFeeModelContracts(chain)) {
    return {
      version: 4,
      factory: getAddress(chain.contracts.factoryV4),
      implementation: getAddress(chain.contracts.implementationV4),
      binderRegistry: getAddress(chain.contracts.binderRegistry),
    };
  }
  // once V3 is recorded it creates every new drop, both modes and both assets, and V2 is
  // paused. `DropV3` reads the same live registry. Null on every chain until V3 is deployed.
  if (hasTokenDropContracts(chain)) {
    return {
      version: 3,
      factory: getAddress(chain.contracts.factoryV3),
      implementation: getAddress(chain.contracts.implementationV3),
      binderRegistry: getAddress(chain.contracts.binderRegistry),
    };
  }
  if (hasHandleContracts(chain)) {
    return {
      version: 2,
      factory: getAddress(chain.contracts.factoryV2),
      implementation: getAddress(chain.contracts.implementationV2),
      binderRegistry: getAddress(chain.contracts.binderRegistry),
    };
  }
  return {
    version: 1,
    factory: getAddress(chain.contracts.factory),
    implementation: getAddress(chain.contracts.implementation),
  };
}

/**
 * The factory whose `allowedToken` the Robinhood token check reads: the one new drops are
 * created on, `DropFactoryV3` or, once recorded, `DropFactoryV4`. `null` before V3: no
 * Robinhood token drops.
 */
export function evmTokenCheckFactory(chain: DeployedChain): Address | null {
  const picked = evmFactoryFor(chain);
  return picked.version >= 3 ? picked.factory : null;
}

/** The EVM write side: the gateway, and the chain name for the funding warnings. */
export interface WriteSide {
  readonly chain: ChainGateway;
  readonly chainName: string;
}

export class WriteSideConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteSideConfigError";
  }
}

export interface BuildWriteSideResult {
  readonly writeSide: WriteSide;
  readonly chain: DeployedChain;
  readonly relayerAddress: Address;
}

/**
 * Build the write side, or explain exactly what is missing.
 *
 * Returns `null` when there is no relayer key. That is not an error: a read only api is a valid
 * way to run this process, and it is how the test suite runs.
 */
export function buildWriteSide(config: Config, db: Database): BuildWriteSideResult | null {
  if (config.RELAYER_PRIVATE_KEY === undefined) return null;

  const chain = getDeployedChain(config.CHAIN_KEY);

  if (config.chainRpcUrls === null) {
    throw new WriteSideConfigError(
      `the relayer needs an RPC url for chain "${chain.key}": set ${String(chain.rpcEnv)} in apps/api/.env`,
    );
  }

  const privateKey = config.RELAYER_PRIVATE_KEY as Hex;
  const derived = privateKeyToAccount(privateKey).address;

  if (config.RELAYER_ADDRESS !== undefined) {
    const expected = getAddress(config.RELAYER_ADDRESS);
    if (derived !== expected) {
      // The address is public, so naming both is safe and it is the only useful message here.
      throw new WriteSideConfigError(
        `RELAYER_PRIVATE_KEY belongs to ${derived}, but RELAYER_ADDRESS says ${expected}. ` +
          `Refusing to start rather than sending drops from the wrong wallet.`,
      );
    }
  }

  const publicClient = createReadClient(chain, config.chainRpcUrls);
  const transport = createViemRelayerTransport({
    chain,
    rpcUrls: config.chainRpcUrls,
    privateKey,
    publicClient,
  });

  const contracts = evmFactoryFor(chain);
  const relayer = createRelayer({
    transport,
    factory: contracts.factory,
    factoryVersion: contracts.version,
    // A drop is "known" only once it is in our table, which happens only after its `DropCreated`
    // event matched the address we predicted. So the relayer can never be aimed at a stranger.
    isKnownDrop: async (address) => {
      const rows = await db
        .select({ address: drops.address })
        .from(drops)
        .where(eq(drops.address, address.toLowerCase()))
        .limit(1);
      return rows.length === 1;
    },
    gasBudget: createDbGasBudget({
      db,
      chainId: chain.chainId,
      dailyLimitWei: config.relayerDailyGasBudgetWei,
      now: () => new Date(),
    }),
    gasCaps: {
      createDrop: BigInt(config.RELAYER_MAX_GAS_PER_CREATE),
      claimBatch: BigInt(config.RELAYER_MAX_GAS_PER_CLAIM_BATCH),
      claimHandle: BigInt(config.RELAYER_MAX_GAS_PER_CLAIM_HANDLE),
    },
    recorder: createDbRecorder(db, chain.chainId, chain.key),
  });

  return {
    chain,
    relayerAddress: derived,
    writeSide: {
      chain: createChainGateway({
        publicClient,
        relayer,
        chainId: chain.chainId,
        ...contracts,
      }),
      chainName: chain.name,
    },
  };
}
