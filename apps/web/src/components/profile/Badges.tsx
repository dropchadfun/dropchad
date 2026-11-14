import { BadgeCheck, Crown, Radio } from "lucide-react";
import type { CSSProperties } from "react";

import type { ProfileBadge } from "@/lib/api";

/**
 * Earned badges, never picked and never editable. Filled pills in their own
 * colour with a small icon; the tooltip says how each is earned. No badges, no row: nothing
 * renders, not even a gap. Today every profile has none, the proofs are not built yet.
 */
const BADGES: Record<
  ProfileBadge,
  { readonly label: string; readonly earned: string; readonly Icon: typeof BadgeCheck }
> = {
  project: {
    label: "verified project",
    earned: "the creator wallet on the launchpad signed a challenge for this X account",
    Icon: BadgeCheck,
  },
  cto: {
    label: "cto",
    earned:
      "the launchpad's takeover record, or the current creator fee wallet, signed for this X account",
    Icon: Crown,
  },
  streamer: {
    label: "streamer",
    earned: "a twitch or kick channel is connected",
    Icon: Radio,
  },
};

export function Badges({ badges }: { badges: readonly ProfileBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="badges">
      {badges.map((badge) => {
        const { label, earned, Icon } = BADGES[badge];
        return (
          <li
            key={badge}
            className="badge type-small"
            style={{ "--pill": `var(--chad-badge-${badge})` } as CSSProperties}
            title={earned}
          >
            <Icon size={12} aria-hidden="true" />
            {label}
          </li>
        );
      })}
    </ul>
  );
}
