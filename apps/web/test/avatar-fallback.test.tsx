/**
 * A picture that fails to load shows the first letter of the handle in a round box, never the
 * broken image icon. One `Avatar` for every place that shows a face, so the
 * rows, the drop page, the boards, the profile and the header all get it.
 *
 * `AvatarFace` is the markup with the state passed in, so it renders here without a DOM; `Avatar`
 * holds the state. A picture can fail before React hydrates, when `onError` has not run, so on
 * mount the image is checked once with `imageBroken`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarFace, imageBroken } from "@/components/site/Avatar";

const PIC = "https://pbs.twimg.com/profile_images/1214999692590739456/u9e0J7DV_normal.jpg";
const SRC = join(__dirname, "..", "src");

describe("a picture that loads", () => {
  it("is the X picture, round, as before", () => {
    const html = renderToStaticMarkup(<Avatar src={PIC} name="nigeloxide" size={40} />);
    expect(html).toContain(`src="${PIC}"`);
    expect(html).toContain("rounded-full");
  });

  it("no picture at all is still the letter", () => {
    const html = renderToStaticMarkup(<Avatar src={null} name="nigeloxide" />);
    expect(html).not.toContain("<img");
    expect(html).toMatch(/>n<\/span>/);
  });
});

describe("a picture that fails", () => {
  it("the image reports its failure through onError", () => {
    let failed = 0;
    const element = AvatarFace({
      src: PIC,
      name: "nigeloxide",
      size: 40,
      failed: false,
      onFail: () => failed++,
    }) as ReactElement<{ onError?: () => void }>;
    expect(element.type).toBe("img");
    element.props.onError?.();
    expect(failed).toBe(1);
  });

  it("after the failure: the first letter in a round box, no img", () => {
    const html = renderToStaticMarkup(
      <AvatarFace src={PIC} name="nigeloxide" size={40} failed onFail={() => undefined} />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain(PIC);
    expect(html).toMatch(/>n<\/span>/);
    expect(html).toContain("rounded-full");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("width:40px;height:40px");
  });

  it("the letter box keeps the caller's class, the square tile in a drop row too", () => {
    const html = renderToStaticMarkup(
      <AvatarFace
        src={PIC}
        name="nigeloxide"
        size={40}
        className="rounded-lg!"
        failed
        onFail={() => undefined}
      />,
    );
    expect(html).toContain("rounded-lg!");
  });
});

describe("imageBroken, the check on mount", () => {
  it("a finished image with no width failed", () => {
    expect(imageBroken({ complete: true, naturalWidth: 0 })).toBe(true);
  });

  it("still loading, or loaded, is not broken", () => {
    expect(imageBroken({ complete: false, naturalWidth: 0 })).toBe(false);
    expect(imageBroken({ complete: true, naturalWidth: 48 })).toBe(false);
  });
});

describe("one Avatar for every place", () => {
  it("is a client component, so the state works where a server component uses it", () => {
    const source = readFileSync(join(SRC, "components", "site", "Avatar.tsx"), "utf8");
    expect(source.trimStart().startsWith('"use client";')).toBe(true);
  });
});
