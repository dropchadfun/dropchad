/**
 * Creating a drop: the whole write path, in one place, for either chain.
 *
 * The order below is not an implementation detail, it is the security of the flow. Every step
 * checks the step before it, and the drop is only written down once the chain has agreed with us.
 *
 *  1. rate limit the creator, per X id, counted in the database
 *  2. normalise the receivers by the family's rules
 *  3. build the commitment from the X id, a nonce and a secret blind
 *     same on both chains. One blind per drop, kept on our row, never served
 *  4. predict the address and skip the nonce forward while it is taken. On the EVM that is the
 *     salt, `saltUsed` and the factory's own `predictDrop`, agreed twice; on Solana it is the PDA
 *     and "does the account exist". The adapter owns that difference
 *  5. build the merkle tree **at that address**, and the manifest and its hash
 *  5b. the fee guards: every leaf worth the usd minimum, and the fee covering
 *     the relayer's cost. Nothing is sent when either refuses
 *  6. send the create call from the relayer and wait for it to confirm
 *  7. read back what the chain made — the `DropCreated` event, or the `Drop` account — and check
 *     every field we care about **against what we sent**
 *  8. only now write our row, and enqueue the funding watcher, in one transaction
 *
 * Step 7 is the one that matters most. Until the chain agrees, the address the sender would be
 * asked to fund is a prediction, and a prediction is not somewhere to send money.
 *
 * Native coins, and token drops on Solana in handle mode
 * the token is checked again, the fee is the usd tier in SOL, and the read back also
 * checks the vault, the SOL fee and the account budget. ERC20 drops are blocked on.
 */
import {
  MAX_LEAVES,
  buildDropTree,
  buildHandleDropTree,
  canonicalHandleManifestJson,
  keccakHandleManifestHash,
  toHandleManifest,
  canonicalManifestJson,
  keccakManifestHash,
  toManifest,
  MIN_SOL_LEAF_LAMPORTS,
  type DropTree,
  type Receiver,
} from "@dropchad/shared";
import { and, count, eq, gte } from "drizzle-orm";
import type { Address, Hex } from "viem";

import {
  CLAIM_PERIOD_SECONDS,
  CREATE_RATE_LIMIT,
  CREATE_RATE_WINDOW_SECONDS,
  FUNDING_PERIOD_SECONDS,
} from "../config.js";
import type { ChainAdapter, FundingInstructions } from "../chain/adapter.js";
import type { TokenCheck } from "../chain/svm/token-check.js";
import type { Binders } from "../binder/binders.js";
import { handleModeStatus } from "../binder/handle-mode.js";
import { canonicalAddress } from "../chain/address.js";
import { creatorCommitment, newCommitmentBlind } from "../chain/predict.js";
import type { Database } from "../db/client.js";
import { dropHandleLeaves, dropJobs, drops } from "../db/schema.js";
import type { PriceService } from "../prices/service.js";
import { checkFeeGuards, checkTokenFeeCoversRelayer, PriceUnavailableError } from "./fee-guards.js";
import { tokenFeeTierUsd, tokenMaxPeople, tokenFeeRule, type TokenFeeTier } from "./token-fee.js";
import { withQuickToken } from "./token-info.js";
import type { ResolveResult } from "../x/resolver.js";

/** How many nonces to try before giving up. A taken address is rare; 32 in a row is a bug, not luck. */
const MAX_NONCE_ATTEMPTS = 32;

export class CreateRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`too many drops created in the last hour, limit is ${String(CREATE_RATE_LIMIT)}`);
    this.name = "CreateRateLimitedError";
  }
}

export class CreateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateInputError";
  }
}

/** What the chain made did not match what we asked for. Never write a row on this. */
export class EventMismatchError extends Error {
  constructor(field: string, sent: string, emitted: string) {
    super(`created drop's ${field} is ${emitted}, we sent ${sent}`);
    this.name = "EventMismatchError";
  }
}

export { PredictionMismatchError } from "../chain/evm/adapter.js";

