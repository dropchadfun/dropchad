/**
 * The drops api. Read and, since the write side landed, create.
 *
 * `GET  /api/drops`                    newest drops
 * `GET  /api/drops/:address`           one drop, its claims and its history
 * `GET  /api/drops/:address/manifest`  the canonical manifest bytes
 * `GET  /api/drops/:address/live`      Server Sent Events for the live rain
 * `GET  /api/drops/:address/share`     the share card facts, the sender only
 * `POST /api/drops`                    create a drop. Signed in, CSRF checked, relayer sent
 * `GET  /api/stats`                    dropped total per chain, in coin and in frozen usd, drop count, unique receivers
 *
 * `GET /api/drops` and `GET /api/drops/:address` carry **our** side next to the indexed side:
 * the title, the meme picture, the chad behind the drop, and how far the relayer got. Under its
 * own key, never blended in. `src/drops/card.ts`.
 *
 * The only price is the one frozen on a drop at activation, and `/api/stats` sums
 * it the way the boards do. decide what the numbers mean, and
 * `/api/stats` says `"finality": "final"` in its own response so a caller cannot mistake it for
 * live data.
 *
 * The read routes forward to the indexer. See `src/indexer/client.ts` for why.
 *
 * **Two chains, one route.** `POST /api/drops` takes a `chain` key from `packages/chains`; absent,
 * it means the default chain, Robinhood testnet, so every existing caller is unchanged. Addresses
 * are validated by the adapter for that chain, and a drop address in a path may be a `0x` address
 * or a base58 public key.
 */
