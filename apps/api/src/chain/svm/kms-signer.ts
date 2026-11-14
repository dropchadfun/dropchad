/**
 * A Solana signer whose key lives in AWS KMS: the relayer's
 * transactions and the binder's message.
 *
 * Every signature is one KMS `Sign` with `ED25519_SHA_512` and message type `RAW` over the exact
 * bytes: pure Ed25519, the 64 bytes the runtime and the Ed25519 instruction check. The prehashed
 * variant is never used. Each answer is verified against the key before it leaves this file, so
 * a wrong answer fails here and never reaches a transaction. The public key comes from
 * `GetPublicKey`, never from config.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { hexToBytes } from "viem";

import { KmsKeyError, type KmsClient } from "../kms.js";
import type { Signer } from "./keypair.js";

const KEY_SPEC = "ECC_NIST_EDWARDS25519";
const KEY_USAGE = "SIGN_VERIFY";
/** The DER header of an Ed25519 `SubjectPublicKeyInfo`, before the 32 byte key. */
const SPKI_PREFIX = hexToBytes("0x302a300506032b6570032100");
/** The largest message KMS `Sign` takes as `RAW`. A Solana transaction is at most 1,232. */
const RAW_LIMIT = 4096;

/** The 32 byte key out of an Ed25519 `SubjectPublicKeyInfo`. */
function keyFromSpki(spki: Uint8Array): Uint8Array {
  const prefixMatches =
    spki.length === SPKI_PREFIX.length + 32 && SPKI_PREFIX.every((byte, i) => spki[i] === byte);
  if (!prefixMatches) {
    throw new KmsKeyError("the KMS public key is not an Ed25519 SubjectPublicKeyInfo");
  }
  return spki.slice(SPKI_PREFIX.length);
}

/**
 * The signer for one KMS key. Reads the public key once and refuses a key with the wrong spec or
 * usage before any sign.
 */
export async function kmsSolanaSigner(kms: KmsClient, keyId: string): Promise<Signer> {
  const key = await kms.getPublicKey(keyId);
  if (key.keySpec !== KEY_SPEC || key.keyUsage !== KEY_USAGE) {
    throw new KmsKeyError(
      `KMS key ${keyId} is ${key.keySpec} ${key.keyUsage}, a Solana key must be ${KEY_SPEC} ${KEY_USAGE}`,
    );
  }
  const publicKey = keyFromSpki(key.publicKey);

  return {
    publicKey,
    async sign(message) {
      if (message.length > RAW_LIMIT) {
        throw new Error(
          `a ${String(message.length)} byte message is over the ${String(RAW_LIMIT)} byte KMS limit`,
        );
      }
      const signature = await kms.sign(keyId, message, "ED25519_SHA_512", "RAW");
      if (signature.length !== 64 || !ed25519.verify(signature, message, publicKey)) {
        throw new Error(`the KMS signature for key ${keyId} does not verify against its key`);
      }
      return signature;
    },
  };
}
