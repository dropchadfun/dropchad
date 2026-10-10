/**
 * -1, the token check: `GET /api/tokens/:mint?chain=solana`.
 *
 * - The mint rules in this order, the first that fails gives the one `reason`: not a token, a
 *   freeze authority, then the Token-2022 extensions, default deny with
 *   only `MetadataPointer` (18) and `TokenMetadata` (19) allowed. The numbers are the
 *   `ExtensionType` order of `spl-token-2022-interface` 2.1.0, the crate the program uses.
 * - Name and ticker: `tokenMetadata` inside a Token-2022 mint, else Metaplex, else `null`
 *   Cut to 32 and 10
 *   characters.
 * - `launchpad` is `pump.fun` only when the bonding curve passes the three checks of
 *   else `null`.
 * - `logoUrl` is `null` until 4b-2. Never a price, a usd value or a market cap.
 *
 * The real fixtures were read from Solana mainnet, read only.
 */
import { describe, expect, it } from "vitest";

import { findProgramAddress } from "../src/chain/svm/pda.js";
import { pubkeyFromBase58, pubkeyToBase58, type Pubkey } from "../src/chain/svm/pubkey.js";
import type { AccountInfo, SvmRpc } from "../src/chain/svm/rpc.js";
import { createTokenChecker } from "../src/chain/svm/token-check.js";
import { createHarness } from "./harness.js";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SYSTEM = "11111111111111111111111111111111";

// --- real accounts, mainnet ----------------------------------------------------

/** A new pump.fun coin, `CreateV2`, Token-2022 with only extensions 18 and 19. */
const PUMP_MINT = "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump";
const PUMP_MINT_DATA =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACNSf0aBwAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARIAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFrScUnTqKp5hE9Fw/Tp7zpBV+hbmXI7gYkQb827l12vEwCmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWtJxSdOoqnmET0XD9OnvOkFX6FuZcjuBiRBvzbuXXa8NAAAARG9vbWVkIFJvY2tldAYAAABET09ST0NDAAAAaHR0cHM6Ly9pcGZzLmlvL2lwZnMvUW1ObnN3RTNtczdyTG1VeWcya25NWmNvd2tWdnhlTG5hUEU3TTdjR1JZUkJ0NQAAAAA=";
/** Its bonding curve, the address worked out by hand from. */
const PUMP_CURVE = "8tAEFnTSzwWT8Zsn9NcHaxRdKCxNSZ6iw6wZGRNZFTbT";
const PUMP_CURVE_DATA =
  "F7f4N2DYrGB2/xhWONADANK07JUFAAAAdmcGCqfRAgCC/hIAAAAAAACAxqR+jQMAAOB1X7jjo8rTXJ+4kay+AAqQ5wf55Ja3HY0s5Sr4w10WAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

/** USDC, classic SPL Token, a freeze authority set: one of the allowlisted exceptions. */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_MINT_DATA =
  "AQAAAJj+huiNm+Lqi8HMpIeLKYjCQPUrhCS/tA7Rot3LXhmbTffYPub4HQAGAQEAAABicKqKWcWUBbRShshncubNEm6bil06OFNtN/e0FOi2Zw==";
/** Its Metaplex metadata account. */
const USDC_METADATA = "5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq";
const USDC_METADATA_DATA =
  "BBzjWe1aAS4E+hQrnHUaHF6Hz9CgFhuchf/TG3jN/Nj2xvp6877brTo9ZfNqq8l0MbG75MLS9uDkfKYCA0UvXWEgAAAAVVNEIENvaW4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAVVNEQwAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAfwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

const fromB64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

// --- byte builders for the rule cases ------------------------------------------------------

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
const borshString = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  return cat(u32(bytes.length), bytes);
};
/** A Metaplex string: the length says the padded size, the rest is zero bytes, 7.4. */
const paddedString = (s: string, max: number) => {
  const bytes = new TextEncoder().encode(s);
  return cat(u32(max), bytes, new Uint8Array(max - bytes.length));
};

let seed = 1;
const freshKey = (): Pubkey => new Uint8Array(32).fill(seed++);

