/**
 * The one grey line at the foot of `/boards` and
 * only handle drops count, one person is one X account. The old line about
 * people paying themselves is gone. Rendered with `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardsFoot } from "@/components/boards/BoardsFoot";

describe("BoardsFoot", () => {
  const html = renderToStaticMarkup(<BoardsFoot />);

  it("says only x handle drops count, one person is one x account", () => {
    expect(html).toContain("only x handle drops count here. one person is one x account.");
  });

  it("is a grey small line", () => {
    expect(html).toContain("type-small");
    expect(html).toContain("text-chad-text-dim");
  });

  it("keeps none of the old words", () => {
    expect(html).not.toContain("paying themselves");
    expect(html).not.toContain("counts real payouts");
    expect(html).not.toContain("wallet");
  });
});
