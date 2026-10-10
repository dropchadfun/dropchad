/**
 * Create and fund, item 4: step 3, the way back to
 * it. Under the funding card: the label `your drop page`, the link short in mono and `copy link`,
 * then `it is on your profile too.` A multisend: `your multisend page`, the `/m/` link, `copy
 * link`, and `save this link. a multisend is on no list, so this link is the way back.` (: a
 * multisend is on no list and no profile.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WayBack, wayBack } from "@/components/create/WayBack";

const SRC = join(import.meta.dirname, "..", "src");
const ORIGIN = "https://dropchad.com";
const EVM = "0x1234567890AbCdEf1234567890aBcDeF12345678";
const SOL = "3wKoQAsKhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr124m5";

describe("item 4: the way back, the words and the link", () => {
  it("a drop: your drop page, /d/, on your profile too", () => {
    expect(wayBack("drop", EVM, ORIGIN)).toEqual({
      label: "your drop page",
      path: `/d/${EVM}`,
      url: `https://dropchad.com/d/${EVM}`,
      shown: "dropchad.com/d/0x1234…5678",
      note: "it is on your profile too.",
    });
  });

  it("a multisend: your multisend page, /m/, save this link", () => {
    expect(wayBack("multisend", SOL, ORIGIN)).toEqual({
      label: "your multisend page",
      path: `/m/${SOL}`,
      url: `https://dropchad.com/m/${SOL}`,
      shown: "dropchad.com/m/3wKoQA…24m5",
      note: "save this link. a multisend is on no list, so this link is the way back.",
    });
  });

  it("the link follows the site it is on, a local dev server too", () => {
    const local = wayBack("drop", EVM, "http://localhost:3123");
    expect(local.url).toBe(`http://localhost:3123/d/${EVM}`);
    expect(local.shown).toBe("localhost:3123/d/0x1234…5678");
  });
});

describe("item 4: the way back, as rendered", () => {
  const drop = renderToStaticMarkup(<WayBack mode="drop" address={EVM} origin={ORIGIN} />);
  const multi = renderToStaticMarkup(<WayBack mode="multisend" address={SOL} origin={ORIGIN} />);

  it("the label, the link in mono and copy link", () => {
    expect(drop).toContain(">your drop page<");
    expect(drop).toMatch(new RegExp(`<a[^>]*href="/d/${EVM}"[^>]*font-mono`));
    expect(drop).toContain(">dropchad.com/d/0x1234…5678<");
    expect(drop).toContain("copy link");
    expect(drop).toMatch(/type-small[^"]*text-chad-text-dim[^>]*>it is on your profile too\.</);
  });

  it("a multisend never says drop or profile", () => {
    expect(multi).toContain(">your multisend page<");
    expect(multi).toContain(`href="/m/${SOL}"`);
    expect(multi).toContain(
      "save this link. a multisend is on no list, so this link is the way back.",
    );
    expect(multi).toContain("copy link");
    expect(multi).not.toContain("drop page");
    expect(multi).not.toContain("profile");
  });
});

describe("item 4: create step 3 shows it under the funding card", () => {
  const page = readFileSync(join(SRC, "components", "create", "CreateDrop.tsx"), "utf8");

  it("renders WayBack with the mode and the created address", () => {
    expect(page).toMatch(
      /<WayBack[\s\S]{0,200}mode=\{mode\}[\s\S]{0,200}address=\{created\.drop\.address\}/,
    );
  });

  it("right under the funding card", () => {
    const card = page.indexOf("<FundingCardFrom");
    const back = page.indexOf("<WayBack");
    expect(card).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(card);
  });
});
