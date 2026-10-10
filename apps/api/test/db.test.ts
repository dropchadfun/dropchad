/**
 * The database layer.
 *
 * `migrations/*.sql` is the source of truth and `src/db/schema.ts` is the typed view of it. These
 * tests are what stop the two drifting apart: every column is written and read back **through
 * drizzle**, so a column renamed in one place and not the other fails here.
 */
import { afterEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { migrate, openAndMigrate, openDatabase, type DatabaseHandle } from "../src/db/client.js";
import {
  dropHandleLeaves,
  dropJobs,
  drops,
  handleBindings,
  oauthStates,
  profiles,
  relayerSpend,
  relayerTxs,
  sessions,
  xHandleLookups,
  xUsers,
} from "../src/db/schema.js";

const DROP_ADDRESS = "0x00000000000000000000000000000000000d0000";
const HASH_11 = `0x${"11".repeat(32)}` as const;
const HASH_22 = `0x${"22".repeat(32)}` as const;
const HASH_33 = `0x${"33".repeat(32)}` as const;
const HASH_44 = `0x${"44".repeat(32)}` as const;
const HASH_55 = `0x${"55".repeat(32)}` as const;
const HASH_66 = `0x${"66".repeat(32)}` as const;
const HASH_77 = `0x${"77".repeat(32)}` as const;
const HASH_AA = `0x${"aa".repeat(32)}` as const;
const MANIFEST_JSON = '{"version":1}';

let handle: DatabaseHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe("migrations", () => {
  it("creates every table and records what it applied", async () => {
    handle = await openDatabase("memory://");
    const ran = await migrate(handle.client);
    expect(ran).toEqual([
      "0001_init.sql",
      "0002_write_side.sql",
      "0003_pay_cursor.sql",
      "0004_profile_kind.sql",
      "0005_chain_key.sql",
      "0006_settle.sql",
      "0007_profile_tags.sql",
      "0008_profile_tag.sql",
      "0009_drop_price.sql",
      "0010_handle_mode.sql",
      "0011_x_lookup_spend.sql",
      "0012_binding_x_login_only.sql",
      "0013_binding_error.sql",
      "0014_claimed_indexes.sql",
      "0015_commitment_blind.sql",
      "0016_login_next.sql",
      "0017_profile_tag_list.sql",
      "0018_token_drops.sql",
      "0019_token_launchpad.sql",
    ]);

    const tables = await handle.client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "_migrations",
      "drop_handle_leaves",
      "drop_jobs",
      "drops",
      "handle_bindings",
      "oauth_states",
      "profiles",
      "relayer_spend",
      "relayer_txs",
      "sessions",
      "x_handle_lookups",
      "x_lookup_spend",
      "x_users",
    ]);
  });

  it("is idempotent: running it twice applies nothing the second time", async () => {
    handle = await openDatabase("memory://");
    await migrate(handle.client);
    expect(await migrate(handle.client)).toEqual([]);
  });

  it("0017 turns one tag into a list of one, keeps the kind, clears every lock, keeps tag", async () => {
    handle = await openDatabase("memory://");
    await migrate(handle.client);
    // Back to the database before 0017: drop what it made and forget it ran. The rows below are
    // what the server holds, a picked tag with a lock, and a profile with none.
    await handle.client.exec(`
      ALTER TABLE profiles DROP COLUMN tags;
      DELETE FROM _migrations WHERE name = '0017_profile_tag_list.sql';
      INSERT INTO profiles (x_user_id, handle, display_name, kind, tag, tag_set_at)
        VALUES ('1', 'samplechad', 'sample', 'kol', 'kol', '2026-09-20T00:00:00Z'),
               ('2', 'nigeloxide', 'nigel', NULL, NULL, NULL),
               ('3', 'devchad', 'dev', 'chad', 'dev', '2026-09-30T00:00:00Z');
    `);

    expect(await migrate(handle.client)).toEqual(["0017_profile_tag_list.sql"]);

    const rows = await handle.client.query<{
      x_user_id: string;
      kind: string | null;
      tag: string | null;
      tags: string[];
      tag_set_at: Date | null;
    }>("SELECT x_user_id, kind, tag, tags, tag_set_at FROM profiles ORDER BY x_user_id");
    expect(rows.rows).toEqual([
      { x_user_id: "1", kind: "kol", tag: "kol", tags: ["kol"], tag_set_at: null },
      { x_user_id: "2", kind: null, tag: null, tags: [], tag_set_at: null },
      { x_user_id: "3", kind: "chad", tag: "dev", tags: ["dev"], tag_set_at: null },
    ]);
  });

  it("refuses a postgres:// url with an explanation instead of failing later", async () => {
    await expect(openDatabase("postgres://user:pw@localhost:5432/dropchad")).rejects.toThrow(
      /not wired up yet/,
    );
  });
});

