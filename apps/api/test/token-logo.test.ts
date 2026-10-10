/**
 * -2, the token logo .
 *
 * - The metadata `uri` points to a JSON file; only its `image` field is read, then that image
 *   is fetched. An empty `uri` means no fetch.
 * - 5 seconds for the whole logo, JSON and image together; the JSON at most 64 KB, the image at
 *   most 1 MB. Every fetch goes through `src/net/safe-fetch.ts` (its own tests).
 * - The type comes from the first bytes: PNG, JPEG, GIF, WebP. SVG and everything else: no logo.
 * - A logo that fails never changes `ok` or `reason`. A refused token gets no fetch.
 * - `logoUrl` is `/api/tokens/<mint>/logo?chain=solana`; that route sends the kept bytes with
 *   our own type and headers and never redirects. Kept 24 hours in memory, 64 MB, oldest out.
 *
 * No socket is opened: `test/fake-web.ts` stands in for DNS and HTTPS.
 */
import { describe, expect, it } from "vitest";

import { pubkeyFromBase58, pubkeyToBase58, type Pubkey } from "../src/chain/svm/pubkey.js";
import type { AccountInfo, SvmRpc } from "../src/chain/svm/rpc.js";
import { createTokenChecker, metaplexAddress } from "../src/chain/svm/token-check.js";
import {
  createLogoFetcher,
  createLogoStore,
  IMAGE_MAX_BYTES,
  JSON_MAX_BYTES,
  LOGO_STORE_MAX_BYTES,
  LOGO_TIMEOUT_MS,
  LOGO_TTL_MS,
  sniffImage,
  type TokenLogo,
} from "../src/chain/svm/token-logo.js";
import { createSafeFetch } from "../src/net/safe-fetch.js";
import { fakeWeb, GIF87, GIF89, HTML, JPEG, padTo, PNG, SVG, WAVE, WEBP } from "./fake-web.js";
import { createHarness } from "./harness.js";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/** The real pump.fun coin of `test/token-check.test.ts`, read on mainnet. */
const PUMP_MINT = "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump";
const PUMP_MINT_DATA =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACNSf0aBwAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARIAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFrScUnTqKp5hE9Fw/Tp7zpBV+hbmXI7gYkQb827l12vEwCmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWtJxSdOoqnmET0XD9OnvOkFX6FuZcjuBiRBvzbuXXa8NAAAARG9vbWVkIFJvY2tldAYAAABET09ST0NDAAAAaHR0cHM6Ly9pcGZzLmlvL2lwZnMvUW1ObnN3RTNtczdyTG1VeWcya25NWmNvd2tWdnhlTG5hUEU3TTdjR1JZUkJ0NQAAAAA=";
/** The `uri` inside it. */
const PUMP_URI = "https://ipfs.io/ipfs/QmNnswE3ms7rLmUyg2knMZcowkVvxeLnaPE7M7cGRYRBt5";
const PUMP_IMAGE = "https://ipfs.io/ipfs/QmPumpImage";
/** Real USDC: classic, Metaplex with an empty uri, so no logo. */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_MINT_DATA =
  "AQAAAJj+huiNm+Lqi8HMpIeLKYjCQPUrhCS/tA7Rot3LXhmbTffYPub4HQAGAQEAAABicKqKWcWUBbRShshncubNEm6bil06OFNtN/e0FOi2Zw==";

const fromB64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const enc = new TextEncoder();
const IPFS_IO = "1.1.1.1";
const CDN = "93.184.216.34";
const MB = 1024 * 1024;
const logoPathOf = (mint: string) => `/api/tokens/${mint}/logo?chain=solana`;

// --- byte builders ---------------------------------------------------------------------------

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
const u16 = (n: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
};
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const option = (key: Pubkey | null) => (key === null ? new Uint8Array(36) : cat(u32(1), key));
const borshString = (s: string) => cat(u32(enc.encode(s).length), enc.encode(s));
const paddedString = (s: string, max: number) =>
  cat(u32(max), enc.encode(s), new Uint8Array(max - enc.encode(s).length));

