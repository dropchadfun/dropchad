/**
 * Base58, the Bitcoin alphabet, as Solana public keys are written. Thirty lines instead of a
 * dependency: the only thing this package needs is 32 bytes in, 32 bytes out.
 */
import { bytesToHex, hexToBytes, type Hex } from "viem";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map<string, bigint>([...ALPHABET].map((c, i) => [c, BigInt(i)]));

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) {
    const digit = INDEX.get(c);
    if (digit === undefined) throw new Error(`not base58: ${text}`);
    n = n * 58n + digit;
  }
  const body: number[] = [];
  while (n > 0n) {
    body.unshift(Number(n % 256n));
    n /= 256n;
  }
  let zeros = 0;
  for (const c of text) {
    if (c !== "1") break;
    zeros += 1;
  }
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...body]);
}

/** A Solana public key: base58 text that decodes to exactly 32 bytes. */
export function isPubkey(text: string): boolean {
  try {
    return base58Decode(text).length === 32;
  } catch {
    return false;
  }
}

/** The 32 raw bytes of a public key as `0x` hex, the form the leaf frame and the sort use. */
export function pubkeyToHex(text: string): Hex {
  const bytes = base58Decode(text);
  if (bytes.length !== 32) throw new Error(`not a 32 byte public key: ${text}`);
  return bytesToHex(bytes);
}

export function hexToPubkey(hex: Hex): string {
  return base58Encode(hexToBytes(hex));
}