/** The 82 byte SPL mint: two optional authorities around supply, decimals and the init flag. */
function mintBase(args: {
  mintAuthority?: Pubkey | null;
  freezeAuthority?: Pubkey | null;
  decimals?: number;
  initialized?: boolean;
}) {
  return cat(
    option(args.mintAuthority ?? null),
    new Uint8Array(8).fill(1),
    new Uint8Array([args.decimals ?? 6, args.initialized === false ? 0 : 1]),
    option(args.freezeAuthority ?? null),
  );
}

/** Token-2022: the base, zero padding to 165, the account type (1 for a mint), then TLV. */
function mint2022(
  args: Parameters<typeof mintBase>[0] & {
    extensions?: { type: number; value: Uint8Array }[];
    accountType?: number;
  },
) {
  const tlv = (args.extensions ?? []).map((e) => cat(u16(e.type), u16(e.value.length), e.value));
  return cat(
    mintBase(args),
    new Uint8Array(165 - 82),
    new Uint8Array([args.accountType ?? 1]),
    ...tlv,
  );
}

const metadataPointer = (mint: Pubkey) => ({ type: 18, value: cat(new Uint8Array(32), mint) });
const tokenMetadata = (mint: Pubkey, name: string, symbol: string, uri = "") => ({
  type: 19,
  value: cat(
    new Uint8Array(32),
    mint,
    borshString(name),
    borshString(symbol),
    borshString(uri),
    u32(0),
  ),
});

function metaplexData(mint: Pubkey, name: string, symbol: string, key = 4) {
  return cat(
    new Uint8Array([key]),
    freshKey(),
    mint,
    paddedString(name, 32),
    paddedString(symbol, 10),
    paddedString("", 200),
    new Uint8Array(100),
  );
}

const CURVE_DISCRIMINATOR = Uint8Array.from(Buffer.from("17b7f83760d8ac60", "hex"));
const curveData = (discriminator = CURVE_DISCRIMINATOR) => cat(discriminator, new Uint8Array(143));

const metaplexPda = (mint: Pubkey) =>
  findProgramAddress(
    [new TextEncoder().encode("metadata"), pubkeyFromBase58(METAPLEX), mint],
    pubkeyFromBase58(METAPLEX),
  ).address;
const curvePda = (mint: Pubkey) =>
  findProgramAddress([new TextEncoder().encode("bonding-curve"), mint], pubkeyFromBase58(PUMP))
    .address;

// --- a fake cluster: accounts by address, every read counted --------------------------------

