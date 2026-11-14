/**
 * One backup Solana RPC url. Every call starts at the main url and moves
 * to the backup on `http 429`, any other http error, a network error or a timeout; never on a
 * JSON-RPC error answer. Main then backup with no extra wait. No url in any log. Without a backup
 * the retry stays as it is, `svm-rpc-retry.test.ts`.
 */
import { getChain } from "@dropchad/chains";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig, redactedConfig } from "../src/config.js";
import { createSvmRpc, RpcError } from "../src/chain/svm/rpc.js";
import { TEST_ENV } from "./harness.js";

const KEY = new Uint8Array(32).fill(7);
const OK = { jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: null } };
const MAIN = "https://main.invalid/main-key-123";
const BACKUP = "https://backup.invalid/backup-key-456";

/** A fetch that plays the given answers in order and remembers which url each call went to. */
function script(answers: ReadonlyArray<() => Promise<Response>>) {
  const calls: { url: string; at: number }[] = [];
  const fetchImpl = ((url: string) => {
    calls.push({ url, at: Date.now() });
    const next = answers[calls.length - 1];
    if (next === undefined) throw new Error("more calls than answers");
    return next();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, urls: () => calls.map((call) => call.url) };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
const status = (code: number) => () => Promise.resolve(new Response("", { status: code }));
const networkError = () => Promise.reject(new TypeError("fetch failed"));
const timeout = () =>
  Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
const rpcError = json({
  jsonrpc: "2.0",
  id: 1,
  error: { code: -32002, message: "preflight failed" },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the backup url", () => {
  const failures = [
    ["http 429", status(429)],
    ["any other http error", status(503)],
    ["an http 403", status(403)],
    ["a network error", networkError],
    ["a timeout", timeout],
  ] as const;

  for (const [name, failure] of failures) {
    it(`${name} on the main: the backup answers`, async () => {
      const { fetchImpl, urls } = script([failure, json(OK)]);
      const rpc = createSvmRpc({ url: [MAIN, BACKUP], fetchImpl });
      expect(await rpc.getAccountInfo(KEY, "finalized")).toBeNull();
      expect(urls()).toEqual([MAIN, BACKUP]);
    });
  }

  it("a JSON-RPC error answer stays on the main and is the error", async () => {
    const { fetchImpl, urls } = script([rpcError]);
    const rpc = createSvmRpc({ url: [MAIN, BACKUP], fetchImpl });
    await expect(rpc.getAccountInfo(KEY, "finalized")).rejects.toThrow(/preflight failed/);
    expect(urls()).toEqual([MAIN]);
  });

  it("a main that answers: the backup is never called", async () => {
    const { fetchImpl, urls } = script([json(OK)]);
    const rpc = createSvmRpc({ url: [MAIN, BACKUP], fetchImpl });
    expect(await rpc.getAccountInfo(KEY, "finalized")).toBeNull();
    expect(urls()).toEqual([MAIN]);
  });

  it("main then backup with no extra wait, and no second try on the main", async () => {
    const { fetchImpl, calls, urls } = script([status(429), json(OK)]);
    const rpc = createSvmRpc({ url: [MAIN, BACKUP], fetchImpl });
    await rpc.getAccountInfo(KEY, "finalized");
    expect(urls()).toEqual([MAIN, BACKUP]);
    expect(calls[1]!.at - calls[0]!.at).toBeLessThan(400);
  });

  it("a failure on the backup is the error, after one call to each url", async () => {
    const { fetchImpl, urls } = script([status(429), status(502)]);
    const rpc = createSvmRpc({ url: [MAIN, BACKUP], fetchImpl });
    await expect(rpc.getAccountInfo(KEY, "finalized")).rejects.toBeInstanceOf(RpcError);
    expect(urls()).toEqual([MAIN, BACKUP]);
  });

  it("nothing remembers that the main was down: the next call starts at the main", async () => {
    const { fetchImpl, urls } = script([status(429), json(OK), json(OK)]);
    const rpc = createSvmRpc({ url: [MAIN, BACKUP], fetchImpl });
    await rpc.getAccountInfo(KEY, "finalized");
    await rpc.getAccountInfo(KEY, "finalized");
    expect(urls()).toEqual([MAIN, BACKUP, MAIN]);
  });

  it("no backup set is the same as today: one url, one more try on it after 500 ms", async () => {
    const { fetchImpl, calls, urls } = script([status(429), json(OK)]);
    const rpc = createSvmRpc({ url: [MAIN], fetchImpl });
    expect(await rpc.getAccountInfo(KEY, "finalized")).toBeNull();
    expect(urls()).toEqual([MAIN, MAIN]);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(480);
  });

  it("no url in the log or the error, on the main or the backup", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetchImpl } = script([networkError, networkError]);
    const rpc = createSvmRpc({ url: [MAIN, BACKUP], fetchImpl });
    const thrown = await rpc.getAccountInfo(KEY, "finalized").catch((e: unknown) => e);
    const printed = [warn, log, error]
      .flatMap((spy) => spy.mock.calls.flat() as unknown[])
      .map(String)
      .join("\n");
    expect(warn).toHaveBeenCalled();
    for (const text of [printed, String(thrown)]) {
      expect(text).not.toContain("main-key-123");
      expect(text).not.toContain("backup-key-456");
      expect(text).not.toContain(".invalid");
    }
  });
});

