import type { Metadata } from "next";

import { BETA_SECTIONS, InLink, TrustPage } from "@/components/site/TrustPage";
import { TESTNET_ONLY } from "@/lib/chains";
import { NAME_WARNING } from "@/lib/social";

export const metadata: Metadata = {
  title: "terms",
  description: TESTNET_ONLY
    ? "the short terms for using dropchad on testnet."
    : "the short terms for using dropchad.",
};

/** `/terms`. Short and plain. */
export default function Page() {
  return (
    <TrustPage
      title="terms"
      intro="short and plain. by using dropchad you agree to this."
      sections={[
        // Mainnet: beta and caps per drop instead.
        ...(TESTNET_ONLY
          ? [
              {
                title: "testnet only",
                lines: [
                  "dropchad runs on testnets only. use test coins only. they have no value.",
                  "never send real coins to a drop.",
                ],
              },
            ]
          : BETA_SECTIONS),
        {
          title: "on chain is final",
          lines: [
            "what happens on chain is final. we cannot undo a transfer, a claim or a refund.",
            "the fee is shown before you send.",
            "check every address before you send.",
          ],
        },
        {
          title: "your X account",
          lines: [
            "your X account is how you claim. if someone takes over your X account, they can claim your drops.",
            "that is your risk. keep it safe and turn on 2FA.",
          ],
        },
        {
          title: "your wallet",
          lines: [
            "you paste the wallet your claim goes to. if you paste a wrong address, the coins are gone.",
            "we cannot get them back.",
          ],
        },
        {
          title: "tokens",
          lines: [
            "anyone can drop any token. we do not check tokens. a token here is not a pick by us.",
            "claims are at your own risk.",
            "stablecoins like USDC, USDT and USDG are controlled by their issuers. they can freeze or remove balances. dropchad cannot change that.",
          ],
        },
        {
          title: "no advice",
          lines: ["dropchad is not financial advice. we never promise a price or returns."],
        },
        {
          title: "your part",
          lines: [
            "do not use dropchad for anything illegal.",
            "your wallet and your keys are yours to keep safe.",
          ],
        },
        {
          title: "no warranty",
          lines: [
            "dropchad is given as it is, with no warranty. it can have bugs.",
            "we can change or stop the service at any time.",
          ],
        },
        {
          title: "not X",
          lines: ["dropchad is not run by X. we use X login only to know who you are."],
        },
        {
          title: "our name",
          // Mint, so people read it, never a link.
          lines: [
            <span key="name" className="text-chad-accent">
              {NAME_WARNING}
            </span>,
          ],
        },
        {
          title: "questions",
          lines: [
            <>
              ask us on the <InLink href="/contact">contact page</InLink>.
            </>,
          ],
        },
      ]}
    />
  );
}
