/**
 * `POST /api/drops` and `GET /api/drops/:address/manifest`.
 *
 * The chain is the fake factory in `test/fake-chain.ts`, which recomputes the salt and the CREATE2
 * address for real and emits a real `DropCreated` log. So these tests exercise the api's own
 * address prediction, its event decoding and its refusal to trust a chain that disagrees with it.
 */
import { getAddress, keccak256, toHex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { computeSalt, creatorCommitment } from "../src/chain/predict.js";
import { CSRF_HEADER } from "../src/auth/session.js";
import { dropJobs, drops } from "../src/db/schema.js";
import {
  FAKE_CHAIN_ID,
  FAKE_FACTORY,
  FAKE_RELAYER,
  createFakeChain,
  type FakeChain,
} from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xBbBbBBBbbBBBbbBbbBbbbbbBBbBbbbbBbBbbBBbB";
const C = "0xCcCcCCCcCCCCcCCCCCcCcCccCcCCCcCcccccCCcC";
const REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";

/** The stubbed X user in `harness.ts`. */
const X_USER_ID = 1234567890n;

async function signedIn(
  chain?: FakeChain,
  randomBlind?: () => `0x${string}`,
): Promise<{
  harness: Harness;
  chain: FakeChain;
  headers: Record<string, string>;
}> {
  const fake = chain ?? createFakeChain();
  const harness = await createHarness({
    writeSide: { chain: fake, chainName: "Robinhood Chain Testnet" },
    ...(randomBlind === undefined ? {} : { randomBlind }),
  });
  const { jar } = await login(harness);
  return {
    harness,
    chain: fake,
    headers: {
      cookie: cookieHeader(jar),
      [CSRF_HEADER]: jar["dc_csrf"] ?? "",
      "content-type": "application/json",
    },
  };
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    mode: "address",
    receivers: [
      { address: A, amount: "100000000000000" },
      { address: B, amount: "100000000000000" },
      { address: C, amount: "100000000000000" },
    ],
    refundRecipient: REFUND,
    ...overrides,
  });
}

describe("POST /api/drops, before it gets anywhere near the chain", () => {
  it("answers 503 when there is no relayer key", async () => {
    const harness = await createHarness();
    const { jar } = await login(harness);
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers: {
        cookie: cookieHeader(jar),
        [CSRF_HEADER]: jar["dc_csrf"] ?? "",
        "content-type": "application/json",
      },
      body: body(),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "relayer_not_configured" });
    await harness.close();
  });

  it("answers 401 when nobody is signed in", async () => {
    const harness = await createHarness({
      writeSide: { chain: createFakeChain(), chainName: "Robinhood Chain Testnet" },
    });
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(),
    });
    expect(response.status).toBe(401);
    await harness.close();
  });

  it("answers 403 without a CSRF header", async () => {
    const { harness, headers } = await signedIn();
    const { [CSRF_HEADER]: _dropped, ...withoutCsrf } = headers;
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers: withoutCsrf,
      body: body(),
    });
    expect(response.status).toBe(403);
    await harness.close();
  });

  it("answers 403 when the CSRF token is somebody else's", async () => {
    const { harness, headers } = await signedIn();
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers: { ...headers, [CSRF_HEADER]: "a".repeat(43) },
      body: body(),
    });
    expect(response.status).toBe(403);
    await harness.close();
  });
});

