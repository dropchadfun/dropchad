/**
 * The claim page as rendered, screens A to
 * K. `ClaimView.tsx`, rendered with `react-dom/server`, no browser: no bind is ever called here.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClaimView, nothingYetShown } from "@/components/drops/ClaimView";
import { addressFits, addressText, type ClaimItem } from "@/components/drops/claim";

const EVM_DROP = "0x00000000000000000000000000000000000d0b01";
const OTHER_DROP = "0x00000000000000000000000000000000000d0b02";
const WALLET = "0x1111111111111111111111111111111111110001";
const OCT_12 = "1791806400";

/** The mint claim button of a row. The page title is `claim` too, so `>claim<` alone proves nothing. */
const CLAIM_BUTTON = /class="btn btn-primary[^"]*"[^>]*>claim</;

const item = (patch: Partial<ClaimItem> = {}): ClaimItem => ({
  drop: EVM_DROP,
  chainKey: "robinhood-testnet",
  chainId: 46630,
  title: null,
  sender: {
    handle: "sender",
    displayName: "the sender",
    profileImageUrl: "https://pbs.twimg.com/profile_images/sender.png",
  },
  amount: "500000000000000000",
  symbol: "ETH",
  decimals: 18,
  index: 0,
  claimDeadline: OCT_12,
  state: "claimable",
  recipient: null,
  claimTxHash: null,
  ...patch,
});

function render(props: Partial<Parameters<typeof ClaimView>[0]> = {}): string {
  return renderToStaticMarkup(
    <ClaimView
      session={{ handle: "alice" }}
      claims={[item()]}
      freshLoginSecondsLeft={600}
      selected={null}
      {...props}
    />,
  );
}

describe("A, signed out", () => {
  it("asks for the X login and comes back to /claim", () => {
    const html = render({ session: null, claims: null });
    expect(html).toContain("sign in with X to see the drops made for you.");
    expect(html).toContain('href="/api/auth/x/start?next=%2Fclaim"');
  });

  it("from one drop's link, comes back to that drop", () => {
    const html = render({ session: null, claims: null, selected: EVM_DROP });
    expect(html).toContain(
      `href="/api/auth/x/start?next=${encodeURIComponent(`/claim?drop=${EVM_DROP}`)}"`,
    );
  });
});

describe("B and C, the list", () => {
  it("a row: sender, title or coin, the amount, the claim button", () => {
    const html = render({ claims: [item({ title: "gm chads" }), item({ drop: OTHER_DROP })] });
    expect(html).toContain("@sender");
    expect(html).toContain("gm chads");
    expect(html).toContain("ETH drop");
    expect(html).toContain("0.5");
    expect(html).toMatch(CLAIM_BUTTON);
    expect(html).toContain(`/claim?drop=${EVM_DROP}`);
  });

  it("each state's word; a paid drop stays, greyed", () => {
    const html = render({
      claims: [
        item({ drop: "0x1", state: "sending", recipient: WALLET }),
        item({ drop: "0x2", state: "paid", claimTxHash: "0xfeed" }),
        item({ drop: "0x3", state: "paused" }),
        item({ drop: "0x4", state: "ended" }),
        item({ drop: "0x5", state: "not_funded" }),
      ],
    });
    for (const word of ["on its way", ">paid<", ">paused<", ">ended<", "not funded yet"]) {
      expect(html).toContain(word);
    }
    expect(html).toMatch(/data-state="paid"[^>]*class="[^"]*text-chad-text-mute/);
  });

  it("C, nothing to claim: says so with my handle, and a quiet link to what is live", () => {
    const html = render({ claims: [] });
    expect(html).toContain("nothing to claim yet. when someone drops on @alice, it shows up here.");
    expect(html).toContain("see what is live");
  });
});

