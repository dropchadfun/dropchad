/**
 * The real `KmsClient` over `@aws-sdk/client-kms`: our own
 * small wrapper, `GetPublicKey` and `Sign` only.
 *
 * The SDK client gets the region and the credentials from config, explicitly, so the SDK's own
 * credential chain (other env names, files in the home folder, instance metadata) is never
 * consulted. 2 attempts and short timeouts: a slow KMS fails one send, and the job retries as for
 * any failed send. The credentials are never logged; an SDK error passes through as it is.
 */
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";

import type { KmsClient } from "./kms.js";

export interface AwsKmsSettings {
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** The one SDK method the wrapper uses, so a test can pass a recording stand in. */
export interface KmsSdk {
  send(command: GetPublicKeyCommand | SignCommand): Promise<unknown>;
}

export function buildAwsKmsSdk(settings: AwsKmsSettings): KMSClient {
  return new KMSClient({
    region: settings.region,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    maxAttempts: 2,
    requestHandler: { requestTimeout: 5_000, connectionTimeout: 3_000 },
  });
}

export function createAwsKmsClient(settings: AwsKmsSettings, sdk?: KmsSdk): KmsClient {
  const client: KmsSdk = sdk ?? buildAwsKmsSdk(settings);

  return {
    async getPublicKey(keyId) {
      const answer = (await client.send(new GetPublicKeyCommand({ KeyId: keyId }))) as {
        PublicKey?: Uint8Array;
        KeySpec?: string;
        KeyUsage?: string;
      };
      if (
        answer.PublicKey === undefined ||
        answer.KeySpec === undefined ||
        answer.KeyUsage === undefined
      ) {
        throw new Error(`KMS GetPublicKey for ${keyId} answered without a key, spec or usage`);
      }
      return { publicKey: answer.PublicKey, keySpec: answer.KeySpec, keyUsage: answer.KeyUsage };
    },

    async sign(keyId, message, algorithm, messageType) {
      const answer = (await client.send(
        new SignCommand({
          KeyId: keyId,
          Message: message,
          MessageType: messageType,
          SigningAlgorithm: algorithm,
        }),
      )) as { Signature?: Uint8Array };
      if (answer.Signature === undefined) {
        throw new Error(`KMS Sign for ${keyId} answered without a signature`);
      }
      return answer.Signature;
    },
  };
}
