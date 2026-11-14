/**
 * The Solana RPC client tries a call once more, never more than once, after 500 ms, on `http 429`
 * or a fast network error; never on a timeout or any other error.
 */
import { describe, expect, it } from "vitest";

import { createSvmRpc, RpcError } from "../src/chain/svm/rpc.js";

const KEY = new Uint8Array(32).fill(7);
const OK = { jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: null } };

/** A fetch that plays the given answers in order and remembers when each call came. */
function script(answers: ReadonlyArray<() => Promise<Response>>) {
  const at: number[] = [];
  const fetchImpl = (() => {
    at.push(Date.now());
    const next = answers[at.length - 1];
    if (next === undefined) throw new Error("more calls than answers");
    return next();
  }) as unknown as typeof fetch;
  return { fetchImpl, at };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
const status = (code: number) => () => Promise.resolve(new Response("", { status: code }));
const networkError = () => Promise.reject(new TypeError("fetch failed"));
const timeout = () =>
  Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

describe("one retry", () => {
  it("http 429 then an answer: the answer, after a 500 ms wait", async () => {
    const { fetchImpl, at } = script([status(429), json(OK)]);
    const rpc = createSvmRpc({ url: "https://rpc.invalid", fetchImpl });
    expect(await rpc.getAccountInfo(KEY, "finalized")).toBeNull();
    expect(at).toHaveLength(2);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(480);
  });

  it("a fast network error then an answer: the answer", async () => {
    const { fetchImpl, at } = script([networkError, json(OK)]);
    const rpc = createSvmRpc({ url: "https://rpc.invalid", fetchImpl });
    expect(await rpc.getAccountInfo(KEY, "finalized")).toBeNull();
    expect(at).toHaveLength(2);
  });

  it("never more than once: two 429s are the error", async () => {
    const { fetchImpl, at } = script([status(429), status(429)]);
    const rpc = createSvmRpc({ url: "https://rpc.invalid", fetchImpl });
    await expect(rpc.getAccountInfo(KEY, "finalized")).rejects.toThrow(/http 429/);
    expect(at).toHaveLength(2);
  });

  it("a timeout is not tried again", async () => {
    const { fetchImpl, at } = script([timeout]);
    const rpc = createSvmRpc({ url: "https://rpc.invalid", fetchImpl });
    await expect(rpc.getAccountInfo(KEY, "finalized")).rejects.toBeInstanceOf(RpcError);
    expect(at).toHaveLength(1);
  });

  it("any other http error is not tried again", async () => {
    const { fetchImpl, at } = script([status(500)]);
    const rpc = createSvmRpc({ url: "https://rpc.invalid", fetchImpl });
    await expect(rpc.getAccountInfo(KEY, "finalized")).rejects.toThrow(/http 500/);
    expect(at).toHaveLength(1);
  });

  it("a JSON-RPC error answer is not tried again", async () => {
    const { fetchImpl, at } = script([
      json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid params" } }),
    ]);
    const rpc = createSvmRpc({ url: "https://rpc.invalid", fetchImpl });
    await expect(rpc.getAccountInfo(KEY, "finalized")).rejects.toThrow(/invalid params/);
    expect(at).toHaveLength(1);
  });

  it("the error never carries the url", async () => {
    const url = "https://rpc.invalid/secret-key-123";
    const { fetchImpl } = script([networkError, networkError]);
    const rpc = createSvmRpc({ url, fetchImpl });
    const error = await rpc.getAccountInfo(KEY, "finalized").catch((e: unknown) => e);
    expect(String(error)).not.toContain("secret-key-123");
  });
});