import { findChain, getChain } from "@dropchad/chains";
import { MAX_LEAVES, isPubkey } from "@dropchad/shared";
import { eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { isAddress, keccak256, toHex } from "viem";
import { z } from "zod";

import { readSessionCookie } from "../auth/cookies.js";
import { readSession } from "../auth/session.js";
import { canonicalAddress, isEvmAddressText, looksLikeDropAddress } from "../chain/address.js";
import type { ChainAdapter } from "../chain/adapter.js";
import { chainFilter, filterIncludes } from "../chain/filter.js";
import {
  GasBudgetExceededError,
  GasCapExceededError,
  RelayerRefusedError,
  TransactionRevertedError,
} from "../chain/relayer.js";
import {
  ComputeCapExceededError,
  SimulationFailedError,
  TransactionExpiredError,
  TransactionFailedError,
} from "../chain/svm/relayer.js";
import { drops, profiles } from "../db/schema.js";
import { ownDropCard, type OwnDropCard } from "../drops/card.js";
import { fedFor, paidIndexesOf } from "../drops/fed.js";
import { boardProfile, type BoardProfile } from "../boards/compute.js";
import { countHandleDrops, evmBoardRows } from "../boards/load.js";
import {
  CreateInputError,
  CreateRateLimitedError,
  EventMismatchError,
  FeeTooHighError,
  HandleModeNotReadyError,
  HandlesNotFoundError,
  InvalidAssetError,
  OwnHandleError,
  PredictionMismatchError,
  TokenCheckUnavailableError,
  TokenRefusedError,
  TokenTooManyError,
  createDrop,
} from "../drops/create.js";
import { parseTokenFeeTiers } from "../drops/token-fee.js";
import { HandleResolveError, resolveHandles } from "../x/resolver.js";
import {
  BelowMinUsdError,
  FeeBelowGasError,
  PriceUnavailableError,
  minReceiverUsd,
} from "../drops/fee-guards.js";
import { fundingWarnings } from "../drops/payment.js";
import { handleDropList, solanaBoardDrops, tileStats, type ReadDeps } from "../drops/read.js";
import { SHARE_READY_STATES, shareCardFor } from "../drops/share.js";
import { fundingOf, tokenInfoOf, unitOfDrop } from "../drops/token-info.js";
import { IndexerUnavailableError, type BoardDrop } from "../indexer/client.js";
import { requireSessionAndCsrf } from "../middleware/require-auth.js";
import { dropLiveHandler } from "./live.js";
import type { AppEnv } from "../app.js";

/**
 * A drop address in a path: a 20 byte hex address, stored lowercase, or a base58 public key,
 * stored as written. Checked here so a junk path never reaches a query or the indexer.
 */
const addressParam = z.object({
  address: z
    .string()
    .refine(looksLikeDropAddress, "must be a 0x address or a base58 public key")
    .transform(canonicalAddress),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** A pill key, a chain key, or `all`. */
  chain: z.string().min(1).max(40).default("all"),
});

const statsQuery = z.object({
  chain: z.string().min(1).max(40).default("all"),
});

/** The read deps of `src/drops/read.ts`, from the app's. */
function readDeps(c: Context<AppEnv>): ReadDeps {
  const { db, indexer, solanaReader, config } = c.var.deps;
  return { db, indexer, solana: solanaReader, indexerChainKey: config.CHAIN_KEY };
}

/** Shape only. The adapter for the chosen chain decides whether it is an address of its family. */
const anyAddress = z
  .string()
  .min(1)
  .max(64)
  .refine(looksLikeDropAddress, "must be a 0x address or a base58 public key");

/**
 * Base units, as a decimal string: wei, or lamports. JSON has no bigint, so a number here would
 * silently lose precision.
 */
const baseUnitAmount = z
  .string()
  // One check, not a regex plus a refine: in zod both run, and `BigInt("0.5")` throws rather
  // than failing, which would turn a bad request into a 500.
  .refine((value) => /^[0-9]+$/.test(value) && BigInt(value) > 0n, {
    message: "amount must be a whole number of base units above zero, written as digits",
  });

/**
 * The create body.
 *
 * `receivers` is capped at `MAX_LEAVES` **before** duplicates are merged as well as after, so a
 * hundred thousand line paste is refused at the door instead of being hashed first.
 */
const createBody = z
  .object({
    /**
     * Required. `handle`: X handles, the product. `address`: the
     * multisend tool. No default, so no client makes one by accident.
     */
    mode: z.enum(["address", "handle"]),
    /** A `packages/chains` key. Absent means the api's default chain, Robinhood testnet. */
    chain: z.string().min(1).max(40).optional(),
    /**
     * `"native"`, or a mint for a Solana token drop in handle mode. Checked against the
     * chain and the mode below. ERC20 drops are blocked on.
     */
    asset: z.string().min(1).max(64).default("native"),
    /** Address mode only. */
    receivers: z
      .array(z.object({ address: anyAddress, amount: baseUnitAmount }))
      .min(1, "a drop needs at least one receiver")
      .max(MAX_LEAVES)
      .optional(),
    /** Handle mode only. The 500 cap is the resolver's; this bound only stops a huge paste. */
    handles: z
      .array(z.object({ handle: z.string().min(1).max(64), amount: baseUnitAmount }))
      .min(1, "a drop needs at least one handle")
      .max(MAX_LEAVES)
      .optional(),
    /**
     * Where unclaimed funds go after the claim deadline. Explicit, never guessed: the creator has
     * no wallet, so there is nothing to default to.
     */
    refundRecipient: anyAddress,
    title: z.string().trim().min(1).max(80).optional(),
    /** Ours only, never on chain and never in the manifest. */
    memeImageUrl: z
      .string()
      .url()
      .refine((value) => URL.parse(value)?.protocol === "https:", {
        message: "must be an https:// url",
      })
      .optional(),
  })
  .superRefine((body, ctx) => {
    // a drop is one mode. Each mode takes its own list and never the other.
    if (body.mode === "address" && (body.receivers === undefined || body.handles !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["receivers"],
        message: "address mode takes receivers and no handles",
      });
    }
    if (body.mode === "handle" && (body.handles === undefined || body.receivers !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["handles"],
        message: "handle mode takes handles and no receivers",
      });
    }
  });

