/**
 * The api's warnings under the funding card: a long address inside the text,
 * the refund address of the third line, breaks inside the card and never runs past its edge.
 * Seen at 360 on `/create` step 3. `break-words` on the list: a word longer than the line breaks,
 * every other word wraps as before.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FundingCard } from "@/components/drops/FundingCard";

const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const REFUND = "CP7FPuCDsR45A27jP21cYegWEW6EneCHC5zWF4kNBEyd";

describe("the funding card warnings, long addresses", () => {
  it("the warning list breaks a word longer than the line", () => {
    const html = renderToStaticMarkup(
      <FundingCard
        address={DROP}
        chainId={103}
        amountWei="210000000"
        feeWei="2500000"
        grossWei="212500000"
        paymentUri={`solana:${DROP}?amount=0.2125`}
        warnings={[`Your refund address is ${REFUND}. Unclaimed funds are sent there.`]}
      />,
    );
    expect(html).toContain('<ul class="type-small mt-4 space-y-1 break-words text-chad-text-dim">');
    expect(html).toContain(REFUND);
  });
});
