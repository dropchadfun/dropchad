import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DropRows } from "@/components/drops/DropRows";
import { fromOwnCard } from "@/components/drops/drop-card-data";
import { Badges } from "@/components/profile/Badges";
import { ProfileClaimLink } from "@/components/drops/ClaimEntry";
import { ProfileTags } from "@/components/profile/ProfileTags";
import { Avatar } from "@/components/site/Avatar";
import { XLink } from "@/components/site/XLink";
import { Empty } from "@/components/site/Empty";
import { Section } from "@/components/site/Section";
import { Skeleton } from "@/components/site/Skeleton";
import { ApiError, getUser, type UserPage } from "@/lib/api";
import { droppedLine, formatCount, formatPeople, formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = Promise<{ handle: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return { title: `@${(await params).handle}` };
}

/**
 * `/u/[handle]`. Minimal: avatar, handle, the earned badges, the tags, three numbers, the wall
 * of that chad's drops as rows at every width. The totals are the board's numbers, final
 * only; when they cannot load the tiles are skeletons, never a red line. The wall is ours, so
 * it renders even when the indexer is down.
 */
export default async function Page({ params }: { params: Params }) {
  const { handle } = await params;

  let user: UserPage;
  try {
    user = await getUser(handle);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }

  const { profile, totals } = user;
  const cards = user.drops.map(fromOwnCard);
  // One usd number from the prices frozen at activation. Native coins only.
  const dropped = totals.available ? formatUsd(totals.usd) : null;

  return (
    <main className="mx-auto w-full max-w-(--container-content) px-4 pt-4 md:pt-6">
      <div className="flex items-center gap-3">
        <Avatar src={profile.profileImageUrl} name={profile.handle} size={48} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="type-h1 truncate">@{profile.handle}</h1>
            <XLink handle={profile.handle} />
          </div>
          <p className="type-small truncate text-chad-text-dim">{profile.displayName}</p>
        </div>
      </div>
      <Badges badges={profile.badges} />
      <ProfileTags xUserId={profile.xUserId} tags={profile.tags} />
      <ProfileClaimLink xUserId={profile.xUserId} />

      <dl className="mt-4 grid grid-cols-3 gap-2 md:gap-3">
        <Stat
          label="dropped"
          note={totals.available ? droppedLine(totals.dropped) : undefined}
          value={dropped}
        />
        <Stat
          label="drops"
          note="funded and paid"
          value={totals.available ? formatCount(totals.dropCount) : null}
        />
        {/* Payouts big, the people under it. */}
        <Stat
          label="payouts"
          short="payouts"
          note={totals.available ? formatPeople(totals.uniqueReceivers) : undefined}
          value={totals.available ? formatCount(totals.claimCount) : null}
        />
      </dl>

      <Section title="drops">
        {cards.length === 0 ? <Empty>no drops yet.</Empty> : <DropRows rows={cards} />}
      </Section>
    </main>
  );
}

/** The same tile as the front page, the same lines under it: the coins that moved, then words. */
function Stat({
  label,
  short,
  note,
  value,
}: {
  label: string;
  short?: string;
  note?: string | undefined;
  value: string | null;
}) {
  return (
    <div className="card min-w-0 p-3 md:p-4">
      <dt className="type-label truncate">
        {short ? (
          <>
            <span className="md:hidden">{short}</span>
            <span className="hidden md:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-1">
        {value === null ? (
          <Skeleton className="h-6 w-16 md:h-7 md:w-24" />
        ) : (
          <span className="type-stat block truncate">{value}</span>
        )}
        {note ? (
          <span className="type-small mt-1 hidden truncate whitespace-pre text-chad-text-dim md:block">
            {note}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
