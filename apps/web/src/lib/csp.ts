/**
 * The site's strict CSP. Enforced on every
 * page by `src/proxy.ts` with a fresh nonce per request. Scripts never get `'unsafe-inline'`;
 * `'strict-dynamic'` lets the nonce scripts load Next's chunks. Styles keep `'unsafe-inline'`
 * this round: the pages use inline style props. `'unsafe-eval'` in development only, where React
 * needs it (Next's CSP guide). `https:` images for the X pictures and a sender's meme picture,
 * `data:` for the QR code, `blob:` for the share card.
 */

/** 16 random bytes, base64. A new one for every request. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function sitePolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
