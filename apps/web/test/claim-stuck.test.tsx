/**
 * The stuck claim: the wallet the receiver gave
 * cannot be paid and can no longer change. One plain line, no paste box, no other address.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClaimView } from "@/components/drops/ClaimView";
import type { ClaimItem } from "@/components/drops/claim";

const EVM_DROP = "0x00000000000000000000000000000000000d0b01";

const stuck: ClaimItem = {
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
  state: "stuck",
  recipient: "0x1111111111111111111111111111111111110001",
  claimTxHash: null,
};

describe("the stuck screen", () => {
  const html = renderToStaticMarkup(
    <ClaimView
      session={{ handle: "alice" }}
      claims={[stuck]}
      freshLoginSecondsLeft={600}
      selected={EVM_DROP}
    />,
  );

  it("says it in one plain line", () => {
    expect(html).toMatch(
      /type-body[^"]*text-chad-text-dim[^>]*>the wallet you gave cannot be paid\.</,
    );
  });

  it("offers no paste box and no other address", () => {
    expect(html).not.toContain("where should it land?");
    expect(html).not.toContain("use another address");
  });
});
