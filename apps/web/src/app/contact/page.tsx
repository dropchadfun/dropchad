import type { Metadata } from "next";

import { InLink, OutLink, TrustPage } from "@/components/site/TrustPage";
import { CONTACT_EMAIL, xUrl } from "@/lib/social";

export const metadata: Metadata = {
  title: "contact",
  description: "email and X for dropchad.",
};

/**
 * `/contact`. X in place of Telegram
 * the Telegram channel takes no messages, X DMs are open.
 */
export default function Page() {
  return (
    <TrustPage
      title="contact"
      sections={[
        {
          title: "email",
          lines: [
            <InLink key="email" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </InLink>,
          ],
        },
        {
          title: "X",
          lines: [
            <OutLink key="x" href={xUrl()}>
              x.com/dropchadfun
            </OutLink>,
            "DMs open",
          ],
        },
        {
          title: "security",
          lines: ["for a security issue, email us. we never DM you first."],
        },
      ]}
    />
  );
}
