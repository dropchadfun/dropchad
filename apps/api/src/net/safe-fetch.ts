/**
 * A fetch for links a stranger wrote . Today only
 * the token logo uses it -2.
 *
 * - **The link:** `https:` on port 443 only, no user or password. `ipfs://<path>` becomes
 *   `https://ipfs.io/ipfs/<path>`, one fixed gateway, then the same checks.
 * - **The address:** the name is resolved here and every address must be public; the
 *   connection goes to exactly the address that was checked (`pinnedLookup`), so a name that
 *   changes its answer between the check and the connect (DNS rebinding) cannot reach inside.
 * - **Redirects:** at most 3, each hop goes through every check again.
 * - **The answer:** 200 only, no compression, at most `maxBytes`, counted as the bytes arrive,
 *   whatever `Content-Length` says. No cookies are sent.
 * - **Time:** the caller's signal stops everything; the logo gives 5 seconds for all of it.
 *
 * DNS and the connection are passed in, so the tests never open a socket.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export type SafeFetchCode =
  | "bad_url"
  | "bad_scheme"
  | "bad_port"
  | "credentials"
  | "no_address"
  | "private_address"
  | "network"
  | "bad_status"
  | "too_many_redirects"
  | "compressed"
  | "too_large"
  | "timeout";

export class SafeFetchError extends Error {
  constructor(readonly code: SafeFetchCode) {
    super(`safe fetch refused: ${code}`);
    this.name = "SafeFetchError";
  }
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface RawResponse {
  readonly status: number;
  /** Lower case names. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  /** Close the connection; safe to call more than once. */
  destroy(): void;
}

export interface SafeFetchDeps {
  resolve(host: string): Promise<readonly ResolvedAddress[]>;
  /** One GET to `url`, connected to exactly `address`; the name stays the TLS name. */
  connect(request: {
    readonly url: URL;
    readonly address: string;
    readonly family: 4 | 6;
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  }): Promise<RawResponse>;
}

export interface SafeFetchOptions {
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

export interface SafeFetchResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The last hop. */
  readonly url: URL;
}

export type SafeFetch = (link: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const HEADERS: Readonly<Record<string, string>> = {
  accept: "*/*",
  "accept-encoding": "identity",
  "user-agent": "dropchad-logo/1",
};

// --- the link ----------------------------------------------------------------------------------

/** The rewritten, checked link. Throws `SafeFetchError` before any lookup. */
export function normaliseLink(link: string): URL {
  const text = /^ipfs:\/\//i.test(link) ? IPFS_GATEWAY + link.slice("ipfs://".length) : link;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SafeFetchError("bad_url");
  }
  if (url.protocol !== "https:") throw new SafeFetchError("bad_scheme");
  if (url.username !== "" || url.password !== "") throw new SafeFetchError("credentials");
  // The URL parser drops `:443`, so any port left is another port.
  if (url.port !== "") throw new SafeFetchError("bad_port");
  return url;
}

// --- the addresses -----------------------------------------------------------------------------

const BLOCKED_V4: readonly [string, number][] = [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link local, the cloud metadata address
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast included
];

/**
 * IPv6: only global unicast, `2000::/3`, and not the special parts inside it. Everything outside
 * is refused: loopback, unspecified, IPv4 inside IPv6 (`::ffff:0:0/96`, NAT64 `64:ff9b::/96`),
 * discard, unique local `fc00::/7`, link local `fe80::/10`, multicast `ff00::/8`.
 */
const BLOCKED_V6_INSIDE_GLOBAL: readonly [string, number][] = [
  ["2001::", 23], // protocol assignments, Teredo included
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, an IPv4 address inside
  ["3fff::", 20], // documentation
];

const blockedV4 = new BlockList();
for (const [net, prefix] of BLOCKED_V4) blockedV4.addSubnet(net, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [net, prefix] of BLOCKED_V6_INSIDE_GLOBAL) blockedV6.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !blockedV4.check(address, "ipv4");
    case 6:
      return globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
    default:
      return false;
  }
}

