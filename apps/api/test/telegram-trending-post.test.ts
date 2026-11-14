/**
 * The trending post text: a testnet line on top, `🤌 TRENDING`
 * (`🤌 TRENDING (beta version)` and an italic last row on a mainnet site), the
 * three cards with up to 3 short rows each, a last plain line, handles linked to x.com,
 * the ticker in `<code>`, no times, never the profile name, the one button.
 */
import { describe, expect, it } from "vitest";

import type { BoardProfile } from "../src/boards/compute.js";
import {
  NO_TRENDING,
  type ChadItem,
  type CoinItem,
  type DropItem,
  type TrendingCards,
} from "../src/boards/trending.js";
import type { TokenInfo } from "../src/drops/token-info.js";
import { buildTrendingPost, trendingButton } from "../src/telegram/trending-post.js";

const SOL = 10n ** 9n;
const ETH = 10n ** 18n;

function profile(handle: string, displayName = "Sample Name"): BoardProfile {
  return {
    xUserId: `id-${handle}`,
    handle,
    displayName,
    profileImageUrl: null,
    kind: "chad",
    tags: [],
    tagLockedUntil: null,
    badges: [],
    streams: [],
  };
}

function token(mint: string, symbol: string | null, decimals = 6): TokenInfo {
  return {
    mint,
    symbol,
    name: "Sample Token",
    decimals,
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    logoUrl: `/api/tokens/${mint}/logo`,
    launchpad: null,
    xUrl: null,
  };
}

const chad = (handle: string, people: number, amount: bigint, chainKey = "solana-devnet") =>
  ({
    profile: profile(handle),
    people,
    drops: 1,
    lastDropAt: 1_800_000_000,
    chainKey,
    amount,
  }) satisfies ChadItem;

const coin = (handle: string, symbol: string | null, total: bigint, people: number) =>
  ({
    token: token("SampleMint1111111111111111111111111111111111", symbol),
    chainKey: "solana-devnet",
    drops: 1,
    people,
    sender: profile(handle),
    newestDrop: "SampleDrop111111111111111111111111111111111",
    total,
  }) satisfies CoinItem;

const drop = (
  handle: string,
  total: bigint,
  receivers: number,
  options: { chainKey?: string; token?: TokenInfo | null } = {},
) =>
  ({
    address: `drop-${handle}`,
    chainKey: options.chainKey ?? "solana-devnet",
    sender: profile(handle),
    receivers,
    total,
    token: options.token ?? null,
    fundedAt: 1_800_000_000,
  }) satisfies DropItem;

function cards(parts: { chad?: ChadItem[]; coin?: CoinItem[]; drop?: DropItem[] }): TrendingCards {
  return {
    chad: { range: "day", items: parts.chad ?? [] },
    coin: { range: "day", items: parts.coin ?? [] },
    drop: { items: parts.drop ?? [] },
  };
}

const x = (handle: string) => `<a href="https://x.com/${handle}">${handle}</a>`;

