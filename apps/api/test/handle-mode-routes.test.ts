/**
 * the routes. Handle mode off means: a handle drop is refused, `503
 * handle_mode_not_ready`, before any paid X lookup; the handle preview is refused the same way
 * when handle mode is off on every chain; `GET /api/chains` says `handleMode` per chain.
 * Multisend is untouched. The rule itself is `handle-mode.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { drops } from "../src/db/schema.js";
import { createFakeChain, evmAdapterFor, type FakeChain } from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV } from "./test-binders.js";

const OTHER_EVM = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const ALICE = { id: "44196397", username: "Alice", name: "alice" };

function evm(ready = true) {
  const chain = createFakeChain();
  const adapter = { ...evmAdapterFor(chain), handleModeReady: () => Promise.resolve(ready) };
  return { chain, adapter };
}

describe("the routes when handle mode is off", () => {
  let harness: Harness;
  afterEach(async () => {
    await harness.close();
  });

  async function signedIn(env: Record<string, string>, setup?: (chain: FakeChain) => void) {
    const { chain, adapter } = evm();
    setup?.(chain);
    harness = await createHarness({
      writeSides: singleAdapter(adapter),
      env: { X_BEARER_TOKEN: "test-bearer", ...env },
      xLookup: [ALICE],
    });
    const { jar } = await login(harness);
    return {
      cookie: cookieHeader(jar),
      [CSRF_HEADER]: jar["dc_csrf"] ?? "",
      "content-type": "application/json",
    };
  }

  const lookups = () => harness.x.calls.filter((call) => call.url.includes("/2/users/by"));
  const createHandle = (headers: Record<string, string>) =>
    harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "handle",
        handles: [{ handle: "alice", amount: "10000000000000" }],
        refundRecipient: REFUND,
      }),
    });
  const resolve = (headers: Record<string, string>) =>
    harness.app.request("/api/handles/resolve", {
      method: "POST",
      headers,
      body: JSON.stringify({ handles: ["alice"] }),
    });

  it("refuses a handle drop with no binder key, before any paid X lookup; multisend still works", async () => {
    const headers = await signedIn({});
    const res = await createHandle(headers);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("handle_mode_not_ready");
    expect(lookups()).toHaveLength(0);
    expect(await harness.deps.db.select().from(drops)).toHaveLength(0);

    const multisend = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "address",
        receivers: [{ address: A, amount: "10000000000000" }],
        refundRecipient: REFUND,
      }),
    });
    expect(multisend.status).toBe(201);
  });

  it("refuses a handle drop when the binder on chain is not our key", async () => {
    const headers = await signedIn(TEST_BINDER_ENV, (chain) => chain.setBinderAddress(OTHER_EVM));
    const res = await createHandle(headers);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("handle_mode_not_ready");
    expect(lookups()).toHaveLength(0);
  });

  it("makes the handle drop when handle mode is on", async () => {
    const headers = await signedIn(TEST_BINDER_ENV);
    expect((await createHandle(headers)).status).toBe(201);
  });

  it("refuses the handle preview when handle mode is off on every chain, and spends nothing", async () => {
    const headers = await signedIn({});
    const res = await resolve(headers);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "handle_mode_not_ready" });
    expect(lookups()).toHaveLength(0);
  });

  it("serves the handle preview when handle mode is on for a chain", async () => {
    const headers = await signedIn(TEST_BINDER_ENV);
    expect((await resolve(headers)).status).toBe(200);
    expect(lookups()).toHaveLength(1);
  });

  it("GET /api/chains says handleMode per chain", async () => {
    await signedIn({});
    let body = (await (await harness.app.request("/api/chains")).json()) as {
      chains: { key: string; handleMode: boolean }[];
    };
    expect(body.chains.map((c) => [c.key, c.handleMode])).toEqual([["robinhood-testnet", false]]);

    await harness.close();
    await signedIn(TEST_BINDER_ENV);
    body = (await (await harness.app.request("/api/chains")).json()) as typeof body;
    expect(body.chains.map((c) => [c.key, c.handleMode])).toEqual([["robinhood-testnet", true]]);
  });
});
