/**
 * The Robinhood token check. Read from the chain: the
 * code, `decimals`, `name` and `symbol`, the three EIP-1967 slots and the EIP-1167 code, and
 * `allowedToken` on `DropFactoryV3`, else a launchpad adapter. The first rule that fails gives
 * the one reason: `not a token`, `it can be changed later` (a proxy, the exception list
 * empty today), `it is not on our list yet`. `tokenProgram` is `erc20`, no logo, no launchpad.
 *
 * A fake set of reads stands in for the chain, so every rule is one test.
 */
import { describe, expect, it } from "vitest";

import {
  EIP1967_SLOTS,
  PROXY_EXCEPTION_TOKENS,
  createEvmTokenChecker,
  isMinimalProxy,
  type Erc20Reads,
} from "../src/chain/evm/token-check.js";

const TOKEN = "0x7e57000000000000000000000000000000007e57";
const PLAIN_CODE = `0x6080604052${"00".repeat(100)}` as const;
/** An EIP-1167 clone, 45 bytes: the prefix, a 20 byte implementation, the suffix. */
const CLONE_CODE =
  `0x363d3d373d3d3d363d73${"b4".repeat(20)}5af43d82803e903d91602b57fd5bf3` as const;

interface FakeToken {
  code?: `0x${string}`;
  slots?: Partial<Record<keyof typeof EIP1967_SLOTS, bigint>>;
  decimals?: number | null;
  name?: string | null;
  symbol?: string | null;
  allowed?: boolean;
  launchpad?: boolean;
  /** Make every read throw, like an RPC that is down. */
  down?: boolean;
}

function readsFor(token: FakeToken): Erc20Reads & { calls: number } {
  const state = { calls: 0 };
  const guard = () => {
    state.calls += 1;
    if (token.down === true) throw new Error("rpc down");
  };
  return {
    get calls() {
      return state.calls;
    },
    code: () => {
      guard();
      return Promise.resolve(token.code ?? PLAIN_CODE);
    },
    slot: (_address, slot) => {
      guard();
      const which = (Object.keys(EIP1967_SLOTS) as (keyof typeof EIP1967_SLOTS)[]).find(
        (k) => EIP1967_SLOTS[k] === slot,
      );
      return Promise.resolve(which === undefined ? 0n : (token.slots?.[which] ?? 0n));
    },
    decimals: () => {
      guard();
      return Promise.resolve(token.decimals === undefined ? 18 : token.decimals);
    },
    name: () => {
      guard();
      return Promise.resolve(token.name === undefined ? "Test Coin" : token.name);
    },
    symbol: () => {
      guard();
      return Promise.resolve(token.symbol === undefined ? "TEST" : token.symbol);
    },
    allowedToken: () => {
      guard();
      return Promise.resolve(token.allowed ?? true);
    },
    fromLaunchpad: () => {
      guard();
      return Promise.resolve(token.launchpad ?? false);
    },
  };
}

const check = (token: FakeToken) => createEvmTokenChecker({ reads: readsFor(token) }).check(TOKEN);

describe("the Robinhood token check", () => {
  it("an allowed plain ERC20: ok, its name, ticker and decimals, erc20, no logo", async () => {
    expect(await check({})).toEqual({
      mint: "0x7E57000000000000000000000000000000007E57",
      tokenProgram: "erc20",
      name: "Test Coin",
      symbol: "TEST",
      decimals: 18,
      logoUrl: null,
      launchpad: null,
      ok: true,
      reason: null,
    });
  });

  it("6 decimals, like tUSDC, is fine", async () => {
    expect(await check({ decimals: 6, symbol: "tUSDC" })).toMatchObject({ ok: true, decimals: 6 });
  });

  it("no code: not a token", async () => {
    expect(await check({ code: "0x" })).toMatchObject({
      ok: false,
      reason: "not a token",
      tokenProgram: null,
      decimals: null,
    });
  });

  it("no decimals: not a token", async () => {
    expect(await check({ decimals: null })).toMatchObject({ ok: false, reason: "not a token" });
  });

  for (const slot of ["implementation", "beacon", "admin"] as const) {
    it(`an EIP-1967 ${slot} slot set: it can be changed later`, async () => {
      expect(await check({ slots: { [slot]: 1n } })).toMatchObject({
        ok: false,
        reason: "it can be changed later",
      });
    });
  }

  it("an EIP-1167 clone: it can be changed later", async () => {
    expect(await check({ code: CLONE_CODE })).toMatchObject({
      ok: false,
      reason: "it can be changed later",
    });
  });

  it("the proxy rule comes before the list: an allowed proxy is still refused", async () => {
    expect(await check({ slots: { implementation: 1n }, allowed: true })).toMatchObject({
      ok: false,
      reason: "it can be changed later",
    });
  });

  it("the proxy exception list is empty today", () => {
    expect(PROXY_EXCEPTION_TOKENS.size).toBe(0);
  });

  it("on neither list: it is not on our list yet", async () => {
    expect(await check({ allowed: false, launchpad: false })).toMatchObject({
      ok: false,
      reason: "it is not on our list yet",
      name: "Test Coin",
      symbol: "TEST",
      decimals: 18,
    });
  });

  it("from an allowlisted launchpad, not on the address list: ok", async () => {
    expect(await check({ allowed: false, launchpad: true })).toMatchObject({ ok: true });
  });

  it("the name cut to 32 characters and the ticker to 10, never half an emoji", async () => {
    const long = await check({ name: "N".repeat(40), symbol: "🚀".repeat(12) });
    expect(long.name).toBe("N".repeat(32));
    expect(long.symbol).toBe("🚀".repeat(10));
  });

  it("no name, no ticker, or empty ones: null, still fine", async () => {
    expect(await check({ name: null, symbol: "" })).toMatchObject({
      ok: true,
      name: null,
      symbol: null,
    });
  });

  it("a chain that cannot be read throws, and the answer is never cached", async () => {
    const reads = readsFor({ down: true });
    const checker = createEvmTokenChecker({ reads });
    await expect(checker.check(TOKEN)).rejects.toThrow();
  });

  it("an answer is kept 60 seconds per token", async () => {
    let now = new Date("2026-10-04T10:00:00Z");
    const reads = readsFor({});
    const checker = createEvmTokenChecker({ reads, now: () => now });
    await checker.check(TOKEN);
    const after = reads.calls;
    await checker.check(TOKEN);
    expect(reads.calls).toBe(after);
    now = new Date(now.getTime() + 61_000);
    await checker.check(TOKEN);
    expect(reads.calls).toBeGreaterThan(after);
  });

  it("an ERC20 carries no logo: logo() is always null", async () => {
    const checker = createEvmTokenChecker({ reads: readsFor({}) });
    expect(await checker.logo(TOKEN)).toBeNull();
  });
});

describe("isMinimalProxy", () => {
  it("is the 45 byte EIP-1167 code only", () => {
    expect(isMinimalProxy(CLONE_CODE)).toBe(true);
    expect(isMinimalProxy(PLAIN_CODE)).toBe(false);
    expect(isMinimalProxy("0x")).toBe(false);
  });
});
