/**
 * The Telegram channel post text: the rows, one empty
 * line between them, Telegram HTML with only `a` and `code`, every stranger's word escaped, the
 * token links per chain.
 */
import { describe, expect, it } from "vitest";

import {
  buildTelegramPost,
  escapeTelegramHtml,
  tokenLinks,
  type TelegramPostFacts,
} from "../src/telegram/post.js";

const SITE = "https://dropchad.com";
const DROP_SOL = "Samp1eSoLDrop11111111111111111111111111111";
const DROP_EVM = "0x00000000000000000000000000000000005a0d01";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const PONS = "0x39dbed3a2bd333467115de45665cc57f813c4571";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const solDrop: TelegramPostFacts = {
  dropAddress: DROP_SOL,
  chainKey: "solana",
  senderHandle: "samplechad",
  amount: "2000000000",
  decimals: 9,
  coinSymbol: "SOL",
  receivers: 5,
  title: null,
  token: null,
};

const rows = (text: string) => text.split("\n\n");

describe("the rows", () => {
  it("a SOL drop: exactly the owner's rows, one empty line between them", () => {
    expect(buildTelegramPost(solDrop, SITE)).toBe(
      [
        "🤌 NEW DROP",
        'from <a href="https://x.com/samplechad">samplechad</a>',
        "2 SOL to 5 chads",
        "chain: solana",
        `<a href="https://dropchad.com/d/${DROP_SOL}">dropchad.com</a>`,
      ].join("\n\n"),
    );
  });

  it("one receiver is 1 chad", () => {
    expect(rows(buildTelegramPost({ ...solDrop, receivers: 1 }, SITE))[2]).toBe("2 SOL to 1 chad");
  });

  it("an ETH drop on robinhood, the amount exact like the drop page", () => {
    const text = buildTelegramPost(
      {
        ...solDrop,
        dropAddress: DROP_EVM,
        chainKey: "robinhood",
        amount: "500000000000000",
        decimals: 18,
        coinSymbol: "ETH",
        receivers: 2,
      },
      SITE,
    );
    expect(rows(text)[2]).toBe("0.0005 ETH to 2 chads");
    expect(rows(text)[3]).toBe("chain: robinhood");
    expect(text).toContain(`href="https://dropchad.com/d/${DROP_EVM}"`);
  });

  it("the sender link has no @, so Telegram opens X, not a Telegram user", () => {
    const from = rows(buildTelegramPost(solDrop, SITE))[1] ?? "";
    expect(from).not.toContain("@");
  });

  it("a handle outside the X charset is plain text, no link", () => {
    const from = rows(buildTelegramPost({ ...solDrop, senderHandle: 'bad"><b>x' }, SITE))[1];
    expect(from).toBe("from bad&quot;&gt;&lt;b&gt;x");
  });

  it("the title row, in code, skipped when there is none", () => {
    const text = buildTelegramPost({ ...solDrop, title: "gm chads" }, SITE);
    expect(rows(text)).toContain("message: <code>gm chads</code>");
    expect(buildTelegramPost({ ...solDrop, title: "" }, SITE)).not.toContain("message:");
    expect(buildTelegramPost({ ...solDrop, title: "   " }, SITE)).not.toContain("message:");
  });

  it("the title is escaped and on one line", () => {
    const text = buildTelegramPost(
      { ...solDrop, title: 'a <b>bold</b> & "q"\nnew\u0000line\tx' },
      SITE,
    );
    expect(rows(text)).toContain(
      "message: <code>a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot; new line x</code>",
    );
  });

  it("the testnets say solana devnet and robinhood testnet", () => {
    expect(rows(buildTelegramPost({ ...solDrop, chainKey: "solana-devnet" }, SITE))[3]).toBe(
      "chain: solana devnet",
    );
    expect(
      rows(buildTelegramPost({ ...solDrop, chainKey: "robinhood-testnet", decimals: 18 }, SITE))[3],
    ).toBe("chain: robinhood testnet");
  });

  it("the site link follows SHARE_BASE_URL", () => {
    expect(buildTelegramPost(solDrop, "https://example.test")).toContain(
      `<a href="https://example.test/d/${DROP_SOL}">dropchad.com</a>`,
    );
  });
});

