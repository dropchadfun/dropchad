/**
 * The api, as the web app sees it.
 *
 * Every call goes to **this origin**: `/api/...`. In dev Next rewrites that to `apps/api` on
 * 4000, in production both sit behind one host. The browser never learns another origin, so the
 * session cookie and the CSRF cookie are always in scope. `apps/api/README.md`, ports.
 *
 * On the server (a server component) there is no origin to be relative to, so `apiUrl` uses
 * `API_ORIGIN` directly. Server calls carry no cookies, which is fine: everything a server
 * component reads here is public.
 *
 * The shapes below are written by hand from `apps/api/src/routes/*.ts` and the indexer's
 * `src/api/index.ts`. They are a contract, not a copy: if the api changes a field, this file
 * changes with it in the same commit.
 */

import type { ShareCardData } from "@/components/drops/share-card";
import type { ClaimsAnswer } from "@/components/drops/claim";
import type { DroppedItem } from "@/lib/format";
import type { ProfileTag } from "@/lib/tags";

const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://localhost:4000";

function apiUrl(path: string): string {
  return typeof window === "undefined" ? `${API_ORIGIN}${path}` : path;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(`${code} (${String(status)})`);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), { cache: "no-store", ...init });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "request_failed";
    throw new ApiError(response.status, code, body);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

export interface Profile {
  readonly xUserId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly profileImageUrl: string | null;
  /** Derived by the api from the main tag, `chad` by default. A label, never proof. */
  readonly kind: ProfileKind;
  /**
   * One to three self picked tags, `lib/tags.ts`, the main tag first: the one rows and boards
   * show. Empty when never picked; a saved set is never emptied.
   */
  readonly tags: ProfileTag[];
  /** ISO. The last save plus 30 days, past or future. Null when never saved. */
  readonly tagLockedUntil: string | null;
  /** Earned, never picked. Empty until the proofs of the design exist. */
  readonly badges: ProfileBadge[];
}

export const PROFILE_KINDS = ["chad", "kol", "project"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const PROFILE_BADGES = ["project", "cto", "streamer"] as const;
export type ProfileBadge = (typeof PROFILE_BADGES)[number];
export type { ProfileTag };

export interface Me {
  readonly profile: Profile | null;
  readonly session?: { readonly expiresAt: string };
}

/** `GET /api/chains`. The chains this api can make drops on, with the fee each charges now. */
export interface ChainInfo {
  readonly key: string;
  readonly chainId: number;
  readonly family: "evm" | "svm";
  readonly nativeSymbol: string;
  readonly decimals: number;
  /** Basis points. `null` when the chain did not answer. */
  readonly defaultFeeBps: number | null;
  /** The flat minimum fee in base units, a decimal string. `null` when the chain did not answer. */
  readonly minFee: string | null;
  /**
   * since api: the minimum fee per receiver in base units, zero is off. `null` when
   * the chain did not answer; absent from an older api.
   */
  readonly minFeePerReceiver?: string | null;
  /** since api: the max fee per drop in base units, zero is no cap. */
  readonly maxFee?: string | null;
  /**
   * Whether a handle drop can be made here now. `false` greys `drop` out on
   * `/create` and shows the paused line.
   */
  readonly handleMode: boolean;
  /**
   * The token drop fee in usd by people: `upTo` the last number of
   * people in the tier, `usd` as written in config. `null` on a chain without token drops;
   * absent from an api before 5b. `/create` shows `fee $15, paid in SOL` from it.
   */
  readonly tokenFeeTiers?:
    | readonly {
        readonly upTo: number;
        readonly usd: string;
        /** The api's SOL estimate at its price; `null` with no price, absent before. */
        readonly lamports?: string | null;
        /** Robinhood: the ETH estimate, rounded up to 0.00001 ETH by the api. */
        readonly wei?: string | null;
      }[]
    | null;
}

export function getChains(): Promise<{ chains: ChainInfo[] }> {
  return request("/api/chains");
}

export function getMe(): Promise<Me> {
  return request<Me>("/api/me");
}

/**
 * `PATCH /api/me`. Your one to three tags, the main tag first, nothing else is editable. The
 * api derives the kind from the main tag, and answers `409 tag_locked` with `until` inside the 30
 * days.
 */
export function setMyTags(
  tags: readonly ProfileTag[],
  csrfToken: string,
): Promise<{ profile: Profile }> {
  return request("/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-dropchad-csrf": csrfToken },
    body: JSON.stringify({ tags }),
  });
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

