/**
 * The pause banner's text: from `createsOn` per chain on
 * `GET /api/chains`. The texts are exact, capitals and full stops included.
 * `null` is not off: a chain the api could not read shows nothing.
 */
import { apiOrigin } from "@/lib/api-origin";
import { TESTNET_ONLY } from "@/lib/chains";

/** The root layout waits this long at most; a slower read shows no banner. */
export const PAUSE_READ_TIMEOUT_MS = 1_500;

/** The chain name in the banner, by registry key. */
const NAMES: Readonly<Record<string, string>> = {
  solana: "Solana",
  "solana-devnet": "Solana",
  robinhood: "Robinhood",
  "robinhood-testnet": "Robinhood",
};

interface PauseRow {
  readonly key: string;
  readonly createsOn?: boolean | null;
  readonly offBy?: "api" | "program" | null;
}

/** three short lines, exactly as the owner wrote them. */
export const CLOSED_TESTNET_TEXT =
  "testnet is closed\nmainnet is next, Solana first\nopen drops can still be claimed";

/**
 * A testnet only site with every listed chain off by the api switch. Never on a
 * site with a mainnet chain live, never for a program pause, one chain off or a failed read.
 */
export function isClosedTestnet(chains: readonly PauseRow[], testnetOnly: boolean): boolean {
  return (
    testnetOnly &&
    chains.length > 0 &&
    chains.every((chain) => chain.createsOn === false && chain.offBy === "api")
  );
}

/** The one chain text, also what `/create` says on `creates_off`. */
export function oneChainPauseText(name: string): string {
  return `We are fixing something on ${name}. Short break. New ${name} drops are off. Claims still work.`;
}

const ALL_OFF = "We are fixing something. Short break. New drops are off. Claims still work.";

/** The chain name of a registry key, or `null` for a chain the banner does not know. */
export function pauseChainName(key: string): string | null {
  return NAMES[key] ?? null;
}

export function pauseBannerText(
  chains: readonly PauseRow[],
  testnetOnly: boolean = TESTNET_ONLY,
): string | null {
  if (isClosedTestnet(chains, testnetOnly)) return CLOSED_TESTNET_TEXT;
  const off = chains.filter((chain) => chain.createsOn === false);
  if (off.length === 0) return null;
  if (off.length === chains.length && chains.length > 1) return ALL_OFF;
  const names = [...new Set(off.map((chain) => pauseChainName(chain.key) ?? chain.key))];
  return names.length === 1 ? oneChainPauseText(names[0] as string) : ALL_OFF;
}

/**
 * The read in the root layout. Server side, no cookies, never cached. Any failure, a non 200 or
 * a read slower than `timeoutMs` is no banner: the page never waits on it or breaks on it.
 */
export async function readPauseText(
  options: {
    readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    readonly timeoutMs?: number;
    /** The site's testnet only flag; the build's `TESTNET_ONLY` when absent. */
    readonly testnetOnly?: boolean;
  } = {},
): Promise<string | null> {
  const fetchFn = options.fetch ?? fetch;
  const testnetOnly = options.testnetOnly ?? TESTNET_ONLY;
  const timeoutMs = options.timeoutMs ?? PAUSE_READ_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const read = (async () => {
    try {
      const response = await fetchFn(`${apiOrigin()}/api/chains`, { cache: "no-store" });
      if (!response.ok) return null;
      const body = (await response.json()) as { chains?: readonly PauseRow[] };
      return Array.isArray(body.chains) ? pauseBannerText(body.chains, testnetOnly) : null;
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
