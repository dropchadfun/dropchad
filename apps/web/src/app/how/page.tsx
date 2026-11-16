import type { Metadata } from "next";

import { HowPage } from "@/components/how/HowPage";
import { ApiError, getChains, type ChainInfo } from "@/lib/api";
import { liveMainnetKeys } from "@/lib/chains";
import { readLiveChains } from "@/lib/live-chains";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "how it works" };

/** `/how`. The fees come from the api; without it the page says where to look. */
export default async function Page() {
  let chains: ChainInfo[] | null;
  try {
    chains = (await getChains()).chains;
  } catch (error) {
    if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
    chains = null;
  }
  // The chains `/how` names, from the api switch.
  const liveKeys = liveMainnetKeys(undefined, await readLiveChains());
  return <HowPage chains={chains} liveKeys={liveKeys} />;
}
