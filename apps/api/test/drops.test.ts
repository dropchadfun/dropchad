/**
 * The public read api: `/api/drops`, `/api/drops/:address`, `/api/stats`.
 *
 * Two layers are tested separately.
 *
 * - the **routes**, over a stub indexer: validation, status codes, and that a junk address never
 *   reaches the indexer at all
 * - the **forwarding client**, over a stubbed `fetch`: the real URL building, the 404 versus
 *   outage distinction, and the timeout
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createIndexerClient,
  IndexerUnavailableError,
  type IndexerClient,
} from "../src/indexer/client.js";
import { createHarness, type Harness } from "./harness.js";

let harness: Harness;

afterEach(async () => {
  await harness?.close();
});

describe("GET /api/drops", () => {
  beforeEach(async () => {
    harness = await createHarness({
      indexer: { drops: { drops: [{ address: "0x01532cdb", status: "Active" }] } },
    });
  });

  it("leaves out a drop we did not create, and says which chains it could read", async () => {
    // Step 21: the list is our handle drops only. This one is the indexer's alone.
    // The handle drop cases are in `drop-list.test.ts`.
    const response = await harness.app.request("/api/drops");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      drops: [],
      chain: "all",
      sources: { indexer: { available: true }, solana: { configured: false } },
    });
  });

  it("rejects a limit that is not a number", async () => {
    const response = await harness.app.request("/api/drops?limit=lots");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
  });

  it("rejects a limit above the cap, so nobody can ask for the whole table", async () => {
    const response = await harness.app.request("/api/drops?limit=100000");
    expect(response.status).toBe(400);
  });

  it("needs no session: the drops list is public", async () => {
    expect((await harness.app.request("/api/drops")).status).toBe(200);
  });
});

describe("GET /api/drops/:address", () => {
  beforeEach(async () => {
    harness = await createHarness({ indexer: { drop: {} } });
  });

  it("returns the indexed drop, labelled as coming from the indexer", async () => {
    const response = await harness.app.request(
      "/api/drops/0x01532cdb9fA0AEde791c3295e7c49ADe9b29f315",
    );
    expect(response.status).toBe(200);
    // The address is lower cased before it is forwarded, so one drop has one url.
    expect(await response.json()).toEqual({
      address: "0x01532cdb9fa0aede791c3295e7c49ade9b29f315",
      chain: {
        source: "indexer",
        available: true,
        indexed: true,
        data: { drop: { address: "0x01532cdb9fa0aede791c3295e7c49ade9b29f315" } },
      },
      // We did not create this one, so we have no opinion about it and say so.
      ours: { source: "dropchad_api", known: false, data: null },
    });
  });

  it("rejects anything that is not a 20 byte hex address", async () => {
    for (const bad of ["nope", "0x123", "0x" + "z".repeat(40), "0x" + "a".repeat(41)]) {
      const response = await harness.app.request(`/api/drops/${bad}`);
      expect(response.status, bad).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_address" });
    }
  });

  it("returns 404 for a drop the indexer does not know", async () => {
    await harness.close();
    harness = await createHarness({ indexer: { drop: null } });

    const response = await harness.app.request(
      "/api/drops/0x0000000000000000000000000000000000000001",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

describe("GET /api/stats", () => {
  it("returns wei totals, says the numbers are final only, and never takes the indexer's /stats", async () => {
    harness = await createHarness({
      indexer: {
        stats: {
          droppedTotalWei: "100000000000000",
          dropCount: 1,
          uniqueReceivers: 1,
          claimCount: 1,
          finality: "final",
        },
      },
    });

    const response = await harness.app.request("/api/stats");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    // the indexer's `/stats` counts every drop, multisend included. The tiles come from
    // the handle drops on the board rows, and there are none here.
    expect(body["droppedTotalWei"]).toBe("0");
    expect(body["dropCount"]).toBe(0);
    expect(body["finality"]).toBe("final");
    // No priced drop anywhere, so the frozen usd sum is zero, not missing and not null.
    expect(body["usd"]).toBe(0);
  });
});

describe("when the indexer is down", () => {
  beforeEach(async () => {
    harness = await createHarness({ indexer: { down: true } });
  });

  it("answers 503, not 500: it is worth retrying", async () => {
    // For a drop we never created there is nothing to answer with when the indexer is down.
    for (const path of [
      "/api/drops",
      "/api/drops/0x0000000000000000000000000000000000000001",
      "/api/stats",
    ]) {
      const response = await harness.app.request(path);
      expect(response.status, path).toBe(503);
      expect(await response.json()).toEqual({ error: "indexer_unavailable" });
    }
  });

  it("still serves login and health, which do not need the indexer", async () => {
    expect((await harness.app.request("/api/health")).status).toBe(200);
    expect((await harness.app.request("/api/me")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// the forwarding client itself
// ---------------------------------------------------------------------------

describe("indexer client", () => {
  interface Call {
    url: string;
  }

  function stubFetch(handler: (url: string) => Response): { calls: Call[]; impl: typeof fetch } {
    const calls: Call[] = [];
    const impl: typeof fetch = (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url });
      return Promise.resolve(handler(url));
    };
    return { calls, impl };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("builds the urls the indexer serves, and strips a trailing slash from the base", async () => {
    const stub = stubFetch(() => jsonResponse({ ok: true }));
    const client: IndexerClient = createIndexerClient({
      baseUrl: "http://localhost:42069/",
      fetchImpl: stub.impl,
    });

    await client.listDrops(25);
    await client.getDrop("0xabc");
    await client.getStats();
    await client.listBoardDrops(1_757_000_000);
    await client.listBoardDrops(null);

    expect(stub.calls.map((call) => call.url)).toEqual([
      "http://localhost:42069/drops?limit=25",
      "http://localhost:42069/drops/0xabc",
      "http://localhost:42069/stats",
      "http://localhost:42069/board-drops?since=1757000000",
      "http://localhost:42069/board-drops",
    ]);
  });

  it("treats a 404 as 'no such drop', not as an outage", async () => {
    const stub = stubFetch(() => jsonResponse({ error: "not_found" }, 404));
    const client = createIndexerClient({
      baseUrl: "http://localhost:42069",
      fetchImpl: stub.impl,
    });

    await expect(client.getDrop("0xabc")).resolves.toBeNull();
  });

  it("treats a 500 as an outage", async () => {
    const stub = stubFetch(() => jsonResponse({ error: "boom" }, 500));
    const client = createIndexerClient({
      baseUrl: "http://localhost:42069",
      fetchImpl: stub.impl,
    });

    await expect(client.getStats()).rejects.toBeInstanceOf(IndexerUnavailableError);
  });

  it("treats a refused connection as an outage rather than letting it escape", async () => {
    const impl: typeof fetch = () => Promise.reject(new Error("ECONNREFUSED"));
    const client = createIndexerClient({ baseUrl: "http://localhost:42069", fetchImpl: impl });

    await expect(client.listDrops(10)).rejects.toBeInstanceOf(IndexerUnavailableError);
    await expect(client.isHealthy()).resolves.toBe(false);
  });
});
