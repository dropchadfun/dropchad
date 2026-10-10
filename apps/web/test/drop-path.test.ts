/**
 * a multisend lives at `/m/<address>`, a handle
 * drop at `/d/<address>`, and each page sends the other kind to the right one with a 307. The
 * drop address is the id. `lib/drop-path.ts`.
 */
import { describe, expect, it } from "vitest";

import type { DropDetail } from "@/lib/api";
import { afterCreatePath, dPageRoute, mPageRoute, pagePathFor } from "@/lib/drop-path";

const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "9ArT5gUTbHq3P8f3LqfJ3i3o1s6r5HgkVdVx7m7z1wYb";

function detail(address: string, mode: "address" | "handle" | null): DropDetail {
  return {
    address,
    chain: { source: "indexer", available: true, indexed: true, data: null },
    ours: {
      source: "dropchad_api",
      known: mode !== null,
      data: mode === null ? null : ({ mode } as unknown as NonNullable<DropDetail["ours"]["data"]>),
    },
  };
}

describe("pagePathFor", () => {
  it("a handle drop is /d/, a multisend is /m/, on both chains", () => {
    expect(pagePathFor("handle", EVM)).toBe(`/d/${EVM}`);
    expect(pagePathFor("address", EVM)).toBe(`/m/${EVM}`);
    expect(pagePathFor("handle", SOL)).toBe(`/d/${SOL}`);
    expect(pagePathFor("address", SOL)).toBe(`/m/${SOL}`);
  });
});

describe("afterCreatePath, where /create goes once the money is seen", () => {
  it("send it in multisend mode lands on /m/", () => {
    expect(afterCreatePath("multisend", EVM)).toBe(`/m/${EVM}`);
  });

  it("drop mode still lands on /d/", () => {
    expect(afterCreatePath("drop", SOL)).toBe(`/d/${SOL}`);
  });
});

describe("dPageRoute, the /d/ page", () => {
  it("an old multisend link redirects to /m/", () => {
    expect(dPageRoute(detail(EVM, "address"))).toEqual({ kind: "redirect", to: `/m/${EVM}` });
    expect(dPageRoute(detail(SOL, "address"))).toEqual({ kind: "redirect", to: `/m/${SOL}` });
  });

  it("a handle drop renders", () => {
    expect(dPageRoute(detail(EVM, "handle"))).toEqual({ kind: "render" });
  });

  it("a drop we did not create renders as today: its mode is not known", () => {
    expect(dPageRoute(detail(EVM, null))).toEqual({ kind: "render" });
  });
});

describe("mPageRoute, the /m/ page", () => {
  it("a multisend renders", () => {
    expect(mPageRoute(detail(SOL, "address"))).toEqual({ kind: "render" });
  });

  it("a handle drop redirects to /d/", () => {
    expect(mPageRoute(detail(EVM, "handle"))).toEqual({ kind: "redirect", to: `/d/${EVM}` });
  });

  it("a drop we did not create is a 404: only our rows know a multisend", () => {
    expect(mPageRoute(detail(EVM, null))).toEqual({ kind: "not_found" });
  });
});
