/**
 * `GET /api/drops/:address/live`, and the merged `GET /api/drops/:address`.
 *
 * The SSE tests read the response body as a stream and stop as soon as they have what they came
 * for. Nothing here waits fifteen seconds for a real heartbeat: the heartbeat interval is proved
 * by its constant and by the snapshot-then-close path, not by sitting still.
 */
import { getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDropEventBus, type DropEventBus } from "../src/worker/events.js";
import { drops, profiles } from "../src/db/schema.js";
import { createFakeChain, FAKE_CHAIN_ID } from "./fake-chain.js";
import { createHarness, type Harness } from "./harness.js";

const DROP = getAddress("0x00000000000000000000000000000000000d0000");
const LOWER = DROP.toLowerCase();

let harness: Harness;
let events: DropEventBus;

async function seed(state = "created"): Promise<void> {
  await harness.deps.db
    .insert(profiles)
    .values({ xUserId: "1", handle: "a", displayName: "A", profileImageUrl: null })
    .onConflictDoNothing();
  await harness.deps.db.insert(drops).values({
    address: LOWER,
    chainId: FAKE_CHAIN_ID,
    chainKey: "robinhood-testnet",
    xUserId: "1",
    nonce: 0n,
    creatorCommitment: `0x${"11".repeat(32)}`,
    salt: `0x${"22".repeat(32)}`,
    asset: "0x0000000000000000000000000000000000000000",
    merkleRoot: `0x${"33".repeat(32)}`,
    manifestHash: `0x${"44".repeat(32)}`,
    manifestJson: "{}",
    totalEntitlements: "300000000000000",
    feeAmount: "0",
    grossRequired: "300000000000000",
    leafCount: 3,
    refundRecipient: "0x000000000000000000000000000000000000dEaD",
    fundingDeadline: 1_800_000_000n,
    claimPeriod: 2_592_000,
    state,
    paidCount: 0,
    createTxHash: `0x${"55".repeat(32)}`,
  });
}

/** Read SSE frames until `want` of them have arrived, or the stream ends. */
async function readFrames(response: Response, want: number): Promise<string[]> {
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (body === null) throw new Error("no body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = "";

  while (frames.length < want) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      frames.push(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");
    }
  }
  await reader.cancel();
  return frames;
}

function parse(frame: string): { event: string; data: Record<string, unknown> } {
  const event = /event:\s*(.+)/.exec(frame)?.[1]?.trim() ?? "";
  const data = /data:\s*(.+)/.exec(frame)?.[1]?.trim() ?? "{}";
  return { event, data: JSON.parse(data) as Record<string, unknown> };
}

beforeEach(async () => {
  events = createDropEventBus();
  harness = await createHarness({
    events,
    writeSide: { chain: createFakeChain(), chainName: "Robinhood Chain Testnet" },
  });
});

afterEach(async () => {
  await harness.close();
});

