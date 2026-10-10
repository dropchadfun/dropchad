/**
 * The worker: watch for funding, activate, then pay everybody.
 *
 * Three job kinds, one after the other, all driven off the `drop_jobs` table:
 *
 * 1. **`watch_funding`** — read the drop's balance every few seconds. At `grossRequired` or above
 *    it is funded. A Solana token drop needs both parts, the tokens in the vault and the
 *    SOL fee and account budget. Past the funding deadline, it is over.
 * 2. **`activate`** — the relayer calls `activate()`. Permissionless, so somebody may have got
 *    there first; the status is read before the call and a drop that is already `Active` simply
 *    moves on.
 * 3. **`pay`** — walk the leaves in batches, `claimsPerTx` wide: 20 on the EVM (`MAX_BATCH`), the
 *    6.5 fit table on Solana. Each batch is checked against the chain first — `isClaimed` per
 *    leaf, or one bitmap read — so nothing is spent on leaves that are already paid, and the
 *    `Claimed` events the chain reports are what counts as progress.
 *
 * **Every step re-reads the chain before it acts.** That is what makes a restart safe: a job that
 * ran half way and died finds its own work already done and carries on from there. Nothing is
 * remembered in memory between ticks.
 *
 * **A failed batch is split, not abandoned.**: one native send that reverts takes the whole
 * batch with it, so a batch that fails is halved and halved again until the bad leaf is alone.
 * That leaf goes into `failed_indexes` and everybody else still gets paid. A contract recipient
 * that rejects ETH is the usual cause, and it must not cost the other nineteen anything.
 *
 * 4. **`settle`** — . After
 *    the claim deadline the relayer sends `refund`, after the funding deadline of a drop nobody
 *    funded it sends `cancel_unfunded`, and on Solana after either it sends `close_drop`, which
 *    returns the bitmap rent it paid at creation. Scheduled only when the adapter says it can,
 *    `capabilities`. The EVM cannot close, so there an empty drop gets nothing sent: a refund or
 *    a cancel of nothing buys nothing. Before the first of those it copies the claimed leaves to
 *    our row on Solana, because `close_drop` deletes the bitmap the boards read.
 *
 * **One worker, every chain.** A job carries its drop, the drop row carries its `chain_key`, and
 * the adapter for that key does the talking. The worker never knows which family it is on. A
 * relayer is the only thing that signs, and each can still only send its own short list: seven
 * calls on the EVM, seven instructions on Solana.
 *
 * **A handle drop never runs `pay`.** Its leaves name X ids, not addresses, so after activation it
 * gets `claim_handles` instead: one claim per binding the receiver made, `src/routes/bind.ts`.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Hex } from "viem";

import type {
  AdapterClaimItem,
  ChainAdapter,
  ChainAdapters,
  DropOnChain,
  FundingStatus,
  PaidClaim,
} from "../chain/adapter.js";
import { canonicalAddress } from "../chain/address.js";
import {
  DROP_STATUS_ACTIVE,
  DROP_STATUS_CANCELLED,
  DROP_STATUS_CREATED,
  DROP_STATUS_FINALIZED,
} from "../chain/gateway.js";
import { GasBudgetExceededError } from "../chain/relayer.js";
import type { Database } from "../db/client.js";
import { fedOne } from "../drops/fed.js";
import {
  dropHandleLeaves,
  dropJobs,
  drops,
  handleBindings,
  type DropJobRow,
  type DropRow,
} from "../db/schema.js";
import type { PriceService } from "../prices/service.js";
import type { DropEventBus } from "./events.js";
import {
  MAX_ATTEMPTS,
  backoffSeconds,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  releaseStuckJobs,
  rescheduleJob,
} from "./queue.js";

export { MAX_BATCH } from "../chain/evm/adapter.js";

/**
 * at most 10 jobs and 30 seconds per turn. Low on purpose until the
 * server logs show the real RPC limit: a claim is about six calls, so 10 is a burst of about 60.
 */
export const MAX_JOBS_PER_TURN = 10;
export const TURN_MS = 30_000;

/** The states in our own database. The chain's status is the indexer's business, not this. */
export type DropState =
  | "created"
  | "funded"
  | "active"
  | "paying"
  /** The worker has no more work. `paidCount` and `failedIndexes` say how it ended. */
  | "finished"
  /** Nobody funded it before the funding deadline. the design is now open to anyone. */
  | "funding_expired"
  /** The claim window closed with leaves still unpaid. refunds them to the creator. */
  | "claims_expired";

export interface WorkerDeps {
  readonly db: Database;
  /** One adapter per configured chain. A row's `chainKey` picks it. */
  readonly chains: ChainAdapters;
  readonly events: DropEventBus;
  readonly now: () => Date;
  /** How often a funding watcher looks again. */
  readonly pollMs: number;
  /**
   * The usd price feed, `src/prices`. Optional: without it no drop gets a price and every usd
   * board counts it zero. With it, `activate` freezes the coin's price on the row, once.
   */
  readonly prices?: PriceService | undefined;
}

