/**
 * The Telegram channel post text: the rows in blocks,
 * one empty line between blocks, Telegram HTML with only `a` and `code`, every
 * stranger's word escaped, the token links per chain.
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
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

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

/** The blocks, one empty line apart. */
const rows = (text: string) => text.split("\n\n");
/** The rows of one block. */
const linesOf = (block: string | undefined) => (block ?? "").split("\n");

describe("the rows", () => {
  it("a SOL drop: from and the amount together, chain alone, the site link", () => {
    expect(buildTelegramPost(solDrop, SITE)).toBe(
      [
        "🤌 NEW DROP",
        'from <a href="https://x.com/samplechad">samplechad</a>\n2 SOL to 5 chads',
        "chain: solana",
        `<a href="https://dropchad.com/d/${DROP_SOL}">dropchad.com</a>`,
      ].join("\n\n"),
    );
  });

  it("a SOL drop with a title: chain and message together, no name, address or links", () => {
    expect(buildTelegramPost({ ...solDrop, receivers: 1, title: "FIRST DROP" }, SITE)).toBe(
      [
        "🤌 NEW DROP",
        'from <a href="https://x.com/samplechad">samplechad</a>\n2 SOL to 1 chad',
        "chain: solana\nmessage: <code>FIRST DROP</code>",
        `<a href="https://dropchad.com/d/${DROP_SOL}">dropchad.com</a>`,
      ].join("\n\n"),
    );
  });

  it("one receiver is 1 chad", () => {
    expect(linesOf(rows(buildTelegramPost({ ...solDrop, receivers: 1 }, SITE))[1])[1]).toBe(
      "2 SOL to 1 chad",
    );
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
    expect(linesOf(rows(text)[1])[1]).toBe("0.0005 ETH to 2 chads");
    expect(rows(text)[2]).toBe("chain: robinhood");
    expect(text).toContain(`href="https://dropchad.com/d/${DROP_EVM}"`);
  });

  it("the sender link has no @, so Telegram opens X, not a Telegram user", () => {
    const from = linesOf(rows(buildTelegramPost(solDrop, SITE))[1])[0] ?? "";
    expect(from).not.toContain("@");
  });

  it("a handle outside the X charset is plain text, no link", () => {
    const block = rows(buildTelegramPost({ ...solDrop, senderHandle: 'bad"><b>x' }, SITE))[1];
    expect(linesOf(block)[0]).toBe("from bad&quot;&gt;&lt;b&gt;x");
  });

  it("the title row, in code, skipped when there is none", () => {
    const text = buildTelegramPost({ ...solDrop, title: "gm chads" }, SITE);
    expect(rows(text)).toContain("chain: solana\nmessage: <code>gm chads</code>");
    expect(buildTelegramPost({ ...solDrop, title: "" }, SITE)).not.toContain("message:");
    expect(buildTelegramPost({ ...solDrop, title: "   " }, SITE)).not.toContain("message:");
  });

  it("the title is escaped and on one line", () => {
    const text = buildTelegramPost(
      { ...solDrop, title: 'a <b>bold</b> & "q"\nnew\u0000line\tx' },
      SITE,
    );
    expect(rows(text)).toContain(
      "chain: solana\nmessage: <code>a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot; new line x</code>",
    );
  });

  it("the testnets say solana devnet and robinhood testnet", () => {
    expect(rows(buildTelegramPost({ ...solDrop, chainKey: "solana-devnet" }, SITE))[2]).toBe(
      "chain: solana devnet",
    );
    expect(
      rows(buildTelegramPost({ ...solDrop, chainKey: "robinhood-testnet", decimals: 18 }, SITE))[2],
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

  it("the token post layout, exactly", () => {
    const wif: TelegramPostFacts = {
      ...solDrop,
      senderHandle: "bigchad",
      amount: "31000000",
      decimals: 6,
      receivers: 1,
      title: "airdrop",
      token: { address: WIF, name: "dogwifhat", symbol: "$WIF" },
    };
    expect(buildTelegramPost(wif, SITE)).toBe(
      [
        "🤌 NEW DROP",
        'from <a href="https://x.com/bigchad">bigchad</a>\n31 $WIF to 1 chad\nname: <code>dogwifhat</code>',
        `<code>${WIF}</code>`,
        "chain: solana\nmessage: <code>airdrop</code>",
        `<a href="https://dexscreener.com/solana/${WIF}">dexscreener</a> | ` +
          `<a href="https://axiom.trade/t/${WIF}">axiom</a> | ` +
          `<a href="https://gmgn.ai/sol/token/${WIF}">gmgn</a>`,
        `<a href="https://dropchad.com/d/${DROP_SOL}">dropchad.com</a>`,
      ].join("\n\n"),
    );
  });

  it("no title: chain alone, the rest as above", () => {
    const text = buildTelegramPost(bonk, SITE);
    expect(rows(text).slice(1, 4)).toEqual([
      'from <a href="https://x.com/samplechad">samplechad</a>\n10000000 BONK to 1 chad\nname: <code>Bonk</code>',
      `<code>${BONK}</code>`,
      "chain: solana",
    ]);
  });

  it("the symbol exactly as the token gives it, nothing added", () => {
    const with$ = buildTelegramPost({ ...bonk, token: { ...bonk.token!, symbol: "$WIF" } }, SITE);
    expect(linesOf(rows(with$)[1])[1]).toBe("10000000 $WIF to 1 chad");
    const plain = buildTelegramPost({ ...bonk, token: { ...bonk.token!, symbol: "POPCAT" } }, SITE);
    expect(linesOf(rows(plain)[1])[1]).toBe("10000000 POPCAT to 1 chad");
  });

  it("the name is escaped and cut at 32 characters", () => {
    const name = `<x>${"n".repeat(40)}`;
    const text = buildTelegramPost({ ...bonk, token: { ...bonk.token!, name } }, SITE);
    expect(linesOf(rows(text)[1])[2]).toBe(`name: <code>&lt;x&gt;${"n".repeat(29)}</code>`);
  });

  it("no name: the ticker; neither: no name row; no ticker: tokens", () => {
    const noName = buildTelegramPost({ ...bonk, token: { ...bonk.token!, name: null } }, SITE);
    expect(linesOf(rows(noName)[1])[2]).toBe("name: <code>BONK</code>");
    const neither = buildTelegramPost(
      { ...bonk, token: { address: BONK, name: null, symbol: null } },
      SITE,
    );
    expect(linesOf(rows(neither)[1])).toEqual([
      'from <a href="https://x.com/samplechad">samplechad</a>',
      "10000000 tokens to 1 chad",
    ]);
    expect(rows(neither)[2]).toBe(`<code>${BONK}</code>`);
  });

  it("a ticker from a stranger is escaped too", () => {
    const text = buildTelegramPost({ ...bonk, token: { ...bonk.token!, symbol: "<i>&" } }, SITE);
    expect(linesOf(rows(text)[1])[1]).toBe("10000000 &lt;i&gt;&amp; to 1 chad");
  });

  it("no link row on a testnet", () => {
    const text = buildTelegramPost({ ...bonk, chainKey: "solana-devnet" }, SITE);
    expect(text).not.toContain("dexscreener");
    expect(rows(text)).toContain(`<code>${BONK}</code>`);
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
