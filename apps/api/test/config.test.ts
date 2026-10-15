/**
 * The environment gate. A missing or wrong value must stop the process at boot with a message
 * that names the variable, not three layers later with an `undefined` in a header.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, redactedConfig } from "../src/config.js";
import { TEST_ENV } from "./harness.js";

const base: NodeJS.ProcessEnv = { ...TEST_ENV };

describe("loadConfig", () => {
  it("derives the X callback url from API_URL, so it is never configured twice", () => {
    expect(loadConfig(base).xCallbackUrl).toBe("http://localhost:3000/api/auth/x/callback");
  });

  it("defaults the port to 4000. apps/web owns 3000 and proxies /api here", () => {
    const { PORT, ...withoutPort } = base;
    expect(PORT).toBeDefined();
    expect(loadConfig(withoutPort).PORT).toBe(4000);
  });

  it("keeps the callback on the 3000 origin whatever port the api itself listens on", () => {
    const config = loadConfig({ ...base, PORT: "4000" });
    expect(config.PORT).toBe(4000);
    expect(config.xCallbackUrl).toBe("http://localhost:3000/api/auth/x/callback");
  });

  it("names the missing variable", () => {
    const { X_CLIENT_SECRET, ...missing } = base;
    expect(X_CLIENT_SECRET).toBeDefined();
    expect(() => loadConfig(missing)).toThrow(/X_CLIENT_SECRET/);
  });

  it("refuses a short SESSION_SECRET", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "too-short" })).toThrow(
      /at least 32 characters/,
    );
  });

  it("refuses an APP_URL that is not a url", () => {
    expect(() => loadConfig({ ...base, APP_URL: "localhost:3000" })).toThrow(/APP_URL/);
  });

  it("defaults SHARE_BASE_URL to https://dropchad.com, the main domain", () => {
    const { SHARE_BASE_URL, ...withoutShare } = base;
    void SHARE_BASE_URL;
    expect(loadConfig(withoutShare).SHARE_BASE_URL).toBe("https://dropchad.com");
  });
});

describe("chain rpc urls", () => {
  const primary = "https://rpc.testnet.chain.robinhood.com";
  const keyed = "https://robinhood-testnet.g.alchemy.com/v2/test-key-not-real";

  it("is null when the primary is unset, the read only api", () => {
    const { ROBINHOOD_TESTNET_RPC_URL, ...none } = base;
    void ROBINHOOD_TESTNET_RPC_URL;
    expect(loadConfig(none).chainRpcUrls).toBeNull();
  });

  it("puts the primary first and the fallback second", () => {
    const config = loadConfig({
      ...base,
      ROBINHOOD_TESTNET_RPC_URL: primary,
      ROBINHOOD_TESTNET_RPC_URL_FALLBACK: keyed,
    });
    expect(config.chainRpcUrls).toEqual([primary, keyed]);
  });

  it("never prints either url, only how many are set", () => {
    const printed = JSON.stringify(
      redactedConfig(
        loadConfig({
          ...base,
          ROBINHOOD_TESTNET_RPC_URL: primary,
          ROBINHOOD_TESTNET_RPC_URL_FALLBACK: keyed,
        }),
      ),
    );
    expect(printed).not.toContain("alchemy");
    expect(printed).not.toContain("robinhood.com");
    expect(printed).toContain('"chainRpcUrls":"<set, 2>"');
  });
});

describe("redactedConfig", () => {
  it("replaces every secret, and never shortens one", () => {
    const printed = JSON.stringify(redactedConfig(loadConfig(base)));

    expect(printed).not.toContain(TEST_ENV.X_CLIENT_SECRET);
    expect(printed).not.toContain(TEST_ENV.SESSION_SECRET);
    // Not even a prefix. A truncated secret is still a leak.
    expect(printed).not.toContain(TEST_ENV.SESSION_SECRET.slice(0, 8));
    expect(printed).toContain("<set>");
  });
});

describe("the fee numbers", () => {
  it("defaults to 1 usd per receiver on a mainnet and on a testnet", () => {
    const { MIN_RECEIVER_USD_TESTNET: _fixture, ...real } = base;
    const config = loadConfig(real);
    expect(config.MIN_RECEIVER_USD_MAINNET).toBe("1");
    expect(config.MIN_RECEIVER_USD_TESTNET).toBe("1");
  });

  it("defaults the token tiers to $1, $3, $6, $10 and $20", () => {
    expect(loadConfig(base).TOKEN_FEE_TIERS_USD).toBe("5:1,20:3,50:6,100:10,500:20");
  });

  it("the example env file says the same, so a copied .env never brings the old numbers", () => {
    const example = readFileSync(join(__dirname, "..", ".env.example"), "utf8");
    expect(example).toMatch(/^MIN_RECEIVER_USD_MAINNET=1$/m);
    expect(example).toMatch(/^MIN_RECEIVER_USD_TESTNET=1$/m);
  });
});
