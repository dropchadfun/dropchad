/**
 * Expired login states and sessions are deleted.
 * Before this nothing deleted them: every visit to a login start left a row behind.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupExpired, startCleanup } from "../src/auth/cleanup.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { oauthStates, profiles, sessions } from "../src/db/schema.js";

const NOW = new Date("2026-10-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;

let handle: DatabaseHandle | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await handle?.close();
  handle = undefined;
});

async function seed(db: DatabaseHandle["db"]): Promise<void> {
  await db
    .insert(profiles)
    .values({ xUserId: "1", handle: "samplechad", displayName: "sample chad" });
  await db.insert(sessions).values([
    { id: "expired", xUserId: "1", csrfTokenHash: "a", expiresAt: new Date(NOW.getTime() - HOUR) },
    { id: "ends-now", xUserId: "1", csrfTokenHash: "b", expiresAt: NOW },
    { id: "live", xUserId: "1", csrfTokenHash: "c", expiresAt: new Date(NOW.getTime() + HOUR) },
  ]);
  const state = (stateHash: string, expiresAt: Date) => ({
    stateHash,
    codeVerifier: "v",
    preSessionHash: "p",
    expiresAt,
  });
  await db
    .insert(oauthStates)
    .values([
      state("expired", new Date(NOW.getTime() - HOUR)),
      state("ends-now", NOW),
      state("live", new Date(NOW.getTime() + HOUR)),
    ]);
}

describe("cleanupExpired", () => {
  it("deletes expired sessions and login states and keeps the live ones", async () => {
    handle = await openAndMigrate("memory://");
    await seed(handle.db);

    const deleted = await cleanupExpired(handle.db, NOW);

    // A row that ends exactly now is expired, the same rule `readSession` uses.
    expect(deleted).toEqual({ sessions: 2, oauthStates: 2 });
    const leftSessions = await handle.db.select({ id: sessions.id }).from(sessions);
    const leftStates = await handle.db.select({ id: oauthStates.stateHash }).from(oauthStates);
    expect(leftSessions.map((r) => r.id)).toEqual(["live"]);
    expect(leftStates.map((r) => r.id)).toEqual(["live"]);
  });

  it("deletes nothing when nothing is expired", async () => {
    handle = await openAndMigrate("memory://");
    expect(await cleanupExpired(handle.db, NOW)).toEqual({ sessions: 0, oauthStates: 0 });
  });
});

describe("startCleanup", () => {
  it("runs once at start, then every interval, and stops on stop()", async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.resolve());
    const cleanup = startCleanup({ run, intervalMs: HOUR, onError: () => undefined });

    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(3);

    cleanup.stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("hands a failed run to onError and keeps going", async () => {
    vi.useFakeTimers();
    const boom = new Error("database busy");
    const run = vi.fn(() => Promise.reject(boom));
    const onError = vi.fn();
    const cleanup = startCleanup({ run, intervalMs: HOUR, onError });

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(boom);
    cleanup.stop();
  });

  it("index.ts starts the cleanup and stops it on shutdown", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/index.ts"), "utf8");
    expect(source).toMatch(/startCleanup\(/);
    expect(source).toMatch(/cleanup\.stop\(\)/);
  });
});
