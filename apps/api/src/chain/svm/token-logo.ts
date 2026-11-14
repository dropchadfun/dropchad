/**
 * The token logo -2. The metadata `uri` points to a JSON
 * file; its `image` field is read, then that image is fetched, both through
 * `src/net/safe-fetch.ts`. Its `twitter` field too, the token's
 * X link, from the same fetch and rebuilt by `xLinkOf`.
 *
 * - 20 seconds for the whole logo, the JSON and the image together, and 8 seconds for one
 *   request. An IPFS link is tried on `IPFS_GATEWAYS` in order, the next only when
 *   one fails. The JSON at most 64 KB, the image at most 1 MB.
 * - Run in the background only, by the token check, never inside a request.
 * - The type comes from the image's first bytes, never from the sender's header: PNG, JPEG, GIF
 *   and WebP. SVG and everything else is no logo.
 * - It never throws: anything that goes wrong is `null`, and the token check stays as it was.
 * - The bytes are kept in memory, 24 hours per mint, 64 MB in all, oldest out first, and the
 *   browser gets them from our own route, `GET /api/tokens/:mint/logo`.
 */
import { linksToTry, type SafeFetch, type SafeFetchResult } from "../../net/safe-fetch.js";

/** The whole logo, JSON and image, every gateway try included. */
export const LOGO_TIMEOUT_MS = 20_000;
/** one request. */
export const LOGO_REQUEST_TIMEOUT_MS = 8_000;
/** logos fetched at the same time. */
export const LOGO_MAX_RUNNING = 2;
/** how long a failed fetch is remembered, and for how many mints. */
export const LOGO_FAIL_TTL_MS = 60 * 60 * 1000;
export const LOGO_FAIL_MAX = 10_000;
export const JSON_MAX_BYTES = 64 * 1024;
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const LOGO_TTL_MS = 24 * 60 * 60 * 1000;
export const LOGO_STORE_MAX_BYTES = 64 * 1024 * 1024;

export type LogoType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface TokenLogo {
  /** A plain `ArrayBuffer` under it, so the route can send it as is. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: LogoType;
}

/** Our own link to a mint's logo, the `logoUrl` of the token check. */
export const logoPath = (mint: string) => `/api/tokens/${mint}/logo?chain=solana`;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  bytes.length >= at + prefix.length && prefix.every((b, i) => bytes[at + i] === b);
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");

/** The image type from its first bytes, or `null` for anything we do not serve. */
export function sniffImage(bytes: Uint8Array): LogoType | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return "image/gif";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  return null;
}

/** The JSON as an object, or `null` when it is broken or not an object. */
function jsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The `image` field of the JSON, or `null`. */
function imageLink(json: Record<string, unknown> | null): string | null {
  const image = json?.["image"];
  return typeof image === "string" && image.trim() !== "" ? image : null;
}

export const X_LINK_MAX = 200;
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);

/**
 * The JSON's `twitter` field as the token's X link: an `https` link on
 * `x.com` or `twitter.com`, no user, password or port, a path, at most 200 characters, rebuilt
 * as `https://x.com/<path>` with the query and fragment dropped. Anything else is `null`.
 */
export function xLinkOf(value: unknown): string | null {
  if (typeof value !== "string" || value.length > X_LINK_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !X_HOSTS.has(url.hostname)) return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;
  if (url.pathname === "" || url.pathname === "/") return null;
  const link = `https://x.com${url.pathname}`;
  return link.length > X_LINK_MAX ? null : link;
}

/** What one metadata JSON gives: the logo and the X link, each `null` when there is none. */
export interface TokenMeta {
  readonly logo: TokenLogo | null;
  readonly xUrl: string | null;
}

export interface LogoFetcher {
  /** The logo behind a metadata `uri`, or `null`. Never throws. */
  fetch(uri: string): Promise<TokenLogo | null>;
  /** The logo and the X link behind a metadata `uri`, from one JSON fetch. Never throws. */
  meta(uri: string): Promise<TokenMeta>;
}

