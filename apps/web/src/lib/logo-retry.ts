/**
 * The create card asks the logo route again: when the token check
 * answers `logoUrl` `null` and `logoPending` `true`, it asks 1, 3 and 6 seconds after the answer,
 * then stops. The first `200` gives the picture at once; until then the card shows the first
 * letter. Only the create card uses this; no other page asks again.
 */

/** When to ask, counted from the check's answer. */
export const LOGO_RETRY_MS = [1_000, 3_000, 6_000] as const;

/** Our own logo route for a Solana mint. */
const logoRoute = (mint: string) => `/api/tokens/${mint}/logo?chain=solana`;

/**
 * Ask the logo route at each of `LOGO_RETRY_MS` while nothing is shown yet. `probe` answers true
 * for a `200`. Returns the stop: no more asks, and an answer that comes back later shows nothing.
 */
export function watchLogo(
  check: { readonly mint: string; readonly logoUrl: string | null; readonly logoPending?: boolean },
  options: {
    readonly probe: (url: string) => Promise<boolean>;
    readonly onReady: (url: string) => void;
  },
): () => void {
  if (check.logoUrl !== null || check.logoPending !== true) return () => {};
  const url = logoRoute(check.mint);
  let stopped = false;
  const timers = LOGO_RETRY_MS.map((ms) =>
    setTimeout(() => {
      if (stopped) return;
      void options.probe(url).then(
        (ok) => {
          if (!ok || stopped) return;
          stopped = true;
          for (const timer of timers) clearTimeout(timer);
          options.onReady(url);
        },
        () => {},
      );
    }, ms),
  );
  return () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
  };
}

/** The real ask: a `GET` of our own route, never cached, true for a `200`. */
export async function probeLogo(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
