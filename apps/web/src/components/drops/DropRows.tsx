import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { DropPicture } from "@/components/drops/DropPicture";
import { SenderLine } from "@/components/drops/SenderLine";
import { LaunchpadBadge } from "@/components/drops/LaunchpadBadge";
import { StatusChip } from "@/components/drops/StatusChip";
import { MainTagPill } from "@/components/site/MainTag";
import { ROW_LOGO, RowAmount } from "@/components/site/Ticker";
import { TokenLogo } from "@/components/site/TokenLogo";
import type { DropCardData } from "@/components/drops/drop-card-data";
import { factsLine, linesOfCard } from "@/components/drops/drop-lines";
import { formatCount, listAmount, percent, timeAgo } from "@/lib/format";
import { dropUnit } from "@/lib/token";

/**
 * Drops as rows at every width. The whole row is the link, a chevron on the right
 * edge, no button. Left: the picture with the chain badge, the title, the handle. The sender's
 * main tag as one pill, nothing after it: on desktop centred in its own column, the space
 * between the name and the amount, one centre line on every row, the title cutting first
 * on phone next to the handle.
 * No other tag after it. A token drop from a listed launchpad gets the `launched on` badge last
 * on the handle line. Right, ending at the state: amount, receivers,
 * claimed, age, state. On phone the numbers fold under the title as one grey line and the
 * amount sits over the state on the right. The grid is `.drop-row` in `globals.css`, so the
 * right columns line up across rows.
 */
export function DropRows({ rows }: { rows: readonly DropCardData[] }) {
  return (
    <div>
      <div className="drop-row type-label hidden h-8 items-center md:grid" aria-hidden="true">
        <span className="font-medium">drop</span>
        <span />
        <span className="text-right font-medium">amount</span>
        <span className="text-right font-medium">receivers</span>
        <span className="text-right font-medium">claimed</span>
        <span className="text-right font-medium">age</span>
        <span className="font-medium">state</span>
        <span />
      </div>
      {rows.map((card) => (
        <DropRow key={card.address} card={card} />
      ))}
    </div>
  );
}

function DropRow({ card }: { card: DropCardData }) {
  const lines = linesOfCard(card);
  const tags = card.creator?.tags ?? [];
  // A token drop is in its token, with its logo before the number.
  const unit = dropUnit(card.chainId, card.token);
  const amount = (
    <RowAmount
      amount={listAmount(card.amountWei, unit.decimals)}
      symbol={unit.symbol}
      logo={card.token ? <TokenLogo token={card.token} size={ROW_LOGO} /> : null}
    />
  );

  return (
    <Link href={`/d/${card.address}`} className="row drop-row group type-table py-2">
      {/* the title block: picture, title, handle. On phone the pill and the facts line too */}
      <span className="flex min-w-0 items-center gap-3">
        <DropPicture card={card} size={32} />
        <span className="min-w-0">
          <span className="block truncate font-medium text-chad-text">{lines.first}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-chad-text-dim md:flex-nowrap">
            <span className="truncate">
              <SenderLine sender={lines.sender} />
            </span>
            <MainTagPill tags={tags} className="md:hidden" />
            {/* `launched on pump.fun`: the handle line has room at both widths */}
            <LaunchpadBadge token={card.token} chainId={card.chainId} compact />
          </span>
          <span className="type-small block truncate text-chad-text-dim md:hidden">
            {factsLine(card)}
          </span>
        </span>
      </span>

      {/* desktop: the pill centred in the space between the name and the amount */}
      <span className="hidden justify-self-center md:block">
        <MainTagPill tags={tags} />
      </span>

      {/* phone: amount over the state on the right. desktop: the amount column */}
      <span className="num flex flex-col items-end gap-1 text-right font-medium text-chad-text md:block">
        <span>{amount}</span>
        <StatusChip chip={card.chip} className="md:hidden" />
      </span>
      <span className="num hidden text-right md:block">{formatCount(card.receivers)}</span>
      <span className="num hidden text-right md:block">
        {percent(card.claimed, card.receivers)}
      </span>
      <span className="num hidden text-right text-chad-text-dim md:block">
        {timeAgo(card.createdAt)}
      </span>
      <span className="hidden md:block">
        <StatusChip chip={card.chip} />
      </span>

      <ChevronRight
        size={16}
        aria-hidden="true"
        className="self-center text-chad-text-mute transition-colors group-hover:text-chad-text group-focus-visible:text-chad-text"
      />
    </Link>
  );
}
