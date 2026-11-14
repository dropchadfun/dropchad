"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { PoweredByGiphy } from "@/components/drops/PoweredByGiphy";
import { giphyKey, type Giphy } from "@/lib/giphy";

/** The SDK and the GIF load only in the browser, after the page. */
const GifView = dynamic(() => import("@/components/drops/GifView"), { ssr: false });

/**
 * A drop's GIF at the top of its card: an
 * empty box of the final height until the GIF is in, 180px on phone and 240px from `md`, dark
 * on the sides; "Powered By GIPHY" under it once it shows. No GIF, no key, or a GIF that does not
 * load: nothing at all.
 */
export function DropGif({ giphy }: { giphy: Giphy | null | undefined }) {
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const key = giphyKey();
  if (giphy === null || giphy === undefined || key === null || state === "failed") return null;

  return (
    <div className="mb-4">
      <div
        data-drop-gif=""
        className="flex h-[180px] w-full items-center justify-center overflow-hidden rounded-lg bg-chad-bg md:h-[240px]"
      >
        <GifView
          apiKey={key}
          giphy={giphy}
          onShown={() => setState("shown")}
          onFailed={() => setState("failed")}
        />
      </div>
      {state === "shown" ? <PoweredByGiphy className="mt-2" /> : null}
    </div>
  );
}