/** One chain's numbers inside `/api/stats`. `droppedTotal` is in that chain's base units. */
export interface ChainTotal {
  readonly chainKey: string;
  readonly family: "evm" | "svm" | "tvm";
  readonly symbol: string;
  readonly decimals: number;
  readonly droppedTotal: string;
  readonly dropCount: number;
  readonly uniqueReceivers: number;
  readonly claimCount: number;
  readonly available: boolean;
  /** Usd from the prices frozen at activation, native coin only. `null` when it could not be read. */
  readonly usd: number | null;
}

export interface Stats {
  readonly chain: string;
  /** EVM wei only, as it always was. Every chain is in `totals`. */
  readonly droppedTotalWei: string;
  readonly dropCount: number;
  readonly uniqueReceivers: number;
  readonly claimCount: number;
  /** Usd summed across the chains in scope. `null` if any chain could not be read. */
  readonly usd: number | null;
  readonly finality: "final";
  readonly totals: ChainTotal[];
  /** The coin line under the tile: what moved, per coin, tokens last. `droppedLine` shows it. */
  readonly dropped: DroppedItem[];
}

export function getStats(chain = "all"): Promise<Stats> {
  return request<Stats>(`/api/stats?chain=${encodeURIComponent(chain)}`);
}

/** Lowercase is the canonical spelling of a `0x` address; a base58 key is left alone. */
function pathAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}

// ---------------------------------------------------------------------------
// drops
// ---------------------------------------------------------------------------

/**
 * A token drop's token: on the drop rows, the drop page,
 * the share card and the claim list; `null` on a SOL or ETH drop. `apps/api/src/drops/token-info.ts`.
 */
export interface TokenInfo {
  readonly mint: string;
  /** The ticker, `null` when the token has none (devnet USDC). The web shows the short mint. */
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number;
  readonly tokenProgram: string;
  /** Always our own logo route; it answers `404 no_logo` when there is none. */
  readonly logoUrl: string;
  /**
   * Where it launched, kept at create; `null` or absent when not known. An id of
   * `lib/launchpads`; an id not in that list shows nothing.
   */
  readonly launchpad?: string | null;
}

/** Our side of a drop. `apps/api/src/drops/card.ts`. */
export interface OwnDropCard {
  readonly address: string;
  readonly chainId: number;
  readonly asset: string;
  /** The token of a token drop, `null` on a SOL or ETH drop; absent from an api before 4f. */
  readonly token?: TokenInfo | null;
  readonly title: string | null;
  readonly memeImageUrl: string | null;
  readonly state: OwnState;
  /** `handle` is a drop, `address` a multisend. */
  readonly mode: "address" | "handle";
  readonly totalEntitlementsWei: string;
  readonly leafCount: number;
  readonly paidCount: number;
  readonly failedIndexes: readonly number[];
  readonly createTxHash: string;
  readonly activateTxHash: string | null;
  readonly lastTxHash: string | null;
  readonly fundingDeadline: string;
  readonly createdAt: string;
  /** Always `null` for a multisend: the api never names its sender. */
  readonly creator: Profile | null;
}

export type OwnState =
  | "created"
  | "funded"
  | "active"
  | "paying"
  | "finished"
  | "failed"
  | "funding_expired"
  | "claims_expired";

/** The indexed drop row. `apps/indexer/src/api/index.ts`, `dropShape`. Amounts are wei strings. */
export interface IndexedDrop {
  readonly address: string;
  readonly chainId: number;
  readonly status: "Created" | "Active" | "Finalized" | "Cancelled";
  readonly asset: string;
  readonly creatorCommitment: string;
  readonly totalEntitlements: string;
  readonly leafCount: number;
  readonly totalClaimed: string;
  readonly claimedCount: number;
  readonly claimDeadline: string | null;
  readonly fundingDeadline: string;
  readonly verified: boolean;
  /** Unix seconds. */
  readonly createdAt: string;
  readonly transactionHash: string;
  readonly finality: "seen" | "final";
  readonly statusFinality: "seen" | "final";
  /** `indexer` for an EVM row, `rpc` for a Solana one. */
  readonly source?: "indexer" | "rpc";
  readonly chainKey?: string;
}

