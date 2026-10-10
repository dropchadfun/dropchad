import type { Metadata } from "next";

import { InLink, TrustPage } from "@/components/site/TrustPage";

export const metadata: Metadata = {
  title: "privacy",
  description: "what dropchad keeps about you, and why.",
};

/**
 * `/privacy`. Only what the api's tables
 * (`apps/api/src/db/schema.ts`) and the browser really keep; a new column or browser key about a
 * person changes this page in the same change.
 */
export default function Page() {
  return (
    <TrustPage
      title="privacy"
      intro="what we keep, and why. nothing more."
      sections={[
        {
          title: "when you sign in with X",
          lines: [
            "your X id, handle, name and picture link, to show your profile, your drops and your claims.",
            "the X login token is used once to read who you are, then revoked. we never keep it, and we can not post for you.",
          ],
        },
        {
          title: "your session",
          lines: [
            "a cookie keeps you signed in for 30 days. we store only a hash of it. log out ends it at once.",
            "while you sign in, a short login check is kept for 10 minutes.",
          ],
        },
        {
          title: "people you send to",
          lines: [
            "their X id, handle, name and picture link, so a drop can show who it pays. they do not need to sign in for this.",
          ],
        },
        {
          title: "your drops",
          lines: [
            "the refund address, the title, the picture link, and the list of handles and amounts. we need them to run and show the drop.",
          ],
        },
        {
          title: "your claims",
          lines: [
            "the wallet you paste, our signature that links it to your X, and the tx hash. we need them to pay you and to prove it.",
          ],
        },
        {
          title: "in your browser only",
          lines: [
            "two small notes on this device: that you closed the hackathon line, and that you closed the welcome popup.",
            "share card pictures never leave your browser.",
          ],
        },
        {
          title: "on chain",
          lines: [
            "drops, claims and refunds are on a public chain. that is public and permanent. we can not delete it.",
          ],
        },
        {
          title: "what we do not do",
          lines: ["no analytics, no ads, no selling data."],
        },
        {
          title: "logs",
          lines: [
            "our server logs and cloudflare see ip addresses, to keep the site running and safe.",
          ],
        },
        {
          title: "delete your data",
          lines: [
            <>
              write to us on the <InLink href="/contact">contact page</InLink>. what is on chain
              stays.
            </>,
          ],
        },
      ]}
    />
  );
}
