/**
 * The drop page headline: a drop without a title looks like a
 * drop with one. The headline is the title, else the rows' line one, `SOL drop`; under it the
 * sender's picture, `@handle` and the X logo; under that the chain and the age. Live and
 * finished alike. On the phone the headline is never cut; desktop one line.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterView } from "@/components/drops/AfterView";
import { LiveView } from "@/components/drops/LiveView";
import type { DropDetail, Profile, TokenInfo } from "@/lib/api";
import { shortAddress } from "@/lib/format";

const DROP = "ATGm4qgrPcAaJQ2yhPSSHjsqLoqgbrqHhDMoVgkkUE48";
const MINT = "77XowHgtgtocxziFhKEFfuQc9rtf2LFx5DGZ9stRpump";

const creator = {
  xUserId: "1",
  handle: "averylonghandle",
  displayName: "long",
  profileImageUrl: null,
  kind: "kol",
  tags: [],
  tagLockedUntil: null,
  badges: [],
} as unknown as Profile;

const token = (symbol: string | null): TokenInfo => ({
  mint: MINT,
  symbol,
  name: "Test Coin",
  decimals: 5,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  logoUrl: `/api/tokens/${MINT}/logo?chain=solana`,
  launchpad: null,
});

interface Kind {
  title: string | null;
  token?: TokenInfo | null;
  sender?: Profile | null;
}

const live = ({ title, token: t = null, sender = creator }: Kind) =>
  renderToStaticMarkup(
    <LiveView
      address={DROP}
      chainId={103}
      token={t}
      title={title}
      creator={sender}
      amountWei="2100000000"
      createdAt={1790838985}
      leafCount={2}
      paidCount={0}
      paid={[]}
      waiting={false}
    />,
  );

const after = ({ title, token: t = null, sender = creator }: Kind) =>
  renderToStaticMarkup(
    <AfterView
      detail={
        {
          address: DROP,
          chain: { source: "rpc", available: true, indexed: false, data: null },
          ours: {
            source: "dropchad_api",
            known: true,
            data: { token: t, memeImageUrl: null, lastTxHash: null, activateTxHash: null },
          },
        } as unknown as DropDetail
      }
      paid={[]}
      paidCount={0}
      leafCount={2}
      chainId={103}
      amountWei="2100000000"
      createdAt={1790838985}
      title={title}
      creator={sender}
      chip="DONE"
    />,
  );

const h1 = (html: string) => /<h1 class="([^"]*)">([\s\S]*?)<\/h1>/.exec(html);

for (const [view, render] of [
  ["live", live],
  ["finished", after],
] as const) {
  describe(`${view}: a drop without a title looks like a drop with one`, () => {
    it("the headline: the title, else `SOL drop`, never what happened", () => {
      expect(h1(render({ title: "Drop from Chrizvico" }))?.[2]).toBe("Drop from Chrizvico");
      expect(h1(render({ title: null }))?.[2]).toBe("SOL drop");
      expect(h1(render({ title: null, token: token("TEST") }))?.[2]).toBe("TEST drop");
      expect(h1(render({ title: null, token: token(null) }))?.[2]).toBe("token drop");
      expect(render({ title: null })).not.toMatch(/is dropping|dropped 21/);
    });

    for (const title of ["Drop from Chrizvico", null]) {
      it(`title ${String(title)}: the headline, then the picture, @handle and X, then the chain`, () => {
        const html = render({ title });
        const headline = html.indexOf("<h1");
        const handle = html.indexOf("@averylonghandle</a>");
        const x = html.indexOf('aria-label="@averylonghandle on X"');
        const chain = html.indexOf("Solana test · ");
        expect(headline).toBeGreaterThan(-1);
        expect(handle).toBeGreaterThan(headline);
        expect(x).toBeGreaterThan(handle);
        expect(chain).toBeGreaterThan(x);
        // One X logo, under the headline; never one before it.
        expect(html.split('aria-label="@averylonghandle on X"')).toHaveLength(2);
      });
    }

    it("no sender: the headline, the short drop address, then the chain", () => {
      const html = render({ title: null, sender: null });
      expect(h1(html)?.[2]).toBe("SOL drop");
      expect(html.indexOf(shortAddress(DROP))).toBeGreaterThan(html.indexOf("<h1"));
      expect(html.indexOf("Solana test")).toBeGreaterThan(html.indexOf(shortAddress(DROP)));
    });

    it("never cut on the phone, one line from md", () => {
      for (const title of ["Drop from Chrizvico", null]) {
        const m = h1(render({ title }));
        expect(m?.[1]?.split(" ")).not.toContain("line-clamp-2");
        expect(m?.[1]).toContain("md:line-clamp-1");
      }
    });
  });
}
