import type { CreateMode } from "@/components/create/form";
import { CopyButton } from "@/components/site/CopyButton";
import { pagePathFor } from "@/lib/drop-path";
import { shortAddress } from "@/lib/format";

/**
 * Create step 3, the way back to it: the sender who leaves
 * before funding must find the drop again. A handle drop is on the sender's profile; a multisend
 * is on no list and no profile, so its link is the only way back.
 */
export function wayBack(
  mode: CreateMode,
  address: string,
  origin: string,
): {
  readonly label: string;
  readonly path: string;
  readonly url: string;
  readonly shown: string;
  readonly note: string;
} {
  const multisend = mode === "multisend";
  const path = pagePathFor(multisend ? "address" : "handle", address);
  const host = new URL(origin).host;
  return {
    label: multisend ? "your multisend page" : "your drop page",
    path,
    url: `${origin}${path}`,
    shown: `${host}${path.slice(0, 3)}${shortAddress(address)}`,
    note: multisend
      ? "save this link. a multisend is on no list, so this link is the way back."
      : "it is on your profile too.",
  };
}

export function WayBack({
  mode,
  address,
  origin,
}: {
  mode: CreateMode;
  address: string;
  /** The site it runs on, `window.location.origin`. */
  origin: string;
}) {
  const back = wayBack(mode, address, origin);
  return (
    <div className="card mt-4 p-4">
      <p className="type-label">{back.label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <a
          href={back.path}
          className="type-body min-w-0 font-mono break-all text-chad-text underline-offset-2 hover:underline"
        >
          {back.shown}
        </a>
        <CopyButton value={back.url} label="copy link" />
      </div>
      <p className="type-small mt-2 text-chad-text-dim">{back.note}</p>
    </div>
  );
}
