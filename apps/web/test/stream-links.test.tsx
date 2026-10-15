/**
 * Streamer connect on the web
 * "Streamer connect on the profile".
 *
 * - The linked Kick or Twitch channel shows as its logo file right after the X link, Kick
 *   before Twitch, on board rows, the drop page sender line and the profile; never on drop rows.
 * - The link is built by the web from a fixed host and a checked name; a bad name shows nothing.
 * - The logo files are fixed, byte for byte, pinned by sha256; the drawn part is 16px tall
 *   (Kick in a 16px box, Twitch in a 23px box).
 * - On your own profile one `streams` card: connect, unlink, the `connect=` lines.
 * - `/privacy` says what is kept.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoardRows } from "@/components/boards/BoardRows";
import { DropRows } from "@/components/drops/DropRows";
import type { DropCardData } from "@/components/drops/drop-card-data";
import { StreamsCardView } from "@/components/profile/StreamsCard";
import { StreamLinks } from "@/components/site/StreamLinks";
import { XLink } from "@/components/site/XLink";
import type { BoardRow, Profile, ProfileStream } from "@/lib/api";
import {
  connectLine,
  connectStartUrl,
  STREAM_BOX_PX,
  STREAM_LOGO,
  STREAMS_NOTE,
  streamUrl,
} from "@/lib/streams";

const WEB = join(__dirname, "..");
const SRC = join(WEB, "src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

const KICK_SHA256 = "bcaaac5e7c3ddc072fb6ac4bb7a6660a2caf24fb21075e1c66e89ba1c2ee230e";
const TWITCH_SHA256 = "c58792c29f2c38a85793870089f2153431b45d44ccb0a80ee793d0dfb9057ea4";

const BOTH: ProfileStream[] = [
  { platform: "kick", channel: "chad-streams" },
  { platform: "twitch", channel: "chadstreams" },
];

const sample = (streams: ProfileStream[] | undefined): Profile => ({
  xUserId: "1",
  handle: "samplechad",
  displayName: "Sample",
  profileImageUrl: null,
  kind: "chad",
  tags: [],
  tagLockedUntil: null,
  badges: [],
  ...(streams === undefined ? {} : { streams }),
});

const boardRow = (profile: Profile): BoardRow => ({
  rank: 1,
  profile,
  totalWei: "300000000000000",
  dropCount: 1,
  claimCount: 1,
  uniqueReceivers: 3,
  biggestDropWei: "300000000000000",
  lastDropAt: 1_700_000_000,
  usd: 0,
  byChain: [],
});

const card = (creator: Profile): DropCardData => ({
  address: "0x1111111111111111111111111111111111110001",
  chainId: 46630,
  title: "gm",
  imageUrl: null,
  creator,
  chip: "LIVE",
  amountWei: "300000000000000",
  receivers: 3,
  claimed: 1,
  createdAt: 1_700_000_000,
});

/** Every `<a ...>` opening tag in some markup. */
const anchors = (html: string): string[] => html.match(/<a\b[^>]*>/g) ?? [];

describe("the link is built by the web", () => {
  it("kick.com/<slug> and www.twitch.tv/<login>", () => {
    expect(streamUrl({ platform: "kick", channel: "chad-streams" })).toBe(
      "https://kick.com/chad-streams",
    );
    expect(streamUrl({ platform: "twitch", channel: "chadstreams" })).toBe(
      "https://www.twitch.tv/chadstreams",
    );
  });

  const BAD: ProfileStream[] = [
    { platform: "kick", channel: "bad slug" },
    { platform: "kick", channel: "../evil" },
    { platform: "kick", channel: "a".repeat(26) },
    { platform: "kick", channel: "" },
    { platform: "twitch", channel: "Has.Dot" },
    { platform: "twitch", channel: "evil.example/x" },
    { platform: "twitch", channel: "UPPER" },
    { platform: "youtube" as "kick", channel: "chad" },
  ];
  for (const bad of BAD) {
    it(`no link for ${JSON.stringify(bad)}`, () => {
      expect(streamUrl(bad)).toBeNull();
    });
  }

  it("the start route of each platform", () => {
    expect(connectStartUrl("kick")).toBe("/api/auth/kick/start");
    expect(connectStartUrl("twitch")).toBe("/api/auth/twitch/start");
  });
});

