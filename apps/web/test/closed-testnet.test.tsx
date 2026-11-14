/**
 * The closed testnet text: on a testnet only site with
 * every listed chain off by the api switch, the banner and the create page say the testnet is
 * closed, in three short lines, calm, never as an error. A program pause, one chain off, a failed
 * read or a site with a mainnet chain live keep the pause texts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { errorTone, explain } from "@/components/create/errors";
import { initialForm, reduceForm, viewOf, type FormAction } from "@/components/create/form";
import { ModeSwitch } from "@/components/create/ModeSwitch";
import { PauseBanner } from "@/components/site/PauseBanner";
import { ApiError } from "@/lib/api";
import { chainPills } from "@/lib/chains";
import { CLOSED_TESTNET_TEXT, isClosedTestnet, pauseBannerText, readPauseText } from "@/lib/pause";

const CLOSED = "testnet is closed\nmainnet is next, Solana first\nopen drops can still be claimed";
const ALL = "We are fixing something. Short break. New drops are off. Claims still work.";
const ONE_SOLANA =
  "We are fixing something on Solana. Short break. New Solana drops are off. Claims still work.";

type OffBy = "api" | "program" | null;
const row = (key: string, createsOn: boolean | null, offBy: OffBy) => ({ key, createsOn, offBy });
const bothByApi = [row("solana-devnet", false, "api"), row("robinhood-testnet", false, "api")];

describe("isClosedTestnet", () => {
  it("a testnet only site with every chain off by the api switch", () => {
    expect(isClosedTestnet(bothByApi, true)).toBe(true);
  });

  it("never on a site with a mainnet chain live", () => {
    expect(isClosedTestnet(bothByApi, false)).toBe(false);
  });

  it("not for a program pause on any chain", () => {
    expect(
      isClosedTestnet(
        [row("solana-devnet", false, "program"), row("robinhood-testnet", false, "api")],
        true,
      ),
    ).toBe(false);
  });

  it("not when one chain is still on, or its read failed", () => {
    expect(
      isClosedTestnet(
        [row("solana-devnet", false, "api"), row("robinhood-testnet", true, null)],
        true,
      ),
    ).toBe(false);
    expect(
      isClosedTestnet(
        [row("solana-devnet", false, "api"), row("robinhood-testnet", null, null)],
        true,
      ),
    ).toBe(false);
  });

  it("not for an empty list", () => {
    expect(isClosedTestnet([], true)).toBe(false);
  });
});

describe("the banner text", () => {
  it("is the three lines exactly, lowercase except Solana, no full stops", () => {
    expect(CLOSED_TESTNET_TEXT).toBe(CLOSED);
    expect(pauseBannerText(bothByApi, true)).toBe(CLOSED);
  });

  it("keeps the texts for a mainnet site, a program pause and one chain off", () => {
    expect(pauseBannerText(bothByApi, false)).toBe(ALL);
    expect(
      pauseBannerText(
        [row("solana-devnet", false, "program"), row("robinhood-testnet", false, "program")],
        true,
      ),
    ).toBe(ALL);
    expect(
      pauseBannerText(
        [row("solana-devnet", false, "api"), row("robinhood-testnet", true, null)],
        true,
      ),
    ).toBe(ONE_SOLANA);
  });

  it("the root layout read passes offBy through", async () => {
    const fetchFn = () =>
      Promise.resolve(new Response(JSON.stringify({ chains: bothByApi }), { status: 200 }));
    expect(await readPauseText({ fetch: fetchFn, testnetOnly: true })).toBe(CLOSED);
    expect(await readPauseText({ fetch: fetchFn, testnetOnly: false })).toBe(ALL);
  });

  it("the banner draws the three lines, calm", () => {
    const html = renderToStaticMarkup(<PauseBanner text={CLOSED} />);
    expect(html).toContain("testnet is closed");
    expect(html).toContain("mainnet is next, Solana first");
    expect(html).toContain("open drops can still be claimed");
    expect(html).toContain("whitespace-pre-line");
    expect(html).not.toMatch(/accent|error|mint/);
  });
});

describe("the create page", () => {
  const pills = chainPills();
  const keys = pills.flatMap((pill) => (pill.chainKey ? [pill.chainKey] : []));
  const allOff = Object.fromEntries(keys.map((key) => [key, true]));
  const allHandle = Object.fromEntries(keys.map((key) => [key, true]));
  const view = (testnetClosed: boolean) => {
    const action: FormAction = {
      type: "handleModes",
      value: allHandle,
      createsOff: allOff,
      testnetClosed,
    };
    return viewOf(reduceForm(initialForm(pills), action), pills);
  };

  it("the grey line under the tabs is the closed testnet text", () => {
    expect(view(true).pauseLine).toBe(CLOSED);
    expect(view(true).createsOff).toBe(true);
  });

  it("without the closed testnet it stays the one chain text", () => {
    expect(view(false).pauseLine).toBe(ONE_SOLANA);
  });

  it("the tab line keeps the three lines, in grey", () => {
    const html = renderToStaticMarkup(
      <ModeSwitch mode="drop" dropAvailable pauseLine={CLOSED} onChange={() => {}} />,
    );
    expect(html).toContain("whitespace-pre-line");
    expect(html).toContain("text-chad-text-dim");
    expect(html).not.toContain("text-chad-error");
  });

  it("creates_off says the closed testnet text, calm, not as an error", () => {
    const err = new ApiError(503, "creates_off", { error: "creates_off", chain: "solana-devnet" });
    expect(explain(err, { decimals: 9, closedTestnet: true })).toBe(CLOSED);
    expect(explain(err, { decimals: 9 })).toBe(ONE_SOLANA);
    expect(errorTone(CLOSED)).toBe("calm");
    expect(errorTone(ONE_SOLANA)).toBe("error");
  });

  it("the page reads the closed testnet from GET /api/chains and colours the line by tone", () => {
    const page = readFileSync(
      join(import.meta.dirname, "..", "src", "components", "create", "CreateDrop.tsx"),
      "utf8",
    );
    expect(page).toContain("isClosedTestnet(");
    expect(page).toContain("testnetClosed");
    expect(page).toContain("errorTone(");
  });
});