/** every handle must resolve, or nothing is created. */
export class HandlesNotFoundError extends Error {
  constructor(readonly handles: readonly string[]) {
    super(`these handles are not on X: ${handles.join(", ")}`);
    this.name = "HandlesNotFoundError";
  }
}

/** a handle drop never pays the sender's own X account. */
export class OwnHandleError extends Error {
  constructor() {
    super("a handle drop cannot pay your own X account");
    this.name = "OwnHandleError";
  }
}

/**
 * Handle mode is off on this chain: `DropFactoryV2` unrecorded,
 * no live binder, no binder key of ours, or a binder on chain that is not our key.
 */
export class HandleModeNotReadyError extends Error {
  constructor(chainKey: string) {
    super(`handle drops are not live on ${chainKey} yet`);
    this.name = "HandleModeNotReadyError";
  }
}

/** a mint where only `"native"` fits, or a mint that is not one. `400 invalid_asset`. */
export class InvalidAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAssetError";
  }
}

/** the token check said no. `400 token_refused` with its one plain reason. */
export class TokenRefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "TokenRefusedError";
  }
}

/** the token cannot be checked, no checker or the chain cannot be read. `503`. */
export class TokenCheckUnavailableError extends Error {
  /** Which chain's reads are missing: `solana_unavailable` or `robinhood_unavailable`. */
  readonly family: "evm" | "svm";
  constructor(family: "evm" | "svm" = "svm") {
    super("the token cannot be checked right now");
    this.family = family;
    this.name = "TokenCheckUnavailableError";
  }
}

/** the fee in SOL is above the 1 SOL cap. `400 fee_too_high`. */
export class FeeTooHighError extends Error {
  constructor(readonly feeLamports: bigint) {
    super("the fee is too high right now, try again later.");
    this.name = "FeeTooHighError";
  }
}

/** more people than the last fee tier. `400 too_many`. */
export class TokenTooManyError extends Error {
  constructor(
    readonly people: number,
    readonly max: number,
  ) {
    super(`a token drop takes at most ${String(max)} people, this one has ${String(people)}`);
    this.name = "TokenTooManyError";
  }
}

/** The text when there is no coin price for a token drop's fee, SOL or ETH. */
const noPrice = (symbol: string) => `no ${symbol} price right now, try again in a minute.`;

export interface HandleLine {
  /** As pasted, `@alice` or `alice`. */
  readonly handle: string;
  readonly amount: bigint;
}

export interface CreateDropInput {
  readonly xUserId: string;
  /** `address` when absent: the multisend path. The route always says which. */
  readonly mode?: "address" | "handle";
  /** Address mode. Addresses as the family writes them. Validated by the adapter, not before. */
  readonly receivers?: readonly Receiver<string>[] | undefined;
  /** Handle mode. */
  readonly handles?: readonly HandleLine[] | undefined;
  readonly refundRecipient: string;
  readonly title?: string | undefined;
  readonly memeImageUrl?: string | undefined;
  /** `"native"` (absent) or a mint. The route has checked the chain and the mode. */
  readonly asset?: string | undefined;
}

export interface CreateDropDeps {
  readonly db: Database;
  readonly chain: ChainAdapter;
  readonly now: () => Date;
  /** Handle mode: pasted handles to X ids, `src/x/resolver.ts`, bound to the api config. */
  readonly resolve?: (handles: readonly string[]) => Promise<ResolveResult>;
  /** The usd feed. Absent means no price, and a create is refused. */
  readonly prices?: PriceService | undefined;
  /** this chain's usd minimum per receiver as a decimal string, `minReceiverUsd`. */
  readonly minReceiverUsd: string;
  /** Our binder keys. A handle drop needs the chain's one, and it must be the binder on chain. */
  readonly binders?: Binders | undefined;
  /** The commitment blind of a new drop. Absent means `newCommitmentBlind`. */
  readonly randomBlind?: (() => Hex) | undefined;
  /** The token check of, run again for a token drop. Absent: a token drop is a `503`. */
  readonly checkToken?: ((mint: string) => Promise<TokenCheck>) | undefined;
  /** from config. Needed for a token drop only. */
  readonly tokenFeeTiers?: readonly TokenFeeTier[] | undefined;
}

