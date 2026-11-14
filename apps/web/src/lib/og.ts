/**
 * The og image of this build: `testnet` on a
 * testnet build, `beta` on a mainnet build. Both files are made by a script, never
 * edited by hand. Set by the root layout; no file based og image, which would override it.
 */

/** The tagline: drop crypto, prove you did. every drop is proved on chain. */
const ALT = "dropchad. drop crypto, prove you did. every drop is proved on chain.";

export interface OgImage {
  readonly url: string;
  readonly width: 1200;
  readonly height: 630;
  readonly alt: string;
}

export function ogImage(testnetOnly: boolean): OgImage {
  const word = testnetOnly ? "testnet" : "beta";
  return { url: `/brand/og-${word}.png`, width: 1200, height: 630, alt: `${ALT} ${word}.` };
}
