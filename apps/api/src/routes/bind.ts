/**
 * `POST /api/drops/:address/bind` — a receiver of a handle drop says where to be paid. Handle
 *
 * No wallet connect and no wallet signature: the X login is the only proof.
 * So the order below is the security of the flow:
 *
 *  1. a live session and its CSRF pair, rate limited per session
 *  2. a handle drop with a leaf for **this** X id, else `404 no_leaf`
 *  3. an X login from the last `BIND_FRESH_LOGIN_SECONDS`, 10 minutes, else
 *     `401 fresh_login_required`. A stolen 30 day cookie alone cannot bind
 *  4. a binder key for the chain, else `503 binder_not_configured`; and handle mode on for the
 *     chain, else `503 handle_mode_not_ready`: a binding signed while our
 *     binder is not live would only wait. The reason goes to the log, never the answer
 *  5. the pasted address in the chain's format, else `400 bad_address`
 *  6. no binding yet for this X id on this drop, else `409 already_bound`. One binding per X id
 *     per drop; a typo after the confirm screen is final. **One exception since
 *     ** a `failed` binding whose claim bit is still clear on chain may be bound again
 *  7. the drop `Active` on chain and inside its claim window, else `409 not_claimable`
 *  8. EVM: our digest equals the drop's own `bindingDigest`, else `500 chain_disagreed`
 *  9. sign, write the row as `bound`, and wake the `claim_handles` job so the claim goes out on
 *     the next poll, `src/worker/worker.ts`
 *
 * The response carries the binding, which is public: the drop will show it on chain anyway.
 */
import { evmBindingDigest } from "@dropchad/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bytesToHex, getAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import type { AppEnv } from "../app.js";
import { readSessionCookie } from "../auth/cookies.js";
import { handleModeStatus } from "../binder/handle-mode.js";
import { BadRecipientError, parseRecipient } from "../binder/recipient.js";
import { canonicalAddress, looksLikeDropAddress } from "../chain/address.js";
import { dropHandleLeaves, drops, handleBindings } from "../db/schema.js";
import { clientIp, rateLimit } from "../middleware/rate-limit.js";
import { enqueueJob, wakeJob } from "../worker/queue.js";
import { requireSessionAndCsrf } from "../middleware/require-auth.js";

const body = z.object({ recipient: z.string().min(1).max(128) }).strict();

/** 1 is `Active` on both chains. */
const STATUS_ACTIVE = 1;

