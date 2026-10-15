/**
 * The `drop` / `multisend` switch at the top of `/create` and handle mode step
 * 20. `drop` first, `multisend` always last, the board tabs look. When handle mode is off,
 * `drop` is shown greyed and cannot be picked, with one grey line: `x handle drops are paused`.
 * Rendered with `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModeSwitch } from "@/components/create/ModeSwitch";

const noop = () => undefined;

describe("ModeSwitch", () => {
  it("shows drop first and multisend last", () => {
    const html = renderToStaticMarkup(
      <ModeSwitch mode="drop" dropAvailable={true} onChange={noop} />,
    );
    const drop = html.indexOf(">drop<");
    const multisend = html.indexOf(">multisend<");
    expect(drop).toBeGreaterThan(-1);
    expect(multisend).toBeGreaterThan(drop);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("paused");
  });

  it("greys drop out and says paused when handle mode is off", () => {
    const html = renderToStaticMarkup(
      <ModeSwitch mode="multisend" dropAvailable={false} onChange={noop} />,
    );
    expect(html).toMatch(/aria-disabled="true"[^>]*>drop</);
    expect(html).toContain("x handle drops are paused");
  });

  it("does not say paused while the api has not answered", () => {
    const html = renderToStaticMarkup(
      <ModeSwitch mode="drop" dropAvailable={null} onChange={noop} />,
    );
    expect(html).not.toContain("paused");
  });
});
