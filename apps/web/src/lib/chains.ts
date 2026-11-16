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
  hasV6Contracts,
  hasV7Contracts,
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
  /**
   * On `/create`, a chain on `API_LISTED_CHAINS` that the api lists with new
   * drops off. Not selectable, and no `soon` label. False or absent everywhere else.
   */
  readonly paused?: boolean;
}

/**
 * The api switch: the mainnet chains that are live on the site only while
 * `GET /api/chains` lists them. Every other mainnet chain is live from the registry alone.
 */
export const API_LISTED_CHAINS: readonly string[] = ["robinhood"];

/** What the last good `GET /api/chains` answer says about the chains on `API_LISTED_CHAINS`. */
export interface LiveView {
  /** Listed by the api: their write side runs there. */
  readonly listed: ReadonlySet<string>;
  /** Listed with `createsOn` false. */
  readonly paused: ReadonlySet<string>;
}

/** No good answer yet: every chain on `API_LISTED_CHAINS` is hidden. */
export const NO_API_VIEW: LiveView = { listed: new Set(), paused: new Set() };

/** A chain the api switch lets through: not on the list, or listed. */
function openedBy(chain: Chain, view: LiveView): boolean {
  return !API_LISTED_CHAINS.includes(chain.key) || view.listed.has(chain.key);
}

/** on a mainnet site a pill counts only its own mainnet chain, never a testnet. */
const MAINNET_SITE = !isTestnetOnly();

/**
 * The one test of a deployed chain on the web
 * V1, V6 or V7 recorded, or a program. The pills and `liveMainnetKeys()` both read it.
 */
export function isLiveDeployed(chain: Chain): boolean {
  return (
    isDeployed(chain) || hasV6Contracts(chain) || hasV7Contracts(chain) || isProgramDeployed(chain)
  );
}

function deployedFor(chain: Chain, mainnetSite: boolean, view: LiveView): Chain[] {
  return chains.filter(
    (candidate) =>
      isLiveDeployed(candidate) &&
      (mainnetSite
        ? candidate.key === chain.key && openedBy(candidate, view)
        : (candidate.key === chain.key && candidate.kind !== "mainnet") ||
          candidate.testnetOf === chain.key),
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
export function chainPills(
  options: {
    /** Reads the pills as on the testnet site; absent, the registry decides. */
    readonly testnetSite?: boolean;
    /** The live view from `lib/live-chains.ts`; absent, no answer. */
    readonly view?: LiveView;
    /** The `/create` pills: a paused chain on the list is not selectable there. */
    readonly forCreate?: boolean;
  } = {},
): ChainPill[] {
  const mainnetSite = options.testnetSite === true ? false : MAINNET_SITE;
  const view = options.view ?? NO_API_VIEW;
  return chains
    .filter((chain) => chain.displayOrder !== null)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((chain) => {
      const deployed = deployedFor(chain, mainnetSite, view);
      const family = familyOfChain(chain);
      const paused =
        options.forCreate === true &&
        mainnetSite &&
        deployed.length > 0 &&
        API_LISTED_CHAINS.includes(chain.key) &&
        view.paused.has(chain.key);
      return {
        key: chain.key,
        name: chain.name,
        nativeSymbol: chain.nativeSymbol,
        logo: `/chains/${chain.key}.svg`,
        tileColor: `var(--brand-${chain.key})`,
        markScale: MARK_SCALE[chain.key] ?? 1,
        selectable: deployed.length > 0 && !paused,
        chainIds: deployed.map((entry) => entry.chainId).filter((id): id is number => id !== null),
        family,
        decimals: decimalsFor(family),
        chainKey: deployed[0]?.key ?? null,
        quickTokens: deployed[0]?.quickTokens ?? [],
        paused,
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
 * The registry keys of the live mainnet chains: a `mainnet` chain
 * with its contracts or program recorded, the same test as `isTestnetOnly()`, and for a chain on
 * `API_LISTED_CHAINS` only while the view lists it. No view: no answer.
 */
export function liveMainnetKeys(
  list: readonly Chain[] = chains,
  view: LiveView = NO_API_VIEW,
): string[] {
  return list
    .filter((chain) => chain.kind === "mainnet" && isLiveDeployed(chain) && openedBy(chain, view))
    .map((chain) => chain.key);
}

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

/** The registry's chain id for a key, `null` for a key it does not know. */
export function chainIdForKey(chainKey: string): number | null {
  return findChain(chainKey)?.chainId ?? null;
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
