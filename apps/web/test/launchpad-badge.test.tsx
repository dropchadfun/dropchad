/**
 * The launched on badge and the Dexscreener button
 * the same day: the badge is off, the list
 * stays with pump.fun off; the Dexscreener button on every mainnet token drop with the official
 * logo. Rendered with `react-dom/server`, no browser.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DropRows } from "@/components/drops/DropRows";
import { LaunchpadBadge } from "@/components/drops/LaunchpadBadge";
import { TokenRow } from "@/components/drops/TokenRow";
import { fromOwnCard } from "@/components/drops/drop-card-data";
import type { OwnDropCard, Profile, TokenInfo } from "@/lib/api";
import { DEXSCREENER_CHAINS, dexscreenerUrl } from "@/lib/dexscreener";
import { LAUNCHPADS, launchpadOf, type Launchpad } from "@/lib/launchpads";
import { tokenPageLink } from "@/lib/token";

const WEB = join(__dirname, "..");
const SOLANA = 101;
const DEVNET = 103;
const ROBINHOOD = 4663;
const ROBINHOOD_TESTNET = 46630;
const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const LOGO = "/launchpads/pump-fun.png";

/** A pump.fun coin, as the api sends it when the token check found its bonding curve. */
const PUMP: TokenInfo = {
  mint: "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump",
  symbol: "CHAD",
  name: "Chad Coin",
  decimals: 6,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  logoUrl: "/api/tokens/77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump/logo?chain=solana",
  launchpad: "pump.fun",
};

/** A token from no known launchpad. */
const PLAIN: TokenInfo = {
  ...PUMP,
  mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  launchpad: null,
};

/** The devnet USDC quick token. Even with a launchpad set it never gets a badge. */
const DEVNET_USDC: TokenInfo = {
  ...PUMP,
  mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  symbol: "USDC",
  name: "USD Coin",
  launchpad: "pump.fun",
};

