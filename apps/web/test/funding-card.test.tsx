/**
 * The funding card as rendered. `FundingCard.tsx`, with
 * `react-dom/server`, no browser. The api's `**` part is bold and `--chad-error`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FundingCard } from "@/components/drops/FundingCard";

const DROP = "0x1111111111111111111111111111111111111111";

function render(warnings: string[], chainId = 46630, grossWei = "120000000000000"): string {
  return renderToStaticMarkup(
    <FundingCard
      address={DROP}
      chainId={chainId}
      amountWei="20000000000000"
      feeWei="100000000000000"
      grossWei={grossWei}
      paymentUri={`ethereum:${DROP}@46630?value=${grossWei}`}
      warnings={warnings}
      kind="multisend"
    />,
  );
}

describe("FundingCard, send this amount: the exact amount, the same as copy amount", () => {
  it("a 9 decimal SOL amount shows in full", () => {
    const html = render([], 103, "12500000001");
    expect(html).toContain(">12.500000001<");
    expect(html).toContain(">SOL<");
  });

  it("an ETH amount shows every decimal it needs, never cut at 8", () => {
    const html = render([], 46630, "123456789012345678");
    expect(html).toContain(">0.123456789012345678<");
  });

  it("no thousands comma", () => {
    const html = render([], 46630, "1234500000000000000000");
    expect(html).toContain(">1234.5<");
    expect(html).not.toContain("1,234.5");
  });

  it("starts at the display size and may step down, never truncates", () => {
    const html = render([]);
    expect(html).toContain("type-display");
    expect(html).not.toContain("truncate");
  });
});

describe("FundingCard warnings", () => {
  it("the marked part is bold and red, and no star shows", () => {
    const html = render([
      "Unclaimed funds are sent there. **Never use an exchange deposit address.** Use a wallet.",
    ]);
    expect(html).not.toContain("**");
    expect(html).toContain(
      '<strong class="font-semibold text-chad-error">Never use an exchange deposit address.</strong>',
    );
    expect(html).toContain("Unclaimed funds are sent there. ");
    expect(html).toContain(" Use a wallet.");
  });

  it("the amount row says people get, never the crowd", () => {
    const html = render([]);
    expect(html).toContain(">people get<");
    expect(html).not.toContain("crowd");
  });

  it("the second button copies the amount in coins, never wei", () => {
    const html = render([]);
    expect(html).toContain("copy amount");
    expect(html).not.toContain("copy wei");
  });

  it("a plain warning has no red in it", () => {
    const html = render(["Check the address character by character before you send."]);
    expect(html).toContain("Check the address character by character before you send.");
    expect(html).not.toContain("text-chad-error");
  });
});
