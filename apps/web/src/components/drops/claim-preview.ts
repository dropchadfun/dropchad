/**
 * The dev only preview of the claim page, `/claim?preview=<screen>`. Its own
 * file so nothing else imports it: only `ClaimPage.tsx`, behind a `NODE_ENV` constant that a
 * production build folds to `false`. The same three walls as `/create?handleMode=on`.
 */
import type { ClaimItem } from "@/components/drops/claim";

export const CLAIM_PREVIEW_SCREENS = [
  "signed-out",
  "list",
  "nothing",
  "fresh-login",
  "paste",
  "confirm",
  "sending",
  "paid",
  "failed",
  "paused",
  "ended",
  "not-funded",
] as const;

export type ClaimPreviewScreen = (typeof CLAIM_PREVIEW_SCREENS)[number];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The screen to preview, or `null`. Development only (Next writes `NODE_ENV` in as a constant,
 * `production` in every real build), the laptop only, a known screen only. A preview never
 * calls the api: sample data, and the confirm's `claim` does nothing.
 */
export function claimPreviewScreen(
  search: string,
  env: { readonly nodeEnv: string | undefined; readonly hostname: string | undefined },
): ClaimPreviewScreen | null {
  if (env.nodeEnv !== "development") return null;
  if (env.hostname === undefined || !LOCAL_HOSTS.has(env.hostname)) return null;
  const screen = new URLSearchParams(search).get("preview");
  return (CLAIM_PREVIEW_SCREENS as readonly string[]).includes(screen ?? "")
    ? (screen as ClaimPreviewScreen)
    : null;
}

const SAMPLE_DEADLINE = String(Math.floor(Date.UTC(2026, 9, 12, 12) / 1000));

/** Made up here, never from the api. Every sender is `sample…`, so nothing looks real. */
export function sampleClaims(): ClaimItem[] {
  const base = {
    chainKey: "robinhood-testnet",
    chainId: 46630,
    title: null,
    symbol: "ETH",
    decimals: 18,
    index: 0,
    claimDeadline: SAMPLE_DEADLINE,
    recipient: null,
    claimTxHash: null,
  } as const;
  const sender = (handle: string) => ({ handle, displayName: handle, profileImageUrl: null });
  const drop = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  return [
    {
      ...base,
      drop: drop(0x5a01),
      sender: sender("samplechad"),
      title: "gm chads",
      amount: "500000000000000000",
      state: "claimable",
    },
    {
      ...base,
      drop: drop(0x5a02),
      sender: sender("sampledev"),
      amount: "250000000000000000",
      state: "sending",
      recipient: "0x1111111111111111111111111111111111110001",
    },
    {
      ...base,
      drop: drop(0x5a03),
      chainKey: "solana-devnet",
      chainId: 103,
      symbol: "SOL",
      decimals: 9,
      sender: sender("samplesol"),
      amount: "10000000",
      state: "failed",
    },
    {
      ...base,
      drop: drop(0x5a04),
      sender: sender("samplekol"),
      amount: "1000000000000000000",
      state: "paused",
    },
    {
      ...base,
      drop: drop(0x5a05),
      sender: sender("sampleproj"),
      amount: "100000000000000000",
      state: "not_funded",
      claimDeadline: null,
    },
    {
      ...base,
      drop: drop(0x5a06),
      sender: sender("sampleold"),
      amount: "300000000000000000",
      state: "ended",
    },
    {
      ...base,
      drop: drop(0x5a07),
      sender: sender("samplegm"),
      amount: "200000000000000000",
      state: "paid",
      recipient: "0x1111111111111111111111111111111111110001",
      claimTxHash: `0x${"fe".repeat(32)}`,
    },
  ];
}
