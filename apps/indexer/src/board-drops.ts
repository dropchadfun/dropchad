/**
 * The rows of `GET /board-drops`, built from plain rows so the rule can be tested outside Ponder.
 *
 * One row per drop handed in, with the sum of its **final** claims, the distinct addresses they
 * paid, and, since, `claimedIndexes`: the merkle indexes of those final
 * claims, both kinds, ascending. The api reads the X id behind each index for a handle drop,
 * a `seen` claim is on no board.
 */
export interface BoardDropIn {
  readonly address: string;
  readonly creatorCommitment: string;
  /** Unix seconds of the creation block. */
  readonly timestamp: bigint;
}

export interface BoardClaimIn {
  readonly drop: string;
  readonly index: number;
  readonly recipient: string;
  readonly amount: bigint;
  readonly finality: string;
}

export interface BoardDropOut {
  readonly address: string;
  readonly creatorCommitment: string;
  readonly createdAt: string;
  readonly claimedFinalWei: string;
  readonly claimedCountFinal: number;
  readonly recipients: string[];
  readonly claimedIndexes: number[];
}

export function boardDropsFrom(
  drops: readonly BoardDropIn[],
  claims: readonly BoardClaimIn[],
): BoardDropOut[] {
  const byDrop = new Map<
    string,
    { total: bigint; count: number; recipients: Set<string>; indexes: number[] }
  >();
  for (const claim of claims) {
    if (claim.finality !== "final") continue;
    const entry = byDrop.get(claim.drop) ?? {
      total: 0n,
      count: 0,
      recipients: new Set<string>(),
      indexes: [],
    };
    entry.total += claim.amount;
    entry.count += 1;
    entry.recipients.add(claim.recipient);
    entry.indexes.push(claim.index);
    byDrop.set(claim.drop, entry);
  }

  return drops.map((drop) => {
    const totals = byDrop.get(drop.address);
    return {
      address: drop.address,
      creatorCommitment: drop.creatorCommitment,
      createdAt: drop.timestamp.toString(),
      claimedFinalWei: (totals?.total ?? 0n).toString(),
      claimedCountFinal: totals?.count ?? 0,
      recipients: [...(totals?.recipients ?? [])],
      claimedIndexes: [...(totals?.indexes ?? [])].sort((a, b) => a - b),
    };
  });
}
