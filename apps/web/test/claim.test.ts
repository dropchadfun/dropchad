/**
 * The logic of the claim page `/claim`.
 * `components/drops/claim.ts`, no React here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLAIM_PREVIEW_SCREENS,
  claimPreviewScreen,
  sampleClaims,
} from "@/components/drops/claim-preview";
import {
  FRESH_LOGIN_MARGIN_SECONDS,
  claimLinkFor,
  claimLoginHref,
  confirmTitle,
  detailScreen,
  endedLine,
  frontLine,
  pasteError,
  pasteHint,
  pausedLine,
  rowAction,
  sendingLine,
  shortDay,
  type ClaimItem,
} from "@/components/drops/claim";
import { NAV } from "@/components/site/Header";
import type { DropDetail } from "@/lib/api";

const EVM_DROP = "0x00000000000000000000000000000000000d0b01";
const SOL_DROP = "9ArT5gUTfmD81oKeNL66RhcWrK9nuaoxuJV2wH7QT9Ra";
const EVM_WALLET = "0x1111111111111111111111111111111111110001";
const SOL_WALLET = "HPDRfuSB9afEJv69hWe78rskDTMWmqmyg17TjNNE8YDH";

// 12 oct 2026, 12:00 UTC.
const OCT_12 = "1791806400";

const item = (patch: Partial<ClaimItem> = {}): ClaimItem => ({
  drop: EVM_DROP,
  chainKey: "robinhood-testnet",
  chainId: 46630,
  title: null,
  sender: { handle: "sender", displayName: "the sender", profileImageUrl: null },
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

describe("the list: what each row offers", () => {
  it("claimable and failed get the mint claim button, the rest a grey word", () => {
    expect(rowAction(item({ state: "claimable" }))).toEqual({ kind: "button", label: "claim" });
    expect(rowAction(item({ state: "failed" }))).toEqual({ kind: "button", label: "claim" });
    expect(rowAction(item({ state: "sending" }))).toEqual({ kind: "word", label: "on its way" });
    expect(rowAction(item({ state: "paid" }))).toEqual({
      kind: "word",
      label: "paid",
      greyed: true,
    });
    expect(rowAction(item({ state: "paused" }))).toEqual({ kind: "word", label: "paused" });
    expect(rowAction(item({ state: "ended" }))).toEqual({ kind: "word", label: "ended" });
    expect(rowAction(item({ state: "not_funded" }))).toEqual({
      kind: "word",
      label: "not funded yet",
    });
  });
});

describe("one drop: which screen", () => {
  const fresh = 600;

  it("facts first: paid, ended, not funded, paused, sending, whatever the step", () => {
    for (const step of ["start", "paste", "confirm"] as const) {
      expect(detailScreen(item({ state: "paid" }), fresh, step)).toBe("paid");
      expect(detailScreen(item({ state: "ended" }), fresh, step)).toBe("ended");
      expect(detailScreen(item({ state: "not_funded" }), fresh, step)).toBe("not-funded");
      expect(detailScreen(item({ state: "paused" }), fresh, step)).toBe("paused");
      expect(detailScreen(item({ state: "sending" }), fresh, step)).toBe("sending");
    }
  });

  it("claimable: paste, then the big confirm", () => {
    expect(detailScreen(item(), fresh, "start")).toBe("paste");
    expect(detailScreen(item(), fresh, "paste")).toBe("paste");
    expect(detailScreen(item(), fresh, "confirm")).toBe("confirm");
  });

  it("failed: the failed screen first, then `use another address` opens the paste box", () => {
    expect(detailScreen(item({ state: "failed" }), fresh, "start")).toBe("failed");
    expect(detailScreen(item({ state: "failed" }), fresh, "paste")).toBe("paste");
    expect(detailScreen(item({ state: "failed" }), fresh, "confirm")).toBe("confirm");
  });

  it("a login too old for a bind asks to sign in again before the paste box, never after", () => {
    const left = FRESH_LOGIN_MARGIN_SECONDS - 1;
    expect(FRESH_LOGIN_MARGIN_SECONDS).toBe(60);
    expect(detailScreen(item(), left, "start")).toBe("fresh-login");
    expect(detailScreen(item(), left, "paste")).toBe("fresh-login");
    expect(detailScreen(item(), left, "confirm")).toBe("fresh-login");
    expect(detailScreen(item({ state: "failed" }), left, "paste")).toBe("fresh-login");
    // The failed screen itself needs no login, only its next step does.
    expect(detailScreen(item({ state: "failed" }), left, "start")).toBe("failed");
    expect(detailScreen(item(), FRESH_LOGIN_MARGIN_SECONDS, "start")).toBe("paste");
    // A fact never waits on a login.
    expect(detailScreen(item({ state: "paid" }), 0, "start")).toBe("paid");
  });
});

describe("the paste box", () => {
  it("names the address each chain takes, never `a ...`", () => {
    // Claim.
    expect(pasteHint("evm")).toBe("Robinhood address, starts with 0x");
    expect(pasteHint("svm")).toBe("Solana address");
  });

  it("checks the shape as they type; the api checks the rest", () => {
    expect(pasteError("evm", EVM_WALLET)).toBeNull();
    expect(pasteError("svm", SOL_WALLET)).toBeNull();
    expect(pasteError("evm", "")).toBeNull();
    expect(pasteError("evm", "0x1234")).toBe("that is not a Robinhood address.");
    expect(pasteError("evm", SOL_WALLET)).toBe("that is not a Robinhood address.");
    expect(pasteError("svm", EVM_WALLET)).toBe("that is not a Solana address.");
    // Spaces from a copy are forgiven, never silently changed into something else.
    expect(pasteError("evm", `  ${EVM_WALLET}  `)).toBeNull();
  });
});

describe("the big confirm", () => {
  // Claim: what lands where, never `send`.
  it("the title: `0.5 ETH goes to this wallet`", () => {
    expect(confirmTitle(item())).toBe("0.5 ETH goes to this wallet");
    expect(confirmTitle(item({ amount: "10000000", decimals: 9, symbol: "SOL" }))).toBe(
      "0.01 SOL goes to this wallet",
    );
    expect(confirmTitle(item({ amount: "10000000000000" }))).toBe(
      "0.00001 ETH goes to this wallet",
    );
  });

  it("the real amount, every decimal, never cut", () => {
    expect(confirmTitle(item({ amount: "12500000001", decimals: 9, symbol: "SOL" }))).toBe(
      "12.500000001 SOL goes to this wallet",
    );
    expect(confirmTitle(item({ amount: "123456789000000000" }))).toBe(
      "0.123456789 ETH goes to this wallet",
    );
    expect(confirmTitle(item())).not.toMatch(/^send/);
  });
});

describe("the lines", () => {
  // A no-break space between the day and the month: `12` and `oct` never split over two lines.
  it("a short UTC day, `12 oct`, the day and the month held together", () => {
    expect(shortDay(OCT_12)).toBe("12\u00a0oct");
  });

  it("paused: the share waits until the deadline, never a promise past it", () => {
    expect(pausedLine(item({ state: "paused" }))).toBe(
      "claims are paused. your share waits here until 12\u00a0oct. after that, unclaimed money goes back to the sender.",
    );
  });

  it("ended: with the day, and without one for a drop that never ran", () => {
    expect(endedLine(item({ state: "ended" }))).toBe(
      "this drop ended on 12\u00a0oct. unclaimed money went back to the sender.",
    );
    expect(endedLine(item({ state: "ended", claimDeadline: null }))).toBe("this drop ended.");
  });

  it("sending: the chosen address, short", () => {
    expect(sendingLine(item({ state: "sending", recipient: EVM_WALLET }))).toBe(
      "on its way to 0x1111…0001",
    );
  });

  it("the front page line counts what can be claimed now, else nothing", () => {
    expect(frontLine([item(), item({ state: "failed" }), item({ state: "paid" })])).toBe(
      "you got dropped. 2 to claim →",
    );
    expect(frontLine([item()])).toBe("you got dropped. 1 to claim →");
    expect(frontLine([item({ state: "paid" }), item({ state: "paused" })])).toBeNull();
    expect(frontLine([])).toBeNull();
  });
});

describe("the ways in", () => {
  it("the login comes back to /claim, or to the one drop", () => {
    expect(claimLoginHref()).toBe("/api/auth/x/start?next=%2Fclaim");
    expect(claimLoginHref(EVM_DROP)).toBe(
      `/api/auth/x/start?next=${encodeURIComponent(`/claim?drop=${EVM_DROP}`)}`,
    );
  });

  it("a handle drop's page links to its claim, a multisend or an unknown drop never", () => {
    const detail = (mode: "handle" | "address" | null, address = EVM_DROP) =>
      ({
        address,
        ours: { known: mode !== null, data: mode === null ? null : { mode } },
      }) as unknown as DropDetail;
    expect(claimLinkFor(detail("handle"))).toBe(`/claim?drop=${EVM_DROP}`);
    expect(claimLinkFor(detail("handle", SOL_DROP))).toBe(`/claim?drop=${SOL_DROP}`);
    expect(claimLinkFor(detail("address"))).toBeNull();
    expect(claimLinkFor(detail(null))).toBeNull();
  });

  it("the desktop menu has claim after drop; the phone bar is a separate list of three", () => {
    expect(NAV.map((n) => n.label)).toEqual(["home", "boards", "drop", "claim", "how it works"]);
    expect(NAV.find((n) => n.label === "claim")?.href).toBe("/claim");
  });
});

describe("the dev only preview, `/claim?preview=<screen>`", () => {
  const dev = { nodeEnv: "development", hostname: "localhost" };

  it("knows the twelve screens", () => {
    expect(CLAIM_PREVIEW_SCREENS).toEqual([
      "signed-out",
      "list",
      "nothing",
      "fresh-login",
      "paste",
      "confirm",
      "sending",
      "paid",
      "failed",
      "paused",
      "ended",
      "not-funded",
    ]);
  });

  it("works only in development, only on the laptop, only with a known screen", () => {
    expect(claimPreviewScreen("?preview=list", dev)).toBe("list");
    expect(claimPreviewScreen("?preview=confirm", { ...dev, hostname: "127.0.0.1" })).toBe(
      "confirm",
    );
    expect(claimPreviewScreen("?preview=list", { ...dev, nodeEnv: "production" })).toBeNull();
    expect(claimPreviewScreen("?preview=list", { ...dev, nodeEnv: undefined })).toBeNull();
    expect(claimPreviewScreen("?preview=list", { ...dev, hostname: "dropchad.com" })).toBeNull();
    expect(claimPreviewScreen("?preview=list", { ...dev, hostname: "192.168.1.20" })).toBeNull();
    expect(claimPreviewScreen("?preview=nope", dev)).toBeNull();
    expect(claimPreviewScreen("", dev)).toBeNull();
  });

  it("sample data only: a sample of each state, clearly not real", () => {
    const list = sampleClaims();
    expect(new Set(list.map((c) => c.state))).toEqual(
      new Set(["claimable", "sending", "paid", "failed", "paused", "ended", "not_funded"]),
    );
    for (const c of list) expect(c.sender?.handle.startsWith("sample")).toBe(true);
  });
});

describe("isPartial", () => {
  it("is true only when the api names a chain it could not read", async () => {
    const { isPartial } = await import("@/components/drops/claim");
    expect(
      isPartial({ claims: [], unavailable: ["solana-devnet"], freshLoginSecondsLeft: 0 }),
    ).toBe(true);
    expect(isPartial({ claims: [], unavailable: [], freshLoginSecondsLeft: 0 })).toBe(false);
    // An api from before the design sends no `unavailable`: complete, as it always was.
    expect(isPartial({ claims: [], freshLoginSecondsLeft: 0 })).toBe(false);
  });

  it("the live claim page passes it to the list", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "components", "drops", "ClaimPage.tsx"),
      "utf8",
    );
    expect(src).toContain("isPartial(answer)");
    expect(src).toMatch(/partial=\{partial\}/);
  });
});
