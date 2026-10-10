"use client";

import { useEffect, useRef, useState } from "react";

import { BOARD_REFRESH_MS, updatedLine } from "@/components/boards/live-line";
import { ApiError, type Board } from "@/lib/api";

/**
 * A board that fetches itself again every 60 seconds while the page is open.
 * `load` reads the current choice; a failed fetch keeps the old rows and the old time. `set`
 * lets a tab or a rail tap put a new board in with the time it came.
 */
export function useLiveBoard(
  initial: Board | null,
  load: () => Promise<Board>,
): {
  board: Board | null;
  fetchedAt: number;
  set: (board: Board | null) => void;
} {
  const [board, setBoard] = useState(initial);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  useEffect(() => {
    let live = true;
    const timer = setInterval(() => {
      loader.current().then(
        (next) => {
          if (!live) return;
          setBoard(next);
          setFetchedAt(Date.now());
        },
        (error: unknown) => {
          if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
        },
      );
    }, BOARD_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const set = (next: Board | null) => {
    setBoard(next);
    if (next !== null) setFetchedAt(Date.now());
  };
  return { board, fetchedAt, set };
}

/**
 * The live line under a board's title: the mint live dot and `live · updated 20s ago`. The
 * words move on every 5 seconds; the first render says `just now` on the server and in the
 * browser alike.
 */
export function LiveLine({ fetchedAt }: { fetchedAt: number }) {
  const [now, setNow] = useState(fetchedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="type-small mt-1 flex items-center gap-1.5 text-chad-text-dim">
      <span className="live-dot size-1.5 rounded-full bg-chad-accent" aria-hidden="true" />
      {updatedLine(fetchedAt, Math.max(now, fetchedAt))}
    </p>
  );
}