/** Mainnet USDC, a quick token on `solana`. */
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const creator = {
  xUserId: "1",
  handle: "sample",
  displayName: "sample",
  profileImageUrl: null,
  kind: "chad",
  tags: ["chad"],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

function own(token: TokenInfo | null, chainId = DEVNET): OwnDropCard {
  return {
    address: DROP,
    chainId,
    asset: token?.mint ?? "11111111111111111111111111111111",
    token,
    title: null,
    memeImageUrl: null,
    state: "active",
    mode: "handle",
    totalEntitlementsWei: "100000000",
    leafCount: 2,
    paidCount: 1,
    failedIndexes: [],
    createTxHash: "5Rn383Wc",
    activateTxHash: "67kNjoxu",
    lastTxHash: "5D847vwi",
    fundingDeadline: "1790838985",
    createdAt: "2026-10-03T07:16:25.000Z",
    creator,
  };
}

const rows = (token: TokenInfo | null, chainId = DEVNET) =>
  renderToStaticMarkup(<DropRows rows={[fromOwnCard(own(token, chainId))]} />);
const tokenRow = (token: TokenInfo, chainId = DEVNET) =>
  renderToStaticMarkup(<TokenRow token={token} chainId={chainId} />);
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** The same pump.fun entry turned on, to check the badge's look for the day one is on. */
const ON: readonly Launchpad[] = [{ id: "pump.fun", name: "pump.fun", logo: null, on: true }];
const DEX_LOGO = "/launchpads/dexscreener-logo.png";
/** The file: 736 by 736 PNG. Byte for byte, never changed. */
const DEX_LOGO_SHA256 = "49bc369dabe42320da826634a1f463d94c32f2de03b8edc18ee4b4758d22c60f";
/** CASHCAT on Robinhood mainnet: Dexscreener's own api lists it under `robinhood`. */
const ROBINHOOD_TOKEN = "0x020bfC650A365f8BB26819deAAbF3E21291018b4";

describe("the launchpads we know", () => {
  it("the list stays, pump.fun in it, nothing turned on", () => {
    // A later launchpad is one entry here plus its own on chain check in the api.
    expect(LAUNCHPADS.map((pad) => pad.id)).toEqual(["pump.fun"]);
    expect(LAUNCHPADS.every((pad) => !pad.on)).toBe(true);
    expect(launchpadOf("pump.fun")).toBeUndefined();
    expect(launchpadOf("bonk")).toBeUndefined();
    expect(launchpadOf(null)).toBeUndefined();
    expect(launchpadOf(undefined)).toBeUndefined();
  });

  it("an entry that is turned on is found", () => {
    expect(launchpadOf("pump.fun", ON)?.name).toBe("pump.fun");
    expect(launchpadOf("bonk", ON)).toBeUndefined();
  });

  it("the pump.fun logo is the file in the repo, or none: words only", () => {
    const file = join(WEB, "public", "launchpads", "pump-fun.png");
    const logo = LAUNCHPADS.find((pad) => pad.id === "pump.fun")?.logo;
    if (existsSync(file)) {
      expect(logo).toBe(LOGO);
      expect(readFileSync(file).subarray(1, 4).toString("ascii")).toBe("PNG");
    } else {
      expect(logo).toBeNull();
    }
  });
});

describe("the badge is off", () => {
  it("no drop shows it, not even pump.fun", () => {
    expect(renderToStaticMarkup(<LaunchpadBadge token={PUMP} chainId={DEVNET} />)).toBe("");
    expect(renderToStaticMarkup(<LaunchpadBadge token={PUMP} chainId={DEVNET} compact />)).toBe("");
    expect(rows(PUMP)).not.toContain("launched on");
    expect(rows(PUMP)).not.toContain("pump.fun");
    expect(tokenRow(PUMP)).not.toContain("launched on");
    expect(tokenRow(PUMP)).not.toContain("pump.fun");
    expect(tokenRow(PUMP, SOLANA)).not.toContain("pump.fun");
  });

  it("never on boards: a board row is a person", () => {
    for (const file of ["BoardRows.tsx", "BoardBlock.tsx", "BoardsPage.tsx"]) {
      const src = readFileSync(join(WEB, "src", "components", "boards", file), "utf8");
      expect(src).not.toContain("LaunchpadBadge");
    }
  });
});

describe("the badge, the day one is turned on", () => {
  it("launched on pump.fun, grey, radius 8, 22px, on the raised fill", () => {
    const html = renderToStaticMarkup(
      <LaunchpadBadge token={PUMP} chainId={DEVNET} logo={null} launchpads={ON} />,
    );
    expect(words(html).trim()).toBe("launched on pump.fun");
    expect(html).toMatch(/class="[^"]*\bh-5\.5\b/);
    expect(html).toContain("rounded-md");
    expect(html).toContain("bg-chad-surface-2");
    expect(html).toContain("border-chad-border");
    expect(html).toContain("type-small");
    expect(html).toContain("text-chad-text-dim");
    expect(html).not.toMatch(/chad-accent|chad-up|chad-badge|chad-brand-mint/);
  });

  it("the logo at 12px before the words; compact shows the logo only on the phone", () => {
    const full = renderToStaticMarkup(
      <LaunchpadBadge token={PUMP} chainId={DEVNET} logo={LOGO} launchpads={ON} />,
    );
    expect(full).toContain(`src="${LOGO}"`);
    expect(full).toContain('width="12"');
    expect(full.indexOf("<img")).toBeLessThan(full.indexOf("launched on"));
    const compact = renderToStaticMarkup(
      <LaunchpadBadge token={PUMP} chainId={DEVNET} logo={LOGO} launchpads={ON} compact />,
    );
    expect(compact).toContain('aria-label="launched on pump.fun"');
    expect(compact).toMatch(
      /<span class="[^"]*\bhidden\b[^"]*\bmd:inline\b[^"]*"[^>]*>pump\.fun<\/span>/,
    );
  });

  it("still nothing without a launchpad, without a token, or on a stablecoin", () => {
    const none = (token: TokenInfo | null) =>
      renderToStaticMarkup(<LaunchpadBadge token={token} chainId={DEVNET} launchpads={ON} />);
    expect(none(PLAIN)).toBe("");
    expect(none({ ...PUMP, launchpad: "bonk" })).toBe("");
    expect(none(null)).toBe("");
    expect(none(DEVNET_USDC)).toBe("");
  });
});

