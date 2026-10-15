import type { Metadata } from "next";

import { OutLink, TrustPage } from "@/components/site/TrustPage";
import { HACKATHON_URL } from "@/lib/hackathon";
import { githubUrl } from "@/lib/social";

export const metadata: Metadata = {
  title: "about",
  description: "who builds dropchad, testnet only, no token, open code.",
};

/** `/about`. No person's name, the public repo only. */
export default function Page() {
  return (
    <TrustPage
      title="about dropchad"
      intro="send crypto to anyone on X, just by their username. they sign in with X to claim."
      sections={[
        {
          title: "who builds it",
          lines: [
            "built by the dropchad team.",
            <>
              built for the Crypto World&apos;s Fair hackathon.{" "}
              <OutLink href={HACKATHON_URL}>see our project page</OutLink>
            </>,
          ],
        },
        {
          title: "testnet only",
          lines: [
            "dropchad is testnet only right now, on solana devnet and robinhood chain testnet.",
            "the coins here are test coins. they have no value.",
          ],
        },
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
