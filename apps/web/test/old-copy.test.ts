/**
 * The old words. only handle drops
 * count, and a person is an X account, never a wallet. Reads every source file under `src`,
 * not the tests. Only the multisend page says wallets, and it never uses these phrases.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  name: relative(SRC, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

const read = (name: string): string => {
  const file = files.find((f) => f.name === name);
  if (file === undefined) throw new Error(`missing ${name}`);
  return file.text;
};

describe("old copy is gone from the web", () => {
  const OLD = [
    "wallets fed",
    "wallets paid",
    'short="wallets"',
    "people who got paid",
    "paying themselves",
    "counts real payouts",
    "counting address drops",
    // The /create chain box: plain words instead.
    "chosen in step 1",
    // people, never the crowd; `1%`, never the word.
    "to the crowd",
    "the crowd does not claim",
    "1 percent",
    // The funding card copies the amount in coins, never in base units.
    "copy wei",
  ];

  for (const phrase of OLD) {
    it(`no source file says ${phrase}`, () => {
      const hits = files.filter((f) => f.text.includes(phrase)).map((f) => f.name);
      expect(hits).toEqual([]);
    });
  }
});

/** The text without its comments, so only what can reach the screen is checked. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("no crowd and no spelled percent on the site", () => {
  // The files outside `src/**/*.ts(x)` that still reach a screen or a link preview.
  const OTHER = ["app/manifest.webmanifest", "app/opengraph-image.alt.txt"];
  const shown = [
    ...files.map((f) => ({ name: f.name, text: withoutComments(f.text) })),
    ...OTHER.map((name) => ({
      name,
      text: withoutComments(readFileSync(join(SRC, name), "utf8")),
    })),
  ];

  it("the word crowd is gone from every screen", () => {
    const hits = shown.filter((f) => /\bcrowd\b/i.test(f.text)).map((f) => f.name);
    expect(hits).toEqual([]);
  });

  it("a percent is written with %, never as a word after a number", () => {
    const hits = shown
      .filter((f) => /(\d|\})\s*percent\b/.test(f.text.replace(/<!--[\s\S]*?-->/g, "")))
      .map((f) => f.name);
    expect(hits).toEqual([]);
  });

  it("an estimate is ≈, never the word about before a number", () => {
    const hits = shown.filter((f) => /\babout\s+(\d|\$\{)/i.test(f.text)).map((f) => f.name);
    expect(hits).toEqual([]);
  });

  it("the tagline says drop crypto, prove you did", () => {
    const TAGLINE = "drop crypto, prove you did. every drop is proved on chain.";
    expect(read("app/layout.tsx")).toContain(TAGLINE);
    expect(readFileSync(join(SRC, "app/manifest.webmanifest"), "utf8")).toContain(TAGLINE);
    expect(readFileSync(join(SRC, "app/opengraph-image.alt.txt"), "utf8")).toContain(TAGLINE);
  });
});

describe("the new words are where they belong", () => {
  it("the front page and the profile tiles say payouts, with the people under it", () => {
    // the big number is payouts, the label the same on the phone.
    for (const name of ["components/front/FrontPage.tsx", "app/u/[handle]/page.tsx"]) {
      const text = read(name);
      expect(text, name).toContain('label="payouts"');
      expect(text, name).toContain('short="payouts"');
      expect(text, name).not.toContain("x accounts that claimed");
      expect(text, name).not.toContain('label="people paid"');
    }
    // The profile tile reads its own totals: payouts big, the people line under it.
    const profile = read("app/u/[handle]/page.tsx");
    expect(profile).toContain("totals.claimCount");
    expect(profile).toContain("formatPeople(totals.uniqueReceivers)");
  });

  it("the drop page counter says people fed, live and after", () => {
    for (const name of ["components/drops/LiveView.tsx", "components/drops/AfterView.tsx"]) {
      expect(read(name), name).toContain("people fed");
    }
  });

  it("the boards page uses the foot line component", () => {
    expect(read("components/boards/BoardsPage.tsx")).toContain("<BoardsFoot />");
  });

  it("no `change it with back` on /create, the back button is enough", () => {
    expect(read("components/create/CreateDrop.tsx")).not.toContain("change it with back");
  });

  it("the step 2 tile and the funding card row say people get", () => {
    expect(read("components/create/CreateDrop.tsx")).toContain('label="people get"');
    expect(read("components/drops/FundingCard.tsx")).toContain(">people get<");
    expect(read("components/create/CreateDrop.tsx")).toContain(
      "whatever people do not claim in 7 days comes back here.",
    );
  });

  it("the funding card's copy amount button copies the exact amount in coins", () => {
    expect(read("components/drops/FundingCard.tsx")).toContain(
      '<CopyButton value={exactAmount(grossWei, decimals)} label="copy amount" />',
    );
  });
});