export interface Worker {
  /** Run at most one job. Returns true when there was one. Tests drive this directly. */
  tick(): Promise<boolean>;
  /**
   * One worker turn: every due job, oldest first, one at a time, at most
   * `MAX_JOBS_PER_TURN` jobs and `TURN_MS`. Returns how many jobs ran. `start()` runs one per poll.
   */
  turn(): Promise<number>;
  /** Run jobs until none is due. */
  drain(): Promise<number>;
  start(): Promise<void>;
  stop(): void;
}

/** The manifest entries, as they are stored. Amounts and proofs, ready to submit. */
interface ManifestEntry {
  readonly index: number;
  readonly recipient: string;
  readonly amount: string;
  readonly proof: readonly Hex[];
}

function secondsToDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1000);
}

/** A drop of a token, not the chain's native coin. */
function isTokenDrop(row: DropRow, chain: ChainAdapter): boolean {
  return canonicalAddress(row.asset) !== canonicalAddress(chain.nativeAsset);
}

function manifestEntries(row: DropRow): ManifestEntry[] {
  const parsed = JSON.parse(row.manifestJson) as { entries: ManifestEntry[] };
  return parsed.entries;
}

export function createWorker(deps: WorkerDeps): Worker {
  const { db, chains, events } = deps;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = false;
  /** The chains whose funding poll already ran in this turn; `null` outside a turn. */
  let polledThisTurn: Set<string> | null = null;

  async function loadDrop(address: string): Promise<DropRow | null> {
    const rows = await db
      .select()
      .from(drops)
      .where(eq(drops.address, canonicalAddress(address)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function setDrop(address: string, patch: Partial<DropRow>): Promise<void> {
    await db
      .update(drops)
      .set({ ...patch, updatedAt: deps.now() })
      .where(eq(drops.address, canonicalAddress(address)));
  }

  // -------------------------------------------------------------------------
  // 1. watch for funding
  // -------------------------------------------------------------------------
  async function watchFunding(job: DropJobRow, row: DropRow, chain: ChainAdapter): Promise<void> {
    // a chain that can read many drops at once checks every waiting drop in this turn,
    // at most once per turn: a watch row due again in the same turn waits for the next.
    if (chain.fundingStatuses !== undefined) {
      if (polledThisTurn?.has(row.chainKey) === true) {
        const now = deps.now();
        await rescheduleJob(db, {
          id: job.id,
          runAfter: new Date(now.getTime() + deps.pollMs),
          now,
          countAttempt: false,
        });
        return;
      }
      polledThisTurn?.add(row.chainKey);
      return pollFunding(job, row, chain);
    }
    let funded: boolean;
    let balance: bigint;
    let tokenAmount: bigint | null = null;
    if (isTokenDrop(row, chain) && chain.fundingStatus !== undefined) {
      // the program's own check, both parts. One part alone is not funded.
      const status = await chain.fundingStatus(chain.parseAddress(row.address));
      ({ funded, tokenAmount } = status);
      balance = status.lamports;
    } else {
      // The balance the drop can spend: the whole balance on the EVM, lamports above the rent
      // minimum on Solana. The adapter knows which.
      balance = await chain.getSpendableBalance(chain.parseAddress(row.address));
      funded = balance >= BigInt(row.grossRequired);
    }
    await afterFundingRead(job, row, chain, { funded, balance, tokenAmount });
  }

  /**
   * Every waiting drop of this chain in one batched read: the job this
   * turn picked and every other `watch_funding` row of the chain, due or not. Each then goes
   * through `afterFundingRead`, the same as one drop read on its own, so every row moves to the
   * next poll together and the turns in between are free for other jobs. A read that fails
   * changes nothing: the rows only wait for the next poll, no attempt counted. One worker
   * process runs this, as everywhere in this file.
   */
  async function pollFunding(job: DropJobRow, row: DropRow, chain: ChainAdapter): Promise<void> {
    const others = await db
      .select({ job: dropJobs, row: drops })
      .from(dropJobs)
      .innerJoin(drops, eq(drops.address, dropJobs.dropAddress))
      .where(
        and(
          eq(dropJobs.kind, "watch_funding"),
          eq(dropJobs.state, "ready"),
          eq(drops.chainKey, row.chainKey),
        ),
      );
    const waiting = [{ job, row }, ...others.filter((o) => o.job.id !== job.id)];

    let statuses: Map<string, FundingStatus | null>;
    try {
      if (chain.fundingStatuses === undefined) throw new Error("no batched funding read");
      statuses = await chain.fundingStatuses(waiting.map((w) => w.row.address));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `funding poll on ${row.chainKey} failed, next poll in ${String(deps.pollMs)} ms: ${message}`,
      );
      const now = deps.now();
      for (const w of waiting) {
        await rescheduleJob(db, {
          id: w.job.id,
          runAfter: new Date(now.getTime() + deps.pollMs),
          now,
          countAttempt: false,
          error: message,
        });
      }
      return;
    }

    for (const w of waiting) {
      const status = statuses.get(w.row.address) ?? null;
      if (status === null) {
        // Not a failed read: the cluster says the account is not there. As before, it counts.
        await jobFailed(w.job, new Error(`drop account ${w.row.address} is missing on chain`));
        continue;
      }
      const funded = isTokenDrop(w.row, chain)
        ? status.funded
        : status.lamports >= BigInt(w.row.grossRequired);
      await afterFundingRead(w.job, w.row, chain, {
        funded,
        balance: status.lamports,
        tokenAmount: status.tokenAmount,
      });
    }
  }

  /** What happens after a funding read, one drop: funded, past its deadline, or wait. */
  async function afterFundingRead(
    job: DropJobRow,
    row: DropRow,
    chain: ChainAdapter,
    read: { funded: boolean; balance: bigint; tokenAmount: bigint | null },
  ): Promise<void> {
    const now = deps.now();
    const address = chain.parseAddress(row.address);
    const { funded, balance, tokenAmount } = read;

    if (funded) {
      // is `>=`, not `==`. Anything extra is extra and goes back at the end.
      await setDrop(row.address, { state: "funded" });
      events.emit({
        type: "funding_seen",
        drop: address,
        balanceWei: balance.toString(),
        ...(tokenAmount === null ? {} : { tokenAmount: tokenAmount.toString() }),
      });
      await completeJob(db, job.id, now);
      await enqueueJob(db, { dropAddress: row.address, kind: "activate", runAfter: now });
      return;
    }

    if (BigInt(Math.floor(now.getTime() / 1000)) > row.fundingDeadline) {
      // Anyone can now cancel and send whatever arrived back to the creator.
      // Our relayer does it in the `settle` job: on Solana so the rent comes back; on the
      // EVM when the drop holds anything. `settle` reads the deadline from the drop.
      await setDrop(row.address, {
        state: "funding_expired",
        lastError: "nobody funded this drop before the funding deadline",
      });
      events.emit({
        type: "finished",
        drop: address,
        state: "funding_expired",
        paidCount: 0,
        leafCount: row.leafCount,
        failedIndexes: [],
      });
      await completeJob(db, job.id, now);
      await scheduleSettle(chain, row.address, now);
      return;
    }

    // Not funded yet is the normal case, not a failure, so it does not count as an attempt.
    await rescheduleJob(db, {
      id: job.id,
      runAfter: new Date(now.getTime() + deps.pollMs),
      now,
      countAttempt: false,
    });
  }

  /**
   * The coin's usd price at this moment, written once and never again. A feed
   * that is missing, answers `null` or throws leaves the row as it is: the drop still pays.
   * A token drop never gets one.
   */
  async function freezePrice(row: DropRow, chain: ChainAdapter, at: Date): Promise<void> {
    if (deps.prices === undefined || row.priceUsd !== null || isTokenDrop(row, chain)) return;
    try {
      const price = await deps.prices.usdPrice(chain.nativeSymbol);
      if (price === null) return;
      await setDrop(row.address, { priceUsd: price.toString(), pricedAt: at });
    } catch {
      // Said in `src/prices`: a price is never a reason to stop paying.
    }
  }

  // -------------------------------------------------------------------------
  // 2. activate
  // -------------------------------------------------------------------------
  async function activate(job: DropJobRow, row: DropRow, chain: ChainAdapter): Promise<void> {
    const now = deps.now();
    const address = chain.parseAddress(row.address);
    const { status } = await chain.readDrop(address);

    if (status === DROP_STATUS_CANCELLED) {
      // Somebody called `cancelUnfunded`. Everything went back to the refund address.
      await setDrop(row.address, { state: "funding_expired", lastError: "drop was cancelled" });
      await completeJob(db, job.id, now);
      return;
    }

    if (status === DROP_STATUS_FINALIZED) {
      // Already refunded. Terminal, so there is nothing left for the relayer to do.
      await setDrop(row.address, { state: "finished" });
      await completeJob(db, job.id, now);
      return;
    }

    let txHash: string | null = row.activateTxHash;

    if (status === DROP_STATUS_CREATED) {
      const result = await chain.activate(address);
      txHash = result.txId;
      await setDrop(row.address, { activateTxHash: result.txId, lastTxHash: result.txId });
    }
    // status === DROP_STATUS_ACTIVE means somebody activated it first. Activation is
    // permissionless, and that is a good outcome, not a race we lost.

    const { claimDeadline } = await chain.readDrop(address);
    await setDrop(row.address, { state: "active" });
    await freezePrice(row, chain, now);
    events.emit({
      type: "activated",
      drop: address,
      txHash,
      claimDeadline: claimDeadline.toString(),
    });

    await completeJob(db, job.id, now);
    // a handle drop pays the bindings its receivers make, never the manifest in one go.
    await enqueueJob(db, {
      dropAddress: row.address,
      kind: row.mode === "handle" ? "claim_handles" : "pay",
      runAfter: now,
    });
  }

  // -------------------------------------------------------------------------
  // 3. pay
  // -------------------------------------------------------------------------

  /**
   * Send one batch, and split it when it will not go through.
   *
   * a single native send that fails reverts the whole `claimBatch`. Halving isolates the
   * bad leaf in log2 attempts instead of nineteen innocent leaves being stuck behind it.
   *
   * Most failures never reach the chain at all: the relayer estimates gas first, and a batch that
   * would revert fails the estimate. So splitting usually costs no gas, only calls.
   *
   * `GasBudgetExceededError` is re-thrown rather than split. It is not this batch's fault and
   * splitting would only spend the rest of the day's budget faster.
   */
  async function sendBatch(
    chain: ChainAdapter,
    address: string,
    items: readonly AdapterClaimItem[],
  ): Promise<{ paid: PaidClaim[]; failed: number[]; txHash: string | null }> {
    if (items.length === 0) return { paid: [], failed: [], txHash: null };

    try {
      const result = await chain.claimBatch(address, items);
      return { paid: [...result.paid], failed: [], txHash: result.txId };
    } catch (error) {
      if (error instanceof GasBudgetExceededError) throw error;

      if (items.length === 1) {
        const only = items[0] as AdapterClaimItem;
        console.error(`claim failed for index ${String(only.index)} of ${address}`, error);
        return { paid: [], failed: [only.index], txHash: null };
      }

      const middle = Math.floor(items.length / 2);
      const left = await sendBatch(chain, address, items.slice(0, middle));
      const right = await sendBatch(chain, address, items.slice(middle));
      return {
        paid: [...left.paid, ...right.paid],
        failed: [...left.failed, ...right.failed],
        // The last hash that actually landed. Progress, not an audit trail: `relayer_txs` is that.
        txHash: right.txHash ?? left.txHash,
      };
    }
  }

  async function pay(job: DropJobRow, row: DropRow, chain: ChainAdapter): Promise<void> {
    const now = deps.now();
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
    const address = chain.parseAddress(row.address);
    const entries = manifestEntries(row);
    const failed = new Set(row.failedIndexes);

    // After this, no claim goes through and `refund` opens instead.
    const { claimDeadline: deadline } = await chain.readDrop(address);
    if (deadline > 0n && nowSeconds > deadline) {
      await setDrop(row.address, {
        state: "claims_expired",
        lastError: "the claim window closed before every leaf was paid",
      });
      events.emit({
        type: "finished",
        drop: address,
        state: "claims_expired",
        paidCount: row.paidCount,
        leafCount: row.leafCount,
        failedIndexes: [...failed],
      });
      await completeJob(db, job.id, now);
      await scheduleSettle(chain, row.address, now);
      return;
    }

    if (row.state !== "paying") await setDrop(row.address, { state: "paying" });

    // --- phase A: walk the leaves once, in order -------------------------------------------
    if (row.nextClaimIndex < entries.length) {
      const batchSize = chain.claimsPerTx(row.leafCount);
      const window = entries.slice(row.nextClaimIndex, row.nextClaimIndex + batchSize);

      // Check first, so nothing is spent on a leaf somebody already claimed themselves. The EVM
      // contract would skip it anyway; on Solana the whole transaction would fail with
      // `AlreadyClaimed`, so the bitmap read here is what makes the batch go through.
      const candidates = window.filter((entry) => !failed.has(entry.index));
      const already = await chain.readClaimed(
        address,
        candidates.map((entry) => entry.index),
      );
      const todo: AdapterClaimItem[] = candidates
        .filter((entry) => !already.has(entry.index))
        .map((entry) => ({
          index: entry.index,
          recipient: entry.recipient,
          amount: BigInt(entry.amount),
          proof: entry.proof,
        }));

      const outcome = await sendBatch(chain, address, todo);
      for (const index of outcome.failed) failed.add(index);

      const paidCount = row.paidCount + outcome.paid.length;
      await setDrop(row.address, {
        nextClaimIndex: row.nextClaimIndex + window.length,
        paidCount,
        failedIndexes: [...failed],
        ...(outcome.txHash === null ? {} : { lastTxHash: outcome.txHash }),
      });

      let emitted = row.paidCount;
      for (const claim of outcome.paid) {
        emitted += 1;
        events.emit({
          type: "claim_paid",
          drop: address,
          index: claim.index,
          recipient: claim.recipient,
          handle: null,
          profileImageUrl: null,
          amountWei: claim.amount.toString(),
          txHash: outcome.txHash ?? "0x",
          paidCount: emitted,
          leafCount: row.leafCount,
        });
      }

      // More leaves to walk. Straight back on the queue, no backoff: this is progress.
      await rescheduleJob(db, { id: job.id, runAfter: now, now, countAttempt: false });
      return;
    }

    // --- phase B: the leaves that would not go through -------------------------------------
    // One more try each, alone, because the reason may have been temporary. Each try re-reads
    // `isClaimed` first, so a leaf that has since been claimed by its owner is simply dropped
    // from the list rather than paid twice.
    if (failed.size > 0 && job.attempts < MAX_ATTEMPTS) {
      const retried: number[] = [];
      let paidCount = row.paidCount;
      let lastTxHash: string | null = null;

      const alreadyClaimed = await chain.readClaimed(address, [...failed]);
      for (const index of [...failed]) {
        const entry = entries[index];
        if (entry === undefined) continue;
        if (alreadyClaimed.has(index)) {
          failed.delete(index);
          continue;
        }
        const outcome = await sendBatch(chain, address, [
          {
            index,
            recipient: entry.recipient,
            amount: BigInt(entry.amount),
            proof: entry.proof,
          },
        ]);
        if (outcome.paid.length > 0) {
          failed.delete(index);
          paidCount += outcome.paid.length;
          lastTxHash = outcome.txHash;
          for (const claim of outcome.paid) {
            events.emit({
              type: "claim_paid",
              drop: address,
              index: claim.index,
              recipient: claim.recipient,
              handle: null,
              profileImageUrl: null,
              amountWei: claim.amount.toString(),
              txHash: outcome.txHash ?? "0x",
              paidCount,
              leafCount: row.leafCount,
            });
          }
        } else {
          retried.push(index);
        }
      }

      await setDrop(row.address, {
        paidCount,
        failedIndexes: [...failed],
        ...(lastTxHash === null ? {} : { lastTxHash }),
      });

      if (retried.length > 0) {
        await rescheduleJob(db, {
          id: job.id,
          runAfter: new Date(now.getTime() + backoffSeconds(job.attempts + 1) * 1000),
          now,
          countAttempt: true,
          error: `${String(retried.length)} leaves still unpaid`,
        });
        return;
      }
    }

    // --- done -------------------------------------------------------------------------------
    const finalRow = await loadDrop(row.address);
    const paidCount = finalRow?.paidCount ?? row.paidCount;
    await setDrop(row.address, {
      state: "finished",
      ...(failed.size > 0
        ? { lastError: `${String(failed.size)} leaves could not be paid` }
        : { lastError: null }),
    });
    events.emit({
      type: "finished",
      drop: address,
      state: "finished",
      paidCount,
      leafCount: row.leafCount,
      failedIndexes: [...failed],
    });
    await completeJob(db, job.id, now);
    // Even a fully paid drop is settled: `refund` with nothing left still moves it to Finalized,
    // which is what lets `close_drop` return the rent. Due one second after the deadline.
    await scheduleSettle(chain, row.address, secondsToDate(deadline + 1n));
  }

  // -------------------------------------------------------------------------
  // 3b. claim_handles, handle drops only
  // -------------------------------------------------------------------------

  async function setBinding(
    address: string,
    index: number,
    fields: Partial<typeof handleBindings.$inferInsert>,
  ): Promise<void> {
    await db
      .update(handleBindings)
      .set({ ...fields, updatedAt: deps.now() })
      .where(and(eq(handleBindings.dropAddress, address), eq(handleBindings.leafIndex, index)));
  }

  async function bindingsOf(address: string) {
    return db
      .select()
      .from(handleBindings)
      .where(eq(handleBindings.dropAddress, address))
      .orderBy(asc(handleBindings.leafIndex));
  }

  /**
   * One `claimHandle` per `bound` binding. The job stays alive until every leaf is paid or
   * the claim window closes; a bind wakes it, and it looks again on its own every minute.
   *
   * After a failed send the chain decides, never the error text, which a real RPC does not
   * reliably carry: the bit set means paid, by us or by anyone holding the binding; a binder that
   * is not live means paused, so the binding waits; anything else is `failed`, and the receiver
   * may bind again.
   */
  async function claimHandles(job: DropJobRow, row: DropRow, chain: ChainAdapter): Promise<void> {
    const now = deps.now();
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
    const address = chain.parseAddress(row.address);
    const later = new Date(now.getTime() + Math.max(deps.pollMs * 12, 60_000));

    const { claimDeadline: deadline } = await chain.readDrop(address);
    if (deadline > 0n && nowSeconds > deadline) {
      await setDrop(row.address, {
        state: "claims_expired",
        lastError: "the claim window closed before every handle leaf was claimed",
      });
      events.emit({
        type: "finished",
        drop: address,
        state: "claims_expired",
        paidCount: row.paidCount,
        leafCount: row.leafCount,
        failedIndexes: [],
      });
      await completeJob(db, job.id, now);
      await scheduleSettle(chain, row.address, now);
      return;
    }

    if (!chain.capabilities.handleClaims) {
      await rescheduleJob(db, {
        id: job.id,
        runAfter: later,
        now,
        countAttempt: false,
        error: `handle claims are not built for ${chain.chainKey} yet`,
      });
      return;
    }

    const proofs = new Map(
      (JSON.parse(row.manifestJson) as { entries: { index: number; proof: Hex[] }[] }).entries.map(
        (entry) => [entry.index, entry.proof],
      ),
    );

    // --- a `submitted` row is one a crash interrupted: the bit says how it ended ---------------
    const interrupted = (await bindingsOf(row.address)).filter((b) => b.state === "submitted");
    if (interrupted.length > 0) {
      const landed = await chain.readClaimed(
        address,
        interrupted.map((b) => b.leafIndex),
      );
      for (const b of interrupted) {
        await setBinding(row.address, b.leafIndex, {
          state: landed.has(b.leafIndex) ? "paid" : "bound",
        });
      }
    }

    // --- send every bound binding, one transaction each -----------------------------------
    let paused = false;
    for (const b of (await bindingsOf(row.address)).filter((x) => x.state === "bound")) {
      const proof = proofs.get(b.leafIndex);
      const leafAmount = await leafAmountOf(row.address, b.leafIndex);
      if (proof === undefined || leafAmount === null) {
        await setBinding(row.address, b.leafIndex, {
          state: "failed",
          lastError: `leaf ${String(b.leafIndex)} is not in the manifest`,
        });
        continue;
      }

      await setBinding(row.address, b.leafIndex, { state: "submitted" });
      try {
        const result = await chain.claimHandle(address, {
          index: b.leafIndex,
          xId: BigInt(b.xUserId),
          amount: leafAmount,
          recipient: b.recipient,
          proof,
          signature: b.binderSignature as Hex,
        });
        await setBinding(row.address, b.leafIndex, {
          state: "paid",
          claimTxHash: result.txId,
          lastError: null,
        });
        const paidCount = await countPaid(row.address);
        await setDrop(row.address, { paidCount, lastTxHash: result.txId });
        const who = await fedOne(db, row.address, b.leafIndex);
        events.emit({
          type: "claim_paid",
          drop: address,
          index: b.leafIndex,
          recipient: result.paid?.recipient ?? b.recipient,
          handle: who?.handle ?? null,
          profileImageUrl: who?.profileImageUrl ?? null,
          amountWei: (result.paid?.amount ?? leafAmount).toString(),
          txHash: result.txId,
          paidCount,
          leafCount: row.leafCount,
        });
      } catch (error) {
        if (error instanceof GasBudgetExceededError) {
          await setBinding(row.address, b.leafIndex, { state: "bound" });
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const claimed = await chain.readClaimed(address, [b.leafIndex]);
        if (claimed.has(b.leafIndex)) {
          await setBinding(row.address, b.leafIndex, { state: "paid", lastError: null });
          await setDrop(row.address, { paidCount: await countPaid(row.address) });
        } else if (!(await chain.binderLive())) {
          // Revoked or unset: a pause. Nothing is lost.
          await setBinding(row.address, b.leafIndex, { state: "bound" });
          paused = true;
          break;
        } else {
          console.error(
            `handle claim failed for index ${String(b.leafIndex)} of ${address}`,
            error,
          );
          await setBinding(row.address, b.leafIndex, {
            state: "failed",
            lastError: message.slice(0, 500),
          });
        }
      }
    }

    const paidCount = await countPaid(row.address);
    if (paidCount >= row.leafCount) {
      await setDrop(row.address, { state: "finished", paidCount, lastError: null });
      events.emit({
        type: "finished",
        drop: address,
        state: "finished",
        paidCount,
        leafCount: row.leafCount,
        failedIndexes: [],
      });
      await completeJob(db, job.id, now);
      await scheduleSettle(chain, row.address, secondsToDate(deadline + 1n));
      return;
    }

    await rescheduleJob(db, {
      id: job.id,
      runAfter: later,
      now,
      countAttempt: false,
      error: paused ? "the binder is not live, handle claims wait" : null,
    });
  }

  async function countPaid(address: string): Promise<number> {
    return (await bindingsOf(address)).filter((b) => b.state === "paid").length;
  }

  async function leafAmountOf(address: string, index: number): Promise<bigint | null> {
    const [leaf] = await db
      .select({ amount: dropHandleLeaves.amount })
      .from(dropHandleLeaves)
      .where(and(eq(dropHandleLeaves.dropAddress, address), eq(dropHandleLeaves.leafIndex, index)))
      .limit(1);
    return leaf === undefined ? null : BigInt(leaf.amount);
  }

  // -------------------------------------------------------------------------
  // 4. settle
  // -------------------------------------------------------------------------

  /**
   * Whether a refund or a cancel would move anything.
   * without `close` one of nothing buys nothing, so an empty drop gets none. Solana sends them
   * even then, because that is what lets `close_drop` run. On the EVM "anything" is any ETH or
   * any of the drop's token.
   */
  async function worthSettling(chain: ChainAdapter, address: string): Promise<boolean> {
    if (chain.capabilities.close) return true;
    if (chain.holdsAnything !== undefined) return chain.holdsAnything(address);
    return (await chain.getSpendableBalance(address)) > 0n;
  }

  /** Queue the settle job, if this chain's relayer can settle at all. */
  async function scheduleSettle(
    chain: ChainAdapter,
    address: string,
    runAfter: Date,
  ): Promise<void> {
    const { refund, cancelUnfunded, close } = chain.capabilities;
    if (!refund && !cancelUnfunded && !close) return;
    await enqueueJob(db, { dropAddress: address, kind: "settle", runAfter });
  }

  /** How long to wait for `finalized` to catch up with `confirmed`, about 15 seconds on Solana. */
  const FINALIZED_WAIT_MS = 15_000;
  /**
   * The copy waits this long past the deadline by the **chain's** clock, a
   * margin on top of the chain time, never the server's.
   */
  const COPY_MARGIN_SECONDS = 120n;

  /**
   * Copy the claimed leaf indexes to our row once the deadline has passed,
   * before this job sends anything: `close_drop` deletes the bitmap, and our `refund` or
   * `cancel_unfunded` is what lets anybody send it. Past the deadline no claim can land, so the
   * bitmap is frozen. "Past" is the chain's `unix_timestamp` from the same `finalized` read, plus
   * `COPY_MARGIN_SECONDS`; a server clock that runs ahead of the chain would copy while a claim
   * can still land. `deadline` is `null` once the chain's own status says the window is over.
   * Kept only when it agrees with the `confirmed` read, so a claim that landed just before the
   * deadline is not missed. Taken once, never rewritten. Returns false when it rescheduled the
   * job and the caller must stop.
   *
   * No bitmap means somebody closed the drop first. Then there is no copy, never an empty one:
   * an empty list would say nobody was paid. The known gap.
   */
  async function copyClaimed(
    job: DropJobRow,
    row: DropRow,
    chain: ChainAdapter,
    address: string,
    onChain: DropOnChain,
    deadline: bigint | null,
  ): Promise<boolean> {
    if (row.claimedIndexes !== null || onChain.closed || chain.claimedSnapshot === undefined) {
      return true;
    }
    const snapshot = await chain.claimedSnapshot(address);
    if (snapshot === null) return true;
    const copyAfter = deadline === null ? null : deadline + COPY_MARGIN_SECONDS;
    if (copyAfter !== null && snapshot.unixTimestamp <= copyAfter) {
      const now = deps.now();
      const waitMs = Number(copyAfter - snapshot.unixTimestamp + 1n) * 1000;
      await rescheduleJob(db, {
        id: job.id,
        runAfter: new Date(now.getTime() + Math.max(waitMs, FINALIZED_WAIT_MS)),
        now,
        countAttempt: false,
      });
      return false;
    }
    if (
      snapshot.indexes.length !== snapshot.claimedCount ||
      snapshot.claimedCount !== onChain.claimedCount
    ) {
      const now = deps.now();
      await rescheduleJob(db, {
        id: job.id,
        runAfter: new Date(now.getTime() + FINALIZED_WAIT_MS),
        now,
        countAttempt: false,
      });
      return false;
    }
    await setDrop(row.address, { claimedIndexes: [...snapshot.indexes] });
    return true;
  }

  /**
   * Refund or cancel, then close. Every step re-reads the drop first, so a settle that was half
   * done by somebody else — anyone may call these — finds the work done and moves on.
   */
  async function settle(job: DropJobRow, row: DropRow, chain: ChainAdapter): Promise<void> {
    const now = deps.now();
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
    const address = chain.parseAddress(row.address);
    const onChain = await chain.readDrop(address);

    if (onChain.status === DROP_STATUS_CREATED) {
      if (nowSeconds <= onChain.fundingDeadline) {
        // Somebody may still fund it. Come back when the window has closed.
        await rescheduleJob(db, {
          id: job.id,
          runAfter: secondsToDate(onChain.fundingDeadline + 1n),
          now,
          countAttempt: false,
        });
        return;
      }
      if (!chain.capabilities.cancelUnfunded) return completeJob(db, job.id, now);
      if (!(await copyClaimed(job, row, chain, address, onChain, onChain.fundingDeadline))) return;
      // the EVM auto cancel, only when the drop holds something. Our relayer pays the gas,
      // inside the daily budget; `GasBudgetExceededError` retries the job later.
      if (!(await worthSettling(chain, address))) return completeJob(db, job.id, now);
      const result = await chain.cancelUnfunded(address);
      await setDrop(row.address, { settleTxHash: result.txId, lastTxHash: result.txId });
      // Straight on to the close, same job, next tick.
      await rescheduleJob(db, { id: job.id, runAfter: now, now, countAttempt: false });
      return;
    }

    if (onChain.status === DROP_STATUS_ACTIVE) {
      if (nowSeconds <= onChain.claimDeadline) {
        await rescheduleJob(db, {
          id: job.id,
          runAfter: secondsToDate(onChain.claimDeadline + 1n),
          now,
          countAttempt: false,
        });
        return;
      }
      if (!chain.capabilities.refund) return completeJob(db, job.id, now);
      if (!(await copyClaimed(job, row, chain, address, onChain, onChain.claimDeadline))) return;
      // A token drop with tokens left and no ETH is refunded too.
      if (!(await worthSettling(chain, address))) return completeJob(db, job.id, now);
      const result = await chain.refund(address);
      await setDrop(row.address, { settleTxHash: result.txId, lastTxHash: result.txId });
      await rescheduleJob(db, { id: job.id, runAfter: now, now, countAttempt: false });
      return;
    }

    // Finalized or Cancelled. Close it, once.
    if (onChain.closed || !chain.capabilities.close) {
      if (onChain.closed && row.closedAt === null) await setDrop(row.address, { closedAt: now });
      await completeJob(db, job.id, now);
      return;
    }
    // Refunded or cancelled by somebody else, or before this code: copy before the close too.
    if (!(await copyClaimed(job, row, chain, address, onChain, null))) return;
    const result = await chain.closeDrop(address);
    await setDrop(row.address, {
      closeTxHash: result.txId,
      lastTxHash: result.txId,
      closedAt: now,
    });
    await completeJob(db, job.id, now);
  }

  // -------------------------------------------------------------------------
  // the loop
  // -------------------------------------------------------------------------
  async function runJob(job: DropJobRow): Promise<void> {
    const row = await loadDrop(job.dropAddress);
    if (row === null) {
      // The drop is gone. Nothing to do, and retrying will not bring it back.
      await completeJob(db, job.id, deps.now());
      return;
    }

    const chain = chains.get(row.chainKey);
    if (chain === undefined) {
      // This process has no relayer for that chain right now: the key is not in this .env, or
      // the Solana config is not initialised yet. Not the job's fault, so wait and do not count it.
      const now = deps.now();
      await rescheduleJob(db, {
        id: job.id,
        runAfter: new Date(now.getTime() + Math.max(deps.pollMs * 12, 60_000)),
        now,
        countAttempt: false,
        error: `no relayer configured for chain ${row.chainKey}`,
      });
      return;
    }

    switch (job.kind) {
      case "watch_funding":
        return watchFunding(job, row, chain);
      case "activate":
        return activate(job, row, chain);
      case "pay":
        return pay(job, row, chain);
      case "settle":
        return settle(job, row, chain);
      case "claim_handles":
        return claimHandles(job, row, chain);
      default:
        await failJob(db, {
          id: job.id,
          error: `unknown job kind ${job.kind}`,
          now: deps.now(),
        });
    }
  }

  /** A job that threw: one attempt more and a backoff, or failed for good after the last. */
  async function jobFailed(job: DropJobRow, error: unknown): Promise<void> {
    const now = deps.now();
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts + 1;
    console.error(`job ${job.kind} for ${job.dropAddress} failed`, error);

    if (attempts >= MAX_ATTEMPTS) {
      await failJob(db, { id: job.id, error: message, now });
      await setDrop(job.dropAddress, { lastError: message });
    } else {
      await rescheduleJob(db, {
        id: job.id,
        runAfter: new Date(now.getTime() + backoffSeconds(attempts) * 1000),
        now,
        countAttempt: true,
        error: message,
      });
    }
  }

  async function tick(): Promise<boolean> {
    const job = await claimNextJob(db, deps.now());
    if (job === null) return false;

    try {
      await runJob(job);
    } catch (error) {
      await jobFailed(job, error);
    }
    return true;
  }

  /**
   * Every due job, oldest first (`claimNextJob`), one after another, until none is due,
   * `MAX_JOBS_PER_TURN` have run, or `TURN_MS` has passed. The time is looked at before each new
   * job, so a job that has started always finishes. A failed job goes through `tick`'s own error
   * path, as before, and the turn goes on.
   */
  async function turn(): Promise<number> {
    const started = deps.now().getTime();
    polledThisTurn = new Set();
    let ran = 0;
    try {
      while (ran < MAX_JOBS_PER_TURN && deps.now().getTime() - started < TURN_MS) {
        if (!(await tick())) break;
        ran += 1;
      }
    } finally {
      polledThisTurn = null;
    }
    return ran;
  }

  return {
    tick,
    turn,

    async drain() {
      let done = 0;
      // A bound, so a job that reschedules itself to `now` cannot spin forever inside one call.
      while (done < 1000 && (await tick())) done += 1;
      return done;
    },

    async start() {
      const released = await releaseStuckJobs(db, deps.now());
      if (released > 0) console.log(`worker: ${String(released)} jobs released after a restart`);

      const loop = () => {
        if (stopped) return;
        timer = setTimeout(() => {
          void (async () => {
            if (!running) {
              running = true;
              try {
                await turn();
              } catch (error) {
                console.error("worker tick failed", error);
              } finally {
                running = false;
              }
            }
            loop();
          })();
        }, deps.pollMs);
        // Do not hold the process open for the sake of the next poll.
        timer.unref?.();
      };
      loop();
    },

    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/** How much work is still outstanding. Used by the tests, and by `/api/health` later. */
export async function pendingJobCount(db: Database): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM drop_jobs WHERE state IN ('ready', 'running')`,
  );
  return (result.rows as unknown as { count: number }[])[0]?.count ?? 0;
}
