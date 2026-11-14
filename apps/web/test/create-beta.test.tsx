/**
 * The beta on `/create`, mainnet only: the
 * notice under the `total` tile on step 1, the tick box before `drop it` and `send it` on step 2,
 * and the over the cap line right under `total`. The cap numbers are written once in
 * `lib/beta.ts` and shared with `/terms` and `/about`. Rendered with `react-dom/server`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BetaNotice, BetaTick } from "@/components/create/BetaLines";
import {
  initialForm,
  reduceForm,
  viewOf,
  type CreateMode,
  type FormAction,
  type FormState,
  type HandlePreview,
} from "@/components/create/form";
import { BETA_NOTICE, BETA_TICK, DROP_CAPS } from "@/lib/beta";
import { chainPills } from "@/lib/chains";

const pills = chainPills();
const SRC = join(import.meta.dirname, "..", "src");
const SOLANA_KEY = pills.find((pill) => pill.key === "solana")?.chainKey as string;
const ROBINHOOD_KEY = pills.find((pill) => pill.key === "robinhood")?.chainKey as string;
const bothOn = { [SOLANA_KEY]: true, [ROBINHOOD_KEY]: true };

const HANDLES = "@alice 0.01\n@bob 0.02";
const SOL_P = "CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB";

const preview = (text: string): HandlePreview => ({
  forText: text,
  found: [
    { handle: "alice", xUserId: "1", displayName: "Alice", profileImageUrl: null },
    { handle: "bob", xUserId: "2", displayName: "Bob", profileImageUrl: null },
  ],
  missing: [],
});

/** A Solana drop or multisend on step 2 with everything ok, the beta flag as given. */
function step2(mode: CreateMode, beta: boolean, ...more: FormAction[]): FormState {
  const start: FormAction[] =
    mode === "drop"
      ? [
          { type: "handleModes", value: bothOn },
          { type: "chain", key: "solana" },
          { type: "handleText", value: HANDLES },
          { type: "preview", preview: preview(HANDLES) },
          { type: "next" },
        ]
      : [
          { type: "chain", key: "solana" },
          { type: "text", value: `${SOL_P} 0.01` },
          { type: "next" },
        ];
  return [...start, { type: "refund", value: SOL_P } as const, ...more].reduce(
    reduceForm,
    initialForm(pills, mode, beta),
  );
}

describe("the words", () => {
  it("the caps, written once", () => {
    expect(DROP_CAPS).toBe(
      "2 SOL, 200 USDC, 200 USDT or 200 USD1 on solana", // the live chains, Solana alone
    );
  });

  it("the notice and the tick box", () => {
    expect(BETA_NOTICE).toBe(
      "dropchad is in beta. each drop has a limit while we grow: 2 SOL, 200 USDC, 200 USDT or 200 USD1 on solana. other tokens have no limit.",
    );
    expect(BETA_TICK).toBe("i understand dropchad is in beta and i send at my own risk.");
  });

  it("/terms and /about read the same caps, never their own copy", () => {
    const trust = readFileSync(join(SRC, "components", "site", "TrustPage.tsx"), "utf8");
    expect(trust).toMatch(/import \{[^}]*DROP_CAPS[^}]*\} from "@\/lib\/beta"/);
    expect(trust).not.toMatch(/const DROP_CAPS/);
  });
});

