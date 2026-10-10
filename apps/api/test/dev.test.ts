/**
 * `/api/dev/proof` — the dev only proof page.
 *
 * What matters here is that it does not exist outside local development. In production, in test,
 * and on any host but localhost the answer is the same 404 an unknown route gives.
 */
import { afterEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "./harness.js";

let harness: Harness;

afterEach(async () => {
  await harness.close();
});

describe("GET /api/dev/proof", () => {
  it("is a 404 in production, even on localhost", async () => {
    harness = await createHarness({ env: { NODE_ENV: "production" } });
    const response = await harness.app.request("http://localhost:3000/api/dev/proof");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("is a 404 in test", async () => {
    harness = await createHarness();
    const response = await harness.app.request("http://localhost:3000/api/dev/proof");
    expect(response.status).toBe(404);
  });

  it("is a 404 in development on any host but localhost", async () => {
    harness = await createHarness({ env: { NODE_ENV: "development" } });
    const response = await harness.app.request("http://api.dropchad.com/api/dev/proof");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("serves the page in development on localhost", async () => {
    harness = await createHarness({ env: { NODE_ENV: "development" } });
    const response = await harness.app.request("http://localhost:3000/api/dev/proof");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("create drop");
    expect(html).toContain("0x1111111111111111111111111111111111110001 100000000000000");
    expect(html).toContain("0x3333333333333333333333333333333333330003 100000000000000");
    expect(html).toContain('value="0x4F1E2b8e5F1C0EB9e01f0d420F6Cf324d9de9E8B"');
    expect(html).toContain('"x-dropchad-csrf"');
    expect(html).toContain("/live");
  });
});
