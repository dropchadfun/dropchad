/**
 * The api switch: a mainnet chain on `API_LISTED_CHAINS` is live
 * on the site only while the last good `GET /api/chains` answer lists it. Solana is live from the
 * registry alone. One rule for the pills, the cap words, the beta card and `/how`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chains } from "@dropchad/chains";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChainSwitch } from "@/components/chains/ChainSwitch";
import { PausedLines, pausedText } from "@/components/create/PausedLines";
import { HowPage } from "@/components/how/HowPage";
import { betaSections } from "@/components/site/TrustPage";
import { betaCardCaps, betaNotice, dropCapWords } from "@/lib/beta";
import {
  API_LISTED_CHAINS,
  NO_API_VIEW,
  chainPills,
  liveMainnetKeys,
  type LiveView,
} from "@/lib/chains";
import {
  LIVE_READ_TIMEOUT_MS,
  LIVE_TTL_MS,
  createLiveChainsReader,
  viewFromRows,
} from "@/lib/live-chains";
import { pauseBannerText } from "@/lib/pause";

const SRC = join(import.meta.dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const LISTED: LiveView = { listed: new Set(["robinhood"]), paused: new Set() };
const PAUSED: LiveView = { listed: new Set(["robinhood"]), paused: new Set(["robinhood"]) };
const pillOf = (key: string, options: Parameters<typeof chainPills>[0] = {}) => {
  const found = chainPills(options).find((pill) => pill.key === key);
  if (found === undefined) throw new Error(`no pill ${key}`);
  return found;
};

const BOTH = "2 SOL, 0.1 ETH, 200 USDG on robinhood, 200 USDC, 200 USDT or 200 USD1 on solana";
const SOLANA_ALONE = "2 SOL, 200 USDC, 200 USDT or 200 USD1 on solana";

describe("which chains need the api", () => {
  it("one list in lib/chains.ts, robinhood only", () => {
    expect(API_LISTED_CHAINS).toEqual(["robinhood"]);
  });

  it("solana is live from the registry alone, with no answer at all", () => {
    expect(liveMainnetKeys(chains, NO_API_VIEW)).toEqual(["solana"]);
    expect(pillOf("solana", { view: NO_API_VIEW }).selectable).toBe(true);
  });

  it("the default, no view given, is no answer: robinhood hidden", () => {
    expect(liveMainnetKeys()).toEqual(["solana"]);
    expect(pillOf("robinhood").selectable).toBe(false);
  });
});

describe("robinhood live only while listed", () => {
  it("listed: live everywhere, the pill selectable on 4663", () => {
    expect(liveMainnetKeys(chains, LISTED)).toEqual(["robinhood", "solana"]);
    const pill = pillOf("robinhood", { view: LISTED, forCreate: true });
    expect(pill.selectable).toBe(true);
    expect(pill.chainKey).toBe("robinhood");
    expect(pill.chainIds).toEqual([4663]);
    expect(pill.paused).toBe(false);
  });

  it("not listed: the pill as before the record, shown but not selectable", () => {
    const pill = pillOf("robinhood", { view: NO_API_VIEW, forCreate: true });
    expect(pill.selectable).toBe(false);
    expect(pill.chainKey).toBeNull();
    expect(pill.chainIds).toEqual([]);
    expect(pill.paused).toBe(false);
  });

  it("a testnet key in the answer never opens the mainnet chain", () => {
    const view = viewFromRows([{ key: "robinhood-testnet", createsOn: true }]);
    expect(liveMainnetKeys(chains, view)).toEqual(["solana"]);
  });
});

describe("one rule for the cap words, the beta card and /how", () => {
  it("the cap words and the /create notice follow the view", () => {
    expect(dropCapWords(liveMainnetKeys(chains, NO_API_VIEW))).toBe(SOLANA_ALONE);
    expect(dropCapWords(liveMainnetKeys(chains, LISTED))).toBe(BOTH);
    expect(betaNotice(liveMainnetKeys(chains, LISTED))).toBe(
      `dropchad is in beta. each drop has a limit while we grow: ${BOTH}. other tokens have no limit.`,
    );
  });

  it("the beta card lines follow the view", () => {
    expect(betaCardCaps(liveMainnetKeys(chains, NO_API_VIEW))).toEqual([
      "2 SOL",
      "200 USDC",
      "200 USDT",
      "200 USD1",
    ]);
    expect(betaCardCaps(liveMainnetKeys(chains, LISTED))).toContain("0.1 ETH");
  });

  it("/terms and /about: the caps section takes the words it is given", () => {
    const caps = betaSections(BOTH).find((section) => section.title === "caps per drop");
    expect(caps?.lines[0]).toBe(`in the beta one drop can hold at most ${BOTH}.`);
  });

  it("/how names Robinhood only when it is live", () => {
    const hidden = renderToStaticMarkup(<HowPage chains={null} liveKeys={["solana"]} />);
    const live = renderToStaticMarkup(<HowPage chains={null} liveKeys={["robinhood", "solana"]} />);
    expect(hidden).not.toMatch(/Robinhood/);
    expect(live).toMatch(/Robinhood/);
  });

  it("the pages read the live view on the server, never a build time copy", () => {
    for (const page of [
      "app/layout.tsx",
      "app/page.tsx",
      "app/create/page.tsx",
      "app/boards/page.tsx",
      "app/how/page.tsx",
      "app/terms/page.tsx",
      "app/about/page.tsx",
    ]) {
      expect(read(page), page).toMatch(/readLiveChains\(\)/);
    }
    expect(read("components/site/BetaCard.tsx")).not.toMatch(/liveMainnetKeys\(\)/);
  });
});

describe("listed with new drops off", () => {
  it("still live: its caps show", () => {
    expect(liveMainnetKeys(chains, PAUSED)).toEqual(["robinhood", "solana"]);
  });

  it("on /create the pill is not selectable and is marked paused", () => {
    const pill = pillOf("robinhood", { view: PAUSED, forCreate: true });
    expect(pill.selectable).toBe(false);
    expect(pill.paused).toBe(true);
  });

  it("the front page and the boards still offer it", () => {
    const pill = pillOf("robinhood", { view: PAUSED });
    expect(pill.selectable).toBe(true);
    expect(pill.paused).toBe(false);
  });

  it("solana is never paused this way", () => {
    const view: LiveView = { listed: new Set(), paused: new Set(["solana"]) };
    expect(pillOf("solana", { view, forCreate: true }).selectable).toBe(true);
    expect(viewFromRows([{ key: "solana", createsOn: false }]).paused.has("solana")).toBe(false);
  });

  it("a paused pill has no soon label", () => {
    const pills = chainPills({ view: PAUSED, forCreate: true });
    const html = renderToStaticMarkup(
      <ChainSwitch pills={pills} value="solana" onChange={() => {}} allowAll={false} />,
    );
    const soon = html.match(/>soon<\/span>/g) ?? [];
    const grey = pills.filter((pill) => !pill.selectable && pill.paused !== true);
    expect(soon).toHaveLength(grey.length);
  });

  it("one grey line under the pills, the words", () => {
    expect(pausedText("robinhood")).toBe("new robinhood drops are paused. claims still work.");
    const html = renderToStaticMarkup(
      <PausedLines pills={chainPills({ view: PAUSED, forCreate: true })} />,
    );
    expect(html).toContain("new robinhood drops are paused. claims still work.");
    expect(renderToStaticMarkup(<PausedLines pills={chainPills({ view: LISTED })} />)).toBe("");
    expect(read("components/create/CreateDrop.tsx")).toMatch(/<PausedLines pills=\{pills\} \/>/);
  });

  it("the view takes paused from createsOn false, for listed chains only", () => {
    const view = viewFromRows([
      { key: "robinhood", createsOn: false },
      { key: "solana", createsOn: true },
    ]);
    expect([...view.listed]).toEqual(["robinhood"]);
    expect([...view.paused]).toEqual(["robinhood"]);
    expect(viewFromRows([{ key: "robinhood", createsOn: null }]).paused.size).toBe(0);
  });
});

describe("the read, no-store, 30 s and the last good answer", () => {
  const answer = (rows: unknown) =>
    Promise.resolve(new Response(JSON.stringify({ chains: rows }), { status: 200 }));

  it("the limits", () => {
    expect(LIVE_TTL_MS).toBe(30_000);
    expect(LIVE_READ_TIMEOUT_MS).toBe(1_500);
  });

  it("never answered: no view, robinhood hidden", async () => {
    const reader = createLiveChainsReader({
      fetch: () => Promise.reject(new TypeError("down")),
      now: () => 0,
    });
    expect(await reader()).toEqual(NO_API_VIEW);
  });

  it("no-store, then 30 s from memory, then a new read", async () => {
    let t = 0;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.cache).toBe("no-store");
      return answer([{ key: "robinhood", createsOn: true }]);
    });
    const reader = createLiveChainsReader({ fetch, now: () => t });
    expect((await reader()).listed.has("robinhood")).toBe(true);
    t = 29_999;
    await reader();
    expect(fetch).toHaveBeenCalledTimes(1);
    t = 30_000;
    await reader();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/api\/chains$/);
  });

  it("a failed, non 200 or broken answer keeps the last good answer", async () => {
    let t = 0;
    let mode: "ok" | "down" | "500" | "junk" = "ok";
    const reader = createLiveChainsReader({
      fetch: () => {
        if (mode === "down") return Promise.reject(new TypeError("down"));
        if (mode === "500") return Promise.resolve(new Response("{}", { status: 500 }));
        if (mode === "junk") return Promise.resolve(new Response("nope", { status: 200 }));
        return answer([{ key: "robinhood", createsOn: true }]);
      },
      now: () => t,
    });
    expect((await reader()).listed.has("robinhood")).toBe(true);
    for (const next of ["down", "500", "junk"] as const) {
      mode = next;
      t += 30_000;
      expect((await reader()).listed.has("robinhood"), next).toBe(true);
    }
  });

  it("an answer that drops robinhood closes it again", async () => {
    let t = 0;
    let rows: unknown = [{ key: "robinhood", createsOn: true }];
    const reader = createLiveChainsReader({ fetch: () => answer(rows), now: () => t });
    expect((await reader()).listed.has("robinhood")).toBe(true);
    rows = [{ key: "robinhood-testnet", createsOn: false }];
    t = 30_000;
    expect((await reader()).listed.has("robinhood")).toBe(false);
  });

  it("a slow read gives up at 1.5 s and keeps what it had", async () => {
    vi.useFakeTimers();
    try {
      const reader = createLiveChainsReader({
        fetch: () => new Promise<Response>(() => {}),
        now: () => 0,
      });
      const pending = reader();
      await vi.advanceTimersByTimeAsync(LIVE_READ_TIMEOUT_MS);
      expect(await pending).toEqual(NO_API_VIEW);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a deploy before the env switch shows the site as today", () => {
  /** `GET /api/chains` on the live site, read: Solana only, new drops on. */
  const LIVE_TODAY = [{ key: "solana", createsOn: true, offBy: null }];

  it("robinhood hidden everywhere, solana live", () => {
    const view = viewFromRows(LIVE_TODAY);
    expect(liveMainnetKeys(chains, view)).toEqual(["solana"]);
    expect(pillOf("robinhood", { view, forCreate: true }).selectable).toBe(false);
    expect(pillOf("robinhood", { view }).selectable).toBe(false);
    expect(pillOf("solana", { view, forCreate: true }).selectable).toBe(true);
    expect(dropCapWords(liveMainnetKeys(chains, view))).toBe(SOLANA_ALONE);
  });

  it("no pause banner", () => {
    expect(pauseBannerText(LIVE_TODAY, false)).toBeNull();
  });

  it("the banner reads every listed row, as before: a testnet row with new drops off shows it", () => {
    // Not today's answer; the api lists robinhood-testnet only while its write side runs.
    const row = [
      ...LIVE_TODAY,
      { key: "robinhood-testnet", createsOn: false, offBy: "api" as const },
    ];
    expect(pauseBannerText(row, false)).toBe(
      "We are fixing something on Robinhood. Short break. New Robinhood drops are off. Claims still work.",
    );
    expect(liveMainnetKeys(chains, viewFromRows(row))).toEqual(["solana"]);
  });
});
