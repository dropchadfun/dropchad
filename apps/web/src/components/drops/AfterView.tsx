import Link from "next/link";

import { ChainBadge } from "@/components/chains/ChainBadge";
import { FedList, FedProgress, type PaidEntry } from "@/components/drops/FedList";
import { StatusChip } from "@/components/drops/StatusChip";
import { TestnetMark } from "@/components/site/Wordmark";
import { Headline } from "@/components/drops/Headline";
import { TokenRow } from "@/components/drops/TokenRow";
import { dropLines, headlineParts } from "@/components/drops/drop-lines";
import type { Chip } from "@/components/drops/drop-card-data";
import { Avatar } from "@/components/site/Avatar";
import { MainTagPill } from "@/components/site/MainTag";
import { XLink } from "@/components/site/XLink";
import type { DropDetail, Profile } from "@/lib/api";
import { txUrl } from "@/lib/chains";
import { shortAddress, shortHash } from "@/lib/format";

/**
 * The drop's one picture on this page, 48px: its own picture, else the sender's X avatar, else a
 * blank tile. The same order as the rows and cards, `DropPicture.tsx`, when
 * `/create` lost its picture box. The chain badge sits on it in the page.
 */
export function AfterPicture({
  imageUrl,
  creator,
}: {
  imageUrl: string | null;
  creator: Profile | null;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user supplied host
      <img src={imageUrl} alt="" className="size-12 rounded-lg bg-chad-surface-2 object-cover" />
    );
  }
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
 * title and the chip, `people fed` with the bar and the amount, `who got fed` by handle, the
 * proof at the bottom. No rain, no replay. The share card is its own section under it, for the
 * sender only, `ShareCard.tsx`.
 *
 * Everything is settled, so the numbers are white. No value line on testnet
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
  const lines = dropLines({
    title,
    handle: creator?.handle ?? null,
    amountWei,
    chainId,
    token,
    createdAt,
    finished: true,
  });
  const parts = headlineParts({
    title,
    handle: creator?.handle ?? null,
    amountWei,
    chainId,
    token,
    createdAt,
    finished: true,
  });
  const imageUrl = ours?.memeImageUrl ?? null;
  const proofTx = ours?.lastTxHash ?? ours?.activateTxHash ?? paid[paid.length - 1]?.txHash ?? null;
  const proofUrl = proofTx ? txUrl(chainId, proofTx) : null;
  const fed = [...paid].sort((a, b) => a.index - b.index);

  return (
    <main className="mx-auto w-full max-w-(--container-content) px-4 py-4 md:py-8">
      <div className="mx-auto w-full max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative shrink-0">
              <AfterPicture imageUrl={imageUrl} creator={creator} />
              <ChainBadge chainId={chainId} />
            </span>
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
                  <Link
                    href={`/u/${creator.handle}`}
                    className="flex items-center gap-2 hover:text-chad-text"
                  >
                    <Avatar src={creator.profileImageUrl} name={creator.handle} size={20} />@
                    {creator.handle}
                  </Link>
                  <XLink handle={creator.handle} />
                  <MainTagPill tags={creator.tags} />
                </p>
              ) : (
                <p className="type-small mt-1 font-mono text-chad-text-dim">
                  {shortAddress(detail.address)}
                </p>
              )}
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
        </div>

        <FedList
          entries={fed}
          chainId={chainId}
          token={token}
          live={false}
          empty={
            chip === "EXPIRED" ? "nobody. the drop expired before it was funded." : "no claims yet."
          }
        />
        {token ? <TokenRow token={token} chainId={chainId} /> : null}

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