export function createDropRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  routes.post("/", async (c) => {
    const deps = c.var.deps;

    // No key, no write side. The read side keeps working, which is what lets the test suite and a
    // read only deployment run with no key anywhere near them.
    if (deps.writeSides === undefined) {
      return c.json(
        {
          error: "relayer_not_configured",
          message: "This api has no relayer key, so it cannot create drops.",
        },
        503,
      );
    }

    const auth = await requireSessionAndCsrf(c);
    if (auth.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
    if (auth.kind === "csrf_failed") return c.json({ error: "csrf_failed" }, 403);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const parsed = createBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_body",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    // Which chain. Absent means the default, which is the EVM chain when one is configured.
    const chainKey = parsed.data.chain ?? deps.writeSides.defaultKey;
    const chain: ChainAdapter | undefined = deps.writeSides.get(chainKey);
    if (chain === undefined) return chainUnavailable(c, chainKey);

    // a token drop is on a chain with token drops (Solana, and Robinhood once
    // `DropFactoryV3` is recorded), handle mode and a real address, before anything else.
    const asset = parsed.data.asset;
    if (asset !== "native") {
      if (chain.tokenVault === undefined) {
        return c.json(
          { error: "invalid_asset", message: `no token drops on ${chain.chainName} yet` },
          400,
        );
      }
      if (parsed.data.mode !== "handle") {
        return c.json(
          { error: "invalid_asset", message: "a token drop is an X handle drop for now" },
          400,
        );
      }
      if (chain.family === "evm" ? !isAddress(asset, { strict: false }) : !isPubkey(asset)) {
        return c.json(
          { error: "invalid_asset", message: 'asset must be "native" or a mint address' },
          400,
        );
      }
    }

    // The same shape check the adapter will do, done here so a wrong family is a 400 with the
    // field named, not a 500 from deep inside the create flow.
    const wrongFamily = [
      ...(parsed.data.receivers ?? []).map((r, i) => ({
        path: `receivers.${String(i)}.address`,
        value: r.address,
      })),
      { path: "refundRecipient", value: parsed.data.refundRecipient },
    ].filter(({ value }) => isEvmAddressText(value) !== (chain.family === "evm"));
    if (wrongFamily.length > 0) {
      return c.json(
        {
          error: "invalid_body",
          issues: wrongFamily.map(({ path }) => ({
            path,
            message: `must be a ${chain.family === "evm" ? "0x address" : "base58 public key"} on ${chain.chainName}`,
          })),
        },
        400,
      );
    }

    try {
      const created = await createDrop(
        {
          db: deps.db,
          chain,
          now: deps.now,
          prices: deps.prices,
          minReceiverUsd: minReceiverUsd(deps.config, getChain(chain.chainKey)),
          binders: deps.binders,
          randomBlind: deps.randomBlind,
          // the chain's own check, Solana or Robinhood.
          checkToken: ((checker) =>
            checker === undefined ? undefined : (mint: string) => checker.check(mint))(
            chain.family === "evm" ? deps.evmTokenChecker : deps.tokenChecker,
          ),
          tokenFeeTiers: parseTokenFeeTiers(deps.config.TOKEN_FEE_TIERS_USD),
          resolve: (handles) =>
            resolveHandles({
              db: deps.db,
              now: deps.now(),
              fetchImpl: deps.xFetch ?? fetch,
              bearerToken: deps.config.X_BEARER_TOKEN,
              maxHandles: deps.config.HANDLE_MAX_RECEIVERS,
              dailyMax: deps.config.HANDLE_LOOKUPS_DAILY_MAX,
              handles,
            }),
        },
        {
          xUserId: auth.session.xUserId,
          mode: parsed.data.mode,
          receivers: parsed.data.receivers?.map((receiver) => ({
            recipient: receiver.address,
            amount: BigInt(receiver.amount),
          })),
          handles: parsed.data.handles?.map((line) => ({
            handle: line.handle,
            amount: BigInt(line.amount),
          })),
          refundRecipient: parsed.data.refundRecipient,
          title: parsed.data.title,
          memeImageUrl: parsed.data.memeImageUrl,
          asset,
        },
      );

      return c.json(
        {
          drop: {
            address: created.address,
            chainKey: created.chainKey,
            chainId: created.chainId,
            family: created.family,
            mode: created.mode,
            asset: created.asset,
            assetKind: created.assetKind,
            merkleRoot: created.merkleRoot,
            manifestHash: created.manifestHash,
            manifestUrl: `/api/drops/${canonicalAddress(created.address)}/manifest`,
            totalEntitlementsWei: created.totalEntitlementsWei,
            feeAmountWei: created.feeAmountWei,
            grossRequiredWei: created.grossRequiredWei,
            leafCount: created.leafCount,
            refundRecipient: created.refundRecipient,
            claimPeriodSeconds: created.claimPeriodSeconds,
            title: created.title,
            memeImageUrl: created.memeImageUrl,
            createTxHash: created.createTxHash,
          },
          funding: created.funding,
          warnings: fundingWarnings({
            refundRecipient: created.refundRecipient,
            amountDisplay: created.funding.amountDisplay,
            symbol: created.funding.symbol,
            chainName: chain.chainName,
            mode: created.mode,
          }),
        },
        201,
      );
    } catch (error) {
      return createError(c, error);
    }
  });

  // ---------------------------------------------------------------------------
  // read
  // ---------------------------------------------------------------------------
  routes.get("/", async (c) => {
    const parsed = listQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const filter = chainFilter(parsed.data.chain);
    if (filter === undefined) return c.json({ error: "invalid_query" }, 400);
    const deps = readDeps(c);

    // Our handle drops only, both chains. A multisend is on no public list.
    let merged;
    try {
      merged = await handleDropList(deps, filter, parsed.data.limit);
    } catch (error) {
      return indexerError(c, error);
    }

    // Our side, keyed by address. Every entry is one of ours now, so a card is always there.
    const cards = await ownCardsFor(
      c,
      merged.drops.map((entry) => entry.address),
    );
    return c.json({
      limit: parsed.data.limit,
      chain: filter.key,
      sources: merged.sources,
      drops: merged.drops.map((entry) => ({
        ...entry,
        dropchad: cards.get(canonicalAddress(entry.address)) ?? null,
      })),
    });
  });

  /**
   * The manifest.
   *
   * The body is the **exact canonical bytes** the hash was taken over, with no envelope around
   * them, so `keccak256(body)` equals the `manifestHash` stored in the drop and anybody can check
   * that for themselves with no knowledge of our api. The hash is in a header instead, and the
   * route recomputes it from the stored bytes rather than trusting the stored hash column.
   */
  routes.get("/:address/manifest", async (c) => {
    const parsed = addressParam.safeParse({ address: c.req.param("address") });
    if (!parsed.success) return c.json({ error: "invalid_address" }, 400);

    const rows = await c.var.deps.db
      .select({ manifestJson: drops.manifestJson })
      .from(drops)
      .where(eq(drops.address, parsed.data.address))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return c.json({ error: "not_found" }, 404);

    return c.body(row.manifestJson, 200, {
      "content-type": "application/json; charset=utf-8",
      "x-dropchad-manifest-hash": keccak256(toHex(row.manifestJson)),
    });
  });

  /**
   * The share card, first version . Handle drops only,
   * the sender only, once the drop is funded and live. The facts only: the browser draws the card
   * and writes the post, so no text, link or image goes out from here.
   */
  routes.get("/:address/share", async (c) => {
    const parsed = addressParam.safeParse({ address: c.req.param("address") });
    if (!parsed.success) return c.json({ error: "invalid_address" }, 400);

    const rows = await c.var.deps.db
      .select()
      .from(drops)
      .where(eq(drops.address, parsed.data.address))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return c.json({ error: "not_found" }, 404);
    // A multisend has no share card. Only a handle drop is shared.
    if (row.mode !== "handle") return c.json({ error: "no_share_card" }, 404);

    // The card is the sender's.
    const viewer = await sessionXUserId(c);
    if (viewer === null) return c.json({ error: "unauthorized" }, 401);
    if (viewer !== row.xUserId) return c.json({ error: "not_yours" }, 403);
    // Ready once funded and live, never at the end: the post tells the receivers.
    if (!SHARE_READY_STATES.includes(row.state)) return c.json({ error: "not_live" }, 409);

    // A token drop is drawn in its token: the ticker (or the short mint) and
    // its decimals, and the token object for the logo.
    return c.json({
      ...(await shareCardFor(c.var.deps.db, row, unitOfDrop(row, symbolFor(row.chainKey)))),
      token: tokenInfoOf(row),
    });
  });

  /** The live stream the rain reads. See `src/routes/live.ts`. */
  routes.get("/:address/live", async (c) => {
    const parsed = addressParam.safeParse({ address: c.req.param("address") });
    if (!parsed.success) return c.json({ error: "invalid_address" }, 400);
    return dropLiveHandler(c, parsed.data.address);
  });

  /**
   * One drop, from both sides, **always labelled**.
   *
   * `chain` is what the indexer saw happen. It is the source of truth.
   * `ours` is our own intent and how far the relayer got. They are never added together and never
   * blended into one number, because they answer different questions: "what happened" and "what
   * are we doing about it".
   *
   * The two can disagree honestly. A drop created a second ago is in `ours` and not yet in
   * `chain`, and that is the indexer being a few blocks behind, not an error.
   */
  routes.get("/:address", async (c) => {
    const parsed = addressParam.safeParse({ address: c.req.param("address") });
    if (!parsed.success) return c.json({ error: "invalid_address" }, 400);
    const address = parsed.data.address;

    const rows = await c.var.deps.db
      .select()
      .from(drops)
      .where(eq(drops.address, address))
      .limit(1);
    const ours = rows[0];

    // A base58 address is a Solana drop and the indexer knows nothing about it. It is either one
    // of ours, read back from the cluster below, or nothing.
    const onSolana = !isEvmAddressText(address);
    let indexed: unknown = null;
    let indexerAvailable = true;
    if (!onSolana) {
      try {
        indexed = await c.var.deps.indexer.getDrop(address);
      } catch (error) {
        if (!(error instanceof IndexerUnavailableError)) throw error;
        indexerAvailable = false;
      }
    }

    if (ours === undefined) {
      if (onSolana) return c.json({ error: "not_found" }, 404);
      // We did not create it. Then the indexer is the only thing that can answer at all.
      if (!indexerAvailable) return c.json({ error: "indexer_unavailable" }, 503);
      if (indexed === null) return c.json({ error: "not_found" }, 404);
    }

    // No api door names the sender of a multisend: not even to the sender, who
    // learns it is theirs from `yours`. A handle drop is public.
    const creator =
      ours === undefined || ours.mode !== "handle" ? null : await creatorFor(c, ours.xUserId);
    const yours = ours === undefined ? false : (await sessionXUserId(c)) === ours.xUserId;
    const chain = await chainSideFor(c, address, ours, indexed, indexerAvailable);
    // Who got fed, by handle: the paid indexes are the chain's, never our own.
    const fed =
      ours === undefined || ours.mode !== "handle"
        ? null
        : await fedFor(c.var.deps.db, ours.address, paidIndexesOf(chain["data"]));

    return c.json({
      address,
      chain,
      ours: {
        source: "dropchad_api",
        known: ours !== undefined,
        data:
          ours === undefined
            ? null
            : {
                creator,
                yours,
                chainId: ours.chainId,
                chainKey: ours.chainKey,
                asset: ours.asset,
                // A token drop's token; `null` on a SOL or ETH drop.
                token: tokenInfoOf(ours),
                // While it waits for money, the same funding as the create answer: a
                // reload never builds the card from the token total. `null` after that.
                funding: fundingFor(c, ours),
                // `handle` counts and gets a card; `address` is a multisend.
                mode: ours.mode,
                state: ours.state,
                paidCount: ours.paidCount,
                leafCount: ours.leafCount,
                failedIndexes: ours.failedIndexes,
                nextClaimIndex: ours.nextClaimIndex,
                merkleRoot: ours.merkleRoot,
                manifestHash: ours.manifestHash,
                manifestUrl: `/api/drops/${address}/manifest`,
                totalEntitlementsWei: ours.totalEntitlements,
                feeAmountWei: ours.feeAmount,
                grossRequiredWei: ours.grossRequired,
                refundRecipient: ours.refundRecipient,
                fundingDeadline: ours.fundingDeadline.toString(),
                claimPeriodSeconds: ours.claimPeriod,
                title: ours.title,
                memeImageUrl: ours.memeImageUrl,
                createTxHash: ours.createTxHash,
                activateTxHash: ours.activateTxHash,
                lastTxHash: ours.lastTxHash,
                lastError: ours.lastError,
                createdAt: ours.createdAt.toISOString(),
                updatedAt: ours.updatedAt.toISOString(),
                fed,
              },
      },
    });
  });

  return routes;
}

