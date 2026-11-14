/**
 * The running creates of the create quota, and of the waiting drops limit,
 *
 * In memory, enough for one api process, as the rate limiter. More than one instance moves the
 * lock and the slots to the database.
 */
import { CREATE_RATE_LIMIT, CREATE_RATE_WINDOW_SECONDS } from "../config.js";

export interface CreateSlot {
  /** `keep`: the create failed after the on chain create started, so it counts for the hour. */
  end(options: { keep: boolean }): void;
}

export interface QuotaCounts {
  /** The X id's drop rows inside the rate limit window. */
  readonly recent: () => Promise<number>;
  /** The X id's drop rows waiting for funding. */
  readonly waiting: () => Promise<number>;
  /** The waiting drops limit. */
  readonly waitingMax: number;
}

export type QuotaRefusal = "rate_limited" | "too_many_waiting";

export interface CreateQuota {
  /**
   * Under the X id's lock: the rows in the window plus its slots: the waiting rows
   * plus its running creates. A refusal names the limit that was reached first.
   */
  take(xUserId: string, now: Date, counts: QuotaCounts): Promise<CreateSlot | QuotaRefusal>;
}

interface Slot {
  readonly startedAt: number;
  running: boolean;
  kept: boolean;
}

export function createCreateQuota(): CreateQuota {
  const locks = new Map<string, Promise<void>>();
  const slots = new Map<string, Set<Slot>>();
  const windowMs = CREATE_RATE_WINDOW_SECONDS * 1000;

  /** One caller at a time per X id: each waits for the one before it. */
  async function withLock<T>(xUserId: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(xUserId) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    locks.set(xUserId, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(xUserId) === tail) locks.delete(xUserId);
    }
  }

  /** The slots that still count at `at`; kept slots older than the window are dropped. */
  function live(xUserId: string, at: number): Set<Slot> {
    const own = slots.get(xUserId) ?? new Set<Slot>();
    for (const slot of own) {
      if (!slot.running && slot.kept && slot.startedAt + windowMs <= at) own.delete(slot);
    }
    if (own.size === 0) slots.delete(xUserId);
    return own;
  }

  return {
    take(xUserId, now, counts) {
      return withLock(xUserId, async () => {
        const at = now.getTime();
        const own = live(xUserId, at);
        if ((await counts.recent()) + own.size >= CREATE_RATE_LIMIT) return "rate_limited";

        // A running create becomes a waiting drop once it lands.
        const running = [...own].filter((slot) => slot.running).length;
        if ((await counts.waiting()) + running >= counts.waitingMax) return "too_many_waiting";

        const slot: Slot = { startedAt: at, running: true, kept: false };
        own.add(slot);
        slots.set(xUserId, own);
        return {
          end({ keep }) {
            slot.running = false;
            slot.kept = keep;
            if (!keep) {
              own.delete(slot);
              if (own.size === 0 && slots.get(xUserId) === own) slots.delete(xUserId);
            }
          },
        };
      });
    },
  };
}
