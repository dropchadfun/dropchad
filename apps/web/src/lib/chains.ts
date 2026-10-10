/**
 * The chain pills, from `@dropchad/chains`. Never hard coded in a component.
 *
 * A pill is **selectable** when the chain, or a testnet of it, has a deployed factory or a
 * deployed program. That is the registry rule (`status: active` and `contracts.factory` or
 * `contracts.program` plus `deploySlot` set) read through the testnet: `robinhood` is active with
 * no mainnet factory and `robinhood-testnet` has the real one, so the robinhood pill is live and
 * the drops behind it are on 46630; `solana-devnet` carries the program, so the solana pill is
 * live and its drops are on leaf chain id 103.
 */
import {
  chains,
  explorerAddressUrl,
  explorerTxUrl,
  findChain,
  findChainByChainId,
  findQuickToken,
  isDeployed,
  isProgramDeployed,
  isTestnetOnly,
  type Chain,
  type QuickToken,
} from "@dropchad/chains";

export type ChainFamily = "evm" | "svm";

export interface ChainPill {
  readonly key: string;
  readonly name: string;
  readonly nativeSymbol: string;
  /** `/chains/<key>.svg`, from the brand kit. */
  readonly logo: string;
  /** The tile behind the mark: `var(--brand-<key>)`, a css variable, value in Part 6 too. */
  readonly tileColor: string;
  /**
   * How much to grow the mark so its visible glyph is 16px, whatever the viewBox says.
   * `1 / (glyph longest side / viewBox side)`, measured from the file's paths. The ton file
   * paints its own circle in the tile colour and the glyph is 60 percent of it.
   */
  readonly markScale: number;
  readonly selectable: boolean;
  /** The chain ids a drop on this pill can be on: the mainnet and every deployed testnet. */
  readonly chainIds: readonly number[];
  /** `evm` or `svm`. Decides how addresses look and how many decimals the coin has. */
  readonly family: ChainFamily;
  readonly decimals: number;
  /** The registry key `POST /api/drops` is told: the deployed chain behind the pill, if any. */
  readonly chainKey: string | null;
  /** The quick token chips of the deployed chain behind the pill. Empty when none. */
  readonly quickTokens: readonly QuickToken[];
}

function deployedFor(chain: Chain): Chain[] {
  return chains.filter(
    (candidate) =>
      (isDeployed(candidate) || isProgramDeployed(candidate)) &&
      (candidate.key === chain.key || candidate.testnetOf === chain.key),
  );
}

function familyOfChain(chain: Chain | undefined): ChainFamily {
  return chain?.family === "svm" ? "svm" : "evm";
}

/** 9 on Solana, 18 everywhere else. */
export function decimalsFor(family: ChainFamily): number {
  return family === "svm" ? 9 : 18;
}

export function familyOf(chainId: number): ChainFamily {
  return familyOfChain(findChainByChainId(chainId));
}

export function decimalsOf(chainId: number): number {
  return decimalsFor(familyOf(chainId));
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 text that decodes to exactly 32 bytes. Twenty lines instead of a dependency. */
function isPubkey(text: string): boolean {
  if (!BASE58.test(text)) return false;
  let n = 0n;
  for (const c of text) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  let length = 0;
  for (let v = n; v > 0n; v /= 256n) length += 1;
  for (const c of text) {
    if (c !== "1") break;
    length += 1;
  }
  return length === 32;
}

/** Shape check per family, the same one the api does before it asks the chain. */
export function isAddressFor(text: string, family: ChainFamily): boolean {
  return family === "svm" ? isPubkey(text) : EVM_ADDRESS.test(text);
}

/** Every other file's glyph fills its viewBox, scale 1. */
const MARK_SCALE: Record<string, number> = { ton: 1.67 };

/** Pills in display order, from the registry: solana, robinhood, bnb, base, ethereum, ton. */
export function chainPills(): ChainPill[] {
  return chains
    .filter((chain) => chain.displayOrder !== null)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((chain) => {
      const deployed = deployedFor(chain);
      const family = familyOfChain(chain);
      return {
        key: chain.key,
        name: chain.name,
        nativeSymbol: chain.nativeSymbol,
        logo: `/chains/${chain.key}.svg`,
        tileColor: `var(--brand-${chain.key})`,
        markScale: MARK_SCALE[chain.key] ?? 1,
        selectable: deployed.length > 0,
        chainIds: deployed.map((entry) => entry.chainId).filter((id): id is number => id !== null),
        family,
        decimals: decimalsFor(family),
        chainKey: deployed[0]?.key ?? null,
        quickTokens: deployed[0]?.quickTokens ?? [],
      };
    });
}

/**
 * The one flag behind every `testnet` mark: the top bar, the funding card, the
 * share card. Read from the registry at build, never a copy of the word in a component. It
 * comes off the day a mainnet address goes into `chains.json`.
 */
export const TESTNET_ONLY: boolean = isTestnetOnly();

/**
 * The quick token at this exact address on the chain with this id
 * or `undefined`: only then are its name and logo ours.
 */
export function quickTokenAt(chainId: number, mint: string): QuickToken | undefined {
  const chain = findChainByChainId(chainId);
  return chain === undefined ? undefined : findQuickToken(chain.key, mint);
}

export function chainName(chainId: number): string {
  return findChainByChainId(chainId)?.name ?? `chain ${String(chainId)}`;
}

/** "Robinhood", "Robinhood test", "Solana test". For a line where the full name does not fit. */
export function shortChainName(chainId: number): string {
  const chain = findChainByChainId(chainId);
  if (chain === undefined) return `chain ${String(chainId)}`;
  const base = chain.name.replace(/ (Chain|Testnet|Devnet)/g, "").trim();
  return chain.kind === "testnet" ? `${base} test` : base;
}

export function nativeSymbol(chainId: number): string {
  return findChainByChainId(chainId)?.nativeSymbol ?? "ETH";
}

export function txUrl(chainId: number, hash: string): string | null {
  const chain = findChainByChainId(chainId);
  return chain === undefined ? null : explorerTxUrl(chain, hash);
}

export function addressUrl(chainId: number, address: string): string | null {
  const chain = findChainByChainId(chainId);
  return chain === undefined ? null : explorerAddressUrl(chain, address);
}

/**
 * A token's own page on a Blockscout explorer, `/token/<address>` (checked on the Robinhood
 * testnet explorer); any other explorer, its address page.
 */
export function tokenExplorerUrl(chainId: number, token: string): string | null {
  const chain = findChainByChainId(chainId);
  if (chain?.explorerKind === "blockscout" && chain.explorer !== null) {
    return `${chain.explorer}/token/${token}`;
  }
  return addressUrl(chainId, token);
}

/** The coin a registry key counts in. `ETH` and 18 for an unknown key. */
export function unitForKey(chainKey: string): { symbol: string; decimals: number } {
  const chain = findChain(chainKey);
  return {
    symbol: chain?.nativeSymbol ?? "ETH",
    decimals: decimalsFor(familyOfChain(chain)),
  };
}
