"use client";

import { GiphyFetch, type GifResult } from "@giphy/js-fetch-api";
import { Gif } from "@giphy/react-components";
import { useEffect, useRef, useState } from "react";

import { gifSize } from "@/components/drops/gif-size";
import { stillOf, type Giphy } from "@/lib/giphy";

type GiphyGif = GifResult["data"];

/** The box heights of `DropGif`, Tailwind `md` from 768px. */
const PHONE_HEIGHT = 180;
const DESKTOP_HEIGHT = 240;

/**
 * The browser half of `DropGif`: fetches the GIF by its id from GIPHY and draws it with the SDK,
 * sized by `gifSize`, from the URLs GIPHY returns. Reduced motion: GIPHY's still frame.
 */
export default function GifView({
  apiKey,
  giphy,
  onShown,
  onFailed,
}: {
  apiKey: string;
  giphy: Giphy;
  onShown: () => void;
  onFailed: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [gif, setGif] = useState<GiphyGif | null>(null);
  const [maxWidth, setMaxWidth] = useState(0);

  useEffect(() => {
    let live = true;
    new GiphyFetch(apiKey)
      .gif(giphy.id)
      .then((result) => {
        if (!live) return;
        setGif(result.data);
        onShown();
      })
      .catch(() => {
        if (live) onFailed();
      });
    return () => {
      live = false;
    };
    // One fetch per GIF; the callbacks only report back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, giphy.id]);

  useEffect(() => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    const measure = () => setMaxWidth(parent.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  const still =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shape = gif?.images.fixed_height;
  const size =
    shape && maxWidth > 0
      ? gifSize(
          { width: shape.width, height: shape.height },
          { boxHeight: desktop ? DESKTOP_HEIGHT : PHONE_HEIGHT, maxWidth },
        )
      : null;
  const stillUrl = gif ? stillOf(gif) : null;

  return (
    <div ref={box} className="flex items-center justify-center">
      {gif && size && size.width > 0 ? (
        still && stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- GIPHY's URL, unchanged
          <img src={stillUrl} alt={gif.title} width={size.width} height={size.height} />
        ) : (
          <Gif
            gif={gif}
            width={size.width}
            height={size.height}
            noLink
            hideAttribution
            backgroundColor="transparent"
          />
        )
      ) : null}
    </div>
  );
}
