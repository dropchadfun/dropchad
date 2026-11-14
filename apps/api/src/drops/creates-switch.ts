/**
 * The api switch per chain. `SOLANA_CREATES` for the Solana chain,
 * `EVM_CREATES` for the EVM chain. It stops new drops only: `POST /api/drops` checks it first,
 * `GET /api/chains` reports it. Claims, refunds and the worker never read it.
 */
import type { ChainAdapter } from "../chain/adapter.js";
import type { Config } from "../config.js";

/** True when the switch of this chain's family is `off`. */
export function createsSwitchOff(
  config: Pick<Config, "SOLANA_CREATES" | "EVM_CREATES">,
  family: ChainAdapter["family"],
): boolean {
  return (family === "svm" ? config.SOLANA_CREATES : config.EVM_CREATES) === "off";
}

export interface CreatesState {
  /** `null` when the pause read failed and the switch is on: not sure. */
  readonly createsOn: boolean | null;
  readonly offBy: "api" | "program" | null;
}

/** How long one pause read is kept, the same as the fee reads of `GET /api/chains`. */
export const PAUSE_TTL_MS = 30_000;

/**
 * The program pause (Solana `config.paused`) or the factory pause (EVM `paused()`) per chain,
 * One reader per app, shared by `GET /api/chains` and `POST /api/drops`, so both
 * see the same read. `null` is a failed read, never kept.
 */
export interface PauseReader {
  paused(
    adapter: Pick<ChainAdapter, "chainKey" | "creationPaused">,
    nowMs: number,
  ): Promise<boolean | null>;
}

export function createPauseReader(): PauseReader {
  const cache = new Map<string, { readonly value: boolean; readonly readAt: number }>();
  return {
    async paused(adapter, nowMs) {
      const hit = cache.get(adapter.chainKey);
      if (hit !== undefined && nowMs - hit.readAt < PAUSE_TTL_MS) return hit.value;
      try {
        const value = await adapter.creationPaused();
        cache.set(adapter.chainKey, { value, readAt: nowMs });
        return value;
      } catch {
        return null;
      }
    },
  };
}

/** The switch wins; else the program or factory pause; `null` paused is a failed read. */
export function createsState(switchOff: boolean, paused: boolean | null): CreatesState {
  if (switchOff) return { createsOn: false, offBy: "api" };
  if (paused === null) return { createsOn: null, offBy: null };
  return paused ? { createsOn: false, offBy: "program" } : { createsOn: true, offBy: null };
}
