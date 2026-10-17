/**
 * The top token next to the name on `best token`:
 * after the X link, the token's 16px logo, the ticker (`token`
 * when it has none) and a grey `+N` for the other tokens. The handle keeps its room on the
 * phone: under `sm` the logo only. Not a link. `best dropchad` rows show no token. Rendered with
 * `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardRows } from "@/components/boards/BoardRows";
import type { BoardRow, Profile, TokenInfo } from "@/lib/api";

const MINT = "0x00000000000000000000000000000000000000a1";
const LOGO = `/api/tokens/${MINT}/logo?chain=robinhood`;

const person: Profile = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "sample",
  profileImageUrl: null,
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
};

const token = (symbol: string | null): TokenInfo => ({
  mint: MINT,
  symbol,
  name: symbol,
  decimals: 18,
  tokenProgram: "erc20",
  logoUrl: LOGO,
  launchpad: null,
});

const row = (topToken: TokenInfo | null, tokens: number): BoardRow => ({
  rank: 1,
  profile: person,
  totalWei: "0",
  dropCount: 2,
  claimCount: 3,
  uniqueReceivers: 3,
  biggestDropWei: "0",
  lastDropAt: 1,
  usd: 0,
  byChain: [],
  tokens,
  topToken,
});

const render = (r: BoardRow, board: "fed" | "project" = "project") =>
  renderToStaticMarkup(
    <BoardRows rows={[r]} rankedBy="uniqueReceivers" board={board} testnetOnly={false} />,
  );

/** The markup from the handle to the end of the name line. */
function nameLine(html: string): string {
  const start = html.indexOf("@samplechad<");
  return html.slice(start, html.indexOf('<span class="type-small', start));
}

describe("the top token on best token", () => {
  it("shows the token's logo from our own route after the name", () => {
    const html = render(row(token("PONS"), 1));
    expect(nameLine(html)).toContain(`src="${LOGO.replace(/&/g, "&amp;")}"`);
    expect(nameLine(html)).toMatch(/width="16"/);
  });

  it("shows the ticker", () => {
    expect(nameLine(render(row(token("PONS"), 1)))).toContain(">PONS<");
  });

  it("says token when the token has no ticker, never the short address", () => {
    const line = nameLine(render(row(token(null), 1)));
    expect(line).toContain(">token<");
    expect(line).not.toContain(">0x0000");
  });

  it("shows +N for the other tokens, in grey", () => {
    const line = nameLine(render(row(token("PONS"), 3)));
    expect(line).toMatch(/<span class="[^"]*text-chad-text-dim[^"]*">\+2<\/span>/);
  });

  it("no +N when it is the only token", () => {
    expect(nameLine(render(row(token("PONS"), 1)))).not.toMatch(/\+\d/);
  });

  it("on the phone the logo only: the ticker and +N hide under sm", () => {
    const line = nameLine(render(row(token("PONS"), 3)));
    // The ticker and the +N sit in one box that is hidden on the phone, shown from sm up.
    expect(line).toMatch(
      /<span class="[^"]*hidden[^"]*sm:inline[^"]*">PONS<span[^>]*>\+2<\/span><\/span>/,
    );
    // The logo is outside that box, so it always shows.
    expect(line.indexOf("<img")).toBeLessThan(line.indexOf(">PONS<"));
  });

  it("is not a link: the row still opens the profile", () => {
    const line = nameLine(render(row(token("PONS"), 3)));
    expect(line).not.toContain("/api/tokens/" + MINT + '"');
    expect(line.match(/<a /g) ?? []).toHaveLength(1); // the X link only
  });
});

describe("best dropchad shows no token", () => {
  it("no logo, no ticker on a fed row", () => {
    const html = render(row(null, 0), "fed");
    expect(html).not.toContain("/api/tokens/");
    expect(nameLine(html)).not.toContain(">token<");
  });
});
