/**
 * The viem clients, and the relayer transport built on top of them.
 *
 * This is the only file in `apps/api` that turns `RELAYER_PRIVATE_KEY` into an account. The key
 * goes in, an `Address` comes out, and nothing else in the codebase can reach it: `createRelayer`
 * takes a `RelayerTransport`, which exposes an address and four verbs and no way to sign anything
 * else.
 *
 * The chain object is built from `packages/chains`, so the chain id, the symbol and the explorer
 * all come from the registry and are never written twice.
 */
import {
  ChainRegistryError,
  getChain,
  hasV6Contracts,
  hasV7Contracts,
  isDeployed,
  type Chain as RegistryChain,
  type DeployedChain,
  type V6ContractsChain,
  type V7ContractsChain,
} from "@dropchad/chains";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  fallback,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { RelayerTransport } from "./relayer.js";

/**
 * The chains whose gas estimate carries an L1 data part, Arbitrum Nitro, and the precompile that
 * prices it.
 */
const NITRO_CHAIN_KEYS: ReadonlySet<string> = new Set(["robinhood", "robinhood-testnet"]);
const NODE_INTERFACE: Address = "0x00000000000000000000000000000000000000C8";
const nodeInterfaceAbi = parseAbi([
  "function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)",
]);

/** RPC urls, primary first. More than one only when a fallback is set, `rpcUrlsFor`. */
export type RpcUrls = string | readonly string[];

function urlList(rpcUrls: RpcUrls): string[] {
  const list = typeof rpcUrls === "string" ? [rpcUrls] : [...rpcUrls];
  if (list.length === 0) throw new Error("no RPC url");
  return list;
}

/**
 * One url: plain http. More: viem's `fallback`, which sends every call to the first url and moves
 * to the next only when it fails, a 429 included. So a keyed fallback costs nothing while the
 * public primary answers.
 */
export function rpcTransport(rpcUrls: RpcUrls): Transport {
  const list = urlList(rpcUrls);
  return list.length === 1 ? http(list[0]) : fallback(list.map((url) => http(url)));
}

/**
 * An EVM chain the api serves: `isDeployed` (V1 recorded), `hasV6Contracts`, the V6 set on top
 * of V5 or alone, or `hasV7Contracts`, the V7 set on top of V6 or alone (the mainnet shape).
 */
export type ServedEvmChain = DeployedChain | V6ContractsChain | V7ContractsChain;

export function isServedEvmChain(chain: RegistryChain): chain is ServedEvmChain {
  return (
    chain.family === "evm" && (isDeployed(chain) || hasV6Contracts(chain) || hasV7Contracts(chain))
  );
}

/** The chain with this key, proven served. Throws when it is not, as `getDeployedChain`. */
export function getServedEvmChain(key: string): ServedEvmChain {
  const chain = getChain(key);
  if (!isServedEvmChain(chain)) {
    throw new ChainRegistryError(`chain "${key}" has no deployed factory yet, or is not active.`);
  }
  return chain;
}

/** A viem chain from a registry entry. */
export function toViemChain(chain: ServedEvmChain, rpcUrls: RpcUrls): Chain {
  return defineChain({
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: urlList(rpcUrls) } },
    ...(chain.explorer === null
      ? {}
      : { blockExplorers: { default: { name: "explorer", url: chain.explorer } } }),
  });
}

export function createReadClient(chain: ServedEvmChain, rpcUrls: RpcUrls): PublicClient {
  return createPublicClient({
    chain: toViemChain(chain, rpcUrls),
    transport: rpcTransport(rpcUrls),
  });
}

export interface RelayerTransportOptions {
  readonly chain: ServedEvmChain;
  readonly rpcUrls: RpcUrls;
  /**
   * A raw key or a ready account, exactly one. The raw key is never logged, never stored, never
   * returned: it becomes an account and then goes out of scope. The account is the KMS one on a
   * mainnet chain.
   */
  readonly privateKey?: Hex;
  readonly account?: LocalAccount;
  readonly publicClient: PublicClient;
}

export interface RelayerTransportHandle extends RelayerTransport {
  readonly walletClient: WalletClient;
}

/**
 * The real transport. Every method here is one RPC call and nothing more, which is what keeps
 * `relayer.ts` — where the rules live — testable against a fake chain.
 */
export function createViemRelayerTransport(
  options: RelayerTransportOptions,
): RelayerTransportHandle {
  const viemChain = toViemChain(options.chain, options.rpcUrls);
  if ((options.privateKey === undefined) === (options.account === undefined)) {
    throw new Error("the relayer transport takes a private key or an account, exactly one");
  }
  const account = options.account ?? privateKeyToAccount(options.privateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: rpcTransport(options.rpcUrls),
  });
  const { publicClient } = options;
  const address: Address = account.address;

  return {
    address,
    walletClient,

    pendingNonce: () => publicClient.getTransactionCount({ address, blockTag: "pending" }),

    estimateGas: (tx) =>
      publicClient.estimateGas({ account: address, to: tx.to, data: tx.data, value: tx.value }),

    /**
     * The L1 data part of the estimate, from `NodeInterface`, on a Nitro
     * chain only. A failed or malformed read is 0, so the whole estimate counts as work. The
     * error is never logged: it can carry an rpc url.
     */
    async l1GasPart(tx) {
      if (!NITRO_CHAIN_KEYS.has(options.chain.key)) return 0n;
      try {
        const { data } = await publicClient.call({
          account: address,
          to: NODE_INTERFACE,
          data: encodeFunctionData({
            abi: nodeInterfaceAbi,
            functionName: "gasEstimateL1Component",
            args: [tx.to, false, tx.data],
          }),
        });
        if (data === undefined) throw new Error("no data");
        const [l1Part] = decodeFunctionResult({
          abi: nodeInterfaceAbi,
          functionName: "gasEstimateL1Component",
          data,
        });
        return l1Part;
      } catch {
        console.warn(
          `relayer: the L1 gas part on ${options.chain.key} could not be read, the whole estimate counts as work`,
        );
        return 0n;
      }
    },

    /**
     * The worst case price per gas, for the budget reservation.
     *
     * Robinhood Chain is Arbitrum Nitro and answers EIP 1559 fee history, but a node that does
     * not is not a reason to refuse to send, so this falls back to the legacy gas price.
     */
    async maxFeePerGas() {
      try {
        const fees = await publicClient.estimateFeesPerGas();
        if (fees.maxFeePerGas !== undefined) return fees.maxFeePerGas;
      } catch {
        // fall through to the legacy price
      }
      return publicClient.getGasPrice();
    },

    send: (tx) =>
      walletClient.sendTransaction({
        account,
        chain: viemChain,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
        nonce: tx.nonce,
      }),

    waitForReceipt: (hash) => publicClient.waitForTransactionReceipt({ hash }),
  };
}