export function createBindRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.use(
    "/:address/bind",
    rateLimit({ limit: 10, windowSeconds: 60, keyOf: (c) => readSessionCookie(c) ?? clientIp(c) }),
  );

  routes.post("/:address/bind", async (c) => {
    const { db, config, now, writeSides, binders } = c.var.deps;

    // --- 1 ---------------------------------------------------------------------------------
    const auth = await requireSessionAndCsrf(c);
    if (auth.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
    if (auth.kind === "csrf_failed") return c.json({ error: "csrf_failed" }, 403);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = body.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    // --- 2 ---------------------------------------------------------------------------------
    const param = c.req.param("address");
    if (!looksLikeDropAddress(param)) return c.json({ error: "no_leaf" }, 404);
    const address = canonicalAddress(param);
    const [drop] = await db.select().from(drops).where(eq(drops.address, address)).limit(1);
    if (drop?.mode !== "handle") return c.json({ error: "no_leaf" }, 404);
    const xUserId = auth.session.xUserId;
    const [leaf] = await db
      .select()
      .from(dropHandleLeaves)
      .where(and(eq(dropHandleLeaves.dropAddress, address), eq(dropHandleLeaves.xUserId, xUserId)))
      .limit(1);
    if (leaf === undefined) return c.json({ error: "no_leaf" }, 404);

    // --- 3 ---------------------------------------------------------------------------------
    const nowDate = now();
    const loginAgeMs = nowDate.getTime() - auth.session.loggedInAt.getTime();
    if (loginAgeMs > config.BIND_FRESH_LOGIN_SECONDS * 1000) {
      return c.json(
        {
          error: "fresh_login_required",
          message: "sign in with X again, a bind needs a login from the last 10 minutes",
        },
        401,
      );
    }

    // --- 4 ---------------------------------------------------------------------------------
    const chain = writeSides?.get(drop.chainKey);
    if (chain === undefined) return c.json({ error: "chain_not_configured" }, 503);
    const binder = chain.family === "evm" ? binders?.evm : binders?.svm;
    if (binder === undefined) return c.json({ error: "binder_not_configured" }, 503);
    const mode = await handleModeStatus(chain, binders);
    if (!mode.on) {
      console.warn(`bind refused on ${chain.chainKey}: handle mode off, ${mode.reason}`);
      return c.json({ error: "handle_mode_not_ready" }, 503);
    }

    // --- 5 ---------------------------------------------------------------------------------
    let recipient: string;
    try {
      recipient = parseRecipient(chain.family, parsed.data.recipient);
    } catch (error) {
      const message = error instanceof BadRecipientError ? error.message : "bad address";
      return c.json({ error: "bad_address", message }, 400);
    }

    // --- 6 ---------------------------------------------------------------------------------
    const existing = await bindingOf(db, address, xUserId);
    let rebind = false;
    if (existing !== null) {
      if (existing.state !== "failed") {
        return c.json({ error: "already_bound", recipient: existing.recipient }, 409);
      }
      // only while the bit is clear. The old signature stays valid until the leaf is
      // claimed, so a bit set here means the leaf is paid, by us or by anyone holding it.
      const claimed = await chain.readClaimed(drop.address, [existing.leafIndex]);
      if (claimed.has(existing.leafIndex)) {
        return c.json({ error: "already_bound", recipient: existing.recipient }, 409);
      }
      rebind = true;
    }

    // --- 7 ---------------------------------------------------------------------------------
    const onChain = await chain.readDrop(drop.address);
    const nowSeconds = BigInt(Math.floor(nowDate.getTime() / 1000));
    if (onChain.status !== STATUS_ACTIVE || onChain.claimDeadline <= nowSeconds) {
      return c.json({ error: "not_claimable" }, 409);
    }

    // --- 8 and 9 ---------------------------------------------------------------------------
    const xId = BigInt(xUserId);
    let signature: Hex;
    if (chain.family === "evm" && binders?.evm !== undefined) {
      const args = {
        drop: getAddress(drop.address),
        chainId: drop.chainId,
        index: leaf.leafIndex,
        xId,
        recipient: recipient as Address,
      };
      if (chain.bindingDigest !== undefined) {
        const ours = evmBindingDigest(args);
        const theirs = await chain.bindingDigest(drop.address, leaf.leafIndex, xId, recipient);
        if (ours.toLowerCase() !== theirs.toLowerCase()) {
          return c.json(
            { error: "chain_disagreed", message: `bindingDigest is ${theirs}, we built ${ours}` },
            500,
          );
        }
      }
      signature = await binders.evm.sign(args);
    } else if (binders?.svm !== undefined) {
      signature = bytesToHex(
        binders.svm.sign({
          drop: drop.address,
          chainId: drop.chainId,
          index: leaf.leafIndex,
          xId,
          recipient,
        }),
      );
    } else {
      return c.json({ error: "binder_not_configured" }, 503);
    }

    if (rebind) {
      // Only a row still `failed` is replaced, so two rebinds at once cannot both win.
      const replaced = await db
        .update(handleBindings)
        .set({
          recipient,
          binderSignature: signature,
          state: "bound",
          claimTxHash: null,
          lastError: null,
          updatedAt: nowDate,
        })
        .where(
          and(
            eq(handleBindings.dropAddress, address),
            eq(handleBindings.xUserId, xUserId),
            eq(handleBindings.state, "failed"),
          ),
        )
        .returning({ recipient: handleBindings.recipient });
      if (replaced.length === 0) {
        const winner = await bindingOf(db, address, xUserId);
        return c.json({ error: "already_bound", recipient: winner?.recipient ?? null }, 409);
      }
    } else {
      try {
        await db.insert(handleBindings).values({
          dropAddress: address,
          leafIndex: leaf.leafIndex,
          xUserId,
          recipient,
          binderSignature: signature,
          state: "bound",
          createdAt: nowDate,
          updatedAt: nowDate,
        });
      } catch (error) {
        // Two binds at once for one leaf: the primary key and the unique index let one win.
        const winner = await bindingOf(db, address, xUserId);
        if (winner !== null) {
          return c.json({ error: "already_bound", recipient: winner.recipient }, 409);
        }
        throw error;
      }
    }

    // The claim goes out on the next poll. `enqueueJob` covers a drop activated before 16a.
    await enqueueJob(db, { dropAddress: address, kind: "claim_handles", runAfter: nowDate });
    await wakeJob(db, { dropAddress: address, kind: "claim_handles", now: nowDate });

    return c.json(
      {
        binding: {
          drop: drop.address,
          chainKey: drop.chainKey,
          index: leaf.leafIndex,
          xId: xUserId,
          recipient,
          signature,
          binder: chain.family === "evm" ? binders?.evm?.address : binders?.svm?.publicKey,
        },
      },
      201,
    );
  });

  return routes;
}

async function bindingOf(
  db: AppEnv["Variables"]["deps"]["db"],
  address: string,
  xUserId: string,
): Promise<{ recipient: string; state: string; leafIndex: number } | null> {
  const [row] = await db
    .select({
      recipient: handleBindings.recipient,
      state: handleBindings.state,
      leafIndex: handleBindings.leafIndex,
    })
    .from(handleBindings)
    .where(and(eq(handleBindings.dropAddress, address), eq(handleBindings.xUserId, xUserId)))
    .limit(1);
  return row ?? null;
}