export interface DropListEntry extends IndexedDrop {
  readonly dropchad: OwnDropCard | null;
}

export function listDrops(limit = 50, chain = "all"): Promise<{ drops: DropListEntry[] }> {
  return request(`/api/drops?limit=${String(limit)}&chain=${encodeURIComponent(chain)}`);
}

export interface IndexedClaim {
  readonly index: number;
  /**
   * `null` on a Solana handle drop: the bitmap says a leaf is paid, not to which address, and a
   * handle leaf names an X id, never an address. Bug found live.
   */
  readonly recipient: string | null;
  readonly amount: string;
  /** `null` on Solana: the bitmap says paid, not which transaction paid. */
  readonly transactionHash: string | null;
  readonly timestamp?: string;
  readonly finality: "seen" | "final";
}

export interface DropDetail {
  readonly address: string;
  readonly chain: {
    readonly source: "indexer" | "rpc";
    readonly available: boolean;
    readonly indexed: boolean;
    readonly data: {
      readonly drop: IndexedDrop;
      readonly claims: IndexedClaim[];
      readonly events: {
        readonly kind: string;
        readonly transactionHash: string;
        readonly timestamp: string;
      }[];
    } | null;
  };
  readonly ours: {
    readonly source: "dropchad_api";
    readonly known: boolean;
    readonly data:
      | (Omit<OwnDropCard, "createdAt" | "fundingDeadline"> & {
          readonly grossRequiredWei: string;
          readonly feeAmountWei: string;
          readonly refundRecipient: string;
          readonly merkleRoot: string;
          readonly manifestUrl: string;
          readonly fundingDeadline: string;
          readonly lastError: string | null;
          readonly createdAt: string;
          /**
           * The session cookie is the X account that made this drop. Only true when the browser
           * asked: a server component sends no cookie. Absent from an api.
           */
          readonly yours?: boolean;
          /**
           * While the drop is `created`, the same funding as the create answer
           * `null` after that or with no write side; absent from an api before 4f.
           */
          readonly funding?: Funding | null;
          /**
           * Who got fed, by handle: each paid leaf of a handle drop with a known X
           * account, by leaf index. `null` on a multisend; absent from an api before.
           */
          readonly fed?: readonly FedPerson[] | null;
        })
      | null;
  };
}

/** One paid receiver of a handle drop. The picture is X's small `_normal` size. */
export interface FedPerson {
  readonly index: number;
  readonly handle: string;
  readonly profileImageUrl: string | null;
}

export function getDrop(address: string): Promise<DropDetail> {
  return request(`/api/drops/${pathAddress(address)}`);
}

/** The published manifest, parsed. The multisend page reads its receivers from it. */
export function getManifest(address: string): Promise<unknown> {
  return request(`/api/drops/${pathAddress(address)}/manifest`);
}

/**
 * The share card facts, `GET /api/drops/:address/share`. The sender only, once the drop
 * is live; anyone else gets 401, 403 or 409. The browser sends the cookie, so call it from the
 * browser only.
 */
export function getShareCard(address: string): Promise<ShareCardData> {
  return request(`/api/drops/${pathAddress(address)}/share`);
}

/**
 * What `/create` sends. `mode` is required by the api since: `handle` takes
 * `@handle amount` lines, `address` the multisend list, never both.
 */
export type CreateDropInput = {
  /** A `packages/chains` key. Absent means the api's default chain. */
  readonly chain?: string;
  readonly refundRecipient: string;
  readonly title?: string;
  readonly memeImageUrl?: string;
} & (
  | {
      readonly mode: "address";
      readonly receivers: readonly { address: string; amount: string }[];
    }
  | {
      readonly mode: "handle";
      readonly handles: readonly { handle: string; amount: string }[];
      /** `native`, the default, or a token's mint: a token drop, Solana only. */
      readonly asset?: string;
    }
);

/**
 * `GET /api/tokens/:mint?chain=solana`, the token check; `?chain=robinhood`
 * for a `0x` address since. `ok: false`
 * carries one plain reason. `logoUrl` is our own route, `null` when there is no logo.
 */
export interface TokenCheck {
  readonly mint: string;
  readonly tokenProgram: string | null;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly logoUrl: string | null;
  readonly launchpad: "pump.fun" | null;
  readonly ok: boolean;
  readonly reason: string | null;
}

