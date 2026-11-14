/**
 * The create card asks the logo route again: when the check answers
 * `logoUrl` `null` and `logoPending` `true`, the card asks 1, 3 and 6 seconds after the answer,
 * then stops. On a `200` it shows the picture at once; until then the first letter. No other
 * page asks again.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGO_RETRY_MS, watchLogo } from "@/lib/logo-retry";

const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const ROUTE = `/api/tokens/${MINT}/logo?chain=solana`;
const SRC = join(import.meta.dirname, "..", "src");

const pending = { mint: MINT, logoUrl: null, logoPending: true };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the create card asks the logo route again", () => {
  it("1, 3 and 6 seconds after the answer", () => {
    expect(LOGO_RETRY_MS).toEqual([1_000, 3_000, 6_000]);
  });

  it("asks at 1, 3 and 6 seconds, shows the picture on the first 200, then stops", async () => {
    const probe = vi.fn<(url: string) => Promise<boolean>>();
    probe.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onReady = vi.fn<(url: string) => void>();
    watchLogo(pending, { probe, onReady });

    await vi.advanceTimersByTimeAsync(999);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenLastCalledWith(ROUTE);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(onReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(onReady).toHaveBeenCalledExactlyOnceWith(ROUTE);
  });

  it("a 200 on the first ask: the picture, and no more asks", async () => {
    const probe = vi.fn<(url: string) => Promise<boolean>>().mockResolvedValue(true);
    const onReady = vi.fn<(url: string) => void>();
    watchLogo(pending, { probe, onReady });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledExactlyOnceWith(ROUTE);
  });

  it("three 404s: it stops, the letter stays", async () => {
    const probe = vi.fn<(url: string) => Promise<boolean>>().mockResolvedValue(false);
    const onReady = vi.fn<(url: string) => void>();
    watchLogo(pending, { probe, onReady });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("no ask when a logo is there, or when no fetch is running", async () => {
    const probe = vi.fn<(url: string) => Promise<boolean>>().mockResolvedValue(true);
    const onReady = vi.fn<(url: string) => void>();
    watchLogo({ mint: MINT, logoUrl: ROUTE, logoPending: false }, { probe, onReady });
    watchLogo({ mint: MINT, logoUrl: null, logoPending: false }, { probe, onReady });
    watchLogo({ mint: MINT, logoUrl: null }, { probe, onReady });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it("stopped when the card goes away or another token is pasted", async () => {
    const probe = vi.fn<(url: string) => Promise<boolean>>().mockResolvedValue(false);
    const onReady = vi.fn<(url: string) => void>();
    const stop = watchLogo(pending, { probe, onReady });
    await vi.advanceTimersByTimeAsync(1_000);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("a 200 that comes back after the stop shows nothing", async () => {
    let answer: (ok: boolean) => void = () => {};
    const probe = vi.fn<(url: string) => Promise<boolean>>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const onReady = vi.fn<(url: string) => void>();
    const stop = watchLogo(pending, { probe, onReady });
    await vi.advanceTimersByTimeAsync(1_000);
    stop();
    answer(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe("only the create card asks again", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it("watchLogo is used by the token card and nowhere else", () => {
    const users = sourceFiles(SRC)
      .filter((path) => readFileSync(path, "utf8").includes("@/lib/logo-retry"))
      .map((path) => relative(SRC, path).replaceAll("\\", "/"));
    expect(users).toEqual(["components/create/TokenBox.tsx"]);
  });

  it("the card starts it from its check and shows the picture it gives", () => {
    const box = readFileSync(join(SRC, "components", "create", "TokenBox.tsx"), "utf8");
    expect(box).toMatch(/watchLogo\(\s*check/);
  });
});
