/**
 * The pause banner: on top of every
 * page while new drops are off on a chain, by the api switch or the program pause. The
 * text exactly as the owner wrote it, the chain name by key; `null` is not off. A failed or slow
 * read shows nothing. The create page greys `drop` on a chain that is off.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { explain } from "@/components/create/errors";
import { handleModesFromChains } from "@/components/create/form";
import { PauseBanner } from "@/components/site/PauseBanner";
import { ApiError } from "@/lib/api";
import { PAUSE_READ_TIMEOUT_MS, pauseBannerText, readPauseText } from "@/lib/pause";

const SRC = join(import.meta.dirname, "..", "src");

const ONE_SOLANA =
  "We are fixing something on Solana. Short break. New Solana drops are off. Claims still work.";
const ONE_ROBINHOOD =
  "We are fixing something on Robinhood. Short break. New Robinhood drops are off. Claims still work.";
const ALL = "We are fixing something. Short break. New drops are off. Claims still work.";

const row = (key: string, createsOn: boolean | null) => ({ key, createsOn });

describe("pauseBannerText", () => {
  it("nothing off: no banner", () => {
    expect(pauseBannerText([row("solana-devnet", true), row("robinhood-testnet", true)])).toBe(
      null,
    );
  });

  it("Solana off: the one chain text, exactly", () => {
    expect(pauseBannerText([row("solana-devnet", false), row("robinhood-testnet", true)])).toBe(
      ONE_SOLANA,
    );
  });

  it("Robinhood off: the one chain text with Robinhood, exactly", () => {
    expect(pauseBannerText([row("solana-devnet", true), row("robinhood-testnet", false)])).toBe(
      ONE_ROBINHOOD,
    );
  });

  it("every chain off: the general text, exactly", () => {
    expect(pauseBannerText([row("solana-devnet", false), row("robinhood-testnet", false)])).toBe(
      ALL,
    );
  });

  it("the mainnet keys carry the same names", () => {
    expect(pauseBannerText([row("solana", false), row("robinhood", true)])).toBe(ONE_SOLANA);
    expect(pauseBannerText([row("solana", true), row("robinhood", false)])).toBe(ONE_ROBINHOOD);
  });

  it("null is not off", () => {
    expect(pauseBannerText([row("solana-devnet", null), row("robinhood-testnet", true)])).toBe(
      null,
    );
    expect(pauseBannerText([row("solana-devnet", null), row("robinhood-testnet", false)])).toBe(
      ONE_ROBINHOOD,
    );
  });

  it("an api without the field shows nothing", () => {
    expect(pauseBannerText([{ key: "solana-devnet" }, { key: "robinhood-testnet" }])).toBe(null);
  });
});

describe("readPauseText, the read in the root layout", () => {
  const answer = (chains: unknown) => () =>
    Promise.resolve(new Response(JSON.stringify({ chains }), { status: 200 }));

  it("reads GET /api/chains and gives the text", async () => {
    let asked = "";
    const fetchFn = (url: string) => {
      asked = url;
      return answer([row("solana-devnet", false), row("robinhood-testnet", true)])();
    };
    expect(await readPauseText({ fetch: fetchFn })).toBe(ONE_SOLANA);
    expect(asked).toMatch(/\/api\/chains$/);
  });

  it("a failed read shows nothing", async () => {
    const fetchFn = () => Promise.reject(new Error("api down"));
    expect(await readPauseText({ fetch: fetchFn })).toBe(null);
  });

  it("a non 200 answer shows nothing", async () => {
    const fetchFn = () => Promise.resolve(new Response("no", { status: 502 }));
    expect(await readPauseText({ fetch: fetchFn })).toBe(null);
  });

  it("a slow read shows nothing and never blocks the page", async () => {
    const fetchFn = () => new Promise<Response>(() => {});
    const started = Date.now();
    expect(await readPauseText({ fetch: fetchFn, timeoutMs: 20 })).toBe(null);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("waits 1.5 seconds at most", () => {
    expect(PAUSE_READ_TIMEOUT_MS).toBe(1_500);
  });
});

describe("PauseBanner", () => {
  it("draws the text, calm: surface 2, no mint, no red, no close button", () => {
    const html = renderToStaticMarkup(<PauseBanner text={ALL} />);
    expect(html).toContain(ALL);
    expect(html).toContain("bg-chad-surface-2");
    expect(html).toContain("text-chad-text");
    expect(html).not.toMatch(/accent|error|down|mint/);
    expect(html).not.toContain("<button");
  });

  it("draws nothing without a text", () => {
    expect(renderToStaticMarkup(<PauseBanner text={null} />)).toBe("");
  });

  it("is in the root layout, above the hackathon line and the top bar", () => {
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
    const banner = layout.indexOf("<PauseBanner");
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(layout.indexOf("<HackathonLine"));
    expect(banner).toBeLessThan(layout.indexOf("<Header"));
    expect(layout).toContain("readPauseText");
  });
});

describe("the create page", () => {
  it("greys drop on a chain that is off, like handleMode false", () => {
    expect(
      handleModesFromChains([
        { key: "solana-devnet", handleMode: true, createsOn: false },
        { key: "robinhood-testnet", handleMode: true, createsOn: true },
        { key: "other", handleMode: true, createsOn: null },
        { key: "old", handleMode: true },
        { key: "nohandle", handleMode: false, createsOn: true },
      ]),
    ).toEqual({
      "solana-devnet": false,
      "robinhood-testnet": true,
      other: true,
      old: true,
      nohandle: false,
    });
  });

  it("creates_off says the one chain banner text", () => {
    const err = new ApiError(503, "creates_off", { error: "creates_off", chain: "solana-devnet" });
    expect(explain(err)).toBe(ONE_SOLANA);
  });
});