describe("POST /api/drops, the body", () => {
  let harness: Harness;
  let headers: Record<string, string>;

  beforeEach(async () => {
    ({ harness, headers } = await signedIn());
    return () => harness.close();
  });

  it("refuses a receiver that is not an address", async () => {
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ receivers: [{ address: "not-an-address", amount: "1" }] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_body" });
  });

  it("refuses a zero amount", async () => {
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ receivers: [{ address: A, amount: "0" }] }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses an amount that is not whole wei", async () => {
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ receivers: [{ address: A, amount: "0.5" }] }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses more than MAX_LEAVES receivers", async () => {
    const receivers = Array.from({ length: 10_001 }, () => ({ address: A, amount: "1" }));
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ receivers }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses a title over 80 characters", async () => {
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ title: "x".repeat(81) }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses an http meme image url", async () => {
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ memeImageUrl: "http://example.com/a.png" }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses a body that is not json", async () => {
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: "not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_json" });
  });

  it("refuses an asset that is not native, because ERC20 drops are blocked on", async () => {
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ asset: "erc20" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("POST /api/drops, the happy path", () => {
  it("creates the drop, returns funding instructions, and writes one row and one job", async () => {
    const { harness, chain, headers } = await signedIn();

    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({ title: "gm trenches", memeImageUrl: "https://example.com/chad.png" }),
    });
    expect(response.status).toBe(201);

    const payload = (await response.json()) as {
      drop: Record<string, unknown>;
      funding: Record<string, unknown>;
      warnings: string[];
    };

    const address = payload.drop["address"] as string;
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(payload.drop["chainId"]).toBe(FAKE_CHAIN_ID);
    expect(payload.drop["leafCount"]).toBe(3);
    expect(payload.drop["totalEntitlementsWei"]).toBe("300000000000000");
    // v1 runs at zero fee, so gross equals the entitlements.
    expect(payload.drop["grossRequiredWei"]).toBe("300000000000000");
    expect(payload.drop["title"]).toBe("gm trenches");

    // EIP 681, with the chain id pinned so a wallet cannot send on the wrong chain.
    expect(payload.funding["paymentUri"]).toBe(`ethereum:${address}@46630?value=300000000000000`);
    expect(payload.funding["address"]).toBe(address);
    expect(payload.funding["amountEth"]).toBe("0.0003");

    // The refund warning has to name the address and say the exchange thing out loud.
    // Checksummed, because that is the form the api hands back and the form a user copies.
    expect(payload.warnings.join(" ")).toContain(getAddress(REFUND));
    expect(payload.warnings.join(" ").toLowerCase()).toContain("exchange");

    // The address the api predicted is the address the factory deployed.
    expect(chain.creates).toHaveLength(1);

    const rows = await harness.deps.db.select().from(drops);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.address).toBe(address.toLowerCase());
    expect(rows[0]?.state).toBe("created");
    expect(rows[0]?.xUserId).toBe("1234567890");
    expect(rows[0]?.memeImageUrl).toBe("https://example.com/chad.png");

    const jobs = await harness.deps.db.select().from(dropJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe("watch_funding");
    expect(jobs[0]?.state).toBe("ready");

    await harness.close();
  });

  it("merges a duplicated address into one leaf", async () => {
    const { harness, headers } = await signedIn();
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body({
        receivers: [
          { address: A, amount: "10000000000000" },
          { address: A.toLowerCase(), amount: "20000000000000" },
          { address: B, amount: "30000000000000" },
        ],
      }),
    });
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { drop: Record<string, unknown> };
    // two lines for one address become one leaf with the amounts added.
    expect(payload.drop["leafCount"]).toBe(2);
    expect(payload.drop["totalEntitlementsWei"]).toBe("60000000000000");
    await harness.close();
  });

  it("moves the nonce forward when the salt is already used on chain", async () => {
    // This is the case where our database was wiped but the chain remembers. The
    // blind is fixed here so the test can know the taken salt; one blind per drop
    // so the retry at nonce 1 keeps it.
    const blind = `0x${"b1".repeat(32)}` as const;
    const takenSalt = computeSalt({
      chainId: FAKE_CHAIN_ID,
      factory: FAKE_FACTORY,
      creator: FAKE_RELAYER,
      creatorCommitment: creatorCommitment(X_USER_ID, 0n, blind),
      nonce: 0n,
    });
    const chain = createFakeChain({ usedSalts: [takenSalt] });
    const { harness, headers } = await signedIn(chain, () => blind);

    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(response.status).toBe(201);
    expect(chain.creates[0]?.nonce).toBe(1n);
    expect(chain.creates[0]?.creatorCommitment).toBe(creatorCommitment(X_USER_ID, 1n, blind));
    await harness.close();
  });

  it("gives each drop of the same creator its own address", async () => {
    const { harness, headers } = await signedIn();
    const first = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    const second = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    const one = (await first.json()) as { drop: { address: string } };
    const two = (await second.json()) as { drop: { address: string } };
    expect(one.drop.address).not.toBe(two.drop.address);
    await harness.close();
  });
});