describe("one drop, D to K", () => {
  const one = (patch: Partial<ClaimItem>, extra: Partial<Parameters<typeof ClaimView>[0]> = {}) =>
    render({ claims: [item(patch)], selected: EVM_DROP, ...extra });

  it("D, a login too old: sign in again, before any paste box", () => {
    const html = one({}, { freshLoginSecondsLeft: 10 });
    expect(html).toContain(
      "you signed in more than 10 minutes ago. for safety, sign in with X once more before you " +
        "pick a wallet. it takes a few seconds.",
    );
    expect(html).toContain(">sign in again<");
    expect(html).toContain(
      `href="/api/auth/x/start?next=${encodeURIComponent(`/claim?drop=${EVM_DROP}`)}"`,
    );
    expect(html).not.toContain("where should it land?");
  });

  it("E, paste: the amount, the box, the hint, next; no wallet connect", () => {
    const html = one({});
    expect(html).toContain("where should it land?");
    expect(html).toContain(">Robinhood address, starts with 0x<");
    expect(html).not.toContain("a Robinhood address");
    expect(html).toContain(">next<");
    expect(html.toLowerCase()).not.toContain("connect");
  });

  it("F, the big confirm: the address in one piece, the warning, yes and change", () => {
    const html = one({}, { initialStep: "confirm", initialAddress: WALLET });
    // Claim: `goes to this wallet`, never `send`.
    expect(html).toContain("0.5 ETH goes to this wallet");
    expect(html).not.toContain("send 0.5");
    // One normal piece, no groups of 4. Body size in mono, white over the grey lines around it,
    // free to wrap on a phone. The big size was too big.
    const address = new RegExp(`class="([^"]*)">${WALLET}<`).exec(html);
    expect(address).not.toBeNull();
    const classes = (address?.[1] ?? "").split(" ");
    expect(classes).toEqual(
      expect.arrayContaining(["type-body", "font-mono", "text-chad-text", "break-all"]),
    );
    expect(classes.some((c) => /^(md:)?text-(xl|[2-9]xl)$/.test(c))).toBe(false);
    expect(html).not.toContain(">1111<");
    expect(html).toContain("check every character. after this it cannot be changed.");
    // The confirm button says only `claim`.
    expect(html).toMatch(CLAIM_BUTTON);
    expect(html).not.toContain("yes, claim");
    expect(html).toContain(">change address<");
  });

  it("G, on its way, then paid with the transaction", () => {
    expect(one({ state: "sending", recipient: WALLET })).toContain("on its way to 0x1111…0001");
    const paid = one({ state: "paid", recipient: WALLET, claimTxHash: `0x${"fe".repeat(32)}` });
    // Claim: bigger, easy to read and to tap on a phone.
    expect(paid).toMatch(/class="[^"]*type-stat[^"]*">paid</);
    // The big paid word in the site's mint, desktop and phone.
    expect(paid).toMatch(/<span class="type-stat text-chad-accent">paid<\/span>/);
    expect(paid).toMatch(/data-address-box="true" class="[^"]*type-body[^"]*font-mono/);
    expect(paid).toMatch(/class="md:hidden">to 0x1111…0001</);
    expect(paid).toMatch(/<a [^>]*class="[^"]*\bh-11\b[^"]*"[^>]*>tx ↗<\/a>/);
  });

  it("H, failed: safe and still yours, another address, never the raw error", () => {
    const html = one({ state: "failed" });
    expect(html).toContain("the claim did not go through. your share is safe and still yours.");
    expect(html).toContain(">use another address<");
    expect(html).not.toContain("execution reverted");
  });

  it("I, paused: the plain line, no address box", () => {
    const html = one({ state: "paused" });
    expect(html).toContain(
      "claims are paused. your share waits here until 12\u00a0oct. after that, unclaimed money goes back to the sender.",
    );
    expect(html).not.toContain("where should it land?");
    expect(html).not.toContain("<input");
  });

  it("J, ended: the day, no button", () => {
    const html = one({ state: "ended" });
    expect(html).toContain(
      "this drop ended on 12\u00a0oct. unclaimed money went back to the sender.",
    );
    expect(html).not.toMatch(CLAIM_BUTTON);
    expect(html).not.toContain("<input");
  });

  it("K, not funded yet", () => {
    const html = one({ state: "not_funded" });
    expect(html).toContain(
      "the sender has not funded this drop yet. the claim button shows up once they do.",
    );
    expect(html).not.toContain("<input");
  });

  it("a drop that is not mine, or unknown, falls back to the list with nothing opened", () => {
    const html = render({ claims: [item()], selected: OTHER_DROP });
    expect(html).not.toContain("where should it land?");
    expect(html).toMatch(CLAIM_BUTTON);
  });
});

describe("G, the full address on desktop claim page", () => {
  const SOL_DROP = "So1anaDrop111111111111111111111111111111111";
  const SOL_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const TX = `0x${"fe".repeat(32)}`;
  const one = (patch: Partial<ClaimItem>) => render({ claims: [item(patch)], selected: EVM_DROP });
  const solana = (patch: Partial<ClaimItem>) =>
    render({
      claims: [item({ drop: SOL_DROP, chainKey: "solana-devnet", chainId: 103, ...patch })],
      selected: SOL_DROP,
    });
  /** The address box: its classes and its three parts, phone, desktop and the measure. */
  const box = (html: string) => {
    const m =
      /<span data-address-box="true" class="([^"]*)"><span class="md:hidden">([^<]*)<\/span><span data-address-desktop="true" class="([^"]*)">([^<]*)<\/span><span data-address-measure="true" aria-hidden="true" class="([^"]*)">([^<]*)<\/span><\/span>/.exec(
        html,
      );
    expect(m, "the address box").not.toBeNull();
    return {
      cls: (m?.[1] ?? "").split(" "),
      phone: m?.[2],
      deskCls: (m?.[3] ?? "").split(" "),
      desk: m?.[4],
      measureCls: (m?.[5] ?? "").split(" "),
      measure: m?.[6],
    };
  };

  it("on its way to: the short address on the phone, the full one measured for desktop", () => {
    const b = box(one({ state: "sending", recipient: WALLET }));
    expect(b.phone).toBe("on its way to 0x1111…0001");
    expect(b.measure).toBe(`on its way to ${WALLET}`);
    expect(b.deskCls).toEqual(["hidden", "md:inline"]);
    // Before the browser measures, the desktop part is the short one: never a cut address.
    expect(b.desk).toBe("on its way to 0x1111…0001");
  });

  it("paid to: the same, both chains", () => {
    const evm = box(one({ state: "paid", recipient: WALLET, claimTxHash: TX }));
    expect([evm.phone, evm.measure]).toEqual(["to 0x1111…0001", `to ${WALLET}`]);
    const sol = box(solana({ state: "paid", recipient: SOL_WALLET, claimTxHash: TX }));
    expect([sol.phone, sol.measure]).toEqual(["to 7xKXtg…gAsU", `to ${SOL_WALLET}`]);
    const sending = box(solana({ state: "sending", recipient: SOL_WALLET }));
    expect(sending.measure).toBe(`on its way to ${SOL_WALLET}`);
  });

  it("one line, never a wrap or a wider card: a cut box, the measure out of the flow", () => {
    const b = box(one({ state: "paid", recipient: WALLET, claimTxHash: TX }));
    expect(b.cls).toEqual(
      expect.arrayContaining(["relative", "min-w-0", "overflow-hidden", "whitespace-nowrap"]),
    );
    expect(b.cls).not.toContain("break-all");
    expect(b.measureCls).toEqual(
      expect.arrayContaining(["invisible", "absolute", "w-max", "pointer-events-none"]),
    );
  });

  it("paid on its own line, then the address and tx in one row, 16 apart, tx never shrinks", () => {
    const html = one({ state: "paid", recipient: WALLET, claimTxHash: TX });
    expect(html).toMatch(
      /<div class="flex flex-col gap-3"><span class="type-stat text-chad-accent">paid<\/span><div data-paid-row="true" class="flex flex-col gap-3 md:flex-row md:items-center md:gap-4"><span data-address-box/,
    );
    expect(html).toMatch(/<a [^>]*class="[^"]*\bmd:shrink-0\b[^"]*"[^>]*>tx ↗<\/a>/);
    expect(box(html).cls).toContain("md:flex-1");
  });

  it("the same fonts and colours: body mono on paid, body on the way", () => {
    const paid = box(one({ state: "paid", recipient: WALLET, claimTxHash: TX }));
    expect(paid.cls).toEqual(expect.arrayContaining(["type-body", "font-mono"]));
    const html = one({ state: "sending", recipient: WALLET });
    expect(html).toMatch(/<p class="type-body flex items-center gap-2"><span class="live-dot/);
    expect(box(html).cls).not.toContain("font-mono");
  });

  it("the full address only when it fits its box, else the short one", () => {
    expect(addressFits(380, 400)).toBe(true);
    expect(addressFits(400, 400)).toBe(true);
    expect(addressFits(401, 400)).toBe(false);
    // A box not laid out yet, or hidden on the phone, is never a fit.
    expect(addressFits(380, 0)).toBe(false);
    expect(addressText("to ", WALLET, true)).toBe(`to ${WALLET}`);
    expect(addressText("to ", WALLET, false)).toBe("to 0x1111…0001");
  });
});