export function createLogoFetcher(options: {
  readonly fetch: SafeFetch;
  readonly timeoutMs?: number;
  readonly requestTimeoutMs?: number;
}): LogoFetcher {
  const timeoutMs = options.timeoutMs ?? LOGO_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? LOGO_REQUEST_TIMEOUT_MS;
  const none: TokenMeta = { logo: null, xUrl: null };

  /**
   * One link: each link to try in order, each with its own time limit inside the whole one.
   * The last failure is thrown when none answers; a bad IPFS link throws before any lookup.
   */
  async function get(link: string, maxBytes: number, whole: AbortSignal): Promise<SafeFetchResult> {
    let last: unknown = new Error("no link to try");
    for (const candidate of linksToTry(link)) {
      if (whole.aborted) break;
      const signal = AbortSignal.any([whole, AbortSignal.timeout(requestTimeoutMs)]);
      try {
        return await options.fetch(candidate, { maxBytes, signal });
      } catch (error) {
        last = error;
      }
    }
    throw last;
  }

  async function meta(uri: string): Promise<TokenMeta> {
    if (uri.trim() === "") return none;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;
    let xUrl: string | null = null;
    try {
      const json = jsonObject((await get(uri, JSON_MAX_BYTES, signal)).bytes);
      xUrl = xLinkOf(json?.["twitter"]);
      const link = imageLink(json);
      if (link === null) return { logo: null, xUrl };
      const image = await get(link, IMAGE_MAX_BYTES, signal);
      const contentType = sniffImage(image.bytes);
      return { logo: contentType === null ? null : { bytes: image.bytes, contentType }, xUrl };
    } catch {
      // A link read before the image failed is still the token's link.
      return { logo: null, xUrl };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    meta,
    async fetch(uri) {
      return (await meta(uri)).logo;
    },
  };
}

export interface LogoStore {
  get(mint: string): TokenLogo | undefined;
  /**
   * The X link kept for a mint, with its logo or alone: `null` when it had none,
   * `undefined` when nothing is kept.
   */
  xUrl(mint: string): string | null | undefined;
  /** A logo, an X link, or both, for 24 hours. Neither keeps nothing. */
  put(mint: string, logo: TokenLogo | null, xUrl?: string | null): void;
}

export function createLogoStore(
  options: {
    readonly now?: () => Date;
    readonly ttlMs?: number;
    readonly maxBytes?: number;
  } = {},
): LogoStore {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? LOGO_TTL_MS;
  const maxBytes = options.maxBytes ?? LOGO_STORE_MAX_BYTES;
  // A Map keeps the order things were put in, so the first key is the oldest.
  const entries = new Map<
    string,
    { readonly at: number; readonly logo: TokenLogo | null; readonly xUrl: string | null }
  >();
  let total = 0;
  // The link counts toward the cap too, so links alone cannot grow without end.
  const sizeOf = (logo: TokenLogo | null, xUrl: string | null) =>
    (logo?.bytes.length ?? 0) + (xUrl?.length ?? 0);

  const remove = (mint: string) => {
    const entry = entries.get(mint);
    if (entry === undefined) return;
    entries.delete(mint);
    total -= sizeOf(entry.logo, entry.xUrl);
  };

  /** The live entry, or `undefined`; a stale one goes. */
  const live = (mint: string) => {
    const entry = entries.get(mint);
    if (entry === undefined) return undefined;
    if (now().getTime() - entry.at >= ttlMs) {
      remove(mint);
      return undefined;
    }
    return entry;
  };

  return {
    get(mint) {
      return live(mint)?.logo ?? undefined;
    },
    xUrl(mint) {
      return live(mint)?.xUrl;
    },
    put(mint, logo, xUrl = null) {
      remove(mint);
      const size = sizeOf(logo, xUrl);
      if ((logo === null && xUrl === null) || size > maxBytes) return;
      entries.set(mint, { at: now().getTime(), logo, xUrl });
      total += size;
      while (total > maxBytes) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        remove(oldest.value);
      }
    },
  };
}
