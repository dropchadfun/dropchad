import type { Metadata } from "next";

import { betaSections, OutLink, TrustPage } from "@/components/site/TrustPage";
import { dropCapWords } from "@/lib/beta";
import { TESTNET_ONLY, liveMainnetKeys } from "@/lib/chains";
import { readLiveChains } from "@/lib/live-chains";
import { HACKATHON_URL } from "@/lib/hackathon";
import { githubUrl } from "@/lib/social";

export const metadata: Metadata = {
  title: "about",
  description: TESTNET_ONLY
    ? "who builds dropchad, testnet only, no token, open code."
    : "who builds dropchad, beta, no token, open code.",
};

/**
 * `/about`. The only person's name on it is the builder's own line.
 */
export default async function Page() {
  // The caps of the live chains, from the api switch.
  const capWords = dropCapWords(liveMainnetKeys(undefined, await readLiveChains()));
  return (
    <TrustPage
      title="about dropchad"
      intro="send crypto to anyone on X, just by their username. they sign in with X to claim."
      sections={[
        {
          title: "who builds it",
          lines: [
            <>
              built by <OutLink href="https://x.com/einzxx">Einz</OutLink>.
            </>,
            <>
              built for the Crypto World&apos;s Fair hackathon.{" "}
              <OutLink href={HACKATHON_URL}>see our project page</OutLink>
            </>,
          ],
        },
        // Mainnet: beta and caps per drop instead.
        ...(TESTNET_ONLY
          ? [
              {
                title: "testnet only",
                lines: [
                  "dropchad is testnet only right now, on solana devnet and robinhood chain testnet.",
                  "the coins here are test coins. they have no value.",
                ],
              },
            ]
          : betaSections(capWords)),
        {
          title: "no token",
          lines: [
            "dropchad has no token. anyone selling one is not us.",
            "we never DM you first, and we never ask for your seed phrase or private keys.",
          ],
        },
        {
          title: "open code",
          lines: [
            <>
              the code is public.{" "}
              <OutLink href={githubUrl()}>github.com/dropchadfun/dropchad</OutLink>
            </>,
          ],
        },
      ]}
    />
  );
}
