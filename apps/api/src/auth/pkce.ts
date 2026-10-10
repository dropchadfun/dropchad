/**
 * PKCE, and the random values the login flow needs.
 *
 * `docs.x.com` allows `S256` or `plain`. **We use S256 only.** `plain` sends the verifier itself
 * in the authorize URL, which defeats the point.
 *
 * Everything random here comes from `crypto.randomBytes`, never `Math.random`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes as base64url. 43 characters, inside the 43 to 128 the design allows. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** The PKCE code verifier. */
export function createCodeVerifier(): string {
  return randomToken(32);
}

/** `base64url(sha256(verifier))`. The `S256` method. */
export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Constant time string compare, for anything a caller can guess at. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, so the length is compared first. Length is not
  // the secret here: every token we compare has a fixed length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
