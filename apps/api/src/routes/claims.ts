/**
 * `GET /api/claims` — the receiver's list.
 *
 * Signed in only. The handle drops with a leaf for the session's X id, newest first: never a
 * multisend, never another receiver's leaf, never the commitment blind, never a raw error.
 *
 * One state per item, in this order of truth:
 *  1. `paid`: our binding says the claim landed. A fact, whatever happened after
 *  2. `ended`: the drop is `Finalized` or `Cancelled`, or `Active` past its claim deadline
 *  3. `not_funded`: still `Created` on chain
 *  4. `paused`: handle mode is off on that chain. A bound claim waits too
 *  5. `sending`: bound, submitted or pending, the worker is on it
 *  6. `failed`: the claim did not land and the bit is clear; a new address is allowed.
 *     `stuck` instead once the signature left the api: the wallet can no longer change.
 *     On a v2 drop `retry` instead while only the same wallet can be claimed again
 *  7. `claimable`
 *
 * The status and the deadline come from the chain, as `bind` reads them, every Solana drop in one
 * batched read. A chain that cannot be read is named in
 * `unavailable` and its drops are left out, never shown with a guessed state; the rest is still
 * listed, `200`.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress } from "viem";

import type { AppEnv } from "../app.js";
import { readSessionCookie } from "../auth/cookies.js";
import { readSession } from "../auth/session.js";
import { handleModeStatus } from "../binder/handle-mode.js";
import { isEvmAddressText } from "../chain/address.js";
import type { DropOnChain } from "../chain/adapter.js";
import { claimsChainAllowed, isMainnetSite, unitOf } from "../chain/filter.js";
import { giphyOf } from "../drops/giphy.js";
import { mayBeLive } from "../drops/hidden.js";
import { tokenInfoOf, unitOfDrop } from "../drops/token-info.js";
import { dropHandleLeaves, drops, handleBindings, profiles } from "../db/schema.js";
import { rateLimit, sessionOrIpKey } from "../middleware/rate-limit.js";

/** The same four numbers on both chains. */
const STATUS_CREATED = 0;
const STATUS_ACTIVE = 1;

export type ClaimState =
  | "paid"
  | "ended"
  | "not_funded"
  | "paused"
  | "sending"
  | "failed"
  | "retry"
  | "stuck"
  | "claimable";

export function claimState(args: {
  readonly binding: "bound" | "submitted" | "pending" | "paid" | "failed" | null;
  /** The binder signature left the api: a failed claim can no longer take a new wallet. */
  readonly signatureSent: boolean;
  readonly status: number;
  readonly claimDeadline: bigint;
  readonly nowSeconds: bigint;
  readonly handleModeOn: boolean;
  /** 2 for a binding v2 drop; absent is v1. */
  readonly bindingVersion?: 1 | 2;
  /** The binding's `binding_valid_until`, v2 only. */
  readonly validUntil?: bigint | null;
  /** The chain's own time, v2 only.4. */
  readonly chainTime?: bigint;
}): ClaimState {
  if (args.binding === "paid") return "paid";
  if (args.status !== STATUS_CREATED && args.status !== STATUS_ACTIVE) return "ended";
  if (
    args.status === STATUS_ACTIVE &&
    args.claimDeadline > 0n &&
    args.nowSeconds > args.claimDeadline
  )
    return "ended";
  if (args.status === STATUS_CREATED) return "not_funded";
  if (!args.handleModeOn) return "paused";
  if (args.binding === "bound" || args.binding === "submitted" || args.binding === "pending")
    return "sending";
  if (args.binding === "failed" && args.bindingVersion === 2) {
    // A new wallet only once the chain's time is past `validUntil`; before that
    // the same wallet can be claimed again. Never stuck, never sending: nothing is on its way.
    const until = args.validUntil ?? null;
    const time = args.chainTime;
    return until === null || (time !== undefined && time > until) ? "failed" : "retry";
  }
  if (args.binding === "failed") return args.signatureSent ? "stuck" : "failed";
  return "claimable";
}