describe("the backup env names", () => {
  it("are in the registry for both clusters", () => {
    expect(getChain("solana").fallbackRpcEnv).toBe("SOLANA_MAINNET_RPC_URL_FALLBACK");
    expect(getChain("solana-devnet").fallbackRpcEnv).toBe("SOLANA_DEVNET_RPC_URL_FALLBACK");
  });
});

describe("the Solana rpc urls in the config", () => {
  const base: NodeJS.ProcessEnv = { ...TEST_ENV };

  it("is null when the main is unset", () => {
    expect(
      loadConfig({ ...base, SOLANA_DEVNET_RPC_URL_FALLBACK: BACKUP }).solanaRpcUrls,
    ).toBeNull();
  });

  it("is the main alone when no backup is set, or the backup is empty", () => {
    expect(loadConfig({ ...base, SOLANA_DEVNET_RPC_URL: MAIN }).solanaRpcUrls).toEqual([MAIN]);
    expect(
      loadConfig({ ...base, SOLANA_DEVNET_RPC_URL: MAIN, SOLANA_DEVNET_RPC_URL_FALLBACK: "" })
        .solanaRpcUrls,
    ).toEqual([MAIN]);
  });

  it("puts the main first and the backup second", () => {
    const config = loadConfig({
      ...base,
      SOLANA_DEVNET_RPC_URL: MAIN,
      SOLANA_DEVNET_RPC_URL_FALLBACK: BACKUP,
    });
    expect(config.solanaRpcUrls).toEqual([MAIN, BACKUP]);
  });

  it("equal urls give one url", () => {
    const config = loadConfig({
      ...base,
      SOLANA_DEVNET_RPC_URL: MAIN,
      SOLANA_DEVNET_RPC_URL_FALLBACK: MAIN,
    });
    expect(config.solanaRpcUrls).toEqual([MAIN]);
  });

  it("never prints either url, only how many are set", () => {
    const printed = JSON.stringify(
      redactedConfig(
        loadConfig({
          ...base,
          SOLANA_DEVNET_RPC_URL: MAIN,
          SOLANA_DEVNET_RPC_URL_FALLBACK: BACKUP,
        }),
      ),
    );
    expect(printed).not.toContain("main-key-123");
    expect(printed).not.toContain("backup-key-456");
    expect(printed).toContain('"solanaRpcUrls":"<set, 2>"');
  });
});
