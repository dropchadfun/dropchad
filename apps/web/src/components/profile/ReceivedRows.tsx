import { findChain } from "@dropchad/chains";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { DropPicture } from "@/components/drops/DropPicture";
import { Empty } from "@/components/site/Empty";
import { MainTagPill } from "@/components/site/MainTag";
import { RowSkeleton } from "@/components/site/Skeleton";
import { TokenLogo } from "@/components/site/TokenLogo";
import type { ReceivedItem, UserPage } from "@/lib/api";
import { formatAmount, timeAgo } from "@/lib/format";
import { dropUnit } from "@/lib/token";

/**
 * The profile's `received` list. The wall's rows: the sender's picture with the chain badge, the title, then
 * `from @sender`, the main tag pill in its column; right, the amount received, then the age.
 * Every row is paid, so no receivers, claimed or state column. No usd, so no `in test coins`.
 * A chain that cannot be read: skeleton rows, never a guess.
 */
export function ReceivedRows({ received }: { received: UserPage["received"] }) {
  if (!received.available) {
    return (
      <div>
        {Array.from({ length: 3 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (received.items.length === 0) return <Empty>nothing received yet.</Empty>;
  return (
    <div>
      <div className="received-row type-label hidden h-8 items-center md:grid" aria-hidden="true">
        <span className="font-medium">drop</span>
        <span />
        <span className="text-right font-medium">amount</span>
        <span className="text-right font-medium">age</span>
        <span />
      </div>
      {received.items.map((item) => (
        <ReceivedRow key={item.address} item={item} />
      ))}
    </div>
  );
}

function ReceivedRow({ item }: { item: ReceivedItem }) {
  const chainId = findChain(item.chainKey)?.chainId ?? 0;
  const unit = dropUnit(chainId, item.token);
  const createdAt = Math.floor(new Date(item.createdAt).getTime() / 1000);
  const title =
    item.title ?? (item.token && item.token.symbol === null ? "token drop" : `${unit.symbol} drop`);
  const tags = item.sender.tags;

  return (
    <Link href={`/d/${item.address}`} className="row received-row group type-table py-2">
      <span className="flex min-w-0 items-center gap-3">
        <DropPicture
          card={{
            address: item.address,
            chainId,
            token: item.token,
            title: item.title,
            imageUrl: null,
            creator: item.sender,
            chip: "DONE",
            amountWei: item.amount,
            receivers: 1,
            claimed: 1,
            createdAt,
          }}
          size={32}
        />
        <span className="min-w-0">
          <span className="block truncate font-medium text-chad-text">{title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-chad-text-dim md:flex-nowrap">
            <span className="truncate">from @{item.sender.handle}</span>
            <MainTagPill tags={tags} className="md:hidden" />
          </span>
          <span className="type-small block truncate text-chad-text-dim md:hidden">
            {timeAgo(createdAt)}
          </span>
        </span>
      </span>

      <span className="hidden justify-self-end px-4 md:block">
        <MainTagPill tags={tags} />
      </span>

      <span className="num text-right font-medium text-chad-text">
        {item.token ? <TokenLogo token={item.token} size={16} className="-mt-0.5 mr-1.5" /> : null}
        {formatAmount(item.amount, unit.decimals)}{" "}
        <span className="text-chad-text-dim">{unit.symbol}</span>
      </span>
      <span className="num hidden text-right text-chad-text-dim md:block">
        {timeAgo(createdAt)}
      </span>

      <ChevronRight
        size={16}
        aria-hidden="true"
        className="self-center text-chad-text-mute transition-colors group-hover:text-chad-text group-focus-visible:text-chad-text"
      />
    </Link>
  );
}