export function getTokenCheck(
  mint: string,
  chain: "solana" | "robinhood" = "solana",
): Promise<TokenCheck> {
  return request(`/api/tokens/${encodeURIComponent(mint)}?chain=${chain}`);
}

/** `POST /api/handles/resolve`: names and avatars before the drop is made. */
export interface ResolvedHandles {
  readonly found: readonly {
    readonly handle: string;
    readonly xUserId: string;
    readonly displayName: string;
    readonly profileImageUrl: string | null;
  }[];
  readonly missing: readonly string[];
}

export interface CreatedDrop {
  readonly drop: {
    readonly address: string;
    readonly chainId: number;
    readonly chainKey: string;
    readonly family: "evm" | "svm";
    readonly totalEntitlementsWei: string;
    readonly feeAmountWei: string;
    readonly grossRequiredWei: string;
    readonly leafCount: number;
    readonly refundRecipient: string;
    readonly title: string | null;
    readonly createTxHash: string;
  };
  readonly funding: Funding;
  readonly warnings: string[];
}

/**
 * What to send, `apps/api/src/chain/adapter.ts` `FundingInstructions`: the create answer, and
 * the drop page while the drop is `created`. On a token drop the top fields are the
 * SOL part (the fee and the receivers' token accounts) and `token` the tokens, both to the same
 * drop address.
 */
export interface Funding {
  readonly address: string;
  readonly chainId: number;
  readonly asset: "native";
  readonly family: "evm" | "svm";
  readonly symbol: string;
  readonly decimals: number;
  readonly amountBaseUnits: string;
  readonly amountDisplay: string;
  readonly amountWei: string;
  readonly amountEth: string;
  /** EIP 681 on an EVM chain, Solana Pay on Solana. */
  readonly paymentUri: string;
  readonly fundingDeadline: string;
  /** A token drop only: the tokens to send. */
  readonly token?: TokenFunding;
}

/** The token part of a token drop's funding. */
export interface TokenFunding {
  readonly mint: string;
  /** The drop's token account. Shown, since some wallets warn about the drop address. */
  readonly vault: string;
  readonly tokenProgram: string;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number;
  readonly amountBaseUnits: string;
  readonly amountDisplay: string;
  /** Solana Pay with `spl-token`, to the drop address. */
  readonly paymentUri: string;
}

export function createDrop(input: CreateDropInput, csrfToken: string): Promise<CreatedDrop> {
  return request("/api/drops", {
    method: "POST",
    headers: { "content-type": "application/json", "x-dropchad-csrf": csrfToken },
    body: JSON.stringify({ asset: "native", ...input }),
  });
}

/**
 * The receiver's list, `GET /api/claims`. Signed in; the browser
 * sends the cookie, so this is only ever called from the browser.
 */
export function getClaims(): Promise<ClaimsAnswer> {
  return request("/api/claims");
}

/**
 * `POST /api/drops/:address/bind`: the pasted address, after the confirm screen. The api
 * checks the login age, the address and handle mode; the binder signs and the relayer claims.
 */
export function bindDrop(address: string, recipient: string, csrfToken: string): Promise<unknown> {
  return request(`/api/drops/${pathAddress(address)}/bind`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dropchad-csrf": csrfToken },
    body: JSON.stringify({ recipient }),
  });
}

/**
 * The one paid lookup on `next` in drop mode.: a cent of X API per handle not yet cached.
 * Signed in and CSRF checked, 20 a minute per session.
 */
export function resolveHandles(
  handles: readonly string[],
  csrfToken: string,
): Promise<ResolvedHandles> {
  return request("/api/handles/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "x-dropchad-csrf": csrfToken },
    body: JSON.stringify({ handles }),
  });
}

export function logout(csrfToken: string): Promise<unknown> {
  return request("/api/auth/logout", {
    method: "POST",
    headers: { "x-dropchad-csrf": csrfToken },
  });
}

// ---------------------------------------------------------------------------
// live stream
// ---------------------------------------------------------------------------