let seed = 50;
const freshKey = (): Pubkey => new Uint8Array(32).fill(seed++);

const mintBase = (freeze: Pubkey | null = null) =>
  cat(option(null), new Uint8Array(8).fill(1), new Uint8Array([6, 1]), option(freeze));

/** A Token-2022 mint with the two allowed extensions, its `uri` inside. */
function mint2022(mint: Pubkey, uri: string, freeze: Pubkey | null = null) {
  const pointer = cat(new Uint8Array(32), mint);
  const metadata = cat(
    new Uint8Array(32),
    mint,
    borshString("Test Coin"),
    borshString("TEST"),
    borshString(uri),
    u32(0),
  );
  return cat(
    mintBase(freeze),
    new Uint8Array(165 - 82),
    new Uint8Array([1]),
    u16(18),
    u16(pointer.length),
    pointer,
    u16(19),
    u16(metadata.length),
    metadata,
  );
}

/** Metaplex for a classic mint, the `uri` padded to 200. */
const metaplexData = (mint: Pubkey, uri: string) =>
  cat(
    new Uint8Array([4]),
    freshKey(),
    mint,
    paddedString("Classic Coin", 32),
    paddedString("CLSC", 10),
    paddedString(uri, 200),
    new Uint8Array(100),
  );

// --- a fake cluster and a fake web ------------------------------------------------------------

