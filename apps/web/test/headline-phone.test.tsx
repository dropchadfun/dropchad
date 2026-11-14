/**
 * The drop page headline: a drop without a title looks like a
 * drop with one. The headline is the title, else the rows' line one, `SOL drop`; under it the
 * sender's picture, `@handle` and the X logo; under that the chain and the age. Live and
 * finished alike. On the phone the headline is never cut; desktop one line.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("the sender line's small picture", () => {
  const pictured = {
    ...creator,
    profileImageUrl: "https://pbs.twimg.com/profile_images/sample_normal.png",
  } as Profile;
  const senderLink = (html: string) =>
    /<a [^>]*href="\/u\/averylonghandle"[^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1] ?? "";

  it("finished: no small picture before @handle, only the handle in the link", () => {
    const html = after({ title: null, sender: pictured });
    expect(senderLink(html)).toBe("@averylonghandle");
    // The sender is shown once, by the big drop picture on the left.
    expect(html.match(/<img[^>]*profile_images\/sample/g)).toHaveLength(1);
    expect(html).not.toMatch(/<img[^>]*width="20"/);
  });

  it("finished, no X picture: no small letter disc before @handle either", () => {
    expect(senderLink(after({ title: null, sender: creator }))).toBe("@averylonghandle");
  });

  /** The 48px drop picture box with the chain badge: the part before the `<h1>`. */
  const pictureBox = (html: string) => {
    const head = html.slice(0, html.indexOf("<h1"));
    return head.slice(head.lastIndexOf('<span class="relative shrink-0">'));
  };

  for (const [view, render] of [
    ["live", live],
    ["finished", after],
  ] as const) {
    it(`${view}: no small picture before @handle, the sender once, 48px on the left`, () => {
      const html = render({ title: null, sender: pictured });
      expect(senderLink(html)).toBe("@averylonghandle");
      expect(html.match(/<img[^>]*profile_images\/sample/g)).toHaveLength(1);
      expect(html).not.toMatch(/<img[^>]*width="20"/);
      const box = pictureBox(html);
      expect(box).toMatch(/<img[^>]*profile_images\/sample[^>]*width="48"/);
      expect(box).toContain('src="/chains/solana.svg"');
    });
  }

  it("live and finished: the same picture box, the same layout around the title", () => {
    const a = live({ title: null, sender: pictured });
    const b = after({ title: null, sender: pictured });
    expect(pictureBox(a)).toBe(pictureBox(b));
    const around = /<div class="flex min-w-0 items-center gap-3"><span class="relative shrink-0">/;
    expect(a).toMatch(around);
    expect(b).toMatch(around);
  });

  it("live, no sender: as today, no picture, the short drop address", () => {
    const html = live({ title: null, sender: null });
    expect(html.slice(0, html.indexOf("<h1"))).not.toContain('<span class="relative shrink-0">');
    expect(html).not.toContain('src="/chains/solana.svg"');
    expect(html).toContain(shortAddress(DROP));
  });

  it("live reuses the finished page picture, never a second copy", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "components", "drops", "LiveView.tsx"),
      "utf8",
    );
    expect(src).toMatch(/import \{[^}]*AfterPicture[^}]*\} from "@\/components\/drops\/AfterView"/);
    expect(src).not.toMatch(/function \w*Picture/);
    expect(src).not.toContain("size={20}");
  });
});
