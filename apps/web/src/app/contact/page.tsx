import type { Metadata } from "next";

import { InLink, OutLink, TrustPage } from "@/components/site/TrustPage";
import { CONTACT_EMAIL, telegramUrl } from "@/lib/social";

export const metadata: Metadata = {
  title: "contact",
  description: "email and telegram for dropchad.",
};

/** `/contact`. */
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
          title: "telegram",
          lines: [
            <OutLink key="telegram" href={telegramUrl()}>
              t.me/dropchad
            </OutLink>,
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
