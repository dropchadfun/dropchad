import type { TokenInfo } from "@/lib/api";
import { quickTokenAt } from "@/lib/chains";
import { LAUNCHPADS, launchpadOf, type Launchpad } from "@/lib/launchpads";
import { cn } from "@/lib/utils";

const BADGE =
  "type-small inline-flex h-5.5 shrink-0 items-center gap-1 rounded-md border border-chad-border bg-chad-surface-2 px-1.5 align-middle text-chad-text-dim";

/**
 * `launched on pump.fun`. Only for
 * a token whose launchpad is in `lib/launchpads`, never for a SOL or ETH drop or a stablecoin.
 * Grey, never mint or green: information, not an earned badge. `compact` is the drop row: the
 * logo only on the phone, the name from `md`, the full words as its accessible name. None is
 * on now, so it renders nothing. `logo` and `launchpads` are for
 * tests; by default the list's own.
 */
export function LaunchpadBadge({
  token,
  chainId,
  compact = false,
  logo,
  launchpads = LAUNCHPADS,
  className,
}: {
  token: TokenInfo | null | undefined;
  chainId: number;
  compact?: boolean;
  logo?: string | null;
  launchpads?: readonly Launchpad[];
  className?: string;
}) {
  if (token === null || token === undefined) return null;
  const pad = launchpadOf(token.launchpad, launchpads);
  if (pad === undefined || quickTokenAt(chainId, token.mint) !== undefined) return null;
  const src = logo === undefined ? pad.logo : logo;
  const label = `launched on ${pad.name}`;
  const picture =
    src === null ? null : (
      // eslint-disable-next-line @next/next/no-img-element -- the file, used as it is
      <img src={src} width={12} height={12} alt="" className="size-3 shrink-0" />
    );

  if (compact) {
    return (
      <span role="img" aria-label={label} className={cn(BADGE, className)}>
        {picture}
        <span className={picture === null ? undefined : "hidden md:inline"}>{pad.name}</span>
      </span>
    );
  }
  return (
    <span className={cn(BADGE, className)}>
      {picture}
      {label}
    </span>
  );
}
