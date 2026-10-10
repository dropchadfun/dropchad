/**
 * The hackathon line: a thin mint line above the
 * top bar on every page, typed once per visit, still under reduced motion, closed for good with
 * `×`. The whole line links to our project page; nothing else from
 * Colosseum. Rendered with `react-dom/server`; the inline script is run
 * against small fakes, no browser.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HackathonLine } from "@/components/site/HackathonLine";
import {
  CLOSED_KEY,
  HACKATHON_TEXT,
  HACKATHON_URL,
  TYPE_MS,
  TYPED_KEY,
  closeHackathonLine,
  hackathonLineScript,
  typedLength,
} from "@/lib/hackathon";

const SRC = join(__dirname, "..", "src");
const html = renderToStaticMarkup(<HackathonLine />);
const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");

/** A Storage that works, or one that throws like a blocked private window. */
function storage(initial: Record<string, string> = {}, blocked = false) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => {
      if (blocked) throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("blocked");
      data.set(key, value);
    },
  };
}

/** Runs the inline script the way the browser does, with the bar as the element before it. */
function runScript(opts: {
  local?: ReturnType<typeof storage>;
  session?: ReturnType<typeof storage>;
  reduced?: boolean;
}) {
  const bar = { dataset: {} as Record<string, string> };
  const local = opts.local ?? storage();
  const session = opts.session ?? storage();
  runInNewContext(hackathonLineScript(), {
    document: { currentScript: { previousElementSibling: bar } },
    localStorage: local,
    sessionStorage: session,
    matchMedia: (query: string) => ({
      matches: query.includes("reduce") && opts.reduced === true,
    }),
  });
  return { state: bar.dataset["state"], local, session };
}

