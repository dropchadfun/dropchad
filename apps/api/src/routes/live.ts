/**
 * `GET /api/drops/:address/live` — Server Sent Events.
 *
 * This is what the drop page's live list reads. Events, in the order they can happen:
 *
 * | event | when |
 * |---|---|
 * | `snapshot` | immediately on connect, so a browser that arrives late is not blind |
 * | `funding_seen` | the drop address holds at least `grossRequired` |
 * | `activated` | `activate` confirmed, claims are open |
 * | `claim_paid` | one leaf paid: index, recipient, amount, and on a handle leaf the `handle` and `profileImageUrl`. One new row |
 * | `finished` | no more work. The stream closes after this |
 * | `heartbeat` | every 15 seconds of quiet, so a proxy does not drop the connection |
 *
 * **The snapshot is why a reload is never a problem.** The stream is a notification channel, not
 * the source of truth: a browser that misses an event and reconnects gets the whole state again
 * from the snapshot, and `GET /api/drops/:address` has it too.
 *
 * SSE rather than a websocket because this is one directional. The browser never sends anything,
 * and SSE reconnects by itself.
 */
import { streamSSE } from "hono/streaming";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getAddress } from "viem";

import { isEvmAddressText } from "../chain/address.js";
import { drops } from "../db/schema.js";
import type { AppEnv } from "../app.js";
import type { DropEvent } from "../worker/events.js";

/** Quiet for this long and a comment goes out, so proxies and load balancers keep the pipe open. */
export const HEARTBEAT_MS = 15_000;

/** States where nothing else will ever be emitted for this drop. */
const TERMINAL = new Set(["finished", "funding_expired", "claims_expired"]);

export async function dropLiveHandler(c: Context<AppEnv>, address: string): Promise<Response> {
  const { db, events, now } = c.var.deps;

  const rows = await db.select().from(drops).where(eq(drops.address, address)).limit(1);
  const row = rows[0];
  if (row === undefined) return c.json({ error: "not_found" }, 404);

  // Checksummed on the EVM, as stored on Solana. What the frontend sees in every event.
  const drop = isEvmAddressText(row.address) ? getAddress(row.address) : row.address;

  return streamSSE(c, async (stream) => {
    const queue: DropEvent[] = [];
    let wake: (() => void) | null = null;
    let aborted = false;

    const unsubscribe = events.subscribe(drop, (event) => {
      queue.push(event);
      wake?.();
    });

    stream.onAbort(() => {
      aborted = true;
      unsubscribe();
      wake?.();
    });

    try {
      await stream.writeSSE({
        event: "snapshot",
        data: JSON.stringify({
          drop,
          chainId: row.chainId,
          // The web decides what a multisend shows.
          mode: row.mode,
          state: row.state,
          paidCount: row.paidCount,
          leafCount: row.leafCount,
          failedIndexes: row.failedIndexes,
          grossRequiredWei: row.grossRequired,
          fundingDeadline: row.fundingDeadline.toString(),
          lastTxHash: row.lastTxHash,
          at: now().toISOString(),
        }),
      });

      // Already over. Say so and close, rather than holding a connection open for nothing.
      if (TERMINAL.has(row.state)) return;

      for (;;) {
        while (queue.length > 0) {
          const event = queue.shift() as DropEvent;
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          if (event.type === "finished") return;
        }
        if (aborted) return;

        // Wait for the next event, or for the heartbeat to come due, whichever is first.
        let timer: NodeJS.Timeout | undefined;
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, HEARTBEAT_MS);
        });
        if (timer !== undefined) clearTimeout(timer);
        wake = null;

        if (aborted) return;
        if (queue.length === 0) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ at: now().toISOString() }),
          });
        }
      }
    } finally {
      unsubscribe();
    }
  });
}
