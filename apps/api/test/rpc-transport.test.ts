/**
 * Two RPC providers: the public endpoint first, a keyed one only when it fails.
 */
import { describe, expect, it } from "vitest";

import { rpcTransport } from "../src/chain/client.js";

describe("rpcTransport", () => {
  it("is plain http for one url", () => {
    expect(rpcTransport("https://a.invalid")({}).config.type).toBe("http");
    expect(rpcTransport(["https://a.invalid"])({}).config.type).toBe("http");
  });

  it("is viem's fallback for a primary and a fallback", () => {
    expect(rpcTransport(["https://a.invalid", "https://b.invalid"])({}).config.type).toBe(
      "fallback",
    );
  });

  it("refuses an empty list", () => {
    expect(() => rpcTransport([])).toThrow(/no RPC url/);
  });
});
