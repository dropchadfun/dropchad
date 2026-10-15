import type { Metadata } from "next";

import { InLink, TrustPage } from "@/components/site/TrustPage";

export const metadata: Metadata = {
  title: "terms",
  description: "the short terms for using dropchad on testnet.",
};

/** `/terms`. Short and plain. */
export default function Page() {
  return (
    <TrustPage
      title="terms"
      intro="short and plain. by using dropchad you agree to this."
      sections={[
        {
          title: "testnet only",
          lines: [
            "dropchad runs on testnets only. use test coins only. they have no value.",
            "never send real coins to a drop.",
          ],
        },
        {
          title: "on chain is final",
          lines: [
            "what happens on chain is final. we cannot undo a transfer, a claim or a refund.",
            "the fee is shown before you send.",
            "check every address before you send.",
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
