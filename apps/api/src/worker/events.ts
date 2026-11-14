/**
 * The live event bus the SSE stream reads from.
 *
 * The worker emits here, `GET /api/drops/:address/live` subscribes, and the rain animation on the
 * frontend is what finally consumes it. Every event names its drop, so one bus serves all of them.
 *
 * **In process, and that is a real limit.** With a second api instance a browser connected to
 * instance A would never see events from the worker on instance B. Today there is one process and
 * one worker, so it is honest; the moment the api is scaled this has to move to Postgres
 * `LISTEN/NOTIFY` or Redis. The interface below is small so that swap is one file. The same note
 * already applies to the in memory rate limiter, `src/middleware/rate-limit.ts`.
 *
 * **The bus is never the source of truth.** It is a notification that something happened; what
 * happened is in the database and, finally, on chain. A browser that misses an event and reloads
 * gets the whole state back from `GET /api/drops/:address`, and the stream sends a snapshot on
 * connect for exactly that reason.
 *
 * Drop keys and transaction ids are plain strings: a `0x` address and hash on an EVM chain, a
 * base58 key and signature on Solana. `amountWei` carries lamports on Solana; the field name is
 * kept so the frontend reads one shape for both chains.
 */
import { canonicalAddress } from "../chain/address.js";

export type DropEvent =
  /** The drop address holds at least `grossRequired`. Activation is next. */
  | {
      readonly type: "funding_seen";
      readonly drop: string;
      /** The native balance; on a token drop the SOL part. */
      readonly balanceWei: string;
      /** A token drop only: the vault's balance in the token's smallest unit. */
      readonly tokenAmount?: string;
    }
  /**
   * `activate` confirmed. Claims are open until `claimDeadline`.
   *
   * `txHash` is `null` when somebody else activated the drop before we got there. Activation is
   * permissionless, so that is a normal outcome and not a race we lost.
   */
  | {
      readonly type: "activated";
      readonly drop: string;
      readonly txHash: string | null;
      readonly claimDeadline: string;
    }
  /** One leaf paid. The drop page adds its row to `who got fed`. */
  | {
      readonly type: "claim_paid";
      readonly drop: string;
      readonly index: number;
      readonly recipient: string;
      /** The receiver's X account on a handle leaf. `null` on an address leaf. */
      readonly handle: string | null;
      readonly profileImageUrl: string | null;
      readonly amountWei: string;
      readonly txHash: string;
      readonly paidCount: number;
      readonly leafCount: number;
    }
  /** No more work. `state` says how it ended. */
  | {
      readonly type: "finished";
      readonly drop: string;
      readonly state: string;
      readonly paidCount: number;
      readonly leafCount: number;
      readonly failedIndexes: readonly number[];
    };

export type DropEventListener = (event: DropEvent) => void;

export interface DropEventBus {
  emit(event: DropEvent): void;
  /** Listen to one drop. Returns the unsubscribe function. */
  subscribe(drop: string, listener: DropEventListener): () => void;
  /** Live subscriber count for one drop. Used by a test, and useful in a health check later. */
  listenerCount(drop: string): number;
}

export function createDropEventBus(): DropEventBus {
  const listeners = new Map<string, Set<DropEventListener>>();

  return {
    emit(event) {
      const key = canonicalAddress(event.drop);
      for (const listener of listeners.get(key) ?? []) {
        try {
          listener(event);
        } catch (error) {
          // A browser that went away mid write must not take the worker down with it.
          console.error("drop event listener failed", error);
        }
      }
    },

    subscribe(drop, listener) {
      const key = canonicalAddress(drop);
      const set = listeners.get(key) ?? new Set<DropEventListener>();
      set.add(listener);
      listeners.set(key, set);

      return () => {
        set.delete(listener);
        // Do not leave an empty set behind for every drop that was ever watched.
        if (set.size === 0) listeners.delete(key);
      };
    },

    listenerCount: (drop) => listeners.get(canonicalAddress(drop))?.size ?? 0,
  };
}