describe("the notice", () => {
  it("mainnet: one grey small line", () => {
    const html = renderToStaticMarkup(<BetaNotice show />);
    expect(html).toContain(BETA_NOTICE);
    expect(html).toMatch(/<p class="[^"]*\btype-small\b[^"]*\btext-chad-text-dim\b/);
  });

  it("testnet: nothing", () => {
    expect(renderToStaticMarkup(<BetaNotice show={false} />)).toBe("");
  });
});

describe("the tick box", () => {
  it("mainnet: a check box and its words in one label, 44px tall", () => {
    const html = renderToStaticMarkup(<BetaTick show checked={false} onChange={() => {}} />);
    expect(html).toMatch(/^<label class="[^"]*\bmin-h-11\b[^"]*"[^>]*><input type="checkbox"/);
    expect(html).toContain(BETA_TICK);
    expect(html).not.toContain("checked");
  });

  it("mainnet: the row takes no more room than the other step 2 rows, the 44px target kept", () => {
    const html = renderToStaticMarkup(<BetaTick show checked={false} onChange={() => {}} />);
    const label = html.match(/^<label class="([^"]*)"/)?.[1] ?? "";
    // `space-y-6` puts the 24px gap in this row's margin-block-end; `-mt-3 mb-3` keep 12px of it
    // below and take 12px above, so the words sit 24px from each neighbour. `-my-3` would not.
    const classes = label.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["min-h-11", "-mt-3", "mb-3"]));
    expect(classes).not.toContain("-my-3");
  });

  it("ticked shows ticked", () => {
    const html = renderToStaticMarkup(<BetaTick show checked onChange={() => {}} />);
    expect(html).toMatch(/<input type="checkbox"[^>]*checked=""/);
  });

  it("testnet: nothing", () => {
    expect(
      renderToStaticMarkup(<BetaTick show={false} checked={false} onChange={() => {}} />),
    ).toBe("");
  });

  for (const mode of ["drop", "multisend"] as const) {
    it(`${mode}, mainnet: the button stays grey until it is ticked`, () => {
      expect(viewOf(step2(mode, true), pills).step2Ok).toBe(false);
      const ticked = step2(mode, true, { type: "betaAccepted", value: true });
      expect(viewOf(ticked, pills).step2Ok).toBe(true);
      const unticked = step2(
        mode,
        true,
        { type: "betaAccepted", value: true },
        {
          type: "betaAccepted",
          value: false,
        },
      );
      expect(viewOf(unticked, pills).step2Ok).toBe(false);
    });

    it(`${mode}, testnet: no tick box, the button as before`, () => {
      expect(viewOf(step2(mode, false), pills).step2Ok).toBe(true);
    });
  }

  it("a new drop starts not ticked, and the flag is off unless asked for", () => {
    expect(initialForm(pills)).toMatchObject({ beta: false, betaAccepted: false });
    expect(initialForm(pills, "multisend", true)).toMatchObject({
      beta: true,
      betaAccepted: false,
    });
  });
});

describe("the create page", () => {
  const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");
  const step1 = page.slice(page.indexOf("{step === 1 ?"), page.indexOf("{step === 2 ?"));
  const step2Src = page.slice(
    page.indexOf("{step === 2 ?"),
    page.indexOf("{step === 3 && created"),
  );

  it("starts the form with the beta flag of the site: mainnet only", () => {
    expect(page).toMatch(/initialForm\(start, initialMode, !TESTNET_ONLY\)/);
    expect(page).toMatch(/import \{[^}]*TESTNET_ONLY[^}]*\} from "@\/lib\/chains"/);
  });

  it("step 1: the over the cap line in small red right under total, then the notice", () => {
    const total = step1.indexOf('label="total"');
    const capLine = step1.search(
      /amountCheck\.code === "drop_too_big"[\s\S]{0,200}<p className="type-small mt-2 text-chad-error">/,
    );
    const notice = step1.indexOf("<BetaNotice show={!TESTNET_ONLY} />");
    expect(total).toBeGreaterThan(-1);
    expect(capLine).toBeGreaterThan(total);
    expect(notice).toBeGreaterThan(capLine);
    expect(notice).toBeLessThan(step1.indexOf("<Primary"));
  });

  it("step 1: the other refusals keep their line under the list, never twice", () => {
    expect(step1).toMatch(
      /amountCheck\.state === "refused" &&\s*amountCheck\.code !== "drop_too_big"/,
    );
  });

  it("step 2: the tick box right above back and drop it, in both modes", () => {
    const tick = step2Src.search(
      /<BetaTick\s+show=\{!TESTNET_ONLY\}\s+checked=\{form\.betaAccepted\}\s+onChange=\{\(value\) => dispatch\(\{ type: "betaAccepted", value \}\)\}/,
    );
    expect(tick).toBeGreaterThan(step2Src.indexOf("view.feeFromMin"));
    expect(tick).toBeLessThan(step2Src.indexOf('dispatch({ type: "back" })'));
  });

  it("the create call is never sent without the tick", () => {
    const submit = page.slice(page.indexOf("const submit = async"));
    const guard = submit.indexOf("if (!step2Ok) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(submit.indexOf("readCsrfToken()"));
  });
});