function fakeCluster() {
  const accounts = new Map<string, AccountInfo>();
  const state = { reads: 0, down: false };
  const rpc = {
    getMultipleAccounts: (keys: readonly Pubkey[]) => {
      state.reads += 1;
      if (state.down) return Promise.reject(new Error("rpc down"));
      return Promise.resolve(keys.map((k) => accounts.get(pubkeyToBase58(k)) ?? null));
    },
    getAccountInfo: (key: Pubkey) => {
      state.reads += 1;
      if (state.down) return Promise.reject(new Error("rpc down"));
      return Promise.resolve(accounts.get(pubkeyToBase58(key)) ?? null);
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
  return { rpc, state, put, accounts };
}

function world() {
  const cluster = fakeCluster();
  let now = new Date("2026-10-02T12:00:00.000Z");
  const checker = createTokenChecker({ rpc: cluster.rpc, now: () => now, cacheMs: 60_000 });
  return {
    ...cluster,
    checker,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const KEYS = [
  "decimals",
  "launchpad",
  "logoUrl",
  "mint",
  "name",
  "ok",
  "reason",
  "symbol",
  "tokenProgram",
];

// --- the check -------------------------------------------------------------------------------

describe("the token check, real mainnet accounts", () => {
  it("a new pump.fun coin: ok, its name and ticker from tokenMetadata, launchpad pump.fun", async () => {
    const w = world();
    w.put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    w.put(PUMP_CURVE, PUMP, fromB64(PUMP_CURVE_DATA));
    const result = await w.checker.check(PUMP_MINT);
    expect(result).toEqual({
      mint: PUMP_MINT,
      tokenProgram: TOKEN_2022,
      name: "Doomed Rocket",
      symbol: "DOOROC",
      decimals: 6,
      logoUrl: null,
      launchpad: "pump.fun",
      ok: true,
      reason: null,
    });
    // never a price, a usd value or a market cap. Exactly these keys.
    expect(Object.keys(result).sort()).toEqual(KEYS);
  });

  it("USDC: a freeze authority, but one of the mints, so ok; the name from Metaplex", async () => {
    const w = world();
    w.put(USDC_MINT, TOKEN, fromB64(USDC_MINT_DATA));
    w.put(USDC_METADATA, METAPLEX, fromB64(USDC_METADATA_DATA));
    expect(await w.checker.check(USDC_MINT)).toEqual({
      mint: USDC_MINT,
      tokenProgram: TOKEN,
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
      logoUrl: null,
      launchpad: null,
      ok: true,
      reason: null,
    });
  });
});

describe("launchpad", () => {
  it("no curve account: null, and the coin is still ok", async () => {
    const w = world();
    w.put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    const result = await w.checker.check(PUMP_MINT);
    expect(result.launchpad).toBeNull();
    expect(result.ok).toBe(true);
  });

  it("an account at the curve address owned by the System program, the USDC case: null", async () => {
    const w = world();
    w.put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    w.put(PUMP_CURVE, SYSTEM, new Uint8Array());
    expect((await w.checker.check(PUMP_MINT)).launchpad).toBeNull();
  });

  it("a curve owned by the pump program but with other first 8 bytes: null", async () => {
    const w = world();
    w.put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    w.put(PUMP_CURVE, PUMP, curveData(new Uint8Array(8).fill(9)));
    expect((await w.checker.check(PUMP_MINT)).launchpad).toBeNull();
  });

  it("the pump ending alone is never enough: a built mint with a good curve is pump.fun", async () => {
    // The rule is the curve, not the name: this mint has no `pump` ending and still counts.
    const w = world();
    const mint = freshKey();
    w.put(
      mint,
      TOKEN_2022,
      mint2022({ extensions: [metadataPointer(mint), tokenMetadata(mint, "A", "A")] }),
    );
    w.put(curvePda(mint), PUMP, curveData());
    expect((await w.checker.check(pubkeyToBase58(mint))).launchpad).toBe("pump.fun");
  });
});

describe("name and ticker", () => {
  it("a classic token with no metadata is ok, name and ticker null", async () => {
    const w = world();
    const mint = freshKey();
    w.put(mint, TOKEN, mintBase({}));
    expect(await w.checker.check(pubkeyToBase58(mint))).toMatchObject({
      ok: true,
      reason: null,
      name: null,
      symbol: null,
      decimals: 6,
      tokenProgram: TOKEN,
    });
  });

  it("cuts the zero padding and keeps at most 32 and 10 characters, 7.4", async () => {
    const w = world();
    const mint = freshKey();
    const long = "N".repeat(40);
    w.put(
      mint,
      TOKEN_2022,
      mint2022({ extensions: [metadataPointer(mint), tokenMetadata(mint, long, "TICKERTOOLONG")] }),
    );
    const result = await w.checker.check(pubkeyToBase58(mint));
    expect(result.name).toBe("N".repeat(32));
    expect(result.symbol).toBe("TICKERTOOL");
  });

  it("cuts by characters, not bytes", async () => {
    const w = world();
    const mint = freshKey();
    const emoji = "🚀".repeat(12);
    w.put(mint, TOKEN_2022, mint2022({ extensions: [tokenMetadata(mint, "ok", emoji)] }));
    expect((await w.checker.check(pubkeyToBase58(mint))).symbol).toBe("🚀".repeat(10));
  });

  it("a Token-2022 mint without tokenMetadata falls back to Metaplex", async () => {
    const w = world();
    const mint = freshKey();
    w.put(mint, TOKEN_2022, mint2022({}));
    w.put(metaplexPda(mint), METAPLEX, metaplexData(mint, "Meta Coin", "META"));
    expect(await w.checker.check(pubkeyToBase58(mint))).toMatchObject({
      name: "Meta Coin",
      symbol: "META",
    });
  });

  it("Metaplex is trusted only with the right, key 4 and the same mint inside", async () => {
    for (const [owner, key, inside] of [
      [SYSTEM, 4, "same"],
      [METAPLEX, 5, "same"],
      [METAPLEX, 4, "other"],
    ] as const) {
      const w = world();
      const mint = freshKey();
      w.put(mint, TOKEN, mintBase({}));
      w.put(
        metaplexPda(mint),
        owner,
        metaplexData(inside === "same" ? mint : freshKey(), "Fake", "FAKE", key),
      );
      const result = await w.checker.check(pubkeyToBase58(mint));
      expect(result.name).toBeNull();
      expect(result.symbol).toBeNull();
      expect(result.ok).toBe(true);
    }
  });
});

describe("the rules, the first that fails gives the reason", () => {
  it("a mint authority is allowed", async () => {
    const w = world();
    const mint = freshKey();
    w.put(mint, TOKEN, mintBase({ mintAuthority: freshKey() }));
    expect((await w.checker.check(pubkeyToBase58(mint))).ok).toBe(true);
  });

  it("a freeze authority: the creator can freeze it, on both token programs", async () => {
    const w = world();
    const classic = freshKey();
    w.put(classic, TOKEN, mintBase({ freezeAuthority: freshKey() }));
    w.put(metaplexPda(classic), METAPLEX, metaplexData(classic, "Frozen", "FRZ"));
    const modern = freshKey();
    w.put(modern, TOKEN_2022, mint2022({ freezeAuthority: freshKey() }));
    for (const mint of [classic, modern]) {
      expect(await w.checker.check(pubkeyToBase58(mint))).toMatchObject({
        ok: false,
        reason: "the creator can freeze it",
      });
    }
    // The name is still sent, so the page can say which token was refused.
    expect((await w.checker.check(pubkeyToBase58(classic))).name).toBe("Frozen");
  });

  it("each blocked extension has its own words, any other is not allowed yet", async () => {
    const cases: [number, string][] = [
      [1, "it takes a tax on every transfer"],
      [12, "the creator can take tokens back"],
      [14, "it runs extra code on every transfer"],
      [9, "it cannot be moved"],
      [3, "it has a feature we do not allow yet"], // mint close authority
      [4, "it has a feature we do not allow yet"], // confidential transfer
      [6, "it has a feature we do not allow yet"], // default account state
      [10, "it has a feature we do not allow yet"], // interest bearing
      [26, "it has a feature we do not allow yet"], // pausable
      [999, "it has a feature we do not allow yet"], // unknown to the crate
    ];
    for (const [type, reason] of cases) {
      const w = world();
      const mint = freshKey();
      w.put(
        mint,
        TOKEN_2022,
        mint2022({ extensions: [metadataPointer(mint), { type, value: new Uint8Array(8) }] }),
      );
      expect(await w.checker.check(pubkeyToBase58(mint))).toMatchObject({ ok: false, reason });
    }
  });

  it("a freeze authority is named before an extension", async () => {
    const w = world();
    const mint = freshKey();
    w.put(
      mint,
      TOKEN_2022,
      mint2022({
        freezeAuthority: freshKey(),
        extensions: [{ type: 1, value: new Uint8Array(8) }],
      }),
    );
    expect((await w.checker.check(pubkeyToBase58(mint))).reason).toBe("the creator can freeze it");
  });

  it("not a token: missing, another, a token account, a Token-2022 account, not initialised", async () => {
    const w = world();
    const missing = freshKey();
    const systemOwned = freshKey();
    w.put(systemOwned, SYSTEM, new Uint8Array(82));
    const tokenAccount = freshKey();
    w.put(tokenAccount, TOKEN, new Uint8Array(165));
    const token2022Account = freshKey();
    w.put(token2022Account, TOKEN_2022, mint2022({ accountType: 2 }));
    const uninitialised = freshKey();
    w.put(uninitialised, TOKEN, mintBase({ initialized: false }));
    for (const mint of [missing, systemOwned, tokenAccount, token2022Account, uninitialised]) {
      expect(await w.checker.check(pubkeyToBase58(mint))).toEqual({
        mint: pubkeyToBase58(mint),
        tokenProgram: null,
        name: null,
        symbol: null,
        decimals: null,
        logoUrl: null,
        launchpad: null,
        ok: false,
        reason: "not a token",
      });
    }
  });
});

describe("reads and the cache", () => {
  it("one read for the mint, the metadata and the curve, then 60 seconds from the cache", async () => {
    const w = world();
    w.put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    w.put(PUMP_CURVE, PUMP, fromB64(PUMP_CURVE_DATA));
    await w.checker.check(PUMP_MINT);
    expect(w.state.reads).toBe(1);
    w.advance(59_000);
    await w.checker.check(PUMP_MINT);
    expect(w.state.reads).toBe(1);
    w.advance(2_000);
    await w.checker.check(PUMP_MINT);
    expect(w.state.reads).toBe(2);
  });

  it("a failed read throws and is not cached", async () => {
    const w = world();
    w.put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    w.state.down = true;
    await expect(w.checker.check(PUMP_MINT)).rejects.toThrow();
    w.state.down = false;
    expect((await w.checker.check(PUMP_MINT)).ok).toBe(true);
  });
});

// --- the route -------------------------------------------------------------------------------

describe("GET /api/tokens/:mint", () => {
  async function routeWorld(withChecker = true) {
    const w = world();
    w.put(PUMP_MINT, TOKEN_2022, fromB64(PUMP_MINT_DATA));
    w.put(PUMP_CURVE, PUMP, fromB64(PUMP_CURVE_DATA));
    const harness = await createHarness(withChecker ? { tokenChecker: w.checker } : {});
    return { w, harness };
  }

  it("answers the check, no sign in", async () => {
    const { harness } = await routeWorld();
    const response = await harness.app.request(`/api/tokens/${PUMP_MINT}?chain=solana`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mint: PUMP_MINT,
      ok: true,
      name: "Doomed Rocket",
      launchpad: "pump.fun",
    });
    await harness.close();
  });

  it("Robinhood is not supported yet, an unknown or missing chain is a bad chain", async () => {
    const { harness } = await routeWorld();
    const robinhood = await harness.app.request(`/api/tokens/${PUMP_MINT}?chain=robinhood`);
    expect(robinhood.status).toBe(400);
    expect(await robinhood.json()).toMatchObject({ error: "chain_not_supported" });
    for (const query of ["?chain=dogecoin", ""]) {
      const response = await harness.app.request(`/api/tokens/${PUMP_MINT}${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "bad_chain" });
    }
    await harness.close();
  });

  it("a mint that is not a base58 public key is 400 bad_mint, with no read", async () => {
    const { w, harness } = await routeWorld();
    for (const mint of ["abc", "0x1111111111111111111111111111111111111111", "O".repeat(44)]) {
      const response = await harness.app.request(`/api/tokens/${mint}?chain=solana`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "bad_mint" });
    }
    expect(w.state.reads).toBe(0);
    await harness.close();
  });

  it("503 solana_unavailable with no checker, and when the read fails", async () => {
    const off = await routeWorld(false);
    const none = await off.harness.app.request(`/api/tokens/${PUMP_MINT}?chain=solana`);
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject({ error: "solana_unavailable" });
    await off.harness.close();

    const { w, harness } = await routeWorld();
    w.state.down = true;
    const down = await harness.app.request(`/api/tokens/${PUMP_MINT}?chain=solana`);
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ error: "solana_unavailable" });
    await harness.close();
  });

  it("30 checks a minute per ip, then 429", async () => {
    const { harness } = await routeWorld();
    const ask = () =>
      harness.app.request(`/api/tokens/${PUMP_MINT}?chain=solana`, {
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
    for (let i = 0; i < 30; i += 1) expect((await ask()).status).toBe(200);
    const over = await ask();
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "rate_limited" });
    await harness.close();
  });
});
