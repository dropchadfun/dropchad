/**
 * the fee tile with the new fee. (
 * ): the fee is `min(max(1%, flat minimum, minimum per person × people), max fee)`, a
 * zero max fee is no cap, the same as the api, the program and `DropFactoryV4`. The small line
 * under the number says which part decided it: `1%`, `minimum fee`
 * `0.0003 SOL per person minimum` (`0.00001 ETH` on Robinhood), or `max fee`. A tie is said as the
 * percent. The two new numbers come from `GET /api/chains`; an api without them is the old fee.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initialForm, reduceForm, viewOf, type FormState } from "@/components/create/form";
import { chainPills } from "@/lib/chains";

const pills = chainPills();
const SRC = join(import.meta.dirname, "..", "src");

const SOL_PER_PERSON = 300_000n; // 0.0003 SOL
const SOL_CAP = 500_000_000n; // 0.5 SOL
const ETH_PER_PERSON = 10_000_000_000_000n; // 0.00001 ETH
const ETH_CAP = 20_000_000_000_000_000n; // 0.02 ETH

/** A drop on the chosen chain with these handle lines, signed out. */
function drop(chain: "solana" | "robinhood", lines: string): FormState {
  return [
    { type: "chain", key: chain } as const,
    { type: "handleText", value: lines } as const,
  ].reduce(reduceForm, initialForm(pills));
}

/** `n` people at `amount` each. */
function people(n: number, amount: string): string {
  return Array.from({ length: n }, (_, i) => `@chad${String(i)} ${amount}`).join("\n");
}

describe("the fee with the minimum per person", () => {
  it("the minimum per person is the fee when it is the biggest part", () => {
    // 3 people x 0.01 SOL = 0.03 SOL; 1% is 0.0003 SOL; 3 x 0.0003 SOL = 0.0009 SOL is bigger.
    const v = viewOf(
      drop("solana", people(3, "0.01")),
      pills,
      100,
      0n,
      null,
      null,
      SOL_PER_PERSON,
      SOL_CAP,
    );
    expect(v.feeWei).toBe(900_000n);
    expect(v.grossWei).toBe(30_000_000n + 900_000n);
    expect(v.feeBig).toBe("0.0009 SOL");
    expect(v.feeSmall).toBe("0.0003 SOL per person minimum");
    expect(v.feeFromMin).toBe(false);
  });

  it("on Robinhood it says the ETH amount", () => {
    // 2 people x 0.0001 ETH; 1% is 0.000002 ETH; 2 x 0.00001 ETH = 0.00002 ETH.
    const v = viewOf(
      drop("robinhood", people(2, "0.0001")),
      pills,
      100,
      0n,
      null,
      null,
      ETH_PER_PERSON,
      ETH_CAP,
    );
    expect(v.feeWei).toBe(20_000_000_000_000n);
    expect(v.feeBig).toBe("0.00002 ETH");
    expect(v.feeSmall).toBe("0.00001 ETH per person minimum");
  });

  it("1% when the percent is bigger", () => {
    // 2 people x 1 SOL; 1% is 0.02 SOL, above 2 x 0.0003 SOL.
    const v = viewOf(
      drop("solana", people(2, "1")),
      pills,
      100,
      0n,
      null,
      null,
      SOL_PER_PERSON,
      SOL_CAP,
    );
    expect(v.feeWei).toBe(20_000_000n);
    expect(v.feeSmall).toBe("1%");
  });

  it("a tie between the percent and the minimum per person is said as the percent", () => {
    // 1 person x 0.03 SOL: 1% is 0.0003 SOL, exactly the minimum per person.
    const v = viewOf(
      drop("solana", people(1, "0.03")),
      pills,
      100,
      0n,
      null,
      null,
      SOL_PER_PERSON,
      SOL_CAP,
    );
    expect(v.feeWei).toBe(300_000n);
    expect(v.feeSmall).toBe("1%");
  });

  it("the flat minimum still says minimum fee, with its grey line, when it is the biggest", () => {
    // 1 person x 0.000000001 SOL: 1% is 0, the flat 0.0025 SOL is above 0.0003 SOL.
    const v = viewOf(
      drop("solana", people(1, "0.000000001")),
      pills,
      100,
      2_500_000n,
      null,
      null,
      SOL_PER_PERSON,
      SOL_CAP,
    );
    expect(v.feeWei).toBe(2_500_000n);
    expect(v.feeSmall).toBe("minimum fee");
    expect(v.feeFromMin).toBe(true);
  });

  it("a multisend counts its receivers", () => {
    const sol = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";
    const sol2 = "DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC";
    const state = [
      { type: "mode", mode: "multisend" } as const,
      { type: "chain", key: "solana" } as const,
      { type: "text", value: `${sol} 0.01\n${sol2} 0.01` } as const,
    ].reduce(reduceForm, initialForm(pills));
    const v = viewOf(state, pills, 100, 0n, null, null, SOL_PER_PERSON, SOL_CAP);
    expect(v.feeWei).toBe(600_000n);
    expect(v.feeSmall).toBe("0.0003 SOL per person minimum");
  });
});

