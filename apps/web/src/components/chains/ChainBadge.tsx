import { findChainByChainId } from "@dropchad/chains";

import { cn } from "@/lib/utils";

/**
 * The small chain mark on the corner of a drop picture or an avatar. On the all
 * view every row says which chain it happened on without a word. A testnet shows its mainnet's
 * mark: the pill is the chain, the network behind it is a detail for the drop page.
 */
export function ChainBadge({ chainId, className }: { chainId: number; className?: string }) {
  const chain = findChainByChainId(chainId);
  if (chain === undefined) return null;
  const key = chain.testnetOf ?? chain.key;
  return (
    <span
      aria-hidden="true"
      title={chain.name}
      className={cn(
        "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-[5px] ring-2 ring-chad-bg",
        className,
      )}
      style={{ background: `var(--brand-${key})` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static svg, no sizing needed */}
      <img src={`/chains/${key}.svg`} alt="" width={10} height={10} className="block size-2.5" />
    </span>
  );
}
