/**
 * A multisend's receivers on its page, option B
 * every row for the sender; for everyone else only the rows the chain says
 * are claimed, which the chain shows anyway. Never a proof: no browser needs one, the worker
 * sends every claim.
 *
 * Paid is the chain's word, as for `fed`: the caller passes `paidIndexesOf` the chain side,
 * never our own `paidCount` or `failedIndexes`.
 */
export interface MultisendReceiver {
  readonly index: number;
  readonly recipient: string;
  /** Base units, a decimal string. */
  readonly amount: string;
}

/**
 * The rows of an address manifest, version 1, by index: all of them (`"all"`), or only the
 * given indexes. `[]` for anything that is not an address manifest.
 */
export function multisendReceivers(
  manifestJson: string,
  which: "all" | readonly number[],
): MultisendReceiver[] {
  let doc: unknown;
  try {
    doc = JSON.parse(manifestJson);
  } catch {
    return [];
  }
  const entries = (doc as { version?: unknown; entries?: unknown } | null)?.entries;
  if ((doc as { version?: unknown } | null)?.version !== 1 || !Array.isArray(entries)) return [];
  const keep = which === "all" ? null : new Set(which);
  const out: MultisendReceiver[] = [];
  for (const entry of entries as unknown[]) {
    const { index, recipient, amount } = (entry ?? {}) as Record<string, unknown>;
    if (typeof index !== "number" || typeof recipient !== "string" || typeof amount !== "string")
      continue;
    if (keep !== null && !keep.has(index)) continue;
    out.push({ index, recipient, amount });
  }
  return out.sort((a, b) => a.index - b.index);
}
