/**
 * Handle mode on or off, per chain.
 *
 * On only when all three hold:
 * - our binder key for the chain's family is set, `BINDER_EVM_*` or `BINDER_SOLANA_*`. Without
 *   it nobody could bind, and a funded handle drop would go back to its sender after 30 days
 * - the chain side is ready, `handleModeReady`: `DropFactoryV2` recorded on the EVM, a migrated
 *   `Config` with a live binder on Solana
 * - the binder on chain is our key. A wrong or rotated key would sign bindings the chain refuses,
 *   so every claim would fail
 *
 * Off refuses a handle drop and the handle preview; `GET /api/chains` says so. The reason is for
 * the server log, never for the public.
 */
import { getAddress } from "viem";

import type { ChainAdapter } from "../chain/adapter.js";
import type { Binders } from "./binders.js";

export type HandleModeReason =
  "on" | "no_binder_key" | "chain_not_ready" | "no_live_binder" | "binder_mismatch";

export interface HandleModeStatus {
  readonly on: boolean;
  readonly reason: HandleModeReason;
}

const off = (reason: Exclude<HandleModeReason, "on">): HandleModeStatus => ({ on: false, reason });

export async function handleModeStatus(
  chain: ChainAdapter,
  binders: Binders | undefined,
): Promise<HandleModeStatus> {
  // The key first: no key needs no chain read.
  const ours = chain.family === "evm" ? binders?.evm?.address : binders?.svm?.publicKey;
  if (ours === undefined) return off("no_binder_key");
  if (!(await chain.handleModeReady())) return off("chain_not_ready");
  const live = await chain.liveBinder();
  if (live === null) return off("no_live_binder");
  const same = chain.family === "evm" ? getAddress(live) === getAddress(ours) : live === ours;
  return same ? { on: true, reason: "on" } : off("binder_mismatch");
}

/** The handle preview needs handle mode on somewhere. A chain that cannot be read counts as off. */
export async function handleModeOnAnywhere(
  chains: readonly ChainAdapter[],
  binders: Binders | undefined,
): Promise<boolean> {
  const statuses = await Promise.all(
    chains.map((chain) => handleModeStatus(chain, binders).catch(() => off("chain_not_ready"))),
  );
  return statuses.some((status) => status.on);
}