describe("a token drop", () => {
  const bonk: TelegramPostFacts = {
    ...solDrop,
    amount: "1000000000000",
    decimals: 5,
    receivers: 1,
    token: { address: BONK, name: "Bonk", symbol: "BONK" },
  };

  it("the amount in the ticker, the token row, the links, in the owner's order", () => {
    expect(buildTelegramPost({ ...bonk, title: "gm" }, SITE)).toBe(
      [
        "🤌 NEW DROP",
        'from <a href="https://x.com/samplechad">samplechad</a>',
        "10000000 BONK to 1 chad",
        `<code>Bonk</code>, <code>${BONK}</code>`,
        "chain: solana",
        "message: <code>gm</code>",
        `<a href="https://dexscreener.com/solana/${BONK}">dexscreener</a> | ` +
          `<a href="https://axiom.trade/t/${BONK}">axiom</a> | ` +
          `<a href="https://gmgn.ai/sol/token/${BONK}">gmgn</a>`,
        `<a href="https://dropchad.com/d/${DROP_SOL}">dropchad.com</a>`,
      ].join("\n\n"),
    );
  });

  it("the name is escaped and cut at 32 characters", () => {
    const name = `<x>${"n".repeat(40)}`;
    const text = buildTelegramPost({ ...bonk, token: { ...bonk.token!, name } }, SITE);
    expect(rows(text)[3]).toBe(`<code>&lt;x&gt;${"n".repeat(29)}</code>, <code>${BONK}</code>`);
  });

  it("no name: the ticker; neither: the address only; no ticker: tokens", () => {
    const noName = buildTelegramPost({ ...bonk, token: { ...bonk.token!, name: null } }, SITE);
    expect(rows(noName)[3]).toBe(`<code>BONK</code>, <code>${BONK}</code>`);
    const neither = buildTelegramPost(
      { ...bonk, token: { address: BONK, name: null, symbol: null } },
      SITE,
    );
    expect(rows(neither)[3]).toBe(`<code>${BONK}</code>`);
    expect(rows(neither)[2]).toBe("10000000 tokens to 1 chad");
  });

  it("a ticker from a stranger is escaped too", () => {
    const text = buildTelegramPost({ ...bonk, token: { ...bonk.token!, symbol: "<i>&" } }, SITE);
    expect(rows(text)[2]).toBe("10000000 &lt;i&gt;&amp; to 1 chad");
  });

  it("no link row on a testnet", () => {
    const text = buildTelegramPost({ ...bonk, chainKey: "solana-devnet" }, SITE);
    expect(text).not.toContain("dexscreener");
    expect(text).toContain(`<code>${BONK}</code>`);
  });
});

describe("the token links", () => {
  it("solana: dexscreener, axiom, gmgn", () => {
    expect(tokenLinks("solana", BONK)).toEqual([
      { label: "dexscreener", url: `https://dexscreener.com/solana/${BONK}` },
      { label: "axiom", url: `https://axiom.trade/t/${BONK}` },
      { label: "gmgn", url: `https://gmgn.ai/sol/token/${BONK}` },
    ]);
  });

  it("robinhood: dexscreener and gmgn, no axiom", () => {
    expect(tokenLinks("robinhood", PONS)).toEqual([
      { label: "dexscreener", url: `https://dexscreener.com/robinhood/${PONS}` },
      { label: "gmgn", url: `https://gmgn.ai/robinhood/token/${PONS}` },
    ]);
  });

  it("none on the testnets", () => {
    expect(tokenLinks("solana-devnet", BONK)).toEqual([]);
    expect(tokenLinks("robinhood-testnet", PONS)).toEqual([]);
  });

  it("none for a stablecoin, a quick token", () => {
    expect(tokenLinks("solana", USDC_SOL)).toEqual([]);
  });

  it("none on a chain with no names", () => {
    expect(tokenLinks("base", PONS)).toEqual([]);
  });
});

describe("escaping", () => {
  it("only &, <, > and the quote, as Telegram's HTML wants", () => {
    expect(escapeTelegramHtml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e ' f",
    );
  });
});
