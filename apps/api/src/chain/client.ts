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
import type { DeployedChain } from "@dropchad/chains";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { RelayerTransport } from "./relayer.js";

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

/** A viem chain from a registry entry. */
export function toViemChain(chain: DeployedChain, rpcUrls: RpcUrls): Chain {
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

export function createReadClient(chain: DeployedChain, rpcUrls: RpcUrls): PublicClient {
  return createPublicClient({
    chain: toViemChain(chain, rpcUrls),
    transport: rpcTransport(rpcUrls),
  });
}

export interface RelayerTransportOptions {
  readonly chain: DeployedChain;
  readonly rpcUrls: RpcUrls;
  /** Never logged, never stored, never returned. It becomes an account and then goes out of scope. */
  readonly privateKey: Hex;
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
  const account = privateKeyToAccount(options.privateKey);
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
