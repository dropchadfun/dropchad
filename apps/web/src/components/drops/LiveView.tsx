import Link from "next/link";

import { ChainBadge } from "@/components/chains/ChainBadge";
import { AfterPicture } from "@/components/drops/AfterView";
import { DropGif } from "@/components/drops/DropGif";
import { FedList, FedProgress, type PaidEntry } from "@/components/drops/FedList";
import { StatusChip } from "@/components/drops/StatusChip";
import { TokenRow } from "@/components/drops/TokenRow";
import { CopyDropLink } from "@/components/drops/drop-link";
import { dropLines } from "@/components/drops/drop-lines";
import { MainTagPill } from "@/components/site/MainTag";
import { StreamLinks } from "@/components/site/StreamLinks";
import { XLink } from "@/components/site/XLink";
import type { Profile, TokenInfo } from "@/lib/api";
import type { Giphy } from "@/lib/giphy";
import { shortAddress } from "@/lib/format";

export { paidLabel, type PaidEntry } from "@/components/drops/FedList";

/**
 * The live drop page, clean: one column in the middle.
 * The title and the chip, `claimed` with the bar and the amount, then `who claimed` by
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
  giphy = null,
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
  /** The drop's GIF at the top of the card. */
  giphy?: Giphy | null;
}) {
  const lines = dropLines({ title, chainId, token, createdAt });
  // Newest first: what came over the stream is at the end of the list.
  const feed = [...paid].reverse();

  return (
    <div className="mx-auto w-full max-w-xl">
      <DropGif giphy={giphy} />
      <div className="flex items-start justify-between gap-3">
        {/* With a sender, the finished page's 48px picture and chain badge on the left. */}
        <div className={creator ? "flex min-w-0 items-center gap-3" : "min-w-0"}>
          {creator ? (
            <span className="relative shrink-0">
              <AfterPicture creator={creator} />
              <ChainBadge chainId={chainId} />
            </span>
          ) : null}
          <div className="min-w-0">
            {/* The same three lines with a title or without. */}
            <h1 className="type-h1 min-w-0 break-words md:line-clamp-1">{lines.first}</h1>
            {creator ? (
              <p className="type-body mt-1 flex items-center gap-2 text-chad-text-dim">
                <Link
                  href={`/u/${creator.handle}`}
                  className="flex items-center gap-2 hover:text-chad-text"
                >
                  @{creator.handle}
                </Link>
                <XLink handle={creator.handle} />
                <StreamLinks streams={creator.streams} />
                <MainTagPill tags={creator.tags} />
              </p>
            ) : (
              <p className="type-small mt-1 font-mono text-chad-text-dim">
                {shortAddress(address)}
              </p>
            )}
            <p className="type-small mt-1 text-chad-text-dim">{lines.meta}</p>
          </div>
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
      {waiting ? null : <CopyDropLink address={address} />}
      {/* The token card waits for the money. */}
      {token && !waiting ? <TokenRow token={token} chainId={chainId} /> : null}
    </div>
  );
}
