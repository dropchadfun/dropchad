import Link from "next/link";

import { FedList, FedProgress, type PaidEntry } from "@/components/drops/FedList";
import { StatusChip } from "@/components/drops/StatusChip";
import { Headline } from "@/components/drops/Headline";
import { TokenRow } from "@/components/drops/TokenRow";
import { dropLines, headlineParts } from "@/components/drops/drop-lines";
import { Avatar } from "@/components/site/Avatar";
import { MainTagPill } from "@/components/site/MainTag";
import { XLink } from "@/components/site/XLink";
import type { Profile, TokenInfo } from "@/lib/api";
import { shortAddress } from "@/lib/format";

export { paidLabel, type PaidEntry } from "@/components/drops/FedList";

/**
 * The live drop page, clean: one column in the middle.
 * The title and the chip, `people fed` with the bar and the amount, then `who got fed` by
 * handle, the newest first. No rain. A claim that lands while the page is open flashes its row.
 *
 * Colour: the counter and every `+amount` are numbers going up, `--chad-up`. The bar and the
 * flash are the accent. Nothing else on the screen is coloured.
 */
export function LiveView({
  address,
  chainId,
  token = null,
  title,
  creator,
  amountWei,
  createdAt,
  leafCount,
  paidCount,
  paid,
  waiting,
}: {
  address: string;
  chainId: number;
  /** A token drop's token; `null` on a SOL or ETH drop. */
  token?: TokenInfo | null;
  title: string | null;
  creator: Profile | null;
  amountWei: string;
  /** Unix seconds, `null` when neither side knows yet. */
  createdAt: number | null;
  leafCount: number;
  paidCount: number;
  paid: readonly PaidEntry[];
  waiting: boolean;
}) {
  const lines = dropLines({
    title,
    handle: creator?.handle ?? null,
    amountWei,
    chainId,
    token,
    createdAt,
    finished: false,
  });
  const parts = headlineParts({
    title,
    handle: creator?.handle ?? null,
    amountWei,
    chainId,
    token,
    createdAt,
    finished: false,
  });
  // Newest first: what came over the stream is at the end of the list.
  const feed = [...paid].reverse();

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* The sender is in the headline, so the profile link is the avatar beside it. */}
            {lines.second.kind === "meta" && creator ? (
              <Link
                href={`/u/${creator.handle}`}
                aria-label={`@${creator.handle}`}
                className="shrink-0 hover:opacity-80"
              >
                <Avatar src={creator.profileImageUrl} name={creator.handle} size={24} />
              </Link>
            ) : null}
            {/* The picture, the X logo right next to it, then the text. */}
            {lines.second.kind === "meta" && creator ? <XLink handle={creator.handle} /> : null}
            <h1 className="type-h1 min-w-0 break-words md:line-clamp-1">
              <Headline parts={parts} first={lines.first} />
            </h1>
          </div>
          {lines.second.kind === "meta" ? (
            <p className="type-small mt-1 text-chad-text-dim">{lines.second.text}</p>
          ) : creator ? (
            <p className="type-body mt-1 flex items-center gap-2 text-chad-text-dim">
              <Avatar src={creator.profileImageUrl} name={creator.handle} size={20} />@
              {creator.handle}
              <XLink handle={creator.handle} />
              <MainTagPill tags={creator.tags} />
            </p>
          ) : (
            <p className="type-small mt-1 font-mono text-chad-text-dim">{shortAddress(address)}</p>
          )}
        </div>
        <StatusChip chip={waiting ? "FUNDING" : "LIVE"} className="mt-1" />
      </div>

      <div className="mt-6">
        <FedProgress
          paidCount={paidCount}
          leafCount={leafCount}
          amountWei={amountWei}
          chainId={chainId}
          token={token}
          live
        />
      </div>

      <FedList
        entries={feed}
        chainId={chainId}
        token={token}
        live
        empty={
          waiting
            ? "nobody yet. the drop is not funded."
            : "nobody yet. waiting for the first claim."
        }
      />
      {token ? <TokenRow token={token} chainId={chainId} /> : null}
    </div>
  );
}
