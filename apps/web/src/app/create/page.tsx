import type { Metadata } from "next";

import { CreateDrop } from "@/components/create/CreateDrop";
import { modeFromSearch } from "@/components/create/form";
import { chainPills } from "@/lib/chains";

export const metadata: Metadata = { title: "make a drop" };

type SearchParams = Promise<{ mode?: string | string[] }>;

/**
 * `/create`. Three steps: who receives, what and how much, fund this address. `?mode=multisend`
 * opens it on multisend, the front page link.
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { mode } = await searchParams;
  return <CreateDrop pills={chainPills()} initialMode={modeFromSearch(mode)} />;
}