describe("StreamLinks", () => {
  it("both: kick then twitch, new tab, noopener noreferrer, aria labels", () => {
    const html = renderToStaticMarkup(<StreamLinks streams={[...BOTH].reverse()} />);
    const links = anchors(html);
    expect(links).toHaveLength(2);
    expect(links[0]).toContain('href="https://kick.com/chad-streams"');
    expect(links[1]).toContain('href="https://www.twitch.tv/chadstreams"');
    for (const link of links) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
      expect(link).toContain("size-11");
    }
    expect(links[0]).toContain('aria-label="kick channel"');
    expect(links[1]).toContain('aria-label="twitch channel"');
  });

  it("the owner's files, the same height: kick 15px box, twitch 25px box", () => {
    expect(STREAM_LOGO).toEqual({
      kick: "/social/kick-logo.png",
      twitch: "/social/twitch-logo.png",
    });
    // Fix rounds: Twitch a little bigger, then Kick a little smaller (16px to 15px).
    expect(STREAM_BOX_PX).toEqual({ kick: 15, twitch: 25 });
    const html = renderToStaticMarkup(<StreamLinks streams={BOTH} />);
    expect(html).toMatch(/<img[^>]*src="\/social\/kick-logo.png"[^>]*width="15"[^>]*height="15"/);
    expect(html).toMatch(/<img[^>]*src="\/social\/twitch-logo.png"[^>]*width="25"[^>]*height="25"/);
    // Their own colours, always: no grey filter, no hover colour change.
    expect(html).not.toMatch(/grayscale|hover:text-chad-accent|opacity-/);
  });

  it("none, or only bad names: nothing at all", () => {
    expect(renderToStaticMarkup(<StreamLinks streams={[]} />)).toBe("");
    expect(renderToStaticMarkup(<StreamLinks streams={undefined} />)).toBe("");
    expect(
      renderToStaticMarkup(<StreamLinks streams={[{ platform: "kick", channel: "../x" }]} />),
    ).toBe("");
  });

  it("the logo files are fixed, byte for byte", () => {
    const kick = readFileSync(join(WEB, "public", "social", "kick-logo.png"));
    const twitch = readFileSync(join(WEB, "public", "social", "twitch-logo.png"));
    expect(createHash("sha256").update(kick).digest("hex")).toBe(KICK_SHA256);
    expect(createHash("sha256").update(twitch).digest("hex")).toBe(TWITCH_SHA256);
  });
});

describe("the X icon next to a name", () => {
  it("is 21px, so the drawn X is about as tall as the Kick K", () => {
    const html = renderToStaticMarkup(<XLink handle="samplechad" />);
    expect(html).toMatch(/<svg[^>]*class="[^"]*size-\[21px\]/);
  });
});

describe("where the icons show", () => {
  it("a board row: right after the X link, above the stretched row link", () => {
    const html = renderToStaticMarkup(<BoardRows rows={[boardRow(sample(BOTH))]} board="fed" />);
    const hrefs = anchors(html).map((a) => /href="([^"]*)"/.exec(a)?.[1]);
    const x = hrefs.indexOf("https://x.com/samplechad");
    expect(x).toBeGreaterThanOrEqual(0);
    expect(hrefs.slice(x + 1, x + 3)).toEqual([
      "https://kick.com/chad-streams",
      "https://www.twitch.tv/chadstreams",
    ]);
  });

  it("a board row of a profile with no streams field, an older api: nothing extra", () => {
    const html = renderToStaticMarkup(
      <BoardRows rows={[boardRow(sample(undefined))]} board="fed" />,
    );
    expect(html).not.toContain("kick.com");
    expect(html).not.toContain("twitch.tv");
  });

  it("never on drop rows", () => {
    const html = renderToStaticMarkup(<DropRows rows={[card(sample(BOTH))]} />);
    expect(html).not.toContain("kick.com");
    expect(html).not.toContain("twitch.tv");
  });

  it("the drop page sender line and the profile put StreamLinks right after every XLink", () => {
    for (const path of [
      "components/drops/LiveView.tsx",
      "components/drops/AfterView.tsx",
      "app/u/[handle]/page.tsx",
    ]) {
      const source = read(path);
      const xLinks = source.match(/<XLink handle=\{(\w+)\.handle\} \/>/g) ?? [];
      expect(xLinks.length, path).toBeGreaterThan(0);
      for (const match of source.matchAll(/<XLink handle=\{(\w+)\.handle\} \/>/g)) {
        const after = source.slice((match.index ?? 0) + match[0].length).trimStart();
        expect(after.startsWith(`<StreamLinks streams={${match[1] ?? ""}.streams} />`), path).toBe(
          true,
        );
      }
    }
  });
});