export function createStatsRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  /**
   * `GET /api/stats?chain=all|<key>`. Handle drops only: the same counted
   * rows as the boards, the indexer's final rows for the EVM chain and the cluster read at
   * `finalized` for Solana, so the front page number is the number the boards rank. Never the
   * indexer's `/stats`, which counts every drop. Coins are never added together: `totals` is per
   * chain, the top level keeps the wei field it always had plus the unit free counts.
   * `src/drops/read.ts`.
   */
  routes.get("/", async (c) => {
    const parsed = statsQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const filter = chainFilter(parsed.data.chain);
    if (filter === undefined) return c.json({ error: "invalid_query" }, 400);
    const deps = readDeps(c);
    const { db, indexer, now, solanaReader } = c.var.deps;

    const evmInScope = filter.families.has("evm") && filterIncludes(filter, deps.indexerChainKey);
    let evmRows: BoardDrop[];
    try {
      evmRows = await evmBoardRows(
        { db, indexer, now, indexerChainKey: deps.indexerChainKey, solana: solanaReader },
        filter,
        null,
      );
    } catch (error) {
      return indexerError(c, error);
    }

    // A Solana cluster that is down marks its tile unavailable; the EVM numbers still stand.
    const solanaChainKey =
      deps.solana !== undefined &&
      filter.families.has("svm") &&
      filterIncludes(filter, deps.solana.chainKey)
        ? deps.solana.chainKey
        : null;
    let solanaRows: BoardDrop[] = [];
    let solanaAvailable = true;
    if (solanaChainKey !== null) {
      try {
        solanaRows = await solanaBoardDrops(deps, filter, null);
      } catch (error) {
        console.error("solana stats unavailable", error);
        solanaAvailable = false;
      }
    }

    const counted = await countHandleDrops(db, [...evmRows, ...solanaRows], deps.indexerChainKey);
    return c.json(
      tileStats(counted, filter, {
        evmChainKey: evmInScope ? deps.indexerChainKey : null,
        solanaChainKey,
        solanaAvailable,
      }),
    );
  });

  return routes;
}

