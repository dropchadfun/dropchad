/**
 * X pictures load with no referrer: X refuses a
 * picture asked for with our referrer. A failed `_400x400` file tries the stored `_normal` link
 * before the letter; each link gets one try, and a new link gets its own. The share card's
 * sender picture loads with no referrer too.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadImage } from "@/components/drops/ShareCard";
import { Avatar, AvatarFace, nextPicture, pictureTries } from "@/components/site/Avatar";

const NORMAL = "https://pbs.twimg.com/profile_images/1234/abc_normal.jpg";
const BIG = "https://pbs.twimg.com/profile_images/1234/abc_400x400.jpg";
const OTHER = "https://pbs.twimg.com/profile_images/5678/xyz_normal.jpg";
const OTHER_BIG = "https://pbs.twimg.com/profile_images/5678/xyz_400x400.jpg";
const NO_REFERRER = /referrerPolicy="no-referrer"/i;

describe("no referrer on the picture", () => {
  it("the img asks for no referrer", () => {
    const html = renderToStaticMarkup(
      <AvatarFace src={NORMAL} name="chad" size={32} failed={false} onFail={() => undefined} />,
    );
    expect(html).toMatch(NO_REFERRER);
  });

  it("at every size, the big file and the small one", () => {
    expect(renderToStaticMarkup(<Avatar src={NORMAL} name="chad" size={52} />)).toMatch(
      NO_REFERRER,
    );
    expect(renderToStaticMarkup(<Avatar src={NORMAL} name="chad" size={32} />)).toMatch(
      NO_REFERRER,
    );
  });
});

describe("the links to try, in order", () => {
  it("48px and up: the 400x400 file, then the stored link", () => {
    expect(pictureTries(NORMAL, 48)).toEqual([BIG, NORMAL]);
    expect(pictureTries(NORMAL, 56)).toEqual([BIG, NORMAL]);
  });

  it("under 48px: only the stored link, as before", () => {
    expect(pictureTries(NORMAL, 32)).toEqual([NORMAL]);
    expect(pictureTries(NORMAL, 47)).toEqual([NORMAL]);
  });

  it("a link without _normal: only that link; no link: none", () => {
    const plain = "https://abs.twimg.com/sticky/default_profile_images/default_profile.png";
    expect(pictureTries(plain, 88)).toEqual([plain]);
    expect(pictureTries(null, 88)).toEqual([]);
  });
});

describe("the link shown after failures", () => {
  it("the big file first", () => {
    expect(nextPicture([BIG, NORMAL], [])).toBe(BIG);
  });

  it("the big file failed: the stored link", () => {
    expect(nextPicture([BIG, NORMAL], [BIG])).toBe(NORMAL);
  });

  it("both failed: none, so the letter", () => {
    expect(nextPicture([BIG, NORMAL], [BIG, NORMAL])).toBeNull();
    expect(nextPicture([NORMAL], [NORMAL])).toBeNull();
    expect(nextPicture([], [])).toBeNull();
  });

  it("a new link gets its own tries", () => {
    expect(nextPicture(pictureTries(OTHER, 52), [BIG, NORMAL])).toBe(OTHER_BIG);
  });
});

describe("the share card's sender picture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads with no referrer and with CORS, so the canvas stays exportable", async () => {
    const made: FakeImage[] = [];
    class FakeImage {
      crossOrigin: string | null = null;
      referrerPolicy = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private url = "";
      constructor() {
        made.push(this);
      }
      get src(): string {
        return this.url;
      }
      set src(value: string) {
        this.url = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);

    const image = await loadImage(NORMAL, true);
    expect(image).toBe(made[0]);
    expect(made[0]?.referrerPolicy).toBe("no-referrer");
    expect(made[0]?.crossOrigin).toBe("anonymous");
  });
});
