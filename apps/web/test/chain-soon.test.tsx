/**
 * The grey chains say `soon` at rest, under the chain marks: a tester did
 * not know the grey marks were coming chains. Always under the mark, never only on hover or a
 * long press; a live chain has no label. The rail (front page, boards) and the create switch.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChainRail } from "@/components/chains/ChainRail";
import { ChainSwitch } from "@/components/chains/ChainSwitch";
import { chainPills } from "@/lib/chains";

const pills = chainPills();
const grey = pills.filter((pill) => !pill.selectable);
const live = pills.filter((pill) => pill.selectable);

const soonLabels = (html: string) => html.match(/>soon<\/span>/g) ?? [];

describe("the soon label", () => {
  it("the registry has grey chains and live chains to test with", () => {
    expect(grey.map((pill) => pill.key)).toEqual(["bnb", "base", "ethereum", "ton"]);
    expect(live.length).toBeGreaterThan(0);
  });

  it("the rail shows soon under every grey chain, at rest", () => {
    const html = renderToStaticMarkup(<ChainRail pills={pills} value="all" onChange={() => {}} />);
    expect(soonLabels(html)).toHaveLength(grey.length);
  });

  it("the create switch shows soon under every grey chain, at rest", () => {
    const html = renderToStaticMarkup(
      <ChainSwitch pills={pills} value={live[0]?.key ?? ""} onChange={() => {}} allowAll={false} />,
    );
    expect(soonLabels(html)).toHaveLength(grey.length);
  });

  it("each label sits right after its grey chain's button, never after a live one", () => {
    const html = renderToStaticMarkup(<ChainRail pills={pills} value="all" onChange={() => {}} />);
    // From a pill's button to the next pill's button: that pill's own part of the markup.
    const partOf = (label: string) => {
      const at = html.indexOf(`aria-label="${label}"`);
      expect(at).toBeGreaterThan(-1);
      const next = html.indexOf("aria-label=", at + 1);
      return html.slice(at, next === -1 ? undefined : next);
    };
    for (const pill of grey) expect(partOf(`${pill.name}, soon`)).toContain(">soon</span>");
    for (const pill of live) expect(partOf(pill.name)).not.toContain(">soon</span>");
  });

  it("the grey chains stay grey and not tappable", () => {
    const html = renderToStaticMarkup(<ChainRail pills={pills} value="all" onChange={() => {}} />);
    for (const pill of grey) {
      expect(html).toMatch(new RegExp(`aria-disabled="true"[^>]*aria-label="${pill.name}, soon"`));
    }
    expect(html.match(/chain-soon/g)).toHaveLength(grey.length);
  });
});
