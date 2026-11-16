import type { Metadata } from "next";

import { CreateDrop } from "@/components/create/CreateDrop";
import { modeFromSearch } from "@/components/create/form";
import { betaNotice } from "@/lib/beta";
import { chainPills, liveMainnetKeys } from "@/lib/chains";
import { readLiveChains } from "@/lib/live-chains";

export const metadata: Metadata = { title: "make a drop" };

type SearchParams = Promise<{ mode?: string | string[] }>;

/**
 * `/create`. Three steps: what and who, check it, fund it. `?mode=multisend`
 * opens it on multisend, the front page link.
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { mode } = await searchParams;
  // The pills and the beta notice of the live chains, from the api switch.
  const view = await readLiveChains();
  return (
    <CreateDrop
      pills={chainPills({ view, forCreate: true })}
      initialMode={modeFromSearch(mode)}
      betaNotice={betaNotice(liveMainnetKeys(undefined, view))}
    />
  );
}