/**
 * The chain's side of one drop: the indexer for an EVM address, the cluster for a Solana one.
 * Both are labelled with their source, and both can be honestly unavailable.
 */
async function chainSideFor(
  c: Context<AppEnv>,
  address: string,
  ours: typeof drops.$inferSelect | undefined,
  indexed: unknown,
  indexerAvailable: boolean,
): Promise<Record<string, unknown>> {
  if (isEvmAddressText(address)) {
    return {
      source: "indexer",
      available: indexerAvailable,
      indexed: indexed !== null,
      data: indexed,
    };
  }
  const reader = c.var.deps.solanaReader;
  if (reader === undefined || ours === undefined) {
    return { source: "rpc", available: false, indexed: false, data: null };
  }
  try {
    const [drop, claims] = await Promise.all([
      reader.indexedDrop(ours, "confirmed"),
      reader.claims(ours, "confirmed"),
    ]);
    return {
      source: "rpc",
      available: true,
      indexed: drop !== null,
      data: drop === null ? null : { drop, claims, events: [] },
    };
  } catch (error) {
    console.error("solana read side unavailable", error);
    return { source: "rpc", available: false, indexed: false, data: null };
  }
}

/** The funding answer while the drop is `created`, else `null`; `null` with no write side. */
function fundingFor(c: Context<AppEnv>, row: typeof drops.$inferSelect) {
  if (row.state !== "created") return null;
  const chain = c.var.deps.writeSides?.get(row.chainKey);
  return chain === undefined ? null : fundingOf(row, chain);
}

