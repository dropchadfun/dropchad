/**
 * The usd price service, `src/prices`. Coingecko free tier, native coins only, one cached call
 * for all three coins, and never a throw: every failure is `null`.
 */
import { describe, expect, it } from "vitest";

import { COINGECKO_IDS, createPriceService } from "../src/prices/service.js";

const BODY = JSON.stringify({
  ethereum: { usd: 3000.5 },
  solana: { usd: 150 },
  binancecoin: { usd: 600 },
});

function fetchStub(answer: () => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = ((input: string | URL | Request) => {
    calls.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("the price service", () => {
  it("maps the three coins to coingecko ids", () => {
    expect(COINGECKO_IDS).toEqual({ ETH: "ethereum", SOL: "solana", BNB: "binancecoin" });
  });

  it("reads usd per coin from one call for all three ids", async () => {
    const { fetchImpl, calls } = fetchStub(() => new Response(BODY, { status: 200 }));
    const prices = createPriceService({ fetchImpl, now: () => 1_000, ttlMs: 60_000 });
    expect(await prices.usdPrice("ETH")).toBe(3000.5);
    expect(await prices.usdPrice("SOL")).toBe(150);
    expect(await prices.usdPrice("BNB")).toBe(600);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("ids=ethereum,solana,binancecoin");
    expect(calls[0]).toContain("vs_currencies=usd");
  });

  it("caches for the ttl and fetches again after it", async () => {
    let clock = 1_000;
    const { fetchImpl, calls } = fetchStub(() => new Response(BODY, { status: 200 }));
    const prices = createPriceService({ fetchImpl, now: () => clock, ttlMs: 60_000 });
    await prices.usdPrice("ETH");
    clock += 59_000;
    await prices.usdPrice("SOL");
    expect(calls).toHaveLength(1);
    clock += 2_000;
    await prices.usdPrice("ETH");
    expect(calls).toHaveLength(2);
  });

  it("is null on a bad status, a thrown fetch, a bad body, and an unknown coin", async () => {
    const bad = createPriceService({
      ...fetchStub(() => new Response("nope", { status: 500 })),
      now: () => 0,
      ttlMs: 0,
    });
    expect(await bad.usdPrice("ETH")).toBeNull();

    const thrown = createPriceService({
      fetchImpl: () => Promise.reject(new Error("offline")),
      now: () => 0,
      ttlMs: 0,
    });
    expect(await thrown.usdPrice("ETH")).toBeNull();

    const junk = createPriceService({
      ...fetchStub(() => new Response('{"ethereum":{"usd":"soon"}}', { status: 200 })),
      now: () => 0,
      ttlMs: 0,
    });
    expect(await junk.usdPrice("ETH")).toBeNull();

    const ok = createPriceService({
      ...fetchStub(() => new Response(BODY, { status: 200 })),
      now: () => 0,
      ttlMs: 0,
    });
    expect(await ok.usdPrice("DOGE")).toBeNull();
  });

  it("does not cache a failure: the next call asks again", async () => {
    let status = 500;
    const { fetchImpl, calls } = fetchStub(() => new Response(BODY, { status }));
    const prices = createPriceService({ fetchImpl, now: () => 0, ttlMs: 60_000 });
    expect(await prices.usdPrice("ETH")).toBeNull();
    status = 200;
    expect(await prices.usdPrice("ETH")).toBe(3000.5);
    expect(calls).toHaveLength(2);
  });
});