describe("the max fee", () => {
  it("the max fee is the fee when the rest is above it", () => {
    // 2 people x 50 SOL; 1% is 1 SOL, above the 0.5 SOL cap.
    const v = viewOf(
      drop("solana", people(2, "50")),
      pills,
      100,
      0n,
      null,
      null,
      SOL_PER_PERSON,
      SOL_CAP,
    );
    expect(v.feeWei).toBe(SOL_CAP);
    expect(v.grossWei).toBe(100_000_000_000n + SOL_CAP);
    expect(v.feeBig).toBe("0.5 SOL");
    expect(v.feeSmall).toBe("max fee");
    expect(v.feeFromMin).toBe(false);
  });

  it("the cap holds the minimum per person too", () => {
    // 500 people x 1 ETH would take 1% = 5 ETH and 500 x 0.00001 ETH; both above 0.02 ETH.
    const v = viewOf(
      drop("robinhood", people(500, "1")),
      pills,
      100,
      0n,
      null,
      null,
      ETH_PER_PERSON,
      ETH_CAP,
    );
    expect(v.feeWei).toBe(ETH_CAP);
    expect(v.feeSmall).toBe("max fee");
  });

  it("exactly at the cap is not capped: it says the part that made it", () => {
    // 1 person x 50 SOL: 1% is 0.5 SOL, exactly the cap.
    const v = viewOf(
      drop("solana", people(1, "50")),
      pills,
      100,
      0n,
      null,
      null,
      SOL_PER_PERSON,
      SOL_CAP,
    );
    expect(v.feeWei).toBe(SOL_CAP);
    expect(v.feeSmall).toBe("1%");
  });

  it("a zero max fee is no cap", () => {
    const v = viewOf(
      drop("solana", people(2, "50")),
      pills,
      100,
      0n,
      null,
      null,
      SOL_PER_PERSON,
      0n,
    );
    expect(v.feeWei).toBe(1_000_000_000n);
    expect(v.feeSmall).toBe("1%");
  });
});

describe("old api and unknown numbers", () => {
  it("without the two numbers the fee is the old one, as before", () => {
    const v = viewOf(drop("solana", people(3, "0.01")), pills, 100, 0n);
    expect(v.feeWei).toBe(300_000n);
    expect(v.feeSmall).toBe("1%");
  });

  it("a number the api could not read means the fee is not known, never a guess", () => {
    const perPerson = viewOf(
      drop("solana", people(3, "0.01")),
      pills,
      100,
      0n,
      null,
      null,
      null,
      SOL_CAP,
    );
    expect(perPerson.feeWei).toBeNull();
    expect(perPerson.feeBig).toBeNull();
    const cap = viewOf(
      drop("solana", people(3, "0.01")),
      pills,
      100,
      0n,
      null,
      null,
      SOL_PER_PERSON,
      null,
    );
    expect(cap.feeWei).toBeNull();
  });

  it("a token drop keeps its usd tier, never the coin fee rule", () => {
    const tiers = [{ upTo: 5, usd: "1", lamports: "8000000" }];
    const state = [
      { type: "chain", key: "solana" } as const,
      { type: "asset", value: "token" } as const,
      { type: "handleText", value: people(3, "1") } as const,
    ].reduce(reduceForm, initialForm(pills));
    const v = viewOf(state, pills, 100, 0n, null, tiers, SOL_PER_PERSON, SOL_CAP);
    expect(v.feeSmall).not.toContain("per person");
    expect(v.feeWei).toBeNull();
  });
});

describe("the create page passes the two numbers from GET /api/chains", () => {
  const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");

  it("reads minFeePerReceiver and maxFee from each chain", () => {
    expect(page).toContain("entry.minFeePerReceiver");
    expect(page).toContain("entry.maxFee");
  });

  it("gives them to viewOf", () => {
    expect(page).toMatch(/viewOf\([^)]*perReceiver[^)]*maxFee[^)]*\)/);
  });
});