/** The coin a drop row is counted in, from the registry. `ETH` and 18 when the key is unknown. */
function symbolFor(chainKey: string): { symbol: string; decimals: number } {
  const chain = findChain(chainKey);
  if (chain === undefined) return { symbol: "ETH", decimals: 18 };
  return { symbol: chain.nativeSymbol, decimals: chain.family === "svm" ? 9 : 18 };
}

/** Our cards for these addresses, with the chad behind each. Two queries, whatever the count. */
async function ownCardsFor(
  c: Context<AppEnv>,
  addresses: readonly string[],
): Promise<Map<string, OwnDropCard>> {
  const out = new Map<string, OwnDropCard>();
  if (addresses.length === 0) return out;
  const db = c.var.deps.db;

  const rows = await db
    .select()
    .from(drops)
    .where(inArray(drops.address, addresses.map(canonicalAddress)));
  if (rows.length === 0) return out;

  const people = await db
    .select({
      xUserId: profiles.xUserId,
      handle: profiles.handle,
      displayName: profiles.displayName,
      profileImageUrl: profiles.profileImageUrl,
      kind: profiles.kind,
      tags: profiles.tags,
      tagSetAt: profiles.tagSetAt,
    })
    .from(profiles)
    .where(inArray(profiles.xUserId, [...new Set(rows.map((row) => row.xUserId))]));
  const byId = new Map(people.map((person) => [person.xUserId, boardProfile(person)] as const));

  for (const row of rows) out.set(row.address, ownDropCard(row, byId.get(row.xUserId) ?? null));
  return out;
}

