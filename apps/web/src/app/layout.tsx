import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";

import { BottomBar } from "@/components/site/BottomBar";
import { Footer } from "@/components/site/Footer";
import { HackathonLine } from "@/components/site/HackathonLine";
import { PauseBanner } from "@/components/site/PauseBanner";
import { BetaCard } from "@/components/site/BetaCard";
import { WelcomePopup } from "@/components/site/WelcomePopup";
import { Header } from "@/components/site/Header";
import { SessionProvider } from "@/components/site/SessionProvider";
import { betaCardCaps } from "@/lib/beta";
import { TESTNET_ONLY, liveMainnetKeys } from "@/lib/chains";
import { readLiveChains } from "@/lib/live-chains";
import { ogImage } from "@/lib/og";
import { CLOSED_TESTNET_TEXT, readPauseText } from "@/lib/pause";

import "./globals.css";

/** Two fonts: Inter for everything, Space Grotesk for page titles. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

/**
 * The icons and the manifest are Next file conventions next to this file: `favicon.ico`,
 * `apple-icon.png`, `manifest.webmanifest`. No `icon.svg`: a traced hand is not the logo,
 * Next writes their tags itself.
 * The og image is set here, by build: `testnet` or `beta`,
 * `lib/og.ts`. No `opengraph-image.*` file: a file based image overrides this object.
 * X falls back to `og:image` when the card is set.
 * `metadataBase` makes those image urls full `https://dropchad.com/…` urls; without it Next wrote
 * `http://localhost:3000/…` and Discord showed an empty card.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://dropchad.com"),
  title: { default: "dropchad", template: "%s · dropchad" },
  description: "drop crypto, prove you did. every drop is proved on chain.",
  openGraph: { images: [ogImage(TESTNET_ONLY)] },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

/**
 * The nonce of this request, from `src/proxy.ts`. Reading it
 * renders every page per request, so every page can carry it.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // read per request, 1.5 s at most; a failed or slow read is no banner.
  const pauseText = await readPauseText();
  // The beta card lines of the live chains, from the api switch.
  const betaCaps = betaCardCaps(liveMainnetKeys(undefined, await readLiveChains()));
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <SessionProvider>
          {/* The pause banner: on top of every page while new drops are off somewhere. */}
          <PauseBanner text={pauseText} />
          {/* The hackathon line: above the top bar, not sticky. */}
          <HackathonLine nonce={nonce} />
          <Header />
          <div className="flex-1 pb-8 md:pb-12">{children}</div>
          {/* The footer keeps room for the bottom bar on phone. On desktop there is none. */}
          <Footer />
          <BottomBar />
          {/* The welcome popup: drawn in the browser only, while testnet only, never while
              the testnet is closed. */}
          <WelcomePopup testnetClosed={pauseText === CLOSED_TESTNET_TEXT} />
          {/* The beta card: drawn in the browser only, mainnet only. */}
          <BetaCard caps={betaCaps} />
        </SessionProvider>
      </body>
    </html>
  );
}