describe("the words", () => {
  it("says exactly the owner's line, after a code prompt", () => {
    expect(HACKATHON_TEXT).toBe("building for the Crypto World's Fair hackathon");
    expect(html).toContain("&gt; ");
    expect(html.replace(/&#x27;/g, "'")).toContain(HACKATHON_TEXT);
  });

  it("links to our project page, the exact url", () => {
    expect(HACKATHON_URL).toBe("https://colosseum.com/arena/projects/dropchad");
  });

  it("one link, in a new tab, noopener noreferrer", () => {
    expect(html.match(/<a /g)).toHaveLength(1);
    const link = /<a [^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain(`href="${HACKATHON_URL}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });

  it("the whole sentence is the link; the close button is outside it", () => {
    const inside = /<a [^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1] ?? "";
    expect(inside.replace(/&#x27;/g, "'")).toContain(
      `<span class="sr-only">${HACKATHON_TEXT}</span>`,
    );
    expect(inside).toContain("hackathon-type");
    expect(inside).not.toContain("<button");
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf("</a>"));
  });

  it("same look, a small hover effect and a focus ring", () => {
    const link = /<a [^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain("hover:underline");
    expect(link).toContain("focus-visible:");
    expect(link).not.toMatch(/\bbg-|\bborder\b/);
  });

  it("has nothing from Colosseum but the link: no logo, no image, the name only in the url", () => {
    expect(html).not.toMatch(/<img|<svg[^>]*>\s*<image/);
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    const hits = files(SRC)
      .filter(
        (path) =>
          /colosseum/i.test(path) ||
          (/\.(tsx?|css)$/.test(path) && /colosseum/i.test(readFileSync(path, "utf8"))),
      )
      .map((path) => relative(SRC, path).replace(/\\/g, "/"));
    expect(hits).toEqual(["lib/hackathon.ts"]);
    const lines = readFileSync(join(SRC, "lib", "hackathon.ts"), "utf8")
      .split("\n")
      .filter((line) => /colosseum/i.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`"${HACKATHON_URL}"`);
  });

  it("a screen reader hears the whole sentence once; the typed part is hidden from it", () => {
    expect(html).toMatch(
      /<span class="sr-only">building for the Crypto World(&#x27;|')s Fair hackathon<\/span>/,
    );
    expect(html).toMatch(/<span aria-hidden="true"[^>]*class="[^"]*hackathon-type/);
  });
});

describe("the look and the motion", () => {
  it("mint, mono, small, at least 28px high, on the page dark; it may wrap on a narrow phone", () => {
    expect(html).toMatch(/class="hackathon-line [^"]*\bmin-h-7\b/);
    expect(html).toContain("text-chad-accent");
    expect(html).toContain("font-mono");
    expect(html).toContain("hackathon-text");
    expect(html).not.toMatch(/class="[^"]*hackathon-line[^"]*\b(truncate|whitespace-nowrap)\b/);
  });

  it("the text is centered, the 2 lines on a narrow phone too", () => {
    const text = html.match(/<a [^>]*class="[^"]*font-mono[^"]*"/)?.[0] ?? "";
    expect(text).toMatch(/\btext-center\b/);
    expect(text).toMatch(/\bflex-1\b/);
  });

  it("an empty spacer as wide as the × on the left keeps the text in the true middle", () => {
    const row = html.match(/<div class="mx-auto [^"]*">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
    expect(row).toMatch(/^<span aria-hidden="true" class="size-4 shrink-0 md:size-5"><\/span><a /);
    expect(html.match(/<button [^>]*>/)?.[0] ?? "").toMatch(/\bsize-4 shrink-0 md:size-5\b/);
  });

  it("on phones the text fits one line from 375px wide, even in the widest phone mono fonts", () => {
    // The row: 16px gutters, a 16px spacer and a 16px ×, two 6px gaps, the × 4px into the gutter.
    const row = html.match(/<div class="mx-auto [^"]*">/)?.[0] ?? "";
    expect(row).toMatch(/\bpx-4\b/);
    expect(row).toMatch(/\bgap-1\.5\b/);
    expect(html.match(/<button [^>]*>/)?.[0] ?? "").toMatch(/\B-mr-1\b/);
    // A 44px tap area on both sizes of the ×: 16 + 2 × 14 on phones, 20 + 2 × 12 from md.
    expect(html.match(/<button [^>]*>/)?.[0] ?? "").toMatch(
      /\bbefore:-inset-3\.5\b[^"]*\bmd:before:-inset-3\b/,
    );
    const taken = 2 * 16 + 16 + 16 + 2 * 6 - 4;
    expect(taken).toBe(72);

    const rule = css.match(/\.hackathon-text\s*\{[^}]*\}/)?.[0] ?? "";
    const clamp = rule.match(
      /font-size:\s*clamp\((\d+)px,\s*calc\(\(100vw - (\d+)px\) \/ ([\d.]+)\),\s*(\d+)px\)/,
    );
    expect(clamp).not.toBeNull();
    const min = Number(clamp?.[1]);
    const minus = Number(clamp?.[2]);
    const divide = Number(clamp?.[3]);
    const max = Number(clamp?.[4]);
    expect(minus).toBe(taken);
    expect(max).toBe(12);
    expect(min).toBeGreaterThanOrEqual(10);
    const size = (width: number) => Math.min(max, Math.max(min, (width - minus) / divide));
    // "> " and the words, at 0.6 of the font size each: SF Mono, Menlo, Droid Sans Mono.
    const need = (width: number) => (2 + HACKATHON_TEXT.length) * 0.6 * size(width);
    for (const width of [375, 390, 414])
      expect(need(width), String(width)).toBeLessThanOrEqual(width - taken);
    expect(size(1280)).toBe(12);
    expect(size(375)).toBeLessThan(12);
  });

  it("from 375px up it stays on one line, under that it may wrap", () => {
    expect(css).toMatch(/\.hackathon-text\s*\{[^}]*white-space: nowrap;/);
    expect(css).toMatch(
      /@media \(max-width: 374px\)\s*\{\s*\.hackathon-text\s*\{\s*white-space: normal;/,
    );
  });

  it("the × stays last in the row, at the right edge", () => {
    const row = html.match(/<div class="mx-auto [^"]*">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
    expect(row).toMatch(/<\/a><button [^>]*>[\s\S]*<\/button>$/);
  });

  it("types once in ≈ 1.2s, one letter at a time, then stops", () => {
    const n = HACKATHON_TEXT.length;
    expect(TYPE_MS).toBe(1200);
    expect(typedLength(0, n)).toBe(0);
    expect(typedLength(TYPE_MS / 2, n)).toBe(Math.floor(n / 2));
    expect(typedLength(TYPE_MS, n)).toBe(n);
    expect(typedLength(60_000, n)).toBe(n);
    for (let ms = 0; ms <= TYPE_MS; ms += 50) {
      expect(typedLength(ms + 50, n)).toBeGreaterThanOrEqual(typedLength(ms, n));
    }
  });

  it("the server sends the full text and no cursor: still, reduced motion and no JS read it all", () => {
    expect(html).not.toContain("hackathon-caret");
  });

  it("while waiting to type the text is hidden, and shows after 2s if the typing never starts", () => {
    expect(css).toMatch(
      /\.hackathon-line\[data-state="type"\] \.hackathon-type\s*\{[^}]*visibility: hidden;[^}]*animation: hackathon-show 0s 2s forwards;/,
    );
    expect(css).toMatch(/@keyframes hackathon-show\s*\{\s*to\s*\{\s*visibility: visible;/);
  });

  it("no loop and no blinking cursor anywhere", () => {
    expect(css).not.toMatch(/hackathon[\s\S]{0,300}infinite/);
    expect(css).not.toMatch(/\.hackathon-caret\s*\{[^}]*animation/);
  });

  it("reduced motion: the full text, never hidden", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.hackathon-line \.hackathon-type\s*\{[^}]*visibility: visible;[^}]*animation: none;/,
    );
  });

  it("closed: not shown at all", () => {
    expect(css).toMatch(/\.hackathon-line\[data-state="closed"\]\s*\{\s*display: none;/);
  });
});

describe("the inline script, before the first paint", () => {
  it("is right after the bar, and the bar keeps what the script wrote", () => {
    expect(html).toMatch(/<div [^>]*class="hackathon-line[^>]*>[\s\S]*<\/div><script/);
    expect(html).toContain(hackathonLineScript());
  });

  it("first visit: type, and marks this visit as typed", () => {
    const { state, session } = runScript({});
    expect(state).toBe("type");
    expect(session.data.get(TYPED_KEY)).toBe("1");
  });

  it("the next page load in the same visit: still", () => {
    expect(runScript({ session: storage({ [TYPED_KEY]: "1" }) }).state).toBe("still");
  });

  it("reduced motion: still", () => {
    expect(runScript({ reduced: true }).state).toBe("still");
  });

  it("closed before: closed, on every visit", () => {
    expect(runScript({ local: storage({ [CLOSED_KEY]: "1" }) }).state).toBe("closed");
  });

  it("blocked storage: shows, never throws", () => {
    expect(() => runScript({ local: storage({}, true), session: storage({}, true) })).not.toThrow();
    // Nothing can be read or saved: the line shows, typed, as on a first visit.
    expect(runScript({ local: storage({}, true), session: storage({}, true) }).state).toBe("type");
  });
});

describe("the close button", () => {
  it("is a small × with a 44px tap area and a clear label", () => {
    const button = html.match(/<button [^>]*>/)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-label="close the hackathon line"');
    expect(button).toMatch(/before:-inset/);
    expect(html).toContain("lucide-x");
  });

  it("closing hides the bar and remembers it in this browser", () => {
    const bar = { dataset: {} as Record<string, string> };
    const local = storage();
    closeHackathonLine(bar, local);
    expect(bar.dataset["state"]).toBe("closed");
    expect(local.data.get(CLOSED_KEY)).toBe("1");
  });

  it("closing with blocked storage still hides the bar, never throws", () => {
    const bar = { dataset: {} as Record<string, string> };
    expect(() => closeHackathonLine(bar, storage({}, true))).not.toThrow();
    expect(bar.dataset["state"]).toBe("closed");
  });
});

describe("every page", () => {
  it("the layout puts the line above the top bar", () => {
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
    const line = layout.indexOf("<HackathonLine />");
    expect(line).toBeGreaterThan(-1);
    expect(line).toBeLessThan(layout.indexOf("<Header />"));
  });
});
