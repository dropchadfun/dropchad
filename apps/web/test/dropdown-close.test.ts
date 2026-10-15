/**
 * Small dropdowns close on a click or tap outside, on Escape, and on their own button again
 * the account menu under the avatar. The `+2` tags box is gone since the main
 * tag.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

/** A document with only the two listener calls, so a test can fire events at it. */
function fakeDoc() {
  const on = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      on.set(type, (on.get(type) ?? new Set()).add(fn));
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => on.get(type)?.delete(fn),
    fire: (type: string, event: object) => {
      on.get(type)?.forEach((fn) => {
        fn(event);
      });
    },
    count: () => [...on.values()].reduce((n, set) => n + set.size, 0),
  };
}
const inside = { id: "inside" };
const box = { contains: (node: unknown) => node === inside };

describe("bindDismiss", () => {
  it("closes on a click or tap outside the box", async () => {
    const { bindDismiss } = await import("@/lib/dismiss");
    const doc = fakeDoc();
    let closed = 0;
    bindDismiss(
      doc as never,
      () => box,
      () => closed++,
    );
    doc.fire("pointerdown", { target: { id: "outside" } });
    expect(closed).toBe(1);
  });

  it("stays open on a click inside the box (the button's own toggle closes it)", async () => {
    const { bindDismiss } = await import("@/lib/dismiss");
    const doc = fakeDoc();
    let closed = 0;
    bindDismiss(
      doc as never,
      () => box,
      () => closed++,
    );
    doc.fire("pointerdown", { target: inside });
    expect(closed).toBe(0);
  });

  it("closes on Escape anywhere, not on other keys", async () => {
    const { bindDismiss } = await import("@/lib/dismiss");
    const doc = fakeDoc();
    let closed = 0;
    bindDismiss(
      doc as never,
      () => box,
      () => closed++,
    );
    doc.fire("keydown", { key: "Enter" });
    doc.fire("keydown", { key: "Escape" });
    expect(closed).toBe(1);
  });

  it("removes its listeners when the box closes", async () => {
    const { bindDismiss } = await import("@/lib/dismiss");
    const doc = fakeDoc();
    const unbind = bindDismiss(
      doc as never,
      () => box,
      () => {},
    );
    expect(doc.count()).toBe(2);
    unbind();
    expect(doc.count()).toBe(0);
  });
});

describe("the dropdowns use it", () => {
  it("account menu: avatar and menu in one box, closed by useDismiss, avatar toggles", () => {
    const src = read("components/site/Header.tsx");
    expect(src).toContain("useDismiss(menu, box, setMenu)");
    expect(src).toMatch(
      /<div ref=\{box\}[^>]*>\s*<button[\s\S]*?role="menu"[\s\S]*?<\/div>\s*\) : null\}\s*<\/div>/,
    );
    expect(src).toContain("setMenu((open) => !open)");
  });
});
