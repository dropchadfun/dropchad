/**
 * Which page a drop lives on. A handle drop is
 * `/d/<address>`, a multisend `/m/<address>`; the drop address is the id on both. Each page
 * sends the other kind to the right one with a 307, so an old multisend link still works.
 */
import type { CreateMode } from "@/components/create/form";
import type { DropDetail } from "@/lib/api";

export type PageRoute =
  | { readonly kind: "render" }
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "not_found" };

export function pagePathFor(mode: "address" | "handle", address: string): string {
  return mode === "address" ? `/m/${address}` : `/d/${address}`;
}

/** Where `/create` goes once the money is seen. */
export function afterCreatePath(mode: CreateMode, address: string): string {
  return pagePathFor(mode === "multisend" ? "address" : "handle", address);
}

/** `/d/`: a multisend goes to `/m/`. A drop we did not create renders as before, mode unknown. */
export function dPageRoute(detail: DropDetail): PageRoute {
  return detail.ours.data?.mode === "address"
    ? { kind: "redirect", to: pagePathFor("address", detail.address) }
    : { kind: "render" };
}

/** `/m/`: only our own multisend rows render. Only our rows know a multisend at all. */
export function mPageRoute(detail: DropDetail): PageRoute {
  const mode = detail.ours.data?.mode;
  if (mode === "address") return { kind: "render" };
  if (mode === "handle") return { kind: "redirect", to: pagePathFor("handle", detail.address) };
  return { kind: "not_found" };
}
