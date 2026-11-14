/**
 * X pictures at 48px or more use the `_400x400` file
 * the stored link is X's 48px `_normal`. Smaller pictures keep it; a link without `_normal`
 * stays as it is; no link, or one that fails, shows the letter.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar } from "@/components/site/Avatar";
import { xPictureAt } from "@/lib/picture";

const NORMAL = "https://pbs.twimg.com/profile_images/1234/abc_normal.jpg";
const BIG = "https://pbs.twimg.com/profile_images/1234/abc_400x400.jpg";

describe("xPictureAt", () => {
  it("48px and up: the 400x400 file of the same link", () => {
    expect(xPictureAt(NORMAL, 48)).toBe(BIG);
    expect(xPictureAt(NORMAL, 88)).toBe(BIG);
    expect(xPictureAt("https://pbs.twimg.com/profile_images/9/x_normal.png", 52)).toBe(
      "https://pbs.twimg.com/profile_images/9/x_400x400.png",
    );
  });

  it("under 48px: the stored link", () => {
    for (const size of [20, 28, 32, 40, 47]) expect(xPictureAt(NORMAL, size)).toBe(NORMAL);
  });

  it("a link without _normal stays as it is; no link stays none", () => {
    const plain = "https://abs.twimg.com/sticky/default_profile_images/default_profile.png";
    expect(xPictureAt(plain, 88)).toBe(plain);
    expect(xPictureAt(BIG, 88)).toBe(BIG);
    expect(xPictureAt(null, 88)).toBeNull();
  });
});

describe("Avatar", () => {
  it("draws the 400x400 file at 48px, the profile page size", () => {
    const html = renderToStaticMarkup(<Avatar src={NORMAL} name="chad" size={48} />);
    expect(html).toContain(`src="${BIG}"`);
  });

  it("keeps the small file in a 32px row", () => {
    const html = renderToStaticMarkup(<Avatar src={NORMAL} name="chad" size={32} />);
    expect(html).toContain(`src="${NORMAL}"`);
  });

  it("no link: the letter", () => {
    const html = renderToStaticMarkup(<Avatar src={null} name="chad" size={88} />);
    expect(html).not.toContain("<img");
    expect(html).toContain(">c<");
  });
});