function world(options: { timeoutMs?: number; storeMaxBytes?: number } = {}) {
  const accounts = new Map<string, AccountInfo>();
  const state = { reads: 0, down: false };
  const rpc = {
    getMultipleAccounts: (keys: readonly Pubkey[]) => {
      state.reads += 1;
      if (state.down) return Promise.reject(new Error("rpc down"));
      return Promise.resolve(keys.map((k) => accounts.get(pubkeyToBase58(k)) ?? null));
    },
  } as unknown as SvmRpc;
  const put = (address: string | Pubkey, owner: string, data: Uint8Array) => {
    accounts.set(typeof address === "string" ? address : pubkeyToBase58(address), {
      lamports: 1_000_000n,
      owner: pubkeyFromBase58(owner),
      data,
      executable: false,
    });
  };

  const web = fakeWeb();
  web.host("ipfs.io", IPFS_IO);
  web.host("cdn.example", CDN);

  let now = new Date("2026-10-02T12:00:00.000Z");
  const clock = () => now;
  const fetcher = createLogoFetcher({
    fetch: createSafeFetch(web.deps),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const store = createLogoStore({
    now: clock,
    ...(options.storeMaxBytes === undefined ? {} : { maxBytes: options.storeMaxBytes }),
  });
  const checker = createTokenChecker({
    rpc,
    now: clock,
    cacheMs: 60_000,
    logos: { fetcher, store },
  });

  /** The pump coin with a JSON and a PNG behind it. */
  const pumpWithLogo = (image: Uint8Array = PNG) => {
    put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    web.page(PUMP_URI, { body: JSON.stringify({ name: "Doomed Rocket", image: PUMP_IMAGE }) });
    web.page(PUMP_IMAGE, { body: image });
  };

  return {
    rpc,
    state,
    put,
    web,
    fetcher,
    store,
    checker,
    pumpWithLogo,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

// --- the image type ----------------------------------------------------------------------------

describe("the image type comes from the first bytes", () => {
  it("PNG, JPEG, GIF and WebP", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(GIF87)).toBe("image/gif");
    expect(sniffImage(GIF89)).toBe("image/gif");
    expect(sniffImage(WEBP)).toBe("image/webp");
  });

  it("SVG, HTML, another RIFF file, too short or empty: none", () => {
    for (const bytes of [SVG, HTML, WAVE, PNG.subarray(0, 4), new Uint8Array(0)]) {
      expect(sniffImage(bytes)).toBeNull();
    }
  });
});

// --- the fetcher -------------------------------------------------------------------------------

describe("the logo fetcher: the JSON, then its image", () => {
  it("the limits are the 's", () => {
    expect(LOGO_TIMEOUT_MS).toBe(5_000);
    expect(JSON_MAX_BYTES).toBe(64 * 1024);
    expect(IMAGE_MAX_BYTES).toBe(MB);
    expect(LOGO_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(LOGO_STORE_MAX_BYTES).toBe(64 * MB);
  });

  it("reads only the image field and keeps the type it read, not the sender's", async () => {
    const w = world();
    w.web.page("https://cdn.example/meta.json", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", image: "https://cdn.example/logo", description: "y" }),
    });
    w.web.page("https://cdn.example/logo", {
      headers: { "content-type": "image/svg+xml" },
      body: JPEG,
    });
    expect(await w.fetcher.fetch("https://cdn.example/meta.json")).toEqual<TokenLogo>({
      bytes: JPEG,
      contentType: "image/jpeg",
    });
  });

  it("ipfs:// in the uri and in the image go through https://ipfs.io/ipfs/", async () => {
    const w = world();
    w.web.page("https://ipfs.io/ipfs/QmMeta", { body: JSON.stringify({ image: "ipfs://QmImg" }) });
    w.web.page("https://ipfs.io/ipfs/QmImg", { body: GIF89 });
    expect(await w.fetcher.fetch("ipfs://QmMeta")).toEqual({
      bytes: GIF89,
      contentType: "image/gif",
    });
    expect(w.web.log.connects.map((c) => [c.href, c.address])).toEqual([
      ["https://ipfs.io/ipfs/QmMeta", IPFS_IO],
      ["https://ipfs.io/ipfs/QmImg", IPFS_IO],
    ]);
  });

  it("an empty uri: no logo and no lookup", async () => {
    const w = world();
    for (const uri of ["", "   "]) expect(await w.fetcher.fetch(uri)).toBeNull();
    expect(w.web.log.resolves).toEqual([]);
  });

  it("a JSON that is broken, not an object, or has no usable image: no logo", async () => {
    const w = world();
    const bodies = [
      "not json",
      "[]",
      "null",
      '"https://cdn.example/a.png"',
      "{}",
      '{"image": 5}',
      '{"image": ""}',
      '{"image": ["https://cdn.example/a.png"]}',
    ];
    for (const [i, body] of bodies.entries()) {
      w.web.page(`https://cdn.example/bad-${i}.json`, { body });
      expect([body, await w.fetcher.fetch(`https://cdn.example/bad-${i}.json`)]).toEqual([
        body,
        null,
      ]);
    }
  });

  it("the JSON at most 64 KB", async () => {
    const w = world();
    w.web.page("https://cdn.example/a.png", { body: PNG });
    const json = (size: number) => {
      const base = JSON.stringify({ image: "https://cdn.example/a.png", pad: "" });
      return base.replace('"pad":""', `"pad":"${"x".repeat(size - base.length)}"`);
    };
    w.web.page("https://cdn.example/ok.json", { body: json(JSON_MAX_BYTES) });
    w.web.page("https://cdn.example/big.json", { body: json(JSON_MAX_BYTES + 1) });
    expect(await w.fetcher.fetch("https://cdn.example/ok.json")).not.toBeNull();
    expect(await w.fetcher.fetch("https://cdn.example/big.json")).toBeNull();
  });

  it("the image at most 1 MB", async () => {
    const w = world();
    w.web.page("https://cdn.example/ok.json", { body: '{"image":"https://cdn.example/ok.png"}' });
    w.web.page("https://cdn.example/big.json", { body: '{"image":"https://cdn.example/big.png"}' });
    w.web.page("https://cdn.example/ok.png", { body: padTo(PNG, MB) });
    w.web.page("https://cdn.example/big.png", { body: padTo(PNG, MB + 1) });
    expect((await w.fetcher.fetch("https://cdn.example/ok.json"))?.bytes).toHaveLength(MB);
    expect(await w.fetcher.fetch("https://cdn.example/big.json")).toBeNull();
  });

  it("an image that is SVG or HTML, whatever its header says: no logo", async () => {
    const w = world();
    for (const [name, bytes] of [
      ["svg", SVG],
      ["html", HTML],
    ] as const) {
      w.web.page(`https://cdn.example/${name}.json`, {
        body: JSON.stringify({ image: `https://cdn.example/${name}` }),
      });
      w.web.page(`https://cdn.example/${name}`, {
        headers: { "content-type": "image/png" },
        body: bytes,
      });
      expect(await w.fetcher.fetch(`https://cdn.example/${name}.json`)).toBeNull();
    }
  });

  it("the JSON or the image pointing inside, or at http: no logo, and never a connection there", async () => {
    const w = world();
    w.web.host("inside.example", "10.0.0.9");
    w.web.page("https://cdn.example/inside.json", {
      body: '{"image":"https://inside.example/a.png"}',
    });
    w.web.page("https://cdn.example/http.json", { body: '{"image":"http://cdn.example/a.png"}' });
    w.web.page("https://cdn.example/meta.json", { body: '{"image":"https://169.254.169.254/"}' });
    expect(await w.fetcher.fetch("https://cdn.example/inside.json")).toBeNull();
    expect(await w.fetcher.fetch("https://cdn.example/http.json")).toBeNull();
    expect(await w.fetcher.fetch("https://cdn.example/meta.json")).toBeNull();
    expect(await w.fetcher.fetch("https://inside.example/meta.json")).toBeNull();
    expect(await w.fetcher.fetch("http://cdn.example/meta.json")).toBeNull();
    expect(w.web.log.connects.every((c) => c.address === CDN)).toBe(true);
  });

  it("one time limit for the JSON and the image together", async () => {
    const w = world({ timeoutMs: 100 });
    w.web.page("https://cdn.example/meta.json", { body: '{"image":"https://cdn.example/slow"}' });
    w.web.page("https://cdn.example/slow", { hang: true });
    const started = Date.now();
    expect(await w.fetcher.fetch("https://cdn.example/meta.json")).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("never throws: a lookup that fails is no logo", async () => {
    const w = world();
    expect(await w.fetcher.fetch("https://nowhere.example/meta.json")).toBeNull();
  });
});

// --- the store ---------------------------------------------------------------------------------

describe("the logo store: 24 hours, 64 MB, oldest out first", () => {
  const logo = (size: number): TokenLogo => ({ bytes: padTo(PNG, size), contentType: "image/png" });

  it("keeps a logo 24 hours", () => {
    let now = new Date("2026-10-02T12:00:00.000Z");
    const store = createLogoStore({ now: () => now });
    store.put("a", logo(100));
    now = new Date(now.getTime() + LOGO_TTL_MS - 1);
    expect(store.get("a")?.bytes).toHaveLength(100);
    now = new Date(now.getTime() + 1);
    expect(store.get("a")).toBeUndefined();
  });

  it("over the byte cap, the oldest goes first; putting again makes it new", () => {
    const store = createLogoStore({ maxBytes: 100 });
    store.put("a", logo(40));
    store.put("b", logo(40));
    store.put("a", logo(40)); // a is now the newest
    store.put("c", logo(40)); // b goes
    expect(store.get("a")).toBeDefined();
    expect(store.get("b")).toBeUndefined();
    expect(store.get("c")).toBeDefined();
  });
});

// --- the check with logos ----------------------------------------------------------------------

describe("the token check with the logo", () => {
  it("the real pump.fun coin: its uri, its JSON, its image; logoUrl is our own route", async () => {
    const w = world();
    w.pumpWithLogo();
    const result = await w.checker.check(PUMP_MINT);
    expect(result).toMatchObject({
      mint: PUMP_MINT,
      ok: true,
      reason: null,
      name: "Doomed Rocket",
      logoUrl: logoPathOf(PUMP_MINT),
    });
    expect(Object.keys(result).sort()).toEqual([
      "decimals",
      "launchpad",
      "logoUrl",
      "mint",
      "name",
      "ok",
      "reason",
      "symbol",
      "tokenProgram",
    ]);
    expect(w.web.log.connects.map((c) => c.href)).toEqual([PUMP_URI, PUMP_IMAGE]);
    expect(w.store.get(PUMP_MINT)).toEqual({ bytes: PNG, contentType: "image/png" });
  });

  it("a classic token: the uri from Metaplex", async () => {
    const w = world();
    const mint = freshKey();
    w.put(mint, TOKEN, mintBase());
    w.put(metaplexAddress(mint), METAPLEX, metaplexData(mint, "https://cdn.example/classic.json"));
    w.web.page("https://cdn.example/classic.json", {
      body: '{"image":"https://cdn.example/c.webp"}',
    });
    w.web.page("https://cdn.example/c.webp", { body: WEBP });
    const result = await w.checker.check(pubkeyToBase58(mint));
    expect(result.logoUrl).toBe(logoPathOf(pubkeyToBase58(mint)));
    expect(w.store.get(pubkeyToBase58(mint))?.contentType).toBe("image/webp");
  });

  it("a logo that fails keeps ok and reason; logoUrl is null", async () => {
    const w = world();
    w.put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    w.web.page(PUMP_URI, { body: JSON.stringify({ image: PUMP_IMAGE }) });
    w.web.page(PUMP_IMAGE, { body: SVG });
    expect(await w.checker.check(PUMP_MINT)).toMatchObject({
      ok: true,
      reason: null,
      logoUrl: null,
    });
  });

  it("an empty uri, real USDC: no lookup at all", async () => {
    const w = world();
    w.put(USDC_MINT, TOKEN, fromB64(USDC_MINT_DATA));
    expect((await w.checker.check(USDC_MINT)).logoUrl).toBeNull();
    expect(w.web.log.resolves).toEqual([]);
  });

  it("a refused token is not fetched", async () => {
    const w = world();
    const mint = freshKey();
    w.put(mint, TOKEN_2022, mint2022(mint, "https://cdn.example/frozen.json", freshKey()));
    w.web.page("https://cdn.example/frozen.json", {
      body: '{"image":"https://cdn.example/f.png"}',
    });
    w.web.page("https://cdn.example/f.png", { body: PNG });
    const result = await w.checker.check(pubkeyToBase58(mint));
    expect(result).toMatchObject({ ok: false, reason: "the creator can freeze it", logoUrl: null });
    expect(w.web.log.resolves).toEqual([]);
  });

  it("a kept logo is not fetched again when the check is read again", async () => {
    const w = world();
    w.pumpWithLogo();
    await w.checker.check(PUMP_MINT);
    w.advance(61_000); // the check is read from the chain again, the logo is still kept
    expect((await w.checker.check(PUMP_MINT)).logoUrl).toBe(logoPathOf(PUMP_MINT));
    expect(w.state.reads).toBe(2);
    expect(w.web.log.connects).toHaveLength(2);
  });

  it("checker.logo: from the store, else the check and the fetch, else null", async () => {
    const w = world();
    w.pumpWithLogo();
    expect(await w.checker.logo(PUMP_MINT)).toEqual({ bytes: PNG, contentType: "image/png" });
    expect(w.state.reads).toBe(1);
    expect(await w.checker.logo(PUMP_MINT)).toEqual({ bytes: PNG, contentType: "image/png" });
    expect(w.state.reads).toBe(1);
    expect(w.web.log.connects).toHaveLength(2);

    w.put(USDC_MINT, TOKEN, fromB64(USDC_MINT_DATA));
    expect(await w.checker.logo(USDC_MINT)).toBeNull();
  });

  it("checker.logo after the store dropped it, while the check is still fresh: fetched again", async () => {
    const w = world({ storeMaxBytes: PNG.length });
    w.pumpWithLogo();
    await w.checker.check(PUMP_MINT);
    // Another logo pushes the coin's out of a store that holds one.
    w.store.put("other", { bytes: padTo(PNG, PNG.length), contentType: "image/png" });
    expect(w.store.get(PUMP_MINT)).toBeUndefined();
    expect(await w.checker.logo(PUMP_MINT)).toEqual({ bytes: PNG, contentType: "image/png" });
    expect(w.web.log.connects).toHaveLength(4);
  });
});

// --- the route ---------------------------------------------------------------------------------

describe("GET /api/tokens/:mint/logo", () => {
  async function routeWorld(withChecker = true) {
    const w = world();
    w.pumpWithLogo();
    const harness = await createHarness(withChecker ? { tokenChecker: w.checker } : {});
    return { w, harness };
  }

  it("the check answers our own logo link", async () => {
    const { harness } = await routeWorld();
    const response = await harness.app.request(`/api/tokens/${PUMP_MINT}?chain=solana`);
    expect(await response.json()).toMatchObject({ logoUrl: logoPathOf(PUMP_MINT) });
    await harness.close();
  });

  it("sends the bytes with our own type and headers, never a redirect", async () => {
    const { harness } = await routeWorld();
    await harness.app.request(`/api/tokens/${PUMP_MINT}?chain=solana`);
    const response = await harness.app.request(logoPathOf(PUMP_MINT));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("location")).toBeNull();
    await harness.close();
  });

  it("not kept yet: the route fetches it under the same rules", async () => {
    const { w, harness } = await routeWorld();
    const response = await harness.app.request(logoPathOf(PUMP_MINT));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(w.web.log.connects.map((c) => c.href)).toEqual([PUMP_URI, PUMP_IMAGE]);
    await harness.close();
  });

  it("no logo: 404 no_logo, for an empty uri and for a logo that fails", async () => {
    const { w, harness } = await routeWorld();
    w.put(USDC_MINT, TOKEN, fromB64(USDC_MINT_DATA));
    const usdc = await harness.app.request(logoPathOf(USDC_MINT));
    expect(usdc.status).toBe(404);
    expect(await usdc.json()).toMatchObject({ error: "no_logo" });

    w.web.page(PUMP_IMAGE, { body: HTML });
    const mint = freshKey();
    w.put(mint, TOKEN_2022, mint2022(mint, PUMP_URI));
    const failed = await harness.app.request(logoPathOf(pubkeyToBase58(mint)));
    expect(failed.status).toBe(404);
    expect(await failed.json()).toMatchObject({ error: "no_logo" });
    expect(failed.headers.get("location")).toBeNull();
    await harness.close();
  });

  it("the same 400s as the check, and 503 without Solana", async () => {
    const { harness } = await routeWorld();
    const robinhood = await harness.app.request(`/api/tokens/${PUMP_MINT}/logo?chain=robinhood`);
    expect(robinhood.status).toBe(400);
    expect(await robinhood.json()).toMatchObject({ error: "chain_not_supported" });
    for (const query of ["?chain=dogecoin", ""]) {
      const response = await harness.app.request(`/api/tokens/${PUMP_MINT}/logo${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "bad_chain" });
    }
    const bad = await harness.app.request(`/api/tokens/abc/logo?chain=solana`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "bad_mint" });
    await harness.close();

    const off = await routeWorld(false);
    const none = await off.harness.app.request(logoPathOf(PUMP_MINT));
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject({ error: "solana_unavailable" });
    await off.harness.close();
  });

  it("the chain down on a miss: 503 solana_unavailable", async () => {
    const { w, harness } = await routeWorld();
    w.state.down = true;
    const response = await harness.app.request(logoPathOf(PUMP_MINT));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "solana_unavailable" });
    await harness.close();
  });

  it("120 a minute per ip, then 429; its own limit, apart from the check's 30", async () => {
    const { harness } = await routeWorld();
    const headers = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 30; i += 1) {
      expect(
        (await harness.app.request(`/api/tokens/${PUMP_MINT}?chain=solana`, { headers })).status,
      ).toBe(200);
    }
    for (let i = 0; i < 120; i += 1) {
      expect((await harness.app.request(logoPathOf(PUMP_MINT), { headers })).status).toBe(200);
    }
    const over = await harness.app.request(logoPathOf(PUMP_MINT), { headers });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "rate_limited" });
    await harness.close();
  });
});