export interface CreatedDrop {
  readonly address: string;
  readonly chainKey: string;
  readonly chainId: number;
  readonly family: ChainAdapter["family"];
  readonly mode: "address" | "handle";
  readonly asset: string;
  readonly assetKind: "native" | "token";
  readonly merkleRoot: Hex;
  readonly manifestHash: Hex;
  /** Base units, as decimal strings. The field names keep the EVM shape the frontend reads. */
  readonly totalEntitlementsWei: string;
  readonly feeAmountWei: string;
  readonly grossRequiredWei: string;
  readonly leafCount: number;
  readonly refundRecipient: string;
  readonly claimPeriodSeconds: number;
  readonly createTxHash: string;
  readonly title: string | null;
  readonly memeImageUrl: string | null;
  readonly funding: FundingInstructions;
}

/** How many drops this X id created inside the rate limit window. */
export async function recentCreateCount(db: Database, xUserId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - CREATE_RATE_WINDOW_SECONDS * 1000);
  const rows = await db
    .select({ value: count() })
    .from(drops)
    .where(and(eq(drops.xUserId, xUserId), gte(drops.createdAt, since)));
  return rows[0]?.value ?? 0;
}

function buildTreeFor(
  chain: ChainAdapter,
  drop: string,
  receivers: readonly Receiver<string>[],
): DropTree<string> {
  if (chain.family === "svm") {
    return buildDropTree({ family: "svm", drop, chainId: chain.chainId, receivers });
  }
  return buildDropTree({
    drop: drop as Address,
    chainId: chain.chainId,
    receivers: receivers as readonly Receiver<Address>[],
  });
}