describe("GET /api/drops/:address/live", () => {
  it("is a 404 for a drop we did not create", async () => {
    const response = await harness.app.request(
      "/api/drops/0x000000000000000000000000000000000000dead/live",
    );
    expect(response.status).toBe(404);
  });

  it("is a 400 for a junk address", async () => {
    const response = await harness.app.request("/api/drops/nope/live");
    expect(response.status).toBe(400);
  });

  it("sends a snapshot straight away, so a late browser is not blind", async () => {
    await seed();
    const response = await harness.app.request(`/api/drops/${LOWER}/live`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const [first] = await readFrames(response, 1);
    const snapshot = parse(first as string);
    expect(snapshot.event).toBe("snapshot");
    expect(snapshot.data).toMatchObject({
      drop: DROP,
      chainId: FAKE_CHAIN_ID,
      state: "created",
      paidCount: 0,
      leafCount: 3,
      grossRequiredWei: "300000000000000",
    });
  });

  it("closes right after the snapshot when the drop is already over", async () => {
    await seed("finished");
    const response = await harness.app.request(`/api/drops/${LOWER}/live`);
    // Asking for two frames returns one, because the stream ended. No connection is held open
    // for a drop that can never emit anything again.
    const frames = await readFrames(response, 2);
    expect(frames).toHaveLength(1);
    expect(parse(frames[0] as string).event).toBe("snapshot");
  });

  it("streams the worker's events in order and closes on finished", async () => {
    await seed();
    const response = await harness.app.request(`/api/drops/${LOWER}/live`);

    const reading = readFrames(response, 5);
    // Give the handler a moment to subscribe before the worker starts shouting.
    await new Promise((resolve) => setTimeout(resolve, 20));

    events.emit({ type: "funding_seen", drop: DROP, balanceWei: "300000000000000" });
    events.emit({
      type: "activated",
      drop: DROP,
      txHash: `0x${"66".repeat(32)}`,
      claimDeadline: "1900000000",
    });
    events.emit({
      type: "claim_paid",
      drop: DROP,
      index: 0,
      recipient: getAddress("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"),
      handle: null,
      profileImageUrl: null,
      amountWei: "100000000000000",
      txHash: `0x${"77".repeat(32)}`,
      paidCount: 1,
      leafCount: 3,
    });
    events.emit({
      type: "finished",
      drop: DROP,
      state: "finished",
      paidCount: 3,
      leafCount: 3,
      failedIndexes: [],
    });

    const frames = await reading;
    expect(frames.map((frame) => parse(frame).event)).toEqual([
      "snapshot",
      "funding_seen",
      "activated",
      "claim_paid",
      "finished",
    ]);

    const paid = parse(frames[3] as string).data;
    // Everything the rain needs to draw one bag.
    expect(paid).toMatchObject({
      index: 0,
      recipient: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
      amountWei: "100000000000000",
      paidCount: 1,
      leafCount: 3,
    });
  });

  it("ignores events belonging to another drop", async () => {
    await seed();
    const response = await harness.app.request(`/api/drops/${LOWER}/live`);
    const reading = readFrames(response, 2);
    await new Promise((resolve) => setTimeout(resolve, 20));

    events.emit({
      type: "funding_seen",
      drop: getAddress("0x000000000000000000000000000000000000beef"),
      balanceWei: "1",
    });
    events.emit({ type: "funding_seen", drop: DROP, balanceWei: "300000000000000" });

    const frames = await reading;
    expect(frames.map((frame) => parse(frame).event)).toEqual(["snapshot", "funding_seen"]);
    expect(parse(frames[1] as string).data["balanceWei"]).toBe("300000000000000");
  });

  it("lets go of the listener when the browser goes away", async () => {
    await seed();
    const response = await harness.app.request(`/api/drops/${LOWER}/live`);
    await readFrames(response, 1);
    // `readFrames` cancels the reader, which is what a closed tab looks like from here.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.listenerCount(DROP)).toBe(0);
  });
});

describe("GET /api/drops/:address, merged", () => {
  it("shows our progress next to the indexed state, each labelled", async () => {
    await seed("paying");
    await harness.deps.db.update(drops).set({ paidCount: 2, failedIndexes: [1] });

    const response = await harness.app.request(`/api/drops/${LOWER}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chain: Record<string, unknown>;
      ours: { source: string; known: boolean; data: Record<string, unknown> };
    };

    expect(body.chain["source"]).toBe("indexer");
    expect(body.ours.source).toBe("dropchad_api");
    expect(body.ours.known).toBe(true);
    expect(body.ours.data).toMatchObject({
      state: "paying",
      paidCount: 2,
      leafCount: 3,
      failedIndexes: [1],
      manifestUrl: `/api/drops/${LOWER}/manifest`,
    });
  });

  it("answers with our side alone while the indexer has not caught up yet", async () => {
    // The seconds right after creation. The indexer being a few blocks behind is normal.
    await harness.close();
    harness = await createHarness({ events, indexer: { drop: null } });
    await seed();

    const response = await harness.app.request(`/api/drops/${LOWER}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chain: { indexed: boolean; data: unknown };
      ours: { known: boolean };
    };
    expect(body.chain.indexed).toBe(false);
    expect(body.chain.data).toBeNull();
    expect(body.ours.known).toBe(true);
  });

  it("still answers for our drop when the indexer is down, and says it is down", async () => {
    await harness.close();
    harness = await createHarness({ events, indexer: { down: true } });
    await seed();

    const response = await harness.app.request(`/api/drops/${LOWER}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { chain: { available: boolean }; ours: unknown };
    expect(body.chain.available).toBe(false);
    expect(body.ours).toMatchObject({ known: true });
  });
});