export function createClaimRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.use("/", rateLimit({ limit: 30, windowSeconds: 60, keyOf: sessionOrIpKey }));

  routes.get("/", async (c) => {
    const { db, config, now, writeSides, binders } = c.var.deps;

    const sessionId = readSessionCookie(c);
    if (sessionId === undefined) return c.json({ error: "unauthorized" }, 401);
    const nowDate = now();
    const session = await readSession(db, {
      secret: config.SESSION_SECRET,
      sessionId,
      now: nowDate,
    });
    if (session === null) return c.json({ error: "unauthorized" }, 401);
    const me = session.xUserId;

    const loginAgeSeconds = Math.floor((nowDate.getTime() - session.loggedInAt.getTime()) / 1000);
    const freshLoginSecondsLeft = Math.max(0, config.BIND_FRESH_LOGIN_SECONDS - loginAgeSeconds);

    // My leaves on handle drops, newest drop first. One leaf per X id per drop. Never a
    // drop that never went live.
    const rows = await db
      .select({
        address: drops.address,
        chainKey: drops.chainKey,
        chainId: drops.chainId,
        title: drops.title,
        giphyId: drops.giphyId,
        giphyKind: drops.giphyKind,
        sender: drops.xUserId,
        asset: drops.asset,
        tokenProgram: drops.tokenProgram,
        tokenDecimals: drops.tokenDecimals,
        tokenName: drops.tokenName,
        tokenSymbol: drops.tokenSymbol,
        tokenLaunchpad: drops.tokenLaunchpad,
        tokenXUrl: drops.tokenXUrl,
        index: dropHandleLeaves.leafIndex,
        amount: dropHandleLeaves.amount,
      })
      .from(dropHandleLeaves)
      .innerJoin(drops, eq(drops.address, dropHandleLeaves.dropAddress))
      .where(
        and(
          eq(dropHandleLeaves.xUserId, me),
          eq(drops.mode, "handle"),
          mayBeLive(Math.floor(nowDate.getTime() / 1000)),
        ),
      )
      .orderBy(desc(drops.createdAt));
    // on a mainnet site no testnet claim is listed.
    const mainnetSite = isMainnetSite(config);
    const mine = rows.filter((row) => claimsChainAllowed(row.chainKey, mainnetSite));
    if (mine.length === 0) return c.json({ claims: [], unavailable: [], freshLoginSecondsLeft });

    const addresses = mine.map((row) => row.address);
    const bindings = new Map(
      (
        await db
          .select({
            dropAddress: handleBindings.dropAddress,
            state: handleBindings.state,
            recipient: handleBindings.recipient,
            claimTxHash: handleBindings.claimTxHash,
            signatureSentAt: handleBindings.bindingSignatureSentAt,
            validUntil: handleBindings.bindingValidUntil,
          })
          .from(handleBindings)
          .where(
            and(eq(handleBindings.xUserId, me), inArray(handleBindings.dropAddress, addresses)),
          )
      ).map((b) => [b.dropAddress, b] as const),
    );
    const senders = new Map(
      (
        await db
          .select({
            xUserId: profiles.xUserId,
            handle: profiles.handle,
            displayName: profiles.displayName,
            profileImageUrl: profiles.profileImageUrl,
          })
          .from(profiles)
          .where(inArray(profiles.xUserId, [...new Set(mine.map((row) => row.sender))]))
      ).map((p) => [p.xUserId, p] as const),
    );

    // Handle mode once per chain. A chain whose status cannot be read counts as off: paused.
    // The promise is kept, not the answer, so drops read in parallel share one read.
    const modes = new Map<string, Promise<boolean>>();
    const modeOf = (chainKey: string): Promise<boolean> => {
      const known = modes.get(chainKey);
      if (known !== undefined) return known;
      const chain = writeSides?.get(chainKey);
      const on =
        chain === undefined
          ? Promise.resolve(false)
          : handleModeStatus(chain, binders).then(
              (status) => status.on,
              () => false,
            );
      modes.set(chainKey, on);
      return on;
    };

    // Each chain's drops read once: one batched read where the adapter has it, else one by one.
    // A chain that fails, or has no adapter, is named and its drops are left out.
    const onChainOf = new Map<string, DropOnChain>();
    const unavailable: string[] = [];
    for (const chainKey of [...new Set(mine.map((row) => row.chainKey))]) {
      const chain = writeSides?.get(chainKey);
      const wanted = mine.filter((row) => row.chainKey === chainKey).map((row) => row.address);
      try {
        if (chain === undefined) throw new Error("no chain adapter for this drop");
        const read =
          chain.readDrops !== undefined
            ? await chain.readDrops(wanted)
            : new Map(
                await Promise.all(
                  wanted.map(async (address) => [address, await chain.readDrop(address)] as const),
                ),
              );
        for (const [address, value] of read) onChainOf.set(address, value);
      } catch (error) {
        console.error(`claims: ${chainKey} could not be read`, error);
        unavailable.push(chainKey);
      }
    }

    const nowSeconds = BigInt(Math.floor(nowDate.getTime() / 1000));
    // Only a failed binding needs its version, and the chain's time once a chain.
    const chainTimes = new Map<string, Promise<bigint>>();
    const v2Facts = async (
      chainKey: string,
      drop: string,
      validUntil: bigint | null,
    ): Promise<{ bindingVersion: 1 | 2; validUntil: bigint | null; chainTime?: bigint }> => {
      const adapter = writeSides?.get(chainKey);
      const version = (await adapter?.bindingVersionOf?.(drop)) ?? 1;
      if (version === 1 || adapter?.chainTime === undefined || validUntil === null) {
        return { bindingVersion: version, validUntil };
      }
      let time = chainTimes.get(chainKey);
      if (time === undefined) {
        time = adapter.chainTime();
        chainTimes.set(chainKey, time);
      }
      return { bindingVersion: version, validUntil, chainTime: await time };
    };
    const claims = await Promise.all(
      mine
        .filter((row) => !unavailable.includes(row.chainKey))
        .map(async (row) => {
          const onChain = onChainOf.get(row.address) as DropOnChain;
          const binding = bindings.get(row.address) ?? null;
          const sender = senders.get(row.sender);
          // A token leaf is in its token.
          const unit = unitOfDrop(row, unitOf(row.chainKey));
          const state = claimState({
            binding: binding?.state ?? null,
            signatureSent: binding?.signatureSentAt != null,
            status: onChain.status,
            claimDeadline: onChain.claimDeadline,
            nowSeconds,
            handleModeOn: await modeOf(row.chainKey),
            ...(binding?.state === "failed"
              ? await v2Facts(row.chainKey, row.address, binding.validUntil ?? null)
              : {}),
          });
          // A sending claim between two attempts of a new send says so.
          const retrying =
            state === "sending" &&
            writeSides?.get(row.chainKey)?.isRetrying?.(row.address, row.index) === true;
          return {
            drop: isEvmAddressText(row.address) ? getAddress(row.address) : row.address,
            chainKey: row.chainKey,
            chainId: row.chainId,
            title: row.title,
            // The drop's GIF for the open drop card.
            giphy: giphyOf(row),
            sender:
              sender === undefined
                ? null
                : {
                    handle: sender.handle,
                    displayName: sender.displayName,
                    profileImageUrl: sender.profileImageUrl,
                  },
            amount: row.amount,
            symbol: unit.symbol,
            decimals: unit.decimals,
            token: tokenInfoOf(row),
            index: row.index,
            claimDeadline: onChain.claimDeadline > 0n ? onChain.claimDeadline.toString() : null,
            state,
            ...(retrying ? { retrying: true } : {}),
            // The receiver's own choice. Never the binder signature, never the raw error.
            recipient: binding?.recipient ?? null,
            claimTxHash: binding?.claimTxHash ?? null,
          };
        }),
    );

    return c.json({ claims, unavailable, freshLoginSecondsLeft });
  });

  return routes;
}
