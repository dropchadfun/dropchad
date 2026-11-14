/**
 * The two AWS KMS calls the api makes: `GetPublicKey` and `Sign`,
 * nothing else. The real client over `@aws-sdk/client-kms` comes with the config; the
 * accounts and signers built on it only see this interface, so a test can pass a fake.
 *
 * A KMS key cannot be exported. The api holds a key id, never key material.
 */

export type KmsSigningAlgorithm = "ECDSA_SHA_256" | "ED25519_SHA_512";
export type KmsMessageType = "DIGEST" | "RAW";

export interface KmsPublicKey {
  /** DER `SubjectPublicKeyInfo`, as `GetPublicKey` returns it. */
  readonly publicKey: Uint8Array;
  /** `KeySpec`, for example `ECC_SECG_P256K1`. */
  readonly keySpec: string;
  /** `KeyUsage`, `SIGN_VERIFY` for every key the api uses. */
  readonly keyUsage: string;
}

export interface KmsClient {
  getPublicKey(keyId: string): Promise<KmsPublicKey>;
  /** The raw signature bytes `Sign` returns: DER for ECDSA, 64 bytes for Ed25519. */
  sign(
    keyId: string,
    message: Uint8Array,
    algorithm: KmsSigningAlgorithm,
    messageType: KmsMessageType,
  ): Promise<Uint8Array>;
}

/** A key that is not what its role needs: wrong spec, wrong usage, or an unreadable public key. */
export class KmsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmsKeyError";
  }
}
