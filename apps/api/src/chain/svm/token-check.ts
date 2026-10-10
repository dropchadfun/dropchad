/**
 * The token check -1. Someone pastes a token address; this
 * reads the mint from the chain and says whether it can be dropped, with its name and ticker.
 * Read only, no key. The program checks the same rules again at `create_drop`.
 *
 * One `getMultipleAccounts` reads three accounts: the mint, its Metaplex metadata and its
 * pump.fun bonding curve. The answer is kept 60 seconds per mint, so pasting again is free.
 *
 * - **The rules, in order; the first that fails gives the one reason.** Not a token; a freeze
 *   authority, except the allowlisted mints; then the Token-2022 extensions, default deny with only
 *   `MetadataPointer` and `TokenMetadata` allowed. A mint authority is
 *   allowed: it cannot take tokens back.
 * - **Name and ticker**: `tokenMetadata` inside a Token-2022 mint, else Metaplex, else `null`;
 *   a token with no name is still fine, the web shows the short address.
 *   Untrusted text, cut to 32 and 10 characters.
 * - **Launchpad**: `pump.fun` only when the bonding curve passes the three checks of
 *   Never from the `pump` ending.
 * - **The logo** (4b-2): the metadata `uri`, only for a token that passes, through
 *   `./token-logo.ts`. A logo that fails is `logoUrl: null` and changes nothing else. The kept
 *   bytes are served by `GET /api/tokens/:mint/logo`, never the stranger's link.
 * - Never a price, a usd value or a market cap.
 */
import { createHash } from "node:crypto";

import { findProgramAddress } from "./pda.js";
import { pubkeyEquals, pubkeyFromBase58, pubkeyToBase58, type Pubkey } from "./pubkey.js";
import type { AccountInfo, SvmRpc } from "./rpc.js";
import { logoPath, type LogoFetcher, type LogoStore, type TokenLogo } from "./token-logo.js";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const METAPLEX_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/**
 * the only mints accepted with a freeze authority: USDC mainnet, USDT mainnet, USDC
 * devnet. The same list as the program's `FREEZE_EXCEPTION_MINTS`, `constants.rs`.
 */
const FREEZE_EXCEPTION_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
]);

/**
 * `ExtensionType` numbers, the order of the enum in `spl-token-2022-interface` 2.1.0, the crate
 * the program uses. Only the two metadata ones are allowed; the named ones get their own words.
 */
const EXT_METADATA_POINTER = 18;
const EXT_TOKEN_METADATA = 19;
const EXTENSION_REASONS = new Map<number, string>([
  [1, "it takes a tax on every transfer"], // TransferFeeConfig
  [12, "the creator can take tokens back"], // PermanentDelegate
  [14, "it runs extra code on every transfer"], // TransferHook
  [9, "it cannot be moved"], // NonTransferable
]);
const OTHER_EXTENSION = "it has a feature we do not allow yet";

/** The SPL mint: 82 bytes, also the start of a Token-2022 mint. */
const MINT_BYTES = 82;
/** Token-2022: the base is padded to a token account's 165 bytes, then the account type. */
const ACCOUNT_TYPE_OFFSET = 165;
const ACCOUNT_TYPE_MINT = 1;

const NAME_MAX = 32;
const SYMBOL_MAX = 10;
/** The Metaplex limit; a longer `uri` in `tokenMetadata` is no logo, never a cut link. */
const URI_MAX = 200;
const METAPLEX_KEY_METADATA = 4;
/** sha256 of `account:BondingCurve`, the first 8 bytes. */
const CURVE_DISCRIMINATOR = createHash("sha256")
  .update("account:BondingCurve")
  .digest()
  .subarray(0, 8);

export interface TokenCheck {
  readonly mint: string;
  /** The token program's address, `null` when it is not a token. */
  readonly tokenProgram: string | null;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  /** Our own route, `/api/tokens/<mint>/logo?chain=solana`, when a logo was fetched. */
  readonly logoUrl: string | null;
  readonly launchpad: "pump.fun" | null;
  readonly ok: boolean;
  /** One plain reason when `ok` is false. */
  readonly reason: string | null;
}

export interface TokenChecker {
  /** Throws when the chain cannot be read; a bad answer is never cached. */
  check(mint: string): Promise<TokenCheck>;
  /**
   * The kept logo, else the check and the fetch, else `null`. Throws only when the chain
   * cannot be read.
   */
  logo(mint: string): Promise<TokenLogo | null>;
}

export interface TokenCheckerOptions {
  readonly rpc: Pick<SvmRpc, "getMultipleAccounts">;
  readonly now?: () => Date;
  /** How long one mint's answer is reused. */
  readonly cacheMs?: number;
  /** The logo fetch and the bytes kept. Absent: `logoUrl` is always `null`. */
  readonly logos?: { readonly fetcher: LogoFetcher; readonly store: LogoStore };
}

