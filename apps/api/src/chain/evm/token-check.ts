/**
 * The Robinhood token check. Someone pastes a token
 * address; this reads it from the chain and says whether it can be dropped, with its name and
 * ticker. Read only, no key. `DropFactoryV3` checks the list again at `createDrop`.
 *
 * - **The rules, in order; the first that fails gives the one reason.** No code or no
 *   `decimals`: `not a token`. A proxy (an EIP-1967 implementation, beacon or admin slot set, or
 *   the EIP-1167 clone code), except the exact addresses of `PROXY_EXCEPTION_TOKENS`: `it can be
 *   changed later`. Not `allowedToken` on `DropFactoryV3` and from no allowlisted
 *   launchpad: `it is not on our list yet`.
 * - **What a check cannot see:** a tax, a pause or a blocklist inside a token's code. Only reading
 *   the source finds them, so the list is the real decision and these
 *   reads are a second guard.
 * - **Name and ticker** are untrusted text, cut to 32 and 10 characters, `null` when absent.
 * - An ERC20 carries no logo: `logoUrl` is `null` and `logo()` always answers `null`.
 * - Never a price, a usd value or a market cap. The answer is kept 60 seconds per token.
 */
import { getAddress, type Address, type Hex, type PublicClient } from "viem";

import type { TokenCheck, TokenChecker } from "../svm/token-check.js";

/** Everything the check reads from the chain. `createViemErc20Reads` is the real one. */
export interface Erc20Reads {
  /** The token's code, `0x` when there is none. */
  code(token: Address): Promise<Hex>;
  slot(token: Address, slot: Hex): Promise<bigint>;
  /** `null` when the call fails or answers something that is not a `uint8`. */
  decimals(token: Address): Promise<number | null>;
  name(token: Address): Promise<string | null>;
  symbol(token: Address): Promise<string | null>;
  /** `allowedToken(token)` on `DropFactoryV3`. */
  allowedToken(token: Address): Promise<boolean>;
  /** An allowlisted launchpad's adapter says the token is from it. */
  fromLaunchpad(token: Address): Promise<boolean>;
}

/** The three EIP-1967 storage slots. Any of them set means the token can be changed. */
export const EIP1967_SLOTS = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
} as const satisfies Record<string, Hex>;

/**
 * proxies accepted by exact address, lower case. **Empty today** (
 * ); USDC and USDT go here when they exist on Robinhood, after their source is read.
 */
export const PROXY_EXCEPTION_TOKENS: ReadonlySet<string> = new Set<string>();

const MINIMAL_PROXY_PREFIX = "0x363d3d373d3d3d363d73";
const MINIMAL_PROXY_SUFFIX = "5af43d82803e903d91602b57fd5bf3";

/** The 45 byte EIP-1167 clone: the prefix, a 20 byte implementation, the suffix. */
export function isMinimalProxy(code: Hex): boolean {
  const lower = code.toLowerCase();
  return (
    lower.length === 2 + 45 * 2 &&
    lower.startsWith(MINIMAL_PROXY_PREFIX) &&
    lower.endsWith(MINIMAL_PROXY_SUFFIX)
  );
}

const NAME_MAX = 32;
const SYMBOL_MAX = 10;

/** Zero padding off the end, then at most `max` characters, never half an emoji. */
function clean(text: string | null, max: number): string | null {
  if (text === null) return null;
  const trimmed = text.replace(/\0+$/, "");
  if (trimmed.length === 0) return null;
  return Array.from(trimmed).slice(0, max).join("");
}

const notAToken = (mint: string): TokenCheck => ({
  mint,
  tokenProgram: null,
  name: null,
  symbol: null,
  decimals: null,
  logoUrl: null,
  launchpad: null,
  ok: false,
  reason: "not a token",
});

