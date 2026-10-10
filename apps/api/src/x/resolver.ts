/**
 * The handle resolver: pasted `@handle`s to numeric X ids.
 *
 * - `x_handle_lookups`, handle to X id, is **refreshed after 7 days**. A handle can pass to a new
 *   a mapping cached forever would pay the old one. The create page shows every name and
 *   avatar before the drop is made, so a rename inside the 7 days is caught by the sender.
 * - `x_users`, X id to name and avatar, is cached **forever**: X ids are never reused.
 * - At most `HANDLE_MAX_RECEIVERS` handles, refused before any paid call.
 * - At most `HANDLE_LOOKUPS_DAILY_MAX` paid lookups a UTC day, charged **before** the call.
 *
 * X: `GET https://api.x.com/2/users/by?usernames=a,b` with the app-only bearer token, at most
 * 100 names a request, `user.fields=profile_image_url`. Unknown or suspended names come back in
 * `errors`, not as a failed request. Read on docs.x.com. One cent per user read, the
 * pricing page read.
 *
 * **The bearer token never leaves the `Authorization` header.** No log line, no error message,
 * no return value carries it.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";

import type { Database } from "../db/client.js";
import { xHandleLookups, xLookupSpend, xUsers } from "../db/schema.js";

/** The X username format, from the `GET /2/users/by` docs. */
export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
export const HANDLE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** `GET /2/users/by` takes at most 100 usernames. */
export const X_LOOKUP_BATCH = 100;
export const X_USERS_BY_URL = "https://api.x.com/2/users/by";

export interface ResolvedHandle {
  /** As X spells it today. */
  readonly handle: string;
  readonly handleLower: string;
  readonly xUserId: string;
  readonly displayName: string;
  readonly profileImageUrl: string | null;
}

export interface ResolveResult {
  /** In the order the handles were first pasted. */
  readonly found: ResolvedHandle[];
  /** Lowercased, unknown or suspended on X. The create page lists them. */
  readonly missing: string[];
  /** How many names were sent to X and charged to today's count. */
  readonly paidLookups: number;
}

export type HandleResolveCode =
  "bad_handle" | "too_many" | "daily_cap" | "not_configured" | "x_unavailable";

