/**
 * Who got fed, by handle., the clean drop page: `GET
 * /api/drops/:address` names each paid leaf of a handle drop by `handle` and `profileImageUrl`,
 * paid as the chain says, never anyone who has not claimed. A multisend names nobody.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { SvmReader } from "../src/chain/svm/reader.js";
import { dropHandleLeaves, drops, profiles, xUsers } from "../src/db/schema.js";
import { FAKE_CHAIN_ID } from "./fake-chain.js";
import { createHarness, type Harness } from "./harness.js";

const DROP = "0x00000000000000000000000000000000000d0000";
const MULTISEND = "0x00000000000000000000000000000000000d0001";
const SOL_DROP = "Dx4BT8ZkGLR49rmVRfkWKF96WCBXNrr3fRE3LAVQK7Wv";
const SENDER = "1234567890";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function row(address: string, overrides: Record<string, unknown> = {}) {
  return {
    address,
    mode: "handle" as const,
    chainId: FAKE_CHAIN_ID,
    chainKey: "robinhood-testnet",
    xUserId: SENDER,
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "400000000000000000",
    feeAmount: "0",
    grossRequired: "400000000000000000",
    leafCount: 4,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    state: "active",
    createTxHash: `0x${"55".repeat(32)}`,
    ...overrides,
  };
}

const LEAF_AMOUNT = "100000000000000000";
/** Four people: 901 and 903 paid, 902 not paid, 904 paid with no `x_users` row. */
const X_IDS = ["901", "902", "903", "904"];

async function seed(h: Harness, address = DROP, overrides: Record<string, unknown> = {}) {
  const db = h.deps.db;
  await db
    .insert(profiles)
    .values({ xUserId: SENDER, handle: "dropchadfun", displayName: "dropchad" })
    .onConflictDoNothing();
  await db.insert(drops).values(row(address, overrides));
  await db.insert(dropHandleLeaves).values(
    X_IDS.map((xUserId, leafIndex) => ({
      dropAddress: address,
      leafIndex,
      xUserId,
      amount: LEAF_AMOUNT,
    })),
  );
  await db
    .insert(xUsers)
    .values([
      {
        xUserId: "901",
        handle: "alice",
        displayName: "Alice",
        profileImageUrl: "https://pbs.twimg.com/profile_images/9/alice_normal.jpg",
      },
      // Bob never claimed: his name must not leave the api.
      { xUserId: "902", handle: "bob", displayName: "Bob", profileImageUrl: null },
      { xUserId: "903", handle: "carol", displayName: "Carol", profileImageUrl: null },
    ])
    .onConflictDoNothing();
}

const indexedClaim = (index: number) => ({
  index,
  recipient: "0x1111111111111111111111111111111111110001",
  amount: LEAF_AMOUNT,
  kind: "handle",
  xId: X_IDS[index],
  transactionHash: `0x${"fe".repeat(32)}`,
  finality: "seen",
});

async function detail(h: Harness, address: string) {
  const response = await h.app.request(`/api/drops/${address}`);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    ours: { data: { fed: unknown } | null };
  };
}

describe("ours.data.fed on a handle drop", () => {
  it("names each paid leaf by handle and picture, by leaf index, never one not paid", async () => {
    harness = await createHarness({
      indexer: {
        dropsByAddress: { [DROP]: { address: DROP, status: "Active" } },
        claimsByAddress: { [DROP]: [indexedClaim(2), indexedClaim(0), indexedClaim(3)] },
      },
    });
    await seed(harness);
    const body = await detail(harness, DROP);
    expect(body.ours.data?.fed).toEqual([
      {
        index: 0,
        handle: "alice",
        profileImageUrl: "https://pbs.twimg.com/profile_images/9/alice_normal.jpg",
      },
      { index: 2, handle: "carol", profileImageUrl: null },
    ]);
    // Bob is in the drop but has not claimed; 904 is paid but has no `x_users` row.
    expect(JSON.stringify(body)).not.toContain("bob");
  });

  it("nobody paid yet is an empty list", async () => {
    harness = await createHarness({
      indexer: { dropsByAddress: { [DROP]: { address: DROP, status: "Active" } } },
    });
    await seed(harness);
    expect((await detail(harness, DROP)).ours.data?.fed).toEqual([]);
  });

  it("the indexer down: no word from the chain, so nobody is named", async () => {
    harness = await createHarness({ indexer: { down: true } });
    await seed(harness);
    expect((await detail(harness, DROP)).ours.data?.fed).toEqual([]);
  });

  it("a multisend names nobody, `fed` is null", async () => {
    harness = await createHarness({
      indexer: {
        dropsByAddress: { [MULTISEND]: { address: MULTISEND, status: "Active" } },
        claimsByAddress: { [MULTISEND]: [indexedClaim(0)] },
      },
    });
    await seed(harness, MULTISEND, { mode: "address" });
    expect((await detail(harness, MULTISEND)).ours.data?.fed).toBeNull();
  });

  it("Solana: the bitmap says which leaf is paid, the handle comes from the leaf's X id", async () => {
    const reader = {
      chainKey: "solana-devnet",
      chainId: 103,
      indexedDrop: () => Promise.resolve({ address: SOL_DROP, status: "Active" }),
      claims: () =>
        Promise.resolve([
          {
            index: 0,
            recipient: null,
            amount: LEAF_AMOUNT,
            transactionHash: null,
            finality: "seen",
          },
        ]),
    } as unknown as SvmReader;
    harness = await createHarness({ solanaReader: reader });
    await seed(harness, SOL_DROP, { chainId: 103, chainKey: "solana-devnet" });
    expect((await detail(harness, SOL_DROP)).ours.data?.fed).toEqual([
      {
        index: 0,
        handle: "alice",
        profileImageUrl: "https://pbs.twimg.com/profile_images/9/alice_normal.jpg",
      },
    ]);
  });
});
