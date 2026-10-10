/**
 * the login return path is an allowlist. A receiver who
 * signs in from `/claim` lands back on `/claim`, and a stale login refreshed from one drop lands
 * back on that drop. Nothing else is kept: no open redirect.
 *
 * `next` is stored in the OAuth state row at start, so it cannot be swapped between start and
 * callback; the callback reads it only from that row.
 */
import { afterEach, describe, expect, it } from "vitest";

import { oauthStates } from "../src/db/schema.js";
import { cookieHeader, cookiesFrom, createHarness, type Harness } from "./harness.js";

const EVM_DROP = "0x00000000000000000000000000000000000d0b01";
const SOL_DROP = "9ArT5gUTfmD81oKeNL66RhcWrK9nuaoxuJV2wH7QT9Ra";

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Start with `next`, then the callback; the `location` the browser is sent to at the end. */
async function loginWith(next: string | null, callbackExtra = ""): Promise<string> {
  const h = await createHarness();
  harness = h;
  const start = await h.app.request(
    next === null ? "/api/auth/x/start" : `/api/auth/x/start?next=${encodeURIComponent(next)}`,
  );
  expect(start.status).toBe(302);
  const jar = cookiesFrom(start);
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const callback = await h.app.request(
    `/api/auth/x/callback?code=auth-code-1&state=${encodeURIComponent(state)}${callbackExtra}`,
    { headers: { cookie: cookieHeader(jar) } },
  );
  expect(callback.status).toBe(302);
  return callback.headers.get("location") ?? "";
}

describe("the login comes back to /claim", () => {
  it("next=/claim lands on /claim", async () => {
    expect(await loginWith("/claim")).toBe("http://localhost:3000/claim?login=ok");
  });

  it("next=/claim?drop=<evm address> lands on that drop", async () => {
    expect(await loginWith(`/claim?drop=${EVM_DROP}`)).toBe(
      `http://localhost:3000/claim?drop=${EVM_DROP}&login=ok`,
    );
  });

  it("next=/claim?drop=<solana address> lands on that drop, case kept", async () => {
    expect(await loginWith(`/claim?drop=${SOL_DROP}`)).toBe(
      `http://localhost:3000/claim?drop=${SOL_DROP}&login=ok`,
    );
  });

  it("no next is the front page, as before", async () => {
    expect(await loginWith(null)).toBe("http://localhost:3000/?login=ok");
  });
});

describe("anything else falls back to the front page", () => {
  const BAD = [
    "//evil.example/claim",
    "https://evil.example/claim",
    "/\\evil.example",
    "javascript:alert(1)",
    "/claimx",
    "/claim/",
    "/claim/../u/x",
    "/claim?drop=<script>",
    `/claim?drop=${EVM_DROP}&next=//evil.example`,
    `/claim?drop=${EVM_DROP}#x`,
    "/d/0x00000000000000000000000000000000000d0b01",
    "/create",
    "/claim?drop=0x123",
    "",
  ];
  for (const bad of BAD) {
    it(`next=${JSON.stringify(bad)} goes to /`, async () => {
      expect(await loginWith(bad)).toBe("http://localhost:3000/?login=ok");
    });
  }
});

describe("next lives in the state row", () => {
  it("is written at start with the state, and a next on the callback is ignored", async () => {
    const h = await createHarness();
    harness = h;
    const start = await h.app.request("/api/auth/x/start?next=%2Fclaim");
    const rows = await h.deps.db.select().from(oauthStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nextPath).toBe("/claim");

    const jar = cookiesFrom(start);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const callback = await h.app.request(
      `/api/auth/x/callback?code=auth-code-1&state=${encodeURIComponent(state)}&next=${encodeURIComponent("//evil.example")}`,
      { headers: { cookie: cookieHeader(jar) } },
    );
    expect(callback.headers.get("location")).toBe("http://localhost:3000/claim?login=ok");
  });

  it("a bad next is never written", async () => {
    const h = await createHarness();
    harness = h;
    await h.app.request(`/api/auth/x/start?next=${encodeURIComponent("//evil.example")}`);
    const rows = await h.deps.db.select().from(oauthStates);
    expect(rows[0]?.nextPath).toBeNull();
  });
});
