/**
 * The waiting drops limit of `POST /api/drops`: at most 2 drops per X id
 * waiting for funding, both chains and both modes together, running creates included.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, createSession } from "../src/auth/session.js";
import { SESSION_TTL_SECONDS, WAITING_DROPS_MAX } from "../src/config.js";
import { drops } from "../src/db/schema.js";
import { createFakeChain, type FakeChain } from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB";
const REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";

const START = new Date("2026-09-09T00:00:00.000Z");

function body(): string {
  return JSON.stringify({
    mode: "address",
    receivers: [
      { address: A, amount: "100000000000000" },
      { address: B, amount: "100000000000000" },
    ],
    refundRecipient: REFUND,
  });
}

/** A fake chain whose `createDrop` takes a while, so parallel creates overlap. */
function slowChain(): FakeChain {
  const chain = createFakeChain();
  const send = chain.createDrop.bind(chain);
  return Object.assign(chain, {
    createDrop: async (params: Parameters<FakeChain["createDrop"]>[0]) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return send(params);
    },
  });
}

async function signedIn(chain: FakeChain = createFakeChain()): Promise<{
  harness: Harness;
  chain: FakeChain;
  headers: Record<string, string>;
}> {
  const harness = await createHarness({
    writeSide: { chain, chainName: "Robinhood Chain Testnet" },
  });
  const { jar } = await login(harness);
  return {
    harness,
    chain,
    headers: {
      cookie: cookieHeader(jar),
      [CSRF_HEADER]: jar["dc_csrf"] ?? "",
      "content-type": "application/json",
    },
  };
}

async function secondUser(harness: Harness): Promise<Record<string, string>> {
  const session = await createSession(harness.handle.db, {
    secret: harness.config.SESSION_SECRET,
    user: { id: "987654321", username: "otherchad", name: "other", profileImageUrl: null },
    ttlSeconds: SESSION_TTL_SECONDS,
    now: START,
  });
  return {
    cookie: `${SESSION_COOKIE}=${session.sessionId}; ${CSRF_COOKIE}=${session.csrfToken}`,
    [CSRF_HEADER]: session.csrfToken,
    "content-type": "application/json",
  };
}

const post = (harness: Harness, headers: Record<string, string>) =>
  harness.app.request("/api/drops", { method: "POST", headers, body: body() });

describe("the waiting drops limit", () => {
  it("is 2, one constant in the api config", () => {
    expect(WAITING_DROPS_MAX).toBe(2);
  });

  it("refuses a third create while 2 drops wait for funding, before the chain", async () => {
    const { harness, chain, headers } = await signedIn();
    expect((await post(harness, headers)).status).toBe(201);
    expect((await post(harness, headers)).status).toBe(201);

    const third = await post(harness, headers);
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: "too_many_waiting", max: 2 });
    expect(chain.creates).toHaveLength(2);
    expect(await harness.handle.db.select().from(drops)).toHaveLength(2);
    await harness.close();
  });

  it("a funded drop not live yet still counts as waiting", async () => {
    const { harness, headers } = await signedIn();
    await post(harness, headers);
    await post(harness, headers);
    await harness.handle.db.update(drops).set({ state: "funded" });
    expect((await post(harness, headers)).status).toBe(409);
    await harness.close();
  });

  it("a drop that went live frees its place", async () => {
    const { harness, headers } = await signedIn();
    await post(harness, headers);
    await post(harness, headers);
    const [first] = await harness.handle.db.select().from(drops).limit(1);
    await harness.handle.db
      .update(drops)
      .set({ state: "active" })
      .where(eq(drops.address, first?.address ?? ""));
    expect((await post(harness, headers)).status).toBe(201);
    expect((await post(harness, headers)).status).toBe(409);
    await harness.close();
  });

  it("a drop past its funding deadline no longer counts, even before the worker moves it", async () => {
    const { harness, headers } = await signedIn();
    await post(harness, headers);
    await post(harness, headers);
    // The fake chain gives every drop one fixed deadline; put it one hour after the test clock.
    const deadline = START.getTime() / 1000 + 3600;
    await harness.handle.db.update(drops).set({ fundingDeadline: BigInt(deadline) });

    // At the deadline the drop can still be funded: it still waits.
    harness.setNow(new Date(deadline * 1000));
    expect((await post(harness, headers)).status).toBe(409);

    harness.setNow(new Date((deadline + 1) * 1000));
    expect((await post(harness, headers)).status).toBe(201);
    await harness.close();
  });

  it("counts both chains and both modes together", async () => {
    const { harness, headers } = await signedIn();
    await post(harness, headers);
    // The one drop becomes a Solana handle drop; it still waits for this X id.
    await harness.handle.db.update(drops).set({ chainKey: "solana-devnet", mode: "handle" });
    expect((await post(harness, headers)).status).toBe(201);
    expect((await post(harness, headers)).status).toBe(409);
    await harness.close();
  });

  it("parallel creates for one X id pass at most 2", async () => {
    const { harness, chain, headers } = await signedIn(slowChain());
    const statuses = (
      await Promise.all(Array.from({ length: 6 }, async () => post(harness, headers)))
    ).map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(chain.creates).toHaveLength(2);
    await harness.close();
  });

  it("another X id is not blocked by the first one's waiting drops", async () => {
    const { harness, headers } = await signedIn();
    const other = await secondUser(harness);
    await post(harness, headers);
    await post(harness, headers);
    expect((await post(harness, headers)).status).toBe(409);
    expect((await post(harness, other)).status).toBe(201);
    await harness.close();
  });
});
