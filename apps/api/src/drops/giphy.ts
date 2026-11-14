/**
 * A drop's GIF. Only the GIPHY id and the kind are taken and kept; the api
 * never calls GIPHY and never takes, stores or sends a GIPHY URL. The browser fetches the GIF by
 * its id.
 */
import { z } from "zod";

import type { DropRow } from "../db/schema.js";

export interface Giphy {
  readonly id: string;
  readonly kind: "gif" | "sticker";
}

/** `giphy` in the create body: 1 to 40 letters and digits, and no other key. */
export const giphyBody = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9]{1,40}$/, "a GIPHY id is 1 to 40 letters and digits"),
    kind: z.enum(["gif", "sticker"]),
  })
  .strict();

/** What the drop detail and the claims list send; `null` when the drop has none. */
export function giphyOf(row: Pick<DropRow, "giphyId" | "giphyKind">): Giphy | null {
  if (row.giphyId === null || row.giphyKind === null) return null;
  return { id: row.giphyId, kind: row.giphyKind };
}
