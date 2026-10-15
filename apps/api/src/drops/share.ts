/**
 * The share card, first version .
 *
 * The api sends the facts only: what was dropped and on how many people, the sender, every
 * receiver biggest first (pictures on the first 3 only), and the rank word. The card is drawn in the browser and the post text is built there, so
 * there is no text, no link and no image here, and no upload route for a background picture.
 */
import { eq, inArray } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { dropHandleLeaves, profiles, xUsers } from "../db/schema.js";

/** The api's own states in which a drop is funded and live. Before that there is no card. */
export const SHARE_READY_STATES: readonly string[] = [
  "active",
  "paying",
  "finished",
  "claims_expired",
];

/** How many receivers get a picture: the ones the post names. The rest are handles only. */
export const SHARE_PICTURES = 3;

/** The stamp on the fun design, from the usd value at the frozen price. */
export type ShareRank = "chad" | "gigachad" | "whale";

export interface ShareCardPerson {
  readonly handle: string;
  /** 400px when it is an X picture. */
  readonly profileImageUrl: string | null;
}

export interface ShareCard {
  readonly chainKey: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Base units: what was dropped, `totalEntitlements`, never what was claimed. */
  readonly amount: string;
  /** Every person in the drop, `leafCount`. */
  readonly people: number;
  readonly sender: ShareCardPerson;
  /** Every receiver, biggest share first, ties by leaf index. Pictures on the first 3 only. */
  readonly receivers: readonly ShareCardPerson[];
  /** `people` minus the receivers listed. */
  readonly rest: number;
  /** The word only; the usd number never leaves the api. `null` without a frozen price. */
  readonly rank: ShareRank | null;
}

/** A decimal string as millionths, exact, so 100 usd is 100 usd and not 99.99999. */
function micros(decimal: string): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (m === null) return null;
  const fraction = (m[2] ?? "").slice(0, 6).padEnd(6, "0");
  return BigInt(m[1] ?? "0") * 1_000_000n + BigInt(fraction);
}

/** Under 100 usd `chad`, 100 up to 1,000 `gigachad`, 1,000 and up `whale`. No price, no rank. */
export function shareRank(
  totalEntitlements: string,
  decimals: number,
  priceUsd: string | null,
): ShareRank | null {
  if (priceUsd === null) return null;
  const price = micros(priceUsd);
  if (price === null) return null;
  const usdMicros = (BigInt(totalEntitlements) * price) / 10n ** BigInt(decimals);
  if (usdMicros >= 1_000n * 1_000_000n) return "whale";
  if (usdMicros >= 100n * 1_000_000n) return "gigachad";
  return "chad";
}

/**
 * X's stored picture is the 48px `_normal`; the card wants the 400px one. X serves both with
 * `access-control-allow-origin` for our origin, so the browser draws it.
 */
export function avatar400(url: string | null): string | null {
  if (url === null) return null;
  return url.replace(/_normal(\.[a-z]+)$/i, "_400x400$1");
}

/** Every leaf biggest first, ties by leaf index, each with its handle. A leaf with no handle is skipped. */
export async function shareCardFor(
  db: Database,
  drop: {
    readonly address: string;
    readonly xUserId: string;
    readonly chainKey: string;
    readonly totalEntitlements: string;
    readonly leafCount: number;
    readonly priceUsd: string | null;
  },
  unit: { readonly symbol: string; readonly decimals: number },
): Promise<ShareCard> {
  const [senderRows, leaves] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.xUserId, drop.xUserId)).limit(1),
    db.select().from(dropHandleLeaves).where(eq(dropHandleLeaves.dropAddress, drop.address)),
  ]);

  const ordered = [...leaves].sort((a, b) => {
    const diff = BigInt(b.amount) - BigInt(a.amount);
    return diff === 0n ? a.leafIndex - b.leafIndex : diff > 0n ? 1 : -1;
  });
  const ids = [...new Set(ordered.map((leaf) => leaf.xUserId))];
  const known =
    ids.length === 0 ? [] : await db.select().from(xUsers).where(inArray(xUsers.xUserId, ids));
  const byId = new Map(known.map((user) => [user.xUserId, user]));

  const receivers: ShareCardPerson[] = [];
  for (const leaf of ordered) {
    const user = byId.get(leaf.xUserId);
    if (user === undefined) continue;
    const picture = receivers.length < SHARE_PICTURES ? avatar400(user.profileImageUrl) : null;
    receivers.push({ handle: user.handle, profileImageUrl: picture });
  }

  const sender = senderRows[0];
  return {
    chainKey: drop.chainKey,
    symbol: unit.symbol,
    decimals: unit.decimals,
    amount: drop.totalEntitlements,
    people: drop.leafCount,
    sender: {
      handle: sender?.handle ?? "",
      profileImageUrl: avatar400(sender?.profileImageUrl ?? null),
    },
    receivers,
    rest: Math.max(0, drop.leafCount - receivers.length),
    rank: shareRank(drop.totalEntitlements, unit.decimals, drop.priceUsd),
  };
}