describe("schema matches the SQL", () => {
  it("round trips every profile column through drizzle", async () => {
    handle = await openAndMigrate("memory://");
    const now = new Date("2026-09-09T00:00:00.000Z");

    await handle.db.insert(profiles).values({
      xUserId: "1234567890",
      handle: "dropchadfun",
      displayName: "dropchad",
      profileImageUrl: "https://example.invalid/a.png",
      kind: "project",
      tags: ["memecoin", "kol", "dev"],
      tagSetAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const rows = await handle.db.select().from(profiles);
    expect(rows[0]).toEqual({
      xUserId: "1234567890",
      handle: "dropchadfun",
      displayName: "dropchad",
      profileImageUrl: "https://example.invalid/a.png",
      kind: "project",
      tags: ["memecoin", "kol", "dev"],
      tagSetAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("a profile written without tags has an empty list, never NULL", async () => {
    handle = await openAndMigrate("memory://");
    await handle.db.insert(profiles).values({
      xUserId: "1234567890",
      handle: "dropchadfun",
      displayName: "dropchad",
    });
    const rows = await handle.db.select().from(profiles);
    expect(rows[0]?.tags).toEqual([]);
    expect(rows[0]?.tagSetAt).toBeNull();
  });

  it("has no tag column in the drizzle view: the old one is kept in SQL only", () => {
    expect(Object.keys(profiles)).not.toContain("tag");
  });

  it("round trips every session column, and cascades when the profile goes", async () => {
    handle = await openAndMigrate("memory://");
    const now = new Date("2026-09-09T00:00:00.000Z");
    const expires = new Date("2026-09-09T12:00:00.000Z");

    await handle.db.insert(profiles).values({
      xUserId: "1",
      handle: "a",
      displayName: "A",
      profileImageUrl: null,
    });
    await handle.db.insert(sessions).values({
      id: "hash",
      xUserId: "1",
      csrfTokenHash: "csrf-hash",
      createdAt: now,
      expiresAt: expires,
    });

    const rows = await handle.db.select().from(sessions);
    expect(rows[0]).toEqual({
      id: "hash",
      xUserId: "1",
      csrfTokenHash: "csrf-hash",
      createdAt: now,
      expiresAt: expires,
    });

    await handle.db.delete(profiles).where(eq(profiles.xUserId, "1"));
    expect(await handle.db.select().from(sessions)).toHaveLength(0);
  });

  it("round trips every oauth state column", async () => {
    handle = await openAndMigrate("memory://");
    const now = new Date("2026-09-09T00:00:00.000Z");
    const expires = new Date("2026-09-09T00:10:00.000Z");

    await handle.db.insert(oauthStates).values({
      stateHash: "state-hash",
      codeVerifier: "verifier",
      preSessionHash: "pre-hash",
      nextPath: "/claim",
      createdAt: now,
      expiresAt: expires,
    });

    expect(await handle.db.select().from(oauthStates)).toEqual([
      {
        stateHash: "state-hash",
        codeVerifier: "verifier",
        nextPath: "/claim",
        preSessionHash: "pre-hash",
        createdAt: now,
        expiresAt: expires,
      },
    ]);
  });

  it("round trips every drop column, including the wei ones", async () => {
    handle = await openAndMigrate("memory://");
    const now = new Date("2026-09-11T00:00:00.000Z");
    const maxUint256 = (2n ** 256n - 1n).toString();

    await handle.db.insert(profiles).values({
      xUserId: "1",
      handle: "a",
      displayName: "A",
      profileImageUrl: null,
    });
    const row = {
      address: DROP_ADDRESS,
      chainId: 46630,
      chainKey: "robinhood-testnet",
      xUserId: "1",
      nonce: 3n,
      creatorCommitment: HASH_11,
      salt: HASH_22,
      asset: "0x0000000000000000000000000000000000000000",
      merkleRoot: HASH_33,
      manifestHash: HASH_44,
      manifestJson: MANIFEST_JSON,
      // NUMERIC(78, 0) holds every uint256 exactly, and this is the largest one there is.
      totalEntitlements: maxUint256,
      feeAmount: "0",
      grossRequired: maxUint256,
      leafCount: 3,
      refundRecipient: "0x000000000000000000000000000000000000dEaD",
      fundingDeadline: 1_800_000_000n,
      claimPeriod: 2_592_000,
      title: "gm",
      memeImageUrl: "https://example.invalid/a.png",
      state: "paying",
      paidCount: 2,
      failedIndexes: [7, 9],
      nextClaimIndex: 20,
      createTxHash: HASH_55,
      activateTxHash: HASH_66,
      lastTxHash: HASH_77,
      settleTxHash: null,
      closeTxHash: null,
      closedAt: null,
      claimedIndexes: [0, 2],
      priceUsd: null,
      pricedAt: null,
      lastError: "one batch reverted",
      mode: "handle" as const,
      commitmentBlind: `0x${"b1".repeat(32)}`,
      // Migration 0018: a token drop's columns, the numeric ones as strings.
      tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      tokenDecimals: 6,
      tokenName: "Doomed Rocket",
      tokenSymbol: "DOOROC",
      vault: "A8XWoUnK974nW8joknyPTfTmZ31GtexRRa6CWaQRvjGM",
      solFeeLamports: "166666667",
      accountBudgetLamports: "12153600",
      feeTierUsd: "37.50",
      feeSolPriceUsd: "143.27",
      // Migration 0019: the launchpad the token check saw at create.
      tokenLaunchpad: "pump.fun",
      createdAt: now,
      updatedAt: now,
    };

    await handle.db.insert(drops).values(row);
    expect(await handle.db.select().from(drops)).toEqual([row]);
  });

  it("round trips a job, and cascades when the drop goes", async () => {
    handle = await openAndMigrate("memory://");
    const now = new Date("2026-09-11T00:00:00.000Z");

    await handle.db
      .insert(profiles)
      .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
    await handle.db.insert(drops).values({
      address: DROP_ADDRESS,
      chainId: 46630,
      chainKey: "robinhood-testnet",
      xUserId: "1",
      nonce: 0n,
      creatorCommitment: HASH_11,
      salt: HASH_22,
      asset: "0x0000000000000000000000000000000000000000",
      merkleRoot: HASH_33,
      manifestHash: HASH_44,
      manifestJson: "{}",
      totalEntitlements: "1",
      feeAmount: "0",
      grossRequired: "1",
      leafCount: 1,
      refundRecipient: "0x000000000000000000000000000000000000dEaD",
      fundingDeadline: 1n,
      claimPeriod: 1,
      createTxHash: HASH_55,
    });
    await handle.db.insert(dropJobs).values({
      dropAddress: DROP_ADDRESS,
      kind: "watch_funding",
      state: "ready",
      runAfter: now,
      attempts: 1,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    expect((await handle.db.select().from(dropJobs))[0]).toMatchObject({
      dropAddress: DROP_ADDRESS,
      kind: "watch_funding",
      state: "ready",
      runAfter: now,
      attempts: 1,
      lastError: null,
    });

    await handle.db.delete(drops);
    expect(await handle.db.select().from(dropJobs)).toHaveLength(0);
  });

  it("round trips a relayer transaction and a day of spending", async () => {
    handle = await openAndMigrate("memory://");
    const now = new Date("2026-09-11T00:00:00.000Z");

    const tx = {
      txHash: HASH_AA,
      kind: "createDrop",
      chainId: 46630,
      chainKey: "robinhood-testnet",
      dropAddress: null,
      toAddress: "0x09ce0ce51a9b14d7f3426db4cb3a5b44a8a74f60",
      nonce: 12n,
      lastValidBlockHeight: null,
      gasLimit: "2000000",
      gasUsed: "1500000",
      effectiveGasPrice: "1000000",
      costWei: "1500000000000",
      status: "success",
      createdAt: now,
    };
    await handle.db.insert(relayerTxs).values(tx);
    expect(await handle.db.select().from(relayerTxs)).toEqual([tx]);

    const spend = {
      day: "2026-09-11",
      chainId: 46630,
      weiSpent: "1500000000000",
      updatedAt: now,
    };
    await handle.db.insert(relayerSpend).values(spend);
    expect(await handle.db.select().from(relayerSpend)).toEqual([spend]);
  });

  // -- handle mode, migration 0010 -------------------------------------------------------------

  /** A profile and one drop, the minimum the handle tables hang off. */
  async function seedDrop(h: DatabaseHandle): Promise<void> {
    await h.db
      .insert(profiles)
      .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null });
    await h.db.insert(drops).values({
      address: DROP_ADDRESS,
      chainId: 46630,
      chainKey: "robinhood-testnet",
      xUserId: "1",
      nonce: 0n,
      creatorCommitment: HASH_11,
      salt: HASH_22,
      asset: "0x0000000000000000000000000000000000000000",
      merkleRoot: HASH_33,
      manifestHash: HASH_44,
      manifestJson: "{}",
      totalEntitlements: "3",
      feeAmount: "0",
      grossRequired: "3",
      leafCount: 2,
      refundRecipient: "0x000000000000000000000000000000000000dEaD",
      fundingDeadline: 1n,
      claimPeriod: 1,
      createTxHash: HASH_55,
    });
  }

  it("a drop written without a mode is an address drop", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    const [row] = await handle.db.select().from(drops);
    expect(row?.mode).toBe("address");
  });

  it("a drop written without a blind has NULL, the drops before 21b", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    const [row] = await handle.db.select().from(drops);
    expect(row?.commitmentBlind).toBeNull();
  });

  it("refuses a blind that is not 32 bytes of lowercase hex", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    for (const bad of ["0x1234", `0x${"B1".repeat(32)}`, "b1".repeat(32), `0x${"b1".repeat(33)}`]) {
      await expect(
        handle.client.query(`UPDATE drops SET commitment_blind = $1 WHERE address = $2`, [
          bad,
          DROP_ADDRESS,
        ]),
        bad,
      ).rejects.toThrow(/commitment_blind/);
    }
    await handle.client.query(`UPDATE drops SET commitment_blind = $1 WHERE address = $2`, [
      `0x${"b1".repeat(32)}`,
      DROP_ADDRESS,
    ]);
    expect((await handle.db.select().from(drops))[0]?.commitmentBlind).toBe(`0x${"b1".repeat(32)}`);
  });

  it("refuses any mode but address and handle", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    await expect(
      handle.client.query(`UPDATE drops SET mode = 'multisend' WHERE address = $1`, [DROP_ADDRESS]),
    ).rejects.toThrow(/mode/);
    await handle.client.query(`UPDATE drops SET mode = 'handle' WHERE address = $1`, [
      DROP_ADDRESS,
    ]);
    expect((await handle.db.select().from(drops))[0]?.mode).toBe("handle");
  });

  it("round trips the X id cache", async () => {
    handle = await openAndMigrate("memory://");
    const now = new Date("2026-09-28T00:00:00.000Z");
    const user = {
      xUserId: "1600000000000000000",
      handle: "SampleChad",
      displayName: "sample",
      profileImageUrl: "https://example.invalid/e.png",
      resolvedAt: now,
    };
    await handle.db.insert(xUsers).values(user);
    expect(await handle.db.select().from(xUsers)).toEqual([user]);

    const lookup = { handleLower: "samplechad", xUserId: "1600000000000000000", resolvedAt: now };
    await handle.db.insert(xHandleLookups).values(lookup);
    expect(await handle.db.select().from(xHandleLookups)).toEqual([lookup]);
  });

  it("round trips a handle leaf, and cascades when the drop goes", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    const leaves = [
      { dropAddress: DROP_ADDRESS, leafIndex: 0, xUserId: "12", amount: "1" },
      { dropAddress: DROP_ADDRESS, leafIndex: 1, xUserId: "44196397", amount: "2" },
    ];
    await handle.db.insert(dropHandleLeaves).values(leaves);
    expect(await handle.db.select().from(dropHandleLeaves)).toEqual(leaves);

    await expect(handle.db.insert(dropHandleLeaves).values(leaves[0]!)).rejects.toThrow();

    await handle.db.delete(drops);
    expect(await handle.db.select().from(dropHandleLeaves)).toHaveLength(0);
  });

  it("round trips a binding", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    const now = new Date("2026-09-28T00:00:00.000Z");
    const binding = {
      dropAddress: DROP_ADDRESS,
      leafIndex: 1,
      xUserId: "44196397",
      recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      binderSignature: `0x${"ab".repeat(65)}`,
      state: "submitted" as const,
      claimTxHash: HASH_66,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await handle.db.insert(handleBindings).values(binding);
    expect(await handle.db.select().from(handleBindings)).toEqual([binding]);
  });

  it("one binding per leaf and one per X id per drop: the database refuses a second", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    const first = {
      dropAddress: DROP_ADDRESS,
      leafIndex: 0,
      xUserId: "12",
      recipient: "0x00000000000000000000000000000000000000a1",
      binderSignature: "0x01",
    };
    await handle.db.insert(handleBindings).values(first);
    const [row] = await handle.db.select().from(handleBindings);
    expect(row?.state).toBe("bound");

    // The same leaf again, to another wallet.
    await expect(
      handle.db
        .insert(handleBindings)
        .values({ ...first, recipient: "0x00000000000000000000000000000000000000b2" }),
    ).rejects.toThrow();
    // The same X id again, on another leaf of the same drop.
    await expect(
      handle.db.insert(handleBindings).values({ ...first, leafIndex: 1 }),
    ).rejects.toThrow();
  });

  it("has no wallet proof columns since 0012: the X login is the only proof", async () => {
    handle = await openAndMigrate("memory://");
    const columns = await handle.client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'handle_bindings'`,
    );
    const names = columns.rows.map((r) => r.column_name);
    expect(names).toContain("binder_signature");
    expect(names).not.toContain("wallet_message");
    expect(names).not.toContain("wallet_signature");
  });

  it("refuses a binding state outside the four", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    // Raw SQL: the typed column already refuses it at compile time, this proves the database does.
    await expect(
      handle.client.query(
        `INSERT INTO handle_bindings (drop_address, leaf_index, x_user_id, recipient, binder_signature,
           state) VALUES ($1, 0, '12', '0xa1', '0x01', 'stolen')`,
        [DROP_ADDRESS],
      ),
    ).rejects.toThrow(/state/);
  });

  it("a binding cascades when the drop goes", async () => {
    handle = await openAndMigrate("memory://");
    await seedDrop(handle);
    await handle.db.insert(handleBindings).values({
      dropAddress: DROP_ADDRESS,
      leafIndex: 0,
      xUserId: "12",
      recipient: "0x00000000000000000000000000000000000000a1",
      binderSignature: "0x01",
    });
    await handle.db.delete(drops);
    expect(await handle.db.select().from(handleBindings)).toHaveLength(0);
  });

  it("has no column anywhere that could hold a private key", async () => {
    handle = await openAndMigrate("memory://");
    const columns = await handle.client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'",
    );
    const names = columns.rows.map((r) => r.column_name.toLowerCase());

    // The relayer key lives in the environment and nowhere else.
    expect(names.some((name) => name.includes("private"))).toBe(false);
    expect(names.some((name) => name.includes("secret"))).toBe(false);
    expect(names.some((name) => name.includes("mnemonic"))).toBe(false);
    expect(names.some((name) => name.includes("seed"))).toBe(false);
  });

  it("has no column anywhere that could hold an X token", async () => {
    handle = await openAndMigrate("memory://");
    const columns = await handle.client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'",
    );
    const names = columns.rows.map((r) => r.column_name.toLowerCase());

    expect(names.some((name) => name.includes("access_token"))).toBe(false);
    expect(names.some((name) => name.includes("refresh"))).toBe(false);
    expect(names.some((name) => name.includes("bearer"))).toBe(false);
  });
});