/** `apps/api/src/worker/events.ts` plus the snapshot the stream opens with. */
export type LiveEvent =
  | {
      readonly type: "snapshot";
      readonly state: OwnState;
      readonly paidCount: number;
      readonly leafCount: number;
      readonly failedIndexes: readonly number[];
      readonly grossRequiredWei: string;
    }
  | { readonly type: "funding_seen"; readonly balanceWei: string }
  | { readonly type: "activated"; readonly txHash: string | null; readonly claimDeadline: string }
  | {
      readonly type: "claim_paid";
      readonly index: number;
      readonly recipient: string;
      /** On a handle leaf; `null` or absent otherwise. */
      readonly handle?: string | null;
      readonly profileImageUrl?: string | null;
      readonly amountWei: string;
      readonly txHash: string;
      readonly paidCount: number;
      readonly leafCount: number;
    }
  | {
      readonly type: "finished";
      readonly state: OwnState;
      readonly paidCount: number;
      readonly leafCount: number;
      readonly failedIndexes: readonly number[];
    };

/**
 * Open the SSE stream for a drop. Browser only. Returns the close function.
 *
 * The stream is a notification, never the truth: on `finished` the caller re-reads the drop.
 */
export function openLive(address: string, onEvent: (event: LiveEvent) => void): () => void {
  const source = new EventSource(`/api/drops/${pathAddress(address)}/live`);
  const names = ["snapshot", "funding_seen", "activated", "claim_paid", "finished"] as const;
  for (const name of names) {
    source.addEventListener(name, (raw) => {
      const data = JSON.parse((raw as MessageEvent<string>).data) as Record<string, unknown>;
      onEvent({ ...data, type: name } as LiveEvent);
    });
  }
  return () => source.close();
}

// ---------------------------------------------------------------------------
// boards and users
// ---------------------------------------------------------------------------

/** the last 24 hours, the last 7 days, or every drop. */
export type BoardRange = "day" | "week" | "all";
export type BoardKind = "all" | ProfileKind;

/** One chad on one chain, in that chain's base unit. */
export interface BoardChainTotals {
  readonly chainKey: string;
  readonly total: string;
  readonly biggestDrop: string;
  readonly dropCount: number;
  readonly uniqueReceivers: number;
  /** Payouts on this chain, every final claim. */
  readonly claimCount: number;
  /** Usd from the prices frozen at activation. Unpriced drops count zero. */
  readonly usd: number;
}

export interface BoardRow {
  readonly rank: number;
  readonly profile: Profile;
  /** The selected chain's total in its unit; EVM wei on the all chains view. */
  readonly totalWei: string;
  readonly dropCount: number;
  readonly uniqueReceivers: number;
  /** Payouts, every final claim, the chains added up. */
  readonly claimCount: number;
  readonly biggestDropWei: string;
  readonly lastDropAt: number;
  /** Usd across every chain, the prices frozen at activation. Unpriced drops count zero. */
  readonly usd: number;
  readonly byChain: BoardChainTotals[];
}

/**
 * What the api takes. `fed` and `project` rank by people paid and are the two tabs
 * 12; `dropper` is the usd board kept for later, no tab shows it.
 */
export const BOARD_TYPES = ["fed", "dropper", "project"] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

export interface Board {
  readonly range: BoardRange;
  readonly kind: BoardKind;
  readonly board: BoardType;
  /** A pill key, or `all`. */
  readonly chain: string;
  readonly rankedBy: "totalWei" | "uniqueReceivers" | "usd";
  /** `false` would mean a board that cannot be built; `note` says why. Always true today. */
  readonly available: boolean;
  readonly note?: string;
  readonly finality: "final";
  readonly rows: BoardRow[];
}

export function getBoard(range: BoardRange, board: BoardType, chain: string): Promise<Board> {
  return request(`/api/boards?range=${range}&board=${board}&chain=${encodeURIComponent(chain)}`);
}

export interface UserPage {
  readonly profile: Profile;
  readonly totals:
    | {
        readonly available: true;
        readonly finality: "final";
        readonly totalWei: string;
        readonly dropCount: number;
        readonly uniqueReceivers: number;
        /** Payouts, every final claim. */
        readonly claimCount: number;
        readonly biggestDropWei: string;
        /** Usd from the prices frozen at activation, two decimals. Unpriced drops count zero. */
        readonly usd: number;
        /** Each coin apart. `totalWei` above is EVM wei only. */
        readonly byChain: BoardChainTotals[];
        /** The coin line under `dropped`, the same rule as the front page. */
        readonly dropped: DroppedItem[];
      }
    | { readonly available: false; readonly finality: "final" };
  readonly drops: OwnDropCard[];
}

export function getUser(handle: string): Promise<UserPage> {
  return request(`/api/users/${encodeURIComponent(handle)}`);
}
