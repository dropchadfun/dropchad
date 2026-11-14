/**
 * The KMS config: the env names, a key id or a raw
 * key per role and never both, the three KMS settings together, no raw key on a mainnet chain, and
 * a start log that says set or unset and never a value.
 */
import { describe, expect, it } from "vitest";

import { kmsSettings, loadConfig, redactedConfig } from "../src/config.js";
import { TEST_ENV } from "./harness.js";

// Public test values: anvil account 2, a fixed Solana seed. Play money only.
const EVM_RAW = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const SOL_RAW = JSON.stringify(Array.from({ length: 64 }, (_, i) => (i < 32 ? 7 : i)));

const KMS = {
  KMS_REGION: "eu-north-1",
  KMS_ACCESS_KEY_ID: "AKIATESTONLYNOTREAL0",
  KMS_SECRET_ACCESS_KEY: "test-only-secret-not-real-0000000000000000",
} as const;

const KEY_IDS = {
  RELAYER_KMS_KEY_ID: "alias/test-evm-relayer",
  BINDER_EVM_KMS_KEY_ID: "alias/test-evm-binder",
  SOLANA_RELAYER_KMS_KEY_ID: "alias/test-solana-relayer",
  BINDER_SOLANA_KMS_KEY_ID: "alias/test-solana-binder",
} as const;

describe("the KMS env names", () => {
  it("reads the three settings and the four key ids", () => {
    const config = loadConfig({ ...TEST_ENV, ...KMS, ...KEY_IDS });
    expect(kmsSettings(config)).toEqual({
      region: KMS.KMS_REGION,
      accessKeyId: KMS.KMS_ACCESS_KEY_ID,
      secretAccessKey: KMS.KMS_SECRET_ACCESS_KEY,
    });
    expect(config.RELAYER_KMS_KEY_ID).toBe(KEY_IDS.RELAYER_KMS_KEY_ID);
    expect(config.BINDER_SOLANA_KMS_KEY_ID).toBe(KEY_IDS.BINDER_SOLANA_KMS_KEY_ID);
  });

  it("no KMS settings: kmsSettings is null and the api runs as before", () => {
    expect(kmsSettings(loadConfig({ ...TEST_ENV }))).toBeNull();
  });

  it("the start log says set or unset, never a value", () => {
    const shown = redactedConfig(loadConfig({ ...TEST_ENV, ...KMS, ...KEY_IDS }));
    expect(shown.KMS_REGION).toBe(KMS.KMS_REGION);
    expect(shown.KMS_ACCESS_KEY_ID).toBe("<set>");
    expect(shown.KMS_SECRET_ACCESS_KEY).toBe("<set>");
    expect(shown.RELAYER_KMS_KEY_ID).toBe("<set>");
    expect(shown.BINDER_SOLANA_KMS_KEY_ID).toBe("<set>");
    const text = JSON.stringify(shown);
    expect(text).not.toContain(KMS.KMS_ACCESS_KEY_ID);
    expect(text).not.toContain(KMS.KMS_SECRET_ACCESS_KEY);
    expect(text).not.toContain("alias/");
  });
});

describe("the start checks in the config", () => {
  it.each([
    ["RELAYER_PRIVATE_KEY", EVM_RAW, "RELAYER_KMS_KEY_ID"],
    ["BINDER_EVM_PRIVATE_KEY", EVM_RAW, "BINDER_EVM_KMS_KEY_ID"],
    ["SOLANA_RELAYER_SECRET", SOL_RAW, "SOLANA_RELAYER_KMS_KEY_ID"],
    ["BINDER_SOLANA_SECRET", SOL_RAW, "BINDER_SOLANA_KMS_KEY_ID"],
  ])("refuses %s and its key id together", (raw, value, keyId) => {
    expect(() => loadConfig({ ...TEST_ENV, ...KMS, [raw]: value, [keyId]: "alias/test" })).toThrow(
      new RegExp(`${raw}.*${keyId}|${keyId}.*${raw}`),
    );
  });

  it.each(["KMS_REGION", "KMS_ACCESS_KEY_ID", "KMS_SECRET_ACCESS_KEY"])(
    "refuses a key id without %s",
    (missing) => {
      const env: Record<string, string> = { ...TEST_ENV, ...KMS, ...KEY_IDS };
      delete env[missing];
      expect(() => loadConfig(env)).toThrow(new RegExp(missing));
    },
  );

  it("refuses a KMS setting with no key id to use it", () => {
    expect(() => loadConfig({ ...TEST_ENV, ...KMS })).toThrow(/KMS_KEY_ID/);
  });

  it.each([
    ["CHAIN_KEY", "robinhood", "RELAYER_PRIVATE_KEY", EVM_RAW],
    ["CHAIN_KEY", "robinhood", "BINDER_EVM_PRIVATE_KEY", EVM_RAW],
    ["SOLANA_CHAIN_KEY", "solana", "SOLANA_RELAYER_SECRET", SOL_RAW],
    ["SOLANA_CHAIN_KEY", "solana", "BINDER_SOLANA_SECRET", SOL_RAW],
  ])("refuses a raw key on a mainnet chain: %s=%s with %s", (chainEnv, chain, raw, value) => {
    let message = "";
    try {
      loadConfig({ ...TEST_ENV, [chainEnv]: chain, [raw]: value });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(new RegExp(`${raw}.*mainnet|mainnet.*${raw}`));
    expect(message).not.toContain(value);
  });

  it("a testnet still takes the raw keys, the testnet exception", () => {
    const config = loadConfig({
      ...TEST_ENV,
      RELAYER_PRIVATE_KEY: EVM_RAW,
      SOLANA_RELAYER_SECRET: SOL_RAW,
    });
    expect(config.RELAYER_PRIVATE_KEY).toBe(EVM_RAW);
    expect(kmsSettings(config)).toBeNull();
  });
});
