/**
 * Create and fund, item 3: one
 * wording for the amount. The funding card says `send this amount`, never `send exactly`; the
 * api's lines never say `at least` (`apps/api/test/funding-warnings.test.ts`).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FundingCard } from "@/components/drops/FundingCard";

const DROP = "0x1111111111111111111111111111111111111111";

function render(kind: "drop" | "multisend"): string {
  return renderToStaticMarkup(
    <FundingCard
      address={DROP}
      chainId={46630}
      amountWei="20000000000000"
      feeWei="100000000000000"
      grossWei="120000000000000"
      paymentUri={`ethereum:${DROP}@46630?value=120000000000000`}
      warnings={[]}
      kind={kind}
    />,
  );
}

describe("item 3: the funding card label", () => {
  for (const kind of ["drop", "multisend"] as const) {
    it(`a ${kind}: send this amount`, () => {
      expect(render(kind)).toContain(">send this amount<");
    });

    it(`a ${kind}: never send exactly or at least`, () => {
      const html = render(kind);
      expect(html).not.toContain("send exactly");
      expect(html).not.toContain("at least");
    });
  }
});
