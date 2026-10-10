/**
 * One shape for a drop card, whichever side of the api it came from.
 *
 * six facts and one picture. Amount, token, receivers, claimed %, chain, age. One
 * chip: LIVE, FUNDING, DONE, EXPIRED. Anything else belongs on the drop page.
 *
 * Chain data wins when both sides are present. Our side fills in what the chain
 * cannot know: the title, the picture, the chad, and progress before the indexer has caught up.
 */
import type {
  DropListEntry,
  IndexedDrop,
  OwnDropCard,
  OwnState,
  Profile,
  TokenInfo,
} from "@/lib/api";

export type Chip = "LIVE" | "FUNDING" | "DONE" | "EXPIRED";

export interface DropCardData {
  readonly address: string;
  readonly chainId: number;
  /** A token drop's token; `null` or absent on a SOL or ETH drop. */
  readonly token?: TokenInfo | null;
  readonly title: string | null;
  readonly imageUrl: string | null;
  readonly creator: Profile | null;
  readonly chip: Chip;
  readonly amountWei: string;
  readonly receivers: number;
  readonly claimed: number;
  /** Unix seconds. */
  readonly createdAt: number;
}

export function chipForOwnState(state: OwnState): Chip {
  switch (state) {
    case "created":
      return "FUNDING";
    case "funded":
    case "active":
    case "paying":
      return "LIVE";
    case "finished":
    case "failed":
      return "DONE";
    case "funding_expired":
    case "claims_expired":
      return "EXPIRED";
  }
}

export function chipForIndexedStatus(status: IndexedDrop["status"]): Chip {
  switch (status) {
    case "Created":
      return "FUNDING";
    case "Active":
      return "LIVE";
    case "Finalized":
      return "DONE";
    case "Cancelled":
      return "EXPIRED";
  }
}

/**
 * The chip from the chain side alone. On chain a drop stays `Active` after its last claim is
 * paid, nothing flips it until the refund. So `Active` with every leaf
 * claimed is DONE here, not LIVE, with or without a row of ours. Item 0.2.
 */
export function chipForChain(
  drop: Pick<IndexedDrop, "status" | "claimedCount" | "leafCount">,
): Chip {
  if (drop.status === "Active" && drop.leafCount > 0 && drop.claimedCount >= drop.leafCount) {
    return "DONE";
  }
  return chipForIndexedStatus(drop.status);
}

/** A drop is live when money is moving or about to. Front page "live now" reads this. */
export function isLive(card: DropCardData): boolean {
  return card.chip === "LIVE";
}

/**
 * Whether a list entry may show in `live now` or latest drops: handle drops only.
 * The api lists nothing else; this is the front page checking again, so an old
 * api or a cached answer never puts a multisend, or a drop we did not create, back on it.
 */
export function isListed(entry: DropListEntry): boolean {
  return entry.dropchad?.mode === "handle";
}

export function fromListEntry(entry: DropListEntry): DropCardData {
  const ours = entry.dropchad;
  const chain = chipForChain(entry);
  return {
    address: entry.address,
    chainId: entry.chainId,
    token: ours?.token ?? null,
    title: ours?.title ?? null,
    imageUrl: ours?.memeImageUrl ?? null,
    creator: ours?.creator ?? null,
    // Our state is finer while a drop is being paid out; the chain's is final once it settles,
    // and every leaf paid is settled whatever our worker has written so far.
    chip:
      entry.status === "Active" && chain !== "DONE" && ours !== null
        ? chipForOwnState(ours.state)
        : chain,
    amountWei: entry.totalEntitlements,
    receivers: entry.leafCount,
    claimed: Math.max(entry.claimedCount, ours?.paidCount ?? 0),
    createdAt: Number(entry.createdAt),
  };
}

export function fromOwnCard(card: OwnDropCard): DropCardData {
  return {
    address: card.address,
    chainId: card.chainId,
    token: card.token ?? null,
    title: card.title,
    imageUrl: card.memeImageUrl,
    creator: card.creator,
    chip: chipForOwnState(card.state),
    amountWei: card.totalEntitlementsWei,
    receivers: card.leafCount,
    claimed: card.paidCount,
    createdAt: Math.floor(new Date(card.createdAt).getTime() / 1000),
  };
}
