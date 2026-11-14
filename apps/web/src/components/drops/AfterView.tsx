import Link from "next/link";

import { ChainBadge } from "@/components/chains/ChainBadge";
import { FedList, FedProgress, type PaidEntry } from "@/components/drops/FedList";
import { StatusChip } from "@/components/drops/StatusChip";
import { DropGif } from "@/components/drops/DropGif";
import { TestnetMark } from "@/components/site/Wordmark";
import { TokenRow, tokenCardShows } from "@/components/drops/TokenRow";
import { dropLines } from "@/components/drops/drop-lines";
import { CopyDropLink } from "@/components/drops/drop-link";
import { COINS_BACK_LINE, coinsBackShows } from "@/components/drops/coins-back";
import { ETH_WAITING_LINE, ethWaitingShows } from "@/components/drops/eth-waiting";
import type { Chip } from "@/components/drops/drop-card-data";
import { Avatar } from "@/components/site/Avatar";
import { MainTagPill } from "@/components/site/MainTag";
import { StreamLinks } from "@/components/site/StreamLinks";
import { XLink } from "@/components/site/XLink";
import type { DropDetail, Profile } from "@/lib/api";
import { txUrl } from "@/lib/chains";
import { shortAddress, shortHash } from "@/lib/format";

/**
 * The drop's one picture on this page, 48px: the sender's X avatar, else a blank tile. The same
 * as the rows and cards, `DropPicture.tsx`; never a picture link. The
 * chain badge sits on it in the page.
 */
export function AfterPicture({ creator }: { creator: Profile | null }) {
  if (creator) {
    return (
      <Avatar
        src={creator.profileImageUrl}
        name={creator.handle}
        size={48}
        className="rounded-lg!"
      />
    );
  }
  return <span aria-hidden="true" className="block size-12 rounded-lg bg-chad-surface-2" />;
}

/**
 * The finished drop page, the same clean layout as the live one: the
 * title and the chip, `claimed` with the bar and the amount, `who claimed` by handle, the
 * proof at the bottom. No rain, no replay. The share card is its own section under it, for the
 * sender only, `ShareCard.tsx`. `copy drop link`, under `who claimed`, is for everyone
 *
 * Everything is settled, so the numbers are white. No value line on testnet:
 * nothing is priced live and the frozen usd is not sent to the page. On mainnet a plain `worth
 * $2.40 when dropped` comes later.
 */
export function AfterView({
  detail,
  paid,
  paidCount,
  leafCount,
  chainId,
  amountWei,
  createdAt,
  title,
  creator,
  chip,
}: {
  detail: DropDetail;
  paid: readonly PaidEntry[];
  paidCount: number;
  leafCount: number;
  chainId: number;
  amountWei: string;
  /** Unix seconds, `null` when neither side knows yet. */
  createdAt: number | null;
  title: string | null;
  creator: Profile | null;
  chip: Chip;
}) {
  const ours = detail.ours.data;
  // A token drop is in its token.
  const token = ours?.token ?? null;
  const lines = dropLines({ title, chainId, token, createdAt });
  const proofTx = ours?.lastTxHash ?? ours?.activateTxHash ?? paid[paid.length - 1]?.txHash ?? null;
  const proofUrl = proofTx ? txUrl(chainId, proofTx) : null;
  const fed = [...paid].sort((a, b) => a.index - b.index);

  return (
    <main className="mx-auto w-full max-w-(--container-content) px-4 py-4 md:py-8">
      <div className="mx-auto w-full max-w-xl">
        <DropGif giphy={ours?.giphy} />
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative shrink-0">
              <AfterPicture creator={creator} />
              <ChainBadge chainId={chainId} />
            </span>
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
                  {shortAddress(detail.address)}
                </p>
              )}
              <p className="type-small mt-1 text-chad-text-dim">{lines.meta}</p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            <TestnetMark />
            <StatusChip chip={chip} />
          </span>
        </div>

        <div className="mt-6">
          <FedProgress
            paidCount={paidCount}
            leafCount={leafCount}
            amountWei={amountWei}
            chainId={chainId}
            token={token}
            live={false}
          />
          {/* mint like the other warning lines. */}
          {ethWaitingShows(detail) ? (
            <p className="type-small mt-3 text-chad-accent">{ETH_WAITING_LINE}</p>
          ) : null}
        </div>

        <FedList
          entries={fed}
          chainId={chainId}
          token={token}
          live={false}
          empty={
            coinsBackShows(detail)
              ? COINS_BACK_LINE
              : chip === "EXPIRED"
                ? "nobody. the drop expired before it was funded."
                : "no claims yet."
          }
        />
        <CopyDropLink address={detail.address} />
        {/* Never on a drop whose funding time ran out unfunded. */}
        {token && tokenCardShows(detail) ? <TokenRow token={token} chainId={chainId} /> : null}

        <section className="mt-8 border-t border-chad-border pt-4">
          <p className="type-label">proof</p>
          <p className="type-body mt-1">
            {proofUrl && proofTx ? (
              <a
                href={proofUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-chad-text underline-offset-4 hover:underline"
              >
                {shortHash(proofTx)} ↗
              </a>
            ) : (
              <span className="text-chad-text-dim">not indexed yet</span>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
