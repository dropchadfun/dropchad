/**
 * The retry claim: a v2 claim that did
 * not land, while only the same wallet can be claimed again. One plain line and a mint
 * `claim again`, no paste box, no other address.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClaimView } from "@/components/drops/ClaimView";
import {
  claimAgainRecipient,
  detailScreen,
  openClaimCount,
  rowAction,
  type ClaimItem,
} from "@/components/drops/claim";

const EVM_DROP = "0x00000000000000000000000000000000000d0b01";
const WALLET = "0xBF46c6446A03419ACcD198d12F333a922a24301a";

const retry: ClaimItem = {
  drop: EVM_DROP,
  chainKey: "robinhood-testnet",
  chainId: 46630,
  title: "enjoy",
  sender: { handle: "sender", displayName: "the sender", profileImageUrl: null },
  amount: "10000000000000000000000",
  symbol: "TEST",
  decimals: 18,
  index: 0,
  claimDeadline: "1793825475",
  state: "retry",
  recipient: WALLET,
  claimTxHash: null,
};

describe("the retry row", () => {
  it("has the mint claim button, never on its way", () => {
    expect(rowAction(retry)).toEqual({ kind: "button", label: "claim" });
  });

  it("counts as one to claim", () => {
    expect(openClaimCount([retry])).toBe(1);
  });
});

describe("the retry screen", () => {
  it("is retry with a fresh login, and asks for a new login first without one", () => {
    expect(detailScreen(retry, 600, "start")).toBe("retry");
    expect(detailScreen(retry, 0, "start")).toBe("fresh-login");
  });

  it("claims again to the same wallet", () => {
    expect(claimAgainRecipient(retry)).toBe(WALLET);
  });

  const html = renderToStaticMarkup(
    <ClaimView
      session={{ handle: "alice" }}
      claims={[retry]}
      freshLoginSecondsLeft={600}
      selected={EVM_DROP}
    />,
  );

  it("says it did not go through, in one plain line", () => {
    expect(html).toMatch(
      /type-body[^"]*text-chad-text-dim[^>]*>the claim did not go through\. your share is safe and still yours\.</,
    );
  });

  it("offers a mint claim again", () => {
    expect(html).toMatch(/btn btn-primary[^>]*>claim again</);
  });

  it("offers no paste box, no other address and no on its way", () => {
    expect(html).not.toContain("where should it land?");
    expect(html).not.toContain("use another address");
    expect(html).not.toContain("on its way");
  });
});
