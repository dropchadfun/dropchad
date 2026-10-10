import { ChainBadge } from "@/components/chains/ChainBadge";
import type { DropCardData } from "@/components/drops/drop-card-data";
import { Avatar } from "@/components/site/Avatar";

/**
 * The one picture a drop gets: its meme image, else the chad's face, else a blank tile. The
 * chain badge sits on its corner on every surface.
 */
export function DropPicture({ card, size = 40 }: { card: DropCardData; size?: 32 | 40 }) {
  const box = size === 32 ? "size-8" : "size-10";
  return (
    <span className={`relative inline-block shrink-0 ${box}`}>
      {card.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user supplied host
        <img
          src={card.imageUrl}
          alt=""
          className={`${box} rounded-lg bg-chad-surface-2 object-cover`}
        />
      ) : card.creator ? (
        <Avatar
          src={card.creator.profileImageUrl}
          name={card.creator.handle}
          size={size}
          className="rounded-lg!"
        />
      ) : (
        <span aria-hidden="true" className={`block ${box} rounded-lg bg-chad-surface-2`} />
      )}
      <ChainBadge chainId={card.chainId} />
    </span>
  );
}
