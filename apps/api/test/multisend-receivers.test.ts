/**
 * Who sees a multisend's receivers, option B
 *
 * - `GET /api/drops/:address/manifest` of a multisend: the exact bytes to its sender only,
 *   `403 manifest_private` to everyone else. A handle drop's manifest stays public.
 * - `GET /api/drops/:address` of a multisend carries `receivers`: every `{ index, recipient,
 *   amount }` for the sender; only the indexes the chain says are claimed for everyone else.
 *   `manifestUrl` is `null` unless `yours`. A handle drop carries no `receivers`.
 *
 * Paid is the chain's word, as for `fed`: our own `paidCount` and `failedIndexes` never show a
 * row to a stranger.
 */
import { keccak256, toHex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { drops, profiles } from "../src/db/schema.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

let harness: Harness;

// The harness X stub signs in as this account, `createXStub`.
const ME = { xUserId: "1234567890", handle: "dropchadfun" };
const OTHER = { xUserId: "777000111222", handle: "someoneelse" };

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const MY_MULTISEND = addr(0x701);
const OTHER_HANDLE_DROP = addr(0x702);
const WALLETS = [addr(0xa1), addr(0xa2), addr(0xa3)];

const manifestOf = (address: string) =>
  JSON.stringify({
    version: 1,
    drop: address,
    chainId: 46630,
    root: `0x${"33".repeat(32)}`,
    totalEntitlements: "60",
    leafCount: 3,
    entries: WALLETS.map((recipient, index) => ({
      index,
      recipient,
      amount: String((index + 1) * 10),
      proof: [`0x${"99".repeat(32)}`],
    })),
  });

const row = (address: string, xUserId: string, mode: "address" | "handle") => {
  const manifestJson = manifestOf(address);
  return {
    address,
    mode,
    chainId: 46630,
    chainKey: "robinhood-testnet",
    xUserId,
    nonce: BigInt(Number.parseInt(address.slice(-3), 16)),
    creatorCommitment: `0x${address.slice(-3).padStart(64, "0")}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: keccak256(toHex(manifestJson)),
    manifestJson,
    totalEntitlements: "60",
    feeAmount: "0",
    grossRequired: "60",
    leafCount: 3,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 604_800,
    state: "paying",
    // Our own word says 2 paid and 1 failed; only the chain's claims may show a row.
    paidCount: 2,
    failedIndexes: [2],
    createTxHash: `0x${"55".repeat(32)}`,
  };
};

/** The chain says index 1 is claimed, and nothing else. */
async function world(claims: { index: number }[] = [{ index: 1 }]): Promise<void> {
  harness = await createHarness({
    indexer: {
      dropsByAddress: { [MY_MULTISEND]: { address: MY_MULTISEND } },
      claimsByAddress: {
        [MY_MULTISEND]: claims.map((claim) => ({
          ...claim,
          recipient: WALLETS[claim.index],
          transactionHash: `0x${"77".repeat(32)}`,
        })),
      },
    },
  });
  await harness.deps.db.insert(profiles).values([
    { xUserId: OTHER.xUserId, handle: OTHER.handle, displayName: "Other", profileImageUrl: null },
    { xUserId: ME.xUserId, handle: ME.handle, displayName: "dropchad", profileImageUrl: null },
  ]);
  await harness.deps.db
    .insert(drops)
    .values([
      row(MY_MULTISEND, ME.xUserId, "address"),
      row(OTHER_HANDLE_DROP, OTHER.xUserId, "handle"),
    ]);
}
afterEach(() => harness.close());

async function signedIn(): Promise<string> {
  const { jar } = await login(harness);
  return cookieHeader(jar);
}

const get = (path: string, cookie?: string) =>
  harness.app.request(path, { headers: cookie === undefined ? {} : { cookie } });

interface Detail {
  ours: {
    data: {
      yours: boolean;
      manifestUrl: string | null;
      receivers?: { index: number; recipient: string; amount: string }[] | null;
    };
  };
}

describe("GET /api/drops/:address/manifest, a multisend", () => {
  it("signed out: 403 manifest_private, no list", async () => {
    await world();
    const res = await get(`/api/drops/${MY_MULTISEND}/manifest`);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "manifest_private" });
    for (const wallet of WALLETS) expect(text.toLowerCase()).not.toContain(wallet.slice(2));
  });

  it("the sender: the exact bytes, the hash checks", async () => {
    await world();
    const res = await get(`/api/drops/${MY_MULTISEND}/manifest`, await signedIn());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(manifestOf(MY_MULTISEND));
    expect(keccak256(toHex(text))).toBe(res.headers.get("x-dropchad-manifest-hash"));
  });

  it("a handle drop's manifest stays public", async () => {
    await world();
    expect((await get(`/api/drops/${OTHER_HANDLE_DROP}/manifest`)).status).toBe(200);
  });
});

describe("GET /api/drops/:address, the receivers of a multisend", () => {
  it("the sender gets every row, without proofs, and the manifest link", async () => {
    await world();
    const body = (await (
      await get(`/api/drops/${MY_MULTISEND}`, await signedIn())
    ).json()) as Detail;
    expect(body.ours.data.yours).toBe(true);
    expect(body.ours.data.manifestUrl).toBe(`/api/drops/${MY_MULTISEND}/manifest`);
    expect(body.ours.data.receivers).toEqual([
      { index: 0, recipient: WALLETS[0], amount: "10" },
      { index: 1, recipient: WALLETS[1], amount: "20" },
      { index: 2, recipient: WALLETS[2], amount: "30" },
    ]);
  });

  it("anyone else gets only the rows the chain says are paid, and no manifest link", async () => {
    await world();
    const res = await get(`/api/drops/${MY_MULTISEND}`);
    const text = await res.text();
    const body = JSON.parse(text) as Detail;
    expect(body.ours.data.yours).toBe(false);
    expect(body.ours.data.manifestUrl).toBeNull();
    expect(body.ours.data.receivers).toEqual([{ index: 1, recipient: WALLETS[1], amount: "20" }]);
    // The unpaid and the failed wallet are nowhere in the answer.
    expect(text.toLowerCase()).not.toContain((WALLETS[0] as string).slice(2));
    expect(text.toLowerCase()).not.toContain((WALLETS[2] as string).slice(2));
    expect(text).not.toContain("proof");
  });

  it("nothing paid on chain yet: an empty list for anyone else", async () => {
    await world([]);
    const body = (await (await get(`/api/drops/${MY_MULTISEND}`)).json()) as Detail;
    expect(body.ours.data.receivers).toEqual([]);
  });

  it("a handle drop carries no receivers list", async () => {
    await world();
    const body = (await (await get(`/api/drops/${OTHER_HANDLE_DROP}`)).json()) as Detail;
    expect(body.ours.data.receivers ?? null).toBeNull();
    expect(body.ours.data.manifestUrl).toBe(`/api/drops/${OTHER_HANDLE_DROP}/manifest`);
  });
});