/**
 * The X id of the session cookie on this request, or `null`. Signed out, a junk cookie and an
 * expired session are all simply `null`: a read route never fails on a cookie.
 */
async function sessionXUserId(c: Context<AppEnv>): Promise<string | null> {
  const sessionId = readSessionCookie(c);
  if (sessionId === undefined) return null;
  const { db, config, now } = c.var.deps;
  const session = await readSession(db, {
    secret: config.SESSION_SECRET,
    sessionId,
    now: now(),
  });
  return session?.xUserId ?? null;
}

async function creatorFor(c: Context<AppEnv>, xUserId: string): Promise<BoardProfile | null> {
  const rows = await c.var.deps.db
    .select({
      xUserId: profiles.xUserId,
      handle: profiles.handle,
      displayName: profiles.displayName,
      profileImageUrl: profiles.profileImageUrl,
      kind: profiles.kind,
      tags: profiles.tags,
      tagSetAt: profiles.tagSetAt,
    })
    .from(profiles)
    .where(eq(profiles.xUserId, xUserId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : boardProfile(row);
}

/**
 * What a failed create looks like from outside.
 *
 * Every branch is a code the frontend can act on. The two relayer limits are `503`, because they
 * are temporary by nature: a budget resets at midnight UTC and a gas spike passes. The mismatch
 * errors are `500` and carry their message, which holds only public values — addresses, hashes
 * and amounts that are already on chain.
 */
function createError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof CreateRateLimitedError) {
    c.header("retry-after", String(error.retryAfterSeconds));
    return c.json(
      { error: "rate_limited", retryAfterSeconds: error.retryAfterSeconds, message: error.message },
      429,
    );
  }
  if (error instanceof CreateInputError) {
    return c.json({ error: "invalid_receivers", message: error.message }, 400);
  }
  // Handle mode., then the resolver's own refusals.
  if (error instanceof HandlesNotFoundError) {
    return c.json({ error: "handles_not_found", handles: error.handles }, 400);
  }
  if (error instanceof OwnHandleError) {
    return c.json({ error: "own_handle", message: error.message }, 400);
  }
  if (error instanceof HandleModeNotReadyError) {
    return c.json({ error: "handle_mode_not_ready", message: error.message }, 503);
  }
  if (error instanceof HandleResolveError) {
    switch (error.code) {
      case "bad_handle":
        return c.json({ error: "bad_handle", handles: error.handles }, 400);
      case "too_many":
        return c.json({ error: "too_many", message: error.message }, 400);
      case "daily_cap":
        return c.json({ error: "daily_cap" }, 429);
      case "not_configured":
        return c.json({ error: "handle_lookup_not_configured" }, 503);
      case "x_unavailable":
        return c.json({ error: "x_unavailable" }, 502);
    }
  }
  // Token drops.
  if (error instanceof InvalidAssetError) {
    return c.json({ error: "invalid_asset", message: error.message }, 400);
  }
  if (error instanceof TokenRefusedError) {
    return c.json({ error: "token_refused", reason: error.reason, message: error.message }, 400);
  }
  if (error instanceof TokenCheckUnavailableError) {
    const which = error.family === "evm" ? "robinhood_unavailable" : "solana_unavailable";
    return c.json({ error: which, message: error.message }, 503);
  }
  if (error instanceof TokenTooManyError) {
    return c.json({ error: "too_many", message: error.message }, 400);
  }
  if (error instanceof FeeTooHighError) {
    return c.json({ error: "fee_too_high", message: error.message }, 400);
  }
  // The fee guards. Every number is public.
  if (error instanceof PriceUnavailableError) {
    return c.json({ error: "price_unavailable", message: error.message }, 503);
  }
  if (error instanceof BelowMinUsdError) {
    return c.json(
      {
        error: "below_min_usd",
        minimum: error.minimum.toString(),
        minUsd: error.minUsd,
        priceUsd: error.priceUsd,
        symbol: error.symbol,
        message: error.message,
      },
      400,
    );
  }
  if (error instanceof FeeBelowGasError) {
    return c.json(
      {
        error: "fee_below_gas",
        fee: error.fee.toString(),
        estimate: error.estimate.toString(),
        gasPrice: error.unitPrice.toString(),
        message: error.message,
      },
      400,
    );
  }
  if (error instanceof GasBudgetExceededError) {
    return c.json({ error: "relayer_budget_exceeded", message: error.message }, 503);
  }
  if (error instanceof GasCapExceededError) {
    return c.json({ error: "gas_cap_exceeded", message: error.message }, 503);
  }
  if (error instanceof RelayerRefusedError) {
    return c.json({ error: "relayer_refused", message: error.message }, 500);
  }
  if (error instanceof TransactionRevertedError) {
    return c.json({ error: "create_reverted", message: error.message }, 502);
  }
  if (error instanceof PredictionMismatchError || error instanceof EventMismatchError) {
    return c.json({ error: "chain_disagreed", message: error.message }, 500);
  }
  // The Solana relayer's own refusals. Same reasoning as the EVM ones above: a compute cap is
  // temporary, a failed simulation carries the program's error name, an expiry is worth a retry.
  if (error instanceof ComputeCapExceededError) {
    return c.json({ error: "gas_cap_exceeded", message: error.message }, 503);
  }
  if (error instanceof SimulationFailedError) {
    return c.json({ error: "create_reverted", message: error.message }, 502);
  }
  if (error instanceof TransactionFailedError) {
    return c.json({ error: "create_reverted", message: error.message }, 502);
  }
  if (error instanceof TransactionExpiredError) {
    return c.json({ error: "create_expired", message: error.message }, 503);
  }
  throw error;
}

/**
 * The chain a caller named has no relayer in this process.
 *
 * For Solana the reason is spelled out: the config may not be initialised yet,
 * and the message names the script that fixes it. For any other key it is a plain unknown chain.
 */
function chainUnavailable(c: Context<AppEnv>, chainKey: string) {
  const solana = c.var.deps.solana;
  if (solana !== undefined && solana.chainKey === chainKey && solana.kind === "config_missing") {
    return c.json(
      {
        error: "solana_config_missing",
        message:
          `Solana drops cannot be created yet: the program's Config account is not initialised on ` +
          `${chainKey}. ${solana.detail}`,
      },
      503,
    );
  }
  return c.json(
    {
      error: "chain_not_configured",
      message: `This api has no relayer for chain "${chainKey}".`,
    },
    503,
  );
}

/**
 * An indexer that is down is a 503, not a 500.
 *
 * It says "come back", not "something broke in the api". The distinction matters to the frontend:
 * one is worth retrying, the other is not.
 */
function indexerError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof IndexerUnavailableError) {
    return c.json({ error: "indexer_unavailable" }, 503);
  }
  throw error;
}