export class HandleResolveError extends Error {
  constructor(
    readonly code: HandleResolveCode,
    message: string,
    /** The handles that failed the format, for `bad_handle`. */
    readonly handles: readonly string[] = [],
    /** The X http status, for `x_unavailable`. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "HandleResolveError";
  }
}

export interface ResolveOptions {
  readonly db: Database;
  readonly now: Date;
  readonly fetchImpl: typeof fetch;
  /** Absent: nothing new is looked up, cached handles still resolve. */
  readonly bearerToken: string | undefined;
  readonly maxHandles: number;
  readonly dailyMax: number;
  readonly handles: readonly string[];
}

/** One `@` stripped, trimmed, lowercased, and checked against the X format; else `null`. */
export function normalizeHandle(input: string): string | null {
  const trimmed = input.trim();
  const bare = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return HANDLE_RE.test(bare) ? bare.toLowerCase() : null;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

interface XUserPayload {
  id?: unknown;
  username?: unknown;
  name?: unknown;
  profile_image_url?: unknown;
}

export async function resolveHandles(options: ResolveOptions): Promise<ResolveResult> {
  const { db, now } = options;

  // 1. Format, before anything else. Name every bad one.
  const bad = options.handles.filter((h) => normalizeHandle(h) === null);
  if (bad.length > 0) {
    throw new HandleResolveError("bad_handle", `not an X handle: ${bad.join(", ")}`, bad);
  }
  const wanted = [...new Set(options.handles.map((h) => normalizeHandle(h) as string))];

  // 2. The cap, before any paid call.
  if (wanted.length > options.maxHandles) {
    throw new HandleResolveError(
      "too_many",
      `a handle drop takes at most ${String(options.maxHandles)} receivers, got ${String(wanted.length)}`,
    );
  }

  // 3. The cache: fresh lookups joined to their profile.
  const freshAfter = new Date(now.getTime() - HANDLE_REFRESH_MS);
  const cachedRows =
    wanted.length === 0
      ? []
      : await db
          .select({
            handleLower: xHandleLookups.handleLower,
            xUserId: xUsers.xUserId,
            handle: xUsers.handle,
            displayName: xUsers.displayName,
            profileImageUrl: xUsers.profileImageUrl,
          })
          .from(xHandleLookups)
          .innerJoin(xUsers, eq(xUsers.xUserId, xHandleLookups.xUserId))
          .where(
            and(
              inArray(xHandleLookups.handleLower, wanted),
              gt(xHandleLookups.resolvedAt, freshAfter),
            ),
          );
  const byLower = new Map<string, ResolvedHandle>(cachedRows.map((r) => [r.handleLower, r]));
  const toFetch = wanted.filter((h) => !byLower.has(h));
  const missing = new Set<string>();

  if (toFetch.length > 0) {
    if (options.bearerToken === undefined) {
      throw new HandleResolveError(
        "not_configured",
        "handle lookups are off: X_BEARER_TOKEN is not set",
      );
    }

    // 4. Charge today's count first, in one conditional statement, so two requests cannot both
    //    squeeze under the cap.
    const day = utcDay(now);
    await db.insert(xLookupSpend).values({ day, lookups: 0, updatedAt: now }).onConflictDoNothing();
    const charged = await db
      .update(xLookupSpend)
      .set({ lookups: sql`${xLookupSpend.lookups} + ${toFetch.length}`, updatedAt: now })
      .where(
        and(
          eq(xLookupSpend.day, day),
          sql`${xLookupSpend.lookups} + ${toFetch.length} <= ${options.dailyMax}`,
        ),
      )
      .returning({ lookups: xLookupSpend.lookups });
    if (charged.length === 0) {
      throw new HandleResolveError(
        "daily_cap",
        `the daily X lookup cap of ${String(options.dailyMax)} is reached; cached handles still work`,
      );
    }

    // 5. Ask X, 100 at a time.
    for (let i = 0; i < toFetch.length; i += X_LOOKUP_BATCH) {
      const batch = toFetch.slice(i, i + X_LOOKUP_BATCH);
      const url = new URL(X_USERS_BY_URL);
      url.searchParams.set("usernames", batch.join(","));
      url.searchParams.set("user.fields", "profile_image_url");

      let response: Response;
      try {
        response = await options.fetchImpl(url.toString(), {
          method: "GET",
          headers: { authorization: `Bearer ${options.bearerToken}`, accept: "application/json" },
        });
      } catch {
        throw new HandleResolveError("x_unavailable", "X users lookup did not answer");
      }
      if (!response.ok) {
        throw new HandleResolveError(
          "x_unavailable",
          `X users lookup failed with ${String(response.status)}`,
          [],
          response.status,
        );
      }

      const body = (await response.json().catch(() => ({}))) as { data?: unknown };
      const data = Array.isArray(body.data) ? (body.data as XUserPayload[]) : [];
      const got = new Map<string, ResolvedHandle>();
      for (const u of data) {
        if (typeof u.id !== "string" || !/^[0-9]+$/.test(u.id) || typeof u.username !== "string")
          continue;
        const handleLower = u.username.toLowerCase();
        got.set(handleLower, {
          handle: u.username,
          handleLower,
          xUserId: u.id,
          displayName: typeof u.name === "string" ? u.name : u.username,
          profileImageUrl: typeof u.profile_image_url === "string" ? u.profile_image_url : null,
        });
      }

      // 6. Write both caches. X ids forever, the handle mapping with its time.
      for (const handleLower of batch) {
        const r = got.get(handleLower);
        if (r === undefined) {
          missing.add(handleLower);
          // A stale mapping must not outlive a handle X no longer knows.
          await db.delete(xHandleLookups).where(eq(xHandleLookups.handleLower, handleLower));
          continue;
        }
        await db
          .insert(xUsers)
          .values({
            xUserId: r.xUserId,
            handle: r.handle,
            displayName: r.displayName,
            profileImageUrl: r.profileImageUrl,
            resolvedAt: now,
          })
          .onConflictDoUpdate({
            target: xUsers.xUserId,
            set: {
              handle: r.handle,
              displayName: r.displayName,
              profileImageUrl: r.profileImageUrl,
              resolvedAt: now,
            },
          });
        await db
          .insert(xHandleLookups)
          .values({ handleLower, xUserId: r.xUserId, resolvedAt: now })
          .onConflictDoUpdate({
            target: xHandleLookups.handleLower,
            set: { xUserId: r.xUserId, resolvedAt: now },
          });
        byLower.set(handleLower, r);
      }
    }
  }

  return {
    found: wanted.filter((h) => byLower.has(h)).map((h) => byLower.get(h) as ResolvedHandle),
    missing: wanted.filter((h) => missing.has(h)),
    paidLookups: toFetch.length,
  };
}
