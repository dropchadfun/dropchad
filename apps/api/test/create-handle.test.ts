/**
 * `POST /api/drops` with `mode`.
 * - `mode` is required: `handle` takes `@handle amount` lines, `address` is the multisend path
 * - every handle must resolve, or the whole drop is refused and the misses are listed
 * - the sender's own X account is refused in a handle drop
 * - a handle drop is refused until the chain is handle ready: `DropFactoryV2` recorded on the
 *   EVM, a live binder in `Config` on Solana
 * - the handle tree, the version 2 manifest, `mode = 'handle'` and one leaf row per X id
 * - the Solana decoder reads `Config` at 116 and 253 bytes and `Drop` at 360 and 424
 */
import { keccak256, toHex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { singleAdapter } from "../src/chain/adapter.js";
import { accountDiscriminator, decodeConfig, decodeDrop } from "../src/chain/svm/accounts.js";
import { DROPCHAD_PROGRAM_ID } from "../src/chain/svm/pubkey.js";
import { dropHandleLeaves, drops } from "../src/db/schema.js";
import { createFakeChain, evmAdapterFor } from "./fake-chain.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";
import { TEST_BINDER_ENV } from "./test-binders.js";

const REFUND = "0xdddddDDddDdDdddddDdDdDDdDDdDddDdDdDdddDD";
const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const ALICE = {
  id: "44196397",
  username: "Alice",
  name: "alice",
  profile_image_url: "https://pbs.twimg.com/a.png",
};
const BOB = { id: "1600000000000000000", username: "bob_2", name: "Bob" };
/** The signed in user of the harness X stub. */
const SELF = { id: "1234567890", username: "dropchadfun", name: "dropchad" };

let harness: Harness;

afterEach(async () => {
  await harness.close();
});

async function signedIn(ready: boolean): Promise<Record<string, string>> {
  const base = evmAdapterFor(createFakeChain());
  const adapter = { ...base, handleModeReady: () => Promise.resolve(ready) };
  harness = await createHarness({
    writeSides: singleAdapter(adapter),
    // Handle mode needs our binder key and the same binder on chain.
    env: { X_BEARER_TOKEN: "test-bearer", ...TEST_BINDER_ENV },
    xLookup: [ALICE, BOB, SELF],
  });
  const { jar } = await login(harness);
  return {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
}

const post = (headers: Record<string, string>, body: unknown) =>
  harness.app.request("/api/drops", { method: "POST", headers, body: JSON.stringify(body) });

const handleBody = (handles: { handle: string; amount: string }[]) => ({
  mode: "handle",
  handles,
  refundRecipient: REFUND,
});

describe("POST /api/drops, the mode", () => {
  it("refuses a body with no mode", async () => {
    const headers = await signedIn(true);
    const res = await post(headers, {
      receivers: [{ address: A, amount: "1" }],
      refundRecipient: REFUND,
    });
    expect(res.status).toBe(400);
    expect(await harness.deps.db.select().from(drops)).toHaveLength(0);
  });

  it("refuses handle mode with address lines, and address mode with handles", async () => {
    const headers = await signedIn(true);
    expect(
      (
        await post(headers, {
          mode: "handle",
          receivers: [{ address: A, amount: "1" }],
          refundRecipient: REFUND,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(headers, {
          mode: "address",
          handles: [{ handle: "alice", amount: "1" }],
          refundRecipient: REFUND,
        })
      ).status,
    ).toBe(400);
  });

  it("an address drop is unchanged and stored as mode address", async () => {
    const headers = await signedIn(true);
    const res = await post(headers, {
      mode: "address",
      receivers: [{ address: A, amount: "10000000000000" }],
      refundRecipient: REFUND,
    });
    expect(res.status).toBe(201);
    const [row] = await harness.deps.db.select().from(drops);
    expect(row?.mode).toBe("address");
    expect(row?.manifestJson.startsWith('{"version":1,')).toBe(true);
  });
});

describe("POST /api/drops, a handle drop", () => {
  it("resolves, builds the handle tree, stores mode handle, the v2 manifest and one leaf per X id", async () => {
    const headers = await signedIn(true);
    const res = await post(
      headers,
      handleBody([
        { handle: "bob_2", amount: "30000000000000" },
        { handle: "@Alice", amount: "10000000000000" },
        { handle: "alice", amount: "5000000000000" },
      ]),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      drop: { leafCount: number; totalEntitlementsWei: string; mode: string };
    };
    expect(body.drop.mode).toBe("handle");
    expect(body.drop.leafCount).toBe(2);
    expect(body.drop.totalEntitlementsWei).toBe("45000000000000");

    const [row] = await harness.deps.db.select().from(drops);
    expect(row?.mode).toBe("handle");
    expect(row?.manifestJson.startsWith('{"version":2,"mode":"handle",')).toBe(true);
    expect(row?.manifestHash).toBe(keccak256(toHex(row?.manifestJson ?? "")));
    expect(row?.manifestJson).not.toContain("alice");

    const leaves = await harness.deps.db.select().from(dropHandleLeaves);
    // Sorted by X id ascending: alice's id is the smaller.
    expect(leaves.map((l) => [l.leafIndex, l.xUserId, l.amount])).toEqual([
      [0, ALICE.id, "15000000000000"],
      [1, BOB.id, "30000000000000"],
    ]);
  });

  it("A: one unknown handle refuses the whole drop and lists every miss", async () => {
    const headers = await signedIn(true);
    const res = await post(
      headers,
      handleBody([
        { handle: "alice", amount: "1" },
        { handle: "ghost", amount: "1" },
        { handle: "nobody_here", amount: "1" },
      ]),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "handles_not_found",
      handles: ["ghost", "nobody_here"],
    });
    expect(await harness.deps.db.select().from(drops)).toHaveLength(0);
  });

  it("B: the sender's own X account is refused", async () => {
    const headers = await signedIn(true);
    const res = await post(
      headers,
      handleBody([
        { handle: "alice", amount: "1" },
        { handle: "@DropChadFun", amount: "1" },
      ]),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("own_handle");
    expect(await harness.deps.db.select().from(drops)).toHaveLength(0);
  });

  it("is refused while the chain is not handle ready", async () => {
    const headers = await signedIn(false);
    const res = await post(headers, handleBody([{ handle: "alice", amount: "1" }]));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("handle_mode_not_ready");
  });

  it("refuses more than 500 handles and a bad handle, before any drop", async () => {
    const headers = await signedIn(true);
    const many = Array.from({ length: 501 }, (_, i) => ({ handle: `h${String(i)}`, amount: "1" }));
    const tooMany = await post(headers, handleBody(many));
    expect(tooMany.status).toBe(400);
    expect(((await tooMany.json()) as { error: string }).error).toBe("too_many");

    const bad = await post(headers, handleBody([{ handle: "not a handle", amount: "1" }]));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad_handle", handles: ["not a handle"] });
  });
});

describe("the Solana decoder reads both layouts. finding", () => {
  function account(name: "Config" | "Drop", size: number, fill: (data: Uint8Array) => void) {
    const data = new Uint8Array(size);
    data.set(accountDiscriminator(name), 0);
    fill(data);
    return { owner: DROPCHAD_PROGRAM_ID, lamports: 1n, data, executable: false };
  }

  it("Config at 116 bytes: no handle fields", () => {
    const cfg = decodeConfig(
      account("Config", 116, (d) => {
        d[104] = 100;
      }),
    );
    expect(cfg.defaultFeeBps).toBe(100);
    expect(cfg.handle).toBeNull();
  });

  it("Config at 253 bytes: the binder, the revoke flag, the guardian and the minimum fee", () => {
    const cfg = decodeConfig(
      account("Config", 253, (d) => {
        d[104] = 100;
        d.fill(7, 116, 148); // binder
        d[148] = 1; // revoked
        d.fill(9, 149, 181); // guardian
        d[181] = 0x40; // min fee, u64 little endian: 0x...4b40 would be 19264
        d[182] = 0x4b;
      }),
    );
    expect(cfg.defaultFeeBps).toBe(100);
    expect(cfg.handle?.binderRevoked).toBe(true);
    expect(cfg.handle?.binder[0]).toBe(7);
    expect(cfg.handle?.guardian[0]).toBe(9);
    expect(cfg.handle?.minFeeLamports).toBe(0x4b40n);
  });

  it("refuses any other Config size", () => {
    expect(() => decodeConfig(account("Config", 200, () => {}))).toThrow(/bytes/);
  });

  it("Drop at 360 and at 424 bytes, and nothing else", () => {
    expect(() => decodeDrop(account("Drop", 360, () => {}))).not.toThrow();
    expect(() => decodeDrop(account("Drop", 424, () => {}))).not.toThrow();
    expect(() => decodeDrop(account("Drop", 400, () => {}))).toThrow(/bytes/);
  });
});