describe("the preview", () => {
  it("says it is a preview, so a screenshot is never mistaken for a real claim", () => {
    const html = render({ preview: true });
    expect(html).toContain("preview, sample data");
  });
});

describe("some drops could not load", () => {
  const NOTE = "some drops could not load right now. try again in a minute.";

  it("shows the drops it got plus one short grey note, never the full error", () => {
    const html = render({ partial: true });
    expect(html).toMatch(CLAIM_BUTTON);
    expect(html).toContain(NOTE);
    expect(html).toMatch(
      /class="type-small[^"]*text-chad-text-dim[^"]*">some drops could not load/,
    );
    expect(html).not.toContain("the list could not be read");
  });

  it("nothing to claim yet only with no drops and no extra items on the page", () => {
    expect(nothingYetShown({ drops: 0, extras: 0, partial: false })).toBe(true);
    expect(nothingYetShown({ drops: 0, extras: 1, partial: false })).toBe(false);
    expect(nothingYetShown({ drops: 2, extras: 0, partial: false })).toBe(false);
    expect(nothingYetShown({ drops: 0, extras: 0, partial: true })).toBe(false);
  });

  it("with none loaded, only the note: never nothing to claim yet", () => {
    const html = render({ partial: true, claims: [] });
    expect(html).toContain(NOTE);
    expect(html).not.toContain("nothing to claim yet");
  });

  it("every drop loaded: no note", () => {
    expect(render()).not.toContain(NOTE);
    expect(render({ claims: [] })).not.toContain(NOTE);
  });
});
