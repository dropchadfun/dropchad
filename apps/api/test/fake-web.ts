/**
 * A fake internet for `src/net/safe-fetch.ts`: names that resolve to addresses, and pages by
 * full link. No socket is ever opened. Every lookup and every connection is logged, so a test
 * can say "no connection was made" or "it connected to exactly this address".
 */
import type { RawResponse, SafeFetchDeps } from "../src/net/safe-fetch.js";

export interface FakePage {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /** The whole body, or chunks; `endless` sends 64 KB chunks forever. */
  readonly body?: string | Uint8Array | readonly Uint8Array[];
  readonly endless?: boolean;
  /** Never answers; only the abort signal ends it. */
  readonly hang?: boolean;
  /** Answers the headers, then the body never comes. */
  readonly hangBody?: boolean;
}

export interface Connection {
  readonly href: string;
  readonly host: string;
  readonly address: string;
  readonly headers: Record<string, string>;
}

const CHUNK = 64 * 1024;
const enc = new TextEncoder();

function toChunks(body: FakePage["body"]): Uint8Array[] {
  if (body === undefined) return [];
  if (typeof body === "string") return [enc.encode(body)];
  if (body instanceof Uint8Array) return [body];
  return [...body];
}

const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

export function fakeWeb() {
  const dns = new Map<string, readonly string[]>();
  const pages = new Map<string, FakePage>();
  const log = {
    resolves: [] as string[],
    connects: [] as Connection[],
    chunksRead: 0,
    destroyed: 0,
  };

  const deps: SafeFetchDeps = {
    resolve(host) {
      log.resolves.push(host);
      const addresses = dns.get(host);
      if (addresses === undefined) return Promise.reject(new Error(`ENOTFOUND ${host}`));
      return Promise.resolve(
        addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      );
    },
    connect({ url, address, headers, signal }) {
      log.connects.push({ href: url.href, host: url.hostname, address, headers: { ...headers } });
      const page = pages.get(url.href) ?? { status: 404, body: "not found" };
      if (page.hang === true) return aborted(signal);
      const chunks = toChunks(page.body);
      const body: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          if (page.hangBody === true) await aborted(signal);
          if (page.endless === true) {
            for (;;) {
              log.chunksRead += 1;
              yield new Uint8Array(CHUNK).fill(0x41);
            }
          }
          for (const chunk of chunks) {
            log.chunksRead += 1;
            yield chunk;
          }
        },
      };
      const response: RawResponse = {
        status: page.status ?? 200,
        headers: Object.fromEntries(
          Object.entries(page.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
        ),
        body,
        destroy: () => {
          log.destroyed += 1;
        },
      };
      return Promise.resolve(response);
    },
  };

  return {
    deps,
    log,
    host(name: string, ...addresses: string[]) {
      dns.set(name, addresses);
    },
    page(href: string, page: FakePage) {
      pages.set(href, page);
    },
  };
}

// --- image bytes, only the first bytes matter -------------------------------------------------

export const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
export const GIF87 = enc.encode("GIF87a\x01\x00\x01\x00");
export const GIF89 = enc.encode("GIF89a\x01\x00\x01\x00");
export const WEBP = Uint8Array.from([
  ...enc.encode("RIFF"),
  0x24,
  0,
  0,
  0,
  ...enc.encode("WEBPVP8 "),
]);
export const SVG = enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>');
export const HTML = enc.encode("<!doctype html><script>x()</script>");
export const WAVE = Uint8Array.from([
  ...enc.encode("RIFF"),
  0x24,
  0,
  0,
  0,
  ...enc.encode("WAVEfmt "),
]);

/** `bytes` padded with zeros up to `size`. */
export function padTo(bytes: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  out.set(bytes);
  return out;
}
