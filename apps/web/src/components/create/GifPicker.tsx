"use client";

import { GiphyFetch, type GifResult } from "@giphy/js-fetch-api";
import { Grid } from "@giphy/react-components";
import { useEffect, useMemo, useRef, useState } from "react";

import { Tabs } from "@/components/boards/BoardTabs";
import { PoweredByGiphy } from "@/components/drops/PoweredByGiphy";
import { Input } from "@/components/ui/input";
import { gridOptions, type GiphyKind } from "@/lib/giphy";
import { cn } from "@/lib/utils";

type GiphyGif = GifResult["data"];

/** Search waits until typing stops. */
const TYPING_MS = 400;

/**
 * The GIF picker: one search box, the
 * `gifs` and `stickers` tabs, GIPHY trending of the open tab while the box is empty, rating `pg`,
 * "Powered By GIPHY" under the grid. Every call goes from the browser to GIPHY.
 */
export default function GifPicker({
  apiKey,
  onPick,
  onClose,
}: {
  apiKey: string;
  onPick: (gif: GiphyGif) => void;
  onClose: () => void;
}) {
  const giphy = useMemo(() => new GiphyFetch(apiKey), [apiKey]);
  const [kind, setKind] = useState<GiphyKind>("gif");
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), TYPING_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fetchGifs = (offset: number) =>
    term === ""
      ? giphy.trending({ ...gridOptions(kind), offset })
      : giphy.search(term, { ...gridOptions(kind), offset });

  return (
    <div className="card mt-2 rounded-lg p-3">
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="search GIPHY"
          aria-label="search GIPHY"
          className="type-body h-10 rounded-lg border-chad-border bg-chad-surface"
        />
        <button
          type="button"
          onClick={onClose}
          className="type-small interactive shrink-0 text-chad-text-dim hover:text-chad-text"
        >
          close
        </button>
      </div>
      <div className="mt-3 md:inline-block">
        <Tabs label="gifs or stickers">
          {(["gif", "sticker"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={kind === tab}
              onClick={() => setKind(tab)}
              className={segment(kind === tab)}
            >
              {tab === "gif" ? "gifs" : "stickers"}
            </button>
          ))}
        </Tabs>
      </div>
      <div ref={box} className="mt-3 max-h-80 overflow-y-auto">
        {width > 0 ? (
          <Grid
            key={`${kind}:${term}`}
            width={width}
            columns={3}
            gutter={6}
            fetchGifs={fetchGifs}
            noLink
            hideAttribution
            backgroundColor="transparent"
            onGifClick={(gif, event) => {
              event.preventDefault();
              onPick(gif);
            }}
          />
        ) : null}
      </div>
      <PoweredByGiphy className="mt-3" />
    </div>
  );
}

/** The board tab look, as `ModeSwitch`. */
const segment = (active: boolean) =>
  cn(
    "type-body flex h-11 flex-1 items-center justify-center rounded-md px-2.5 font-medium whitespace-nowrap md:h-8 md:flex-none",
    active
      ? "interactive bg-chad-surface-2 text-chad-text hover:bg-chad-surface-2"
      : "interactive text-chad-text-dim hover:text-chad-text",
  );
