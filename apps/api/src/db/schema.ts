/**
 * Drizzle table definitions.
 *
 * These mirror `migrations/0001_init.sql`. The SQL is the source of truth — it is what actually
 * runs, on PGlite locally and on Postgres later — and this file is the typed view of it.
 * `test/db.test.ts` runs the migrations and round trips every column, so the two cannot drift
 * apart quietly.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  /** The numeric X user id, as text. Never the handle. */
  xUserId: text("x_user_id").primaryKey(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  profileImageUrl: text("profile_image_url"),
  /**
   * The sender's kind: `chad` | `kol` | `project`. NULL reads as `chad`, `boards/compute.ts`.
   * It is a label and proves nothing. Column from migration 0004. it is
   * derived from the first of `tags` on every `PATCH /api/me`, never an input,
   */
  kind: text("kind"),
  /**
   * One to three self picked tags, `PROFILE_TAGS` in `boards/compute.ts`, the main tag first:
   * the one rows and boards show. Empty is a profile that never picked; a saved set
   * is never emptied. Column from migration 0017. The old one tag column `tag` (0008) is still
   * in the SQL, never read or written, and is left out of this view on purpose.
   */
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** When `tags` was last saved. A change before 30 days later is refused, `routes/me.ts`. */
  tagSetAt: timestamp("tag_set_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** HMAC of the opaque session id. The id itself only exists in the cookie. */
    id: text("id").primaryKey(),
    xUserId: text("x_user_id")
      .notNull()
      .references(() => profiles.xUserId, { onDelete: "cascade" }),
    csrfTokenHash: text("csrf_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sessions_x_user_id_idx").on(table.xUserId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const oauthStates = pgTable(
  "oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    /** The PKCE verifier. Cannot be hashed, the token exchange needs the value back. */
    codeVerifier: text("code_verifier").notNull(),
    /** Binds the state to the browser that started the login. */
    preSessionHash: text("pre_session_hash").notNull(),
    /** Where the login returns, migration 0016: `/claim` or `/claim?drop=…`, else NULL. */
    nextPath: text("next_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("oauth_states_expires_at_idx").on(table.expiresAt)],
);

/**
 * Our own record of a drop: the intent, and how far the relayer got.
 *
 * **Not the truth about the chain.** The indexer is. This row says what
 * we asked for and what we have done about it; `GET /api/drops/:address` shows this next to the
 * indexed state and labels which is which.
 *
 * Amount columns are `NUMERIC(78, 0)` in **base units** — wei on an EVM chain, lamports on
 * Solana — and come back as decimal strings. `BigInt()` at the edge. The unit follows `chain_key`.
 */
export const drops = pgTable(
  "drops",
  {
    /**
     * The clone address, lowercase, or the drop PDA, base58 as written. Predicted, then
     * confirmed against `DropCreated` or the `Drop` account. `src/chain/address.ts`.
     */
    address: text("address").primaryKey(),
    chainId: integer("chain_id").notNull(),
    /** The `packages/chains` key. Migration 0005. Says which adapter owns the row. */
    chainKey: text("chain_key").notNull(),
    xUserId: text("x_user_id")
      .notNull()
      .references(() => profiles.xUserId, { onDelete: "restrict" }),

    /** Salt inputs, or the PDA seeds. The nonce is per X id. */
    nonce: bigint("nonce", { mode: "bigint" }).notNull(),
    creatorCommitment: text("creator_commitment").notNull(),
    /** The CREATE2 salt. `null` on Solana, where the seeds are the two columns above. */
    salt: text("salt"),

    /** `address(0)` or `Pubkey::default()` means the native coin. */
    asset: text("asset").notNull(),
    merkleRoot: text("merkle_root").notNull(),
    /** keccak256 of `manifestJson`. */
    manifestHash: text("manifest_hash").notNull(),
    /** The canonical bytes the hash was taken over. Served at `/api/drops/:address/manifest`. */
    manifestJson: text("manifest_json").notNull(),
    totalEntitlements: numeric("total_entitlements").notNull(),
    feeAmount: numeric("fee_amount").notNull(),
    grossRequired: numeric("gross_required").notNull(),
    leafCount: integer("leaf_count").notNull(),
    refundRecipient: text("refund_recipient").notNull(),
    /** Unix seconds, absolute. */
    fundingDeadline: bigint("funding_deadline", { mode: "bigint" }).notNull(),
    /** Seconds, relative. */
    claimPeriod: integer("claim_period").notNull(),

    /** Ours only. Never in the manifest and never in the hash. */
    title: text("title"),
    memeImageUrl: text("meme_image_url"),

    /** Our progress, not the chain's status. */
    state: text("state").notNull().default("created"),
    paidCount: integer("paid_count").notNull().default(0),
    /** Leaf indexes we could not pay. explains why one bad index must be isolated. */
    failedIndexes: jsonb("failed_indexes").$type<number[]>().notNull().default([]),
    /**
     * How far the payer has walked the leaves. A **position**, not a count: `paidCount` counts
     * `Claimed` events, and the two differ whenever a receiver claimed for themselves.
     */
    nextClaimIndex: integer("next_claim_index").notNull().default(0),

    createTxHash: text("create_tx_hash").notNull(),
    activateTxHash: text("activate_tx_hash"),
    lastTxHash: text("last_tx_hash"),
    /** The refund or the cancel, and the close. Solana only, migration 0006. */
    settleTxHash: text("settle_tx_hash"),
    closeTxHash: text("close_tx_hash"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /**
     * The claimed leaf indexes, copied from the bitmap at `finalized` before the settle job's
     * `refund` or `cancel_unfunded`, because `close_drop` deletes the bitmap. Solana only,
     * migration 0014. NULL is no copy, never "none claimed".
     */
    claimedIndexes: jsonb("claimed_indexes").$type<number[]>(),
    /**
     * Usd per whole coin when the drop activated, and when. Written once by the worker, never
     * again, migration 0009. NULL counts zero on the usd boards.
     */
    priceUsd: numeric("price_usd"),
    pricedAt: timestamp("priced_at", { withTimezone: true }),
    lastError: text("last_error"),
    /**
     * `address` or `handle`, migration 0010. The api's, never the chain's. Every drop
     * before handle mode is `address`; only `handle` counts on boards, profiles, rain and cards.
     */
    mode: text("mode").$type<"address" | "handle">().notNull().default("address"),
    /**
     * The secret of the commitment, migration 0015: `0x` and 64 lowercase hex.
     * `creatorCommitment = keccak256(abi.encode(xUserId, nonce, blind))`. NULL is a drop made
     * before 21b, with the unblinded commitment. **Never served, never logged**.
     */
    commitmentBlind: text("commitment_blind"),
    /**
     * A token drop, migration 0018. The mint is `asset`. The token program,
     * decimals, name and ticker as the token check read them at create (name and ticker are
     * untrusted text). `vault`, the SOL fee and the account budget are read back from the
     * `Drop` account; the usd tier and the SOL price are what the fee was worked out at.
     * All NULL on a native drop.
     */
    tokenProgram: text("token_program"),
    tokenDecimals: integer("token_decimals"),
    tokenName: text("token_name"),
    tokenSymbol: text("token_symbol"),
    /** Migration 0019: the token check's launchpad at create, `pump.fun` or NULL. */
    tokenLaunchpad: text("token_launchpad"),
    vault: text("vault"),
    solFeeLamports: numeric("sol_fee_lamports"),
    accountBudgetLamports: numeric("account_budget_lamports"),
    feeTierUsd: numeric("fee_tier_usd"),
    feeSolPriceUsd: numeric("fee_sol_price_usd"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("drops_x_user_created_idx").on(table.xUserId, table.createdAt),
    index("drops_state_idx").on(table.state),
    index("drops_chain_key_created_idx").on(table.chainKey, table.createdAt),
  ],
);

/**
 * The queue. A table, not pg-boss.
 *
 * pg-boss speaks the Postgres wire protocol and uses advisory locks and `LISTEN/NOTIFY`; PGlite
 * has no wire server, so pg-boss would force Docker Postgres into local dev today. All state here
 * is rows, so a restart resumes exactly where the worker stopped, including the backoff.
 */
export const dropJobs = pgTable(
  "drop_jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    dropAddress: text("drop_address")
      .notNull()
      .references(() => drops.address, { onDelete: "cascade" }),
    /** `watch_funding` | `activate` | `pay`. */
    kind: text("kind").notNull(),
    /** `ready` | `running` | `done` | `failed`. */
    state: text("state").notNull().default("ready"),
    /** Backoff lives here, not in memory. */
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("drop_jobs_ready_idx").on(table.state, table.runAfter),
    uniqueIndex("drop_jobs_drop_address_kind_key").on(table.dropAddress, table.kind),
  ],
);

/**
 * Every transaction either relayer sent. The hash or signature is public. The key is not, and
 * is never here.
 *
 * On an EVM row the gas columns are gas and `cost_wei` is wei. On a Solana row `gas_limit` and
 * `gas_used` are compute units, `effective_gas_price` is null, `cost_wei` is lamports the relayer
 * spent including rent, `nonce` is null and `last_valid_block_height` is set. Migration 0005.
 */
export const relayerTxs = pgTable(
  "relayer_txs",
  {
    /** The EVM tx hash, or the Solana signature. */
    txHash: text("tx_hash").primaryKey(),
    /**
     * EVM: `createDrop` | `activate` | `claim` | `claimBatch`, no fifth. Solana: `create_drop` |
     * `activate` | `claim` | `refund` | `cancel_unfunded` | `close_drop`, no seventh.
     */
    kind: text("kind").notNull(),
    chainId: integer("chain_id").notNull(),
    chainKey: text("chain_key").notNull(),
    dropAddress: text("drop_address"),
    /** The factory or drop on the EVM; the program id on Solana. */
    toAddress: text("to_address").notNull(),
    nonce: bigint("nonce", { mode: "bigint" }),
    lastValidBlockHeight: bigint("last_valid_block_height", { mode: "bigint" }),
    gasLimit: numeric("gas_limit").notNull(),
    gasUsed: numeric("gas_used"),
    effectiveGasPrice: numeric("effective_gas_price"),
    costWei: numeric("cost_wei"),
    /** `sent` | `success` | `reverted`. */
    status: text("status").notNull().default("sent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("relayer_txs_drop_idx").on(table.dropAddress)],
);

/**
 * The daily gas budget. Keyed by chain id, so each relayer has its own day:
 * wei for 46630, lamports for 103.
 *
 * `weiSpent` is charged with the worst case cost before a send and corrected once the receipt
 * gives the real one. Charging first is what makes the cap a cap.
 */
export const relayerSpend = pgTable(
  "relayer_spend",
  {
    /** UTC day, `YYYY-MM-DD`. */
    day: date("day").notNull(),
    chainId: integer("chain_id").notNull(),
    weiSpent: numeric("wei_spent").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.day, table.chainId] })],
);

/**
 * Every X account we ever resolved, migration 0010. Receivers mostly never sign in, so
 * this is not `profiles`. Keyed by the numeric X id, never the handle.
 */
export const xUsers = pgTable("x_users", {
  xUserId: text("x_user_id").primaryKey(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  profileImageUrl: text("profile_image_url"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A pasted handle, lowercased, and the X id it resolved to. */
export const xHandleLookups = pgTable("x_handle_lookups", {
  handleLower: text("handle_lower").primaryKey(),
  xUserId: text("x_user_id").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per handle leaf. The manifest is still the published source. */
export const dropHandleLeaves = pgTable(
  "drop_handle_leaves",
  {
    dropAddress: text("drop_address")
      .notNull()
      .references(() => drops.address, { onDelete: "cascade" }),
    leafIndex: integer("leaf_index").notNull(),
    xUserId: text("x_user_id").notNull(),
    /** Base units, as `drops.total_entitlements`. */
    amount: numeric("amount").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dropAddress, table.leafIndex] }),
    index("drop_handle_leaves_x_user_idx").on(table.xUserId),
  ],
);

/**
 * One binding per leaf, one per X id per drop, both enforced by the database.
 * The wallet message and signature are the receiver's proof, kept.
 */
export const handleBindings = pgTable(
  "handle_bindings",
  {
    dropAddress: text("drop_address")
      .notNull()
      .references(() => drops.address, { onDelete: "cascade" }),
    leafIndex: integer("leaf_index").notNull(),
    xUserId: text("x_user_id").notNull(),
    recipient: text("recipient").notNull(),
    binderSignature: text("binder_signature").notNull(),
    /** `bound`, `submitted`, `paid` or `failed`. */
    state: text("state")
      .$type<"bound" | "submitted" | "paid" | "failed">()
      .notNull()
      .default("bound"),
    claimTxHash: text("claim_tx_hash"),
    /** Why the claim failed, migration 0013. A `failed` binding may be rebound. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.dropAddress, table.leafIndex] }),
    uniqueIndex("handle_bindings_drop_x_user_key").on(table.dropAddress, table.xUserId),
  ],
);

/** Paid X handle lookups per UTC day, migration 0011. Charged before the call. */
export const xLookupSpend = pgTable("x_lookup_spend", {
  day: date("day").primaryKey(),
  lookups: integer("lookups").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type OauthStateRow = typeof oauthStates.$inferSelect;
export type DropRow = typeof drops.$inferSelect;
export type DropJobRow = typeof dropJobs.$inferSelect;
export type RelayerTxRow = typeof relayerTxs.$inferSelect;
export type RelayerSpendRow = typeof relayerSpend.$inferSelect;
export type XUserRow = typeof xUsers.$inferSelect;
export type XHandleLookupRow = typeof xHandleLookups.$inferSelect;
export type DropHandleLeafRow = typeof dropHandleLeaves.$inferSelect;
export type HandleBindingRow = typeof handleBindings.$inferSelect;