describe("the Dexscreener link", () => {
  it("solana and robinhood in the map, Dexscreener's own chain names", () => {
    expect(DEXSCREENER_CHAINS).toEqual({ solana: "solana", robinhood: "robinhood" });
  });

  it("every mainnet token drop, whatever its launchpad", () => {
    expect(dexscreenerUrl(SOLANA, PUMP.mint)).toBe(`https://dexscreener.com/solana/${PUMP.mint}`);
    expect(dexscreenerUrl(SOLANA, PLAIN.mint)).toBe(`https://dexscreener.com/solana/${PLAIN.mint}`);
    expect(dexscreenerUrl(ROBINHOOD, ROBINHOOD_TOKEN)).toBe(
      `https://dexscreener.com/robinhood/${ROBINHOOD_TOKEN}`,
    );
  });

  it("hidden on every testnet, on stablecoins and on a chain we do not know", () => {
    expect(dexscreenerUrl(DEVNET, PUMP.mint)).toBeNull();
    expect(dexscreenerUrl(ROBINHOOD_TESTNET, ROBINHOOD_TOKEN)).toBeNull();
    expect(dexscreenerUrl(SOLANA, MAINNET_USDC)).toBeNull();
    expect(dexscreenerUrl(999999, PUMP.mint)).toBeNull();
  });

  it("the logo is the file, byte for byte", () => {
    const file = readFileSync(join(WEB, "public", "launchpads", "dexscreener-logo.png"));
    expect(createHash("sha256").update(file).digest("hex")).toBe(DEX_LOGO_SHA256);
  });

  it("the button: the owner's logo at 14px before the words, no lucide icon, a quiet pill, a new tab", () => {
    for (const [html, href] of [
      [tokenRow(PUMP, SOLANA), `https://dexscreener.com/solana/${PUMP.mint}`],
      [tokenRow(PLAIN, SOLANA), `https://dexscreener.com/solana/${PLAIN.mint}`],
      [
        tokenRow({ ...PLAIN, mint: ROBINHOOD_TOKEN }, ROBINHOOD),
        `https://dexscreener.com/robinhood/${ROBINHOOD_TOKEN}`,
      ],
    ] as const) {
      const button =
        html.match(/<a [^>]*href="https:\/\/dexscreener\.com[^"]*"[^>]*>.*?<\/a>/)?.[0] ?? "";
      expect(button).toContain(`href="${href}"`);
      expect(button).toContain('target="_blank"');
      expect(button).toContain('rel="noopener noreferrer"');
      expect(button).toContain("chart on dexscreener");
      expect(button).toContain(`src="${DEX_LOGO}"`);
      expect(button).toContain('width="14"');
      expect(button).toContain('height="14"');
      expect(button).toContain('alt=""');
      expect(button).not.toContain("<svg");
      expect(button.indexOf("<img")).toBeLessThan(button.indexOf("chart on dexscreener"));
      expect(button).toContain("min-h-11");
      expect(button).toContain("md:min-h-8");
      expect(button).toContain("rounded-full");
      expect(button).toContain("text-chad-text-dim");
      expect(button).toContain("hover:text-chad-text");
      expect(button).not.toMatch(/chad-accent|chad-up/);
    }
  });

  it("no button on a testnet token row or a mainnet stablecoin", () => {
    expect(tokenRow(PUMP, DEVNET)).not.toContain("dexscreener");
    expect(tokenRow(PLAIN, DEVNET)).not.toContain("dexscreener");
    expect(tokenRow({ ...PLAIN, mint: MAINNET_USDC }, SOLANA)).not.toContain("dexscreener");
  });

  it("the small link stays the explorer, so Dexscreener is never there twice", () => {
    expect(tokenPageLink(PUMP.mint, SOLANA, false)).toEqual({
      href: `https://explorer.solana.com/address/${PUMP.mint}`,
      label: "explorer ↗",
    });
    expect(tokenRow(PUMP, SOLANA).match(/dexscreener\.com/g)).toHaveLength(1);
  });
});

describe("the words", () => {
  it("no promise next to the badge or the button", () => {
    for (const html of [
      tokenRow(PUMP, SOLANA),
      tokenRow(PUMP, DEVNET),
      rows(PUMP),
      renderToStaticMarkup(
        <LaunchpadBadge token={PUMP} chainId={DEVNET} logo={LOGO} launchpads={ON} />,
      ),
    ]) {
      expect(words(html)).not.toMatch(/\b(verified|safe|official|trusted|legit|moon|price)\b/i);
    }
  });
});