// --- the real transport ------------------------------------------------------------------------

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/** A `lookup` for `https.request` that answers the checked address, whatever it is asked. */
export function pinnedLookup(address: string, family: 4 | 6) {
  return (_hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    if (options.all === true) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

const nodeDeps: SafeFetchDeps = {
  async resolve(host) {
    const found = await dnsLookup(host, { all: true, verbatim: true });
    return found.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
  },
  connect({ url, address, family, headers, signal }) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        {
          protocol: "https:",
          hostname: host,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers,
          signal,
          agent: false,
          lookup: pinnedLookup(address, family) as unknown as LookupFunction,
          ...(isIP(host) === 0 ? { servername: host } : {}),
        },
        (response) => {
          const lower: Record<string, string | undefined> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            lower[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: lower,
            body: response as AsyncIterable<Uint8Array>,
            destroy: () => {
              response.destroy();
              request.destroy();
            },
          });
        },
      );
      request.on("error", reject);
      request.end();
    });
  },
};

// --- the fetch ---------------------------------------------------------------------------------

/** `promise`, or `timeout` as soon as the signal fires, whichever is first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SafeFetchError("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SafeFetchError("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(new SafeFetchError("timeout"));
        else reject(error instanceof Error ? error : new SafeFetchError("network"));
      },
    );
  });
}

async function checkedAddress(
  url: URL,
  deps: SafeFetchDeps,
  signal: AbortSignal,
): Promise<ResolvedAddress> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  let addresses: readonly ResolvedAddress[];
  if (literal !== 0) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await untilAborted(deps.resolve(host), signal);
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      throw new SafeFetchError("no_address");
    }
  }
  const first = addresses[0];
  if (first === undefined) throw new SafeFetchError("no_address");
  if (!addresses.every((a) => isPublicAddress(a.address))) {
    throw new SafeFetchError("private_address");
  }
  return first;
}

async function readBody(
  response: RawResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const iterator = response.body[Symbol.asyncIterator]();
  for (;;) {
    const next = await untilAborted(iterator.next(), signal);
    if (next.done === true) break;
    total += next.value.length;
    if (total > maxBytes) throw new SafeFetchError("too_large");
    chunks.push(next.value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export function createSafeFetch(deps: SafeFetchDeps = nodeDeps): SafeFetch {
  return async (link, { maxBytes, signal }) => {
    let url = normaliseLink(link);
    for (let hop = 0; ; hop += 1) {
      if (signal.aborted) throw new SafeFetchError("timeout");
      const target = await checkedAddress(url, deps, signal);
      let response: RawResponse;
      try {
        response = await untilAborted(
          deps.connect({ url, ...target, headers: HEADERS, signal }),
          signal,
        );
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        throw new SafeFetchError("network");
      }
      try {
        if (REDIRECTS.has(response.status)) {
          const location = response.headers["location"];
          if (location === undefined || location === "") throw new SafeFetchError("bad_status");
          if (hop >= MAX_REDIRECTS) throw new SafeFetchError("too_many_redirects");
          let next: URL;
          try {
            next = new URL(location, url);
          } catch {
            throw new SafeFetchError("bad_url");
          }
          url = normaliseLink(next.href);
          continue;
        }
        if (response.status !== 200) throw new SafeFetchError("bad_status");
        const encoding = response.headers["content-encoding"];
        if (encoding !== undefined && encoding.trim().toLowerCase() !== "identity") {
          throw new SafeFetchError("compressed");
        }
        const length = response.headers["content-length"];
        if (length !== undefined && Number(length) > maxBytes) {
          throw new SafeFetchError("too_large");
        }
        return { bytes: await readBody(response, maxBytes, signal), url };
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        throw new SafeFetchError("network");
      } finally {
        response.destroy();
      }
    }
  };
}
