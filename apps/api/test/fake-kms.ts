/**
 * A fake AWS KMS for tests. It answers `GetPublicKey` and `Sign` the way
 * KMS does: the public key as DER `SubjectPublicKeyInfo`, the ECDSA signature as DER, the Ed25519
 * signature as 64 raw bytes. Real KMS returns a high `s` about half the time; `highS` forces it,
 * so the low-s step is always tested. `corrupt` makes an Ed25519 key answer a wrong signature.
 *
 * The private keys here are test values only. The file name avoids `key`, which `.gitignore`
 * blocks.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes, type Hex } from "viem";

import type {
  KmsClient,
  KmsMessageType,
  KmsPublicKey,
  KmsSigningAlgorithm,
} from "../src/chain/kms.js";

/** The DER header of a secp256k1 `SubjectPublicKeyInfo`, before the 65 byte point. */
const SPKI_SECP256K1_PREFIX = hexToBytes("0x3056301006072a8648ce3d020106052b8104000a034200");
/** The DER header of an Ed25519 `SubjectPublicKeyInfo`, before the 32 byte key. */
const SPKI_ED25519_PREFIX = hexToBytes("0x302a300506032b6570032100");
/** The `RAW` message limit of KMS `Sign`. */
const RAW_LIMIT = 4096;

export interface FakeKmsCall {
  readonly keyId: string;
  readonly message: Uint8Array;
  readonly algorithm: KmsSigningAlgorithm;
  readonly messageType: KmsMessageType;
}

type FakeKey =
  | { readonly kind: "secp256k1"; readonly secret: Uint8Array; readonly highS: boolean }
  | { readonly kind: "ed25519"; readonly seed: Uint8Array; readonly corrupt: boolean }
  | { readonly kind: "other"; readonly keySpec: string; readonly keyUsage: string }
  | { readonly kind: "unreachable" };

/** A DER INTEGER, minimal, with a leading zero when the high bit is set. */
export function derInteger(value: bigint): Uint8Array {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  let bytes = hexToBytes(`0x${hex}`);
  if ((bytes[0] ?? 0) & 0x80) bytes = Uint8Array.from([0, ...bytes]);
  return Uint8Array.from([0x02, bytes.length, ...bytes]);
}

/** `SEQUENCE { r INTEGER, s INTEGER }`, the shape KMS returns for ECDSA. */
export function derSignature(r: bigint, s: bigint): Uint8Array {
  const body = [...derInteger(r), ...derInteger(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}

export interface FakeKms {
  readonly client: KmsClient;
  readonly calls: FakeKmsCall[];
  addSecp256k1(keyId: string, secret: Hex, options?: { highS?: boolean }): void;
  addEd25519(keyId: string, seed: Uint8Array, options?: { corrupt?: boolean }): void;
  addOther(keyId: string, keySpec: string, keyUsage: string): void;
  /** A key whose `GetPublicKey` times out, as when KMS cannot be reached. */
  addUnreachable(keyId: string): void;
  /** Every `Sign` after this throws the error, until called with `undefined`. */
  failSigns(error: Error | undefined): void;
}

export function createFakeKms(): FakeKms {
  const keys = new Map<string, FakeKey>();
  const calls: FakeKmsCall[] = [];
  let failure: Error | undefined;

  function find(keyId: string): FakeKey {
    const key = keys.get(keyId);
    if (key === undefined) throw new Error(`fake KMS: no key ${keyId}`);
    return key;
  }

  const client: KmsClient = {
    getPublicKey(keyId: string): Promise<KmsPublicKey> {
      const key = find(keyId);
      if (key.kind === "unreachable") {
        return Promise.reject(
          Object.assign(new Error("connect timeout"), { name: "TimeoutError" }),
        );
      }
      if (key.kind === "other") {
        return Promise.resolve({
          publicKey: new Uint8Array(91),
          keySpec: key.keySpec,
          keyUsage: key.keyUsage,
        });
      }
      if (key.kind === "ed25519") {
        return Promise.resolve({
          publicKey: Uint8Array.from([...SPKI_ED25519_PREFIX, ...ed25519.getPublicKey(key.seed)]),
          keySpec: "ECC_NIST_EDWARDS25519",
          keyUsage: "SIGN_VERIFY",
        });
      }
      const point = secp256k1.getPublicKey(key.secret, false);
      return Promise.resolve({
        publicKey: Uint8Array.from([...SPKI_SECP256K1_PREFIX, ...point]),
        keySpec: "ECC_SECG_P256K1",
        keyUsage: "SIGN_VERIFY",
      });
    },

    async sign(keyId, message, algorithm, messageType) {
      calls.push({ keyId, message: Uint8Array.from(message), algorithm, messageType });
      await Promise.resolve();
      if (failure !== undefined) throw failure;
      const key = find(keyId);
      if (key.kind === "ed25519") {
        if (algorithm !== "ED25519_SHA_512" || messageType !== "RAW") {
          throw new Error("fake KMS: an Ed25519 key signs ED25519_SHA_512 over RAW only");
        }
        if (message.length > RAW_LIMIT) throw new Error("fake KMS: RAW message over 4096 bytes");
        const signature = ed25519.sign(message, key.seed);
        if (key.corrupt) signature[0] = (signature[0] ?? 0) ^ 0xff;
        return signature;
      }
      if (key.kind !== "secp256k1") throw new Error("fake KMS: not a signing key");
      if (algorithm !== "ECDSA_SHA_256" || messageType !== "DIGEST" || message.length !== 32) {
        throw new Error("fake KMS: only ECDSA_SHA_256 over a 32 byte DIGEST");
      }
      const signature = secp256k1.sign(message, key.secret, { lowS: true });
      const s = key.highS ? secp256k1.CURVE.n - signature.s : signature.s;
      return derSignature(signature.r, s);
    },
  };

  return {
    client,
    calls,
    addSecp256k1(keyId, secret, options) {
      keys.set(keyId, {
        kind: "secp256k1",
        secret: hexToBytes(secret),
        highS: options?.highS ?? false,
      });
    },
    addEd25519(keyId, seed, options) {
      keys.set(keyId, { kind: "ed25519", seed, corrupt: options?.corrupt ?? false });
    },
    addOther(keyId, keySpec, keyUsage) {
      keys.set(keyId, { kind: "other", keySpec, keyUsage });
    },
    addUnreachable(keyId) {
      keys.set(keyId, { kind: "unreachable" });
    },
    failSigns(error) {
      failure = error;
    },
  };
}