export async function createDrop(
  deps: CreateDropDeps,
  input: CreateDropInput,
): Promise<CreatedDrop> {
  const { db, chain } = deps;
  const now = deps.now();

  // --- 1. rate limit, per X id, counted in the database so a restart does not reset it --------
  if ((await recentCreateCount(db, input.xUserId, now)) >= CREATE_RATE_LIMIT) {
    throw new CreateRateLimitedError(CREATE_RATE_WINDOW_SECONDS);
  }

  const mode = input.mode ?? "address";
  let mint = input.asset === undefined || input.asset === "native" ? null : input.asset;
  // a token drop is a handle drop, on a chain with token drops: Solana, and Robinhood once
  // `DropFactoryV3` is recorded. The adapter has `tokenVault` exactly then.
  if (mint !== null && (mode !== "handle" || chain.tokenVault === undefined)) {
    throw new InvalidAssetError(
      `a token drop is a handle drop on a chain with token drops; ${chain.chainName} has none yet`,
    );
  }
  if (mint !== null && chain.family === "evm") {
    try {
      mint = chain.parseAddress(mint);
    } catch {
      throw new InvalidAssetError("a token on this chain is a 0x address");
    }
  }

  // --- 2. receivers, by the mode, then the family's rules ------------------------------------
  let receivers: Receiver<string>[] = [];
  let handleReceivers: { xId: bigint; amount: bigint }[] = [];
  let tokenInfo: {
    readonly mint: string;
    readonly tokenProgram: string;
    readonly decimals: number;
    readonly name: string | null;
    readonly symbol: string | null;
    /** the check's launchpad, kept on the row. */
    readonly launchpad: "pump.fun" | null;
  } | null = null;
  let tokenFee: {
    readonly tierUsd: string;
    readonly solPriceUsd: number;
    readonly lamports: bigint;
  } | null = null;
  if (mode === "handle") {
    // before any paid X lookup.
    const status = await handleModeStatus(chain, deps.binders);
    if (!status.on) {
      console.warn(`handle drop refused on ${chain.chainKey}: handle mode off, ${status.reason}`);
      throw new HandleModeNotReadyError(chain.chainKey);
    }
    if (deps.resolve === undefined) throw new HandleModeNotReadyError(chain.chainKey);
    // the token is checked again, before any paid X lookup.
    if (mint !== null) {
      if (deps.checkToken === undefined) throw new TokenCheckUnavailableError(chain.family);
      let checked: TokenCheck;
      try {
        checked = await deps.checkToken(mint);
      } catch {
        throw new TokenCheckUnavailableError(chain.family);
      }
      if (!checked.ok || checked.tokenProgram === null || checked.decimals === null) {
        throw new TokenRefusedError(checked.reason ?? "not a token");
      }
      // a quick token, by this chain and exact address, gets our name and ticker.
      const named = withQuickToken(chain.chainKey, mint, checked);
      tokenInfo = {
        mint,
        tokenProgram: checked.tokenProgram,
        decimals: checked.decimals,
        name: named.name,
        symbol: named.symbol,
        launchpad: checked.launchpad,
      };
    }
    const lines = input.handles ?? [];
    if (lines.length === 0) throw new CreateInputError("a handle drop needs at least one handle");
    // Throws `HandleResolveError` for a bad handle, too many, the daily cap or X down.
    const resolved = await deps.resolve(lines.map((l) => l.handle));
    if (resolved.missing.length > 0) throw new HandlesNotFoundError(resolved.missing);
    const idOf = new Map(resolved.found.map((f) => [f.handleLower, f.xUserId]));
    handleReceivers = lines.map((l) => {
      const lower = l.handle.trim().replace(/^@/, "").toLowerCase();
      const xUserId = idOf.get(lower);
      if (xUserId === undefined) throw new HandlesNotFoundError([lower]);
      return { xId: BigInt(xUserId), amount: l.amount };
    });
    if (handleReceivers.some((r) => r.xId === BigInt(input.xUserId))) throw new OwnHandleError();
    if (handleReceivers.every((r) => r.amount <= 0n)) {
      throw new CreateInputError("a drop needs at least one receiver with an amount above zero");
    }
    // the people after the merge set the tier; the end of the last tier is the cap.
    if (tokenInfo !== null) {
      const tiers = deps.tokenFeeTiers;
      if (tiers === undefined) throw new TokenCheckUnavailableError(chain.family);
      const people = new Set(handleReceivers.filter((r) => r.amount > 0n).map((r) => r.xId)).size;
      const max = tokenMaxPeople(tiers);
      if (people > max) throw new TokenTooManyError(people, max);
      const tierUsd = tokenFeeTierUsd(people, tiers);
      const solPriceUsd = (await deps.prices?.usdPrice(chain.nativeSymbol)) ?? null;
      if (solPriceUsd === null || !(solPriceUsd > 0)) {
        throw new PriceUnavailableError(chain.nativeSymbol, noPrice(chain.nativeSymbol));
      }
      // lamports and 1 SOL on Solana; wei rounded up to 0.00001 ETH and 0.05 ETH on
      // Robinhood. The field keeps its Solana name; it is the native coin.
      const rule = tokenFeeRule(chain.family);
      const lamports = rule.toBaseUnits(tierUsd, solPriceUsd);
      if (lamports > rule.cap) throw new FeeTooHighError(lamports);
      tokenFee = { tierUsd, solPriceUsd, lamports };
    }
  } else {
    try {
      receivers = chain.normalizeReceivers(input.receivers ?? []);
    } catch (error) {
      throw new CreateInputError(error instanceof Error ? error.message : "bad receiver list");
    }
    if (receivers.length === 0) {
      throw new CreateInputError("a drop needs at least one receiver with an amount above zero");
    }
    if (receivers.length > MAX_LEAVES) {
      throw new CreateInputError(
        `${String(receivers.length)} receivers after merging duplicates, the limit is ${String(MAX_LEAVES)}`,
      );
    }
  }

  let refundRecipient: string;
  try {
    refundRecipient = chain.parseAddress(input.refundRecipient);
  } catch (error) {
    throw new CreateInputError(error instanceof Error ? error.message : "bad refund address");
  }
  if (refundRecipient === chain.nativeAsset) {
    throw new CreateInputError("refundRecipient cannot be the zero address");
  }

  // --- 3 and 4. commitment, and a free address agreed with the chain -------------------------
  const startNonce = BigInt(
    (await db.select({ value: count() }).from(drops).where(eq(drops.xUserId, input.xUserId)))[0]
      ?.value ?? 0,
  );

  const xUserIdNumeric = BigInt(input.xUserId);
  // One blind per drop, kept through the nonce loop below. The nonce is public on chain; the
  // blind is what keeps a guessed X id from being checked against the commitment.
  const blind = (deps.randomBlind ?? newCommitmentBlind)();
  let nonce = startNonce;
  let commitment: Hex = "0x";
  let predicted: string;
  let attempts = 0;

  for (;;) {
    commitment = creatorCommitment(xUserIdNumeric, nonce, blind);
    const prediction = await chain.predictDrop(commitment, nonce);
    predicted = prediction.address;
    if (!prediction.taken) break;

    // The address is taken. That happens when our database was wiped but the chain remembers.
    attempts += 1;
    if (attempts >= MAX_NONCE_ATTEMPTS) {
      throw new Error(`no free nonce for X id after ${String(attempts)} attempts`);
    }
    nonce += 1n;
  }

  // --- 5. the tree is built at the predicted address. binds the leaf to this drop --------
  // Handle mode: the six word leaf, the version 2 manifest. Address mode is 7.1.
  let tree: { readonly root: Hex; readonly totalEntitlements: bigint; readonly leafCount: number };
  let manifestJson: string;
  let manifestHash: Hex;
  let handleLeaves: { index: number; xId: bigint; amount: bigint }[] = [];
  if (mode === "handle") {
    let handleTree;
    try {
      handleTree = buildHandleDropTree({
        family: chain.family === "svm" ? "svm" : "evm",
        drop: predicted,
        chainId: chain.chainId,
        receivers: handleReceivers,
      });
    } catch (error) {
      throw new CreateInputError(error instanceof Error ? error.message : "bad handle list");
    }
    const manifest = toHandleManifest(handleTree);
    manifestJson = canonicalHandleManifestJson(manifest);
    manifestHash = keccakHandleManifestHash(manifest);
    handleLeaves = handleTree.entries.map((e) => ({
      index: e.index,
      xId: e.xId,
      amount: e.amount,
    }));
    // the rent floor holds on SOL handle leaves too. Address leaves get it in the
    // adapter. A token amount has no floor and no usd minimum.
    if (chain.family === "svm" && tokenInfo === null) {
      const under = handleLeaves.find((l) => l.amount < MIN_SOL_LEAF_LAMPORTS);
      if (under !== undefined) {
        throw new CreateInputError(
          `X id ${under.xId.toString()} would receive ${under.amount.toString()} lamports, under ` +
            `the ${MIN_SOL_LEAF_LAMPORTS.toString()} lamport minimum a fresh wallet can hold. ` +
            ``,
        );
      }
    }
    tree = handleTree;
  } else {
    const addressTree = buildTreeFor(chain, predicted, receivers);
    const manifest = toManifest(addressTree);
    manifestJson = canonicalManifestJson(manifest);
    manifestHash = keccakManifestHash(manifest);
    tree = addressTree;
  }

  // --- 5b. the fee guards, before anything is sent -------------------------
  /** the fee of a native drop as the api works it out, checked again at the read back. */
  let nativeFee: bigint | null = null;
  if (tokenFee !== null) {
    await checkTokenFeeCoversRelayer({
      chain,
      fee: tokenFee.lamports,
      handleLeaves: tree.leafCount,
    });
  } else {
    nativeFee = await checkFeeGuards({
      chain,
      prices: deps.prices,
      minUsd: deps.minReceiverUsd,
      amounts:
        mode === "handle" ? handleLeaves.map((l) => l.amount) : receivers.map((r) => r.amount),
      totalEntitlements: tree.totalEntitlements,
      addressLeaves: mode === "handle" ? 0 : tree.leafCount,
      handleLeaves: mode === "handle" ? tree.leafCount : 0,
    });
  }

  // --- 6. send it --------------------------------------------------------------------------
  const created = await chain.createDrop({
    merkleRoot: tree.root,
    manifestHash,
    totalEntitlements: tree.totalEntitlements,
    leafCount: tree.leafCount,
    refundRecipient,
    creatorCommitment: commitment,
    nonce,
    fundingPeriod: FUNDING_PERIOD_SECONDS,
    claimPeriod: CLAIM_PERIOD_SECONDS,
    ...(tokenInfo === null || tokenFee === null
      ? {}
      : {
          token: {
            mint: tokenInfo.mint,
            tokenProgram: tokenInfo.tokenProgram,
            solFeeLamports: tokenFee.lamports,
          },
        }),
  });

  // --- 7. the chain has to agree with every number we are about to show a sender --------------
  if (canonicalAddress(created.drop) !== canonicalAddress(predicted)) {
    throw new EventMismatchError("drop", predicted, created.drop);
  }
  if (created.merkleRoot.toLowerCase() !== tree.root.toLowerCase()) {
    throw new EventMismatchError("merkleRoot", tree.root, created.merkleRoot);
  }
  if (created.manifestHash.toLowerCase() !== manifestHash.toLowerCase()) {
    throw new EventMismatchError("manifestHash", manifestHash, created.manifestHash);
  }
  if (created.totalEntitlements !== tree.totalEntitlements) {
    throw new EventMismatchError(
      "totalEntitlements",
      tree.totalEntitlements.toString(),
      created.totalEntitlements.toString(),
    );
  }
  if (created.leafCount !== tree.leafCount) {
    throw new EventMismatchError("leafCount", String(tree.leafCount), String(created.leafCount));
  }
  if (canonicalAddress(created.refundRecipient) !== canonicalAddress(refundRecipient)) {
    throw new EventMismatchError("refundRecipient", refundRecipient, created.refundRecipient);
  }
  const expectedAsset = tokenInfo?.mint ?? chain.nativeAsset;
  if (canonicalAddress(created.asset) !== canonicalAddress(expectedAsset)) {
    throw new EventMismatchError("asset", expectedAsset, created.asset);
  }
  // a native drop's fee is exactly the one the api worked out from the same chain read.
  if (nativeFee !== null && created.feeAmount !== nativeFee) {
    throw new EventMismatchError("feeAmount", nativeFee.toString(), created.feeAmount.toString());
  }
  // a token drop's vault, its zero token fee, the SOL fee and the account budget.
  let vault: string | null = null;
  let accountBudget = 0n;
  if (tokenInfo !== null && tokenFee !== null) {
    if (chain.tokenVault === undefined || chain.tokenAccountRent === undefined) {
      throw new InvalidAssetError(`${chain.chainKey} has no token drops`);
    }
    const expectedVault = chain.tokenVault(created.drop, tokenInfo.mint, tokenInfo.tokenProgram);
    if (created.vault !== expectedVault) {
      throw new EventMismatchError("vault", expectedVault, String(created.vault));
    }
    if (created.feeAmount !== 0n) {
      throw new EventMismatchError("feeAmount", "0", created.feeAmount.toString());
    }
    if (created.grossRequired !== tree.totalEntitlements) {
      throw new EventMismatchError(
        "grossRequired",
        tree.totalEntitlements.toString(),
        created.grossRequired.toString(),
      );
    }
    if (created.solFeeLamports !== tokenFee.lamports) {
      throw new EventMismatchError(
        "solFeeLamports",
        tokenFee.lamports.toString(),
        String(created.solFeeLamports),
      );
    }
    const expectedBudget =
      BigInt(tree.leafCount) * (await chain.tokenAccountRent(tokenInfo.tokenProgram));
    if (created.accountBudgetLamports !== expectedBudget) {
      throw new EventMismatchError(
        "accountBudgetLamports",
        expectedBudget.toString(),
        String(created.accountBudgetLamports),
      );
    }
    vault = expectedVault;
    accountBudget = expectedBudget;
  }

  // --- 8. now it is real. The row and the first job go in together. ---------------------------
  const address = canonicalAddress(created.drop);
  await db.transaction(async (tx) => {
    await tx.insert(drops).values({
      address,
      chainId: chain.chainId,
      chainKey: chain.chainKey,
      xUserId: input.xUserId,
      nonce,
      creatorCommitment: commitment,
      salt: created.salt,
      asset: created.asset,
      merkleRoot: tree.root,
      manifestHash,
      manifestJson,
      totalEntitlements: tree.totalEntitlements.toString(),
      // The fee is snapshotted by the chain, so both numbers come from the read back, never from us.
      feeAmount: created.feeAmount.toString(),
      grossRequired: created.grossRequired.toString(),
      leafCount: tree.leafCount,
      refundRecipient,
      fundingDeadline: created.fundingDeadline,
      claimPeriod: created.claimPeriod,
      title: input.title ?? null,
      memeImageUrl: input.memeImageUrl ?? null,
      mode,
      commitmentBlind: blind,
      ...(tokenInfo === null || tokenFee === null
        ? {}
        : {
            tokenProgram: tokenInfo.tokenProgram,
            tokenDecimals: tokenInfo.decimals,
            tokenName: tokenInfo.name,
            tokenSymbol: tokenInfo.symbol,
            tokenLaunchpad: tokenInfo.launchpad,
            vault,
            solFeeLamports: tokenFee.lamports.toString(),
            accountBudgetLamports: accountBudget.toString(),
            feeTierUsd: tokenFee.tierUsd,
            feeSolPriceUsd: String(tokenFee.solPriceUsd),
          }),
      state: "created",
      createTxHash: created.txId,
      lastTxHash: created.txId,
      createdAt: now,
      updatedAt: now,
    });

    // One row per handle leaf, so the claim page can find a receiver's drops.
    if (handleLeaves.length > 0) {
      await tx.insert(dropHandleLeaves).values(
        handleLeaves.map((l) => ({
          dropAddress: address,
          leafIndex: l.index,
          xUserId: l.xId.toString(),
          amount: l.amount.toString(),
        })),
      );
    }

    // The funding watcher picks this up.
    await tx.insert(dropJobs).values({
      dropAddress: address,
      kind: "watch_funding",
      state: "ready",
      runAfter: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    address: created.drop,
    chainKey: chain.chainKey,
    chainId: chain.chainId,
    family: chain.family,
    mode,
    asset: created.asset,
    assetKind: tokenInfo === null ? "native" : "token",
    merkleRoot: tree.root,
    manifestHash,
    totalEntitlementsWei: tree.totalEntitlements.toString(),
    feeAmountWei: created.feeAmount.toString(),
    grossRequiredWei: created.grossRequired.toString(),
    leafCount: tree.leafCount,
    refundRecipient,
    claimPeriodSeconds: created.claimPeriod,
    createTxHash: created.txId,
    title: input.title ?? null,
    memeImageUrl: input.memeImageUrl ?? null,
    funding:
      tokenInfo === null || tokenFee === null || vault === null
        ? chain.fundingInstructions({
            drop: created.drop,
            // The sender must cover entitlements plus fee. check this number.
            amount: created.grossRequired,
            fundingDeadline: created.fundingDeadline,
          })
        : chain.fundingInstructions({
            drop: created.drop,
            // the SOL part is the fee and the account budget; the tokens apart.
            amount: tokenFee.lamports + accountBudget,
            fundingDeadline: created.fundingDeadline,
            token: {
              mint: tokenInfo.mint,
              vault,
              tokenProgram: tokenInfo.tokenProgram,
              name: tokenInfo.name,
              symbol: tokenInfo.symbol,
              decimals: tokenInfo.decimals,
              amount: tree.totalEntitlements,
            },
          }),
  };
}
