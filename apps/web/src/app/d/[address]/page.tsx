import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DropPage } from "@/components/drops/DropPage";
import { claimLinkFor } from "@/components/drops/claim";
import { withoutFunding } from "@/components/drops/funding";
import { ApiError, getDrop, type DropDetail } from "@/lib/api";
import { dPageRoute } from "@/lib/drop-path";

export const dynamic = "force-dynamic";

type Params = Promise<{ address: string }>;

// No address in the tab: a drop waiting for money shows it to its creator only.
export function generateMetadata(_props: { params: Params }): Promise<Metadata> {
  return Promise.resolve({ title: "drop" });
}

/**
 * `/d/[address]`. One route for the whole life of a drop: waiting for funding, live, and after.
 * The client decides which view from the state and keeps it current over the live stream.
 */
export default async function Page({ params }: { params: Params }) {
  const { address } = await params;
  // A `0x` address, or a base58 public key on Solana. The api checks the shape again.
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    notFound();

  let detail: DropDetail;
  try {
    detail = await getDrop(address);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 503) {
      return (
        <main className="mx-auto w-full max-w-(--container-content) px-4 py-8">
          <h1 className="type-h1">drop {address.slice(0, 6)}…</h1>
          <p className="type-body mt-4 text-chad-text-dim">
            the indexer is not answering and this is not a drop we created, so there is nothing to
            show yet. try again in a minute.
          </p>
        </main>
      );
    }
    throw error;
  }

  // An old multisend link lands here: its page is `/m/`. A 307.
  const route = dPageRoute(detail);
  if (route.kind === "redirect") redirect(route.to);

  // A handle drop's page is where the share link on X lands: the way in to its claim.
  const claimHref = claimLinkFor(detail);
  return (
    <>
      {claimHref !== null ? (
        <div className="mx-auto w-full max-w-(--container-content) px-4 pt-4">
          <Link
            href={claimHref}
            className="type-body text-chad-accent hover:text-chad-accent-hover"
          >
            got dropped? claim it →
          </Link>
        </div>
      ) : null}
      {/* The server has no cookie: the funding answer stays out of the HTML. */}
      <DropPage initial={withoutFunding(detail)} />
    </>
  );
}
