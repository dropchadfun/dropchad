/**
 * The indexer's optional env lines. An empty line is not set: an empty
 * `DROPCHAD_CHAIN=` and later an empty `FINALITY_CHECK_INTERVAL=` crashed the indexer on the
 * server, because `??` only skips `undefined`, not `""`.
 */
import { describe, expect, it } from "vitest";

import { optionalEnv, readIndexerEnv } from "../src/env.js";

const DEFAULTS = {
  chainKey: "robinhood-testnet",
  confirmationDepth: 64,
  finalityCheckInterval: 200,
};

describe("optionalEnv", () => {
  it("is undefined when the name is missing, empty or only spaces", () => {
    expect(optionalEnv({}, "X")).toBeUndefined();
    expect(optionalEnv({ X: "" }, "X")).toBeUndefined();
    expect(optionalEnv({ X: "   " }, "X")).toBeUndefined();
  });

  it("returns a real value, trimmed", () => {
    expect(optionalEnv({ X: " robinhood-testnet " }, "X")).toBe("robinhood-testnet");
  });
});

describe("readIndexerEnv", () => {
  it("uses the defaults when every optional line is left out", () => {
    expect(readIndexerEnv({})).toEqual(DEFAULTS);
  });

  it("uses the defaults when every optional line is empty", () => {
    expect(
      readIndexerEnv({ DROPCHAD_CHAIN: "", CONFIRMATION_DEPTH: "", FINALITY_CHECK_INTERVAL: "" }),
    ).toEqual(DEFAULTS);
  });

  it("uses the defaults when a line holds only spaces", () => {
    expect(readIndexerEnv({ FINALITY_CHECK_INTERVAL: "  " })).toEqual(DEFAULTS);
  });

  it("takes real values", () => {
    expect(
      readIndexerEnv({
        DROPCHAD_CHAIN: "robinhood",
        CONFIRMATION_DEPTH: "128",
        FINALITY_CHECK_INTERVAL: "50",
      }),
    ).toEqual({ chainKey: "robinhood", confirmationDepth: 128, finalityCheckInterval: 50 });
  });

  it("allows a depth of 0 only when written out", () => {
    expect(readIndexerEnv({ CONFIRMATION_DEPTH: "0" }).confirmationDepth).toBe(0);
  });

  it("refuses a value that is not a whole number, and names the line", () => {
    expect(() => readIndexerEnv({ CONFIRMATION_DEPTH: "abc" })).toThrow(/CONFIRMATION_DEPTH/);
    expect(() => readIndexerEnv({ FINALITY_CHECK_INTERVAL: "1.5" })).toThrow(
      /FINALITY_CHECK_INTERVAL/,
    );
    expect(() => readIndexerEnv({ CONFIRMATION_DEPTH: "-1" })).toThrow(/CONFIRMATION_DEPTH/);
  });

  it("refuses an interval of 0, which Ponder cannot run", () => {
    expect(() => readIndexerEnv({ FINALITY_CHECK_INTERVAL: "0" })).toThrow(
      /FINALITY_CHECK_INTERVAL/,
    );
  });
});

describe("INDEXER_LOCAL_CHAIN", () => {
  it("is unset by default, and when empty", () => {
    expect(readIndexerEnv({}).localChainFile).toBeUndefined();
    expect(readIndexerEnv({ INDEXER_LOCAL_CHAIN: "  " }).localChainFile).toBeUndefined();
  });

  it("takes a path, trimmed, outside production", () => {
    expect(
      readIndexerEnv({ INDEXER_LOCAL_CHAIN: " C:/tmp/anvil-chain.json ", NODE_ENV: "development" })
        .localChainFile,
    ).toBe("C:/tmp/anvil-chain.json");
    expect(readIndexerEnv({ INDEXER_LOCAL_CHAIN: "anvil.json" }).localChainFile).toBe("anvil.json");
  });

  it("is refused in production, and names the line", () => {
    expect(() =>
      readIndexerEnv({ INDEXER_LOCAL_CHAIN: "anvil.json", NODE_ENV: "production" }),
    ).toThrow(/INDEXER_LOCAL_CHAIN/);
  });

  it("an empty line in production is fine, it is not set", () => {
    expect(readIndexerEnv({ INDEXER_LOCAL_CHAIN: "", NODE_ENV: "production" }).localChainFile).toBe(
      undefined,
    );
  });
});
