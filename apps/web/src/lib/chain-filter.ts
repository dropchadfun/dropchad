/**
 * The chain rail's selection. `ALL` means every chain. Otherwise a set of pill
 * keys that are on. Only live pills can be toggled, and the set can never go empty: turning the
 * last chain off is the same as turning every chain on.
 */
import type { ChainPill } from "@/lib/chains";

export const ALL = "all";
export type ChainSelection = typeof ALL | ReadonlySet<string>;

export function isAll(selection: ChainSelection): boolean {
  return selection === ALL;
}

export function isOn(selection: ChainSelection, key: string): boolean {
  return selection === ALL || selection.has(key);
}

export function toggleChain(
  selection: ChainSelection,
  key: string,
  pills: readonly ChainPill[],
): ChainSelection {
  const live = pills.filter((pill) => pill.selectable).map((pill) => pill.key);
  if (!live.includes(key)) return selection;

  const next = new Set(selection === ALL ? live : selection);
  if (next.has(key)) next.delete(key);
  else next.add(key);

  if (next.size === 0) return ALL;
  if (live.every((candidate) => next.has(candidate))) return ALL;
  return next;
}

/** The chain ids a row may be on to pass the filter, or `null` for no filter at all. */
export function selectedChainIds(
  selection: ChainSelection,
  pills: readonly ChainPill[],
): ReadonlySet<number> | null {
  if (selection === ALL) return null;
  const ids = new Set<number>();
  for (const pill of pills) {
    if (selection.has(pill.key)) for (const id of pill.chainIds) ids.add(id);
  }
  return ids;
}

/** Does a registry chain key belong to a pill that is on: the pill itself or a testnet of it. */
export function chainKeyIsOn(
  selection: ChainSelection,
  chainKey: string,
  pills: readonly ChainPill[],
): boolean {
  if (selection === ALL) return true;
  return pills.some(
    (pill) =>
      selection.has(pill.key) && (chainKey === pill.key || chainKey.startsWith(`${pill.key}-`)),
  );
}

/**
 * What the board api is asked for: the api ranks one chain or every chain,
 * never a subset. Exactly one pill on is that chain's board; anything else is `all`.
 */
export function boardChainOf(selection: ChainSelection): string {
  if (selection === ALL || selection.size !== 1) return ALL;
  return [...selection][0] ?? ALL;
}
