import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";

import { BottomBar } from "@/components/site/BottomBar";
import { Footer } from "@/components/site/Footer";
import { HackathonLine } from "@/components/site/HackathonLine";
import { WelcomePopup } from "@/components/site/WelcomePopup";
import { Header } from "@/components/site/Header";
import { SessionProvider } from "@/components/site/SessionProvider";

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
 * The icons, the og image and the manifest are Next file conventions next to this file:
 * `favicon.ico`, `apple-icon.png`, `opengraph-image.png`, `manifest.webmanifest`. No `icon.svg`:
 * a traced hand is not the logo.
 * Next writes their tags itself. X falls back to `og:image` when the card is set.
 * `metadataBase` makes those image urls full `https://dropchad.com/…` urls; without it Next wrote
 * `http://localhost:3000/…` and Discord showed an empty card.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://dropchad.com"),
  title: { default: "dropchad", template: "%s · dropchad" },
  description: "drop crypto, prove you did. every drop is proved on chain.",
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <SessionProvider>
          {/* The hackathon line: above the top bar, not sticky. */}
          <HackathonLine />
          <Header />
          <div className="flex-1 pb-8 md:pb-12">{children}</div>
          {/* The footer keeps room for the bottom bar on phone. On desktop there is none. */}
          <Footer />
          <BottomBar />
          {/* The welcome popup: drawn in the browser only, while testnet only. */}
          <WelcomePopup />
        </SessionProvider>
      </body>
    </html>
  );
}