describe("the create rate limit", () => {
  it("allows five drops an hour and refuses the sixth", async () => {
    const { harness, headers } = await signedIn();

    for (let i = 0; i < 5; i += 1) {
      const ok = await harness.app.request("/api/drops", { method: "POST", headers, body: body() });
      expect(ok.status).toBe(201);
    }

    const sixth = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toBe("3600");
    expect(await sixth.json()).toMatchObject({ error: "rate_limited" });

    await harness.close();
  });

  it("lets the same creator through again once the hour has passed", async () => {
    const { harness, headers } = await signedIn();
    for (let i = 0; i < 5; i += 1) {
      await harness.app.request("/api/drops", { method: "POST", headers, body: body() });
    }
    expect(
      (await harness.app.request("/api/drops", { method: "POST", headers, body: body() })).status,
    ).toBe(429);

    harness.setNow(new Date("2026-09-09T02:00:00.000Z"));
    expect(
      (await harness.app.request("/api/drops", { method: "POST", headers, body: body() })).status,
    ).toBe(201);

    await harness.close();
  });
});

describe("when the chain does not agree", () => {
  it("refuses to write a row when DropCreated names another address", async () => {
    const chain = createFakeChain({
      tamperEvent: (event) => ({
        ...event,
        drop: "0x000000000000000000000000000000000000dead",
      }),
    });
    const { harness, headers } = await signedIn(chain);
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "chain_disagreed" });
    // Nothing was written. A sender must never be shown an address the chain did not confirm.
    expect(await harness.deps.db.select().from(drops)).toHaveLength(0);
    await harness.close();
  });

  it("refuses when DropCreated carries a different merkle root", async () => {
    const chain = createFakeChain({
      tamperEvent: (event) => ({ ...event, merkleRoot: `0x${"99".repeat(32)}` }),
    });
    const { harness, headers } = await signedIn(chain);
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(response.status).toBe(500);
    expect(await harness.deps.db.select().from(drops)).toHaveLength(0);
    await harness.close();
  });

  it("refuses when DropCreated carries a different manifest hash", async () => {
    const chain = createFakeChain({
      tamperEvent: (event) => ({ ...event, manifestHash: `0x${"98".repeat(32)}` }),
    });
    const { harness, headers } = await signedIn(chain);
    const response = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(response.status).toBe(500);
    await harness.close();
  });
});

describe("GET /api/drops/:address/manifest", () => {
  it("serves the exact bytes the manifest hash was taken over", async () => {
    const { harness, headers } = await signedIn();
    const created = await harness.app.request("/api/drops", {
      method: "POST",
      headers,
      body: body(),
    });
    const payload = (await created.json()) as { drop: { address: string; manifestHash: string } };

    const response = await harness.app.request(
      `/api/drops/${payload.drop.address.toLowerCase()}/manifest`,
    );
    expect(response.status).toBe(200);

    const text = await response.text();
    // This is the whole point of: anybody can hash the body themselves and get the number
    // that is stored in the drop. No envelope, no reformatting.
    expect(keccak256(toHex(text))).toBe(payload.drop.manifestHash);
    expect(response.headers.get("x-dropchad-manifest-hash")).toBe(payload.drop.manifestHash);

    const manifest = JSON.parse(text) as { entries: unknown[]; drop: string; leafCount: number };
    expect(manifest.entries).toHaveLength(3);
    expect(manifest.leafCount).toBe(3);
    expect(manifest.drop.toLowerCase()).toBe(payload.drop.address.toLowerCase());

    await harness.close();
  });

  it("is a 404 for a drop we did not create", async () => {
    const { harness } = await signedIn();
    const response = await harness.app.request(
      "/api/drops/0x000000000000000000000000000000000000dead/manifest",
    );
    expect(response.status).toBe(404);
    await harness.close();
  });

  it("is a 400 for a junk address", async () => {
    const { harness } = await signedIn();
    const response = await harness.app.request("/api/drops/nope/manifest");
    expect(response.status).toBe(400);
    await harness.close();
  });
});
