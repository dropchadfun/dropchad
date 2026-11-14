/**
 * The amount check on step 1 of `/create`:
 * once the list parses, the page asks `POST /api/drops/check` half a second after
 * typing stops. A refusal shows the create sentence (`errors.ts`) under the list and keeps `next`
 * off; a failed check (no answer, `429`, a `5xx` other than `price_unavailable`) shows nothing
 * and blocks nothing. Create still checks again on step 2.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHECK_DELAY_MS,
  amountCheckBody,
  blocksNext,
  checkOutcome,
} from "@/components/create/amount-check";
import { ApiError, checkDrop } from "@/lib/api";

const SRC = join(import.meta.dirname, "..", "src");
const ETH = { decimals: 18 };
const err = (status: number, body: Record<string, unknown>) =>
  new ApiError(status, body.error as string, body);

const base = {
  chain: "robinhood-testnet",
  family: "evm" as const,
  asset: "native",
  hasErrors: false,
  tooMany: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the wait after typing", () => {
  it("is half a second", () => {
    expect(CHECK_DELAY_MS).toBe(500);
  });
});

describe("amountCheckBody, what step 1 sends", () => {
  it("drop mode: one amount a person, a repeated handle merged whatever the case", () => {
    expect(
      amountCheckBody({
        ...base,
        mode: "drop",
        lines: [
          { key: "Alice", amountWei: 1n },
          { key: "bob", amountWei: 5n },
          { key: "alice", amountWei: 2n },
        ],
      }),
    ).toEqual({ mode: "handle", chain: "robinhood-testnet", asset: "native", amounts: ["3", "5"] });
  });

  it("multisend on Robinhood: a 0x address merged whatever the case", () => {
    expect(
      amountCheckBody({
        ...base,
        mode: "multisend",
        lines: [
          { key: "0xAbC0000000000000000000000000000000000001", amountWei: 4n },
          { key: "0xabc0000000000000000000000000000000000001", amountWei: 6n },
        ],
      }),
    ).toEqual({ mode: "address", chain: "robinhood-testnet", asset: "native", amounts: ["10"] });
  });

  it("multisend on Solana: a base58 key is case sensitive, two lines stay two", () => {
    expect(
      amountCheckBody({
        ...base,
        chain: "solana-devnet",
        family: "svm",
        mode: "multisend",
        lines: [
          { key: "AbCd1111111111111111111111111111", amountWei: 1n },
          { key: "abcd1111111111111111111111111111", amountWei: 2n },
        ],
      })?.amounts,
    ).toEqual(["1", "2"]);
  });

  it("carries the token address as the asset", () => {
    const token = "0x61Cb4e7Be9A366fDa2D4c528b817cc426a039C3C";
    expect(
      amountCheckBody({ ...base, asset: token, mode: "drop", lines: [{ key: "a", amountWei: 1n }] })
        ?.asset,
    ).toBe(token);
  });

  it("nothing to send: an empty list, a line that did not parse, or the local people cap", () => {
    expect(amountCheckBody({ ...base, mode: "drop", lines: [] })).toBeNull();
    expect(
      amountCheckBody({
        ...base,
        mode: "drop",
        hasErrors: true,
        lines: [{ key: "a", amountWei: 1n }],
      }),
    ).toBeNull();
    expect(
      amountCheckBody({
        ...base,
        mode: "drop",
        tooMany: true,
        lines: [{ key: "a", amountWei: 1n }],
      }),
    ).toBeNull();
  });
});

describe("checkOutcome, what the answer means", () => {
  it("all good", () => {
    expect(checkOutcome(null, ETH)).toEqual({ state: "ok" });
  });

  it("below_min_usd: the create sentence", () => {
    expect(
      checkOutcome(
        err(400, { error: "below_min_usd", minimum: "400000000000000", symbol: "ETH" }),
        ETH,
      ),
    ).toEqual({
      state: "refused",
      code: "below_min_usd",
      message: "send at least 0.0004 ETH per person.",
    });
  });

  it("fee_below_gas: the create sentence", () => {
    expect(checkOutcome(err(400, { error: "fee_below_gas" }), ETH)).toEqual({
      state: "refused",
      code: "fee_below_gas",
      message:
        "the fee does not cover the gas right now. send a bit more per person, or try later.",
    });
  });

  it("drop_too_big: the create sentence with the cap, and its code for the line under total", () => {
    expect(
      checkOutcome(
        err(400, { error: "drop_too_big", max: "100000000000000000", symbol: "ETH", decimals: 18 }),
        ETH,
      ),
    ).toEqual({
      state: "refused",
      code: "drop_too_big",
      message: "over the beta limit: at most 0.1 ETH per drop.",
    });
  });

  it("too_many, fee_too_high and price_unavailable are refusals too", () => {
    for (const code of ["too_many", "fee_too_high", "price_unavailable"]) {
      const status = code === "price_unavailable" ? 503 : 400;
      expect(checkOutcome(err(status, { error: code }), ETH).state, code).toBe("refused");
    }
  });

  it("a failed check is unknown: rate limited, a 5xx, no answer, a code it does not know", () => {
    expect(checkOutcome(err(429, { error: "rate_limited" }), ETH)).toEqual({ state: "unknown" });
    expect(checkOutcome(err(500, { error: "request_failed" }), ETH)).toEqual({ state: "unknown" });
    expect(checkOutcome(new TypeError("fetch failed"), ETH)).toEqual({ state: "unknown" });
    expect(checkOutcome(err(400, { error: "invalid_body" }), ETH)).toEqual({ state: "unknown" });
  });
});

describe("blocksNext", () => {
  it("only a refusal keeps next off; ok, unknown and no check yet never do", () => {
    expect(blocksNext({ state: "refused", code: "too_many", message: "x" })).toBe(true);
    expect(blocksNext({ state: "ok" })).toBe(false);
    expect(blocksNext({ state: "unknown" })).toBe(false);
    expect(blocksNext(null)).toBe(false);
  });
});

describe("checkDrop, the call", () => {
  it("posts the body to /api/drops/check with the CSRF header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }),
    );
    const body = {
      mode: "address" as const,
      chain: "robinhood-testnet",
      asset: "native",
      amounts: ["1"],
    };
    expect(await checkDrop(body, "csrf-1")).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/api/drops/check");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>)["x-dropchad-csrf"]).toBe("csrf-1");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(body);
  });

  it("a refusal comes back as an ApiError with its code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: "fee_below_gas" }), { status: 400 })),
      ),
    );
    await expect(
      checkDrop(
        { mode: "address", chain: "robinhood-testnet", asset: "native", amounts: ["1"] },
        "c",
      ),
    ).rejects.toMatchObject({ code: "fee_below_gas", status: 400 });
  });
});

describe("CreateDrop wires it into step 1", () => {
  const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
  const step1 = page.slice(page.indexOf("{step === 1 ?"), page.indexOf("{step === 2 ?"));

  it("sends the check after the wait, through checkDrop and amountCheckBody", () => {
    expect(page).toMatch(/import \{[^}]*checkDrop[^}]*\} from "@\/lib\/api"/);
    expect(page).toMatch(/amountCheckBody\(/);
    expect(page).toMatch(/setTimeout\([\s\S]{0,400}CHECK_DELAY_MS\)/);
  });

  it("shows a refusal in red under the list, before the next button", () => {
    const message = step1.search(/amountCheck\.state === "refused"[\s\S]{0,200}text-chad-error/);
    expect(message).toBeGreaterThan(-1);
    expect(message).toBeLessThan(step1.indexOf("<Primary"));
  });

  it("keeps next off on a refusal, in both modes", () => {
    const nexts = step1.match(/<Primary\s+disabled=\{[^}]*\}/g) ?? [];
    expect(nexts).toHaveLength(2);
    for (const next of nexts) expect(next).toContain("blocksNext(amountCheck)");
  });
});