/** Every read for one token. Throws when the chain cannot be read. */
async function judge(reads: Erc20Reads, token: Address): Promise<TokenCheck> {
  const code = await reads.code(token);
  if (code === "0x" || code.length <= 2) return notAToken(token);
  const decimals = await reads.decimals(token);
  if (decimals === null) return notAToken(token);

  const [name, symbol, implementation, beacon, admin] = await Promise.all([
    reads.name(token),
    reads.symbol(token),
    reads.slot(token, EIP1967_SLOTS.implementation),
    reads.slot(token, EIP1967_SLOTS.beacon),
    reads.slot(token, EIP1967_SLOTS.admin),
  ]);
  const base = {
    mint: token,
    tokenProgram: "erc20",
    name: clean(name, NAME_MAX),
    symbol: clean(symbol, SYMBOL_MAX),
    decimals,
    logoUrl: null,
    launchpad: null,
  } as const;

  const proxy = implementation !== 0n || beacon !== 0n || admin !== 0n || isMinimalProxy(code);
  if (proxy && !PROXY_EXCEPTION_TOKENS.has(token.toLowerCase())) {
    return { ...base, ok: false, reason: "it can be changed later" };
  }
  const listed = (await reads.allowedToken(token)) || (await reads.fromLaunchpad(token));
  if (!listed) return { ...base, ok: false, reason: "it is not on our list yet" };
  return { ...base, ok: true, reason: null };
}

export function createEvmTokenChecker(options: {
  readonly reads: Erc20Reads;
  readonly now?: () => Date;
  /** How long one token's answer is reused. */
  readonly cacheMs?: number;
}): TokenChecker {
  const now = options.now ?? (() => new Date());
  const cacheMs = options.cacheMs ?? 60_000;
  const cache = new Map<string, { readonly at: number; readonly value: TokenCheck }>();

  return {
    async check(text) {
      const token = getAddress(text);
      const at = now().getTime();
      const hit = cache.get(token);
      if (hit !== undefined && at - hit.at < cacheMs) return hit.value;
      const value = await judge(options.reads, token);
      // A cheap sweep keeps the map to live answers only.
      for (const [key, entry] of cache) if (at - entry.at >= cacheMs) cache.delete(key);
      cache.set(token, { at, value });
      return value;
    },
    // An ERC20 has no logo field. The route answers `404 no_logo`, the web shows the letter.
    logo: () => Promise.resolve(null),
  };
}

const erc20ViewAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const allowedTokenAbi = [
  {
    type: "function",
    name: "allowedToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowedTokenFactory",
    stateMutability: "view",
    inputs: [{ name: "tokenFactory", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/** `ITokenFactoryAdapter.isTokenFromFactory`. */
const adapterAbi = [
  {
    type: "function",
    name: "isTokenFromFactory",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * The real reads, over the api's read client. `factory` is `DropFactoryV3`; `launchpads` are the
 * registry's launchpad factories with an adapter. A token call that reverts is `null`, never an
 * error: that is a token without that field. Anything else, like the RPC being down, throws.
 */
export function createViemErc20Reads(options: {
  readonly client: PublicClient;
  readonly factory: Address;
  readonly launchpads: readonly { readonly factory: Address; readonly adapter: Address }[];
}): Erc20Reads {
  const { client, factory } = options;
  const view = async <T>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch (error) {
      // viem names a revert `ContractFunctionExecutionError`; that is an answer, not an outage.
      if (error instanceof Error && error.name === "ContractFunctionExecutionError") return null;
      throw error;
    }
  };
  return {
    code: async (token) => (await client.getCode({ address: token })) ?? "0x",
    slot: async (token, slot) =>
      BigInt((await client.getStorageAt({ address: token, slot })) ?? "0x0"),
    decimals: (token) =>
      view(() =>
        client.readContract({ address: token, abi: erc20ViewAbi, functionName: "decimals" }),
      ),
    name: (token) =>
      view(() => client.readContract({ address: token, abi: erc20ViewAbi, functionName: "name" })),
    symbol: (token) =>
      view(() =>
        client.readContract({ address: token, abi: erc20ViewAbi, functionName: "symbol" }),
      ),
    allowedToken: (token) =>
      client.readContract({
        address: factory,
        abi: allowedTokenAbi,
        functionName: "allowedToken",
        args: [token],
      }),
    async fromLaunchpad(token) {
      for (const launchpad of options.launchpads) {
        const allowed = await client.readContract({
          address: factory,
          abi: allowedTokenAbi,
          functionName: "allowedTokenFactory",
          args: [launchpad.factory],
        });
        if (!allowed) continue;
        const from = await view(() =>
          client.readContract({
            address: launchpad.adapter,
            abi: adapterAbi,
            functionName: "isTokenFromFactory",
            args: [token],
          }),
        );
        if (from === true) return true;
      }
      return false;
    },
  };
}
