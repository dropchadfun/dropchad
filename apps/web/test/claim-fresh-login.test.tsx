/**
 * Create and fund, item 6: the second X sign
 * in at claim. A bind needs an X login from the last 10 minutes, counted from the session start
 * (`apps/api/src/routes/bind.ts`), and the page asks again with less than 60 seconds left.
 * - the line says why: `you signed in more than 10 minutes ago. for safety, sign in with X once
 *   more before you pick a wallet. it takes a few seconds.`
 * - the page counts the time down while it is open, so it asks before the paste or the confirm
 *   screen, never after `claim` (before, the number was read once at load and a slow claim got a
 *   401 after the confirm)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClaimView } from "@/components/drops/ClaimView";
import { detailScreen, freshLoginLeft, type ClaimItem } from "@/components/drops/claim";

const SRC = join(import.meta.dirname, "..", "src");
const EVM_DROP = "0x00000000000000000000000000000000000d0b01";
const LINE =
  "you signed in more than 10 minutes ago. for safety, sign in with X once more before you " +
  "pick a wallet. it takes a few seconds.";

const item: ClaimItem = {
  drop: EVM_DROP,
  chainKey: "robinhood-testnet",
  chainId: 46630,
  title: null,
  sender: { handle: "sender", displayName: "the sender", profileImageUrl: null },
  amount: "500000000000000000",
  symbol: "ETH",
  decimals: 18,
  index: 0,
  claimDeadline: "1791806400",
  state: "claimable",
  recipient: null,
  claimTxHash: null,
};

const LOADED = 1_790_000_000_000;

describe("item 6: the time left counts down while the page is open", () => {
  it("at load it is the api's number", () => {
    expect(freshLoginLeft(600, LOADED, LOADED)).toBe(600);
  });

  it("30 seconds later, 30 seconds less", () => {
    expect(freshLoginLeft(600, LOADED, LOADED + 30_000)).toBe(570);
  });

  it("a part of a second is not counted yet", () => {
    expect(freshLoginLeft(600, LOADED, LOADED + 1_500)).toBe(599);
  });

  it("never under zero", () => {
    expect(freshLoginLeft(600, LOADED, LOADED + 3_600_000)).toBe(0);
    expect(freshLoginLeft(0, LOADED, LOADED + 1_000)).toBe(0);
  });

  it("the confirm screen turns into sign in again before the 10 minutes run out", () => {
    const at = (ms: number) => freshLoginLeft(600, LOADED, LOADED + ms);
    expect(detailScreen(item, at(539_000), "confirm")).toBe("confirm");
    expect(detailScreen(item, at(541_000), "confirm")).toBe("fresh-login");
    expect(detailScreen(item, at(541_000), "paste")).toBe("fresh-login");
  });
});

describe("item 6: the words", () => {
  it("says why, before any paste box", () => {
    const html = renderToStaticMarkup(
      <ClaimView
        session={{ handle: "alice" }}
        claims={[item]}
        freshLoginSecondsLeft={10}
        selected={EVM_DROP}
      />,
    );
    expect(html).toMatch(new RegExp(`type-body[^"]*text-chad-text-dim[^>]*>${LINE}<`));
    expect(html).toContain(">sign in again<");
    expect(html).not.toContain("where should it land?");
  });
});

describe("item 6: ClaimView ticks", () => {
  const view = readFileSync(join(SRC, "components", "drops", "ClaimView.tsx"), "utf8");

  it("counts with freshLoginLeft on a timer", () => {
    expect(view).toContain("setInterval(");
    expect(view).toContain("freshLoginLeft(");
  });

  it("stops the timer when the screen goes away", () => {
    expect(view).toContain("clearInterval(");
  });
});
