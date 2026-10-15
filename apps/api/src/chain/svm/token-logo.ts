/**
 * The token logo -2. The metadata `uri` points to a JSON
 * file; only its `image` field is read, then that image is fetched, both through
 * `src/net/safe-fetch.ts`.
 *
 * - 5 seconds for the whole logo, the JSON and the image together. The JSON at most 64 KB, the
 *   image at most 1 MB.
 * - The type comes from the image's first bytes, never from the sender's header: PNG, JPEG, GIF
 *   and WebP. SVG and everything else is no logo.
 * - It never throws: anything that goes wrong is `null`, and the token check stays as it was.
 * - The bytes are kept in memory, 24 hours per mint, 64 MB in all, oldest out first, and the
 *   browser gets them from our own route, `GET /api/tokens/:mint/logo`.
 */
import type { SafeFetch } from "../../net/safe-fetch.js";

export const LOGO_TIMEOUT_MS = 5_000;
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

/** The `image` field of the JSON, or `null`. */
function imageLink(bytes: Uint8Array): string | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const image = (parsed as Record<string, unknown>)["image"];
    return typeof image === "string" && image.trim() !== "" ? image : null;
  } catch {
    return null;
  }
}

export interface LogoFetcher {
  /** The logo behind a metadata `uri`, or `null`. Never throws. */
  fetch(uri: string): Promise<TokenLogo | null>;
}

export function createLogoFetcher(options: {
  readonly fetch: SafeFetch;
  readonly timeoutMs?: number;
}): LogoFetcher {
  const timeoutMs = options.timeoutMs ?? LOGO_TIMEOUT_MS;
  return {
    async fetch(uri) {
      if (uri.trim() === "") return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const signal = controller.signal;
      try {
        const json = await options.fetch(uri, { maxBytes: JSON_MAX_BYTES, signal });
        const link = imageLink(json.bytes);
        if (link === null) return null;
        const image = await options.fetch(link, { maxBytes: IMAGE_MAX_BYTES, signal });
        const contentType = sniffImage(image.bytes);
        return contentType === null ? null : { bytes: image.bytes, contentType };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface LogoStore {
  get(mint: string): TokenLogo | undefined;
  put(mint: string, logo: TokenLogo): void;
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
  const entries = new Map<string, { readonly at: number; readonly logo: TokenLogo }>();
  let total = 0;

  const remove = (mint: string) => {
    const entry = entries.get(mint);
    if (entry === undefined) return;
    entries.delete(mint);
    total -= entry.logo.bytes.length;
  };

  return {
    get(mint) {
      const entry = entries.get(mint);
      if (entry === undefined) return undefined;
      if (now().getTime() - entry.at >= ttlMs) {
        remove(mint);
        return undefined;
      }
      return entry.logo;
    },
    put(mint, logo) {
      remove(mint);
      if (logo.bytes.length > maxBytes) return;
      entries.set(mint, { at: now().getTime(), logo });
      total += logo.bytes.length;
      while (total > maxBytes) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        remove(oldest.value);
      }
    },
  };
}
