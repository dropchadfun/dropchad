import type { ReactNode } from "react";

/** No extra list on the claim page in this copy of the site: only what it wraps. */
export function ExtraClaims({
  children,
}: {
  onCount?: (count: number) => void;
  children?: ReactNode;
}): ReactNode {
  return children ?? null;
}
