/**
 * An EVM account whose key lives in AWS KMS: the relayer's
 * transactions and the binder's EIP-712 binding.
 *
 * Every signature is one KMS `Sign` with `ECDSA_SHA_256` and message type `DIGEST` over the
 * keccak-256 hash viem would sign locally, so KMS never hashes again. KMS answers DER and does
 * not say which of the two possible points it used, so `s` is moved to the low half of the curve
 * order (OpenZeppelin `ECDSA` refuses a high `s`) and `v` is the recovery id whose public key is
 * the KMS key. The address comes from `GetPublicKey`, never from config.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bytesToHex,
  hashMessage,
  hashTypedData,
  hexToBytes,
  keccak256,
  serializeSignature,
  serializeTransaction,
  type Hex,
  type LocalAccount,
} from "viem";
import { publicKeyToAddress, toAccount } from "viem/accounts";

import { KmsKeyError, type KmsClient } from "../kms.js";

const KEY_SPEC = "ECC_SECG_P256K1";
const KEY_USAGE = "SIGN_VERIFY";
/** The DER header of a secp256k1 `SubjectPublicKeyInfo`, before the 65 byte point. */
const SPKI_PREFIX = hexToBytes("0x3056301006072a8648ce3d020106052b8104000a034200");
const N = secp256k1.CURVE.n;

/** The 65 byte uncompressed point out of a secp256k1 `SubjectPublicKeyInfo`. */
function pointFromSpki(spki: Uint8Array): Uint8Array {
  const prefixMatches =
    spki.length === SPKI_PREFIX.length + 65 && SPKI_PREFIX.every((byte, i) => spki[i] === byte);
  if (!prefixMatches || spki[SPKI_PREFIX.length] !== 0x04) {
    throw new KmsKeyError("the KMS public key is not a secp256k1 SubjectPublicKeyInfo");
  }
  return spki.slice(SPKI_PREFIX.length);
}

/** One DER INTEGER at `at`: its value and where the next element starts. */
function readInteger(der: Uint8Array, at: number): { value: bigint; next: number } {
  if (der[at] !== 0x02) throw new Error("DER signature: an INTEGER was expected");
  const length = der[at + 1];
  if (length === undefined || length === 0 || length > 33 || at + 2 + length > der.length) {
    throw new Error("DER signature: bad INTEGER length");
  }
  const bytes = der.slice(at + 2, at + 2 + length);
  return { value: BigInt(bytesToHex(bytes)), next: at + 2 + length };
}

/** `SEQUENCE { r INTEGER, s INTEGER }`, as KMS returns an ECDSA signature. Strict: nothing extra. */
export function derSignatureToRs(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) {
    throw new Error("DER signature: not a SEQUENCE of the stated length");
  }
  const r = readInteger(der, 2);
  const s = readInteger(der, r.next);
  if (s.next !== der.length) throw new Error("DER signature: bytes after s");
  if (r.value === 0n || r.value >= N || s.value === 0n || s.value >= N) {
    throw new Error("DER signature: r or s out of range");
  }
  return { r: r.value, s: s.value };
}

/**
 * The account for one KMS key. Reads the public key once, refuses a key with the wrong spec or
 * usage before any sign, and signs nothing but digests.
 */
export async function kmsEvmAccount(kms: KmsClient, keyId: string): Promise<LocalAccount> {
  const key = await kms.getPublicKey(keyId);
  if (key.keySpec !== KEY_SPEC || key.keyUsage !== KEY_USAGE) {
    throw new KmsKeyError(
      `KMS key ${keyId} is ${key.keySpec} ${key.keyUsage}, an EVM key must be ${KEY_SPEC} ${KEY_USAGE}`,
    );
  }
  const point = pointFromSpki(key.publicKey);
  const publicKey = bytesToHex(point);
  const address = publicKeyToAddress(publicKey);

  async function signDigest(digest: Hex): Promise<{ r: Hex; s: Hex; yParity: number }> {
    const der = await kms.sign(keyId, hexToBytes(digest), "ECDSA_SHA_256", "DIGEST");
    const { r, s: rawS } = derSignatureToRs(der);
    const s = rawS > N / 2n ? N - rawS : rawS;
    for (const yParity of [0, 1]) {
      const recovered = new secp256k1.Signature(r, s)
        .addRecoveryBit(yParity)
        .recoverPublicKey(digest.slice(2))
        .toRawBytes(false);
      if (bytesToHex(recovered) === publicKey) {
        return {
          r: `0x${r.toString(16).padStart(64, "0")}`,
          s: `0x${s.toString(16).padStart(64, "0")}`,
          yParity,
        };
      }
    }
    throw new Error(`the KMS signature for key ${keyId} does not recover to ${address}`);
  }

  return toAccount({
    address,
    async signMessage({ message }) {
      return serializeSignature(await signDigest(hashMessage(message)));
    },
    async signTypedData(typedData) {
      return serializeSignature(await signDigest(hashTypedData(typedData)));
    },
    async signTransaction(transaction, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      const signature = await signDigest(keccak256(await serializer(transaction)));
      return serializer(transaction, signature);
    },
  });
}