describe("the streams card on your own profile", () => {
  const view = (props: Partial<Parameters<typeof StreamsCardView>[0]> = {}): string =>
    renderToStaticMarkup(
      <StreamsCardView
        streams={[]}
        connect={{ kick: true, twitch: true }}
        result={null}
        busy={null}
        onUnlink={() => undefined}
        {...props}
      />,
    );

  it("none linked: connect kick and connect twitch, each to its start route", () => {
    const html = view();
    expect(html).toContain("streams");
    expect(html).toMatch(/<a[^>]*href="\/api\/auth\/kick\/start"[^>]*>[^<]*connect kick/);
    expect(html).toMatch(/<a[^>]*href="\/api\/auth\/twitch\/start"[^>]*>[^<]*connect twitch/);
    expect(html).not.toContain("unlink");
    expect(html).toContain(STREAMS_NOTE);
    // Kick's own screen says it reads the email, so no "we read nothing else".
    expect(STREAMS_NOTE).toBe("only used to show your channel link.");
    // A full page visit, never a new tab or a popup.
    expect(html).not.toContain('target="_blank"');
  });

  it("one linked: its name and unlink, the other still connect", () => {
    const html = view({ streams: [{ platform: "kick", channel: "chad-streams" }] });
    expect(html).toContain("chad-streams");
    expect(html).toContain("unlink");
    expect(html).not.toContain("connect kick");
    expect(html).toContain("connect twitch");
  });

  it("both linked: two names, two unlinks", () => {
    const html = view({ streams: BOTH });
    expect(html.match(/>unlink</g)).toHaveLength(2);
    expect(html).not.toContain("connect kick");
    expect(html).not.toContain("connect twitch");
  });

  it("a platform that is off has no row", () => {
    const html = view({ connect: { kick: true, twitch: false } });
    expect(html).toContain("connect kick");
    expect(html).not.toContain("twitch");
  });

  it("both off: no card at all", () => {
    expect(view({ connect: { kick: false, twitch: false } })).toBe("");
  });

  it("the connect= lines, the words of", () => {
    // `ok` has no line; the row's `connected` pill says it.
    expect(connectLine("ok", "kick")).toBeNull();
    expect(connectLine("ok", "twitch")).toBeNull();
    expect(connectLine("cancelled", "kick")).toBe("nothing changed.");
    expect(connectLine("taken", "kick")).toBe(
      "this kick account is linked to another X account. unlink it there first.",
    );
    expect(connectLine("taken", "twitch")).toBe(
      "this twitch account is linked to another X account. unlink it there first.",
    );
    expect(connectLine("expired", "kick")).toBe("that took too long. try again.");
    expect(connectLine("failed", "twitch")).toBe("twitch did not answer right. try again.");
    // `signin` lands on `/`, which shows nothing new.
    expect(connectLine("signin", "kick")).toBeNull();
    expect(connectLine("nonsense", "kick")).toBeNull();
  });

  it("an error line shows at the top of the card", () => {
    const line = "that took too long. try again.";
    const html = view({ result: { line } });
    expect(html.indexOf(line)).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(line)).toBeLessThan(html.indexOf("connect kick"));
  });

  it("a linked row: the name, then a connected pill with a mint dot, then unlink", () => {
    const html = view({ streams: [{ platform: "kick", channel: "chad-streams" }] });
    const pill =
      /<span[^>]*class="[^"]*\bpill\b[^"]*\bpill-on\b[^"]*"[^>]*>(.*?connected)<\/span>/.exec(html);
    expect(pill, "a pill-on span").not.toBeNull();
    expect(pill?.[0]).toContain("--pill:var(--chad-accent)");
    expect(pill?.[1]).toMatch(/<span[^>]*rounded-full[^>]*bg-chad-accent[^>]*><\/span>connected$/);
    const name = html.indexOf("chad-streams");
    const word = html.indexOf(">connected<");
    expect(name).toBeGreaterThanOrEqual(0);
    expect(word).toBeGreaterThan(name);
    expect(html.indexOf(">unlink<")).toBeGreaterThan(word);
    // The name takes the free space, so the pill sits on the right, right before unlink, and
    // the pills of both rows line up.
    expect(html).toMatch(
      /<span class="[^"]*\bflex-1\b[^"]*">chad-streams<\/span><span class="pill /,
    );
    expect(html.slice(word)).toMatch(/^>connected<\/span><button/);
    // One pill per linked row, none on a row still to connect.
    expect(html.match(/>connected</g)).toHaveLength(1);
    expect(view({ streams: BOTH }).match(/>connected</g)).toHaveLength(2);
    expect(view().match(/>connected</g)).toBeNull();
  });

  it("the card's icon box fits the 25px twitch box", () => {
    const html = view();
    expect(html).toMatch(/<img[^>]*src="\/social\/twitch-logo.png"[^>]*width="25"[^>]*height="25"/);
    expect(html).toMatch(/<img[^>]*src="\/social\/kick-logo.png"[^>]*width="15"[^>]*height="15"/);
    expect(read("components/profile/StreamsCard.tsx")).not.toContain("size-6 shrink-0");
  });

  it("the profile page puts the card under the tag picker, for its own profile only", () => {
    const page = read("app/u/[handle]/page.tsx");
    expect(page).toMatch(/<ProfileTags [^>]*\/>\s*<StreamsCard xUserId=\{profile\.xUserId\} \/>/);
    const cardSource = read("components/profile/StreamsCard.tsx");
    expect(cardSource).toMatch(/profile\.xUserId [!=]== xUserId/);
  });
});

describe("/privacy", () => {
  it("says what is kept when you connect kick or twitch", async () => {
    const privacy = await import("@/app/privacy/page");
    const html = renderToStaticMarkup(privacy.default());
    expect(html).toContain(
      "if you connect kick or twitch: that account&#x27;s id and name, only to show a link to your channel. we never keep a kick or twitch login, and unlink deletes it.",
    );
  });
});