describe("the rows", () => {
  it("a full post on a testnet, the blocks one empty line apart", () => {
    const text = buildTrendingPost(
      cards({
        chad: [
          chad("alpha", 12, (81n * SOL) / 10n),
          chad("bravo", 3, ETH / 20n, "robinhood-testnet"),
        ],
        coin: [coin("charlie", "BONK", 2_000n * 10n ** 6n, 210)],
        drop: [drop("delta", 3n * SOL, 200)],
      }),
      "testnet",
    );
    expect(text).toBe(
      [
        "<b>🧪 TESTNET, test coins only</b>",
        "<b>🤌 TRENDING</b>",
        `<b>chads of the day</b>\n1. ${x("alpha")} 8.1 SOL\n2. ${x("bravo")} 0.05 ETH`,
        `<b>top coins</b>\n1. 2K <code>$BONK</code> by ${x("charlie")}`,
        `<b>just dropped</b>\n1. 3 SOL by ${x("delta")}`,
        "full info on dropchad.com",
      ].join("\n\n"),
    );
  });

  it("on a testnet the last line is plain text, after one empty line", () => {
    const text = buildTrendingPost(NO_TRENDING, "testnet");
    expect(text.endsWith("\n\nfull info on dropchad.com")).toBe(true);
    expect(text).not.toContain("<i>");
  });

  it("on a mainnet the italic line sits right under the last line, no empty line", () => {
    const text = buildTrendingPost(NO_TRENDING, "mainnet");
    expect(
      text.endsWith(
        "\n\nfull info on dropchad.com\n<i>we never dm you and never ask for anything</i>",
      ),
    ).toBe(true);
    expect(text.match(/<i>/g)).toHaveLength(1);
  });

  it("on a mainnet the title says beta version and there is no testnet line", () => {
    const text = buildTrendingPost(NO_TRENDING, "mainnet");
    expect(text.startsWith("<b>🤌 TRENDING (beta version)</b>\n\n")).toBe(true);
    expect(text).not.toContain("TESTNET");
  });

  it("on a testnet the title stays as it was", () => {
    const text = buildTrendingPost(NO_TRENDING, "testnet");
    expect(text).toContain("\n\n<b>🤌 TRENDING</b>\n\n");
    expect(text).not.toContain("beta version");
  });

  it("empty cards say the words of the front page", () => {
    expect(buildTrendingPost(NO_TRENDING, "mainnet")).toBe(
      [
        "<b>🤌 TRENDING (beta version)</b>",
        "<b>chads of the day</b>\nno SOL or ETH drops today.",
        "<b>top coins</b>\nno coin drops today.",
        "<b>just dropped</b>\nno drops yet.",
        "full info on dropchad.com\n<i>we never dm you and never ask for anything</i>",
      ].join("\n\n"),
    );
  });

  it("at most 3 rows per card, numbered in the given order", () => {
    const text = buildTrendingPost(
      cards({ chad: ["a1", "a2", "a3", "a4"].map((h) => chad(h, 1, SOL)) }),
      "mainnet",
    );
    expect(text).toContain(`1. ${x("a1")}`);
    expect(text).toContain(`3. ${x("a3")}`);
    expect(text).not.toContain("a4");
  });

  it("a chad row is the handle and the chain coin amount, no comma", () => {
    const text = buildTrendingPost(
      cards({ chad: [chad("firstchad", 2, 20n * SOL), chad("two", 9, ETH, "robinhood-testnet")] }),
      "mainnet",
    );
    expect(text).toContain(
      `<b>chads of the day</b>\n1. ${x("firstchad")} 20 SOL\n2. ${x("two")} 1 ETH\n`,
    );
  });

  it("a top coin row is the total, the ticker, then by the handle", () => {
    const text = buildTrendingPost(
      cards({ coin: [coin("firstchad", "TEST", 100_000n * 10n ** 6n, 4)] }),
      "mainnet",
    );
    expect(text).toContain(`<b>top coins</b>\n1. 100K <code>$TEST</code> by ${x("firstchad")}\n`);
  });

  it("no people count on any row", () => {
    const text = buildTrendingPost(
      cards({
        chad: [chad("alpha", 9, SOL)],
        coin: [coin("b", "BONK", 10n ** 6n, 9)],
        drop: [drop("c", SOL, 9)],
      }),
      "mainnet",
    );
    expect(text).not.toMatch(/people|person/);
    expect(text).not.toContain(" to ");
  });

  it("the given order of each list is kept", () => {
    const text = buildTrendingPost(
      cards({
        chad: [chad("small", 1, SOL), chad("big", 1, 9n * SOL)],
        coin: [coin("c1", "LOW", 10n ** 6n, 1), coin("c2", "HIGH", 10n ** 9n, 1)],
      }),
      "mainnet",
    );
    expect(text).toContain(`1. ${x("small")} 1 SOL\n2. ${x("big")} 9 SOL\n`);
    expect(text).toContain(`1. 1 <code>$LOW</code> by ${x("c1")}\n2. 1K <code>$HIGH</code>`);
  });

  it("a coin amount below 1 keeps two significant digits, rounded down", () => {
    const text = buildTrendingPost(
      cards({
        chad: [chad("tiny", 2, 1_234_567n)],
        drop: [drop("small", 1_234_567n, 2)],
      }),
      "mainnet",
    );
    expect(text).toContain(`1. ${x("tiny")} 0.0012 SOL\n`);
    expect(text).toContain(`1. 0.0012 SOL by ${x("small")}\n`);
  });
});

describe("tokens", () => {
  it("a ticker that starts with $ gets no second one; no ticker is tokens, no $", () => {
    const text = buildTrendingPost(
      cards({ coin: [coin("a", "$WIF", 10n ** 6n, 1), coin("b", null, 15n * 10n ** 11n, 4)] }),
      "mainnet",
    );
    expect(text).toContain(`1. 1 <code>$WIF</code> by ${x("a")}\n`);
    expect(text).toContain(`2. 1.5M <code>tokens</code> by ${x("b")}\n`);
    expect(text).not.toContain("$$");
  });

  it("a long ticker is cut at 32 characters", () => {
    const long = "A".repeat(40);
    const text = buildTrendingPost(cards({ coin: [coin("a", long, 10n ** 6n, 1)] }), "mainnet");
    expect(text).toContain(`<code>$${"A".repeat(31)}</code>`);
    expect(text).not.toContain("A".repeat(32));
  });

  it("just dropped: a stablecoin short with its ticker, another token short with coins", () => {
    const usdc = token("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", null);
    const meme = token("SampleMint1111111111111111111111111111111111", "MEME");
    const text = buildTrendingPost(
      cards({
        drop: [
          drop("s", 1_000n * 10n ** 6n, 5, { token: usdc }),
          drop("m", 2_000n * 10n ** 6n, 7, { token: meme }),
        ],
      }),
      "testnet",
    );
    expect(text).toContain(`1. 1K USDC by ${x("s")}\n`);
    expect(text).toContain(`2. 2K coins by ${x("m")}\n`);
  });
});