const enc = new TextEncoder();

export function metaplexAddress(mint: Pubkey): Pubkey {
  const program = pubkeyFromBase58(METAPLEX_PROGRAM);
  return findProgramAddress([enc.encode("metadata"), program, mint], program).address;
}

export function bondingCurveAddress(mint: Pubkey): Pubkey {
  return findProgramAddress([enc.encode("bonding-curve"), mint], pubkeyFromBase58(PUMP_PROGRAM))
    .address;
}

/** A little cursor over untrusted bytes. Any read past the end throws, and the caller decides. */
class Reader {
  private at: number;
  constructor(
    private readonly bytes: Uint8Array,
    start = 0,
  ) {
    this.at = start;
  }
  take(n: number): Uint8Array {
    if (n < 0 || this.at + n > this.bytes.length) throw new RangeError("short read");
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  u32(): number {
    const b = this.take(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  }
  string(): string {
    return new TextDecoder().decode(this.take(this.u32()));
  }
}

const u16At = (b: Uint8Array, at: number) =>
  new DataView(b.buffer, b.byteOffset + at, 2).getUint16(0, true);
const u32At = (b: Uint8Array, at: number) =>
  new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, true);

/** Zero padding off the end, then at most `max` characters, never half an emoji. */
function clean(text: string, max: number): string | null {
  const trimmed = text.replace(/\0+$/, "");
  if (trimmed.length === 0) return null;
  return Array.from(trimmed).slice(0, max).join("");
}

interface MintFields {
  readonly decimals: number;
  readonly hasFreezeAuthority: boolean;
}

/** The 82 byte base: mint authority option, supply, decimals, init flag, freeze option. */
function readMintBase(data: Uint8Array): MintFields | null {
  if (data.length < MINT_BYTES) return null;
  if (data[45] !== 1) return null; // not initialised
  return { decimals: data[44] as number, hasFreezeAuthority: u32At(data, 46) !== 0 };
}

interface Extension {
  readonly type: number;
  readonly value: Uint8Array;
}

/** The TLV list after the account type, the way the crate walks it: type 0 or the end stops. */
function readExtensions(data: Uint8Array): Extension[] {
  const out: Extension[] = [];
  let at = ACCOUNT_TYPE_OFFSET + 1;
  while (at + 4 <= data.length) {
    const type = u16At(data, at);
    if (type === 0) break;
    const length = u16At(data, at + 2);
    const end = at + 4 + length;
    if (end > data.length) throw new RangeError("extension past the end");
    out.push({ type, value: data.subarray(at + 4, end) });
    at = end;
  }
  return out;
}

interface Names {
  readonly name: string | null;
  readonly symbol: string | null;
  /** The metadata link to the logo JSON, `null` when empty or too long. */
  readonly uri: string | null;
}

function readNames(r: Reader): Names {
  const name = clean(r.string(), NAME_MAX);
  const symbol = clean(r.string(), SYMBOL_MAX);
  let uri: string | null = null;
  try {
    uri = clean(r.string(), Number.MAX_SAFE_INTEGER);
  } catch {
    // A name and a ticker with a broken link after them are still a name and a ticker.
  }
  return { name, symbol, uri: uri !== null && uri.length <= URI_MAX ? uri : null };
}

/** `tokenMetadata`: update authority, mint, then name, symbol, uri as borsh strings. */
function readTokenMetadata(value: Uint8Array, mint: Pubkey): Names | null {
  try {
    const r = new Reader(value);
    r.take(32);
    if (!pubkeyEquals(r.take(32), mint)) return null;
    return readNames(r);
  } catch {
    return null;
  }
}

/** Metaplex, trusted only with its owner, key 4 and this mint inside. */
function readMetaplex(account: AccountInfo | null, mint: Pubkey): Names | null {
  if (account === null || pubkeyToBase58(account.owner) !== METAPLEX_PROGRAM) return null;
  try {
    const r = new Reader(account.data);
    if (r.take(1)[0] !== METAPLEX_KEY_METADATA) return null;
    r.take(32);
    if (!pubkeyEquals(r.take(32), mint)) return null;
    return readNames(r);
  } catch {
    return null;
  }
}

/** the right address (asked for), the pump program's, the right start. */
function isPumpCurve(account: AccountInfo | null): boolean {
  if (account === null || pubkeyToBase58(account.owner) !== PUMP_PROGRAM) return false;
  if (account.data.length < 8) return false;
  return pubkeyEquals(account.data.subarray(0, 8), CURVE_DISCRIMINATOR);
}

const notAToken = (mint: string): TokenCheck => ({
  mint,
  tokenProgram: null,
  name: null,
  symbol: null,
  decimals: null,
  logoUrl: null,
  launchpad: null,
  ok: false,
  reason: "not a token",
});

interface Judged {
  readonly check: TokenCheck;
  /** The logo JSON link, only for a token that passes. */
  readonly uri: string | null;
}

/** The rules on three accounts already read. Pure, so every rule is one test. */
export function judgeMint(
  mintText: string,
  mintAccount: AccountInfo | null,
  metaplexAccount: AccountInfo | null,
  curveAccount: AccountInfo | null,
): Judged {
  const refused = { check: notAToken(mintText), uri: null };
  if (mintAccount === null) return refused;
  const mint = pubkeyFromBase58(mintText);
  const program = pubkeyToBase58(mintAccount.owner);
  const data = mintAccount.data;

  let extensions: Extension[] = [];
  if (program === TOKEN_PROGRAM) {
    if (data.length !== MINT_BYTES) return refused;
  } else if (program === TOKEN_2022_PROGRAM) {
    if (data.length !== MINT_BYTES) {
      if (data.length <= ACCOUNT_TYPE_OFFSET || data[ACCOUNT_TYPE_OFFSET] !== ACCOUNT_TYPE_MINT)
        return refused;
      try {
        extensions = readExtensions(data);
      } catch {
        return refused;
      }
    }
  } else {
    return refused;
  }

  const base = readMintBase(data);
  if (base === null) return refused;

  const inside = extensions.find((e) => e.type === EXT_TOKEN_METADATA);
  const names = (inside && readTokenMetadata(inside.value, mint)) ??
    readMetaplex(metaplexAccount, mint) ?? { name: null, symbol: null, uri: null };

  let reason: string | null = null;
  if (base.hasFreezeAuthority && !FREEZE_EXCEPTION_MINTS.has(mintText)) {
    reason = "the creator can freeze it";
  } else {
    const blocked = extensions.find(
      (e) => e.type !== EXT_METADATA_POINTER && e.type !== EXT_TOKEN_METADATA,
    );
    if (blocked !== undefined) reason = EXTENSION_REASONS.get(blocked.type) ?? OTHER_EXTENSION;
  }

  return {
    check: {
      mint: mintText,
      tokenProgram: program,
      name: names.name,
      symbol: names.symbol,
      decimals: base.decimals,
      logoUrl: null,
      launchpad: isPumpCurve(curveAccount) ? "pump.fun" : null,
      ok: reason === null,
      reason,
    },
    uri: reason === null ? names.uri : null,
  };
}

export function createTokenChecker(options: TokenCheckerOptions): TokenChecker {
  const now = options.now ?? (() => new Date());
  const cacheMs = options.cacheMs ?? 60_000;
  const logos = options.logos;
  const cache = new Map<
    string,
    { readonly at: number; readonly value: TokenCheck; readonly uri: string | null }
  >();

  /** Fetch and keep the logo; `true` when there is one. Never throws. */
  async function fetchLogo(mintText: string, uri: string): Promise<boolean> {
    if (logos === undefined) return false;
    const logo = await logos.fetcher.fetch(uri);
    if (logo === null) return false;
    logos.store.put(mintText, logo);
    return true;
  }

  async function check(mintText: string): Promise<TokenCheck> {
    const at = now().getTime();
    const hit = cache.get(mintText);
    if (hit !== undefined && at - hit.at < cacheMs) return hit.value;

    const mint = pubkeyFromBase58(mintText);
    const [mintAccount, metaplexAccount, curveAccount] = await options.rpc.getMultipleAccounts(
      [mint, metaplexAddress(mint), bondingCurveAddress(mint)],
      "confirmed",
    );
    const judged = judgeMint(
      mintText,
      mintAccount ?? null,
      metaplexAccount ?? null,
      curveAccount ?? null,
    );
    let value = judged.check;
    if (judged.uri !== null && logos !== undefined) {
      const kept = logos.store.get(mintText) !== undefined;
      if (kept || (await fetchLogo(mintText, judged.uri))) {
        value = { ...value, logoUrl: logoPath(mintText) };
      }
    }
    // A cheap sweep keeps the map to live answers only.
    for (const [key, entry] of cache) if (at - entry.at >= cacheMs) cache.delete(key);
    cache.set(mintText, { at, value, uri: judged.uri });
    return value;
  }

  return {
    check,
    async logo(mintText) {
      if (logos === undefined) return null;
      const kept = logos.store.get(mintText);
      if (kept !== undefined) return kept;
      const hit = cache.get(mintText);
      if (hit !== undefined && now().getTime() - hit.at < cacheMs) {
        // A fresh check: no logo stays no logo; one the store let go is fetched again.
        if (hit.value.logoUrl === null || hit.uri === null) return null;
        await fetchLogo(mintText, hit.uri);
      } else {
        await check(mintText);
      }
      return logos.store.get(mintText) ?? null;
    },
  };
}
