/**
 * The main tag. The first tag of `tags` is the main
 * tag, the one rows and boards show, picked by the sender; there is no separate field. `musician`
 * joins the list after `streamer` and makes kind `chad`. Changing only the main tag is a save, so
 * it falls under the 30 day lock like any other change.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../src/auth/session.js";
import { PROFILE_TAGS } from "../src/boards/compute.js";
import { profiles } from "../src/db/schema.js";
import { cookieHeader, createHarness, login, type Harness } from "./harness.js";

/** The stubbed X user in `harness.ts`. */
const X_USER_ID = "1234567890";
const HANDLE = "dropchadfun";

/** The harness clock at login, `harness.ts`. */
const T0 = new Date("2026-09-09T00:00:00.000Z");
const LOCK_MS = 30 * 24 * 60 * 60 * 1000;

interface ProfileBody {
  profile: { kind: string; tags: string[]; tagLockedUntil: string | null };
}

let harness: Harness;
let headers: Record<string, string>;

async function signIn(): Promise<void> {
  const { jar } = await login(harness);
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

async function save(...tags: string[]): Promise<Response> {
  return await harness.app.request("/api/me", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ tags }),
  });
}

/** A save on a fresh clock, `step` lock periods after the first login, so no lock is in the way. */
async function saveAt(step: number, ...tags: string[]): Promise<ProfileBody["profile"]> {
  harness.setNow(new Date(T0.getTime() + step * LOCK_MS));
  await signIn();
  const response = await save(...tags);
  expect(response.status, tags.join(",")).toBe(200);
  return ((await response.json()) as ProfileBody).profile;
}

async function publicProfile(): Promise<ProfileBody["profile"]> {
  const response = await harness.app.request(`/api/users/${HANDLE}`);
  return ((await response.json()) as ProfileBody).profile;
}

async function storedRow(): Promise<{ kind: string | null; tags: string[] } | undefined> {
  const rows = await harness.deps.db.select().from(profiles).where(eq(profiles.xUserId, X_USER_ID));
  return rows[0];
}

describe("musician, the tenth tag", () => {
  it("sits right after streamer in the one flat list", () => {
    expect(PROFILE_TAGS).toEqual([
      "chad",
      "kol",
      "dev",
      "streamer",
      "musician",
      "trader",
      "community",
      "memecoin",
      "utility",
      "nft",
    ]);
  });

  it("is accepted, alone or with others, and kept where it was sent", async () => {
    expect((await saveAt(0, "musician")).tags).toEqual(["musician"]);
    expect((await saveAt(1, "dev", "musician", "kol")).tags).toEqual(["dev", "musician", "kol"]);
    expect((await storedRow())?.tags).toEqual(["dev", "musician", "kol"]);
    expect((await publicProfile()).tags).toEqual(["dev", "musician", "kol"]);
  });

  it("as the main tag makes kind chad, whatever comes after", async () => {
    expect((await saveAt(0, "musician", "kol", "nft")).kind).toBe("chad");
    expect((await storedRow())?.kind).toBe("chad");
    expect((await publicProfile()).kind).toBe("chad");
  });
});

describe("the main tag is the first of tags", () => {
  it("is kept first as sent, and decides the kind", async () => {
    const profile = await saveAt(0, "kol", "musician", "dev");
    expect(profile.tags[0]).toBe("kol");
    expect(profile.kind).toBe("kol");
    const moved = await saveAt(1, "musician", "kol", "dev");
    expect(moved.tags).toEqual(["musician", "kol", "dev"]);
    expect(moved.kind).toBe("chad");
  });

  it("a change of the main tag alone is a save: refused while locked, with the date", async () => {
    await saveAt(0, "kol", "musician");
    const response = await save("musician", "kol");
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; until: string };
    expect(body.error).toBe("tag_locked");
    expect(body.until).toBe(new Date(T0.getTime() + LOCK_MS).toISOString());
    expect((await storedRow())?.tags).toEqual(["kol", "musician"]);
  });

  it("a change of the main tag alone goes through once the lock passed", async () => {
    await saveAt(0, "kol", "musician");
    const profile = await saveAt(1, "musician", "kol");
    expect(profile.tags).toEqual(["musician", "kol"]);
    expect(profile.kind).toBe("chad");
  });
});
