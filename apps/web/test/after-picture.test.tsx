/**
 * The picture on the drop page after the rain, `AfterView.tsx`: a drop with
 * no picture shows the sender's X avatar, the same as the rows and cards (`DropPicture.tsx`),
 * never the grey `meme` tile. Rendered with `react-dom/server`, no browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterPicture } from "@/components/drops/AfterView";
import type { Profile } from "@/lib/api";

const creator = {
  xUserId: "1",
  handle: "samplechad",
  displayName: "Sample",
  profileImageUrl: "https://pbs.twimg.com/profile_images/sample.png",
  kind: "chad",
  tags: [],
} as unknown as Profile;

describe("AfterPicture", () => {
  it("shows the drop's own picture when it has one", () => {
    const html = renderToStaticMarkup(
      <AfterPicture imageUrl="https://example.com/meme.png" creator={creator} />,
    );
    expect(html).toContain('src="https://example.com/meme.png"');
    expect(html).not.toContain("sample.png");
  });

  it("shows the sender's X avatar when the drop has no picture, never the meme tile", () => {
    const html = renderToStaticMarkup(<AfterPicture imageUrl={null} creator={creator} />);
    expect(html).toContain('src="https://pbs.twimg.com/profile_images/sample.png"');
    expect(html).not.toContain(">meme<");
  });

  it("a sender without an X picture gets the first letter, like everywhere else", () => {
    const html = renderToStaticMarkup(
      <AfterPicture imageUrl={null} creator={{ ...creator, profileImageUrl: null }} />,
    );
    expect(html).toContain(">s<");
    expect(html).not.toContain(">meme<");
  });

  it("a drop with no known sender gets a blank tile, as the rows do", () => {
    const html = renderToStaticMarkup(<AfterPicture imageUrl={null} creator={null} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain(">meme<");
  });
});
