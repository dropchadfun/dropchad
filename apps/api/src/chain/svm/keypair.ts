/**
 * The relayer keypair, parsed once and then only able to sign.
 *
 * `SOLANA_RELAYER_SECRET` is in one of the two shapes the Solana tooling
 * produces: the JSON array of 64 bytes that `solana-keygen` writes to a file, or the same 64
 * bytes as base58 as some wallets export them. The first 32 bytes are the ed25519 seed, the last
 * 32 the public key, and the two are checked against each other so a corrupted paste is refused
 * rather than signing with a key that does not match its address.
 *
 * The seed lives inside a closure. Nothing here returns it, logs it, or keeps it on an object
 * that could be serialised.
 */
import { ed25519 } from "@noble/curves/ed25519";

import { base58Decode } from "@dropchad/shared";

import { pubkeyEquals, type Pubkey } from "./pubkey.js";

export interface Signer {
  readonly publicKey: Pubkey;
  sign(message: Uint8Array): Uint8Array;
}

export class SecretFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretFormatError";
  }
}

function parseBytes(secret: string, name: string): Uint8Array {
  const trimmed = secret.trim();
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new SecretFormatError(`${name} looks like JSON but does not parse`);
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)
    ) {
      throw new SecretFormatError(`${name} must be a JSON array of bytes 0 to 255`);
    }
    return new Uint8Array(parsed as number[]);
  }
  try {
    return base58Decode(trimmed);
  } catch {
    throw new SecretFormatError(
      `${name} must be the 64 byte JSON array solana-keygen writes, or base58`,
    );
  }
}

/**
 * Build a signer from the pasted secret. The only function that ever sees the seed.
 *
 * The error messages name the variable and the expected shape, never any part of the value.
 */
export function signerFromSecret(secret: string, name = "SOLANA_RELAYER_SECRET"): Signer {
  const bytes = parseBytes(secret, name);
  if (bytes.length !== 64) {
    throw new SecretFormatError(`${name} must decode to 64 bytes, got ${String(bytes.length)}`);
  }
  const seed = bytes.slice(0, 32);
  const stated = bytes.slice(32, 64);
  const derived = ed25519.getPublicKey(seed);
  if (!pubkeyEquals(derived, stated)) {
    throw new SecretFormatError(
      `${name} is corrupt: the public key half does not match the seed half`,
    );
  }
  return {
    publicKey: derived,
    sign: (message) => ed25519.sign(message, seed),
  };
}

/** A throwaway keypair. Tests and the fake chain only; nothing in `src/` calls it. */
export function randomSigner(): Signer {
  const seed = ed25519.utils.randomPrivateKey();
  return {
    publicKey: ed25519.getPublicKey(seed),
    sign: (message) => ed25519.sign(message, seed),
  };
}
