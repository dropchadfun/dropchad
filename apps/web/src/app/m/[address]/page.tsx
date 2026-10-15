import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { MultisendView } from "@/components/drops/MultisendView";
import { multisendMetadata, receiversOf } from "@/components/drops/multisend";
import { ApiError, getDrop, type DropDetail } from "@/lib/api";
import { mPageRoute } from "@/lib/drop-path";

export const dynamic = "force-dynamic";

type Params = Promise<{ address: string }>;

// No address in the tab while it waits for money; a failed read keeps it out too.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { address } = await params;
  try {
    const detail = await getDrop(address);
    return multisendMetadata(address, detail.ours.data?.state === "created");
  } catch {
    return multisendMetadata(address, true);
  }
}

/**
 * `/m/[address]`, the multisend page. The drop
 * address is the id, as on `/d/`. Only our own multisend rows render: a handle drop goes to
 * `/d/` with a 307, anything else is a 404. No `loading.tsx` here on purpose: a streamed page
 * turns `redirect()` into a client side meta redirect instead of the 307.
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
    if (error instanceof ApiError && (error.status === 404 || error.status === 503)) notFound();
    throw error;
  }

  const route = mPageRoute(detail);
  if (route.kind === "not_found") notFound();
  if (route.kind === "redirect") redirect(route.to);

  // The receivers come with the drop: this read carries no cookie, so they are the
  // paid rows a stranger sees. The view reads again with the cookie; the sender gets them all.
  return <MultisendView initial={detail} receivers={receiversOf(detail)} isSender={false} />;
}
