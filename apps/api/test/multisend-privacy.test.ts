/**
 * **no api door shows who sent
 * a multisend.** A multisend is a tool; the sender may not want their name on a list of wallets.
 *
 * - `GET /api/drops/:address` gives `creator: null` for a multisend, to everyone, the sender too.
 *   It gives `yours: true` only when the session cookie is the X account that made the drop,
 *   which is how the page knows to show `you sent this`.
 * - A handle drop is public: its `creator` stays for everyone, and it carries
 *   `yours` the same way.
 * - The list card drops `creator` for a multisend too, even though the list no longer carries one.
 * - The live stream, the manifest, the share route and the sender's profile never name the
 *   sender of a multisend. Boards and stats are covered by `handle-counting.test.ts`.
 *
 * What the chain itself says is not ours to hide: `refundRecipient` and `creatorCommitment` are
 * on chain in the drop. See the note in.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ownDropCard } from "../src/drops/card.js";
import { drops, profiles, type DropRow } from "../src/db/schema.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

let harness: Harness;

// The harness X stub signs in as this account, `createXStub`.
const ME = { xUserId: "1234567890", handle: "dropchadfun" };
// Somebody else, with a name nothing else in a response could contain by accident.
const SECRET = { xUserId: "777000111222", handle: "secretsender" };

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const MY_MULTISEND = addr(0x501);
const SECRET_MULTISEND = addr(0x502);
const SECRET_HANDLE_DROP = addr(0x503);

const row = (address: string, xUserId: string, mode: "address" | "handle") => ({
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
  manifestHash: `0x${"44".repeat(32)}`,
  manifestJson: JSON.stringify({
    version: 1,
    drop: address,
    chainId: 46630,
    root: `0x${"33".repeat(32)}`,
    totalEntitlements: "10",
    leafCount: 1,
    entries: [{ index: 0, recipient: addr(0xa1), amount: "10", proof: [] }],
  }),
  totalEntitlements: "10000000000000000",
  feeAmount: "0",
  grossRequired: "10000000000000000",
  leafCount: 1,
  refundRecipient: "0x000000000000000000000000000000000000dEaD",
  fundingDeadline: 1_800_000_000n,
  claimPeriod: 2_592_000,
  state: "paying",
  paidCount: 0,
  createTxHash: `0x${"55".repeat(32)}`,
});

beforeEach(async () => {
  harness = await createHarness();
  await harness.deps.db.insert(profiles).values([
    {
      xUserId: SECRET.xUserId,
      handle: SECRET.handle,
      displayName: "Secret Sender",
      profileImageUrl: "https://pbs.twimg.com/profile_images/secret.png",
    },
    // The login below upserts this row; the drop needs it first.
    { xUserId: ME.xUserId, handle: ME.handle, displayName: "dropchad", profileImageUrl: null },
  ]);
  await harness.deps.db
    .insert(drops)
    .values([
      row(MY_MULTISEND, ME.xUserId, "address"),
      row(SECRET_MULTISEND, SECRET.xUserId, "address"),
      row(SECRET_HANDLE_DROP, SECRET.xUserId, "handle"),
    ]);
});
afterEach(() => harness.close());

/** No trace of the secret sender anywhere in a body: id, handle, name or avatar. */
function expectNoSender(text: string): void {
  expect(text).not.toContain(SECRET.xUserId);
  expect(text).not.toContain(SECRET.handle);
  expect(text).not.toContain("Secret Sender");
  expect(text).not.toContain("secret.png");
}

interface DetailBody {
  ours: { data: { creator: { handle: string } | null; yours: boolean; mode: string } };
}

async function detail(
  address: string,
  cookie?: string,
): Promise<{ text: string; body: DetailBody }> {
  const response = await harness.app.request(`/api/drops/${address}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  return { text, body: JSON.parse(text) as DetailBody };
}

async function signedIn(): Promise<string> {
  // The profile of the signed in account is written by the login itself.
  const { jar } = await login(harness);
  return cookieHeader(jar);
}

describe("GET /api/drops/:address, a multisend", () => {
  it("a stranger, signed out, gets no creator and yours false", async () => {
    const { text, body } = await detail(SECRET_MULTISEND);
    expect(body.ours.data.creator).toBeNull();
    expect(body.ours.data.yours).toBe(false);
    expect(body.ours.data.mode).toBe("address");
    expectNoSender(text);
  });

  it("a stranger, signed in as somebody else, gets no creator and yours false", async () => {
    const { text, body } = await detail(SECRET_MULTISEND, await signedIn());
    expect(body.ours.data.creator).toBeNull();
    expect(body.ours.data.yours).toBe(false);
    expectNoSender(text);
  });

  it("the sender gets yours true, and still no creator: the page needs only the flag", async () => {
    const { body } = await detail(MY_MULTISEND, await signedIn());
    expect(body.ours.data.yours).toBe(true);
    expect(body.ours.data.creator).toBeNull();
  });

  it("the sender's cookie on somebody else's multisend is yours false", async () => {
    const { body } = await detail(SECRET_MULTISEND, await signedIn());
    expect(body.ours.data.yours).toBe(false);
  });

  it("a junk or expired cookie is simply signed out, never an error", async () => {
    const { body } = await detail(MY_MULTISEND, "dc_session=not-a-real-session");
    expect(body.ours.data.yours).toBe(false);
  });
});

describe("GET /api/drops/:address, a handle drop stays public", () => {
  it("the creator is there for everyone, yours false for a stranger", async () => {
    const { body } = await detail(SECRET_HANDLE_DROP);
    expect(body.ours.data.creator?.handle).toBe(SECRET.handle);
    expect(body.ours.data.yours).toBe(false);
  });
});

describe("the list card", () => {
  it("ownDropCard gives no creator for a multisend, and keeps it for a handle drop", () => {
    const person = {
      xUserId: SECRET.xUserId,
      handle: SECRET.handle,
      displayName: "Secret Sender",
      profileImageUrl: null,
      kind: "chad",
      tags: [],
    } as unknown as Parameters<typeof ownDropCard>[1];
    const base = { ...row(SECRET_MULTISEND, SECRET.xUserId, "address"), createdAt: new Date() };
    expect(ownDropCard(base as unknown as DropRow, person).creator).toBeNull();
    expect(
      ownDropCard({ ...base, mode: "handle" } as unknown as DropRow, person).creator?.handle,
    ).toBe(SECRET.handle);
  });
});

describe("the other doors never name the sender of a multisend", () => {
  it("the live snapshot", async () => {
    const response = await harness.app.request(`/api/drops/${SECRET_MULTISEND}/live`);
    expect(response.status).toBe(200);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("\n\n")) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(text).toContain("event: snapshot");
    expectNoSender(text);
  });

  it("the manifest", async () => {
    const response = await harness.app.request(`/api/drops/${SECRET_MULTISEND}/manifest`);
    expect(response.status).toBe(200);
    expectNoSender(await response.text());
  });

  it("the share route answers 404 without a name", async () => {
    const response = await harness.app.request(`/api/drops/${SECRET_MULTISEND}/share`);
    expect(response.status).toBe(404);
    expectNoSender(await response.text());
  });

  it("the sender's own profile never lists the multisend", async () => {
    const response = await harness.app.request(`/api/users/${SECRET.handle}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).not.toContain(SECRET_MULTISEND.toLowerCase());
    expect(text.toLowerCase()).toContain(SECRET_HANDLE_DROP.toLowerCase());
  });
});
