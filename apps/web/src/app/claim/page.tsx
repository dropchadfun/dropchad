import type { Metadata } from "next";

import { ClaimPage } from "@/components/drops/ClaimPage";

export const dynamic = "force-dynamic";

/** Personal: a receiver's own drops. Never in a search engine. */
export const metadata: Metadata = { title: "claim", robots: { index: false, follow: false } };

type SearchParams = Promise<{ drop?: string | string[] }>;

/**
 * `/claim` and `/claim?drop=<address>`.
 * The list comes from the browser, which carries the session cookie; this server part only
 * passes the drop on, when it has the shape of a drop address.
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { drop } = await searchParams;
  const one = typeof drop === "string" ? drop : null;
  const valid =
    one !== null && (/^0x[0-9a-fA-F]{40}$/.test(one) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(one));
  return <ClaimPage drop={valid ? one : null} />;
}
