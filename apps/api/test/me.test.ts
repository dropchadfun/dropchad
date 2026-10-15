/**
 * `PATCH /api/me`: a chad picks one to three tags. Self picked, so
 * they are labels, not badges, and the api checks that the list holds one to three known tags
 * with no repeat, that the writer is the owner, and that the last save is at least 30 days old.
 * The order is kept as sent: the first tag is the first one tapped. `kind` is derived from the
 * first tag on every save and is not an input.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { profiles } from "../src/db/schema.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

/** The stubbed X user in `harness.ts`. */
const X_USER_ID = "1234567890";
const HANDLE = "dropchadfun";

/** The harness clock at login, `harness.ts`. */
const T0 = new Date("2026-09-09T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_MS = 30 * DAY_MS;

interface ProfileBody {
  profile: { kind: string; tags: string[]; tagLockedUntil: string | null; badges: string[] };
}

let harness: Harness;
let headers: Record<string, string>;
let jar: Record<string, string>;

/** Sign in, or sign in again after the clock moved past the session. */
async function signIn(): Promise<void> {
  jar = (await login(harness)).jar;
  headers = {
    cookie: cookieHeader(jar),
    [CSRF_HEADER]: jar["dc_csrf"] ?? "",
    "content-type": "application/json",
  };
}

beforeEach(async () => {
  harness = await createHarness();
  await signIn();
});

afterEach(async () => {
  await harness.close();
});

async function patch(body: string, extra: Record<string, string> = {}): Promise<Response> {
  return await harness.app.request("/api/me", {
    method: "PATCH",
    headers: { ...headers, ...extra },
    body,
  });
}

const save = (...tags: string[]): Promise<Response> => patch(JSON.stringify({ tags }));

async function me(): Promise<ProfileBody["profile"]> {
  const response = await harness.app.request("/api/me", { headers: { cookie: cookieHeader(jar) } });
  return ((await response.json()) as ProfileBody).profile;
}

async function publicProfile(): Promise<ProfileBody["profile"]> {
  const response = await harness.app.request(`/api/users/${HANDLE}`);
  return ((await response.json()) as ProfileBody).profile;
}

async function storedRow(): Promise<
  { kind: string | null; tags: string[]; tagSetAt: Date | null } | undefined
> {
  const rows = await harness.deps.db.select().from(profiles).where(eq(profiles.xUserId, X_USER_ID));
  return rows[0];
}

const lockedUntil = (setAt: Date): string => new Date(setAt.getTime() + LOCK_MS).toISOString();

describe("PATCH /api/me", () => {
  it("starts with no tags, kind chad, no lock and no badges", async () => {
    const expected = { kind: "chad", tags: [], tagLockedUntil: null, badges: [] };
    expect(await me()).toMatchObject(expected);
    expect(await publicProfile()).toMatchObject(expected);
    expect((await storedRow())?.tags).toEqual([]);
  });

  it("stores one tag as a list of one, records when, and both reads show it with the lock", async () => {
    const response = await save("dev");
    expect(response.status).toBe(200);
    expect(((await response.json()) as ProfileBody).profile).toMatchObject({
      tags: ["dev"],
      tagLockedUntil: lockedUntil(T0),
    });

    const row = await storedRow();
    expect(row?.tags).toEqual(["dev"]);
    expect(row?.tagSetAt).toEqual(T0);
    expect(await me()).toMatchObject({ tags: ["dev"], tagLockedUntil: lockedUntil(T0) });
    expect(await publicProfile()).toMatchObject({
      tags: ["dev"],
      tagLockedUntil: lockedUntil(T0),
    });
  });

  it("stores three tags in the order sent, the first tap first", async () => {
    const response = await save("streamer", "dev", "kol");
    expect(response.status).toBe(200);
    expect(((await response.json()) as ProfileBody).profile.tags).toEqual([
      "streamer",
      "dev",
      "kol",
    ]);
    expect((await storedRow())?.tags).toEqual(["streamer", "dev", "kol"]);
    expect((await publicProfile()).tags).toEqual(["streamer", "dev", "kol"]);
  });

  it("takes chad as a normal pick, stored as the word", async () => {
    const response = await save("chad");
    expect(response.status).toBe(200);
    expect((await storedRow())?.tags).toEqual(["chad"]);
    expect(await me()).toMatchObject({ tags: ["chad"], kind: "chad" });
  });

  it("rejects an empty list, four tags, a repeat, an unknown tag, and the old one tag body", async () => {
    const bad: unknown[] = [
      { tags: [] },
      { tags: ["dev", "kol", "nft", "chad"] },
      { tags: ["dev", "dev"] },
      { tags: ["dev", "whale"] },
      { tags: ["project"] },
      { tags: "dev" },
      { tags: null },
      { tags: [null] },
      {},
      { tag: "dev" },
      { kind: "kol" },
      { tags: ["dev"], kind: "project" },
      { tags: ["dev"], tag: "dev" },
    ];
    for (const body of bad) {
      const response = await patch(JSON.stringify(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_body" });
    }
    expect((await patch("not json")).status).toBe(400);
    const row = await storedRow();
    expect(row?.tags).toEqual([]);
    expect(row?.tagSetAt).toBeNull();
  });

  describe("the 30 day lock", () => {
    it("refuses a second save right away, with the date it opens, and changes nothing", async () => {
      await save("dev", "kol");
      const response = await save("nft");
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "tag_locked", until: lockedUntil(T0) });

      const row = await storedRow();
      expect(row?.tags).toEqual(["dev", "kol"]);
      expect(row?.tagSetAt).toEqual(T0);
      expect(row?.kind).toBe("chad");
    });

    it("refuses the same set again while locked too", async () => {
      await save("dev", "kol");
      expect((await save("dev", "kol")).status).toBe(409);
    });

    it("still refuses on day 29", async () => {
      await save("dev");
      harness.setNow(new Date(T0.getTime() + 29 * DAY_MS));
      await signIn();
      const response = await save("kol");
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "tag_locked", until: lockedUntil(T0) });
    });

    it("lets the set change on day 30, down to one tag, and locks again from then", async () => {
      await save("dev", "streamer", "trader");
      const day30 = new Date(T0.getTime() + LOCK_MS);
      harness.setNow(day30);
      await signIn();
      const response = await save("kol");
      expect(response.status).toBe(200);
      expect(((await response.json()) as ProfileBody).profile).toMatchObject({
        tags: ["kol"],
        kind: "kol",
        tagLockedUntil: lockedUntil(day30),
      });
      const row = await storedRow();
      expect(row?.tags).toEqual(["kol"]);
      expect(row?.tagSetAt).toEqual(day30);

      expect((await save("dev")).status).toBe(409);
    });
  });

  describe("derives kind from the first tag only", () => {
    /** Each save on a fresh clock, 30 days apart, so the lock never gets in the way. */
    async function saveAt(step: number, ...tags: string[]): Promise<ProfileBody["profile"]> {
      harness.setNow(new Date(T0.getTime() + step * LOCK_MS));
      await signIn();
      const response = await save(...tags);
      expect(response.status, tags.join(",")).toBe(200);
      return ((await response.json()) as ProfileBody).profile;
    }

    it("project when memecoin, utility or nft is first", async () => {
      let step = 0;
      for (const tag of ["memecoin", "utility", "nft"]) {
        expect((await saveAt(step++, tag, "kol")).kind, tag).toBe("project");
        expect((await storedRow())?.kind).toBe("project");
        expect((await publicProfile()).kind).toBe("project");
      }
    });

    it("kol when kol is first", async () => {
      expect((await saveAt(0, "kol", "nft")).kind).toBe("kol");
      expect((await storedRow())?.kind).toBe("kol");
    });

    it("chad when anything else is first, whatever comes after", async () => {
      let step = 0;
      for (const tag of ["chad", "dev", "streamer", "trader", "community"]) {
        expect((await saveAt(step++, tag, "kol", "nft")).kind, tag).toBe("chad");
        expect((await storedRow())?.kind).toBe("chad");
      }
      expect((await saveAt(step, "nft")).kind).toBe("project");
      expect((await saveAt(step + 1, "dev", "memecoin")).kind).toBe("chad");
      expect((await storedRow())?.kind).toBe("chad");
    });
  });

  it("needs a session", async () => {
    const response = await harness.app.request("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["kol"] }),
    });
    expect(response.status).toBe(401);
  });

  it("needs the CSRF token, the cookie alone is not enough", async () => {
    const response = await patch(JSON.stringify({ tags: ["kol"] }), { [CSRF_HEADER]: "" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "csrf_failed" });
  });
});
