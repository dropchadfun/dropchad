/**
 * Our own wrapper over `@aws-sdk/client-kms`:
 * `GetPublicKey` and `Sign` only, the credentials and the region from config only. No network:
 * the SDK client is replaced by a recording `send`, and the real client is only built and read.
 */
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";

import { buildAwsKmsSdk, createAwsKmsClient } from "../src/chain/kms-aws.js";

const SETTINGS = {
  region: "eu-north-1",
  accessKeyId: "AKIATESTONLYNOTREAL0",
  secretAccessKey: "test-only-secret-not-real-0000000000000000",
} as const;

function recording(answer: unknown) {
  const sent: unknown[] = [];
  return {
    sent,
    sdk: {
      send: (command: unknown) => {
        sent.push(command);
        return Promise.resolve(answer);
      },
    },
  };
}

describe("the AWS KMS wrapper", () => {
  it("GetPublicKey: one command with the key id, the answer mapped", async () => {
    const publicKey = new Uint8Array([1, 2, 3]);
    const { sent, sdk } = recording({
      PublicKey: publicKey,
      KeySpec: "ECC_SECG_P256K1",
      KeyUsage: "SIGN_VERIFY",
    });
    const kms = createAwsKmsClient(SETTINGS, sdk);
    expect(await kms.getPublicKey("alias/test")).toEqual({
      publicKey,
      keySpec: "ECC_SECG_P256K1",
      keyUsage: "SIGN_VERIFY",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(GetPublicKeyCommand);
    expect((sent[0] as GetPublicKeyCommand).input).toEqual({ KeyId: "alias/test" });
  });

  it("Sign: one command with the key id, the bytes, the type and the algorithm", async () => {
    const signature = new Uint8Array(64).fill(5);
    const { sent, sdk } = recording({ Signature: signature });
    const kms = createAwsKmsClient(SETTINGS, sdk);
    const message = new Uint8Array(32).fill(9);
    expect(await kms.sign("alias/test", message, "ECDSA_SHA_256", "DIGEST")).toEqual(signature);
    expect(sent[0]).toBeInstanceOf(SignCommand);
    expect((sent[0] as SignCommand).input).toEqual({
      KeyId: "alias/test",
      Message: message,
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    });
  });

  it("an answer without the expected field is an error, never an empty result", async () => {
    await expect(
      createAwsKmsClient(SETTINGS, recording({}).sdk).getPublicKey("alias/test"),
    ).rejects.toThrow();
    await expect(
      createAwsKmsClient(SETTINGS, recording({}).sdk).sign(
        "alias/test",
        new Uint8Array(1),
        "ED25519_SHA_512",
        "RAW",
      ),
    ).rejects.toThrow();
  });

  it("the SDK error passes through, the job retries as a failed send", async () => {
    const failing = {
      send: () =>
        Promise.reject(Object.assign(new Error("slow down"), { name: "ThrottlingException" })),
    };
    await expect(
      createAwsKmsClient(SETTINGS, failing).sign(
        "alias/test",
        new Uint8Array(32),
        "ECDSA_SHA_256",
        "DIGEST",
      ),
    ).rejects.toThrow("slow down");
  });
});

describe("the SDK client", () => {
  it("takes the region and the credentials from config, never the default chain", async () => {
    const sdk = buildAwsKmsSdk(SETTINGS);
    expect(await sdk.config.region()).toBe(SETTINGS.region);
    const credentials = await sdk.config.credentials();
    expect(credentials.accessKeyId).toBe(SETTINGS.accessKeyId);
    expect(credentials.secretAccessKey).toBe(SETTINGS.secretAccessKey);
    expect(await sdk.config.maxAttempts()).toBe(2);
  });
});
