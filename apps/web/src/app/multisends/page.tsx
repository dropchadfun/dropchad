import type { Metadata } from "next";

import { MyMultisends } from "@/components/drops/MyMultisends";

/** Personal: the sender's own multisends. Never in a search engine. */
export const metadata: Metadata = {
  title: "your multisends",
  robots: { index: false, follow: false },
};

/**
 * `/multisends`. The list comes from the
 * browser, which carries the session cookie; the server part renders the frame only.
 */
export default function Page() {
  return <MyMultisends />;
}
