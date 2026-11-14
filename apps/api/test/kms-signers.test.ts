/**
 * The four signers at start: each role from its
 * KMS key id or its raw key, the KMS public key checked against `*_ADDRESS`, a binder that is
 * the relayer refused, a wrong key refused, and a KMS that cannot be read turning only that role
 * off. Against the fake in `fake-kms.ts`; the AWS client itself is `kms-aws.test.ts`.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { base58Encode } from "@dropchad/shared";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import { buildBinders } from "../src/binder/binders.js";
import { KmsKeyError } from "../src/chain/kms.js";
import { SignerConfigError, resolveSigners } from "../src/chain/signers.js";
import { buildWriteSides } from "../src/chain/write-sides.js";
import { loadConfig } from "../src/config.js";
import { openAndMigrate, type DatabaseHandle } from "../src/db/client.js";
import { createFakeKms } from "./fake-kms.js";
import { TEST_ENV } from "./harness.js";

// Anvil accounts 2 and 3, and two fixed Solana seeds. Play money only.
const EVM_RELAYER = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const EVM_BINDER = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;
const SOL_RELAYER_SEED = new Uint8Array(32).fill(21);
const SOL_BINDER_SEED = new Uint8Array(32).fill(22);
const solAddress = (seed: Uint8Array) => base58Encode(ed25519.getPublicKey(seed));
const solSecret = (seed: Uint8Array) => JSON.stringify([...seed, ...ed25519.getPublicKey(seed)]);

const KMS_ENV = {
  KMS_REGION: "eu-north-1",
  KMS_ACCESS_KEY_ID: "AKIATESTONLYNOTREAL0",
  KMS_SECRET_ACCESS_KEY: "test-only-secret-not-real-0000000000000000",
  RELAYER_KMS_KEY_ID: "evm-relayer",
  BINDER_EVM_KMS_KEY_ID: "evm-binder",
  SOLANA_RELAYER_KMS_KEY_ID: "sol-relayer",
  BINDER_SOLANA_KMS_KEY_ID: "sol-binder",
} as const;

const ADDRESSES = {
  RELAYER_ADDRESS: privateKeyToAccount(EVM_RELAYER).address,
  BINDER_EVM_ADDRESS: privateKeyToAccount(EVM_BINDER).address,
  SOLANA_RELAYER_ADDRESS: solAddress(SOL_RELAYER_SEED),
  BINDER_SOLANA_ADDRESS: solAddress(SOL_BINDER_SEED),
} as const;

function fourKeys() {
  const kms = createFakeKms();
  kms.addSecp256k1("evm-relayer", EVM_RELAYER);
  kms.addSecp256k1("evm-binder", EVM_BINDER);
  kms.addEd25519("sol-relayer", SOL_RELAYER_SEED);
  kms.addEd25519("sol-binder", SOL_BINDER_SEED);
  return kms;
}

describe("the signers from KMS", () => {
  it("builds all four roles from their key ids, the addresses from the public keys", async () => {
    const kms = fourKeys();
    const signers = await resolveSigners(
      loadConfig({ ...TEST_ENV, ...KMS_ENV, ...ADDRESSES }),
      kms.client,
    );
    expect(signers.evmRelayer?.address).toBe(ADDRESSES.RELAYER_ADDRESS);
    expect(base58Encode(signers.svmRelayer?.publicKey ?? new Uint8Array())).toBe(
      ADDRESSES.SOLANA_RELAYER_ADDRESS,
    );
    expect(signers.binders.evm?.address).toBe(ADDRESSES.BINDER_EVM_ADDRESS);
    expect(signers.binders.svm?.publicKey).toBe(ADDRESSES.BINDER_SOLANA_ADDRESS);
    expect(signers.notes).toEqual([]);
    expect(kms.calls).toHaveLength(0);
  });

  it("key ids with no KMS client is a start error", async () => {
    await expect(
      resolveSigners(loadConfig({ ...TEST_ENV, ...KMS_ENV }), null),
    ).rejects.toBeInstanceOf(SignerConfigError);
  });
});

describe("the start checks on the keys", () => {
  it.each([
    ["RELAYER_ADDRESS", ADDRESSES.BINDER_EVM_ADDRESS],
    ["BINDER_EVM_ADDRESS", ADDRESSES.RELAYER_ADDRESS],
    ["SOLANA_RELAYER_ADDRESS", ADDRESSES.BINDER_SOLANA_ADDRESS],
    ["BINDER_SOLANA_ADDRESS", ADDRESSES.SOLANA_RELAYER_ADDRESS],
  ])("refuses a KMS key that is not the one %s names", async (name, wrong) => {
    const config = loadConfig({ ...TEST_ENV, ...KMS_ENV, ...ADDRESSES, [name]: wrong });
    await expect(resolveSigners(config, fourKeys().client)).rejects.toThrow(new RegExp(name));
  });

  it("refuses a key with the wrong spec or usage", async () => {
    const kms = fourKeys();
    kms.addOther("evm-relayer", "ECC_NIST_P256", "SIGN_VERIFY");
    await expect(
      resolveSigners(loadConfig({ ...TEST_ENV, ...KMS_ENV }), kms.client),
    ).rejects.toBeInstanceOf(KmsKeyError);
  });

  it("refuses a binder that is the relayer, EVM and Solana", async () => {
    await expect(
      resolveSigners(
        loadConfig({ ...TEST_ENV, ...KMS_ENV, BINDER_EVM_KMS_KEY_ID: "evm-relayer" }),
        fourKeys().client,
      ),
    ).rejects.toBeInstanceOf(SignerConfigError);
    await expect(
      resolveSigners(
        loadConfig({ ...TEST_ENV, ...KMS_ENV, BINDER_SOLANA_KMS_KEY_ID: "sol-relayer" }),
        fourKeys().client,
      ),
    ).rejects.toBeInstanceOf(SignerConfigError);
  });

  it("refuses a KMS binder that is the raw relayer key on a testnet", async () => {
    const kms = createFakeKms();
    kms.addSecp256k1("evm-binder", EVM_RELAYER);
    const config = loadConfig({
      ...TEST_ENV,
      KMS_REGION: KMS_ENV.KMS_REGION,
      KMS_ACCESS_KEY_ID: KMS_ENV.KMS_ACCESS_KEY_ID,
      KMS_SECRET_ACCESS_KEY: KMS_ENV.KMS_SECRET_ACCESS_KEY,
      RELAYER_PRIVATE_KEY: EVM_RELAYER,
      BINDER_EVM_KMS_KEY_ID: "evm-binder",
    });
    await expect(resolveSigners(config, kms.client)).rejects.toBeInstanceOf(SignerConfigError);
  });

  it("KMS that cannot be read turns only that role off, with the reason", async () => {
    const kms = fourKeys();
    kms.addUnreachable("evm-relayer");
    const signers = await resolveSigners(loadConfig({ ...TEST_ENV, ...KMS_ENV }), kms.client);
    expect(signers.evmRelayer).toBeUndefined();
    expect(signers.svmRelayer).toBeDefined();
    expect(signers.binders.evm).toBeDefined();
    expect(signers.binders.svm).toBeDefined();
    expect(signers.notes).toHaveLength(1);
    expect(signers.notes[0]).toMatch(/RELAYER_KMS_KEY_ID/);
    expect(signers.notes[0]).toMatch(/off/);
    expect(signers.notes[0]).not.toContain(KMS_ENV.KMS_SECRET_ACCESS_KEY);
  });
});

describe("the raw keys on a testnet, unchanged", () => {
  it("gives the same four as the raw key path did", async () => {
    const config = loadConfig({
      ...TEST_ENV,
      RELAYER_PRIVATE_KEY: EVM_RELAYER,
      SOLANA_RELAYER_SECRET: solSecret(SOL_RELAYER_SEED),
      BINDER_EVM_PRIVATE_KEY: EVM_BINDER,
      BINDER_SOLANA_SECRET: solSecret(SOL_BINDER_SEED),
    });
    const signers = await resolveSigners(config, null);
    const before = buildBinders(config);
    expect(signers.evmRelayer?.address).toBe(ADDRESSES.RELAYER_ADDRESS);
    expect(base58Encode(signers.svmRelayer?.publicKey ?? new Uint8Array())).toBe(
      ADDRESSES.SOLANA_RELAYER_ADDRESS,
    );
    expect(signers.binders.evm?.address).toBe(before.evm?.address);
    expect(signers.binders.svm?.publicKey).toBe(before.svm?.publicKey);
  });
});

describe("the write sides on a KMS relayer", () => {
  let handle: DatabaseHandle | undefined;
  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("the EVM write side runs on the KMS relayer address", async () => {
    handle = await openAndMigrate("memory://");
    const kms = createFakeKms();
    kms.addSecp256k1("evm-relayer", EVM_RELAYER);
    const config = loadConfig({
      ...TEST_ENV,
      KMS_REGION: KMS_ENV.KMS_REGION,
      KMS_ACCESS_KEY_ID: KMS_ENV.KMS_ACCESS_KEY_ID,
      KMS_SECRET_ACCESS_KEY: KMS_ENV.KMS_SECRET_ACCESS_KEY,
      RELAYER_KMS_KEY_ID: "evm-relayer",
      ROBINHOOD_TESTNET_RPC_URL: "http://127.0.0.1:1",
    });
    const signers = await resolveSigners(config, kms.client);
    const write = await buildWriteSides(config, handle.db, signers);
    expect(write.adapters).toBeDefined();
    expect(write.lines.join("\n")).toContain(`relayer ${ADDRESSES.RELAYER_ADDRESS}`);
  });

  it("a Solana relayer KMS key that cannot be read: the line names its key id env", async () => {
    handle = await openAndMigrate("memory://");
    const kms = createFakeKms();
    kms.addUnreachable("sol-relayer");
    const config = loadConfig({
      ...TEST_ENV,
      KMS_REGION: KMS_ENV.KMS_REGION,
      KMS_ACCESS_KEY_ID: KMS_ENV.KMS_ACCESS_KEY_ID,
      KMS_SECRET_ACCESS_KEY: KMS_ENV.KMS_SECRET_ACCESS_KEY,
      SOLANA_RELAYER_KMS_KEY_ID: "sol-relayer",
    });
    const signers = await resolveSigners(config, kms.client);
    expect(signers.svmRelayer).toBeUndefined();
    const write = await buildWriteSides(config, handle.db, signers);
    expect(write.solana.kind).toBe("off");
    expect(write.lines).toContain(
      "SOLANA_RELAYER_KMS_KEY_ID not readable, the Solana write side is off",
    );
    expect(write.lines.join("\n")).not.toContain("SOLANA_RELAYER_SECRET");
  });

  it("no Solana relayer key at all: the line is unchanged", async () => {
    handle = await openAndMigrate("memory://");
    const config = loadConfig({ ...TEST_ENV });
    const write = await buildWriteSides(config, handle.db, await resolveSigners(config, null));
    expect(write.lines).toContain("no SOLANA_RELAYER_SECRET, the Solana write side is off");
  });
});
