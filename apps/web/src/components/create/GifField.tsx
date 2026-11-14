"use client";

import type { GifResult } from "@giphy/js-fetch-api";
import dynamic from "next/dynamic";
import { useState } from "react";

import type { CreateMode } from "@/components/create/form";
import { giphyKey, type Giphy } from "@/lib/giphy";

type GiphyGif = GifResult["data"];

/** The SDK loads only when the picker opens. */
const GifPicker = dynamic(() => import("@/components/create/GifPicker"), { ssr: false });

/**
 * The GIF field on `/create`, under the title
 * `add a gif or sticker` opens the picker; a pick shows small with `remove`. Drop mode only, and
 * only with a GIPHY key: otherwise nothing.
 */
export function GifField({
  mode,
  value,
  onChange,
}: {
  mode: CreateMode;
  value: Giphy | null;
  onChange: (value: Giphy | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<GiphyGif | null>(null);
  const key = giphyKey();
  if (mode !== "drop" || key === null) return null;

  const shown = value !== null && picked !== null && picked.id === value.id ? picked : null;

  return (
    <div>
      <span className="type-label">gif or sticker</span>
      {shown ? (
        <div className="mt-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- GIPHY's URL, unchanged */}
          <img
            src={shown.images.fixed_height_small.url}
            alt={shown.title}
            className="h-16 w-auto rounded-lg bg-chad-bg"
          />
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              onChange(null);
            }}
            className="type-small interactive text-chad-text-dim hover:text-chad-text"
          >
            remove
          </button>
        </div>
      ) : open ? (
        <GifPicker
          apiKey={key}
          onPick={(gif) => {
            setPicked(gif);
            setOpen(false);
            onChange({ id: gif.id.toString(), kind: gif.is_sticker ? "sticker" : "gif" });
          }}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="card type-body interactive mt-2 flex h-10 w-full items-center rounded-lg px-3 text-chad-text-dim hover:text-chad-text"
        >
          add a gif or sticker
        </button>
      )}
    </div>
  );
}