describe("text from users", () => {
  it("a handle outside the X charset is plain escaped text, no link", () => {
    const text = buildTrendingPost(cards({ chad: [chad("<b>bad</b>", 1, SOL)] }), "mainnet");
    expect(text).toContain("1. &lt;b&gt;bad&lt;/b&gt; 1 SOL");
    expect(text).not.toContain("<b>bad");
    expect(text).not.toContain("x.com/<");
  });

  it("the ticker is escaped inside <code>", () => {
    const text = buildTrendingPost(
      cards({ coin: [coin("a", '<a href="x.co">x</a>', 10n ** 6n, 1)] }),
      "mainnet",
    );
    expect(text).toContain("<code>$&lt;a href=&quot;x.co&quot;&gt;x&lt;/a&gt;</code>");
    expect(text).not.toContain('href="x.co');
  });

  it("a ticker with newlines stays on one line", () => {
    const text = buildTrendingPost(
      cards({ coin: [coin("a", "GO\nNOW", 10n ** 6n, 1)] }),
      "mainnet",
    );
    expect(text).toContain("<code>$GO NOW</code>");
  });

  it("never the profile name", () => {
    const item = { ...chad("alpha", 1, SOL), profile: profile("alpha", "Name With Link.com") };
    const text = buildTrendingPost(cards({ chad: [item] }), "mainnet");
    expect(text).not.toContain("Name With Link");
  });

  it("only the a, b and code tags", () => {
    const text = buildTrendingPost(
      cards({
        chad: [chad("alpha", 1, SOL)],
        coin: [coin("b", "BONK", 10n ** 6n, 1)],
        drop: [drop("c", SOL, 1)],
      }),
      "testnet",
    );
    const tags = new Set([...text.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]));
    expect([...tags].sort()).toEqual(["a", "b", "code"]);
  });

  it("on a mainnet only the a, b, code and i tags", () => {
    const text = buildTrendingPost(
      cards({
        chad: [chad("alpha", 1, SOL)],
        coin: [coin("b", "BONK", 10n ** 6n, 1)],
        drop: [drop("c", SOL, 1)],
      }),
      "mainnet",
    );
    const tags = new Set([...text.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]));
    expect([...tags].sort()).toEqual(["a", "b", "code", "i"]);
  });

  it("<b> holds only the five fixed titles, each a whole row", () => {
    const text = buildTrendingPost(
      cards({
        chad: [chad("alpha", 1, SOL)],
        coin: [coin("b", "BONK", 10n ** 6n, 1)],
        drop: [drop("c", SOL, 1)],
      }),
      "testnet",
    );
    const bold = [...text.matchAll(/<b>(.*?)<\/b>/g)].map((m) => m[1]);
    expect(bold).toEqual([
      "🧪 TESTNET, test coins only",
      "🤌 TRENDING",
      "chads of the day",
      "top coins",
      "just dropped",
    ]);
    for (const line of text.split("\n")) {
      if (line.includes("<b>")) expect(line).toMatch(/^<b>[^<]*<\/b>$/);
    }
  });

  it("a ticker or a handle with <b> is escaped, never bold", () => {
    const text = buildTrendingPost(
      cards({
        chad: [chad("<b>x</b>", 1, SOL)],
        coin: [coin("a", "<b>BOLD</b>", 10n ** 6n, 1)],
      }),
      "mainnet",
    );
    expect(text).toContain("<code>$&lt;b&gt;BOLD&lt;/b&gt;</code>");
    expect(text).toContain("1. &lt;b&gt;x&lt;/b&gt; 1 SOL");
    expect([...text.matchAll(/<b>/g)]).toHaveLength(4);
  });

  it("no times in the text", () => {
    const text = buildTrendingPost(cards({ drop: [drop("c", SOL, 1)] }), "mainnet");
    expect(text).not.toMatch(/ago|just now|\d:\d/);
  });
});

describe("the button", () => {
  it("one url button, open dropchad, to the site", () => {
    expect(trendingButton("https://dropchad.com/")).toEqual({
      inline_keyboard: [[{ text: "open dropchad", url: "https://dropchad.com" }]],
    });
  });
});
